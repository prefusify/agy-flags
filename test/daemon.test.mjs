import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { files, loadConfig } from '../src/config.mjs';
import { computePending, ping, startDaemon } from '../src/daemon.mjs';
import { close, fakeApp, fakePageScript, fakeRunner, freePorts, listen, request, sleep, tempHome, waitFor } from './helpers.mjs';

/** A fake Google: answers the two flag paths and one ordinary path. */
function fakeUpstream() {
  return http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (pathname.endsWith(':fetchAvailableModels')) {
        res.end(JSON.stringify({ models: { one: {}, two: { modelExperiments: { experiments: { other: { boolValue: true } } } } } }));
      } else if (pathname.endsWith(':listExperiments')) {
        res.end(JSON.stringify({ flags: [{ name: 'x', boolValue: false }, { name: 'n', intValue: '3' }] }));
      } else if (pathname.endsWith(':fetchConfig')) {
        res.end(JSON.stringify({ experimentConfig: { experimentFlags: [{ name: 'x', boolValue: false }] } }));
      } else {
        res.end('{"other":true}');
      }
    });
  });
}

function fakeClient(state = {}) {
  const current = { running: false, lsPid: null, lsStartedAt: null, endpointArg: null, env: {}, ...state };
  return {
    current,
    restarts: 0,
    appInfo: async () => ({ installed: true, version: '9.9.9', bundleId: 'test.app' }),
    clientState: async () => current,
    async restartClient() {
      this.restarts += 1;
      return { ok: true };
    },
  };
}

async function setup(
  t,
  { flags = { x: true }, enabled = true, runner = fakeRunner(), client = fakeClient(), start = true, pageScript = fakePageScript(), app = true } = {}
) {
  const home = tempHome();
  const before = process.env.AGY_FLAGS_HOME;
  process.env.AGY_FLAGS_HOME = home;
  const upstream = fakeUpstream();
  const upstreamPort = await listen(upstream);
  const [cloudcode, aicode, ui, devui] = await freePorts(4);
  const origin = `http://127.0.0.1:${upstreamPort}`;
  // The "app" is a directory with a page archive in its language server, or nothing at all.
  const appPath = app
    ? fakeApp(home, [
        { name: 'index.html', data: Buffer.from('<!doctype html><script src="/main.js"></script>') },
        { name: 'main.js', data: Buffer.from(pageScript) },
        { name: 'icons/a.svg', data: Buffer.from('<svg/>') },
      ])
    : `${home}/Missing.app`;
  fs.writeFileSync(
    files.config(),
    JSON.stringify({ enabled, flags, ports: { cloudcode, aicode, ui, devui }, upstreams: { cloudcode: origin, aicode: origin }, appPath })
  );
  const logs = [];
  // A small catalog of our own, so that the tests do not depend on the shipped one.
  const catalogFile = `${home}/catalog.json`;
  fs.writeFileSync(
    catalogFile,
    JSON.stringify({
      groups: [
        { id: 'plain', flags: ['x'] },
        { id: 'keep', perModel: true, flags: ['keep-on'], params: [{ flag: 'keep_pings', type: 'int', default: 8 }] },
        { id: 'ctx', uiPatch: 'contextUsageIndicator', flags: ['ctx-on'] },
      ],
    })
  );
  const ctx = { home, runner, client, logs, ports: { cloudcode, aicode, ui, devui }, handles: [] };
  ctx.start = async (extra = {}) => {
    const handle = await startDaemon({ runner, client, log: (m) => logs.push(m), pollMs: 20, catalogFile, ...extra });
    if (handle.status === 'running') ctx.handles.push(handle);
    return handle;
  };
  t.after(async () => {
    for (const handle of ctx.handles) await handle.stop();
    await close(upstream);
    if (before === undefined) delete process.env.AGY_FLAGS_HOME;
    else process.env.AGY_FLAGS_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  });
  if (start) ctx.handle = await ctx.start();
  return ctx;
}

const ours = (ports) => ({
  CLOUD_CODE_URL: `http://127.0.0.1:${ports.cloudcode}`,
  AICODE_ENDPOINT_URL: `http://127.0.0.1:${ports.aicode}`,
});

const parse = (res) => JSON.parse(res.body.toString('utf8'));

