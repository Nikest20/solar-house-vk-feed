// Browser-staged VK community videos: cloud only sends approved wall.post.
import crypto from 'node:crypto';

export const VIDEO_GROUP_ID = '211038294';
export const videoSha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function strictDate(value, field) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${field}: timezone is required`);
  }
  const date = new Date(value);
  if (!Number.isFinite(+date)) throw new Error(`${field}: invalid date`);
  return date;
}

export function validateVideo(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected video object');
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(raw.id ?? '')) throw new Error('Invalid video id');
  if (!['draft', 'approved'].includes(raw.status)) throw new Error(`${raw.id}: invalid status`);
  const due = strictDate(raw.publish_at, 'publish_at');
  if (typeof raw.title !== 'string' || raw.title.trim().length < 4 || raw.title.length > 100) {
    throw new Error(`${raw.id}: invalid video title`);
  }
  if (typeof raw.text !== 'string' || raw.text.trim().length < 8 || raw.text.length > 16000) {
    throw new Error(`${raw.id}: invalid video caption`);
  }
  if (typeof raw.file !== 'string' || !/^media\/[a-z0-9][a-z0-9_.-]*\.mp4$/.test(raw.file)) {
    throw new Error(`${raw.id}: MP4 must be a flat file under media/`);
  }
  if (!/^[a-f0-9]{64}$/.test(raw.file_sha256 ?? '')) throw new Error(`${raw.id}: missing file hash`);
  return { ...raw, due };
}

export function videosToPost(items, now = new Date()) {
  return items.filter(item => item.status === 'approved' && item.due <= now)
    .sort((a, b) => +a.due - +b.due || a.id.localeCompare(b.id));
}

// Caller must have pushed an immutable attempt journal BEFORE calling this.
export async function publishVideoWallPost({ attachment, message, id, groupToken, fetcher = fetch }) {
  if (!new RegExp(`^video-${VIDEO_GROUP_ID}_\\d{5,}$`).test(attachment)) throw new Error('Invalid community video ID');
  if (!groupToken || groupToken.length < 20) throw new Error('VK_GROUP_TOKEN missing');
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(id)) throw new Error('Invalid post ID');
  const response = await fetcher('https://api.vk.ru/method/wall.post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ owner_id: `-${VIDEO_GROUP_ID}`, from_group: '1',
      attachments: attachment, message, guid: `shvk-${id}`,
      access_token: groupToken, v: '5.199' }),
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new Error('VK wall.post HTTP outcome uncertain; do not retry');
  const data = await response.json();
  if (data?.error) throw new Error(`VK wall.post rejected the video (code ${Number(data.error.error_code) || -1})`);
  const postId = Number(data?.response?.post_id);
  if (!Number.isSafeInteger(postId) || postId < 1) throw new Error('VK wall.post returned no post ID; do not retry');
  return { postId, postUrl: `https://vk.ru/wall-${VIDEO_GROUP_ID}_${postId}` };
}
