// Solar House: two-phase scheduled VK community VIDEO publisher.
// First stage video without a wall post. Later post once it's encoded and due.
// Never retry an uncertain upload/wall.post. GitHub journal is durable before API effects.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  validateVideo, videoSha256, videosToUpload, videosToPost,
  uploadCommunityVideo, isCommunityVideoReady, publishVideoWallPost,
} from './video-cloud-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const QUEUE = path.join(ROOT, 'videos-queue');
const LEDGER = path.join(ROOT, 'cloud-video-state');
const MODE = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'preview';
if (!['preview', 'live'].includes(MODE)) throw new Error('Allowed modes: preview, live');

function readJson(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
function ledgerPath(id) { return path.join(LEDGER, `${id}.json`); }

function git(args) {
  try { execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('GitHub journal push failed. Never retry without manual ledger review.'); }
}

function saveAndPush(state, branch, action) {
  fs.mkdirSync(LEDGER, { recursive: true });
  const file = ledgerPath(state.post_id);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
  git(['add', '--', path.relative(ROOT, file).replaceAll('\\', '/')]);
  git(['commit', '-m', `VK: video ${action} ${state.post_id}`]);
  git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
}

function loadVideos() {
  if (!fs.existsSync(QUEUE)) return [];
  const names = fs.readdirSync(QUEUE).filter(name => name.endsWith('.json')).sort();
  const videos = names.map(file => validateVideo(JSON.parse(fs.readFileSync(path.join(QUEUE, file), 'utf8'))));
  if (new Set(videos.map(item => item.id)).size !== videos.length) throw new Error('Duplicate video queue IDs');
  return videos;
}

function bytesAndDigest(item) {
  const filePath = path.join(ROOT, item.file);
  if (!fs.existsSync(filePath)) throw new Error(`${item.id}: MP4 file absent`);
  const bytes = fs.readFileSync(filePath);
  const hash = videoSha256(bytes);
  if (hash !== item.file_sha256) throw new Error(`${item.id}: approved MP4 hash has changed`);
  return { bytes, hash };
}

function verifyImmutableState(item, state) {
  if (state.file_sha256 !== item.file_sha256 || state.text_sha256 !== videoSha256(Buffer.from(item.text))) {
    throw new Error(`${item.id}: video or caption changed after staging. Manual review required.`);
  }
}

async function main() {
  const videos = loadVideos();
  console.log(`SOLAR HOUSE / VK VIDEO: mode=${MODE}; queue=${videos.length}; due=${videosToPost(videos).length}`);
  if (MODE === 'preview') {
    for (const item of videos) {
      const state = readJson(ledgerPath(item.id));
      console.log(`${item.id}: ${item.status}; upload=${item.upload_not_before}; wall=${item.publish_at}; state=${state?.status ?? 'none'}`);
    }
    console.log('Preview: no network calls, commits or VK publication.');
    return;
  }

  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.VK_VIDEO_ENABLED !== 'true' ||
      process.env.VK_PUBLISH_ENABLED !== 'true') {
    throw new Error('Video live requires GitHub Actions AND VK_VIDEO_ENABLED=true AND VK_PUBLISH_ENABLED=true');
  }
  const ref = process.env.GITHUB_REF ?? '';
  if (!/^refs\/heads\/[a-zA-Z0-9._/-]+$/.test(ref)) throw new Error('Invalid GitHub branch');
  const branch = ref.replace(/^refs\/heads\//, '');
  const userToken = process.env.VK_VIDEO_USER_TOKEN;
  const groupToken = process.env.VK_GROUP_TOKEN;
  if (!userToken || userToken.length < 20) throw new Error('Missing VK_VIDEO_USER_TOKEN user secret (VK_GROUP_TOKEN is insufficient for video.save)');
  if (!groupToken || groupToken.length < 20) throw new Error('Missing VK_GROUP_TOKEN group secret');

  // A scheduled run does at most one externally significant operation.
  for (const item of videosToUpload(videos)) {
    let state = readJson(ledgerPath(item.id));
    if (state) verifyImmutableState(item, state);

    if (!state) {
      const { bytes, hash } = bytesAndDigest(item);
      state = {
        post_id: item.id,
        status: 'upload-outcome-uncertain',
        file_sha256: hash,
        text_sha256: videoSha256(Buffer.from(item.text)),
        created_at_utc: new Date().toISOString(),
      };
      saveAndPush(state, branch, 'upload-attempt');
      let prepared;
      try { prepared = await uploadCommunityVideo({ videoBytes: bytes, title: item.title,
        description: item.text, userToken }); }
      catch { throw new Error(`${item.id}: video.upload outcome uncertain. Do NOT retry automatically.`); }
      state.status = 'uploaded-processing';
      state.video_attachment = prepared.attachment;
      state.vk_video_id = String(prepared.videoId);
      state.uploaded_at_utc = new Date().toISOString();
      saveAndPush(state, branch, 'uploaded');
      console.log(`VIDEO_UPLOADED community_video_id=${state.vk_video_id}; waiting for processing`);
      return;
    }

    if (state.status === 'uploaded-processing') {
      // Keep waiting while VK transcodes; don't post an unplayable file.
      let ready;
      try { ready = await isCommunityVideoReady({ attachment: state.video_attachment, userToken }); }
      catch { console.log(`${item.id}: video processing check failed; wait until next run`); continue; }
      if (!ready) { console.log(`${item.id}: video still processing`); continue; }
      state.status = 'ready';
      state.ready_at_utc = new Date().toISOString();
      saveAndPush(state, branch, 'ready');
      console.log(`${item.id}: video encoded; wall post will wait until ${item.publish_at}`);
      return;
    }
  }

  for (const item of videosToPost(videos)) {
    const state = readJson(ledgerPath(item.id));
    if (!state || state.status === 'uploaded-processing') continue;
    verifyImmutableState(item, state);
    if (state.status === 'published') continue;
    if (state.status !== 'ready') {
      console.log(`${item.id}: stage=${state.status}; automatic retry BLOCKED`);
      continue;
    }
    // Ensure wall publisher never uses bytes or an attachment different from approved file.
    bytesAndDigest(item);
    const next = { ...state, status: 'post-outcome-uncertain', post_attempt_at_utc: new Date().toISOString() };
    saveAndPush(next, branch, 'wall-attempt');
    let published;
    try { published = await publishVideoWallPost({ attachment: next.video_attachment,
      message: item.text, id: item.id, groupToken }); }
    catch { throw new Error(`${item.id}: wall.post outcome uncertain. Do NOT retry automatically.`); }
    next.status = 'published';
    next.vk_post_id = String(published.postId);
    next.post_url = published.postUrl;
    next.published_at_utc = new Date().toISOString();
    saveAndPush(next, branch, 'published');
    console.log(`VIDEO_POST_PUBLISHED ${next.post_url}`);
    return;
  }
  console.log('No new video action eligible.');
}

try { await main(); }
catch (error) { console.error(`STOPPED: ${error.message}`); process.exitCode = 1; }
