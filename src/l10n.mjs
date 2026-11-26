// The Chinese interface of Antigravity's page.
//
// The page script of the client has no languages: every English text is written directly in
// its code. So the translation is made in the page, after the page has drawn its text. A
// translator is added to the end of the page script. It watches the page and replaces a text
// that the word list knows with its Chinese form. The code of the client is not changed, so
// a mistake in the word list can only show a wrong text; it cannot break a function.
//
// What is translated: a whole text node or a whole attribute value that is equal to an
// entry of the word list, or that matches one of its patterns. Nothing is translated in
// part.
//
// What is never translated: the text of the conversation (messages of the user and of the
// model), code, terminals, editors and input fields. The translator knows these places by
// the marks that the client itself puts on them (see `kindOf` below).

import fs from 'node:fs';
import crypto from 'node:crypto';

/** The attributes whose value the user can see or hear. */
export const L10N_ATTRIBUTES = Object.freeze(['title', 'placeholder', 'aria-label', 'aria-description', 'aria-placeholder', 'alt', 'data-tooltip']);

/**
 * The translator. It runs inside Antigravity's page, so it is plain JavaScript without
 * imports, and it writes text only with nodeValue and setAttribute.
 *
 * `data` is { exact: { english: chinese }, patterns: [[regexSource, replacement], ...] }.
 * @returns {{ start(doc): void, stop(): void, lookup(text): string|null, modeOf(el): number }}
 */
