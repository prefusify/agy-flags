import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_GUIDELINES_TEMPLATE,
  applyTemplateTarget,
  effectiveTemplates,
  isValidFlagName,
  isValidFlagValue,
  kindOf,
  modelDisplayNames,
  normalizeTemplateTarget,
  patchFlagConfig,
  patchModelTemplates,
  splitTemplatePath,
  summarizeFlags,
} from '../src/patch.mjs';

test('kindOf recognises the two flag responses and the model list, and nothing else', () => {
  assert.equal(kindOf('/v1internal:listExperiments'), 'listExperiments');
  assert.equal(kindOf('/v1alpha:fetchConfig'), 'fetchConfig');
  assert.equal(kindOf('/v1internal:fetchAvailableModels'), 'fetchAvailableModels');
  assert.equal(kindOf('/v1internal:streamGenerateContent'), null);
  assert.equal(kindOf('/v1alpha/remote:listConversations'), null);
  assert.equal(kindOf(undefined), null);
});

test('an existing entry keeps flagId and other unknown fields; only the value changes', () => {
  const data = { experimentIds: [1, 2], flags: [{ name: 'a', flagId: 45837903, boolValue: false, future: 'x' }] };
  const result = patchFlagConfig('listExperiments', data, { a: true });
  assert.deepEqual(result, { applied: ['a'], skipped: [] });
  assert.deepEqual(data.flags, [{ name: 'a', flagId: 45837903, future: 'x', boolValue: true }]);
  assert.deepEqual(data.experimentIds, [1, 2]);
});

test('an entry that carries only a flagId gets the value added', () => {
  const data = { flags: [{ name: 'a', flagId: 5 }] };
  patchFlagConfig('listExperiments', data, { a: true });
  assert.deepEqual(data.flags, [{ name: 'a', flagId: 5, boolValue: true }]);
});

test('a flag the server does not send is appended', () => {
  const data = { experimentConfig: { experimentFlags: [{ name: 'a', boolValue: true }] }, availableExperiences: ['x'] };
  const result = patchFlagConfig('fetchConfig', data, { b: true });
  assert.deepEqual(result.applied, ['b']);
  assert.deepEqual(data.experimentConfig.experimentFlags, [
    { name: 'a', boolValue: true },
    { name: 'b', boolValue: true },
  ]);
  assert.deepEqual(data.availableExperiences, ['x']);
});

test('integers travel as strings', () => {
  const data = { flags: [{ name: 'n', intValue: '300' }] };
  patchFlagConfig('listExperiments', data, { n: 600, m: 5 });
  assert.deepEqual(data.flags, [
    { name: 'n', intValue: '600' },
    { name: 'm', intValue: '5' },
  ]);
});

test('a flag with a different type on the server is skipped, not converted', () => {
  const data = { flags: [{ name: 'n', intValue: '300' }, { name: 's', stringValue: 'x' }] };
  const result = patchFlagConfig('listExperiments', data, { n: true, s: false });
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.skipped.map((s) => s.name), ['n', 's']);
  assert.deepEqual(data.flags, [{ name: 'n', intValue: '300' }, { name: 's', stringValue: 'x' }]);
});

test('missing lists are created, also for fetchConfig', () => {
  const a = {};
  patchFlagConfig('listExperiments', a, { x: true });
  assert.deepEqual(a, { flags: [{ name: 'x', boolValue: true }] });
  const b = {};
  patchFlagConfig('fetchConfig', b, { x: false });
  assert.deepEqual(b, { experimentConfig: { experimentFlags: [{ name: 'x', boolValue: false }] } });
});

test('no overrides means the data is not touched at all', () => {
  const data = {};
  assert.deepEqual(patchFlagConfig('fetchConfig', data, {}), { applied: [], skipped: [] });
  assert.deepEqual(data, {});
});

test('an applied flag is removed from filteredFlags', () => {
  const data = { flags: [], filteredFlags: [{ name: 'a' }, { name: 'b' }] };
  patchFlagConfig('listExperiments', data, { a: true });
  assert.deepEqual(data.filteredFlags, [{ name: 'b' }]);
});

test('invalid names and values are skipped', () => {
  const data = { flags: [] };
  const result = patchFlagConfig('listExperiments', data, { 'bad name': true, ok: { nested: 1 } });
  assert.deepEqual(result.applied, []);
  assert.equal(result.skipped.length, 2);
  assert.deepEqual(data.flags, []);
});

