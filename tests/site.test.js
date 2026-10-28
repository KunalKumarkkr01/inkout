// Checks the GitHub Pages site loads nothing from third parties and has no broken links.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.join(__dirname, '..', 'site');
const ALLOWED_ABSOLUTE = [
  'https://github.com/KunalKumarkkr01/inkout',
  'https://chromewebstore.google.com/',
  'mailto:kunaljmit036@gmail.com',
];
const PAGES = ['index.html', 'privacy.html'];

/**
 * Summary: every URL a page or its stylesheet refers to (href, src and CSS url()).
 * Parameters: text — HTML or CSS source.
 * Returns: array of URL strings.
 */
function referencesIn(text) {
  const attributes = [...text.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  const cssUrls = [...text.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((match) => match[1]);
  return [...attributes, ...cssUrls];
}

const files = [...PAGES, 'style.css'].map((name) => ({
  name,
  text: fs.readFileSync(path.join(SITE, name), 'utf8'),
}));

for (const { name, text } of files) {
  test(`${name} loads nothing from other sites`, () => {
    const absolute = referencesIn(text).filter((url) => /^[a-z]+:/i.test(url));
    for (const url of absolute) {
      assert.ok(
        ALLOWED_ABSOLUTE.some((allowed) => url.startsWith(allowed)),
        `${name} points to ${url}`
      );
    }
  });

  test(`${name} has no broken relative links`, () => {
    const relative = referencesIn(text).filter((url) => !/^[a-z]+:/i.test(url) && !url.startsWith('#'));
    assert.ok(relative.length > 0);
    for (const url of relative) {
      const file = path.join(SITE, decodeURIComponent(url.split(/[?#]/)[0]));
      assert.ok(fs.existsSync(file), `${name} links to missing ${url}`);
    }
  });
}

test('pages link to each other, and in-page links have targets', () => {
  const index = files.find((file) => file.name === 'index.html').text;
  assert.ok(index.includes('href="privacy.html"'));
  for (const [, id] of index.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(index.includes(`id="${id}"`), `no element with id ${id}`);
  }
});

test('the privacy policy names the support contact and says nothing is collected', () => {
  const privacy = files.find((file) => file.name === 'privacy.html').text;
  assert.ok(privacy.includes('kunaljmit036@gmail.com'));
  assert.match(privacy, /does not collect/i);
});

test('every page has a title, a description and a language', () => {
  for (const name of PAGES) {
    const page = files.find((file) => file.name === name).text;
    assert.match(page, /<html lang="en">/);
    assert.match(page, /<title>[^<]+<\/title>/);
    assert.match(page, /<meta name="description" content="[^"]+"/);
  }
});
