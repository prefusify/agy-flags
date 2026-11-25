import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApi } from '../src/api.mjs';
import { PING_PATH } from '../src/forward.mjs';
import { close, listen, request } from './helpers.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'a'.repeat(64);

async function setup(t, { notesFile = path.join(ROOT, 'src', 'flag-notes.json') } = {}) {
  const calls = [];
  const server = createApi({
    token: TOKEN,
    uiDir: path.join(ROOT, 'ui'),
    catalogFile: path.join(ROOT, 'src', 'catalog.json'),
    notesFile,
    identity: () => ({ pid: 1 }),
    getState: async () => ({ enabled: true }),
    getServerFlags: () => ({ version: 1, flags: {} }),
    actions: {
      setFlags: async (changes) => {
        calls.push(['setFlags', changes]);
        return changes && changes.reject ? { ok: false, error: 'server-type', name: 'reject' } : { ok: true };
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
  const port = await listen(server);
  t.after(() => close(server));
  const auth = { 'x-agy-flags-token': TOKEN };
  const json = { ...auth, 'content-type': 'application/json' };
  return { port, calls, auth, json };
}

const parse = (res) => JSON.parse(res.body.toString('utf8'));

test('the page is served without a token, with a strict content security policy', async (t) => {
  const { port } = await setup(t);
  for (const pathname of ['/', '/app.js', '/style.css']) {
    const res = await request({ port, path: pathname });
    assert.equal(res.status, 200, pathname);
    assert.match(res.headers['content-security-policy'], /default-src 'none'/);
    assert.match(res.headers['content-security-policy'], /script-src 'self'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  }
  assert.equal((await request({ port, path: '/../package.json' })).status, 404);
  assert.equal((await request({ port, path: '/src/config.mjs' })).status, 404);
});

test('the page has no inline script or style, so the policy does not break it', async (t) => {
  const { port } = await setup(t);
  const html = (await request({ port, path: '/' })).body.toString('utf8');
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'inline <script>');
  assert.ok(!/<style/i.test(html), 'inline <style>');
  assert.ok(!/\sstyle=/i.test(html), 'style attribute');
  assert.ok(!/\son[a-z]+=/i.test(html), 'inline event handler');
});

test('every API call needs the token', async (t) => {
  const { port, auth, calls } = await setup(t);
  assert.equal((await request({ port, path: '/api/state' })).status, 401);
  assert.equal((await request({ port, path: '/api/state', headers: { 'x-agy-flags-token': 'b'.repeat(64) } })).status, 401);
  assert.equal((await request({ port, path: '/api/state', headers: { 'x-agy-flags-token': 'short' } })).status, 401);
  const post = await request({ port, method: 'POST', path: '/api/enabled', headers: { 'content-type': 'application/json' }, body: '{"enabled":false}' });
  assert.equal(post.status, 401);
  assert.equal(calls.length, 0);
  const ok = await request({ port, path: '/api/state', headers: auth });
  assert.equal(ok.status, 200);
  assert.deepEqual(parse(ok), { enabled: true });
});

test('a request with a foreign Host is refused, even with the token', async (t) => {
  const { port, auth } = await setup(t);
  for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`]) {
    const res = await request({ port, path: '/api/state', headers: { ...auth, host } });
    assert.equal(res.status, 403, host);
  }
  assert.equal((await request({ port, path: '/', headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await request({ port, path: '/api/state', headers: { ...auth, host: `localhost:${port}` } })).status, 200);
});

test('a request from another origin is refused, even with the token', async (t) => {
  const { port, json, calls } = await setup(t);
  const body = '{"enabled":false}';
  const cross = await request({ port, method: 'POST', path: '/api/enabled', headers: { ...json, origin: 'https://evil.example' }, body });
  assert.equal(cross.status, 403);
  const otherPort = await request({ port, method: 'POST', path: '/api/enabled', headers: { ...json, origin: `http://127.0.0.1:${port + 1}` }, body });
  assert.equal(otherPort.status, 403);
  const site = await request({ port, method: 'POST', path: '/api/enabled', headers: { ...json, 'sec-fetch-site': 'cross-site' }, body });
  assert.equal(site.status, 403);
  assert.equal(calls.length, 0);
  const same = await request({ port, method: 'POST', path: '/api/enabled', headers: { ...json, origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }, body });
  assert.equal(same.status, 200);
  assert.deepEqual(calls, [['setEnabled', false]]);
});

test('POST needs a JSON content type and a small JSON body', async (t) => {
  const { port, auth, json, calls } = await setup(t);
  const form = await request({ port, method: 'POST', path: '/api/enabled', headers: { ...auth, 'content-type': 'text/plain' }, body: '{"enabled":false}' });
  assert.equal(form.status, 415);
  const broken = await request({ port, method: 'POST', path: '/api/enabled', headers: json, body: '{nope' });
  assert.equal(broken.status, 400);
  const array = await request({ port, method: 'POST', path: '/api/enabled', headers: json, body: '[]' });
  assert.equal(array.status, 400);
  const big = await request({ port, method: 'POST', path: '/api/flags', headers: json, body: JSON.stringify({ pad: 'x'.repeat(70 * 1024) }) });
  assert.equal(big.status, 413);
  assert.equal(calls.length, 0);
});

test('actions are called and their refusals come back as 400', async (t) => {
  const { port, json, auth, calls } = await setup(t);
  const ok = await request({ port, method: 'POST', path: '/api/flags', headers: json, body: '{"changes":{"a":true,"b":null}}' });
  assert.equal(ok.status, 200);
  const refused = await request({ port, method: 'POST', path: '/api/flags', headers: json, body: '{"changes":{"reject":true}}' });
  assert.equal(refused.status, 400);
  assert.equal(parse(refused).error, 'server-type');
  assert.equal((await request({ port, method: 'POST', path: '/api/restart-client', headers: json, body: '{}' })).status, 200);
  assert.deepEqual(calls, [['setFlags', { a: true, b: null }], ['setFlags', { reject: true }], ['restartClient']]);

  assert.equal((await request({ port, method: 'POST', path: '/api/nothing', headers: json, body: '{}' })).status, 404);
  assert.equal((await request({ port, method: 'PUT', path: '/api/flags', headers: json, body: '{}' })).status, 405);
  assert.equal((await request({ port, path: '/api/nothing', headers: auth })).status, 404);
  const catalog = parse(await request({ port, path: '/api/catalog', headers: auth }));
  assert.ok(catalog.groups.length > 0);
});

test('the flag notes are served, and a missing notes file gives an empty list', async (t) => {
  const { port, auth } = await setup(t);
  assert.equal((await request({ port, path: '/api/flag-notes' })).status, 401);
  const notes = parse(await request({ port, path: '/api/flag-notes', headers: auth }));
  assert.ok(notes.groups.length > 0);
  assert.ok(Object.keys(notes.flags).length > 0);

  const missing = await setup(t, { notesFile: path.join(ROOT, 'no-such-notes.json') });
  assert.deepEqual(parse(await request({ port: missing.port, path: '/api/flag-notes', headers: missing.auth })), { groups: [], flags: {} });
});

test('the ping needs no token', async (t) => {
  const { port } = await setup(t);
  const res = await request({ port, path: PING_PATH });
  assert.deepEqual(parse(res), { app: 'agy-flags', role: 'ui', pid: 1 });
});