test('the variables are set only after the forwarders are listening', async (t) => {
  const runner = fakeRunner();
  const set = runner.set;
  const listeningWhenSet = [];
  runner.set = async (name, value) => {
    listeningWhenSet.push(Boolean(await ping(Number(new URL(value).port))));
    await set(name, value);
  };
  const ctx = await setup(t, { runner });
  assert.equal(ctx.handle.status, 'running');
  assert.deepEqual(listeningWhenSet, [true, true]);
  assert.deepEqual(runner.vars, ours(ctx.ports));
});

test('a flag response that passes through is patched, and the state shows it', async (t) => {
  const ctx = await setup(t);
  const res = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  assert.deepEqual(parse(res).flags, [{ name: 'x', boolValue: true }, { name: 'n', intValue: '3' }]);
  const other = await request({ port: ctx.ports.aicode, path: '/v1alpha/remote:listProjects' });
  assert.deepEqual(parse(other), { other: true });

  const state = await ctx.handle.getState();
  assert.equal(state.enabled, true);
  assert.equal(state.env.status, 'set');
  assert.equal(state.server.count, 2);
  assert.deepEqual(state.lastInjection.cloudcode.applied, ['x']);
  assert.deepEqual(state.warnings, []);
  assert.equal(state.app.version, '9.9.9');
});

test('the web API changes overrides, and refuses a value of the wrong type', async (t) => {
  const ctx = await setup(t, { flags: {} });
  const headers = { 'x-agy-flags-token': ctx.handle.token, 'content-type': 'application/json' };
  // Let the daemon see the server list first.
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });

  const ok = await request({ port: ctx.ports.ui, method: 'POST', path: '/api/flags', headers, body: '{"changes":{"x":true,"custom-flag":false}}' });
  assert.equal(ok.status, 200);
  assert.deepEqual(loadConfig().flags, { x: true, 'custom-flag': false });
  assert.ok(loadConfig().flagsChangedAt > 0);

  const refused = await request({ port: ctx.ports.ui, method: 'POST', path: '/api/flags', headers, body: '{"changes":{"n":true}}' });
  assert.equal(refused.status, 400);
  assert.equal(parse(refused).error, 'server-type');
  const notBool = await request({ port: ctx.ports.ui, method: 'POST', path: '/api/flags', headers, body: '{"changes":{"x":"yes"}}' });
  assert.equal(parse(notBool).error, 'bad-value');
  const fraction = await request({ port: ctx.ports.ui, method: 'POST', path: '/api/flags', headers, body: '{"changes":{"n":1.5}}' });
  assert.equal(parse(fraction).error, 'bad-value');
  const intOnBool = await request({ port: ctx.ports.ui, method: 'POST', path: '/api/flags', headers, body: '{"changes":{"x":3}}' });
  assert.equal(parse(intOnBool).error, 'server-type');
  const badName = await request({ port: ctx.ports.ui, method: 'POST', path: '/api/flags', headers, body: '{"changes":{"bad name":true}}' });
  assert.equal(parse(badName).error, 'bad-name');
  assert.deepEqual(loadConfig().flags, { x: true, 'custom-flag': false });

  const removed = await request({ port: ctx.ports.ui, method: 'POST', path: '/api/flags', headers, body: '{"changes":{"custom-flag":null}}' });
  assert.equal(removed.status, 200);
  assert.deepEqual(loadConfig().flags, { x: true });

  const list = parse(await request({ port: ctx.ports.ui, path: '/api/server-flags', headers }));
  assert.deepEqual(list.flags.n, { type: 'intValue', value: '3', sources: ['cloudcode'] });

  // An integer flag takes an integer, whether the server sends the flag or not.
  const ints = await request({ port: ctx.ports.ui, method: 'POST', path: '/api/flags', headers, body: '{"changes":{"n":7,"new_count":2}}' });
  assert.equal(ints.status, 200);
  assert.deepEqual(loadConfig().flags, { x: true, n: 7, new_count: 2 });
});

