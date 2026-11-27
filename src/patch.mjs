// Pure functions that rewrite the "experiment flag" and model-list responses Antigravity reads.
//
// Shapes seen on the wire (Antigravity 2.34.0 and 2.35.0):
//   POST /v1internal:listExperiments      -> { experimentIds: [...], flags: [entry, ...] }
//   GET  /v1alpha:fetchConfig             -> { experimentConfig: { experimentFlags: [entry, ...] }, ... }
//   POST /v1internal:fetchAvailableModels -> { models: { <id>: { displayName, modelExperiments, ... } } }
//   entry = { name, [flagId], <exactly one value key> }
//   value = { <exactly one value key> }
// Integers travel as strings ("intValue": "300").

export const VALUE_KEYS = Object.freeze([
  'boolValue',
  'intValue',
  'stringValue',
  'floatValue',
  'stringListValue',
  'int32ListValue',
]);

const NAME_RE = /^[A-Za-z0-9_.:-]{1,160}$/;

export function isValidFlagName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

/** An override can be a boolean, an integer or a short string. */
export function isValidFlagValue(value) {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  return typeof value === 'string' && value.length <= 4096;
}

/** The model list. Each model carries its own copy of some flags. */
export const MODELS_KIND = 'fetchAvailableModels';

/** Which response a request path is, or null for traffic that is passed through. */
export function kindOf(pathname) {
  if (typeof pathname !== 'string') return null;
  if (pathname.endsWith(':listExperiments')) return 'listExperiments';
  if (pathname.endsWith(':fetchConfig') || pathname.endsWith('/FetchConfig')) return 'fetchConfig';
  if (pathname.endsWith(':fetchAvailableModels')) return MODELS_KIND;
  return null;
}

export function valueKeyOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return VALUE_KEYS.find((key) => Object.hasOwn(entry, key)) ?? null;
}

export function valueKeyFor(value) {
  if (typeof value === 'boolean') return 'boolValue';
  if (typeof value === 'number') return 'intValue';
  return 'stringValue';
}

function flagList(kind, data, create) {
  if (kind === 'listExperiments') {
    if (!Array.isArray(data.flags)) {
      if (!create) return null;
      data.flags = [];
    }
    return data.flags;
  }
  if (!data.experimentConfig || typeof data.experimentConfig !== 'object') {
    if (!create) return null;
    data.experimentConfig = {};
  }
  if (!Array.isArray(data.experimentConfig.experimentFlags)) {
    if (!create) return null;
    data.experimentConfig.experimentFlags = [];
  }
  return data.experimentConfig.experimentFlags;
}

/** Keep every field we do not understand (flagId, ...) and replace only the value. */
function makeEntry(name, key, value, existing) {
  const entry = {};
  if (existing) {
    for (const [k, v] of Object.entries(existing)) {
      if (!VALUE_KEYS.includes(k)) entry[k] = v;
    }
  }
  entry.name = name;
  entry[key] = key === 'intValue' ? String(value) : value;
  return entry;
}

/**
 * Apply `flags` ({ name: value }) to a parsed response, in place.
 * A flag the server sends with a different value type is left alone and reported in `skipped`.
 */
export function patchFlagConfig(kind, data, flags) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('unexpected response shape');
  }
  const result = { applied: [], skipped: [] };
  const names = Object.keys(flags || {});
  if (names.length === 0) return result;

  const list = flagList(kind, data, true);
  const position = new Map();
  list.forEach((entry, i) => {
    if (entry && typeof entry === 'object' && typeof entry.name === 'string' && !position.has(entry.name)) {
      position.set(entry.name, i);
    }
  });

  for (const name of names) {
    const value = flags[name];
    if (!isValidFlagName(name) || !isValidFlagValue(value)) {
      result.skipped.push({ name, reason: 'invalid override' });
      continue;
    }
    const wantKey = valueKeyFor(value);
    const i = position.get(name);
    if (i === undefined) {
      list.push(makeEntry(name, wantKey, value, null));
      result.applied.push(name);
      continue;
    }
    const haveKey = valueKeyOf(list[i]);
    if (haveKey && haveKey !== wantKey) {
      result.skipped.push({ name, reason: `server sends ${haveKey}` });
      continue;
    }
    list[i] = makeEntry(name, wantKey, value, list[i]);
    result.applied.push(name);
  }

  if (kind === 'listExperiments' && Array.isArray(data.filteredFlags)) {
    const applied = new Set(result.applied);
    data.filteredFlags = data.filteredFlags.filter(
      (entry) => !(entry && typeof entry === 'object' && applied.has(entry.name))
    );
  }
  return result;
}

