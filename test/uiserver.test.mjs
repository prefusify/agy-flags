import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { findUiBundle } from '../src/bundle.mjs';
import { PING_PATH } from '../src/forward.mjs';
import { bundleNameOf, createUiServer } from '../src/uiserver.mjs';
import { close, fakeApp, fakePageScript, listen, request, tempHome } from './helpers.mjs';

async function setup(t, { wantIndicator = () => true, script = fakePageScript(), ...options } = {}) {
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
    ...options,
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

const COST_PLACE = 'q.costSummary!==void 0&&(r.costSummary=q.costSummary);';
const costScript = (base = fakePageScript()) => `${base}function take(q,r){${COST_PLACE}return r}`;
const PRICES = { version: 'v1', rows: { 'gemini-4-neon': [3, 15, 0.15] } };

test('the costs are filled in with the price table, and a new table gives a new script', async (t) => {
  let prices = PRICES;
  const { port, scripts } = await setup(t, { script: costScript(), getPrices: () => prices });
  const first = (await request({ port, path: '/main.js' })).body.toString('utf8');
  assert.ok(first.includes('contextUsageIndicator:(()=>'));
  assert.ok(first.includes('__agyFlagsCost'));
  assert.ok(first.includes('{"gemini-4-neon":[3,15,0.15]}'));
  assert.equal(scripts.length, 1);
  assert.deepEqual(scripts[0].parts, { contextUsageIndicator: { ok: true, reason: null }, costPrices: { ok: true, reason: null } });
  assert.equal(scripts[0].patched, true);

  // The same table: the script that was made is used again.
  await request({ port, path: '/main.js' });
  assert.equal(scripts.length, 1);

  // Other prices: a script with them, not the old one.
  prices = { version: 'v2', rows: { 'gemini-4-neon': [4, 16, 0.2] } };
  const second = (await request({ port, path: '/main.js' })).body.toString('utf8');
  assert.ok(second.includes('{"gemini-4-neon":[4,16,0.2]}'));
  assert.equal(scripts.length, 2);

  // The feature goes off: the costs are left alone again.
  prices = false;
  const third = (await request({ port, path: '/main.js' })).body.toString('utf8');
  assert.equal(third.includes('__agyFlagsCost'), false);
  assert.ok(third.includes('contextUsageIndicator:(()=>'));
  assert.deepEqual(Object.keys(scripts[2].parts), ['contextUsageIndicator']);
});

test('the costs alone, without the indicator', async (t) => {
  const original = costScript();
  const { port, scripts } = await setup(t, { script: original, wantIndicator: () => false, getPrices: () => PRICES });
  const body = (await request({ port, path: '/main.js' })).body.toString('utf8');
  assert.ok(body.includes('__agyFlagsCost'));
  assert.ok(body.includes('contextUsageIndicator:void 0,'));
  assert.deepEqual(scripts[0].parts, { costPrices: { ok: true, reason: null } });
});

test('one change that cannot be made does not stop the other, and the report says which', async (t) => {
  // No place for the costs in this script.
  const { port, scripts } = await setup(t, { getPrices: () => PRICES });
  const body = (await request({ port, path: '/main.js' })).body.toString('utf8');
  assert.ok(body.includes('contextUsageIndicator:(()=>'));
  assert.equal(scripts[0].patched, false);
  assert.equal(scripts[0].parts.contextUsageIndicator.ok, true);
  assert.match(scripts[0].parts.costPrices.reason, /found 0 times/);
  assert.match(scripts[0].reason, /found 0 times/);
});

test('without a price list the script is served without the costs, and says so', async (t) => {
  let prices = null;
  let waited = 0;
  const original = costScript();
  const { port, scripts } = await setup(t, {
    script: original,
    wantIndicator: () => false,
    getPrices: () => prices,
    beforeScript: async () => {
      waited += 1;
    },
  });
  assert.equal((await request({ port, path: '/main.js' })).body.toString('utf8'), original);
  assert.equal(waited, 1);
  assert.deepEqual(scripts[0].parts, { costPrices: { ok: false, reason: 'there is no price list yet' } });
  assert.equal(scripts[0].patched, false);
  // Other files do not wait for the price list.
  await request({ port, path: '/jetbox.css' });
  assert.equal(waited, 1);
  // The list arrives: the next request gets the costs.
  prices = PRICES;
  assert.ok((await request({ port, path: '/main.js' })).body.toString('utf8').includes('__agyFlagsCost'));
  assert.equal(scripts[1].patched, true);
});

const WORDS = { version: 'w1', data: { exact: { 'New Conversation': '新建对话' }, patterns: [] } };

test('the Chinese interface: the translator goes at the end of the script, and a new word list gives a new script', async (t) => {
  let words = WORDS;
  const original = fakePageScript();
  const { port, scripts } = await setup(t, { script: original, wantIndicator: () => false, getL10n: () => words });
  const first = (await request({ port, path: '/main.js' })).body.toString('utf8');
  assert.ok(first.startsWith(original));
  assert.ok(first.includes('__agyFlagsL10n'));
  assert.ok(first.includes('新建对话'));
  // The indicator is another feature, and it is off.
  assert.ok(first.includes('contextUsageIndicator:void 0,'));
  assert.deepEqual(scripts[0].parts, { l10n: { ok: true, reason: null } });
  assert.equal(scripts[0].patched, true);

  await request({ port, path: '/main.js' });
  assert.equal(scripts.length, 1);

  words = { version: 'w2', data: { exact: { 'New Conversation': '新对话' }, patterns: [] } };
  assert.ok((await request({ port, path: '/main.js' })).body.toString('utf8').includes('新对话'));
  assert.equal(scripts.length, 2);

  // A word list that cannot be read: the original script, and the report says why.
  words = null;
  assert.equal((await request({ port, path: '/main.js' })).body.toString('utf8'), original);
  assert.deepEqual(scripts[2].parts, { l10n: { ok: false, reason: 'the word list cannot be read' } });
  assert.equal(scripts[2].patched, false);

  // The feature goes off: the original script, and nothing is prepared.
  words = false;
  assert.equal((await request({ port, path: '/main.js' })).body.toString('utf8'), original);
  assert.equal(scripts.length, 3);
});

test('the Chinese interface and the indicator together', async (t) => {
  const { port, scripts } = await setup(t, { getL10n: () => WORDS });
  const body = (await request({ port, path: '/main.js' })).body.toString('utf8');
  assert.ok(body.includes('contextUsageIndicator:(()=>'));
  assert.ok(body.includes('__agyFlagsL10n'));
  assert.deepEqual(scripts[0].parts, { contextUsageIndicator: { ok: true, reason: null }, l10n: { ok: true, reason: null } });
});