test('a response that is not an object is rejected', () => {
  assert.throws(() => patchFlagConfig('listExperiments', [], { a: true }));
  assert.throws(() => patchFlagConfig('listExperiments', null, { a: true }));
});

test('summarizeFlags lists every flag with its type', () => {
  const data = { flags: [{ name: 'a', flagId: 1, boolValue: true }, { name: 'n', intValue: '3' }, { name: 'bare', flagId: 2 }, { junk: 1 }] };
  assert.deepEqual(summarizeFlags('listExperiments', data), {
    a: { type: 'boolValue', value: true },
    n: { type: 'intValue', value: '3' },
    bare: { type: null, value: null },
  });
  assert.deepEqual(summarizeFlags('fetchConfig', {}), {});
});

test('name and value validation', () => {
  assert.ok(isValidFlagName('enable-developer-mode'));
  assert.ok(isValidFlagName('Chat__enable_mcp_server_ij'));
  assert.ok(!isValidFlagName(''));
  assert.ok(!isValidFlagName('a b'));
  assert.ok(!isValidFlagName('<script>'));
  assert.ok(!isValidFlagName('x'.repeat(161)));
  assert.ok(isValidFlagValue(true) && isValidFlagValue(5) && isValidFlagValue('s'));
  assert.ok(!isValidFlagValue(1.5) && !isValidFlagValue(null) && !isValidFlagValue([]));
});

test('the display names of the model list are read as short plain text', () => {
  assert.deepEqual(
    modelDisplayNames({
      models: {
        a: { displayName: 'Gemini 4 Neon (XHigh)' },
        b: { displayName: 'Gemini 4 Neon (XHigh)' },
        c: { displayName: '  Orchestrator (Neon)\u0000\u4e2d ' },
        d: { displayName: 7 },
        e: {},
        f: null,
        g: { displayName: 'x'.repeat(200) },
      },
    }),
    ['Gemini 4 Neon (XHigh)', 'Orchestrator (Neon)', 'x'.repeat(80)]
  );
  for (const odd of [null, {}, { models: [] }, { models: 'x' }]) assert.deepEqual(modelDisplayNames(odd), []);
});

// ---- per-model template overrides ---------------------------------------------------

const TPL_PATH = 'models/*/modelExperiments/experiments/tpl/stringValue';
const makeModelEntry = (value, missing = false) => {
  const model = { modelExperiments: { experiments: {} } };
  if (!missing) model.modelExperiments.experiments.tpl = { stringValue: value };
  return { models: { m1: model } };
};
const makeTarget = (extra = {}) => ({
  path: TPL_PATH,
  action: 'section_override',
  match: { start: 'HEAD:', end: 'TAIL:' },
  replace_with: 'BODY',
  ...extra,
});

test('template actions: section_override, set_value, drop_field, and when_absent', () => {
  // 1. section_override replaces from start up to (not including) end.
  let data = makeModelEntry('lead HEAD: middle TAIL: rest');
  assert.deepEqual(applyTemplateTarget(data, makeTarget()), { changed: 1, inserted: 0, missing: 0 });
  assert.equal(data.models.m1.modelExperiments.experiments.tpl.stringValue, 'lead BODYTAIL: rest');

  // 2. missing end marker leaves the text unchanged and counts missing.
  data = makeModelEntry('lead HEAD: middle');
  assert.deepEqual(applyTemplateTarget(data, makeTarget()), { changed: 0, inserted: 0, missing: 1 });
  assert.equal(data.models.m1.modelExperiments.experiments.tpl.stringValue, 'lead HEAD: middle');

  // End appearing only before start is also treated as missing.
  data = makeModelEntry('TAIL: before HEAD: after');
  assert.deepEqual(applyTemplateTarget(data, makeTarget()), { changed: 0, inserted: 0, missing: 1 });

  // 3. when_absent=insert creates the leaf with replace_with.
  data = makeModelEntry(null, true);
  assert.deepEqual(applyTemplateTarget(data, makeTarget({ when_absent: 'insert' })), { changed: 0, inserted: 1, missing: 0 });
  assert.deepEqual(data.models.m1.modelExperiments.experiments.tpl, { stringValue: 'BODY' });

  // 4. default when_absent skips absent fields.
  data = makeModelEntry(null, true);
  assert.deepEqual(applyTemplateTarget(data, makeTarget()), { changed: 0, inserted: 0, missing: 0 });
  assert.equal(Object.hasOwn(data.models.m1.modelExperiments.experiments, 'tpl'), false);

  // 5. set_value overwrites the leaf.
  data = makeModelEntry('whatever');
  assert.deepEqual(applyTemplateTarget(data, makeTarget({ action: 'set_value' })), { changed: 1, inserted: 0, missing: 0 });
  assert.equal(data.models.m1.modelExperiments.experiments.tpl.stringValue, 'BODY');

  // 6. drop_field deletes the key.
  data = makeModelEntry('whatever');
  assert.deepEqual(applyTemplateTarget(data, makeTarget({ action: 'drop_field' })), { changed: 1, inserted: 0, missing: 0 });
  assert.equal(Object.hasOwn(data.models.m1.modelExperiments.experiments, 'tpl'), false);

  // 7. non-object model entries and empty payloads are tolerated.
  data = { models: { odd: null, ok: { modelExperiments: { experiments: { tpl: { stringValue: 'HEAD:a TAIL:b' } } } } } };
  assert.deepEqual(applyTemplateTarget(data, makeTarget()), { changed: 1, inserted: 0, missing: 0 });
  assert.deepEqual(applyTemplateTarget({}, makeTarget({ when_absent: 'insert' })), { changed: 0, inserted: 0, missing: 0 });
});

