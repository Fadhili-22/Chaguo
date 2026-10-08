// A small local stand-in for the Google Apps Script web app, for tests.
// Modes: ok | ok-no-cors-headers (stores, but the browser may not read the reply) | fail (HTTP 500) |
//        reject ({ok:false}) | down (connection dropped).
// mock.requests: every request (POSTs with the parsed body; OPTIONS = a preflight, which must never happen).
// mock.stored: the snapshots a real endpoint would have saved.
import http from 'node:http';

export async function startMock() {
  // Modes: ok | ok-no-cors-headers (stores, but the browser may not read the reply) | fail (HTTP 500) |
  //        reject ({ok:false}) | down (connection dropped)
  const mock = { mode: 'ok', failFirst: 0, requests: [], stored: [], url: '' };
  const STORING = ['ok', 'ok-no-cors-headers'];
  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (req.method === 'OPTIONS') { // a preflight: the survey must never cause one
      mock.requests.push({ method: 'OPTIONS', headers: req.headers });
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' });
      return res.end();
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      let mode = mock.mode;
      if (mock.failFirst > 0) { mock.failFirst--; mode = 'fail'; }
      let parsed = null;
      try { parsed = JSON.parse(body); } catch {}
      mock.requests.push({ method: req.method, contentType: req.headers['content-type'], body: parsed, mode });
      if (mode === 'down') return req.socket.destroy();
      if (STORING.includes(mode) && parsed) mock.stored.push(parsed);
      if (mode === 'fail') { res.writeHead(500, cors); return res.end('server error'); }
      if (mode === 'reject') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end('{"ok":false,"error":"nope"}'); }
      res.writeHead(200, mode === 'ok' ? { ...cors, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  mock.url = `http://127.0.0.1:${server.address().port}/exec`;
  const resetMock = (mode = 'ok') => { mock.mode = mode; mock.failFirst = 0; mock.requests.length = 0; mock.stored.length = 0; };


  mock.origin = new URL(mock.url).origin;
  mock.close = () => new Promise((r) => server.close(r));
  mock.reset = resetMock;
  return mock;
}
