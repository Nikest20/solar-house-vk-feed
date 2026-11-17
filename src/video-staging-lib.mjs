// Attachment integrity checks shared by Windows staging and cloud wall publisher.
import { VIDEO_GROUP_ID, videoSha256 } from './video-cloud-lib.mjs';

export function videoStageDigest(item) {
  return videoSha256(Buffer.from(`${item.id}\n${item.text}\n${item.file}\n${item.file_sha256}`, 'utf8'));
}

export function preparedVideoAttachment(item) {
  if (typeof item.video_attachment !== 'string' ||
      !new RegExp(`^video-${VIDEO_GROUP_ID}_\\d{5,}$`).test(item.video_attachment)) {
    return { ready: false, reason: 'Community video ID not yet confirmed' };
  }
  if (item.staged_video_sha256 !== item.file_sha256 ||
      item.staged_content_sha256 !== videoStageDigest(item)) {
    return { ready: false, reason: 'File or caption changed after video staging' };
  }
  return { ready: true, attachment: item.video_attachment };
}

// Only exact COMMUNITY video IDs can be used; private/user videos are rejected.
export function communityVideoIdFromUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/(^|\.)(?:vk\.ru|vk\.com|vkvideo\.ru)$/.test(parsed.hostname)) {
    throw new Error('Video link must be on VK');
  }
  const value = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const result = value.match(new RegExp(`video-${VIDEO_GROUP_ID}_(\\d{5,})`));
  if (!result) throw new Error('Link must point to a video owned by Solar House community');
  return `video-${VIDEO_GROUP_ID}_${result[1]}`;
}