test('per-model flags go into the model list, with a status of their own', async (t) => {
  const ctx = await setup(t, { flags: { x: true, 'keep-on': true, keep_pings: 3 } });
  const listed = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  // In the global list every override is written.
  assert.deepEqual(
    parse(listed).flags.map((f) => f.name),
    ['x', 'n', 'keep-on', 'keep_pings']
  );
  const before = await ctx.handle.getState();
  assert.equal(before.modelPatch, null);
  assert.deepEqual(before.perModelFlags.sort(), ['keep-on', 'keep_pings']);

  const models = parse(await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}' }));
  const want = { 'keep-on': { boolValue: true }, keep_pings: { intValue: '3' } };
  assert.deepEqual(models.models.one.modelExperiments.experiments, want);
  assert.deepEqual(models.models.two.modelExperiments.experiments, { other: { boolValue: true }, ...want });

  const state = await ctx.handle.getState();
  assert.deepEqual(
    { ok: state.modelPatch.ok, applied: state.modelPatch.applied, models: state.modelPatch.models },
    { ok: true, applied: ['keep-on', 'keep_pings'], models: 2 }
  );
  // The model list must not replace the status or the flag list of listExperiments.
  assert.deepEqual(state.lastInjection.cloudcode.applied, ['x', 'keep-on', 'keep_pings']);
  assert.equal(state.lastInjection.cloudcode.kind, 'listExperiments');
  assert.equal(state.server.count, 2);
  assert.deepEqual(state.warnings, []);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(files.state(), 'utf8')).serverFlags.cloudcode), ['x', 'n']);
});

test('with injection off, or without per-model overrides, the model list is not changed', async (t) => {
  const ctx = await setup(t, { flags: { x: true } });
  const plain = parse(await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}' }));
  assert.deepEqual(plain.models.one, {});
  assert.equal((await ctx.handle.getState()).modelPatch, null);
});

test('keep-alive requests of the client are counted', async (t) => {
  const ctx = await setup(t);
  const body = '{"request":{"labels":{"prompt_cache_keep_alive":"true"}}}';
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:streamGenerateContent?alt=sse', body });
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:streamGenerateContent?alt=sse', body: '{"request":{}}' });
  const state = await ctx.handle.getState();
  assert.equal(state.keepAlive.count, 1);
  assert.ok(state.keepAlive.lastAt > 0);
});

test('turning rewriting off clears the variables but keeps forwarding', async (t) => {
  const ctx = await setup(t);
  const headers = { 'x-agy-flags-token': ctx.handle.token, 'content-type': 'application/json' };
  const off = await request({ port: ctx.ports.ui, method: 'POST', path: '/api/enabled', headers, body: '{"enabled":false}' });
  assert.equal(off.status, 200);
  assert.deepEqual(ctx.runner.vars, {});
  const res = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  assert.deepEqual(parse(res).flags[0], { name: 'x', boolValue: false });

  await request({ port: ctx.ports.ui, method: 'POST', path: '/api/enabled', headers, body: '{"enabled":true}' });
  assert.deepEqual(ctx.runner.vars, ours(ctx.ports));
});

test('a second daemon sees the first one and leaves everything alone', async (t) => {
  const ctx = await setup(t);
  const callsBefore = ctx.runner.calls.length;
  const second = await ctx.start();
  assert.equal(second.status, 'already-running');
  assert.equal(ctx.runner.calls.length, callsBefore);
  assert.deepEqual(ctx.runner.vars, ours(ctx.ports));
  assert.ok(await ping(ctx.ports.cloudcode));
});

test('stopping clears the variables and frees the ports', async (t) => {
  const ctx = await setup(t);
  await ctx.handle.stop();
  assert.deepEqual(ctx.runner.vars, {});
  assert.equal(await ping(ctx.ports.cloudcode), null);
  assert.equal(await ping(ctx.ports.ui), null);
});

test('a variable set by another program is not overwritten', async (t) => {
  const runner = fakeRunner({ CLOUD_CODE_URL: 'http://127.0.0.1:8888' });
  const ctx = await setup(t, { runner });
  assert.deepEqual(runner.vars, { CLOUD_CODE_URL: 'http://127.0.0.1:8888' });
  const state = await ctx.handle.getState();
  assert.equal(state.env.status, 'conflict');
  assert.deepEqual(state.warnings.map((w) => w.code), ['env-conflict']);
  await ctx.handle.stop();
  assert.deepEqual(runner.vars, { CLOUD_CODE_URL: 'http://127.0.0.1:8888' });
});

test('a port taken by another program stops the start and removes stale variables', async (t) => {
  const ctx = await setup(t, { start: false });
  Object.assign(ctx.runner.vars, ours(ctx.ports));
  const squatter = http.createServer((req, res) => res.end('not agy-flags'));
  await listen(squatter, ctx.ports.aicode);
  t.after(() => close(squatter));
  await assert.rejects(ctx.start(), (err) => err.code === 'PORT_IN_USE' && err.port === ctx.ports.aicode);
  assert.deepEqual(ctx.runner.vars, {});
  assert.equal(await ping(ctx.ports.cloudcode), null);
});

