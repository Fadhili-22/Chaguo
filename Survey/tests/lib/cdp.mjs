// Tiny helper: start a throwaway headless Chrome/Edge and drive it over the DevTools protocol.
// Used by tests/saving.test.mjs. (tests/browser.test.mjs has its own copy of this boilerplate.)
// Needs Node 22+ (built-in WebSocket and fetch) and Chrome or Edge; set CHROME_PATH if it's somewhere unusual.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchBrowser({ width = 360, height = 800, args = [] } = {}) {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const exe = candidates.find((p) => fs.existsSync(p));
  if (!exe) { console.error('Chrome or Edge not found. Set CHROME_PATH to its executable.'); process.exit(2); }
  if (typeof WebSocket === 'undefined') { console.error('Needs Node 22 or newer (built-in WebSocket).'); process.exit(2); }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chaguo-chrome-'));
  const chrome = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', `--window-size=${width},${height}`, ...args, 'about:blank'
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 100; i++) {
    try {
      const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.length) break;
    } catch {}
    await sleep(200);
  }
  if (!targets) { console.error('Could not connect to the browser.'); chrome.kill(); process.exit(2); }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled') logs.push(msg.params);
    if (msg.method === 'Runtime.exceptionThrown') logs.push({ type: 'EXCEPTION', args: [{ value: JSON.stringify(msg.params.exceptionDetails) }] });
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  const nav = async (url) => { await send('Page.navigate', { url }); await sleep(600); };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });

  // HOUSE RULE: only ever close the browser THIS test started (its own process handle, its own profile folder).
  // Never kill Chrome by name or by "all chrome processes": that would close the owner's own windows too.
  // So: ask our browser to quit through DevTools (Browser.close), and only if that fails end our own handle.
  process.on('exit', () => { try { chrome.kill(); } catch {} }); // a crashed test still cleans up its own browser
  async function close() {
    try { await Promise.race([send('Browser.close'), sleep(2000)]); } catch {}
    try { ws.close(); } catch {}
    chrome.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
  return { send, ev, nav, logs, close };
}
