// A plain-HTTP reverse proxy for one upstream host.
//
// Antigravity's language server is pointed at it with an environment variable. Everything
// is streamed through unchanged (connection upgrades included), except the flag-config
// responses of the desktop app, which are buffered, patched and sent on: the two flag lists
// always, and the model list only while there is a per-model flag to write. One request can
// be changed too: while the Chinese titles are on, the request that asks the model for the
// title of a conversation is kept back, one sentence of its instruction is replaced, and it
// is sent on (see rewriteTitleRequest). Nothing here adds credentials or follows redirects;
// the upstream is fixed when the forwarder is created.
//
// The variable lives in the login session, so other programs of the same family read it
// too: the `agy` command line, for one. Only a request that names the desktop app as its
// sender is changed. Every other request gets exactly what the server sent.

import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { MODELS_KIND, kindOf, modelDisplayNames, patchFlagConfig, patchModelExperiments, summarizeFlags } from './patch.mjs';

export const PING_PATH = '/__agy_flags_ping';

const HOP_BY_HOP = new Set([
  'connection',
  'proxy-connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'proxy-authenticate',
  'proxy-authorization',
]);

/** A flag-config response larger than this is passed through unpatched. */
const MAX_CONFIG_BYTES = 32 * 1024 * 1024;
/** A request body is kept for one retry only up to this size. */
const MAX_REPLAY_BYTES = 16 * 1024 * 1024;
const STALE_SOCKET_ERRORS = new Set(['ECONNRESET', 'EPIPE']);
/**
 * The client marks its own cache keep-alive requests with this label. The quotes matter:
 * inside conversation text the same words arrive escaped (\"...\") and do not match.
 */
const KEEP_ALIVE_NAME = Buffer.from('"prompt_cache_keep_alive"');
const KEEP_ALIVE_RE = /"prompt_cache_keep_alive"\s*:\s*"true"/;
/** Longer than the whole label, so that one split over two chunks is still seen. */
const KEEP_ALIVE_TAIL = 64;

const MAX_AGENT_CHARS = 160;

/**
 * The client asks a small model for the title of a new conversation. Seen on 2.35.1: the
 * body starts with {"project":"…","requestId":"checkpoint/…", and the instruction is the
 * text below. The sentence TITLE_OLD is why every title is in English.
 */
const TITLE_HEAD = Buffer.from('"requestId":"checkpoint/');
/** The request id stands at the start of the body. Only this much is looked at to decide. */
const TITLE_HEAD_BYTES = 512;
/** A title request can hold the pictures of the first message. A larger one goes on unchanged. */
const MAX_TITLE_BYTES = 8 * 1024 * 1024;
const TITLE_PROMPT_START = 'You are a conversation title generator';
export const TITLE_OLD = "Respond with ONLY a short conversation title (3-5 words, title-cased, no prefix) describing the USER's intent.";
export const TITLE_NEW =
  "Respond with ONLY a short conversation title in Simplified Chinese (4 to 12 Chinese characters, no prefix, no quotation marks, no punctuation at the end) describing the USER's intent. Write the title in Simplified Chinese even when the USER's request is in another language.";

/**
 * Make the title request ask for a Chinese title. Only the one sentence changes; every other
 * byte of the body goes out as it came in.
 * @param {Buffer} raw  The whole request body.
 * @returns {{ result: 'rewritten' | 'not-title' | 'changed' | 'skipped', body: Buffer }}
 *   'not-title': another kind of request. 'changed': a title request whose instruction no
 *   longer has the sentence (the client words it differently now). 'skipped': the sentence
 *   is there more than once, so it is not clear which one is the instruction.
 */
export function rewriteTitleRequest(raw) {
  const same = (result) => ({ result, body: raw });
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    return same('not-title');
  }
  const parts = data?.request?.systemInstruction?.parts;
  const prompt = (Array.isArray(parts) ? parts : []).map((part) => part?.text).find((text) => typeof text === 'string' && text.startsWith(TITLE_PROMPT_START));
  if (prompt === undefined) return same('not-title');
  if (!prompt.includes(TITLE_OLD)) return same('changed');
  // The sentence has no character that JSON writes in another way, so it is in the body as it is.
  const old = Buffer.from(TITLE_OLD, 'utf8');
  const at = raw.indexOf(old);
  if (at === -1) return same('changed');
  if (raw.indexOf(old, at + 1) !== -1) return same('skipped');
  return { result: 'rewritten', body: Buffer.concat([raw.subarray(0, at), Buffer.from(TITLE_NEW, 'utf8'), raw.subarray(at + old.length)]) };
}

