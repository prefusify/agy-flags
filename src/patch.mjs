// Pure functions that rewrite the "experiment flag" responses Antigravity reads.
//
// Shapes seen on the wire (Antigravity 2.34.0 and 2.35.0):
//   POST /v1internal:listExperiments      -> { experimentIds: [...], flags: [entry, ...] }
//   GET  /v1alpha:fetchConfig             -> { experimentConfig: { experimentFlags: [entry, ...] }, ... }
//   POST /v1internal:fetchAvailableModels -> { models: { <id>: { modelExperiments: { experiments: { <name>: value } } } } }
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
 * Write `flags` ({ name: value }) into every model of a parsed model list, in place.
 *
 * Some flags are read per model: the client takes them from the model's own
 * `modelExperiments.experiments`, not from the global list. A flag that a model already
 * carries with a different value type is left alone for that model and reported in `skipped`.
 * @returns {{ applied: string[], skipped: object[], models: number }}
 *          `applied` lists the flags written into at least one model; `models` counts the models changed.
 */
export function patchModelExperiments(data, flags) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('unexpected response shape');
  }
  const result = { applied: [], skipped: [], models: 0 };
  const valid = [];
  for (const [name, value] of Object.entries(flags || {})) {
    if (isValidFlagName(name) && isValidFlagValue(value)) valid.push([name, value]);
    else result.skipped.push({ name, reason: 'invalid override' });
  }
  if (valid.length === 0) return result;
  if (!data.models || typeof data.models !== 'object' || Array.isArray(data.models)) {
    throw new Error('no model list in the response');
  }

  const applied = new Set();
  const mismatched = new Map();
  for (const model of Object.values(data.models)) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) continue;
    const holder = model.modelExperiments ?? {};
    if (typeof holder !== 'object' || Array.isArray(holder)) continue;
    const experiments = holder.experiments ?? {};
    if (typeof experiments !== 'object' || Array.isArray(experiments)) continue;
    let touched = false;
    for (const [name, value] of valid) {
      const wantKey = valueKeyFor(value);
      const existing = Object.hasOwn(experiments, name) ? experiments[name] : null;
      const haveKey = valueKeyOf(existing);
      if (haveKey && haveKey !== wantKey) {
        mismatched.set(name, haveKey);
        continue;
      }
      experiments[name] = makeValue(wantKey, value, existing);
      applied.add(name);
      touched = true;
    }
    if (touched) {
      holder.experiments = experiments;
      model.modelExperiments = holder;
      result.models += 1;
    }
  }
  result.applied = valid.map(([name]) => name).filter((name) => applied.has(name));
  for (const [name, haveKey] of mismatched) {
    result.skipped.push({ name, reason: `a model sends ${haveKey}` });
  }
  return result;
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

function makeValue(key, value, existing) {
  const out = {};
  if (existing && typeof existing === 'object') {
    for (const [k, v] of Object.entries(existing)) {
      if (!VALUE_KEYS.includes(k)) out[k] = v;
    }
  }
  out[key] = key === 'intValue' ? String(value) : value;
  return out;
}
