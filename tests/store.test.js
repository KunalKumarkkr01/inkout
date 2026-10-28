// Checks the Chrome Web Store images and listing text meet the store's rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decodePng } = require('./browser/harness.js');

const STORE = path.join(__dirname, '..', 'store');
const SCREENSHOT_SIZE = [1280, 800];
const PROMO_SIZE = [440, 280];
const SCREENSHOTS = ['screenshot-1-inbox.png', 'screenshot-2-popup.png', 'screenshot-3-settings.png', 'screenshot-4-welcome.png'];
const SUMMARY_LIMIT = 132;

/**
 * Summary: width and height of a PNG in the store folder.
 * Parameters: name — file name.
 * Returns: [width, height].
 */
function sizeOf(name) {
  const image = decodePng(fs.readFileSync(path.join(STORE, name)));
  return [image.width, image.height];
}

for (const name of SCREENSHOTS) {
  test(`${name} is 1280×800`, () => {
    assert.deepEqual(sizeOf(name), SCREENSHOT_SIZE);
  });
}

test('the small promo tile is 440×280', () => {
  assert.deepEqual(sizeOf('promo-440x280.png'), PROMO_SIZE);
});

test('the listing summary fits the store limit and matches the manifest', () => {
  const listing = fs.readFileSync(path.join(STORE, 'listing.md'), 'utf8');
  const summary = listing.match(/## Summary\s+([^\n]+)/)[1].trim();
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.ok(summary.length <= SUMMARY_LIMIT, `${summary.length} characters`);
  assert.equal(summary, manifest.description);
});

test('the listing gives the privacy policy and support contact', () => {
  const listing = fs.readFileSync(path.join(STORE, 'listing.md'), 'utf8');
  assert.ok(listing.includes('https://kunalkumarkkr01.github.io/inkout/privacy.html'));
  assert.ok(listing.includes('kunaljmit036@gmail.com'));
});
