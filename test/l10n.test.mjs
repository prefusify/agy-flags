import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { L10N_ATTRIBUTES, isDictionary, isSafePattern, l10nFactory, loadDictionary, patchL10n } from '../src/l10n.mjs';
import { PART_L10N, patchMainJs } from '../src/uipatch.mjs';
import { fakePageScript, tempHome } from './helpers.mjs';

const WORD_LIST = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'src', 'l10n', 'zh-CN.json');

const DATA = {
  exact: {
    Settings: '设置',
    'New Conversation': '新建对话',
    Copy: '复制',
    'More options': '更多选项',
    'Search…': '搜索…',
    Skills: 'Skills',
  },
  patterns: [
    ['^Show (\\d+) More$', '再显示 $1 项'],
    ['^(\\d+) selected$', '已选 $1 项'],
    ['^Delete "(.+)" from (.+)\\?$', '要从 $2 中删除「$1」吗？'],
  ],
};

// ---- a page that is just enough for the translator ------------------------------------------

/** What a page gives the translator: elements, text/comment nodes, and an observer that is told about changes. */
function fakePage() {
  const observers = [];
  const tell = (record) => {
    for (const o of observers) {
      if (!o.target) continue;
      if (record.type === 'attributes' && !o.options.attributeFilter.includes(record.attributeName)) continue;
      o.records.push(record);
    }
  };
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.records = [];
      this.target = null;
      observers.push(this);
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
    takeRecords() {
      const taken = this.records;
      this.records = [];
      return taken;
    }
    disconnect() {
      this.target = null;
      this.records = [];
    }
  }
  const link = (parent, node) => {
    node.parentNode = parent;
    node.nextSibling = null;
    if (parent.lastChild) parent.lastChild.nextSibling = node;
    else parent.firstChild = node;
    parent.lastChild = node;
  };
  const text = (value) => {
    let current = value;
    return {
      nodeType: 3,
      parentNode: null,
      nextSibling: null,
      writes: 0,
      get nodeValue() {
        return current;
      },
      set nodeValue(next) {
        current = next;
        this.writes += 1;
        tell({ type: 'characterData', target: this });
      },
    };
  };
  const comment = (value = '') => ({
    nodeType: 8,
    nodeValue: value,
    parentNode: null,
    nextSibling: null,
  });
  /** el('div', { class: 'a b', title: 'x' }, child, 'text', ...) */
  const el = (tag, attrs = {}, ...children) => {
    const attributes = new Map(Object.entries(attrs));
    const node = {
      nodeType: 1,
      tagName: tag === 'svg' ? 'svg' : tag.toUpperCase(),
      parentNode: null,
      nextSibling: null,
      firstChild: null,
      lastChild: null,
      getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
      hasAttribute: (name) => attributes.has(name),
      setAttribute(name, value) {
        attributes.set(name, String(value));
        tell({ type: 'attributes', target: node, attributeName: name });
      },
      get classList() {
        const names = String(attributes.get('class') || '').split(/\s+/).filter(Boolean);
        return { length: names.length, contains: (name) => names.includes(name) };
      },
      append(...nodes) {
        const added = nodes.map((child) => (typeof child === 'string' ? text(child) : child));
        for (const child of added) link(node, child);
        tell({ type: 'childList', target: node, addedNodes: added, removedNodes: [] });
        return added.length === 1 ? added[0] : added;
      },
      insertBefore(newChild, refChild) {
        const child = typeof newChild === 'string' ? text(newChild) : newChild;
        if (!refChild) return node.append(child);
        child.parentNode = node;
        if (node.firstChild === refChild) {
          child.nextSibling = refChild;
          node.firstChild = child;
        } else {
          let before = null;
          for (let cur = node.firstChild; cur && cur !== refChild; cur = cur.nextSibling) before = cur;
          if (before) {
            child.nextSibling = refChild;
            before.nextSibling = child;
          }
        }
        tell({ type: 'childList', target: node, addedNodes: [child], removedNodes: [] });
        return child;
      },
      removeChild(child) {
        let before = null;
        for (let cur = node.firstChild; cur && cur !== child; cur = cur.nextSibling) before = cur;
        if (before) before.nextSibling = child.nextSibling;
        else node.firstChild = child.nextSibling;
        if (node.lastChild === child) node.lastChild = before;
        child.parentNode = null;
        child.nextSibling = null;
        tell({ type: 'childList', target: node, addedNodes: [], removedNodes: [child] });
        return child;
      },
    };
    for (const child of children) link(node, typeof child === 'string' ? text(child) : child);
    return node;
  };
  /** Give the observers what happened since the last time, as the browser does after a task. */
  const settle = () => {
    for (const o of observers) {
      if (!o.target) continue;
      const records = o.takeRecords();
      if (records.length > 0) o.callback(records);
    }
  };
  const html = el('html');
  const body = el('body');
  link(html, body);
  return { el, text, comment, body, settle, observers, document: { documentElement: html }, MutationObserver: Observer };
}

/** The translator, working on a fake page. */
function setup(data = DATA) {
  const page = fakePage();
  const before = globalThis.MutationObserver;
  globalThis.MutationObserver = page.MutationObserver;
  const translator = l10nFactory(data);
  const start = () => {
    translator.start(page.document);
    page.settle();
  };
  const restore = () => {
    translator.stop();
    globalThis.MutationObserver = before;
  };
  return { ...page, translator, start, restore };
}

const textOf = (node) => {
  let out = '';
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) out += child.nodeValue;
    else if (child.nodeType === 1) out += textOf(child);
  }
  return out;
};

const childrenOf = (node) => {
  const out = [];
  for (let child = node.firstChild; child; child = child.nextSibling) out.push(child);
  return out;
};

// ---- the word list --------------------------------------------------------------------------

test('a text is looked up whole, and keeps the spaces around it', () => {
  const { lookup } = l10nFactory(DATA);
  assert.equal(lookup('Settings'), '设置');
  assert.equal(lookup('  Settings\n'), '  设置\n');
  assert.equal(lookup('New   Conversation'), '新建对话');
  assert.equal(lookup('Show 12 More'), '再显示 12 项');
  assert.equal(lookup('3 selected'), '已选 3 项');
  assert.equal(lookup('Delete "notes.md" from CLI Project?'), '要从 CLI Project 中删除「notes.md」吗？');
  // Never a part of a text, never another spelling.
  for (const other of ['Open Settings', 'settings', 'Settings.', 'Show More', 'x 3 selected', '设置', '12', '', 'S', null, undefined, 7]) {
    assert.equal(lookup(other), null, String(other));
  }
  // An entry that is the same in both languages changes nothing.
  assert.equal(lookup('Skills'), null);
  assert.equal(lookup(`Settings${' '.repeat(1100)}`), null);
  // Descriptions up to 1000 characters (e.g. the 630-char built-in plugin skill description) are allowed.
  const longKey = `Plugin guide ${'a '.repeat(320)}end`;
  assert.ok(longKey.length > 600 && longKey.length <= 1000);
  assert.equal(l10nFactory({ exact: { [longKey]: '插件指南' }, patterns: [] }).lookup(longKey), '插件指南');
});

test('names of an object are not entries', () => {
  const { lookup } = l10nFactory(DATA);
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(lookup(name), null, name);
});

test('typographic quotes and ellipsis are normalized without folding letter case', () => {
  const { lookup } = l10nFactory({
    exact: {
      'Searching...': '搜索中…',
      'Starting…': '启动中…',
      "Don't ask again": '不再询问',
      'This site can’t be reached': '无法访问此网站',
      'No sites match "foo".': '没有匹配「foo」的网站。',
      Settings: '设置',
    },
    patterns: [
      ['^Loading (.+?)\\.\\.\\.$', '加载 $1 中…'],
      ['^Zipping (.+?)…$', '压缩 $1 中…'],
      ['^No sites match “(.+?)”\\.$', '没有匹配「$1」的网站。'],
    ],
  });
  // Ellipsis both directions
  assert.equal(lookup('Searching…'), '搜索中…');
  assert.equal(lookup('Searching...'), '搜索中…');
  assert.equal(lookup('Starting...'), '启动中…');
  assert.equal(lookup('Starting…'), '启动中…');
  // Curly vs straight quotes both directions
  assert.equal(lookup('Don’t ask again'), '不再询问');
  assert.equal(lookup("This site can't be reached"), '无法访问此网站');
  assert.equal(lookup('No sites match “foo”.'), '没有匹配「foo」的网站。');
  // Patterns match across ellipsis and curly quotes
  assert.equal(lookup('Loading branches…'), '加载 branches 中…');
  assert.equal(lookup('Zipping archive...'), '压缩 archive 中…');
  assert.equal(lookup('Zipping archive…'), '压缩 archive 中…');
  assert.equal(lookup('No sites match "example.com".'), '没有匹配「example.com」的网站。');
  assert.equal(lookup('No sites match “example.com”.'), '没有匹配「example.com」的网站。');
  // Letter case is never folded.
  assert.equal(lookup('settings'), null);
  assert.equal(lookup('SETTINGS'), null);
});

test('a pattern is only tried for a text that has its fixed words', () => {
  let tried = 0;
  const RealRegExp = globalThis.RegExp;
  const counting = (source) => {
    const re = new RealRegExp(source);
    const exec = re.exec.bind(re);
    re.exec = (text) => {
      tried += 1;
      return exec(text);
    };
    return re;
  };
  // Count the tries of the patterns of the word list only.
  globalThis.RegExp = function (source, flags) {
    return DATA.patterns.some((row) => row[0] === source) ? counting(source) : new RealRegExp(source, flags);
  };
  let lookup;
  try {
    lookup = l10nFactory(DATA).lookup;
  } finally {
    globalThis.RegExp = RealRegExp;
  }
  assert.equal(lookup('A long sentence that no pattern can match, with many words in it.'), null);
  assert.equal(tried, 0);
  assert.equal(lookup('7 selected'), '已选 7 项');
  assert.equal(tried, 1);
});

test('a more particular pattern wins over a general one, in whatever order they are', () => {
  const rows = [
    ['^Error (.+?)$', '错误 $1'],
    ['^(.+?) archived conversations$', '$1 个已归档的对话'],
    ['^Error restarting (.+?): (.+?)$', '重启 $1 时出错：$2'],
    ['^(.+?) active conversations and (.+?) archived conversations$', '$1 个进行中的对话和 $2 个已归档的对话'],
  ];
  for (const patterns of [rows, [...rows].reverse()]) {
    const { lookup } = l10nFactory({ exact: {}, patterns });
    assert.equal(lookup('Error restarting server: timeout'), '重启 server 时出错：timeout');
    assert.equal(lookup('Error timeout'), '错误 timeout');
    assert.equal(lookup('3 active conversations and 2 archived conversations'), '3 个进行中的对话和 2 个已归档的对话');
    assert.equal(lookup('2 archived conversations'), '2 个已归档的对话');
  }
});

