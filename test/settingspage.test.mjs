import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { SETTINGS_SCREEN, patchSettingsPage, settingsPageFactory } from '../src/settingspage.mjs';
import { fakeSettingsScript } from './helpers.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OPTIONS = { api: '/__agy_flags/' };

// ---- a React that is just enough to draw the page once ------------------------------------

/**
 * `states` are the values that the state hooks of the page give out, in the order in which
 * the page asks for them: data, failure, mistake, asking, restarting. A value that is left
 * out is the one the page starts with.
 */
function fakeReact(states = []) {
  let asked = 0;
  return {
    Component: class {
      constructor(props) {
        this.props = props;
      }
    },
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (first) => {
      const i = asked++;
      return [i < states.length && states[i] !== undefined ? states[i] : first, () => {}];
    },
    useRef: (current) => ({ current }),
    useCallback: (fn) => fn,
    useEffect: () => {},
  };
}

/** Draw an element: every component is called, and what is left are tags and texts. */
function draw(node) {
  if (node === null || node === undefined || node === false || node === true) return [];
  if (Array.isArray(node)) return node.flatMap(draw);
  if (typeof node !== 'object') return [String(node)];
  const props = { ...node.props, children: node.children.length === 1 ? node.children[0] : node.children };
  if (typeof node.type === 'function') {
    if (node.type.prototype && typeof node.type.prototype.render === 'function') return draw(new node.type(props).render());
    return draw(node.type(props));
  }
  return [{ tag: node.type, props: node.props, children: node.children.flatMap(draw) }];
}

const walk = (nodes, visit) => {
  for (const node of nodes) {
    if (typeof node === 'string') continue;
    visit(node);
    walk(node.children, visit);
  }
};
const textOf = (nodes) => nodes.map((node) => (typeof node === 'string' ? node : textOf(node.children))).join('');
const all = (nodes, test) => {
  const out = [];
  walk(nodes, (node) => {
    if (test(node)) out.push(node);
  });
  return out;
};
const switches = (nodes) => all(nodes, (node) => node.props.role === 'switch');
const buttons = (nodes) => all(nodes, (node) => node.tag === 'button' && node.props.role !== 'switch');
const notices = (nodes) => all(nodes, (node) => node.props.role === 'status').map((node) => textOf([node]));
const headings = (nodes) => all(nodes, (node) => node.tag === 'h3').map((node) => textOf([node]));

const CATALOG = {
  sections: [
    { id: 'a', title: { zh: '界面', en: 'Interface' } },
    { id: 'b', title: { zh: '代理', en: 'Agents' } },
    { id: 'empty', title: { zh: '空', en: 'Empty' } },
  ],
  groups: [
    { id: 'plain', section: 'a', flags: ['p1', 'p2'], tested: '2.35.2', title: { zh: '普通', en: 'Plain' }, description: { zh: '普通的说明。', en: 'A plain one.' } },
    {
      id: 'risky',
      section: 'b',
      flags: ['r1'],
      requires: ['p1'],
      tested: null,
      title: { zh: '有风险', en: 'Risky' },
      description: { zh: '有风险的说明。', en: 'A risky one.' },
      riskLabel: { zh: '消耗配额', en: 'uses quota' },
      risk: { zh: '配额会成倍消耗。', en: 'Uses quota many times faster.' },
    },
    { id: 'zh', section: 'b', flags: [], feature: 'uiChinese', uiPatch: 'l10n', status: 'l10n', tested: '2.35.2', title: { zh: '界面汉化', en: 'Chinese interface' } },
    { id: 'costs', flags: [], feature: 'costPrices', requires: ['cost-on'], uiPatch: 'costPrices', status: 'prices', tested: '2.35.1', title: { zh: '估算费用', en: 'Estimated costs' } },
  ],
};

