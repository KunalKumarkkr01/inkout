// Service worker: keyboard shortcut toggle and the "OFF" badge on the toolbar icon.
importScripts('settings.js');

const TOGGLE_COMMAND = 'toggle-masking';
const OFF_BADGE_TEXT = 'OFF';
const OFF_BADGE_COLOR = '#d93025';

/**
 * Summary: shows "OFF" on the toolbar icon while hiding is switched off, so it's obvious before a call.
 * Parameters: settings — complete settings object.
 * Usage: updateBadge(await PrivacyGuardSettings.load());
 */
function updateBadge(settings) {
  chrome.action.setBadgeText({ text: settings.enabled ? '' : OFF_BADGE_TEXT });
  chrome.action.setBadgeBackgroundColor({ color: OFF_BADGE_COLOR });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== TOGGLE_COMMAND) return;
  const settings = await PrivacyGuardSettings.load();
  await PrivacyGuardSettings.save({ ...settings, enabled: !settings.enabled });
});

PrivacyGuardSettings.onChange(updateBadge);
PrivacyGuardSettings.load().then(updateBadge);
