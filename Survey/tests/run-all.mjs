// Runs every test file and prints one summary line each.
//
//   node tests/run-all.mjs            all suites
//   node tests/run-all.mjs --quick    only the ones that need no browser (the same set the deploy workflow runs)
//
// Needs Node 22+; the browser suites also need Chrome or Edge (see README). Exits non-zero if any suite fails.
// None of these tests can send anything to the real Google Sheet: the browser suites run against temp copies
// of the survey with their own config.js.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const NODE_ONLY = ['scoring.test.js', 'background.test.js', 'snapshot.test.js', 'apps-script.test.js', 'deploy.test.js'];
const BROWSER = ['browser.test.mjs', 'saving.test.mjs', 'live.test.mjs', 'slow-network.test.mjs'];
const suites = process.argv.includes('--quick') ? NODE_ONLY : NODE_ONLY.concat(BROWSER);

let bad = 0;
for (const file of suites) {
  const r = spawnSync(process.execPath, [path.join(here, file)], { encoding: 'utf8', cwd: path.join(here, '..'), timeout: 600000 });
  const lines = (r.stdout || '').trim().split(/\r?\n/);
  const summary = [...lines].reverse().find((l) => /\d+ passed|checks passed/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || 'no summary';
  const ok = r.status === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${file.padEnd(24)} ${summary.trim()}`);
  if (!ok) lines.filter((l) => /FAIL/.test(l)).forEach((l) => console.log('        ' + l.trim()));
}
console.log(bad ? `\n${bad} suite(s) failed` : `\nAll ${suites.length} suites passed`);
process.exit(bad ? 1 : 0);
