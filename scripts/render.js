// Renders the extension's images with the installed Chrome (no image libraries needed).
//   node scripts/render.js icons   → icons/icon-16.png, -32, -48, -128
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

const COMMANDS = { icons: renderIcons };

/**
 * Summary: command-line entry: node scripts/render.js <icons>.
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
