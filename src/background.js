// Service worker: keyboard shortcut, per-tab state (counts and pause) and the toolbar badge.
// Chrome stops idle service workers, so per-tab state lives in chrome.storage.session, not in memory.
importScripts('settings.js', 'sites.js', 'tab-state.js');

const TOGGLE_COMMAND = 'toggle-masking';
const TABS_KEY = 'tabs';
const NO_SHARING = Object.freeze({ active: false, label: '' });
const TabState = InkoutTabState;

// State changes run one at a time, so two frames reporting together can't overwrite each other.
let tabsQueue = Promise.resolve();

/**
 * Summary: reads the per-tab state.
 * Returns: Promise of the state object (see tab-state.js).
 */
async function loadTabs() {
  const data = await chrome.storage.session.get(TABS_KEY);
  return data[TABS_KEY] ?? {};
}

/**
 * Summary: changes the per-tab state and saves it, one change at a time.
 * Parameters: change — function from the old state object to the new one.
 * Returns: Promise of the new state object.
 * Usage: await updateTabs((tabs) => TabState.setPaused(tabs, tabId, true));
 */
function updateTabs(change) {
  const run = tabsQueue.then(async () => {
    const tabs = change(await loadTabs());
    await chrome.storage.session.set({ [TABS_KEY]: tabs });
    return tabs;
  });
  tabsQueue = run.catch(() => {});
  return run;
}

/**
 * Summary: sets one tab's toolbar badge, text color and tooltip.
 * Parameters: tabId; enabled — whether protection is on; tabs — state object.
 */
async function updateTabBadge(tabId, enabled, tabs) {
  const badge = TabState.badgeFor(enabled, TabState.tabSummary(tabs, tabId));
  try {
    await chrome.action.setBadgeText({ tabId, text: badge.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
    await chrome.action.setTitle({ tabId, title: badge.title });
  } catch {
    // The tab closed meanwhile; there is no badge to set.
  }
}

/**
 * Summary: sets the badge for every tab, plus the default for tabs Inkout can't run on.
 * Parameters: settings — complete settings object.
 */
async function updateAllBadges(settings) {
  const fallback = TabState.badgeFor(settings.enabled, { paused: false });
  await chrome.action.setBadgeText({ text: fallback.text });
  await chrome.action.setBadgeBackgroundColor({ color: fallback.color });
  await chrome.action.setTitle({ title: fallback.title });
  const tabs = await loadTabs();
  await Promise.all(Object.keys(tabs).map((tabId) => updateTabBadge(Number(tabId), settings.enabled, tabs)));
}

/**
 * Summary: answers a message from a content script or an extension page.
 * Parameters: message — { type, ... }; sender — Chrome's sender info.
 * Returns: Promise of the reply, or undefined for messages that need none.
 */
async function handleMessage(message, sender) {
  const settings = await PrivacyGuardSettings.load();
  switch (message.type) {
    case 'frameHello': {
      const tabId = sender.tab.id;
      const tabs = await updateTabs((all) => TabState.recordFrame(all, tabId, sender.frameId, message.host));
      await updateTabBadge(tabId, settings.enabled, tabs);
      return { paused: TabState.tabSummary(tabs, tabId).paused };
    }
    case 'frameCounts':
      await updateTabs((all) => TabState.recordCounts(all, sender.tab.id, sender.frameId, message.counts));
      return undefined;
    case 'getTabState':
      return { ...TabState.tabSummary(await loadTabs(), message.tabId), sharing: NO_SHARING };
    case 'setPaused': {
      const tabs = await updateTabs((all) => TabState.setPaused(all, message.tabId, message.paused));
      await updateTabBadge(message.tabId, settings.enabled, tabs);
      await chrome.tabs.sendMessage(message.tabId, { type: 'pauseChanged', paused: message.paused }).catch(() => {});
      return undefined;
    }
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse, () => sendResponse(undefined));
  return true; // the reply is sent asynchronously
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateTabs((tabs) => TabState.forgetTab(tabs, tabId));
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== TOGGLE_COMMAND) return;
  const settings = await PrivacyGuardSettings.load();
  await PrivacyGuardSettings.save({ ...settings, enabled: !settings.enabled });
});

PrivacyGuardSettings.onChange(updateAllBadges);
PrivacyGuardSettings.load().then(updateAllBadges);
