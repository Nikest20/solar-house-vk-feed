// VK Video upload needs a USER token; wall.post uses the existing GROUP token.
// See VKCOM/vk-api-schema: video.save is restricted to access_token_type=user.
import crypto from 'node:crypto';

export const VIDEO_GROUP_ID = '211038294';
const ALLOWED_UPLOAD_HOST = /(^|\.)(?:vk\.com|vk\.ru|vkvideo\.ru)$/i;

export const videoSha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function isoDate(value, name) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${name}: timestamp must specify a timezone`);
  }
  const date = new Date(value);
  if (!Number.isFinite(+date)) throw new Error(`${name}: invalid timestamp`);
  return date;
}

export function validateVideo(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Video queue: expected object');
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(item.id ?? '')) throw new Error('Video queue: invalid id');
  if (!['draft', 'approved'].includes(item.status)) throw new Error(`${item.id}: invalid status`);
  const due = isoDate(item.publish_at, 'publish_at');
  const upload = isoDate(item.upload_not_before, 'upload_not_before');
  if (+upload > +due) throw new Error(`${item.id}: upload_not_before must be before publish_at`);
  if (typeof item.title !== 'string' || item.title.trim().length < 4 || item.title.length > 100) {
    throw new Error(`${item.id}: invalid video title`);
  }
  if (typeof item.text !== 'string' || item.text.trim().length < 8 || item.text.length > 16000) {
    throw new Error(`${item.id}: invalid caption`);
  }
  if (typeof item.file !== 'string' || !/^media\/[a-z0-9][a-z0-9_.-]*\.mp4$/.test(item.file)) {
    throw new Error(`${item.id}: video file must be a flat MP4 under media/`);
  }
  if (!/^[a-f0-9]{64}$/.test(item.file_sha256 ?? '')) throw new Error(`${item.id}: invalid file hash`);
  return { ...item, due, upload };
}

export function videosToUpload(items, now = new Date()) {
  return items.filter(item => item.status === 'approved' && item.upload <= now)
    .sort((a, b) => +a.upload - +b.upload || a.id.localeCompare(b.id));
}

export function videosToPost(items, now = new Date()) {
  return items.filter(item => item.status === 'approved' && item.due <= now)
    .sort((a, b) => +a.due - +b.due || a.id.localeCompare(b.id));
}

export function validateVideoUploadUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_UPLOAD_HOST.test(url.hostname) || url.username || url.password) {
    throw new Error('VK returned an untrusted video upload URL');
  }
  return url.toString();
}

async function vkMethod(method, token, args, fetcher, timeoutMs = 35_000) {
  const response = await fetcher(`https://api.vk.ru/method/${method}`, {
    method: 'POST',
    body: new URLSearchParams({ ...args, access_token: token, v: '5.199' }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`VK ${method}: HTTP failure; outcome unknown`);
  const data = await response.json();
  if (data?.error) {
    const error = new Error(`VK ${method}: API error ${Number(data.error.error_code) || -1}`);
    error.vkErrorCode = Number(data.error.error_code) || -1;
    throw error;
  }
  if (!data || typeof data !== 'object' || !('response' in data)) {
    throw new Error(`VK ${method}: unexpected response`);
  }
  return data.response;
}

export async function uploadCommunityVideo({ videoBytes, title, description, userToken, fetcher = fetch }) {
  if (!Buffer.isBuffer(videoBytes) || videoBytes.byteLength < 1000) throw new Error('Video file empty');
  if (!userToken || userToken.length < 20) throw new Error('VK_VIDEO_USER_TOKEN is missing');

  // wallpost=0 is essential: upload must not create an uncontrolled wall post.
  const prepare = await vkMethod('video.save', userToken, {
    group_id: VIDEO_GROUP_ID, name: title, description, wallpost: '0',
  }, fetcher);
  const ownerId = Number(prepare?.owner_id);
  const videoId = Number(prepare?.video_id);
  if (ownerId !== -Number(VIDEO_GROUP_ID) || !Number.isSafeInteger(videoId) || videoId <= 0) {
    throw new Error('VK video.save: video was not allocated under the expected community');
  }
  const uploadUrl = validateVideoUploadUrl(prepare.upload_url);
  const form = new FormData();
  form.set('video_file', new Blob([videoBytes], { type: 'video/mp4' }), 'solar-house.mp4');
  const result = await fetcher(uploadUrl, {
    method: 'POST', body: form, signal: AbortSignal.timeout(180_000),
  });
  if (!result.ok) throw new Error('VK video upload HTTP failure; do not retry automatically');
  const resultText = await result.text();
  let uploadResult;
  try { uploadResult = JSON.parse(resultText); }
  catch { throw new Error('VK video upload sent an unexpected response; do not retry'); }
  if (!uploadResult || typeof uploadResult !== 'object' || uploadResult.error || uploadResult.error_code) {
    throw new Error('VK video upload rejected the file; do not retry automatically');
  }
  return { videoId, ownerId, attachment: `video${ownerId}_${videoId}` };
}

export function videoLooksProcessed(item) {
  if (!item || typeof item !== 'object' || item.processing || item.is_processing || item.live_status === 'waiting') return false;
  // An uploaded-but-not-yet-encoded object may already have an id but no player.
  return Number(item.duration) > 0 &&
    (typeof item.player === 'string' && item.player.startsWith('https://') ||
     !!(item.files && Object.values(item.files).some(value => typeof value === 'string' && value.startsWith('https://'))));
}

export async function isCommunityVideoReady({ attachment, userToken, fetcher = fetch }) {
  const response = await vkMethod('video.get', userToken, { videos: attachment.replace(/^video/, '') }, fetcher);
  const item = response?.items?.[0];
  return !!item && Number(item.owner_id) === -Number(VIDEO_GROUP_ID) && videoLooksProcessed(item);
}

export async function publishVideoWallPost({ attachment, message, id, groupToken, fetcher = fetch }) {
  if (!new RegExp(`^video-${VIDEO_GROUP_ID}_\\d+$`).test(attachment)) throw new Error('Invalid community video attachment');
  if (!groupToken || groupToken.length < 20) throw new Error('VK_GROUP_TOKEN missing');
  const response = await vkMethod('wall.post', groupToken, {
    owner_id: `-${VIDEO_GROUP_ID}`, from_group: '1', attachments: attachment,
    message, guid: `shvk-${id}`,
  }, fetcher);
  const postId = Number(response?.post_id);
  if (!Number.isSafeInteger(postId) || postId < 1) throw new Error('VK wall.post: missing post id; do not retry');
  return { postId, postUrl: `https://vk.ru/wall-${VIDEO_GROUP_ID}_${postId}` };
}
