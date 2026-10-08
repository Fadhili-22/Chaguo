/*
 * Chaguo survey - Google Apps Script web app (schema_version "3").
 *
 * Paste this whole file into the Apps Script editor of the Google Sheet that should hold the
 * responses (see SETUP.md). The browser POSTs one JSON snapshot per request; doPost() checks it,
 * keeps only the known columns, and appends ONE new row. Rows are never updated or deleted.
 * Analysis later keeps the latest row per response_id.
 *
 * Everything that decides what is allowed (validation, cleaning) is in plain functions with no
 * Google calls, so tests/apps-script.test.js can load this file in Node and test them.
 * Only doPost / doGet touch Google services.
 *
 * Nothing identifying is stored: no IP address (Apps Script does not provide one) and no user info.
 */

var SCHEMA_VERSION = '3';
var SHEET_NAME = 'Responses';
var FALLBACK_SHEET_NAME = 'Responses_schema_' + SCHEMA_VERSION;
var MAX_BODY_CHARS = 20000;
var MAX_COURSE = 100;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
var VERSION_RE = /^[A-Za-z0-9._-]{1,20}$/;
var HOLLAND_RE = /^[RIASEC]{3}$/;
var MAX_MS = 7 * 24 * 60 * 60 * 1000; // a week: anything bigger is not a real timing

/*
 * COLUMNS: the Sheet's column order. Each entry says how its value is cleaned:
 *   uuid | const (must equal `value`) | iso | int (min..max, whole number) | bool | ms | version |
 *   holland | enum (one of `values`) | text (cut to `max`) | server (filled by the server)
 * Anything that fails its check is written as "" (the empty string), never guessed.
 * The order and the allowed values must match the survey's snapshot; tests/apps-script.test.js checks this.
 */
function col(name, type, extra) {
  var c = { name: name, type: type };
  if (extra) for (var k in extra) c[k] = extra[k];
  return c;
}

var COLUMNS = (function () {
  var c = [];
  c.push(col('response_id', 'uuid'));
  c.push(col('schema_version', 'const', { value: SCHEMA_VERSION }));
  c.push(col('started_at', 'iso'));
  c.push(col('finished_at', 'iso'));
  var types = ['R', 'I', 'A', 'S', 'E', 'C'];
  var n, t;
  for (t = 0; t < types.length; t++) for (n = 1; n <= 8; n++) c.push(col(types[t] + n, 'int', { min: 1, max: 5 }));
  c.push(col('attention_check', 'int', { min: 1, max: 5 }));
  c.push(col('attention_passed', 'bool'));
  for (t = 0; t < types.length; t++) c.push(col('score_' + types[t], 'int', { min: 8, max: 40 }));
  c.push(col('holland_code', 'holland'));
  c.push(col('course', 'text', { max: MAX_COURSE }));
  c.push(col('uni_type', 'enum', { values: ['public', 'private', 'not_sure'] }));
  c.push(col('year_of_study', 'enum', { values: ['year_1', 'year_2', 'year_3', 'year_4', 'year_5_plus', 'graduated_2y'] }));
  c.push(col('admission_route', 'enum', { values: ['kuccps_placed', 'kuccps_elsewhere', 'direct', 'not_sure'] }));
  c.push(col('kuccps_first_choice', 'enum', { values: ['yes', 'no', 'dont_remember'] }));
  c.push(col('kuccps_placed_course', 'text', { max: MAX_COURSE }));
  c.push(col('kuccps_placed_dont_remember', 'enum', { values: ['yes', 'no'] }));
  c.push(col('switched_course', 'enum', { values: ['yes', 'no'] }));
  c.push(col('original_course', 'text', { max: MAX_COURSE }));
  c.push(col('satisfaction', 'int', { min: 1, max: 5 }));
  c.push(col('choose_again', 'enum', { values: ['yes', 'not_sure', 'no'] }));
  c.push(col('gender', 'enum', { values: ['female', 'male', 'prefer_not_to_say'] }));
  c.push(col('age_band', 'enum', { values: ['18_20', '21_23', '24_26', '27_plus', 'prefer_not_to_say'] }));
  for (n = 1; n <= 8; n++) c.push(col('time_screen_' + n, 'ms'));
  c.push(col('time_total_ms', 'ms'));
  c.push(col('user_agent_is_mobile', 'bool'));
  c.push(col('stage', 'enum', { values: ['screen_1', 'screen_2', 'screen_3', 'screen_4', 'screen_5', 'screen_6', 'screen_7', 'screen_8', 'complete'] }));
  c.push(col('is_complete', 'enum', { values: ['yes', 'no'] }));
  c.push(col('client_sent_at', 'iso'));
  c.push(col('consent_version', 'version'));
  c.push(col('is_test', 'enum', { values: ['yes', 'no'] }));
  c.push(col('received_at', 'server'));
  return c;
})();

var COLUMN_NAMES = COLUMNS.map(function (c) { return c.name; });

// ---- Cleaning (pure) -------------------------------------------------------------------------

// Google Sheets treats a cell that starts with = + - @ as a formula (and tab / line breaks can be used
// to sneak one in). A leading ' makes it plain text. Applied to every string that gets written.
function neutraliseFormula(s) {
  return /^[=+\-@\t\r\n]/.test(s) ? "'" + s : s;
}

