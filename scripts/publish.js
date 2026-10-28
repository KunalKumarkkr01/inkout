// Release helpers for the Release workflow (.github/workflows/release.yml), using the Chrome Web
// Store API v2 with Node's own fetch, so no library is needed.
//   node scripts/publish.js check-tag v1.0.1      fails unless the tag is "v" + manifest.json's version
//   node scripts/publish.js submit dist/x.zip     uploads the zip and submits it for review
// "submit" reads CWS_ACCESS_TOKEN, CWS_PUBLISHER_ID and CWS_EXTENSION_ID from the environment.
const fs = require('node:fs');
const path = require('node:path');

const API = 'https://chromewebstore.googleapis.com';
const ROOT = path.resolve(__dirname, '..');
// The store processes some uploads after answering; check every 10 s, for up to 5 minutes.
const STATUS_CHECK_INTERVAL_MS = 10_000;
const MAX_STATUS_CHECKS = 30;
const UPLOAD_DONE = 'SUCCEEDED';
const UPLOAD_FAILED = 'FAILED';
const SUBMISSION_FAILED = ['REJECTED', 'CANCELLED'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const itemPath = (publisherId, extensionId) => `publishers/${publisherId}/items/${extensionId}`;

/**
 * Summary: makes sure a release tag matches the version in manifest.json.
 * Parameters: tag — the pushed git tag, such as "v1.0.1"; version — manifest.json's version.
 * Throws: when the tag isn't exactly "v" followed by the version.
 * Usage: checkTag('v1.0.1', '1.0.1') passes; checkTag('v1.0.2', '1.0.1') throws.
 */
function checkTag(tag, version) {
  const expected = `v${version}`;
  if (tag !== expected) {
    throw new Error(`Tag ${tag} doesn't match manifest.json version ${version} (expected ${expected})`);
  }
}

/**
 * Summary: sends one request to the store and reads its JSON answer.
 * Parameters: fetch; url; token — OAuth access token; options — extra fetch options.
 * Returns: the parsed response body.
 * Throws: on any HTTP error, with the status and the store's message.
 */
async function callStore(fetch, url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      message = JSON.parse(text).error?.message ?? text;
    } catch {}
    throw new Error(`Chrome Web Store answered ${response.status}: ${message}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Summary: uploads a new package for an existing store item and waits until the store has processed it.
 * Parameters: { token, publisherId, extensionId, zip (Buffer), fetch, wait } — fetch and wait default
 *   to the real ones; tests pass stand-ins.
 * Throws: when the upload fails or is still being processed after 5 minutes.
 * Usage: await uploadPackage({ token, publisherId, extensionId, zip: fs.readFileSync(file) }).
 */
async function uploadPackage({ token, publisherId, extensionId, zip, fetch = globalThis.fetch, wait = sleep }) {
  const item = itemPath(publisherId, extensionId);
  const uploaded = await callStore(fetch, `${API}/upload/v2/${item}:upload`, token, { method: 'POST', body: zip });
  let state = uploaded.uploadState;
  for (let check = 0; check < MAX_STATUS_CHECKS && state !== UPLOAD_DONE && state !== UPLOAD_FAILED; check++) {
    await wait(STATUS_CHECK_INTERVAL_MS);
    state = (await callStore(fetch, `${API}/v2/${item}:fetchStatus`, token)).lastAsyncUploadState;
  }
  if (state === UPLOAD_FAILED) throw new Error('Chrome Web Store upload FAILED');
  if (state !== UPLOAD_DONE) throw new Error(`Chrome Web Store upload is still ${state} after 5 minutes`);
}

/**
 * Summary: submits the uploaded package for review; it goes live once Google approves it.
 * Parameters: { token, publisherId, extensionId, fetch }.
 * Returns: the submission's state, normally "PENDING_REVIEW".
 * Throws: when the store reports the submission as rejected or cancelled.
 */
async function submitForReview({ token, publisherId, extensionId, fetch = globalThis.fetch }) {
  const url = `${API}/v2/${itemPath(publisherId, extensionId)}:publish`;
  const { state } = await callStore(fetch, url, token, { method: 'POST' });
  if (SUBMISSION_FAILED.includes(state)) throw new Error(`Chrome Web Store submission ${state}`);
  return state;
}

/**
 * Summary: reads a required environment variable.
 * Parameters: name.
 * Returns: its value. Throws when it's missing or empty.
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Summary: runs a command from the command line ("check-tag <tag>" or "submit <zip>").
 * Parameters: command; argument.
 */
async function main(command, argument) {
  if (command === 'check-tag') {
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    checkTag(argument, version);
    console.log(`Tag ${argument} matches manifest.json`);
    return;
  }
  if (command === 'submit') {
    const item = {
      token: requireEnv('CWS_ACCESS_TOKEN'),
      publisherId: requireEnv('CWS_PUBLISHER_ID'),
      extensionId: requireEnv('CWS_EXTENSION_ID'),
    };
    await uploadPackage({ ...item, zip: fs.readFileSync(argument) });
    console.log(`Uploaded ${argument}`);
    console.log(`Submitted for review: ${await submitForReview(item)}`);
    return;
  }
  throw new Error('Usage: node scripts/publish.js check-tag <tag> | submit <zip>');
}

if (require.main === module) {
  main(process.argv[2], process.argv[3]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { checkTag, uploadPackage, submitForReview };
