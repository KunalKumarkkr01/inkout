// Checks the parts of the manifest the Chrome Web Store and the toolbar depend on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decodePng } = require('./browser/harness.js');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const STORE_DESCRIPTION_LIMIT = 132;
const ICON_SIZES = ['16', '32', '48', '128'];
const SITE_URL = 'https://kunalkumarkkr01.github.io/inkout/';

test('the extension is called Inkout', () => {
  assert.equal(manifest.name, 'Inkout');
  assert.equal(manifest.action.default_title, 'Inkout');
});

test('the description fits the Chrome Web Store limit', () => {
  assert.ok(manifest.description.length <= STORE_DESCRIPTION_LIMIT, `${manifest.description.length} characters`);
});

test('the homepage is the project website', () => {
  assert.equal(manifest.homepage_url, SITE_URL);
});

test('only the storage permission is asked for', () => {
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.host_permissions, undefined);
});

for (const [where, icons] of [
  ['extension', manifest.icons],
  ['toolbar', manifest.action.default_icon],
]) {
  test(`${where} icons exist at 16, 32, 48 and 128 pixels`, () => {
    assert.deepEqual(Object.keys(icons).sort(), [...ICON_SIZES].sort());
    for (const size of ICON_SIZES) {
      const image = decodePng(fs.readFileSync(path.join(ROOT, icons[size])));
      assert.deepEqual([image.width, image.height], [Number(size), Number(size)], icons[size]);
    }
  });
}

test('icons have see-through corners', () => {
  const image = decodePng(fs.readFileSync(path.join(ROOT, manifest.icons['128'])));
  const cornerAlpha = image.pixels[3];
  assert.equal(cornerAlpha, 0);
});
