/*
 * The "snapshot": the full response so far, sent to the Sheet after each completed screen.
 * Pure functions only: no DOM, no storage, no clock (the caller passes the time in).
 * Works in the browser (window.ChaguoSnapshot) and in Node (require).
 *
 * A snapshot always has the same 89 fields in the same order (the 84 core fields from scoring.js,
 * then the 5 sending fields). Anything not known yet is "" - same convention as background.js.
 * The Sheet only ever gets new rows; analysis keeps the latest row per response_id.
 */
(function (root) {
  'use strict';

  var node = typeof module !== 'undefined' && module.exports;
  var Items = node ? require('./items.js') : root.ChaguoItems;
  var Scoring = node ? require('./scoring.js') : root.ChaguoScoring;
  var Background = node ? require('./background.js') : root.ChaguoBackground;

  var STAGES = ['screen_1', 'screen_2', 'screen_3', 'screen_4', 'screen_5', 'screen_6', 'screen_7', 'screen_8', 'complete'];

  // Fields added in schema 3, after the 84 core fields. The server adds received_at after these.
  var SENDING_FIELDS = ['stage', 'is_complete', 'client_sent_at', 'consent_version', 'is_test'];

  function iso(ms) { return new Date(ms).toISOString(); }

  // "yes" when this is not the live site: ?debug is on, or the page is a local file, localhost, or a LAN address.
  function isTestEnvironment(loc, debugOn) {
    if (debugOn) return 'yes';
    var protocol = (loc && loc.protocol) || '';
    var host = String((loc && loc.hostname) || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (protocol === 'file:' || host === '') return 'yes';
    if (host === 'localhost' || host === '::1' || /\.local$/.test(host) || /\.localhost$/.test(host)) return 'yes';
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return 'yes';
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 'yes';
    return 'no';
  }

  // The 84 core fields while the survey is unfinished: known values in, "" for the rest.
  function buildPartial(o) {
    var answers = o.answers || {};
    var r = {
      response_id: o.responseId,
      schema_version: Scoring.SCHEMA_VERSION,
      started_at: iso(o.startedAtMs),
      finished_at: ''
    };
    Items.ITEM_IDS.forEach(function (id) { r[id] = Scoring.isValidAnswer(answers[id]) ? answers[id] : ''; });
    var check = Scoring.isValidAnswer(o.attentionCheck) ? o.attentionCheck : '';
    r.attention_check = check;
    r.attention_passed = check === '' ? '' : check === Items.ATTENTION_CHECK.passValue;

    // A type's score exists once all 8 of its items are answered; the code once all six scores exist.
    var scores = {};
    var allScores = true;
    Scoring.TYPES.forEach(function (t) {
      var sum = 0;
      for (var n = 1; n <= Items.ITEMS_PER_TYPE; n++) {
        var v = answers[t + n];
        if (!Scoring.isValidAnswer(v)) { sum = null; break; }
        sum += v;
      }
      scores[t] = sum;
      if (sum === null) allScores = false;
      r['score_' + t] = sum === null ? '' : sum;
    });
    r.holland_code = allScores ? Scoring.hollandCode(scores).code : '';

    var bg = Background.buildPartialBackgroundFields(o.bg);
    Object.keys(bg).forEach(function (k) { r[k] = bg[k]; });

    for (var i = 0; i < Scoring.TIMED_SCREENS; i++) {
      var ms = o.screenTimes && o.screenTimes[i];
      r['time_screen_' + (i + 1)] = ms > 0 ? ms : ''; // "" = screen not reached yet
    }
    r.time_total_ms = o.nowMs - o.startedAtMs;
    r.user_agent_is_mobile = !!o.isMobile;
    return r;
  }

  // opts: stage ('screen_1'..'screen_8' | 'complete'), responseId, startedAtMs, nowMs, answers {R1..C8},
  //       attentionCheck, bg (the background answers as kept by app.js), screenTimes [8 x ms], isMobile,
  //       isTest ('yes' | 'no'), consentVersion
  // For 'complete' the strict builders are used, so a snapshot can't claim completeness with answers missing.
  function buildSnapshot(opts) {
    if (STAGES.indexOf(opts.stage) === -1) throw new Error('Unknown stage: ' + opts.stage);
    var complete = opts.stage === 'complete';
    var r;
    if (complete) {
      r = Scoring.buildResponse({
        responseId: opts.responseId,
        startedAt: iso(opts.startedAtMs),
        finishedAt: iso(opts.nowMs),
        answers: opts.answers,
        attentionCheck: opts.attentionCheck,
        background: Background.buildBackgroundFields(opts.bg),
        screenTimes: opts.screenTimes,
        totalMs: opts.nowMs - opts.startedAtMs,
        isMobile: opts.isMobile
      });
    } else {
      r = buildPartial(opts);
    }
    r.stage = opts.stage;
    r.is_complete = complete ? 'yes' : 'no';
    r.client_sent_at = iso(opts.nowMs);
    r.consent_version = opts.consentVersion;
    r.is_test = opts.isTest === 'yes' ? 'yes' : 'no';
    return r;
  }

  root.ChaguoSnapshot = {
    STAGES: STAGES,
    SENDING_FIELDS: SENDING_FIELDS,
    isTestEnvironment: isTestEnvironment,
    buildSnapshot: buildSnapshot
  };
  if (node) module.exports = root.ChaguoSnapshot;
})(typeof window !== 'undefined' ? window : globalThis);
