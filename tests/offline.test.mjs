import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePost } from '../src/lib.mjs';
import { contentDigest, preparedAttachment, cloudDuePosts } from '../src/offline-lib.mjs';

const post = validatePost({
  id: 'offline-test-01', status: 'approved', publish_at: '2026-11-20T10:00:00+03:00',
  text: 'Готовим фото дома заранее, публикуем после согласования.', image: 'house.jpg',
});
const staged = {
  ...post, photo_attachment: 'photo-211038294_457240967',
  staged_image_sha256: 'a'.repeat(64), staged_content_sha256: contentDigest(post),
};

test('staged group photo accepted only with unchanged content', () => {
  assert.equal(preparedAttachment(staged).ready, true);
  assert.equal(preparedAttachment({ ...staged, text: 'Текст изменили после подтверждения' }).ready, false);
  assert.equal(preparedAttachment({ ...staged, photo_attachment: 'photo-123_457240967' }).ready, false);
  assert.equal(preparedAttachment({ ...staged, staged_image_sha256: null }).ready, false);
});

test('the cloud queue uses actual UTC instant, not the machine timezone', () => {
  const future = { ...post, publish_at: '2026-11-20T10:15:00+03:00', publishedAt: new Date('2026-11-20T07:15:00Z') };
  assert.deepEqual(cloudDuePosts([future, post], new Date('2026-11-20T07:10:00Z')).map(x => x.id), [post.id]);
});
