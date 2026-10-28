// Renders the extension's images with the installed Chrome (no image libraries needed).
//   node scripts/render.js icons   → icons/icon-16.png, -32, -48, -128
//   node scripts/render.js store   → store/*.png (Chrome Web Store) and site/images/*.png
// Uses the same headless-Chrome connection as the browser tests.
const fs = require('node:fs');
const path = require('node:path');
const { findChrome, launchChrome } = require('../tests/browser/chrome.js');

const ROOT = path.resolve(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'icons');
const ICON_SIZES = [16, 32, 48, 128];

// The Inkout mark: a page with one line inked out. Small sizes use the simplified marks from the
// approved logo board, so the inked line stays readable.
const MARKS = {
  large: `<rect x="1" y="1" width="46" height="46" rx="11" fill="#FFFFFF" stroke="#0F1B2D" stroke-width="2"/>
    <rect x="12" y="12" width="24" height="4" rx="2" fill="#B8C1CC"/>
    <path d="M12 25 L36 23" fill="none" stroke="#0F1B2D" stroke-width="7" stroke-linecap="round"/>
    <rect x="12" y="32" width="15" height="4" rx="2" fill="#B8C1CC"/>`,
  medium: `<rect x="1.5" y="1.5" width="45" height="45" rx="11" fill="#FFFFFF" stroke="#0F1B2D" stroke-width="3"/>
    <rect x="11" y="11" width="26" height="5" rx="2.5" fill="#B8C1CC"/>
    <path d="M12 25 L36 23" fill="none" stroke="#0F1B2D" stroke-width="8" stroke-linecap="round"/>
    <rect x="11" y="32" width="16" height="5" rx="2.5" fill="#B8C1CC"/>`,
  small: `<rect x="2" y="2" width="44" height="44" rx="11" fill="#FFFFFF" stroke="#0F1B2D" stroke-width="4"/>
    <path d="M11 25 L37 23" fill="none" stroke="#0F1B2D" stroke-width="11" stroke-linecap="round"/>`,
};

/**
 * Summary: the logo as an SVG string at one pixel size, using the mark drawn for that size.
 * Parameters: size — icon size in pixels.
 * Returns: SVG markup.
 * Usage: logoSvg(16) gives the simplified mark used in the toolbar.
 */
function logoSvg(size) {
  const mark = size <= 16 ? MARKS.small : size <= 32 ? MARKS.medium : MARKS.large;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">${mark}</svg>`;
}

/**
 * Summary: draws HTML in a fresh headless tab and returns it as a PNG.
 * Parameters: chrome — connection from launchChrome; options.html — the page; options.width, options.height —
 *   output size in pixels; options.transparent — keep the background see-through (for icons).
 * Returns: Promise of a PNG Buffer.
 * Usage: const png = await renderPng(chrome, { html: logoSvg(128), width: 128, height: 128, transparent: true });
 */
