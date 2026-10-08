// Run with:  node tests/scoring.test.js   (from the Survey/ folder)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Items = require('../js/items.js');
const Scoring = require('../js/scoring.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ok    ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL  ' + name + '\n        ' + e.message);
    failed++;
  }
}

// Build an answers object where every item of a type gets the same value.
function answersFrom(perType) {
  const a = {};
  Items.TYPES.forEach((t) => {
    for (let n = 1; n <= 8; n++) a[t + n] = perType[t];
  });
  return a;
}
const all = (v) => answersFrom({ R: v, I: v, A: v, S: v, E: v, C: v });

console.log('Scoring');

test('all 3s -> every score is 24', () => {
  const scores = Scoring.scoreResponses(all(3));
  Items.TYPES.forEach((t) => assert.strictEqual(scores[t], 24));
});

test('R clearly highest, then I, then A -> code "RIA"', () => {
  const scores = Scoring.scoreResponses(answersFrom({ R: 5, I: 4, A: 3, S: 2, E: 1, C: 1 }));
  assert.deepStrictEqual(scores, { R: 40, I: 32, A: 24, S: 16, E: 8, C: 8 });
  const h = Scoring.hollandCode(scores);
  assert.strictEqual(h.code, 'RIA');
  assert.strictEqual(h.tieAffected, false);
});

test('tie for 3rd place: R-I-A-S-E-C order decides (A beats S) and tie is flagged', () => {
  const scores = Scoring.scoreResponses(answersFrom({ R: 5, I: 4, A: 3, S: 3, E: 1, C: 1 }));
  const h = Scoring.hollandCode(scores);
  assert.strictEqual(h.code, 'RIA');
  assert.deepStrictEqual(h.ranking.slice(0, 4), ['R', 'I', 'A', 'S']);
  assert.strictEqual(h.tieAffected, true);
});

test('tie for 1st place: E comes before C, tie is flagged', () => {
  const scores = Scoring.scoreResponses(answersFrom({ R: 1, I: 1, A: 1, S: 3, E: 5, C: 5 }));
  const h = Scoring.hollandCode(scores);
  assert.strictEqual(h.code, 'ECS');
  assert.strictEqual(h.tieAffected, true);
});

test('tie below the top 3 (4th/5th) does not change the code and is not flagged', () => {
  const scores = Scoring.scoreResponses(answersFrom({ R: 5, I: 4, A: 3, S: 2, E: 2, C: 1 }));
  const h = Scoring.hollandCode(scores);
  assert.strictEqual(h.code, 'RIA');
  assert.strictEqual(h.tieAffected, false);
});

test('everything tied (all 3s) -> "RIA" by the fixed order, tie flagged', () => {
  const h = Scoring.hollandCode(Scoring.scoreResponses(all(3)));
  assert.strictEqual(h.code, 'RIA');
  assert.strictEqual(h.tieAffected, true);
});

test('the attention check never changes scores or the code', () => {
  const base = answersFrom({ R: 5, I: 4, A: 3, S: 2, E: 1, C: 1 });
  const expected = Scoring.scoreResponses(base);
  [1, 2, 3, 4, 5, null, undefined].forEach((v) => {
    const withCheck = Object.assign({}, base, { attention_check: v });
    assert.deepStrictEqual(Scoring.scoreResponses(withCheck), expected);
  });
  const common = {
    responseId: 'x', startedAt: 'a', finishedAt: 'b', answers: base,
    screenTimes: [0, 0, 0, 0, 0, 0], totalMs: 0, isMobile: false
  };
  const pass = Scoring.buildResponse(Object.assign({ attentionCheck: 1 }, common));
  const fail = Scoring.buildResponse(Object.assign({ attentionCheck: 5 }, common));
  assert.strictEqual(pass.attention_passed, true);
  assert.strictEqual(fail.attention_passed, false);
  Items.TYPES.forEach((t) => assert.strictEqual(pass['score_' + t], fail['score_' + t]));
  assert.strictEqual(pass.holland_code, fail.holland_code);
});

