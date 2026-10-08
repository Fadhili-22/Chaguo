// Browser smoke test for the survey. Drives a real headless Chrome/Edge over the DevTools protocol.
//
//   node tests/browser.test.mjs                 run the checks
//   node tests/browser.test.mjs --screenshots   also save PNGs to tests/screenshots/ (git-ignored)
//
// Needs: Node 22+ (built-in WebSocket and fetch) and Chrome or Edge installed.
// Nothing is installed with npm. Set CHROME_PATH if your browser is somewhere unusual.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = pathToFileURL(path.join(here, '..', 'index.html')).href;
const SHOTS = process.argv.includes('--screenshots') ? path.join(here, 'screenshots') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) { console.error('Chrome or Edge not found. Set CHROME_PATH to its executable.'); process.exit(2); }
if (typeof WebSocket === 'undefined') { console.error('Needs Node 22 or newer (built-in WebSocket).'); process.exit(2); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chaguo-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--window-size=360,800', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
let id = 0; const pending = new Map(); const logs = [];
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
await send('Runtime.enable'); await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__resp=null;const _l=console.log;console.log=function(...a){if(a[1]&&a[1].response_id)window.__resp=JSON.parse(JSON.stringify(a[1]));_l.apply(console,a)}`});
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });

const results = [];
const check = (name, cond, extra = '') => { results.push(cond); console.log((cond ? '  ok    ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); };
const visible = () => ev(`[...document.querySelectorAll('[data-screen]')].filter(e=>!e.hidden).map(e=>e.dataset.screen).join(',')`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const shot = async (name) => {
  if (!SHOTS) return;
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64'));
};
const answerAll = (v) => ev(`document.querySelectorAll('#items-list .item').forEach(fs=>{const i=fs.querySelector('input[value="${v}"]'); i.checked=true; i.dispatchEvent(new Event('change',{bubbles:true}));})`);
const itemIds = () => ev(`[...document.querySelectorAll('#items-list .item')].map(f=>f.dataset.id).join(' ')`);

await nav(BASE);
await ev('sessionStorage.clear()'); await nav(BASE);
check('starts on the single opening screen', (await visible()) === 'start');
check('old welcome/age/consent screens are gone from the page', await ev(`!document.getElementById('screen-welcome') && !document.getElementById('screen-age') && !document.getElementById('screen-consent')`));
check('intro mentions Chaguo, KCSE leavers and the 3-letter code', await ev(`(()=>{const t=document.getElementById('screen-start').textContent; return /KCSE leavers/.test(t) && /3-letter interest code/.test(t) && /Before you start/.test(t);})()`));
const EXPECTED_LIST = [
  'Anonymous (no name, email or phone number needed)',
  'Voluntary (you can stop at any time)',
  'Time-friendly (about 7 to 10 minutes)',"Answers (your interests, course details and satisfaction) are used for research and to train Chaguo's model",
  'Contact (njenga.munyua@strathmore.edu)'
];
const listText = await ev(`[...document.querySelectorAll('#screen-start .before-list li')].map(li=>li.textContent)`);
check('"Before you start" list reads exactly as agreed (five points)', JSON.stringify(listText) === JSON.stringify(EXPECTED_LIST), JSON.stringify(listText) === JSON.stringify(EXPECTED_LIST) ? '' : JSON.stringify(listText));
check('list uses bullets with a small gap (<= 1.5em indent)', await ev(`(()=>{const l=document.querySelector('#screen-start .before-list'); const cs=getComputedStyle(l); return l.tagName==='UL' && cs.listStyleType==='disc' && parseFloat(cs.paddingLeft) <= 1.5*parseFloat(cs.fontSize);})()`));
check('"Before you start" is bold; list items are normal weight; main heading and buttons may be bold', await ev(`(()=>{const root=document.getElementById('screen-start'); if(root.querySelector('strong,b,dt')) return false; const w=(el)=>parseInt(getComputedStyle(el).fontWeight,10); if(w(root.querySelector('.before-title'))<600) return false; return [...root.querySelectorAll('*')].every(el=>{ if(el.tagName==='H1'||el.classList.contains('btn')||el.classList.contains('before-title')) return true; return w(el)<=400; });})()`));
check('time wording: "about 7 to 10 minutes" appears once on the page; no stale "7 minutes"', await ev(`(()=>{const t=document.body.textContent; return t.split('7 to 10 minutes').length===2 && t.split('7 minutes').length===1;})()`));
check('contact email is a mailto link', await ev(`document.querySelector('#screen-start .before-list a[href="mailto:njenga.munyua@strathmore.edu"]') !== null`));
check('header shows the logo with alt "Chaguo", loaded, sensibly sized', await ev(`(()=>{const i=document.querySelector('.site-header img'); const h=i.getBoundingClientRect().height; return i.alt==='Chaguo' && i.complete && i.naturalWidth>0 && h>=24 && h<=60 && i.getAttribute('src')==='assets/chaguo-logo-transparent.png';})()`));
check('header still says INTEREST SURVEY', await ev(`document.querySelector('.site-header-note').textContent.trim().toLowerCase()==='interest survey'`));
check('no horizontal scroll on the opening screen', await ev(`document.documentElement.scrollWidth <= 360`));
check('buttons stack (same left edge, one above the other, full width)', await ev(`(()=>{const a=document.getElementById('start-agree').getBoundingClientRect(), b=document.getElementById('start-underage').getBoundingClientRect(); return Math.abs(a.left-b.left)<1 && b.top>=a.bottom && a.width>300 && Math.abs(a.width-b.width)<1;})()`));
check('both buttons have tap targets of at least 44px', await ev(`['start-agree','start-underage'].every(id=>document.getElementById(id).getBoundingClientRect().height>=44)`));
const pageHeight = await ev(`document.documentElement.scrollHeight`);
console.log(`        opening screen at 360x800: page height ${pageHeight}px (viewport 800px)`);
check('opening screen needs little scrolling at 360px (<= 1.25 screens)', pageHeight <= 1000);
await shot('start');
// Laptop-sized viewport: the opening screen must fit with no vertical scrolling.
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
await sleep(200);
const laptop = await ev(`({ page: document.documentElement.scrollHeight, view: window.innerHeight })`);
console.log(`        opening screen at 1366x768: page height ${laptop.page}px, viewport ${laptop.view}px`);
check('opening screen fits a laptop screen with no scrolling', laptop.page <= laptop.view);
await shot('start-laptop');
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
await sleep(200);
await click('#start-agree');
check('18+/agree button -> items screen 1 (age + consent in one step)', (await visible()) === 'items');
check('progress label', (await ev(`document.getElementById('items-progress-label').textContent`)) === 'Screen 1 of 6');
check('screen 1 items', (await itemIds()) === 'R1 I1 A1 S1 E1 C1 R2 I2');
check('no Back on screen 1', await ev(`document.getElementById('items-back').hidden`));
await click('#items-next');
check('Next with nothing answered stays put and shows summary', (await visible()) === 'items' && (await ev(`document.getElementById('items-summary').textContent`)) === '8 items still need an answer.');
check('all 8 flagged missing, first one focused', (await ev(`document.querySelectorAll('.item.is-missing').length`)) === 8 && (await ev(`document.activeElement.name`)) === 'R1');
await shot('items-missing');
// answer one: flag clears and count drops
await ev(`(()=>{const i=document.querySelector('input[name=R1][value="4"]'); i.checked=true; i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
check('answering clears flag and updates count', (await ev(`document.getElementById('items-summary').textContent`)) === '7 items still need an answer.');
check('no horizontal scroll at 360px', (await ev(`document.documentElement.scrollWidth <= 360`)));
// refresh keeps the answer
await nav(BASE);
check('refresh restores items screen 1 with the answer', (await visible()) === 'items' && (await ev(`document.querySelector('input[name=R1][value="4"]').checked`)) === true);
await answerAll(3);
await ev(`(()=>{const i=document.querySelector('input[name=R1][value="4"]'); i.checked=true; i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await click('#items-next');
check('screen 2 items', (await itemIds()) === 'A2 S2 E2 C2 R3 I3 A3 S3');
await click('#items-back');
check('Back keeps earlier answers', (await ev(`document.querySelector('input[name=R1][value="4"]').checked`)) === true);
await click('#items-next'); await answerAll(3); await click('#items-next');
check('screen 3 items', (await itemIds()) === 'E3 C3 R4 I4 A4 S4 E4 C4');
await answerAll(3); await click('#items-next');
check('screen 4 items (check is 5th of 9)', (await itemIds()) === 'R5 I5 A5 S5 attention_check E5 C5 R6 I6');
await shot('items-screen4');
await answerAll(3);
// the attention check: answer Dislike (1)
await ev(`(()=>{const i=document.querySelector('input[name=attention_check][value="1"]'); i.checked=true; i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await click('#items-next');
check('screen 5 items', (await itemIds()) === 'A6 S6 E6 C6 R7 I7 A7 S7');
await answerAll(3); await click('#items-next');
check('screen 6 items', (await itemIds()) === 'E7 C7 R8 I8 A8 S8 E8 C8');
await answerAll(3); await click('#items-next');
check('-> background placeholder', (await visible()) === 'background');
await click('#background-continue');
check('-> results', (await visible()) === 'results');
const R = await ev(`window.__resp`);
check('response object was console.logged with 69 flat fields', !!R && Object.keys(R).length === 69, R ? Object.keys(R).length : '');
console.log('        ', JSON.stringify(R));
check('response (R1=4, rest 3): score_R 25, others 24, code RIA, attention passed', R.score_R === 25 && R.score_C === 24 && R.holland_code === 'RIA' && R.attention_check === 1 && R.attention_passed === true && R.schema_version === '1');
check('timings recorded', R.time_screen_1 > 0 && R.time_total_ms >= R.time_screen_1 && R.time_screen_6 > 0);
check('sessionStorage state cleared on results', (await ev(`sessionStorage.getItem('chaguo_survey_state_v1')`)) === null);
const code = await ev(`document.getElementById('results-code').textContent`);
check('all-3s code is RIA with a tie note', code === 'RIA' && (await ev(`!document.getElementById('results-tie-note').hidden`)), `code=${code}`);
check('share link is wa.me with the code', (await ev(`document.getElementById('results-share').href`)).startsWith('https://wa.me/?text=My%20interest%20code%20is%20RIA'));
check('six score rows', (await ev(`document.querySelectorAll('.score-row').length`)) === 6);
check('no horizontal scroll on results', (await ev(`document.documentElement.scrollWidth <= 360`)));
await shot('results');

// Under-18
await ev('sessionStorage.clear()'); await nav(BASE);
await click('#start-underage');
check('under 18 -> exit screen', (await visible()) === 'exit');
check('under 18: nothing stored except the flag', await ev(`sessionStorage.getItem('chaguo_survey_state_v1') === null && sessionStorage.getItem('chaguo_survey_underage') === '1' && sessionStorage.length === 1`));
await nav(BASE);
check('under 18 skips straight to exit after refresh (no way back in)', (await visible()) === 'exit');
await shot('exit');

// Debug helper: absent without the flag
await ev('sessionStorage.clear()'); await nav(BASE);
check('debug button hidden without the flag', await ev(`document.getElementById('debug-bar').hidden`));

// Debug=1
await ev('sessionStorage.clear()'); logs.length = 0; await nav(BASE + '?debug=1');
check('debug button shown with ?debug=1', (await ev(`document.getElementById('debug-bar').hidden`)) === false);
await click('#debug-fill');
check('debug=1 jumps to results', (await visible()) === 'results');
const D1 = await ev(`window.__resp`);
check('debug=1 attention_check is 1 and passed; 48 answers in 1..5', D1.attention_check === 1 && D1.attention_passed === true && Object.keys(D1).filter(k=>/^[RIASEC][1-8]$/.test(k)).every(k=>D1[k]>=1&&D1[k]<=5));

// Debug=fail
await ev('sessionStorage.clear()'); logs.length = 0; await nav(BASE + '?debug=fail');
await click('#debug-fill');
const D2 = await ev(`window.__resp`);
check('debug=fail attention_check is wrong (5), passed=false', D2.attention_check === 5 && D2.attention_passed === false && (await visible()) === 'results');

const errs = logs.filter((l) => l.type === 'EXCEPTION' || l.type === 'error');
check('no JS errors', errs.length === 0, errs.length ? JSON.stringify(errs).slice(0, 300) : '');

const failed = results.filter((r) => !r).length;
console.log(`
${results.length - failed}/${results.length} checks passed`);
ws.close(); chrome.kill();
await sleep(300);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);
