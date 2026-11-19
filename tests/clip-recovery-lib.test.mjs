import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTerraceRecoveryEvidence } from '../src/clip-recovery-lib.mjs';

const args = {
  expectedSha: 'abc',
  originalJournal: { video_id: 'solar-house-terrace-20261119', file_sha256: 'abc', state: 'upload-outcome-uncertain' },
  originalResult: { video_id: 'solar-house-terrace-20261119', file_sha256: 'abc', selected_file_once: true,
    clicked_publish: false, clicked_save: false, clicked_next: false },
  inspection: { mode: 'READ-ONLY', clip_id: 'clip-211038294_456239559', publication_status: 'not-confirmed',
    views: [
      { name: 'cabinet', clip_id_in_dom: false, matching_clip_links: 0 },
      { name: 'clips', clip_id_in_dom: false, matching_clip_links: 0, content_excerpt: '135 клипов\nПостроить дом за 5 недель\n17 нояб 2026' },
      { name: 'clips-filter', clip_id_in_dom: false, matching_clip_links: 0, content_excerpt: '0 клипов' },
      { name: 'direct-clip-link', clip_id_in_dom: false, matching_clip_links: 0 },
    ] },
};

test('a previously unsubmitted clip with inspected empty schedule is eligible for a one-shot recovery', () => {
  assert.equal(verifyTerraceRecoveryEvidence(args).originalClipId, 'clip-211038294_456239559');
});
test('full November spelling in the published clips list is also accepted', () => {
  const fullMonth = { ...args, inspection: { ...args.inspection, views: args.inspection.views.map(v =>
    v.name === 'clips' ? { ...v, content_excerpt: v.content_excerpt.replace('17 нояб 2026', '17 ноября 2026') } : v) } };
  assert.equal(verifyTerraceRecoveryEvidence(fullMonth).previouslyScheduled, 0);
});
test('recovery refuses a first upload that already submitted', () => {
  assert.throws(() => verifyTerraceRecoveryEvidence({ ...args,
    originalResult: { ...args.originalResult, clicked_publish: true } }), /changed/);
});
test('recovery refuses a discovered original clip', () => {
  assert.throws(() => verifyTerraceRecoveryEvidence({ ...args,
    inspection: { ...args.inspection, views: args.inspection.views.map(v => v.name === 'clips' ? { ...v, matching_clip_links: 1 } : v) } }), /original clip/);
});
test('recovery refuses a nonempty scheduled list', () => {
  assert.throws(() => verifyTerraceRecoveryEvidence({ ...args,
    inspection: { ...args.inspection, views: args.inspection.views.map(v => v.name === 'clips-filter' ? { ...v, content_excerpt: '1 клип' } : v) } }), /empty/);
});
