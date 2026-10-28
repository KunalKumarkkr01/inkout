// Shared settings helpers for the content script, popup and service worker.
// Exposes globalThis.PrivacyGuardSettings (and module.exports for Node tests).
(function (root) {
  'use strict';

  const STORAGE_KEY = 'privacyGuardSettings';
  const DEFAULTS = Object.freeze({
    enabled: true,
    types: Object.freeze({ email: true, apiKey: true, iban: true, card: true, phone: true, ip: false, custom: true }),
    customWords: Object.freeze([]),
    customWordsIgnoreCase: true,
    customWordsAsPatterns: false,
    style: 'blur',
    blurStrength: 'medium',
    siteMode: 'all',
    chosenSites: Object.freeze([]),
    neverHideSites: Object.freeze([]),
    hideTitles: true,
    autoOnWhenSharing: true,
    autoOffWhenSharingEnds: false,
  });
  const CHOICES = Object.freeze({
    style: ['blur', 'bar'],
    blurStrength: ['light', 'medium', 'strong'],
    siteMode: ['all', 'chosen'],
  });
  const LIST_KEYS = ['customWords', 'chosenSites', 'neverHideSites'];

  /**
   * Summary: fills in missing or invalid settings with defaults, so callers always get a complete object.
   * Parameters: stored — settings object read from storage, possibly undefined, partial or from an older version.
   * Returns: a complete settings object shaped like DEFAULTS, with fresh arrays the caller may change.
   * Usage: withDefaults(undefined) → defaults on first install; withDefaults({ style: 'label' }).style → 'blur'.
   */
  function withDefaults(stored) {
    const merged = { ...DEFAULTS, ...stored, types: { ...DEFAULTS.types, ...stored?.types } };
    for (const [key, allowed] of Object.entries(CHOICES)) {
      if (!allowed.includes(merged[key])) merged[key] = DEFAULTS[key];
    }
    for (const key of LIST_KEYS) {
      merged[key] = Array.isArray(merged[key]) ? [...merged[key]] : [];
    }
    return merged;
  }

  /**
   * Summary: reads the current settings from Chrome sync storage.
   * Returns: Promise resolving to a complete settings object.
   * Usage: const settings = await PrivacyGuardSettings.load();
   */
  async function load() {
    const data = await chrome.storage.sync.get(STORAGE_KEY);
    return withDefaults(data[STORAGE_KEY]);
  }

  /**
   * Summary: saves settings to Chrome sync storage; every open tab picks the change up.
   * Parameters: settings — complete settings object.
   * Returns: Promise that resolves once saved.
   * Usage: await PrivacyGuardSettings.save({ ...settings, enabled: false });
   */
  async function save(settings) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  }

  /**
   * Summary: calls back whenever the settings change (from the popup, shortcut or another device).
   * Parameters: callback — receives the new complete settings object.
   * Usage: PrivacyGuardSettings.onChange((settings) => applySettings(settings));
   */
  function onChange(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[STORAGE_KEY]) return;
      callback(withDefaults(changes[STORAGE_KEY].newValue));
    });
  }

  const api = { DEFAULTS, withDefaults, load, save, onChange };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.PrivacyGuardSettings = api;
  }
})(globalThis);
