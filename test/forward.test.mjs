import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import zlib from 'node:zlib';
import { PING_PATH, createForwarder } from '../src/forward.mjs';
import { close, freePorts, listen, request, sleep } from './helpers.mjs';

/** Start a fake upstream and a forwarder in front of it. */
async function setup(t, upstreamHandler, { flags = {}, modelFlags = {} } = {}) {
  const upstream = http.createServer(upstreamHandler);
  const upstreamPort = await listen(upstream);
  const configs = [];
  const requests = [];
  const forwarder = createForwarder({
    name: 'aicode',
    upstream: `http://127.0.0.1:${upstreamPort}`,
    getFlags: () => flags,
    getModelFlags: () => modelFlags,
    onConfig: (report) => configs.push(report),
    onRequest: (report) => requests.push(report),
    identity: () => ({ pid: 123 }),
  });
  const port = await listen(forwarder);
  t.after(async () => {
    await close(forwarder);
    await close(upstream);
  });
  return { port, upstreamPort, configs, requests };
}

const FETCH_CONFIG = {
  experimentConfig: {
    experimentFlags: [
      { name: 'a', flagId: 7, boolValue: false },
      { name: 'n', intValue: '300' },
    ],
  },
  availableExperiences: ['x'],
};

test('a gzip flag response is patched and flagId survives', async (t) => {
  const { port, configs } = await setup(
    t,
    (req, res) => {
      const body = zlib.gzipSync(JSON.stringify(FETCH_CONFIG));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': body.length });
      res.end(body);
    },
    { flags: { a: true, b: true } }
  );
  const res = await request({ port, path: '/v1alpha:fetchConfig?alt=json' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-encoding'], undefined);
  assert.equal(Number(res.headers['content-length']), res.body.length);
  const data = JSON.parse(res.body.toString('utf8'));
  assert.deepEqual(data.experimentConfig.experimentFlags, [
    { name: 'a', flagId: 7, boolValue: true },
    { name: 'n', intValue: '300' },
    { name: 'b', boolValue: true },
  ]);
  assert.deepEqual(data.availableExperiences, ['x']);
  assert.equal(configs.length, 1);
  assert.equal(configs[0].ok, true);
  assert.deepEqual(configs[0].applied, ['a', 'b']);
  // The report describes what the server sent, before our change.
  assert.deepEqual(configs[0].server.a, { type: 'boolValue', value: false });
});

test('with nothing to apply, the original bytes go out', async (t) => {
  const original = zlib.gzipSync(JSON.stringify(FETCH_CONFIG));
  const { port, configs } = await setup(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
    res.end(original);
  });
  const res = await request({ port, path: '/v1alpha:fetchConfig' });
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.ok(res.body.equals(original));
  assert.equal(configs[0].ok, true);
  assert.deepEqual(configs[0].applied, []);
});

test('a flag response that is not JSON passes through unchanged', async (t) => {
  const { port, configs } = await setup(
    t,
    (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>maintenance</html>');
    },
    { flags: { a: true } }
  );
  const res = await request({ port, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  assert.equal(res.status, 200);
  assert.equal(res.body.toString('utf8'), '<html>maintenance</html>');
  assert.equal(configs[0].ok, false);
});

test('an error status on a flag path is not patched', async (t) => {
  const { port, configs } = await setup(
    t,
    (req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":{"code":503}}');
    },
    { flags: { a: true } }
  );
  const res = await request({ port, path: '/v1alpha:fetchConfig' });
  assert.equal(res.status, 503);
  assert.equal(res.body.toString('utf8'), '{"error":{"code":503}}');
  assert.equal(configs.length, 0);
});

const MODEL_LIST = { models: { one: { displayName: 'One' }, two: { modelExperiments: { experiments: {} } } }, defaultAgentModelId: 'one' };

test('per-model flags are written into the model list', async (t) => {
  const { port, configs } = await setup(
    t,
    (req, res) => {
      const body = zlib.gzipSync(JSON.stringify(MODEL_LIST));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(body);
    },
    { flags: { a: true }, modelFlags: { keep: true, pings: 3 } }
  );
  const res = await request({ port, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}' });
  assert.equal(res.headers['content-encoding'], undefined);
  const data = JSON.parse(res.body.toString('utf8'));
  const want = { keep: { boolValue: true }, pings: { intValue: '3' } };
  assert.deepEqual(data.models.one.modelExperiments.experiments, want);
  assert.deepEqual(data.models.two.modelExperiments.experiments, want);
  assert.equal(data.defaultAgentModelId, 'one');
  // Only the per-model flags go into models, not every override.
  assert.equal(JSON.stringify(data).includes('"a"'), false);
  assert.equal(configs.length, 1);
  assert.deepEqual(
    { kind: configs[0].kind, ok: configs[0].ok, applied: configs[0].applied, models: configs[0].models, server: configs[0].server },
    { kind: 'fetchAvailableModels', ok: true, applied: ['keep', 'pings'], models: 2, server: undefined }
  );
});

test('without per-model flags the model list is streamed through and not reported', async (t) => {
  const original = zlib.gzipSync(JSON.stringify(MODEL_LIST));
  const { port, configs } = await setup(
    t,
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(original);
    },
    { flags: { a: true } }
  );
  const res = await request({ port, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}' });
  assert.ok(res.body.equals(original));
  assert.equal(configs.length, 0);
});

test('a model list of an unknown shape passes through unchanged', async (t) => {
  const { port, configs } = await setup(
    t,
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"models":[]}');
    },
    { modelFlags: { keep: true } }
  );
  const res = await request({ port, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}' });
  assert.equal(res.body.toString('utf8'), '{"models":[]}');
  assert.equal(configs[0].ok, false);
  assert.match(configs[0].error, /no model list/);
});

test('a keep-alive request of the client is recognised, and conversation text is not', async (t) => {
  const { port, requests } = await setup(t, (req, res) => {
    req.resume();
    req.on('end', () => res.end('ok'));
  });
  const send = (body, pathname = '/v1internal:streamGenerateContent?alt=sse', headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: pathname, headers, agent: false }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      // Sent in pieces, so that the label is split over two chunks.
      const parts = Array.isArray(body) ? body : [body];
      const next = () => {
        if (parts.length === 0) return req.end();
        req.write(parts.shift(), () => setTimeout(next, 15));
      };
      next();
    });
  const label = '{"request":{"labels":{"prompt_cache_keep_alive": "true","request_id":"r-keepalive-1"}},"pad":"';
  await send(label + 'x'.repeat(200) + '"}');
  await send([label.slice(0, 40), label.slice(40) + '"}']);
  // The same words inside a message are escaped JSON text.
  await send(JSON.stringify({ request: { contents: [{ text: 'is "prompt_cache_keep_alive":"true" a label?' }] } }));
  await send('{"request":{"labels":{"prompt_cache_keep_alive":"false"}}}');
  await send(label + '"}', '/v1internal:loadCodeAssist');
  await send(label + '"}', '/v1internal:generateContent', { 'content-encoding': 'gzip' });
  assert.deepEqual(requests.map((r) => r.keepAlive), [true, true, false, false, false, false]);
});

test('other responses are streamed, not buffered', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { port } = await setup(t, async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: one\n\n');
    await gate;
    res.end('data: two\n\n');
  });
  const first = await new Promise((resolve, reject) => {
    // A forwarder that buffers would never deliver the first event; fail instead of hanging.
    const timer = setTimeout(() => {
      release();
      reject(new Error('the first event did not arrive while the upstream was still open'));
    }, 2000);
    t.after(() => clearTimeout(timer));
    const req = http.request({ host: '127.0.0.1', port, path: '/v1internal:streamGenerateContent', method: 'POST', agent: false }, (res) => {
      const seen = [];
      res.on('data', (chunk) => {
        seen.push(chunk.toString('utf8'));
        // The first event must arrive while the upstream is still holding the second one back.
        if (seen.length === 1) resolve({ res, seen });
      });
    });
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(first.seen[0], 'data: one\n\n');
  const ended = new Promise((resolve) => first.res.on('end', resolve));
  release();
  await ended;
  assert.equal(first.seen.join(''), 'data: one\n\ndata: two\n\n');
});

test('method, path, query, headers and body reach the upstream; host is rewritten', async (t) => {
  const { port, upstreamPort } = await setup(t, (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          host: req.headers.host,
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
    });
  });
  const res = await request({
    port,
    method: 'POST',
    path: '/v1internal:loadCodeAssist?alt=sse&x=1',
    headers: { authorization: 'Bearer test-only', 'content-type': 'application/json' },
    body: '{"hello":"world"}',
  });
  assert.deepEqual(JSON.parse(res.body.toString('utf8')), {
    method: 'POST',
    url: '/v1internal:loadCodeAssist?alt=sse&x=1',
    host: `127.0.0.1:${upstreamPort}`,
    authorization: 'Bearer test-only',
    body: '{"hello":"world"}',
  });
});

