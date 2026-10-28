// Privacy claims on screen must match the privacy policy. Settings (custom words and site lists
// included) are saved with Chrome sync storage, so Chrome may copy them to the user's other
// browsers: nothing may say that *everything* stays on the device.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const USER_FACING = [
  'src/popup.html',
  'src/options.html',
  'src/welcome.html',
  'site/index.html',
  'site/privacy.html',
  'store/listing.md',
  'scripts/render.js',
];
// "Nothing you see leaves your device" is about page content, which is true, so it is allowed.
const OVERCLAIMS = [/stays on your device/i, /(?<!you see )leaves your device/i, /nothing leaves the browser/i];

for (const file of USER_FACING) {
  test(`${file} doesn't claim settings never leave the device`, () => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const claim of OVERCLAIMS) assert.doesNotMatch(text, claim);
  });
}

test('the settings page and the store listing say Chrome sync may copy settings', () => {
  for (const file of ['src/options.html', 'store/listing.md']) {
    assert.match(fs.readFileSync(path.join(ROOT, file), 'utf8'), /Chrome sync/i, file);
  }
});
