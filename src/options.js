// Settings page: every control saves right away, and every open tab picks the change up.
(function () {
  'use strict';

  const Settings = globalThis.PrivacyGuardSettings;
  const { normalizeSiteEntry } = globalThis.InkoutSites;
  const { createCustomPattern } = globalThis.PiiDetectors;
  // A pattern slower than this on awkward text could freeze pages; one that never finishes is
  // stopped after the longer limit.
  const SLOW_PATTERN_MS = 50;
  const PATTERN_CHECK_TIMEOUT_MS = 1000;
  const SHORTCUTS_PAGE = 'chrome://extensions/shortcuts';
  const MESSAGES = {
    invalidPattern: "This isn't a valid pattern",
    slowPattern: 'This pattern is too slow to use',
    invalidSavedPatterns: 'Some of your words are not valid patterns. Remove them first.',
    invalidSite: 'Enter a site like example.com',
  };

  const byId = (id) => document.getElementById(id);
  let settings = Settings.DEFAULTS;

  /**
   * Summary: saves a change to the settings and redraws the page.
   * Parameters: patch — the settings to change, e.g. { style: 'bar' }.
   * Usage: save({ hideTitles: false }) when the tab-titles box is unticked.
   */
  async function save(patch) {
    settings = { ...settings, ...patch };
    render();
    await Settings.save(settings);
  }

  /**
   * Summary: checks a pattern in a worker, so a pattern that never finishes can't freeze this page.
   * Parameters: source — the pattern's text; ignoreCase — the "ignore case" setting.
   * Returns: Promise of true when the pattern stays fast on awkward text.
   */
  function isFastPattern(source, ignoreCase) {
    return new Promise((resolve) => {
      const worker = new Worker('pattern-check.js');
      const finish = (fast) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(fast);
      };
      const timer = setTimeout(() => finish(false), PATTERN_CHECK_TIMEOUT_MS);
      worker.onmessage = (event) => finish(event.data.slowestMs <= SLOW_PATTERN_MS);
      worker.onerror = () => finish(false);
      worker.postMessage({ source, flags: ignoreCase ? 'giu' : 'gu' });
    });
  }

  /**
   * Summary: why a custom pattern can't be used, if it can't.
   * Parameters: source — the pattern's text.
   * Returns: Promise of an error message, or '' when it is fine.
   */
  async function patternProblem(source) {
    const options = { ignoreCase: settings.customWordsIgnoreCase, asPatterns: true };
    if (!createCustomPattern([source], options)) return MESSAGES.invalidPattern;
    return (await isFastPattern(source, settings.customWordsIgnoreCase)) ? '' : MESSAGES.slowPattern;
  }

  /**
   * Summary: draws a removable list of entries (custom words or sites).
   * Parameters: list — the <ul>; entries — strings; onRemove — called with the entry to remove.
   */
  function renderList(list, entries, onRemove) {
    list.replaceChildren(
      ...entries.map((entry) => {
        const item = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = entry;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.setAttribute('aria-label', `Remove ${entry}`);
        remove.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
        remove.addEventListener('click', () => onRemove(entry));
        item.append(label, remove);
        return item;
      })
    );
  }

  /**
   * Summary: shows every setting in its control, and the examples in the current style.
   */
  function render() {
    byId('master').checked = settings.enabled;
    byId('master-label').textContent = settings.enabled ? 'Protection on' : 'Protection off';
    byId('master').closest('.master').classList.toggle('off', !settings.enabled);
    for (const box of document.querySelectorAll('input[data-type]')) {
      box.checked = settings.types[box.dataset.type];
    }
    for (const example of document.querySelectorAll('[data-example]')) {
      example.classList.toggle('masked', settings.enabled && settings.types[example.dataset.example]);
    }
    document.documentElement.dataset.style = settings.style;
    document.documentElement.dataset.strength = settings.blurStrength;

    byId('custom-ignore-case').checked = settings.customWordsIgnoreCase;
    byId('custom-as-patterns').checked = settings.customWordsAsPatterns;
    renderList(byId('custom-list'), settings.customWords, (word) =>
      save({ customWords: settings.customWords.filter((each) => each !== word) })
    );

    document.querySelector(`input[name="scope"][value="${settings.siteMode}"]`).checked = true;
    byId('chosen-section').hidden = settings.siteMode !== 'chosen';
    renderList(byId('chosen-list'), settings.chosenSites, (site) =>
      save({ chosenSites: settings.chosenSites.filter((each) => each !== site) })
    );
    renderList(byId('never-list'), settings.neverHideSites, (site) =>
      save({ neverHideSites: settings.neverHideSites.filter((each) => each !== site) })
    );

    document.querySelector(`input[name="style"][value="${settings.style}"]`).checked = true;
    document.querySelector(`input[name="strength"][value="${settings.blurStrength}"]`).checked = true;
    byId('hide-titles').checked = settings.hideTitles;
    byId('auto-on').checked = settings.autoOnWhenSharing;
    byId('auto-off').checked = settings.autoOffWhenSharingEnds;
  }

  /**
   * Summary: wires a site form: cleans up what was typed and adds it to one of the site lists.
   * Parameters: formId; inputId; errorId; listKey — 'neverHideSites' or 'chosenSites'.
   */
  function wireSiteForm(formId, inputId, errorId, listKey) {
    byId(formId).addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = byId(inputId);
      const site = normalizeSiteEntry(input.value);
      byId(errorId).textContent = site ? '' : MESSAGES.invalidSite;
      if (!site) return;
      input.value = '';
      if (!settings[listKey].includes(site)) await save({ [listKey]: [...settings[listKey], site] });
    });
  }

  byId('master').addEventListener('change', (event) => save({ enabled: event.target.checked }));

  for (const box of document.querySelectorAll('input[data-type]')) {
    box.addEventListener('change', () => save({ types: { ...settings.types, [box.dataset.type]: box.checked } }));
  }

  byId('custom-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = byId('custom-input');
    const word = input.value.trim();
    if (!word) return;
    byId('custom-error').textContent = '';
    const problem = settings.customWordsAsPatterns ? await patternProblem(word) : '';
    byId('custom-error').textContent = problem;
    if (problem) return;
    input.value = '';
    if (!settings.customWords.includes(word)) await save({ customWords: [...settings.customWords, word] });
  });

  byId('custom-ignore-case').addEventListener('change', (event) => save({ customWordsIgnoreCase: event.target.checked }));

  byId('custom-as-patterns').addEventListener('change', async (event) => {
    const box = event.target;
    if (box.checked) {
      // Words saved as plain text may not work as patterns; one bad pattern would switch them all off.
      const problems = await Promise.all(settings.customWords.map(patternProblem));
      if (problems.some(Boolean)) {
        box.checked = false;
        byId('custom-error').textContent = MESSAGES.invalidSavedPatterns;
        return;
      }
    }
    byId('custom-error').textContent = '';
    await save({ customWordsAsPatterns: box.checked });
  });

  for (const radio of document.querySelectorAll('input[name="scope"]')) {
    radio.addEventListener('change', () => save({ siteMode: radio.value }));
  }
  wireSiteForm('chosen-form', 'chosen-input', 'chosen-error', 'chosenSites');
  wireSiteForm('site-form', 'site-input', 'site-error', 'neverHideSites');

  for (const radio of document.querySelectorAll('input[name="style"]')) {
    radio.addEventListener('change', () => save({ style: radio.value }));
  }
  for (const radio of document.querySelectorAll('input[name="strength"]')) {
    radio.addEventListener('change', () => save({ blurStrength: radio.value }));
  }
  byId('hide-titles').addEventListener('change', (event) => save({ hideTitles: event.target.checked }));
  byId('auto-on').addEventListener('change', (event) => save({ autoOnWhenSharing: event.target.checked }));
  byId('auto-off').addEventListener('change', (event) => save({ autoOffWhenSharingEnds: event.target.checked }));

  byId('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: SHORTCUTS_PAGE }));

  // Show the shortcuts as the user has set them in Chrome.
  chrome.commands.getAll().then((commands) => {
    for (const command of commands) {
      const key = byId(`key-${command.name}`);
      if (key) key.textContent = command.shortcut || 'Not set';
    }
  });

  Settings.load().then((loaded) => {
    settings = loaded;
    render();
  });
  Settings.onChange((changed) => {
    settings = changed;
    render();
  });
})();