/** { name: { type, value } } for every flag in a parsed response. Call it before patching. */
export function summarizeFlags(kind, data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  const list = flagList(kind, data, false);
  if (!list) return out;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') continue;
    const key = valueKeyOf(entry);
    out[entry.name] = key ? { type: key, value: entry[key] } : { type: null, value: null };
  }
  return out;
}

/**
 * The display names in a parsed model list, as the client shows them. Each is a short text;
 * the settings page shows them as text.
 */
export function modelDisplayNames(data) {
  const names = new Set();
  const models = data?.models;
  if (!models || typeof models !== 'object' || Array.isArray(models)) return [];
  for (const model of Object.values(models)) {
    const name = model?.displayName;
    if (typeof name !== 'string') continue;
    const text = name.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 80);
    if (text) names.add(text);
    if (names.size >= 200) break;
  }
  return [...names];
}

// ---- per-model template overrides ---------------------------------------------------

export const TEMPLATE_ACTIONS = Object.freeze(['section_override', 'set_value', 'drop_field']);
export const TEMPLATE_WHEN_ABSENT = Object.freeze(['skip', 'insert']);

// A Go template comment renders to nothing. An empty string would not do: the language server
// can treat it as absent and fall back to the template compiled into it.
const EMPTY_TEMPLATE = '{{- /* local template override */ -}}';

/**
 * Built-in override for the leading section of the per-model guidelines template: the rules
 * against bypassing access controls and against solving CAPTCHAs (and, in the Gemini 4
 * Hydrogen template, the one about keeping comments). Models without the template get the
 * empty one, so the compiled-in default with the same rules is not used either.
 */
export const BUILTIN_GUIDELINES_TEMPLATE = Object.freeze({
  path: 'models/*/modelExperiments/experiments/template__system_prompts__guidelines/stringValue',
  action: 'section_override',
  match: Object.freeze({
    start: 'Follow these behavioral guidelines at all times:',
    end: '{{- if and $includeECR',
  }),
  replace_with: EMPTY_TEMPLATE,
  when_absent: 'insert',
});

/** Built-in override that empties the section telling the model to recommend slash commands. */
export const BUILTIN_SLASH_COMMANDS_TEMPLATE = Object.freeze({
  path: 'models/*/modelExperiments/experiments/template__system_prompts__slash_commands/stringValue',
  action: 'set_value',
  replace_with: EMPTY_TEMPLATE,
  when_absent: 'insert',
});

/** The built-in template rules, each under the feature of agy-plus (config.features) that turns it on. */
export const BUILTIN_TEMPLATES = Object.freeze({
  guidelinesOverride: BUILTIN_GUIDELINES_TEMPLATE,
  slashCommandsOverride: BUILTIN_SLASH_COMMANDS_TEMPLATE,
});

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_TEMPLATE_TEXT = 65536;
const MAX_MARKER_TEXT = 4096;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Split `root/<wildcard>/mid/deep/key/leaf` into its five object keys, or null when malformed.
export function splitTemplatePath(templatePath) {
  if (typeof templatePath !== 'string') return null;
  const segs = templatePath.split('/');
  if (segs.length !== 6 || segs[1] !== '*') return null;
  for (let i = 0; i < segs.length; i += 1) {
    if (i === 1) continue;
    if (!NAME_RE.test(segs[i]) || UNSAFE_KEYS.has(segs[i])) return null;
  }
  return [segs[0], segs[2], segs[3], segs[4], segs[5]];
}

/** Validate and normalize one template target entry, or return null when invalid. */
export function normalizeTemplateTarget(raw) {
  if (!isPlainObject(raw)) return null;
  if (!splitTemplatePath(raw.path)) return null;
  const action = raw.action === undefined ? 'section_override' : raw.action;
  if (!TEMPLATE_ACTIONS.includes(action)) return null;
  const whenAbsent = action === 'drop_field' ? 'skip' : raw.when_absent === undefined ? 'skip' : raw.when_absent;
  if (!TEMPLATE_WHEN_ABSENT.includes(whenAbsent)) return null;

  const out = { path: raw.path, action };
  if (action === 'section_override') {
    if (!isPlainObject(raw.match)) return null;
    const { start, end } = raw.match;
    if (typeof start !== 'string' || start.length === 0 || start.length > MAX_MARKER_TEXT) return null;
    if (typeof end !== 'string' || end.length === 0 || end.length > MAX_MARKER_TEXT) return null;
    out.match = { start, end };
  }
  if (action !== 'drop_field') {
    const body = raw.replace_with === undefined ? '' : raw.replace_with;
    if (typeof body !== 'string' || body.length > MAX_TEMPLATE_TEXT) return null;
    out.replace_with = body;
  }
  if (whenAbsent === 'insert') out.when_absent = 'insert';
  return out;
}

