// content.js carries a copy of content.css for shadow roots (page styles can't reach inside
// them). These checks fail if the two drift apart.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../src/content.css'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');

test('the blur used in shadow roots matches content.css', () => {
  const blur = script.match(/const BLUR = '([^']+)'/)[1];
  const cssShadows = [...css.matchAll(/text-shadow: ([^;!]+?)\s*(!important)?;/g)].map((match) => match[1]);
  assert.ok(cssShadows.length > 0);
  for (const shadow of cssShadows) assert.equal(shadow, blur);
});

test('the other hiding declarations appear in both', () => {
  for (const declaration of [
    'color: transparent',
    '-webkit-text-fill-color: transparent',
    'background-color: Highlight !important',
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
