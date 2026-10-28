const test = require('node:test');
const assert = require('node:assert/strict');
const { withDefaults, DEFAULTS } = require('../src/settings.js');

test('first run with nothing stored hides everything', () => {
  assert.deepEqual(withDefaults(undefined), {
    enabled: true,
    types: { email: true, phone: true, card: true },
  });
});

test('partial stored settings keep the missing types switched on', () => {
  assert.deepEqual(withDefaults({ enabled: false, types: { phone: false } }), {
    enabled: false,
    types: { email: true, phone: false, card: true },
  });
});

test('defaults cannot be mutated by callers', () => {
  const merged = withDefaults(undefined);
  merged.types.email = false;
  assert.equal(DEFAULTS.types.email, true);
});
