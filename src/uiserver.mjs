// Serves Antigravity's own page files, with the changes of agy-plus in the page script.
//
// The language server has a development switch: with AGY_DEV_UI_URL set, it takes its page
// files (index.html, main.js, style sheets, icons, sounds) from that address instead of from
// the archive inside its own program. This server is that address. Every file comes
// unchanged out of the archive of the installed language server, except main.js: the page
// of agy-plus is added to the settings in it, and the change of each page feature that is
// on is made in it (see uipatch.mjs).
//
// A change that cannot be made safely is left out; without any, the original script is served. A file the
// archive does not have gives 404. Nothing here reads or forwards conversation traffic:
// the page talks to the language server directly, not to this server.
//
// The language server also passes on the requests of the settings page of agy-plus. They
// are answered by api.mjs.

import http from 'node:http';
import path from 'node:path';
import { API_PREFIX } from './api.mjs';
import { readBundleFile } from './bundle.mjs';
import { PING_PATH } from './forward.mjs';
import { PART_COSTS, PART_L10N, patchMainJs } from './uipatch.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** The archive name for a request path, or null for a path that is not a plain file name. */
export function bundleNameOf(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) return null;
  const name = decoded === '/' ? 'index.html' : decoded.slice(1);
  if (name === '' || name.startsWith('/') || name.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  return name;
}

/**
 * @param {object} options
 * @param {() => object} options.getBundle        The page archive (see bundle.mjs). May throw.
 * @param {() => boolean} [options.wantIndicator] Whether the context usage indicator is on.
 * @param {() => ({ version: string, rows: object }|null|false)} [options.getPrices]
 *        The price table while the costs are to be filled in; null when that is on but there
 *        is no table yet; false when it is off.
 * @param {() => ({ version: string, data: object }|null|false)} [options.getL10n]
 *        The word list while the page is to be shown in Chinese; null when that is on but
 *        the word list cannot be read; false when it is off.
 * @param {(req, res, pathname: string) => Promise<void>} [options.api]
 *        Answers the requests of the settings page (see api.mjs). With it, the settings page
 *        is added to main.js.
 * @param {() => (Promise<void>|void)} [options.beforeScript]  Awaited before main.js is prepared.
 * @param {(report: object) => void} [options.onScript]  Called when main.js was prepared:
 *        { at, patched, reason, parts }. `parts` has { ok, reason } for each change that was wanted.
 * @param {() => object} [options.identity]       Extra fields for the ping answer.
 * @returns {http.Server} A server that is not listening yet.
 */
export function createUiServer({
  getBundle,
  wantIndicator = () => false,
  getPrices = () => false,
  getL10n = () => false,
  api = null,
  beforeScript = () => {},
  onScript = () => {},
  identity = () => ({}),
}) {
  // The changed script, kept as long as the program it came from and the changes stay the same.
  let cache = null;

  function mainJs(bundle) {
    const original = readBundleFile(bundle, 'main.js');
    const indicator = wantIndicator() === true;
    const prices = getPrices();
    const l10n = getL10n();
    const settings = api ? { api: API_PREFIX } : null;
    if (!settings && !indicator && prices === false && l10n === false) return original;
    const version = (part) => (part ? part.version : part === null ? 'none' : 'off');
    const wanted = `${settings ? 1 : 0}:${indicator ? 1 : 0}:${version(prices)}:${version(l10n)}`;
    if (cache && cache.file === bundle.file && cache.size === bundle.size && cache.mtimeMs === bundle.mtimeMs && cache.wanted === wanted) {
      return cache.data;
    }
    const text = original.toString('utf8');
    const result = patchMainJs(text, { settings, indicator, prices: prices ? prices.rows : null, l10n: l10n ? l10n.data : null });
    const parts = { ...result.parts };
    if (prices === null) parts[PART_COSTS] = { ok: false, reason: 'there is no price list yet' };
    if (l10n === null) parts[PART_L10N] = { ok: false, reason: 'the word list cannot be read' };
    const failed = Object.values(parts).filter((part) => !part.ok);
    const data = result.source === text ? original : Buffer.from(result.source, 'utf8');
    cache = { file: bundle.file, size: bundle.size, mtimeMs: bundle.mtimeMs, wanted, data };
    onScript({
      at: Date.now(),
      patched: failed.length === 0,
      reason: failed.length === 0 ? null : failed.map((part) => part.reason).join('; '),
      parts,
    });
    return data;
  }

  async function handle(req, res) {
    const pathname = (req.url || '/').split('?')[0];
    const send = (status, type, body) => {
      res.writeHead(status, {
        'content-type': type,
        'content-length': body.length,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const text = (status, message) => send(status, 'text/plain; charset=utf-8', Buffer.from(`agy-plus: ${message}\n`));

    if (pathname === PING_PATH) {
      send(200, 'application/json', Buffer.from(JSON.stringify({ app: 'agy-plus', role: 'devui', ...identity() })));
      return;
    }
    if (pathname.startsWith(API_PREFIX)) {
      if (api) await api(req, res, pathname);
      else text(404, 'not found');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      text(405, 'method not allowed');
      return;
    }
    const name = bundleNameOf(pathname);
    if (!name) {
      text(404, 'not found');
      return;
    }
    let body;
    try {
      // For example a price list that is still on its way: better a short wait than a script without it.
      if (name === 'main.js') await beforeScript();
      const bundle = getBundle();
      body = name === 'main.js' ? mainJs(bundle) : readBundleFile(bundle, name);
    } catch (err) {
      text(500, `cannot read the page files: ${err?.message || err}`);
      return;
    }
    if (!body) {
      text(404, 'not found');
      return;
    }
    send(200, TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream', body);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('agy-plus: internal error\n');
      }
    });
  });
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  server.on('clientError', (_err, socket) => socket.destroy());
  return server;
}
