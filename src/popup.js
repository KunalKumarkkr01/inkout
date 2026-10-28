// Toolbar popup (Popup A): one big on/off button, the current tab's site and what is hidden there,
// a temporary pause, and, while a screen share is running, a banner and "Blur the whole page".
(function () {
  'use strict';

  const Settings = globalThis.PrivacyGuardSettings;
  const { isSiteActive } = globalThis.InkoutSites;
  const REFRESH_INTERVAL_MS = 1000;
  // Order and wording of the count chips, as [singular, plural].
  const COUNT_LABELS = [
    ['email', 'email', 'emails'],
    ['phone', 'phone', 'phones'],
    ['card', 'card', 'cards'],
    ['apiKey', 'API key', 'API keys'],
    ['iban', 'bank account', 'bank accounts'],
    ['ip', 'IP address', 'IP addresses'],
    ['custom', 'custom word', 'custom words'],
  ];
  const STATE_COPY = {
    on: {
      word: 'ON',
      title: 'Protection is on',
      desc: 'Emails, phone numbers and card numbers are blurred on every site.',
    },
    off: {
      word: 'OFF',
      title: 'Protection is off',
      desc: 'Everything is visible to anyone watching your screen.',
    },
    paused: {
      word: 'PAUSED',
      title: 'Paused on this tab',
      desc: 'Nothing is hidden here until you resume or close the tab.',
    },
  };

  const elements = Object.fromEntries(
    [
      'power',
      'power-word',
      'state-title',
      'state-desc',
      'site-initial',
      'site-host',
      'site-line',
      'counts',
      'pause',
      'sharing-banner',
      'sharing-label',
      'blur-page',
      'settings',
    ].map((id) => [id, document.getElementById(id)])
  );
  let tabId = null;
  let settings = Settings.DEFAULTS;
  let tabState = null;

  /**
   * Summary: the tab this popup is about: the active tab, or the tabId parameter when one is given
   *          (the browser tests open the popup as a page of its own).
   * Returns: Promise of a tab id, or null when there is no tab.
   */
  async function findTabId() {
    const requested = new URLSearchParams(location.search).get('tabId');
    if (requested) return Number(requested);
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return activeTab?.id ?? null;
  }

  /**
   * Summary: words for a count, e.g. 1 → "1 email", 3 → "3 emails".
   * Parameters: count; singular; plural.
   */
  function countWords(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  /**
   * Summary: the line under the site name.
   * Parameters: state — 'on' | 'off' | 'paused'; total — items hidden on the tab.
   */
  function siteLine(state, total) {
    if (!tabState.host) return "Inkout can't run on this page";
    if (state === 'on' && !isSiteActive(settings, tabState.host)) return "Your settings don't hide anything on this site";
    if (state !== 'on' || total === 0) return 'Nothing hidden right now';
    return `${countWords(total, 'item', 'items')} hidden on this tab`;
  }

  /**
   * Summary: draws the popup from the current settings and tab state.
   */
  function render() {
    const state = !settings.enabled ? 'off' : tabState.paused ? 'paused' : 'on';
    const copy = STATE_COPY[state];
    document.body.dataset.state = state;
    elements.power.setAttribute('aria-pressed', String(settings.enabled));
    elements['power-word'].textContent = copy.word;
    elements['state-title'].textContent = copy.title;
    elements['state-desc'].textContent = copy.desc;

    const counts = state === 'on' ? tabState.counts : {};
    const chips = COUNT_LABELS.filter(([type]) => counts[type] > 0).map(([type, singular, plural]) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = countWords(counts[type], singular, plural);
      return chip;
    });
    elements.counts.replaceChildren(...chips);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    elements['site-host'].textContent = tabState.host || 'This page';
    elements['site-initial'].textContent = (tabState.host || '?').charAt(0).toUpperCase();
    elements['site-line'].textContent = siteLine(state, total);

    elements.pause.hidden = !tabState.host;
    elements.pause.disabled = !settings.enabled;
    elements.pause.textContent = tabState.paused ? 'Resume' : 'Pause on this site';

    document.body.toggleAttribute('data-sharing', tabState.sharing.active);
    elements['sharing-banner'].hidden = !tabState.sharing.active;
    elements['sharing-label'].textContent = tabState.sharing.label;
    elements['blur-page'].hidden = !tabState.sharing.active || tabId === null;
  }

  /**
   * Summary: reloads settings and the tab's state from the service worker, then redraws.
   */
  async function refresh() {
    const [nextSettings, nextTabState] = await Promise.all([
      Settings.load(),
      chrome.runtime.sendMessage({ type: 'getTabState', tabId }),
    ]);
    settings = nextSettings;
    tabState = nextTabState;
    render();
  }

  elements.power.addEventListener('click', async () => {
    await Settings.save({ ...settings, enabled: !settings.enabled });
    await refresh();
  });

  elements.pause.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'setPaused', tabId, paused: !tabState.paused });
    await refresh();
  });

  elements['blur-page'].addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'blurPage', tabId });
  });

  elements.settings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  findTabId().then((id) => {
    tabId = id;
    refresh();
    Settings.onChange(refresh);
    setInterval(refresh, REFRESH_INTERVAL_MS);
  });
})();