function makeState(change = {}) {
  return {
    version: '0.3.0',
    enabled: true,
    overrides: {},
    features: { costPrices: false, uiChinese: true, chineseTitles: false },
    pendingRestart: false,
    pendingReason: null,
    restarting: false,
    warnings: [],
    app: { version: '2.35.2' },
    client: { running: true, routed: true },
    lastInjection: {},
    server: { version: 1, count: 0 },
    page: { script: { parts: {} } },
    prices: { error: null, fetchedAt: null },
    l10n: { ready: true },
    titles: { changed: 0 },
    traffic: { byClient: { desktop: 0, cli: 0, other: 0 } },
    ...change,
  };
}

const SERVER = { version: 1, flags: {} };

function page(states, props = { active: true }) {
  const React = fakeReact(states);
  const Page = settingsPageFactory(React, OPTIONS);
  return draw(React.createElement(Page, props));
}

const shown = (state, extra = [], server = SERVER) => page([{ state, server, catalog: CATALOG }, ...extra]);

// ---- what is on ---------------------------------------------------------------------------

const { helpers } = settingsPageFactory(fakeReact(), OPTIONS);

test('an entry is on when all its flags are, by an override or because the server sends them', () => {
  const [plain, risky] = CATALOG.groups;
  const state = (overrides) => makeState({ overrides });
  assert.deepEqual(helpers.groupState(plain, state({}), SERVER), { on: false, partial: false, serverOnly: false });
  assert.deepEqual(helpers.groupState(plain, state({ p1: true }), SERVER), { on: false, partial: true, serverOnly: false });
  assert.deepEqual(helpers.groupState(plain, state({ p1: true, p2: true }), SERVER), { on: true, partial: false, serverOnly: false });
  // The server turns both on: there is nothing to choose here.
  const server = { version: 2, flags: { p1: { type: 'boolValue', value: true }, p2: { type: 'boolValue', value: true }, n: { type: 'intValue', value: '1' } } };
  assert.deepEqual(helpers.groupState(plain, state({}), server), { on: true, partial: false, serverOnly: true });
  assert.deepEqual(helpers.groupState(plain, state({ p2: true }), server), { on: true, partial: false, serverOnly: false });
  // An override that says "off" wins over the server.
  assert.deepEqual(helpers.groupState(plain, state({ p1: false }), server), { on: false, partial: true, serverOnly: false });

  // An entry that needs the flag of another one is only a part without it.
  assert.deepEqual(helpers.groupState(risky, state({ r1: true }), SERVER), { on: false, partial: true, serverOnly: false });
  assert.deepEqual(helpers.groupState(risky, state({ r1: true, p1: true }), SERVER), { on: true, partial: false, serverOnly: false });
});

test('a feature of agy-flags is on with its own switch and the flags it needs', () => {
  const costs = CATALOG.groups[3];
  const state = (costPrices, overrides = {}) => makeState({ overrides, features: { costPrices, uiChinese: false, chineseTitles: false } });
  assert.deepEqual(helpers.groupState(costs, state(false), SERVER), { on: false, partial: false, serverOnly: false });
  assert.deepEqual(helpers.groupState(costs, state(true), SERVER), { on: false, partial: true, serverOnly: false });
  assert.deepEqual(helpers.groupState(costs, state(true, { 'cost-on': true }), SERVER), { on: true, partial: false, serverOnly: false });
  // The flag alone turns nothing on, and the server cannot turn a feature of ours on.
  assert.deepEqual(helpers.groupState(costs, state(false, { 'cost-on': true }), SERVER), { on: false, partial: false, serverOnly: false });
});

