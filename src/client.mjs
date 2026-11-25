// What we can learn about the Antigravity app on this machine, and how to restart it.
// Every command is run with execFile and fixed arguments; nothing is passed through a shell.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ENV_NAMES } from './env.mjs';

function run(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 8000, maxBuffer: 16 * 1024 * 1024, ...options }, (err, stdout) => {
      resolve({ ok: !err, stdout: String(stdout || '') });
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function plistValue(appPath, key) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const { ok, stdout } = await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]);
  return ok ? stdout.trim() : null;
}

/** { installed, version, bundleId } */
export async function appInfo(appPath) {
  if (!fs.existsSync(appPath)) return { installed: false, version: null, bundleId: null };
  return {
    installed: true,
    version: await plistValue(appPath, 'CFBundleShortVersionString'),
    bundleId: await plistValue(appPath, 'CFBundleIdentifier'),
  };
}

/** Parse one line of `ps -axo pid=,lstart=,command=`. Exported for the tests. */
export function parsePsLine(line) {
  const m = /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/.exec(line);
  if (!m) return null;
  const startedAt = Date.parse(m[2]);
  return { pid: Number(m[1]), startedAt: Number.isFinite(startedAt) ? startedAt : null, command: m[3] };
}

async function processes() {
  const { ok, stdout } = await run('/bin/ps', ['-axo', 'pid=,lstart=,command='], {
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  });
  if (!ok) return [];
  return stdout.split('\n').map(parsePsLine).filter(Boolean);
}

/** Pull NAME=value out of `ps eww` output. Exported for the tests. */
export function envFromPs(text, name) {
  const m = new RegExp(`(?:^|\\s)${name}=(\\S+)`).exec(text);
  return m ? m[1] : '';
}

/**
 * The running client, if any:
 * { running, lsPid, lsStartedAt, endpointArg, env: { CLOUD_CODE_URL, AICODE_ENDPOINT_URL } }
 */
export async function clientState(appPath) {
  const state = { running: false, lsPid: null, lsStartedAt: null, endpointArg: null, env: {} };
  const list = await processes();
  const mainPrefix = `${path.join(appPath, 'Contents', 'MacOS')}/`;
  state.running = list.some((p) => p.command.startsWith(mainPrefix));
  // Matches both the stock binary and a renamed one (language_server.real) behind a wrapper.
  const lsPrefix = path.join(appPath, 'Contents', 'Resources', 'bin', 'language_server');
  const ls = list.find((p) => {
    if (!p.command.startsWith(lsPrefix)) return false;
    const rest = p.command.slice(lsPrefix.length);
    return rest.startsWith(' ') || rest.startsWith('.real ');
  });
  if (!ls) return state;
  state.lsPid = ls.pid;
  state.lsStartedAt = ls.startedAt;
  const arg = /--cloud_code_endpoint[= ](\S+)/.exec(ls.command);
  state.endpointArg = arg ? arg[1] : null;
  const { stdout } = await run('/bin/ps', ['eww', '-o', 'command=', '-p', String(ls.pid)]);
  for (const name of Object.values(ENV_NAMES)) state.env[name] = envFromPs(stdout, name);
  return state;
}

/** Quit the app (if it runs), wait for it to exit, start it again. */
export async function restartClient(appPath) {
  const info = await appInfo(appPath);
  if (!info.installed) return { ok: false, error: 'app not found' };
  const mainPrefix = `${path.join(appPath, 'Contents', 'MacOS')}/`;
  const mainPids = async () => (await processes()).filter((p) => p.command.startsWith(mainPrefix)).map((p) => p.pid);
  const isRunning = async () => (await mainPids()).length > 0;
  const waitForExit = async (ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && (await isRunning())) await sleep(500);
    return !(await isRunning());
  };

  let method = 'not-running';
  if (await isRunning()) {
    let quit = false;
    if (info.bundleId && /^[A-Za-z0-9.-]+$/.test(info.bundleId)) {
      method = 'applescript';
      const asked = await run('/usr/bin/osascript', ['-e', `tell application id "${info.bundleId}" to quit`], { timeout: 10000 });
      quit = await waitForExit(asked.ok ? 10000 : 1000);
    }
    if (!quit) {
      method = 'signal';
      // macOS can refuse the quit request from a background process. Ask the main process directly.
      for (const pid of await mainPids()) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // already gone
        }
      }
      quit = await waitForExit(15000);
    }
    if (!quit) return { ok: false, error: 'the app did not quit' };
    await sleep(800);
  }
  const opened = await run('/usr/bin/open', ['-a', appPath]);
  return opened.ok ? { ok: true, method } : { ok: false, error: 'could not start the app' };
}
