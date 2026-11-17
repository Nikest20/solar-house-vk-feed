import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateVideo, videosToUpload, videosToPost, validateVideoUploadUrl,
  uploadCommunityVideo, isCommunityVideoReady, publishVideoWallPost,
  videoLooksProcessed,
} from '../src/video-cloud-lib.mjs';

const video = {
  id: 'solar-house-terrace-20261119', status: 'approved',
  upload_not_before: '2026-11-18T08:00:00+03:00',
  publish_at: '2026-11-19T10:00:00+03:00',
  title: 'Терраса? Да зачем она нам!',
  text: 'Терраса объединяет семью и друзей.',
  file: 'media/terrace.mp4', file_sha256: 'c'.repeat(64),
};

test('video upload and wall are independently scheduled in Moscow time', () => {
  const item = validateVideo(video);
  assert.equal(videosToUpload([item], new Date('2026-11-18T04:59:00Z')).length, 0);
  assert.equal(videosToUpload([item], new Date('2026-11-18T05:00:00Z')).length, 1);
  assert.equal(videosToPost([item], new Date('2026-11-19T06:59:59Z')).length, 0);
  assert.equal(videosToPost([item], new Date('2026-11-19T07:00:00Z')).length, 1);
  assert.equal(videosToPost([validateVideo({ ...video, status: 'draft' })], new Date('2027-01-01')).length, 0);
});

test('queue rejects path traversal, mismatched time, missing hash and invalid status', () => {
  assert.throws(() => validateVideo({ ...video, file: '../secret.mp4' }), /video file/);
  assert.throws(() => validateVideo({ ...video, file: 'media/nested/secret.mp4' }), /video file/);
  assert.throws(() => validateVideo({ ...video, upload_not_before: '2026-11-20T00:00:00+03:00' }), /before/);
  assert.throws(() => validateVideo({ ...video, file_sha256: 'not-hash' }), /hash/);
  assert.throws(() => validateVideo({ ...video, status: 'posted' }), /status/);
});

test('upload server is HTTPS VK domain only', () => {
  assert.equal(validateVideoUploadUrl('https://pu.vk.com/upload?x=1'), 'https://pu.vk.com/upload?x=1');
  assert.throws(() => validateVideoUploadUrl('https://vk.com.attacker.example/upload'), /untrusted/);
  assert.throws(() => validateVideoUploadUrl('http://pu.vk.com/upload'), /untrusted/);
});

test('video.save allocates group video with wallpost=0 and uploads exactly one multipart file', async () => {
  const calls = [];
  const result = await uploadCommunityVideo({
    videoBytes: Buffer.alloc(2500, 0x30), title: video.title,
    description: video.text, userToken: 'u'.repeat(40),
    fetcher: async (url, init) => {
      calls.push(url);
      if (url.endsWith('/video.save')) {
        assert.equal(init.body.get('group_id'), '211038294');
        assert.equal(init.body.get('wallpost'), '0');
        return { ok: true, json: async () => ({ response: {
          owner_id: -211038294, video_id: 77, upload_url: 'https://pu.vk.com/upload/77',
        } }) };
      }
      assert.equal(url, 'https://pu.vk.com/upload/77');
      assert.ok(init.body instanceof FormData);
      assert.ok(init.body.get('video_file') instanceof Blob);
      return { ok: true, text: async () => JSON.stringify({ video_id: 77, size: 2500 }) };
    },
  });
  assert.deepEqual(result, { videoId: 77, ownerId: -211038294, attachment: 'video-211038294_77' });
  assert.equal(calls.length, 2);
});

test('video.save for personal user instead of group is rejected before upload', async () => {
  let calls = 0;
  await assert.rejects(uploadCommunityVideo({
    videoBytes: Buffer.alloc(2500), title: video.title, description: video.text,
    userToken: 'u'.repeat(40), fetcher: async () => {
      calls++;
      return { ok: true, json: async () => ({ response: {
        owner_id: 123, video_id: 77, upload_url: 'https://pu.vk.com/upload/77',
      } }) };
    },
  }), /expected community/);
  assert.equal(calls, 1);
});

test('file upload failure cannot retry and never calls wall.post', async () => {
  let calls = 0;
  await assert.rejects(uploadCommunityVideo({
    videoBytes: Buffer.alloc(2500), title: video.title, description: video.text,
    userToken: 'u'.repeat(40), fetcher: async () => {
      calls++;
      if (calls === 1) return { ok: true, json: async () => ({ response: {
        owner_id: -211038294, video_id: 77, upload_url: 'https://pu.vk.com/upload/77',
      } }) };
      throw new Error('timeout');
    },
  }));
  assert.equal(calls, 2);
});

test('video.get waits for actual playable video', async () => {
  assert.equal(videoLooksProcessed({ id: 77, duration: 9 }), false);
  assert.equal(videoLooksProcessed({ id: 77, duration: 9, player: 'https://vkvideo.ru/77', processing: 1 }), false);
  assert.equal(videoLooksProcessed({ id: 77, duration: 9, player: 'https://vkvideo.ru/77' }), true);
  const ready = await isCommunityVideoReady({
    attachment: 'video-211038294_77', userToken: 'u'.repeat(40),
    fetcher: async (_url, init) => {
      assert.equal(init.body.get('videos'), '-211038294_77');
      return { ok: true, json: async () => ({ response: {
        count: 1, items: [{ owner_id: -211038294, id: 77, duration: 9, player: 'https://vkvideo.ru/77' }],
      } }) };
    },
  });
  assert.equal(ready, true);
});

test('wall.post sends existing approved group attachment only once', async () => {
  let requests = 0;
  const result = await publishVideoWallPost({
    attachment: 'video-211038294_77', message: video.text,
    id: video.id, groupToken: 'g'.repeat(40),
    fetcher: async (url, init) => {
      requests++;
      assert.equal(url, 'https://api.vk.ru/method/wall.post');
      assert.equal(init.body.get('attachments'), 'video-211038294_77');
      assert.equal(init.body.get('owner_id'), '-211038294');
      return { ok: true, json: async () => ({ response: { post_id: 88 } }) };
    },
  });
  assert.deepEqual(result, { postId: 88, postUrl: 'https://vk.ru/wall-211038294_88' });
  assert.equal(requests, 1);
  await assert.rejects(publishVideoWallPost({
    attachment: 'video123_77', message: video.text, id: video.id, groupToken: 'g'.repeat(40),
  }), /Invalid community/);
});
