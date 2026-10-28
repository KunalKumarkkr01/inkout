// Service worker: keyboard shortcuts, per-tab state (counts and pause), presenter mode and the
// toolbar badge. Chrome stops idle service workers, so state lives in chrome.storage.session.
importScripts('settings.js', 'sites.js', 'tab-state.js', 'presenter.js');

const TOGGLE_COMMAND = 'toggle-masking';
const BLUR_PAGE_COMMAND = 'blur-page';
const TABS_KEY = 'tabs';
const PRESENTER_KEY = 'presenter';
const WELCOME_PAGE = 'src/welcome.html';
const TOP_FRAME_ID = 0;
const NO_SHARING = Object.freeze({ active: false, label: '' });
const TabState = InkoutTabState;
const Presenter = InkoutPresenter;

// State changes run one at a time, so two messages arriving together can't overwrite each other.
let tabsQueue = Promise.resolve();
let presenterQueue = Promise.resolve();

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
 * Summary: changes the presenter session (who is sharing) and saves it, one change at a time.
 * Parameters: change — async function from (session, settings) to the new session; it may save settings.
 * Returns: Promise of the new session.
 */
function updatePresenter(change) {
  const run = presenterQueue.then(async () => {
    const data = await chrome.storage.session.get(PRESENTER_KEY);
    const session = await change(data[PRESENTER_KEY] ?? Presenter.NO_SESSION, await PrivacyGuardSettings.load());
    await chrome.storage.session.set({ [PRESENTER_KEY]: session });
    return session;
  });
  presenterQueue = run.catch(() => {});
  return run;
}

/**
 * Summary: what the popup shows about a screen share in progress.
 * Returns: Promise of { active, label } such as { active: true, label: 'Google Meet' }.
 */
async function sharingState() {
  const { sharing } = (await chrome.storage.session.get(PRESENTER_KEY))[PRESENTER_KEY] ?? Presenter.NO_SESSION;
  return sharing ? { active: true, label: InkoutSites.meetingLabel(sharing.host) } : NO_SHARING;
}

/**
 * Summary: a tab started sharing its screen: switch protection on if asked, and end every pause
 *          so nothing left paused shows during the call.
 * Parameters: tabId; host — the sharing tab's site.
 */
async function handleShareStarted(tabId, host) {
  await updatePresenter(async (session, settings) => {
    const next = Presenter.onShareStarted(session, settings, tabId, host);
    if (next.settingsPatch) await PrivacyGuardSettings.save({ ...settings, ...next.settingsPatch });
    return next.session;
  });
  const tabs = await updateTabs(TabState.clearAllPauses);
  const settings = await PrivacyGuardSettings.load();
  // Every known tab is told, not only those recorded as paused: a page can hold a pause the
  // worker no longer knows about (for example one kept in the back/forward cache).
  await Promise.all(
    Object.keys(tabs).map(async (id) => {
      await updateTabBadge(Number(id), settings.enabled, tabs);
      await chrome.tabs.sendMessage(Number(id), { type: 'pauseChanged', paused: false }).catch(() => {});
    })
  );
}

/**
 * Summary: a tab's screen share ended (or the tab closed): switch protection back off only if the
 *          share switched it on and the user asked for that.
 * Parameters: tabId.
 */
async function handleShareEnded(tabId) {
  await updatePresenter(async (session, settings) => {
    const next = Presenter.onShareEnded(session, settings, tabId);
    if (next.settingsPatch) await PrivacyGuardSettings.save({ ...settings, ...next.settingsPatch });
    return next.session;
  });
}

/**
 * Summary: a manual switch-off during a share means the share must not switch anything later.
 * Parameters: settings — the new settings.
 * Usage: on every settings change; a switch-on the share made itself never looks like this.
 */
async function noticeManualToggle(settings) {
  if (settings.enabled) return;
  await updatePresenter(async (session) => (session.autoEnabled ? Presenter.onManualToggle(session) : session));
}

/**
 * Summary: asks every frame of a tab to blur or unblur its whole page.
 * Parameters: tabId.
 */
async function toggleWholePageBlur(tabId) {
  await chrome.tabs.sendMessage(tabId, { type: 'toggleWholePageBlur' }).catch(() => {});
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
 * Summary: whether a message came from the page shown in the tab itself, not from a frame inside it.
 * Parameters: sender — Chrome's sender info.
 * Returns: true for the tab's top-level page. Chrome's frameType is used where available, because a
 *          prerendered page that is then shown doesn't have frame id 0.
 */
function isTopFrame(sender) {
  return sender.frameType ? sender.frameType === 'outermost_frame' : sender.frameId === TOP_FRAME_ID;
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
      const frameId = isTopFrame(sender) ? TOP_FRAME_ID : sender.frameId;
      const tabs = await updateTabs((all) => TabState.recordFrame(all, tabId, frameId, message.host));
      await updateTabBadge(tabId, settings.enabled, tabs);
      return { paused: TabState.tabSummary(tabs, tabId).paused };
    }
    case 'frameCounts':
      await updateTabs((all) => TabState.recordCounts(all, sender.tab.id, sender.frameId, message.counts));
      return undefined;
    case 'getTabState':
      return { ...TabState.tabSummary(await loadTabs(), message.tabId), sharing: await sharingState() };
    case 'setPaused': {
      const tabs = await updateTabs((all) => TabState.setPaused(all, message.tabId, message.paused));
      await updateTabBadge(message.tabId, settings.enabled, tabs);
      await chrome.tabs.sendMessage(message.tabId, { type: 'pauseChanged', paused: message.paused }).catch(() => {});
      return undefined;
    }
    case 'shareStarted':
      await handleShareStarted(sender.tab.id, message.host);
      return undefined;
    case 'shareEnded':
      await handleShareEnded(sender.tab.id);
      return undefined;
    case 'blurPage':
      await toggleWholePageBlur(message.tabId);
      return undefined;
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse, () => sendResponse(undefined));
  return true; // the reply is sent asynchronously
});

// The welcome page opens once, when Inkout is first installed (not on updates).
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) chrome.tabs.create({ url: WELCOME_PAGE });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateTabs((tabs) => TabState.forgetTab(tabs, tabId));
  handleShareEnded(tabId);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === BLUR_PAGE_COMMAND) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) await toggleWholePageBlur(activeTab.id);
    return;
  }
  if (command !== TOGGLE_COMMAND) return;
  const settings = await PrivacyGuardSettings.load();
  await PrivacyGuardSettings.save({ ...settings, enabled: !settings.enabled });
});

PrivacyGuardSettings.onChange((settings) => {
  updateAllBadges(settings);
  noticeManualToggle(settings);
});
PrivacyGuardSettings.load().then(updateAllBadges);
