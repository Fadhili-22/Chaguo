// Run with:  node tests/deploy.test.js   (from the Survey/ folder)
// Checks what gets PUBLISHED: the build output, the paths in index.html, the share tags, the security policy.
// Pure Node, no browser. (tests/live.test.mjs checks the same things in a real browser, under /Chaguo/.)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const SURVEY = path.join(__dirname, '..');
const LIVE_URL = 'https://fadhili-22.github.io/Chaguo/'; // the address this survey is published at
const read = (p) => fs.readFileSync(path.join(SURVEY, p), 'utf8');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok    ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); failed++; }
}

const html = read('index.html');
const config = read('js/config.js');
const configVar = (name) => {
  const m = config.match(new RegExp('var ' + name + ' = ("[^"]*"|true|false);'));
  return m ? JSON.parse(m[1]) : undefined;
};
const meta = (attr, name) => {
  const m = html.match(new RegExp('<meta ' + attr + '="' + name + '" content="([^"]*)"'));
  return m ? m[1] : undefined;
};
const pngSize = (file) => {
  const b = fs.readFileSync(file);
  assert.strictEqual(b.slice(1, 4).toString(), 'PNG', file + ' is not a PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
};

(async () => {
  const { buildSite, RUNTIME } = await import('../scripts/build-site.mjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'chaguo-build-'));
  const site = path.join(out, 'chaguo-site');
  const built = buildSite(site);
  const builtHtml = fs.readFileSync(path.join(site, 'index.html'), 'utf8');

  console.log('What gets published');

  test('the build contains only index.html, css/, js/ and assets/', () => {
    const tops = [...new Set(built.files.map((f) => f.split('/')[0]))].sort();
    assert.deepStrictEqual(tops, RUNTIME.slice().sort());
    assert.deepStrictEqual(RUNTIME.slice().sort(), ['assets', 'css', 'index.html', 'js']);
  });

  test('no tests, Apps Script, scripts, docs or other repo files are published', () => {
    const bad = built.files.filter((f) => /^(tests|apps-script|scripts|_site)\//.test(f) ||
      /\.(md|mjs|gs|yml|yaml|json|jpe?g|csv|map)$/i.test(f) || /(^|\/)(README|LAUNCH|CLAUDE)/i.test(f));
    assert.deepStrictEqual(bad, []);
  });

  test('every stylesheet, script and image the PUBLISHED index.html uses is in the build, with relative paths', () => {
    const refs = [...builtHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !/^(https?:|mailto:|#)/.test(r));
    assert.ok(refs.length >= 4, 'found ' + refs.length + ' local references');
    refs.forEach((r) => {
      assert.ok(!r.startsWith('/'), 'root-relative path breaks under /Chaguo/: ' + r);
      assert.ok(built.files.includes(r), 'missing from build: ' + r);
    });
  });

  console.log('\nBundling (one script file in the published site)');

  const sourceScripts = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map((m) => m[1]);
  const bundle = fs.readFileSync(path.join(site, 'js', 'survey.js'), 'utf8');

  test('the source index.html loads several scripts; the published one loads only js/survey.js', () => {
    assert.ok(sourceScripts.length >= 7, 'source scripts: ' + sourceScripts.join(', '));
    assert.deepStrictEqual([...builtHtml.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ['js/survey.js']);
    assert.deepStrictEqual(built.files.filter((f) => f.startsWith('js/')), ['js/survey.js']);
    assert.deepStrictEqual(built.scripts, sourceScripts);
  });

  test('the bundle is plain concatenation: every source file is in it, whole, in the same order', () => {
    let at = 0;
    sourceScripts.forEach((s) => {
      const body = read(s).replace(/\r\n/g, '\n');
      const i = bundle.indexOf(body, at);
      assert.ok(i >= at, s + ' is missing from the bundle or out of order');
      at = i + body.length;
    });
  });

  test('the bundle is valid JavaScript, and no script is loaded twice or missing from index.html', () => {
    new (require('vm').Script)(bundle);
    const onDisk = fs.readdirSync(path.join(SURVEY, 'js')).map((f) => 'js/' + f).sort();
    assert.deepStrictEqual(onDisk, sourceScripts.slice().sort(), 'a file in js/ is not loaded by index.html (or the reverse)');
  });

  test('the published index.html differs from the source only in its script tags', () => {
    const strip = (h) => h.replace(/\r\n/g, '\n').replace(/[ \t]*<script src="[^"]+"><\/script>\n?/g, '');
    assert.strictEqual(strip(builtHtml), strip(html));
  });

  test('the build refuses a stray file type (e.g. a photo dropped into assets/)', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'chaguo-src-'));
    RUNTIME.forEach((e) => fs.cpSync(path.join(SURVEY, e), path.join(src, e), { recursive: true }));
    fs.writeFileSync(path.join(src, 'assets', 'photo.jpeg'), 'x');
    assert.throws(() => buildSite(path.join(out, 'chaguo-bad'), src), /Unexpected file type/);
    fs.rmSync(src, { recursive: true, force: true });
  });

  test('the build refuses to overwrite a folder that is not empty and not _site', () => {
    const victim = path.join(out, 'important');
    fs.mkdirSync(victim);
    fs.writeFileSync(path.join(victim, 'keep.txt'), 'x');
    assert.throws(() => buildSite(victim), /Refusing to overwrite/);
    assert.ok(fs.existsSync(path.join(victim, 'keep.txt')));
  });

  test('the workflow publishes only the built _site folder, on push to main for Survey/** and by hand', () => {
    const wf = fs.readFileSync(path.join(SURVEY, '..', '.github', 'workflows', 'deploy-survey.yml'), 'utf8');
    assert.ok(/branches: \[main\]/.test(wf));
    assert.ok(/'Survey\/\*\*'/.test(wf));
    assert.ok(/workflow_dispatch:/.test(wf));
    assert.ok(/node scripts\/build-site\.mjs _site/.test(wf));
    assert.ok(/path: Survey\/_site/.test(wf));
    assert.ok(!/path: (\.|Survey|Survey\/)\s*$/m.test(wf), 'must not upload the whole repo or Survey/');
    assert.ok(/pages: write/.test(wf) && /id-token: write/.test(wf));
  });

  console.log('\nPage weight');

  test('what a visitor downloads on the opening screen is under 300 KB (raw and gzipped)', () => {
    const fontUrls = [...read('css/styles.css').matchAll(/url\("\.\.\/(assets\/fonts\/[^"]+\.woff2)"\)/g)].map((m) => m[1]);
    const urls = ['index.html', 'css/styles.css', 'assets/chaguo-logo-transparent.png', 'assets/favicon-32.png']
      .concat(fontUrls)
      .concat([...builtHtml.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]));
    let raw = 0; let gz = 0;
    urls.forEach((u) => {
      const b = fs.readFileSync(path.join(site, u));
      raw += b.length; gz += /\.(html|css|js)$/.test(u) ? zlib.gzipSync(b).length : b.length;
    });
    console.log('        ' + urls.length + ' files: ' + (raw / 1024).toFixed(0) + ' KB raw, ' + (gz / 1024).toFixed(0) + ' KB gzipped');
    assert.ok(raw < 300 * 1024, 'raw ' + raw);
    assert.ok(gz < 300 * 1024, 'gzipped ' + gz);
  });

  console.log('\nConfig');

  test('config.js defines every setting with a sensible value', () => {
    assert.strictEqual(typeof configVar('SURVEY_ENDPOINT'), 'string');
    assert.ok(['cors', 'no-cors'].includes(configVar('SEND_MODE')));
    assert.strictEqual(typeof configVar('SURVEY_OPEN'), 'boolean');
    assert.ok(/^[A-Za-z0-9._-]{1,20}$/.test(configVar('CONSENT_VERSION')));
  });

  test('SURVEY_URL is the Pages address, ending in /, and app.js has no address of its own', () => {
    assert.strictEqual(configVar('SURVEY_URL'), LIVE_URL);
    assert.ok(!/SURVEY_URL_PLACEHOLDER/.test(read('js/app.js')));
    assert.ok(!/https?:\/\//.test(read('js/app.js').replace(/https:\/\/wa\.me\/\?text=/g, '')), 'unexpected web address in app.js');
  });

  test('the endpoint (when set) is a script.google.com /exec address', () => {
    const ep = configVar('SURVEY_ENDPOINT');
    if (ep !== '') assert.ok(/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(ep), ep);
  });

  console.log('\nSecurity policy (CSP)');

  const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1];
  const directives = {};
  (csp || '').split(';').map((d) => d.trim()).filter(Boolean).forEach((d) => {
    const parts = d.split(/\s+/);
    directives[parts[0]] = parts.slice(1);
  });

  test('a CSP meta tag exists and comes before any script or stylesheet', () => {
    assert.ok(csp, 'no CSP meta tag');
    assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf('<script'));
    assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf('<link rel="stylesheet"'));
  });

  test('default-src is none; scripts and styles only from the site itself', () => {
    assert.deepStrictEqual(directives['default-src'], ["'none'"]);
    assert.deepStrictEqual(directives['script-src'], ["'self'"]);
    assert.deepStrictEqual(directives['style-src'], ["'self'"]);
    assert.deepStrictEqual(directives['img-src'], ["'self'"]);
    assert.deepStrictEqual(directives['font-src'], ["'self'"]); // IBM Plex is self-hosted (assets/fonts/)
    assert.deepStrictEqual(directives['base-uri'], ["'none'"]);
    assert.deepStrictEqual(directives['form-action'], ["'none'"]);
    assert.ok(!/unsafe-inline|unsafe-eval|\*|http:/.test(csp));
  });

  test('the page may connect only to the two Apps Script hosts (the post and its redirect)', () => {
    assert.deepStrictEqual(directives['connect-src'].slice().sort(), ['https://script.google.com', 'https://script.googleusercontent.com']);
    const ep = configVar('SURVEY_ENDPOINT');
    if (ep) assert.ok(directives['connect-src'].includes(new URL(ep).origin), 'endpoint origin not allowed by connect-src');
  });

  test('nothing in the page would be blocked by that policy: no inline scripts, styles or handlers', () => {
    assert.ok(![...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].length, 'inline <script>');
    assert.ok(!/<style[\s>]/.test(html), 'inline <style>');
    assert.ok(!/\sstyle="/.test(html), 'style attribute');
    assert.ok(!/\son[a-z]+="/i.test(html), 'inline event handler');
    assert.ok(!/javascript:/i.test(html));
    ['app', 'sender', 'snapshot', 'background', 'scoring', 'items'].forEach((n) => {
      const js = read('js/' + n + '.js');
      assert.ok(!/\beval\(|new Function\(|setAttribute\(\s*['"]style|\.cssText|innerHTML|document\.write/.test(js),
        n + '.js uses something a strict policy blocks or that is unsafe');
    });
  });

  console.log('\nSharing and icons');

  test('Open Graph and Twitter tags are present, and their addresses are absolute and under the live URL', () => {
    ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].forEach((k) => assert.ok(meta('property', k), k));
    ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'].forEach((k) => assert.ok(meta('name', k), k));
    assert.strictEqual(meta('property', 'og:url'), LIVE_URL);
    assert.strictEqual(meta('property', 'og:url'), configVar('SURVEY_URL'));
    assert.strictEqual(meta('property', 'og:image'), LIVE_URL + 'assets/og-image.png');
    assert.strictEqual(meta('name', 'twitter:image'), LIVE_URL + 'assets/og-image.png');
    assert.strictEqual(meta('name', 'twitter:card'), 'summary_large_image');
  });

  test('the preview image exists in the build, is a 1200x630 PNG and small enough for WhatsApp (< 300 KB)', () => {
    assert.ok(built.files.includes('assets/og-image.png'));
    const s = pngSize(path.join(site, 'assets/og-image.png'));
    assert.deepStrictEqual([s.w, s.h], [1200, 630]);
    assert.ok(s.bytes < 300 * 1024, s.bytes + ' bytes');
    assert.strictEqual(meta('property', 'og:image:width'), '1200');
    assert.strictEqual(meta('property', 'og:image:height'), '630');
  });

  test('title and description are short enough for a link preview', () => {
    assert.ok(meta('property', 'og:title').length <= 60);
    assert.ok(meta('property', 'og:description').length <= 110, meta('property', 'og:description').length + ' chars');
  });

  test('favicon (32x32) and apple-touch-icon (180x180) are linked and exist', () => {
    assert.ok(/<link rel="icon" type="image\/png" sizes="32x32" href="assets\/favicon-32\.png">/.test(html));
    assert.ok(/<link rel="apple-touch-icon" href="assets\/apple-touch-icon\.png">/.test(html));
    const f = pngSize(path.join(site, 'assets/favicon-32.png'));
    const a = pngSize(path.join(site, 'assets/apple-touch-icon.png'));
    assert.deepStrictEqual([f.w, f.h, a.w, a.h], [32, 32, 180, 180]);
  });

  test('the published index.html carries the same security policy, share tags and noindex as the source', () => {
    const pick = (h) => ({
      csp: (h.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1],
      og: [...h.matchAll(/<meta (?:property|name)="(?:og|twitter):[^>]*>/g)].map((m) => m[0]),
      robots: /<meta name="robots" content="noindex">/.test(h)
    });
    assert.deepStrictEqual(pick(builtHtml), pick(html));
    assert.ok(pick(builtHtml).csp && pick(builtHtml).robots);
  });

  console.log('\nHouse rules');

  test('no test or script kills browsers by name (only processes a test started itself may be closed)', () => {
    const banned = new RegExp(['task' + 'kill', 'pk' + 'ill', 'kill' + 'all', 'Stop-' + 'Process'].join('|'), 'i');
    const files = [];
    const walkDir = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'screenshots') walkDir(p); } else if (/\.(m?js|ya?ml)$/.test(e.name)) files.push(p);
    });
    walkDir(path.join(SURVEY, 'tests')); walkDir(path.join(SURVEY, 'scripts')); walkDir(path.join(SURVEY, '..', '.github'));
    const offenders = files.filter((f) => path.basename(f) !== 'deploy.test.js' && banned.test(fs.readFileSync(f, 'utf8')));
    assert.deepStrictEqual(offenders.map((f) => path.relative(SURVEY, f)), []);
  });

  test('every browser the tests start uses its own throwaway profile folder, and is closed through the DevTools protocol', () => {
    ['tests/lib/cdp.mjs', 'tests/browser.test.mjs'].forEach((f) => {
      const src = read(f);
      assert.ok(/--user-data-dir=\$\{profile\}/.test(src), f + ' must launch Chrome with its own --user-data-dir');
      assert.ok(/mkdtempSync\(path\.join\(os\.tmpdir\(\), 'chaguo-chrome-'\)\)/.test(src), f + ' must create the profile with mkdtempSync');
      assert.ok(/Browser\.close/.test(src), f + ' must close its browser with Browser.close (on its own handle)');
    });
  });

  console.log('\nPage basics');

  test('noindex, viewport, language, noscript message and the closed screen are present', () => {
    assert.ok(/<meta name="robots" content="noindex">/.test(html));
    assert.ok(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html));
    assert.ok(/<html lang="en">/.test(html));
    assert.ok(/<noscript>[\s\S]*Opera Mini[\s\S]*<\/noscript>/.test(html));
    assert.ok(/id="screen-closed"[\s\S]*This survey has now closed\. Thank you for your interest\./.test(html));
  });

  test('the logo copies in Survey/ and Web-App/ are still byte-identical (brand rule)', () => {
    ['chaguo-logo.png', 'chaguo-logo-transparent.png'].forEach((n) => {
      const a = path.join(SURVEY, 'assets', n);
      const b = path.join(SURVEY, '..', 'Web-App', 'assets', n);
      if (fs.existsSync(b)) assert.ok(fs.readFileSync(a).equals(fs.readFileSync(b)), n);
    });
  });

  fs.rmSync(out, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
