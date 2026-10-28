const test = require('node:test');
const assert = require('node:assert/strict');
const { checkTag, uploadPackage, submitForReview } = require('../scripts/publish.js');

const TOKEN = 'test-access-token';
const PUBLISHER = 'pub-123';
const EXTENSION = 'abcdefghijklmnopabcdefghijklmnop';
const ITEM_URL = `https://chromewebstore.googleapis.com/v2/publishers/${PUBLISHER}/items/${EXTENSION}`;
const UPLOAD_URL = `https://chromewebstore.googleapis.com/upload/v2/publishers/${PUBLISHER}/items/${EXTENSION}:upload`;
const ZIP = Buffer.from('PK fake zip');

/**
 * Summary: a stand-in for the Chrome Web Store that answers requests in order and records them.
 * Parameters: replies — array of { status, body } returned one per request.
 * Returns: { fetch, calls } where calls lists { url, method, headers, body } for each request.
 * Usage: const store = fakeStore([{ status: 200, body: { uploadState: 'SUCCEEDED' } }]).
 */
function fakeStore(replies) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', headers: options.headers ?? {}, body: options.body });
    const reply = replies[calls.length - 1];
    assert.ok(reply, `unexpected request ${calls.length}: ${url}`);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  return { fetch, calls };
}

const noWait = async () => {};
const item = (fetch) => ({ token: TOKEN, publisherId: PUBLISHER, extensionId: EXTENSION, fetch, wait: noWait });

test('checkTag accepts a tag that is v plus the manifest version', () => {
  assert.doesNotThrow(() => checkTag('v1.0.1', '1.0.1'));
});

test('checkTag rejects a tag that differs from the manifest version', () => {
  assert.throws(() => checkTag('v1.0.2', '1.0.1'), /v1\.0\.2.*1\.0\.1/);
});

test('checkTag rejects a tag without the leading v', () => {
  assert.throws(() => checkTag('1.0.1', '1.0.1'), /expected v1\.0\.1/);
});

test('uploadPackage posts the zip to the upload URL with the access token', async () => {
  const store = fakeStore([{ body: { uploadState: 'SUCCEEDED', crxVersion: '1.0.1' } }]);
  await uploadPackage({ ...item(store.fetch), zip: ZIP });
  assert.equal(store.calls.length, 1);
  const [call] = store.calls;
  assert.equal(call.url, UPLOAD_URL);
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(call.body, ZIP);
});

test('uploadPackage waits for an upload still being processed', async () => {
  const store = fakeStore([
    { body: { uploadState: 'IN_PROGRESS' } },
    { body: { lastAsyncUploadState: 'IN_PROGRESS' } },
    { body: { lastAsyncUploadState: 'SUCCEEDED' } },
  ]);
  await uploadPackage({ ...item(store.fetch), zip: ZIP });
  assert.deepEqual(store.calls.map((call) => call.url), [UPLOAD_URL, `${ITEM_URL}:fetchStatus`, `${ITEM_URL}:fetchStatus`]);
});

test('uploadPackage fails when the store rejects the package', async () => {
  const store = fakeStore([{ body: { uploadState: 'FAILED' } }]);
  await assert.rejects(uploadPackage({ ...item(store.fetch), zip: ZIP }), /upload FAILED/i);
});

test('uploadPackage gives up when processing never finishes', async () => {
  const replies = [{ body: { uploadState: 'IN_PROGRESS' } }];
  for (let index = 0; index < 100; index++) replies.push({ body: { lastAsyncUploadState: 'IN_PROGRESS' } });
  const store = fakeStore(replies);
  await assert.rejects(uploadPackage({ ...item(store.fetch), zip: ZIP }), /still IN_PROGRESS/);
});

test('an HTTP error names the status and the store message', async () => {
  const store = fakeStore([{ status: 401, body: { error: { message: 'Request had invalid authentication credentials.' } } }]);
  await assert.rejects(uploadPackage({ ...item(store.fetch), zip: ZIP }), /401.*invalid authentication credentials/);
});

test('submitForReview posts to the publish URL and returns the new state', async () => {
  const store = fakeStore([{ body: { state: 'PENDING_REVIEW' } }]);
  const state = await submitForReview(item(store.fetch));
  assert.equal(state, 'PENDING_REVIEW');
  const [call] = store.calls;
  assert.equal(call.url, `${ITEM_URL}:publish`);
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
});

test('submitForReview fails when the submission is rejected or cancelled', async () => {
  for (const state of ['REJECTED', 'CANCELLED']) {
    const store = fakeStore([{ body: { state } }]);
    await assert.rejects(submitForReview(item(store.fetch)), new RegExp(state));
  }
});
