import { createHash } from 'node:crypto';

export const STORY_GROUP_ID = '211038294';
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{6,79}$/;

export function storyImageSha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateStory(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid story object');
  if (!ID_PATTERN.test(raw.id ?? '')) throw new Error('Invalid story id');
  if (!['draft', 'approved'].includes(raw.status)) throw new Error(`Invalid story status ${raw.id}`);
  if (typeof raw.publish_at !== 'string' || !/T\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(raw.publish_at)) {
    throw new Error(`Invalid date ${raw.id}`);
  }
  const publishedAt = new Date(raw.publish_at);
  if (!Number.isFinite(publishedAt.getTime())) throw new Error(`Invalid date ${raw.id}`);
  if (!ID_PATTERN.test(raw.linked_wall_post_id ?? '')) throw new Error(`Invalid wall reference ${raw.id}`);
  if (typeof raw.image !== 'string' ||
      !/^drafts\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|jpeg|png)$/.test(raw.image)) {
    throw new Error(`Invalid image path ${raw.id}`);
  }
  if (typeof raw.image_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.image_sha256)) {
    throw new Error(`Missing image digest ${raw.id}`);
  }
  return { ...raw, publishedAt };
}

export function storiesDue(stories, now = new Date()) {
  return stories.filter(story => story.status === 'approved' && story.publishedAt <= now)
    .sort((a, b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id));
}

export function extractUploadResult(data) {
  const candidate = data?.response ?? data;
  const encoded = typeof candidate === 'string' ? candidate : candidate?.upload_result;
  if (typeof encoded !== 'string' || encoded.length < 8) throw new Error('VK returned no story upload_result');
  return encoded;
}

async function vkMethod(method, fields, token, fetchImpl) {
  const body = new URLSearchParams({ ...fields, access_token: token, v: '5.199' });
  const response = await fetchImpl(`https://api.vk.ru/method/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body, signal: AbortSignal.timeout(35000),
  });
  if (!response.ok) throw new Error(`VK ${method} HTTP status unknown`);
  const json = await response.json();
  if (json?.error) throw new Error(`VK ${method} rejected request (code ${Number(json.error.error_code) || -1})`);
  return json?.response;
}

// Must be invoked ONLY after a one-shot ledger has been durably pushed.
// Never retry when any of the three remote calls has an unknown result.
export async function publishStoryOnce({ imageBytes, token, groupId = STORY_GROUP_ID, fetchImpl = fetch }) {
  if (!token || token.length < 20) throw new Error('Missing VK group token');
  if (!Buffer.isBuffer(imageBytes) || imageBytes.length < 1000) throw new Error('Missing image bytes');
  const server = await vkMethod('stories.getPhotoUploadServer', {
    group_id: String(groupId), add_to_news: '1',
  }, token, fetchImpl);
  if (typeof server?.upload_url !== 'string' || !server.upload_url.startsWith('https://')) {
    throw new Error('VK did not return HTTPS story upload URL');
  }

  const form = new FormData();
  form.append('file', new Blob([imageBytes], { type: 'image/jpeg' }), 'solar-house-story.jpg');
  const uploadResponse = await fetchImpl(server.upload_url, {
    method: 'POST', body: form, signal: AbortSignal.timeout(45000),
  });
  if (!uploadResponse.ok) throw new Error('VK story upload HTTP result unknown');
  const uploadResult = extractUploadResult(await uploadResponse.json());

  const saved = await vkMethod('stories.save', {
    upload_results_json: JSON.stringify([{ upload_result: uploadResult }]),
  }, token, fetchImpl);
  const item = saved?.items?.[0];
  if (!saved || Number(saved.count) < 1 || !Number.isInteger(item?.id) || item.id <= 0) {
    throw new Error('VK story.save returned no unambiguous story id');
  }
  const owner = Number(item.owner_id);
  if (!Number.isInteger(owner) || owner !== -Number(groupId)) {
    throw new Error('VK story.save returned unexpected community owner');
  }
  return { storyId: item.id, ownerId: owner };
}