test('a change made in config.json by hand is picked up', async (t) => {
  const ctx = await setup(t, { flags: {} });
  const config = loadConfig();
  fs.writeFileSync(files.config(), JSON.stringify({ ...config, flags: { y: true } }));
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(files.config(), future, future);
  const state = await waitFor(async () => {
    const s = await ctx.handle.getState();
    return s.overrides.y === true ? s : null;
  });
  assert.ok(state.changedAt > 0);
  const res = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  assert.ok(parse(res).flags.some((f) => f.name === 'y' && f.boolValue === true));
});

test('the server flag list survives a daemon restart', async (t) => {
  const ctx = await setup(t);
  await request({ port: ctx.ports.aicode, path: '/v1alpha:fetchConfig' });
  await ctx.handle.stop();
  const again = await ctx.start();
  const state = await again.getState();
  assert.equal(state.server.count, 1);
  assert.deepEqual(state.lastInjection, {});
});

test('the state says when the client needs a restart', async (t) => {
  const client = fakeClient();
  const ctx = await setup(t, { client, flags: {} });
  Object.assign(client.current, { running: true, lsPid: 10, lsStartedAt: Date.now() - 60_000, env: ours(ctx.ports) });
  const headers = { 'x-agy-flags-token': ctx.handle.token, 'content-type': 'application/json' };
  let state = await ctx.handle.getState();
  assert.equal(state.pendingRestart, false);
  assert.equal(state.client.routed, true);

  await request({ port: ctx.ports.ui, method: 'POST', path: '/api/flags', headers, body: '{"changes":{"x":true}}' });
  state = await ctx.handle.getState();
  assert.equal(state.pendingRestart, true);
  assert.equal(state.pendingReason, 'flags-changed');

  const restart = await request({ port: ctx.ports.ui, method: 'POST', path: '/api/restart-client', headers, body: '{}' });
  assert.equal(restart.status, 200);
  assert.equal(client.restarts, 1);
});

test('computePending', () => {
  const base = { CLOUD_CODE_URL: 'http://127.0.0.1:1', AICODE_ENDPOINT_URL: 'http://127.0.0.1:2' };
  const page = { AGY_DEV_UI_URL: 'http://127.0.0.1:3' };
  const client = (env, lsStartedAt = 1000) => ({ running: true, lsPid: 1, lsStartedAt, env });
  const stopped = { running: false, lsPid: null, lsStartedAt: null, env: {} };
  const reason = (args) => computePending({ base, page, changedAt: 0, ...args }).reason;

  assert.deepEqual(computePending({ enabled: true, client: stopped, base, changedAt: 5000 }), { pending: false, reason: null, routed: null, carries: null });
  assert.deepEqual(computePending({ enabled: true, client: client({}), base, changedAt: 0 }), { pending: true, reason: 'not-routed', routed: false, carries: false });
  // One variable alone is not enough.
  assert.equal(reason({ enabled: true, client: client({ CLOUD_CODE_URL: base.CLOUD_CODE_URL }) }), 'not-routed');
  assert.deepEqual(computePending({ enabled: true, client: client(base), base, changedAt: 500 }), { pending: false, reason: null, routed: true, carries: true });
  assert.equal(reason({ enabled: true, client: client(base), changedAt: 2000 }), 'flags-changed');
  assert.equal(reason({ enabled: false, client: client(base) }), 'still-routed');
  assert.deepEqual(computePending({ enabled: false, client: client({}), base, changedAt: 9999 }), { pending: false, reason: null, routed: false, carries: false });

  // The page variable: wanted and missing, carried and no longer wanted.
  assert.equal(reason({ enabled: true, client: client(base), wantPage: true }), 'not-routed');
  assert.equal(reason({ enabled: true, client: client({ ...base, ...page }), wantPage: true }), null);
  assert.equal(reason({ enabled: true, client: client({ ...base, ...page }), wantPage: false }), 'page-off');
  // A client that has only the page variable still needs a restart after rewriting is turned off.
  assert.deepEqual(computePending({ enabled: false, client: client(page), base, page, changedAt: 0 }), {
    pending: true,
    reason: 'still-routed',
    routed: false,
    carries: true,
  });
});

