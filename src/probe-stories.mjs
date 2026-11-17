// Read-only capability probe for VK community stories.
// It requests an upload URL, but never uploads bytes or calls stories.save.
const DEFAULT_GROUP_ID = '211038294';

export async function probeStories({ token, groupId = DEFAULT_GROUP_ID, fetchImpl = fetch }) {
  if (!token || typeof token !== 'string') return { available: false, reason: 'missing_token' };
  if (!/^\d+$/.test(String(groupId))) return { available: false, reason: 'invalid_group_id' };

  const body = new URLSearchParams({
    group_id: String(groupId),
    access_token: token,
    v: '5.199',
  });
  let response;
  try {
    response = await fetchImpl('https://api.vk.ru/method/stories.getPhotoUploadServer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return { available: false, reason: 'network_or_timeout' };
  }
  if (!response.ok) return { available: false, reason: 'http_error', httpStatus: response.status };

  let data;
  try { data = await response.json(); }
  catch { return { available: false, reason: 'invalid_response' }; }
  if (data?.error) {
    return { available: false, reason: 'vk_api_error', errorCode: Number(data.error.error_code) || -1 };
  }
  if (typeof data?.response?.upload_url === 'string' && data.response.upload_url.startsWith('https://')) {
    return { available: true, reason: 'upload_server_accessible' };
  }
  return { available: false, reason: 'unexpected_response' };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href) {
  const result = await probeStories({ token: process.env.VK_GROUP_TOKEN });
  // Do not print the token, signed upload URL, or full VK error payload.
  console.log(`VK_STORIES_CAPABILITY=${result.available ? 'AVAILABLE' : 'UNAVAILABLE'}`);
  console.log(`VK_STORIES_REASON=${result.reason}`);
  if (result.errorCode) console.log(`VK_STORIES_ERROR_CODE=${result.errorCode}`);
  if (result.httpStatus) console.log(`VK_STORIES_HTTP_STATUS=${result.httpStatus}`);
  console.log('No photo uploaded; no story saved; no wall post created.');
  if (!result.available) process.exitCode = 2;
}
