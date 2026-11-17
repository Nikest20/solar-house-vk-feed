// Windows-side preparation while the owner's PC is on and logged in:
// upload approved images to VK community album ahead of schedule and write
// their photo IDs back to the GitHub-backed queue. No wall.post here.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256, validatePost, validateUploadResult, GROUP_ID } from './lib.mjs';
import { contentDigest, preparedAttachment } from './offline-lib.mjs';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SRC);
const APP_ROOT = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'SolarHouseVkAuto');
const STATE_DIR = path.join(APP_ROOT, 'photo-staging-state');
const DIAG_DIR = path.join(APP_ROOT, 'upload-diagnostics');
const LOCK = path.join(STATE_DIR, '.stage-running.lock');
// Deliberately not tracked in the public repo: user-specific arming state.
const CONFIG_FILE = path.join(ROOT, 'publisher.local.json');

function arg(name, fallback) { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; }
const mode = arg('--mode', 'preview');
const queueDir = path.resolve(arg('--queue-dir', path.join(ROOT, 'queue')));
const mediaDir = path.resolve(arg('--media-dir', path.join(ROOT, 'media')));
const limit = Number(arg('--limit', '3'));
const gitPush = process.argv.includes('--git-push');
if (!['preview', 'stage'].includes(mode)) throw new Error('Режим: preview или stage');
if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Лимит от 1 до 20 фотографий');