test('a page feature sets the third variable and serves the page script with the component', async (t) => {
  const ctx = await setup(t, { flags: { 'ctx-on': true } });
  const pageVar = `http://127.0.0.1:${ctx.ports.devui}`;
  assert.deepEqual(ctx.runner.vars, { ...ours(ctx.ports), AGY_DEV_UI_URL: pageVar });

  const script = await request({ port: ctx.ports.devui, path: '/main.js' });
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /javascript/);
  const text = script.body.toString('utf8');
  assert.equal(text.includes('contextUsageIndicator:void 0,'), false);
  assert.ok(text.includes('contextUsageIndicator:(()=>'));
  // Every other file comes out of the archive unchanged.
  const index = await request({ port: ctx.ports.devui, path: '/' });
  assert.equal(index.body.toString('utf8'), '<!doctype html><script src="/main.js"></script>');
  assert.equal((await request({ port: ctx.ports.devui, path: '/icons/a.svg' })).body.toString('utf8'), '<svg/>');
  assert.equal((await request({ port: ctx.ports.devui, path: '/nothing.js' })).status, 404);

  const state = await ctx.handle.getState();
  assert.equal(state.page.wanted, true);
  assert.equal(state.page.script.patched, true);
  assert.deepEqual(state.warnings, []);

  await ctx.handle.stop();
  assert.deepEqual(ctx.runner.vars, {});
});

test('without a page feature the third variable is not set and the script is the original', async (t) => {
  const ctx = await setup(t, { flags: { x: true } });
  assert.deepEqual(ctx.runner.vars, ours(ctx.ports));
  const script = await request({ port: ctx.ports.devui, path: '/main.js' });
  assert.equal(script.body.toString('utf8'), fakePageScript());
  assert.equal((await ctx.handle.getState()).page.wanted, false);
});

test('turning a page feature on and off sets and clears the third variable', async (t) => {
  const client = fakeClient();
  const ctx = await setup(t, { flags: {}, client });
  const headers = { 'x-agy-flags-token': ctx.handle.token, 'content-type': 'application/json' };
  const pageVar = `http://127.0.0.1:${ctx.ports.devui}`;
  Object.assign(client.current, { running: true, lsPid: 7, lsStartedAt: Date.now() + 60_000, env: ours(ctx.ports) });

  await request({ port: ctx.ports.ui, method: 'POST', path: '/api/flags', headers, body: '{"changes":{"ctx-on":true}}' });
  assert.equal(ctx.runner.vars.AGY_DEV_UI_URL, pageVar);
  // The running client does not have the variable yet.
  await waitFor(async () => (await ctx.handle.getState()).pendingReason === 'not-routed');

  client.current.env = { ...ours(ctx.ports), AGY_DEV_UI_URL: pageVar };
  await waitFor(async () => (await ctx.handle.getState()).pendingRestart === false);

  await request({ port: ctx.ports.ui, method: 'POST', path: '/api/flags', headers, body: '{"changes":{"ctx-on":null}}' });
  assert.equal(ctx.runner.vars.AGY_DEV_UI_URL, undefined);
  assert.deepEqual(ctx.runner.vars, ours(ctx.ports));
  // The client still takes its page files from us until it is restarted.
  await waitFor(async () => (await ctx.handle.getState()).pendingReason === 'page-off');
  assert.equal((await request({ port: ctx.ports.devui, path: '/main.js' })).body.toString('utf8'), fakePageScript());
});

test('when the page files cannot be found, the third variable is not set', async (t) => {
  const ctx = await setup(t, { flags: { 'ctx-on': true }, app: false });
  assert.deepEqual(ctx.runner.vars, ours(ctx.ports));
  const state = await ctx.handle.getState();
  assert.equal(state.page.wanted, false);
  assert.deepEqual(state.warnings.map((w) => w.code), ['page-unavailable']);
  assert.equal((await request({ port: ctx.ports.devui, path: '/main.js' })).status, 500);
});

test('a page script that cannot be changed is served as it is, with a warning', async (t) => {
  const original = fakePageScript({ anchor: '' });
  const ctx = await setup(t, { flags: { 'ctx-on': true }, pageScript: original });
  const script = await request({ port: ctx.ports.devui, path: '/main.js' });
  assert.equal(script.body.toString('utf8'), original);
  const state = await ctx.handle.getState();
  assert.deepEqual(state.warnings.map((w) => w.code), ['page-not-changed']);
  assert.match(state.warnings[0].detail, /place for the indicator was not found/);
});

