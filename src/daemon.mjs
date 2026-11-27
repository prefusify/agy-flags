// The long-running process: two forwarders, the page-file server with the requests of the
// settings page, and the environment variables.
//
// Order matters. The variables are set only after every listener is up and has answered a
// ping, and they are cleared before the listeners stop. A client that starts while the
// variables are set must always find somebody listening.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.mjs';
import * as realClient from './client.mjs';
import {
  FEATURE_NAMES,
  PAGE_LANGUAGES,
  configMtime,
  ensureDataDir,
  files,
  loadConfig,
  loadState,
  removeObsoleteFiles,
  saveConfig,
  saveState,
} from './config.mjs';
import { findUiBundle } from './bundle.mjs';
import { allOurEnv, applyEnv, clearEnv, launchctlRunner, ourEnv, ourUiEnv, readEnv } from './env.mjs';
import { PING_PATH, createForwarder } from './forward.mjs';
import { loadDictionary } from './l10n.mjs';
import { BUILTIN_TEMPLATES, MODELS_KIND, effectiveTemplates, isValidFlagName } from './patch.mjs';
import { createPeerCheck } from './peer.mjs';
import { createPriceStore } from './prices.mjs';
import { createSkillManager, isValidSkillName } from './skills.mjs';
import { PART_COSTS, PART_INDICATOR, PART_L10N, PART_SETTINGS } from './uipatch.mjs';
import { createUiServer } from './uiserver.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const UPSTREAM_NAMES = ['cloudcode', 'aicode'];
const MAX_OVERRIDES = 2000;
const CATALOG_FILE = path.join(ROOT, 'src', 'catalog.json');
const L10N_FILE = path.join(ROOT, 'src', 'l10n', 'zh-CN.json');

/**
 * The page features of the catalog: [{ patch, flags }]. Such a feature needs a component
 * added to the client's page script, on top of its flags.
 */
export function uiPatchGroups(catalogFile = CATALOG_FILE) {
  const list = (value) => (Array.isArray(value) ? value.filter((name) => typeof name === 'string') : []);
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    return (catalog.groups || [])
      .filter((group) => typeof group?.uiPatch === 'string')
      .map((group) => ({
        patch: group.uiPatch,
        flags: list(group.flags),
        // A feature of agy-plus itself (config.features), and the flags of other groups it needs.
        feature: FEATURE_NAMES.includes(group.feature) ? group.feature : null,
        requires: list(group.requires),
      }))
      .filter((group) => group.flags.length > 0 || group.feature);
  } catch {
    return [];
  }
}

/** Ask whoever listens on a local port whether it is agy-plus. Resolves to its answer or null. */
export function ping(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: PING_PATH, timeout: timeoutMs, agent: false }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size <= 4096) chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(body && body.app === 'agy-plus' ? body : null);
        } catch {
          resolve(null);
        }
      });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

/** Remember the result of a slow lookup for a short time, and share one lookup between callers. */
function cached(fn, ttlMs) {
  let at = 0;
  let value;
  let inflight = null;
  const get = async () => {
    if (value !== undefined && Date.now() - at < ttlMs) return value;
    if (!inflight) {
      inflight = fn().then(
        (v) => {
          value = v;
          at = Date.now();
          inflight = null;
          return v;
        },
        (err) => {
          inflight = null;
          throw err;
        }
      );
    }
    return inflight;
  };
  get.invalidate = () => {
    at = 0;
  };
  return get;
}

