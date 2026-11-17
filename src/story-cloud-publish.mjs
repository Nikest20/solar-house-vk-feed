// Cloud-only exactly-once community story publisher. Independent of wall posts.
// No upload or save until approved story is due, linked wall post is published,
// and VK_STORIES_ENABLED=true is explicitly configured in GitHub Variables.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STORY_GROUP_ID, storyImageSha, validateStory, storiesDue, publishStoryOnce } from './story-cloud-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STORY_QUEUE = path.join(ROOT, 'stories-queue');
const STORY_LEDGER = path.join(ROOT, 'cloud-story-state');
const WALL_LEDGER = path.join(ROOT, 'cloud-publisher-state');
const VIDEO_WALL_LEDGER = path.join(ROOT, 'cloud-video-state');
const MODE = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'preview';
if (!['preview', 'live'].includes(MODE)) throw new Error('Allowed modes: preview and live');

function readJson(filename) { return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : null; }
function storyStatePath(id) { return path.join(STORY_LEDGER, `${id}.json`); }
function wallState(id) {
  return readJson(path.join(WALL_LEDGER, `${id}.json`)) ??
    readJson(path.join(VIDEO_WALL_LEDGER, `${id}.json`));
}
function git(args) {
  try { execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('GitHub journal push failed; do not retry without manual review'); }
}

function saveState(state, branch, phase) {
  fs.mkdirSync(STORY_LEDGER, { recursive: true });
  const file = storyStatePath(state.post_id);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  git(['add', '--', path.relative(ROOT, file).replaceAll('\\', '/')]);
  git(['commit', '-m', `VK: story ${phase} ${state.post_id}`]);
  git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
}

function loadStories() {
  if (!fs.existsSync(STORY_QUEUE)) return [];
  const names = fs.readdirSync(STORY_QUEUE).filter(f => f.endsWith('.json')).sort();
  const stories = names.map(f => validateStory(JSON.parse(fs.readFileSync(path.join(STORY_QUEUE, f), 'utf8'))));
  const ids = new Set();
  for (const story of stories) {
    if (ids.has(story.id)) throw new Error(`Duplicate story id ${story.id}`);
    ids.add(story.id);
  }
  return stories;
}

async function main() {
  const stories = loadStories();
  console.log('SOLAR HOUSE / VK: STORY PUBLISHER');
  console.log(`Mode=${MODE}; queue=${stories.length}; due=${storiesDue(stories).length}`);
  if (MODE === 'preview') {
    for (const item of stories) {
      const wall = wallState(item.linked_wall_post_id);
      const state = readJson(storyStatePath(item.id));
      console.log(`${item.id}: ${item.status}; wall=${wall?.status ?? 'pending'}; story=${state?.status ?? 'not-started'}`);
    }
    console.log('Preview does not contact VK, upload media, or change GitHub.');
    return;
  }

  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.VK_STORIES_ENABLED !== 'true') {
    throw new Error('Live stories require GitHub Actions and VK_STORIES_ENABLED=true');
  }
  const ref = process.env.GITHUB_REF ?? '';
  if (!/^refs\/heads\/[a-zA-Z0-9._/-]+$/.test(ref)) throw new Error('Invalid GitHub branch');
  const branch = ref.slice('refs/heads/'.length);
  const token = process.env.VK_GROUP_TOKEN;
  if (!token || token.length < 20) throw new Error('Missing VK_GROUP_TOKEN secret');

  for (const item of storiesDue(stories)) {
    const state = readJson(storyStatePath(item.id));
    if (state?.status === 'published') continue;
    if (state) {
      console.error(`${item.id}: previous outcome ${state.status} requires manual review; no repeat`);
      continue;
    }
    const wall = wallState(item.linked_wall_post_id);
    if (wall?.status !== 'published') {
      console.log(`${item.id}: wall post not confirmed published; story deferred`);
      continue;
    }

    const imagePath = path.join(ROOT, item.image);
    if (!fs.existsSync(imagePath)) throw new Error(`${item.id}: missing story file`);
    const imageBytes = fs.readFileSync(imagePath);
    const hash = storyImageSha(imageBytes);
    if (hash !== item.image_sha256) throw new Error(`${item.id}: image changed after approval`);

    const next = {
      post_id: item.id,
      status: 'story-outcome-uncertain',
      linked_wall_post_id: item.linked_wall_post_id,
      image_sha256: hash,
      created_at_utc: new Date().toISOString(),
    };
    // Durable write before getPhotoUploadServer, upload, or stories.save.
    saveState(next, branch, 'attempt');
    let published;
    try { published = await publishStoryOnce({ imageBytes, token, groupId: STORY_GROUP_ID }); }
    catch {
      throw new Error(`${item.id}: VK story outcome uncertain; do NOT retry automatically`);
    }
    next.status = 'published';
    next.vk_story_id = String(published.storyId);
    next.vk_owner_id = published.ownerId;
    next.published_at_utc = new Date().toISOString();
    saveState(next, branch, 'published');
    console.log(`STORY_PUBLISHED id=${published.ownerId}_${published.storyId}`);
    return; // Exactly one story per job.
  }
  console.log('No new eligible stories.');
}

try { await main(); }
catch (error) { console.error(`STOPPED: ${error.message}`); process.exitCode = 1; }