test('the change for a switch: its flags, and what it needs when it goes on', () => {
  const [plain, risky, , costs] = CATALOG.groups;
  const state = makeState({ overrides: { p1: true } });
  assert.deepEqual(helpers.changeFor(plain, true, state, SERVER), { path: 'flags', body: { changes: { p1: true, p2: true } } });
  // Off is "what the server sends", not "forced off".
  assert.deepEqual(helpers.changeFor(plain, false, state, SERVER), { path: 'flags', body: { changes: { p1: null, p2: null } } });
  // What it needs is already on: it is left alone. Off never touches it.
  assert.deepEqual(helpers.changeFor(risky, true, state, SERVER), { path: 'flags', body: { changes: { r1: true } } });
  assert.deepEqual(helpers.changeFor(risky, true, makeState(), SERVER), { path: 'flags', body: { changes: { p1: true, r1: true } } });
  assert.deepEqual(helpers.changeFor(risky, false, state, SERVER), { path: 'flags', body: { changes: { r1: null } } });
  assert.deepEqual(helpers.changeFor(costs, true, state, SERVER), { path: 'features', body: { changes: { costPrices: true }, flags: { 'cost-on': true } } });
  assert.deepEqual(helpers.changeFor(costs, false, state, SERVER), { path: 'features', body: { changes: { costPrices: false } } });
});

test('the problems of a feature that is on', () => {
  const [, , zh, costs] = CATALOG.groups;
  assert.deepEqual(helpers.groupProblems(zh, makeState()), []);
  assert.deepEqual(helpers.groupProblems(zh, makeState({ l10n: { ready: false } })), [['l10nMissing', {}]]);
  const failed = makeState({ page: { script: { parts: { l10n: { ok: false, reason: 'no place' } } } } });
  assert.deepEqual(helpers.groupProblems(zh, failed), [['pageScriptFail', { reason: 'no place' }]]);
  assert.deepEqual(helpers.groupProblems(costs, makeState({ prices: { error: 'offline', fetchedAt: null } })), [['pricesErrorNone', { error: 'offline' }]]);
  assert.deepEqual(helpers.groupProblems(costs, makeState({ prices: { error: 'offline', fetchedAt: 5 } })), [['pricesError', { error: 'offline' }]]);
});

test('the page is Chinese with the Chinese interface or on a Chinese system', () => {
  assert.equal(helpers.pickLang(makeState(), 'en-US'), 'zh');
  assert.equal(helpers.pickLang(makeState({ features: { uiChinese: false } }), 'zh-CN'), 'zh');
  assert.equal(helpers.pickLang(makeState({ features: { uiChinese: false } }), 'en-US'), 'en');
  assert.equal(helpers.pickLang(null, undefined), 'en');
  // Both languages have every text.
  const keys = (texts) => Object.keys(texts).filter((key) => key !== 'warn').sort();
  assert.deepEqual(keys(helpers.TEXT.zh), keys(helpers.TEXT.en));
  assert.deepEqual(Object.keys(helpers.TEXT.zh.warn).sort(), Object.keys(helpers.TEXT.en.warn).sort());
});

test('the shipped catalog puts every feature under a heading', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'catalog.json'), 'utf8'));
  const ids = catalog.sections.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const section of catalog.sections) assert.ok(section.title.zh && section.title.en, section.id);
  for (const group of catalog.groups) assert.ok(ids.includes(group.section), `${group.id} has no heading`);
  const sections = helpers.sectionsOf(catalog);
  assert.deepEqual(sections.map((section) => section.id), ids);
  assert.equal(sections.reduce((n, section) => n + section.groups.length, 0), catalog.groups.length);
});

// ---- what the page shows --------------------------------------------------------------------

test('before the first answer the page says that it is loading', () => {
  const tree = page([]);
  assert.match(textOf(tree), /AGY-flags/);
  assert.match(textOf(tree), /Loading…|正在读取…/);
  assert.equal(switches(tree).length, 0);
  // The daemon does not answer: the page says so.
  assert.match(notices(page([undefined, { kind: 'offline' }]))[0], /daemon cannot be reached|连不上/);
  assert.match(notices(page([undefined, { kind: 'refused', data: { error: 'caller not recognized' } }]))[0], /caller not recognized/);
});

