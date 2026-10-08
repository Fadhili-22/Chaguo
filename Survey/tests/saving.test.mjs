// Browser test for saving (phase 3): a real headless browser fills in the survey while a small local
// "mock endpoint" stands in for the Google Apps Script web app.
//
//   node tests/saving.test.mjs
//
// How it works: the survey is copied to a temp folder and that copy's js/config.js is rewritten to point
// at the mock (so the real config path is what gets tested, and the production code has no test hooks).
// Needs Node 22+ and Chrome or Edge, like tests/browser.test.mjs. Nothing to install.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, sleep } from './lib/cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..');
const COPY = fs.mkdtempSync(path.join(os.tmpdir(), 'chaguo-survey-'));
for (const entry of ['index.html', 'css', 'js', 'assets']) fs.cpSync(path.join(SRC, entry), path.join(COPY, entry), { recursive: true });
const BASE = pathToFileURL(path.join(COPY, 'index.html')).href;
const QUEUE_KEY = 'chaguo_send_queue_v1';

// ---- The mock endpoint -----------------------------------------------------------------------
// Modes: ok | ok-no-cors-headers (stores, but the browser may not read the reply) | fail (HTTP 500) |
//        reject ({ok:false}) | down (connection dropped)
const mock = { mode: 'ok', failFirst: 0, requests: [], stored: [], url: '' };
const STORING = ['ok', 'ok-no-cors-headers'];
const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') { // a preflight: the survey must never cause one
    mock.requests.push({ method: 'OPTIONS', headers: req.headers });
    res.writeHead(204, { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' });
    return res.end();
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    let mode = mock.mode;
    if (mock.failFirst > 0) { mock.failFirst--; mode = 'fail'; }
    let parsed = null;
    try { parsed = JSON.parse(body); } catch {}
    mock.requests.push({ method: req.method, contentType: req.headers['content-type'], body: parsed, mode });
    if (mode === 'down') return req.socket.destroy();
    if (STORING.includes(mode) && parsed) mock.stored.push(parsed);
    if (mode === 'fail') { res.writeHead(500, cors); return res.end('server error'); }
    if (mode === 'reject') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end('{"ok":false,"error":"nope"}'); }
    res.writeHead(200, mode === 'ok' ? { ...cors, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
mock.url = `http://127.0.0.1:${server.address().port}/exec`;
const resetMock = (mode = 'ok') => { mock.mode = mode; mock.failFirst = 0; mock.requests.length = 0; mock.stored.length = 0; };

function setConfig(endpoint, sendMode = 'cors') {
  fs.writeFileSync(path.join(COPY, 'js', 'config.js'),
    `var SURVEY_ENDPOINT = ${JSON.stringify(endpoint)};\nvar SEND_MODE = ${JSON.stringify(sendMode)};\nvar CONSENT_VERSION = "2026-10-v1";\n`);
}

// ---- Browser helpers -------------------------------------------------------------------------
const b = await launchBrowser();
const { ev, nav, logs } = b;
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log((cond ? '  ok    ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); };
const visible = () => ev(`[...document.querySelectorAll('[data-screen]')].filter(e=>!e.hidden).map(e=>e.dataset.screen).join(',')`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const change = (sel, extra = '') => `(()=>{const i=document.querySelector(${JSON.stringify(sel)}); i.checked=true; i.dispatchEvent(new Event('change',{bubbles:true}));${extra}})()`;
const answerAll = (v) => ev(`document.querySelectorAll('#items-list .item').forEach(fs=>{const i=fs.querySelector('input[value="${v}"]'); i.checked=true; i.dispatchEvent(new Event('change',{bubbles:true}));})`);
const pick = (name, value) => ev(change(`#background-list input[name="${name}"][value="${value}"]`));
const typeIn = (name, text) => ev(`(()=>{const i=document.querySelector('#background-list input[name="${name}"]'); i.value=${JSON.stringify(text)}; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const queue = () => ev(`sessionStorage.getItem('${QUEUE_KEY}')`);
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(40); }
  return false;
}
const storedCount = (n) => waitFor(() => mock.stored.length >= n);
const filled = (o) => Object.values(o).filter((v) => v !== '').length;

async function freshStart(url = BASE) {
  await nav(BASE); // a page of ours, so sessionStorage can be cleared
  await ev('sessionStorage.clear()');
  await nav(url);
}
async function agree() { await click('#start-agree'); }
async function itemScreen(n) {
  await answerAll(3);
  if (n === 4) await ev(change('input[name=attention_check][value="1"]'));
  await click('#items-next');
}
async function screen7() {
  await typeIn('course', '  BSc Computer Science  ');
  await pick('uni_type', 'private'); await pick('year_of_study', 'year_3');
  await pick('admission_route', 'direct'); await pick('switched_course', 'no');
  await click('#background-next');
}
async function screen8() {
  await pick('satisfaction', '4'); await pick('choose_again', 'yes'); await pick('gender', 'male'); await pick('age_band', '21_23');
  await click('#background-next');
}
// Walk the whole survey; if `expectSaves` is a number, wait for that many stored snapshots after each Next.
async function walk(waitEach = false) {
  let want = mock.stored.length;
  for (let s = 1; s <= 6; s++) { await itemScreen(s); if (waitEach) await storedCount(++want); }
  await screen7(); if (waitEach) await storedCount(++want);
  await screen8(); if (waitEach) await storedCount(want + 2); // screen_8, then complete
}
const refCode = () => ev(`document.getElementById('results-ref-code').textContent`);
const failedMsgVisible = () => ev(`!document.getElementById('results-save-failed').hidden`);

console.log('\n  -- saving off (SURVEY_ENDPOINT is empty) --');
{
  setConfig('');
  logs.length = 0;
  await freshStart(); await agree(); await walk();
  check('reaches results', (await visible()) === 'results');
  check('no network request is made and no saving message appears', mock.requests.length === 0 && !(await failedMsgVisible()));
  const snaps = logs.filter((l) => l.type === 'log' && l.args[0] && /saving is off/.test(String(l.args[0].value || ''))).length;
  check('each snapshot is console.logged instead (8 screens + complete = 9)', snaps === 9, `got ${snaps}`);
  const id = await ev(`window.ChaguoSender.enabled()`);
  check('Sender reports saving disabled', id === false);
  check('reference code is shown (8 characters)', /^[0-9a-f]{8}$/.test(await refCode()));
}

console.log('\n  -- consent: nothing is sent before agreeing, or ever for under-18s --');
{
  setConfig(mock.url); resetMock();
  await freshStart();
  await sleep(500);
  check('opening screen: nothing sent', mock.requests.length === 0);
  await ev(`window.dispatchEvent(new Event('pagehide')); document.dispatchEvent(new Event('visibilitychange'))`);
  await sleep(300);
  check('closing the page on the opening screen: still nothing', mock.requests.length === 0);
  await click('#start-underage');
  await sleep(500);
  check('under 18: exit screen, nothing sent', (await visible()) === 'exit' && mock.requests.length === 0);
  await ev(`window.dispatchEvent(new Event('pagehide'))`);
  await nav(BASE);
  await sleep(400);
  check('under 18 after a refresh: still nothing, no queue stored', mock.requests.length === 0 && (await queue()) === null);

  await freshStart(); await agree(); await sleep(500);
  check('after agreeing but before completing a screen: nothing sent yet', mock.requests.length === 0);
  await ev(`window.dispatchEvent(new Event('pagehide'))`);
  await sleep(300);
  check('closing the page before any screen is complete: nothing sent', mock.requests.length === 0);
}

console.log('\n  -- normal run (SEND_MODE "cors") --');
{
  setConfig(mock.url, 'cors'); resetMock('ok');
  await freshStart(); await agree();
  await walk(true);
  check('reaches results', (await visible()) === 'results');
  const S = mock.stored;
  check('9 snapshots: one per completed screen (1-8) plus "complete"', S.length === 9, `got ${S.length}`);
  check('stages in order', JSON.stringify(S.map((s) => s.stage)) === JSON.stringify(['screen_1', 'screen_2', 'screen_3', 'screen_4', 'screen_5', 'screen_6', 'screen_7', 'screen_8', 'complete']), JSON.stringify(S.map((s) => s.stage)));
  check('every snapshot is full: 89 fields, schema "3", same response_id, never null', S.every((s) => Object.keys(s).length === 89 && s.schema_version === '3' && s.response_id === S[0].response_id && Object.values(s).every((v) => v !== null && v !== undefined)));
  check('snapshots grow: each of screens 1-8 has more filled fields than the one before', S.slice(0, 8).every((s, i) => i === 0 || filled(s) > filled(S[i - 1])), S.map(filled).join(','));
  check('"complete" has at least as much as screen_8, is_complete yes, finished_at, scores and code', filled(S[8]) >= filled(S[7]) && S[8].is_complete === 'yes' && S[8].finished_at !== '' && S[8].score_R === 24 && S[8].holland_code === 'RIA');
  check('earlier snapshots say is_complete "no" with no finished_at', S.slice(0, 8).every((s) => s.is_complete === 'no' && s.finished_at === ''));
  check('screen_1 snapshot: first eight items answered, rest ""', S[0].R1 === 3 && S[0].I2 === 3 && S[0].A2 === '' && S[0].course === '' && S[0].score_R === '');
  check('screen_4 snapshot includes the attention check', S[3].attention_check === 1 && S[3].attention_passed === true && S[2].attention_check === '');
  check('screen_7 snapshot has the course (trimmed); screen_6 does not', S[6].course === 'BSc Computer Science' && S[6].uni_type === 'private' && S[5].course === '');
  check('is_test is "yes" (the page runs from a local file), consent_version is set', S.every((s) => s.is_test === 'yes' && s.consent_version === '2026-10-v1'));
  check('client_sent_at is an ISO time and does not go backwards', S.every((s, i) => /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(s.client_sent_at) && (i === 0 || s.client_sent_at >= S[i - 1].client_sent_at)));
  const posts = mock.requests.filter((r) => r.method === 'POST');
  check('sent as Content-Type text/plain (a simple request)', posts.length >= 9 && posts.every((r) => /^text\/plain/.test(r.contentType)), posts[0] && posts[0].contentType);
  check('no preflight (OPTIONS) request was ever made', !mock.requests.some((r) => r.method === 'OPTIONS'));
  check('on results: no saving message, queue empty', !(await failedMsgVisible()) && (await queue()) === null);
  const code = await refCode();
  check('reference code = first 8 characters of response_id', code === S[0].response_id.slice(0, 8) && code.length === 8, code);
  check('the reference line reads as agreed', await ev(`(()=>{const t=document.getElementById('results-ref').textContent; return t===('Your reference code: ${code}. To have your answers deleted, email njenga.munyua@strathmore.edu with this code.');})()`));
  check('the old "Phase 1 test build" note is gone', await ev(`!/Phase 1|not been saved/.test(document.body.textContent)`));
  check('only ONE response_id was ever used', new Set(S.map((s) => s.response_id)).size === 1);
}

console.log('\n  -- a failing endpoint is retried and the queue drains --');
{
  setConfig(mock.url, 'cors'); resetMock('ok');
  mock.failFirst = 2; // the first two sends (screens 1 and 2) fail with HTTP 500
  await freshStart(); await agree();
  await itemScreen(1);
  await waitFor(() => mock.requests.filter((r) => r.method === 'POST').length >= 1);
  await sleep(150);
  check('after screen 1 failed: respondent is not blocked (on screen 2), snapshot waits in the queue', (await ev(`document.getElementById('items-progress-label').textContent`)) === 'Screen 2 of 8' && (await queue()) !== null && mock.stored.length === 0);
  check('queue holds exactly one snapshot (screen_1)', await ev(`(()=>{const q=JSON.parse(sessionStorage.getItem('${QUEUE_KEY}')); return q.snapshot.stage==='screen_1';})()`));
  await itemScreen(2);
  await waitFor(() => mock.requests.filter((r) => r.method === 'POST').length >= 2);
  await sleep(150);
  check('after screen 2 failed too: still one queued snapshot, now the newer one (screen_2)', await ev(`(()=>{const q=JSON.parse(sessionStorage.getItem('${QUEUE_KEY}')); return q.snapshot.stage==='screen_2';})()`));
  await itemScreen(3);
  await storedCount(1);
  await waitFor(async () => (await queue()) === null);
  check('screen 3 send succeeds: queue drained', (await queue()) === null && mock.stored.length === 1);
  check('what arrived is the newest, full snapshot (screen_3 with screens 1 and 2 inside); the older ones are not sent separately', mock.stored[0].stage === 'screen_3' && mock.stored[0].R1 === 3 && mock.stored[0].A2 === 3 && mock.stored[0].E3 === 3);
  // Refresh with something queued: the queue survives and is sent with the next snapshot
  mock.mode = 'down';
  await itemScreen(4);
  await sleep(300);
  await nav(BASE);
  check('after a refresh the queue is still there (and the survey resumes)', (await queue()) !== null && (await visible()) === 'items');
  mock.mode = 'ok';
  await itemScreen(5);
  await storedCount(2);
  await waitFor(async () => (await queue()) === null);
  check('next send after the refresh succeeds and drains the queue', mock.stored.length === 2 && mock.stored[1].stage === 'screen_5' && (await queue()) === null);
}

console.log('\n  -- final save fails: calm message, button works --');
{
  setConfig(mock.url, 'cors'); resetMock('down');
  await freshStart(); await agree();
  await walk();
  check('results still appear', (await visible()) === 'results' && /^[RIASEC]{3}$/.test(await ev(`document.getElementById('results-code').textContent`)));
  await waitFor(() => failedMsgVisible());
  check('save-failed message is shown', await failedMsgVisible());
  const msg = await ev(`document.getElementById('results-save-failed').textContent.replace(/\\s+/g,' ').trim()`);
  check('message is calm and offers "Try saving again"', /couldn't save your answers/.test(msg) && /Try saving again/.test(msg) && !/error|fail(ed|ure)|!/i.test(msg.replace('Try saving again', '')), msg);
  check('the snapshot is queued (so the reference code matches a response that will be saved)', await ev(`JSON.parse(sessionStorage.getItem('${QUEUE_KEY}')).snapshot.stage==='complete'`));
  const ref = await refCode();
  await click('#results-retry');
  await sleep(500);
  check('retry while the endpoint is still down: message stays, button usable again', (await failedMsgVisible()) && (await ev(`!document.getElementById('results-retry').disabled`)));
  mock.mode = 'ok';
  await click('#results-retry');
  await storedCount(1);
  await waitFor(async () => !(await failedMsgVisible()));
  check('retry after the endpoint is back: message disappears, queue empty', !(await failedMsgVisible()) && (await queue()) === null);
  check('the stored row is the complete snapshot and its response_id starts with the reference code', mock.stored.length === 1 && mock.stored[0].stage === 'complete' && mock.stored[0].is_complete === 'yes' && mock.stored[0].response_id.slice(0, 8) === ref);
}

console.log('\n  -- the server refuses the data ({ok:false}) --');
{
  setConfig(mock.url, 'cors'); resetMock('reject');
  await freshStart(); await agree();
  await walk();
  await waitFor(() => failedMsgVisible());
  check('refusal shows the same calm message', await failedMsgVisible());
  await click('#results-retry'); await sleep(400);
  await click('#results-retry'); await sleep(400);
  check('after 3 refusals the snapshot is dropped from the queue (retrying cannot help)', (await queue()) === null);
  const posts = mock.requests.filter((r) => r.method === 'POST' && r.body && r.body.stage === 'complete').length;
  check('the complete snapshot was tried exactly 3 times', posts === 3, `got ${posts}`);
  check('the message stays so the respondent knows', await failedMsgVisible());
}

console.log('\n  -- when Google\'s reply cannot be read: "cors" vs "no-cors" --');
{
  // The mock saves the rows but sends no CORS headers, like an Apps Script reply the page cannot read.
  setConfig(mock.url, 'cors'); resetMock('ok-no-cors-headers');
  await freshStart(); await agree();
  await walk();
  await storedCount(9);
  await waitFor(() => failedMsgVisible());
  check('SEND_MODE "cors": rows arrive, but the page cannot read the reply, so it reports a failure', mock.stored.length >= 9 && (await failedMsgVisible()));

  setConfig(mock.url, 'no-cors'); resetMock('ok-no-cors-headers');
  await freshStart(); await agree();
  await walk(true);
  check('SEND_MODE "no-cors": all 9 snapshots arrive', mock.stored.length === 9, `got ${mock.stored.length}`);
  await sleep(300);
  check('SEND_MODE "no-cors": a request that completes counts as saved - queue empty, no message', (await visible()) === 'results' && !(await failedMsgVisible()) && (await queue()) === null);
  check('SEND_MODE "no-cors": still text/plain, still no preflight', mock.requests.filter((r) => r.method === 'POST').every((r) => /^text\/plain/.test(r.contentType)) && !mock.requests.some((r) => r.method === 'OPTIONS'));

  setConfig(mock.url, 'no-cors'); resetMock('down');
  await freshStart(); await agree();
  await walk();
  await waitFor(() => failedMsgVisible());
  check('SEND_MODE "no-cors": a real network error still counts as a failure', await failedMsgVisible() && (await queue()) !== null);
  mock.mode = 'ok-no-cors-headers';
  await click('#results-retry');
  await storedCount(1);
  await waitFor(async () => !(await failedMsgVisible()));
  check('SEND_MODE "no-cors": retry works once the endpoint is back', !(await failedMsgVisible()) && (await queue()) === null);

  setConfig(mock.url, 'something-else'); resetMock('ok');
  await freshStart(); await agree();
  await walk();
  await storedCount(9);
  await sleep(200);
  check('an unrecognised SEND_MODE behaves as "cors"', mock.stored.length === 9 && !(await failedMsgVisible()));
}

console.log('\n  -- leaving the page mid-survey (sendBeacon) --');
{
  setConfig(mock.url, 'cors'); resetMock('ok');
  await freshStart(); await agree();
  await itemScreen(1);
  await storedCount(1);
  await waitFor(async () => (await queue()) === null); // the page has seen the reply
  const before = mock.requests.length;
  await ev(`window.dispatchEvent(new Event('pagehide'))`);
  await sleep(300);
  check('closing straight after a snapshot with nothing new: no extra send', mock.requests.length === before);
  await ev(change('#items-list input[name=A2][value="5"]'));
  await ev(`window.dispatchEvent(new Event('pagehide'))`);
  await storedCount(2);
  const last = mock.stored[1];
  check('answers given since the last snapshot are beaconed', !!last && last.stage === 'screen_1' && last.A2 === 5 && last.R1 === 3 && last.is_complete === 'no');
  check('the beacon is text/plain too, and made no preflight', /^text\/plain/.test(mock.requests[mock.requests.length - 1].contentType) && !mock.requests.some((r) => r.method === 'OPTIONS'));
  await ev(`document.dispatchEvent(new Event('visibilitychange'))`);
  await sleep(200);
  check('the same answers are not beaconed twice', mock.stored.length === 2);
  // A snapshot that never got through is beaconed on leaving
  mock.mode = 'down';
  await itemScreen(2);
  await sleep(300);
  mock.mode = 'ok';
  await ev(`window.dispatchEvent(new Event('pagehide'))`);
  await storedCount(3);
  check('a snapshot still waiting in the queue is beaconed when the page is closed', mock.stored.length === 3 && mock.stored[2].stage === 'screen_2');
  // On the results screen the beacon is not used
  setConfig(mock.url, 'cors'); resetMock('ok');
  await freshStart(); await agree(); await walk(true);
  const n = mock.requests.length;
  await ev(`window.dispatchEvent(new Event('pagehide'))`);
  await sleep(300);
  check('on the results screen leaving the page sends nothing more', mock.requests.length === n);
}

const errs = logs.filter((l) => l.type === 'EXCEPTION' || l.type === 'error');
check('no JS errors', errs.length === 0, errs.length ? JSON.stringify(errs).slice(0, 400) : '');

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await b.close();
server.close();
try { fs.rmSync(COPY, { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);
