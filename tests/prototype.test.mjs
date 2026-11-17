import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePost, selectDuePost, checkResume, validateUploadResult } from '../src/lib.mjs';

const base = {
  id: 'sample-test-post', status: 'approved',
  publish_at: '2026-11-20T10:00:00+03:00',
  text: 'Проверка системы Solar House', image: 'test-photo.jpg',
};

test('approved due post selected; draft and future posts ignored', () => {
  const now = new Date('2026-11-20T07:10:00Z');
  const posts = [
    validatePost({ ...base, id: 'draft-demo-01', status: 'draft' }),
    validatePost({ ...base, id: 'future-demo-01', publish_at: '2026-11-21T10:00:00+03:00' }),
    validatePost(base),
  ];
  assert.equal(selectDuePost(posts, now).id, base.id);
  assert.equal(selectDuePost(posts, new Date('2026-11-20T06:59:00Z')), null);
});

test('dangerous image paths and dates without timezone rejected', () => {
  assert.throws(() => validatePost({ ...base, image: '../secret.jpg' }), /image/);
  assert.throws(() => validatePost({ ...base, image: 'C:\\secret.jpg' }), /image/);
  assert.throws(() => validatePost({ ...base, publish_at: '2026-11-20T10:00:00' }), /publish_at/);
});

test('only verified photo-uploaded-no-post state can resume', () => {
  const s = { post_id: base.id, image_sha256: 'aaa', message_sha256: 'bbb', status: 'photo-uploaded-no-post', photo_attachment: 'photo-211038294_457240967' };
  assert.deepEqual(checkResume(s, base.id, 'aaa', 'bbb'), { action: 'resume', attachment: 'photo-211038294_457240967' });
  assert.equal(checkResume({ ...s, status: 'post-outcome-uncertain' }, base.id, 'aaa', 'bbb').action, 'block');
  assert.equal(checkResume(s, base.id, 'changed', 'bbb').action, 'block');
  assert.equal(checkResume({ ...s, photo_attachment: 'photo-123_457240967' }, base.id, 'aaa', 'bbb').action, 'block');
});

test('upload report must match file and one new group photo', () => {
  const report = { status: 'candidate-photo-id-found-needs-visual-check', file_sha256: 'xyz', new_photo_ids: ['457240968'], photo_url: 'https://vk.ru/photo-211038294_457240968' };
  assert.equal(validateUploadResult(report, 'xyz'), 'photo-211038294_457240968');
  assert.throws(() => validateUploadResult({ ...report, new_photo_ids: ['457240968', '457240969'] }, 'xyz'), /не один ID/);
  assert.throws(() => validateUploadResult(report, 'different'), /исходному файлу/);
});
