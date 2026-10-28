// Minimal Chrome DevTools Protocol client for the browser tests. Launches the installed
// Chrome headless with a throwaway profile, talks to it over --remote-debugging-pipe and
// loads the extension with Extensions.loadUnpacked. No dependencies.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MESSAGE_SEPARATOR = '\0';
const COMMAND_TIMEOUT_MS = 15_000;

const CHROME_CANDIDATES = {
  win32: [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

/**
 * Summary: finds a Chrome executable to test with.
 * Returns: absolute path, or null when none is installed.
 * Usage: CHROME_PATH=/path/to/chrome overrides the platform defaults.
 */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  return (CHROME_CANDIDATES[process.platform] || []).find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Summary: one CDP connection over Chrome's debugging pipe.
 * Usage: const chrome = await launchChrome(); await chrome.send('Target.getTargets');
 */
class ChromeConnection {
  constructor(child, profileDir) {
    this.child = child;
    this.profileDir = profileDir;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.buffer = '';
    child.stdio[4].on('data', (chunk) => this.receive(chunk));
  }

  /**
   * Summary: parses NUL-separated JSON messages from Chrome and routes them.
   * Parameters: chunk — raw bytes from Chrome's output pipe.
   */
  receive(chunk) {
    this.buffer += chunk.toString('utf8');
    let separatorAt;
    while ((separatorAt = this.buffer.indexOf(MESSAGE_SEPARATOR)) !== -1) {
      const message = JSON.parse(this.buffer.slice(0, separatorAt));
      this.buffer = this.buffer.slice(separatorAt + 1);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      } else if (message.method) {
        this.listeners.forEach((listener) => listener(message));
      }
    }
  }

  /**
   * Summary: sends a CDP command and waits for its result.
   * Parameters: method — e.g. 'Runtime.evaluate'; params — command parameters; sessionId — target session, if any.
   * Returns: Promise of the command's result object; rejects on a CDP error or timeout.
   * Usage: await chrome.send('Page.navigate', { url }, sessionId);
   */
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify(message) + MESSAGE_SEPARATOR);
    });
  }

  /**
   * Summary: waits for the first event matching a method name and an optional filter.
   * Parameters: method — event name; predicate — (message) => boolean; timeoutMs — give-up time.
   * Returns: Promise of the event message.
   * Usage: await chrome.waitFor('Page.loadEventFired', (m) => m.sessionId === sessionId);
   */
  waitFor(method, predicate = () => true, timeoutMs = COMMAND_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const listener = (message) => {
        if (message.method !== method || !predicate(message)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(message);
      };
      this.listeners.add(listener);
    });
  }

  /**
   * Summary: subscribes to every CDP event; returns an unsubscribe function.
   * Parameters: listener — (message) => void.
   */
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Summary: shuts Chrome down and deletes the throwaway profile.
   * Usage: after(() => chrome.close());
   */
  async close() {
    try {
      await this.send('Browser.close');
    } catch {
      this.child.kill();
    }
    await new Promise((resolve) => (this.child.exitCode !== null ? resolve() : this.child.once('exit', resolve)));
    fs.rmSync(this.profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * Summary: starts headless Chrome with a fresh temporary profile, ready for extension loading.
 * Parameters: chromePath — the executable from findChrome().
 * Returns: Promise of a ChromeConnection.
 * Usage: const chrome = await launchChrome(findChrome());
 */
async function launchChrome(chromePath) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkout-test-profile-'));
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--window-size=1280,900',
      // CI runners restrict the user namespaces Chrome's sandbox needs; the profile is throwaway.
      ...(process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }
  );
  const connection = new ChromeConnection(child, profileDir);
  await connection.send('Browser.getVersion');
  return connection;
}

module.exports = { findChrome, launchChrome };
