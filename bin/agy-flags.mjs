#!/usr/bin/env node
// Command line for agy-flags. Run `agy-flags help` for the list of commands.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const HELP = `agy-flags - turn on experimental features of the Antigravity desktop app

Usage: agy-flags <command>

  install               Start agy-flags now and at every login
  uninstall             Stop it and remove the login item
      --restart-client    also restart Antigravity when it still runs through agy-flags
      --purge             also delete the settings in the data directory
  status                Show what is running and what is changed
  daemon                Run in the foreground (this is what the login item runs)
  help, --version

The features are chosen inside Antigravity: Settings > AGY-flags. The page is there after
Antigravity was restarted once while agy-flags runs. When the page is missing, "agy-flags
status" says why, and the same choices can be written into config.json in the data directory.

agy-flags does not modify the Antigravity app. It runs local forwarders and points the app at
them with login-session environment variables. Only requests of the desktop app are changed;
requests of the agy command line pass through unchanged. See README.md.
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  console.error(`agy-flags: ${message}`);
  process.exit(1);
}

function requireMac() {
  if (process.platform !== 'darwin') fail('this version supports macOS only');
}

/**
 * Last resort for a daemon that cannot even load its own code: remove our variables so
 * that the next start of Antigravity connects directly. Uses nothing from src/.
 */
function emergencyClear() {
  if (process.platform !== 'darwin') return;
  const home = process.env.AGY_FLAGS_HOME || path.join(os.homedir(), 'Library', 'Application Support', 'agy-flags');
  let ports = {};
  try {
    ports = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).ports || {};
  } catch {
    // defaults below
  }
  const ours = {
    CLOUD_CODE_URL: `http://127.0.0.1:${ports.cloudcode || 47931}`,
    AICODE_ENDPOINT_URL: `http://127.0.0.1:${ports.aicode || 47932}`,
    AGY_DEV_UI_URL: `http://127.0.0.1:${ports.devui || 47933}`,
  };
  for (const [name, value] of Object.entries(ours)) {
    try {
      const current = execFileSync('/bin/launchctl', ['getenv', name], { encoding: 'utf8', timeout: 5000 }).trim();
      if (current === value) execFileSync('/bin/launchctl', ['unsetenv', name], { timeout: 5000 });
    } catch {
      // nothing more can be done here
    }
  }
}