test('scoreResponses rejects a missing or out-of-range answer', () => {
  const a = all(3);
  delete a.R1;
  assert.throws(() => Scoring.scoreResponses(a));
  const b = all(3);
  b.C8 = 6;
  assert.throws(() => Scoring.scoreResponses(b));
});

test('buildResponse is flat with the 69 agreed fields, in a stable order', () => {
  const r = Scoring.buildResponse({
    responseId: 'id', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:10:00.000Z',
    answers: all(3), attentionCheck: 1, screenTimes: [1, 2, 3, 4, 5, 6], totalMs: 600000, isMobile: true
  });
  const keys = Object.keys(r);
  assert.strictEqual(keys.length, 69);
  assert.deepStrictEqual(keys.slice(0, 5), ['response_id', 'schema_version', 'started_at', 'finished_at', 'R1']);
  assert.strictEqual(keys[51], 'C8'); // R1..C8 occupy indices 4..51
  assert.strictEqual(keys[52], 'attention_check');
  keys.forEach((k) => assert.notStrictEqual(typeof r[k], 'object'));
  assert.strictEqual(r.schema_version, '1');
  assert.strictEqual(r.score_R, 24);
  assert.strictEqual(r.time_screen_6, 6);
  assert.strictEqual(r.user_agent_is_mobile, true);
});

console.log('\nItems and screens');

const EXPECTED_SCREENS = [
  'R1 I1 A1 S1 E1 C1 R2 I2',
  'A2 S2 E2 C2 R3 I3 A3 S3',
  'E3 C3 R4 I4 A4 S4 E4 C4',
  'R5 I5 A5 S5 attention_check E5 C5 R6 I6',
  'A6 S6 E6 C6 R7 I7 A7 S7',
  'E7 C7 R8 I8 A8 S8 E8 C8'
];

test('interleaved order has 48 unique items', () => {
  assert.strictEqual(Items.ITEMS.length, 48);
  assert.strictEqual(new Set(Items.ITEMS.map((i) => i.id)).size, 48);
  assert.strictEqual(new Set(Items.ITEMS.map((i) => i.text)).size, 48);
  assert.strictEqual(Items.ITEMS[0].id, 'R1');
  assert.strictEqual(Items.ITEMS[47].id, 'C8');
});

test('each screen has exactly the expected items in the expected order', () => {
  EXPECTED_SCREENS.forEach((expected, i) => {
    const ids = Items.getScreenItems(i + 1).map((it) => it.id).join(' ');
    assert.strictEqual(ids, expected, 'screen ' + (i + 1));
  });
});

test('each screen has 8 items; screen 4 has 9 (8 + the attention check)', () => {
  assert.strictEqual(Items.SCREEN_COUNT, 6);
  for (let s = 1; s <= 6; s++) {
    const real = Items.getScreenItems(s).filter((it) => it.id !== 'attention_check');
    assert.strictEqual(real.length, 8, 'screen ' + s);
    assert.strictEqual(Items.getScreenItems(s).length, s === 4 ? 9 : 8, 'screen ' + s);
  }
});

test('attention check is at the fixed 5th position on screen 4 and nowhere else', () => {
  const s4 = Items.getScreenItems(4);
  assert.strictEqual(s4[4].id, 'attention_check');
  for (let s = 1; s <= 6; s++) {
    if (s !== 4) assert.ok(!Items.getScreenItems(s).some((it) => it.id === 'attention_check'));
  }
});

test('the 48 items together cover every id R1..C8 exactly once', () => {
  assert.deepStrictEqual(Items.ITEMS.map((i) => i.id).sort(), Items.ITEM_IDS.slice().sort());
});

test('item wording matches the codebook exactly (skipped if the codebook is not present)', () => {
  const file = path.join(__dirname, '..', '..', 'Dataset', 'RIASEC_data12Dec2018', 'codebook.txt');
  if (!fs.existsSync(file)) {
    console.log('        (codebook not found - skipped)');
    return;
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let matched = 0;
  Items.ITEMS.forEach((it) => {
    const line = lines.find((l) => l.startsWith(it.id + '\t'));
    assert.ok(line, 'codebook line for ' + it.id);
    assert.strictEqual(line.slice(it.id.length + 1), it.text, it.id);
    matched++;
  });
  assert.strictEqual(matched, 48);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
