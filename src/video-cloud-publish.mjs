// Cloud-only publication of videos ALREADY uploaded using the owner's Chrome.
// No user VK token. No VK video.save. The community video ID is approved,
// pinned in the queue and checked before exactly one wall.post.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateVideo, videoSha256, videosToPost, publishVideoWallPost } from './video-cloud-lib.mjs';
import { preparedVideoAttachment } from './video-staging-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const QUEUE = path.join(ROOT, 'videos-queue');
const LEDGER = path.join(ROOT, 'cloud-video-state');
const MODE = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'preview';
if (!['preview', 'live'].includes(MODE)) throw new Error('Allowed modes: preview, live');

function readJson(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
function ledgerPath(id) { return path.join(LEDGER, `${id}.json`); }

function saveAndPush(state, branch, action) {
  fs.mkdirSync(LEDGER, { recursive: true });
  const filename = ledgerPath(state.post_id);
  const temp = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, filename);
  const relative = path.relative(ROOT, filename).replaceAll('\\', '/');
  try {
    execFileSync('git', ['add', '--', relative], { cwd: ROOT, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', `VK: video ${action} ${state.post_id}`], { cwd: ROOT, stdio: 'pipe' });
    execFileSync('git', ['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: ROOT, stdio: 'pipe' });
  } catch {
    throw new Error('Cannot push safety ledger. Do not retry wall.post without manual review.');
  }
}

function loadVideos() {
  if (!fs.existsSync(QUEUE)) return [];
  const names = fs.readdirSync(QUEUE).filter(name => name.endsWith('.json')).sort();
  const videos = names.map(name => validateVideo(JSON.parse(fs.readFileSync(path.join(QUEUE, name), 'utf8'))));
  if (new Set(videos.map(v => v.id)).size !== videos.length) throw new Error('Duplicate queue video IDs');
  return videos;
}

function verifyMedia(item) {
  const filename = path.join(ROOT, item.file);
  if (!fs.existsSync(filename) || videoSha256(fs.readFileSync(filename)) !== item.file_sha256) {
    throw new Error(`${item.id}: approved MP4 has changed or is missing`);
  }
}

async function main() {
  const videos = loadVideos();
  console.log(`SOLAR HOUSE / VK VIDEO WALL: mode=${MODE}; approved=${videos.filter(v=>v.status==='approved').length}`);
  if (MODE === 'preview') {
    for (const video of videos) {
      const prep = preparedVideoAttachment(video);
      console.log(`${video.id}: ${video.status}; staged=${prep.ready}; wall=${readJson(ledgerPath(video.id))?.status ?? 'not-started'}`);
    }
    console.log('Preview does not contact VK, change GitHub or publish.');
    return;
  }
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.VK_VIDEO_ENABLED !== 'true' ||
      process.env.VK_PUBLISH_ENABLED !== 'true') {
    throw new Error('Live requires GitHub Actions, VK_VIDEO_ENABLED=true and VK_PUBLISH_ENABLED=true');
  }
  const ref = process.env.GITHUB_REF ?? '';
  if (!/^refs\/heads\/[a-zA-Z0-9._/-]+$/.test(ref)) throw new Error('Invalid GitHub branch');
  const branch = ref.slice('refs/heads/'.length);
  const groupToken = process.env.VK_GROUP_TOKEN;
  if (!groupToken || groupToken.length < 20) throw new Error('Missing group VK_GROUP_TOKEN secret');

  for (const video of videosToPost(videos)) {
    const state = readJson(ledgerPath(video.id));
    if (state?.status === 'published') continue;
    if (state) {
      console.log(`${video.id}: prior wall outcome=${state.status}; automatic retry BLOCKED`);
      continue;
    }
    const prep = preparedVideoAttachment(video);
    if (!prep.ready) {
      console.log(`${video.id}: needs browser staging first; ${prep.reason}`);
      continue;
    }
    verifyMedia(video);
    const next = {
      post_id: video.id,
      status: 'post-outcome-uncertain',
      video_attachment: prep.attachment,
      file_sha256: video.file_sha256,
      caption_sha256: videoSha256(Buffer.from(video.text)),
      created_at_utc: new Date().toISOString(),
    };
    // Durable GitHub journal BEFORE the first wall.post request.
    saveAndPush(next, branch, 'wall-attempt');
    let posted;
    try { posted = await publishVideoWallPost({
      attachment: prep.attachment, message: video.text, id: video.id, groupToken,
    }); }
    catch { throw new Error(`${video.id}: VK wall outcome uncertain. NEVER automatically resend.`); }
    next.status = 'published';
    next.vk_post_id = String(posted.postId);
    next.post_url = posted.postUrl;
    next.published_at_utc = new Date().toISOString();
    saveAndPush(next, branch, 'published');
    console.log(`VIDEO_POST_PUBLISHED ${posted.postUrl}`);
    return;
  }
  console.log('No newly due AND browser-staged videos.');
}

try { await main(); }
catch (error) { console.error(`STOPPED: ${error.message}`); process.exitCode = 1; }
