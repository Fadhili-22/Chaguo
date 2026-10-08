/*
 * Background questions (survey screens 7 and 8): the question list, KUCCPS branching and validation.
 * Pure functions only: no DOM, no storage, no clock. Works in the browser (window.ChaguoBackground)
 * and in Node (require).
 *
 * `answers` is a plain object keyed by the response field names (course, uni_type, ...).
 *   - radio answers hold the machine value ("public", "kuccps_placed", 4, ...), never the display text
 *   - text answers hold the raw string as typed; trimming happens in validation and when building
 *   - the "I don't remember" checkbox is stored only when ticked, as "yes"
 *
 * NOT-SHOWN CONVENTION: a question the respondent was never shown (its follow-up condition was not
 * met) is the empty string "" in the response object. "" is not a valid value for any real answer, so
 * it can never be confused with one. "Shown but left blank" is also "" for an optional text question,
 * but the checkbox next to kuccps_placed_course tells the two apart ("yes"/"no" when shown, "" when not).
 */
(function (root) {
  'use strict';

  var SCREENS = [7, 8]; // survey screen numbers (1-6 are the item screens)
  var MAX_TEXT = 100;

  function opts(pairs) {
    return pairs.map(function (p) { return { value: p[0], label: p[1] }; });
  }

  var YES_NO = opts([['yes', 'Yes'], ['no', 'No']]);

  // Display order = array order. A follow-up sits directly after its parent question.
  var QUESTIONS = [
    {
      id: 'course', screen: 7, type: 'text', required: true, maxLength: MAX_TEXT,
      label: 'What course are you studying?', placeholder: 'BSc Computer Science'
    },
    {
      id: 'uni_type', screen: 7, type: 'radio', required: true,
      label: 'What type of university is it?',
      options: opts([['public', 'Public'], ['private', 'Private'], ['not_sure', 'Not sure']])
    },
    {
      id: 'year_of_study', screen: 7, type: 'radio', required: true,
      label: 'What year are you in?',
      options: opts([
        ['year_1', '1st'], ['year_2', '2nd'], ['year_3', '3rd'], ['year_4', '4th'],
        ['year_5_plus', '5th or above'], ['graduated_2y', 'Graduated in the last 2 years']
      ])
    },
    {
      id: 'admission_route', screen: 7, type: 'radio', required: true,
      label: 'How did you get into this course?',
      options: opts([
        ['kuccps_placed', 'KUCCPS placed me in this course'],
        ['kuccps_elsewhere', "I applied through KUCCPS but I'm now studying a different course or somewhere else"],
        ['direct', "I applied directly to the university (didn't go through KUCCPS for this course)"],
        ['not_sure', 'Not sure']
      ])
    },
    {
      id: 'kuccps_first_choice', screen: 7, type: 'radio', required: true, followUp: true,
      label: 'Was this course your first choice on your KUCCPS application?',
      options: opts([['yes', 'Yes'], ['no', 'No'], ['dont_remember', "Don't remember"]]),
      showIf: function (a) { return a.admission_route === 'kuccps_placed'; }
    },
    {
      id: 'kuccps_placed_course', screen: 7, type: 'text', required: false, followUp: true, maxLength: MAX_TEXT,
      label: 'What course did KUCCPS place you in?',
      showIf: function (a) { return a.admission_route === 'kuccps_elsewhere'; }
    },
    {
      // Drawn inside the question above (attachTo); stored only when ticked.
      id: 'kuccps_placed_dont_remember', screen: 7, type: 'checkbox', required: false, followUp: true,
      attachTo: 'kuccps_placed_course', label: "I don't remember",
      showIf: function (a) { return a.admission_route === 'kuccps_elsewhere'; }
    },
    {
      id: 'switched_course', screen: 7, type: 'radio', required: true,
      label: 'Have you switched course since starting university?', options: YES_NO
    },
    {
      id: 'original_course', screen: 7, type: 'text', required: false, followUp: true, maxLength: MAX_TEXT,
      label: 'What course did you start in?',
      showIf: function (a) { return a.switched_course === 'yes'; }
    },
    {
      id: 'satisfaction', screen: 8, type: 'radio', required: true, showNumbers: true,
      label: 'How satisfied are you with your current course?',
      options: [
        { value: 1, label: 'Very dissatisfied' }, { value: 2, label: 'Dissatisfied' },
        { value: 3, label: 'Neutral' }, { value: 4, label: 'Satisfied' }, { value: 5, label: 'Very satisfied' }
      ]
    },
    {
      id: 'choose_again', screen: 8, type: 'radio', required: true,
      label: 'If you could choose again, would you pick the same course?',
      options: opts([['yes', 'Yes'], ['not_sure', 'Not sure'], ['no', 'No']])
    },
    {
      id: 'gender', screen: 8, type: 'radio', required: true,
      label: 'What is your gender?',
      options: opts([['female', 'Female'], ['male', 'Male'], ['prefer_not_to_say', 'Prefer not to say']])
    },
    {
      // Underscores, not hyphens: Google Sheets would turn "18-20" into a date.
      id: 'age_band', screen: 8, type: 'radio', required: true,
      label: 'What is your age?',
      options: opts([
        ['18_20', '18–20'], ['21_23', '21–23'], ['24_26', '24–26'],
        ['27_plus', '27 or older'], ['prefer_not_to_say', 'Prefer not to say']
      ])
    }
  ];

  var BY_ID = {};
  QUESTIONS.forEach(function (q) { BY_ID[q.id] = q; });

  // The background fields of the response object, in order.
  var FIELD_ORDER = QUESTIONS.map(function (q) { return q.id; });

  // ---- Helpers ----------------------------------------------------------------------------

  function trimmed(v) { return typeof v === 'string' ? v.trim() : ''; }

  function isVisible(q, answers) { return !q.showIf || !!q.showIf(answers); }

  function isValidOption(q, v) {
    return q.options.some(function (o) { return o.value === v; });
  }

  // Why a visible question's answer is not acceptable: 'required', 'too_long', or null (fine).
  function problem(q, answers) {
    var v = answers[q.id];
    if (q.type === 'text') {
      var t = trimmed(v);
      if (t.length > MAX_TEXT) return 'too_long';
      if (q.required && t.length === 0) return 'required';
      return null;
    }
    if (q.type === 'radio') {
      return q.required && !isValidOption(q, v) ? 'required' : null;
    }
    return null; // the checkbox is never required
  }

  // ---- Public functions -------------------------------------------------------------------

  // The questions to show, in order: those whose follow-up condition is met. Optionally only one screen.
  function visibleQuestions(answers, screen) {
    return QUESTIONS.filter(function (q) {
      return (screen === undefined || q.screen === screen) && isVisible(q, answers);
    });
  }

  // A cleaned copy of `answers`: hidden questions are removed and values that are not valid answers
  // are dropped. This is what stops a stale answer from a changed branch reaching the response.
  function pruneHidden(answers) {
    var out = {};
    QUESTIONS.forEach(function (q) {
      if (!isVisible(q, answers)) return;
      var v = answers[q.id];
      if (q.type === 'text') {
        if (typeof v === 'string' && v.length > 0) out[q.id] = v;
      } else if (q.type === 'radio') {
        if (isValidOption(q, v)) out[q.id] = v;
      } else if (v === 'yes') {
        out[q.id] = 'yes';
      }
    });
    // "I don't remember" and a typed course exclude each other.
    if (out.kuccps_placed_dont_remember === 'yes') delete out.kuccps_placed_course;
    return out;
  }

  // Record one answer and return the new answers object (the input is not changed). Any follow-up
  // that is now hidden is cleared. Unknown ids and invalid radio values are ignored.
  function setAnswer(answers, id, value) {
    var q = BY_ID[id];
    var next = Object.assign({}, answers);
    if (q) {
      if (value === null || value === undefined || value === '' || (q.type === 'checkbox' && value !== 'yes')) {
        delete next[id];
      } else if (q.type === 'text') {
        if (typeof value === 'string') next[id] = value;
      } else if (q.type === 'radio') {
        if (isValidOption(q, value)) next[id] = value;
      } else {
        next[id] = 'yes';
      }
      if (id === 'kuccps_placed_dont_remember' && next[id] === 'yes') delete next.kuccps_placed_course;
      if (id === 'kuccps_placed_course' && trimmed(next[id]).length > 0) delete next.kuccps_placed_dont_remember;
    }
    return pruneHidden(next);
  }

  // { valid, missing: [ids in display order], reasons: { id: 'required' | 'too_long' } }
  // Only visible questions count. Optional questions may be blank.
  function validateScreen(screen, answers) {
    if (SCREENS.indexOf(screen) === -1) throw new Error('Not a background screen: ' + screen);
    var missing = [];
    var reasons = {};
    visibleQuestions(answers, screen).forEach(function (q) {
      var p = problem(q, answers);
      if (p) { missing.push(q.id); reasons[q.id] = p; }
    });
    return { valid: missing.length === 0, missing: missing, reasons: reasons };
  }

  // How many required visible questions on this screen are answered (for the progress bar).
  function screenProgress(screen, answers) {
    var total = 0;
    var answered = 0;
    visibleQuestions(answers, screen).forEach(function (q) {
      if (!q.required) return;
      total++;
      if (!problem(q, answers)) answered++;
    });
    return { answered: answered, total: total };
  }

  // The 13 flat response fields, in FIELD_ORDER. Throws if a required answer is missing.
  // Hidden questions are "" (see the NOT-SHOWN CONVENTION at the top of this file).
  function buildBackgroundFields(answers) {
    var clean = pruneHidden(answers);
    SCREENS.forEach(function (s) {
      var v = validateScreen(s, clean);
      if (!v.valid) throw new Error('Missing or invalid background answer(s) on screen ' + s + ': ' + v.missing.join(', '));
    });
    var fields = {};
    QUESTIONS.forEach(function (q) {
      if (!isVisible(q, clean)) { fields[q.id] = ''; return; }
      if (q.type === 'text') fields[q.id] = trimmed(clean[q.id]);
      else if (q.type === 'checkbox') fields[q.id] = clean[q.id] === 'yes' ? 'yes' : 'no';
      else fields[q.id] = clean[q.id];
    });
    return fields;
  }

  // Same 13 fields as buildBackgroundFields, but for a survey that is not finished: it never throws.
  // A shown question that has no valid answer yet is "" (not shown is "" too, as always). Once every
  // required answer is in, the result is identical to buildBackgroundFields (a test checks this).
  function buildPartialBackgroundFields(answers) {
    var clean = pruneHidden(answers && typeof answers === 'object' ? answers : {});
    var fields = {};
    QUESTIONS.forEach(function (q) {
      if (!isVisible(q, clean)) { fields[q.id] = ''; return; }
      if (q.type === 'text') fields[q.id] = trimmed(clean[q.id]);
      else if (q.type === 'checkbox') fields[q.id] = clean[q.id] === 'yes' ? 'yes' : 'no';
      else fields[q.id] = isValidOption(q, clean[q.id]) ? clean[q.id] : '';
    });
    return fields;
  }

  // Valid random answers for the ?debug helper. `rand` is a function returning a number in [0, 1),
  // e.g. Math.random. The admission route is random, so different branches get exercised.
  var SAMPLE_COURSES = [
    'BSc Computer Science', 'Bachelor of Commerce', 'BSc Nursing', 'LLB', 'BEd Arts',
    'BSc Civil Engineering', 'Bachelor of Architecture', 'BA Journalism'
  ];

  function randomAnswers(rand) {
    function pick(list) { return list[Math.floor(rand() * list.length)]; }
    var a = {};
    QUESTIONS.forEach(function (q) {
      if (!isVisible(q, a)) return; // parents come first, so their answers are already in place
      if (q.type === 'radio') {
        a = setAnswer(a, q.id, pick(q.options).value);
      } else if (q.type === 'text') {
        if (q.required || rand() < 0.5) a = setAnswer(a, q.id, pick(SAMPLE_COURSES));
      } else if (!trimmed(a[q.attachTo]) && rand() < 0.4) {
        a = setAnswer(a, q.id, 'yes');
      }
    });
    return a;
  }

  root.ChaguoBackground = {
    SCREENS: SCREENS,
    MAX_TEXT: MAX_TEXT,
    QUESTIONS: QUESTIONS,
    FIELD_ORDER: FIELD_ORDER,
    visibleQuestions: visibleQuestions,
    pruneHidden: pruneHidden,
    setAnswer: setAnswer,
    validateScreen: validateScreen,
    screenProgress: screenProgress,
    buildBackgroundFields: buildBackgroundFields,
    buildPartialBackgroundFields: buildPartialBackgroundFields,
    randomAnswers: randomAnswers
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ChaguoBackground;
})(typeof window !== 'undefined' ? window : globalThis);