test('fixedText handles \\s+ and constrained groups outrank wildcard patterns regardless of order', () => {
  const rows = [
    ['^Thought for (.+)$', '思考了 $1'],
    ['^Thought for (.+?)s$', '思考了 $1 秒'],
    ['^Thought\\s+for\\s+(\\d+)\\s*m\\s+(\\d+(?:\\.\\d+)?)\\s*s$', '已思考 $1 分钟 $2 秒'],
    ['^Thought\\s+for\\s+(\\d+)\\s*m$', '已思考 $1 分钟'],
    ['^Thought\\s+for\\s+(\\d+(?:\\.\\d+)?)\\s*s$', '已思考 $1 秒'],
    ['^Worked for (.+)$', '耗时 $1'],
    ['^Worked\\s+for\\s+(\\d+)\\s*m\\s+(\\d+(?:\\.\\d+)?)\\s*s$', '已处理 $1 分钟 $2 秒'],
    ['^Worked\\s+for\\s+(\\d+(?:\\.\\d+)?)\\s*s$', '已处理 $1 秒'],
    ['^(.+?) active conversations$', '通配 $1 个活跃对话'],
    ['^(\\d+) active conversations$', '数字 $1 个活跃对话'],
    ['^(.+?) Queues after the turn$', '通配 $1'],
    ['^(Enter|Alt\\+Enter) Queues after the turn$', '枚举 $1'],
    ['^Executing\\s+task:\\s+(.+)$', '执行任务：$1'],
  ];
  for (const patterns of [rows, [...rows].reverse()]) {
    const { lookup } = l10nFactory({ exact: {}, patterns });
    assert.equal(lookup('Thought for 2m 15s'), '已思考 2 分钟 15 秒');
    assert.equal(lookup('Thought for 5m'), '已思考 5 分钟');
    assert.equal(lookup('Thought for 5s'), '已思考 5 秒');
    assert.equal(lookup('Worked for 1m 23s'), '已处理 1 分钟 23 秒');
    assert.equal(lookup('Worked for 42s'), '已处理 42 秒');
    assert.equal(lookup('42 active conversations'), '数字 42 个活跃对话');
    assert.equal(lookup('Enter Queues after the turn'), '枚举 Enter');
    // Multi-word \s+ pattern is NOT falsely classified as loose=true.
    assert.equal(
      lookup('Executing task: Run all integration tests across the workspace'),
      '执行任务：Run all integration tests across the workspace'
    );
  }
});

test('a pattern with one fixed word is not used for a sentence, except explicit colon prefixes', () => {
  const { lookup } = l10nFactory({
    exact: {},
    patterns: [
      ['^Turn (.+?)$', '第 $1 轮'],
      ['^Using (.+?)$', '正在使用 $1'],
      ['^Show (.+?)$', '显示 $1'],
      ['^Creating (.+?)$', '创建 $1 中…'],
      ['^Context: (.+)$', '上下文：$1'],
      ['^Error: (.+?)$', '错误：$1'],
      ['^Thought for (.+?)$', '思考了 $1'],
    ],
  });
  // What a pattern of one word is for: a number, a name, a few words (up to 3-word names).
  assert.equal(lookup('Turn 3'), '第 3 轮');
  assert.equal(lookup('Using Google Chrome'), '正在使用 Google Chrome');
  assert.equal(lookup('Using Visual Studio Code'), '正在使用 Visual Studio Code');
  assert.equal(lookup('Context: 37.5k / 840k (4.5%)'), '上下文：37.5k / 840k (4.5%)');
  // A sentence of the server, including sentences mixed with numbers, is rejected.
  assert.equal(lookup('Turn Figma designs into production code, map components'), null);
  assert.equal(lookup('Using the Google Antigravity Python SDK to build agents'), null);
  assert.equal(lookup('Show all 5 remaining items'), null);
  assert.equal(lookup('Creating project 42 took > 7 seconds'), null);
  // Explicit colon-prefixed UI labels translate even with longer messages.
  assert.equal(lookup('Error: Failed to connect to the remote server due to timeout'), '错误：Failed to connect to the remote server due to timeout');
  // A pattern with more fixed words is trusted with a longer part.
  assert.equal(lookup('Thought for a long time about the question'), '思考了 a long time about the question');
});

test('structured single-word UI patterns are exempted from loose prose rejection while bare verbs remain strict', () => {
  const { lookup } = l10nFactory({
    exact: {},
    patterns: [
      ['^(.+?) — Toggles: (.+?)$', '$1 — 切换：$2'],
      ['^(.+?) — Inserts: (.+?)$', '$1 — 插入：$2'],
      ['^(.+?) · Remote$', '$1 · 远程'],
      ['^See (.+?): (.+?)$', '参阅 $1：$2'],
      ['^Started "(.+?)"\\.$', '已启动「$1」。'],
      ['^Task "(.+?)"$', '任务「$1」'],
      ['^Resolved "(.+?)"$', '已解决「$1」'],
      ['^(.+?) \\(Default\\)$', '$1（默认）'],
      ['^(.+?) \\(Remote\\)$', '$1（远程）'],
      ['^(.+?): (\\d+) comments?$', '$1：$2 条评论'],
      ['^(.+?), (\\d+) grants?$', '$1，$2 条授权'],
      ['^Allow (.+?)\\?$', '允许 $1？'],
      ['^Stop (.+?)\\?$', '确定停止 $1？'],
      ['^Loading (.+?)\\.\\.\\.$', '加载 $1 中…'],
      ['^Enter (.+?)\\.\\.\\.$', '输入 $1…'],
      ['^Open (.+?)$', '打开 $1'],
      ['^Conversation (.+?)$', '对话 $1'],
      ['^Running (.+?)$', '运行 $1 中'],
    ],
  });
  assert.equal(lookup('My Flag — Toggles: Enable the new experimental sidebar layout'), 'My Flag — 切换：Enable the new experimental sidebar layout');
  assert.equal(lookup('My Shortcut — Inserts: Insert current file path into prompt'), 'My Shortcut — 插入：Insert current file path into prompt');
  assert.equal(lookup('Production Build Workspace Cluster · Remote'), 'Production Build Workspace Cluster · 远程');
  assert.equal(lookup('Started "Run all integration tests in workspace".'), '已启动「Run all integration tests in workspace」。');
  assert.equal(lookup('Task "Audit DOM blindspots across the sidebar"'), '任务「Audit DOM blindspots across the sidebar」');
  assert.equal(lookup('Resolved "Fix authentication bug in login flow"'), '已解决「Fix authentication bug in login flow」');
  assert.equal(lookup('Open in Built in Browser Window (Default)'), 'Open in Built in Browser Window（默认）');
  assert.equal(lookup('Cloud Development Server Cluster Instance (Remote)'), 'Cloud Development Server Cluster Instance（远程）');
  assert.equal(lookup('Fix authentication bug in login flow: 4 comments'), 'Fix authentication bug in login flow：4 条评论');
  assert.equal(lookup('Google Workspace Enterprise Integration Plugin, 3 grants'), 'Google Workspace Enterprise Integration Plugin，3 条授权');
  // Short targets still translate for loose single-word patterns (including "?$", "...$", and "See X: Y").
  assert.equal(lookup('Loading branches...'), '加载 branches 中…');
  assert.equal(lookup('Stop my-server?'), '确定停止 my-server？');
  assert.equal(lookup('See docs: MCP'), '参阅 docs：MCP');
  // Long English sentences with "?$", "...$", "See X: Y", or bare single verbs remain rejected by loose.
  assert.equal(lookup('Allow the browser extension to read all tabs and modify page content?'), null);
  assert.equal(lookup('Loading the remote workspace and indexing project files...'), null);
  assert.equal(lookup('Enter a detailed description of the issue you encountered...'), null);
  assert.equal(lookup('See documentation: how to configure custom plugins'), null);
  assert.equal(lookup('Open the settings panel to configure your preferences'), null);
  assert.equal(lookup('Conversation is not open in this Hub window'), null);
  assert.equal(lookup('Running all the integration tests in the workspace'), null);
});

test('a pattern must be simple', () => {
  for (const good of ['^Show (\\d+) More$', '^(.+) and (\\d+) others?$', '^Turn \\((.+)\\)$', '^(?:Open|Close) (.+)$', '^[A-Z]+ (.+)\\.$']) {
    assert.equal(isSafePattern(good), true, good);
  }
  for (const bad of [
    'Show (\\d+) More',
    '^Show (\\d+) More',
    'Show (\\d+) More$',
    '^ Show (\\d+) More$',
    '^Show (\\d+) More $',
    '^(a+)+$',
    '^(a|b)*c$',
    '^(\\d+){2,} x$',
    '^(.+)(.+)$',
    '^(.+?)(.+?) end$',
    '^(.+) a (.+) b (.+) c (.+) d (.+)$',
    '^Open (.+)$|^Close$',
    '^(.+) \\1$',
    '^(unclosed$',
    '^[unclosed$',
    '^ends with a dollar\\$',
    `^${'a'.repeat(400)}$`,
    '',
    null,
  ]) {
    assert.equal(isSafePattern(bad), false, String(bad));
  }
});

test('a word list is checked before it goes into the page, including optional inline templates', () => {
  assert.equal(isDictionary(DATA), true);
  assert.equal(
    isDictionary({
      ...DATA,
      inline: {
        'Always open {1} links without asking': '始终直接打开 {1} 链接，不再询问',
        '{1} Press {2} to continue': '{1} 按 {2} 继续',
        'Visit {1} or {2} for {3}.': '访问 {1} 或 {2} 获取 {3}。',
        'See {1}, {2}, {3}, and {4}.': '参阅 {1}、{2}、{3} 和 {4}。',
        'Click {1}, pick {2}, select {3}, click {4}, then {5}.': '点 {1}、选 {2}、选 {3}、点 {4}，再点 {5}。',
        'A {1} B {2} C {3} D {4} E {5} F {6} G': '甲 {1} 乙 {2} 丙 {3} 丁 {4} 戊 {5} 己 {6} 庚',
      },
    }),
    true
  );
  assert.equal(isDictionary({ exact: { ['a'.repeat(630)]: '长文本', ['b'.repeat(1000)]: '上限文本' }, patterns: [] }), true);
  const bad = [
    null,
    [],
    {},
    { exact: {}, patterns: [] },
    { exact: { a: 'b' } },
    { exact: { 'Two  spaces': 'x' }, patterns: [] },
    { exact: { ' padded': 'x' }, patterns: [] },
    { exact: { Empty: '' }, patterns: [] },
    { exact: { Number: 7 }, patterns: [] },
    { exact: { Control: 'a\u0000b' }, patterns: [] },
    { exact: { Long: 'x'.repeat(1001) }, patterns: [] },
    { exact: { a: 'b' }, patterns: [['Show (\\d+)', '$1']] },
    { exact: { a: 'b' }, patterns: [['^Show (\\d+)$', '$2 项']] },
    { exact: { a: 'b' }, patterns: [['^Show (\\d+)$', '$& 项']] },
    { exact: { a: 'b' }, patterns: [['^Show (\\d+)$', '项 $']] },
    { exact: { a: 'b' }, patterns: [['^Show (\\d+)$']] },
    { exact: { a: 'b' }, patterns: 'none' },
    // Invalid inline tables
    { exact: { a: 'b' }, patterns: [], inline: [] },
    { exact: { a: 'b' }, patterns: [], inline: { 'No slots here': '没有槽位' } },
    { exact: { a: 'b' }, patterns: [], inline: { 'Swap {1} and {2}': '交换 {2} 和 {1}' } },
    { exact: { a: 'b' }, patterns: [], inline: { 'Too many {1} {2} {3} {4} {5} {6} {7}': '太多 {1} {2} {3} {4} {5} {6} {7}' } },
    // Boundary violations: must not add text where DOM has no text node
    { exact: { a: 'b' }, patterns: [], inline: { '{1} files': '共 {1} 个文件' } },
    { exact: { a: 'b' }, patterns: [], inline: { 'Open {1}': '打开 {1} 项' } },
    { exact: { a: 'b' }, patterns: [], inline: { 'Use {1}{2} now': '使用 {1} 和 {2}' } },
  ];
  for (const data of bad) assert.equal(isDictionary(data), false, JSON.stringify(data));
  assert.equal(patchL10n('var a=1;', { exact: {}, patterns: [] }).ok, false);
});