function makeLogger(file) {
  try {
    if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.1`);
  } catch {
    // no log yet
  }
  return (message) => {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
      fs.appendFileSync(file, line, { mode: 0o600 });
    } catch {
      // logging must never stop the daemon
    }
    if (process.stdout.isTTY) process.stdout.write(line);
  };
}

function apiGet(port, pathname) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: pathname, timeout: 8000, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(res.statusCode === 200 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null);
          } catch {
            resolve(null);
          }
        });
        res.on('error', () => resolve(null));
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

async function cmdDaemon() {
  let daemon;
  let config;
  try {
    daemon = await import('../src/daemon.mjs');
    config = await import('../src/config.mjs');
  } catch (err) {
    emergencyClear();
    console.error(err);
    process.exit(1);
  }
  config.ensureDataDir();
  const log = makeLogger(config.files.log());
  process.on('uncaughtException', (err) => log(`uncaught exception: ${err?.stack || err}`));
  process.on('unhandledRejection', (err) => log(`unhandled rejection: ${err?.stack || err}`));

  log(`agy-flags ${daemon.VERSION} starting (pid ${process.pid}, node ${process.version})`);
  let handle;
  try {
    handle = await daemon.startDaemon({
      log,
      onFatal: (reason) => {
        log(`stopping: ${reason}`);
        process.exit(75);
      },
    });
  } catch (err) {
    log(`could not start: ${err?.message || err}`);
    // The service manager starts us again after a failure. Wait first, so that a port that
    // stays taken does not turn into a tight loop.
    if (err?.code === 'PORT_IN_USE') await sleep(30_000);
    process.exit(1);
  }
  if (handle.status === 'already-running') {
    log('another agy-flags daemon is already running; this one exits');
    process.exit(0);
  }

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log(`received ${signal}`);
    await handle.stop();
    process.exit(0);
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => shutdown(signal));
}

async function cmdInstall() {
  requireMac();
  const launchd = await import('../src/launchd.mjs');
  const { loadConfig } = await import('../src/config.mjs');
  const { ping } = await import('../src/daemon.mjs');
  const client = await import('../src/client.mjs');
  const config = loadConfig();

  const before = await launchd.unload();
  if (!before.ok) fail(`could not stop the old login item: ${before.stderr}`);
  const loaded = await launchd.load();
  if (!loaded.ok) fail(`launchctl could not load ${loaded.plist}: ${loaded.stderr}`);

  let answer = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !(answer = await ping(config.ports.devui))) await sleep(300);
  if (!answer) {
    fail(`the daemon did not start. See the log: ${path.join(path.dirname(loaded.root), 'daemon.log')}`);
  }
  console.log(`agy-flags is running (pid ${answer.pid}) and starts at every login.`);
  console.log(`Program copied to: ${loaded.root}`);
  // The settings page is a part of the Antigravity window, and the window is loaded when the app starts.
  const { running } = await client.clientState(config.appPath);
  console.log(`Next: ${running ? 'quit and reopen' : 'open'} Antigravity, then open Settings > AGY-flags and choose features.`);
}

async function cmdUninstall(args) {
  requireMac();
  const launchd = await import('../src/launchd.mjs');
  const { loadConfig } = await import('../src/config.mjs');
  const env = await import('../src/env.mjs');
  const client = await import('../src/client.mjs');
  const { computePending } = await import('../src/daemon.mjs');
  const config = loadConfig();
  const desired = env.allOurEnv(config.ports);

  const stopped = await launchd.unload();
  if (!stopped.ok) fail(`could not stop the login item: ${stopped.stderr}`);
  // The daemon clears its variables when it stops. Do it again in case it was not running.
  const cleared = await env.clearEnv(env.launchctlRunner(), desired);
  launchd.removeFiles({ purge: args.includes('--purge') });
  console.log(stopped.wasLoaded ? 'Stopped agy-flags and removed the login item.' : 'The login item was not loaded; files removed.');
  for (const [name, result] of Object.entries(cleared)) {
    if (result === 'foreign') console.log(`Note: ${name} is set by another program and was left as it is.`);
    if (result === 'error') console.log(`Warning: could not clear ${name}. Run: launchctl unsetenv ${name}`);
  }

  const state = await client.clientState(config.appPath);
  const { carries, routed } = computePending({
    enabled: false,
    client: state,
    base: env.ourEnv(config.ports),
    page: env.ourUiEnv(config.ports),
    changedAt: 0,
  });
  if (carries) {
    if (args.includes('--restart-client')) {
      const result = await client.restartClient(config.appPath);
      console.log(result.ok ? 'Antigravity was restarted and now connects directly.' : `Could not restart Antigravity: ${result.error}`);
    } else {
      // With rewriting off, the client had only the variable for the page files.
      console.log(`Antigravity is still running with the settings of agy-flags.${routed ? ' It can no longer reach its servers,' : ''}`);
      console.log(`${routed ? 'and a' : 'A'} window that is reloaded can no longer load its page.`);
      console.log('Quit and reopen Antigravity now.');
    }
  }
  // The variables were inherited by every program started while agy-flags was on.
  console.log('Programs that were opened while agy-flags was on (Terminal, for example) still carry its');
  console.log('variables. Quit and reopen them before you use the agy command line there.');
}

async function cmdStatus() {
  const { loadConfig, dataDir } = await import('../src/config.mjs');
  const { ping, VERSION } = await import('../src/daemon.mjs');
  const { API_PREFIX } = await import('../src/api.mjs');
  const config = loadConfig();
  console.log(`agy-flags ${VERSION}`);
  console.log(`data directory: ${dataDir()}`);
  if (process.platform === 'darwin') {
    const launchd = await import('../src/launchd.mjs');
    console.log(`login item:     ${(await launchd.isLoaded()) ? 'loaded' : 'not loaded'}`);
  }
  const answer = await ping(config.ports.devui);
  if (!answer) {
    console.log('daemon:         not running');
    if (process.platform === 'darwin') {
      const env = await import('../src/env.mjs');
      const values = await env.readEnv(env.launchctlRunner(), env.allOurEnv(config.ports));
      for (const [name, { value, ours }] of Object.entries(values)) {
        if (value) console.log(`WARNING: ${name}=${value}${ours ? ' still points at agy-flags. Run: launchctl unsetenv ' + name : ''}`);
      }
    }
    return;
  }
  console.log(`daemon:         running (pid ${answer.pid})`);
  const state = await apiGet(config.ports.devui, `${API_PREFIX}state.json`);
  if (!state) {
    console.log('could not read the state from the daemon');
    return;
  }
  const client = !state.app.installed
    ? `not found at ${state.app.path}`
    : `${state.app.version}, ${state.client.running ? 'running' : 'not running'}` +
      (state.client.running ? (state.client.routed ? ', through agy-flags' : ', direct') : '');
  console.log(`rewriting:      ${state.enabled ? 'on' : 'off'}`);
  console.log(`variables:      ${state.env.status}`);
  console.log(`Antigravity:    ${client}`);
  const names = Object.keys(state.overrides);
  console.log(`overrides:      ${names.length}`);
  for (const name of names) console.log(`  ${name} = ${state.overrides[name]}`);
  const by = state.traffic?.byClient;
  if (by) {
    console.log(`requests:       desktop app ${by.desktop}; passed through unchanged: agy command line ${by.cli}, other ${by.other}`);
  }
  for (const [name, last] of Object.entries(state.lastInjection)) {
    console.log(`last rewrite:   ${name} ${new Date(last.at).toLocaleTimeString()} ${last.ok ? `${last.applied.length} applied` : 'NOT PATCHED'}`);
  }
  if (state.pendingRestart) console.log(`pending:        restart Antigravity to apply (${state.pendingReason})`);
  for (const w of state.warnings) console.log(`warning:        ${w.code} ${w.detail}`);
}

const [command = 'help', ...args] = process.argv.slice(2);
switch (command) {
  case 'daemon':
    await cmdDaemon();
    break;
  case 'install':
    await cmdInstall();
    break;
  case 'uninstall':
    await cmdUninstall(args);
    break;
  case 'status':
    await cmdStatus();
    break;
  case '--version':
  case '-v':
  case 'version': {
    const { VERSION } = await import('../src/daemon.mjs');
    console.log(VERSION);
    break;
  }
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;
  default:
    console.error(`agy-flags: unknown command "${command}"\n`);
    console.error(HELP);
    process.exit(2);
}
