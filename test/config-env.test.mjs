import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parsePsLine, envFromPs } from '../src/client.mjs';
import {
  DEFAULT_CONFIG,
  FEATURE_NAMES,
  dataDir,
  files,
  loadConfig,
  migrateLegacyDataDir,
  normalizeConfig,
  removeObsoleteFiles,
  saveConfig,
} from '../src/config.mjs';
import { allOurEnv, applyEnv, clearEnv, ourEnv, ourUiEnv, readEnv } from '../src/env.mjs';
import { buildPlist } from '../src/launchd.mjs';
import { fakeRunner, tempHome } from './helpers.mjs';

const NO_FEATURES = { costPrices: false, uiChinese: false, chineseTitles: false };

function useTempHome(t) {
  const home = tempHome();
  const before = process.env.AGY_PLUS_HOME;
  process.env.AGY_PLUS_HOME = home;
  t.after(() => {
    if (before === undefined) delete process.env.AGY_PLUS_HOME;
    else process.env.AGY_PLUS_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

test('normalizeConfig fills defaults and drops what is not valid', () => {
  assert.deepEqual(normalizeConfig(null), { ...DEFAULT_CONFIG, flags: {} });
  const config = normalizeConfig({
    enabled: false,
    flags: { good: true, 'bad name': true, nested: { a: 1 }, n: 5 },
    // "ui" was the port of the web page that versions up to 0.2 had.
    ports: { cloudcode: 80, aicode: 50000, ui: 47930, devui: 'x' },
    upstreams: { cloudcode: 'ftp://example.com', aicode: 'https://example.com/some/path' },
    appPath: 'relative/Antigravity.app',
  });
  assert.equal(config.enabled, false);
  assert.deepEqual(config.flags, { good: true, n: 5 });
  assert.deepEqual(config.features, NO_FEATURES);
  assert.equal(config.pageLanguage, 'auto');
  assert.equal(normalizeConfig({ pageLanguage: 'en' }).pageLanguage, 'en');
  assert.equal(normalizeConfig({ pageLanguage: 'zh' }).pageLanguage, 'zh');
  for (const odd of ['EN', 'fr', true, null, ['en']]) assert.equal(normalizeConfig({ pageLanguage: odd }).pageLanguage, 'auto');
  assert.deepEqual(config.ports, {
    cloudcode: DEFAULT_CONFIG.ports.cloudcode,
    aicode: 50000,
    devui: DEFAULT_CONFIG.ports.devui,
  });
  assert.deepEqual(DEFAULT_CONFIG.ports, { cloudcode: 47931, aicode: 47932, devui: 47933 });
  assert.equal(config.upstreams.cloudcode, DEFAULT_CONFIG.upstreams.cloudcode);
  assert.equal(config.upstreams.aicode, 'https://example.com');
  assert.equal(config.appPath, DEFAULT_CONFIG.appPath);
});

test('the config is stored in the data directory, readable by the user only', (t) => {
  const home = useTempHome(t);
  assert.equal(dataDir(), home);
  assert.deepEqual(loadConfig().flags, {});
  saveConfig({ ...loadConfig(), flags: { a: true }, flagsChangedAt: 42 });
  assert.deepEqual(loadConfig().flags, { a: true });
  assert.equal(loadConfig().flagsChangedAt, 42);
  assert.equal(fs.statSync(files.config()).mode & 0o777, 0o600);
  // A config file of an older version keeps its settings and loses the port that is gone.
  fs.writeFileSync(files.config(), JSON.stringify({ flags: { b: true }, ports: { cloudcode: 50001, aicode: 50002, ui: 50003, devui: 50004 } }));
  assert.deepEqual(loadConfig().flags, { b: true });
  assert.deepEqual(loadConfig().ports, { cloudcode: 50001, aicode: 50002, devui: 50004 });
});

test('the secret of the old web page is removed, and nothing else', (t) => {
  const home = useTempHome(t);
  saveConfig({ ...loadConfig(), flags: { a: true } });
  // Nothing to remove: no error.
  removeObsoleteFiles();
  fs.writeFileSync(`${home}/token`, 'a'.repeat(64), { mode: 0o600 });
  removeObsoleteFiles();
  assert.deepEqual(fs.readdirSync(home), ['config.json']);
  assert.equal(Object.hasOwn(files, 'token'), false);
});

test('a broken config file falls back to defaults', (t) => {
  useTempHome(t);
  fs.writeFileSync(files.config(), '{ not json');
  assert.deepEqual(loadConfig(), { ...DEFAULT_CONFIG, flags: {} });
});

const DESIRED = ourEnv({ cloudcode: 47931, aicode: 47932 });

test('ourEnv names the two forwarder variables, ourUiEnv the one for the page files', () => {
  assert.deepEqual(DESIRED, {
    CLOUD_CODE_URL: 'http://127.0.0.1:47931',
    AICODE_ENDPOINT_URL: 'http://127.0.0.1:47932',
  });
  // Scheme, host and port only: the language server does not start with a path in this address.
  assert.deepEqual(ourUiEnv(DEFAULT_CONFIG.ports), { AGY_DEV_UI_URL: 'http://127.0.0.1:47933' });
  assert.deepEqual(allOurEnv(DEFAULT_CONFIG.ports), { ...DESIRED, AGY_DEV_UI_URL: 'http://127.0.0.1:47933' });
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
  const plist = buildPlist({ node: '/opt/a&b/node', script: '/x/<y>/agy-plus.mjs', errorLog: '/tmp/err.log', home: '' });
  assert.match(plist, /<string>\/opt\/a&amp;b\/node<\/string>/);
  assert.match(plist, /<string>\/x\/&lt;y&gt;\/agy-plus\.mjs<\/string>/);
  assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.ok(!plist.includes('AGY_PLUS_HOME'));
  assert.ok(buildPlist({ node: 'n', script: 's', errorLog: 'e', home: '/h' }).includes('<string>/h</string>'));
  if (process.platform !== 'darwin') {
    t.diagnostic('plutil check skipped: not macOS');
  }
});

test('migrateLegacyDataDir copies config, state and prices only when agy-plus has no config yet', (t) => {
  const oldDir = tempHome();
  const newDir = `${tempHome()}/nested`;
  t.after(() => {
    fs.rmSync(oldDir, { recursive: true, force: true });
    fs.rmSync(newDir, { recursive: true, force: true });
  });
  assert.equal(migrateLegacyDataDir({ from: oldDir, to: newDir }), false);

  fs.writeFileSync(`${oldDir}/config.json`, '{"flags":{"x":true}}\n');
  fs.writeFileSync(`${oldDir}/prices.json`, '{"provider":"google-vertex"}');
  fs.writeFileSync(`${oldDir}/daemon.log`, 'old log');
  assert.equal(migrateLegacyDataDir({ from: oldDir, to: newDir }), true);
  assert.equal(fs.readFileSync(`${newDir}/config.json`, 'utf8'), '{"flags":{"x":true}}\n');
  assert.equal(fs.readFileSync(`${newDir}/prices.json`, 'utf8'), '{"provider":"google-vertex"}');
  assert.equal(fs.existsSync(`${newDir}/daemon.log`), false);

  // Never overwrites an existing agy-plus config.
  fs.writeFileSync(`${oldDir}/config.json`, '{"flags":{"y":true}}\n');
  assert.equal(migrateLegacyDataDir({ from: oldDir, to: newDir }), false);
  assert.equal(fs.readFileSync(`${newDir}/config.json`, 'utf8'), '{"flags":{"x":true}}\n');
});

test('features of agy-plus are kept apart from the flags, and only known ones are kept', () => {
  assert.deepEqual(FEATURE_NAMES, ['costPrices', 'uiChinese', 'chineseTitles']);
  assert.deepEqual(normalizeConfig({ features: { costPrices: true, other: true } }).features, { ...NO_FEATURES, costPrices: true });
  assert.deepEqual(normalizeConfig({ features: { uiChinese: true, chineseTitles: true } }).features, {
    ...NO_FEATURES,
    uiChinese: true,
    chineseTitles: true,
  });
  for (const odd of [{ costPrices: 'yes' }, { costPrices: 1 }, { uiChinese: 'true' }, null, 'x', []]) {
    assert.deepEqual(normalizeConfig({ features: odd }).features, NO_FEATURES);
  }
  // A feature is not a flag: it is never part of what is sent to the client.
  assert.deepEqual(normalizeConfig({ features: { costPrices: true } }).flags, {});
});
