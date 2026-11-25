// Serves Antigravity's own page files, with one component added to the page script.
//
// The language server has a development switch: with AGY_DEV_UI_URL set, it takes its page
// files (index.html, main.js, style sheets, icons, sounds) from that address instead of from
// the archive inside its own program. This server is that address. Every file comes
// unchanged out of the archive of the installed language server, except main.js while a
// page feature is on: then the feature's component is added to it (see uipatch.mjs).
//
// When the script cannot be changed safely, the original script is served. A file the
// archive does not have gives 404. Nothing here reads or forwards conversation traffic:
// the page talks to the language server directly, not to this server.

import http from 'node:http';
import path from 'node:path';
import { readBundleFile } from './bundle.mjs';
import { PING_PATH } from './forward.mjs';
import { patchMainJs } from './uipatch.mjs';

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
 * @param {(report: object) => void} [options.onScript]  Called when main.js was prepared: { at, patched, reason }.
 * @param {() => object} [options.identity]       Extra fields for the ping answer.
 * @returns {http.Server} A server that is not listening yet.
 */
export function createUiServer({ getBundle, wantIndicator = () => false, onScript = () => {}, identity = () => ({}) }) {
  // The changed script, kept as long as the program it came from stays the same.
  let cache = null;

  function mainJs(bundle) {
    const original = readBundleFile(bundle, 'main.js');
    if (!wantIndicator()) return original;
    if (cache && cache.file === bundle.file && cache.size === bundle.size && cache.mtimeMs === bundle.mtimeMs) return cache.data;
    const result = patchMainJs(original.toString('utf8'));
    const data = result.ok ? Buffer.from(result.source, 'utf8') : original;
    cache = { file: bundle.file, size: bundle.size, mtimeMs: bundle.mtimeMs, data };
    onScript({ at: Date.now(), patched: result.ok, reason: result.ok ? null : result.reason });
    return data;
  }

  function handle(req, res) {
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
    const text = (status, message) => send(status, 'text/plain; charset=utf-8', Buffer.from(`agy-flags: ${message}\n`));

    if (pathname === PING_PATH) {
      send(200, 'application/json', Buffer.from(JSON.stringify({ app: 'agy-flags', role: 'devui', ...identity() })));
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

  const server = http.createServer(handle);
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  server.on('clientError', (_err, socket) => socket.destroy());
  return server;
}
