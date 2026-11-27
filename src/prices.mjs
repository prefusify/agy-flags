// The price list for the cost column of Antigravity's cost summary.
//
// On 2.35.1 the language server has no price list, so every cost it reports is 0. While the
// feature "costPrices" is on, the daemon downloads the public list of models.dev and keeps
// the prices of one provider in a file of its own. The page script gets them as a table of
// numbers (see uipatch.mjs).
//
// The download is data from another party, and a part of it ends up inside a script that
// runs in Antigravity's page. So only this is kept from it: for each model a key made of
// a-z, 0-9 and "-", three numbers inside fixed limits, and a short display name that is
// shown in the settings page only (as text, never as HTML).

import crypto from 'node:crypto';
import fs from 'node:fs';
import { isPriceTable, modelKey } from './uipatch.mjs';

export const PRICES_URL = 'https://models.dev/api.json';
/** One provider, so that a model has one price. Vertex is where Google sells every model of the client. */
export const PRICES_PROVIDER = 'google-vertex';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_MODELS = 2000;
const MAX_PRICE = 100_000;
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

const price = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE ? value : null);

function displayName(value, fallback) {
  const text = typeof value === 'string' ? value.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 80) : '';
  return text || fallback;
}

/**
 * The prices of one provider out of the models.dev list.
 * @returns {{ [key: string]: { name: string, input: number, output: number, cacheRead: number, cacheFromInput: boolean } }}
 *          Prices are US dollars per million tokens. A model without a price for cached
 *          input gets its input price there (`cacheFromInput`). A model that is free or has
 *          no price is left out. Prices that depend on the size of the context are not used.
 */
export function extractPrices(api, provider = PRICES_PROVIDER) {
  const models = api?.[provider]?.models;
  if (!models || typeof models !== 'object' || Array.isArray(models)) return {};
  const rows = [];
  for (const [id, model] of Object.entries(models)) {
    if (rows.length >= MAX_MODELS) break;
    const cost = model?.cost;
    if (!cost || typeof cost !== 'object') continue;
    const input = price(cost.input);
    const output = price(cost.output);
    if (input === null || output === null || (input === 0 && output === 0)) continue;
    const cached = price(cost.cache_read);
    rows.push({
      keys: [modelKey(typeof model.name === 'string' ? model.name : ''), modelKey(id)],
      row: {
        name: displayName(model.name, displayName(id, '?')),
        input,
        output,
        cacheRead: cached ?? input,
        cacheFromInput: cached === null,
      },
    });
  }
  // The key from the display name wins over the key from the id of another model.
  const out = {};
  for (const position of [0, 1]) {
    for (const { keys, row } of rows) {
      const key = keys[position];
      if (KEY_RE.test(key) && !Object.hasOwn(out, key)) out[key] = row;
    }
  }
  return out;
}

/** Check a stored or extracted list again. Returns a clean copy; entries that do not fit are dropped. */
export function cleanPrices(models) {
  const out = {};
  if (!models || typeof models !== 'object' || Array.isArray(models)) return out;
  for (const [key, row] of Object.entries(models).slice(0, MAX_MODELS * 2)) {
    if (!KEY_RE.test(key) || !row || typeof row !== 'object') continue;
    const input = price(row.input);
    const output = price(row.output);
    const cacheRead = price(row.cacheRead);
    if (input === null || output === null || cacheRead === null) continue;
    out[key] = { name: displayName(row.name, key), input, output, cacheRead, cacheFromInput: row.cacheFromInput === true };
  }
  return out;
}