test('the word list file is read, and a broken one gives nothing', (t) => {
  const dir = tempHome();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'words.json');
  assert.equal(loadDictionary(file), null);
  fs.writeFileSync(file, '{ not json');
  assert.equal(loadDictionary(file), null);
  fs.writeFileSync(file, JSON.stringify({ exact: { a: 7 }, patterns: [] }));
  assert.equal(loadDictionary(file), null);
  fs.writeFileSync(file, JSON.stringify({ note: 'kept out', ...DATA }));
  const first = loadDictionary(file);
  assert.deepEqual(first.data, DATA);
  assert.equal(first.count, 9);
  // Optional inline field is preserved and counted when present.
  const withInline = { ...DATA, inline: { 'Always open {1} links': '始终打开 {1} 链接' } };
  fs.writeFileSync(file, JSON.stringify(withInline));
  const second = loadDictionary(file);
  assert.deepEqual(second.data, withInline);
  assert.equal(second.count, 10);
  assert.notEqual(second.version, first.version);
});

// ---- the page -------------------------------------------------------------------------------

test('the text and the attributes of the page are translated when the translator starts', (t) => {
  const page = setup();
  t.after(page.restore);
  const button = page.el('button', { title: 'Copy', 'aria-label': 'More options', id: 'Settings' }, 'Settings');
  const input = page.el('input', { placeholder: 'Search…', 'aria-valuetext': 'Settings', 'aria-roledescription': 'Copy' });
  const slot = page.el('span', { 'data-slot-out': 'Settings', 'aria-hidden': 'true' });
  const unknown = page.el('p', {}, 'Nothing in the list');
  page.body.append(page.el('div', {}, button, input, slot, unknown, page.el('span', {}, ' Show 3 More ')));
  page.start();
  assert.equal(textOf(button), '设置');
  assert.equal(button.getAttribute('title'), '复制');
  assert.equal(button.getAttribute('aria-label'), '更多选项');
  // An attribute that the user does not see stays.
  assert.equal(button.getAttribute('id'), 'Settings');
  assert.equal(input.getAttribute('placeholder'), '搜索…');
  assert.equal(input.getAttribute('aria-valuetext'), '设置');
  assert.equal(input.getAttribute('aria-roledescription'), '复制');
  assert.equal(slot.getAttribute('data-slot-out'), '设置');
  assert.equal(textOf(unknown), 'Nothing in the list');
  assert.equal(textOf(page.body), '设置Nothing in the list 再显示 3 项 ');
  assert.deepEqual([...L10N_ATTRIBUTES].sort(), [...page.observers[0].options.attributeFilter].sort());
});

test('code, editors, Shiki code/diff blocks, PDF text layers and drawings are never translated', (t) => {
  const page = setup();
  t.after(page.restore);
  const closed = [
    page.el('code', {}, 'Settings'),
    page.el('pre', {}, page.el('span', {}, 'Settings')),
    page.el('textarea', {}, 'Settings'),
    page.el('style', {}, 'Settings'),
    page.el('script', {}, 'Settings'),
    page.el('kbd', {}, 'Copy'),
    page.el('svg', {}, page.el('title', {}, 'Settings')),
    page.el('div', { contenteditable: 'true' }, page.el('p', {}, 'Settings')),
    page.el('div', { contenteditable: '' }, 'Settings'),
    page.el('div', { class: 'view monaco-editor' }, page.el('button', { title: 'Copy' }, 'Settings')),
    page.el('div', { class: 'xterm' }, page.el('span', {}, 'Settings')),
    page.el('span', { class: 'katex' }, 'Settings'),
    page.el('div', { class: 'code-block' }, page.el('div', { class: 'code-line' }, page.el('span', {}, 'Settings'))),
    page.el('div', { 'data-testid': 'pdf-text-layer', class: 'textLayer' }, page.el('span', {}, 'Settings')),
    page.el('span', { 'data-line-tokens': '' }, page.el('span', {}, 'Settings')),
    page.el('div', { translate: 'no' }, page.el('button', {}, 'Settings')),
  ];
  page.body.append(...closed, page.el('div', { contenteditable: 'false' }, 'Settings'));
  page.start();
  for (const node of closed) assert.equal(textOf(node), node.tagName === 'KBD' ? 'Copy' : 'Settings', node.tagName);
  assert.equal(closed[9].firstChild.getAttribute('title'), 'Copy');
  assert.equal(textOf(page.body.lastChild), '设置');
  // A button inside an editor or PDF layer is still closed.
  assert.equal(page.translator.modeOf(closed[9].firstChild), 0);
  assert.equal(page.translator.modeOf(closed[13]), 0);
});

test('textarea and contenteditable translate own visible attributes while keeping children closed', (t) => {
  const page = setup();
  t.after(page.restore);
  const ta = page.el('textarea', { 'data-testid': 'vcs-commit-message', placeholder: 'Search…', 'aria-label': 'Settings', title: 'Copy' }, 'Settings');
  const editable = page.el(
    'div',
    { contenteditable: 'true', 'aria-placeholder': 'Search…', 'aria-label': 'More options' },
    page.el('p', {}, 'Settings'),
    page.el('button', {}, 'Copy')
  );
  const editorTa = page.el('div', { class: 'monaco-editor' }, page.el('textarea', { placeholder: 'Search…' }, 'Settings'));
  const contentTa = page.el('div', { 'data-testid': 'planner-response-text' }, page.el('textarea', { placeholder: 'Search…' }, 'Settings'));
  page.body.append(ta, editable, editorTa, contentTa);
  page.start();
  // Own attributes translated when parent is OPEN
  assert.equal(ta.getAttribute('placeholder'), '搜索…');
  assert.equal(ta.getAttribute('aria-label'), '设置');
  assert.equal(ta.getAttribute('title'), '复制');
  assert.equal(textOf(ta), 'Settings');
  assert.equal(editable.getAttribute('aria-placeholder'), '搜索…');
  assert.equal(editable.getAttribute('aria-label'), '更多选项');
  assert.equal(textOf(editable), 'SettingsCopy');
  // Dynamic attribute update on textarea is translated
  ta.setAttribute('placeholder', 'More options');
  page.settle();
  assert.equal(ta.getAttribute('placeholder'), '更多选项');
  // Nested inside CLOSED or CONTENT: attributes are NOT translated
  assert.equal(editorTa.firstChild.getAttribute('placeholder'), 'Search…');
  assert.equal(contentTa.firstChild.getAttribute('placeholder'), 'Search…');
  editorTa.firstChild.setAttribute('placeholder', 'Copy');
  page.settle();
  assert.equal(editorTa.firstChild.getAttribute('placeholder'), 'Copy');
});

test('what the user and the model wrote stays, but controls inside it are translated', (t) => {
  const page = setup();
  t.after(page.restore);
  const copy = page.el('button', { title: 'Copy' }, 'Copy');
  const menuCheck = page.el('div', { role: 'menuitemcheckbox' }, 'Copy');
  const menuRadio = page.el('div', { role: 'menuitemradio' }, 'Settings');
  const radioDiv = page.el('div', { role: 'radio' }, 'Copy');
  const optionDiv = page.el('div', { role: 'option' }, 'Copy');
  const dialogDiv = page.el('div', { role: 'dialog' }, 'Settings');
  const reply = page.el(
    'div',
    { 'data-testid': 'planner-response-text' },
    page.el(
      'div',
      { 'data-markdown-root': '', title: 'Settings' },
      page.el('p', {}, 'Settings'),
      page.el('div', {}, copy, menuCheck, menuRadio, radioDiv, optionDiv, dialogDiv, page.el('pre', {}, page.el('code', {}, 'Copy')))
    )
  );
  const message = page.el('div', { 'data-testid': 'user-message-bubble' }, page.el('div', { 'data-testid': 'user-message-content' }, 'New Conversation'));
  const row = page.el(
    'div',
    { 'data-testid': 'conversation-row-sidebar' },
    page.el('a', { 'aria-label': 'Settings' }, page.el('span', {}, 'Settings')),
    page.el('button', { 'aria-label': 'More options' })
  );
  const histRow = page.el(
    'div',
    { 'data-testid': 'conversation-row-history' },
    page.el('span', {}, 'Settings'),
    page.el('button', { 'aria-label': 'Copy' })
  );
  const branch = page.el('span', { 'data-testid': 'branch-pill-label' }, 'Settings');
  const fileTitle = page.el('span', { 'data-testid': 'file-title-name' }, 'Settings');
  const projItem = page.el('div', { 'data-project-name': 'Settings' }, page.el('span', {}, 'Settings'), page.el('button', { title: 'Settings' }));
  const diffLine = page.el(
    'div',
    { class: 'code-line', 'data-file-uri': 'file:///a.ts' },
    page.el('button', { 'aria-label': 'Copy' }),
    page.el('div', { class: 'line-content' }, page.el('span', {}, 'Settings'))
  );
  const crumb = page.el('span', { 'data-testid': 'breadcrumb-segment', role: 'button', 'aria-label': 'Settings' }, 'Settings');
  const project = page.el('button', { 'data-testid': 'project-header', 'data-project-label': 'x' }, page.el('span', {}, 'Settings'));
  const model = page.el('button', { 'data-testid': 'model-selector-trigger' }, 'Copy');
  const file = page.el('span', { 'data-uri': 'file:///Settings' }, 'Settings');
  const header = page.el('h1', {}, 'Settings');
  page.body.append(reply, message, row, histRow, branch, fileTitle, projItem, diffLine, crumb, project, model, file, header);
  page.start();
  assert.equal(textOf(copy), '复制');
  assert.equal(copy.getAttribute('title'), '复制');
  assert.equal(textOf(menuCheck), '复制');
  assert.equal(textOf(menuRadio), '设置');
  assert.equal(textOf(radioDiv), '复制');
  // option and dialog do NOT punch through CONTENT
  assert.equal(textOf(optionDiv), 'Copy');
  assert.equal(textOf(dialogDiv), 'Settings');
  assert.equal(reply.firstChild.getAttribute('title'), 'Settings');
  assert.equal(textOf(message), 'New Conversation');
  assert.equal(textOf(row), 'Settings');
  assert.equal(row.firstChild.getAttribute('aria-label'), 'Settings');
  assert.equal(row.lastChild.getAttribute('aria-label'), '更多选项');
  assert.equal(textOf(histRow), 'Settings');
  assert.equal(histRow.lastChild.getAttribute('aria-label'), '复制');
  assert.equal(textOf(branch), 'Settings');
  assert.equal(textOf(fileTitle), 'Settings');
  assert.equal(textOf(projItem), 'Settings');
  assert.equal(projItem.lastChild.getAttribute('title'), '设置');
  // Shiki diff line: code protected, hover/fold button translated
  assert.equal(textOf(diffLine), 'Settings');
  assert.equal(diffLine.firstChild.getAttribute('aria-label'), '复制');
  assert.equal(textOf(crumb), 'Settings');
  assert.equal(crumb.getAttribute('aria-label'), 'Settings');
  assert.equal(textOf(project), 'Settings');
  assert.equal(textOf(model), 'Copy');
  assert.equal(textOf(file), 'Settings');
  assert.equal(textOf(header), '设置');
  assert.deepEqual([page.translator.modeOf(reply), page.translator.modeOf(copy), page.translator.modeOf(header)], [1, 2, 2]);
});

