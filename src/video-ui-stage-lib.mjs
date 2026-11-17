// Fail-closed checks before the first browser-side VK Video file selection.
import { validateVideo, videoSha256 } from './video-cloud-lib.mjs';

export function videoEligibleForBrowserStage(raw, bytes, now = new Date(), existingAttempt = false) {
  const item = validateVideo(raw);
  if (item.status !== 'approved') throw new Error(`${item.id}: not approved`);
  if (item.due <= now) throw new Error(`${item.id}: publication time has passed; manual review required`);
  if (existingAttempt) throw new Error(`${item.id}: earlier upload attempt exists; do not automatically repeat`);
  if (videoSha256(bytes) !== item.file_sha256) throw new Error(`${item.id}: approved MP4 hash mismatch`);
  if (item.video_attachment) throw new Error(`${item.id}: already has a VK video attachment`);
  return item;
}
