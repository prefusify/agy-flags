import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  INDICATOR_ANCHOR,
  PART_COSTS,
  PART_INDICATOR,
  costRepricerFactory,
  detectNames,
  indicatorFactory,
  isPriceTable,
  modelKey,
  patchCostSummary,
  patchMainJs,
} from '../src/uipatch.mjs';

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
  assert.deepEqual(patchMainJs(missing), {
    ok: false,
    source: missing,
    reason: 'the place for the indicator was not found',
    parts: { [PART_INDICATOR]: { ok: false, reason: 'the place for the indicator was not found' } },
  });
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

// ---- costs ---------------------------------------------------------------------------

const TABLE = { 'gemini-4-neon': [3, 15, 0.15], 'gemini-3-8-flash': [0.75, 3.75, 0.075], 'claude-sonnet-5-5': [2, 10, 0.1] };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

/** A section as the language server of 2.35.1 sends it: token counts, and every cost and price 0. */
function section(modelName, { input = 0, cache = 0, thinking = 0, response = 0, generations = 1 } = {}) {
  const category = (tokens) => ({ tokens: BigInt(tokens), estimatedCostUsd: 0 });
  return {
    input: category(input),
    cacheRead: category(cache),
    output: category(thinking + response),
    thinking: category(thinking),
    response: category(response),
    generationCount: generations,
    estimatedCostUsd: 0,
    pricing: {
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
      cacheReadPricePerMillionTokens: 0,
      modelName,
      isEstimated: true,
    },
  };
}

/** The four turns that were measured in the client: two models after the first two turns. */
function measuredSummary() {
  return {
    turnCosts: {
      // Not in the order of the conversation: the map of the client has no order.
      c: { turn: section('Gemini 3.8 Flash (Medium)', { input: 17000, response: 1 }), cumulativeTotal: section('Gemini 3.8 Flash (Medium)', { input: 35900, cache: 14700, thinking: 42, response: 5, generations: 3 }) },
      a: { turn: section('Gemini 4 Neon (XHigh)', { input: 16700, thinking: 22, response: 2 }), cumulativeTotal: section('Gemini 4 Neon (XHigh)', { input: 16700, thinking: 22, response: 2 }) },
      d: { turn: section('Claude Sonnet 5.5 (Medium)', { input: 26100, response: 4 }), cumulativeTotal: section('Claude Sonnet 5.5 (Medium)', { input: 62000, cache: 14700, thinking: 42, response: 9, generations: 4 }) },
      b: { turn: section('Gemini 4 Neon (XHigh)', { input: 2200, cache: 14700, thinking: 20, response: 2 }), cumulativeTotal: section('Gemini 4 Neon (XHigh)', { input: 18900, cache: 14700, thinking: 42, response: 4, generations: 2 }) },
    },
    total: { cumulativeTotal: section('Claude Sonnet 5.5 (Medium)', { input: 62000, cache: 14700, thinking: 42, response: 9, generations: 4 }) },
  };
}

test('one spelling for a model, whatever the source calls it', () => {
  assert.equal(modelKey('Gemini 4 Neon (XHigh)'), 'gemini-4-neon');
  assert.equal(modelKey('gemini-4-neon'), 'gemini-4-neon');
  assert.equal(modelKey('Claude Opus 5.5 (High)'), 'claude-opus-5-5');
  assert.equal(modelKey('claude-opus-5-5@default'), 'claude-opus-5-5');
  assert.equal(modelKey('openai/gpt-oss-120b-maas'), 'gpt-oss-120b');
  assert.equal(modelKey('GPT-OSS 120B (Medium)'), 'gpt-oss-120b');
  assert.equal(modelKey('MODEL_GOOGLE_GEMINI_2_5_PRO'), 'gemini-2-5-pro');
  // Not a model of the price list: it must not become one by losing its brackets.
  assert.equal(modelKey('Orchestrator (Neon)'), 'orchestrator');
  for (const bad of [undefined, null, 7, {}, '', 'x'.repeat(201)]) assert.equal(modelKey(bad), '');
});

