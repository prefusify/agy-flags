// The requests of the settings page: what is on, and the changes the user makes there.
//
// The page is a part of Antigravity's own window (see settingspage.mjs). That window is
// served by the language server, and the language server passes every request for a file
// name it does not know on to the address in AGY_DEV_UI_URL: our page-file server. So the
// page asks its own origin for /__agy_flags/<name>.json, and the request arrives here. The
// command line of agy-flags asks the same paths directly.
//
// These requests change settings, so not everybody may send them:
//   - The sender must be a program of the same user, also when the language server passes
//     the request on (see peer.mjs). Another user of the machine is refused.
//   - A web page of another site must not be able to make the user's browser send them:
//       * Host must be our own address (this stops DNS rebinding);
//       * a request that names an Origin is refused. The language server removes that header,
//         and the command line sends none, so only a browser that talks to us directly has it;
//       * Sec-Fetch-Site, which a page script cannot set, must say "same-origin" when it is
//         there. A request that another site sends to the language server says "cross-site";
//       * a change must be sent as JSON. A page of another site cannot send that without
//         asking first, and that question is never answered with a yes.
//
// Nothing here is a secret: the answers hold flag names and settings, no conversation data.

import fs from 'node:fs';

export const API_PREFIX = '/__agy_flags/';

const MAX_BODY_BYTES = 64 * 1024;

const HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...HEADERS,
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

/** The reason why a request is refused before anybody looks at what it asks for, or null. */
export function refusal(req) {
  const port = req.socket?.localPort;
  const host = String(req.headers.host || '').toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return 'bad host';
  if (req.headers.origin !== undefined) return 'bad origin';
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return 'cross-site request';
  return null;
}

/**
 * @param {object} options
 * @param {string} [options.catalogFile]  JSON file served as catalog.json.
 * @param {() => Promise<object>} options.getState
 * @param {() => object} options.getServerFlags
 * @param {{ setFlags: Function, setFeatures: Function, refreshPrices: Function, setEnabled: Function, restartClient: Function }} options.actions
 * @param {(socket: object) => Promise<boolean>} options.peerCheck  Is the caller a program of our user?
 * @returns {(req, res, pathname: string) => Promise<void>} Answers a request below API_PREFIX.
 */
export function createApi({ catalogFile, getState, getServerFlags, actions, peerCheck }) {
  const read = {
    state: () => getState(),
    'server-flags': () => getServerFlags(),
    // An unreadable catalog only empties the list of features.
    catalog: () => readJsonFile(catalogFile, { groups: [] }),
  };
  const change = {
    flags: (body) => actions.setFlags(body.changes),
    features: (body) => actions.setFeatures(body.changes, body.flags),
    enabled: (body) => actions.setEnabled(body.enabled),
    'prices-refresh': () => actions.refreshPrices(),
    'restart-client': () => actions.restartClient(),
  };

  return async function handle(req, res, pathname) {
    const reason = refusal(req);
    if (reason) {
      sendJson(res, 403, { error: reason });
      return;
    }
    const match = /^([a-z-]+)\.json$/.exec(pathname.slice(API_PREFIX.length));
    const name = match ? match[1] : '';
    const known = async () => {
      if (await peerCheck(req.socket)) return true;
      sendJson(res, 403, { error: 'caller not recognized' });
      return false;
    };
    if (req.method === 'GET') {
      if (!(await known())) return;
      if (!Object.hasOwn(read, name)) sendJson(res, 404, { error: 'not found' });
      else sendJson(res, 200, await read[name]());
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
    if (!Object.hasOwn(change, name)) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    // The body is read before the sender is looked up. The lookup also asks whether the
    // connection is still open, and the end of a connection is only noticed once everything
    // that was sent on it has been read.
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.message });
      return;
    }
    if (!(await known())) return;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: 'bad request' });
      return;
    }
    const result = await change[name](body);
    const status = result.ok ? 200 : result.error === 'busy' ? 409 : result.error === 'download-failed' ? 502 : 400;
    sendJson(res, status, result);
  };
}
