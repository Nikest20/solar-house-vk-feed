import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectArticleOnlyDrafts } from '../src/article-only-plan-lib.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = JSON.parse(fs.readFileSync(path.join(root, 'drafts/2026-11-20_26-weekly.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(root, 'drafts/2026-11-20_26-articles-only.json'), 'utf8'));

test('four articles and zero clips are selected across editorial approval states', () => {
  for (const review_status of ['needs_approval', 'partially_approved', 'approved']) {
    const items = selectArticleOnlyDrafts(source, { ...plan, review_status });
    assert.deepEqual(items.map(x => x.date), ['2026-11-20', '2026-11-22', '2026-11-24', '2026-11-26']);
    assert.ok(items.every(x => x.format === 'image_post'));
  }
});
test('editorial approval never enables publishing, clips, or stories', () => {
  assert.throws(() => selectArticleOnlyDrafts(source, { ...plan, review_status: 'unknown' }), /editorial review status/);
  assert.throws(() => selectArticleOnlyDrafts(source, { ...plan, publication_enabled: true }), /non-publishing/);
  assert.throws(() => selectArticleOnlyDrafts(source, { ...plan, video_automation_enabled: true }), /without video/);
  assert.throws(() => selectArticleOnlyDrafts(source, { ...plan, stories_enabled: true }), /without video/);
});
test('all four pre-existing review images are available', () => {
  const names = ['2026-11-20-family-home.jpg', '2026-11-22-vapor-barrier.jpg',
    '2026-11-24-wood-fibreboard.jpg', '2026-11-26-base-options.jpg'];
  for (const filename of names) assert.ok(fs.statSync(path.join(root, 'review/week-2026-11-20_26', filename)).size > 10000);
});
test('clips cannot be added back without review', () => {
  assert.throws(() => selectArticleOnlyDrafts(source, { ...plan,
    post_ids: [plan.post_ids[0], 'solar-house-project-savings-20261121', ...plan.post_ids.slice(1)] }), /four unique/);
  assert.throws(() => selectArticleOnlyDrafts(source, { ...plan, video_automation_enabled: true }), /without video/);
});
test('old missed terrace video and its story are both removed from active queues', () => {
  const video = JSON.parse(fs.readFileSync(path.join(root, 'videos-queue/2026-11-19-terrace.json'), 'utf8'));
  const story = JSON.parse(fs.readFileSync(path.join(root, 'stories-queue/2026-11-19-terrace.json'), 'utf8'));
  assert.equal(video.status, 'draft');
  assert.equal(story.status, 'draft');
  const videoWorkflow = fs.readFileSync(path.join(root, '.github/workflows/vk-videos-cloud.yml'), 'utf8');
  const storyWorkflow = fs.readFileSync(path.join(root, '.github/workflows/vk-stories-cloud.yml'), 'utf8');
  assert.doesNotMatch(videoWorkflow, /^\s{2}schedule:/m);
  assert.doesNotMatch(storyWorkflow, /^\s{2}schedule:/m);
});