test('a turn is paid at the prices of its model: input, cache read and output', () => {
  const summary = measuredSummary();
  const reprice = costRepricerFactory(TABLE);
  assert.equal(reprice(summary), summary);
  const second = summary.turnCosts.b.turn;
  near(second.input.estimatedCostUsd, (2200 * 3) / 1e6);
  near(second.cacheRead.estimatedCostUsd, (14700 * 0.15) / 1e6);
  near(second.output.estimatedCostUsd, (22 * 15) / 1e6);
  near(second.thinking.estimatedCostUsd, (20 * 15) / 1e6);
  near(second.response.estimatedCostUsd, (2 * 15) / 1e6);
  // Output already holds thinking and response: they are not added a second time.
  near(second.estimatedCostUsd, (2200 * 3 + 14700 * 0.15 + 22 * 15) / 1e6);
  assert.deepEqual(
    { ...second.pricing },
    { inputPricePerMillionTokens: 3, outputPricePerMillionTokens: 15, cacheReadPricePerMillionTokens: 0.15, modelName: 'Gemini 4 Neon (XHigh)', isEstimated: false }
  );
  // The token counts are not touched.
  assert.equal(second.input.tokens, 2200n);
  assert.equal(second.generationCount, 1);
});

test('a running total is the sum of the turns, each at the prices of its own model', () => {
  const summary = measuredSummary();
  costRepricerFactory(TABLE)(summary);
  const cost = (id) => summary.turnCosts[id].turn.estimatedCostUsd;
  near(summary.turnCosts.a.cumulativeTotal.estimatedCostUsd, cost('a'));
  near(summary.turnCosts.b.cumulativeTotal.estimatedCostUsd, cost('a') + cost('b'));
  near(summary.turnCosts.c.cumulativeTotal.estimatedCostUsd, cost('a') + cost('b') + cost('c'));
  near(summary.turnCosts.d.cumulativeTotal.estimatedCostUsd, cost('a') + cost('b') + cost('c') + cost('d'));
  near(summary.total.cumulativeTotal.estimatedCostUsd, cost('a') + cost('b') + cost('c') + cost('d'));
  // The whole total at the prices of the last model would be another number.
  const third = summary.turnCosts.c.cumulativeTotal;
  near(third.input.estimatedCostUsd, (18900 * 3 + 17000 * 0.75) / 1e6);
  assert.ok(Math.abs(third.estimatedCostUsd - (35900 * 0.75 + 14700 * 0.075 + 47 * 3.75) / 1e6) > 0.01);
  assert.equal(third.pricing.isEstimated, false);
});

test('a model without a price stays as the client sent it', () => {
  const summary = {
    turnCosts: {
      a: { turn: section('Gemini 4 Neon (High)', { input: 1000 }), cumulativeTotal: section('Gemini 4 Neon (High)', { input: 1000 }) },
      b: { turn: section('Orchestrator (Neon)', { input: 5000 }), cumulativeTotal: section('Orchestrator (Neon)', { input: 6000 }) },
    },
  };
  const before = structuredClone(summary.turnCosts.b.turn);
  costRepricerFactory(TABLE)(summary);
  assert.deepEqual(summary.turnCosts.b.turn, before);
  // Its turn adds nothing to the running total, as its own row shows nothing.
  near(summary.turnCosts.b.cumulativeTotal.estimatedCostUsd, (1000 * 3) / 1e6);
  assert.equal(summary.turnCosts.b.cumulativeTotal.pricing.inputPricePerMillionTokens, 0);
});

test('a section that the client priced itself is not changed', () => {
  const own = section('Gemini 4 Neon (High)', { input: 1000 });
  own.pricing.inputPricePerMillionTokens = 9;
  own.input.estimatedCostUsd = 0.009;
  own.estimatedCostUsd = 0.009;
  const summary = { turnCosts: { a: { turn: own, cumulativeTotal: structuredClone(own) } }, total: { cumulativeTotal: structuredClone(own) } };
  const before = structuredClone(summary);
  costRepricerFactory(TABLE)(summary);
  assert.deepEqual(summary, before);
});