test('a request of the command line is not changed and leaves no trace in the flag status', async (t) => {
  const ctx = await setup(t, { flags: { x: true, 'keep-on': true } });
  const original = [{ name: 'x', boolValue: false }, { name: 'n', intValue: '3' }];
  const res = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}', as: 'cli' });
  assert.deepEqual(parse(res).flags, original);
  const config = await request({ port: ctx.ports.aicode, path: '/v1alpha:fetchConfig', as: 'cli' });
  assert.deepEqual(parse(config).experimentConfig.experimentFlags, [{ name: 'x', boolValue: false }]);
  const models = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}', as: 'cli' });
  assert.deepEqual(parse(models).models.one, {});

  let state = await ctx.handle.getState();
  assert.deepEqual(state.lastInjection, {});
  assert.equal(state.modelPatch, null);
  assert.equal(state.server.count, 0);
  assert.deepEqual(state.traffic.byClient, { desktop: 0, cli: 3, other: 0 });
  assert.match(state.traffic.agents.cli, /^antigravity\/cli\//);
  assert.deepEqual(state.warnings, []);

  // The desktop app asks for the same thing and gets the override.
  const desktop = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  assert.deepEqual(parse(desktop).flags.slice(0, 2), [{ name: 'x', boolValue: true }, { name: 'n', intValue: '3' }]);
  state = await ctx.handle.getState();
  assert.deepEqual(state.lastInjection.cloudcode.applied, ['x', 'keep-on']);
  assert.equal(state.server.count, 2);
  assert.deepEqual(state.traffic.byClient, { desktop: 1, cli: 3, other: 0 });
});

test('a desktop app that runs through us under an unknown name gets a warning', async (t) => {
  const client = fakeClient();
  const ctx = await setup(t, { client, start: false });
  ctx.handle = await ctx.start({ unrecognizedGraceMs: 0 });
  const codes = async () => (await ctx.handle.getState()).warnings.map((w) => w.code);
  const list = (as) => request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}', as });

  // An unknown sender while the desktop app does not run through us: nothing to warn about.
  await list('antigravity/ide/1.20.0 (aidev_client)');
  assert.deepEqual(await codes(), []);

  // The desktop app starts, routed through us. The command line alone is no reason either.
  await sleep(5);
  Object.assign(client.current, { running: true, lsPid: 42, lsStartedAt: Date.now(), env: ours(ctx.ports) });
  await list('cli');
  await waitFor(async () => (await ctx.handle.getState()).client.routed === true);
  assert.deepEqual(await codes(), []);

  // A flag request with a name we do not know, and none with the desktop name since the start.
  const renamed = 'antigravity/desk/3.0.0 (aidev_client; os_type=darwin)';
  const res = await list(renamed);
  assert.deepEqual(parse(res).flags, [{ name: 'x', boolValue: false }, { name: 'n', intValue: '3' }]);
  const state = await ctx.handle.getState();
  assert.deepEqual(state.warnings, [{ code: 'desktop-not-recognized', detail: renamed }]);
  assert.equal(state.traffic.byClient.other, 2);

  // Once a request carries the desktop name, the warning goes away.
  await list('desktop');
  assert.deepEqual(await codes(), []);

  // The model list of an unknown sender is no sign of a renamed app.
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}', as: renamed });
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:loadCodeAssist', body: '{}', as: renamed });
  assert.deepEqual(await codes(), []);
});

test('an unknown sender next to a working desktop app raises no warning', async (t) => {
  const client = fakeClient();
  const ctx = await setup(t, { client, start: false });
  // The default wait is longer than the app's own minute between two flag requests.
  ctx.handle = await ctx.start();
  const codes = async () => (await ctx.handle.getState()).warnings.map((w) => w.code);
  const list = (as) => request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}', as });
  Object.assign(client.current, { running: true, lsPid: 42, lsStartedAt: Date.now() - 1000, env: ours(ctx.ports) });
  await list('desktop');
  await list('antigravity/ide/1.20.0 (aidev_client)');
  await waitFor(async () => (await ctx.handle.getState()).client.routed === true);
  assert.deepEqual(await codes(), []);
  assert.equal((await ctx.handle.getState()).traffic.byClient.other, 1);
});