async function renderPng(chrome, { html, width, height, transparent = false }) {
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
  try {
    await chrome.send('Page.enable', {}, sessionId);
    await chrome.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    if (transparent) {
      await chrome.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);
    }
    const { frameTree } = await chrome.send('Page.getFrameTree', {}, sessionId);
    const page = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${html}</body></html>`;
    await chrome.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: page }, sessionId);
    await chrome.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true }, sessionId);
    const { data } = await chrome.send(
      'Page.captureScreenshot',
      { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } },
      sessionId
    );
    return Buffer.from(data, 'base64');
  } finally {
    await chrome.send('Target.closeTarget', { targetId });
  }
}

/**
 * Summary: writes the four toolbar and store icons.
 * Parameters: chrome — connection from launchChrome.
 */
async function renderIcons(chrome) {
  fs.mkdirSync(ICON_DIR, { recursive: true });
  for (const size of ICON_SIZES) {
    const png = await renderPng(chrome, { html: logoSvg(size), width: size, height: size, transparent: true });
    fs.writeFileSync(path.join(ICON_DIR, `icon-${size}.png`), png);
  }
}

const STORE_DIR = path.join(ROOT, 'store');
const SITE_IMAGE_DIR = path.join(ROOT, 'site', 'images');
const FIXTURES = path.join(ROOT, 'tests', 'browser', 'fixtures');
const SCREENSHOT = { width: 1280, height: 800 };
const PROMO = { width: 440, height: 280 };
const POPUP_WIDTH = 360;
// The screenshots show a believable site (.test is reserved for testing); Chrome is handed the
// fixture for it directly, so no server or port number is involved.
const INBOX_URL = 'http://mail.example.test/';
const INBOX_FIXTURE = path.join(FIXTURES, 'store-inbox.html');
const PAGE_SETTLE_MS = 1500;
const FONT_URL = `data:font/ttf;base64,${fs.readFileSync(path.join(ROOT, 'src', 'fonts', 'Manrope.ttf')).toString('base64')}`;
const FONT_FACE = `@font-face { font-family: Manrope; src: url('${FONT_URL}') format('truetype'); font-weight: 200 800; }`;

/**
 * Summary: captures a page at a given viewport size, as the user would see it.
 * Parameters: chrome; tab — a harness Tab; width, height — viewport and image size.
 * Returns: Promise of a PNG Buffer.
 */
async function capture(chrome, tab, width, height) {
  await chrome.send('Page.bringToFront', {}, tab.sessionId);
  const { data } = await chrome.send(
    'Page.captureScreenshot',
    { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } },
    tab.sessionId
  );
  return Buffer.from(data, 'base64');
}

/**
 * Summary: sets a tab's viewport size and color scheme, and hides scrollbars (they look out of place in a screenshot).
 * Parameters: chrome; tab; width; height; scheme — 'light' or 'dark'.
 */
async function setViewport(chrome, tab, width, height, scheme = 'light') {
  await chrome.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, tab.sessionId);
  await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, tab.sessionId);
  await chrome.send('Emulation.setScrollbarsHidden', { hidden: true }, tab.sessionId);
}

const dataUrl = (png) => `data:image/png;base64,${png.toString('base64')}`;

/**
 * Summary: lays a page capture (and optionally the popup) on an ink backdrop with a caption.
 * Parameters: caption — one line of text; page — PNG of the page at 1280×800; popup — optional PNG of the popup.
 * Returns: HTML for renderPng at 1280×800.
 */
function framedScreenshot(caption, page, popup = null) {
  const popupImage = popup
    ? `<img class="popup" src="${dataUrl(popup)}" alt="">`
    : '';
  return `<style>${FONT_FACE}
    body { width: 1280px; height: 800px; overflow: hidden; background: #0F1B2D; font-family: Manrope, sans-serif; }
    .caption { position: absolute; top: 34px; left: 0; right: 0; text-align: center; color: #FFFFFF; font-size: 34px; font-weight: 800; letter-spacing: -0.02em; }
    .caption b { color: #5EDDD3; font-weight: 800; }
    .window { position: absolute; left: 100px; top: 108px; width: 1080px; height: 675px; border-radius: 14px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.45); background: #FFFFFF; }
    .page { width: 1080px; height: 675px; display: block; ${popup ? 'filter: brightness(0.92);' : ''} }
    .popup { position: absolute; top: 10px; right: 18px; width: 304px; border-radius: 12px; box-shadow: 0 18px 50px rgba(15,27,45,0.45); }
  </style>
  <div class="caption">${caption}</div>
  <div class="window"><img class="page" src="${dataUrl(page)}" alt="">${popupImage}</div>`;
}

/**
 * Summary: the small promo tile (440×280) from the approved store board.
 * Returns: HTML for renderPng.
 */
function promoTile() {
  const row = (name, email) =>
    `<div class="row"><b>${name}</b><span>${email}</span></div>`;
  return `<style>${FONT_FACE}
    body { width: 440px; height: 280px; box-sizing: border-box; background: #0F1B2D; padding: 28px; display: flex; flex-direction: column; justify-content: space-between; color: #FFFFFF; font-family: Manrope, sans-serif; }
    .brand { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 800; }
    h1 { margin: 0; font-size: 30px; line-height: 1.12; font-weight: 800; letter-spacing: -0.02em; }
    .card { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 12px; background: #17263B; }
    .row { display: flex; justify-content: space-between; font-size: 13px; }
    .row span { font-family: Consolas, monospace; color: transparent; text-shadow: 0 0 6px #C9D3DF, 0 0 6px #C9D3DF; }
  </style>
  <div class="brand"><svg width="30" height="30" viewBox="0 0 48 48">${MARKS.medium}</svg>Inkout</div>
  <h1>Share your screen,<br>not your inbox.</h1>
  <div class="card">${row('Priya Sharma', 'priya.sharma@example.com')}${row('Billing', '+91 98765 43210')}</div>`;
}

/**
 * Summary: makes a tab load the store inbox fixture whenever it asks for INBOX_URL.
 * Parameters: chrome; tab — a harness Tab.
 * Returns: Promise of a function that stops answering.
 */
async function serveInbox(chrome, tab) {
  const body = fs.readFileSync(INBOX_FIXTURE).toString('base64');
  const stop = chrome.onEvent((message) => {
    if (message.method !== 'Fetch.requestPaused' || message.sessionId !== tab.sessionId) return;
    const fulfilled = message.params.request.url === INBOX_URL;
    chrome.send(
      'Fetch.fulfillRequest',
      {
        requestId: message.params.requestId,
        responseCode: fulfilled ? 200 : 404,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: fulfilled ? body : '',
      },
      tab.sessionId
    );
  });
  await chrome.send('Fetch.enable', { patterns: [{ urlPattern: 'http://mail.example.test/*' }] }, tab.sessionId);
  return stop;
}

/**
 * Summary: writes the store screenshots and promo tile, and copies the screenshots for the website
 *          and README. Loads the real extension so every image shows Inkout actually working.
 * Parameters: chrome — connection from launchChrome.
 */
async function renderStore(chrome) {
  const { Tab } = require('../tests/browser/harness.js');
  const name = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).name;
  const { id } = await chrome.send('Extensions.loadUnpacked', { path: ROOT });
  const extensionPage = (file) => `chrome-extension://${id}/src/${file}`;
  const openTabs = [];
  try {
    // Close the welcome tab that opens on install; it is captured on its own below.
    const { targetInfos } = await chrome.send('Target.getTargets');
    for (const info of targetInfos) {
      if (info.url.endsWith('/src/welcome.html')) await chrome.send('Target.closeTarget', { targetId: info.targetId });
    }

    const helper = await Tab.open(chrome, name);
    openTabs.push(helper);
    await helper.goto(extensionPage('popup.html'));
    const tabIds = () => helper.evaluate(`chrome.tabs.query({}).then((tabs) => tabs.map((tab) => tab.id))`);
    const before = await tabIds();
    const inbox = await Tab.open(chrome, name);
    openTabs.push(inbox);
    const inboxId = (await tabIds()).find((tabId) => !before.includes(tabId));
    await setViewport(chrome, inbox, SCREENSHOT.width, SCREENSHOT.height);
    const stopServing = await serveInbox(chrome, inbox);
    await inbox.goto(INBOX_URL);
    await inbox.evaluate(
      `PrivacyGuardSettings.save({ ...PrivacyGuardSettings.DEFAULTS, customWords: ['Project Falcon'] })`,
      { world: 'isolated' }
    );
    await inbox.settle(PAGE_SETTLE_MS);
    const inboxPng = await capture(chrome, inbox, SCREENSHOT.width, SCREENSHOT.height);
    stopServing();

    const popup = await Tab.open(chrome, name);
    openTabs.push(popup);
    await setViewport(chrome, popup, POPUP_WIDTH, SCREENSHOT.height);
    await popup.goto(`${extensionPage('popup.html')}?tabId=${inboxId}`);
    await popup.settle(PAGE_SETTLE_MS);
    const popupHeight = await popup.evaluate('Math.ceil(document.body.getBoundingClientRect().height)');
    const popupPng = await capture(chrome, popup, POPUP_WIDTH, popupHeight);

    const pageShot = async (file, scheme = 'light') => {
      const page = await Tab.open(chrome, name);
      await setViewport(chrome, page, SCREENSHOT.width, SCREENSHOT.height, scheme);
      await page.goto(extensionPage(file));
      await page.settle(PAGE_SETTLE_MS);
      const png = await capture(chrome, page, SCREENSHOT.width, SCREENSHOT.height);
      await page.close();
      return png;
    };
    const settingsPng = await pageShot('options.html');
    const welcomePng = await pageShot('welcome.html');

    const images = {
      'screenshot-1-inbox.png': framedScreenshot('Emails, phones, cards and bank details <b>blurred on every site</b>', inboxPng),
      'screenshot-2-popup.png': framedScreenshot('See what is hidden. <b>Pause a tab</b> when you need to.', inboxPng, popupPng),
      'screenshot-3-settings.png': framedScreenshot('Choose <b>what to hide</b>, where, and how it looks', settingsPng),
      'screenshot-4-welcome.png': framedScreenshot('On from the start. <b>Nothing leaves your device.</b>', welcomePng),
    };
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.mkdirSync(SITE_IMAGE_DIR, { recursive: true });
    for (const [file, html] of Object.entries(images)) {
      const png = await renderPng(chrome, { html, ...SCREENSHOT });
      fs.writeFileSync(path.join(STORE_DIR, file), png);
      fs.writeFileSync(path.join(SITE_IMAGE_DIR, file), png);
    }
    fs.writeFileSync(path.join(STORE_DIR, 'promo-440x280.png'), await renderPng(chrome, { html: promoTile(), ...PROMO }));
    // Plain captures for the website, which frames them itself.
    fs.writeFileSync(path.join(SITE_IMAGE_DIR, 'inbox.png'), inboxPng);
    fs.writeFileSync(path.join(SITE_IMAGE_DIR, 'popup.png'), popupPng);
  } finally {
    for (const tab of openTabs) await tab.close();
  }
}

const COMMANDS = { icons: renderIcons, store: renderStore };

/**
 * Summary: command-line entry: node scripts/render.js <icons|store>.
 */
async function main() {
  const command = COMMANDS[process.argv[2]];
  if (!command) {
    console.error(`Usage: node scripts/render.js <${Object.keys(COMMANDS).join('|')}>`);
    process.exitCode = 1;
    return;
  }
  const chrome = await launchChrome(findChrome());
  try {
    await command(chrome);
  } finally {
    await chrome.close();
  }
}

if (require.main === module) main();

module.exports = { renderPng, logoSvg };
