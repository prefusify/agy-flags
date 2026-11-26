import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import zlib from 'node:zlib';
import { PING_PATH, TITLE_NEW, TITLE_OLD, clientOf, createForwarder, rewriteTitleRequest } from '../src/forward.mjs';
import { CLI_AGENT, DESKTOP_AGENT, close, freePorts, listen, request, sleep, titleRequest } from './helpers.mjs';

/** Start a fake upstream and a forwarder in front of it. */
async function setup(t, upstreamHandler, { flags = {} } = {}) {
  const upstream = http.createServer(upstreamHandler);
  const upstreamPort = await listen(upstream);
  const configs = [];
  const requests = [];
  const forwarder = createForwarder({
    name: 'aicode',
    upstream: `http://127.0.0.1:${upstreamPort}`,
    getFlags: () => flags,
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

test('the model list is streamed through and not reported while nobody wants its names', async (t) => {
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
  const reports = [];
  const forwarder = createForwarder({
    name: 'aicode',
    upstream: `http://127.0.0.1:${upstreamPort}`,
    getFlags: () => ({}),
    onRequest: (report) => reports.push(report),
  });
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
      headers: { connection: 'Upgrade', upgrade: 'test-echo', 'user-agent': CLI_AGENT },
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
  // The sender of an upgrade is reported like the sender of any other request.
  assert.deepEqual(
    reports.map((r) => [r.status, r.client, r.agent, r.kind]),
    [[101, 'cli', CLI_AGENT, null]]
  );
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

test('the sender is read from the User-Agent', () => {
  assert.equal(clientOf({ 'user-agent': DESKTOP_AGENT }), 'desktop');
  assert.equal(clientOf({ 'user-agent': CLI_AGENT }), 'cli');
  assert.equal(clientOf({ 'user-agent': 'Antigravity/Hub/3.0.0 (x)' }), 'desktop');
  // A name that only contains the desktop name is not the desktop app.
  assert.equal(clientOf({ 'user-agent': 'curl/8 antigravity/hub/2.35.1' }), 'other');
  assert.equal(clientOf({ 'user-agent': 'antigravity/hubcap/1.0' }), 'other');
  assert.equal(clientOf({ 'user-agent': 'antigravity/2.35.1 (aidev_client)' }), 'other');
  assert.equal(clientOf({ 'user-agent': 'Go-http-client/1.1' }), 'other');
  assert.equal(clientOf({}), 'other');
  assert.equal(clientOf(undefined), 'other');
});

test('a flag response for the command line goes out byte for byte', async (t) => {
  const zipped = zlib.gzipSync(JSON.stringify(FETCH_CONFIG));
  const seen = [];
  const { port, configs, requests } = await setup(
    t,
    (req, res) => {
      seen.push(req.headers['user-agent']);
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': zipped.length });
      res.end(zipped);
    },
    { flags: { a: true, n: 5 } }
  );
  for (const as of ['cli', 'antigravity/ide/1.20.0 (aidev_client)', '']) {
    const res = await request({ port, path: '/v1alpha:fetchConfig', as });
    assert.equal(res.status, 200);
    assert.ok(res.body.equals(zipped), `body changed for "${as}"`);
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.headers['content-length'], String(zipped.length));
  }
  // Nothing of it reaches the flag status or the server flag list.
  assert.deepEqual(configs, []);
  assert.deepEqual(seen, [CLI_AGENT, 'antigravity/ide/1.20.0 (aidev_client)', undefined]);
  assert.deepEqual(
    requests.map((r) => [r.client, r.kind, r.agent]),
    [
      ['cli', 'fetchConfig', CLI_AGENT],
      ['other', 'fetchConfig', 'antigravity/ide/1.20.0 (aidev_client)'],
      ['other', 'fetchConfig', ''],
    ]
  );

  // The same response for the desktop app is patched: the test above would pass for a
  // forwarder that never patches anything.
  const desktop = await request({ port, path: '/v1alpha:fetchConfig' });
  assert.equal(JSON.parse(desktop.body.toString('utf8')).experimentConfig.experimentFlags[0].boolValue, true);
  assert.equal(configs.length, 1);
  assert.equal(requests.at(-1).client, 'desktop');
});

test('the names of the model list are reported only while somebody wants them, and the list goes out unchanged', async (t) => {
  const raw = JSON.stringify({ models: { one: { displayName: 'Gemini 4 Neon (High)' }, two: { displayName: 'Orchestrator (Neon)' } } }, null, 3);
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(raw);
    });
  });
  const upstreamPort = await listen(upstream);
  let want = false;
  const reports = [];
  const forwarder = createForwarder({
    name: 'cloudcode',
    upstream: `http://127.0.0.1:${upstreamPort}`,
    getFlags: () => ({}),
    wantModelNames: () => want,
    onConfig: (report) => reports.push(report),
  });
  const port = await listen(forwarder);
  t.after(async () => {
    await close(forwarder);
    await close(upstream);
  });
  const ask = (as) => request({ port, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}', as });

  // Nobody wants the names: the list is not even read.
  assert.equal((await ask()).body.toString('utf8'), raw);
  assert.equal(reports.length, 0);

  want = true;
  const res = await ask();
  // Byte for byte what the server sent: nothing was written into it.
  assert.equal(res.body.toString('utf8'), raw);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].names, ['Gemini 4 Neon (High)', 'Orchestrator (Neon)']);
  assert.deepEqual(reports[0].applied, []);

  // The command line is never read.
  assert.equal((await ask('cli')).body.toString('utf8'), raw);
  assert.equal(reports.length, 1);
});