test('a request on a reused connection that the upstream resets is retried once', async (t) => {
  let total = 0;
  const perSocket = new WeakMap();
  const { port, requests } = await setup(t, (req, res) => {
    total += 1;
    const count = (perSocket.get(req.socket) || 0) + 1;
    perSocket.set(req.socket, count);
    if (count === 2) {
      // What a server does when it closes an idle connection just as the client reuses it.
      req.socket.destroy();
      return;
    }
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`ok ${total}`);
    });
  });
  const first = await request({ port, method: 'POST', path: '/v1internal:one', body: 'a' });
  assert.equal(first.body.toString('utf8'), 'ok 1');
  await sleep(50); // let the forwarder put the upstream connection back into its pool
  const second = await request({ port, method: 'POST', path: '/v1internal:two', body: 'b' });
  assert.equal(second.status, 200);
  assert.equal(second.body.toString('utf8'), 'ok 3');
  assert.equal(total, 3);
  assert.deepEqual(requests.map((r) => r.status), [200, 200]);
});

test('a request that the client cancels is not sent again', async (t) => {
  let total = 0;
  const { port, requests } = await setup(t, (req, res) => {
    total += 1;
    req.resume();
    if (total === 1) {
      req.on('end', () => res.end('ok'));
    }
    // The second request is held open: no answer until the client gives up.
  });
  await request({ port, method: 'POST', path: '/v1internal:one', body: 'a' });
  await sleep(50); // the upstream connection is now idle in the forwarder's pool
  await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1internal:two', agent: false });
    req.on('error', () => resolve());
    req.end('b');
    // Cancel while the upstream is still thinking, like pressing Stop before the first token.
    setTimeout(() => req.destroy(), 80);
  });
  await sleep(200);
  assert.equal(total, 2, 'the cancelled request must reach the upstream once');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].status, 499);
  assert.equal(requests[1].error, undefined);
});