test('the features stand under their headings, each with one switch', () => {
  const tree = shown(makeState({ overrides: { p1: true, p2: true } }));
  // A heading without a feature is left out; a feature without a heading comes last.
  assert.deepEqual(headings(tree), ['界面', '代理', '其他', '关于']);
  const list = switches(tree);
  assert.deepEqual(list.map((node) => node.props['aria-label']), ['启用 agy-flags', '普通', '有风险', '界面汉化', '估算费用']);
  assert.deepEqual(list.map((node) => node.props['aria-checked']), [true, true, false, true, false]);
  assert.ok(list.every((node) => node.props.disabled !== true));
  const text = textOf(tree);
  assert.match(text, /普通的说明。/);
  // Only what is unusual gets a mark: not seen working, and a risk.
  assert.match(text, /未实测/);
  assert.match(text, /消耗配额/);
  assert.equal(text.includes('2.35.2 · 经过 agy-flags'), true);
  assert.deepEqual(notices(tree), []);
  // The version it was seen on is in the tip of the name.
  assert.equal(all(tree, (node) => node.props.title === '已在 Antigravity 2.35.2 上实测').length, 2);
});

test('the page is English without the Chinese interface on an English system', () => {
  const tree = shown(makeState({ features: { costPrices: false, uiChinese: false, chineseTitles: false } }));
  // The test runs with the language of this machine, so only one of the two is checked.
  const lang = helpers.pickLang(makeState({ features: {} }), globalThis.navigator?.language);
  assert.deepEqual(headings(tree), lang === 'zh' ? ['界面', '代理', '其他', '关于'] : ['Interface', 'Agents', 'Other', 'About']);
});

test('with rewriting off the features cannot be changed, and the page says what a restart does', () => {
  const tree = shown(makeState({ enabled: false, pendingRestart: true, pendingReason: 'still-routed' }));
  const list = switches(tree);
  assert.equal(list[0].props['aria-checked'], false);
  assert.equal(list[0].props.disabled, undefined);
  assert.ok(list.slice(1).every((node) => node.props.disabled === true));
  assert.deepEqual(notices(tree), ['改写已关闭，重启 Antigravity 后恢复为直连 Google。重启 Antigravity']);
});

test('a switch that the server already turned on cannot be turned off here', () => {
  const server = { version: 2, flags: { p1: { type: 'boolValue', value: true }, p2: { type: 'boolValue', value: true } } };
  const tree = shown(makeState(), [], server);
  const plain = switches(tree)[1];
  assert.equal(plain.props['aria-checked'], true);
  assert.equal(plain.props.disabled, true);
  assert.match(textOf(tree), /服务端已开启/);
});

test('warnings, a refused change and the problems of a feature are shown as lines', () => {
  const state = makeState({
    warnings: [{ code: 'upstream-failed', detail: 'aicode: timeout' }, { code: 'new-code', detail: 'x' }],
    l10n: { ready: false },
  });
  const tree = shown(state, [undefined, { kind: 'failed', data: { error: 'server-type', name: 'n' } }]);
  assert.deepEqual(notices(tree), [
    'n 在服务端不是布尔开关，不能改。',
    '最近有请求转发失败（aicode: timeout）。',
    'new-code: x',
    '词条表读不出来，界面仍是英文，请重新安装本工具。',
  ]);
});