test('what the page adds or changes later is translated, and the own changes are not looked at again', (t) => {
  const page = setup();
  t.after(page.restore);
  page.start();
  const label = page.text('Loading');
  const menu = page.el('div', { role: 'menu' }, page.el('div', { role: 'menuitem' }, 'Settings'), page.el('span', {}, label));
  page.body.append(menu);
  page.settle();
  assert.equal(textOf(menu), '设置Loading');
  // The page changes a text and an attribute of nodes that are already there.
  label.nodeValue = 'Copy';
  menu.setAttribute('title', 'More options');
  menu.setAttribute('data-other', 'Settings');
  page.settle();
  assert.equal(label.nodeValue, '复制');
  assert.equal(menu.getAttribute('title'), '更多选项');
  assert.equal(menu.getAttribute('data-other'), 'Settings');
  // The page writes the English text again (React does that when its own text changes back).
  label.nodeValue = 'Settings';
  page.settle();
  assert.equal(label.nodeValue, '设置');
  // Nothing is left to do, and nothing was written twice.
  const writes = label.writes;
  page.settle();
  page.settle();
  assert.equal(label.writes, writes);
  assert.equal(page.observers[0].records.length, 0);
  // A text node added by itself, and text in a place that is not translated.
  const plain = page.el('p');
  page.body.append(plain, page.el('div', { 'data-markdown-root': '' }));
  plain.append('Settings');
  page.body.lastChild.append(page.el('span', {}, 'Settings'));
  page.body.lastChild.append('Copy');
  page.settle();
  assert.equal(textOf(plain), '设置');
  assert.equal(textOf(page.body.lastChild), 'SettingsCopy');
  // A node that was taken out again before the translator saw it.
  const gone = page.el('p', {}, 'Settings');
  page.body.append(gone);
  gone.parentNode = null;
  page.settle();
  assert.equal(textOf(gone), 'Settings');
});

test('contiguous text runs are translated whole even next to icons or comments', (t) => {
  const page = setup({
    exact: { No: '否', Show: '显示', 'No automations yet': '还没有自动化', 'No rules yet': '还没有规则', Settings: '设置' },
    patterns: [
      ['^(\\d+) files$', '$1 个文件'],
      ['^Show (\\d+) more$', '再显示 $1 项'],
    ],
  });
  t.after(page.restore);
  // Pure text group: "No ", kind, " yet"
  const kind = page.text('automations');
  const empty = page.el('p', {}, 'No ', kind, ' yet');
  const count = page.el('span', {}, '3', ' files');
  // Without an entry for the whole sentence, no part is translated, although "No" has one.
  const other = page.el('p', {}, 'No ', 'skills', ' yet');
  // One part with words and one with spaces only is no sentence of parts.
  const single = page.el('span', {}, ' ', 'Settings');
  // Icon + contiguous text run: previously broken (turned into "显示 5 more")!
  const iconMore = page.el('button', {}, page.el('svg'), 'Show ', '5', ' more');
  const iconUnmatched = page.el('button', {}, page.el('svg'), 'No ', 'skills', ' yet');
  // Comment node inside a contiguous text run
  const withComment = page.el('p', {}, 'No ', page.comment(''), 'automations', ' yet');
  page.body.append(empty, count, other, single, iconMore, iconUnmatched, withComment);
  page.start();
  assert.equal(textOf(empty), '还没有自动化');
  assert.equal(empty.firstChild.nodeValue, '还没有自动化');
  assert.equal(kind.nodeValue, '');
  assert.equal(textOf(count), '3 个文件');
  assert.equal(textOf(other), 'No skills yet');
  assert.equal(textOf(single), ' 设置');
  assert.equal(textOf(iconMore), '再显示 5 项');
  assert.equal(textOf(iconUnmatched), 'No skills yet');
  assert.equal(textOf(withComment), '还没有自动化');

  // The page changes one part: the sentence is made again from the English parts.
  kind.nodeValue = 'rules';
  page.settle();
  assert.equal(textOf(empty), '还没有规则');
  kind.nodeValue = 'skills';
  page.settle();
  assert.equal(textOf(empty), 'No skills yet');
  kind.nodeValue = 'automations';
  page.settle();
  assert.equal(textOf(empty), '还没有自动化');

  // Dynamic element insertion splits a text run, and removal merges it back cleanly.
  const n1 = page.text('Show ');
  const n2 = page.text('3');
  const n3 = page.text(' more');
  const dynamic = page.el('button', {}, n1, n2, n3);
  page.body.append(dynamic);
  page.settle();
  assert.equal(textOf(dynamic), '再显示 3 项');
  const divider = page.el('span');
  dynamic.insertBefore(divider, n2);
  page.settle();
  assert.equal(textOf(dynamic), '显示 3 more');
  dynamic.removeChild(divider);
  page.settle();
  assert.equal(textOf(dynamic), '再显示 3 项');

  // A part is taken out: what is left is one text, translated as one.
  const words = page.el('span', {}, 'Settings', ' x');
  page.body.append(words);
  page.settle();
  assert.equal(textOf(words), 'Settings x');
  words.removeChild(words.lastChild);
  page.settle();
  assert.equal(textOf(words), '设置');
  // Nothing is left to do.
  page.settle();
  assert.equal(page.observers[0].records.length, 0);
});

test('inline-slot templates translate in place without adding, removing, or moving DOM nodes', (t) => {
  const page = setup({
    exact: { 'Tip:': '提示：', 'Always open': '始终打开', Settings: '设置' },
    patterns: [],
    inline: {
      'Always open {1} links without asking': '始终直接打开 {1} 链接，不再询问',
      '{1} Press {2} to switch to the app.': '{1} 按 {2} 切换应用。',
      'No sites match "{1}".': '没有匹配「{1}」的网站。',
    },
  });
  t.after(page.restore);

  // Case 1: [Text, Text, <code>, Text]
  const t0 = page.text('Always open');
  const t1 = page.text(' ');
  const code = page.el('code', {}, 'mailto:');
  const t2 = page.text(' links without asking');
  const span = page.el('span', {}, t0, t1, code, t2);
  const beforeSpanChildren = childrenOf(span);

  // Case 2: leading inline element (no text node before {1}) + <kbd>
  const tipSpan = page.el('span', {}, 'Tip:');
  const p0 = page.text(' Press ');
  const kbd = page.el('kbd', {}, '⌘K');
  const p1 = page.text(' to switch to the app.');
  const para = page.el('p', {}, tipSpan, p0, kbd, p1);
  const beforeParaChildren = childrenOf(para);

  // Case 3: curly quotes normalized to match straight-quote inline key
  const strong = page.el('strong', {}, 'example.com');
  const curly = page.el('p', {}, 'No sites match “', strong, '”.');

  page.body.append(span, para, curly);
  page.start();

  assert.equal(textOf(span), '始终直接打开 mailto: 链接，不再询问');
  assert.equal(textOf(code), 'mailto:');
  // Strict React invariant: exact same child node instances in exact same order!
  assert.deepEqual(childrenOf(span), beforeSpanChildren);

  assert.equal(textOf(para), '提示： 按 ⌘K 切换应用。');
  assert.equal(textOf(tipSpan), '提示：');
  assert.equal(textOf(kbd), '⌘K');
  assert.deepEqual(childrenOf(para), beforeParaChildren);

  assert.equal(textOf(curly), '没有匹配「example.com」的网站。');

  // React mutates a text node so the sentence no longer matches inline: restores cleanly!
  t2.nodeValue = ' links in external browser';
  page.settle();
  assert.equal(textOf(span), '始终打开 mailto: links in external browser');
  // Mutates back: inline template re-applies cleanly!
  t2.nodeValue = ' links without asking';
  page.settle();
  assert.equal(textOf(span), '始终直接打开 mailto: 链接，不再询问');
  assert.deepEqual(childrenOf(span), beforeSpanChildren);
});

test('inline-slot templates support up to 6 slots in place with strict DOM node identity', (t) => {
  const page = setup({
    exact: { 'necessary rights': '必要权利', 'Prohibited Use Policy': '禁止使用政策', 'Terms of Service': '服务条款', 'Privacy Policy': '隐私政策' },
    patterns: [],
    inline: {
      'Ensure you have {1} and follow {2}. Subject to {3} and {4}.': '请确保你拥有{1}并遵守{2}。使用受{3}和{4}约束。',
      'In System Settings, click {1}, choose {2}, turn it on. Select {3}, click {4}, then {5} again.':
        '在系统设置中点按 {1}，选择 {2} 并开启。选中 {3}，点按 {4}，再点按 {5} 重新添加。',
      'Step {1} -> {2} -> {3} -> {4} -> {5} -> {6} done': '步骤 {1} → {2} → {3} → {4} → {5} → {6} 完成',
    },
  });
  t.after(page.restore);

  // 4-slot privacy disclosure (<a> x 4)
  const a1 = page.el('a', {}, 'necessary rights');
  const a2 = page.el('a', {}, 'Prohibited Use Policy');
  const a3 = page.el('a', {}, 'Terms of Service');
  const a4 = page.el('a', {}, 'Privacy Policy');
  const privacy = page.el('p', {}, 'Ensure you have ', a1, ' and follow ', a2, '. Subject to ', a3, ' and ', a4, '.');
  const privacyBefore = childrenOf(privacy);

  // 5-slot macOS permission guide (<strong> x 5)
  const s1 = page.el('strong', {}, '+');
  const s2 = page.el('strong', {}, 'Antigravity');
  const s3 = page.el('strong', {}, 'Antigravity');
  const s4 = page.el('strong', {}, '–');
  const s5 = page.el('strong', {}, '+');
  const guide = page.el(
    'p',
    {},
    'In System Settings, click ',
    s1,
    ', choose ',
    s2,
    ', turn it on. Select ',
    s3,
    ', click ',
    s4,
    ', then ',
    s5,
    ' again.'
  );
  const guideBefore = childrenOf(guide);

  // 6-slot template
  const c = [1, 2, 3, 4, 5, 6].map((n) => page.el('code', {}, `k${n}`));
  const six = page.el('p', {}, 'Step ', c[0], ' -> ', c[1], ' -> ', c[2], ' -> ', c[3], ' -> ', c[4], ' -> ', c[5], ' done');
  const sixBefore = childrenOf(six);

  page.body.append(privacy, guide, six);
  page.start();

  assert.equal(textOf(privacy), '请确保你拥有必要权利并遵守禁止使用政策。使用受服务条款和隐私政策约束。');
  assert.equal(childrenOf(privacy).length, privacyBefore.length);
  childrenOf(privacy).forEach((n, i) => assert.equal(n, privacyBefore[i]));

  assert.equal(textOf(guide), '在系统设置中点按 +，选择 Antigravity 并开启。选中 Antigravity，点按 –，再点按 + 重新添加。');
  assert.equal(childrenOf(guide).length, guideBefore.length);
  childrenOf(guide).forEach((n, i) => assert.equal(n, guideBefore[i]));

  assert.equal(textOf(six), '步骤 k1 → k2 → k3 → k4 → k5 → k6 完成');
  assert.equal(childrenOf(six).length, sixBefore.length);
  childrenOf(six).forEach((n, i) => assert.equal(n, sixBefore[i]));
});

