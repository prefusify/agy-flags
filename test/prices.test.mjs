import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PRICES_PROVIDER, PRICES_URL, cleanPrices, createPriceStore, extractPrices, fetchPriceList } from '../src/prices.mjs';
import { isPriceTable } from '../src/uipatch.mjs';
import { tempHome } from './helpers.mjs';

/** A list with the shape of models.dev, as small as the tests need. */
function fakeList(models = {}) {
  return {
    'google-vertex': {
      id: 'google-vertex',
      models: {
        'gemini-4-neon': { name: 'Gemini 4 Neon', cost: { input: 3, output: 15, cache_read: 0.15 } },
        'claude-opus-5-5@default': { name: 'Claude Opus 5.5', cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } },
        'openai/gpt-oss-120b-maas': { name: 'GPT OSS 120B', cost: { input: 0.09, output: 0.36 } },
        ...models,
      },
    },
    // Another provider sells the same model at another price. It is not used.
    other: { models: { 'gemini-4-neon': { name: 'Gemini 4 Neon', cost: { input: 99, output: 99 } } } },
  };
}

function tempFile(t) {
  const dir = tempHome();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'prices.json');
}

test('the prices of one provider are taken, under the name and under the id of each model', () => {
  const prices = extractPrices(fakeList());
  assert.deepEqual(prices['gemini-4-neon'], { name: 'Gemini 4 Neon', input: 3, output: 15, cacheRead: 0.15, cacheFromInput: false });
  assert.deepEqual(prices['claude-opus-5-5'], { name: 'Claude Opus 5.5', input: 4, output: 20, cacheRead: 0.2, cacheFromInput: false });
  // No price for cached input: the input price stands in, and the entry says so.
  assert.deepEqual(prices['gpt-oss-120b'], { name: 'GPT OSS 120B', input: 0.09, output: 0.36, cacheRead: 0.09, cacheFromInput: true });
  assert.deepEqual(Object.keys(prices).sort(), ['claude-opus-5-5', 'gemini-4-neon', 'gpt-oss-120b']);
  assert.deepEqual(extractPrices({}), {});
  assert.deepEqual(extractPrices(null), {});
  assert.deepEqual(extractPrices({ 'google-vertex': { models: [] } }), {});
});

test('only clean keys, numbers inside the limits and plain names are kept from the download', () => {
  const prices = extractPrices(
    fakeList({
      'free-model': { name: 'Free', cost: { input: 0, output: 0 } },
      'no-cost': { name: 'No cost' },
      'text-price': { name: 'Text price', cost: { input: '3', output: 15 } },
      'negative': { name: 'Negative', cost: { input: -1, output: 15 } },
      'huge': { name: 'Huge', cost: { input: 1e9, output: 15 } },
      'nan': { name: 'NaN', cost: { input: Number.NaN, output: 15 } },
      'bad-cache': { name: 'Bad cache', cost: { input: 1, output: 2, cache_read: 'free' } },
      'odd"name': { name: '<img src=x onerror=alert(1)>\u0000中', cost: { input: 1, output: 2 } },
      '': { name: '', cost: { input: 1, output: 2 } },
    })
  );
  for (const gone of ['free-model', 'no-cost', 'text-price', 'negative', 'huge', 'nan', 'free']) assert.equal(Object.hasOwn(prices, gone), false, gone);
  assert.deepEqual(prices['bad-cache'], { name: 'Bad cache', input: 1, output: 2, cacheRead: 1, cacheFromInput: true });
  for (const key of Object.keys(prices)) assert.match(key, /^[a-z0-9][a-z0-9-]*$/);
  // The name is kept as plain printable text. The page shows it as text, never as HTML.
  assert.equal(prices['odd-name'].name, '<img src=x onerror=alert(1)>');
  const rows = Object.fromEntries(Object.entries(prices).map(([key, row]) => [key, [row.input, row.output, row.cacheRead]]));
  assert.equal(isPriceTable(rows), true);
});

test('a stored list is checked again when it is read', () => {
  assert.deepEqual(
    cleanPrices({
      good: { name: 'Good', input: 1, output: 2, cacheRead: 0.1, cacheFromInput: false },
      'Bad Key': { name: 'x', input: 1, output: 2, cacheRead: 0.1 },
      short: { name: 'x', input: 1, output: 2 },
      text: { name: 'x', input: '1', output: 2, cacheRead: 0.1 },
      nothing: null,
    }),
    { good: { name: 'Good', input: 1, output: 2, cacheRead: 0.1, cacheFromInput: false } }
  );
  assert.deepEqual(cleanPrices(null), {});
  assert.deepEqual(cleanPrices([1, 2]), {});
});