function cleanValue(c, v) {
  switch (c.type) {
    case 'uuid':
      return typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : '';
    case 'const':
      return v === c.value ? v : '';
    case 'iso':
      return typeof v === 'string' && v.length <= 40 && ISO_RE.test(v) ? v : '';
    case 'int':
      return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= c.min && v <= c.max ? v : '';
    case 'ms':
      return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= MAX_MS ? v : '';
    case 'bool':
      return v === true || v === false ? v : '';
    case 'version':
      return typeof v === 'string' && VERSION_RE.test(v) ? v : '';
    case 'holland':
      return typeof v === 'string' && HOLLAND_RE.test(v) ? v : '';
    case 'enum':
      return typeof v === 'string' && c.values.indexOf(v) !== -1 ? v : '';
    case 'text':
      return typeof v === 'string' ? neutraliseFormula(v.slice(0, c.max)) : '';
    default:
      return '';
  }
}

// Check a request body (a string). Returns { ok:true, record } or { ok:false, error }.
// Rejects: too big, not JSON, not an object, wrong schema_version, response_id that is not a UUID.
// Everything else is cleaned column by column; keys that are not columns are dropped.
function validateBody(body) {
  if (typeof body !== 'string' || body.length === 0) return { ok: false, error: 'empty body' };
  if (body.length > MAX_BODY_CHARS) return { ok: false, error: 'body too large' };
  var data;
  try { data = JSON.parse(body); } catch (e) { return { ok: false, error: 'not valid JSON' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'not a JSON object' };
  if (data.schema_version !== SCHEMA_VERSION) return { ok: false, error: 'unsupported schema_version' };
  if (typeof data.response_id !== 'string' || !UUID_RE.test(data.response_id)) return { ok: false, error: 'invalid response_id' };
  var record = {};
  COLUMNS.forEach(function (c) {
    if (c.type === 'server') return;
    // hasOwnProperty: an attacker-supplied "__proto__" or "constructor" key must never be read
    record[c.name] = cleanValue(c, Object.prototype.hasOwnProperty.call(data, c.name) ? data[c.name] : '');
  });
  return { ok: true, record: record };
}

// The cleaned record as an array in COLUMNS order, with received_at filled in.
function toRow(record, receivedAtIso) {
  return COLUMNS.map(function (c) {
    return c.type === 'server' ? receivedAtIso : record[c.name];
  });
}

// ---- Writing to a sheet (works with a real Spreadsheet or a test double) ---------------------

// Is the header row of `sheet` exactly COLUMN_NAMES? 'empty' | 'match' | 'mismatch'
function headerState(sheet) {
  if (sheet.getLastRow() === 0) return 'empty';
  if (sheet.getLastColumn() !== COLUMN_NAMES.length) return 'mismatch';
  var header = sheet.getRange(1, 1, 1, COLUMN_NAMES.length).getValues()[0];
  for (var i = 0; i < COLUMN_NAMES.length; i++) if (header[i] !== COLUMN_NAMES[i]) return 'mismatch';
  return 'match';
}

// Returns the sheet that is ready to take a row (header present and correct), or null.
function prepareSheet(ss, name) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var state = headerState(sheet);
  if (state === 'empty') {
    sheet.getRange(1, 1, 1, COLUMN_NAMES.length).setValues([COLUMN_NAMES]);
    return sheet;
  }
  return state === 'match' ? sheet : null;
}

// Append one row. If the main tab already has a different header, use the schema-specific tab
// instead of writing misaligned columns. No locking here (doPost does that).
function appendResponse(ss, record, receivedAtIso) {
  var sheet = prepareSheet(ss, SHEET_NAME) || prepareSheet(ss, FALLBACK_SHEET_NAME);
  if (!sheet) return { ok: false, error: 'sheet header mismatch' };
  sheet.appendRow(toRow(record, receivedAtIso));
  return { ok: true, sheet: sheet.getName() };
}

// The whole request, minus the Google services: body in, { ok } / { ok:false, error } out.
function handleBody(body, ss, nowIso) {
  var v = validateBody(body);
  if (!v.ok) return v;
  return appendResponse(ss, v.record, nowIso);
}

// ---- Web app entry points (Google services; not run by the tests) ----------------------------

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // One request at a time, so two people finishing together cannot write over each other.
    lock.waitLock(20000);
  } catch (err) {
    return jsonOutput_({ ok: false, retry: true, error: 'busy, try again' });
  }
  try {
    var body = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    var result = handleBody(body, SpreadsheetApp.getActiveSpreadsheet(), new Date().toISOString());
    return jsonOutput_(result.ok ? { ok: true } : { ok: false, error: result.error });
  } catch (err2) {
    return jsonOutput_({ ok: false, retry: true, error: 'server error' });
  } finally {
    lock.releaseLock();
  }
}

// Opening the web app address in a browser shows this: a quick way to check the deployment is live.
function doGet() {
  return jsonOutput_({ ok: true, service: 'chaguo-survey', schema_version: SCHEMA_VERSION });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    SHEET_NAME: SHEET_NAME,
    FALLBACK_SHEET_NAME: FALLBACK_SHEET_NAME,
    MAX_BODY_CHARS: MAX_BODY_CHARS,
    COLUMNS: COLUMNS,
    COLUMN_NAMES: COLUMN_NAMES,
    neutraliseFormula: neutraliseFormula,
    cleanValue: cleanValue,
    validateBody: validateBody,
    toRow: toRow,
    headerState: headerState,
    prepareSheet: prepareSheet,
    appendResponse: appendResponse,
    handleBody: handleBody
  };
}