// ---- titles of conversations --------------------------------------------------------

test('the title request asks for a Chinese title, and only the one sentence changes', () => {
  const raw = titleRequest();
  const out = rewriteTitleRequest(raw);
  assert.equal(out.result, 'rewritten');
  assert.equal(out.body.toString('utf8'), raw.toString('utf8').replace(TITLE_OLD, TITLE_NEW));
  const data = JSON.parse(out.body.toString('utf8'));
  assert.ok(data.request.systemInstruction.parts[0].text.includes('Simplified Chinese'));
  assert.equal(data.request.contents[0].parts[0].text, 'make the tests pass');
});

test('a request that is no title request, or a title request of another wording, stays as it is', () => {
  const same = (raw, result) => {
    const out = rewriteTitleRequest(raw);
    assert.equal(out.result, result, raw.toString('utf8').slice(0, 80));
    assert.equal(out.body, raw);
  };
  same(Buffer.from('not json'), 'not-title');
  same(Buffer.from('{"requestId":"checkpoint/1"}'), 'not-title');
  same(Buffer.from(JSON.stringify({ request: { systemInstruction: { parts: [{ text: `You are a coding agent. ${TITLE_OLD}` }] } } })), 'not-title');
  same(Buffer.from(JSON.stringify({ request: { systemInstruction: { parts: 'x' } } })), 'not-title');
  // The client words its instruction differently now: nothing is guessed.
  same(titleRequest({ prompt: 'You are a conversation title generator. Respond with a title of 3-5 words.' }), 'changed');
  // The sentence written in another way of JSON, which the byte search would not find.
  same(Buffer.from(titleRequest().toString('utf8').replace("USER's intent", 'USER\\u0027s intent')), 'changed');
  // The user's own message has the sentence too: it is not clear which one to change.
  same(titleRequest({ message: `What does this mean: ${TITLE_OLD}` }), 'skipped');
});

/** A forwarder in front of an upstream that answers with what it received. */
async function setupTitles(t, { want = () => true, upstreamHandler } = {}) {
  const seen = [];
  const upstream = http.createServer(
    upstreamHandler ??
      ((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          seen.push({ body: Buffer.concat(chunks), length: req.headers['content-length'], chunked: req.headers['transfer-encoding'] === 'chunked' });
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end('data: {}\n\n');
        });
      })
  );
  const upstreamPort = await listen(upstream);
  const requests = [];
  const forwarder = createForwarder({
    name: 'cloudcode',
    upstream: `http://127.0.0.1:${upstreamPort}`,
    getFlags: () => ({}),
    wantChineseTitles: want,
    onRequest: (report) => requests.push(report),
  });
  const port = await listen(forwarder);
  t.after(async () => {
    await close(forwarder);
    await close(upstream);
  });
  return { port, seen, requests };
}

const TITLE_PATH = '/v1internal:streamGenerateContent?alt=sse';

/** Send a body in pieces, without a length: the way a body arrives that is not known in advance. */
function sendInPieces(port, parts, { as = DESKTOP_AGENT, pause = 15 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: TITLE_PATH, headers: { 'user-agent': as }, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    const rest = [...parts];
    const next = () => {
      if (rest.length === 0) return req.end();
      req.write(rest.shift(), () => setTimeout(next, pause));
    };
    next();
  });
}

test('a title request of the desktop app is kept back, changed and sent with its new length', async (t) => {
  const { port, seen, requests } = await setupTitles(t);
  const raw = titleRequest();
  const expected = Buffer.from(raw.toString('utf8').replace(TITLE_OLD, TITLE_NEW));

  // In one piece, with a length.
  const res = await request({ port, method: 'POST', path: TITLE_PATH, headers: { 'content-type': 'application/json' }, body: raw });
  assert.equal(res.status, 200);
  assert.ok(seen[0].body.equals(expected));
  assert.equal(seen[0].length, String(expected.length));

  // In small pieces, without a length: the first piece alone does not decide.
  const pieces = [raw.subarray(0, 100), raw.subarray(100, 700), raw.subarray(700)];
  assert.equal(await sendInPieces(port, pieces), 200);
  assert.ok(seen[1].body.equals(expected));
  assert.equal(seen[1].length, String(expected.length));
  assert.equal(seen[1].chunked, false);
  assert.deepEqual(requests.map((r) => r.title), ['rewritten', 'rewritten']);
});