/** Download the list. Only this one address is asked, and no redirect is followed. */
export async function fetchPriceList({ url = PRICES_URL, fetchImpl = globalThis.fetch, timeoutMs = 60_000, maxBytes = MAX_BYTES } = {}) {
  const res = await fetchImpl(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json', 'user-agent': 'agy-plus' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('the price list is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * The price list in memory and on disk.
 * @param {object} options
 * @param {string} options.file                    Where the list is kept.
 * @param {() => Promise<object>} [options.fetchList]  Gets the models.dev list.
 * @param {number} [options.maxAgeMs]              A list older than this is downloaded again.
 * @param {number} [options.retryMs]               How long to wait after a download that failed.
 */
export function createPriceStore({ file, fetchList = fetchPriceList, log = () => {}, now = Date.now, maxAgeMs = 24 * 3600_000, retryMs = 3600_000 }) {
  let models = {};
  let fetchedAt = null;
  let failure = null;
  let inflight = null;
  let cachedTable = null;

  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved?.provider === PRICES_PROVIDER && Number.isFinite(saved.fetchedAt)) {
      models = cleanPrices(saved.models);
      fetchedAt = Object.keys(models).length > 0 ? saved.fetchedAt : null;
    }
  } catch {
    // no list yet
  }

  function save() {
    try {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ source: PRICES_URL, provider: PRICES_PROVIDER, fetchedAt, models }), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (err) {
      log(`prices: could not save the list (${err?.message || err})`);
    }
  }

  /** Download now. One download at a time; a second caller gets the same result. */
  function refresh() {
    if (!inflight) {
      inflight = (async () => {
        try {
          const next = extractPrices(await fetchList());
          const count = Object.keys(next).length;
          if (count === 0) throw new Error(`no prices of ${PRICES_PROVIDER} in the list`);
          models = next;
          fetchedAt = now();
          failure = null;
          cachedTable = null;
          save();
          log(`prices: ${count} model names from ${PRICES_URL} (${PRICES_PROVIDER})`);
          return { ok: true };
        } catch (err) {
          const error = String(err?.message || err);
          if (failure?.error !== error) log(`prices: not updated (${error})`);
          failure = { at: now(), error };
          return { ok: false, error };
        } finally {
          inflight = null;
        }
      })();
    }
    return inflight;
  }

  /** Download when there is no list or the list is old. A failure is tried again after `retryMs`. */
  function refreshIfStale() {
    const stale = fetchedAt === null || now() - fetchedAt > maxAgeMs;
    if (!stale || inflight) return;
    if (failure && now() - failure.at < retryMs) return;
    refresh();
  }

  /** Wait for a download that is running, but not longer than `ms`. */
  async function settled(ms) {
    if (!inflight) return;
    let timer;
    await Promise.race([inflight, new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
    clearTimeout(timer);
  }

  /** For the page script: { version, rows: { key: [input, output, cacheRead] } }, or null without a list. */
  function table() {
    if (cachedTable) return cachedTable;
    const rows = {};
    for (const [key, row] of Object.entries(models)) rows[key] = [row.input, row.output, row.cacheRead];
    if (!isPriceTable(rows)) return null;
    const version = crypto.createHash('sha1').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
    cachedTable = { version, rows };
    return cachedTable;
  }

  /** The price of a model name of the client, or null. */
  function lookup(name) {
    const key = modelKey(name);
    return key && Object.hasOwn(models, key) ? models[key] : null;
  }

  /**
   * For the settings page. `clientModels` are the display names in the model list of the
   * client. The client lists one name for each thinking level ("Gemini 4 Neon (High)");
   * the levels of one model have one price, so a model with a price is listed once, under
   * the name of the client without the level.
   */
  function view(clientModels = []) {
    const priced = new Map();
    const unpriced = [];
    for (const name of clientModels) {
      const key = modelKey(name);
      const row = key && Object.hasOwn(models, key) ? models[key] : null;
      if (!row) unpriced.push({ name, priced: false });
      else if (!priced.has(key)) {
        const base = name.replace(/(\s*\([^()]*\))+\s*$/, '').trim() || name;
        priced.set(key, { name: base, priced: true, input: row.input, output: row.output, cacheRead: row.cacheRead, cacheFromInput: row.cacheFromInput });
      }
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    return {
      source: PRICES_URL,
      provider: PRICES_PROVIDER,
      fetchedAt,
      count: new Set(Object.values(models).map((row) => row.name)).size,
      refreshing: inflight !== null,
      error: failure?.error ?? null,
      errorAt: failure?.at ?? null,
      models: [...[...priced.values()].sort(byName), ...unpriced.sort(byName)],
    };
  }

  return { refresh, refreshIfStale, settled, table, lookup, view };
}