test('precision CONTENT rules release real Antigravity 2.35.2 UI while keeping code and user content protected', (t) => {
  const page = setup({
    exact: {
      Settings: '设置',
      Copy: '复制',
      'Needs Input': '需要输入',
      'This Computer': '本机',
      'Leaving Soon': '即将下线',
      New: '新',
      High: '高',
      Max: '最高',
      Orchestrator: '编排器',
      'Default (Gemini Pro)': '默认（Gemini Pro）',
      'No Model Selected': '未选择模型',
      Conflict: '冲突',
      Staged: '已暂存',
      'Binary file not shown': '不显示二进制文件',
      Before: '修改前',
      After: '修改后',
      'Not available': '不可用',
      'Leave a comment': '添加评论',
      'Edit comment': '编辑评论',
      'Selected element preview': '所选元素预览',
      'Outside of Project': '项目外',
      'Unsent draft': '未发送草稿',
      now: '刚刚',
      'Image rendering blocked (strict mode enabled)': '已阻止图片渲染（已启用严格模式）',
      'Alt text:': '替代文本：',
      'Image URL:': '图片网址：',
      'Preview unavailable': '预览不可用',
      'Suggested plugin:': '推荐插件：',
      "The suggested plugin isn't in the marketplace.": '推荐的插件不在市场中。',
      'Markdown view mode': 'Markdown 视图模式',
      'Summarizing call…': '生成通话摘要中…',
      'Loading logs...': '加载日志中…',
      'Cloning locally…': '克隆到本地中…',
      'Expand message': '展开消息',
      'Commented on:': '评论于：',
      'You said': '你说',
    },
    patterns: [
      ['^Select model, current: (.+?)$', '选择模型，当前：$1'],
      ['^(\\d+) models selected$', '已选 $1 个模型'],
      ['^Line (\\d+) → (\\d+)$', '第 $1 行 → 第 $2 行'],
      ['^(\\d+) waiting on you$', '$1 项待你处理'],
      ['^⚠️ Failed to render Mermaid diagram: (.+?)$', '⚠️ 渲染 Mermaid 图表失败：$1'],
      ['^Checked out in (.+?)$', '已检出至 $1'],
      ['^Edit side question title: (.+?)$', '编辑旁问标题：$1'],
    ],
  });
  t.after(page.restore);

  // 1. data-project-label: custom icon (system group) translates, folder/cloud/missing (user project) protected
  const sysGroup = page.el(
    'button',
    { 'data-testid': 'project-header', 'data-project-label': 'Needs Input', 'data-project-icon': 'custom' },
    page.el('span', {}, 'Needs Input')
  );
  const sysLocation = page.el(
    'button',
    { 'data-testid': 'project-header', 'data-project-label': 'This Computer', 'data-project-icon': 'custom' },
    page.el('span', {}, 'This Computer')
  );
  const userProject = page.el(
    'button',
    { 'data-testid': 'project-header', 'data-project-label': 'Settings', 'data-project-icon': 'folder' },
    page.el('span', {}, 'Settings')
  );

  // 2. model-selector-item / custom-item / trigger / orchestrator-picker-row
  const modelItem = page.el(
    'div',
    { 'data-testid': 'model-selector-item', role: 'menuitem', 'data-model-label': 'Settings' },
    page.el(
      'span',
      { class: 'flex items-center gap-1.5 min-w-0' },
      page.el('span', { class: 'truncate text-sm text-left' }, 'Settings'),
      page.el('div', { class: 'bg-secondary opacity-70 flex items-center gap-1 rounded-full px-1.5 text-sm' }, page.el('span', {}, 'Leaving Soon'))
    )
  );
  const customModelItem = page.el(
    'div',
    { 'data-testid': 'model-selector-custom-item', role: 'menuitem', 'data-model-label': 'Copy' },
    page.el(
      'span',
      { class: 'flex items-center gap-1.5 min-w-0' },
      page.el('span', { class: 'truncate text-sm text-left' }, 'Copy'),
      page.el('div', { class: 'bg-secondary rounded-full px-1.5 text-sm' }, 'New')
    )
  );
  const triggerConcrete = page.el(
    'button',
    {
      'data-testid': 'model-selector-trigger',
      'data-model-label': 'Copy High',
      'aria-label': 'Select model, current: Copy High',
    },
    page.el('span', { class: 'min-w-0' }, 'Copy', page.el('span', { class: 'opacity-70' }, ' ', 'High'))
  );
  const triggerOrch = page.el(
    'button',
    {
      'data-testid': 'model-selector-trigger',
      'data-model-label': 'Orchestrator Default (Gemini Pro)',
      'aria-label': 'Select model, current: Orchestrator Default (Gemini Pro)',
    },
    page.el('span', { class: 'min-w-0' }, 'Orchestrator', page.el('span', { class: 'opacity-70' }, ' ', 'Default (Gemini Pro)'))
  );
  const triggerMulti = page.el(
    'button',
    { 'data-testid': 'model-selector-trigger', 'data-model-label': '3 models selected' },
    page.el('span', {}, '3 models selected')
  );
  const orchRow = page.el(
    'div',
    { 'data-testid': 'orchestrator-picker-row', 'data-model-base': 'Copy' },
    page.el('span', { class: 'truncate text-left' }, 'Copy'),
    page.el('span', { class: 'shrink-0 opacity-70' }, 'Max')
  );

  // 3. data-file-uri narrowed: review wrapper, FileTitle, code-line, comment rows, log_line, changed-file-row
  const fileTitleDir = page.el('div', { style: 'direction:rtl' }, page.el('span', {}, 'Settings'));
  const fileTitleBadge = page.el('span', { 'data-testid': 'file-title-badge' }, 'Conflict');
  const fileTitle = page.el(
    'div',
    { 'data-file-uri': 'file:///Settings/a.ts', role: 'button' },
    page.el('span', { 'data-testid': 'file-title-name' }, 'Settings'),
    fileTitleDir,
    fileTitleBadge
  );
  const gutterDiff = page.el('span', { 'data-testid': 'code-gutter-diff', title: 'Line 10 → 12' }, '12');
  const diffCodeContent = page.el('div', { class: 'line-content' }, page.el('span', { 'data-line-tokens': '' }, page.el('span', {}, 'Settings')), page.el('span', {}, 'Copy'));
  const codeLine = page.el('div', { class: 'code-line group', 'data-file-uri': 'file:///a.ts' }, gutterDiff, page.el('button', { 'aria-label': 'Copy' }), diffCodeContent);
  const nonTextDiff = page.el('div', { 'data-testid': 'non-text-diff-message' }, 'Binary file not shown');
  const imgDiff = page.el('div', { 'data-testid': 'image-diff-view' }, page.el('div', {}, 'Before'), page.el('div', {}, 'After'), page.el('div', {}, 'Not available'));
  const commentEditable = page.el('div', { contenteditable: 'true', 'aria-placeholder': 'Leave a comment' }, page.el('p', {}, 'Settings'));
  const commentBox = page.el('div', { 'data-testid': 'comment-box-row', 'data-file-uri': 'file:///a.ts', 'data-line-number': '10' }, commentEditable);
  const commentImg = page.el('img', { 'data-testid': 'comment-cropped-screenshot', alt: 'Selected element preview' });
  const commentUserText = page.el('div', { 'data-testid': 'comment-card-text' }, 'Settings');
  const commentThread = page.el('div', { 'data-testid': 'comment-thread-row', 'data-file-uri': 'file:///a.ts', 'data-line-number': '10' }, commentImg, commentUserText);
  const reviewWrapper = page.el('div', { 'data-file-uri': 'file:///a.ts', 'data-group-key': 'g1' }, fileTitle, codeLine, nonTextDiff, imgDiff, commentBox, commentThread);
  const logLine = page.el('div', { 'data-file-uri': 'file:///run.log', 'data-line-number': '1', 'data-line-start': '1' }, page.el('span', {}, '1'), page.el('span', {}, 'Settings'));
  const changedFileRow = page.el('div', { 'data-testid': 'changed-file-row', 'data-file-uri': 'file:///a.ts' }, page.el('span', {}, 'Settings'));

  // 4. conversation-row-sidebar / history
  const convTitle = page.el('span', { class: 'truncate inline-block' }, 'Settings');
  const convStandalone = page.el('span', { class: 'min-w-0 truncate' }, 'Outside of Project');
  const convDraft = page.el('span', { role: 'img', 'aria-label': 'Unsent draft', title: 'Unsent draft', 'data-testid': 'conversation-row-draft' });
  const convAttention = page.el('span', { role: 'img', 'aria-label': '2 waiting on you', 'data-testid': 'attention-count' }, '2');
  const convTime = page.el('span', { 'data-screenshot-volatile': 'true' }, 'now');
  const convRow = page.el(
    'div',
    { 'data-testid': 'conversation-row-history', 'data-subtext': 'Outside of Project' },
    page.el('a', { 'aria-label': 'Settings' }),
    page.el('div', {}, page.el('div', {}, page.el('div', {}, convTitle), page.el('span', {}, page.el('svg'), convStandalone))),
    page.el('span', {}, convDraft, convAttention, convTime)
  );
  const convProjectSub = page.el('span', { class: 'min-w-0 truncate' }, 'Settings');
  const convRowProject = page.el(
    'div',
    { 'data-testid': 'conversation-row-sidebar', 'data-subtext': 'Settings' },
    page.el('div', {}, page.el('div', {}, page.el('span', {}, convProjectSub)))
  );

  // 5. data-markdown-root internal cards
  const blockedImgCard = page.el(
    'div',
    { class: 'my-2 rounded bg-muted px-3 py-2 text-base border border-border' },
    page.el(
      'div',
      { class: 'flex items-start gap-2' },
      page.el(
        'div',
        { class: 'flex flex-col gap-1' },
        page.el('span', { class: 'opacity-70 text-sm' }, 'Image rendering blocked (strict mode enabled)'),
        page.el('span', { class: 'italic opacity-50 text-sm' }, page.el('span', { class: 'opacity-70' }, 'Alt text:'), ' ', 'Settings'),
        page.el('div', { class: 'flex items-center gap-1' }, page.el('span', { class: 'italic opacity-50 text-sm', title: 'Copy' }, page.el('span', { class: 'opacity-70' }, 'Image URL:'), ' ', 'Copy'))
      )
    )
  );
  const mermaidErrBanner = page.el('div', { class: 'box-border mb-2 whitespace-pre-line' }, '⚠️ Failed to render Mermaid diagram: ', 'syntax');
  const mermaidRaw = page.el('div', { class: 'whitespace-pre-wrap' }, page.el('code', {}, 'Settings'));
  const mermaidBox = page.el('div', { class: 'mermaid-wrapper relative my-4' }, mermaidErrBanner, mermaidRaw);
  const previewUnavailable = page.el('span', { class: 'text-base' }, 'Preview unavailable');
  const pluginFallback = page.el('span', { 'data-testid': 'plugin-card-fallback' }, 'Suggested plugin:', ' ', page.el('code', {}, 'Settings'));
  const pluginUnavailable = page.el('div', { 'data-testid': 'plugin-suggestion-card-unavailable' }, "The suggested plugin isn't in the marketplace.");
  const mdViewToggle = page.el('div', { 'data-testid': 'code-block-preview-toggle', role: 'radiogroup', 'aria-label': 'Markdown view mode' });
  const mdProse = page.el('p', {}, 'Settings');
  const mdRoot = page.el('div', { 'data-markdown-root': '' }, mdProse, blockedImgCard, mermaidBox, previewUnavailable, pluginFallback, pluginUnavailable, mdViewToggle);

  // 6. P1/P2 fixes
  const voiceSummary = page.el(
    'span',
    { 'data-testid': 'voice-transcript-summary' },
    page.el('span', { 'data-testid': 'voice-transcript-summary-lead' }, 'Settings'),
    page.el('span', { 'data-testid': 'voice-transcript-summary-point' }, 'Copy'),
    page.el('span', { 'data-testid': 'voice-transcript-summary-pending' }, 'Summarizing call…')
  );
  const sidecarLogs = page.el('div', { 'data-testid': 'sidecar-logs-content' }, page.el('p', {}, 'Loading logs...'), page.el('pre', {}, 'Settings'));
  const remoteProj = page.el(
    'div',
    { 'data-project-name': 'Settings' },
    page.el('span', { class: 'flex flex-col' }, page.el('span', { class: 'truncate' }, 'Settings'), page.el('span', { class: 'truncate text-sm text-muted-foreground' }, 'Cloning locally…'))
  );
  const branchOpt = page.el(
    'div',
    { 'data-testid': 'branch-option' },
    page.el('span', { class: 'flex flex-col' }, page.el('span', { class: 'truncate' }, 'Copy'), page.el('span', { class: 'truncate text-sm text-muted-foreground' }, 'Checked out in main'))
  );
  const userMsgContent = page.el(
    'div',
    { 'data-testid': 'user-message-content', 'aria-label': 'Expand message' },
    page.el('div', { class: 'flex items-center gap-2 flex-wrap' }, page.el('span', { class: 'text-secondary-foreground' }, 'Commented on: ')),
    page.el('p', {}, 'Settings')
  );
  const userMsgBubble = page.el('div', { 'data-testid': 'user-message-bubble' }, userMsgContent);
  const pendingWrapper = page.el('div', { 'data-testid': 'pending-user-messages' }, page.el('h5', { class: 'sr-only' }, 'You said'), userMsgBubble);
  const closedUserMsg = page.el('div', { translate: 'no' }, page.el('div', { 'data-testid': 'user-message-content', 'aria-label': 'Expand message' }, 'Settings'));
  const sideQ = page.el('span', { 'data-testid': 'side-question-tab-header-name', role: 'button', 'aria-label': 'Edit side question title: Foo' }, page.el('span', {}, 'Settings'));

  page.body.append(
    sysGroup,
    sysLocation,
    userProject,
    modelItem,
    customModelItem,
    triggerConcrete,
    triggerOrch,
    triggerMulti,
    orchRow,
    reviewWrapper,
    logLine,
    changedFileRow,
    convRow,
    convRowProject,
    mdRoot,
    voiceSummary,
    sidecarLogs,
    remoteProj,
    branchOpt,
    pendingWrapper,
    closedUserMsg,
    sideQ
  );
  page.start();

  // Assertions: 1. data-project-label
  assert.equal(textOf(sysGroup), '需要输入');
  assert.equal(textOf(sysLocation), '本机');
  assert.equal(textOf(userProject), 'Settings');

  // Assertions: 2. model selector & orchestrator picker
  assert.equal(textOf(modelItem), 'Settings即将下线');
  assert.equal(textOf(customModelItem), 'Copy新');
  assert.equal(triggerConcrete.getAttribute('aria-label'), '选择模型，当前：Copy High');
  assert.equal(textOf(triggerConcrete), 'Copy 高');
  assert.equal(triggerOrch.getAttribute('aria-label'), '选择模型，当前：Orchestrator Default (Gemini Pro)');
  assert.equal(textOf(triggerOrch), '编排器 默认（Gemini Pro）');
  assert.equal(textOf(triggerMulti), '已选 3 个模型');
  assert.equal(textOf(orchRow), 'Copy最高');

  // Assertions: 3. data-file-uri narrowed
  assert.equal(textOf(fileTitle), 'SettingsSettings冲突');
  assert.equal(gutterDiff.getAttribute('title'), '第 10 行 → 第 12 行');
  assert.equal(textOf(diffCodeContent), 'SettingsCopy');
  assert.equal(codeLine.firstChild.nextSibling.getAttribute('aria-label'), '复制');
  assert.equal(textOf(nonTextDiff), '不显示二进制文件');
  assert.equal(textOf(imgDiff), '修改前修改后不可用');
  assert.equal(commentEditable.getAttribute('aria-placeholder'), '添加评论');
  assert.equal(textOf(commentEditable), 'Settings');
  assert.equal(commentImg.getAttribute('alt'), '所选元素预览');
  assert.equal(textOf(commentUserText), 'Settings');
  assert.equal(textOf(logLine), '1Settings');
  assert.equal(textOf(changedFileRow), 'Settings');

  // Assertions: 4. conversation rows
  assert.equal(convRow.firstChild.getAttribute('aria-label'), 'Settings');
  assert.equal(textOf(convTitle), 'Settings');
  assert.equal(textOf(convStandalone), '项目外');
  assert.equal(convDraft.getAttribute('aria-label'), '未发送草稿');
  assert.equal(convDraft.getAttribute('title'), '未发送草稿');
  assert.equal(convAttention.getAttribute('aria-label'), '2 项待你处理');
  assert.equal(textOf(convTime), '刚刚');
  assert.equal(textOf(convProjectSub), 'Settings');

  // Assertions: 5. data-markdown-root internal cards
  assert.equal(textOf(mdProse), 'Settings');
  assert.equal(textOf(blockedImgCard), '已阻止图片渲染（已启用严格模式）替代文本： Settings图片网址： Copy');
  assert.equal(textOf(mermaidErrBanner), '⚠️ 渲染 Mermaid 图表失败：syntax');
  assert.equal(textOf(mermaidRaw), 'Settings');
  assert.equal(textOf(previewUnavailable), '预览不可用');
  assert.equal(textOf(pluginFallback), '推荐插件： Settings');
  assert.equal(textOf(pluginUnavailable), '推荐的插件不在市场中。');
  assert.equal(mdViewToggle.getAttribute('aria-label'), 'Markdown 视图模式');

  // Assertions: 6. P1/P2 fixes
  assert.equal(textOf(voiceSummary), 'SettingsCopy生成通话摘要中…');
  assert.equal(textOf(sidecarLogs), '加载日志中…Settings');
  assert.equal(textOf(remoteProj), 'Settings克隆到本地中…');
  assert.equal(textOf(branchOpt), 'Copy已检出至 main');
  assert.equal(textOf(pendingWrapper.firstChild), '你说');
  assert.equal(userMsgContent.getAttribute('aria-label'), '展开消息');
  assert.equal(textOf(userMsgContent), '评论于： Settings');
  assert.equal(closedUserMsg.firstChild.getAttribute('aria-label'), 'Expand message');
  assert.equal(sideQ.getAttribute('aria-label'), '编辑旁问标题：Foo');
  assert.equal(textOf(sideQ), 'Settings');

  // Assertions: 7. modeOf / walk / onRecords equivalence on dynamic mutations
  assert.equal(page.translator.modeOf(userMsgContent), 1);
  assert.equal(page.translator.modeOf(triggerConcrete), 1);
  assert.equal(page.translator.modeOf(triggerOrch), 2);
  assert.equal(page.translator.modeOf(diffCodeContent), 1);
  assert.equal(page.translator.modeOf(diffCodeContent.firstChild), 0);
  assert.equal(page.translator.modeOf(fileTitleBadge), 2);
  assert.equal(page.translator.modeOf(sysGroup), 2);
  assert.equal(page.translator.modeOf(userProject), 1);

  // Dynamic attribute & child mutations through MutationObserver (onRecords cache path)
  userMsgContent.setAttribute('aria-label', 'Expand message');
  triggerConcrete.setAttribute('aria-label', 'Select model, current: NewModel Max');
  commentEditable.setAttribute('aria-placeholder', 'Edit comment');
  const dynamicBadge = page.el('span', { 'data-testid': 'file-title-badge' }, 'Staged');
  fileTitle.append(dynamicBadge);
  const dynamicCode = page.el('span', {}, 'Settings');
  diffCodeContent.append(dynamicCode);
  page.settle();
  assert.equal(userMsgContent.getAttribute('aria-label'), '展开消息');
  assert.equal(triggerConcrete.getAttribute('aria-label'), '选择模型，当前：NewModel Max');
  assert.equal(commentEditable.getAttribute('aria-placeholder'), '编辑评论');
  assert.equal(textOf(dynamicBadge), '已暂存');
  assert.equal(textOf(dynamicCode), 'Settings');
});

