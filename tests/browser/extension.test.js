// End-to-end tests: the real extension loaded into headless Chrome, checked on real pages.
// Needs Chrome installed (or CHROME_PATH). Skipped locally without it; required on CI.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findChrome, launchChrome } = require('./chrome.js');
const { startServer, Tab, countRedPixels, samePixels } = require('./harness.js');

const EXTENSION_DIR = path.resolve(__dirname, '../..');
const FIXTURES = path.join(__dirname, 'fixtures');
const EXTENSION_NAME = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8')).name;
const DEFAULT_SETTINGS = { enabled: true, types: { email: true, phone: true, card: true } };
const PRUNE_WAIT_MS = 2500;
const INSTALL_SETTLE_MS = 500;
const FRAME_LOAD_WAIT_MS = 800;
const BULK_ROWS = 5000;
const BULK_BUDGET_MS = 2000;

const chromePath = findChrome();
const skipReason = !chromePath && !process.env.CI ? 'Chrome is not installed (set CHROME_PATH to run these tests)' : false;

describe('extension in a real browser', { skip: skipReason }, () => {
  let chrome;
  let server;
  let extensionId;
  let tab;
  let page; // an extension page, to talk to the service worker like the popup does
  let welcomeTargetsAtInstall = []; // page URLs open just after the extension was installed

  before(async () => {
    assert.ok(chromePath, 'Chrome is required on CI');
    chrome = await launchChrome(chromePath);
    ({ id: extensionId } = await chrome.send('Extensions.loadUnpacked', { path: EXTENSION_DIR }));
    await new Promise((resolve) => setTimeout(resolve, INSTALL_SETTLE_MS));
    const { targetInfos } = await chrome.send('Target.getTargets');
    welcomeTargetsAtInstall = targetInfos.filter((info) => info.type === 'page').map((info) => info.url);
    // Close the welcome tab so it doesn't get in the way of the other tests.
    for (const info of targetInfos) {
      if (info.url.endsWith('/src/welcome.html')) await chrome.send('Target.closeTarget', { targetId: info.targetId });
    }
    server = await startServer(FIXTURES);
    tab = await Tab.open(chrome, EXTENSION_NAME);
    page = await Tab.open(chrome, EXTENSION_NAME);
    await page.goto(`chrome-extension://${extensionId}/src/popup.html`);
  });

  after(async () => {
    await page?.close();
    await tab?.close();
    await chrome?.close();
    await server?.close();
  });

  // Chrome runs timers in background tabs about once a second, which delays their count reports.
  const COUNT_REPORT_WAIT_MS = 1500;

  /**
   * Summary: ids of every open tab, read from an extension page.
   * Returns: Promise of tab ids. (Tab URLs are hidden without the "tabs" permission.)
   */
  function tabIds() {
    return page.evaluate(`chrome.tabs.query({}).then((tabs) => tabs.map((each) => each.id))`);
  }

  /**
   * Summary: opens a new tab on a page and learns its Chrome tab id by comparing the tab list.
   * Parameters: url — page to open.
   * Returns: Promise of { tab, id }.
   */
  async function openTrackedTab(url) {
    const before = await tabIds();
    const opened = await Tab.open(chrome, EXTENSION_NAME);
    const id = (await tabIds()).find((each) => !before.includes(each));
    await opened.goto(url);
    await opened.settle(COUNT_REPORT_WAIT_MS);
    return { tab: opened, id };
  }

  /**
   * Summary: sends a runtime message from the extension page and returns the reply.
   * Parameters: message — e.g. { type: 'getTabState', tabId }.
   */
  function sendMessage(message) {
    return page.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(message)})`);
  }

  /**
   * Summary: the badge text Chrome shows for a tab.
   * Parameters: tabId.
   */
  function badgeText(tabId) {
    return page.evaluate(`chrome.action.getBadgeText({ tabId: ${tabId} })`);
  }

  /**
   * Summary: stops the extension's service worker the way Chrome does when it is idle.
   * Returns: Promise that resolves once Chrome reports it stopped.
   */
  async function stopServiceWorker() {
    const versions = new Map();
    const stopListening = chrome.onEvent((message) => {
      if (message.method !== 'ServiceWorker.workerVersionUpdated') return;
      for (const version of message.params.versions) versions.set(version.versionId, version);
    });
    await chrome.send('ServiceWorker.enable', {}, page.sessionId);
    await page.settle(300);
    const running = [...versions.values()].find(
      (version) => version.scriptURL.endsWith('/src/background.js') && version.runningStatus === 'running'
    );
    assert.ok(running, 'the service worker should be running before it is stopped');
    const stopped = chrome.waitFor('ServiceWorker.workerVersionUpdated', (message) =>
      message.params.versions.some(
        (version) => version.versionId === running.versionId && version.runningStatus === 'stopped'
      )
    );
    await chrome.send('ServiceWorker.stopWorker', { versionId: running.versionId }, page.sessionId);
    await stopped;
    stopListening();
    await chrome.send('ServiceWorker.disable', {}, page.sessionId);
  }

  /**
   * Summary: saves settings from a page's content-script world, then waits for every tab to apply them.
   * Parameters: settings — complete settings object; onTab — tab whose content script does the save.
   */
  async function setSettings(settings, onTab = tab) {
    await onTab.evaluate(`PrivacyGuardSettings.save(${JSON.stringify(settings)})`, { world: 'isolated' });
    await onTab.settle(200);
  }

  /**
   * Summary: opens a fixture page with default settings.
   * Parameters: name — fixture file name, plus any query string.
   */
  async function openFixture(name) {
    await tab.goto(`${server.origin}/${name}`);
    await setSettings(DEFAULT_SETTINGS);
  }

  /**
   * Summary: page rectangle of the first occurrence of some text inside an element (or the element itself).
   * Parameters: selector — CSS selector; text — substring to locate, or null for the whole element;
   *   frameId — default main frame; onTab — default the shared test tab.
   * Returns: Promise of { x, y, width, height }.
   */
  function rectOf(selector, text = null, frameId = undefined, onTab = tab) {
    return onTab.evaluate(
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        const toPage = (box) => ({ x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height });
        if (${JSON.stringify(text)} === null) return toPage(element.getBoundingClientRect());
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const at = walker.currentNode.data.indexOf(${JSON.stringify(text)});
          if (at === -1) continue;
          const range = new Range();
          range.setStart(walker.currentNode, at);
          range.setEnd(walker.currentNode, at + ${JSON.stringify(text)}.length);
          return toPage(range.getBoundingClientRect());
        }
        throw new Error('text not found');
      })()`,
      { frameId }
    );
  }

  /**
   * Summary: how many original (red) glyph pixels are visible over some text.
   * Parameters: selector, text, onTab — as for rectOf.
   */
  async function redPixelsOver(selector, text = null, onTab = tab) {
    return countRedPixels(await onTab.screenshot(await rectOf(selector, text, undefined, onTab)));
  }

  describe('a page as it loads', () => {
    before(() => openFixture('basic.html'));

    test('hides exactly the sensitive values, nothing else', async () => {
      assert.deepEqual(await tab.hiddenText(), {
        email: ['ops@acme.io', 'priya.sharma@example.com', 'support@acme.io', 'svg@example.com'],
        phone: ['(555) 123-4567', '+1 555 123 4567', '+91 98765 43210'],
        card: ['4111 1111 1111 1111'],
      });
    });

    test("leaves the page's structure exactly as the site built it", async () => {
      const differences = await tab.evaluate(`(async () => {
        const source = await (await fetch(location.href)).text();
        const original = new DOMParser().parseFromString(source, 'text/html').body.innerHTML;
        const live = document.body.innerHTML.replace(/ data-privacy-guard-[a-z-]+(="[^"]*")?/g, '');
        return live === original ? null : { live, original };
      })()`);
      assert.equal(differences, null);
    });

    test('the original characters are not drawn on screen', async () => {
      assert.equal(await redPixelsOver('#contact', 'priya.sharma@example.com'), 0);
      assert.equal(await redPixelsOver('#contact', '+91 98765 43210'), 0);
      assert.equal(await redPixelsOver('#card', '4111 1111 1111 1111'), 0);
      assert.equal(await redPixelsOver('#inline b'), 0);
      assert.equal(await redPixelsOver('#inline a'), 0);
      assert.equal(await redPixelsOver('#editable', 'ops@acme.io'), 0);
    });

    test('text in SVG drawings is hidden too, including nested tspans', async () => {
      assert.equal(await redPixelsOver('#svg-text'), 0);
      assert.equal(await redPixelsOver('#svg-tspan'), 0);
    });

    test('ordinary text stays visible (the pixel check can see red)', async () => {
      assert.ok((await redPixelsOver('#contact', 'Priya Sharma')) > 50);
      assert.ok((await redPixelsOver('#plain')) > 50);
    });

    test('text fields holding sensitive values are hidden as a whole', async () => {
      assert.equal(await redPixelsOver('#email-field'), 0);
      assert.equal(await redPixelsOver('#number-field'), 0);
      assert.ok((await redPixelsOver('#name-field')) > 20);
    });

    test('text inside a script element is ignored', async () => {
      const hidden = await tab.hiddenText();
      assert.equal(hidden.email.includes('hidden@script.example'), false);
    });
  });

  describe('typing and page changes', () => {
    before(() => openFixture('basic.html'));

    test('typing a phone number into a text area hides the field', async () => {
      await tab.evaluate(`(() => {
        const notes = document.getElementById('notes');
        notes.focus();
        notes.setSelectionRange(notes.value.length, notes.value.length);
      })()`);
      await tab.type(' call 9876543210');
      assert.equal(await redPixelsOver('#notes'), 0);
    });

    test('clearing the text area shows it again', async () => {
      await tab.evaluate(`(() => {
        const notes = document.getElementById('notes');
        notes.value = 'all clear';
        notes.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await tab.settle();
      assert.ok((await redPixelsOver('#notes')) > 20);
    });

    test('a value filled in by a script, with no typing event, is hidden', async () => {
      await tab.evaluate(`document.getElementById('name-field').value = 'kunal.k@example.com'`);
      await tab.settle();
      assert.equal(await redPixelsOver('#name-field'), 0);
    });

    test('a value set later through the value attribute is hidden', async () => {
      await tab.evaluate(`(() => {
        const field = document.createElement('input');
        field.id = 'late-field';
        field.style.cssText = 'font: inherit; color: #ff0000';
        document.body.append(field);
      })()`);
      await tab.settle();
      await tab.evaluate(`document.getElementById('late-field').setAttribute('value', '+44 20 7946 0958')`);
      await tab.settle();
      assert.equal(await redPixelsOver('#late-field'), 0);
    });

    test("a text area's text replaced by a script is hidden", async () => {
      await tab.evaluate(`(() => {
        const area = document.createElement('textarea');
        area.id = 'late-area';
        area.style.cssText = 'font: inherit; color: #ff0000';
        document.body.append(area);
      })()`);
      await tab.settle();
      await tab.evaluate(`document.getElementById('late-area').textContent = 'reach me at area@example.com'`);
      await tab.settle();
      assert.equal(await redPixelsOver('#late-area'), 0);
    });

    test('typing an email into an editable area hides it', async () => {
      await tab.evaluate(`(() => {
        const editable = document.getElementById('editable');
        editable.focus();
        getSelection().selectAllChildren(editable);
        getSelection().collapseToEnd();
      })()`);
      await tab.type(' and new@acme.io');
      // The typing caret is drawn in the text colour; move focus away so only the text is measured.
      await tab.evaluate(`document.activeElement.blur()`);
      await tab.settle();
      assert.ok((await tab.hiddenText()).email.includes('new@acme.io'));
      assert.equal(await redPixelsOver('#editable', 'new@acme.io'), 0);
    });
  });

  describe('content added, changed and removed by the page', () => {
    before(() => openFixture('blank.html'));

    test('content inserted later is hidden before it can be seen', async () => {
      await tab.evaluate(`document.getElementById('root').innerHTML = '<p id="later">Added: later@example.com</p>'`);
      await tab.settle();
      assert.deepEqual((await tab.hiddenText()).email, ['later@example.com']);
      assert.equal(await redPixelsOver('#later', 'later@example.com'), 0);
    });

    test('text changed in place is rechecked', async () => {
      await tab.evaluate(`document.getElementById('later').firstChild.data = 'Now: changed@example.com'`);
      await tab.settle();
      assert.deepEqual((await tab.hiddenText()).email, ['changed@example.com']);
    });

    test('removed content is forgotten (no memory left behind)', async () => {
      await tab.evaluate(`document.getElementById('later').remove()`);
      await tab.settle(PRUNE_WAIT_MS);
      const sizes = await tab.evaluate(`CSS.highlights.get('privacy-guard-email').size`, { world: 'isolated' });
      assert.equal(sizes, 0);
    });

    test(`${BULK_ROWS} rows with an email and a phone each are hidden quickly`, async (t) => {
      const elapsed = await tab.evaluate(`(async () => {
        const rows = Array.from({ length: ${BULK_ROWS} }, (_, i) =>
          '<p>Row ' + i + ': user' + i + '@example.com, +1 555 010 ' + String(i).padStart(4, '0') + '</p>').join('');
        const started = performance.now();
        document.getElementById('root').innerHTML = rows;
        await new Promise((resolve) => setTimeout(resolve, 0));
        return performance.now() - started;
      })()`);
      t.diagnostic(`insert and hide took ${elapsed.toFixed(0)} ms`);
      const hidden = await tab.hiddenText();
      assert.equal(hidden.email.length, BULK_ROWS);
      assert.equal(hidden.phone.length, BULK_ROWS);
      assert.ok(elapsed < BULK_BUDGET_MS, `took ${elapsed.toFixed(0)} ms`);
    });
  });

  describe('settings', () => {
    before(() => openFixture('basic.html'));
    after(() => setSettings(DEFAULT_SETTINGS));

    test('turning protection off shows everything', async () => {
      await setSettings({ ...DEFAULT_SETTINGS, enabled: false });
      assert.deepEqual(await tab.hiddenText(), {});
      assert.ok((await redPixelsOver('#contact', 'priya.sharma@example.com')) > 50);
      assert.ok((await redPixelsOver('#email-field')) > 20);
    });

    test('turning it back on hides everything again', async () => {
      await setSettings(DEFAULT_SETTINGS);
      assert.equal(await redPixelsOver('#contact', 'priya.sharma@example.com'), 0);
      assert.equal(await redPixelsOver('#email-field'), 0);
    });

    test('switching off one type shows only that type', async () => {
      await setSettings({ ...DEFAULT_SETTINGS, types: { email: false, phone: true, card: true } });
      const hidden = await tab.hiddenText();
      assert.deepEqual(Object.keys(hidden).sort(), ['card', 'phone']);
      assert.ok((await redPixelsOver('#contact', 'priya.sharma@example.com')) > 50);
      assert.equal(await redPixelsOver('#contact', '+91 98765 43210'), 0);
      assert.ok((await redPixelsOver('#email-field')) > 20);
    });
  });

  describe('all types and hide styles', () => {
    const TOKEN = 'ghp' + '_' + 'A'.repeat(36);
    const WITH_CUSTOM_WORDS = { ...DEFAULT_SETTINGS, customWords: ['Project Falcon'] };

    before(async () => {
      await tab.goto(`${server.origin}/types.html`);
      await setSettings(WITH_CUSTOM_WORDS);
    });
    after(() => setSettings(DEFAULT_SETTINGS));

    /**
     * Summary: screenshot of the email on the types fixture, for comparing hide styles.
     * Returns: Promise of a PNG buffer.
     */
    async function emailPixels() {
      await tab.settle();
      return tab.screenshot(await rectOf('#email', 'priya.sharma@example.com'));
    }

    test('API keys, bank account numbers and custom words are hidden; IP addresses are not by default', async () => {
      assert.deepEqual(await tab.hiddenText(), {
        apiKey: [TOKEN],
        iban: ['DE89 3704 0044 0532 0130 00'],
        custom: ['Project Falcon'],
        email: ['priya.sharma@example.com'],
      });
      assert.equal(await redPixelsOver('#key', TOKEN), 0);
      assert.equal(await redPixelsOver('#iban', 'DE89 3704 0044 0532 0130 00'), 0);
      assert.equal(await redPixelsOver('#custom', 'Project Falcon'), 0);
      assert.ok((await redPixelsOver('#ip', '192.168.1.24')) > 50);
      assert.equal(await tab.evaluate(`document.querySelector('#iban-field').hasAttribute('data-privacy-guard-masked')`), true);
    });

    test('IP addresses are hidden once switched on', async () => {
      await setSettings({ ...WITH_CUSTOM_WORDS, types: { ...DEFAULT_SETTINGS.types, ip: true } });
      assert.deepEqual((await tab.hiddenText()).ip, ['192.168.1.24']);
      assert.equal(await redPixelsOver('#ip', '192.168.1.24'), 0);
      await setSettings(WITH_CUSTOM_WORDS);
    });

    test('removing a custom word shows it again without a reload', async () => {
      await setSettings(DEFAULT_SETTINGS);
      assert.equal((await tab.hiddenText()).custom, undefined);
      assert.ok((await redPixelsOver('#custom', 'Project Falcon')) > 50);
      await setSettings(WITH_CUSTOM_WORDS);
    });

    test('the solid bar style hides with a bar instead of a blur', async () => {
      const blurred = await emailPixels();
      await setSettings({ ...WITH_CUSTOM_WORDS, style: 'bar' });
      assert.equal(await tab.evaluate(`document.documentElement.dataset.privacyGuardStyle`), 'bar');
      assert.equal(await redPixelsOver('#email', 'priya.sharma@example.com'), 0);
      assert.equal(await redPixelsOver('#iban-field'), 0);
      assert.equal(samePixels(blurred, await emailPixels()), false);
      await setSettings(WITH_CUSTOM_WORDS);
    });

    test('light and strong blur look different, and both hide the text', async () => {
      await setSettings({ ...WITH_CUSTOM_WORDS, blurStrength: 'light' });
      const light = await emailPixels();
      assert.equal(await redPixelsOver('#email', 'priya.sharma@example.com'), 0);
      await setSettings({ ...WITH_CUSTOM_WORDS, blurStrength: 'strong' });
      const strong = await emailPixels();
      assert.equal(await redPixelsOver('#email', 'priya.sharma@example.com'), 0);
      assert.equal(samePixels(light, strong), false);
      await setSettings(WITH_CUSTOM_WORDS);
    });
  });

  describe('selecting hidden text', () => {
    before(() => openFixture('basic.html'));
    after(() => setSettings(DEFAULT_SETTINGS));

    test('selected hidden text stays hidden', async () => {
      await tab.evaluate(`getSelection().selectAllChildren(document.body)`);
      await tab.settle();
      assert.equal(await redPixelsOver('#contact', 'priya.sharma@example.com'), 0);
      assert.equal(await redPixelsOver('#card', '4111 1111 1111 1111'), 0);
      assert.equal(await redPixelsOver('#inline b'), 0);
    });

    test('selected text inside a hidden field stays hidden', async () => {
      await tab.evaluate(`document.getElementById('email-field').select()`);
      await tab.settle();
      assert.equal(await redPixelsOver('#email-field'), 0);
    });

    test('a type that is switched off shows normally when selected', async () => {
      await tab.evaluate(`getSelection().selectAllChildren(document.getElementById('inline'))`);
      await setSettings({ ...DEFAULT_SETTINGS, types: { email: false, phone: true, card: true } });
      const emailShown = await tab.screenshot(await rectOf('#inline b'));
      const phoneHidden = await tab.screenshot(await rectOf('#inline a'));
      await setSettings(DEFAULT_SETTINGS);
      // Selected text is drawn in the selection colours, so compare the email with itself hidden.
      assert.equal(samePixels(emailShown, await tab.screenshot(await rectOf('#inline b'))), false);
      assert.equal(samePixels(phoneHidden, await tab.screenshot(await rectOf('#inline a'))), true);
    });
  });

  describe('frames', () => {
    test('hides text in the page, same-site, blank and cross-site frames', async () => {
      await tab.goto(`${server.origin}/frames.html?cross=${encodeURIComponent(`${server.crossSiteOrigin}/frame-child.html`)}`);
      await setSettings(DEFAULT_SETTINGS);
      await tab.settle(FRAME_LOAD_WAIT_MS);
      const byFrame = {};
      for (const frameId of await tab.frameIds()) {
        const where = await tab.evaluate(
          `location.protocol === 'about:' ? location.href : location.origin + location.pathname`,
          { frameId }
        );
        byFrame[where.replace(server.origin, 'same-site').replace(server.crossSiteOrigin, 'cross-site')] = (
          await tab.hiddenText(frameId)
        ).email;
      }
      assert.deepEqual(byFrame, {
        'same-site/frames.html': ['top@example.com'],
        'same-site/frame-child.html': ['child@example.com'],
        'about:blank': ['blank@example.com'],
        'cross-site/frame-child.html': ['child@example.com'],
      });
    });
  });

  describe('site rules', () => {
    const siteHost = () => new URL(server.origin).host;
    after(() => setSettings(DEFAULT_SETTINGS));

    test('nothing is hidden on a never-hide site', async () => {
      await openFixture('basic.html');
      await setSettings({ ...DEFAULT_SETTINGS, neverHideSites: [siteHost()] });
      assert.deepEqual(await tab.hiddenText(), {});
      assert.ok((await redPixelsOver('#contact', 'priya.sharma@example.com')) > 50);
      assert.equal(await tab.evaluate(`document.querySelector('[data-privacy-guard-masked]')`), null);
    });

    test('content added while on a never-hide site is left alone, then hidden once the rule goes', async () => {
      await tab.evaluate(`document.body.insertAdjacentHTML('beforeend', '<p id="late">late@example.com</p>')`);
      await tab.settle();
      assert.deepEqual(await tab.hiddenText(), {});
      await setSettings(DEFAULT_SETTINGS);
      assert.deepEqual((await tab.hiddenText()).email, [
        'late@example.com',
        'ops@acme.io',
        'priya.sharma@example.com',
        'support@acme.io',
        'svg@example.com',
      ]);
      assert.equal(await redPixelsOver('#contact', 'priya.sharma@example.com'), 0);
      assert.equal(await redPixelsOver('#email-field'), 0);
    });

    test('only chosen sites are hidden in "only on sites I choose" mode', async () => {
      await setSettings({ ...DEFAULT_SETTINGS, siteMode: 'chosen', chosenSites: [] });
      assert.deepEqual(await tab.hiddenText(), {});
      await setSettings({ ...DEFAULT_SETTINGS, siteMode: 'chosen', chosenSites: [siteHost()] });
      assert.ok((await tab.hiddenText()).email.length > 0);
    });

    test("frames follow the rule for the tab's site, even cross-site ones", async () => {
      await tab.goto(`${server.origin}/frames.html?cross=${encodeURIComponent(`${server.crossSiteOrigin}/frame-child.html`)}`);
      await setSettings({ ...DEFAULT_SETTINGS, neverHideSites: [siteHost()] });
      await tab.settle(FRAME_LOAD_WAIT_MS);
      const frameIds = await tab.frameIds();
      assert.equal(frameIds.length, 4);
      for (const frameId of frameIds) assert.deepEqual(await tab.hiddenText(frameId), {});
    });
  });

  describe('tab titles', () => {
    const TITLE_SAMPLES = 20;
    const TITLE_SAMPLE_GAP_MS = 50;
    after(() => setSettings(DEFAULT_SETTINGS));

    test('sensitive values in the title are replaced by dots', async () => {
      await openFixture('title.html');
      assert.equal(await tab.evaluate('document.title'), 'Inbox - ••••• - Mail');
    });

    test('the real title comes back when title hiding or protection is switched off', async () => {
      await setSettings({ ...DEFAULT_SETTINGS, hideTitles: false });
      assert.equal(await tab.evaluate('document.title'), 'Inbox - priya.sharma@example.com - Mail');
      await setSettings(DEFAULT_SETTINGS);
      assert.equal(await tab.evaluate('document.title'), 'Inbox - ••••• - Mail');
      await setSettings({ ...DEFAULT_SETTINGS, enabled: false });
      assert.equal(await tab.evaluate('document.title'), 'Inbox - priya.sharma@example.com - Mail');
    });

    test('a page that keeps rewriting its title never shows the value, in the page or in Chrome', async () => {
      await chrome.send('Target.setDiscoverTargets', { discover: true });
      const browserTitles = [];
      const stopListening = chrome.onEvent((message) => {
        const info = message.params?.targetInfo;
        if (message.method === 'Target.targetInfoChanged' && info.targetId === tab.targetId) browserTitles.push(info.title);
      });
      await openFixture('title.html?tick=1');
      const pageTitles = [];
      for (let sample = 0; sample < TITLE_SAMPLES; sample++) {
        pageTitles.push(await tab.evaluate('document.title'));
        await tab.settle(TITLE_SAMPLE_GAP_MS);
      }
      stopListening();
      await chrome.send('Target.setDiscoverTargets', { discover: false });
      assert.ok(new Set(pageTitles).size > 5, 'the page should have changed its title while sampling');
      assert.deepEqual(pageTitles.filter((title) => title.includes('@')), []);
      assert.ok(browserTitles.length > 0);
      assert.deepEqual(browserTitles.filter((title) => title.includes('@')), []);
    });
  });

  describe('web components', () => {
    before(async () => {
      await openFixture('shadow.html');
      await tab.settle(200);
    });
    after(() => setSettings(DEFAULT_SETTINGS));

    /**
     * Summary: page rectangle of text (or an element) inside a component's shadow root.
     * Parameters: rootExpression — page code returning the shadow root; selector; text — or null for the element.
     */
    function shadowRect(rootExpression, selector, text = null) {
      return tab.evaluate(`(() => {
        const element = (${rootExpression}).querySelector(${JSON.stringify(selector)});
        const toPage = (box) => ({ x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height });
        if (${JSON.stringify(text)} === null) return toPage(element.getBoundingClientRect());
        const node = element.firstChild;
        const at = node.data.indexOf(${JSON.stringify(text)});
        const range = new Range();
        range.setStart(node, at);
        range.setEnd(node, at + ${JSON.stringify(text)}.length);
        return toPage(range.getBoundingClientRect());
      })()`);
    }

    /** Summary: red glyph pixels over text inside a shadow root (see shadowRect). */
    async function redPixelsInShadow(rootExpression, selector, text) {
      return countRedPixels(await tab.screenshot(await shadowRect(rootExpression, selector, text)));
    }

    test('text inside open, closed and later-defined components is hidden', async () => {
      assert.deepEqual((await tab.hiddenText()).email, ['closed@example.com', 'late@example.com', 'shadow@example.com']);
      assert.equal(await redPixelsInShadow(`document.getElementById('open-card').shadowRoot`, '#inside', 'shadow@example.com'), 0);
      assert.equal(await redPixelsInShadow('window.closedRoot', '#inside', 'closed@example.com'), 0);
      assert.equal(await redPixelsInShadow(`document.getElementById('late-card').shadowRoot`, '#inside', 'late@example.com'), 0);
    });

    test('ordinary text inside a component stays visible', async () => {
      assert.ok((await redPixelsInShadow(`document.getElementById('open-card').shadowRoot`, '#inside', 'Shadow contact')) > 50);
    });

    test('selected text inside a component stays hidden', async () => {
      await tab.evaluate(`getSelection().selectAllChildren(document.body)`);
      await tab.settle();
      assert.equal(await redPixelsInShadow(`document.getElementById('open-card').shadowRoot`, '#inside', 'shadow@example.com'), 0);
      await tab.evaluate(`getSelection().removeAllRanges()`);
    });

    test('a field inside a component is hidden when typed into or filled by a script', async () => {
      const fieldRoot = `document.getElementById('form-card').shadowRoot`;
      assert.ok((await redPixelsInShadow(fieldRoot, '#shadow-field')) > 20);
      await tab.evaluate(`${fieldRoot}.getElementById('shadow-field').value = 'kunal@example.com'`);
      await tab.settle();
      assert.equal(await redPixelsInShadow(fieldRoot, '#shadow-field'), 0);
      await tab.evaluate(`(() => {
        const field = ${fieldRoot}.getElementById('shadow-field');
        field.value = '';
        field.focus();
      })()`);
      await tab.type('call +91 98765 43210');
      await tab.evaluate(`${fieldRoot}.getElementById('shadow-field').blur()`);
      await tab.settle();
      assert.equal(await redPixelsInShadow(fieldRoot, '#shadow-field'), 0);
    });

    test('switching protection off shows component text again', async () => {
      await setSettings({ ...DEFAULT_SETTINGS, enabled: false });
      assert.ok((await redPixelsInShadow(`document.getElementById('open-card').shadowRoot`, '#inside', 'shadow@example.com')) > 50);
      assert.ok((await redPixelsInShadow(`document.getElementById('form-card').shadowRoot`, '#shadow-field')) > 20);
    });
  });

  describe('per-tab counts and pause', () => {
    let first;
    let second;

    before(async () => {
      first = await openTrackedTab(`${server.origin}/basic.html`);
      await setSettings(DEFAULT_SETTINGS, first.tab);
      second = await openTrackedTab(`${server.origin}/basic.html`);
      await first.tab.settle(COUNT_REPORT_WAIT_MS);
    });
    after(async () => {
      await first?.tab.close();
      await second?.tab.close();
    });

    test('the tab reports how many values of each type it is hiding', async () => {
      const expectedEmails = await first.tab.evaluate(
        `CSS.highlights.get('privacy-guard-email').size +
          [...document.querySelectorAll('[data-privacy-guard-masked]')].filter((field) =>
            PiiDetectors.findMatches(field.value).some((match) => match.type === 'email')
          ).length`,
        { world: 'isolated' }
      );
      const state = await sendMessage({ type: 'getTabState', tabId: first.id });
      assert.ok(expectedEmails > 0);
      assert.equal(state.counts.email, expectedEmails);
      assert.equal(state.counts.card, 1);
      assert.equal(state.host, new URL(server.origin).host);
      assert.equal(state.paused, false);
      assert.deepEqual(state.sharing, { active: false, label: '' });
    });

    test('the count follows the page as content is added', async () => {
      const before = (await sendMessage({ type: 'getTabState', tabId: first.id })).counts.email;
      await first.tab.evaluate(`document.body.insertAdjacentHTML('beforeend', '<p>new@example.com</p>')`);
      await first.tab.settle(COUNT_REPORT_WAIT_MS);
      assert.equal((await sendMessage({ type: 'getTabState', tabId: first.id })).counts.email, before + 1);
    });

    test('pausing a tab shows everything there and badges that tab only', async () => {
      await sendMessage({ type: 'setPaused', tabId: first.id, paused: true });
      await first.tab.settle(300);
      assert.deepEqual(await first.tab.hiddenText(), {});
      assert.equal(await first.tab.evaluate(`document.querySelector('[data-privacy-guard-masked]')`), null);
      assert.equal(await badgeText(first.id), '❚❚');
      assert.equal(await page.evaluate(`chrome.action.getTitle({ tabId: ${first.id} })`), 'Inkout is paused on this tab');
      assert.equal((await sendMessage({ type: 'getTabState', tabId: first.id })).paused, true);
    });

    test('another tab on the same site stays protected', async () => {
      assert.ok((await second.tab.hiddenText()).email.length > 0);
      assert.equal(await badgeText(second.id), '');
    });

    test('the pause survives Chrome stopping the service worker', async () => {
      await stopServiceWorker();
      assert.equal((await sendMessage({ type: 'getTabState', tabId: first.id })).paused, true);
    });

    test('the pause survives a reload on the same site', async () => {
      await first.tab.goto(`${server.origin}/basic.html`);
      assert.deepEqual(await first.tab.hiddenText(), {});
    });

    test('a paused page brought back with the Back button, after leaving the site, is protected again', async () => {
      const BACK_RESTORE_WAIT_MS = 1500;
      await first.tab.evaluate(`addEventListener('pageshow', (event) => { window.restoredFromCache = event.persisted; })`);
      await first.tab.goto(`${server.crossSiteOrigin}/basic.html`);
      assert.equal((await sendMessage({ type: 'getTabState', tabId: first.id })).paused, false);
      const { currentIndex, entries } = await chrome.send('Page.getNavigationHistory', {}, first.tab.sessionId);
      await chrome.send('Page.navigateToHistoryEntry', { entryId: entries[currentIndex - 1].id }, first.tab.sessionId);
      await first.tab.settle(BACK_RESTORE_WAIT_MS);
      assert.equal(await first.tab.evaluate('window.restoredFromCache'), true, 'Chrome should restore the page from its back/forward cache');
      assert.ok((await first.tab.hiddenText()).email.length > 0);
      assert.equal(await badgeText(first.id), '');
      await sendMessage({ type: 'setPaused', tabId: first.id, paused: true });
      await first.tab.settle(300);
    });

    test('resuming hides again and clears the badge', async () => {
      await sendMessage({ type: 'setPaused', tabId: first.id, paused: false });
      await first.tab.settle(300);
      assert.ok((await first.tab.hiddenText()).email.length > 0);
      assert.equal(await badgeText(first.id), '');
    });

    test('moving the tab to a different site ends the pause', async () => {
      await sendMessage({ type: 'setPaused', tabId: first.id, paused: true });
      await first.tab.goto(`${server.crossSiteOrigin}/basic.html`);
      assert.ok((await first.tab.hiddenText()).email.length > 0);
      assert.equal(await badgeText(first.id), '');
      assert.equal((await sendMessage({ type: 'getTabState', tabId: first.id })).paused, false);
    });

    test('turning protection off badges every tab OFF, even a paused one', async () => {
      await sendMessage({ type: 'setPaused', tabId: second.id, paused: true });
      await setSettings({ ...DEFAULT_SETTINGS, enabled: false }, first.tab);
      assert.equal(await badgeText(first.id), 'OFF');
      assert.equal(await badgeText(second.id), 'OFF');
      await setSettings(DEFAULT_SETTINGS, first.tab);
      assert.equal(await badgeText(second.id), '❚❚');
      await sendMessage({ type: 'setPaused', tabId: second.id, paused: false });
    });

    test('a closed tab is forgotten', async () => {
      await second.tab.close();
      await page.settle(300);
      assert.deepEqual(await sendMessage({ type: 'getTabState', tabId: second.id }), {
        host: '',
        paused: false,
        counts: {},
        sharing: { active: false, label: '' },
      });
      second = null;
    });
  });

  describe('presenter mode', () => {
    let meeting;

    /**
     * Summary: whether protection is on, read straight from storage.
     * Returns: Promise of boolean.
     */
    function enabledNow() {
      return page.evaluate(
        `chrome.storage.sync.get('privacyGuardSettings').then((data) => data.privacyGuardSettings.enabled)`
      );
    }

    /**
     * Summary: starts sharing the meeting tab's screen, as a user click would, and waits for Inkout to react.
     * Parameters: onTab — the tab that shares.
     */
    async function startSharing(onTab = meeting.tab) {
      assert.equal(await onTab.evaluate('startSharing()', { userGesture: true }), 1);
      await onTab.settle(300);
    }

    /**
     * Summary: stops the share the way a meeting site's own Stop button does.
     */
    async function stopSharing() {
      await meeting.tab.evaluate('stopSharing()');
      await meeting.tab.settle(300);
    }

    const sharingNow = async () => (await sendMessage({ type: 'getTabState', tabId: meeting.id })).sharing;

    before(async () => {
      meeting = await openTrackedTab(`${server.origin}/meeting.html`);
    });
    after(async () => {
      await setSettings(DEFAULT_SETTINGS, meeting.tab);
      await meeting.tab.close();
    });

    test('starting to share turns protection on and the share shows in the tab state', async () => {
      await setSettings({ ...DEFAULT_SETTINGS, enabled: false }, meeting.tab);
      assert.deepEqual(await meeting.tab.hiddenText(), {});
      await startSharing();
      assert.equal(await enabledNow(), true);
      assert.deepEqual(await meeting.tab.hiddenText(), { email: ['priya.sharma@example.com'] });
      assert.deepEqual(await sharingNow(), { active: true, label: new URL(server.origin).host });
    });

    test('stopping the share ends it and keeps protection on by default', async () => {
      await stopSharing();
      assert.deepEqual(await sharingNow(), { active: false, label: '' });
      assert.equal(await enabledNow(), true);
    });

    test('with "turn off when sharing ends", stopping turns protection back off', async () => {
      await setSettings({ ...DEFAULT_SETTINGS, enabled: false, autoOffWhenSharingEnds: true }, meeting.tab);
      await startSharing();
      assert.equal(await enabledNow(), true);
      await stopSharing();
      assert.equal(await enabledNow(), false);
    });

    test('switching protection by hand during a share is never undone when the share ends', async () => {
      const autoOff = { ...DEFAULT_SETTINGS, autoOffWhenSharingEnds: true };
      await setSettings({ ...autoOff, enabled: false }, meeting.tab);
      await startSharing();
      await setSettings({ ...autoOff, enabled: false }, meeting.tab);
      await setSettings({ ...autoOff, enabled: true }, meeting.tab);
      await stopSharing();
      assert.equal(await enabledNow(), true);
    });

    test('starting to share ends every pause', async () => {
      await setSettings(DEFAULT_SETTINGS, meeting.tab);
      await sendMessage({ type: 'setPaused', tabId: meeting.id, paused: true });
      await meeting.tab.settle(300);
      assert.deepEqual(await meeting.tab.hiddenText(), {});
      await startSharing();
      assert.deepEqual(await meeting.tab.hiddenText(), { email: ['priya.sharma@example.com'] });
      assert.equal(await badgeText(meeting.id), '');
      assert.equal((await sendMessage({ type: 'getTabState', tabId: meeting.id })).paused, false);
      await stopSharing();
    });

    test('closing the tab that is sharing ends the share', async () => {
      const other = await openTrackedTab(`${server.origin}/meeting.html`);
      await startSharing(other.tab);
      assert.equal((await sendMessage({ type: 'getTabState', tabId: other.id })).sharing.active, true);
      await other.tab.close();
      await page.settle(300);
      assert.deepEqual(await sharingNow(), { active: false, label: '' });
    });
  });

  describe('blurring the whole page', () => {
    let blurred;
    before(async () => {
      blurred = await openTrackedTab(`${server.origin}/basic.html`);
      await setSettings(DEFAULT_SETTINGS, blurred.tab);
    });
    after(() => blurred.tab.close());

    test('blurs everything on the page, and a second press undoes it', async () => {
      assert.ok((await redPixelsOver('#plain', null, blurred.tab)) > 50);
      await sendMessage({ type: 'blurPage', tabId: blurred.id });
      await blurred.tab.settle(300);
      assert.equal(await redPixelsOver('#plain', null, blurred.tab), 0);
      await sendMessage({ type: 'blurPage', tabId: blurred.id });
      await blurred.tab.settle(300);
      assert.ok((await redPixelsOver('#plain', null, blurred.tab)) > 50);
    });

    test('works even while protection is off', async () => {
      await setSettings({ ...DEFAULT_SETTINGS, enabled: false }, blurred.tab);
      await sendMessage({ type: 'blurPage', tabId: blurred.id });
      await blurred.tab.settle(300);
      assert.equal(await redPixelsOver('#plain', null, blurred.tab), 0);
      await sendMessage({ type: 'blurPage', tabId: blurred.id });
      await setSettings(DEFAULT_SETTINGS, blurred.tab);
    });

    test('the page cannot remove the blur', async () => {
      await sendMessage({ type: 'blurPage', tabId: blurred.id });
      await blurred.tab.settle(300);
      await blurred.tab.evaluate(`document.documentElement.removeAttribute('data-privacy-guard-whole-page')`);
      await blurred.tab.settle(300);
      assert.equal(await redPixelsOver('#plain', null, blurred.tab), 0);
    });

    test('the blur ends when the tab moves to another page', async () => {
      await blurred.tab.goto(`${server.origin}/basic.html`);
      assert.ok((await redPixelsOver('#plain', null, blurred.tab)) > 50);
    });
  });

  describe('popup', () => {
    const POPUP_MAX_WIDTH = 360;
    const POPUP_MAX_HEIGHT = 600;
    let meeting;
    let popup;

    /**
     * Summary: what the popup shows right now, after it has had a moment to refresh.
     * Returns: Promise of { pressed, title, desc, host, siteLine, counts, pause, pauseShown, banner, blurShown }.
     */
    async function popupView() {
      // A real popup is always on screen; as a background tab its page would be throttled.
      await chrome.send('Page.bringToFront', {}, popup.sessionId);
      await popup.settle(400);
      return popup.evaluate(`(() => {
        const text = (id) => document.getElementById(id).textContent.replace(/\\s+/g, ' ').trim();
        const shown = (id) => !document.getElementById(id).hidden;
        return {
          pressed: document.getElementById('power').getAttribute('aria-pressed'),
          title: text('state-title'),
          desc: text('state-desc'),
          host: text('site-host'),
          siteLine: text('site-line'),
          counts: text('counts'),
          pause: text('pause'),
          pauseShown: shown('pause'),
          banner: shown('sharing-banner') ? text('sharing-banner') : null,
          blurShown: shown('blur-page'),
        };
      })()`);
    }

    /**
     * Summary: checks the popup fits Chrome's popup size limit without scrollbars.
     */
    async function assertFits() {
      // Opened as a tab here, so measure the popup's body rather than the whole window.
      const size = await popup.evaluate(
        `({ width: document.body.scrollWidth, height: Math.ceil(document.body.getBoundingClientRect().height) })`
      );
      assert.ok(size.width <= POPUP_MAX_WIDTH, `popup is ${size.width}px wide`);
      assert.ok(size.height <= POPUP_MAX_HEIGHT, `popup is ${size.height}px tall`);
    }

    /**
     * Summary: opens the popup for a given tab (the tabId parameter stands in for "the active tab").
     * Parameters: tabId.
     */
    async function openPopupFor(tabId) {
      await popup?.close();
      popup = await Tab.open(chrome, EXTENSION_NAME);
      await popup.goto(`chrome-extension://${extensionId}/src/popup.html?tabId=${tabId}`);
    }

    before(async () => {
      meeting = await openTrackedTab(`${server.origin}/meeting.html`);
      await setSettings(DEFAULT_SETTINGS, meeting.tab);
      await meeting.tab.settle(COUNT_REPORT_WAIT_MS);
      await openPopupFor(meeting.id);
    });
    after(async () => {
      await popup?.close();
      await setSettings(DEFAULT_SETTINGS, meeting.tab);
      await meeting.tab.close();
    });

    test('shows that protection is on, and what is hidden on the tab', async () => {
      assert.deepEqual(await popupView(), {
        pressed: 'true',
        title: 'Protection is on',
        desc: 'Emails, phone numbers and card numbers are blurred on every site.',
        host: new URL(server.origin).host,
        siteLine: '1 item hidden on this tab',
        counts: '1 email',
        pause: 'Pause on this site',
        pauseShown: true,
        banner: null,
        blurShown: false,
      });
      await assertFits();
    });

    test('the big button turns protection off everywhere and badges the icon', async () => {
      await popup.evaluate(`document.getElementById('power').click()`);
      await meeting.tab.settle(300);
      assert.deepEqual(await meeting.tab.hiddenText(), {});
      assert.ok((await redPixelsOver('#contact', 'priya.sharma@example.com', meeting.tab)) > 50);
      assert.equal(await badgeText(meeting.id), 'OFF');
      const view = await popupView();
      assert.equal(view.pressed, 'false');
      assert.equal(view.title, 'Protection is off');
      assert.equal(view.desc, 'Everything is visible to anyone watching your screen.');
      assert.equal(view.siteLine, 'Nothing hidden right now');
      await assertFits();
    });

    test('pressing it again turns protection back on', async () => {
      await popup.evaluate(`document.getElementById('power').click()`);
      await meeting.tab.settle(300);
      assert.deepEqual(await meeting.tab.hiddenText(), { email: ['priya.sharma@example.com'] });
      assert.equal(await badgeText(meeting.id), '');
      assert.equal((await popupView()).title, 'Protection is on');
    });

    test('pausing the site shows it plainly, and Resume undoes it', async () => {
      await popup.evaluate(`document.getElementById('pause').click()`);
      await meeting.tab.settle(300);
      assert.equal(await badgeText(meeting.id), '❚❚');
      let view = await popupView();
      assert.equal(view.title, 'Paused on this tab');
      assert.equal(view.desc, 'Nothing is hidden here until you resume or close the tab.');
      assert.equal(view.pause, 'Resume');
      await assertFits();
      await popup.evaluate(`document.getElementById('pause').click()`);
      await meeting.tab.settle(300);
      view = await popupView();
      assert.equal(view.title, 'Protection is on');
      assert.equal(await badgeText(meeting.id), '');
    });

    test('while sharing, a banner and a "Blur the whole page" button appear', async () => {
      assert.equal(await meeting.tab.evaluate('startSharing()', { userGesture: true }), 1);
      await meeting.tab.settle(300);
      const view = await popupView();
      assert.equal(view.banner, `You are sharing your screen ${new URL(server.origin).host}`);
      assert.equal(view.blurShown, true);
      await assertFits();
      await popup.evaluate(`document.getElementById('blur-page').click()`);
      await meeting.tab.settle(300);
      assert.equal(await meeting.tab.evaluate(`document.documentElement.hasAttribute('data-privacy-guard-whole-page')`), true);
      await popup.evaluate(`document.getElementById('blur-page').click()`);
      await meeting.tab.evaluate('stopSharing()');
      await meeting.tab.settle(300);
      assert.equal((await popupView()).banner, null);
    });

    test('on a page Inkout cannot run on, it says so and offers no pause', async () => {
      const chromePage = await openTrackedTab('chrome://version');
      await openPopupFor(chromePage.id);
      const view = await popupView();
      assert.equal(view.siteLine, "Inkout can't run on this page");
      assert.equal(view.pauseShown, false);
      await chromePage.tab.close();
      await openPopupFor(meeting.id);
    });

    test('the settings button opens the settings page', async () => {
      await chrome.send('Target.setDiscoverTargets', { discover: true });
      const opened = chrome.waitFor('Target.targetCreated', (message) =>
        message.params.targetInfo.url.endsWith('/src/options.html')
      );
      await popup.evaluate(`document.getElementById('settings').click()`);
      const { params } = await opened;
      await chrome.send('Target.closeTarget', { targetId: params.targetInfo.targetId });
      await chrome.send('Target.setDiscoverTargets', { discover: false });
    });
  });

  describe('settings page', () => {
    const DESKTOP_WIDTH = 1280;
    const PHONE_WIDTH = 375;
    let fixture;
    let options;

    /**
     * Summary: the settings as stored right now.
     * Returns: Promise of the stored settings object.
     */
    function stored() {
      return options.evaluate(`chrome.storage.sync.get('privacyGuardSettings').then((data) => data.privacyGuardSettings)`);
    }

    /**
     * Summary: clicks an element on the settings page and waits for the change to reach open tabs.
     * Parameters: selector — CSS selector of the control.
     */
    async function click(selector) {
      await options.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await options.settle(300);
    }

    /**
     * Summary: types into a text box on the settings page and presses its Add button.
     * Parameters: inputSelector; buttonSelector; text.
     */
    async function addEntry(inputSelector, buttonSelector, text) {
      await options.evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).value = ${JSON.stringify(text)}`);
      await click(buttonSelector);
    }

    const text = (selector) => options.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);

    before(async () => {
      fixture = await openTrackedTab(`${server.origin}/types.html`);
      await setSettings(DEFAULT_SETTINGS, fixture.tab);
      options = await Tab.open(chrome, EXTENSION_NAME);
      await options.goto(`chrome-extension://${extensionId}/src/options.html`);
    });
    after(async () => {
      await setSettings(DEFAULT_SETTINGS, fixture.tab);
      await options.close();
      await fixture.tab.close();
    });

    test('shows the current settings', async () => {
      assert.deepEqual(
        await options.evaluate(`({
          master: document.getElementById('master').checked,
          types: Object.fromEntries([...document.querySelectorAll('input[data-type]')].map((box) => [box.dataset.type, box.checked])),
          style: document.querySelector('input[name="style"]:checked').value,
          strength: document.querySelector('input[name="strength"]:checked').value,
          scope: document.querySelector('input[name="scope"]:checked').value,
          hideTitles: document.getElementById('hide-titles').checked,
          autoOn: document.getElementById('auto-on').checked,
          autoOff: document.getElementById('auto-off').checked,
        })`),
        {
          master: true,
          types: { email: true, apiKey: true, iban: true, card: true, phone: true, ip: false, custom: true },
          style: 'blur',
          strength: 'medium',
          scope: 'all',
          hideTitles: true,
          autoOn: true,
          autoOff: false,
        }
      );
    });

    test('switching off a type saves it and shows that type on open pages', async () => {
      await click('input[data-type="email"]');
      assert.equal((await stored()).types.email, false);
      assert.equal((await fixture.tab.hiddenText()).email, undefined);
      await click('input[data-type="email"]');
      assert.deepEqual((await fixture.tab.hiddenText()).email, ['priya.sharma@example.com']);
    });

    test('the main switch turns protection off', async () => {
      await click('#master');
      assert.equal((await stored()).enabled, false);
      assert.deepEqual(await fixture.tab.hiddenText(), {});
      await click('#master');
      assert.equal((await stored()).enabled, true);
    });

    test('a custom word is added, hidden on pages, and can be removed', async () => {
      await addEntry('#custom-input', '#custom-add', 'Project Falcon');
      assert.deepEqual((await stored()).customWords, ['Project Falcon']);
      assert.equal(await text('#custom-list'), 'Project Falcon');
      assert.deepEqual((await fixture.tab.hiddenText()).custom, ['Project Falcon']);
      await click('#custom-list button');
      assert.deepEqual((await stored()).customWords, []);
    });

    test('an invalid pattern is refused with a message', async () => {
      await click('#custom-as-patterns');
      await addEntry('#custom-input', '#custom-add', '(unclosed');
      assert.equal(await text('#custom-error'), "This isn't a valid pattern");
      assert.deepEqual((await stored()).customWords, []);
    });

    test('a pattern that could freeze pages is refused', async () => {
      const PATTERN_CHECK_WAIT_MS = 1500; // the page gives up on a pattern after a second
      await addEntry('#custom-input', '#custom-add', '(a+)+$');
      await options.settle(PATTERN_CHECK_WAIT_MS);
      assert.equal(await text('#custom-error'), 'This pattern is too slow to use');
      assert.deepEqual((await stored()).customWords, []);
    });

    test('a working pattern is saved', async () => {
      await addEntry('#custom-input', '#custom-add', 'Falcon\\b');
      assert.equal(await text('#custom-error'), '');
      assert.deepEqual((await stored()).customWords, ['Falcon\\b']);
      await click('#custom-list button');
      await click('#custom-as-patterns');
    });

    test('a never-hide site is cleaned up when added, and the page follows it', async () => {
      await addEntry('#site-input', '#site-add', 'https://www.Example.com/x');
      assert.equal(await text('#never-list'), 'example.com');
      await addEntry('#site-input', '#site-add', new URL(server.origin).host);
      assert.deepEqual(await fixture.tab.hiddenText(), {});
      assert.deepEqual((await stored()).neverHideSites, ['example.com', new URL(server.origin).host]);
      await click('#never-list li:last-child button');
      assert.ok((await fixture.tab.hiddenText()).email);
      await click('#never-list li button');
      assert.deepEqual((await stored()).neverHideSites, []);
    });

    test('something that is not a site is refused with a message', async () => {
      await addEntry('#site-input', '#site-add', 'not a site!');
      assert.equal(await text('#site-error'), 'Enter a site like example.com');
      assert.deepEqual((await stored()).neverHideSites, []);
    });

    test('"only on sites I choose" shows its own list', async () => {
      await click('input[name="scope"][value="chosen"]');
      assert.equal((await stored()).siteMode, 'chosen');
      assert.equal(await options.evaluate(`document.getElementById('chosen-section').hidden`), false);
      assert.deepEqual(await fixture.tab.hiddenText(), {});
      await addEntry('#chosen-input', '#chosen-add', new URL(server.origin).host);
      assert.ok((await fixture.tab.hiddenText()).email);
      await click('#chosen-list li button');
      await click('input[name="scope"][value="all"]');
      assert.equal(await options.evaluate(`document.getElementById('chosen-section').hidden`), true);
    });

    test('the hide style and strength reach open pages', async () => {
      await click('input[name="style"][value="bar"]');
      assert.equal(await fixture.tab.evaluate(`document.documentElement.dataset.privacyGuardStyle`), 'bar');
      await click('input[name="style"][value="blur"]');
      await click('input[name="strength"][value="strong"]');
      assert.equal(await fixture.tab.evaluate(`document.documentElement.dataset.privacyGuardStrength`), 'strong');
      await click('input[name="strength"][value="medium"]');
    });

    test('tab titles and presenter mode switches are saved', async () => {
      await click('#hide-titles');
      await click('#auto-on');
      await click('#auto-off');
      const settings = await stored();
      assert.deepEqual([settings.hideTitles, settings.autoOnWhenSharing, settings.autoOffWhenSharingEnds], [false, false, true]);
      await click('#hide-titles');
      await click('#auto-on');
      await click('#auto-off');
    });

    test("both shortcuts are given to Inkout (none clashes with Chrome's own)", async () => {
      assert.equal(await text('#key-toggle-masking'), 'Alt+Shift+H');
      assert.equal(await text('#key-blur-page'), 'Alt+Shift+K');
    });

    test('links to the website, the privacy policy and support', async () => {
      const links = await options.evaluate(`[...document.querySelectorAll('a[href]')].map((link) => link.href)`);
      assert.ok(links.includes('https://kunalkumarkkr01.github.io/inkout/'));
      assert.ok(links.includes('https://kunalkumarkkr01.github.io/inkout/privacy.html'));
      assert.ok(links.includes('mailto:kunaljmit036@gmail.com'));
    });

    test('fits a desktop window and a phone-width window without sideways scrolling', async () => {
      for (const width of [DESKTOP_WIDTH, PHONE_WIDTH]) {
        await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, options.sessionId);
        await options.settle(200);
        assert.ok((await options.evaluate('document.documentElement.scrollWidth')) <= width, `scrolls sideways at ${width}px`);
      }
      await chrome.send('Emulation.clearDeviceMetricsOverride', {}, options.sessionId);
    });
  });

  describe('welcome page', () => {
    let welcome;
    before(async () => {
      welcome = await Tab.open(chrome, EXTENSION_NAME);
      await welcome.goto(`chrome-extension://${extensionId}/src/welcome.html`);
    });
    after(() => welcome.close());

    test('opens by itself when Inkout is installed', () => {
      assert.ok(
        welcomeTargetsAtInstall.some((url) => url.endsWith('/src/welcome.html')),
        `tabs open after install: ${welcomeTargetsAtInstall.join(', ')}`
      );
    });

    /**
     * Summary: red pixels over some text of the "Try it right here" demo, which lives in its own frame.
     * Parameters: text — substring of the demo paragraph.
     */
    async function redPixelsOverDemo(text) {
      const rect = await welcome.evaluate(`(() => {
        const frame = document.getElementById('demo-frame');
        const paragraph = frame.contentDocument.getElementById('demo');
        const node = paragraph.firstChild;
        const at = node.data.indexOf(${JSON.stringify(text)});
        const range = new Range();
        range.setStart(node, at);
        range.setEnd(node, at + ${JSON.stringify(text)}.length);
        const inner = range.getBoundingClientRect();
        const outer = frame.getBoundingClientRect();
        // Trim the edges: neighbouring letters can bleed a pixel or two into the range's box.
        const EDGE = 5;
        return { x: outer.x + inner.x + scrollX + EDGE, y: outer.y + inner.y + scrollY, width: inner.width - 2 * EDGE, height: inner.height };
      })()`);
      return countRedPixels(await welcome.screenshot(rect));
    }

    test('really hides the values in its "Try it right here" paragraph, and nothing else', async () => {
      await welcome.evaluate(`document.getElementById('demo-frame').contentDocument.getElementById('demo').style.color = '#ff0000'`);
      await welcome.settle(300);
      assert.deepEqual(
        await welcome.evaluate(
          `[...document.getElementById('demo-frame').contentWindow.CSS.highlights.values()].flatMap((highlight) => [...highlight].map(String)).sort()`
        ),
        ['+91 98765 43210', '4111 1111 1111 1111', 'accounts@example.com']
      );
      assert.equal(await welcome.evaluate('CSS.highlights.size'), 0, 'the rest of the welcome page is left as it is');
      assert.equal(await redPixelsOverDemo('accounts@example.com'), 0);
      assert.equal(await redPixelsOverDemo('4111 1111 1111 1111'), 0);
      assert.ok((await redPixelsOverDemo('send the invoice')) > 50);
    });

    test('links to settings, the website, the privacy policy and support', async () => {
      const links = await welcome.evaluate(`[...document.querySelectorAll('a[href]')].map((link) => link.href)`);
      assert.ok(links.includes('https://kunalkumarkkr01.github.io/inkout/'));
      assert.ok(links.includes('https://kunalkumarkkr01.github.io/inkout/privacy.html'));
      assert.ok(links.includes('mailto:kunaljmit036@gmail.com'));
      assert.ok(links.includes('https://github.com/KunalKumarkkr01/inkout/issues'));
      await chrome.send('Target.setDiscoverTargets', { discover: true });
      const opened = chrome.waitFor('Target.targetCreated', (message) =>
        message.params.targetInfo.url.endsWith('/src/options.html')
      );
      await welcome.evaluate(`document.querySelector('[data-open-settings]').click()`);
      const { params } = await opened;
      await chrome.send('Target.closeTarget', { targetId: params.targetInfo.targetId });
      await chrome.send('Target.setDiscoverTargets', { discover: false });
    });
  });
});
