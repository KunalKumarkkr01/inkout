// Presenter mode decisions for the service worker: what to do when a tab starts or stops sharing
// its screen. Pure functions; the session object is stored in chrome.storage.session.
// Exposes globalThis.InkoutPresenter (and module.exports for Node tests).
(function (root) {
  'use strict';

  // sharing: the tab sharing its screen, or null. autoEnabled: protection was switched on by the share.
  const NO_SESSION = Object.freeze({ sharing: null, autoEnabled: false });

  /**
   * Summary: decides what happens when a tab starts sharing its screen.
   * Parameters: session — current presenter session; settings — complete settings object;
   *   tabId — the sharing tab; host — that tab's site.
   * Returns: { session, settingsPatch } where settingsPatch is { enabled: true } when protection
   *   should switch on ("Turn on when I start sharing"), otherwise null.
   * Usage: const { session, settingsPatch } = onShareStarted(session, settings, tab.id, 'meet.google.com').
   */
  function onShareStarted(session, settings, tabId, host) {
    const switchOn = settings.autoOnWhenSharing && !settings.enabled;
    return {
      session: { sharing: { tabId, host }, autoEnabled: session.autoEnabled || switchOn },
      settingsPatch: switchOn ? { enabled: true } : null,
    };
  }

  /**
   * Summary: decides what happens when a tab's screen share ends.
   * Parameters: session; settings; tabId — the tab whose share ended.
   * Returns: { session, settingsPatch } where settingsPatch is { enabled: false } only when the share
   *   itself switched protection on and "Turn off when sharing ends" is on, otherwise null.
   */
  function onShareEnded(session, settings, tabId) {
    if (session.sharing?.tabId !== tabId) return { session, settingsPatch: null };
    const switchOff = session.autoEnabled && settings.autoOffWhenSharingEnds && settings.enabled;
    return { session: NO_SESSION, settingsPatch: switchOff ? { enabled: false } : null };
  }

  /**
   * Summary: records that the user switched protection by hand, so the share never undoes their choice.
   * Parameters: session.
   * Returns: the session with autoEnabled cleared.
   */
  function onManualToggle(session) {
    return { ...session, autoEnabled: false };
  }

  const api = { NO_SESSION, onShareStarted, onShareEnded, onManualToggle };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.InkoutPresenter = api;
  }
})(globalThis);