test('the download asks one address, follows no redirect and has a size limit', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(fakeList()));
  };
  const list = await fetchPriceList({ fetchImpl });
  assert.equal(calls[0].url, PRICES_URL);
  assert.equal(new URL(PRICES_URL).protocol, 'https:');
  assert.equal(calls[0].options.redirect, 'error');
  // Nothing about the user or the machine goes out.
  assert.deepEqual(calls[0].options.headers, { accept: 'application/json', 'user-agent': 'agy-flags' });
  assert.equal(Object.hasOwn(list, PRICES_PROVIDER), true);

  await assert.rejects(fetchPriceList({ fetchImpl: async () => new Response('no', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(fetchPriceList({ fetchImpl: async () => new Response('x'.repeat(5000)), maxBytes: 1000 }), /too large/);
  await assert.rejects(fetchPriceList({ fetchImpl: async () => new Response('<html>') }));
});

test('the list is downloaded, kept on disk and read again', async (t) => {
  const file = tempFile(t);
  let downloads = 0;
  const logs = [];
  const store = createPriceStore({
    file,
    log: (line) => logs.push(line),
    now: () => 1000,
    fetchList: async () => {
      downloads += 1;
      return fakeList();
    },
  });
  assert.equal(store.table(), null);
  assert.equal(store.view().fetchedAt, null);
  assert.deepEqual(await store.refresh(), { ok: true });
  assert.equal(downloads, 1);
  const table = store.table();
  assert.deepEqual(table.rows['gemini-4-neon'], [3, 15, 0.15]);
  assert.match(table.version, /^[0-9a-f]{16}$/);
  assert.equal(store.table(), table);
  assert.equal(store.lookup('Gemini 4 Neon (XHigh)').input, 3);
  assert.equal(store.lookup('Orchestrator (Neon)'), null);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(logs.length, 1);

  // Another process start: the same list, without a download.
  const again = createPriceStore({ file, now: () => 2000, fetchList: async () => (downloads += 1) && fakeList() });
  assert.deepEqual(again.table(), table);
  assert.equal(again.view().fetchedAt, 1000);
  // It is fresh, so a check does not download it again.
  again.refreshIfStale();
  await again.settled(100);
  assert.equal(downloads, 1);

  // A file that somebody changed by hand cannot put anything else into the table.
  fs.writeFileSync(file, JSON.stringify({ provider: PRICES_PROVIDER, fetchedAt: 5, models: { 'x");alert(1);("': { name: 'x', input: 1, output: 2, cacheRead: 1 } } }));
  assert.equal(createPriceStore({ file }).table(), null);
  fs.writeFileSync(file, 'not json');
  assert.equal(createPriceStore({ file }).table(), null);
});

test('the settings page gets one line for each model of the client, with or without a price', async (t) => {
  const store = createPriceStore({ file: tempFile(t), now: () => 77, fetchList: async () => fakeList() });
  await store.refresh();
  const view = store.view(['Gemini 4 Neon (Low)', 'Orchestrator (Neon)', 'Gemini 4 Neon (XHigh)', 'GPT-OSS 120B (Medium)', 'Gemini 3 Flash']);
  assert.equal(view.source, PRICES_URL);
  assert.equal(view.provider, PRICES_PROVIDER);
  assert.equal(view.fetchedAt, 77);
  assert.equal(view.count, 3);
  assert.equal(view.refreshing, false);
  assert.equal(view.error, null);
  // The thinking levels of one model have one price: one line for them.
  assert.deepEqual(view.models, [
    { name: 'Gemini 4 Neon', priced: true, input: 3, output: 15, cacheRead: 0.15, cacheFromInput: false },
    // The name is the one of the client, not the one of the price list ("GPT OSS 120B").
    { name: 'GPT-OSS 120B', priced: true, input: 0.09, output: 0.36, cacheRead: 0.09, cacheFromInput: true },
    { name: 'Gemini 3 Flash', priced: false },
    { name: 'Orchestrator (Neon)', priced: false },
  ]);
  assert.deepEqual(store.view().models, []);
});

test('a download that fails keeps the old list and is tried again later', async (t) => {
  let clock = 0;
  let fail = false;
  let downloads = 0;
  const logs = [];
  const store = createPriceStore({
    file: tempFile(t),
    now: () => clock,
    maxAgeMs: 1000,
    retryMs: 100,
    log: (line) => logs.push(line),
    fetchList: async () => {
      downloads += 1;
      if (fail) throw new Error('offline');
      return fakeList();
    },
  });
  // No list yet: the first check downloads. Two callers share one download.
  store.refreshIfStale();
  store.refreshIfStale();
  assert.equal(store.view().refreshing, true);
  await store.settled(1000);
  assert.equal(downloads, 1);
  const table = store.table();

  // A fresh list is not downloaded again.
  clock = 500;
  store.refreshIfStale();
  assert.equal(downloads, 1);

  // An old one is. The download fails: the old list stays, and the failure is shown.
  clock = 2000;
  fail = true;
  store.refreshIfStale();
  await store.settled(1000);
  assert.equal(downloads, 2);
  assert.deepEqual(store.table(), table);
  assert.equal(store.view().error, 'offline');
  assert.equal(store.view().errorAt, 2000);
  assert.equal(store.view().fetchedAt, 0);

  // Not again at once, but after the wait. The same failure is logged once.
  clock = 2050;
  store.refreshIfStale();
  assert.equal(downloads, 2);
  clock = 2200;
  store.refreshIfStale();
  await store.settled(1000);
  assert.equal(downloads, 3);
  assert.equal(logs.filter((line) => line.includes('offline')).length, 1);

  // The button of the page does not wait.
  fail = false;
  assert.deepEqual(await store.refresh(), { ok: true });
  assert.equal(store.view().error, null);
  assert.equal(store.view().fetchedAt, 2200);

  // A list without prices of the provider is a failure too.
  const empty = createPriceStore({ file: tempFile(t), fetchList: async () => ({ other: {} }) });
  assert.deepEqual(await empty.refresh(), { ok: false, error: `no prices of ${PRICES_PROVIDER} in the list` });
  assert.equal(empty.table(), null);
});

test('waiting for a download ends after the given time', async (t) => {
  let finish;
  const store = createPriceStore({ file: tempFile(t), fetchList: () => new Promise((resolve) => (finish = resolve)) });
  await store.settled(10);
  store.refreshIfStale();
  const started = Date.now();
  await store.settled(30);
  assert.ok(Date.now() - started < 500);
  assert.equal(store.table(), null);
  finish(fakeList());
  await store.settled(1000);
  assert.notEqual(store.table(), null);
});
