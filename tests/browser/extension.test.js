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

  before(async () => {
    assert.ok(chromePath, 'Chrome is required on CI');
    chrome = await launchChrome(chromePath);
    ({ id: extensionId } = await chrome.send('Extensions.loadUnpacked', { path: EXTENSION_DIR }));
    server = await startServer(FIXTURES);
    tab = await Tab.open(chrome, EXTENSION_NAME);
  });

  after(async () => {
    await tab?.close();
    await chrome?.close();
    await server?.close();
  });

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
   * Parameters: selector — CSS selector; text — substring to locate, or null for the whole element.
   * Returns: Promise of { x, y, width, height }.
   */
  function rectOf(selector, text = null, frameId) {
    return tab.evaluate(
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
   * Parameters: selector, text — as for rectOf.
   */
  async function redPixelsOver(selector, text = null) {
    return countRedPixels(await tab.screenshot(await rectOf(selector, text)));
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

  describe('popup and toolbar badge', () => {
    let popup;

    before(async () => {
      await openFixture('basic.html');
      popup = await Tab.open(chrome, EXTENSION_NAME);
      await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
    });
    after(async () => {
      await popup?.close();
      await setSettings(DEFAULT_SETTINGS);
    });

    test('the popup shows the current state', async () => {
      assert.deepEqual(
        await popup.evaluate(`({
          enabled: document.getElementById('enabled').checked,
          status: document.getElementById('status').textContent,
          types: [...document.querySelectorAll('input[data-type]')].map((box) => box.checked),
        })`),
        { enabled: true, status: 'Hiding is ON', types: [true, true, true] }
      );
    });

    test('switching off in the popup shows everything on open pages and badges the icon', async () => {
      await popup.evaluate(`document.getElementById('enabled').click()`);
      await tab.settle(300);
      assert.deepEqual(await tab.hiddenText(), {});
      assert.equal(await popup.evaluate(`chrome.action.getBadgeText({})`), 'OFF');
    });

    test('switching back on hides again and clears the badge', async () => {
      await popup.evaluate(`document.getElementById('enabled').click()`);
      await tab.settle(300);
      assert.equal((await tab.hiddenText()).email.length, 4);
      assert.equal(await popup.evaluate(`chrome.action.getBadgeText({})`), '');
    });

    test('unticking a type in the popup shows that type on pages', async () => {
      await popup.evaluate(`document.querySelector('input[data-type="phone"]').click()`);
      await tab.settle(300);
      assert.deepEqual(Object.keys(await tab.hiddenText()).sort(), ['card', 'email']);
    });
  });
});
