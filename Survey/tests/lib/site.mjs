// Test helpers: a throwaway COPY of the survey whose js/config.js the test controls, so no test can ever
// send anything to the real Google Sheet (the real endpoint in the repo's config.js is never used), and a
// small static server that publishes a folder under a sub-path like GitHub Pages does.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SURVEY_DIR = path.join(here, '..', '..');
const REAL_CONFIG = fs.readFileSync(path.join(SURVEY_DIR, 'js', 'config.js'), 'utf8');
export const REAL_SURVEY_URL = (REAL_CONFIG.match(/var SURVEY_URL = "([^"]*)"/) || [])[1] || '';
export const REAL_CONSENT_VERSION = (REAL_CONFIG.match(/var CONSENT_VERSION = "([^"]*)"/) || [])[1] || '';

// The files the live site needs (the same list scripts/build-site.mjs publishes).
const RUNTIME = ['index.html', 'css', 'js', 'assets'];

export function makeSiteCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaguo-survey-'));
  for (const entry of RUNTIME) fs.cpSync(path.join(SURVEY_DIR, entry), path.join(dir, entry), { recursive: true });
  const indexSrc = fs.readFileSync(path.join(SURVEY_DIR, 'index.html'), 'utf8');

  // open: true | false | 'omit' (no SURVEY_OPEN line at all) | any other value (written as a string).
  // endpoint: '' = saving off. connectOrigin: an extra origin the page's CSP must allow (the mock endpoint);
  // the only change made to the shipped CSP, and only in this copy.
  function configure({ endpoint = '', sendMode = 'cors', open = true, connectOrigin = null } = {}) {
    fs.writeFileSync(path.join(dir, 'js', 'config.js'),
      `var SURVEY_ENDPOINT = ${JSON.stringify(endpoint)};\nvar SEND_MODE = ${JSON.stringify(sendMode)};\n` +
      `var SURVEY_URL = ${JSON.stringify(REAL_SURVEY_URL)};\n` +
      (open === 'omit' ? '' : `var SURVEY_OPEN = ${typeof open === 'boolean' ? open : JSON.stringify(open)};\n`) +
      `var CONSENT_VERSION = ${JSON.stringify(REAL_CONSENT_VERSION)};\n`);
    let html = indexSrc;
    if (connectOrigin) {
      if (!html.includes('connect-src https://script.google.com')) throw new Error('CSP connect-src not found in index.html');
      html = html.replace('connect-src https://script.google.com', `connect-src ${connectOrigin} https://script.google.com`);
    }
    fs.writeFileSync(path.join(dir, 'index.html'), html);
  }
  configure();
  return {
    dir,
    fileUrl: pathToFileURL(path.join(dir, 'index.html')).href,
    configure,
    cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

// Serve `dir` under `prefix` (e.g. '/Chaguo/'). Text files are gzipped, like GitHub Pages. Everything
// else is a 404. Records every request in `log` as { url, status }.
export async function serveUnderPrefix(dir, prefix = '/Chaguo/', { gzip = true, host = '127.0.0.1' } = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let status = 404; let body = Buffer.from('not found'); let type = 'text/plain';
    if (url.pathname.startsWith(prefix)) {
      const rel = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
      const file = path.join(dir, rel);
      if (file.startsWith(dir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        status = 200; body = fs.readFileSync(file); type = TYPES[path.extname(file)] || 'application/octet-stream';
      }
    }
    const headers = { 'Content-Type': type };
    if (gzip && status === 200 && /^text\/|javascript/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      body = zlib.gzipSync(body); headers['Content-Encoding'] = 'gzip';
    }
    log.push({ url: url.pathname + url.search, status });
    res.writeHead(status, headers);
    res.end(body);
  });
  await new Promise((r) => server.listen(0, host, r));
  return { port: server.address().port, log, close: () => new Promise((r) => server.close(r)) };
}
