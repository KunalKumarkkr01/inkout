// Helpers for the browser tests: a static file server, a tab wrapper that evaluates code in
// the page or in the extension's content-script world, and a tiny PNG decoder for pixel checks.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');

const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const PAGE_SETTLE_MS = 100;

/**
 * Summary: serves a folder over HTTP on 127.0.0.1 with a random free port.
 * Parameters: root — folder to serve.
 * Returns: Promise of { origin, crossSiteOrigin, close }. crossSiteOrigin uses "localhost",
 *          which Chrome treats as a different site, so frames from it run out of process.
 * Usage: const server = await startServer(FIXTURES); tab.goto(`${server.origin}/basic.html`).
 */
function startServer(root) {
  const server = http.createServer((request, response) => {
    const file = path.join(root, decodeURIComponent(new URL(request.url, 'http://x').pathname));
    if (!file.startsWith(root)) return response.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return response.writeHead(404).end('not found');
      response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        crossSiteOrigin: `http://localhost:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/**
 * Summary: one browser tab with helpers for evaluating code and taking screenshots.
 * Usage: const tab = await Tab.open(chrome, extensionName); await tab.goto(url);
 */
class Tab {
  constructor(chrome, extensionName, targetId, sessionId) {
    this.chrome = chrome;
    this.extensionName = extensionName;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.frameSessions = new Map([[sessionId, sessionId]]);
    this.contexts = new Map();
    this.unsubscribe = chrome.onEvent((message) => this.track(message));
  }

  /**
   * Summary: opens a new blank tab and starts tracking its frames and script worlds.
   * Parameters: chrome — ChromeConnection; extensionName — manifest name (labels the content-script world).
   * Returns: Promise of a Tab.
   */
  static async open(chrome, extensionName) {
    const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = new Tab(chrome, extensionName, targetId, sessionId);
    await tab.prepareSession(sessionId);
    return tab;
  }

  /**
   * Summary: enables the CDP domains the tests need on one session (the tab or an out-of-process frame).
   * Parameters: sessionId — CDP session.
   */
  async prepareSession(sessionId) {
    await this.chrome.send('Page.enable', {}, sessionId);
    await this.chrome.send('Runtime.enable', {}, sessionId);
    await this.chrome.send(
      'Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      sessionId
    );
  }

  /**
   * Summary: records script worlds per frame, and attaches to out-of-process frames as they appear.
   * Parameters: message — any CDP event.
   */
  track(message) {
    if (message.method === 'Target.attachedToTarget' && this.frameSessions.has(message.sessionId)) {
      const child = message.params.sessionId;
      this.frameSessions.set(child, child);
      this.prepareSession(child).catch(() => {});
      return;
    }
    // An out-of-process frame's session ends when its page navigates away.
    if (message.method === 'Target.detachedFromTarget' && message.params.sessionId !== this.sessionId) {
      this.frameSessions.delete(message.params.sessionId);
      return;
    }
    if (!this.frameSessions.has(message.sessionId)) return;
    if (message.method === 'Runtime.executionContextCreated') {
      const { id, name, auxData } = message.params.context;
      const key = auxData.frameId;
      const entry = this.contexts.get(key) || {};
      if (auxData.isDefault) entry.main = { id, sessionId: message.sessionId };
      else if (auxData.type === 'isolated' && name === this.extensionName) entry.isolated = { id, sessionId: message.sessionId };
      this.contexts.set(key, entry);
    }
    if (message.method === 'Runtime.executionContextDestroyed') {
      for (const entry of this.contexts.values()) {
        if (entry.main?.id === message.params.executionContextId) delete entry.main;
        if (entry.isolated?.id === message.params.executionContextId) delete entry.isolated;
      }
    }
  }

  /**
   * Summary: navigates and waits for the load event, then lets the extension settle.
   * Parameters: url — page to open.
   */
  async goto(url) {
    const loaded = this.chrome.waitFor('Page.loadEventFired', (m) => m.sessionId === this.sessionId);
    const { frameId } = await this.chrome.send('Page.navigate', { url }, this.sessionId);
    this.mainFrameId = frameId;
    await loaded;
    await this.settle();
  }

  /**
   * Summary: waits briefly so mutation handling and settings changes finish.
   * Parameters: ms — how long.
   */
  async settle(ms = PAGE_SETTLE_MS) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Summary: lists every frame id in the tab, including out-of-process frames.
   * Returns: Promise of frame id strings (main frame first).
   */
  async frameIds() {
    const ids = [];
    const walk = (node) => {
      ids.push(node.frame.id);
      (node.childFrames || []).forEach(walk);
    };
    for (const sessionId of this.frameSessions.keys()) {
      const { frameTree } = await this.chrome.send('Page.getFrameTree', {}, sessionId);
      walk(frameTree);
    }
    return [...new Set(ids)];
  }

  /**
   * Summary: evaluates JavaScript in the page's own world or the extension's content-script world.
   * Parameters: expression — code (may be async); options.world — 'main' | 'isolated'; options.frameId — default main frame.
   * Returns: Promise of the JSON value the expression produced.
   * Usage: await tab.evaluate('CSS.highlights.size', { world: 'isolated' });
   */
  async evaluate(expression, { world = 'main', frameId = this.mainFrameId } = {}) {
    const context = this.contexts.get(frameId)?.[world];
    if (!context) throw new Error(`No ${world} world for frame ${frameId}`);
    const result = await this.chrome.send(
      'Runtime.evaluate',
      { expression, contextId: context.id, returnByValue: true, awaitPromise: true },
      context.sessionId
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  /**
   * Summary: the exact strings the extension is currently hiding in a frame, per type.
   * Parameters: frameId — default main frame.
   * Returns: Promise of { email: [...], phone: [...], card: [...] } (only types with something hidden right now).
   */
  hiddenText(frameId) {
    return this.evaluate(
      `(() => {
        const result = {};
        for (const [name, highlight] of CSS.highlights) {
          if (highlight.size === 0) continue;
          result[name.replace('privacy-guard-', '')] = [...highlight].map((range) => range.toString()).sort();
        }
        return result;
      })()`,
      { world: 'isolated', frameId }
    );
  }

  /**
   * Summary: types text into the focused element like a user would.
   * Parameters: text — characters to insert.
   */
  async type(text) {
    await this.chrome.send('Input.insertText', { text }, this.sessionId);
    await this.settle();
  }

  /**
   * Summary: screenshots a rectangle of the page and decodes it.
   * Parameters: rect — { x, y, width, height } in CSS pixels.
   * Returns: Promise of { width, height, pixels } (RGBA bytes).
   */
  async screenshot(rect) {
    const { data } = await this.chrome.send(
      'Page.captureScreenshot',
      { format: 'png', clip: { ...rect, scale: 1 }, captureBeyondViewport: true },
      this.sessionId
    );
    return decodePng(Buffer.from(data, 'base64'));
  }

  /**
   * Summary: closes the tab.
   */
  async close() {
    this.unsubscribe();
    await this.chrome.send('Target.closeTarget', { targetId: this.targetId });
  }
}

/**
 * Summary: decodes an 8-bit RGB or RGBA, non-interlaced PNG (what Chrome screenshots produce).
 * Parameters: buffer — PNG file bytes.
 * Returns: { width, height, pixels } with pixels as RGBA bytes.
 * Usage: const image = decodePng(fs.readFileSync('shot.png'));
 */
function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      if (chunk[8] !== 8 || chunk[12] !== 0) throw new Error('Only 8-bit non-interlaced PNGs are supported');
      colorType = chunk[9];
    }
    if (type === 'IDAT') idat.push(chunk);
    offset += 12 + length;
  }
  const channels = { 2: 3, 6: 4 }[colorType];
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rows[y * stride + x - channels] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? rows[(y - 1) * stride + x - channels] : 0;
      rows[y * stride + x] = (line[x] + unfilter(filter, left, up, upLeft)) & 0xff;
    }
  }
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = rows[i * channels];
    pixels[i * 4 + 1] = rows[i * channels + 1];
    pixels[i * 4 + 2] = rows[i * channels + 2];
    pixels[i * 4 + 3] = channels === 4 ? rows[i * channels + 3] : 255;
  }
  return { width, height, pixels };
}

/**
 * Summary: the predictor value for one PNG filter type.
 * Parameters: filter — 0..4; left, up, upLeft — neighbouring decoded bytes.
 * Returns: the value to add to the filtered byte.
 */
function unfilter(filter, left, up, upLeft) {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  if (filter === 4) {
    const estimate = left + up - upLeft;
    const distanceLeft = Math.abs(estimate - left);
    const distanceUp = Math.abs(estimate - up);
    const distanceUpLeft = Math.abs(estimate - upLeft);
    if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
    return distanceUp <= distanceUpLeft ? up : upLeft;
  }
  throw new Error(`Unknown PNG filter ${filter}`);
}

/**
 * Summary: counts pixels drawn in the test pages' pure-red text color.
 * Parameters: image — from Tab.screenshot.
 * Returns: number of clearly red pixels. Zero means none of the original glyphs were painted.
 * Usage: assert.equal(countRedPixels(await tab.screenshot(rect)), 0);
 */
function countRedPixels(image) {
  let count = 0;
  for (let i = 0; i < image.pixels.length; i += 4) {
    const [red, green, blue] = [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
    if (red > 180 && green < 90 && blue < 90) count++;
  }
  return count;
}

/**
 * Summary: whether two screenshots are pixel-for-pixel identical.
 * Parameters: first, second — images from Tab.screenshot.
 * Returns: true when sizes and every pixel match.
 * Usage: assert.equal(samePixels(before, after), false) to prove something visibly changed.
 */
function samePixels(first, second) {
  return first.width === second.width && first.height === second.height && first.pixels.equals(second.pixels);
}

module.exports = { startServer, Tab, decodePng, countRedPixels, samePixels };
