import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { files, loadConfig } from '../src/config.mjs';
import { computePending, ping, startDaemon } from '../src/daemon.mjs';
import { TITLE_NEW } from '../src/forward.mjs';
import { close, fakeApp, fakePageScript, fakeRunner, freePorts, listen, request, sleep, tempHome, titleRequest, waitFor } from './helpers.mjs';

/**
 * A fake Google: answers the two flag paths and one ordinary path. `flags` is its flag list.
 * The bodies of the model requests that reach it are kept in `server.modelBodies`.
 */
function fakeUpstream(flags = [{ name: 'x', boolValue: false }, { name: 'n', intValue: '3' }]) {
  const modelBodies = [];
  const server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (pathname.endsWith('GenerateContent')) modelBodies.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      if (pathname.endsWith(':fetchAvailableModels')) {
        res.end(
          JSON.stringify({
            models: {
              one: { displayName: 'Gemini 4 Neon (High)' },
              two: { displayName: 'Orchestrator (Neon)', modelExperiments: { experiments: { other: { boolValue: true } } } },
            },
          })
        );
      } else if (pathname.endsWith(':listExperiments')) {
        res.end(JSON.stringify({ flags }));
      } else if (pathname.endsWith(':fetchConfig')) {
        res.end(JSON.stringify({ experimentConfig: { experimentFlags: [{ name: 'x', boolValue: false }] } }));
      } else {
        res.end('{"other":true}');
      }
    });
  });
  server.modelBodies = modelBodies;
  return server;
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
  {
    flags = { x: true },
    enabled = true,
    runner = fakeRunner(),
    client = fakeClient(),
    start = true,
    pageScript = fakePageScript(),
    app = true,
    appOptions = {},
    upstreamFlags,
  } = {}
) {
  const home = tempHome();
  const before = process.env.AGY_FLAGS_HOME;
  process.env.AGY_FLAGS_HOME = home;
  const upstream = fakeUpstream(upstreamFlags);
  const upstreamPort = await listen(upstream);
  const [cloudcode, aicode, ui, devui] = await freePorts(4);
  const origin = `http://127.0.0.1:${upstreamPort}`;
  // The "app" is a directory with a page archive in its language server, or nothing at all.
  const appPath = app
    ? fakeApp(
        home,
        [
          { name: 'index.html', data: Buffer.from('<!doctype html><script src="/main.js"></script>') },
          { name: 'main.js', data: Buffer.from(pageScript) },
          { name: 'icons/a.svg', data: Buffer.from('<svg/>') },
        ],
        appOptions
      )
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
        { id: 'ctx', uiPatch: 'contextUsageIndicator', flags: ['ctx-on'] },
        { id: 'prices', uiPatch: 'costPrices', feature: 'costPrices', flags: [], requires: ['cost-on'] },
        { id: 'zh', uiPatch: 'l10n', feature: 'uiChinese', flags: [] },
        { id: 'titles', feature: 'chineseTitles', flags: [] },
      ],
    })
  );
  // A word list of our own too.
  const l10nFile = `${home}/words.json`;
  fs.writeFileSync(l10nFile, JSON.stringify({ exact: { 'New Conversation': '新建对话' }, patterns: [] }));
  const ctx = { home, runner, client, logs, upstream, ports: { cloudcode, aicode, ui, devui }, handles: [] };
  ctx.start = async (extra = {}) => {
    const handle = await startDaemon({ runner, client, log: (m) => logs.push(m), pollMs: 20, catalogFile, l10nFile, ...extra });
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

const NO_FEATURES = { costPrices: false, uiChinese: false, chineseTitles: false };

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

test('the model list is never changed, and it does not replace the status of the flag response', async (t) => {
  const ctx = await setup(t, { flags: { x: true } });
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  const res = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}' });
  assert.deepEqual(parse(res).models, {
    one: { displayName: 'Gemini 4 Neon (High)' },
    two: { displayName: 'Orchestrator (Neon)', modelExperiments: { experiments: { other: { boolValue: true } } } },
  });
  const state = await ctx.handle.getState();
  assert.deepEqual(state.lastInjection.cloudcode.applied, ['x']);
  assert.equal(state.lastInjection.cloudcode.kind, 'listExperiments');
  assert.equal(state.server.count, 2);
  assert.deepEqual(state.warnings, []);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(files.state(), 'utf8')).serverFlags.cloudcode), ['x', 'n']);
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
  const ctx = await setup(t, { flags: { x: true, 'other-on': true } });
  const original = [{ name: 'x', boolValue: false }, { name: 'n', intValue: '3' }];
  const res = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}', as: 'cli' });
  assert.deepEqual(parse(res).flags, original);
  const config = await request({ port: ctx.ports.aicode, path: '/v1alpha:fetchConfig', as: 'cli' });
  assert.deepEqual(parse(config).experimentConfig.experimentFlags, [{ name: 'x', boolValue: false }]);
  const models = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}', as: 'cli' });
  assert.deepEqual(parse(models).models.one, { displayName: 'Gemini 4 Neon (High)' });

  let state = await ctx.handle.getState();
  assert.deepEqual(state.lastInjection, {});
  assert.equal(state.server.count, 0);
  assert.deepEqual(state.traffic.byClient, { desktop: 0, cli: 3, other: 0 });
  assert.match(state.traffic.agents.cli, /^antigravity\/cli\//);
  assert.deepEqual(state.warnings, []);

  // The desktop app asks for the same thing and gets the override.
  const desktop = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  assert.deepEqual(parse(desktop).flags.slice(0, 2), [{ name: 'x', boolValue: true }, { name: 'n', intValue: '3' }]);
  state = await ctx.handle.getState();
  assert.deepEqual(state.lastInjection.cloudcode.applied, ['x', 'other-on']);
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

test('the page gets what the servers send for each flag', async (t) => {
  const ctx = await setup(t);
  const headers = { 'x-agy-flags-token': ctx.handle.token };
  const list = async () => parse(await request({ port: ctx.ports.ui, path: '/api/server-flags', headers }));
  const before = await list();
  assert.deepEqual(before.flags, {});
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  const after = await list();
  assert.ok(after.version > before.version);
  assert.equal(after.flags.x.type, 'boolValue');
  assert.equal(after.flags.x.value, false);
  assert.equal(after.flags.n.type, 'intValue');
  // Nothing else: the page shows the curated features only.
  assert.deepEqual(Object.keys(after).sort(), ['flags', 'version']);
});

// ---- costs at public prices -----------------------------------------------------------

const COST_PLACE = 'q.costSummary!==void 0&&(r.costSummary=q.costSummary);';
const costPage = () => `${fakePageScript()}function take(q,r){${COST_PLACE}return r}`;
const PRICE_LIST = {
  'google-vertex': { models: { 'gemini-4-neon': { name: 'Gemini 4 Neon', cost: { input: 3, output: 15, cache_read: 0.15 } } } },
};

/** A daemon with a price list that the test gives out, and the count of downloads. */
async function setupPrices(t, options = {}) {
  const downloads = { count: 0, fail: false };
  const ctx = await setup(t, { start: false, pageScript: costPage(), ...options });
  ctx.downloads = downloads;
  ctx.handle = await ctx.start({
    fetchPriceList: async () => {
      downloads.count += 1;
      if (downloads.fail) throw new Error('offline');
      return PRICE_LIST;
    },
    priceWaitMs: 500,
  });
  const headers = { 'x-agy-flags-token': ctx.handle.token, 'content-type': 'application/json' };
  ctx.post = (pathname, body) => request({ port: ctx.ports.ui, method: 'POST', path: pathname, headers, body: JSON.stringify(body) });
  ctx.state = async () => parse(await request({ port: ctx.ports.ui, path: '/api/state', headers }));
  ctx.script = async () => (await request({ port: ctx.ports.devui, path: '/main.js' })).body.toString('utf8');
  return ctx;
}

test('the price feature is off at first: no download, no third variable, the original script', async (t) => {
  const ctx = await setupPrices(t);
  await sleep(60);
  assert.equal(ctx.downloads.count, 0);
  assert.deepEqual(ctx.runner.vars, ours(ctx.ports));
  const state = await ctx.state();
  assert.deepEqual(state.features, NO_FEATURES);
  assert.equal(state.prices.fetchedAt, null);
  assert.equal(fs.existsSync(files.prices()), false);
  // Nobody can download the list from the page while the feature is off.
  const res = await ctx.post('/api/prices/refresh', {});
  assert.equal(res.status, 400);
  assert.equal(ctx.downloads.count, 0);
});

test('turning the price feature on downloads the list, sets the third variable and fills in the costs', async (t) => {
  const ctx = await setupPrices(t);
  const res = await ctx.post('/api/features', { changes: { costPrices: true }, flags: { 'cost-on': true } });
  assert.equal(res.status, 200);
  await waitFor(async () => (await ctx.state()).prices.fetchedAt);
  assert.equal(ctx.downloads.count, 1);
  assert.equal(ctx.runner.vars.AGY_DEV_UI_URL, `http://127.0.0.1:${ctx.ports.devui}`);

  // The feature is in the config file, apart from the flags; the flag it needs is a flag.
  const saved = loadConfig();
  assert.deepEqual(saved.features, { ...NO_FEATURES, costPrices: true });
  assert.equal(saved.flags['cost-on'], true);
  assert.equal(Object.keys(saved.flags).includes('costPrices'), false);

  const script = await ctx.script();
  assert.ok(script.includes('__agyFlagsCost'));
  assert.ok(script.includes('{"gemini-4-neon":[3,15,0.15]}'));
  // The indicator is another feature, and it is off.
  assert.ok(script.includes('contextUsageIndicator:void 0,'));
  const state = await ctx.state();
  assert.deepEqual(state.page.script.parts, { costPrices: { ok: true, reason: null } });
  assert.equal(state.prices.count, 1);
  assert.equal(state.prices.error, null);
  assert.deepEqual(state.warnings, []);

  // The flag it needs goes to the client; the feature itself is no flag and does not.
  const flags = parse(await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' })).flags;
  assert.deepEqual(flags.map((flag) => flag.name).sort(), ['cost-on', 'n', 'x']);
});

test('the price feature needs the flag of the other group', async (t) => {
  const ctx = await setupPrices(t);
  // The feature alone, without the flag: nothing happens yet.
  await ctx.post('/api/features', { changes: { costPrices: true } });
  await sleep(60);
  assert.equal(ctx.downloads.count, 0);
  assert.deepEqual(ctx.runner.vars, ours(ctx.ports));
  assert.equal((await ctx.script()).includes('__agyFlagsCost'), false);

  // The flag comes: now it works.
  await ctx.post('/api/flags', { changes: { 'cost-on': true } });
  await waitFor(() => ctx.downloads.count === 1);
  await waitFor(() => ctx.runner.vars.AGY_DEV_UI_URL);
  assert.ok((await ctx.script()).includes('__agyFlagsCost'));

  // The flag goes: the feature stops, and the flag of the other group is not touched by it.
  await ctx.post('/api/flags', { changes: { 'cost-on': null } });
  await waitFor(() => !ctx.runner.vars.AGY_DEV_UI_URL);
  assert.equal((await ctx.script()).includes('__agyFlagsCost'), false);
  assert.deepEqual(loadConfig().features, { ...NO_FEATURES, costPrices: true });

  // Turning the feature off leaves the flag as it is.
  await ctx.post('/api/flags', { changes: { 'cost-on': true } });
  await ctx.post('/api/features', { changes: { costPrices: false } });
  assert.equal(loadConfig().flags['cost-on'], true);
  assert.equal(ctx.runner.vars.AGY_DEV_UI_URL, undefined);
});

test('a flag that the server already turns on counts for the price feature', async (t) => {
  const ctx = await setupPrices(t, { upstreamFlags: [{ name: 'x', boolValue: false }, { name: 'cost-on', boolValue: true }] });
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  await ctx.post('/api/features', { changes: { costPrices: true } });
  await waitFor(() => ctx.downloads.count === 1);
  assert.equal(Object.hasOwn(loadConfig().flags, 'cost-on'), false);
});

test('bad feature changes are refused and change nothing', async (t) => {
  const ctx = await setupPrices(t);
  // The daemon knows the types of the server flags after one flag response: "n" is a number.
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  for (const body of [
    {},
    { changes: {} },
    { changes: [] },
    { changes: { unknown: true } },
    { changes: { costPrices: 'yes' } },
    { changes: { costPrices: true }, flags: { 'bad name': true } },
    { changes: { costPrices: true }, flags: { n: true } },
  ]) {
    assert.equal((await ctx.post('/api/features', body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(loadConfig().features, NO_FEATURES);
  assert.deepEqual(loadConfig().flags, { x: true });
  assert.equal(ctx.downloads.count, 0);
});

test('the models of the client are listed with or without a price', async (t) => {
  const ctx = await setupPrices(t);
  // While the feature is off, the model list is not read.
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}' });
  await ctx.post('/api/features', { changes: { costPrices: true }, flags: { 'cost-on': true } });
  await waitFor(async () => (await ctx.state()).prices.fetchedAt);
  assert.deepEqual((await ctx.state()).prices.models, []);

  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}' });
  const expected = [
    { name: 'Gemini 4 Neon', priced: true, input: 3, output: 15, cacheRead: 0.15, cacheFromInput: false },
    { name: 'Orchestrator (Neon)', priced: false },
  ];
  assert.deepEqual((await ctx.state()).prices.models, expected);

  // The names and the list survive a restart of the daemon, without a new download.
  await ctx.handle.stop();
  ctx.handles.length = 0;
  let again = 0;
  ctx.handle = await ctx.start({
    fetchPriceList: async () => {
      again += 1;
      return PRICE_LIST;
    },
  });
  // The token is the same after a restart, so the same headers still work.
  const state = await ctx.state();
  assert.deepEqual(state.prices.models, expected);
  assert.equal(state.prices.count, 1);
  assert.equal(state.prices.error, null);
  await sleep(60);
  assert.equal(again, 0);
});

test('a download that fails leaves the script without the costs, with a warning, and the button tries again', async (t) => {
  const ctx = await setupPrices(t);
  ctx.downloads.fail = true;
  await ctx.post('/api/features', { changes: { costPrices: true }, flags: { 'cost-on': true } });
  await waitFor(async () => (await ctx.state()).prices.error);
  assert.equal((await ctx.script()).includes('__agyFlagsCost'), false);
  let state = await ctx.state();
  assert.equal(state.prices.error, 'offline');
  assert.equal(state.prices.fetchedAt, null);
  assert.deepEqual(state.warnings, [{ code: 'page-not-changed', detail: 'there is no price list yet' }]);

  const failed = await ctx.post('/api/prices/refresh', {});
  assert.equal(failed.status, 502);
  assert.equal(parse(failed).detail, 'offline');

  ctx.downloads.fail = false;
  assert.equal((await ctx.post('/api/prices/refresh', {})).status, 200);
  assert.ok((await ctx.script()).includes('__agyFlagsCost'));
  state = await ctx.state();
  assert.equal(state.prices.error, null);
  assert.deepEqual(state.warnings, []);
});

test('the script waits a short time for the first download of the prices', async (t) => {
  let release;
  const ctx = await setup(t, { start: false, pageScript: costPage(), flags: { 'cost-on': true } });
  fs.writeFileSync(files.config(), JSON.stringify({ ...JSON.parse(fs.readFileSync(files.config(), 'utf8')), features: { costPrices: true } }));
  ctx.handle = await ctx.start({ fetchPriceList: () => new Promise((resolve) => (release = () => resolve(PRICE_LIST))), priceWaitMs: 2000 });
  await waitFor(() => release);
  const pending = request({ port: ctx.ports.devui, path: '/main.js' });
  await sleep(50);
  release();
  assert.ok((await pending).body.toString('utf8').includes('__agyFlagsCost'));
});

test('the indicator and the costs can be on together, and each has its own status', async (t) => {
  const ctx = await setupPrices(t, { flags: { 'ctx-on': true } });
  await ctx.post('/api/features', { changes: { costPrices: true }, flags: { 'cost-on': true } });
  await waitFor(async () => (await ctx.state()).prices.fetchedAt);
  const script = await ctx.script();
  assert.ok(script.includes('contextUsageIndicator:(()=>'));
  assert.ok(script.includes('__agyFlagsCost'));
  assert.deepEqual((await ctx.state()).page.script.parts, {
    contextUsageIndicator: { ok: true, reason: null },
    costPrices: { ok: true, reason: null },
  });
  // The costs go off: the third variable stays, because the indicator still needs it.
  await ctx.post('/api/features', { changes: { costPrices: false } });
  assert.equal(ctx.runner.vars.AGY_DEV_UI_URL, `http://127.0.0.1:${ctx.ports.devui}`);
  assert.equal((await ctx.script()).includes('__agyFlagsCost'), false);
});

// ---- Chinese interface and titles ---------------------------------------------------

/** A daemon with a running client that took its variables, and a way to change features. */
async function setupRunning(t, options = {}) {
  const client = fakeClient();
  const ctx = await setup(t, { client, flags: {}, ...options });
  Object.assign(client.current, { running: true, lsPid: 10, lsStartedAt: Date.now() - 60_000, env: ours(ctx.ports) });
  const headers = () => ({ 'x-agy-flags-token': ctx.handle.token, 'content-type': 'application/json' });
  ctx.post = (pathname, body) => request({ port: ctx.ports.ui, method: 'POST', path: pathname, headers: headers(), body: JSON.stringify(body) });
  ctx.state = () => ctx.handle.getState();
  ctx.script = async () => (await request({ port: ctx.ports.devui, path: '/main.js' })).body.toString('utf8');
  return ctx;
}

test('the Chinese interface changes the page script, and the client needs a restart for it', async (t) => {
  const ctx = await setupRunning(t);
  let state = await ctx.state();
  assert.deepEqual(state.l10n, { ready: true, words: 1 });
  assert.equal(state.pendingRestart, false);
  assert.equal((await ctx.script()).includes('__agyFlagsL10n'), false);

  assert.equal((await ctx.post('/api/features', { changes: { uiChinese: true } })).status, 200);
  assert.equal(ctx.runner.vars.AGY_DEV_UI_URL, `http://127.0.0.1:${ctx.ports.devui}`);
  const script = await ctx.script();
  assert.ok(script.includes('__agyFlagsL10n'));
  assert.ok(script.includes('新建对话'));
  state = await ctx.state();
  assert.deepEqual(state.features, { ...NO_FEATURES, uiChinese: true });
  assert.ok(state.changedAt > 0);
  assert.equal(state.pendingRestart, true);
  assert.deepEqual(state.page.script.parts, { l10n: { ok: true, reason: null } });
  assert.deepEqual(state.warnings, []);

  await ctx.post('/api/features', { changes: { uiChinese: false } });
  assert.equal(ctx.runner.vars.AGY_DEV_UI_URL, undefined);
  assert.equal((await ctx.script()).includes('__agyFlagsL10n'), false);
});

test('a word list that cannot be read leaves the page as it is, with a warning', async (t) => {
  const ctx = await setupRunning(t, { start: false });
  ctx.handle = await ctx.start({ l10nFile: `${ctx.home}/missing.json` });
  assert.ok(ctx.logs.some((line) => line.includes('word list')));
  assert.deepEqual((await ctx.state()).l10n, { ready: false, words: 0 });
  await ctx.post('/api/features', { changes: { uiChinese: true } });
  assert.equal((await ctx.script()).includes('__agyFlagsL10n'), false);
  assert.deepEqual((await ctx.state()).warnings, [{ code: 'page-not-changed', detail: 'the word list cannot be read' }]);
});

const TITLE_PATH = '/v1internal:streamGenerateContent?alt=sse';

test('Chinese titles work at once, without a restart, and the state counts them', async (t) => {
  const ctx = await setupRunning(t);
  const before = (await ctx.state()).changedAt;
  const send = (body) => request({ port: ctx.ports.cloudcode, method: 'POST', path: TITLE_PATH, body });
  const last = () => ctx.upstream.modelBodies.at(-1);

  // Off: the title request goes out as it is.
  await send(titleRequest());
  assert.equal(last().includes(TITLE_NEW), false);

  await ctx.post('/api/features', { changes: { chineseTitles: true } });
  let state = await ctx.state();
  assert.deepEqual(state.features, { ...NO_FEATURES, chineseTitles: true });
  // The feature changes requests, not the page: no restart, no third variable.
  assert.equal(state.changedAt, before);
  assert.equal(state.pendingRestart, false);
  assert.equal(ctx.runner.vars.AGY_DEV_UI_URL, undefined);

  await send(titleRequest());
  assert.ok(last().includes(TITLE_NEW));
  state = await ctx.state();
  assert.equal(state.titles.rewritten, 1);
  assert.ok(state.titles.rewrittenAt > 0);
  assert.deepEqual(state.warnings, []);

  // The client words its instruction differently: the title is in English, and the state says so.
  await sleep(5);
  await send(titleRequest({ prompt: 'You are a conversation title generator. Respond with a title.' }));
  state = await ctx.state();
  assert.equal(state.titles.changed, 1);
  assert.deepEqual(state.warnings, [{ code: 'titles-not-changed', detail: '' }]);
  assert.ok(ctx.logs.some((line) => line.startsWith('conversation title:')));

  // A later title that is changed again ends the warning.
  await sleep(5);
  await send(titleRequest());
  assert.deepEqual((await ctx.state()).warnings, []);

  // The command line is never changed.
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: TITLE_PATH, body: titleRequest(), as: 'cli' });
  assert.equal(last().includes(TITLE_NEW), false);

  // Off again: at once.
  await ctx.post('/api/features', { changes: { chineseTitles: false } });
  await send(titleRequest());
  assert.equal(last().includes(TITLE_NEW), false);
  assert.equal((await ctx.state()).titles.rewritten, 2);
});

test('Chinese titles turned on in the config file need no restart either', async (t) => {
  const ctx = await setupRunning(t);
  const before = (await ctx.state()).changedAt;
  fs.writeFileSync(files.config(), JSON.stringify({ ...JSON.parse(fs.readFileSync(files.config(), 'utf8')), features: { chineseTitles: true } }));
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(files.config(), future, future);
  const state = await waitFor(async () => {
    const s = await ctx.state();
    return s.features.chineseTitles ? s : null;
  });
  assert.equal(state.changedAt, before);
  assert.equal(state.pendingRestart, false);
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: TITLE_PATH, body: titleRequest() });
  assert.ok(ctx.upstream.modelBodies.at(-1).includes(TITLE_NEW));
});

test('Chinese titles are off while agy-flags is off', async (t) => {
  const ctx = await setupRunning(t);
  await ctx.post('/api/features', { changes: { chineseTitles: true } });
  await ctx.post('/api/enabled', { enabled: false });
  assert.equal((await ctx.state()).enabled, false);
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: TITLE_PATH, body: titleRequest() });
  assert.equal(ctx.upstream.modelBodies.at(-1).includes(TITLE_NEW), false);
});
