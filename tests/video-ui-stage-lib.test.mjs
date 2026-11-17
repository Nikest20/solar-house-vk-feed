import test from 'node:test';
import assert from 'node:assert/strict';
import { videoEligibleForBrowserStage } from '../src/video-ui-stage-lib.mjs';
import { videoSha256 } from '../src/video-cloud-lib.mjs';

const bytes = Buffer.from('approved video bytes');
const approved = {
  id: 'solar-house-terrace-20261119', status: 'approved',
  publish_at: '2026-11-19T10:00:00+03:00',
  title: 'Solar House terrace', text: 'Approved terrace clip and caption',
  file: 'media/solar-house-terrace-2026-11-19.mp4', file_sha256: videoSha256(bytes),
};
test('staging is available immediately after approval, before publication', () => {
  assert.equal(videoEligibleForBrowserStage(approved, bytes, new Date('2026-11-17T20:00:00+03:00')).id, approved.id);
});
test('one approved unchanged video may be selected inside the staging window', () => {
  assert.equal(videoEligibleForBrowserStage(approved, bytes, new Date('2026-11-18T09:00:00+03:00')).id, approved.id);
});
test('staging refuses duplicate attempt and changed video', () => {
  const now = new Date('2026-11-18T09:00:00+03:00');
  assert.throws(() => videoEligibleForBrowserStage(approved, bytes, now, true), /earlier upload attempt/);
  assert.throws(() => videoEligibleForBrowserStage(approved, Buffer.from('different'), now), /hash mismatch/);
});
test('staging refuses unapproved, already attached, or late video', () => {
  const now = new Date('2026-11-18T09:00:00+03:00');
  assert.throws(() => videoEligibleForBrowserStage({ ...approved, status: 'draft' }, bytes, now), /not approved/);
  assert.throws(() => videoEligibleForBrowserStage({ ...approved, video_attachment: 'video-211038294_123456' }, bytes, now), /already has/);
  assert.throws(() => videoEligibleForBrowserStage(approved, bytes, new Date('2026-11-19T11:00:00+03:00')), /publication time has passed/);
});
