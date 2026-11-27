// The environment variables that point Antigravity at this program: two for the local
// forwarders, and one more for the page files, which hold the settings page of agy-flags.
//
// They live in the login session (launchctl setenv), so every app started afterwards
// inherits them. The dangerous state is "variable still set, nobody listening": a client
// started then cannot reach the cloud. The rules below exist to avoid it:
//   - set a variable only after our port is listening;
//   - never overwrite a value somebody else set;
//   - clear a variable only when its value is ours.

import { execFile } from 'node:child_process';

export const ENV_NAMES = Object.freeze({ cloudcode: 'CLOUD_CODE_URL', aicode: 'AICODE_ENDPOINT_URL', devui: 'AGY_DEV_UI_URL' });

/** The two variables for the forwarders, { CLOUD_CODE_URL: 'http://127.0.0.1:47931', ... }. */
export function ourEnv(ports) {
  return {
    [ENV_NAMES.cloudcode]: `http://127.0.0.1:${ports.cloudcode}`,
    [ENV_NAMES.aicode]: `http://127.0.0.1:${ports.aicode}`,
  };
}

/** The variable that makes the client take its page files from us. Set while those files can be served. */
export function ourUiEnv(ports) {
  return { [ENV_NAMES.devui]: `http://127.0.0.1:${ports.devui}` };
}

/** Every variable this installation can set. */
export function allOurEnv(ports) {
  return { ...ourEnv(ports), ...ourUiEnv(ports) };
}

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('/bin/launchctl', args, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

/** Reads and writes the login-session environment. Replaced by a fake in the tests. */
export function launchctlRunner() {
  if (process.platform !== 'darwin') {
    const unsupported = async () => {
      throw new Error('agy-flags can set login-session variables on macOS only');
    };
    return { get: unsupported, set: unsupported, unset: unsupported };
  }
  return {
    get: async (name) => (await run(['getenv', name])).trim(),
    set: async (name, value) => {
      await run(['setenv', name, value]);
    },
    unset: async (name) => {
      await run(['unsetenv', name]);
    },
  };
}

/** { NAME: { value, ours } } */
export async function readEnv(runner, desired) {
  const out = {};
  for (const [name, want] of Object.entries(desired)) {
    let value = '';
    try {
      value = await runner.get(name);
    } catch {
      value = '';
    }
    out[name] = { value, ours: value === want };
  }
  return out;
}

/**
 * Set each variable unless somebody else already set it.
 * @returns {{ ok: boolean, results: Record<string, 'set'|'kept'|'conflict'|'error'>, conflicts: Record<string, string> }}
 */
export async function applyEnv(runner, desired) {
  const results = {};
  const conflicts = {};
  const current = await readEnv(runner, desired);
  // Check every variable first: of the two forwarder variables, setting one and not the
  // other would split the traffic.
  for (const [name, { value, ours }] of Object.entries(current)) {
    if (value && !ours) conflicts[name] = value;
  }
  if (Object.keys(conflicts).length > 0) {
    for (const name of Object.keys(desired)) results[name] = conflicts[name] ? 'conflict' : 'kept';
    return { ok: false, results, conflicts };
  }
  let ok = true;
  for (const [name, want] of Object.entries(desired)) {
    if (current[name].ours) {
      results[name] = 'kept';
      continue;
    }
    try {
      await runner.set(name, want);
      results[name] = 'set';
    } catch {
      results[name] = 'error';
      ok = false;
    }
  }
  if (!ok) await clearEnv(runner, desired);
  return { ok, results, conflicts };
}

/** Clear each variable whose current value is ours. Foreign values are left alone. */
export async function clearEnv(runner, desired) {
  const results = {};
  const current = await readEnv(runner, desired);
  for (const [name, { value, ours }] of Object.entries(current)) {
    if (!value) {
      results[name] = 'absent';
    } else if (!ours) {
      results[name] = 'foreign';
    } else {
      try {
        await runner.unset(name);
        results[name] = 'cleared';
      } catch {
        results[name] = 'error';
      }
    }
  }
  return results;
}