test('a title request goes out unchanged while the feature is off, and from the command line', async (t) => {
  let want = false;
  const { port, seen, requests } = await setupTitles(t, { want: () => want });
  const raw = titleRequest();
  await request({ port, method: 'POST', path: TITLE_PATH, body: raw });
  want = true;
  await request({ port, method: 'POST', path: TITLE_PATH, body: raw, as: 'cli' });
  // A compressed body is never read.
  await request({ port, method: 'POST', path: TITLE_PATH, body: raw, headers: { 'content-encoding': 'gzip' } });
  // Another path is no model request.
  await request({ port, method: 'POST', path: '/v1internal:loadCodeAssist', body: raw });
  assert.equal(seen.length, 4);
  for (const one of seen) assert.ok(one.body.equals(raw));
  assert.deepEqual(requests.map((r) => r.title), [null, null, null, null]);
});

test('a title request of another wording goes out unchanged, and the report says so', async (t) => {
  const { port, seen, requests } = await setupTitles(t);
  const changed = titleRequest({ prompt: 'You are a conversation title generator. Respond with a title of 3-5 words.' });
  const twice = titleRequest({ message: `What does this mean: ${TITLE_OLD}` });
  await request({ port, method: 'POST', path: TITLE_PATH, body: changed });
  await request({ port, method: 'POST', path: TITLE_PATH, body: twice });
  assert.ok(seen[0].body.equals(changed));
  assert.ok(seen[1].body.equals(twice));
  assert.deepEqual(requests.map((r) => r.title), ['changed', 'skipped']);
});

test('another model request is sent on as soon as its start shows that it is no title request', async (t) => {
  let started;
  const gotStart = new Promise((resolve) => {
    started = resolve;
  });
  const bodies = [];
  const { port, requests } = await setupTitles(t, {
    upstreamHandler: (req, res) => {
      const chunks = [];
      req.on('data', (chunk) => {
        chunks.push(chunk);
        started();
      });
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        res.end('data: {}\n\n');
      });
    },
  });
  const head = `{"project":"p","requestId":"agent/1","request":{"contents":[{"role":"user","parts":[{"text":"${'x'.repeat(600)}`;
  const tail = '"}]}]}}';
  const done = new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: TITLE_PATH, headers: { 'user-agent': DESKTOP_AGENT }, agent: false }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(head);
    // The rest is sent only after the upstream has seen the start. A forwarder that kept
    // the whole body back would never get there; fail instead of hanging.
    const timer = setTimeout(() => reject(new Error('the start of the body did not reach the upstream')), 2000);
    gotStart.then(() => {
      clearTimeout(timer);
      req.end(tail);
    });
  });
  await done;
  assert.equal(bodies[0], head + tail);
  // A short one, which ends before the bytes that decide.
  await request({ port, method: 'POST', path: TITLE_PATH, body: '{"requestId":"agent/2"}' });
  assert.equal(bodies[1], '{"requestId":"agent/2"}');
  assert.deepEqual(requests.map((r) => r.title), [null, null]);
});

test('a very large title request goes out unchanged', async (t) => {
  const { port, seen, requests } = await setupTitles(t);
  const raw = titleRequest({ message: 'x'.repeat(9 * 1024 * 1024) });
  const res = await request({ port, method: 'POST', path: TITLE_PATH, body: raw });
  assert.equal(res.status, 200);
  assert.ok(seen[0].body.equals(raw));
  assert.equal(requests[0].title, null);
});

test('a title request that is sent again after a reset connection is sent changed', async (t) => {
  const perSocket = new WeakMap();
  const bodies = [];
  const { port } = await setupTitles(t, {
    upstreamHandler: (req, res) => {
      const count = (perSocket.get(req.socket) || 0) + 1;
      perSocket.set(req.socket, count);
      if (count === 2) {
        req.socket.destroy();
        return;
      }
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks));
        res.end('ok');
      });
    },
  });
  const raw = titleRequest();
  await request({ port, method: 'POST', path: TITLE_PATH, body: raw });
  await sleep(50);
  const res = await request({ port, method: 'POST', path: TITLE_PATH, body: raw });
  assert.equal(res.status, 200);
  assert.equal(bodies.length, 2);
  for (const body of bodies) assert.ok(body.toString('utf8').includes(TITLE_NEW));
});