test('a risky feature asks before it is turned on', async (t) => {
  const sent = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push([url, init.method, init.body]);
    return { ok: false, status: 500, json: async () => null };
  };
  t.after(() => {
    globalThis.fetch = before;
  });

  // A click on the switch only asks.
  let tree = shown(makeState());
  switches(tree)[2].props.onClick();
  assert.deepEqual(sent, []);

  // The question is open: the risk in words, and two buttons.
  tree = shown(makeState(), [undefined, undefined, 'risk:risky']);
  assert.deepEqual(notices(tree), ['配额会成倍消耗。仍要开启取消']);
  const yes = buttons(tree).find((node) => textOf([node]) === '仍要开启');
  yes.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent[0], ['/__agy_flags/flags.json', 'POST', '{"changes":{"p1":true,"r1":true}}']);

  // A feature without a risk is changed at once, and off needs no question.
  const allOn = makeState({ overrides: { p1: true, p2: true, r1: true } });
  sent.length = 0;
  tree = shown(allOn);
  switches(tree)[1].props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent[0], ['/__agy_flags/flags.json', 'POST', '{"changes":{"p1":null,"p2":null}}']);
  sent.length = 0;
  tree = shown(allOn);
  switches(tree)[2].props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent[0], ['/__agy_flags/flags.json', 'POST', '{"changes":{"r1":null}}']);
});

test('the restart is asked about first, in the place where it was clicked', async (t) => {
  const sent = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push([url, init.method, init.body]);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  t.after(() => {
    globalThis.fetch = before;
  });
  const pending = makeState({ pendingRestart: true, pendingReason: 'flags-changed' });
  let tree = shown(pending);
  assert.deepEqual(notices(tree), ['你改了开关，重启 Antigravity 后生效。重启 Antigravity']);
  buttons(tree).find((node) => textOf([node]) === '重启 Antigravity').props.onClick();
  assert.deepEqual(sent, []);

  tree = shown(pending, [undefined, undefined, 'restart:top']);
  assert.deepEqual(notices(tree), ['这会退出并重新打开 Antigravity，正在运行的任务会中断。重启取消']);
  // The row at the end of the page still shows its own button, not a second question.
  assert.equal(buttons(tree).filter((node) => textOf([node]) === '重启').length, 2);
  buttons(tree).find((node) => textOf([node]) === '重启').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent[0], ['/__agy_flags/restart-client.json', 'POST', '{}']);

  // While the client restarts, there is nothing to click.
  tree = shown(makeState({ restarting: true }));
  assert.deepEqual(notices(tree), ['正在重启…正在重启…']);
  assert.ok(buttons(tree).every((node) => node.props.disabled === true));
});

test('a mistake while the page is drawn leaves a short note, not a broken window', () => {
  const React = fakeReact();
  const Page = settingsPageFactory(React, OPTIONS);
  // The page is wrapped in a part that catches such mistakes.
  const wrapper = Page({ active: true });
  assert.equal(typeof wrapper.type.getDerivedStateFromError, 'function');
  assert.deepEqual(wrapper.type.getDerivedStateFromError(new Error('x')), { failed: true });
  const boundary = new wrapper.type({ compact: false, children: 'page' });
  boundary.state = { failed: true };
  assert.match(textOf(draw(boundary.render())), /This page failed|这一页出错了/);
});

// ---- the changes to the page script ---------------------------------------------------------

/** A script with the shapes of the real one, and a React that keeps what it is asked to make. */
function script(react = 'Q') {
  return `var ${react}={createElement:(type,props,...children)=>({type,props:props||{},children}),Component:class{}};${fakeSettingsScript(react)}`;
}

function run(source) {
  const context = vm.createContext({ console: { error() {} } });
  vm.runInContext(source, context);
  return context;
}

