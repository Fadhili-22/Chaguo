// Run with:  node tests/apps-script.test.js   (from the Survey/ folder)
// Loads apps-script/Code.gs in Node (its Google-only parts are not touched) and uses a fake sheet.
'use strict';
const assert = require('assert');

const Code = require('../apps-script/Code.gs');
const Items = require('../js/items.js');
const B = require('../js/background.js');
const Snapshot = require('../js/snapshot.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok    ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); failed++; }
}

const ID = '3f2b8c1e-9d4a-4c6b-8e1f-0a7d5b2c9e44';
const NOW = '2026-10-08T10:05:00.000Z';

// ---- A real, complete snapshot built by the survey's own code --------------------------------
const answers = {};
Items.ITEM_IDS.forEach((id, i) => { answers[id] = 1 + (i % 5); });
const bg = [
  ['course', 'BSc Nursing'], ['uni_type', 'public'], ['year_of_study', 'year_2'], ['admission_route', 'kuccps_elsewhere'],
  ['kuccps_placed_course', 'BA History'], ['switched_course', 'yes'], ['original_course', 'BSc Physics'],
  ['satisfaction', 4], ['choose_again', 'yes'], ['gender', 'female'], ['age_band', '21_23']
].reduce((a, [k, v]) => B.setAnswer(a, k, v), {});
function snap(over) {
  return Object.assign(Snapshot.buildSnapshot({
    stage: 'complete', responseId: ID, startedAtMs: Date.UTC(2026, 9, 8, 10, 0, 0), nowMs: Date.UTC(2026, 9, 8, 10, 4, 0),
    answers, attentionCheck: 1, bg, screenTimes: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000], isMobile: false,
    isTest: 'no', consentVersion: '2026-10-v1'
  }), over || {});
}
const body = (obj) => JSON.stringify(obj);
const record = (over) => {
  const v = Code.validateBody(body(snap(over)));
  assert.ok(v.ok, v.error);
  return v.record;
};

// ---- A fake Spreadsheet: just enough of the Apps Script API ----------------------------------
function fakeSheet(name, rows) {
  const data = rows ? rows.map((r) => r.slice()) : [];
  return {
    data,
    getName: () => name,
    getLastRow: () => data.length,
    getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
    getRange: (r, c, nr, nc) => ({
      getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = data[r - 1 + i] || []; out.push(Array.from({ length: nc }, (_, j) => (row[c - 1 + j] === undefined ? '' : row[c - 1 + j]))); } return out; },
      setValues: (vals) => { for (let i = 0; i < nr; i++) { data[r - 1 + i] = data[r - 1 + i] || []; for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = vals[i][j]; } }
    }),
    appendRow: (row) => { data.push(row.slice()); }
  };
}
function fakeSpreadsheet(sheets) {
  const map = {};
  (sheets || []).forEach((s) => { map[s.getName()] = s; });
  return {
    map,
    getSheetByName: (n) => map[n] || null,
    insertSheet: (n) => { map[n] = fakeSheet(n); return map[n]; }
  };
}

console.log('Columns');

test('COLUMNS match the survey snapshot: same fields, same order, plus received_at last', () => {
  const keys = Object.keys(snap());
  assert.deepStrictEqual(Code.COLUMN_NAMES, keys.concat(['received_at']));
  assert.strictEqual(Code.COLUMN_NAMES.length, 90);
});

test('allowed values match the survey\'s own option lists', () => {
  B.QUESTIONS.filter((q) => q.type === 'radio' && typeof q.options[0].value === 'string').forEach((q) => {
    const c = Code.COLUMNS.find((x) => x.name === q.id);
    assert.ok(c && c.type === 'enum', q.id);
    assert.deepStrictEqual(c.values.slice().sort(), q.options.map((o) => o.value).sort(), q.id);
  });
  const sat = Code.COLUMNS.find((x) => x.name === 'satisfaction');
  assert.strictEqual(sat.type, 'int');
  assert.strictEqual(Code.COLUMNS.find((x) => x.name === 'course').max, B.MAX_TEXT);
  assert.deepStrictEqual(Code.COLUMNS.find((x) => x.name === 'stage').values, Snapshot.STAGES);
});

console.log('\nRejecting bad requests');

