/*
 * Sending snapshots to the Google Apps Script endpoint. Never blocks the respondent: every send is
 * fire-and-forget from the survey's point of view.
 *
 * How it works:
 *   - send(snapshot) puts the snapshot in a one-slot queue (a newer snapshot replaces the older one,
 *     because it contains everything the older one did), then tries to send what is in the queue.
 *   - If the send fails, the snapshot simply stays queued. The next send() tries again with the newest.
 *   - The queue is also mirrored in sessionStorage, so it survives a page refresh.
 *   - A reply of {ok:false} means the server refused the data; retrying can't fix that, so such a
 *     snapshot is dropped after REJECT_LIMIT refusals.
 *
 * Settings come from config.js: SURVEY_ENDPOINT ("" = saving off) and SEND_MODE ("cors" | "no-cors").
 * Plain <script>, browser only (the logic is exercised by tests/saving.test.mjs in a real browser).
 */
(function (root) {
  'use strict';

  var QUEUE_KEY = 'chaguo_send_queue_v1';
  var TIMEOUT_MS = 10000;
  var REJECT_LIMIT = 3;

  var queue = null;        // { seq, snapshot, rejected } or null
  var seqCounter = 0;
  var lastSavedSeq = 0;
  var draining = null;     // promise while a drain loop is running
  var beaconedSeq = 0;

  function endpoint() {
    return typeof root.SURVEY_ENDPOINT === 'string' ? root.SURVEY_ENDPOINT.trim() : '';
  }
  function enabled() { return endpoint() !== ''; }
  function mode() { return root.SEND_MODE === 'no-cors' ? 'no-cors' : 'cors'; }

  function storageGet() { try { return root.sessionStorage.getItem(QUEUE_KEY); } catch (e) { return null; } }
  function storageSet(v) { try { root.sessionStorage.setItem(QUEUE_KEY, v); } catch (e) { /* carry on without it */ } }
  function storageRemove() { try { root.sessionStorage.removeItem(QUEUE_KEY); } catch (e) { /* ignore */ } }

  function setQueue(q) {
    queue = q;
    if (q) storageSet(JSON.stringify(q)); else storageRemove();
  }

  // Pick up a queue left behind by a refresh.
  function loadQueue() {
    var raw = storageGet();
    if (!raw) return;
    try {
      var q = JSON.parse(raw);
      if (q && q.snapshot && typeof q.snapshot.response_id === 'string') {
        queue = { seq: ++seqCounter, snapshot: q.snapshot, rejected: q.rejected | 0 };
      }
    } catch (e) { storageRemove(); }
  }

  // One attempt. Resolves 'ok', 'rejected' (server said no) or 'failed' (network/timeout/odd reply).
  function post(snapshot) {
    var body = JSON.stringify(snapshot);
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    var m = mode();
    return root.fetch(endpoint(), {
      method: 'POST',
      mode: m,
      credentials: 'omit',
      redirect: 'follow',
      // text/plain keeps this a "simple" request: no CORS preflight (which Apps Script cannot answer).
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      // no-cors: the reply is opaque and unreadable; finishing without a network error counts as saved.
      if (m === 'no-cors') return 'ok';
      if (!res.ok) return 'failed';
      return res.json().then(function (j) {
        if (j && j.ok === true) return 'ok';
        if (j && j.ok === false) return j.retry === true ? 'failed' : 'rejected'; // retry:true = server busy, not a refusal
        return 'failed';
      }, function () { return 'failed'; });
    }, function () {
      clearTimeout(timer);
      return 'failed';
    });
  }

  // Send whatever is queued, newest first, until the queue is empty or an attempt fails.
  // draining is cleared in the same synchronous step as the last queue check, so a send() that
  // arrives meanwhile is never missed.
  function drain() {
    if (draining) return draining;
    if (!queue) return Promise.resolve();
    draining = (function loop() {
      var q = queue;
      if (!q) { draining = null; return Promise.resolve(); }
      return post(q.snapshot).then(function (result) {
        if (result !== 'ok') {
          console.warn('Chaguo: saving ' + (result === 'rejected' ? 'was refused by the server' : 'failed') +
            ' (SEND_MODE is "' + mode() + '"). The snapshot (' + q.snapshot.stage + ') stays queued.' +
            (result === 'failed' && mode() === 'cors' ? ' If rows still appear in the Sheet, try SEND_MODE = "no-cors" in js/config.js.' : ''));
        }
        var current = queue;
        var stillSame = current && current.seq === q.seq;
        if (result === 'ok') {
          lastSavedSeq = Math.max(lastSavedSeq, q.seq);
          if (stillSame) setQueue(null);
          return loop();
        }
        if (result === 'rejected' && stillSame) {
          q.rejected += 1;
          if (q.rejected >= REJECT_LIMIT) { setQueue(null); return loop(); }
          setQueue(q);
        }
        if (!stillSame) return loop(); // a newer snapshot arrived meanwhile: try that one
        draining = null;
        return Promise.resolve();
      });
    })();
    return draining;
  }

  // Queue this snapshot and try to send. Resolves true if this snapshot (or a newer one) was saved,
  // false if it is still waiting. Resolves true straight away when saving is off.
  function send(snapshot) {
    if (!enabled()) {
      console.log('Chaguo: saving is off (SURVEY_ENDPOINT is empty). Snapshot:', snapshot);
      return Promise.resolve(true);
    }
    var seq = ++seqCounter;
    setQueue({ seq: seq, snapshot: snapshot, rejected: 0 });
    return drain().then(function () { return lastSavedSeq >= seq; });
  }

  // Try again with whatever is still queued (for example when the browser comes back online).
  function retry() {
    if (!enabled() || !queue) return Promise.resolve(true);
    var seq = queue.seq;
    return drain().then(function () { return lastSavedSeq >= seq; });
  }

  function hasPending() { return !!queue; }

  // Forget everything queued (used if the respondent says they're under 18).
  function clear() { queue = null; storageRemove(); }

  // For when the page is being closed: fetch can be cut off, sendBeacon is built for this. Returns
  // true if the browser accepted the beacon. It cannot report whether the server stored it.
  function beacon(snapshot) {
    if (!enabled() || !root.navigator || typeof root.navigator.sendBeacon !== 'function') return false;
    try {
      var blob = new root.Blob([JSON.stringify(snapshot)], { type: 'text/plain;charset=UTF-8' });
      return root.navigator.sendBeacon(endpoint(), blob);
    } catch (e) { return false; }
  }

  // Beacon the queued (unsent) snapshot, once per queue entry.
  function beaconQueued() {
    if (!queue || queue.seq === beaconedSeq) return false;
    beaconedSeq = queue.seq;
    return beacon(queue.snapshot);
  }

  loadQueue();

  root.ChaguoSender = {
    enabled: enabled,
    send: send,
    retry: retry,
    hasPending: hasPending,
    clear: clear,
    beacon: beacon,
    beaconQueued: beaconQueued
  };
})(window);