test('template path and target validation rejects malformed or unsafe keys', () => {
  assert.deepEqual(splitTemplatePath(TPL_PATH), ['models', 'modelExperiments', 'experiments', 'tpl', 'stringValue']);
  for (const bad of ['models/only/two', 'models/x/a/b/c/d', 'models/*/__proto__/b/c/d', 'models/*/a/constructor/c/d', 'models/*/a/b/prototype/d', null]) {
    assert.equal(splitTemplatePath(bad), null, String(bad));
    assert.equal(normalizeTemplateTarget({ path: bad, action: 'drop_field' }), null);
  }
  assert.throws(() => applyTemplateTarget({}, { path: 'models/only/two' }));
  assert.equal(normalizeTemplateTarget({ path: TPL_PATH, action: 'section_override', match: { start: '', end: 'x' } }), null);
  assert.equal(normalizeTemplateTarget({ path: TPL_PATH, action: 'unknown' }), null);
});

test('built-in guidelines template patches multi-profile fetchAvailableModels responses', () => {
  const key = 'template__system_prompts__guidelines';
  const good =
    `${BUILTIN_GUIDELINES_TEMPLATE.match.start}\n- item a\n- item b\n` +
    `${BUILTIN_GUIDELINES_TEMPLATE.match.end} true }}\n<efficient_code_reading>\nECR\n{{- end }}\n`;
  const models = {};
  for (let i = 0; i < 7; i += 1) {
    models[`good-${i}`] = { modelExperiments: { experiments: { [key]: { stringValue: good } } } };
  }
  models['lead-only'] = { modelExperiments: { experiments: { [key]: { stringValue: `${BUILTIN_GUIDELINES_TEMPLATE.match.start}\n- a\n` } } } };
  for (let i = 0; i < 34; i += 1) {
    models[`absent-${i}`] = { modelExperiments: { experiments: { unrelated: { stringValue: 'x' } } } };
  }
  models['odd-nonstring'] = { modelExperiments: { experiments: { [key]: { stringValue: 123 } } } };

  const payload = { models, defaultAgentModelId: 'good-0' };
  const targets = effectiveTemplates({ guidelinesOverride: true, templates: [] });
  assert.equal(targets.length, 1);
  const stats = patchModelTemplates(payload, targets);
  assert.deepEqual(stats, { profiles: 43, changed: 7, inserted: 35, missing: 1 });
  assert.equal(
    payload.models['good-0'].modelExperiments.experiments[key].stringValue,
    `${BUILTIN_GUIDELINES_TEMPLATE.replace_with}${BUILTIN_GUIDELINES_TEMPLATE.match.end} true }}\n<efficient_code_reading>\nECR\n{{- end }}\n`
  );
  assert.equal(payload.models['absent-0'].modelExperiments.experiments[key].stringValue, BUILTIN_GUIDELINES_TEMPLATE.replace_with);
  assert.equal(payload.models['absent-0'].modelExperiments.experiments.unrelated.stringValue, 'x');

  // A custom rule for the same path overrides the built-in rule instead of running both.
  const custom = { path: BUILTIN_GUIDELINES_TEMPLATE.path, action: 'set_value', replace_with: 'CUSTOM' };
  assert.deepEqual(effectiveTemplates({ guidelinesOverride: true, templates: [custom] }), [custom]);
});
