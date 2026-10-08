// Run with:  node tests/snapshot.test.js   (from the Survey/ folder)
'use strict';
const assert = require('assert');

const Items = require('../js/items.js');
const Scoring = require('../js/scoring.js');
const B = require('../js/background.js');
const S = require('../js/snapshot.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok    ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); failed++; }
}

const ID = '3f2b8c1e-9d4a-4c6b-8e1f-0a7d5b2c9e44';
const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);

function allAnswers(v) {
  const a = {};
  Items.ITEM_IDS.forEach((id) => { a[id] = v; });
  return a;
}
const BG_ANSWERS = [
  ['course', ' BSc Nursing '], ['uni_type', 'public'], ['year_of_study', 'year_2'], ['admission_route', 'kuccps_placed'],
  ['kuccps_first_choice', 'yes'], ['switched_course', 'no'],
  ['satisfaction', 4], ['choose_again', 'yes'], ['gender', 'female'], ['age_band', '21_23']
].reduce((a, [k, v]) => B.setAnswer(a, k, v), {});

function opts(over) {
  return Object.assign({
    stage: 'screen_1', responseId: ID, startedAtMs: T0, nowMs: T0 + 90000,
    answers: {}, attentionCheck: null, bg: {}, screenTimes: [0, 0, 0, 0, 0, 0, 0, 0],
    isMobile: true, isTest: 'yes', consentVersion: '2026-10-v1'
  }, over);
}

console.log('Snapshot shape');

test('an empty snapshot has all 89 fields; unknown values are "" (never null/undefined)', () => {
  const r = S.buildSnapshot(opts({}));
  assert.strictEqual(Object.keys(r).length, 89);
  Object.keys(r).forEach((k) => assert.ok(r[k] !== null && r[k] !== undefined, k));
  assert.strictEqual(r.R1, '');
  assert.strictEqual(r.attention_check, '');
  assert.strictEqual(r.attention_passed, '');
  assert.strictEqual(r.score_R, '');
  assert.strictEqual(r.holland_code, '');
  assert.strictEqual(r.finished_at, '');
  assert.strictEqual(r.course, '');
  assert.strictEqual(r.time_screen_1, '');
  assert.strictEqual(r.time_total_ms, 90000);
  assert.strictEqual(r.schema_version, '3');
});

test('sending fields come last, after the 84 core fields', () => {
  const k = Object.keys(S.buildSnapshot(opts({})));
  assert.strictEqual(k[83], 'user_agent_is_mobile');
  assert.deepStrictEqual(k.slice(84), ['stage', 'is_complete', 'client_sent_at', 'consent_version', 'is_test']);
  assert.deepStrictEqual(S.SENDING_FIELDS, k.slice(84));
});

test('partial and complete snapshots list the keys in exactly the same order', () => {
  const partial = Object.keys(S.buildSnapshot(opts({})));
  const complete = Object.keys(S.buildSnapshot(opts({
    stage: 'complete', answers: allAnswers(3), attentionCheck: 1, bg: BG_ANSWERS, screenTimes: [1, 2, 3, 4, 5, 6, 7, 8]
  })));
  assert.deepStrictEqual(partial, complete);
});

test('a finished state gives identical values through the partial and the strict path', () => {
  const base = opts({ answers: allAnswers(3), attentionCheck: 1, bg: BG_ANSWERS, screenTimes: [1, 2, 3, 4, 5, 6, 7, 8] });
  const viaPartial = S.buildSnapshot(Object.assign({}, base, { stage: 'screen_8' }));
  const viaStrict = S.buildSnapshot(Object.assign({}, base, { stage: 'complete' }));
  ['stage', 'is_complete', 'finished_at'].forEach((k) => { delete viaPartial[k]; delete viaStrict[k]; });
  assert.deepStrictEqual(viaPartial, viaStrict);
  assert.deepStrictEqual(B.buildPartialBackgroundFields(BG_ANSWERS), B.buildBackgroundFields(BG_ANSWERS));
});

console.log('\nSnapshots grow as the survey goes on');

test('after screen 1: eight items, no scores, "stage" and "is_complete" say so', () => {
  const a = {};
  Items.getScreenItems(1).forEach((it) => { a[it.id] = 4; });
  const r = S.buildSnapshot(opts({ stage: 'screen_1', answers: a, screenTimes: [5000, 0, 0, 0, 0, 0, 0, 0] }));
  assert.strictEqual(r.R1, 4);
  assert.strictEqual(r.I2, 4);
  assert.strictEqual(r.A2, '');
  assert.strictEqual(r.score_R, '');
  assert.strictEqual(r.stage, 'screen_1');
  assert.strictEqual(r.is_complete, 'no');
  assert.strictEqual(r.time_screen_1, 5000);
  assert.strictEqual(r.time_screen_2, '');
});

