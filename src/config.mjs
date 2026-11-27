// Where agy-plus keeps its files, and how the config file is read and written.
//
// config.json is the single source of truth for which flags are overridden. The daemon
// re-reads it when its modification time changes, so editing it by hand also works.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isValidFlagName, isValidFlagValue, normalizeTemplateTarget } from './patch.mjs';
import { isValidSkillName } from './skills.mjs';

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  flags: {},
  features: { costPrices: false, uiChinese: false, chineseTitles: false, guidelinesOverride: false, slashCommandsOverride: false },
  templates: [],
  disabledSkills: [],
  pageLanguage: 'auto',
  flagsChangedAt: 0,
  ports: { cloudcode: 47931, aicode: 47932, devui: 47933 },
  upstreams: {
    cloudcode: 'https://daily-cloudcode-pa.googleapis.com',
    aicode: 'https://aicode.googleapis.com',
  },
  appPath: '/Applications/Antigravity.app',
});

/** AGY_PLUS_HOME overrides the location (the tests use it). */
export function dataDir() {
  if (process.env.AGY_PLUS_HOME) return process.env.AGY_PLUS_HOME;
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'agy-plus');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'agy-plus');
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
 * Features of agy-plus itself that no flag of the client stands for. They are kept apart
 * from `flags`, because everything in `flags` is sent to the client.
 */
export const FEATURE_NAMES = Object.freeze(['costPrices', 'uiChinese', 'chineseTitles', 'guidelinesOverride', 'slashCommandsOverride']);

/** The language of the AGY Plus page: `auto` follows the language of the system. */
export const PAGE_LANGUAGES = Object.freeze(['auto', 'zh', 'en']);

export const files = {
  prices: () => path.join(dataDir(), 'prices.json'),
  config: () => path.join(dataDir(), 'config.json'),
  state: () => path.join(dataDir(), 'state.json'),
  log: () => path.join(dataDir(), 'daemon.log'),
  skillsBackup: () => path.join(dataDir(), 'skills-backup'),
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
  const templates = Array.isArray(input.templates)
    ? input.templates.slice(0, 100).map(normalizeTemplateTarget).filter(Boolean)
    : [];
  const disabledSkills = Array.isArray(input.disabledSkills)
    ? [...new Set(input.disabledSkills.slice(0, 200).filter(isValidSkillName))]
    : [];
  return {
    enabled: input.enabled !== false,
    flags,
    features,
    templates,
    disabledSkills,
    pageLanguage: PAGE_LANGUAGES.includes(input.pageLanguage) ? input.pageLanguage : 'auto',
    flagsChangedAt: Number.isFinite(input.flagsChangedAt) ? input.flagsChangedAt : 0,
    ports: {
      cloudcode: validPort(ports.cloudcode, DEFAULT_CONFIG.ports.cloudcode),
      aicode: validPort(ports.aicode, DEFAULT_CONFIG.ports.aicode),
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

/**
 * Versions up to 0.2 had a web page of their own, which had to present a secret from a file
 * in the data directory. Nothing reads that file any more.
 */
export function removeObsoleteFiles() {
  fs.rmSync(path.join(dataDir(), 'token'), { force: true });
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