test('a connection upgrade is tunnelled in both directions', async (t) => {
  const upstream = http.createServer((req, res) => res.end('plain'));
  let seenHost = null;
  upstream.on('upgrade', (req, socket) => {
    seenHost = req.headers.host;
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: test-echo\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (chunk) => socket.write(`echo:${chunk.toString('utf8')}`));
    socket.on('end', () => socket.end());
    socket.on('error', () => {});
  });
  const upstreamPort = await listen(upstream);
  const forwarder = createForwarder({ name: 'aicode', upstream: `http://127.0.0.1:${upstreamPort}`, getFlags: () => ({}) });
  const port = await listen(forwarder);
  t.after(async () => {
    await close(forwarder);
    await close(upstream);
  });

  const answer = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no upgrade within 2 s')), 2000);
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/v1alpha/live',
      headers: { connection: 'Upgrade', upgrade: 'test-echo' },
      agent: false,
    });
    req.on('upgrade', (res, socket) => {
      socket.write('hello');
      socket.once('data', (chunk) => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ status: res.statusCode, upgrade: res.headers.upgrade, data: chunk.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end();
  });
  assert.deepEqual(answer, { status: 101, upgrade: 'test-echo', data: 'echo:hello' });
  assert.equal(seenHost, `127.0.0.1:${upstreamPort}`);
});

test('an unreachable upstream gives 502', async (t) => {
  const [deadPort] = await freePorts(1);
  const requests = [];
  const forwarder = createForwarder({
    name: 'cloudcode',
    upstream: `http://127.0.0.1:${deadPort}`,
    getFlags: () => ({}),
    onRequest: (report) => requests.push(report),
  });
  const port = await listen(forwarder);
  t.after(() => close(forwarder));
  const res = await request({ port, method: 'POST', path: '/v1internal:loadCodeAssist', body: '{}' });
  assert.equal(res.status, 502);
  assert.equal(requests[0].status, 502);
  assert.match(requests[0].error, /ECONNREFUSED/);
});

test('the ping path is answered locally', async (t) => {
  let reached = false;
  const { port } = await setup(t, (req, res) => {
    reached = true;
    res.end();
  });
  const res = await request({ port, path: PING_PATH });
  assert.deepEqual(JSON.parse(res.body.toString('utf8')), { app: 'agy-flags', role: 'aicode', pid: 123 });
  assert.equal(reached, false);
});
