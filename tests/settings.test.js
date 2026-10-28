const test = require('node:test');
const assert = require('node:assert/strict');
const { withDefaults, DEFAULTS } = require('../src/settings.js');

test('first run with nothing stored uses the defaults', () => {
  assert.deepEqual(withDefaults(undefined), {
    enabled: true,
    types: { email: true, apiKey: true, iban: true, card: true, phone: true, ip: false, custom: true },
    customWords: [],
    customWordsIgnoreCase: true,
    customWordsAsPatterns: false,
    style: 'blur',
    blurStrength: 'medium',
    siteMode: 'all',
    chosenSites: [],
    neverHideSites: [],
    hideTitles: true,
    autoOnWhenSharing: true,
    autoOffWhenSharingEnds: false,
  });
});

test('partial stored settings keep the missing types at their defaults', () => {
  const merged = withDefaults({ enabled: false, types: { phone: false, ip: true } });
  assert.equal(merged.enabled, false);
  assert.equal(merged.types.phone, false);
  assert.equal(merged.types.ip, true);
  assert.equal(merged.types.email, true);
  assert.equal(merged.types.apiKey, true);
});

test('settings saved by the prototype gain the new types', () => {
  const merged = withDefaults({ enabled: true, types: { email: true, phone: false, card: true } });
  assert.equal(merged.types.iban, true);
  assert.equal(merged.types.ip, false);
  assert.equal(merged.style, 'blur');
});

test('unknown choice values fall back to the defaults', () => {
  const merged = withDefaults({ style: 'label', blurStrength: 'huge', siteMode: 'some' });
  assert.equal(merged.style, 'blur');
  assert.equal(merged.blurStrength, 'medium');
  assert.equal(merged.siteMode, 'all');
});

test('known choice values are kept', () => {
  const merged = withDefaults({ style: 'bar', blurStrength: 'strong', siteMode: 'chosen' });
  assert.equal(merged.style, 'bar');
  assert.equal(merged.blurStrength, 'strong');
  assert.equal(merged.siteMode, 'chosen');
});

test('list settings that are not arrays fall back to empty lists', () => {
  const merged = withDefaults({ neverHideSites: 'x', chosenSites: null, customWords: 5 });
  assert.deepEqual(merged.neverHideSites, []);
  assert.deepEqual(merged.chosenSites, []);
  assert.deepEqual(merged.customWords, []);
});

test('stored lists are kept', () => {
  const merged = withDefaults({ neverHideSites: ['example.com'], customWords: ['Project Falcon'] });
  assert.deepEqual(merged.neverHideSites, ['example.com']);
  assert.deepEqual(merged.customWords, ['Project Falcon']);
});

test('defaults cannot be mutated by callers', () => {
  const merged = withDefaults(undefined);
  merged.types.email = false;
  merged.neverHideSites.push('example.com');
  merged.customWords.push('secret');
  assert.equal(DEFAULTS.types.email, true);
  assert.deepEqual(DEFAULTS.neverHideSites, []);
  assert.deepEqual(DEFAULTS.customWords, []);
});
