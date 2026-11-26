// Where agy-flags keeps its files, and how the config file is read and written.
//
// config.json is the single source of truth for which flags are overridden. The daemon
// re-reads it when its modification time changes, so editing it by hand also works.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isValidFlagName, isValidFlagValue } from './patch.mjs';

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  flags: {},
  features: { costPrices: false, uiChinese: false, chineseTitles: false },
  flagsChangedAt: 0,
  ports: { cloudcode: 47931, aicode: 47932, ui: 47930, devui: 47933 },
  upstreams: {
    cloudcode: 'https://daily-cloudcode-pa.googleapis.com',
    aicode: 'https://aicode.googleapis.com',
  },
  appPath: '/Applications/Antigravity.app',
});

/** AGY_FLAGS_HOME overrides the location (the tests use it). */
export function dataDir() {
  if (process.env.AGY_FLAGS_HOME) return process.env.AGY_FLAGS_HOME;
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'agy-flags');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'agy-flags');
}

export function ensureDataDir() {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best effort
  }
  return dir;
}

/**
 * Features of agy-flags itself that no flag of the client stands for. They are kept apart
 * from `flags`, because everything in `flags` is sent to the client.
 */
export const FEATURE_NAMES = Object.freeze(['costPrices', 'uiChinese', 'chineseTitles']);

export const files = {
  prices: () => path.join(dataDir(), 'prices.json'),
  config: () => path.join(dataDir(), 'config.json'),
  token: () => path.join(dataDir(), 'token'),
  state: () => path.join(dataDir(), 'state.json'),
  log: () => path.join(dataDir(), 'daemon.log'),
};

function validPort(value, fallback) {
  return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : fallback;
}

function validUpstream(value, fallback) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
  } catch {
    // fall through
  }
  return fallback;
}

/** Turn whatever is in the file into a complete, safe config object. */
export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const flags = {};
  if (input.flags && typeof input.flags === 'object' && !Array.isArray(input.flags)) {
    for (const [name, value] of Object.entries(input.flags)) {
      if (isValidFlagName(name) && isValidFlagValue(value)) flags[name] = value;
    }
  }
  const ports = input.ports && typeof input.ports === 'object' ? input.ports : {};
  const upstreams = input.upstreams && typeof input.upstreams === 'object' ? input.upstreams : {};
  const features = {};
  for (const name of FEATURE_NAMES) features[name] = input.features?.[name] === true;
  return {
    enabled: input.enabled !== false,
    flags,
    features,
    flagsChangedAt: Number.isFinite(input.flagsChangedAt) ? input.flagsChangedAt : 0,
    ports: {
      cloudcode: validPort(ports.cloudcode, DEFAULT_CONFIG.ports.cloudcode),
      aicode: validPort(ports.aicode, DEFAULT_CONFIG.ports.aicode),
      ui: validPort(ports.ui, DEFAULT_CONFIG.ports.ui),
      devui: validPort(ports.devui, DEFAULT_CONFIG.ports.devui),
    },
    upstreams: {
      cloudcode: validUpstream(upstreams.cloudcode, DEFAULT_CONFIG.upstreams.cloudcode),
      aicode: validUpstream(upstreams.aicode, DEFAULT_CONFIG.upstreams.aicode),
    },
    appPath:
      typeof input.appPath === 'string' && path.isAbsolute(input.appPath) && input.appPath.endsWith('.app')
        ? input.appPath
        : DEFAULT_CONFIG.appPath,
  };
}

export function loadConfig() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(files.config(), 'utf8'));
  } catch {
    // missing or unreadable file: start from defaults
  }
  return normalizeConfig(raw);
}

function writeFileAtomic(file, text, mode = 0o600) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

export function saveConfig(config) {
  ensureDataDir();
  writeFileAtomic(files.config(), `${JSON.stringify(normalizeConfig(config), null, 2)}\n`);
}

export function configMtime() {
  try {
    return fs.statSync(files.config()).mtimeMs;
  } catch {
    return 0;
  }
}

/** The secret the web page must present. Created on first use, readable by the user only. */
export function ensureToken() {
  ensureDataDir();
  try {
    const existing = fs.readFileSync(files.token(), 'utf8').trim();
    if (/^[0-9a-f]{48,}$/.test(existing)) return existing;
  } catch {
    // create below
  }
  const token = crypto.randomBytes(32).toString('hex');
  writeFileAtomic(files.token(), `${token}\n`);
  return token;
}

export function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(files.state(), 'utf8'));
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

export function saveState(state) {
  try {
    ensureDataDir();
    writeFileAtomic(files.state(), JSON.stringify(state));
  } catch {
    // state is a cache; losing it is harmless
  }
}
