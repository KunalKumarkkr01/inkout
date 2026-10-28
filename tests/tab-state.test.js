const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  recordFrame,
  recordCounts,
  setPaused,
  forgetTab,
  clearAllPauses,
  tabSummary,
  badgeFor,
} = require('../src/tab-state.js');

const TAB = 7;
const OTHER_TAB = 8;

describe('tab state', () => {
  test('an unknown tab has nothing hidden and is not paused', () => {
    assert.deepEqual(tabSummary({}, TAB), { host: '', paused: false, counts: {} });
  });

  test('the top frame records the tab site', () => {
    const tabs = recordFrame({}, TAB, 0, 'mail.example.com');
    assert.equal(tabSummary(tabs, TAB).host, 'mail.example.com');
  });

  test('counts are added up across frames, leaving out zeros', () => {
    let tabs = recordFrame({}, TAB, 0, 'example.com');
    tabs = recordCounts(tabs, TAB, 0, { email: 2, phone: 0 });
    tabs = recordCounts(tabs, TAB, 3, { email: 1, card: 1 });
    assert.deepEqual(tabSummary(tabs, TAB).counts, { email: 3, card: 1 });
  });

  test('a frame reporting again replaces its earlier counts', () => {
    let tabs = recordCounts({}, TAB, 0, { email: 2 });
    tabs = recordCounts(tabs, TAB, 0, { email: 5 });
    assert.deepEqual(tabSummary(tabs, TAB).counts, { email: 5 });
  });

  test('a new page in the top frame resets the counts', () => {
    let tabs = recordFrame({}, TAB, 0, 'example.com');
    tabs = recordCounts(tabs, TAB, 3, { email: 1 });
    tabs = recordFrame(tabs, TAB, 0, 'example.com');
    assert.deepEqual(tabSummary(tabs, TAB).counts, {});
  });

  test('a frame inside the page does not reset anything', () => {
    let tabs = recordFrame({}, TAB, 0, 'example.com');
    tabs = setPaused(tabs, TAB, true);
    tabs = recordCounts(tabs, TAB, 0, { email: 1 });
    tabs = recordFrame(tabs, TAB, 3, 'example.com');
    assert.deepEqual(tabSummary(tabs, TAB), { host: 'example.com', paused: true, counts: { email: 1 } });
  });

  test('a pause survives a reload on the same site', () => {
    let tabs = recordFrame({}, TAB, 0, 'example.com');
    tabs = setPaused(tabs, TAB, true);
    tabs = recordFrame(tabs, TAB, 0, 'example.com');
    assert.equal(tabSummary(tabs, TAB).paused, true);
  });

  test('moving to a different site ends the pause', () => {
    let tabs = recordFrame({}, TAB, 0, 'example.com');
    tabs = setPaused(tabs, TAB, true);
    tabs = recordFrame(tabs, TAB, 0, 'other.example.org');
    assert.equal(tabSummary(tabs, TAB).paused, false);
  });

  test('pausing one tab leaves other tabs alone', () => {
    let tabs = recordFrame({}, TAB, 0, 'example.com');
    tabs = recordFrame(tabs, OTHER_TAB, 0, 'example.com');
    tabs = setPaused(tabs, TAB, true);
    assert.equal(tabSummary(tabs, OTHER_TAB).paused, false);
  });

  test('a closed tab is forgotten', () => {
    let tabs = recordFrame({}, TAB, 0, 'example.com');
    tabs = setPaused(tabs, TAB, true);
    tabs = forgetTab(tabs, TAB);
    assert.deepEqual(tabs, {});
  });

  test('all pauses can be ended at once', () => {
    let tabs = setPaused(recordFrame({}, TAB, 0, 'a.example'), TAB, true);
    tabs = setPaused(recordFrame(tabs, OTHER_TAB, 0, 'b.example'), OTHER_TAB, true);
    tabs = clearAllPauses(tabs);
    assert.equal(tabSummary(tabs, TAB).paused, false);
    assert.equal(tabSummary(tabs, OTHER_TAB).paused, false);
  });

  test('state is never changed in place', () => {
    const tabs = Object.freeze({});
    const next = recordFrame(tabs, TAB, 0, 'example.com');
    assert.notEqual(next, tabs);
    assert.deepEqual(tabs, {});
  });

  test('state survives being stored as JSON', () => {
    let tabs = recordFrame({}, TAB, 0, 'example.com');
    tabs = recordCounts(setPaused(tabs, TAB, true), TAB, 0, { email: 1 });
    const restored = JSON.parse(JSON.stringify(tabs));
    assert.deepEqual(tabSummary(restored, TAB), { host: 'example.com', paused: true, counts: { email: 1 } });
  });
});

describe('toolbar badge', () => {
  const summary = (paused) => ({ host: 'example.com', paused, counts: {} });

  test('off shows a red OFF badge', () => {
    assert.deepEqual(badgeFor(false, summary(false)), { text: 'OFF', color: '#d93025', title: 'Inkout is off' });
  });

  test('paused shows an amber pause badge', () => {
    assert.deepEqual(badgeFor(true, summary(true)), {
      text: '❚❚',
      color: '#B45309',
      title: 'Inkout is paused on this tab',
    });
  });

  test('on shows no badge', () => {
    assert.deepEqual(badgeFor(true, summary(false)), { text: '', color: '#0B7A75', title: 'Inkout' });
  });

  test('off wins over paused', () => {
    assert.equal(badgeFor(false, summary(true)).text, 'OFF');
  });
});