export function l10nFactory(data) {
  const exact = data && data.exact && typeof data.exact === 'object' ? data.exact : {};
  const own = Object.prototype.hasOwnProperty;
  const ATTRS = ['title', 'placeholder', 'aria-label', 'aria-description', 'aria-placeholder', 'alt', 'data-tooltip'];
  const MAX_CHARS = 600;
  const MAX_CACHE = 5000;

  // ---- the word list --------------------------------------------------------------------

  /**
   * The longest run of fixed letters and spaces that every match of a pattern must contain.
   * It is read from the top level of the pattern only, and never from a place that can
   * repeat or be left out. A text without it cannot match, and that is quick to see.
   */
  function fixedPart(source) {
    let best = '';
    let run = '';
    let depth = 0;
    let inClass = false;
    const end = () => {
      if (run.length > best.length) best = run;
      run = '';
    };
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '\\') {
        i += 1;
        end();
      } else if (inClass) {
        if (ch === ']') inClass = false;
      } else if (ch === '[') {
        inClass = true;
        end();
      } else if (ch === '(') {
        depth += 1;
        end();
      } else if (ch === ')') {
        depth -= 1;
        end();
      } else if (ch === '{') {
        // A count such as {2,3}: nothing of it is text.
        const close = source.indexOf('}', i);
        if (close !== -1) i = close;
        end();
      } else if (ch === '|' && depth === 0) {
        // A choice at the top level: no part is in every match.
        return '';
      } else if (depth > 0 || !/[A-Za-z ]/.test(ch)) {
        end();
      } else if (/[?*+{]/.test(source[i + 1] || '')) {
        // This letter can repeat or be left out.
        end();
      } else {
        run += ch;
      }
    }
    end();
    return best;
  }

  /**
   * The fixed characters of a pattern outside its groups. More of them make a pattern more
   * particular: "^Error restarting (.+?): (.+?)$" has more than "^Error (.+?)$".
   */
  function fixedText(source) {
    let text = '';
    let depth = 0;
    let inClass = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '\\') {
        const next = source[i + 1] || '';
        i += 1;
        if (depth === 0 && !inClass && !/[0-9A-Za-z]/.test(next)) text += next;
      } else if (inClass) {
        if (ch === ']') inClass = false;
      } else if (ch === '[') {
        inClass = true;
      } else if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth -= 1;
      } else if (ch === '{') {
        const close = source.indexOf('}', i);
        if (close !== -1) i = close;
      } else if (depth === 0 && !'^$.*+?|'.includes(ch)) {
        text += ch;
      }
    }
    return text;
  }

  /** Four or more plain English words: a sentence, not a name or a number. */
  function isProse(part) {
    return typeof part === 'string' && (part.match(/(?:^|\s)[A-Za-z]+(?=[\s,.;:!?]|$)/g) || []).length >= 4;
  }

  // A pattern that starts with fixed letters is tried only for a text that starts with the
  // same letter. The rest is tried for every text that holds the fixed part of the pattern.
  // The more particular patterns are tried first, so that a general one cannot hide them.
  const byFirstLetter = Object.create(null);
  const forAnyText = [];
  let index = 0;
  for (const row of Array.isArray(data && data.patterns) ? data.patterns : []) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string') continue;
    let re;
    try {
      re = new RegExp(row[0]);
    } catch {
      continue;
    }
    const fixed = fixedText(row[0]);
    // A pattern with only one fixed word, such as "^Turn (.+?)$", would turn the first word of
    // any sentence into Chinese and leave the rest in English. It is used only for short parts.
    const loose = (fixed.match(/[A-Za-z]{2,}/g) || []).length <= 1;
    const item = { re, to: row[1], fixed: fixedPart(row[0]), weight: fixed.length, loose, index: index++ };
    const first = /^\^([A-Za-z])[A-Za-z ]/.exec(row[0]);
    if (first) (byFirstLetter[first[1]] || (byFirstLetter[first[1]] = [])).push(item);
    else forAnyText.push(item);
  }
  const moreParticular = (a, b) => b.weight - a.weight || a.index - b.index;
  forAnyText.sort(moreParticular);
  const forLetter = Object.create(null);
  for (const letter of Object.keys(byFirstLetter)) forLetter[letter] = byFirstLetter[letter].concat(forAnyText).sort(moreParticular);

  /** The Chinese form of a text without outer spaces, or null. */
  function translate(key) {
    if (own.call(exact, key)) {
      const out = exact[key];
      return typeof out === 'string' && out !== '' ? out : null;
    }
    for (const item of forLetter[key[0]] || forAnyText) {
      if (item.fixed !== '' && key.indexOf(item.fixed) === -1) continue;
      const match = item.re.exec(key);
      if (!match || (item.loose && match.slice(1).some(isProse))) continue;
      // Every pattern matches the whole text, and a replacement holds only $1 to $9.
      return item.to.replace(/\$([1-9])/g, (_, n) => match[Number(n)] ?? '');
    }
    return null;
  }

  const cache = new Map();
  /** The Chinese form of `text`, with the spaces it had around it. null when the word list does not have it. */
  function lookup(text) {
    if (typeof text !== 'string' || text.length < 2 || text.length > MAX_CHARS) return null;
    // Without a Latin letter there is nothing to translate. This is also true for our own Chinese text.
    if (!/[A-Za-z]/.test(text)) return null;
    const key = text.replace(/\s+/g, ' ').trim();
    if (key.length < 2) return null;
    let out = cache.get(key);
    if (out === undefined) {
      out = translate(key);
      if (cache.size >= MAX_CACHE) cache.clear();
      cache.set(key, out);
    }
    if (out === null || out === key) return null;
    return /^\s*/.exec(text)[0] + out + /\s*$/.exec(text)[0];
  }

  // ---- which places are translated --------------------------------------------------------

  const CLOSED = 0; // Nothing below this element is translated.
  const CONTENT = 1; // Text of the user or of the model. Below it, only controls are translated.
  const OPEN = 2; // No rule of its own.
  const CONTROL = 3; // A button or a tooltip. Its text belongs to the interface.

  const CLOSED_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, CODE: 1, PRE: 1, TEXTAREA: 1, SAMP: 1, KBD: 1,
    VAR: 1, IFRAME: 1, CANVAS: 1, MATH: 1, SVG: 1, svg: 1, math: 1,
  };
  // Editors, terminals and formulas.
  const CLOSED_CLASSES = ['monaco-editor', 'xterm', 'katex', 'cm-editor', 'mermaid'];
  // The marks the client puts on text that the user or the model wrote, and on names of things
  // (conversations, projects, models). Seen in the page of 2.35.1.
  const CONTENT_IDS = {
    'user-message-content': 1,
    'user-message-bubble': 1,
    'planner-response-text': 1,
    'live-user-turn': 1,
    'live-agent-turn': 1,
    'transcript-line-text': 1,
    'conversation-row-sidebar': 1,
    'breadcrumb-segment': 1,
    'model-selector-trigger': 1,
    'model-selector-item': 1,
    'side-question-tab-header-name': 1,
    'pending-user-messages': 1,
    'vcs-commit-message': 1,
    'sidecar-logs-content': 1,
    'pdf-text-layer': 1,
  };
  const CONTENT_ATTRS = ['data-markdown-root', 'data-project-label', 'data-uri', 'data-quotable-inline'];
  const CONTROL_ROLES = { button: 1, tooltip: 1, menuitem: 1 };

  function kindOf(el) {
    if (CLOSED_TAGS[el.tagName] === 1) return CLOSED;
    const editable = el.getAttribute('contenteditable');
    if (editable !== null && editable !== 'false') return CLOSED;
    const classes = el.classList;
    if (classes && classes.length > 0) {
      for (let i = 0; i < CLOSED_CLASSES.length; i++) if (classes.contains(CLOSED_CLASSES[i])) return CLOSED;
    }
    const id = el.getAttribute('data-testid');
    if (id !== null && CONTENT_IDS[id] === 1) return CONTENT;
    for (let i = 0; i < CONTENT_ATTRS.length; i++) if (el.hasAttribute(CONTENT_ATTRS[i])) return CONTENT;
    if (el.tagName === 'BUTTON') return CONTROL;
    const role = el.getAttribute('role');
    if (role !== null && CONTROL_ROLES[role] === 1) return CONTROL;
    return OPEN;
  }

  /** The mode below an element of kind `kind`, when the mode at its parent is `parentMode`. */
  const below = (parentMode, kind) => (kind === OPEN ? parentMode : kind === CONTROL ? OPEN : kind);

  /** CLOSED, CONTENT or OPEN for the text and the attributes of `el`, from `el` and everything above it. */
  function modeOf(el) {
    let decided = null;
    let control = false;
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentNode) {
      const kind = kindOf(cur);
      if (kind === CLOSED) return CLOSED;
      if (decided !== null) continue;
      if (kind === CONTROL) control = true;
      else if (kind === CONTENT) decided = control ? OPEN : CONTENT;
    }
    return decided === null ? OPEN : decided;
  }

  // ---- writing --------------------------------------------------------------------------

  // The English text of every text node that was changed here. A later change by the page
  // brings new English; it is put here before anything else is done (see onRecords).
  const originals = new WeakMap();
  const englishOf = (node) => (originals.has(node) ? originals.get(node) : node.nodeValue);

  function translateText(node) {
    const english = englishOf(node);
    const out = lookup(english);
    const want = out === null ? english : out;
    if (node.nodeValue === want) return;
    originals.set(node, english);
    node.nodeValue = want;
  }

  /**
   * The text nodes of `el` when it has nothing else and at least two of them hold words:
   * one sentence that the page put together from parts, such as "No ", kind, " yet".
   */
  function textGroup(el) {
    let words = 0;
    const nodes = [];
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 3) return null;
      nodes.push(child);
      if (/\S/.test(englishOf(child))) words += 1;
    }
    return words >= 2 ? nodes : null;
  }

  /**
   * Such a sentence is translated whole: the first part gets the Chinese sentence and the
   * others become empty. A sentence without an entry stays in English, part by part; a
   * translated part next to English parts would not make sense.
   */
  function translateGroup(nodes) {
    const english = nodes.map(englishOf);
    const out = lookup(english.join(''));
    for (let i = 0; i < nodes.length; i++) {
      const want = out === null ? english[i] : i === 0 ? out : '';
      if (nodes[i].nodeValue !== want) {
        originals.set(nodes[i], english[i]);
        nodes[i].nodeValue = want;
      }
    }
  }

  /** The text directly in `el`. */
  function translateTextOf(el) {
    const group = textGroup(el);
    if (group) {
      translateGroup(group);
      return;
    }
    for (let child = el.firstChild; child; child = child.nextSibling) if (child.nodeType === 3) translateText(child);
  }

  function translateAttribute(el, name) {
    const value = el.getAttribute(name);
    if (value === null) return;
    const out = lookup(value);
    if (out !== null) el.setAttribute(name, out);
  }

  /** Translate `root` and everything below it. `parentMode` is the mode at the parent of `root`. */
  function walk(root, parentMode) {
    const stack = [[root, parentMode]];
    while (stack.length > 0) {
      const [el, above] = stack.pop();
      const kind = kindOf(el);
      if (kind === CLOSED) continue;
      const mode = below(above, kind);
      if (mode === OPEN) {
        for (let i = 0; i < ATTRS.length; i++) if (el.hasAttribute(ATTRS[i])) translateAttribute(el, ATTRS[i]);
        translateTextOf(el);
      }
      for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) stack.push([child, mode]);
      }
    }
  }

  let observer = null;
  let failures = 0;

  function onRecords(records) {
    // The structure of the page does not change while this runs, so a mode is found once.
    const modes = new Map();
    const mode = (el) => {
      let found = modes.get(el);
      if (found === undefined) {
        found = modeOf(el);
        modes.set(el, found);
      }
      return found;
    };
    // A text that the page changed is the new English of that node. All of them are taken
    // first, while the page holds only what the page wrote.
    for (const record of records) {
      if (record.type === 'characterData' && record.target.nodeType === 3) originals.set(record.target, record.target.nodeValue);
    }
    // Each element is done once, however many of its parts changed.
    const done = new Set();
    const textChanged = (parent) => {
      if (done.has(parent) || mode(parent) !== OPEN) return;
      done.add(parent);
      translateTextOf(parent);
    };
    for (const record of records) {
      const target = record.target;
      if (record.type === 'characterData') {
        const parent = target.parentNode;
        if (target.nodeType === 3 && parent && parent.nodeType === 1) textChanged(parent);
      } else if (record.type === 'attributes') {
        if (target.nodeType === 1 && mode(target) === OPEN) translateAttribute(target, record.attributeName);
      } else {
        // A part of a sentence was taken out: what is left is looked at again.
        for (const node of record.removedNodes || []) {
          if (node.nodeType === 3 && target.nodeType === 1) textChanged(target);
        }
        for (const node of record.addedNodes || []) {
          const parent = node.parentNode;
          // A node that was taken out again has no parent.
          if (!parent || parent.nodeType !== 1) continue;
          if (node.nodeType === 3) {
            textChanged(parent);
          } else if (node.nodeType === 1) {
            const above = mode(parent);
            if (above !== CLOSED) walk(node, above);
          }
        }
      }
    }
  }

  // A mistake here must never disturb the page. After some failures the translator stops.
  function safely(records) {
    if (!observer) return;
    try {
      onRecords(records);
      // What is waiting now are the changes that were made just above.
      if (observer) observer.takeRecords();
    } catch (error) {
      failures += 1;
      try {
        console.error('[agy-flags] the translation failed:', error);
      } catch {
        // nothing else to do
      }
      if (failures >= 5) stop();
    }
  }

  function start(doc) {
    if (observer || !doc || !doc.documentElement || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(safely);
    observer.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
    try {
      walk(doc.documentElement, OPEN);
      observer.takeRecords();
    } catch (error) {
      try {
        console.error('[agy-flags] the translation failed:', error);
      } catch {
        // nothing else to do
      }
    }
  }

  function stop() {
    if (observer) observer.disconnect();
    observer = null;
  }

  return { start, stop, lookup, modeOf };
}

