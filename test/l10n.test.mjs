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
  assert.equal(lookup(`Settings${' '.repeat(700)}`), null);
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
      },
    }),
    true
  );
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
    { exact: { Long: 'x'.repeat(601) }, patterns: [] },
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
    { exact: { a: 'b' }, patterns: [], inline: { 'Too many {1} {2} {3} {4}': '太多 {1} {2} {3} {4}' } },
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
    'Response (incl. tool calls)',
    'Generations',
    'Turn ($0.0048)',
    'Grand Total ($0.2241)',
    'Cumulative Total ($0.1990)',
    'Pricing is based on public API pricing',
    'Turn: 944/4 $0.0048',
    'Tot: 94.8K/745 $0.224',
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
  page.body.append(span);
  page.start();
  assert.ok(textOf(span).includes('mailto:'));
  assert.ok(/[\u4e00-\u9fff]/.test(textOf(span)));
  assert.ok(!/Always open|links without asking/.test(textOf(span)));
  assert.deepEqual(childrenOf(span), before);
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
