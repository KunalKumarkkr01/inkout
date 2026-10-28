const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { NO_SESSION, onShareStarted, onShareEnded, onManualToggle } = require('../src/presenter.js');
const { withDefaults } = require('../src/settings.js');

const SHARING_TAB = 4;
const OTHER_TAB = 5;
const off = (extra = {}) => withDefaults({ enabled: false, ...extra });
const on = (extra = {}) => withDefaults({ enabled: true, ...extra });

describe('presenter mode', () => {
  test('starting a share turns protection on when it was off', () => {
    const { session, settingsPatch } = onShareStarted(NO_SESSION, off(), SHARING_TAB, 'meet.google.com');
    assert.deepEqual(settingsPatch, { enabled: true });
    assert.deepEqual(session, { sharing: { tabId: SHARING_TAB, host: 'meet.google.com' }, autoEnabled: true });
  });

  test('starting a share changes nothing when protection is already on', () => {
    const { session, settingsPatch } = onShareStarted(NO_SESSION, on(), SHARING_TAB, 'meet.google.com');
    assert.equal(settingsPatch, null);
    assert.equal(session.autoEnabled, false);
    assert.deepEqual(session.sharing, { tabId: SHARING_TAB, host: 'meet.google.com' });
  });

  test('starting a share leaves protection off when "turn on when I start sharing" is off', () => {
    const { settingsPatch, session } = onShareStarted(NO_SESSION, off({ autoOnWhenSharing: false }), SHARING_TAB, 'zoom.us');
    assert.equal(settingsPatch, null);
    assert.equal(session.autoEnabled, false);
  });

  test('ending the share turns protection off again only if the share turned it on and the setting asks', () => {
    const started = onShareStarted(NO_SESSION, off({ autoOffWhenSharingEnds: true }), SHARING_TAB, 'zoom.us');
    const { session, settingsPatch } = onShareEnded(started.session, on({ autoOffWhenSharingEnds: true }), SHARING_TAB);
    assert.deepEqual(settingsPatch, { enabled: false });
    assert.deepEqual(session, NO_SESSION);
  });

  test('ending the share keeps protection on by default', () => {
    const started = onShareStarted(NO_SESSION, off(), SHARING_TAB, 'zoom.us');
    const { session, settingsPatch } = onShareEnded(started.session, on(), SHARING_TAB);
    assert.equal(settingsPatch, null);
    assert.deepEqual(session, NO_SESSION);
  });

  test('ending the share never turns off protection the user turned on themselves', () => {
    const started = onShareStarted(NO_SESSION, on({ autoOffWhenSharingEnds: true }), SHARING_TAB, 'zoom.us');
    const { settingsPatch } = onShareEnded(started.session, on({ autoOffWhenSharingEnds: true }), SHARING_TAB);
    assert.equal(settingsPatch, null);
  });

  test('switching protection by hand during the share cancels the automatic switch-off', () => {
    const started = onShareStarted(NO_SESSION, off({ autoOffWhenSharingEnds: true }), SHARING_TAB, 'zoom.us');
    const afterManual = onManualToggle(started.session);
    assert.equal(afterManual.autoEnabled, false);
    const { settingsPatch } = onShareEnded(afterManual, on({ autoOffWhenSharingEnds: true }), SHARING_TAB);
    assert.equal(settingsPatch, null);
  });

  test('a share ending in another tab is ignored', () => {
    const started = onShareStarted(NO_SESSION, off({ autoOffWhenSharingEnds: true }), SHARING_TAB, 'zoom.us');
    const { session, settingsPatch } = onShareEnded(started.session, on({ autoOffWhenSharingEnds: true }), OTHER_TAB);
    assert.equal(settingsPatch, null);
    assert.deepEqual(session, started.session);
  });

  test('a share ending with no share running changes nothing', () => {
    const { session, settingsPatch } = onShareEnded(NO_SESSION, on(), SHARING_TAB);
    assert.equal(settingsPatch, null);
    assert.deepEqual(session, NO_SESSION);
  });

  test('a second share keeps the earlier automatic switch-on', () => {
    const first = onShareStarted(NO_SESSION, off({ autoOffWhenSharingEnds: true }), SHARING_TAB, 'zoom.us');
    const second = onShareStarted(first.session, on({ autoOffWhenSharingEnds: true }), OTHER_TAB, 'meet.google.com');
    assert.deepEqual(second.session, { sharing: { tabId: OTHER_TAB, host: 'meet.google.com' }, autoEnabled: true });
    assert.deepEqual(onShareEnded(second.session, on({ autoOffWhenSharingEnds: true }), OTHER_TAB).settingsPatch, {
      enabled: false,
    });
  });
});