// ---- the word list file ---------------------------------------------------------------------

const MAX_ENTRIES = 20000;
const MAX_PATTERNS = 2000;
const MAX_TEXT = 600;

/** A pattern must be simple enough that it cannot take long on any text. */
export function isSafePattern(source) {
  if (typeof source !== 'string' || source.length < 3 || source.length > 300) return false;
  if (!source.startsWith('^') || !source.endsWith('$') || source.endsWith('\\$')) return false;
  // No repeated group ((a+)+ and its relatives), and no reference back.
  if (/\)[+*{]/.test(source) || /\\[1-9]/.test(source)) return false;
  // No choice outside a group: it would make the two ends free.
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === '|' && depth === 0) return false;
    if (depth < 0) return false;
  }
  if (depth !== 0 || inClass) return false;
  try {
    new RegExp(source);
  } catch {
    return false;
  }
  return true;
}

/** How many groups a pattern has. */
function groupCount(source) {
  return new RegExp(`${source}|`).exec('').length - 1;
}

/**
 * Is `data` a word list and nothing else? It is written into the page script.
 * { exact: { english: chinese }, patterns: [[regexSource, replacement], ...] }
 */
export function isDictionary(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const { exact, patterns } = data;
  if (!exact || typeof exact !== 'object' || Array.isArray(exact)) return false;
  const entries = Object.entries(exact);
  if (entries.length === 0 || entries.length > MAX_ENTRIES) return false;
  const plain = (text) => typeof text === 'string' && text.length > 0 && text.length <= MAX_TEXT && !/[\u0000-\u0008\u000b-\u001f]/.test(text);
  if (!entries.every(([from, to]) => plain(from) && plain(to) && from === from.replace(/\s+/g, ' ').trim())) return false;
  if (!Array.isArray(patterns) || patterns.length > MAX_PATTERNS) return false;
  return patterns.every((row) => {
    if (!Array.isArray(row) || row.length !== 2 || !isSafePattern(row[0]) || !plain(row[1])) return false;
    // In the replacement, a dollar sign may only name a group that the pattern has.
    const groups = groupCount(row[0]);
    const refs = row[1].match(/\$./g) || [];
    return !/\$$/.test(row[1]) && refs.every((ref) => /^\$[1-9]$/.test(ref) && Number(ref[1]) <= groups);
  });
}

/**
 * Read a word list file.
 * @returns {{ version: string, data: object, count: number } | null} null when the file is not a word list.
 */
export function loadDictionary(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const data = { exact: parsed?.exact, patterns: parsed?.patterns };
  if (!isDictionary(data)) return null;
  return {
    version: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16),
    data,
    count: Object.keys(data.exact).length + data.patterns.length,
  };
}

/**
 * Add the translator to the end of the page script. The script of the client stays as it is.
 * @returns {{ ok: true, source: string } | { ok: false, reason: string }}
 */
export function patchL10n(source, data) {
  if (!isDictionary(data)) return { ok: false, reason: 'there is no word list' };
  // The translator is made once for each page load. A failure while it is made changes nothing.
  const code =
    '\n;(()=>{try{if(!globalThis.__agyFlagsL10n){globalThis.__agyFlagsL10n=(' +
    l10nFactory.toString() +
    `)(${JSON.stringify(data)});globalThis.__agyFlagsL10n.start(document)}}catch(e){try{console.error("[agy-flags]",e)}catch(_){}}})();\n`;
  return { ok: true, source: source + code };
}