test('subagents are paid at their own model and are part of the grand total', () => {
  // The shape that was measured on 2.35.1: the turns do not hold the subagents. They are in
  // a list, in a sum that names no model, and in the grand total.
  const sum = section('unused', { input: 8000, cache: 600, response: 40, generations: 4 });
  delete sum.pricing;
  const summary = {
    turnCosts: {
      a: { turn: section('Claude Sonnet 5.5 (Medium)', { input: 1000, response: 10 }), cumulativeTotal: section('Claude Sonnet 5.5 (Medium)', { input: 1000, response: 10 }) },
    },
    subagentCosts: {
      one: section('Gemini 3.8 Flash (Low)', { input: 4000, cache: 300, response: 20, generations: 2 }),
      two: section('Claude Sonnet 5.5 (Medium)', { input: 4000, cache: 300, response: 20, generations: 2 }),
    },
    total: {
      turn: section('Claude Sonnet 5.5 (Medium)', { input: 1000, response: 10 }),
      subagent: sum,
      cumulativeTotal: section('Claude Sonnet 5.5 (Medium)', { input: 9000, cache: 600, response: 50, generations: 5 }),
    },
  };
  costRepricerFactory(TABLE)(summary);
  const turn = (1000 * 2 + 10 * 10) / 1e6;
  const one = (4000 * 0.75 + 300 * 0.075 + 20 * 3.75) / 1e6;
  const two = (4000 * 2 + 300 * 0.1 + 20 * 10) / 1e6;
  near(summary.subagentCosts.one.estimatedCostUsd, one);
  near(summary.subagentCosts.two.estimatedCostUsd, two);
  near(summary.turnCosts.a.cumulativeTotal.estimatedCostUsd, turn);
  near(summary.total.turn.estimatedCostUsd, turn);
  // The sum has no model: it gets the sum of the list, and no prices.
  near(summary.total.subagent.estimatedCostUsd, one + two);
  near(summary.total.subagent.input.estimatedCostUsd, (4000 * 0.75 + 4000 * 2) / 1e6);
  assert.equal(Object.hasOwn(summary.total.subagent, 'pricing'), false);
  near(summary.total.cumulativeTotal.estimatedCostUsd, turn + one + two);
  assert.equal(summary.total.cumulativeTotal.pricing.isEstimated, false);
});

test('a sum of subagents that the list does not explain stays empty', () => {
  const sum = section('unused', { input: 9999, response: 40 });
  delete sum.pricing;
  const summary = {
    turnCosts: { a: { turn: section('Gemini 4 Neon (Low)', { input: 1000 }), cumulativeTotal: section('Gemini 4 Neon (Low)', { input: 1000 }) } },
    subagentCosts: { one: section('Gemini 3.8 Flash (Low)', { input: 4000, response: 20 }) },
    total: { subagent: sum, cumulativeTotal: section('Gemini 4 Neon (Low)', { input: 10999, response: 40 }) },
  };
  costRepricerFactory(TABLE)(summary);
  assert.equal(summary.total.subagent.estimatedCostUsd, 0);
  // It adds nothing to the grand total, as its own row shows nothing.
  near(summary.total.cumulativeTotal.estimatedCostUsd, (1000 * 3) / 1e6);
});

test('subagents inside the turns are counted once', () => {
  // Another possible shape: each turn carries its subagents, and the running totals hold them.
  const summary = {
    turnCosts: {
      a: {
        turn: section('Claude Sonnet 5.5 (Medium)', { input: 1000, response: 10 }),
        subagent: section('Gemini 3.8 Flash (Low)', { input: 4000, response: 20 }),
        cumulativeTotal: section('Claude Sonnet 5.5 (Medium)', { input: 5000, response: 30 }),
      },
    },
    total: {
      subagent: section('Gemini 3.8 Flash (Low)', { input: 4000, response: 20 }),
      cumulativeTotal: section('Claude Sonnet 5.5 (Medium)', { input: 5000, response: 30 }),
    },
  };
  costRepricerFactory(TABLE)(summary);
  const turn = (1000 * 2 + 10 * 10) / 1e6;
  const sub = (4000 * 0.75 + 20 * 3.75) / 1e6;
  near(summary.turnCosts.a.subagent.estimatedCostUsd, sub);
  near(summary.total.subagent.estimatedCostUsd, sub);
  near(summary.turnCosts.a.cumulativeTotal.estimatedCostUsd, turn + sub);
  near(summary.total.cumulativeTotal.estimatedCostUsd, turn + sub);
  assert.equal(summary.total.cumulativeTotal.pricing.isEstimated, false);
});

