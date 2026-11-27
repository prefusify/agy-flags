import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { API_PREFIX } from '../src/api.mjs';
import { files, loadConfig } from '../src/config.mjs';
import { computePending, ping, startDaemon } from '../src/daemon.mjs';
import { TITLE_NEW } from '../src/forward.mjs';
import { BUILTIN_GUIDELINES_TEMPLATE } from '../src/patch.mjs';
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
  const before = process.env.AGY_PLUS_HOME;
  process.env.AGY_PLUS_HOME = home;
  const upstream = fakeUpstream(upstreamFlags);
  const upstreamPort = await listen(upstream);
  const [cloudcode, aicode, devui] = await freePorts(3);
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
    JSON.stringify({ enabled, flags, ports: { cloudcode, aicode, devui }, upstreams: { cloudcode: origin, aicode: origin }, appPath })
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
  const builtinDir = `${home}/builtin`;
  const ctx = { home, builtinDir, runner, client, logs, upstream, ports: { cloudcode, aicode, devui }, handles: [] };
  ctx.start = async (extra = {}) => {
    // Every caller counts as a program of the user here. peer.test.mjs tests the real lookup.
    const handle = await startDaemon({
      runner,
      client,
      log: (m) => logs.push(m),
      pollMs: 20,
      catalogFile,
      l10nFile,
      builtinDir,
      peerCheck: async () => true,
      ...extra,
    });
    if (handle.status === 'running') ctx.handles.push(handle);
    return handle;
  };
  // The requests of the settings page, sent the way the command line sends them.
  ctx.get = (name) => request({ port: devui, path: `${API_PREFIX}${name}.json` });
  ctx.post = (name, body) =>
    request({ port: devui, method: 'POST', path: `${API_PREFIX}${name}.json`, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  ctx.script = async () => (await request({ port: devui, path: '/main.js' })).body.toString('utf8');
  t.after(async () => {
    for (const handle of ctx.handles) await handle.stop();
    await close(upstream);
    if (before === undefined) delete process.env.AGY_PLUS_HOME;
    else process.env.AGY_PLUS_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  });
  if (start) ctx.handle = await ctx.start();
  return ctx;
}

/** The two variables of the forwarders, the variable of the page files, and all three. */
const ours = (ports) => ({
  CLOUD_CODE_URL: `http://127.0.0.1:${ports.cloudcode}`,
  AICODE_ENDPOINT_URL: `http://127.0.0.1:${ports.aicode}`,
});
const pageVar = (ports) => ({ AGY_DEV_UI_URL: `http://127.0.0.1:${ports.devui}` });
const all = (ports) => ({ ...ours(ports), ...pageVar(ports) });

/** The mark of the settings page in a page script. */
const SETTINGS_MARK = '{screen:"AGY Plus"}';
const PART_OK = { ok: true, reason: null };

const parse = (res) => JSON.parse(res.body.toString('utf8'));

const NO_FEATURES = { costPrices: false, uiChinese: false, chineseTitles: false, guidelinesOverride: false };

test('the variables are set only after every listener is up', async (t) => {
  const runner = fakeRunner();
  const set = runner.set;
  const listeningWhenSet = [];
  runner.set = async (name, value) => {
    listeningWhenSet.push(Boolean(await ping(Number(new URL(value).port))));
    await set(name, value);
  };
  const ctx = await setup(t, { runner });
  assert.equal(ctx.handle.status, 'running');
  assert.deepEqual(listeningWhenSet, [true, true, true]);
  assert.deepEqual(runner.vars, all(ctx.ports));
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

test('the settings page changes overrides, and a value of the wrong type is refused', async (t) => {
  const ctx = await setup(t, { flags: {} });
  // Let the daemon see the server list first.
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });

  const ok = await ctx.post('flags', { changes: { x: true, 'custom-flag': false } });
  assert.equal(ok.status, 200);
  assert.deepEqual(loadConfig().flags, { x: true, 'custom-flag': false });
  assert.ok(loadConfig().flagsChangedAt > 0);

  const refused = await ctx.post('flags', { changes: { n: true } });
  assert.equal(refused.status, 400);
  assert.equal(parse(refused).error, 'server-type');
  assert.equal(parse(await ctx.post('flags', { changes: { x: 'yes' } })).error, 'bad-value');
  assert.equal(parse(await ctx.post('flags', { changes: { n: 1.5 } })).error, 'bad-value');
  assert.equal(parse(await ctx.post('flags', { changes: { x: 3 } })).error, 'server-type');
  assert.equal(parse(await ctx.post('flags', { changes: { 'bad name': true } })).error, 'bad-name');
  assert.equal(parse(await ctx.post('flags', {})).error, 'bad-request');
  assert.deepEqual(loadConfig().flags, { x: true, 'custom-flag': false });

  const removed = await ctx.post('flags', { changes: { 'custom-flag': null } });
  assert.equal(removed.status, 200);
  assert.deepEqual(loadConfig().flags, { x: true });

  const list = parse(await ctx.get('server-flags'));
  assert.deepEqual(list.flags.n, { type: 'intValue', value: '3', sources: ['cloudcode'] });

  // An integer flag takes an integer, whether the server sends the flag or not.
  const ints = await ctx.post('flags', { changes: { n: 7, new_count: 2 } });
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

test('turning rewriting off clears the forwarder variables, and keeps the page variable and the forwarding', async (t) => {
  const ctx = await setup(t);
  const off = await ctx.post('enabled', { enabled: false });
  assert.equal(off.status, 200);
  // The settings page is where rewriting is turned on again, so the client must still get it.
  assert.deepEqual(ctx.runner.vars, pageVar(ctx.ports));
  assert.ok((await ctx.script()).includes(SETTINGS_MARK));
  assert.equal(parse(await ctx.get('state')).enabled, false);
  const res = await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  assert.deepEqual(parse(res).flags[0], { name: 'x', boolValue: false });

  await ctx.post('enabled', { enabled: true });
  assert.deepEqual(ctx.runner.vars, all(ctx.ports));
  assert.equal(parse(await ctx.post('enabled', { enabled: 'yes' })).error, 'bad-request');
});

test('rewriting that is off at the start sets the page variable only', async (t) => {
  const ctx = await setup(t, { enabled: false });
  assert.deepEqual(ctx.runner.vars, pageVar(ctx.ports));
  const state = await ctx.handle.getState();
  assert.equal(state.env.status, 'set');
  assert.equal(state.page.wanted, true);
  assert.deepEqual(state.warnings, []);
});

test('a second daemon sees the first one and leaves everything alone', async (t) => {
  const ctx = await setup(t);
  const callsBefore = ctx.runner.calls.length;
  const second = await ctx.start();
  assert.equal(second.status, 'already-running');
  assert.equal(ctx.runner.calls.length, callsBefore);
  assert.deepEqual(ctx.runner.vars, all(ctx.ports));
  assert.ok(await ping(ctx.ports.cloudcode));
});

test('stopping clears the variables and frees the ports', async (t) => {
  const ctx = await setup(t);
  await ctx.handle.stop();
  assert.deepEqual(ctx.runner.vars, {});
  assert.equal(await ping(ctx.ports.cloudcode), null);
  assert.equal(await ping(ctx.ports.devui), null);
});

test('a forwarder variable set by another program is not overwritten, and the settings page is still there to say so', async (t) => {
  const runner = fakeRunner({ CLOUD_CODE_URL: 'http://127.0.0.1:8888' });
  const ctx = await setup(t, { runner });
  // Neither forwarder variable is set: one without the other would split the traffic.
  assert.deepEqual(runner.vars, { CLOUD_CODE_URL: 'http://127.0.0.1:8888', ...pageVar(ctx.ports) });
  const state = await ctx.handle.getState();
  assert.equal(state.env.status, 'conflict');
  assert.deepEqual(state.warnings, [{ code: 'env-conflict', detail: 'CLOUD_CODE_URL' }]);
  assert.equal(state.page.wanted, true);
  await ctx.handle.stop();
  assert.deepEqual(runner.vars, { CLOUD_CODE_URL: 'http://127.0.0.1:8888' });
});

test('a page variable set by another program is not overwritten, and rewriting still works', async (t) => {
  const client = fakeClient();
  const runner = fakeRunner({ AGY_DEV_UI_URL: 'http://127.0.0.1:5173' });
  const ctx = await setup(t, { runner, client });
  assert.deepEqual(runner.vars, { ...ours(ctx.ports), AGY_DEV_UI_URL: 'http://127.0.0.1:5173' });
  // A client that started with these variables is as it should be: a restart would change nothing.
  Object.assign(client.current, { running: true, lsPid: 10, lsStartedAt: Date.now() + 60_000, env: { ...runner.vars } });
  const state = await ctx.handle.getState();
  assert.equal(state.env.status, 'conflict');
  assert.deepEqual(state.warnings, [{ code: 'env-conflict', detail: 'AGY_DEV_UI_URL' }]);
  assert.equal(state.page.wanted, false);
  assert.equal(state.pendingRestart, false);
  assert.equal(state.client.routed, true);
  await ctx.handle.stop();
  assert.deepEqual(runner.vars, { AGY_DEV_UI_URL: 'http://127.0.0.1:5173' });
});

test('a port taken by another program stops the start and removes stale variables', async (t) => {
  const ctx = await setup(t, { start: false });
  Object.assign(ctx.runner.vars, all(ctx.ports));
  const squatter = http.createServer((req, res) => res.end('not agy-plus'));
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
  Object.assign(client.current, { running: true, lsPid: 10, lsStartedAt: Date.now() - 60_000, env: all(ctx.ports) });
  let state = await ctx.handle.getState();
  assert.equal(state.pendingRestart, false);
  assert.equal(state.client.routed, true);
  assert.equal(state.page.carried, true);

  await ctx.post('flags', { changes: { x: true } });
  state = await ctx.handle.getState();
  assert.equal(state.pendingRestart, true);
  assert.equal(state.pendingReason, 'flags-changed');

  const restart = await ctx.post('restart-client', {});
  assert.equal(restart.status, 200);
  assert.equal(client.restarts, 1);
});

test('a client that started without the page variable needs a restart to get the settings page', async (t) => {
  const client = fakeClient();
  const ctx = await setup(t, { client, flags: {} });
  // It started before the page files could be served: it has the forwarders only.
  Object.assign(client.current, { running: true, lsPid: 10, lsStartedAt: Date.now() + 60_000, env: ours(ctx.ports) });
  let state = await ctx.handle.getState();
  assert.equal(state.pendingReason, 'not-routed');
  assert.equal(state.client.routed, true);
  assert.equal(state.page.carried, false);

  client.current.env = all(ctx.ports);
  state = await waitFor(async () => {
    const s = await ctx.handle.getState();
    return s.pendingRestart ? null : s;
  });
  assert.equal(state.page.carried, true);
});

test('with rewriting off, a client needs the page variable and nothing else', async (t) => {
  const client = fakeClient();
  const ctx = await setup(t, { client, flags: {} });
  Object.assign(client.current, { running: true, lsPid: 10, lsStartedAt: Date.now() - 60_000, env: all(ctx.ports) });
  await ctx.post('enabled', { enabled: false });
  // It still sends its requests through us.
  await waitFor(async () => (await ctx.handle.getState()).pendingReason === 'still-routed');
  // After its restart it has the page variable only, and that is how it should be.
  Object.assign(client.current, { lsPid: 11, lsStartedAt: Date.now(), env: pageVar(ctx.ports) });
  const state = await waitFor(async () => {
    const s = await ctx.handle.getState();
    return s.pendingRestart ? null : s;
  });
  assert.equal(state.client.routed, false);
  assert.equal(state.page.carried, true);
  // Turned on again: now the forwarders are missing.
  await ctx.post('enabled', { enabled: true });
  await waitFor(async () => (await ctx.handle.getState()).pendingReason === 'not-routed');
});

test('computePending', () => {
  const base = { CLOUD_CODE_URL: 'http://127.0.0.1:1', AICODE_ENDPOINT_URL: 'http://127.0.0.1:2' };
  const page = { AGY_DEV_UI_URL: 'http://127.0.0.1:3' };
  const both = { ...base, ...page };
  const client = (env, lsStartedAt = 1000) => ({ running: true, lsPid: 1, lsStartedAt, env });
  const stopped = { running: false, lsPid: null, lsStartedAt: null, env: {} };
  const pending = (args) => computePending({ base, page, wantPage: true, changedAt: 0, ...args });
  const reason = (args) => pending(args).reason;

  // No client, or no language server yet: nothing to restart.
  assert.deepEqual(pending({ enabled: true, client: stopped, changedAt: 5000 }), { pending: false, reason: null, routed: null, carries: null });
  assert.equal(pending({ enabled: true, client: { ...client(both), lsPid: null } }).pending, false);

  // Rewriting on: the client needs all three variables.
  assert.deepEqual(pending({ enabled: true, client: client({}) }), { pending: true, reason: 'not-routed', routed: false, carries: false });
  assert.deepEqual(pending({ enabled: true, client: client(both), changedAt: 500 }), { pending: false, reason: null, routed: true, carries: true });
  // One forwarder variable alone is not enough.
  assert.equal(reason({ enabled: true, client: client({ ...page, CLOUD_CODE_URL: base.CLOUD_CODE_URL }) }), 'not-routed');
  // A variable with another value does not count.
  assert.equal(reason({ enabled: true, client: client({ ...both, CLOUD_CODE_URL: 'http://127.0.0.1:8888' }) }), 'not-routed');
  // Without the page variable the settings page is missing.
  assert.deepEqual(pending({ enabled: true, client: client(base) }), { pending: true, reason: 'not-routed', routed: true, carries: true });
  // A change that was made after the client started.
  assert.equal(reason({ enabled: true, client: client(both), changedAt: 2000 }), 'flags-changed');
  assert.equal(reason({ enabled: true, client: client(both, null), changedAt: 2000 }), null);

  // Rewriting off: the page variable alone is right.
  assert.deepEqual(pending({ enabled: false, client: client(page), changedAt: 9999 }), { pending: false, reason: null, routed: false, carries: true });
  assert.equal(reason({ enabled: false, client: client(both) }), 'still-routed');
  assert.equal(reason({ enabled: false, client: client({ ...page, CLOUD_CODE_URL: base.CLOUD_CODE_URL }) }), 'still-routed');
  assert.equal(reason({ enabled: false, client: client({}) }), 'not-routed');

  // The page files cannot be served: the client should not carry the page variable.
  assert.equal(reason({ enabled: true, client: client(both), wantPage: false }), 'page-off');
  assert.equal(reason({ enabled: true, client: client(base), wantPage: false }), null);
  assert.equal(reason({ enabled: false, client: client(page), wantPage: false }), 'page-off');
  assert.deepEqual(pending({ enabled: false, client: client({}), wantPage: false, changedAt: 9999 }), { pending: false, reason: null, routed: false, carries: false });

  // Without `page` and `wantPage`, only the forwarders count.
  assert.deepEqual(computePending({ enabled: true, client: client(base), base, changedAt: 0 }), { pending: false, reason: null, routed: true, carries: true });
});

test('the page script gets the settings page, and a page feature adds its component', async (t) => {
  const ctx = await setup(t, { flags: { 'ctx-on': true } });
  assert.deepEqual(ctx.runner.vars, all(ctx.ports));

  const script = await request({ port: ctx.ports.devui, path: '/main.js' });
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /javascript/);
  const text = script.body.toString('utf8');
  assert.ok(text.includes(SETTINGS_MARK));
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
  assert.deepEqual(state.page.script.parts, { settingsPage: PART_OK, contextUsageIndicator: PART_OK });
  assert.deepEqual(state.warnings, []);

  await ctx.handle.stop();
  assert.deepEqual(ctx.runner.vars, {});
});

test('without a page feature the script gets the settings page and nothing else', async (t) => {
  const ctx = await setup(t, { flags: { x: true } });
  assert.deepEqual(ctx.runner.vars, all(ctx.ports));
  const script = await ctx.script();
  assert.ok(script.includes(SETTINGS_MARK));
  assert.ok(script.includes(`"api":"${API_PREFIX}"`));
  assert.ok(script.includes('contextUsageIndicator:void 0,'));
  const state = await ctx.handle.getState();
  assert.equal(state.page.wanted, true);
  assert.deepEqual(state.page.script.parts, { settingsPage: PART_OK });
});

test('turning a page feature on and off changes the script, not the variables', async (t) => {
  const client = fakeClient();
  const ctx = await setup(t, { flags: {}, client });
  Object.assign(client.current, { running: true, lsPid: 7, lsStartedAt: Date.now() - 60_000, env: all(ctx.ports) });
  assert.equal((await ctx.handle.getState()).pendingRestart, false);

  await ctx.post('flags', { changes: { 'ctx-on': true } });
  assert.deepEqual(ctx.runner.vars, all(ctx.ports));
  assert.ok((await ctx.script()).includes('contextUsageIndicator:(()=>'));
  // The client loaded its page before the change.
  await waitFor(async () => (await ctx.handle.getState()).pendingReason === 'flags-changed');

  await ctx.post('flags', { changes: { 'ctx-on': null } });
  assert.deepEqual(ctx.runner.vars, all(ctx.ports));
  const script = await ctx.script();
  assert.ok(script.includes('contextUsageIndicator:void 0,'));
  assert.ok(script.includes(SETTINGS_MARK));
});

test('when the page files cannot be found, the page variable is not set', async (t) => {
  const client = fakeClient();
  const ctx = await setup(t, { flags: { 'ctx-on': true }, app: false, client });
  assert.deepEqual(ctx.runner.vars, ours(ctx.ports));
  let state = await ctx.handle.getState();
  assert.equal(state.page.wanted, false);
  assert.deepEqual(state.warnings.map((w) => w.code), ['page-unavailable']);
  assert.equal((await request({ port: ctx.ports.devui, path: '/main.js' })).status, 500);
  // The requests of the settings page are still answered: the command line asks them too.
  assert.equal((await ctx.get('state')).status, 200);
  // A client that still takes its page files from us cannot load them any more.
  Object.assign(client.current, { running: true, lsPid: 7, lsStartedAt: Date.now() + 60_000, env: all(ctx.ports) });
  state = await waitFor(async () => {
    const s = await ctx.handle.getState();
    return s.pendingRestart ? s : null;
  });
  assert.equal(state.pendingReason, 'page-off');
});

test('with rewriting off and no page files, no variable is set', async (t) => {
  const ctx = await setup(t, { enabled: false, app: false });
  assert.deepEqual(ctx.runner.vars, {});
  assert.equal((await ctx.handle.getState()).env.status, 'cleared');
  assert.ok(ctx.logs.some((line) => line.startsWith('environment variables: cleared')));
});

test('a page feature that cannot be added leaves its place as it is, with a warning', async (t) => {
  const ctx = await setup(t, { flags: { 'ctx-on': true }, pageScript: fakePageScript({ anchor: '' }) });
  const script = await ctx.script();
  // The settings page does not depend on it.
  assert.ok(script.includes(SETTINGS_MARK));
  assert.equal(script.includes('contextUsageIndicator:(()=>'), false);
  const state = await ctx.handle.getState();
  assert.equal(state.page.script.patched, false);
  assert.deepEqual(state.warnings.map((w) => w.code), ['page-not-changed']);
  assert.match(state.warnings[0].detail, /place for the indicator was not found/);
});

test('a client whose settings are built differently gets its own script, and the state says why', async (t) => {
  const original = fakePageScript({ settings: false });
  const ctx = await setup(t, { flags: {}, pageScript: original });
  assert.equal(await ctx.script(), original);
  // The page files are still served, so the variable stays.
  assert.deepEqual(ctx.runner.vars, all(ctx.ports));
  const state = await ctx.handle.getState();
  assert.deepEqual(state.page.script.parts, { settingsPage: { ok: false, reason: 'the list of setting pages was found 0 times, not once' } });
  assert.deepEqual(state.warnings, [{ code: 'page-not-changed', detail: 'the list of setting pages was found 0 times, not once' }]);
  // The features can still be chosen without the page.
  assert.equal((await ctx.post('flags', { changes: { x: true } })).status, 200);
  assert.deepEqual(loadConfig().flags, { x: true });
});

test('the requests of the settings page are answered for the programs of the user only', async (t) => {
  const ctx = await setup(t, { start: false });
  const asked = [];
  ctx.handle = await ctx.start({
    peerCheck: async (socket) => {
      asked.push(socket.localPort);
      return false;
    },
  });
  const read = await ctx.get('state');
  assert.equal(read.status, 403);
  assert.deepEqual(parse(read), { error: 'caller not recognized' });
  assert.equal((await ctx.post('enabled', { enabled: false })).status, 403);
  assert.equal(loadConfig().enabled, true);
  assert.deepEqual(asked, [ctx.ports.devui, ctx.ports.devui]);
  // The page files hold nothing of the user, and the language server asks for them: no check.
  assert.equal((await request({ port: ctx.ports.devui, path: '/main.js' })).status, 200);
  assert.ok(await ping(ctx.ports.devui));
  assert.equal(asked.length, 2);
  // The forwarders do not answer these requests at all.
  const other = await request({ port: ctx.ports.cloudcode, path: `${API_PREFIX}state.json` });
  assert.deepEqual(parse(other), { other: true });
});

test('the file with the secret of the old web page is removed at the start', async (t) => {
  const ctx = await setup(t, { start: false });
  fs.writeFileSync(`${ctx.home}/token`, 'a'.repeat(64));
  ctx.handle = await ctx.start();
  assert.equal(fs.existsSync(`${ctx.home}/token`), false);
  assert.equal(Object.hasOwn(ctx.handle, 'token'), false);
  assert.equal(Object.hasOwn(loadConfig().ports, 'ui'), false);
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
  Object.assign(client.current, { running: true, lsPid: 42, lsStartedAt: Date.now(), env: all(ctx.ports) });
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
  Object.assign(client.current, { running: true, lsPid: 42, lsStartedAt: Date.now() - 1000, env: all(ctx.ports) });
  await list('desktop');
  await list('antigravity/ide/1.20.0 (aidev_client)');
  await waitFor(async () => (await ctx.handle.getState()).client.routed === true);
  assert.deepEqual(await codes(), []);
  assert.equal((await ctx.handle.getState()).traffic.byClient.other, 1);
});

test('the page gets what the servers send for each flag', async (t) => {
  const ctx = await setup(t);
  const list = async () => parse(await ctx.get('server-flags'));
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
  // The page reads the same number in the state, to know when to ask again.
  assert.equal(parse(await ctx.get('state')).server.version, after.version);
  // The catalog of the daemon is the one the page shows.
  assert.deepEqual(parse(await ctx.get('catalog')).groups.map((group) => group.id), ['plain', 'ctx', 'prices', 'zh', 'titles']);
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
  ctx.state = async () => parse(await ctx.get('state'));
  return ctx;
}

test('the price feature is off at first: no download, and the costs are left alone', async (t) => {
  const ctx = await setupPrices(t);
  await sleep(60);
  assert.equal(ctx.downloads.count, 0);
  assert.equal((await ctx.script()).includes('__agyPlusCost'), false);
  const state = await ctx.state();
  assert.deepEqual(state.features, NO_FEATURES);
  assert.equal(state.prices.fetchedAt, null);
  assert.equal(fs.existsSync(files.prices()), false);
  // Nobody can download the list from the page while the feature is off.
  const res = await ctx.post('prices-refresh', {});
  assert.equal(res.status, 400);
  assert.equal(parse(res).error, 'feature-off');
  assert.equal(ctx.downloads.count, 0);
});

test('turning the price feature on downloads the list and fills in the costs', async (t) => {
  const ctx = await setupPrices(t);
  const res = await ctx.post('features', { changes: { costPrices: true }, flags: { 'cost-on': true } });
  assert.equal(res.status, 200);
  await waitFor(async () => (await ctx.state()).prices.fetchedAt);
  assert.equal(ctx.downloads.count, 1);

  // The feature is in the config file, apart from the flags; the flag it needs is a flag.
  const saved = loadConfig();
  assert.deepEqual(saved.features, { ...NO_FEATURES, costPrices: true });
  assert.equal(saved.flags['cost-on'], true);
  assert.equal(Object.keys(saved.flags).includes('costPrices'), false);

  const script = await ctx.script();
  assert.ok(script.includes('__agyPlusCost'));
  assert.ok(script.includes('{"gemini-4-neon":[3,15,0.15]}'));
  // The indicator is another feature, and it is off.
  assert.ok(script.includes('contextUsageIndicator:void 0,'));
  const state = await ctx.state();
  assert.deepEqual(state.page.script.parts, { settingsPage: PART_OK, costPrices: PART_OK });
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
  await ctx.post('features', { changes: { costPrices: true } });
  await sleep(60);
  assert.equal(ctx.downloads.count, 0);
  assert.equal((await ctx.script()).includes('__agyPlusCost'), false);

  // The flag comes: now it works.
  await ctx.post('flags', { changes: { 'cost-on': true } });
  await waitFor(() => ctx.downloads.count === 1);
  await waitFor(async () => (await ctx.state()).prices.fetchedAt);
  assert.ok((await ctx.script()).includes('__agyPlusCost'));

  // The flag goes: the feature stops, and the flag of the other group is not touched by it.
  await ctx.post('flags', { changes: { 'cost-on': null } });
  assert.equal((await ctx.script()).includes('__agyPlusCost'), false);
  assert.deepEqual(loadConfig().features, { ...NO_FEATURES, costPrices: true });

  // Turning the feature off leaves the flag as it is.
  await ctx.post('flags', { changes: { 'cost-on': true } });
  await ctx.post('features', { changes: { costPrices: false } });
  assert.equal(loadConfig().flags['cost-on'], true);
  assert.equal((await ctx.script()).includes('__agyPlusCost'), false);
  // None of this touches the variables.
  assert.deepEqual(ctx.runner.vars, all(ctx.ports));
});

test('a flag that the server already turns on counts for the price feature', async (t) => {
  const ctx = await setupPrices(t, { upstreamFlags: [{ name: 'x', boolValue: false }, { name: 'cost-on', boolValue: true }] });
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:listExperiments', body: '{}' });
  await ctx.post('features', { changes: { costPrices: true } });
  await waitFor(() => ctx.downloads.count === 1);
  assert.equal(Object.hasOwn(loadConfig().flags, 'cost-on'), false);
});

test('the page language is kept in the config and needs no restart', async (t) => {
  const ctx = await setupRunning(t);
  let state = await ctx.state();
  assert.equal(state.pageLanguage, 'auto');
  const changedAt = state.changedAt;
  assert.equal((await ctx.post('page-language', { language: 'en' })).status, 200);
  state = await ctx.state();
  assert.equal(state.pageLanguage, 'en');
  assert.equal(state.changedAt, changedAt);
  assert.equal(state.pendingRestart, false);
  assert.equal(loadConfig().pageLanguage, 'en');
  for (const body of [{}, { language: 'fr' }, { language: true }, { language: null }]) {
    assert.equal((await ctx.post('page-language', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await ctx.state()).pageLanguage, 'en');
  assert.equal((await ctx.post('page-language', { language: 'auto' })).status, 200);
  assert.equal((await ctx.state()).pageLanguage, 'auto');
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
    assert.equal((await ctx.post('features', body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(loadConfig().features, NO_FEATURES);
  assert.deepEqual(loadConfig().flags, { x: true });
  assert.equal(ctx.downloads.count, 0);
});

test('the models of the client are listed with or without a price', async (t) => {
  const ctx = await setupPrices(t);
  // While the feature is off, the model list is not read.
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}' });
  await ctx.post('features', { changes: { costPrices: true }, flags: { 'cost-on': true } });
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
  await ctx.post('features', { changes: { costPrices: true }, flags: { 'cost-on': true } });
  await waitFor(async () => (await ctx.state()).prices.error);
  assert.equal((await ctx.script()).includes('__agyPlusCost'), false);
  let state = await ctx.state();
  assert.equal(state.prices.error, 'offline');
  assert.equal(state.prices.fetchedAt, null);
  assert.deepEqual(state.warnings, [{ code: 'page-not-changed', detail: 'there is no price list yet' }]);

  const failed = await ctx.post('prices-refresh', {});
  assert.equal(failed.status, 502);
  assert.equal(parse(failed).detail, 'offline');

  ctx.downloads.fail = false;
  assert.equal((await ctx.post('prices-refresh', {})).status, 200);
  assert.ok((await ctx.script()).includes('__agyPlusCost'));
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
  assert.ok((await pending).body.toString('utf8').includes('__agyPlusCost'));
});

test('the indicator and the costs can be on together, and each has its own status', async (t) => {
  const ctx = await setupPrices(t, { flags: { 'ctx-on': true } });
  await ctx.post('features', { changes: { costPrices: true }, flags: { 'cost-on': true } });
  await waitFor(async () => (await ctx.state()).prices.fetchedAt);
  const script = await ctx.script();
  assert.ok(script.includes('contextUsageIndicator:(()=>'));
  assert.ok(script.includes('__agyPlusCost'));
  assert.deepEqual((await ctx.state()).page.script.parts, { settingsPage: PART_OK, contextUsageIndicator: PART_OK, costPrices: PART_OK });
  // The costs go off: the indicator stays.
  await ctx.post('features', { changes: { costPrices: false } });
  const without = await ctx.script();
  assert.equal(without.includes('__agyPlusCost'), false);
  assert.ok(without.includes('contextUsageIndicator:(()=>'));
});

// ---- Chinese interface and titles ---------------------------------------------------

/** A daemon with a running client that took its variables, and a way to change features. */
async function setupRunning(t, options = {}) {
  const client = fakeClient();
  const ctx = await setup(t, { client, flags: {}, ...options });
  Object.assign(client.current, { running: true, lsPid: 10, lsStartedAt: Date.now() - 60_000, env: all(ctx.ports) });
  ctx.state = () => ctx.handle.getState();
  return ctx;
}

test('the Chinese interface changes the page script, and the client needs a restart for it', async (t) => {
  const ctx = await setupRunning(t);
  let state = await ctx.state();
  assert.deepEqual(state.l10n, { ready: true, words: 1 });
  assert.equal(state.pendingRestart, false);
  assert.equal((await ctx.script()).includes('__agyPlusL10n'), false);

  assert.equal((await ctx.post('features', { changes: { uiChinese: true } })).status, 200);
  const script = await ctx.script();
  assert.ok(script.includes('__agyPlusL10n'));
  assert.ok(script.includes('新建对话'));
  state = await ctx.state();
  assert.deepEqual(state.features, { ...NO_FEATURES, uiChinese: true });
  assert.ok(state.changedAt > 0);
  assert.equal(state.pendingRestart, true);
  assert.equal(state.pendingReason, 'flags-changed');
  assert.deepEqual(state.page.script.parts, { settingsPage: PART_OK, l10n: PART_OK });
  assert.deepEqual(state.warnings, []);

  await ctx.post('features', { changes: { uiChinese: false } });
  const without = await ctx.script();
  assert.equal(without.includes('__agyPlusL10n'), false);
  assert.ok(without.includes(SETTINGS_MARK));
});

test('a word list that cannot be read leaves the page as it is, with a warning', async (t) => {
  const ctx = await setupRunning(t, { start: false });
  ctx.handle = await ctx.start({ l10nFile: `${ctx.home}/missing.json` });
  assert.ok(ctx.logs.some((line) => line.includes('word list')));
  assert.deepEqual((await ctx.state()).l10n, { ready: false, words: 0 });
  await ctx.post('features', { changes: { uiChinese: true } });
  assert.equal((await ctx.script()).includes('__agyPlusL10n'), false);
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

  await ctx.post('features', { changes: { chineseTitles: true } });
  let state = await ctx.state();
  assert.deepEqual(state.features, { ...NO_FEATURES, chineseTitles: true });
  // The feature changes requests, not the page: no restart.
  assert.equal(state.changedAt, before);
  assert.equal(state.pendingRestart, false);

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
  await ctx.post('features', { changes: { chineseTitles: false } });
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

test('Chinese titles are off while agy-plus is off', async (t) => {
  const ctx = await setupRunning(t);
  await ctx.post('features', { changes: { chineseTitles: true } });
  await ctx.post('enabled', { enabled: false });
  assert.equal((await ctx.state()).enabled, false);
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: TITLE_PATH, body: titleRequest() });
  assert.equal(ctx.upstream.modelBodies.at(-1).includes(TITLE_NEW), false);
});

// ---- template overrides & builtin skills --------------------------------------------

test('guidelinesOverride rewrites fetchAvailableModels, needs a restart, and warns on marker drift', async (t) => {
  const key = 'template__system_prompts__guidelines';
  const goodText = `${BUILTIN_GUIDELINES_TEMPLATE.match.start}\n- rule\n${BUILTIN_GUIDELINES_TEMPLATE.match.end} true }}\n<code_quality/>`;
  let modelPayload = {
    models: {
      m1: { displayName: 'One', modelExperiments: { experiments: { [key]: { stringValue: goodText } } } },
      m2: { displayName: 'Two', modelExperiments: { experiments: {} } },
    },
  };
  const customUpstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.includes(':fetchAvailableModels')) res.end(JSON.stringify(modelPayload));
      else res.end(JSON.stringify({ flags: [] }));
    });
  });
  const upPort = await listen(customUpstream);
  t.after(() => close(customUpstream));

  const ctx = await setupRunning(t, { start: false });
  const cfg = JSON.parse(fs.readFileSync(files.config(), 'utf8'));
  fs.writeFileSync(files.config(), JSON.stringify({ ...cfg, upstreams: { cloudcode: `http://127.0.0.1:${upPort}`, aicode: `http://127.0.0.1:${upPort}` } }));
  ctx.handle = await ctx.start();

  // Turn guidelinesOverride on: needs a client restart.
  assert.equal((await ctx.post('features', { changes: { guidelinesOverride: true } })).status, 200);
  let state = await ctx.state();
  assert.equal(state.features.guidelinesOverride, true);
  assert.equal(state.pendingRestart, true);
  assert.equal(state.pendingReason, 'flags-changed');

  const res = parse(await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}' }));
  assert.equal(
    res.models.m1.modelExperiments.experiments[key].stringValue,
    `${BUILTIN_GUIDELINES_TEMPLATE.replace_with}${BUILTIN_GUIDELINES_TEMPLATE.match.end} true }}\n<code_quality/>`
  );
  assert.equal(res.models.m2.modelExperiments.experiments[key].stringValue, BUILTIN_GUIDELINES_TEMPLATE.replace_with);
  state = await ctx.state();
  assert.deepEqual(
    { profiles: state.templates.profiles, changed: state.templates.changed, inserted: state.templates.inserted, missing: state.templates.missing },
    { profiles: 2, changed: 1, inserted: 1, missing: 0 }
  );
  assert.deepEqual(state.warnings, []);

  // Upstream wording drift raises templates-markers-missing.
  modelPayload = { models: { m1: { modelExperiments: { experiments: { [key]: { stringValue: 'drifted wording' } } } } } };
  await request({ port: ctx.ports.cloudcode, method: 'POST', path: '/v1internal:fetchAvailableModels', body: '{}' });
  state = await ctx.state();
  assert.equal(state.templates.missing, 1);
  assert.deepEqual(state.warnings, [{ code: 'templates-markers-missing', detail: '1' }]);
});

test('builtin skills can be toggled via the API and are restored when agy-plus is turned off', async (t) => {
  const ctx = await setupRunning(t);
  const skillsDir = `${ctx.builtinDir}/skills`;
  fs.mkdirSync(`${skillsDir}/antigravity_guide`, { recursive: true });
  fs.writeFileSync(`${skillsDir}/antigravity_guide/SKILL.md`, '---\nname: antigravity_guide\ndescription: Guide\n---\n');
  fs.writeFileSync(`${ctx.builtinDir}/.checksum`, 'sum1\n');

  let state = await ctx.state();
  assert.equal(state.skills.items.length, 1);
  assert.equal(state.skills.items[0].enabled, true);

  // Disable antigravity_guide via POST /__agy_plus/skills.json.
  assert.equal((await ctx.post('skills', { changes: { antigravity_guide: false } })).status, 200);
  assert.equal(fs.existsSync(`${skillsDir}/antigravity_guide`), false);
  assert.equal(fs.existsSync(`${files.skillsBackup()}/antigravity_guide/SKILL.md`), true);
  state = await ctx.state();
  assert.deepEqual(state.skills.disabled, ['antigravity_guide']);
  assert.equal(state.skills.items[0].enabled, false);

  // Reject invalid skill requests.
  for (const bad of [{}, { changes: {} }, { changes: { '../x': false } }, { changes: { antigravity_guide: 'no' } }]) {
    assert.equal((await ctx.post('skills', bad)).status, 400);
  }

  // Turning agy-plus off restores the folder while keeping the user's choice for when it is turned back on.
  await ctx.post('enabled', { enabled: false });
  assert.equal(fs.existsSync(`${skillsDir}/antigravity_guide/SKILL.md`), true);
  await ctx.post('enabled', { enabled: true });
  assert.equal(fs.existsSync(`${skillsDir}/antigravity_guide`), false);

  // Re-enabling restores it permanently.
  assert.equal((await ctx.post('skills', { changes: { antigravity_guide: true } })).status, 200);
  assert.equal(fs.existsSync(`${skillsDir}/antigravity_guide/SKILL.md`), true);
  assert.deepEqual(loadConfig().disabledSkills, []);
});

test('getBundle reads language_server.real when language_server is a wrapper script', async (t) => {
  const ctx = await setup(t, { start: false });
  const binDir = `${ctx.home}/Fake.app/Contents/Resources/bin`;
  fs.renameSync(`${binDir}/language_server`, `${binDir}/language_server.real`);
  fs.writeFileSync(`${binDir}/language_server`, '#!/bin/bash\nexec "$(dirname "$0")/language_server.real" "$@"\n');
  ctx.handle = await ctx.start();
  const script = await ctx.script();
  assert.ok(script.includes(SETTINGS_MARK));
  assert.deepEqual((await ctx.handle.getState()).warnings, []);
});
