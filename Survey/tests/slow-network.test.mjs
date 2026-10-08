// Slow-network check: how long until the opening screen is usable on a throttled connection?
//
//   node tests/slow-network.test.mjs
//
// Serves the BUILT site (what GitHub Pages publishes: scripts bundled into one file) gzipped under /Chaguo/, throttles the browser with
// Chrome's network emulation, and measures the time from navigation until the "I'm 18 or older" button is on
// screen and clickable. Caches are off, so this is a first visit. It prints the numbers and fails only if the
// first-visit time on the main "slow 3G" profile is over the limit below.
//
// Caveat: the local server speaks HTTP/1.1 (GitHub Pages speaks HTTP/2, which is a little better for many
// small files), and the throttle is Chrome's emulation, not a real phone. Treat the numbers as a guide.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './lib/cdp.mjs';
import { serveUnderPrefix, makeSiteCopy } from './lib/site.mjs';
import { buildSite } from '../scripts/build-site.mjs';

const LIMIT_MS = 3000; // main profile must make the opening screen usable within this

// latency = extra delay per request (ms); kbps = bandwidth each way
const PROFILES = [
  { name: 'no throttling (baseline)', latency: 0, kbps: 0, gate: false },
  { name: 'Fast 3G   (1.6 Mbps, 150 ms)', latency: 150, kbps: 1600, gate: false },
  { name: 'Slow 3G   (400 kbps, 400 ms)', latency: 400, kbps: 400, gate: true },
  { name: 'Very slow (400 kbps, 2000 ms; Chrome DevTools "Slow 3G" preset)', latency: 2000, kbps: 400, gate: false }
];

const site = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chaguo-slow-')), 'chaguo-site');
// Built the way the workflow builds it (scripts bundled into js/survey.js), from a temp copy with a blank
// endpoint, so nothing here could ever reach the real Sheet.
const src = makeSiteCopy();
src.configure({ endpoint: '' });
const built = buildSite(site, src.dir);
const server = await serveUnderPrefix(site, '/Chaguo/', { gzip: true });
const b = await launchBrowser();
const { ev, nav, send } = b;
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log((cond ? '  ok    ' : '  FAIL  ') + name + (extra ? '  ' + extra : '')); };

async function measure(profile) {
  await send('Network.emulateNetworkConditions', {
    offline: false, latency: profile.latency,
    downloadThroughput: profile.kbps ? (profile.kbps * 1024) / 8 : -1,
    uploadThroughput: profile.kbps ? (profile.kbps * 1024) / 8 : -1
  });
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  server.log.length = 0;
  const t0 = Date.now();
  await send('Page.navigate', { url: `http://127.0.0.1:${server.port}/Chaguo/` });
  let usable = null; let firstPaint = null;
  const deadline = t0 + 60000;
  while (Date.now() < deadline) {
    try {
      const r = await ev(`(()=>{const b=document.getElementById('start-agree'); const fp=performance.getEntriesByName('first-contentful-paint')[0]; return {usable: !!b && b.offsetParent!==null && b.getBoundingClientRect().height>0, fcp: fp?Math.round(fp.startTime):null};})()`);
      if (r.fcp && firstPaint === null) firstPaint = r.fcp;
      if (r.usable) { usable = Date.now() - t0; break; }
    } catch {}
    await sleep(50);
  }
  const bytes = server.log.length;
  return { usable, firstPaint, requests: bytes };
}

console.log(`\n  Published site: ${built.files.length} files, ${(built.bytes / 1024).toFixed(0)} KB on disk (a visitor downloads about 73 KB gzipped on the opening screen)`);
console.log('  Time until the opening screen is usable (first visit, no cache):\n');
for (const p of PROFILES) {
  const runs = [await measure(p), await measure(p)];
  const usable = Math.min(...runs.map((r) => r.usable ?? Infinity));
  const fcp = Math.min(...runs.map((r) => r.firstPaint ?? Infinity));
  console.log(`    ${p.name.padEnd(66)} usable ${(usable / 1000).toFixed(1)} s   (first paint ${Number.isFinite(fcp) ? (fcp / 1000).toFixed(1) + ' s' : 'n/a'}, ${runs[0].requests} requests)`);
  if (p.gate) check(`opening screen usable within ${LIMIT_MS / 1000} s on ${p.name.trim()}`, usable <= LIMIT_MS, `${(usable / 1000).toFixed(1)} s`);
}
console.log('');
check('the survey needed no more than 5 requests for the opening screen (page, css, one script, logo, icon)', server.log.length <= 5, `${server.log.length}`);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await b.close();
await server.close();
src.cleanup();
try { fs.rmSync(path.dirname(site), { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);
