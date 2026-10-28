// content.js carries a copy of content.css for shadow roots (page styles can't reach inside
// them). These checks fail if the two drift apart.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TYPES } = require('../src/detectors.js');

const css = fs.readFileSync(path.join(__dirname, '../src/content.css'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');

test('every text-shadow in content.css is also used in shadow roots', () => {
  const cssShadows = new Set([...css.matchAll(/text-shadow: ([^;!]+?)\s*(!important)?;/g)].map((match) => match[1]));
  assert.ok(cssShadows.size >= 4, 'expected medium, light, strong and none');
  for (const shadow of cssShadows) {
    assert.ok(script.includes(`'${shadow}'`), `content.js shadow styles are missing text-shadow "${shadow}"`);
  }
});

test('content.css styles every type', () => {
  for (const type of TYPES) {
    assert.ok(css.includes(`::highlight(privacy-guard-${type})`), `no highlight rule for ${type}`);
    assert.ok(css.includes(`[data-privacy-guard-selection~='${type}']::selection`), `no selection rule for ${type}`);
    assert.ok(css.includes(`svg text:is([data-privacy-guard-selection~='${type}']`), `no SVG rule for ${type}`);
  }
});

test('the other hiding declarations appear in both', () => {
  for (const declaration of [
    'color: transparent',
    '-webkit-text-fill-color: transparent',
    'background-color: Highlight !important',
    'background-color: #0F1B2D',
    'caret-color: #5f6368 !important',
    'fill: #3c4043 !important',
    'stroke: #3c4043 !important',
    'stroke-width: 0.12em !important',
    'filter: blur(0.35em)',
  ]) {
    assert.ok(css.includes(declaration), `content.css is missing "${declaration}"`);
    assert.ok(script.includes(declaration), `content.js shadow styles are missing "${declaration}"`);
  }
});
