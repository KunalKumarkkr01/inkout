// Shared settings helpers for the content script, popup and service worker.
// Exposes globalThis.PrivacyGuardSettings (and module.exports for Node tests).
(function (root) {
  'use strict';

  const STORAGE_KEY = 'privacyGuardSettings';
  const DEFAULTS = Object.freeze({
    enabled: true,
    types: Object.freeze({ email: true, phone: true, card: true }),
  });

  /**
   * Summary: fills in any missing settings with defaults (everything hidden).
   * Parameters: stored — settings object read from storage, possibly undefined or partial.
   * Returns: a complete settings object { enabled, types: { email, phone, card } }.
   * Usage: withDefaults(undefined) → defaults on first install; withDefaults({ enabled: false }) keeps types on.
   */
  function withDefaults(stored) {
    return { ...DEFAULTS, ...stored, types: { ...DEFAULTS.types, ...stored?.types } };
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
