import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { findUiBundle } from '../src/bundle.mjs';
import { PING_PATH } from '../src/forward.mjs';
import { bundleNameOf, createUiServer } from '../src/uiserver.mjs';
import { close, fakeApp, fakePageScript, listen, request, tempHome } from './helpers.mjs';

async function setup(t, { wantIndicator = () => true, script = fakePageScript() } = {}) {
  const dir = tempHome();
  const appPath = fakeApp(dir, [
    { name: 'index.html', data: Buffer.from('<!doctype html>') },
    { name: 'main.js', data: Buffer.from(script) },
    { name: 'jetbox.css', data: Buffer.from('body{}') },
    { name: 'voices/a b.mp3', data: Buffer.from([1, 2, 3]), store: true },
  ]);
  const file = path.join(appPath, 'Contents', 'Resources', 'bin', 'language_server');
  const scripts = [];
  let bundle = null;
  const server = createUiServer({
    getBundle: () => (bundle ??= findUiBundle(file)),
    wantIndicator,
    onScript: (report) => scripts.push(report),
    identity: () => ({ pid: 9 }),
  });
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { port, scripts, file };
}

test('a request path becomes a file name of the archive, or nothing', () => {
  assert.equal(bundleNameOf('/'), 'index.html');
  assert.equal(bundleNameOf('/main.js'), 'main.js');
  assert.equal(bundleNameOf('/voices/a%20b.mp3'), 'voices/a b.mp3');
  for (const bad of ['/../secret', '/a/../../b', '/a//b', '/./a', '/a/', '/%2e%2e/x', '/a%00b', '/a\\b', 'main.js', '/%zz']) {
    assert.equal(bundleNameOf(bad), null, bad);
  }
});

test('page files come out of the archive with their types', async (t) => {
  const { port } = await setup(t, { wantIndicator: () => false });
  const index = await request({ port, path: '/?x=1' });
  assert.equal(index.status, 200);
  assert.equal(index.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(index.body.toString('utf8'), '<!doctype html>');
  assert.equal((await request({ port, path: '/jetbox.css' })).headers['content-type'], 'text/css; charset=utf-8');
  const sound = await request({ port, path: '/voices/a%20b.mp3' });
  assert.equal(sound.headers['content-type'], 'audio/mpeg');
  assert.deepEqual([...sound.body], [1, 2, 3]);
  assert.equal((await request({ port, path: '/main.js' })).body.toString('utf8'), fakePageScript());

  assert.equal((await request({ port, path: '/missing.png' })).status, 404);
  assert.equal((await request({ port, path: '/../etc/passwd' })).status, 404);
  assert.equal((await request({ port, method: 'POST', path: '/main.js', body: 'x' })).status, 405);
  const head = await request({ port, method: 'HEAD', path: '/jetbox.css' });
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], '6');
  assert.equal(head.body.length, 0);
});

test('the page script gets the component once, and the result is kept', async (t) => {
  const { port, scripts } = await setup(t);
  const first = await request({ port, path: '/main.js' });
  const second = await request({ port, path: '/main.js' });
  assert.ok(first.body.toString('utf8').includes('contextUsageIndicator:(()=>'));
  assert.ok(first.body.equals(second.body));
  assert.equal(Number(first.headers['content-length']), first.body.length);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].patched, true);
});

test('a page script that cannot be changed is served as it is', async (t) => {
  const original = fakePageScript({ anchor: '' });
  const { port, scripts } = await setup(t, { script: original });
  assert.equal((await request({ port, path: '/main.js' })).body.toString('utf8'), original);
  assert.equal(scripts[0].patched, false);
  assert.match(scripts[0].reason, /not found/);
});

test('a missing program gives an error answer, not a crash', async (t) => {
  const { port, file } = await setup(t);
  fs.rmSync(file);
  const res = await request({ port, path: '/main.js' });
  assert.equal(res.status, 500);
  assert.match(res.body.toString('utf8'), /cannot read the page files/);
});

test('the ping path is answered locally', async (t) => {
  const { port } = await setup(t);
  const res = await request({ port, path: PING_PATH });
  assert.deepEqual(JSON.parse(res.body.toString('utf8')), { app: 'agy-flags', role: 'devui', pid: 9 });
});
