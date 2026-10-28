// Per-tab state kept by the service worker: the tab's site, what is hidden in each frame, and
// whether the tab is paused. Pure functions over a plain object, so it can be stored as JSON in
// chrome.storage.session. Exposes globalThis.InkoutTabState (and module.exports for Node tests).
(function (root) {
  'use strict';

  const TOP_FRAME_ID = 0;
  const BADGES = Object.freeze({
    off: Object.freeze({ text: 'OFF', color: '#d93025', title: 'Inkout is off' }),
    paused: Object.freeze({ text: '❚❚', color: '#B45309', title: 'Inkout is paused on this tab' }),
    on: Object.freeze({ text: '', color: '#0B7A75', title: 'Inkout' }),
  });

  /**
   * Summary: a tab's entry, or an empty one for a tab not seen yet.
   * Parameters: tabs — state object; tabId — Chrome tab id.
   * Returns: { host, paused, counts } where counts is keyed by frame id.
   */
  function entryFor(tabs, tabId) {
    return tabs[tabId] ?? { host: '', paused: false, counts: {} };
  }

  /**
   * Summary: records that a frame of a tab loaded a page. A new page in the top frame resets the
   *          counts, and moving to a different site also ends the tab's pause.
   * Parameters: tabs — state object; tabId; frameId — 0 for the top frame; host — the tab's site.
   * Returns: the new state object.
   * Usage: tabs = recordFrame(tabs, sender.tab.id, sender.frameId, message.host).
   */
  function recordFrame(tabs, tabId, frameId, host) {
    const entry = entryFor(tabs, tabId);
    if (frameId !== TOP_FRAME_ID) return { ...tabs, [tabId]: entry };
    const paused = entry.paused && entry.host === host;
    return { ...tabs, [tabId]: { host, paused, counts: {} } };
  }

  /**
   * Summary: stores how many values of each type one frame is hiding.
   * Parameters: tabs; tabId; frameId; counts — like { email: 2, phone: 1 }.
   * Returns: the new state object.
   */
  function recordCounts(tabs, tabId, frameId, counts) {
    const entry = entryFor(tabs, tabId);
    return { ...tabs, [tabId]: { ...entry, counts: { ...entry.counts, [frameId]: counts } } };
  }

  /**
   * Summary: pauses or resumes hiding on one tab.
   * Parameters: tabs; tabId; paused — true to pause.
   * Returns: the new state object.
   */
  function setPaused(tabs, tabId, paused) {
    return { ...tabs, [tabId]: { ...entryFor(tabs, tabId), paused } };
  }

  /**
   * Summary: drops a closed tab.
   * Parameters: tabs; tabId.
   * Returns: the new state object without that tab.
   */
  function forgetTab(tabs, tabId) {
    const { [tabId]: _closed, ...rest } = tabs;
    return rest;
  }

  /**
   * Summary: resumes every paused tab, for example when a screen share starts.
   * Parameters: tabs.
   * Returns: the new state object.
   */
  function clearAllPauses(tabs) {
    return Object.fromEntries(Object.entries(tabs).map(([tabId, entry]) => [tabId, { ...entry, paused: false }]));
  }

  /**
   * Summary: what the popup and badge need to know about one tab.
   * Parameters: tabs; tabId.
   * Returns: { host, paused, counts } with counts added up over all frames, leaving out zeros.
   * Usage: tabSummary(tabs, 7) → { host: 'example.com', paused: false, counts: { email: 3 } }.
   */
  function tabSummary(tabs, tabId) {
    const entry = entryFor(tabs, tabId);
    const counts = {};
    for (const frameCounts of Object.values(entry.counts)) {
      for (const [type, count] of Object.entries(frameCounts)) {
        if (count > 0) counts[type] = (counts[type] ?? 0) + count;
      }
    }
    return { host: entry.host, paused: entry.paused, counts };
  }

  /**
   * Summary: the toolbar badge for a tab.
   * Parameters: enabled — whether protection is on overall; summary — from tabSummary.
   * Returns: { text, color, title }: OFF in red when off, ❚❚ in amber when paused, no text when on.
   */
  function badgeFor(enabled, summary) {
    if (!enabled) return BADGES.off;
    return summary.paused ? BADGES.paused : BADGES.on;
  }

  const api = { recordFrame, recordCounts, setPaused, forgetTab, clearAllPauses, tabSummary, badgeFor };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.InkoutTabState = api;
  }
})(globalThis);
