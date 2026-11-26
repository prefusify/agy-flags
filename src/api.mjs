// The web UI server. It listens on 127.0.0.1 only, and every /api call must carry the token.
//
// A web page on another site can make the user's browser send requests to 127.0.0.1. Three
// checks stop that from doing anything:
//   - Host must be 127.0.0.1 or localhost with our port (blocks DNS rebinding);
//   - Origin, when the browser sends one, must be our own origin;
//   - the token header must match (another site cannot read the token, and a custom header
//     cannot be sent cross-origin without a preflight, which we never approve).

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { PING_PATH } from './forward.mjs';

const MAX_BODY_BYTES = 64 * 1024;

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function tokenMatches(given, expected) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

/**
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.uiDir         Directory that holds index.html, app.js and style.css.
 * @param {string} [options.catalogFile] JSON file served at /api/catalog.
 * @param {string} [options.notesFile]   JSON file served at /api/flag-notes.
 * @param {() => object} [options.identity]
 * @param {() => Promise<object>} options.getState
 * @param {() => object} options.getServerFlags
 * @param {{ setFlags: Function, setFeatures: Function, refreshPrices: Function, setEnabled: Function, restartClient: Function }} options.actions
 * @returns {http.Server} A server that is not listening yet.
 */
export function createApi({ token, uiDir, catalogFile, notesFile, identity = () => ({}), getState, getServerFlags, actions }) {
  let server;

  function ownOrigins() {
    const port = server.address()?.port;
    return {
      hosts: new Set([`127.0.0.1:${port}`, `localhost:${port}`]),
      origins: new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]),
    };
  }

  async function handleApi(req, res, pathname) {
    if (!tokenMatches(req.headers['x-agy-flags-token'], token)) {
      sendJson(res, 401, { error: 'token required' });
      return;
    }
    if (req.method === 'GET') {
      if (pathname === '/api/state') {
        sendJson(res, 200, await getState());
        return;
      }
      if (pathname === '/api/server-flags') {
        sendJson(res, 200, getServerFlags());
        return;
      }
      if (pathname === '/api/catalog') {
        // An unreadable catalog only empties the curated tab.
        sendJson(res, 200, readJsonFile(catalogFile, { groups: [] }));
        return;
      }
      if (pathname === '/api/flag-notes') {
        // Without notes the flag list is shown in one group, without descriptions.
        sendJson(res, 200, readJsonFile(notesFile, { groups: [], flags: {} }));
        return;
      }
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      sendJson(res, 415, { error: 'content-type must be application/json' });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.message });
      return;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: 'bad request' });
      return;
    }
    let result;
    if (pathname === '/api/flags') result = await actions.setFlags(body.changes);
    else if (pathname === '/api/features') result = await actions.setFeatures(body.changes, body.flags);
    else if (pathname === '/api/prices/refresh') result = await actions.refreshPrices();
    else if (pathname === '/api/enabled') result = await actions.setEnabled(body.enabled);
    else if (pathname === '/api/restart-client') result = await actions.restartClient();
    else {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const status = result.ok ? 200 : result.error === 'busy' ? 409 : result.error === 'download-failed' ? 502 : 400;
    sendJson(res, status, result);
  }

  async function handle(req, res) {
    const pathname = (req.url || '/').split('?')[0];
    const own = ownOrigins();
    if (!own.hosts.has(String(req.headers.host || '').toLowerCase())) {
      sendJson(res, 403, { error: 'bad host' });
      return;
    }
    if (pathname === PING_PATH) {
      sendJson(res, 200, { app: 'agy-flags', role: 'ui', ...identity() });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !own.origins.has(origin)) {
      sendJson(res, 403, { error: 'bad origin' });
      return;
    }
    const site = req.headers['sec-fetch-site'];
    if (pathname.startsWith('/api/') && site !== undefined && site !== 'same-origin' && site !== 'none') {
      sendJson(res, 403, { error: 'cross-site request' });
      return;
    }
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    const entry = STATIC[pathname];
    if (!entry) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    let data;
    try {
      data = fs.readFileSync(path.join(uiDir, entry[0]));
    } catch {
      sendJson(res, 500, { error: 'ui file missing' });
      return;
    }
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': entry[1], 'content-length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.destroy();
    });
  });
  server.on('clientError', (_err, socket) => socket.destroy());
  return server;
}
