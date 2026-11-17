import test from 'node:test';
import assert from 'node:assert/strict';
import { videoStageDigest, preparedVideoAttachment, communityVideoIdFromUrl } from '../src/video-staging-lib.mjs';
import { validateVideo } from '../src/video-cloud-lib.mjs';

const prepared = {
  id: 'solar-house-terrace-20261119', status: 'approved',
  upload_not_before: '2026-11-18T08:00:00+03:00',
  publish_at: '2026-11-19T10:00:00+03:00',
  title: 'Solar House terrace', text: 'Our terrace is a place for friends.',
  file: 'media/solar-house-terrace-2026-11-19.mp4',
  file_sha256: 'f'.repeat(64),
  video_attachment: 'video-211038294_457240999',
};

test('staged group video can be published only when caption and video match', () => {
  const video = validateVideo({ ...prepared, staged_video_sha256: prepared.file_sha256,
    staged_content_sha256: videoStageDigest(prepared) });
  assert.equal(preparedVideoAttachment(video).ready, true);
  assert.equal(preparedVideoAttachment({ ...video, text: 'Altered caption' }).ready, false);
  assert.equal(preparedVideoAttachment({ ...video, file_sha256: 'c'.repeat(64) }).ready, false);
  assert.equal(preparedVideoAttachment({ ...video, video_attachment: 'video-555_457240999' }).ready, false);
});

test('a saved MP4 without community video ID cannot be posted', () => {
  assert.equal(preparedVideoAttachment(prepared).ready, false);
  assert.equal(preparedVideoAttachment({ ...prepared, video_attachment: 'video-211038294_457240999',
    staged_video_sha256: prepared.file_sha256 }).ready, false);
});

test('only direct links to Solar House community video are accepted', () => {
  assert.equal(communityVideoIdFromUrl('https://vk.ru/video-211038294_457240999'), 'video-211038294_457240999');
  assert.equal(communityVideoIdFromUrl('https://vk.com/video?z=video-211038294_457240999%2Fvideo'), 'video-211038294_457240999');
  assert.throws(() => communityVideoIdFromUrl('https://not-vk.example/video-211038294_457240999'));
  assert.throws(() => communityVideoIdFromUrl('https://vk.ru/video-666_457240999'));
});
