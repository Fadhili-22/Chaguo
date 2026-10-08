// Run with:  node tests/background.test.js   (from the Survey/ folder)
'use strict';
const assert = require('assert');

const B = require('../js/background.js');

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

// Apply a list of [id, value] answers one at a time, the way the page does.
function fill(pairs, start) {
  return pairs.reduce((a, [id, v]) => B.setAnswer(a, id, v), start || {});
}
const ids = (list) => list.map((q) => q.id);

// A complete, valid set of answers for the given route (screens 7 and 8).
function complete(route, extra) {
  const base = [
    ['course', '  BSc Computer Science  '], ['uni_type', 'public'], ['year_of_study', 'year_2'],
    ['admission_route', route], ['switched_course', 'no'],
    ['satisfaction', 4], ['choose_again', 'yes'], ['gender', 'female'], ['age_band', '21_23']
  ];
  const followUp = route === 'kuccps_placed' ? [['kuccps_first_choice', 'yes']] : [];
  return fill(base.concat(followUp, extra || []));
}

console.log('Question list');

test('screen 7 has the 5 core questions, screen 8 has 4; follow-ups are hidden at first', () => {
  assert.deepStrictEqual(ids(B.visibleQuestions({}, 7)), ['course', 'uni_type', 'year_of_study', 'admission_route', 'switched_course']);
  assert.deepStrictEqual(ids(B.visibleQuestions({}, 8)), ['satisfaction', 'choose_again', 'gender', 'age_band']);
});

test('field order is the 13 agreed response fields', () => {
  assert.deepStrictEqual(B.FIELD_ORDER, [
    'course', 'uni_type', 'year_of_study', 'admission_route', 'kuccps_first_choice', 'kuccps_placed_course',
    'kuccps_placed_dont_remember', 'switched_course', 'original_course', 'satisfaction', 'choose_again', 'gender', 'age_band'
  ]);
});