test('a genuine snapshot is accepted and every column survives intact', () => {
  const r = record();
  assert.strictEqual(r.course, 'BSc Nursing');
  assert.strictEqual(r.R1, answers.R1);
  assert.strictEqual(r.attention_passed, true);
  assert.strictEqual(r.user_agent_is_mobile, false);
  assert.strictEqual(r.stage, 'complete');
  assert.strictEqual(r.is_test, 'no');
  assert.strictEqual(r.time_total_ms, 240000);
  assert.strictEqual(r.started_at, '2026-10-08T10:00:00.000Z');
});

test('response_id that is not a UUID is rejected', () => {
  ['', 'abc', ID.slice(1), ID + 'x', '3f2b8c1e-9d4a-4c6b-8e1f-0a7d5b2c9eZZ', 12345, null, { a: 1 }, "' OR 1=1"].forEach((bad) => {
    const v = Code.validateBody(body(snap({ response_id: bad })));
    assert.strictEqual(v.ok, false, JSON.stringify(bad));
    assert.strictEqual(v.error, 'invalid response_id');
  });
  const none = snap(); delete none.response_id;
  assert.strictEqual(Code.validateBody(body(none)).ok, false);
});

test('wrong or missing schema_version is rejected', () => {
  ['2', '4', 3, '', null, undefined].forEach((bad) => {
    const o = snap({ schema_version: bad });
    if (bad === undefined) delete o.schema_version;
    const v = Code.validateBody(body(o));
    assert.strictEqual(v.ok, false, String(bad));
    assert.strictEqual(v.error, 'unsupported schema_version');
  });
});

test('empty, oversized, non-JSON and non-object bodies are rejected', () => {
  assert.strictEqual(Code.validateBody('').ok, false);
  assert.strictEqual(Code.validateBody(undefined).ok, false);
  assert.strictEqual(Code.validateBody('{not json').ok, false);
  assert.strictEqual(Code.validateBody('[1,2,3]').ok, false);
  assert.strictEqual(Code.validateBody('"text"').ok, false);
  assert.strictEqual(Code.validateBody('null').ok, false);
  assert.strictEqual(Code.validateBody(body(snap({ course: 'x'.repeat(Code.MAX_BODY_CHARS) }))).ok, false);
});

console.log('\nCleaning');

test('unknown keys are dropped, including prototype tricks', () => {
  const o = snap({ evil: 'x', admin: true, extra_column: 5 });
  const json = body(o).replace('{', '{"__proto__":{"polluted":1},"constructor":"x",');
  const v = Code.validateBody(json);
  assert.ok(v.ok);
  assert.deepStrictEqual(Object.keys(v.record), Code.COLUMN_NAMES.filter((n) => n !== 'received_at'));
  assert.strictEqual(({}).polluted, undefined);
  assert.strictEqual(Code.toRow(v.record, NOW).length, 90);
});

test('missing columns become ""', () => {
  const o = snap(); delete o.course; delete o.R3;
  const v = Code.validateBody(body(o));
  assert.strictEqual(v.record.course, '');
  assert.strictEqual(v.record.R3, '');
});

test('item answers: integers 1-5 or "" - everything else becomes ""', () => {
  const r = record({ R1: 0, R2: 6, R3: 2.5, R4: '3', R5: -1, R6: null, R7: true, R8: [3], I1: NaN, I2: 1e9, I3: 5, I4: 1, I5: '' });
  ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'I1', 'I2', 'I5'].forEach((k) => assert.strictEqual(r[k], '', k));
  assert.strictEqual(r.I3, 5);
  assert.strictEqual(r.I4, 1);
});

test('satisfaction, attention_check and scores are range-checked too', () => {
  const r = record({ satisfaction: 9, attention_check: 0, score_R: 41, score_I: 7, score_A: 8, score_S: 40 });
  assert.strictEqual(r.satisfaction, '');
  assert.strictEqual(r.attention_check, '');
  assert.strictEqual(r.score_R, '');
  assert.strictEqual(r.score_I, '');
  assert.strictEqual(r.score_A, 8);
  assert.strictEqual(r.score_S, 40);
});

