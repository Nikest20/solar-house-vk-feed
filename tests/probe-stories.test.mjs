import test from 'node:test';
import assert from 'node:assert/strict';
import { probeStories } from '../src/probe-stories.mjs';

test('missing token prevents any VK request', async () => {
  let called = false;
  const result = await probeStories({ token: '', fetchImpl: async () => { called = true; } });
  assert.equal(result.reason, 'missing_token');
  assert.equal(called, false);
});

test('authorized upload server is detected without upload or save', async () => {
  let calls = 0;
  const result = await probeStories({
    token: 'test-token',
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.vk.ru/method/stories.getPhotoUploadServer');
      assert.equal(init.method, 'POST');
      assert.equal(init.body.get('group_id'), '211038294');
      assert.equal(init.body.get('access_token'), 'test-token');
      return { ok: true, json: async () => ({ response: { upload_url: 'https://upload.vk.example/signed' } }) };
    },
  });
  assert.deepEqual(result, { available: true, reason: 'upload_server_accessible' });
  assert.equal(calls, 1);
});

test('VK API access errors are handled without displaying secrets', async () => {
  const result = await probeStories({ token: 'test-token', fetchImpl: async () => ({
    ok: true,
    json: async () => ({ error: { error_code: 15, error_msg: 'Access denied' } }),
  }) });
  assert.deepEqual(result, { available: false, reason: 'vk_api_error', errorCode: 15 });
});

test('unknown timeout or HTTP error does not cause an automatic retry', async () => {
  let calls = 0;
  const result = await probeStories({ token: 'test-token', fetchImpl: async () => {
    calls++;
    throw new Error('timeout');
  } });
  assert.deepEqual(result, { available: false, reason: 'network_or_timeout' });
  assert.equal(calls, 1);
});
