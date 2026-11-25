import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { INDICATOR_ANCHOR, detectNames, indicatorFactory, patchMainJs } from '../src/uipatch.mjs';

/** A small script with the same shapes as the real page script, under other names. */
function fakeScript({ react = 'Q', hook = 'zz9', anchor = INDICATOR_ANCHOR, component = true } = {}) {
  return [
    `var ${react}={useState(){},createElement(){}${component ? ',Component:class{}' : ''}};`,
    `var noise=[${Array.from({ length: 30 }, () => `(0,${react}.useState)`).join(',')}];`,
    'var Xb={useState(){}},other=(0,Xb.useState);',
    `var x=${react}.createElement("div");`,
    `var rp=a=>a,${hook}=(a,b)=>{var c=[],{optimisticState:d,trueState:f}=rp(a);return d};`,
    `var bindings={cider:void 0,${anchor}contextWindow:void 0};`,
  ].join('');
}

function run(source) {
  const context = vm.createContext({ console: { error() {} } });
  vm.runInContext(source, context);
  return context;
}

test('the two names are found by their shape, whatever they are called', () => {
  assert.deepEqual(detectNames(fakeScript()), { ok: true, react: 'Q', stateHook: 'zz9' });
  assert.deepEqual(detectNames(fakeScript({ react: '$e', hook: 'a_b' })), { ok: true, react: '$e', stateHook: 'a_b' });
});

test('a script without the shapes gives a reason, not a guess', () => {
  assert.match(detectNames('var a=1;').reason, /React/);
  const noHook = fakeScript().replace('{optimisticState:d,trueState:f}', '{state:d}');
  assert.match(detectNames(noHook).reason, /found 0 times/);
  const twoHooks = fakeScript() + 'var yy=(a,b)=>{var c=[],{optimisticState:d,trueState:f}=rp(a);return d};';
  assert.match(detectNames(twoHooks).reason, /found 2 times/);
});

test('the indicator is put into its place and the script still runs', () => {
  const source = fakeScript();
  const result = patchMainJs(source);
  assert.equal(result.ok, true);
  assert.deepEqual(result.names, { react: 'Q', stateHook: 'zz9' });
  assert.equal(result.source.includes(INDICATOR_ANCHOR), false);
  // Nothing else changes: the text before and after the place is the same.
  const at = source.indexOf(INDICATOR_ANCHOR);
  assert.equal(result.source.slice(0, at), source.slice(0, at));
  assert.ok(result.source.endsWith(source.slice(at + INDICATOR_ANCHOR.length)));

  const context = run(result.source);
  assert.equal(typeof context.bindings.contextUsageIndicator.Indicator, 'function');
  assert.equal(context.bindings.cider, undefined);
});

test('a script that cannot be changed safely comes back unchanged', () => {
  const missing = fakeScript({ anchor: '' });
  assert.deepEqual(patchMainJs(missing), { ok: false, source: missing, reason: 'the place for the indicator was not found' });
  const twice = fakeScript() + `var again={${INDICATOR_ANCHOR}a:1};`;
  assert.equal(patchMainJs(twice).ok, false);
  assert.equal(patchMainJs(twice).source, twice);
  const noHook = fakeScript().replace('{optimisticState:d,trueState:f}', '{state:d}');
  assert.equal(patchMainJs(noHook).source, noHook);
  const broken = `${fakeScript()}var bad=(;`;
  const result = patchMainJs(broken);
  assert.equal(result.ok, false);
  assert.match(result.reason, /does not parse/);
  assert.equal(result.source, broken);
  assert.equal(patchMainJs(undefined).ok, false);
});

test('a failure while the page loads leaves the place empty, as in the original', () => {
  // This React has no Component class, so building the indicator throws.
  const result = patchMainJs(fakeScript({ component: false }));
  assert.equal(result.ok, true);
  const context = run(result.source);
  assert.equal(context.bindings.contextUsageIndicator, undefined);
});

test('the numbers shown come from the usage the client reports', () => {
  const Indicator = indicatorFactory({ createElement() {}, Component: class {} }, () => undefined);
  const info = Indicator.summarize(
    {
      estimatedTokensUsed: 50_000n,
      maxContextTokens: 200000,
      tokenGroups: [
        { type: 1, numTokens: 30000 },
        { name: 'Custom', numTokens: 20000n },
        { type: 7, numTokens: 0 },
        { type: 99, numTokens: 5 },
      ],
    },
    false
  );
  assert.equal(info.used, 50000);
  assert.equal(info.max, 200000);
  assert.equal(info.ratio, 0.25);
  assert.equal(info.compacted, false);
  assert.deepEqual(info.groups, [
    { label: 'System prompt', tokens: 30000 },
    { label: 'Custom', tokens: 20000 },
    { label: 'Other', tokens: 5 },
  ]);
  assert.equal(Indicator.summarize({ estimatedTokensUsed: 900, maxContextTokens: 1000 }, false).color, '#ef4444');
  assert.equal(Indicator.summarize({ estimatedTokensUsed: 5000, maxContextTokens: 1000 }, true).ratio, 1);
  assert.equal(Indicator.summarize({ estimatedAfterCompaction: 10 }, false).compacted, true);
  assert.deepEqual(Indicator.summarize(undefined, false), {
    used: 0,
    max: 0,
    ratio: 0,
    groups: [],
    compacted: false,
    color: 'var(--primary, #3b82f6)',
  });
  assert.equal(Indicator.formatTokens(1234), '1.2k');
  assert.equal(Indicator.formatTokens(250000), '250k');
  assert.equal(Indicator.formatTokens(1_000_000), '1M');
  assert.equal(Indicator.formatTokens(12_340_000), '12.3M');
});
