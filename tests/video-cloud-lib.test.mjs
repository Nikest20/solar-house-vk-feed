import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVideo, videosToPost, publishVideoWallPost, videoSha256 } from '../src/video-cloud-lib.mjs';

const video = {
  id: 'solar-house-terrace-20261119', status: 'approved',
  publish_at: '2026-11-19T10:00:00+03:00',
  title: 'Терраса? Да зачем она нам!',
  text: 'Терраса объединяет семью и друзей.',
  file: 'media/terrace.mp4', file_sha256: 'c'.repeat(64),
};

test('approved video is not due before Moscow publish time', () => {
  const post = validateVideo(video);
  assert.equal(videosToPost([post], new Date('2026-11-19T06:59:59Z')).length, 0);
  assert.equal(videosToPost([post], new Date('2026-11-19T07:00:00Z')).length, 1);
  assert.equal(videosToPost([validateVideo({ ...video, status: 'draft' })], new Date('2027-01-01')).length, 0);
});

test('video queue validates paths and immutable file hash', () => {
  assert.throws(() => validateVideo({ ...video, file: '../secret.mp4' }), /MP4/);
  assert.throws(() => validateVideo({ ...video, file: 'media/nested/secret.mp4' }), /MP4/);
  assert.throws(() => validateVideo({ ...video, file_sha256: 'broken' }), /hash/);
  assert.throws(() => validateVideo({ ...video, status: 'published' }), /status/);
  assert.throws(() => validateVideo({ ...video, publish_at: '2026-11-19T10:00:00' }), /timezone/);
  assert.equal(videoSha256(Buffer.from('test')).length, 64);
});

test('wall.post gets exactly one prepared community attachment with group token', async () => {
  let count = 0;
  const result = await publishVideoWallPost({
    attachment: 'video-211038294_457240999', message: video.text,
    id: video.id, groupToken: 'g'.repeat(40),
    fetcher: async (url, init) => {
      count++;
      assert.equal(url, 'https://api.vk.ru/method/wall.post');
      assert.equal(init.body.get('attachments'), 'video-211038294_457240999');
      assert.equal(init.body.get('owner_id'), '-211038294');
      return { ok: true, json: async () => ({ response: { post_id: 81 } }) };
    },
  });
  assert.equal(count, 1);
  assert.deepEqual(result, { postId: 81, postUrl: 'https://vk.ru/wall-211038294_81' });
  await assert.rejects(publishVideoWallPost({
    attachment: 'video-9999_457240999', message: video.text, id: video.id,
    groupToken: 'g'.repeat(40),
  }), /Invalid community/);
});

test('wall.post VK error remains a blocked uncertain outcome for the caller', async () => {
  await assert.rejects(publishVideoWallPost({
    attachment: 'video-211038294_457240999', message: video.text,
    id: video.id, groupToken: 'g'.repeat(40),
    fetcher: async () => ({ ok: true, json: async () => ({ error: { error_code: 15 } }) }),
  }), /code 15/);
});
