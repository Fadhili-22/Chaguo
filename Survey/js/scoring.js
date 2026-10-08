/*
 * Scoring and response-object building. Pure functions only: no DOM, no storage, no clock.
 * Works in the browser (window.ChaguoScoring) and in Node (require).
 */
(function (root) {
  'use strict';

  var Items = (typeof module !== 'undefined' && module.exports) ? require('./items.js') : root.ChaguoItems;

  var TYPES = Items.TYPES; // R-I-A-S-E-C: also the documented tie-break order
  var SCHEMA_VERSION = '1';

  function isValidAnswer(v) {
    return Number.isInteger(v) && v >= 1 && v <= 5;
  }

  // Score per type = sum of its 8 items (8-40). Reads only R1..C8, so the attention
  // check (or any other key on `answers`) can never change a score.
  function scoreResponses(answers) {
    var scores = {};
    TYPES.forEach(function (t) {
      var sum = 0;
      for (var n = 1; n <= Items.ITEMS_PER_TYPE; n++) {
        var v = answers[t + n];
        if (!isValidAnswer(v)) throw new Error('Missing or invalid answer for ' + t + n);
        sum += v;
      }
      scores[t] = sum;
    });
    return scores;
  }

  // Letters sorted by score (high to low); equal scores fall back to R-I-A-S-E-C order.
  function rankTypes(scores) {
    return TYPES.slice().sort(function (a, b) {
      return (scores[b] - scores[a]) || (TYPES.indexOf(a) - TYPES.indexOf(b));
    });
  }

  // Holland code = top 3 letters. tieAffected is true when the fallback order decided
  // something in the code: a tie inside the top 3, or between 3rd and 4th place.
  // A tie further down (4th/5th, 5th/6th) does not change the code, so it is not flagged.
  function hollandCode(scores) {
    var ranking = rankTypes(scores);
    var tieAffected = false;
    for (var i = 0; i < 3; i++) {
      if (scores[ranking[i]] === scores[ranking[i + 1]]) tieAffected = true;
    }
    return { code: ranking.slice(0, 3).join(''), ranking: ranking, tieAffected: tieAffected };
  }

  // The flat, spreadsheet-friendly object phase 3 will send to Google Sheets.
  // opts: responseId, startedAt (ISO), finishedAt (ISO), answers {R1..C8}, attentionCheck,
  //       screenTimes [6 x ms], totalMs, isMobile
  function buildResponse(opts) {
    var scores = scoreResponses(opts.answers);
    var r = {
      response_id: opts.responseId,
      schema_version: SCHEMA_VERSION,
      started_at: opts.startedAt,
      finished_at: opts.finishedAt
    };
    Items.ITEM_IDS.forEach(function (id) { r[id] = opts.answers[id]; });
    r.attention_check = opts.attentionCheck;
    r.attention_passed = opts.attentionCheck === Items.ATTENTION_CHECK.passValue;
    TYPES.forEach(function (t) { r['score_' + t] = scores[t]; });
    r.holland_code = hollandCode(scores).code;
    for (var i = 0; i < Items.SCREEN_COUNT; i++) r['time_screen_' + (i + 1)] = opts.screenTimes[i];
    r.time_total_ms = opts.totalMs;
    r.user_agent_is_mobile = !!opts.isMobile;
    return r;
  }

  root.ChaguoScoring = {
    TYPES: TYPES,
    SCHEMA_VERSION: SCHEMA_VERSION,
    isValidAnswer: isValidAnswer,
    scoreResponses: scoreResponses,
    rankTypes: rankTypes,
    hollandCode: hollandCode,
    buildResponse: buildResponse
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ChaguoScoring;
})(typeof window !== 'undefined' ? window : globalThis);