test('enumerated fields outside their allowed values become ""', () => {
  const r = record({ uni_type: 'PUBLIC', gender: 'other', age_band: '18-20', stage: 'screen_9', is_test: 'maybe', choose_again: 'yes ', switched_course: true, admission_route: 5 });
  ['uni_type', 'gender', 'age_band', 'stage', 'is_test', 'choose_again', 'switched_course', 'admission_route'].forEach((k) => assert.strictEqual(r[k], '', k));
  const good = record({ uni_type: 'private', age_band: '27_plus', stage: 'screen_4', is_test: 'yes' });
  assert.strictEqual(good.uni_type, 'private');
  assert.strictEqual(good.age_band, '27_plus');
  assert.strictEqual(good.stage, 'screen_4');
});

test('booleans, timings, timestamps, version and holland code are checked', () => {
  const r = record({ attention_passed: 'true', user_agent_is_mobile: 1, time_screen_1: -5, time_screen_2: 1.5, time_screen_3: 'fast', time_total_ms: 9e12, started_at: 'yesterday', finished_at: '2026-10-08', client_sent_at: '2026-10-08T10:04:00Z', consent_version: 'a b', holland_code: 'RIAS' });
  ['attention_passed', 'user_agent_is_mobile', 'time_screen_1', 'time_screen_2', 'time_screen_3', 'time_total_ms', 'started_at', 'finished_at', 'consent_version', 'holland_code'].forEach((k) => assert.strictEqual(r[k], '', k));
  assert.strictEqual(r.client_sent_at, '2026-10-08T10:04:00Z');
  const ok = record({ time_screen_1: 0, time_total_ms: 600000, holland_code: 'EAS' });
  assert.strictEqual(ok.time_screen_1, 0);
  assert.strictEqual(ok.time_total_ms, 600000);
  assert.strictEqual(ok.holland_code, 'EAS');
});

test('overlong text is cut to its length (course fields: 100)', () => {
  const r = record({ course: 'a'.repeat(500), kuccps_placed_course: 'b'.repeat(101), original_course: 'c'.repeat(100) });
  assert.strictEqual(r.course.length, 100);
  assert.strictEqual(r.kuccps_placed_course.length, 100);
  assert.strictEqual(r.original_course.length, 100);
  assert.strictEqual(record({ course: { x: 1 } }).course, '');
  assert.strictEqual(record({ course: 42 }).course, '');
});

test('text that Sheets would read as a formula gets a leading quote', () => {
  ['=SUM(A1:A9)', '+1+1', '-2', '@SUM(1)', '\t=1+1', '\r=1+1', '\n=1+1', '=HYPERLINK("http://evil.example","click")'].forEach((t) => {
    assert.strictEqual(Code.neutraliseFormula(t), "'" + t, JSON.stringify(t));
    assert.strictEqual(record({ course: t }).course, "'" + t.slice(0, 100), JSON.stringify(t));
  });
  ['BSc Computer Science', 'a=b', 'C++', "O'Neil", ' =x', '', '1+1'].forEach((t) => {
    assert.strictEqual(Code.neutraliseFormula(t), t, JSON.stringify(t));
  });
  assert.strictEqual(record({ original_course: '=1+1' }).original_course, "'=1+1");
  assert.strictEqual(record({ kuccps_placed_course: '@x' }).kuccps_placed_course, "'@x");
});

test('the formula check happens after the cut, so the stored text is at most 101 characters', () => {
  assert.strictEqual(record({ course: '=' + 'x'.repeat(300) }).course.length, 101);
});

test('no cleaned value can still look like a formula', () => {
  const nasty = ['=1', '+1', '-1', '@a', '\t1', '\r1'];
  const o = {};
  Code.COLUMNS.forEach((c) => { o[c.name] = nasty[0]; });
  o.response_id = ID; o.schema_version = '3';
  const row = Code.toRow(Code.validateBody(body(o)).record, NOW);
  row.forEach((v) => { if (typeof v === 'string') assert.ok(!/^[=+\-@\t\r]/.test(v), JSON.stringify(v)); });
});

test('toRow follows COLUMNS order and puts received_at last', () => {
  const row = Code.toRow(record(), NOW);
  assert.strictEqual(row.length, 90);
  assert.strictEqual(row[0], ID);
  assert.strictEqual(row[1], '3');
  assert.strictEqual(row[89], NOW);
  assert.strictEqual(row[Code.COLUMN_NAMES.indexOf('course')], 'BSc Nursing');
});

test('a client cannot set received_at', () => {
  const v = Code.validateBody(body(snap({ received_at: '1999-01-01T00:00:00.000Z' })));
  assert.strictEqual(Code.toRow(v.record, NOW)[89], NOW);
});