test('Electron preload IPC helpers translate context menus and notifications safely without mutating inputs', () => {
  const tr = l10nFactory({
    exact: {
      Copy: '复制',
      'Open in Side Panel': '在侧边栏中打开',
      'Pin This Conversation': '置顶此对话',
      'Action requires your attention': '有操作需要处理',
      'Agent finished': '代理已完成',
      'The agent has a question for you:': '代理有一个问题需要确认：',
      'The agent has questions for you:': '代理有几个问题需要确认：',
      'Click to respond to the questions.': '点击回答问题。',
      'Where should it run?': '在哪里运行？',
    },
    patterns: [
      ['^Command: (.+)$', '命令：$1'],
      ['^URL: (.+)$', '网址：$1'],
      ['^Stop (.+?)\\?$', '确定停止 $1？'],
    ],
  });

  const menu = Object.freeze([
    Object.freeze({ id: 'cmi-0', label: 'Copy', type: 'normal', accelerator: 'CmdOrCtrl+C', sublabel: 'Pin This Conversation', toolTip: 'Open in Side Panel' }),
    Object.freeze({ id: 'cmi-1', type: 'separator', label: 'Copy' }),
    Object.freeze({
      id: 'cmi-2',
      label: 'Open in Side Panel',
      type: 'submenu',
      submenu: Object.freeze([Object.freeze({ id: 'cmi-2-sub-0', label: 'Pin This Conversation', checked: true, disabled: false }), Object.freeze({ id: 'cmi-2-sub-1', label: 'Unknown Item' })]),
    }),
  ]);
  const outMenu = tr.translateMenu(menu);
  assert.notEqual(outMenu, menu);
  assert.deepEqual(outMenu, [
    { id: 'cmi-0', label: '复制', type: 'normal', accelerator: 'CmdOrCtrl+C', sublabel: '置顶此对话', toolTip: '在侧边栏中打开' },
    { id: 'cmi-1', type: 'separator', label: 'Copy' },
    {
      id: 'cmi-2',
      label: '在侧边栏中打开',
      type: 'submenu',
      submenu: [
        { id: 'cmi-2-sub-0', label: '置顶此对话', checked: true, disabled: false },
        { id: 'cmi-2-sub-1', label: 'Unknown Item' },
      ],
    },
  ]);
  // Original frozen input untouched.
  assert.equal(menu[0].label, 'Copy');
  // Shared non-cyclic DAG items are each translated cleanly.
  const sharedItem = { id: 'dag', label: 'Copy' };
  const dagOut = tr.translateMenu([sharedItem, sharedItem]);
  assert.deepEqual(
    dagOut.map((x) => x.label),
    ['复制', '复制']
  );
  // 3-branch cyclic submenu terminates in O(1) without exponential blowup or throwing.
  const cyclic = { id: 'cyc', label: 'Copy' };
  cyclic.submenu = [cyclic, cyclic, cyclic];
  const cycStart = process.hrtime.bigint();
  const cycOut = tr.translateMenu([cyclic]);
  const cycMs = Number(process.hrtime.bigint() - cycStart) / 1e6;
  assert.ok(cycMs < 50, `cyclic submenu took ${cycMs} ms`);
  assert.equal(cycOut[0].label, '复制');
  assert.equal(cycOut[0].submenu.length, 3);
  assert.equal(cycOut[0].submenu[0], cyclic);
  // Hostile getter passes through original array without throwing.
  const hostile = [{ get label() { throw new Error('boom'); } }];
  assert.equal(tr.translateMenu(hostile), hostile);

  const notif = Object.freeze({
    id: 'n-1',
    title: 'Action requires your attention',
    body: 'URL: https://example.com',
    silent: false,
    payload: { cascadeId: 'abc', type: 'permission' },
  });
  const outNotif = tr.translateNotification(notif);
  assert.notEqual(outNotif, notif);
  assert.deepEqual(outNotif, {
    id: 'n-1',
    title: '有操作需要处理',
    body: '网址：https://example.com',
    silent: false,
    payload: { cascadeId: 'abc', type: 'permission' },
  });
  assert.equal(notif.title, 'Action requires your attention');

  // Under a question title the body is the agent's own question: it stays as the agent wrote it,
  // even when the word list has it. Only the client's sentence for an empty question is translated.
  assert.deepEqual(tr.translateNotification({ id: 'q1', title: 'The agent has a question for you:', body: 'Where should it run?' }), {
    id: 'q1',
    title: '代理有一个问题需要确认：',
    body: 'Where should it run?',
  });
  assert.equal(tr.translateNotification({ id: 'q2', title: 'The agent has questions for you:', body: 'Stop the server?' }).body, 'Stop the server?');
  assert.equal(tr.translateNotification({ id: 'q3', title: 'The agent has questions for you:', body: 'Click to respond to the questions.' }).body, '点击回答问题。');
  // The same texts under another title are the client's own and are translated.
  assert.equal(tr.translateNotification({ id: 'p1', title: 'Requesting your permission:', body: 'Stop the server?' }).body, '确定停止 the server？');
});