/** Shorten a flag value for display and for state.json. */
function compactValue(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function compactFlags(server) {
  const out = {};
  for (const [name, { type, value }] of Object.entries(server)) {
    out[name] = { type, value: compactValue(value) };
  }
  return out;
}

/**
 * Does the running client need a restart before the current settings apply?
 * The answer is read from the client's own process, not from what we remember doing.
 *
 * `base` are the two forwarder variables: the client should carry them while rewriting is
 * on. `page` is the page-file variable: the client should carry it while the page files can
 * be served (`wantPage`), also while rewriting is off, because the settings page is in them.
 * @returns {{ pending: boolean, reason: string|null, routed: boolean|null, carries: boolean|null }}
 *          `routed`: the client sends its cloud requests through us.
 *          `carries`: the client has at least one variable of ours.
 */
export function computePending({ enabled, client, base, page = {}, wantPage = false, changedAt }) {
  if (!client.running || !client.lsPid) return { pending: false, reason: null, routed: null, carries: null };
  const has = ([name, value]) => client.env[name] === value;
  const baseEntries = Object.entries(base);
  const routed = baseEntries.every(has);
  const baseCarried = baseEntries.some(has);
  const pageEntries = Object.entries(page);
  const pageCarried = pageEntries.some(has);
  const out = { routed, carries: baseCarried || pageCarried };
  if (!enabled && baseCarried) return { pending: true, reason: 'still-routed', ...out };
  if (enabled && !routed) return { pending: true, reason: 'not-routed', ...out };
  if (wantPage && !pageEntries.every(has)) return { pending: true, reason: 'not-routed', ...out };
  // The client still takes its page files from us, although they can no longer be served.
  if (!wantPage && pageCarried) return { pending: true, reason: 'page-off', ...out };
  // The client reads its flags when it starts. A change made later needs a restart.
  if (enabled && client.lsStartedAt !== null && changedAt > client.lsStartedAt) {
    return { pending: true, reason: 'flags-changed', ...out };
  }
  return { pending: false, reason: null, ...out };
}

/**
 * Start everything.
 * @returns {Promise<{ status: 'running', stop: Function, getState: Function, ports: object }
 *                 | { status: 'already-running' }>}
 * Throws an Error with code PORT_IN_USE when a port is taken by another program.
 */
export async function startDaemon({
  runner = launchctlRunner(),
  client = realClient,
  log = () => {},
  onFatal = () => {},
  pollMs = 1000,
  envCheckMs = 60_000,
  catalogFile = CATALOG_FILE,
  l10nFile = L10N_FILE,
  builtinDir,
  unrecognizedGraceMs = 150_000,
  fetchPriceList,
  priceCheckMs = 30 * 60_000,
  priceWaitMs = 5000,
  peerCheck = createPeerCheck(),
} = {}) {
  ensureDataDir();
  removeObsoleteFiles();
  let config = loadConfig();
  if (!fs.existsSync(files.config())) saveConfig(config);
  let mtime = configMtime();
  const ports = { ...config.ports };
  const baseEnv = ourEnv(ports);
  const pageEnv = ourUiEnv(ports);
  const allEnv = allOurEnv(ports);
  const startedAt = Date.now();

  const persisted = loadState();
  const serverFlags = {};
  const serverSeenAt = {};
  for (const name of UPSTREAM_NAMES) {
    const saved = persisted.serverFlags?.[name];
    serverFlags[name] = saved && typeof saved === 'object' ? saved : null;
    serverSeenAt[name] = Number(persisted.serverSeenAt?.[name]) || null;
  }
  // The page asks for the flag list again when this number changes. It starts at the start
  // time, so that a page that was open before a restart never meets a number it already has.
  let serverVersion = startedAt;

  const lastInjection = {};
  const lastSignature = {};
  const pageGroups = uiPatchGroups(catalogFile);
  // The display names in the model list of the client. They are read only while a feature needs them.
  let modelNames = Array.isArray(persisted.modelNames) ? persisted.modelNames.filter((name) => typeof name === 'string').slice(0, 200) : [];
  let lastScript = null;
  let pageError = null;
  // Title requests of the desktop app: how many were changed, and how many could not be
  // changed because the client words its instruction differently now.
  const titles = { rewritten: 0, rewrittenAt: null, changed: 0, changedAt: null, skipped: 0 };
  const templates = { seenAt: null, profiles: 0, changed: 0, inserted: 0, missing: 0 };
  const skills = createSkillManager({ ...(builtinDir ? { builtinDir } : {}), backupDir: files.skillsBackup(), log });
  // The word list for the Chinese interface. It is a file of agy-plus itself.
  const dictionary = loadDictionary(l10nFile);
  if (!dictionary) log('word list for the Chinese interface: cannot be read');
  // byClient counts who sent the requests. Only the desktop app is changed; the rest pass through.
  const traffic = { requests: 0, failures: 0, lastFailure: null, byClient: { desktop: 0, cli: 0, other: 0 }, agents: {} };
  // Flag-config requests of a sender that is neither the desktop app nor the command line, as
  // long as no request named the desktop app in between: { firstAt, lastAt, agent }.
  let unrecognized = null;
  const lastFailureLog = {};
  let envState = { status: 'pending', conflicts: {} };
  let stopped = false;
  let restarting = false;

  function onConfig(report) {
    const entry = {
      at: report.at,
      kind: report.kind,
      ok: report.ok,
      applied: report.applied || [],
      skipped: report.skipped || [],
      error: report.error || null,
    };
    // The model list is only read for its display names. It must not replace the status or
    // the flag list of the flag response that comes from the same host.
    const isModels = report.kind === MODELS_KIND;
    const slot = isModels ? `${report.upstream}:models` : report.upstream;
    if (!isModels) lastInjection[report.upstream] = entry;
    if (isModels && report.ok && Array.isArray(report.names) && report.names.length > 0) {
      if (JSON.stringify(report.names) !== JSON.stringify(modelNames)) {
        modelNames = report.names;
        saveState({ serverFlags, serverSeenAt, modelNames });
      }
    }
    if (isModels && report.ok && report.templates) {
      templates.seenAt = report.at;
      templates.profiles = report.templates.profiles;
      templates.changed = report.templates.changed;
      templates.inserted = report.templates.inserted;
      templates.missing = report.templates.missing;
    }
    const signature = JSON.stringify([entry.ok, entry.applied, entry.skipped, entry.error, report.templates || null]);
    if (signature !== lastSignature[slot]) {
      lastSignature[slot] = signature;
      const tplNote = report.templates
        ? `, templates profiles=${report.templates.profiles} override=${report.templates.changed} inserted=${report.templates.inserted} markers_missing=${report.templates.missing}`
        : '';
      log(
        `${report.upstream} ${report.kind}: ${entry.ok ? 'ok' : 'NOT PATCHED'}, applied ${entry.applied.length}` +
          tplNote +
          (entry.skipped.length ? `, skipped ${entry.skipped.map((s) => s.name).join(' ')}` : '') +
          (entry.error ? `, ${entry.error}` : '')
      );
    }
    if (!isModels && report.ok && report.server) {
      const compact = compactFlags(report.server);
      serverSeenAt[report.upstream] = report.at;
      if (JSON.stringify(compact) !== JSON.stringify(serverFlags[report.upstream])) {
        serverFlags[report.upstream] = compact;
        serverVersion += 1;
        saveState({ serverFlags, serverSeenAt, modelNames });
      }
    }
  }

  function onRequest(report) {
    traffic.requests += 1;
    const who = Object.hasOwn(traffic.byClient, report.client) ? report.client : 'other';
    traffic.byClient[who] += 1;
    if (report.agent) traffic.agents[who] = report.agent;
    if (who === 'desktop') {
      unrecognized = null;
    } else if (who === 'other' && report.kind && report.kind !== MODELS_KIND && report.status === 200) {
      const now = Date.now();
      unrecognized = { firstAt: unrecognized?.firstAt ?? now, lastAt: now, agent: report.agent || '' };
    }
    if (report.title && Object.hasOwn(titles, report.title)) {
      titles[report.title] += 1;
      if (report.title !== 'skipped') titles[`${report.title}At`] = Date.now();
      if (report.title === 'changed' && titles.changed === 1) log('conversation title: the instruction of the client has changed, the title request was NOT changed');
    }
    if (report.status !== 502 || !report.error) return;
    traffic.failures += 1;
    traffic.lastFailure = { at: Date.now(), upstream: report.upstream, error: report.error };
    const last = lastFailureLog[report.upstream] || 0;
    if (Date.now() - last > 5000) {
      lastFailureLog[report.upstream] = Date.now();
      log(`${report.upstream} upstream request failed: ${report.error}`);
    }
  }

  const identity = () => ({ pid: process.pid, version: VERSION });
  const getFlags = () => (config.enabled ? config.flags : {});
  // ---- page files ---------------------------------------------------------------------

  /** What the client gets for a flag: the override, else what the server sends. */
  const flagOn = (name) => {
    if (Object.hasOwn(config.flags, name)) return config.flags[name] === true;
    return UPSTREAM_NAMES.some((upstream) => {
      const info = serverFlags[upstream]?.[name];
      return info?.type === 'boolValue' && info.value === true;
    });
  };
  const groupOn = (group) =>
    group.flags.every((flag) => config.flags[flag] === true) &&
    (!group.feature || config.features[group.feature] === true) &&
    group.requires.every(flagOn);
  const pageFeatureOn = (patch) => config.enabled && pageGroups.some((group) => group.patch === patch && groupOn(group));
  const pricesOn = () => pageFeatureOn(PART_COSTS);
  const titlesOn = () => config.enabled && config.features.chineseTitles === true;
  const activeTemplates = () =>
    config.enabled ? effectiveTemplates({ features: config.features, templates: config.templates }) : [];
  // A feature of agy-plus that changes the page. The client loads its page when it starts.
  const pageFeatures = new Set(pageGroups.map((group) => group.feature).filter(Boolean));
  /** Does the running client need a restart for the step from `before` to `after`? */
  const restartNeeded = (before, after) =>
    JSON.stringify(before.flags) !== JSON.stringify(after.flags) ||
    JSON.stringify(before.templates || []) !== JSON.stringify(after.templates || []) ||
    Object.keys(BUILTIN_TEMPLATES).some((name) => before.features[name] !== after.features[name]) ||
    FEATURE_NAMES.some((name) => pageFeatures.has(name) && before.features[name] !== after.features[name]);

  // ---- prices & builtin skills --------------------------------------------------------

  const prices = createPriceStore({ file: files.prices(), log, ...(fetchPriceList ? { fetchList: fetchPriceList } : {}) });
  /** The price list is downloaded only while the feature that uses it is on. */
  function syncPrices() {
    if (!stopped && pricesOn()) prices.refreshIfStale();
  }
  function syncSkills() {
    if (!stopped) skills.reconcile(config.enabled ? config.disabledSkills : []);
  }

  let bundle = null;
  /** The page archive of the installed language server. Found again when that program changes. */
  function getBundle() {
    const binDir = path.join(config.appPath, 'Contents', 'Resources', 'bin');
    const real = path.join(binDir, 'language_server.real');
    const file = fs.existsSync(real) ? real : path.join(binDir, 'language_server');
    const stat = fs.statSync(file);
    if (!bundle || bundle.file !== file || bundle.size !== stat.size || bundle.mtimeMs !== stat.mtimeMs) {
      bundle = null;
      bundle = findUiBundle(file);
    }
    return bundle;
  }

  /** The page variable may be set only when the page files can really be served. */
  function pageReady() {
    try {
      getBundle();
      pageError = null;
      return true;
    } catch (err) {
      const message = String(err?.message || err);
      if (message !== pageError) log(`page files: ${message}`);
      pageError = message;
      return false;
    }
  }

  /**
   * The variables the login session should have now, in the groups that are set together.
   * The two forwarder variables are one group: one without the other would split the traffic.
   * The page-file variable stands alone, and it stays while rewriting is off: the settings
   * page, where rewriting is turned on again, is in the page files.
   */
  function wantedGroups() {
    const groups = [];
    if (config.enabled) groups.push(baseEnv);
    if (pageReady()) groups.push(pageEnv);
    return groups;
  }

  const forwarders = UPSTREAM_NAMES.map((name) => ({
    name,
    port: ports[name],
    server: createForwarder({
      name,
      upstream: config.upstreams[name],
      getFlags,
      getTemplates: activeTemplates,
      wantModelNames: pricesOn,
      wantChineseTitles: titlesOn,
      onConfig,
      onRequest,
      identity,
    }),
  }));

  // One flag can come from both hosts. The page shows one row for it.
  function mergedServerFlags() {
    const out = {};
    for (const name of UPSTREAM_NAMES) {
      for (const [flag, info] of Object.entries(serverFlags[name] || {})) {
        if (!out[flag]) out[flag] = { type: info.type, value: info.value, sources: [name] };
        else {
          out[flag].sources.push(name);
          if (out[flag].type !== info.type || out[flag].value !== info.value) {
            // aicode is the response the client asks for every minute; show that value.
            out[flag] = { type: info.type, value: info.value, sources: out[flag].sources, differs: true };
          }
        }
      }
    }
    return out;
  }

  function serverTypeOf(flag) {
    for (const name of UPSTREAM_NAMES) {
      const info = serverFlags[name]?.[flag];
      if (info?.type) return info.type;
    }
    return null;
  }

  let envQueue = Promise.resolve();
  function reconcileEnv() {
    envQueue = envQueue.then(async () => {
      if (stopped) return;
      try {
        const groups = wantedGroups();
        const wanted = Object.assign({}, ...groups);
        const unwanted = Object.fromEntries(Object.entries(allEnv).filter(([name]) => !Object.hasOwn(wanted, name)));
        const conflicts = {};
        let failed = false;
        // A group that another program is in the way of is left out. The other group is still
        // set: with the page variable alone, the settings page is there to say what is wrong.
        for (const group of groups) {
          const result = await applyEnv(runner, group);
          Object.assign(conflicts, result.conflicts);
          if (!result.ok && Object.keys(result.conflicts).length === 0) failed = true;
        }
        await clearEnv(runner, unwanted);
        const names = Object.keys(wanted).length;
        const status = names === 0 ? 'cleared' : failed ? 'error' : Object.keys(conflicts).length > 0 ? 'conflict' : 'set';
        if (status !== envState.status || names !== envState.names) {
          log(`environment variables: ${status === 'cleared' ? 'cleared (rewriting is off, and the page files cannot be served)' : `${status} (${names})`}`);
        }
        envState = { status, conflicts, names };
      } catch (err) {
        envState = { status: 'error', conflicts: {} };
        log(`environment variables: ${err?.message || err}`);
      }
      getEnv.invalidate();
    });
    return envQueue;
  }

  function writeConfig(next) {
    saveConfig(next);
    config = loadConfig();
    mtime = configMtime();
  }

  // config.json edited by hand: pick the change up.
  async function reloadFromDisk() {
    const next = loadConfig();
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!same(next.ports, ports) || !same(next.upstreams, config.upstreams)) {
      log('ports or upstreams changed in config.json: stopping so that the service manager restarts the daemon');
      await stop();
      onFatal('config-changed');
      return;
    }
    const enabledChanged = next.enabled !== config.enabled;
    const templatesChanged = !same(next.templates, config.templates);
    const skillsChanged = !same(next.disabledSkills, config.disabledSkills);
    const flagsChanged = !same(next.flags, config.flags) || !same(next.features, config.features) || templatesChanged || skillsChanged;
    const restart = enabledChanged || restartNeeded(config, next);
    config = next;
    if (enabledChanged || flagsChanged) {
      log(`config.json changed on disk (${Object.keys(config.flags).length} overrides, enabled=${config.enabled})`);
      if (restart) writeConfig({ ...config, flagsChangedAt: Date.now() });
    }
    if (enabledChanged) await reconcileEnv();
    if (enabledChanged || skillsChanged) syncSkills();
    syncPrices();
  }

  const getApp = cached(() => client.appInfo(config.appPath), 30_000);
  const getClient = cached(() => client.clientState(config.appPath), 1500);
  const getEnv = cached(() => readEnv(runner, allEnv), 1500);

  async function getState() {
    const [app, cl, env] = await Promise.all([getApp(), getClient(), getEnv()]);
    // The client should carry the page variable while we can set it and serve the files.
    const wantPage = pageReady() && !Object.keys(pageEnv).some((name) => Object.hasOwn(envState.conflicts, name));
    const pend = computePending({
      enabled: config.enabled,
      client: cl,
      base: baseEnv,
      page: pageEnv,
      wantPage,
      changedAt: config.flagsChangedAt,
    });
    const warnings = [];
    if (!app.installed) warnings.push({ code: 'app-missing', detail: config.appPath });
    if (envState.status === 'conflict') {
      warnings.push({ code: 'env-conflict', detail: Object.keys(envState.conflicts).join(', ') });
    }
    if (envState.status === 'error') warnings.push({ code: 'env-error', detail: '' });
    if (cl.endpointArg && pend.routed) {
      let argOrigin = cl.endpointArg;
      try {
        argOrigin = new URL(cl.endpointArg).origin;
      } catch {
        // compared as text
      }
      if (argOrigin !== config.upstreams.cloudcode) {
        warnings.push({ code: 'endpoint-mismatch', detail: `${argOrigin} ≠ ${config.upstreams.cloudcode}` });
      }
    }
    for (const name of UPSTREAM_NAMES) {
      const last = lastInjection[name];
      if (last && !last.ok) warnings.push({ code: 'not-patched', detail: `${name}: ${last.error || ''}` });
      if (last && last.skipped.length > 0) {
        warnings.push({ code: 'skipped', detail: last.skipped.map((s) => `${s.name} (${s.reason})`).join(', ') });
      }
    }
    // The desktop app runs through us and asks for its flags about once a minute. If flag
    // requests with an unknown name keep arriving for longer than that, and none names the
    // desktop app, the app has probably changed its name: its flags now pass through unchanged.
    // The wait keeps a third program from raising the warning between two requests of the app.
    if (
      config.enabled &&
      pend.routed &&
      cl.lsStartedAt !== null &&
      unrecognized &&
      unrecognized.lastAt >= cl.lsStartedAt &&
      Date.now() - unrecognized.firstAt >= unrecognizedGraceMs
    ) {
      warnings.push({ code: 'desktop-not-recognized', detail: unrecognized.agent || '?' });
    }
    if (pageError) warnings.push({ code: 'page-unavailable', detail: pageError });
    for (const part of [PART_SETTINGS, PART_INDICATOR, PART_COSTS, PART_L10N]) {
      const made = lastScript?.parts?.[part];
      const wanted = part === PART_SETTINGS || pageFeatureOn(part);
      if (wanted && made && !made.ok) warnings.push({ code: 'page-not-changed', detail: made.reason || '' });
    }
    // The last title request could not be changed: the title of that conversation is in English.
    if (titlesOn() && titles.changedAt !== null && titles.changedAt > (titles.rewrittenAt ?? 0)) {
      warnings.push({ code: 'titles-not-changed', detail: '' });
    }
    const activeTpl = activeTemplates();
    const skillView = skills.status(config.disabledSkills);
    if (activeTpl.length > 0 && templates.seenAt !== null && templates.missing > 0) {
      warnings.push({ code: 'templates-markers-missing', detail: String(templates.missing) });
    }
    if (config.enabled && config.disabledSkills.length > 0 && skillView.available && !skillView.checksumPresent) {
      warnings.push({ code: 'skills-checksum-missing', detail: '' });
    }
    if (traffic.lastFailure && Date.now() - traffic.lastFailure.at < 5 * 60_000) {
      warnings.push({ code: 'upstream-failed', detail: `${traffic.lastFailure.upstream}: ${traffic.lastFailure.error}` });
    }
    const merged = mergedServerFlags();
    return {
      version: VERSION,
      daemon: { pid: process.pid, startedAt },
      enabled: config.enabled,
      ports,
      upstreams: config.upstreams,
      env: { status: envState.status, values: env },
      app: { ...app, path: config.appPath },
      client: {
        running: cl.running,
        lsPid: cl.lsPid,
        lsStartedAt: cl.lsStartedAt,
        routed: pend.routed,
        endpointArg: cl.endpointArg,
      },
      pendingRestart: pend.pending,
      pendingReason: pend.reason,
      restarting,
      overrides: config.flags,
      features: { ...config.features },
      pageLanguage: config.pageLanguage,
      prices: prices.view(modelNames),
      l10n: { ready: dictionary !== null, words: dictionary?.count ?? 0 },
      titles: { ...titles },
      templates: { customCount: config.templates.length, activeCount: activeTpl.length, ...templates },
      skills: skillView,
      changedAt: config.flagsChangedAt,
      server: { version: serverVersion, count: Object.keys(merged).length, seenAt: serverSeenAt },
      lastInjection,
      page: { wanted: wantPage, carried: Object.entries(pageEnv).some(([name, value]) => cl.env?.[name] === value), script: lastScript },
      traffic: { ...traffic, byClient: { ...traffic.byClient }, agents: { ...traffic.agents } },
      warnings,
    };
  }

  /** The overrides after `changes`, or the reason why the changes are refused. */
  function flagsAfter(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      return { ok: false, error: 'bad-request' };
    }
    const entries = Object.entries(changes);
    if (entries.length === 0 || entries.length > 500) return { ok: false, error: 'bad-request' };
    const flags = { ...config.flags };
    for (const [name, value] of entries) {
      if (!isValidFlagName(name)) return { ok: false, error: 'bad-name', name };
      if (value === null) {
        delete flags[name];
        continue;
      }
      const isInteger = typeof value === 'number' && Number.isSafeInteger(value);
      if (typeof value !== 'boolean' && !isInteger) return { ok: false, error: 'bad-value', name };
      // The page changes booleans and integers. A flag keeps the type the server gives it.
      const type = serverTypeOf(name);
      if (type && type !== (isInteger ? 'intValue' : 'boolValue')) {
        return { ok: false, error: 'server-type', name, type };
      }
      flags[name] = value;
    }
    if (Object.keys(flags).length > MAX_OVERRIDES) return { ok: false, error: 'too-many' };
    return { ok: true, flags };
  }

  /** Write new overrides or features, when they differ from what is set. */
  async function applyChange({ flags = config.flags, features = config.features }) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (same(flags, config.flags) && same(features, config.features)) return;
    const flagsChanged = !same(flags, config.flags);
    // A feature that changes requests only works at once, without a restart of the client.
    const restart = restartNeeded(config, { flags, features });
    writeConfig({ ...config, flags, features, ...(restart ? { flagsChangedAt: Date.now() } : {}) });
    if (flagsChanged) log(`overrides changed: ${Object.keys(config.flags).length} in total`);
    else log(`features changed: ${FEATURE_NAMES.filter((name) => config.features[name]).join(', ') || 'none'}`);
    syncPrices();
  }

  const actions = {
    /** changes: { name: true | false | integer | null }. null removes the override. */
    async setFlags(changes) {
      const next = flagsAfter(changes);
      if (!next.ok) return next;
      await applyChange({ flags: next.flags });
      return { ok: true };
    },

    /**
     * changes: { featureName: true | false }. `flagChanges` are made in the same step: a
     * feature can need a flag of another group, and that flag is turned on together with it.
     */
    async setFeatures(changes, flagChanges) {
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return { ok: false, error: 'bad-request' };
      const entries = Object.entries(changes);
      if (entries.length === 0) return { ok: false, error: 'bad-request' };
      const features = { ...config.features };
      for (const [name, value] of entries) {
        if (!FEATURE_NAMES.includes(name)) return { ok: false, error: 'bad-name', name };
        if (typeof value !== 'boolean') return { ok: false, error: 'bad-value', name };
        features[name] = value;
      }
      let flags = config.flags;
      if (flagChanges !== undefined) {
        const next = flagsAfter(flagChanges);
        if (!next.ok) return next;
        flags = next.flags;
      }
      await applyChange({ flags, features });
      return { ok: true };
    },

    /** changes: { skillName: true (enabled) | false (disabled) }. */
    async setSkills(changes) {
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return { ok: false, error: 'bad-request' };
      const entries = Object.entries(changes);
      if (entries.length === 0 || entries.length > 200) return { ok: false, error: 'bad-request' };
      const disabled = new Set(config.disabledSkills);
      for (const [name, value] of entries) {
        if (!isValidSkillName(name)) return { ok: false, error: 'bad-name', name };
        if (typeof value !== 'boolean') return { ok: false, error: 'bad-value', name };
        if (value) disabled.delete(name);
        else disabled.add(name);
      }
      const nextDisabled = [...disabled];
      if (JSON.stringify(nextDisabled) !== JSON.stringify(config.disabledSkills)) {
        writeConfig({ ...config, disabledSkills: nextDisabled });
        log(`disabled skills changed: ${nextDisabled.join(', ') || 'none'}`);
        syncSkills();
      }
      return { ok: true };
    },

    /** Download the price list now. */
    async refreshPrices() {
      if (!pricesOn()) return { ok: false, error: 'feature-off' };
      const result = await prices.refresh();
      return result.ok ? { ok: true } : { ok: false, error: 'download-failed', detail: result.error };
    },

    async setEnabled(enabled) {
      if (typeof enabled !== 'boolean') return { ok: false, error: 'bad-request' };
      if (enabled !== config.enabled) {
        writeConfig({ ...config, enabled, flagsChangedAt: Date.now() });
        log(`injection turned ${enabled ? 'on' : 'off'}`);
        await reconcileEnv();
        syncSkills();
      }
      return { ok: true };
    },

    /** The language of this page: 'auto', 'zh' or 'en'. Takes effect at once. */
    async setPageLanguage(language) {
      if (!PAGE_LANGUAGES.includes(language)) return { ok: false, error: 'bad-value' };
      if (language !== config.pageLanguage) {
        writeConfig({ ...config, pageLanguage: language });
        log(`page language: ${language}`);
      }
      return { ok: true };
    },

    async restartClient() {
      if (restarting) return { ok: false, error: 'busy' };
      restarting = true;
      try {
        const result = await client.restartClient(config.appPath);
        log(`client restart: ${result.ok ? `ok (${result.method})` : result.error}`);
        return result;
      } finally {
        restarting = false;
        getClient.invalidate();
      }
    },
  };

  // The requests of the settings page.
  const api = createApi({
    catalogFile,
    getState,
    getServerFlags: () => ({ version: serverVersion, flags: mergedServerFlags() }),
    actions,
    peerCheck,
  });

  const uiServer = createUiServer({
    getBundle,
    api,
    wantIndicator: () => pageFeatureOn(PART_INDICATOR),
    getPrices: () => (pricesOn() ? prices.table() : false),
    getL10n: () => (pageFeatureOn(PART_L10N) ? (dictionary ? { version: dictionary.version, data: dictionary.data } : null) : false),
    // The client can ask for its script while the first download of the prices still runs.
    beforeScript: () => (pricesOn() && !prices.table() ? prices.settled(priceWaitMs) : undefined),
    onScript: (report) => {
      lastScript = report;
      const made = Object.entries(report.parts).filter(([, part]) => part.ok).map(([name]) => name);
      log(`page script: ${made.length > 0 ? `changed (${made.join(', ')})` : 'not changed'}${report.reason ? `, NOT DONE: ${report.reason}` : ''}`);
    },
    identity,
  });

  const servers = [
    ...forwarders.map((f) => ({ name: f.name, port: f.port, server: f.server })),
    { name: 'devui', port: ports.devui, server: uiServer },
  ];

  async function closeAll() {
    await Promise.all(servers.map((s) => closeServer(s.server)));
  }

  for (const entry of servers) {
    try {
      await listen(entry.server, entry.port);
    } catch (err) {
      await closeAll();
      if (err?.code !== 'EADDRINUSE') throw err;
      const other = await ping(entry.port);
      if (other) {
        // Another copy of us is serving. Its variables are valid; leave them alone.
        log(`port ${entry.port} is served by another agy-plus (pid ${other.pid ?? '?'})`);
        return { status: 'already-running' };
      }
      // Nobody of ours is listening. A variable that still points at us would break the client.
      await clearEnv(runner, allEnv).catch(() => {});
      const error = new Error(`port ${entry.port} (${entry.name}) is used by another program`);
      error.code = 'PORT_IN_USE';
      error.port = entry.port;
      throw error;
    }
  }

  for (const port of [...forwarders.map((f) => f.port), ports.devui]) {
    const answer = await ping(port);
    if (!answer || answer.pid !== process.pid) {
      await closeAll();
      await clearEnv(runner, allEnv).catch(() => {});
      throw new Error(`self-check failed on port ${port}`);
    }
  }
  log(`listening: cloudcode ${ports.cloudcode}, aicode ${ports.aicode}, page files and settings page ${ports.devui}`);

  await reconcileEnv();
  syncSkills();
  syncPrices();

  const pollTimer = setInterval(() => {
    if (stopped) return;
    const now = configMtime();
    if (now === mtime) return;
    mtime = now;
    reloadFromDisk().catch((err) => log(`config reload failed: ${err?.message || err}`));
  }, pollMs);
  // Somebody may unset or change the variables while we run, or an app update may unpack builtin skills again.
  const envTimer = setInterval(() => {
    reconcileEnv();
    syncSkills();
  }, envCheckMs);
  const priceTimer = setInterval(syncPrices, priceCheckMs);
  pollTimer.unref?.();
  envTimer.unref?.();
  priceTimer.unref?.();

  async function stop() {
    if (stopped) return;
    await envQueue.catch(() => {});
    stopped = true;
    clearInterval(pollTimer);
    clearInterval(envTimer);
    clearInterval(priceTimer);
    // Variables first, listeners second.
    try {
      await clearEnv(runner, allEnv);
      log('environment variables: cleared (daemon is stopping)');
    } catch (err) {
      log(`could not clear the environment variables: ${err?.message || err}`);
    }
    await closeAll();
  }

  return { status: 'running', stop, getState, ports };
}