console.log('\nWriting to the sheet');

test('an empty sheet gets the header row, then the data row (append-only)', () => {
  const ss = fakeSpreadsheet();
  const res = Code.handleBody(body(snap()), ss, NOW);
  assert.deepStrictEqual(res, { ok: true, sheet: 'Responses' });
  const sheet = ss.map.Responses;
  assert.strictEqual(sheet.data.length, 2);
  assert.deepStrictEqual(sheet.data[0], Code.COLUMN_NAMES);
  assert.strictEqual(sheet.data[1][0], ID);
  assert.strictEqual(sheet.data[1][89], NOW);
});

test('a second send is a new row; the header is not repeated and old rows are untouched', () => {
  const ss = fakeSpreadsheet();
  Code.handleBody(body(snap({ stage: 'screen_3', is_complete: 'no' })), ss, NOW);
  const first = ss.map.Responses.data[1].slice();
  Code.handleBody(body(snap()), ss, '2026-10-08T10:06:00.000Z');
  Code.handleBody(body(snap()), ss, '2026-10-08T10:07:00.000Z');
  const rows = ss.map.Responses.data;
  assert.strictEqual(rows.length, 4);
  assert.deepStrictEqual(rows[1], first);
  assert.strictEqual(rows[1][Code.COLUMN_NAMES.indexOf('stage')], 'screen_3');
  assert.strictEqual(rows[3][Code.COLUMN_NAMES.indexOf('stage')], 'complete');
});

test('a sheet that already has the right header just gets the row', () => {
  const ss = fakeSpreadsheet([fakeSheet('Responses', [Code.COLUMN_NAMES.slice()])]);
  assert.strictEqual(Code.handleBody(body(snap()), ss, NOW).sheet, 'Responses');
  assert.strictEqual(ss.map.Responses.data.length, 2);
  assert.strictEqual(ss.map[Code.FALLBACK_SHEET_NAME], undefined);
});

test('a header that does not match goes to the schema tab; the old tab is not touched', () => {
  const oldHeader = Code.COLUMN_NAMES.slice(0, 84); // e.g. a sheet from an older layout
  const old = fakeSheet('Responses', [oldHeader.slice(), ['x']]);
  const ss = fakeSpreadsheet([old]);
  const res = Code.handleBody(body(snap()), ss, NOW);
  assert.deepStrictEqual(res, { ok: true, sheet: 'Responses_schema_3' });
  assert.strictEqual(old.data.length, 2);
  assert.deepStrictEqual(old.data[0], oldHeader);
  const fb = ss.map.Responses_schema_3;
  assert.deepStrictEqual(fb.data[0], Code.COLUMN_NAMES);
  assert.strictEqual(fb.data.length, 2);
  Code.handleBody(body(snap()), ss, NOW);
  assert.strictEqual(fb.data.length, 3);
});

test('same width but a different or reordered column name counts as a mismatch', () => {
  const swapped = Code.COLUMN_NAMES.slice();
  [swapped[4], swapped[5]] = [swapped[5], swapped[4]];
  const ss = fakeSpreadsheet([fakeSheet('Responses', [swapped])]);
  assert.strictEqual(Code.handleBody(body(snap()), ss, NOW).sheet, 'Responses_schema_3');
  const wider = fakeSheet('Responses', [Code.COLUMN_NAMES.concat(['notes'])]);
  assert.strictEqual(Code.headerState(wider), 'mismatch');
});

test('if the schema tab is also wrong, nothing is written and an error comes back', () => {
  const a = fakeSheet('Responses', [['wrong']]);
  const b = fakeSheet('Responses_schema_3', [['also wrong']]);
  const ss = fakeSpreadsheet([a, b]);
  const res = Code.handleBody(body(snap()), ss, NOW);
  assert.deepStrictEqual(res, { ok: false, error: 'sheet header mismatch' });
  assert.strictEqual(a.data.length, 1);
  assert.strictEqual(b.data.length, 1);
});

test('a rejected request writes nothing, not even a header or a new tab', () => {
  const ss = fakeSpreadsheet();
  assert.strictEqual(Code.handleBody(body(snap({ response_id: 'nope' })), ss, NOW).ok, false);
  assert.strictEqual(Code.handleBody('garbage', ss, NOW).ok, false);
  assert.deepStrictEqual(Object.keys(ss.map), []);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
