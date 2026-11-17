import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStory, storiesDue, extractUploadResult, publishStoryOnce, storyImageSha } from '../src/story-cloud-lib.mjs';

const approved = {
  id: 'solar-house-million-story-20261118',
  status: 'approved',
  publish_at: '2026-11-18T10:15:00+03:00',
  linked_wall_post_id: 'solar-house-million-20261118-v2',
  image: 'drafts/solar-house-story-2026-11-18.jpg',
  image_sha256: 'a'.repeat(64),
};

test('approved story is not due before its Moscow publish time', () => {
  const story = validateStory(approved);
  assert.equal(storiesDue([story], new Date('2026-11-18T07:14:59Z')).length, 0);
  assert.equal(storiesDue([story], new Date('2026-11-18T07:15:00Z')).length, 1);
});

test('draft is never due and unsafe story paths are rejected', () => {
  assert.equal(storiesDue([validateStory({ ...approved, status: 'draft' })], new Date('2027-01-01')).length, 0);
  assert.equal(validateStory({ ...approved, image: 'media/story-terrace.jpg' }).image, 'media/story-terrace.jpg');
  assert.throws(() => validateStory({ ...approved, image: '../private.jpg' }), /Invalid image path/);
  assert.throws(() => validateStory({ ...approved, image_sha256: 'wrong' }), /Missing image digest/);
});

test('photo hash is deterministic and bytes-specific', () => {
  assert.equal(storyImageSha(Buffer.from('hi')), '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4');
});

test('accepts only unambiguous upload_result', () => {
  assert.equal(extractUploadResult({ response: { upload_result: 'sample-upload-token' } }), 'sample-upload-token');
  assert.throws(() => extractUploadResult({ response: {} }), /upload_result/);
});

test('one authorized story invokes get upload URL, upload file, save exactly once', async () => {
  const called = [];
  const r = await publishStoryOnce({
    imageBytes: Buffer.alloc(2000, 0xff), token: 'f'.repeat(40),
    fetchImpl: async (url, init) => {
      called.push(url);
      if (url.endsWith('stories.getPhotoUploadServer')) {
        assert.equal(init.body.get('group_id'), '211038294');
        assert.equal(init.body.get('add_to_news'), '1');
        return { ok: true, json: async () => ({ response: { upload_url: 'https://upload.example/story' } }) };
      }
      if (url === 'https://upload.example/story') {
        assert.equal(init.method, 'POST');
        assert.ok(init.body instanceof FormData);
        assert.ok(init.body.get('file') instanceof Blob);
        return { ok: true, json: async () => ({ response: { upload_result: 'encoded-upload-result' } }) };
      }
      if (url.endsWith('stories.save')) {
        assert.deepEqual(JSON.parse(init.body.get('upload_results_json')), [{ upload_result: 'encoded-upload-result' }]);
        return { ok: true, json: async () => ({ response: { count: 1, items: [{ id: 42, owner_id: -211038294 }] } }) };
      }
      throw new Error('Unexpected call');
    },
  });
  assert.deepEqual(r, { storyId: 42, ownerId: -211038294 });
  assert.equal(called.length, 3);
});

test('upload failure never calls stories.save or retries upload', async () => {
  const called = [];
  await assert.rejects(publishStoryOnce({
    imageBytes: Buffer.alloc(2000, 0xff), token: 'f'.repeat(40),
    fetchImpl: async (url) => {
      called.push(url);
      if (url.endsWith('stories.getPhotoUploadServer')) {
        return { ok: true, json: async () => ({ response: { upload_url: 'https://upload.example/story' } }) };
      }
      throw new Error('upload timed out');
    },
  }));
  assert.equal(called.length, 2);
});

test('unexpected owner on stories.save fails closed', async () => {
  await assert.rejects(publishStoryOnce({
    imageBytes: Buffer.alloc(2000, 0xff), token: 'f'.repeat(40),
    fetchImpl: async (url) => {
      if (url.endsWith('stories.getPhotoUploadServer')) {
        return { ok: true, json: async () => ({ response: { upload_url: 'https://upload.example/story' } }) };
      }
      if (url === 'https://upload.example/story') {
        return { ok: true, json: async () => ({ response: { upload_result: 'encoded-upload-result' } }) };
      }
      return { ok: true, json: async () => ({ response: { count: 1, items: [{ id: 42, owner_id: -999 }] } }) };
    },
  }), /unexpected community owner/);
});