test('patchL10n wraps unique Electron IPC call sites even when contextBridge globals are frozen and non-configurable', () => {
  const dict = {
    exact: { Copy: '复制', 'More options': '更多选项', 'Agent finished': '代理已完成' },
    patterns: [['^Command: (.+)$', '命令：$1']],
  };
  // Mirror Antigravity 2.35.2 main.js exact call shapes (pgb + CRd).
  const clientScript = [
    'function runMenu(items){return window.electronNative?.showContextMenu?.(items);}',
    'class NotifSvc{constructor(){this.bridge=window.nativeNotifications;}send(a){return this.bridge.send({...a,silent:false});}}',
    'globalThis.__runMenu=runMenu;globalThis.__NotifSvc=NotifSvc;',
  ].join('\n');

  const patched = patchL10n(clientScript, dict);
  assert.equal(patched.ok, true);

  const seenMenus = [];
  const seenNotifs = [];
  const frozenNative = Object.freeze({
    showContextMenu: Object.freeze((items) => {
      seenMenus.push(items);
      return Promise.resolve(items[0].id);
    }),
  });
  const frozenNotif = Object.freeze({
    send: Object.freeze((opts) => {
      seenNotifs.push(opts);
      return Promise.resolve();
    }),
  });

  const page = fakePage();
  const win = {};
  // Exact Electron contextBridge.exposeInMainWorld descriptors: non-writable, non-configurable, frozen.
  Object.defineProperty(win, 'electronNative', { value: frozenNative, writable: false, configurable: false, enumerable: true });
  Object.defineProperty(win, 'nativeNotifications', { value: frozenNotif, writable: false, configurable: false, enumerable: true });
  page.document.defaultView = win;

  const ctx = vm.createContext({ window: win, document: page.document, MutationObserver: page.MutationObserver, console });
  assert.doesNotThrow(() => new vm.Script(patched.source).runInContext(ctx));

  // Frozen globals remain intact, yet IPC calls are intercepted cleanly via source call hooks!
  assert.equal(win.electronNative, frozenNative);
  assert.equal(win.nativeNotifications, frozenNotif);
  ctx.__runMenu([{ id: 'm1', label: 'Copy', submenu: [{ id: 'm2', label: 'More options' }] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(seenMenus)), [[{ id: 'm1', label: '复制', submenu: [{ id: 'm2', label: '更多选项' }] }]]);

  const svc = new ctx.__NotifSvc();
  svc.send({ id: 'n1', title: 'Agent finished', body: 'Command: ls -la', payload: { cascadeId: 'c1' } });
  assert.deepEqual(JSON.parse(JSON.stringify(seenNotifs)), [
    { id: 'n1', title: '代理已完成', body: '命令：ls -la', silent: false, payload: { cascadeId: 'c1' } },
  ]);

  // Ambiguous (duplicated) anchors are silently skipped without breaking DOM translation.
  const dup = 'window.electronNative?.showContextMenu?.(a);window.electronNative?.showContextMenu?.(b);';
  const dupRes = patchL10n(dup, dict);
  assert.equal(dupRes.ok, true);
  assert.ok(dupRes.source.startsWith(dup));
});

test('a failure stops the translator after a few times and never reaches the page', (t) => {
  const page = setup();
  t.after(page.restore);
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args);
  t.after(() => {
    console.error = realError;
  });
  page.start();
  const broken = page.el('div');
  broken.getAttribute = () => {
    throw new Error('boom');
  };
  for (let i = 0; i < 7; i++) {
    page.body.append(page.el('p', {}, 'Settings'));
    broken.parentNode = page.body;
    page.observers[0].records.push({ type: 'childList', target: page.body, addedNodes: [broken] });
    assert.doesNotThrow(() => page.settle());
  }
  assert.equal(errors.length, 5);
  assert.equal(page.observers[0].target, null);
});

// ---- the page script ------------------------------------------------------------------------

test('the translator is added to the end of the script and starts by itself', () => {
  const original = "'use strict';var marker=1;";
  const result = patchL10n(original, DATA);
  assert.equal(result.ok, true);
  assert.ok(result.source.startsWith(original));
  const page = fakePage();
  const header = page.el('h1', { title: 'Copy' }, 'Settings');
  page.body.append(header);
  const context = vm.createContext({ document: page.document, MutationObserver: page.MutationObserver, console });
  // Loaded twice, as two script tags would: one translator.
  new vm.Script(result.source).runInContext(context);
  const first = context.__agyFlagsL10n;
  new vm.Script(result.source).runInContext(context);
  assert.equal(context.__agyFlagsL10n, first);
  assert.equal(page.observers.length, 1);
  assert.equal(textOf(header), '设置');
  assert.equal(header.getAttribute('title'), '复制');
  assert.equal(context.marker, 1);
  // A page without a document or without observers: nothing happens, and nothing fails.
  for (const sandbox of [{}, { document: {} }, { document: page.document }]) {
    assert.doesNotThrow(() => new vm.Script(result.source).runInContext(vm.createContext({ ...sandbox, console: { error() {} } })));
  }
});

test('the translator is one more change of the page script', () => {
  const script = fakePageScript();
  const result = patchMainJs(script, { l10n: DATA });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.parts).sort(), ['contextUsageIndicator', PART_L10N].sort());
  assert.ok(result.source.includes('__agyFlagsL10n'));
  const alone = patchMainJs(script, { indicator: false, l10n: DATA });
  assert.deepEqual(alone.parts, { [PART_L10N]: { ok: true, reason: null } });
  assert.ok(alone.source.startsWith(script));
  // A word list that is not one leaves the script as it is, and says so.
  const none = patchMainJs(script, { indicator: false, l10n: { exact: {}, patterns: [] } });
  assert.equal(none.ok, false);
  assert.equal(none.source, script);
  assert.match(none.parts[PART_L10N].reason, /no word list/);
});

// ---- the word list of agy-flags -------------------------------------------------------------

test('the word list of agy-flags is a word list', () => {
  const list = loadDictionary(WORD_LIST);
  assert.ok(list, 'src/l10n/zh-CN.json is missing or is not a word list');
  assert.ok(list.count > 1000);
  const { lookup } = l10nFactory(list.data);
  // What the context usage indicator of agy-flags shows.
  for (const text of [
    'Context window',
    'Compacted',
    'Empty',
    'Other',
    'No breakdown reported yet.',
    'Send or receive a message to see the context usage.',
    'Context window usage',
    'System prompt',
    'Tools',
    'Rules',
    'MCP tools',
    'Chat messages',
    'Workflows',
    'Plugins',
    'Flows',
    'Context: 29.6k / 840k (3.5%)',
    '944 tokens',
  ]) {
    assert.ok(lookup(text), `no entry for the indicator text "${text}"`);
  }
  // What the cost summary of the client shows.
  for (const text of [
    'Input',
    'Output',
    'Cache',
    'Thinking',
    'Thinking:',
    'Response (incl. tool calls)',
    'Response (incl. tool calls):',
    'Generations',
    'Generations:',
    'Turn',
    'Turn ($0.0048)',
    'Grand Total ($0.2241)',
    'Cumulative Total ($0.1990)',
    'Pricing is based on public API pricing',
    'Turn: 944/4 $0.0048',
    'Tot: 94.8K/745 $0.224',
    '· Tot: 765.8K/124.0K $7.15',
    'Cost summary: Turn: 25.6K/4 $0.103 · Tot: 25.6K/4 $0.103',
  ]) {
    assert.ok(lookup(text), `no entry for the cost text "${text}"`);
  }
  // Core terminology and anti-regression assertions.
  assert.equal(lookup('Skills'), '技能');
  assert.equal(lookup('Subagents'), '子代理');
  assert.equal(lookup('MCP'), null);
  assert.equal(lookup('PIN'), null);
  assert.equal(lookup('UNPIN'), null);
  assert.equal(lookup('New Conversation'), '新建对话');
  assert.equal(lookup('Settings'), '设置');
  // Duration & punctuation normalization checks against the shipped dictionary.
  assert.equal(lookup('Thought for 2m 15s'), '已思考 2 分钟 15 秒');
  assert.equal(lookup('Worked for 1m 23s'), '耗时 1 分钟 23 秒');
  assert.ok(lookup('Searching…'));
  assert.ok(lookup('Searching...'));
  assert.ok(lookup('Loading branches…'));
  for (const [from, to] of Object.entries(list.data.exact)) {
    assert.ok(/[A-Za-z]/.test(from), `"${from}" has no letter`);
    assert.ok(!/\{\d\}/.test(to), `"${from}" has a placeholder that was not filled`);
    assert.ok(!/智能体|您/.test(to), `"${from}" → "${to}" does not follow the wording rules`);
  }
  const seenPatterns = new Set();
  for (const [src, to] of list.data.patterns) {
    assert.ok(!seenPatterns.has(src), `duplicate pattern "${src}"`);
    seenPatterns.add(src);
    assert.ok(!/[\u4e00-\u9fff]/.test(src), `pattern "${src}" must not contain Chinese characters`);
    assert.ok(!/智能体|您/.test(src) && !/智能体|您/.test(to), `pattern "${src}" → "${to}" violates wording rules`);
    assert.ok(!/\\s/.test(src), `pattern "${src}" should use plain spaces instead of \\s`);
    assert.ok(!/\{\d\}/.test(to), `pattern "${src}" → "${to}" has an unfilled placeholder`);
  }
  assert.ok(list.data.inline && Object.keys(list.data.inline).length > 0, 'expected inline templates in zh-CN.json');
  for (const [from, to] of Object.entries(list.data.inline)) {
    assert.ok(!/智能体|您/.test(to), `inline "${from}" → "${to}" violates wording rules`);
  }
});

