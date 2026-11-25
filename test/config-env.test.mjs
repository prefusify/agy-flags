import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parsePsLine, envFromPs } from '../src/client.mjs';
import { DEFAULT_CONFIG, dataDir, ensureToken, files, loadConfig, normalizeConfig, saveConfig } from '../src/config.mjs';
import { applyEnv, clearEnv, ourEnv, readEnv } from '../src/env.mjs';
import { buildPlist } from '../src/launchd.mjs';
import { fakeRunner, tempHome } from './helpers.mjs';

function useTempHome(t) {
  const home = tempHome();
  const before = process.env.AGY_FLAGS_HOME;
  process.env.AGY_FLAGS_HOME = home;
  t.after(() => {
    if (before === undefined) delete process.env.AGY_FLAGS_HOME;
    else process.env.AGY_FLAGS_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

test('normalizeConfig fills defaults and drops what is not valid', () => {
  assert.deepEqual(normalizeConfig(null), { ...DEFAULT_CONFIG, flags: {} });
  const config = normalizeConfig({
    enabled: false,
    flags: { good: true, 'bad name': true, nested: { a: 1 }, n: 5 },
    ports: { cloudcode: 80, aicode: 50000, ui: 'x' },
    upstreams: { cloudcode: 'ftp://example.com', aicode: 'https://example.com/some/path' },
    appPath: 'relative/Antigravity.app',
  });
  assert.equal(config.enabled, false);
  assert.deepEqual(config.flags, { good: true, n: 5 });
  assert.deepEqual(config.ports, {
    cloudcode: DEFAULT_CONFIG.ports.cloudcode,
    aicode: 50000,
    ui: DEFAULT_CONFIG.ports.ui,
    devui: DEFAULT_CONFIG.ports.devui,
  });
  assert.equal(config.upstreams.cloudcode, DEFAULT_CONFIG.upstreams.cloudcode);
  assert.equal(config.upstreams.aicode, 'https://example.com');
  assert.equal(config.appPath, DEFAULT_CONFIG.appPath);
});

test('the config and the token are stored in the data directory, readable by the user only', (t) => {
  const home = useTempHome(t);
  assert.equal(dataDir(), home);
  assert.deepEqual(loadConfig().flags, {});
  saveConfig({ ...loadConfig(), flags: { a: true }, flagsChangedAt: 42 });
  assert.deepEqual(loadConfig().flags, { a: true });
  assert.equal(loadConfig().flagsChangedAt, 42);
  assert.equal(fs.statSync(files.config()).mode & 0o777, 0o600);

  const token = ensureToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(ensureToken(), token);
  assert.equal(fs.statSync(files.token()).mode & 0o777, 0o600);
});

test('a broken config file falls back to defaults', (t) => {
  useTempHome(t);
  fs.writeFileSync(files.config(), '{ not json');
  assert.deepEqual(loadConfig(), { ...DEFAULT_CONFIG, flags: {} });
});

const DESIRED = ourEnv({ cloudcode: 47931, aicode: 47932 });

test('ourEnv names the two variables', () => {
  assert.deepEqual(DESIRED, {
    CLOUD_CODE_URL: 'http://127.0.0.1:47931',
    AICODE_ENDPOINT_URL: 'http://127.0.0.1:47932',
  });
});

test('applyEnv sets both variables and is idempotent', async () => {
  const runner = fakeRunner();
  const first = await applyEnv(runner, DESIRED);
  assert.equal(first.ok, true);
  assert.deepEqual(runner.vars, DESIRED);
  const second = await applyEnv(runner, DESIRED);
  assert.deepEqual(second.results, { CLOUD_CODE_URL: 'kept', AICODE_ENDPOINT_URL: 'kept' });
  assert.equal(runner.calls.length, 2);
});

test('applyEnv sets nothing when one variable belongs to somebody else', async () => {
  const runner = fakeRunner({ AICODE_ENDPOINT_URL: 'http://127.0.0.1:9999' });
  const result = await applyEnv(runner, DESIRED);
  assert.equal(result.ok, false);
  assert.deepEqual(result.conflicts, { AICODE_ENDPOINT_URL: 'http://127.0.0.1:9999' });
  assert.deepEqual(runner.vars, { AICODE_ENDPOINT_URL: 'http://127.0.0.1:9999' });
  assert.equal(runner.calls.length, 0);
});

test('applyEnv removes its own half when the second variable cannot be set', async () => {
  const runner = fakeRunner();
  const set = runner.set;
  runner.set = async (name, value) => {
    if (name === 'AICODE_ENDPOINT_URL') throw new Error('boom');
    await set(name, value);
  };
  const result = await applyEnv(runner, DESIRED);
  assert.equal(result.ok, false);
  assert.deepEqual(runner.vars, {});
});

test('clearEnv removes our values and leaves foreign ones', async () => {
  const runner = fakeRunner({ CLOUD_CODE_URL: DESIRED.CLOUD_CODE_URL, AICODE_ENDPOINT_URL: 'http://elsewhere:1' });
  const results = await clearEnv(runner, DESIRED);
  assert.deepEqual(results, { CLOUD_CODE_URL: 'cleared', AICODE_ENDPOINT_URL: 'foreign' });
  assert.deepEqual(runner.vars, { AICODE_ENDPOINT_URL: 'http://elsewhere:1' });
  assert.deepEqual(await readEnv(runner, DESIRED), {
    CLOUD_CODE_URL: { value: '', ours: false },
    AICODE_ENDPOINT_URL: { value: 'http://elsewhere:1', ours: false },
  });
});

test('ps output is parsed', () => {
  const line = '14597 Tue Nov 24 09:59:41 2026     /Applications/Antigravity.app/Contents/Resources/bin/language_server --standalone --cloud_code_endpoint https://example.com';
  const parsed = parsePsLine(line);
  assert.equal(parsed.pid, 14597);
  assert.equal(new Date(parsed.startedAt).getFullYear(), 2026);
  assert.ok(parsed.command.startsWith('/Applications/Antigravity.app/'));
  assert.equal(parsePsLine('garbage'), null);

  const env = '/path/language_server --flag HOME=/Users/x CLOUD_CODE_URL=http://127.0.0.1:47931 XCLOUD_CODE_URL=nope';
  assert.equal(envFromPs(env, 'CLOUD_CODE_URL'), 'http://127.0.0.1:47931');
  assert.equal(envFromPs(env, 'AICODE_ENDPOINT_URL'), '');
});

test('the login item definition is valid and escapes its strings', (t) => {
  const plist = buildPlist({ node: '/opt/a&b/node', script: '/x/<y>/agy-flags.mjs', errorLog: '/tmp/err.log', home: '' });
  assert.match(plist, /<string>\/opt\/a&amp;b\/node<\/string>/);
  assert.match(plist, /<string>\/x\/&lt;y&gt;\/agy-flags\.mjs<\/string>/);
  assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.ok(!plist.includes('AGY_FLAGS_HOME'));
  assert.ok(buildPlist({ node: 'n', script: 's', errorLog: 'e', home: '/h' }).includes('<string>/h</string>'));
  if (process.platform !== 'darwin') {
    t.diagnostic('plutil check skipped: not macOS');
  }
});