/**
 * Who sent a request, read from the User-Agent that the Antigravity programs set themselves:
 *   antigravity/hub/2.35.1 (aidev_client; os_type=darwin; ...)   the desktop app
 *   antigravity/cli/1.5.17 (aidev_client; os_type=darwin; ...)   the `agy` command line
 * @returns {'desktop' | 'cli' | 'other'}
 */
export function clientOf(headers) {
  const agent = String(headers?.['user-agent'] || '');
  if (/^antigravity\/hub\//i.test(agent)) return 'desktop';
  if (/^antigravity\/cli\//i.test(agent)) return 'cli';
  return 'other';
}

function withoutHopByHop(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name)) out[name] = value;
  }
  return out;
}

function decodeBody(raw, encoding) {
  const enc = String(encoding || '').toLowerCase();
  if (!enc || enc === 'identity') return raw;
  if (enc === 'gzip') return zlib.gunzipSync(raw);
  if (enc === 'br') return zlib.brotliDecompressSync(raw);
  if (enc === 'deflate') return zlib.inflateSync(raw);
  throw new Error(`unsupported content-encoding ${enc}`);
}

/**
 * @param {object} options
 * @param {string} options.name      Label used in reports ("cloudcode" or "aicode").
 * @param {string} options.upstream  Origin to forward to, for example https://aicode.googleapis.com.
 * @param {() => object} options.getFlags   Current overrides, { name: value }. Empty disables patching.
 * @param {() => object} [options.getModelFlags]  The overrides that also go into every model of the
 *                                                model list. Empty leaves the model list untouched.
 * @param {() => boolean} [options.wantModelNames]  While true, the model list is read and its
 *                                                display names are reported as `names`.
 * @param {() => boolean} [options.wantChineseTitles]  While true, the title request of the desktop
 *                                                app is changed so that the title is in Chinese.
 * @param {(report: object) => void} [options.onConfig]   Called for every flag-config response of the
 *                                                desktop app. Other senders are never reported here.
 * @param {(report: object) => void} [options.onRequest]  Called once per finished request. `client` is
 *                                                the sender ('desktop', 'cli' or 'other'), `agent` its
 *                                                User-Agent, `kind` the flag-config kind or null.
 *                                                `keepAlive` is true for a cache keep-alive request of
 *                                                the desktop app. `title` says what was done
 *                                                with a title request ('rewritten', 'changed' or
 *                                                'skipped'); it is null for every other request.
 * @param {() => object} [options.identity]  Extra fields for the ping answer.
 * @returns {http.Server} A server that is not listening yet.
 */
