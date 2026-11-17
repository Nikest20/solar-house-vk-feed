// Solar House VK: cloud-only publication of ALREADY uploaded community photos.
// GitHub-hosted runner: no Chrome, no user VK token, no dependency on the PC.
// Disabled by default. Commits a one-shot ledger BEFORE the wall.post request.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePost, GROUP_ID, sha256 } from './lib.mjs';
import { preparedAttachment, cloudDuePosts } from './offline-lib.mjs';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SRC);
const LEDGER = path.join(ROOT, 'cloud-publisher-state');
const QUEUE = path.join(ROOT, 'queue');

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
}

const mode = option('--mode', 'preview');
if (!['preview', 'live'].includes(mode)) throw new Error('Разрешены только --mode preview и --mode live');

function loadPosts() {
  const posts = fs.readdirSync(QUEUE).filter(name => name.endsWith('.json')).sort().map(name =>
    validatePost(JSON.parse(fs.readFileSync(path.join(QUEUE, name), 'utf8')), name));
  const ids = new Set();
  for (const post of posts) {
    if (ids.has(post.id)) throw new Error(`Повторный ID в очереди: ${post.id}`);
    ids.add(post.id);
  }
  return posts;
}

function ledgerPath(postId) { return path.join(LEDGER, `${postId}.json`); }
function readLedger(postId) {
  const file = ledgerPath(postId);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('Не удалось записать журнал в GitHub. Проверьте локальное и удалённое состояние перед любым повтором.'); }
}

function saveAndPush(state, branch, reason) {
  fs.mkdirSync(LEDGER, { recursive: true });
  const file = ledgerPath(state.post_id);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
  const relative = path.relative(ROOT, file).replaceAll('\\', '/');
  try {
    git(['add', '--', relative]);
    git(['commit', '-m', `VK: ${reason} ${state.post_id}`]);
    git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  } catch {
    if (reason === 'attempt') {
      throw new Error('Не удалось записать в GitHub защиту перед публикацией; VK API не вызывался.');
    }
    throw new Error('VK мог принять публикацию, но обновление журнала GitHub не удалось. Повтор запрещён.');
  }
}

async function postOne(attachment, post, token) {
  const body = new URLSearchParams({
    owner_id: `-${GROUP_ID}`,
    from_group: '1',
    attachments: attachment,
    message: post.text,
    guid: `shvk-${post.id}`,
    access_token: token,
    v: '5.199',
  });
  // Intentionally ONE request. Timeout does not authorize a retry.
  const response = await fetch('https://api.vk.ru/method/wall.post', {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new Error('VK HTTP-ответ неопределён: повтор запрещён');
  return response.json();
}

async function main() {
  const posts = loadPosts();
  const due = cloudDuePosts(posts);
  console.log('SOLAR HOUSE / VK — ОБЛАЧНОЕ РАСПИСАНИЕ');
  console.log(`Режим: ${mode}; очередь ${posts.length}; утверждено и наступило время ${due.length}`);
  if (mode === 'preview') {
    for (const post of posts) {
      const stage = preparedAttachment(post);
      const ledger = readLedger(post.id);
      console.log(`${post.id}: ${post.status}; подготовка=${stage.ready}; публикация=${ledger?.status ?? 'нет'}`);
    }
    console.log('Режим preview: GitHub, ключ ВК и wall.post не изменяются.');
    return;
  }

  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.VK_PUBLISH_ENABLED !== 'true') {
    throw new Error('LIVE разрешён только в GitHub Actions с VK_PUBLISH_ENABLED=true.');
  }
  if (!/^refs\/heads\/[a-zA-Z0-9._/-]+$/.test(process.env.GITHUB_REF ?? '')) {
    throw new Error('Не определена ветка GitHub; публикация остановлена.');
  }
  const branch = process.env.GITHUB_REF.slice('refs/heads/'.length);
  const token = process.env.VK_GROUP_TOKEN;
  if (!token || token.length < 20) throw new Error('В GitHub Secrets отсутствует постоянный VK_GROUP_TOKEN.');

  for (const post of due) {
    const state = readLedger(post.id);
    if (state?.status === 'published') {
      console.log(`Уже опубликовано ${post.id}: ${state.post_url}`);
      continue;
    }
    if (state) throw new Error(`${post.id}: найден статус ${state.status}; повтор публикации запрещён.`);
    const prepared = preparedAttachment(post);
    if (!prepared.ready) throw new Error(`${post.id}: ещё не подготовлено: ${prepared.reason}`);

    const next = {
      post_id: post.id,
      status: 'post-outcome-uncertain',
      photo_attachment: prepared.attachment,
      message_sha256: sha256(Buffer.from(post.text, 'utf8')),
      created_at_utc: new Date().toISOString(),
    };
    // If this commit/push fails, no wall.post is sent. If API times out,
    // the remote ledger stays uncertain and future runs MUST NOT resend.
    saveAndPush(next, branch, 'attempt');
    let vk;
    try { vk = await postOne(prepared.attachment, post, token); }
    catch { throw new Error(`${post.id}: исход wall.post неизвестен; ПРОВЕРИТЬ ВРУЧНУЮ, не повторять.`); }
    if (vk?.error) {
      next.status = 'vk-api-error';
      next.vk_error_code = Number(vk.error.error_code) || -1;
      saveAndPush(next, branch, 'api-error');
      throw new Error(`${post.id}: VK API отклонил публикацию (код ${next.vk_error_code}).`);
    }
    const vkId = vk?.response?.post_id;
    if (!/^\d+$/.test(String(vkId ?? ''))) throw new Error('VK не вернул post_id; повтор запрещён.');
    next.status = 'published';
    next.vk_post_id = String(vkId);
    next.post_url = `https://vk.ru/wall-${GROUP_ID}_${vkId}`;
    next.published_at_utc = new Date().toISOString();
    saveAndPush(next, branch, 'published');
    console.log(`ОПУБЛИКОВАНО: ${next.post_url}`);
    return; // Maximum one post per invocation.
  }
  console.log('Нет готовых новых постов.');
}

try { await main(); }
catch (error) { console.error(`ОСТАНОВЛЕНО: ${error.message}`); process.exitCode = 1; }
