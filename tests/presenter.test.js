const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { NO_SESSION, onShareStarted, onShareEnded, onTabGone, onManualToggle } = require('../src/presenter.js');
const { withDefaults } = require('../src/settings.js');

const MEET = { tabId: 4, frameId: 0, host: 'meet.google.com' };
const ZOOM = { tabId: 5, frameId: 0, host: 'zoom.us' };
const AD_FRAME_IN_MEET = { tabId: 4, frameId: 9, host: 'meet.google.com' };
const off = (extra = {}) => withDefaults({ enabled: false, ...extra });
const on = (extra = {}) => withDefaults({ enabled: true, ...extra });
const autoOff = { autoOffWhenSharingEnds: true };

/**
 * Summary: the session after one share started while protection was off (so the share switched it on).
 * Parameters: share — which tab and frame shares; extra — settings overrides.
 */
function sharingSince(share, extra = {}) {
  return onShareStarted(NO_SESSION, off(extra), share).session;
}

describe('presenter mode', () => {
  test('starting a share turns protection on when it was off', () => {
    const { session, settingsPatch } = onShareStarted(NO_SESSION, off(), MEET);
    assert.deepEqual(settingsPatch, { enabled: true });
    assert.deepEqual(session, { shares: [MEET], autoEnabled: true });
  });

  test('starting a share changes nothing when protection is already on', () => {
    const { session, settingsPatch } = onShareStarted(NO_SESSION, on(), MEET);
    assert.equal(settingsPatch, null);
    assert.deepEqual(session, { shares: [MEET], autoEnabled: false });
  });

  test('starting a share leaves protection off when "turn on when I start sharing" is off', () => {
    const { settingsPatch, session } = onShareStarted(NO_SESSION, off({ autoOnWhenSharing: false }), ZOOM);
    assert.equal(settingsPatch, null);
    assert.equal(session.autoEnabled, false);
  });

  test('the same frame starting again is still one share', () => {
    const again = onShareStarted(sharingSince(MEET), on(), MEET).session;
    assert.deepEqual(again.shares, [MEET]);
  });

  test('ending the share turns protection off again only if the share turned it on and the setting asks', () => {
    const { session, settingsPatch } = onShareEnded(sharingSince(MEET, autoOff), on(autoOff), MEET.tabId, MEET.frameId);
    assert.deepEqual(settingsPatch, { enabled: false });
    assert.deepEqual(session, NO_SESSION);
  });

  test('ending the share keeps protection on by default', () => {
    const { session, settingsPatch } = onShareEnded(sharingSince(MEET), on(), MEET.tabId, MEET.frameId);
    assert.equal(settingsPatch, null);
    assert.deepEqual(session, NO_SESSION);
  });

  test('ending the share never turns off protection the user turned on themselves', () => {
    const started = onShareStarted(NO_SESSION, on(autoOff), MEET).session;
    assert.equal(onShareEnded(started, on(autoOff), MEET.tabId, MEET.frameId).settingsPatch, null);
  });

  test('switching protection by hand during the share cancels the automatic switch-off', () => {
    const afterManual = onManualToggle(sharingSince(MEET, autoOff));
    assert.equal(afterManual.autoEnabled, false);
    assert.equal(onShareEnded(afterManual, on(autoOff), MEET.tabId, MEET.frameId).settingsPatch, null);
  });

  test('while another share is still running, nothing switches off', () => {
    const both = onShareStarted(sharingSince(MEET, autoOff), on(autoOff), ZOOM).session;
    const meetEnded = onShareEnded(both, on(autoOff), MEET.tabId, MEET.frameId);
    assert.equal(meetEnded.settingsPatch, null);
    assert.deepEqual(meetEnded.session, { shares: [ZOOM], autoEnabled: true });
    assert.deepEqual(onShareEnded(meetEnded.session, on(autoOff), ZOOM.tabId, ZOOM.frameId).settingsPatch, { enabled: false });
  });

  test('an end from a frame that is not sharing changes nothing', () => {
    const session = sharingSince(MEET, autoOff);
    for (const [tabId, frameId] of [[ZOOM.tabId, 0], [AD_FRAME_IN_MEET.tabId, AD_FRAME_IN_MEET.frameId]]) {
      const ended = onShareEnded(session, on(autoOff), tabId, frameId);
      assert.equal(ended.settingsPatch, null);
      assert.deepEqual(ended.session, session);
    }
  });

  test('a share ending with no share running changes nothing', () => {
    const { session, settingsPatch } = onShareEnded(NO_SESSION, on(), MEET.tabId, MEET.frameId);
    assert.equal(settingsPatch, null);
    assert.deepEqual(session, NO_SESSION);
  });

  test('a sharing tab that closes or loads a new page ends all of its shares', () => {
    const twoFrames = onShareStarted(sharingSince(MEET, autoOff), on(autoOff), AD_FRAME_IN_MEET).session;
    const gone = onTabGone(twoFrames, on(autoOff), MEET.tabId);
    assert.deepEqual(gone.settingsPatch, { enabled: false });
    assert.deepEqual(gone.session, NO_SESSION);
  });

  test('a tab that was not sharing going away changes nothing', () => {
    const session = sharingSince(MEET, autoOff);
    const gone = onTabGone(session, on(autoOff), ZOOM.tabId);
    assert.equal(gone.settingsPatch, null);
    assert.deepEqual(gone.session, session);
  });
});
