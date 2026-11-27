import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { API_PREFIX, createApi, refusal } from '../src/api.mjs';
import { close, listen, request } from './helpers.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const JSON_TYPE = { 'content-type': 'application/json' };

async function setup(t, { failDownload = false, peerCheck, catalogFile = path.join(ROOT, 'src', 'catalog.json') } = {}) {
  const calls = [];
  const checked = [];
  const api = createApi({
    catalogFile,
    getState: async () => ({ enabled: true }),
    getServerFlags: () => ({ version: 1, flags: { a: true } }),
    peerCheck:
      peerCheck ??
      (async (socket) => {
        checked.push(socket.remotePort);
        return true;
      }),
    actions: {
      setFlags: async (changes) => {
        calls.push(['setFlags', changes]);
        if (changes && changes.reject) return { ok: false, error: 'server-type', name: 'reject' };
        if (changes && changes.busy) return { ok: false, error: 'busy' };
        return { ok: true };
      },
      setFeatures: async (changes, flags) => {
        calls.push(['setFeatures', changes, flags]);
        return { ok: true };
      },
      refreshPrices: async () => {
        calls.push(['refreshPrices']);
        return failDownload ? { ok: false, error: 'download-failed', detail: 'offline' } : { ok: true };
      },
      setEnabled: async (enabled) => {
        calls.push(['setEnabled', enabled]);
        return { ok: true };
      },
      restartClient: async () => {
        calls.push(['restartClient']);
        return { ok: true };
      },
    },
  });
  // The page-file server hands over every path below the prefix. So does this one.
  const server = http.createServer((req, res) => {
    api(req, res, (req.url || '/').split('?')[0]).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  const port = await listen(server);
  t.after(() => close(server));
  const get = (name, headers = {}) => request({ port, path: `${API_PREFIX}${name}`, headers });
  const post = (name, body, headers = JSON_TYPE, method = 'POST') =>
    request({ port, method, path: `${API_PREFIX}${name}`, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { port, calls, checked, get, post };
}

const parse = (res) => JSON.parse(res.body.toString('utf8'));

test('the state, the flags of the servers and the catalog can be read', async (t) => {
  const { get } = await setup(t);
  const state = await get('state.json');
  assert.equal(state.status, 200);
  assert.deepEqual(parse(state), { enabled: true });
  assert.equal(state.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(state.headers['cache-control'], 'no-store');
  assert.equal(state.headers['x-content-type-options'], 'nosniff');
  assert.equal(state.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(state.headers['access-control-allow-origin'], undefined);
  assert.deepEqual(parse(await get('server-flags.json')), { version: 1, flags: { a: true } });
  const catalog = parse(await get('catalog.json'));
  assert.ok(catalog.groups.length > 0);
  assert.ok(catalog.sections.length > 0);
  // A query does not change what is asked for.
  assert.equal((await get('state.json?x=1')).status, 200);
});

test('only the known names are answered, and only as <name>.json', async (t) => {
  const { port, get, post, calls } = await setup(t);
  for (const name of ['nothing.json', 'state', 'state.txt', 'State.json', '../state.json', 'a/state.json', '', 'flag-notes.json']) {
    assert.equal((await get(name)).status, 404, name);
  }
  // What can be changed cannot be read, and what can be read cannot be changed.
  assert.equal((await get('flags.json')).status, 404);
  assert.equal((await get('prices-refresh.json')).status, 404);
  assert.equal((await post('state.json', {})).status, 404);
  assert.equal((await post('nothing.json', {})).status, 404);
  assert.equal((await post('flags.json', {}, JSON_TYPE, 'PUT')).status, 405);
  assert.equal((await request({ port, method: 'DELETE', path: `${API_PREFIX}flags.json` })).status, 405);
  // A name of Object.prototype is not a name of ours.
  assert.equal((await get('constructor.json')).status, 404);
  assert.equal((await post('constructor.json', {})).status, 404);
  assert.equal(calls.length, 0);
});

test('an unreadable catalog gives an empty list, not an error', async (t) => {
  const { get } = await setup(t, { catalogFile: path.join(ROOT, 'no-such-file.json') });
  assert.deepEqual(parse(await get('catalog.json')), { groups: [] });
});

test('a caller that is not a program of the same user is refused', async (t) => {
  const seen = [];
  const { get, post, calls } = await setup(t, {
    peerCheck: async (socket) => {
      seen.push(typeof socket.remotePort);
      return false;
    },
  });
  const read = await get('state.json');
  assert.equal(read.status, 403);
  assert.deepEqual(parse(read), { error: 'caller not recognized' });
  assert.equal((await post('enabled.json', { enabled: false })).status, 403);
  assert.equal(calls.length, 0);
  // The check gets the connection of the request.
  assert.deepEqual(seen, ['number', 'number']);
});

test('a request with a foreign Host is refused, before anybody looks up the caller', async (t) => {
  const { port, get, checked } = await setup(t);
  for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`, '127.0.0.1', `[::1]:${port}`]) {
    const res = await get('state.json', { host });
    assert.equal(res.status, 403, host);
    assert.deepEqual(parse(res), { error: 'bad host' });
  }
  assert.equal(checked.length, 0);
  assert.equal((await get('state.json', { host: `localhost:${port}` })).status, 200);
  assert.equal((await get('state.json', { host: `LOCALHOST:${port}` })).status, 200);
  assert.equal(checked.length, 2);
});

test('a request that a page of another site makes the browser send is refused', async (t) => {
  const { port, post, get, calls, checked } = await setup(t);
  const body = { enabled: false };
  // A browser that talks to us directly names an Origin for every change. Even our own address is refused:
  // the page of agy-flags never talks to us directly, and the language server removes the header.
  for (const origin of ['https://evil.example', `http://127.0.0.1:${port + 1}`, `http://127.0.0.1:${port}`, 'null']) {
    const res = await post('enabled.json', body, { ...JSON_TYPE, origin });
    assert.equal(res.status, 403, origin);
    assert.deepEqual(parse(res), { error: 'bad origin' });
  }
  // The language server passes this header on. Only a page of its own origin may ask.
  for (const site of ['cross-site', 'same-site', 'none']) {
    const res = await post('enabled.json', body, { ...JSON_TYPE, 'sec-fetch-site': site });
    assert.equal(res.status, 403, site);
    assert.deepEqual(parse(res), { error: 'cross-site request' });
    assert.equal((await get('state.json', { 'sec-fetch-site': site })).status, 403, site);
  }
  assert.equal(calls.length, 0);
  assert.equal(checked.length, 0);
  const same = await post('enabled.json', body, { ...JSON_TYPE, 'sec-fetch-site': 'same-origin' });
  assert.equal(same.status, 200);
  assert.deepEqual(calls, [['setEnabled', false]]);
});

test('a change needs a JSON content type and a small JSON object', async (t) => {
  const { post, calls } = await setup(t);
  // What a form of another site can send without asking first.
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) {
    const res = await post('enabled.json', '{"enabled":false}', type ? { 'content-type': type } : {});
    assert.equal(res.status, 415, type);
  }
  assert.equal((await post('enabled.json', '{nope')).status, 400);
  assert.equal((await post('enabled.json', '[]')).status, 400);
  assert.equal((await post('enabled.json', 'null')).status, 400);
  assert.equal((await post('enabled.json', '"text"')).status, 400);
  assert.equal((await post('flags.json', { pad: 'x'.repeat(70 * 1024) })).status, 413);
  assert.equal(calls.length, 0);
  assert.equal((await post('enabled.json', { enabled: true }, { 'content-type': 'Application/JSON; charset=utf-8' })).status, 200);
  assert.deepEqual(calls, [['setEnabled', true]]);
});

test('each change calls its action, and a refusal comes back with its own status', async (t) => {
  const { post, calls } = await setup(t);
  assert.equal((await post('flags.json', { changes: { a: true, b: null } })).status, 200);
  const refused = await post('flags.json', { changes: { reject: true } });
  assert.equal(refused.status, 400);
  assert.deepEqual(parse(refused), { ok: false, error: 'server-type', name: 'reject' });
  assert.equal((await post('flags.json', { changes: { busy: true } })).status, 409);
  assert.equal((await post('features.json', { changes: { costPrices: true }, flags: { 'enable-cost-accumulator': true } })).status, 200);
  assert.equal((await post('features.json', { changes: { costPrices: false } })).status, 200);
  assert.equal((await post('enabled.json', { enabled: false })).status, 200);
  assert.equal((await post('prices-refresh.json', {})).status, 200);
  const restart = await post('restart-client.json', {});
  assert.equal(restart.status, 200);
  assert.deepEqual(parse(restart), { ok: true });
  assert.deepEqual(calls, [
    ['setFlags', { a: true, b: null }],
    ['setFlags', { reject: true }],
    ['setFlags', { busy: true }],
    ['setFeatures', { costPrices: true }, { 'enable-cost-accumulator': true }],
    ['setFeatures', { costPrices: false }, undefined],
    ['setEnabled', false],
    ['refreshPrices'],
    ['restartClient'],
  ]);
});

test('a download of the price list that fails is told to the page', async (t) => {
  const { post } = await setup(t, { failDownload: true });
  const res = await post('prices-refresh.json', {});
  assert.equal(res.status, 502);
  assert.deepEqual(parse(res), { ok: false, error: 'download-failed', detail: 'offline' });
});

test('refusal: the reasons, in the order they are looked at', () => {
  const req = (headers, localPort = 47933) => ({ headers, socket: { localPort } });
  assert.equal(refusal(req({ host: '127.0.0.1:47933' })), null);
  assert.equal(refusal(req({ host: 'localhost:47933', 'sec-fetch-site': 'same-origin' })), null);
  assert.equal(refusal(req({})), 'bad host');
  assert.equal(refusal(req({ host: '127.0.0.1:47933' }, 47931)), 'bad host');
  assert.equal(refusal(req({ host: 'evil.example', origin: 'https://evil.example' })), 'bad host');
  assert.equal(refusal(req({ host: '127.0.0.1:47933', origin: '' })), 'bad origin');
  assert.equal(refusal(req({ host: '127.0.0.1:47933', origin: 'http://127.0.0.1:47933', 'sec-fetch-site': 'cross-site' })), 'bad origin');
  assert.equal(refusal(req({ host: '127.0.0.1:47933', 'sec-fetch-site': 'cross-site' })), 'cross-site request');
  assert.equal(refusal(req({ host: '127.0.0.1:47933', 'sec-fetch-site': '' })), 'cross-site request');
  assert.equal(refusal({ headers: { host: '127.0.0.1:47933' } }), 'bad host');
});