/** Replace the region from `start` up to (not including) `end` with `body`. */
export function sectionOverride(text, start, end, body) {
  if (typeof text !== 'string' || !start || !end) return { text, matched: false };
  const a = text.indexOf(start);
  if (a < 0) return { text, matched: false };
  const b = text.indexOf(end, a + start.length);
  if (b < 0) return { text, matched: false };
  return { text: text.slice(0, a) + body + text.slice(b), matched: true };
}

/**
 * Apply one template target across every model entry under the wildcard root.
 * Returns `{ changed, inserted, missing }` where `missing` counts entries that carry a
 * string at `path` but no longer contain both markers in order.
 */
export function applyTemplateTarget(data, target) {
  const parts = splitTemplatePath(target?.path);
  if (!parts) throw new Error(`invalid template path: ${target?.path}`);
  const [root, mid, deep, key, leaf] = parts;
  const action = target.action || 'section_override';
  const whenAbsent = target.when_absent || 'skip';
  const body = typeof target.replace_with === 'string' ? target.replace_with : '';
  const start = target.match?.start ?? '';
  const end = target.match?.end ?? '';

  let changed = 0;
  let inserted = 0;
  let missing = 0;

  if (!isPlainObject(data)) return { changed, inserted, missing };
  const entries = data[root];
  if (!isPlainObject(entries)) return { changed, inserted, missing };

  for (const entry of Object.values(entries)) {
    if (!isPlainObject(entry)) continue;
    const midBox = isPlainObject(entry[mid]) ? entry[mid] : null;
    const deepBox = midBox && isPlainObject(midBox[deep]) ? midBox[deep] : null;
    const current = deepBox && Object.hasOwn(deepBox, key) ? deepBox[key] : undefined;

    if (action === 'drop_field') {
      if (deepBox && Object.hasOwn(deepBox, key)) {
        delete deepBox[key];
        changed += 1;
      }
      continue;
    }

    if (isPlainObject(current) && typeof current[leaf] === 'string') {
      const text = current[leaf];
      if (action === 'set_value') {
        if (text !== body) {
          current[leaf] = body;
          changed += 1;
        }
        continue;
      }
      const out = sectionOverride(text, start, end, body);
      if (!out.matched) {
        missing += 1;
      } else if (out.text !== text) {
        current[leaf] = out.text;
        changed += 1;
      }
      continue;
    }

    if (whenAbsent === 'insert') {
      if (!Object.hasOwn(entry, mid) || entry[mid] === undefined) entry[mid] = {};
      if (!isPlainObject(entry[mid])) continue;
      const container = entry[mid];
      if (!Object.hasOwn(container, deep) || container[deep] === undefined) container[deep] = {};
      if (!isPlainObject(container[deep])) continue;
      container[deep][key] = { [leaf]: body };
      inserted += 1;
    }
  }

  return { changed, inserted, missing };
}

/** Apply a list of template targets in place to a parsed `fetchAvailableModels` payload. */
export function patchModelTemplates(data, templates) {
  if (!isPlainObject(data)) throw new Error('unexpected response shape');
  const profiles = isPlainObject(data.models) ? Object.keys(data.models).length : 0;
  let changed = 0;
  let inserted = 0;
  let missing = 0;
  for (const raw of Array.isArray(templates) ? templates : []) {
    const target = normalizeTemplateTarget(raw);
    if (!target) continue;
    const r = applyTemplateTarget(data, target);
    changed += r.changed;
    inserted += r.inserted;
    missing += r.missing;
  }
  return { profiles, changed, inserted, missing };
}

/**
 * The built-in rules of the features that are on, then the custom rules from `config.json`.
 * A custom rule for the same path replaces the built-in one instead of running after it.
 */
export function effectiveTemplates({ features = {}, templates = [] } = {}) {
  const custom = Array.isArray(templates) ? templates.map(normalizeTemplateTarget).filter(Boolean) : [];
  const customPaths = new Set(custom.map((target) => target.path));
  const builtin = Object.entries(BUILTIN_TEMPLATES)
    .filter(([feature, target]) => features?.[feature] === true && !customPaths.has(target.path))
    .map(([, target]) => target);
  return [...builtin, ...custom];
}
