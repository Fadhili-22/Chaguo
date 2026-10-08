/*
 * Screen flow, state, rendering and timings. All survey state lives in the single `state` object.
 * Scoring is in scoring.js (pure functions); item data is in items.js.
 */
(function () {
  'use strict';

  // Replace with the live survey address before sharing (used in the WhatsApp message).
  var SURVEY_URL = 'https://SURVEY_URL_PLACEHOLDER';

  var STORAGE_KEY = 'chaguo_survey_state_v1';
  var UNDERAGE_KEY = 'chaguo_survey_underage';
  var RESTORABLE_SCREENS = ['items', 'background']; // the opening screen is never restored: it is where consent happens

  var Items = window.ChaguoItems;
  var Scoring = window.ChaguoScoring;

  var LETTERS = {
    R: { name: 'Realistic', blurb: 'You tend to enjoy practical, hands-on work: building, fixing and operating tools or machines.' },
    I: { name: 'Investigative', blurb: 'You tend to enjoy working things out: studying, researching and solving problems that need careful thinking.' },
    A: { name: 'Artistic', blurb: 'You tend to enjoy creative, expressive work such as music, writing, design or performing, and coming up with original ideas.' },
    S: { name: 'Social', blurb: 'You tend to enjoy helping, teaching and caring for people, and working with others to support them.' },
    E: { name: 'Enterprising', blurb: 'You tend to enjoy leading, persuading and selling: taking charge, running things and making them happen in business.' },
    C: { name: 'Conventional', blurb: 'You tend to enjoy organised, detail-focused work: keeping records, working with numbers and following clear steps.' }
  };

  var debugParam = new URLSearchParams(window.location.search).get('debug');
  var DEBUG_ON = debugParam === '1' || debugParam === 'fail';

  // ---- State ------------------------------------------------------------------------------

  var state = {
    screen: 'start',        // start | exit | items | background | results
    itemScreen: 1,          // 1..6, used when screen === 'items'
    responseId: null,
    startedAtMs: null,      // set when the respondent presses the 18+/agree button
    answers: {},            // R1..C8 -> 1..5
    attentionCheck: null,   // 1..5, kept apart from answers so it can never be scored
    screenTimes: [0, 0, 0, 0, 0, 0], // ms per item screen, accumulated across back/forth
    enteredAt: null,        // when the current item screen was shown (not persisted)
    response: null          // the finished response object (not persisted)
  };

  // ---- Small helpers ----------------------------------------------------------------------

  function $(id) { return document.getElementById(id); }

  function safeGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (e) { /* storage unavailable: carry on */ }
  }
  function safeRemove(key) {
    try { window.sessionStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function makeUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); });
    return [h.slice(0, 4), h.slice(4, 6), h.slice(6, 8), h.slice(8, 10), h.slice(10)]
      .map(function (p) { return p.join(''); }).join('-');
  }

  function isMobile() {
    var uad = navigator.userAgentData;
    if (uad && typeof uad.mobile === 'boolean') return uad.mobile;
    return /Mobi|Android/i.test(navigator.userAgent || '');
  }

  function getAnswer(id) {
    return id === Items.ATTENTION_CHECK.id ? state.attentionCheck : state.answers[id];
  }
  function setAnswer(id, value) {
    if (id === Items.ATTENTION_CHECK.id) state.attentionCheck = value;
    else state.answers[id] = value;
  }
  function answeredCount() {
    return Object.keys(state.answers).length;
  }

  // ---- Timing -----------------------------------------------------------------------------

  // Add the time spent on the current item screen so far, then restart the clock.
  function flushTime() {
    if (state.screen === 'items' && state.enteredAt !== null) {
      var now = Date.now();
      state.screenTimes[state.itemScreen - 1] += now - state.enteredAt;
      state.enteredAt = now;
    }
  }

  // ---- Persistence (sessionStorage, so a refresh doesn't lose answers) ---------------------

  function persist() {
    if (RESTORABLE_SCREENS.indexOf(state.screen) === -1) return; // never store exit/results
    flushTime();
    safeSet(STORAGE_KEY, JSON.stringify({
      screen: state.screen,
      itemScreen: state.itemScreen,
      responseId: state.responseId,
      startedAtMs: state.startedAtMs,
      answers: state.answers,
      attentionCheck: state.attentionCheck,
      screenTimes: state.screenTimes
    }));
  }

  function restore() {
    var raw = safeGet(STORAGE_KEY);
    if (!raw) return;
    try {
      var s = JSON.parse(raw);
      if (RESTORABLE_SCREENS.indexOf(s.screen) === -1) return;
      if (typeof s.startedAtMs !== 'number' || typeof s.responseId !== 'string') return;
      var answers = {};
      Items.ITEM_IDS.forEach(function (id) {
        if (Scoring.isValidAnswer(s.answers && s.answers[id])) answers[id] = s.answers[id];
      });
      var times = Array.isArray(s.screenTimes) && s.screenTimes.length === Items.SCREEN_COUNT &&
        s.screenTimes.every(function (t) { return typeof t === 'number' && t >= 0; });
      state.screen = s.screen;
      state.itemScreen = Number.isInteger(s.itemScreen) && s.itemScreen >= 1 && s.itemScreen <= Items.SCREEN_COUNT ? s.itemScreen : 1;
      state.responseId = s.responseId;
      state.startedAtMs = s.startedAtMs;
      state.answers = answers;
      state.attentionCheck = Scoring.isValidAnswer(s.attentionCheck) ? s.attentionCheck : null;
      state.screenTimes = times ? s.screenTimes : [0, 0, 0, 0, 0, 0];
      state.enteredAt = state.screen === 'items' ? Date.now() : null;
    } catch (e) { /* corrupt data: start fresh */ }
  }

  // ---- Navigation -------------------------------------------------------------------------

  function goTo(screen, itemScreen) {
    flushTime(); // closes the clock on the screen we're leaving
    state.screen = screen;
    if (itemScreen) state.itemScreen = itemScreen;
    state.enteredAt = screen === 'items' ? Date.now() : null;
    persist();
    show();
  }

  function show() {
    var sections = document.querySelectorAll('[data-screen]');
    Array.prototype.forEach.call(sections, function (el) {
      el.hidden = el.getAttribute('data-screen') !== state.screen;
    });
    if (state.screen === 'items') renderItemScreen();
    if (state.screen === 'results') renderResults();
    var section = $('screen-' + state.screen);
    var heading = section.querySelector('h1');
    window.scrollTo(0, 0);
    if (heading) heading.focus({ preventScroll: true });
  }

  // ---- Item screens -----------------------------------------------------------------------

  function buildItem(item) {
    var fs = document.createElement('fieldset');
    fs.className = 'item';
    fs.setAttribute('data-id', item.id);

    var legend = document.createElement('legend');
    legend.textContent = item.text;
    fs.appendChild(legend);

    var scale = document.createElement('div');
    scale.className = 'scale';
    var words = { 1: 'Dislike', 3: 'Neutral', 5: 'Enjoy' }; // only 1, 3 and 5 are labelled
    var current = getAnswer(item.id);
    for (var v = 1; v <= 5; v++) {
      var label = document.createElement('label');
      label.className = 'choice';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = item.id;
      input.value = String(v);
      input.checked = current === v;
      var box = document.createElement('span');
      box.className = 'choice-box';
      box.textContent = String(v);
      var word = document.createElement('span');
      word.className = 'choice-word';
      word.textContent = words[v] || '';
      label.appendChild(input);
      label.appendChild(box);
      label.appendChild(word);
      scale.appendChild(label);
    }
    fs.appendChild(scale);

    var err = document.createElement('p');
    err.className = 'item-error';
    err.textContent = 'Please choose an answer for this one.';
    fs.appendChild(err);
    return fs;
  }

  function renderItemScreen() {
    var n = state.itemScreen;
    $('items-progress-label').textContent = 'Screen ' + n + ' of ' + Items.SCREEN_COUNT;
    var list = $('items-list');
    list.textContent = '';
    Items.getScreenItems(n).forEach(function (item) { list.appendChild(buildItem(item)); });
    $('items-summary').hidden = true;
    $('items-back').hidden = n === 1;
    updateProgress();
  }

  function updateProgress() {
    var done = answeredCount();
    $('items-progress').setAttribute('aria-valuenow', String(done));
    $('items-progress-fill').style.width = (done / Items.ITEMS.length * 100) + '%';
  }

  function missingOnScreen() {
    return Items.getScreenItems(state.itemScreen).filter(function (it) { return getAnswer(it.id) == null; });
  }

  function showMissing(missing) {
    missing.forEach(function (it) {
      var fs = document.querySelector('.item[data-id="' + it.id + '"]');
      if (fs) fs.classList.add('is-missing');
    });
    refreshSummary(missing.length);
    var first = document.querySelector('.item.is-missing input');
    if (first) {
      first.scrollIntoView({ block: 'center' });
      first.focus();
    }
  }

  function refreshSummary(count) {
    var summary = $('items-summary');
    if (count > 0) {
      summary.textContent = count === 1 ? '1 item still needs an answer.' : count + ' items still need an answer.';
      summary.hidden = false;
    } else {
      summary.hidden = true;
    }
  }

  function onItemChange(e) {
    var input = e.target;
    if (!input || input.type !== 'radio') return;
    setAnswer(input.name, parseInt(input.value, 10));
    var fs = input.closest('.item');
    if (fs) fs.classList.remove('is-missing');
    if (!$('items-summary').hidden) refreshSummary(document.querySelectorAll('.item.is-missing').length);
    updateProgress();
    persist();
  }

  function onNext() {
    var missing = missingOnScreen();
    if (missing.length) { showMissing(missing); return; }
    if (state.itemScreen < Items.SCREEN_COUNT) goTo('items', state.itemScreen + 1);
    else goTo('background');
  }

  function onBack() {
    if (state.itemScreen > 1) goTo('items', state.itemScreen - 1);
  }

  // ---- Finishing and results --------------------------------------------------------------

  function finishSurvey() {
    flushTime();
    state.enteredAt = null;
    var finishedMs = Date.now();
    state.response = Scoring.buildResponse({
      responseId: state.responseId,
      startedAt: new Date(state.startedAtMs).toISOString(),
      finishedAt: new Date(finishedMs).toISOString(),
      answers: state.answers,
      attentionCheck: state.attentionCheck,
      screenTimes: state.screenTimes,
      totalMs: finishedMs - state.startedAtMs,
      isMobile: isMobile()
    });
    console.log('Chaguo survey response object:', state.response);
    safeRemove(STORAGE_KEY); // cleared on reaching results
    state.screen = 'results';
    show();
  }

  function renderResults() {
    var r = state.response;
    var scores = {};
    Items.TYPES.forEach(function (t) { scores[t] = r['score_' + t]; });
    var h = Scoring.hollandCode(scores);

    $('results-code').textContent = h.code;
    $('results-code-names').textContent = h.code.split('').map(function (l) { return LETTERS[l].name; }).join(' · ');

    var tie = $('results-tie-note');
    if (h.tieAffected) {
      tie.textContent = 'Note: some of your scores were tied. Ties are settled in the fixed order R, I, A, S, E, C, and that affected your code.';
      tie.hidden = false;
    } else {
      tie.hidden = true;
    }

    var bars = $('results-bars');
    bars.textContent = '';
    h.ranking.forEach(function (letter, i) {
      var row = document.createElement('div');
      row.className = 'score-row';

      var head = document.createElement('div');
      head.className = 'score-head';
      var name = document.createElement('span');
      name.textContent = LETTERS[letter].name + ' (' + letter + ')';
      var value = document.createElement('span');
      value.className = 'score-value';
      value.textContent = scores[letter] + ' / 40';
      head.appendChild(name);
      head.appendChild(value);

      var bar = document.createElement('div');
      bar.className = 'bar';
      var fill = document.createElement('div');
      fill.className = 'bar-fill' + (i < 3 ? ' in-code' : '');
      fill.style.width = (scores[letter] / 40 * 100) + '%';
      bar.appendChild(fill);

      var blurb = document.createElement('p');
      blurb.className = 'score-blurb';
      blurb.textContent = LETTERS[letter].blurb;

      row.appendChild(head);
      row.appendChild(bar);
      row.appendChild(blurb);
      bars.appendChild(row);
    });

    var text = 'My interest code is ' + h.code + ' — find yours: ' + SURVEY_URL;
    $('results-share').href = 'https://wa.me/?text=' + encodeURIComponent(text);
  }

  // ---- Debug helper (does nothing without ?debug=1 or ?debug=fail) -------------------------

  function debugFillAndFinish() {
    Items.ITEMS.forEach(function (it) { state.answers[it.id] = 1 + Math.floor(Math.random() * 5); });
    state.attentionCheck = debugParam === 'fail' ? 5 : Items.ATTENTION_CHECK.passValue;
    if (state.startedAtMs === null) {
      state.startedAtMs = Date.now();
      state.responseId = makeUuid();
    }
    finishSurvey();
  }

  // ---- Wiring -----------------------------------------------------------------------------

  function init() {
    if (safeGet(UNDERAGE_KEY) === '1') {
      state.screen = 'exit';
    } else {
      restore();
    }

    // One button is both age confirmation and consent; timing starts here.
    $('start-agree').addEventListener('click', function () {
      state.startedAtMs = Date.now();
      state.responseId = makeUuid();
      goTo('items', 1);
    });
    $('start-underage').addEventListener('click', function () {
      safeRemove(STORAGE_KEY);
      safeSet(UNDERAGE_KEY, '1'); // a flag only; stops re-entry during this browser session
      goTo('exit');
    });
    $('items-list').addEventListener('change', onItemChange);
    $('items-next').addEventListener('click', onNext);
    $('items-back').addEventListener('click', onBack);
    $('background-back').addEventListener('click', function () { goTo('items', Items.SCREEN_COUNT); });
    $('background-continue').addEventListener('click', finishSurvey);

    if (DEBUG_ON) {
      $('debug-bar').hidden = false;
      $('debug-fill').addEventListener('click', debugFillAndFinish);
    }

    // Keep the stored time up to date if the page is closed or hidden mid-screen.
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') persist();
    });

    show();
  }

  init();
})();
