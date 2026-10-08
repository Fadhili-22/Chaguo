// Builds the folder that gets published to GitHub Pages: ONLY what the live survey needs.
//
//   node scripts/build-site.mjs [outDir]        (outDir defaults to _site, next to this script's parent)
//
// Used by .github/workflows/deploy-survey.yml and by the live/deploy/slow-network tests, so there is one
// definition of "what is published". Anything not listed in RUNTIME (tests/, apps-script/, scripts/, *.md, ...)
// never leaves the repo. No npm packages needed.
//
// BUNDLING: in the repo, index.html loads the scripts one by one (js/config.js, js/items.js, ...). In the
// published copy those are joined, in the same order, into ONE file, js/survey.js, and index.html loads just
// that. Fewer requests = a much faster first load on slow phones. The source files stay split; the bundle is
// plain concatenation (no minifying, no rewriting), so it behaves exactly like the separate files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SURVEY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME = ['index.html', 'css', 'js', 'assets']; // the whole allow-list
const ALLOWED_EXT = new Set(['.html', '.css', '.js', '.png', '.svg', '.ico', '.jpg', '.webp', '.woff2', '.txt']); // .txt = the font licence (assets/fonts/OFL.txt)
const JUNK = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

const SCRIPT_TAG = /[ \t]*<script src="(js\/[^"]+\.js)"><\/script>[ \t]*\r?\n?/g;
export const BUNDLE = 'js/survey.js';

// Joins the scripts named in `html` (in order) into one text, and returns the html pointing at it instead.
// Each file is separated by a newline and a semicolon, so one file can never run into the next.
export function bundleScripts(html, readFile) {
  const names = [...html.matchAll(SCRIPT_TAG)].map((m) => m[1]);
  if (names.length < 2) throw new Error('Expected several <script src="js/..."> tags in index.html to bundle');
  if (new Set(names).size !== names.length) throw new Error('A script is listed twice in index.html');
  const code = names.map((n) => `/* ${n} */\n` + readFile(n).replace(/\r\n/g, '\n')).join('\n;\n');
  let first = true;
  const out = html.replace(SCRIPT_TAG, (m) => {
    if (!first) return '';
    first = false;
    return m.replace(/<script src="[^"]+">/, `<script src="${BUNDLE}">`);
  });
  return { names, code, html: out };
}

// Copies the runtime files into outDir, bundles the scripts, and checks the result. Returns { files, bytes, scripts }; throws on a problem.
export function buildSite(outDir, srcDir = SURVEY_DIR) {
  const out = path.resolve(outDir);
  if (fs.existsSync(out)) {
    const safe = fs.readdirSync(out).length === 0 || /^(_site|chaguo-[\w-]+)$/.test(path.basename(out));
    if (!safe) throw new Error(`Refusing to overwrite ${out}: not empty and not named _site`);
    fs.rmSync(out, { recursive: true, force: true });
  }
  fs.mkdirSync(out, { recursive: true });

  for (const entry of RUNTIME) {
    const from = path.join(srcDir, entry);
    if (!fs.existsSync(from)) throw new Error(`Missing from Survey/: ${entry}`);
    if (fs.statSync(from).isDirectory()) {
      for (const rel of walk(from)) {
        if (JUNK.has(path.basename(rel).toLowerCase())) continue;
        const ext = path.extname(rel).toLowerCase();
        if (!ALLOWED_EXT.has(ext)) throw new Error(`Unexpected file type in ${entry}/: ${rel} (add it to ALLOWED_EXT if it is meant to be published)`);
        fs.mkdirSync(path.dirname(path.join(out, entry, rel)), { recursive: true });
        fs.copyFileSync(path.join(from, rel), path.join(out, entry, rel));
      }
    } else {
      fs.copyFileSync(from, path.join(out, entry));
    }
  }

  // Join the scripts into js/survey.js, point index.html at it, and drop the separate script files.
  const indexPath = path.join(out, 'index.html');
  const bundled = bundleScripts(fs.readFileSync(indexPath, 'utf8'), (n) => fs.readFileSync(path.join(out, n), 'utf8'));
  fs.writeFileSync(path.join(out, BUNDLE), bundled.code);
  fs.writeFileSync(indexPath, bundled.html);
  for (const n of bundled.names) if (n !== BUNDLE) fs.rmSync(path.join(out, n));
  const leftovers = walk(path.join(out, 'js')).filter((f) => f !== 'survey.js');
  if (leftovers.length) throw new Error('Scripts in js/ that index.html does not load (they would be published unused): ' + leftovers.join(', '));

  // Every file index.html points at (relative links only) must exist in the output.
  const html = fs.readFileSync(indexPath, 'utf8');
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    .filter((r) => !/^(https?:|mailto:|#|data:)/.test(r));
  const files = walk(out).sort();
  for (const r of refs) {
    if (r.startsWith('/')) throw new Error(`index.html uses a root-relative path "${r}" (breaks under /Chaguo/); use a relative path`);
    if (!files.includes(r)) throw new Error(`index.html refers to "${r}" but it is not in the published folder`);
  }
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
  return { files, bytes, scripts: bundled.names };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || path.join(SURVEY_DIR, '_site');
  try {
    const { files, bytes } = buildSite(out);
    console.log(`Built ${out}`);
    files.forEach((f) => console.log('  ' + f));
    console.log(`${files.length} files, ${(bytes / 1024).toFixed(1)} KB`);
  } catch (e) {
    console.error('Build failed: ' + e.message);
    process.exit(1);
  }
}