test('growth that the listed turns do not explain is paid at the model of that turn, as an estimate', () => {
  // Older turns are in the total but are not listed any more.
  const summary = {
    turnCosts: { z: { turn: section('Gemini 4 Neon (High)', { input: 1000 }), cumulativeTotal: section('Gemini 4 Neon (High)', { input: 51000, cache: 2000 }) } },
    total: { cumulativeTotal: section('Gemini 4 Neon (High)', { input: 51000, cache: 2000 }) },
  };
  costRepricerFactory(TABLE)(summary);
  const total = summary.total.cumulativeTotal;
  near(total.estimatedCostUsd, (51000 * 3 + 2000 * 0.15) / 1e6);
  assert.equal(total.pricing.isEstimated, true);
  assert.equal(summary.turnCosts.z.turn.pricing.isEstimated, false);
});

test('a summary is filled in once, and anything else comes back as it is', () => {
  const reprice = costRepricerFactory(TABLE);
  const summary = measuredSummary();
  reprice(summary);
  const once = structuredClone(summary);
  reprice(summary);
  assert.deepEqual(summary, once);

  for (const odd of [undefined, null, 5, 'text', {}, { turnCosts: null }, { turnCosts: { a: null, b: 7, c: {} }, total: {} }]) {
    assert.equal(reprice(odd), odd);
  }
  // A total without any listed turn is paid at its own model.
  const alone = { total: { cumulativeTotal: section('Gemini 4 Neon (Low)', { input: 1e6 }) } };
  reprice(alone);
  near(alone.total.cumulativeTotal.estimatedCostUsd, 3);
  // Every number the page formats with toFixed stays a number.
  const broken = { turnCosts: { a: { turn: { ...section('Gemini 4 Neon (Low)'), input: { tokens: 'many' } }, cumulativeTotal: section('Gemini 4 Neon (Low)') } } };
  reprice(broken);
  assert.equal(broken.turnCosts.a.turn.input.estimatedCostUsd, 0);
  assert.equal(broken.turnCosts.a.turn.estimatedCostUsd, 0);
  // A frozen summary cannot be filled in; it must not throw.
  const frozen = measuredSummary();
  const freeze = (value) => {
    if (value && typeof value === 'object') Object.values(Object.freeze(value)).forEach(freeze);
    return value;
  };
  const error = console.error;
  const said = [];
  console.error = (...args) => said.push(args);
  try {
    assert.equal(costRepricerFactory(TABLE)(freeze(frozen)), frozen);
  } finally {
    console.error = error;
  }
  assert.equal(said.length, 1);
});

test('a table of prices is nothing but keys and three numbers', () => {
  assert.equal(isPriceTable(TABLE), true);
  for (const bad of [
    null,
    [],
    {},
    { 'Gemini 4': [1, 2, 3] },
    { 'a"b': [1, 2, 3] },
    { a: [1, 2] },
    { a: [1, 2, '3'] },
    { a: [1, 2, -1] },
    { a: [1, 2, Infinity] },
    { a: { 0: 1, 1: 2, 2: 3 } },
  ]) {
    assert.equal(isPriceTable(bad), false, JSON.stringify(bad));
  }
});

/** The place where the summary enters the page state, as in the real script, under other names. */
const COST_PLACE = 'q.costSummary!==void 0&&(r.costSummary=q.costSummary);';
const costScript = () => `function take(q,r){${COST_PLACE}return r}var bindings={cider:void 0,${INDICATOR_ANCHOR}contextWindow:void 0};`;

