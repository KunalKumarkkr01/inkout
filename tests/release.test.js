// The Release workflow can publish an extension that runs on every website, so these checks guard
// how it gets there: pinned actions, tests before packaging, and Google access only behind approval.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOWS = path.join(__dirname, '..', '.github', 'workflows');
const release = fs.readFileSync(path.join(WORKFLOWS, 'release.yml'), 'utf8');
const [buildJob, publishJob] = release.split(/^  publish:$/m);

test('every workflow pins its actions to a full commit SHA', () => {
  for (const file of fs.readdirSync(WORKFLOWS)) {
    const text = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
    for (const [, action] of text.matchAll(/uses:\s*(\S+)/g)) {
      assert.match(action, /@[0-9a-f]{40}$/, `${file}: ${action}`);
    }
  }
});

test('a release runs only for version tags', () => {
  assert.match(release, /on:\s+push:\s+tags: \['v\*'\]/);
  assert.doesNotMatch(release, /branches:|pull_request|workflow_dispatch/);
});

test('the build checks the tag, then runs the tests, then packages', () => {
  const order = ['scripts/publish.js check-tag', 'npm test', 'npm run package', 'gh release create'];
  const positions = order.map((step) => buildJob.indexOf(step));
  positions.forEach((position, index) => assert.ok(position > 0, `missing: ${order[index]}`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('only the publish job can sign in to Google, and only after approval', () => {
  assert.ok(publishJob, 'missing publish job');
  assert.match(publishJob, /needs: build/);
  assert.match(publishJob, /environment: chrome-web-store/);
  assert.match(publishJob, /id-token: write/);
  assert.doesNotMatch(buildJob, /id-token|google-github-actions/);
  assert.match(publishJob, /access_token_scopes: https:\/\/www\.googleapis\.com\/auth\/chromewebstore$/m);
  assert.match(publishJob, /scripts\/publish\.js submit/);
});

test('nothing in the workflow is a stored secret', () => {
  assert.doesNotMatch(release, /secrets\./);
});
