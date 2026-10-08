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
import { fileURLToPath } from 'node:url';
import { makeSiteCopy } from './lib/site.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Runs against a temp COPY of the survey with saving switched off, so this test can never send rows to the real
// Google Sheet (the repo's own js/config.js holds the real endpoint).
const site = makeSiteCopy();
const BASE = site.fileUrl;
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
// With --screenshots: saves the whole page at phone width (360) and laptop width (1366), then goes back to phone width.
const shot = async (name) => {
  if (!SHOTS) return;
  const save = async (suffix) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(SHOTS, `${name}-${suffix}.png`), Buffer.from(r.result.data, 'base64'));
  };
  await save('360');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(150);
  await save('1366');
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
  await sleep(150);
};
const answerAll = (v) => ev(`document.querySelectorAll('#items-list .item').forEach(fs=>{const i=fs.querySelector('input[value="${v}"]'); i.checked=true; i.dispatchEvent(new Event('change',{bubbles:true}));})`);
const itemIds = () => ev(`[...document.querySelectorAll('#items-list .item')].map(f=>f.dataset.id).join(' ')`);

// ---- Background screens (7 and 8) helpers ----
const STATE_KEY = 'chaguo_survey_state_v2';
const bgIds = () => ev(`[...document.querySelectorAll('#background-list .item')].map(f=>f.dataset.id).join(' ')`);
const pick = (name, value) => ev(`(()=>{const i=document.querySelector('#background-list input[name="${name}"][value="${value}"]'); i.checked=true; i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const typeIn = (name, text) => ev(`(()=>{const i=document.querySelector('#background-list input[name="${name}"]'); i.value=${JSON.stringify(text)}; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const tick = (name, on) => ev(`(()=>{const i=document.querySelector('#background-list input[name="${name}"]'); i.checked=${on}; i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const isChecked = (name, value) => ev(`document.querySelector('#background-list input[name="${name}"][value="${value}"]').checked`);
const textValue = (name) => ev(`document.querySelector('#background-list input[name="${name}"]').value`);
const bgTitle = () => ev(`document.getElementById('background-title').textContent`);
const bgLabel = () => ev(`document.getElementById('background-progress-label').textContent`);
const bgSummary = () => ev(`document.getElementById('background-summary').hidden ? '' : document.getElementById('background-summary').textContent`);
const bgMissingCount = () => ev(`document.querySelectorAll('#background-list .item.is-missing').length`);
const progressNow = (prefix) => ev(`document.getElementById('${prefix}-progress').getAttribute('aria-valuenow')`);
const apply = async (ops) => { for (const [kind, name, v] of ops) { if (kind === 'pick') await pick(name, v); else if (kind === 'type') await typeIn(name, v); else await tick(name, v); } };

// Fresh session -> agree -> answer all 48 items with 3 (attention check = Dislike) -> arrive on screen 7.
async function itemsToBackground(url = BASE) {
  await ev('sessionStorage.clear()'); await nav(url);
  await click('#start-agree');
  for (let s = 1; s <= 6; s++) {
    await answerAll(3);
    if (s === 4) await ev(`(()=>{const i=document.querySelector('input[name=attention_check][value="1"]'); i.checked=true; i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await click('#items-next');
  }
}
const SCREEN7_BASE = [['type', 'course', '  BSc Computer Science  '], ['pick', 'uni_type', 'private'], ['pick', 'year_of_study', 'year_3']];
const SCREEN8_BASE = [['pick', 'satisfaction', '4'], ['pick', 'choose_again', 'not_sure'], ['pick', 'gender', 'male'], ['pick', 'age_band', '24_26']];
const BASE_EXPECTED = { schema_version: '3', course: 'BSc Computer Science', uni_type: 'private', year_of_study: 'year_3', satisfaction: 4, choose_again: 'not_sure', gender: 'male', age_band: '24_26' };

// One complete run for a branch. `screen7` are the route-specific operations; `expected` the exact fields to see.
async function fullRun(label, screen7, expected) {
  await itemsToBackground();
  await apply(SCREEN7_BASE.concat(screen7));
  await click('#background-next');
  const on8 = (await visible()) === 'background' && (await bgLabel()) === 'Screen 8 of 8';
  await apply(SCREEN8_BASE);
  await click('#background-next');
  const done = (await visible()) === 'results';
  const r = await ev(`window.__resp`);
  const want = Object.assign({}, BASE_EXPECTED, expected);
  const wrong = r ? Object.keys(want).filter((k) => r[k] !== want[k]).map((k) => `${k}: got ${JSON.stringify(r[k])}, want ${JSON.stringify(want[k])}`) : ['no response object'];
  check(`full run ${label}: reaches results, 89 fields, right fields filled and empty`, on8 && done && !!r && Object.keys(r).length === 89 && wrong.length === 0, wrong.join('; '));
  return r;
}

// Is a debug-built response internally consistent (shown questions filled, hidden ones empty)?
function consistent(R) {
  const routes = ['kuccps_placed', 'kuccps_elsewhere', 'direct', 'not_sure'];
  return !!R.course && R.course === R.course.trim() && routes.includes(R.admission_route) &&
    ['public', 'private', 'not_sure'].includes(R.uni_type) && /^year_[1-4]$|^year_5_plus$|^graduated_2y$/.test(R.year_of_study) &&
    Number.isInteger(R.satisfaction) && R.satisfaction >= 1 && R.satisfaction <= 5 &&
    ['yes', 'not_sure', 'no'].includes(R.choose_again) && ['female', 'male', 'prefer_not_to_say'].includes(R.gender) &&
    ['18_20', '21_23', '24_26', '27_plus', 'prefer_not_to_say'].includes(R.age_band) && ['yes', 'no'].includes(R.switched_course) &&
    (R.admission_route === 'kuccps_placed') === (R.kuccps_first_choice !== '') &&
    (R.admission_route === 'kuccps_elsewhere') === (R.kuccps_placed_dont_remember !== '') &&
    (R.admission_route === 'kuccps_elsewhere' || R.kuccps_placed_course === '') &&
    (R.kuccps_placed_dont_remember !== 'yes' || R.kuccps_placed_course === '') &&
    (R.switched_course === 'yes' || R.original_course === '');
}

await nav(BASE);
await ev('sessionStorage.clear()'); await nav(BASE);
check('starts on the single opening screen', (await visible()) === 'start');
check('old welcome/age/consent screens are gone from the page', await ev(`!document.getElementById('screen-welcome') && !document.getElementById('screen-age') && !document.getElementById('screen-consent')`));
check('intro mentions Chaguo, KCSE leavers and the 3-letter code', await ev(`(()=>{const t=document.getElementById('screen-start').textContent; return /KCSE leavers/.test(t) && /3-letter interest code/.test(t) && /Before you start/.test(t);})()`));
const EXPECTED_LIST = [
  'Anonymous (no name, email or phone number needed)',
  'Voluntary (you can stop at any time)',
  'Time-friendly (about 7 to 10 minutes)',
  "Answers (your interests, course details and satisfaction) are saved as you go, so if you stop partway, what you've answered is kept. They are used for research and to train Chaguo's model",
  'Contact (njenga.munyua@strathmore.edu): email us with the reference code shown at the end of the survey to have your answers deleted'
];
const listText = await ev(`[...document.querySelectorAll('#screen-start .before-list li')].map(li=>li.textContent)`);
check('"Before you start" list reads exactly as agreed (five points; saved as you go + deletion by reference code)', JSON.stringify(listText) === JSON.stringify(EXPECTED_LIST), JSON.stringify(listText) === JSON.stringify(EXPECTED_LIST) ? '' : JSON.stringify(listText));
check('list is numbered I) II) III) IV) V) in mono (a real <ul>; numerals come from CSS, the text is unchanged)', await ev(`(()=>{const l=document.querySelector('#screen-start .before-list'); const cs=getComputedStyle(l); const m=getComputedStyle(l.querySelector('li'),'::marker'); return l.tagName==='UL' && cs.listStyleType==='roman-paren' && /mono/i.test(m.fontFamily);})()`));
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
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
await sleep(200);
await click('#start-agree');
check('18+/agree button -> items screen 1 (age + consent in one step)', (await visible()) === 'items');
check('progress label', (await ev(`document.getElementById('items-progress-label').textContent`)) === 'Screen 1 of 8');
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
check('progress label on item screen 6 is "Screen 6 of 8"', (await ev(`document.getElementById('items-progress-label').textContent`)) === 'Screen 6 of 8');
check('-> background screen 7 "Your course"', (await visible()) === 'background' && (await bgTitle()) === 'Your course' && (await bgLabel()) === 'Screen 7 of 8');
check('progress bar is 75% at the start of screen 7 (6 of 8 screens done)', (await progressNow('background')) === '75');
check('screen 7 shows the 5 core questions; follow-ups hidden', (await bgIds()) === 'course uni_type year_of_study admission_route switched_course');
check('course input: max 100 chars, placeholder "BSc Computer Science"', await ev(`(()=>{const i=document.querySelector('input[name=course]'); return i.maxLength===100 && i.placeholder==='BSc Computer Science';})()`));
check('admission-route options read as agreed', JSON.stringify(await ev(`[...document.querySelectorAll('.item[data-id=admission_route] .option-text')].map(e=>e.textContent)`)) === JSON.stringify([
  'KUCCPS placed me in this course',
  "I applied through KUCCPS but I'm now studying a different course or somewhere else",
  "I applied directly to the university (didn't go through KUCCPS for this course)",
  'Not sure'
]));
check('no horizontal scroll on screen 7', await ev(`document.documentElement.scrollWidth <= 360`));
check('every option has a tap target of at least 44px', await ev(`[...document.querySelectorAll('.option-text')].every(e=>e.getBoundingClientRect().height>=44)`));
await shot('background-7');
// Back from screen 7 goes to item screen 6 and keeps its answers; Next returns
await click('#background-back');
check('Back from screen 7 -> item screen 6 with answers kept', (await visible()) === 'items' && (await itemIds()) === 'E7 C7 R8 I8 A8 S8 E8 C8' && (await ev(`document.querySelectorAll('#items-list input:checked').length`)) === 8);
await click('#items-next');
check('Next from item screen 6 -> screen 7 again', (await visible()) === 'background' && (await bgTitle()) === 'Your course');
// Next with nothing answered: stays, highlights, focuses the first missing question
await click('#background-next');
check('screen 7 Next with nothing answered stays put and shows the summary', (await visible()) === 'background' && (await bgTitle()) === 'Your course' && (await bgSummary()) === '5 questions still need an answer.');
check('all 5 flagged missing, first one (course) focused', (await bgMissingCount()) === 5 && (await ev(`document.activeElement.name`)) === 'course');
await shot('background-missing');
await typeIn('course', '   ');
check('whitespace-only course still counts as missing', (await bgMissingCount()) === 5);
await typeIn('course', '  BSc Computer Science  ');
check('typing a course clears its flag and updates the count', (await bgSummary()) === '4 questions still need an answer.' && (await bgMissingCount()) === 4);
// Branching on screen
await pick('admission_route', 'kuccps_placed');
check('(a) shows the first-choice follow-up directly under the route question', (await bgIds()) === 'course uni_type year_of_study admission_route kuccps_first_choice switched_course' && await ev(`document.querySelector('.item[data-id=admission_route]').nextElementSibling.dataset.id === 'kuccps_first_choice' && document.querySelector('.item[data-id=kuccps_first_choice]').classList.contains('followup')`));
check('route question keeps focus after the redraw', (await ev(`document.activeElement.name + '=' + document.activeElement.value`)) === 'admission_route=kuccps_placed');
await pick('kuccps_first_choice', 'no');
await pick('admission_route', 'kuccps_elsewhere');
check('(b) shows the placed-course text, optional label and "I don\'t remember" checkbox; first-choice is gone', (await bgIds()) === 'course uni_type year_of_study admission_route kuccps_placed_course switched_course' && await ev(`(()=>{const f=document.querySelector('.item[data-id=kuccps_placed_course]'); return f.textContent.includes('(optional)') && f.querySelector('input[type=checkbox]') && f.textContent.includes("I don't remember");})()`));
await typeIn('kuccps_placed_course', 'BSc Nursing');
await tick('kuccps_placed_dont_remember', true);
check('ticking "I don\'t remember" clears and disables the placed-course box', (await textValue('kuccps_placed_course')) === '' && await ev(`document.querySelector('input[name=kuccps_placed_course]').disabled`));
await tick('kuccps_placed_dont_remember', false);
check('unticking re-enables it', await ev(`!document.querySelector('input[name=kuccps_placed_course]').disabled`));
await pick('admission_route', 'direct');
check('(c) direct shows no follow-up', (await bgIds()) === 'course uni_type year_of_study admission_route switched_course');
await pick('admission_route', 'not_sure');
check('(d) not sure shows no follow-up', (await bgIds()) === 'course uni_type year_of_study admission_route switched_course');
await pick('admission_route', 'kuccps_placed');
check('changing route away and back: the old first-choice answer was cleared', (await isChecked('kuccps_first_choice', 'no')) === false && (await ev(`document.querySelectorAll('input[name=kuccps_first_choice]:checked').length`)) === 0);
await pick('switched_course', 'yes');
check('switched = Yes shows "What course did you start in?" (optional)', (await bgIds()).endsWith('switched_course original_course') && await ev(`document.querySelector('.item[data-id=original_course]').textContent.includes('(optional)')`));
await typeIn('original_course', 'BSc Physics');
await pick('switched_course', 'no');
check('switched = No hides the follow-up', (await bgIds()).endsWith('switched_course'));
await pick('switched_course', 'yes');
check('switching No -> Yes again shows an empty box (old text was cleared)', (await textValue('original_course')) === '');
await pick('switched_course', 'no');
// Missing follow-up: (a) needs the first-choice answer
await click('#background-next');
check('required follow-up unanswered: Next stays and highlights it', (await bgTitle()) === 'Your course' && (await bgSummary()) === '3 questions still need an answer.' && (await ev(`document.activeElement.name`)) === 'uni_type');
await pick('uni_type', 'public'); await pick('year_of_study', 'year_3');
await click('#background-next');
check('only the first-choice follow-up is flagged now, and it is focused', (await bgMissingCount()) === 1 && (await ev(`document.querySelector('.item.is-missing').dataset.id`)) === 'kuccps_first_choice' && (await ev(`document.activeElement.name`)) === 'kuccps_first_choice');
await pick('kuccps_first_choice', 'no');
check('answering it clears the summary', (await bgSummary()) === '' && (await bgMissingCount()) === 0);
await sleep(40);
await click('#background-next');
check('-> screen 8 "A bit about you", button reads "See my results"', (await visible()) === 'background' && (await bgTitle()) === 'A bit about you' && (await bgLabel()) === 'Screen 8 of 8' && (await ev(`document.getElementById('background-next').textContent`)) === 'See my results');
check('screen 8 shows the 4 questions', (await bgIds()) === 'satisfaction choose_again gender age_band');
check('satisfaction options are all five labelled 1-5', JSON.stringify(await ev(`[...document.querySelectorAll('.item[data-id=satisfaction] .option-text')].map(e=>e.textContent)`)) === JSON.stringify(['1Very dissatisfied', '2Dissatisfied', '3Neutral', '4Satisfied', '5Very satisfied']));
check('age options read as agreed', JSON.stringify(await ev(`[...document.querySelectorAll('.item[data-id=age_band] .option-text')].map(e=>e.textContent)`)) === JSON.stringify(['18–20', '21–23', '24–26', '27 or older', 'Prefer not to say']));
check('progress bar is 88% at the start of screen 8', (await progressNow('background')) === '88');
check('no horizontal scroll on screen 8', await ev(`document.documentElement.scrollWidth <= 360`));
await shot('background-8-empty');
await click('#background-next');
check('screen 8 Next with nothing answered stays, 4 flagged, satisfaction focused', (await bgSummary()) === '4 questions still need an answer.' && (await bgMissingCount()) === 4 && (await ev(`document.activeElement.name`)) === 'satisfaction');
await pick('satisfaction', '4');
check('answering one clears its flag; progress moves', (await bgSummary()) === '3 questions still need an answer.' && (await progressNow('background')) === '91');
// Back from 8 keeps answers on both screens
await click('#background-back');
check('Back from screen 8 -> screen 7 with answers kept', (await bgTitle()) === 'Your course' && (await textValue('course')) === '  BSc Computer Science  ' && (await isChecked('admission_route', 'kuccps_placed')) && (await isChecked('kuccps_first_choice', 'no')) && (await isChecked('switched_course', 'no')));
await click('#background-next');
check('Next -> screen 8 again with satisfaction kept', (await bgTitle()) === 'A bit about you' && (await isChecked('satisfaction', '4')));
// Refresh on screen 8 restores everything
await nav(BASE);
check('refresh on screen 8 restores screen 8 and its answers', (await visible()) === 'background' && (await bgTitle()) === 'A bit about you' && (await bgLabel()) === 'Screen 8 of 8' && (await isChecked('satisfaction', '4')));
await click('#background-back');
check('after refresh, screen 7 answers (incl. the follow-up) are restored', (await textValue('course')) === '  BSc Computer Science  ' && (await isChecked('admission_route', 'kuccps_placed')) && (await isChecked('kuccps_first_choice', 'no')) && (await bgIds()).includes('kuccps_first_choice'));
await sleep(40);
await click('#background-next');
await pick('choose_again', 'yes'); await pick('gender', 'female'); await pick('age_band', '21_23');
await shot('background-8');
await sleep(40);
await click('#background-next');
check('-> results', (await visible()) === 'results');
const R = await ev(`window.__resp`);
check('response object was console.logged with 89 flat fields', !!R && Object.keys(R).length === 89, R ? Object.keys(R).length : '');
check('route (a) run: background fields filled/empty as expected', !!R && R.course === 'BSc Computer Science' && R.uni_type === 'public' && R.year_of_study === 'year_3' && R.admission_route === 'kuccps_placed' && R.kuccps_first_choice === 'no' && R.kuccps_placed_course === '' && R.kuccps_placed_dont_remember === '' && R.switched_course === 'no' && R.original_course === '' && R.satisfaction === 4 && R.choose_again === 'yes' && R.gender === 'female' && R.age_band === '21_23', JSON.stringify(R));
check('background fields sit after holland_code and before the timings', (() => { const k = Object.keys(R); return k.indexOf('holland_code') === 60 && k[61] === 'course' && k[73] === 'age_band' && k[74] === 'time_screen_1' && k[81] === 'time_screen_8'; })());
console.log('        ', JSON.stringify(R));
check('response (R1=4, rest 3): score_R 25, others 24, code RIA, attention passed', R.score_R === 25 && R.score_C === 24 && R.holland_code === 'RIA' && R.attention_check === 1 && R.attention_passed === true && R.schema_version === '3');
check('timings recorded for all 8 screens', R.time_screen_1 > 0 && R.time_total_ms >= R.time_screen_1 && R.time_screen_6 > 0 && R.time_screen_7 > 0 && R.time_screen_8 > 0);
check('sessionStorage state cleared on results', (await ev(`sessionStorage.getItem('${STATE_KEY}')`)) === null);
const code = await ev(`document.getElementById('results-code').textContent`);
check('all-3s code is RIA with a tie note', code === 'RIA' && (await ev(`!document.getElementById('results-tie-note').hidden`)), `code=${code}`);
check('share link is wa.me with the code', (await ev(`document.getElementById('results-share').href`)).startsWith('https://wa.me/?text=My%20interest%20code%20is%20RIA'));
check('six score rows', (await ev(`document.querySelectorAll('.score-row').length`)) === 6);
check('no horizontal scroll on results', (await ev(`document.documentElement.scrollWidth <= 360`)));
await shot('results');

// One full run per admission route (route (a) is the main run above)
console.log('\n  -- full runs per admission route --');
const NONE = { kuccps_first_choice: '', kuccps_placed_course: '', kuccps_placed_dont_remember: '', switched_course: 'no', original_course: '' };
await fullRun('(a) KUCCPS placed me, first choice "yes"',
  [['pick', 'admission_route', 'kuccps_placed'], ['pick', 'kuccps_first_choice', 'yes'], ['pick', 'switched_course', 'no']],
  Object.assign({}, NONE, { admission_route: 'kuccps_placed', kuccps_first_choice: 'yes' }));
await fullRun('(b) KUCCPS then elsewhere, course typed (trimmed), switched yes + original course',
  [['pick', 'admission_route', 'kuccps_elsewhere'], ['type', 'kuccps_placed_course', '  BSc Nursing '], ['pick', 'switched_course', 'yes'], ['type', 'original_course', ' BA History ']],
  Object.assign({}, NONE, { admission_route: 'kuccps_elsewhere', kuccps_placed_course: 'BSc Nursing', kuccps_placed_dont_remember: 'no', switched_course: 'yes', original_course: 'BA History' }));
await fullRun('(b) KUCCPS then elsewhere, "I don\'t remember" ticked',
  [['pick', 'admission_route', 'kuccps_elsewhere'], ['type', 'kuccps_placed_course', 'will be cleared'], ['tick', 'kuccps_placed_dont_remember', true], ['pick', 'switched_course', 'no']],
  Object.assign({}, NONE, { admission_route: 'kuccps_elsewhere', kuccps_placed_course: '', kuccps_placed_dont_remember: 'yes' }));
await fullRun('(b) KUCCPS then elsewhere, optional answers left blank, switched yes but no original course',
  [['pick', 'admission_route', 'kuccps_elsewhere'], ['pick', 'switched_course', 'yes']],
  Object.assign({}, NONE, { admission_route: 'kuccps_elsewhere', kuccps_placed_dont_remember: 'no', switched_course: 'yes' }));
await fullRun('(c) applied directly, switched yes + original course',
  [['pick', 'admission_route', 'direct'], ['pick', 'switched_course', 'yes'], ['type', 'original_course', 'BSc Physics']],
  Object.assign({}, NONE, { admission_route: 'direct', switched_course: 'yes', original_course: 'BSc Physics' }));
await fullRun('(d) not sure',
  [['pick', 'admission_route', 'not_sure'], ['pick', 'switched_course', 'no']],
  Object.assign({}, NONE, { admission_route: 'not_sure' }));
// Stale answers: fill every follow-up, then change the parents; nothing hidden may reach the response
await fullRun('stale answers cleared: (a)+yes, switched+original, then changed to (c) and No',
  [['pick', 'admission_route', 'kuccps_placed'], ['pick', 'kuccps_first_choice', 'no'], ['pick', 'switched_course', 'yes'], ['type', 'original_course', 'BSc Physics'],
   ['pick', 'admission_route', 'direct'], ['pick', 'switched_course', 'no']],
  Object.assign({}, NONE, { admission_route: 'direct' }));
await fullRun('stale answers cleared: (b)+course typed, then changed to (a)',
  [['pick', 'admission_route', 'kuccps_elsewhere'], ['type', 'kuccps_placed_course', 'BSc Nursing'], ['pick', 'admission_route', 'kuccps_placed'], ['pick', 'kuccps_first_choice', 'dont_remember'], ['pick', 'switched_course', 'no']],
  Object.assign({}, NONE, { admission_route: 'kuccps_placed', kuccps_first_choice: 'dont_remember' }));

// Under-18
await ev('sessionStorage.clear()'); await nav(BASE);
await click('#start-underage');
check('under 18 -> exit screen', (await visible()) === 'exit');
check('under 18: nothing stored except the flag', await ev(`sessionStorage.getItem('${STATE_KEY}') === null &&sessionStorage.getItem('chaguo_survey_underage') === '1' && sessionStorage.length === 1`));
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
check('debug=1 also fills the background fields: 89 fields, valid and consistent', Object.keys(D1).length === 89 && consistent(D1), JSON.stringify(D1));
// Several debug runs: every one must be consistent, and different routes must turn up
const seenRoutes = new Set(); let allConsistent = true;
for (let i = 0; i < 10; i++) {
  await ev('sessionStorage.clear()'); await nav(BASE + (i % 2 ? '?debug=fail' : '?debug=1'));
  await click('#debug-fill');
  const Dn = await ev(`window.__resp`);
  seenRoutes.add(Dn.admission_route);
  if (!consistent(Dn) || Object.keys(Dn).length !== 89) { allConsistent = false; console.log('        inconsistent:', JSON.stringify(Dn)); }
}
check('10 more debug runs (1 and fail): all consistent; at least 2 different admission routes seen', allConsistent && seenRoutes.size >= 2, [...seenRoutes].join(','));

// Debug=fail
await ev('sessionStorage.clear()'); logs.length = 0; await nav(BASE + '?debug=fail');
await click('#debug-fill');
const D2 = await ev(`window.__resp`);
check('debug=fail attention_check is wrong (5), passed=false, background filled', D2.attention_check === 5 && D2.attention_passed === false && (await visible()) === 'results' && consistent(D2));

const errs = logs.filter((l) => l.type === 'EXCEPTION' || l.type === 'error');
check('no JS errors', errs.length === 0, errs.length ? JSON.stringify(errs).slice(0, 300) : '');

const failed = results.filter((r) => !r).length;
console.log(`
${results.length - failed}/${results.length} checks passed`);
try { await Promise.race([send('Browser.close'), sleep(2000)]); } catch {} // only the browser this test started (own profile); never kill Chrome by name
ws.close(); chrome.kill();
await sleep(300);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
site.cleanup();
process.exit(failed ? 1 : 0);