export function createForwarder({
  name,
  upstream,
  getFlags,
  getModelFlags = () => ({}),
  wantModelNames = () => false,
  wantChineseTitles = () => false,
  onConfig = () => {},
  onRequest = () => {},
  identity = () => ({}),
}) {
  const target = new URL(upstream);
  const secure = target.protocol === 'https:';
  const transport = secure ? https : http;
  const pool = new transport.Agent({ keepAlive: true });
  const port = Number(target.port) || (secure ? 443 : 80);

  function handle(req, res) {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname === PING_PATH) {
      const body = JSON.stringify({ app: 'agy-flags', role: name, ...identity() });
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }

    const started = Date.now();
    const kind = kindOf(pathname);
    const client = clientOf(req.headers);
    // Only the desktop app is changed. Any other sender is streamed through untouched.
    const ours = client === 'desktop';
    const agent = String(req.headers['user-agent'] || '').slice(0, MAX_AGENT_CHARS);
    const headers = withoutHopByHop(req.headers);
    headers.host = target.host;

    // Keep a copy of the request body so that one retry is possible.
    const copy = [];
    let copied = 0;
    let replayable = true;
    let bodyEnded = false;
    let afterBody = null;
    // A model request is only looked at for one label name. Nothing of it is kept or logged.
    // A compressed body cannot be read this way and is not counted.
    const isModelRequest =
      ours && req.method === 'POST' && pathname.endsWith('GenerateContent') && !req.headers['content-encoding'];
    let keepAlive = false;
    let tail = Buffer.alloc(0);
    // A model request is kept back until its first bytes show whether it asks for a title.
    // Every other request goes upstream while it still arrives.
    let held = isModelRequest && wantChineseTitles() === true;
    let candidate = null;
    let title = null;
    let release = () => {};
    const decide = (ended) => {
      if (candidate === null) {
        if (copied < TITLE_HEAD_BYTES && !ended) return;
        candidate = Buffer.concat(copy).subarray(0, TITLE_HEAD_BYTES).includes(TITLE_HEAD);
      }
      if (candidate && !ended && replayable && copied <= MAX_TITLE_BYTES) return;
      if (candidate && ended && replayable) {
        const out = rewriteTitleRequest(Buffer.concat(copy));
        if (out.result !== 'not-title') title = out.result;
        if (out.result === 'rewritten') {
          copy.length = 0;
          copy.push(out.body);
          copied = out.body.length;
          headers['content-length'] = String(out.body.length);
        }
      }
      release();
    };
    req.on('data', (chunk) => {
      if (isModelRequest && !keepAlive) {
        const window = tail.length > 0 ? Buffer.concat([tail, chunk]) : chunk;
        if (window.includes(KEEP_ALIVE_NAME) && KEEP_ALIVE_RE.test(window.toString('latin1'))) keepAlive = true;
        else tail = Buffer.from(window.subarray(Math.max(0, window.length - KEEP_ALIVE_TAIL)));
      }
      if (!replayable) return;
      copied += chunk.length;
      if (copied > MAX_REPLAY_BYTES) {
        replayable = false;
        copy.length = 0;
      } else {
        copy.push(chunk);
      }
      if (held) decide(false);
    });
    req.on('end', () => {
      bodyEnded = true;
      if (held) decide(true);
      if (afterBody) afterBody();
    });

    let settled = false;
    let gotResponse = false;
    let clientGone = false;
    let upstreamReq = null;

    const done = (status, extra = {}) => {
      if (settled) return;
      settled = true;
      onRequest({
        upstream: name,
        method: req.method,
        path: pathname,
        status,
        ms: Date.now() - started,
        client,
        agent,
        kind,
        keepAlive,
        title,
        ...extra,
      });
    };

    const fail = (err) => {
      if (settled) return;
      if (clientGone) {
        // The client went away and we closed the upstream request ourselves. Not an upstream failure.
        res.destroy();
        done(499);
        return;
      }
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('agy-flags: upstream request failed\n');
      } else {
        res.destroy();
      }
      done(502, { error: `${err?.code || ''} ${err?.message || err}`.trim() });
    };

    res.on('close', () => {
      if (res.writableEnded) return;
      // The client cancelled (for example Stop in the app). Cancel upstream too, and never retry.
      clientGone = true;
      if (upstreamReq) upstreamReq.destroy();
      done(499);
    });

    const patchAndSend = (upRes, status, respHeaders) => {
      const chunks = [];
      let size = 0;
      let passthrough = false;
      upRes.on('data', (chunk) => {
        if (passthrough) return;
        size += chunk.length;
        if (size <= MAX_CONFIG_BYTES) {
          chunks.push(chunk);
          return;
        }
        passthrough = true;
        res.writeHead(status, respHeaders);
        for (const c of chunks) res.write(c);
        res.write(chunk);
        chunks.length = 0;
        upRes.pipe(res);
        onConfig({ upstream: name, kind, at: Date.now(), ok: false, error: 'response too large to patch' });
      });
      upRes.on('end', () => {
        if (passthrough) {
          done(status);
          return;
        }
        const raw = Buffer.concat(chunks);
        const report = { upstream: name, kind, at: Date.now(), ok: false };
        let body = raw;
        let outHeaders = respHeaders;
        try {
          const data = JSON.parse(decodeBody(raw, upRes.headers['content-encoding']).toString('utf8'));
          let result;
          if (kind === MODELS_KIND) {
            result = patchModelExperiments(data, getModelFlags() || {});
            report.models = result.models;
            if (wantModelNames()) report.names = modelDisplayNames(data);
          } else {
            report.server = summarizeFlags(kind, data);
            result = patchFlagConfig(kind, data, getFlags() || {});
          }
          report.applied = result.applied;
          report.skipped = result.skipped;
          report.ok = true;
          if (result.applied.length > 0) {
            // Re-serialised only when something changed; otherwise the original bytes go out.
            body = Buffer.from(JSON.stringify(data), 'utf8');
            outHeaders = { ...respHeaders, 'content-length': String(body.length) };
            delete outHeaders['content-encoding'];
          }
        } catch (err) {
          // Fail open: the client gets exactly what the server sent.
          report.error = String(err?.message || err);
          body = raw;
          outHeaders = respHeaders;
        }
        res.writeHead(status, outHeaders);
        res.end(body);
        onConfig(report);
        done(status, { patched: report.ok ? report.applied.length : 0 });
      });
    };

    const respond = (upRes) => {
      gotResponse = true;
      const status = upRes.statusCode || 502;
      const respHeaders = withoutHopByHop(upRes.headers);
      upRes.on('error', fail);
      // The model list is buffered only while there is something to write into it or to read from it.
      const wanted = kind !== MODELS_KIND || Object.keys(getModelFlags() || {}).length > 0 || wantModelNames();
      if (ours && kind && status === 200 && wanted) {
        patchAndSend(upRes, status, respHeaders);
        return;
      }
      res.writeHead(status, respHeaders);
      res.flushHeaders();
      upRes.pipe(res);
      upRes.on('end', () => done(status));
    };

    const send = (attempt) => {
      const upReq = transport.request({
        host: target.hostname,
        port,
        method: req.method,
        path: req.url,
        headers,
        agent: attempt === 1 ? pool : false,
      });
      upstreamReq = upReq;
      upReq.on('response', respond);
      upReq.on('error', (err) => {
        // A kept-alive socket can be closed by the server just as we reuse it. Nothing has
        // reached the upstream application in that case, so one retry on a fresh socket is safe.
        const staleSocket =
          attempt === 1 &&
          upReq.reusedSocket &&
          STALE_SOCKET_ERRORS.has(err?.code) &&
          !gotResponse &&
          !settled &&
          !clientGone &&
          replayable;
        if (!staleSocket) {
          fail(err);
          return;
        }
        const retry = () => send(2);
        if (bodyEnded) retry();
        else afterBody = retry;
      });
      if (attempt !== 1 || bodyEnded) {
        // A second attempt, or a body that was kept back to its end.
        upReq.end(Buffer.concat(copy));
      } else {
        // The start of the body may have been kept back: it goes first, and the rest follows as it arrives.
        for (const chunk of late ? copy : []) upReq.write(chunk);
        req.pipe(upReq);
      }
    };

    // True when the upstream request starts after a part of the body has already arrived.
    let late = false;
    if (held) {
      release = () => {
        held = false;
        late = true;
        if (!settled && !clientGone) send(1);
      };
    } else {
      send(1);
    }
  }

  // A connection upgrade (WebSocket) is tunnelled as it is: the request head goes upstream
  // with only Host changed, and after that bytes are copied in both directions.
  function handleUpgrade(req, socket, head) {
    const pathname = (req.url || '/').split('?')[0];
    const started = Date.now();
    let reported = false;
    const report = (status, extra = {}) => {
      if (reported) return;
      reported = true;
      onRequest({
        upstream: name,
        method: req.method,
        path: pathname,
        status,
        ms: Date.now() - started,
        client: clientOf(req.headers),
        agent: String(req.headers['user-agent'] || '').slice(0, MAX_AGENT_CHARS),
        kind: null,
        ...extra,
      });
    };
    const headText = (res) => {
      const lines = [`HTTP/1.1 ${res.statusCode} ${res.statusMessage || ''}`];
      for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) lines.push(`${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`);
      return `${lines.join('\r\n')}\r\n\r\n`;
    };
    const upReq = transport.request({
      host: target.hostname,
      port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: target.host },
      agent: false,
    });
    upReq.on('upgrade', (upRes, upSocket, upHead) => {
      socket.write(headText(upRes));
      if (upHead && upHead.length > 0) socket.write(upHead);
      if (head && head.length > 0) upSocket.write(head);
      upSocket.pipe(socket);
      socket.pipe(upSocket);
      const closeBoth = () => {
        socket.destroy();
        upSocket.destroy();
      };
      for (const s of [socket, upSocket]) {
        s.on('error', closeBoth);
        s.on('close', closeBoth);
        // Server-side sockets stay half-open after the peer hangs up. Finish our side too,
        // so that the socket closes and the tunnel does not leak.
        s.on('end', () => s.end());
      }
      report(upRes.statusCode);
    });
    // The upstream answered without upgrading: pass its answer on and close.
    upReq.on('response', (upRes) => {
      socket.write(headText(upRes));
      upRes.pipe(socket);
      upRes.on('end', () => socket.end());
      report(upRes.statusCode || 502);
    });
    upReq.on('error', (err) => {
      if (!reported) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      else socket.destroy();
      report(502, { error: `${err?.code || ''} ${err?.message || err}`.trim() });
    });
    socket.on('error', () => upReq.destroy());
    upReq.end();
  }

  const server = http.createServer(handle);
  server.on('upgrade', handleUpgrade);
  // Longer than the 90 s the Go client keeps idle connections, so that we are not the side
  // that closes a connection the client is about to reuse.
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  server.on('clientError', (_err, socket) => socket.destroy());
  server.on('close', () => pool.destroy());
  return server;
}
