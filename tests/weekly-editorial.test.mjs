import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const w = JSON.parse(fs.readFileSync(path.join(root, 'drafts/2026-11-20_26-weekly.json'), 'utf8'));

test('original mixed-media package is archived and cannot auto-publish', () => {
  assert.equal(w.review_status, 'archived');
  assert.equal(w.publication_enabled, false);
  assert.equal(w.superseded_by, 'drafts/2026-11-20_26-articles-only.json');
  assert.ok(w.items.every(item => item.status === 'needs_approval'));
});

test('exactly seven unique dates and identifiers with 4 image posts + 3 clips', () => {
  assert.equal(w.items.length, 7);
  assert.equal(new Set(w.items.map(x => x.id)).size, 7);
  assert.equal(w.items.filter(x => x.format === 'image_post').length, 4);
  assert.equal(w.items.filter(x => x.format === 'clip').length, 3);
  const dates = w.items.map(x => x.date);
  assert.deepEqual(dates, Array.from({ length: 7 }, (_, idx) =>
    `2026-11-${String(20 + idx).padStart(2, '0')}`));
});

test('all schedules match Moscow 10:00 for post and 10:15 for story', () => {
  for (const item of w.items) {
    assert.equal(item.publish_at, `${item.date}T10:00:00+03:00`);
    assert.equal(item.story_at, `${item.date}T10:15:00+03:00`);
    assert.ok(item.text.length > 80);
    assert.ok(item.story_text.length > 10);
    assert.ok(item.disclosure.length > 10);
  }
});

test('clip storyboards have safe approved durations and three scenes', () => {
  for (const item of w.items.filter(x => x.format === 'clip')) {
    assert.ok([9, 12].includes(item.duration_seconds));
    assert.equal(item.scenes.length, 3);
    assert.equal(item.scenes.reduce((sum, scene) => sum + scene.seconds, 0), item.duration_seconds);
    assert.ok(item.scenes.every(scene => scene.overlay && scene.visual));
  }
});

test('complex claims include primary-source technical checks', () => {
  for (const date of ['2026-11-22', '2026-11-24']) {
    const item = w.items.find(x => x.date === date);
    assert.ok(item.source_urls.some(url => url.startsWith('https://')));
  }
});