test('the page is added to the three places, and the script still runs', () => {
  const source = script();
  const result = patchSettingsPage(source, OPTIONS);
  assert.equal(result.ok, true);
  assert.equal(result.reported, false);
  const context = run(result.source);

  // The navigation: one more page, at the end.
  assert.equal(vm.runInContext('navTable.map((entry) => entry.screen).join()', context), `General,App,Developer,Running,${SETTINGS_SCREEN}`);
  assert.equal(vm.runInContext('navTable[1].label', context), 'Application');
  assert.equal(typeof context.__agyFlagsSettings, 'function');

  // The settings window: the page is there, and shown when it is the chosen one.
  const pages = (name) => vm.runInContext(`settingsWindow(${JSON.stringify(name)}).children`, context);
  const ours = pages(SETTINGS_SCREEN)[2];
  assert.equal(ours.props.style.display, 'block');
  assert.equal(ours.children[0].props.active, true);
  assert.equal(typeof ours.children[0].type, 'function');
  assert.equal(pages('General')[2].props.style.display, 'none');
  assert.equal(pages('General')[2].children[0].props.active, false);
  // The pages of the client stay where they were.
  assert.equal(pages('General')[0].props.style.display, 'block');
  assert.equal(pages('Developer')[1].props.style.display, 'block');

  // The narrow layout: one more case.
  const single = vm.runInContext(`settingsPage(${JSON.stringify(SETTINGS_SCREEN)})`, context);
  assert.deepEqual({ ...single.props }, { active: true, compact: true });
  assert.equal(single.type, ours.children[0].type);
  assert.equal(vm.runInContext('settingsPage("Running").type === Dev', context), true);
  assert.equal(vm.runInContext('settingsPage("nothing")', context), null);

  // The name of this page is not reported; every other page is, as before.
  const reports = vm.runInContext(
    `(() => { const seen = []; const w = { fireEvent: (name, data) => seen.push([name, data.extra.screen]) }; viewed(w, ${JSON.stringify(SETTINGS_SCREEN)}); viewed(w, "General"); return seen; })()`,
    context
  );
  assert.deepEqual(JSON.parse(JSON.stringify(reports)), [['settings_page_viewed', 'General']]);
});

test('the places are found whatever React is called', () => {
  const result = patchSettingsPage(script('$e'), OPTIONS);
  assert.equal(result.ok, true);
  const context = run(result.source);
  assert.equal(vm.runInContext(`settingsWindow(${JSON.stringify(SETTINGS_SCREEN)}).children[2].props.style.display`, context), 'block');
});

test('the component is made once, and a failure while it is made leaves an empty page', () => {
  const context = run(patchSettingsPage(script(), OPTIONS).source);
  // This React has no hooks, but making the component does not need them.
  const first = vm.runInContext('__agyFlagsSettings(Q)', context);
  assert.equal(vm.runInContext('__agyFlagsSettings(Q)', context), first);
  // A React without the Component class: the page cannot be made.
  const broken = run(patchSettingsPage(script(), OPTIONS).source.replace(',Component:class{}', ''));
  const empty = vm.runInContext('__agyFlagsSettings(Q)', broken);
  assert.equal(empty(), null);
});

test('a script without one of the places is left alone, with the reason', () => {
  const source = script();
  const without = (text) => {
    assert.ok(source.includes(text), text);
    return patchSettingsPage(source.replace(text, ''), OPTIONS);
  };
  assert.match(without('{screen:"General"},').reason, /list of setting pages was found 0 times/);
  assert.match(without('==="Developer"?"block":"none"').reason, /pages of the settings window were found 0 times/);
  assert.match(without('case "Developer":return Q.createElement(Dev,null);').reason, /single setting page was found 0 times/);
  assert.match(patchSettingsPage(`${source}var again=[{screen:"General"},{screen:"Other"}];`, OPTIONS).reason, /found 2 times/);
  assert.match(patchSettingsPage(source.replace('case "Developer":return Q.', 'case "Developer":return Z.'), OPTIONS).reason, /same React/);
  // A second run changes nothing more.
  const once = patchSettingsPage(source, OPTIONS);
  assert.match(patchSettingsPage(once.source, OPTIONS).reason, /already have a page/);
});

test('without the place of the report the page is still added, and the result says so', () => {
  const source = script().replace('.fireEvent("settings_page_viewed"', '.fireEvent("something_else"');
  const result = patchSettingsPage(source, OPTIONS);
  assert.equal(result.ok, true);
  assert.equal(result.reported, true);
  assert.equal(vm.runInContext('navTable.at(-1).screen', run(result.source)), SETTINGS_SCREEN);
});
