/*
 * Screen flow, state, rendering and timings. All survey state lives in the single `state` object.
 * Scoring is in scoring.js and the background questions' branching/validation is in background.js
 * (both pure functions); item data is in items.js.
 *
 * Survey screens 1-6 are the item screens; screens 7 and 8 are the two background screens
 * (state.screen === 'background', state.bgScreen === 7 or 8).
 */
(function () {
  'use strict';

  // Replace with the live survey address before sharing (used in the WhatsApp message).
  var SURVEY_URL = 'https://SURVEY_URL_PLACEHOLDER';

  var STORAGE_KEY = 'chaguo_survey_state_v2';
  var UNDERAGE_KEY = 'chaguo_survey_underage';
  var RESTORABLE_SCREENS = ['items', 'background']; // the opening screen is never restored: it is where consent happens

  var Items = window.ChaguoItems;
  var Scoring = window.ChaguoScoring;
  var Background = window.ChaguoBackground;
  var Snapshot = window.ChaguoSnapshot;
  var Sender = window.ChaguoSender;

  var FIRST_BG_SCREEN = Background.SCREENS[0]; // 7
  var TOTAL_SCREENS = Scoring.TIMED_SCREENS;   // 8
  var BG_TITLES = { 7: 'Your course', 8: 'A bit about you' };

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
    bgScreen: FIRST_BG_SCREEN, // 7 | 8, used when screen === 'background'
    bg: {},                 // background answers, keyed by response field name (see background.js)
    screenTimes: [0, 0, 0, 0, 0, 0, 0, 0], // ms per screen (1-8), accumulated across back/forth
    lastStage: null,        // last snapshot stage sent ('screen_1'..'screen_8'); null until a screen is completed
    dirty: false,           // answers changed since the last snapshot (not persisted)
    enteredAt: null,        // when the current timed screen was shown (not persisted)
    response: null          // the finished response object (not persisted)
  };

  // Background questions the respondent has been told are missing (highlighted until answered).
  var flagged = [];

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

  // ---- Timing -----------------------------------------------------------------------------

  // The survey screen number (1-8) being shown, or null on screens that aren't timed.
  function currentScreenNumber() {
    if (state.screen === 'items') return state.itemScreen;
    if (state.screen === 'background') return state.bgScreen;
    return null;
  }

  // Add the time spent on the current timed screen so far, then restart the clock.
  function flushTime() {
    var n = currentScreenNumber();
    if (n !== null && state.enteredAt !== null) {
      var now = Date.now();
      state.screenTimes[n - 1] += now - state.enteredAt;
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
      bgScreen: state.bgScreen,
      bg: state.bg,
      screenTimes: state.screenTimes,
      lastStage: state.lastStage
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
      var times = Array.isArray(s.screenTimes) && s.screenTimes.length === TOTAL_SCREENS &&
        s.screenTimes.every(function (t) { return typeof t === 'number' && t >= 0; });
      state.screen = s.screen;
      state.itemScreen = Number.isInteger(s.itemScreen) && s.itemScreen >= 1 && s.itemScreen <= Items.SCREEN_COUNT ? s.itemScreen : 1;
      state.bgScreen = Background.SCREENS.indexOf(s.bgScreen) !== -1 ? s.bgScreen : FIRST_BG_SCREEN;
      state.responseId = s.responseId;
      state.startedAtMs = s.startedAtMs;
      state.answers = answers;
      state.attentionCheck = Scoring.isValidAnswer(s.attentionCheck) ? s.attentionCheck : null;
      // pruneHidden drops hidden and invalid values, so nothing stale comes back from storage
      state.bg = Background.pruneHidden(s.bg && typeof s.bg === 'object' ? s.bg : {});
      state.screenTimes = times ? s.screenTimes : [0, 0, 0, 0, 0, 0, 0, 0];
      state.lastStage = typeof s.lastStage === 'string' && /^screen_[1-8]$/.test(s.lastStage) ? s.lastStage : null;
      state.enteredAt = currentScreenNumber() !== null ? Date.now() : null;
    } catch (e) { /* corrupt data: start fresh */ }
  }

  // ---- Navigation -------------------------------------------------------------------------

  // `n` is the item screen (1-6) for 'items' or the background screen (7 or 8) for 'background'.
  function goTo(screen, n) {
    flushTime(); // closes the clock on the screen we're leaving
    state.screen = screen;
    if (screen === 'items' && n) state.itemScreen = n;
    if (screen === 'background' && n) state.bgScreen = n;
    flagged = [];
    state.enteredAt = currentScreenNumber() !== null ? Date.now() : null;
    persist();
    show();
  }

  function show() {
    var sections = document.querySelectorAll('[data-screen]');
    Array.prototype.forEach.call(sections, function (el) {
      el.hidden = el.getAttribute('data-screen') !== state.screen;
    });
    if (state.screen === 'items') renderItemScreen();
    if (state.screen === 'background') renderBackgroundScreen();
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
    $('items-progress-label').textContent = 'Screen ' + n + ' of ' + TOTAL_SCREENS;
    var list = $('items-list');
    list.textContent = '';
    Items.getScreenItems(n).forEach(function (item) { list.appendChild(buildItem(item)); });
    $('items-summary').hidden = true;
    $('items-back').hidden = n === 1;
    updateProgress();
  }

  // Progress bar for both kinds of screen: finished screens plus the answered share of this one, out of 8.
  function updateProgress() {
    var n = currentScreenNumber();
    if (n === null) return;
    var share;
    if (state.screen === 'items') {
      var items = Items.getScreenItems(n);
      share = items.filter(function (it) { return getAnswer(it.id) != null; }).length / items.length;
    } else {
      var p = Background.screenProgress(n, state.bg);
      share = p.total ? p.answered / p.total : 0;
    }
    var pct = Math.round((n - 1 + share) / TOTAL_SCREENS * 100);
    var prefix = state.screen === 'items' ? 'items' : 'background';
    $(prefix + '-progress').setAttribute('aria-valuenow', String(pct));
    $(prefix + '-progress-fill').style.width = pct + '%';
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
    state.dirty = true;
    var fs = input.closest('.item');
    if (fs) fs.classList.remove('is-missing');
    if (!$('items-summary').hidden) refreshSummary(document.querySelectorAll('.item.is-missing').length);
    updateProgress();
    persist();
  }

  function onNext() {
    var missing = missingOnScreen();
    if (missing.length) { showMissing(missing); return; }
    saveProgress('screen_' + state.itemScreen);
    if (state.itemScreen < Items.SCREEN_COUNT) goTo('items', state.itemScreen + 1);
    else goTo('background', FIRST_BG_SCREEN);
  }

  function onBack() {
    if (state.itemScreen > 1) goTo('items', state.itemScreen - 1);
  }

  // ---- Background screens (7 and 8) -------------------------------------------------------
  // What is shown is decided by background.js; this code only draws it and passes answers back.

  function buildOption(q, option) {
    var label = document.createElement('label');
    label.className = 'option';
    var input = document.createElement('input');
    input.type = 'radio';
    input.name = q.id;
    input.value = String(option.value);
    input.checked = state.bg[q.id] === option.value;
    var text = document.createElement('span');
    text.className = 'option-text';
    if (q.showNumbers) {
      var num = document.createElement('span');
      num.className = 'option-num';
      num.textContent = String(option.value);
      text.appendChild(num);
    }
    text.appendChild(document.createTextNode(option.label));
    label.appendChild(input);
    label.appendChild(text);
    return label;
  }

  function buildQuestion(q, withCheckbox) {
    var box = document.createElement(q.type === 'radio' ? 'fieldset' : 'div');
    box.className = 'item' + (q.followUp ? ' followup' : '');
    box.setAttribute('data-id', q.id);

    var title;
    if (q.type === 'radio') {
      title = document.createElement('legend');
    } else {
      title = document.createElement('label');
      title.className = 'item-label';
      title.setAttribute('for', 'bg-' + q.id);
    }
    title.appendChild(document.createTextNode(q.label));
    if (!q.required) {
      var opt = document.createElement('span');
      opt.className = 'optional';
      opt.textContent = ' (optional)';
      title.appendChild(opt);
    }
    box.appendChild(title);

    if (q.type === 'radio') {
      var group = document.createElement('div');
      group.className = 'options';
      q.options.forEach(function (o) { group.appendChild(buildOption(q, o)); });
      box.appendChild(group);
    } else {
      var input = document.createElement('input');
      input.type = 'text';
      input.id = 'bg-' + q.id;
      input.name = q.id;
      input.className = 'text-input';
      input.maxLength = q.maxLength;
      input.autocomplete = 'off';
      if (q.placeholder) input.placeholder = q.placeholder;
      input.value = state.bg[q.id] || '';
      if (withCheckbox && state.bg[withCheckbox.id] === 'yes') input.disabled = true;
      box.appendChild(input);
      if (withCheckbox) {
        var row = document.createElement('label');
        row.className = 'check';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = withCheckbox.id;
        cb.checked = state.bg[withCheckbox.id] === 'yes';
        row.appendChild(cb);
        row.appendChild(document.createTextNode(withCheckbox.label));
        box.appendChild(row);
      }
    }

    var err = document.createElement('p');
    err.className = 'item-error';
    err.textContent = q.type === 'radio' ? 'Please choose an answer for this one.' : 'Please type your answer here.';
    box.appendChild(err);
    return box;
  }

  function renderQuestions() {
    var list = $('background-list');
    list.textContent = '';
    var shown = Background.visibleQuestions(state.bg, state.bgScreen);
    shown.forEach(function (q) {
      if (q.attachTo) return; // drawn inside its parent question
      var attached = shown.filter(function (x) { return x.attachTo === q.id; })[0];
      var el = buildQuestion(q, attached);
      if (flagged.indexOf(q.id) !== -1) el.classList.add('is-missing');
      list.appendChild(el);
    });
    refreshBackgroundSummary();
    updateProgress();
  }

  function renderBackgroundScreen() {
    $('background-progress-label').textContent = 'Screen ' + state.bgScreen + ' of ' + TOTAL_SCREENS;
    $('background-title').textContent = BG_TITLES[state.bgScreen];
    $('background-back').hidden = false;
    $('background-next').textContent = state.bgScreen === TOTAL_SCREENS ? 'See my results' : 'Next';
    renderQuestions();
  }

  function refreshBackgroundSummary() {
    var summary = $('background-summary');
    var n = flagged.length;
    if (n > 0) {
      summary.textContent = n === 1 ? '1 question still needs an answer.' : n + ' questions still need an answer.';
      summary.hidden = false;
    } else {
      summary.hidden = true;
    }
  }

  function unflag(id) {
    flagged = flagged.filter(function (f) { return f !== id; });
    var el = document.querySelector('#background-list .item[data-id="' + id + '"]');
    if (el) el.classList.remove('is-missing');
    refreshBackgroundSummary();
  }

  // Radios and the checkbox can change which questions are visible, so redraw and put focus back.
  function onBackgroundChange(e) {
    var input = e.target;
    if (!input || (input.type !== 'radio' && input.type !== 'checkbox')) return;
    var q = Background.QUESTIONS.filter(function (x) { return x.id === input.name; })[0];
    if (!q) return;
    var value;
    if (input.type === 'checkbox') {
      value = input.checked ? 'yes' : 'no';
    } else {
      value = q.options.filter(function (o) { return String(o.value) === input.value; })[0].value;
    }
    state.bg = Background.setAnswer(state.bg, input.name, value);
    state.dirty = true;
    flagged = flagged.filter(function (f) { return f !== q.id && Background.visibleQuestions(state.bg).some(function (v) { return v.id === f; }); });
    renderQuestions();
    var again = input.type === 'checkbox'
      ? document.querySelector('#background-list input[name="' + input.name + '"]')
      : document.querySelector('#background-list input[name="' + input.name + '"][value="' + input.value + '"]');
    if (again) again.focus({ preventScroll: true });
    persist();
  }

  // Typing never changes which questions are visible, so no redraw (it would steal focus).
  function onBackgroundInput(e) {
    var input = e.target;
    if (!input || input.type !== 'text') return;
    state.bg = Background.setAnswer(state.bg, input.name, input.value);
    state.dirty = true;
    if (Background.validateScreen(state.bgScreen, state.bg).missing.indexOf(input.name) === -1) unflag(input.name);
    updateProgress();
    persist();
  }

  function showBackgroundMissing(missing) {
    flagged = missing.slice();
    renderQuestions();
    var first = document.querySelector('#background-list .item.is-missing input');
    if (first) {
      first.scrollIntoView({ block: 'center' });
      first.focus();
    }
  }

  function onBackgroundNext() {
    var v = Background.validateScreen(state.bgScreen, state.bg);
    if (!v.valid) { showBackgroundMissing(v.missing); return; }
    if (state.bgScreen < TOTAL_SCREENS) {
      saveProgress('screen_' + state.bgScreen);
      goTo('background', state.bgScreen + 1);
      return;
    }
    // Last screen: double-check the earlier one too (a restored session could be incomplete).
    var earlier = Background.validateScreen(FIRST_BG_SCREEN, state.bg);
    if (!earlier.valid) { goTo('background', FIRST_BG_SCREEN); showBackgroundMissing(earlier.missing); return; }
    saveProgress('screen_' + TOTAL_SCREENS);
    finishSurvey();
  }

  function onBackgroundBack() {
    if (state.bgScreen > FIRST_BG_SCREEN) goTo('background', state.bgScreen - 1);
    else goTo('items', Items.SCREEN_COUNT);
  }

  // ---- Finishing and results --------------------------------------------------------------

  // ---- Saving (snapshots; see sender.js and snapshot.js) ------------------------------------

  var IS_TEST = Snapshot.isTestEnvironment(window.location, DEBUG_ON);

  // The full response so far. `stage` is the last completed screen, or 'complete'.
  function makeSnapshot(stage) {
    flushTime();
    return Snapshot.buildSnapshot({
      stage: stage,
      responseId: state.responseId,
      startedAtMs: state.startedAtMs,
      nowMs: Date.now(),
      answers: state.answers,
      attentionCheck: state.attentionCheck,
      bg: state.bg,
      screenTimes: state.screenTimes,
      isMobile: isMobile(),
      isTest: IS_TEST,
      consentVersion: typeof CONSENT_VERSION === 'string' ? CONSENT_VERSION : ''
    });
  }

  // Called when a screen has been completed (all required answers in). Never waits for the network.
  function saveProgress(stage) {
    var snapshot = makeSnapshot(stage);
    state.lastStage = stage;
    state.dirty = false;
    persist();
    Sender.send(snapshot);
  }

  // When the page is hidden or closed mid-survey: send answers given since the last snapshot with
  // sendBeacon (built for page close), or beacon an earlier snapshot that never got through.
  function saveOnLeaving() {
    var inProgress = state.screen === 'items' || state.screen === 'background';
    if (!inProgress || state.startedAtMs === null || state.lastStage === null) return;
    if (state.dirty) {
      state.dirty = false;
      Sender.beacon(makeSnapshot(state.lastStage));
    } else {
      Sender.beaconQueued();
    }
  }

  // ---- Finishing and results --------------------------------------------------------------

  function finishSurvey() {
    flushTime();
    state.enteredAt = null;
    state.response = makeSnapshot('complete');
    console.log('Chaguo survey response object:', state.response);
    safeRemove(STORAGE_KEY); // cleared on reaching results
    state.screen = 'results';
    show();
    // The snapshot is queued before this returns, so the reference code always matches a response
    // that is stored or waiting to be. A failed attempt is reported on the results screen.
    trySavingFinal(false);
  }

  function trySavingFinal(isRetry) {
    var failed = $('results-save-failed');
    var button = $('results-retry');
    if (isRetry) {
      state.response.client_sent_at = new Date().toISOString();
      button.disabled = true;
    }
    // A retry of a snapshot that is still queued keeps its count of server refusals (sender.js gives up after 3).
    var attempt = isRetry && Sender.hasPending() ? Sender.retry() : Sender.send(state.response);
    attempt.then(function (saved) {
      failed.hidden = saved;
      button.disabled = false;
    });
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

    var ref = String(r.response_id).slice(0, 8);
    $('results-ref-code').textContent = ref;
    $('results-save-failed').hidden = true;

    var text = 'My interest code is ' + h.code + ' — find yours: ' + SURVEY_URL;
    $('results-share').href = 'https://wa.me/?text=' + encodeURIComponent(text);
  }

  // ---- Debug helper (does nothing without ?debug=1 or ?debug=fail) -------------------------

  function debugFillAndFinish() {
    Items.ITEMS.forEach(function (it) { state.answers[it.id] = 1 + Math.floor(Math.random() * 5); });
    state.attentionCheck = debugParam === 'fail' ? 5 : Items.ATTENTION_CHECK.passValue;
    state.bg = Background.randomAnswers(Math.random); // random admission route, so branches get exercised
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
      Sender.clear(); // nothing is ever sent for under-18s
      safeSet(UNDERAGE_KEY, '1'); // a flag only; stops re-entry during this browser session
      goTo('exit');
    });
    $('items-list').addEventListener('change', onItemChange);
    $('items-next').addEventListener('click', onNext);
    $('items-back').addEventListener('click', onBack);
    $('background-list').addEventListener('change', onBackgroundChange);
    $('background-list').addEventListener('input', onBackgroundInput);
    $('background-back').addEventListener('click', onBackgroundBack);
    $('background-next').addEventListener('click', onBackgroundNext);
    $('results-retry').addEventListener('click', function () { trySavingFinal(true); });

    if (DEBUG_ON) {
      $('debug-bar').hidden = false;
      $('debug-fill').addEventListener('click', debugFillAndFinish);
    }

    // Keep the stored time up to date if the page is closed or hidden mid-screen.
    window.addEventListener('pagehide', function () { persist(); saveOnLeaving(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { persist(); saveOnLeaving(); }
    });
    // Back online: try again with anything that is still waiting.
    window.addEventListener('online', function () { Sender.retry(); });

    show();
  }

  init();
})();
