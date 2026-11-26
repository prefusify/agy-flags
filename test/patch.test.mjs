import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidFlagName,
  isValidFlagValue,
  kindOf,
  modelDisplayNames,
  patchFlagConfig,
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