function stateFile(id) { return path.join(STATE_DIR, `${id}.json`); }
function save(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = stateFile(state.post_id);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
}
function read(id) { return fs.existsSync(stateFile(id)) ? JSON.parse(fs.readFileSync(stateFile(id), 'utf8')) : null; }
function diagnostics() {
  if (!fs.existsSync(DIAG_DIR)) return new Set();
  return new Set(fs.readdirSync(DIAG_DIR, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name));
}
function resultAfter(before, hash) {
  const found = [...diagnostics()].filter(x => !before.has(x)).map(x => {
    const filename = path.join(DIAG_DIR, x, 'result.json');
    if (!fs.existsSync(filename)) return null;
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    return data.run_id === x && data.file_sha256 === hash ? data : null;
  }).filter(Boolean);
  if (found.length !== 1) throw new Error(`Не удалось однозначно определить результат загрузки (найдено ${found.length})`);
  return validateUploadResult(found[0], hash);
}
function runUploader(imagePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(SRC, 'upload-vk-photo.mjs'), imagePath], {
      cwd: SRC, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', x => process.stdout.write(x));
    child.stderr.on('data', x => process.stderr.write(x));
    const timer = setTimeout(() => child.kill(), 180_000);
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => { clearTimeout(timer); resolve(code); });
  });
}
function writeQueueFile(filename, post) {
  const temp = `${filename}.${process.pid}.tmp`;
  // publishedAt is a runtime-only Date; never persist it to the queue.
  const { publishedAt, ...raw } = post;
  fs.writeFileSync(temp, JSON.stringify(raw, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, filename);
}
function pushPreparedFile(filename) {
  // Requires a previously authenticated private repository checkout. No
  // access credentials are requested, extracted or embedded by this script.
  let gitRoot;
  try {
    gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: queueDir, encoding: 'utf8' }).trim();
    const relative = path.relative(gitRoot, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('File outside repository');
    execFileSync('git', ['add', '--', relative], { cwd: gitRoot, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', `VK: pre-stage image ${path.basename(filename)}`], { cwd: gitRoot, stdio: 'pipe' });
    execFileSync('git', ['push'], { cwd: gitRoot, stdio: 'pipe' });
  } catch {
    throw new Error('Фото уже загружено в VK, но git push не удался. Изменение осталось локально, повтор загрузки запрещён.');
  }
}

async function main() {
  const config = fs.existsSync(CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    : { group_id: GROUP_ID, staging_enabled: false };
  if (String(config.group_id) !== GROUP_ID) throw new Error('Неверное сообщество в локальном конфиге');
  const now = Date.now();
  const horizon = now + 30 * 24 * 3600 * 1000;
  const queue = fs.readdirSync(queueDir).filter(x => x.endsWith('.json')).sort().map(name => {
    const filename = path.join(queueDir, name);
    return { filename, post: validatePost(JSON.parse(fs.readFileSync(filename, 'utf8')), name) };
  });
  const ready = queue.filter(x => x.post.status === 'approved' && x.post.publishedAt.getTime() <= horizon)
    .sort((a, b) => a.post.publishedAt - b.post.publishedAt);
  console.log('SOLAR HOUSE / VK — ЗАРАНЕЕ ГОТОВИМ ФОТОГРАФИИ');
  console.log(`Режим ${mode}; ближайшие 30 дней: ${ready.length} утверждённых постов`);
  if (mode === 'preview') {
    for (const { post } of ready) console.log(`${post.id}: ${preparedAttachment(post).ready ? 'фото готово' : 'ожидает загрузки'}`);
    console.log('Только просмотр: Chrome и альбом VK не изменяются.');
    return;
  }
  if (config.staging_enabled !== true) throw new Error('Предварительная загрузка выключена (staging_enabled=false).');
  if (process.platform !== 'win32') throw new Error('Загрузка работает только на Windows с профилем Chrome владельца.');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  let lockFd;
  try { lockFd = fs.openSync(LOCK, 'wx'); }
  catch { throw new Error('Другой запуск подготовки активен или оставил защитную блокировку.'); }
  try {
    let finished = 0;
    for (const { filename, post } of ready) {
      if (finished >= limit) break;
      const attachmentState = preparedAttachment(post);
      if (attachmentState.ready) continue;
      if (post.photo_attachment || post.staged_content_sha256) {
        throw new Error(`${post.id}: подготовка устарела, содержимое изменилось; нужна проверка перед повтором.`);
      }
      const imagePath = path.join(mediaDir, post.image);
      if (!fs.existsSync(imagePath)) throw new Error(`${post.id}: нет изображения ${post.image} в media`);
      const imageHash = sha256(fs.readFileSync(imagePath));
      const digest = contentDigest(post);
      let state = read(post.id);
      if (state && (state.content_sha256 !== digest || state.image_sha256 !== imageHash)) {
        throw new Error(`${post.id}: изменилось содержимое после попытки загрузки; повтор запрещён.`);
      }
      let attachment;
      if (state?.status === 'photo-uploaded' && /^photo-211038294_\d{6,}$/.test(state.photo_attachment ?? '')) {
        attachment = state.photo_attachment;
        console.log(`${post.id}: повторно использую ранее подтверждённый ID ${attachment}`);
      } else if (state) {
        throw new Error(`${post.id}: статус ${state.status}, автоматический повтор заблокирован.`);
      } else {
        state = { post_id: post.id, status: 'upload-attempted', image_sha256: imageHash,
          content_sha256: digest, created_at_utc: new Date().toISOString() };
        save(state); // Before opening VK file picker.
        const before = diagnostics();
        console.log(`Загружаю ${post.id}: ${post.image}`);
        const code = await runUploader(imagePath);
        if (code !== 0) throw new Error(`${post.id}: результат загрузки неизвестен. Не повторять автоматически.`);
        attachment = resultAfter(before, imageHash);
        state.status = 'photo-uploaded';
        state.photo_attachment = attachment;
        save(state);
      }
      post.photo_attachment = attachment;
      post.staged_image_sha256 = imageHash;
      post.staged_content_sha256 = digest;
      post.staged_at_utc = new Date().toISOString();
      writeQueueFile(filename, post);
      finished++;
      console.log(`${post.id}: фото готово (${attachment})`);
      if (gitPush) pushPreparedFile(filename);
    }
    console.log(`Подготовлено за запуск: ${finished}. Публикаций на стене не создано.`);
  } finally {
    if (lockFd !== undefined) { fs.closeSync(lockFd); fs.unlinkSync(LOCK); }
  }
}

try { await main(); }
catch (error) { console.error(`ОСТАНОВЛЕНО: ${error.message}`); process.exitCode = 1; }