test('shipped inline templates work end-to-end on real DOM without mutating node structure', (t) => {
  const list = loadDictionary(WORD_LIST);
  assert.ok(list && list.data.inline);
  const page = setup(list.data);
  t.after(page.restore);
  const code = page.el('code', {}, 'mailto:');
  const span = page.el('span', {}, 'Always open', ' ', code, ' links without asking');
  const before = childrenOf(span);

  // 4-slot cloud privacy disclosure (<a> x 4)
  const privacy = page.el(
    'p',
    {},
    'Avoid uploading highly sensitive data and verify actions taken by your agent. Make sure you have the ',
    page.el('a', {}, 'necessary rights'),
    " to any content or files that you upload, including content of minors. Don't generate content that infringes on others' rights, including content that deceives, harasses, or harms. When using Antigravity, you must comply with Google's ",
    page.el('a', {}, 'Prohibited Use Policy'),
    '. Your use is subject to the ',
    page.el('a', {}, 'Google Antigravity Terms of Service'),
    ' and ',
    page.el('a', {}, 'Google Privacy Policy'),
    '.'
  );
  const privacyBefore = childrenOf(privacy);

  // 5-slot macOS permission guide (<strong> x 5)
  const macGuide = page.el(
    'p',
    {},
    'In System Settings, click ',
    page.el('strong', {}, '+'),
    ', choose ',
    page.el('strong', {}, 'Antigravity'),
    ', then turn it on. Already on? Select ',
    page.el('strong', {}, 'Antigravity'),
    ', click ',
    page.el('strong', {}, '–'),
    ', then click ',
    page.el('strong', {}, '+'),
    ' and add it again.'
  );
  const macGuideBefore = childrenOf(macGuide);

  // M4+Gzc permission approval buttons (<strong> slot)
  const permDl = page.el('button', {}, 'Yes, allow downloads from ', page.el('strong', {}, 'example.com'), ' for this run');
  const permDlBefore = childrenOf(permDl);
  const permRule = page.el('button', {}, "Yes, save rule for '", page.el('strong', {}, 'npm test'), "' globally");
  const permRuleBefore = childrenOf(permRule);

  // Model selector item with G5 "Leaving Soon" badge (DOM blindspot + dictionary end-to-end)
  const modelItem = page.el(
    'div',
    { 'data-testid': 'model-selector-item', role: 'menuitem', 'data-model-label': 'Gemini 4' },
    page.el(
      'span',
      { class: 'flex items-center gap-1.5 min-w-0' },
      page.el('span', { class: 'truncate text-sm text-left' }, 'Gemini 4'),
      page.el('div', { class: 'bg-secondary opacity-70 flex items-center gap-1 rounded-full px-1.5 text-sm' }, page.el('span', {}, 'Leaving Soon'))
    )
  );

  page.body.append(span, privacy, macGuide, permDl, permRule, modelItem);
  page.start();
  assert.ok(textOf(span).includes('mailto:'));
  assert.ok(/[\u4e00-\u9fff]/.test(textOf(span)));
  assert.ok(!/Always open|links without asking/.test(textOf(span)));
  assert.deepEqual(childrenOf(span), before);

  assert.ok(/请勿上传高度敏感数据/.test(textOf(privacy)));
  assert.ok(!/Avoid uploading|Your use is subject/.test(textOf(privacy)));
  childrenOf(privacy).forEach((n, i) => assert.equal(n, privacyBefore[i]));

  assert.equal(textOf(macGuide), '在「系统设置」中点击 +，选择 Antigravity，然后开启。已开启？选中 Antigravity，点击 –，再点击 + 重新添加。');
  childrenOf(macGuide).forEach((n, i) => assert.equal(n, macGuideBefore[i]));

  assert.equal(textOf(permDl), '允许本次运行从 example.com 下载');
  childrenOf(permDl).forEach((n, i) => assert.equal(n, permDlBefore[i]));
  assert.equal(textOf(permRule), '为「npm test」保存全局规则');
  childrenOf(permRule).forEach((n, i) => assert.equal(n, permRuleBefore[i]));

  assert.equal(textOf(modelItem), 'Gemini 4即将下线');
});

test('shipped dictionary covers tier-B cloud, backend, IPC, long skill, and anti-half-translation regressions', () => {
  const list = loadDictionary(WORD_LIST);
  assert.ok(list);
  const tr = l10nFactory(list.data);
  const { lookup } = tr;

  // Screenshot #1: model badge & deprecation date (without half-translating marketing copy)
  assert.equal(lookup('Leaving Soon'), '即将下线');
  assert.equal(lookup('New'), '新');
  assert.equal(lookup('Leaving on Nov 30.'), '将于 11 月 30 日下线');
  assert.equal(lookup('The original Gemini 4 model for advanced workflows. Leaving on Nov 30.'), null);

  // Screenshot #2: cloud-delivered quota groups, headers, and refresh countdowns
  assert.equal(lookup('Gemini Models'), 'Gemini 模型');
  assert.equal(lookup('Claude and GPT models'), 'Claude 与 GPT 模型');
  assert.equal(lookup('Weekly Limit Remaining'), '每周剩余限额');
  assert.equal(lookup('Five Hour Limit Remaining'), '5 小时剩余限额');
  assert.equal(
    lookup('You have used some of your weekly limit, it will fully refresh in 5 days, 22 hours.'),
    '每周限额已用部分，将于 5 天 22 小时后完全刷新。'
  );
  assert.equal(
    lookup('You have used some of your 5-hour limit, it will fully refresh in 4 hours, 34 minutes.'),
    '5 小时限额已用部分，将于 4 小时 34 分钟后完全刷新。'
  );
  assert.equal(
    lookup('You have reached your weekly limit, it will fully refresh in less than a minute.'),
    '已达每周限额，将于不到 1 分钟后完全刷新。'
  );

  // Screenshot #3: Swarm Worker tab header & subagent source label
  assert.equal(lookup('Swarm Worker (extractor)'), 'Swarm 工作代理（extractor）');
  assert.equal(lookup('Open Subagent: Swarm Worker (extractor)'), '打开子代理：Swarm 工作代理（extractor）');

  // 630-char built-in plugin skill description (> 600 chars) & system slash commands
  const pluginSkill =
    "How to manage and create plugins — namespaced bundles of skills, agents, rules, MCP servers and hooks that install, enable and disable as a single unit. Use this skill when the user wants to enable, disable, install or uninstall a plugin, when they want to create a new plugin, or when a new customization should be packaged into a plugin rather than left loose. Also triggered by the /plugin slash command. Don't use for the underlying customization system itself — discovery roots, loading priority, or authoring a standalone skill, agent, rule, hook or MCP server outside a plugin; see the customizations guide skill for those.";
  assert.ok(pluginSkill.length === 630);
  assert.ok(lookup(pluginSkill), 'expected 630-char built-in plugin skill description to translate');
  for (const cmd of [
    'Run until the specified goal is completely finished.',
    'Plan carefully before executing a task.',
    'Run an instruction on a recurring schedule or as a one-time timer.',
    'Invoke a browser agent for web tasks.',
    'Invoke a computer-use agent to operate apps on this Mac.',
  ]) {
    assert.ok(lookup(cmd), `expected system slash command description "${cmd}" to translate`);
  }

  // Native Electron IPC context menu & notification items (5 newly added)
  const translatedMenu = tr.translateMenu([
    { id: '1', label: 'Copy Image Address' },
    { id: '2', label: 'Copy Link Address' },
    { id: '3', label: 'Pin Entire Folder' },
    { id: '4', label: 'Unpin Folder' },
  ]);
  assert.deepEqual(
    translatedMenu.map((m) => m.label),
    ['复制图片地址', '复制链接地址', '置顶整个文件夹', '取消置顶文件夹']
  );
  assert.deepEqual(tr.translateNotification({ id: 'u1', title: 'Requesting your permission to open URL:', body: 'URL: https://example.com/path' }), {
    id: 'u1',
    title: '请求打开网址权限：',
    body: '网址：https://example.com/path',
  });

  // Key anti-half-translation and terminology regressions
  assert.equal(lookup('You can now use the new feature'), null);
  assert.equal(lookup('Upgrade to get unlimited access to all premium models'), null);
  assert.equal(lookup('Execute notebook cells'), '运行 Notebook 单元格');
  assert.equal(lookup('Copy transcript'), '复制转写内容');
  assert.equal(lookup('Running command'), '运行命令中');
  assert.equal(lookup('No branches found'), '未找到分支');
  assert.equal(lookup('Could not load the app view: timeout'), '无法加载应用视图：timeout');
  assert.equal(lookup('Open Mermaid diagram preview'), '打开 Mermaid 图表预览');
  assert.equal(lookup('Open locally'), '在本地打开');
  assert.equal(lookup('Running browser action'), '运行浏览器操作中');
  assert.equal(lookup('Waiting for download approval'), '等待下载审批');
  assert.equal(lookup('Matches system denylist.'), '命中系统黑名单。');
  assert.equal(lookup('John Doe, from Acme Corp'), 'John Doe，来自 Acme Corp');
  assert.equal(lookup('5m'), '5 分钟');
  assert.ok(!/weekdays/.test(lookup('Every 2 hours on weekdays') || 'weekdays'));
  assert.ok(!/1h 20m/.test(lookup('Running for 1h 20m') || '1h 20m'));
  assert.ok(!/Applies to messages/.test(lookup('Select model, current: Gemini 4. Applies to messages sent after this turn') || 'Applies to messages'));
  assert.ok(!/approval to run/.test(lookup('Waiting for approval to run: npm test') || 'approval to run'));
  assert.ok(!/agents/.test(lookup('Running · 2/4 agents') || 'agents'));
});

test('the word list of agy-flags is fast on a long text that it does not have', () => {
  const list = loadDictionary(WORD_LIST);
  assert.ok(list);
  const { lookup } = l10nFactory(list.data);
  const started = process.hrtime.bigint();
  for (let i = 0; i < 300; i++) {
    assert.equal(lookup(`Row ${i}: a file name or a command that is long and that no entry has, ${'x '.repeat(200)}`), null);
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 1500, `took ${ms} ms`);
});