test('the call that fills in the costs goes around the one place of the summary', () => {
  const source = costScript();
  const result = patchCostSummary(source, TABLE);
  assert.equal(result.ok, true);
  const at = source.indexOf(COST_PLACE);
  assert.equal(result.source.slice(0, at), source.slice(0, at));
  assert.ok(result.source.endsWith(source.slice(at + COST_PLACE.length - 1)));

  const context = run(result.source);
  const summary = measuredSummary();
  const state = context.take({ costSummary: summary }, {});
  assert.equal(state.costSummary, summary);
  near(summary.turnCosts.a.turn.estimatedCostUsd, (16700 * 3 + 24 * 15) / 1e6);
  // An update without a summary leaves the state alone, as before.
  assert.deepEqual({ ...context.take({}, { costSummary: 1 }) }, { costSummary: 1 });

  assert.match(patchCostSummary('var a=1;', TABLE).reason, /found 0 times/);
  // Other names, as after an update of the client. A place that only looks alike does not count.
  const renamed = 'function take($a,b_2){$a.costSummary!==void 0&&(b_2.costSummary=$a.costSummary);return b_2}';
  assert.equal(patchCostSummary(renamed, TABLE).ok, true);
  assert.equal(typeof run(patchCostSummary(renamed, TABLE).source).take({ costSummary: {} }, {}).costSummary, 'object');
  for (const other of [
    'q.costSummary!==void 0&&(r.costSummary=z.costSummary);',
    'q.costSummary!==void 0&&(r.costSummary=q.costSummary2);',
    'q.costSummary!==void 0&&(r.other=q.costSummary);',
    '.costSummary!==void 0&&(r.costSummary=q.costSummary);',
  ]) {
    assert.match(patchCostSummary(`function f(q,r,z){${other}}`, TABLE).reason, /found 0 times/, other);
  }
  assert.match(patchCostSummary(source + source, TABLE).reason, /found 2 times/);
  assert.match(patchCostSummary(source, {}).reason, /no price list/);
  assert.match(patchCostSummary(source, { 'x");alert(1);("': [1, 2, 3] }).reason, /no price list/);
});

test('the place of the costs is found fast in a large script', () => {
  // A pattern that starts with a free name took seconds over the real script (8 MB), and
  // the daemon forwards nothing while it runs.
  const filler = 'var filler=[' + 'aaa.bbb(ccc,ddd)&&eee.fff,'.repeat(300_000) + '0];';
  const large = filler + costScript() + filler;
  const started = process.hrtime.bigint();
  const result = patchCostSummary(large, TABLE);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(result.ok, true);
  assert.ok(ms < 1000, `took ${ms} ms`);
});

test('the two changes do not depend on each other', () => {
  const both = fakeScript().replace('var bindings=', `function take(q,r){${COST_PLACE}return r}var bindings=`);
  const all = patchMainJs(both, { prices: TABLE });
  assert.equal(all.ok, true);
  assert.deepEqual(all.parts, { [PART_INDICATOR]: { ok: true, reason: null }, [PART_COSTS]: { ok: true, reason: null } });
  const context = run(all.source);
  assert.equal(typeof context.bindings.contextUsageIndicator.Indicator, 'function');
  assert.equal(typeof context.take({ costSummary: {} }, {}).costSummary, 'object');

  // Only the costs.
  const costsOnly = patchMainJs(both, { indicator: false, prices: TABLE });
  assert.deepEqual(costsOnly.parts, { [PART_COSTS]: { ok: true, reason: null } });
  assert.ok(costsOnly.source.includes(INDICATOR_ANCHOR));

  // The place of one is missing: the other is still made, and the answer says which one failed.
  const noCosts = patchMainJs(fakeScript(), { prices: TABLE });
  assert.equal(noCosts.ok, false);
  assert.equal(noCosts.parts[PART_INDICATOR].ok, true);
  assert.match(noCosts.parts[PART_COSTS].reason, /found 0 times/);
  assert.equal(typeof run(noCosts.source).bindings.contextUsageIndicator.Indicator, 'function');

  const noIndicator = patchMainJs(costScript().replace(INDICATOR_ANCHOR, ''), { prices: TABLE });
  assert.equal(noIndicator.ok, false);
  assert.equal(noIndicator.parts[PART_COSTS].ok, true);
  assert.ok(noIndicator.source.includes('__agyPlusCost'));

  // Nothing asked for: nothing changes.
  assert.deepEqual(patchMainJs(both, { indicator: false }), { ok: true, source: both, parts: {} });
});

