// Presenter mode decisions for the service worker: what to do when a page starts or stops sharing
// the screen. Pure functions; the session object is stored in chrome.storage.session.
// Exposes globalThis.InkoutPresenter (and module.exports for Node tests).
(function (root) {
  'use strict';

  // shares: every frame sharing right now, as { tabId, frameId, host }. Share events come from pages,
  // which can fake them, so a share only ends for the frame that started it, and switching protection
  // off waits until no share is left. autoEnabled: protection was switched on by a share.
  const NO_SESSION = Object.freeze({ shares: Object.freeze([]), autoEnabled: false });

  const sameFrame = (share, tabId, frameId) => share.tabId === tabId && share.frameId === frameId;

  /**
   * Summary: decides what happens when a frame starts sharing the screen.
   * Parameters: session — current presenter session; settings — complete settings object;
   *   share — { tabId, frameId, host } of the sharing frame.
   * Returns: { session, settingsPatch } where settingsPatch is { enabled: true } when protection
   *   should switch on ("Turn on when I start sharing"), otherwise null.
   * Usage: onShareStarted(session, settings, { tabId: 4, frameId: 0, host: 'meet.google.com' }).
   */
  function onShareStarted(session, settings, share) {
    const switchOn = settings.autoOnWhenSharing && !settings.enabled;
    const others = session.shares.filter((each) => !sameFrame(each, share.tabId, share.frameId));
    return {
      session: { shares: [...others, share], autoEnabled: session.autoEnabled || switchOn },
      settingsPatch: switchOn ? { enabled: true } : null,
    };
  }

  /**
   * Summary: removes shares, and once none is left decides whether protection switches back off.
   * Parameters: session; settings; ends — function telling which shares have ended.
   * Returns: { session, settingsPatch } where settingsPatch is { enabled: false } only when the last
   *   share ended, a share switched protection on, and "Turn off when sharing ends" is on.
   */
  function endShares(session, settings, ends) {
    const remaining = session.shares.filter((share) => !ends(share));
    if (remaining.length === session.shares.length) return { session, settingsPatch: null };
    if (remaining.length > 0) return { session: { ...session, shares: remaining }, settingsPatch: null };
    const switchOff = session.autoEnabled && settings.autoOffWhenSharingEnds && settings.enabled;
    return { session: NO_SESSION, settingsPatch: switchOff ? { enabled: false } : null };
  }

  /**
   * Summary: decides what happens when a frame says its share ended.
   * Parameters: session; settings; tabId, frameId — the frame reporting the end.
   * Returns: { session, settingsPatch } as for endShares; an end from a frame that isn't sharing changes nothing.
   */
  function onShareEnded(session, settings, tabId, frameId) {
    return endShares(session, settings, (share) => sameFrame(share, tabId, frameId));
  }

  /**
   * Summary: a tab closed or loaded a new page, so any share its old page had has ended.
   * Parameters: session; settings; tabId.
   * Returns: { session, settingsPatch } as for endShares.
   */
  function onTabGone(session, settings, tabId) {
    return endShares(session, settings, (share) => share.tabId === tabId);
  }

  /**
   * Summary: records that the user switched protection by hand, so the share never undoes their choice.
   * Parameters: session.
   * Returns: the session with autoEnabled cleared.
   */
  function onManualToggle(session) {
    return { ...session, autoEnabled: false };
  }

  const api = { NO_SESSION, onShareStarted, onShareEnded, onTabGone, onManualToggle };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.InkoutPresenter = api;
  }
})(globalThis);