test('satisfaction has five options, all labelled, values 1..5', () => {
  const q = B.QUESTIONS.find((x) => x.id === 'satisfaction');
  assert.deepStrictEqual(q.options.map((o) => o.value), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(q.options.map((o) => o.label), ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied']);
});

console.log('\nBranching');

test('(a) kuccps_placed shows the first-choice follow-up directly after the route question', () => {
  const a = fill([['admission_route', 'kuccps_placed']]);
  const list = ids(B.visibleQuestions(a, 7));
  assert.strictEqual(list[list.indexOf('admission_route') + 1], 'kuccps_first_choice');
  assert.ok(!list.includes('kuccps_placed_course'));
  assert.ok(!list.includes('kuccps_placed_dont_remember'));
});

test('(b) kuccps_elsewhere shows the placed-course text and the "I don\'t remember" checkbox', () => {
  const a = fill([['admission_route', 'kuccps_elsewhere']]);
  const list = ids(B.visibleQuestions(a, 7));
  assert.ok(list.includes('kuccps_placed_course') && list.includes('kuccps_placed_dont_remember'));
  assert.ok(!list.includes('kuccps_first_choice'));
});

test('(c) direct and (d) not_sure show no KUCCPS follow-up', () => {
  ['direct', 'not_sure'].forEach((route) => {
    const list = ids(B.visibleQuestions(fill([['admission_route', route]]), 7));
    ['kuccps_first_choice', 'kuccps_placed_course', 'kuccps_placed_dont_remember'].forEach((id) => assert.ok(!list.includes(id), route + ' ' + id));
  });
});

test('switched_course = yes shows original_course; no hides it', () => {
  assert.ok(ids(B.visibleQuestions(fill([['switched_course', 'yes']]), 7)).includes('original_course'));
  assert.ok(!ids(B.visibleQuestions(fill([['switched_course', 'no']]), 7)).includes('original_course'));
});

console.log('\nChanging an answer clears hidden follow-ups');

test('(a) -> other route clears kuccps_first_choice', () => {
  let a = fill([['admission_route', 'kuccps_placed'], ['kuccps_first_choice', 'no']]);
  assert.strictEqual(a.kuccps_first_choice, 'no');
  ['kuccps_elsewhere', 'direct', 'not_sure'].forEach((route) => {
    const b = B.setAnswer(a, 'admission_route', route);
    assert.ok(!('kuccps_first_choice' in b), route);
  });
});

test('(b) -> other route clears the placed course and the checkbox', () => {
  const typed = fill([['admission_route', 'kuccps_elsewhere'], ['kuccps_placed_course', 'BA Economics']]);
  const ticked = fill([['admission_route', 'kuccps_elsewhere'], ['kuccps_placed_dont_remember', 'yes']]);
  ['kuccps_placed', 'direct', 'not_sure'].forEach((route) => {
    [typed, ticked].forEach((a) => {
      const b = B.setAnswer(a, 'admission_route', route);
      assert.ok(!('kuccps_placed_course' in b) && !('kuccps_placed_dont_remember' in b), route);
    });
  });
});

test('picking the same route again keeps the follow-up answer', () => {
  const a = fill([['admission_route', 'kuccps_placed'], ['kuccps_first_choice', 'dont_remember']]);
  assert.strictEqual(B.setAnswer(a, 'admission_route', 'kuccps_placed').kuccps_first_choice, 'dont_remember');
});

test('switched_course = no clears original_course', () => {
  const a = fill([['switched_course', 'yes'], ['original_course', 'BSc Physics']]);
  assert.strictEqual(a.original_course, 'BSc Physics');
  const b = B.setAnswer(a, 'switched_course', 'no');
  assert.ok(!('original_course' in b));
  assert.strictEqual(b.switched_course, 'no');
});

test('ticking "I don\'t remember" clears the typed course; typing again clears the tick', () => {
  const a = fill([['admission_route', 'kuccps_elsewhere'], ['kuccps_placed_course', 'BA Economics']]);
  const ticked = B.setAnswer(a, 'kuccps_placed_dont_remember', 'yes');
  assert.ok(!('kuccps_placed_course' in ticked));
  assert.strictEqual(ticked.kuccps_placed_dont_remember, 'yes');
  const typed = B.setAnswer(ticked, 'kuccps_placed_course', 'LLB');
  assert.ok(!('kuccps_placed_dont_remember' in typed));
  assert.strictEqual(typed.kuccps_placed_course, 'LLB');
  const unticked = B.setAnswer(ticked, 'kuccps_placed_dont_remember', 'no');
  assert.ok(!('kuccps_placed_dont_remember' in unticked));
});

test('setAnswer does not change the object it was given', () => {
  const a = fill([['admission_route', 'kuccps_placed'], ['kuccps_first_choice', 'yes']]);
  const snapshot = JSON.stringify(a);
  B.setAnswer(a, 'admission_route', 'direct');
  assert.strictEqual(JSON.stringify(a), snapshot);
});

test('setAnswer ignores unknown questions and invalid radio values', () => {
  const a = fill([['uni_type', 'public']]);
  assert.deepStrictEqual(B.setAnswer(a, 'nonsense', 'x'), a);
  assert.deepStrictEqual(B.setAnswer(a, 'uni_type', 'martian'), a);
  assert.deepStrictEqual(B.setAnswer(fill([['satisfaction', 4]]), 'satisfaction', 9), { satisfaction: 4 });
});

test('pruneHidden removes stale hidden answers and invalid values (used on refresh-restore)', () => {
  const stale = {
    admission_route: 'direct', kuccps_first_choice: 'yes', kuccps_placed_course: 'X',
    kuccps_placed_dont_remember: 'yes', switched_course: 'no', original_course: 'Y',
    gender: 'robot', satisfaction: 4
  };
  assert.deepStrictEqual(B.pruneHidden(stale), { admission_route: 'direct', switched_course: 'no', satisfaction: 4 });
});

console.log('\nValidation');

test('empty screen 7 lists every required question, in display order', () => {
  const v = B.validateScreen(7, {});
  assert.strictEqual(v.valid, false);
  assert.deepStrictEqual(v.missing, ['course', 'uni_type', 'year_of_study', 'admission_route', 'switched_course']);
});

test('empty screen 8 lists all four questions', () => {
  assert.deepStrictEqual(B.validateScreen(8, {}).missing, ['satisfaction', 'choose_again', 'gender', 'age_band']);
});

test('screen 7 and 8 validate independently', () => {
  const a = complete('direct');
  assert.strictEqual(B.validateScreen(7, a).valid, true);
  assert.strictEqual(B.validateScreen(8, a).valid, true);
  const onlySeven = fill([['course', 'LLB'], ['uni_type', 'private'], ['year_of_study', 'year_1'], ['admission_route', 'direct'], ['switched_course', 'no']]);
  assert.strictEqual(B.validateScreen(7, onlySeven).valid, true);
  assert.strictEqual(B.validateScreen(8, onlySeven).valid, false);
});

test('a shown follow-up that is required counts as missing: (a) needs first choice', () => {
  const a = fill([['course', 'LLB'], ['uni_type', 'private'], ['year_of_study', 'year_1'], ['admission_route', 'kuccps_placed'], ['switched_course', 'no']]);
  assert.deepStrictEqual(B.validateScreen(7, a).missing, ['kuccps_first_choice']);
  assert.strictEqual(B.validateScreen(7, B.setAnswer(a, 'kuccps_first_choice', 'dont_remember')).valid, true);
});

test('a hidden required follow-up is never missing', () => {
  assert.ok(!B.validateScreen(7, fill([['admission_route', 'direct']])).missing.includes('kuccps_first_choice'));
});

test('optional follow-ups can be blank: (b) with nothing typed, switched yes with no original course', () => {
  const a = complete('kuccps_elsewhere', [['switched_course', 'yes']]);
  assert.strictEqual(B.validateScreen(7, a).valid, true);
  assert.strictEqual(B.validateScreen(8, a).valid, true);
  assert.ok(!('kuccps_placed_course' in a) && !('original_course' in a));
});

test('whitespace-only course counts as missing', () => {
  const a = Object.assign(complete('direct'), { course: '   ' });
  const v = B.validateScreen(7, a);
  assert.deepStrictEqual(v.missing, ['course']);
  assert.strictEqual(v.reasons.course, 'required');
});

test('text over 100 characters is invalid (required or optional); exactly 100 is fine', () => {
  const long = 'x'.repeat(101);
  const a = Object.assign(complete('direct', [['switched_course', 'yes']]), { course: long });
  assert.strictEqual(B.validateScreen(7, a).reasons.course, 'too_long');
  const b = Object.assign(complete('direct', [['switched_course', 'yes']]), { original_course: long });
  assert.strictEqual(B.validateScreen(7, b).reasons.original_course, 'too_long');
  const ok = Object.assign(complete('direct'), { course: 'x'.repeat(100) });
  assert.strictEqual(B.validateScreen(7, ok).valid, true);
  const padded = Object.assign({}, ok, { course: '  ' + 'x'.repeat(100) + '  ' });
  assert.strictEqual(B.validateScreen(7, padded).valid, true, 'trimmed length counts');
});

test('validateScreen rejects a screen number that is not a background screen', () => {
  assert.throws(() => B.validateScreen(6, {}));
  assert.throws(() => B.validateScreen(9, {}));
});

test('screenProgress counts only required, visible questions', () => {
  assert.deepStrictEqual(B.screenProgress(7, {}), { answered: 0, total: 5 });
  assert.deepStrictEqual(B.screenProgress(7, fill([['course', 'LLB'], ['admission_route', 'kuccps_placed']])), { answered: 2, total: 6 });
  assert.deepStrictEqual(B.screenProgress(8, complete('direct')), { answered: 4, total: 4 });
});

console.log('\nResponse fields');

test('each route gives the right filled and empty fields', () => {
  const placed = B.buildBackgroundFields(complete('kuccps_placed', [['kuccps_first_choice', 'no']]));
  assert.strictEqual(placed.admission_route, 'kuccps_placed');
  assert.strictEqual(placed.kuccps_first_choice, 'no');
  assert.strictEqual(placed.kuccps_placed_course, '');
  assert.strictEqual(placed.kuccps_placed_dont_remember, '');

  const elsewhere = B.buildBackgroundFields(complete('kuccps_elsewhere', [['kuccps_placed_course', ' BSc Nursing ']]));
  assert.strictEqual(elsewhere.kuccps_first_choice, '');
  assert.strictEqual(elsewhere.kuccps_placed_course, 'BSc Nursing');
  assert.strictEqual(elsewhere.kuccps_placed_dont_remember, 'no');

  const elsewhereTicked = B.buildBackgroundFields(complete('kuccps_elsewhere', [['kuccps_placed_dont_remember', 'yes']]));
  assert.strictEqual(elsewhereTicked.kuccps_placed_course, '');
  assert.strictEqual(elsewhereTicked.kuccps_placed_dont_remember, 'yes');

  const elsewhereBlank = B.buildBackgroundFields(complete('kuccps_elsewhere'));
  assert.strictEqual(elsewhereBlank.kuccps_placed_course, '');
  assert.strictEqual(elsewhereBlank.kuccps_placed_dont_remember, 'no'); // shown and left blank, not "not shown"

  ['direct', 'not_sure'].forEach((route) => {
    const f = B.buildBackgroundFields(complete(route));
    assert.strictEqual(f.kuccps_first_choice, '');
    assert.strictEqual(f.kuccps_placed_course, '');
    assert.strictEqual(f.kuccps_placed_dont_remember, '');
  });
});

test('fields come out flat, in order, with trimmed text and integer satisfaction', () => {
  const f = B.buildBackgroundFields(complete('direct'));
  assert.deepStrictEqual(Object.keys(f), B.FIELD_ORDER);
  assert.strictEqual(f.course, 'BSc Computer Science');
  assert.strictEqual(f.satisfaction, 4);
  assert.ok(Number.isInteger(f.satisfaction));
  assert.strictEqual(f.switched_course, 'no');
  assert.strictEqual(f.original_course, '');
});

test('switched yes keeps original_course (trimmed); a stale one is dropped after switching to no', () => {
  const yes = B.buildBackgroundFields(complete('direct', [['switched_course', 'yes'], ['original_course', '  BSc Physics ']]));
  assert.strictEqual(yes.original_course, 'BSc Physics');
  const no = B.buildBackgroundFields(B.setAnswer(complete('direct', [['switched_course', 'yes'], ['original_course', 'BSc Physics']]), 'switched_course', 'no'));
  assert.strictEqual(no.original_course, '');
});

test('buildBackgroundFields ignores a stale hidden answer even if one sneaks into the input', () => {
  const sneaky = Object.assign(complete('direct'), { kuccps_first_choice: 'yes', original_course: 'Old', kuccps_placed_dont_remember: 'yes' });
  const f = B.buildBackgroundFields(sneaky);
  assert.strictEqual(f.kuccps_first_choice, '');
  assert.strictEqual(f.original_course, '');
  assert.strictEqual(f.kuccps_placed_dont_remember, '');
});

test('buildBackgroundFields throws if a required answer is missing', () => {
  const a = complete('direct');
  delete a.gender;
  assert.throws(() => B.buildBackgroundFields(a), /gender/);
});

test('every real answer is non-empty, so "" can only mean "not shown" or "optional, left blank"', () => {
  B.QUESTIONS.forEach((q) => {
    if (q.options) q.options.forEach((o) => assert.ok(o.value !== '' && o.value !== null && o.value !== undefined, q.id));
  });
});

console.log('\nDebug helper');

test('randomAnswers gives valid, consistent answers for 500 runs and reaches all four routes', () => {
  const routes = new Set();
  for (let i = 0; i < 500; i++) {
    const a = B.randomAnswers(Math.random);
    assert.strictEqual(B.validateScreen(7, a).valid, true);
    assert.strictEqual(B.validateScreen(8, a).valid, true);
    assert.deepStrictEqual(B.pruneHidden(a), a, 'nothing hidden or invalid left in');
    const f = B.buildBackgroundFields(a);
    routes.add(f.admission_route);
    assert.strictEqual(f.kuccps_first_choice !== '', f.admission_route === 'kuccps_placed');
    assert.strictEqual(f.kuccps_placed_dont_remember !== '', f.admission_route === 'kuccps_elsewhere');
    if (f.switched_course === 'no') assert.strictEqual(f.original_course, '');
    if (f.admission_route !== 'kuccps_elsewhere') assert.strictEqual(f.kuccps_placed_course, '');
    if (f.kuccps_placed_dont_remember === 'yes') assert.strictEqual(f.kuccps_placed_course, '');
  }
  assert.strictEqual(routes.size, 4);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