test('a score appears as soon as its 8 items are in; the code only when all six are', () => {
  const a = {};
  for (let n = 1; n <= 8; n++) a['R' + n] = 5;
  let r = S.buildSnapshot(opts({ answers: a }));
  assert.strictEqual(r.score_R, 40);
  assert.strictEqual(r.score_I, '');
  assert.strictEqual(r.holland_code, '');
  r = S.buildSnapshot(opts({ answers: allAnswers(3) }));
  assert.strictEqual(r.score_C, 24);
  assert.strictEqual(r.holland_code, 'RIA');
});

test('attention check: shown once answered, passed only for the agreed answer', () => {
  assert.strictEqual(S.buildSnapshot(opts({ attentionCheck: 1 })).attention_passed, true);
  assert.strictEqual(S.buildSnapshot(opts({ attentionCheck: 5 })).attention_passed, false);
});

test('background fields fill in as answered; a shown, unanswered question is ""', () => {
  const part = B.setAnswer({}, 'course', 'LLB');
  const r = S.buildSnapshot(opts({ bg: part }));
  assert.strictEqual(r.course, 'LLB');
  assert.strictEqual(r.uni_type, '');
  assert.strictEqual(r.kuccps_first_choice, '');
  const placed = B.setAnswer(part, 'admission_route', 'kuccps_placed');
  assert.strictEqual(S.buildSnapshot(opts({ bg: placed })).kuccps_first_choice, ''); // shown, not answered yet
  const elsewhere = B.setAnswer(part, 'admission_route', 'kuccps_elsewhere');
  assert.strictEqual(S.buildSnapshot(opts({ bg: elsewhere })).kuccps_placed_dont_remember, 'no');
});

test('timestamps are ISO; client_sent_at is the time of this send', () => {
  const r = S.buildSnapshot(opts({}));
  assert.strictEqual(r.started_at, '2026-10-08T10:00:00.000Z');
  assert.strictEqual(r.client_sent_at, '2026-10-08T10:01:30.000Z');
  assert.strictEqual(r.consent_version, '2026-10-v1');
});

test('the complete snapshot is strict: it refuses to claim completeness with answers missing', () => {
  assert.throws(() => S.buildSnapshot(opts({ stage: 'complete', answers: allAnswers(3), attentionCheck: 1, screenTimes: [1, 2, 3, 4, 5, 6, 7, 8] })));
  const r = S.buildSnapshot(opts({
    stage: 'complete', answers: allAnswers(3), attentionCheck: 1, bg: BG_ANSWERS, screenTimes: [1, 2, 3, 4, 5, 6, 7, 8]
  }));
  assert.strictEqual(r.is_complete, 'yes');
  assert.strictEqual(r.stage, 'complete');
  assert.strictEqual(r.finished_at, '2026-10-08T10:01:30.000Z');
  assert.strictEqual(r.course, 'BSc Nursing');
});

test('an unknown stage is refused', () => {
  assert.throws(() => S.buildSnapshot(opts({ stage: 'screen_9' })));
  assert.throws(() => S.buildSnapshot(opts({ stage: undefined })));
});

console.log('\nis_test');

test('is_test is "yes" for ?debug, file://, localhost and LAN addresses; "no" for a public site', () => {
  const L = (protocol, hostname) => ({ protocol, hostname });
  assert.strictEqual(S.isTestEnvironment(L('https:', 'chaguo.example.org'), true), 'yes');
  assert.strictEqual(S.isTestEnvironment(L('file:', ''), false), 'yes');
  assert.strictEqual(S.isTestEnvironment(L('http:', 'localhost'), false), 'yes');
  assert.strictEqual(S.isTestEnvironment(L('http:', '127.0.0.1'), false), 'yes');
  assert.strictEqual(S.isTestEnvironment(L('http:', '[::1]'), false), 'yes');
  assert.strictEqual(S.isTestEnvironment(L('http:', '192.168.1.23'), false), 'yes');
  assert.strictEqual(S.isTestEnvironment(L('http:', '10.0.0.5'), false), 'yes');
  assert.strictEqual(S.isTestEnvironment(L('http:', '172.20.1.1'), false), 'yes');
  assert.strictEqual(S.isTestEnvironment(L('http:', 'laptop.local'), false), 'yes');
  assert.strictEqual(S.isTestEnvironment(L('https:', 'fadhilimunyua.github.io'), false), 'no');
  assert.strictEqual(S.isTestEnvironment(L('https:', 'chaguo.example.org'), false), 'no');
  assert.strictEqual(S.isTestEnvironment(L('https:', '172.32.0.1'), false), 'no'); // outside 172.16-31
  assert.strictEqual(S.isTestEnvironment(L('https:', '1920.168.example.org'), false), 'no');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
