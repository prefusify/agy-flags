// Registering the daemon as a per-user login item (a launchd LaunchAgent).
//
// install copies the program into the data directory first. The login item then does not
// depend on where the source was downloaded to, and macOS does not block it from reading
// folders such as Documents or Downloads.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, ensureDataDir } from './config.mjs';

export const LABEL = 'dev.agy-flags.daemon';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COPIED = ['bin', 'src', 'ui', 'package.json', 'LICENSE', 'README.md'];

export const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
export const installedRoot = () => path.join(dataDir(), 'app');
const domain = () => `gui/${process.getuid()}`;

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

const xml = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** The LaunchAgent definition. Exported for the tests. */
export function buildPlist({ node, script, errorLog, home }) {
  const env = home ? `  <key>EnvironmentVariables</key>\n  <dict>\n    <key>AGY_FLAGS_HOME</key>\n    <string>${xml(home)}</string>\n  </dict>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(script)}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>2</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardErrorPath</key>
  <string>${xml(errorLog)}</string>
${env}</dict>
</plist>
`;
}

/**
 * The path used to start node at login. A package manager's link (for example
 * /opt/homebrew/bin/node) survives an upgrade; the real path of the binary does not.
 */
export function stableNodePath() {
  let real;
  try {
    real = fs.realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, 'node');
    try {
      if (fs.realpathSync(candidate) === real) return candidate;
    } catch {
      // not there
    }
  }
  return process.execPath;
}

/** Copy the program into the data directory. Returns the directory it now lives in. */
export function copyProgram() {
  const target = installedRoot();
  if (path.resolve(ROOT) === path.resolve(target)) return target;
  ensureDataDir();
  const staging = `${target}.new`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const name of COPIED) {
    const from = path.join(ROOT, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(staging, name), { recursive: true });
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);
  return target;
}

export async function isLoaded() {
  const { ok } = await run('/bin/launchctl', ['print', `${domain()}/${LABEL}`]);
  return ok;
}

/** Stop the login item if it is loaded. launchd sends SIGTERM; the daemon clears its variables. */
export async function unload() {
  if (!(await isLoaded())) return { ok: true, wasLoaded: false };
  const result = await run('/bin/launchctl', ['bootout', `${domain()}/${LABEL}`]);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && (await isLoaded())) await new Promise((r) => setTimeout(r, 300));
  return { ok: !(await isLoaded()), wasLoaded: true, stderr: result.stderr.trim() };
}

export async function load({ home = process.env.AGY_FLAGS_HOME || '' } = {}) {
  const root = copyProgram();
  const file = plistPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const plist = buildPlist({
    node: stableNodePath(),
    script: path.join(root, 'bin', 'agy-flags.mjs'),
    errorLog: path.join(dataDir(), 'launchd-stderr.log'),
    home,
  });
  fs.writeFileSync(file, plist, { mode: 0o644 });
  const result = await run('/bin/launchctl', ['bootstrap', domain(), file]);
  return { ok: result.ok, stderr: result.stderr.trim(), plist: file, root };
}

export function removeFiles({ purge = false } = {}) {
  fs.rmSync(plistPath(), { force: true });
  fs.rmSync(installedRoot(), { recursive: true, force: true });
  if (purge) fs.rmSync(dataDir(), { recursive: true, force: true });
}
