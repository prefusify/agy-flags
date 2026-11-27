// The Chinese interface of Antigravity's page.
//
// The page script of the client has no languages: every English text is written directly in
// its code. So the translation is made in the page, after the page has drawn its text. A
// translator is added to the end of the page script. It watches the page and replaces a text
// that the word list knows with its Chinese form. The code of the client is not changed, so
// a mistake in the word list can only show a wrong text; it cannot break a function.
//
// What is translated: a whole text node, a contiguous run of text nodes, an inline-slot
// sentence (modifying only existing text nodes in place — never adding, removing, or moving
// DOM nodes), or a whole visible attribute value that matches the word list. Nothing is
// translated in part.
//
// What is never translated: the text of the conversation (messages of the user and of the
// model), code (including Shiki code/diff views), terminals, editors, PDF text layers, and
// input field values. The translator knows these places by the marks that the client itself
// puts on them (see `kindOf` below).

import fs from 'node:fs';
import crypto from 'node:crypto';

/** The attributes whose value the user can see or hear. */
export const L10N_ATTRIBUTES = Object.freeze([
  'title',
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-valuetext',
  'aria-roledescription',
  'alt',
  'data-tooltip',
  'data-slot-out',
]);

/**
 * The translator. It runs inside Antigravity's page, so it is plain JavaScript without
 * imports, and it writes text only with nodeValue and setAttribute.
 *
 * `data` is { exact: { english: chinese }, patterns: [[regexSource, replacement], ...], inline?: { template: chinese } }.
 * @returns {{ start(doc): void, stop(): void, lookup(text): string|null, modeOf(el): number }}
 */
export function l10nFactory(data, attrs) {
  const exact = data && data.exact && typeof data.exact === 'object' ? data.exact : {};
  const inline = data && data.inline && typeof data.inline === 'object' && !Array.isArray(data.inline) ? data.inline : null;
  const own = Object.prototype.hasOwnProperty;
  const ATTRS =
    Array.isArray(attrs) && attrs.length > 0
      ? attrs
      : ['title', 'placeholder', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-valuetext', 'aria-roledescription', 'alt', 'data-tooltip', 'data-slot-out'];
  const MAX_CHARS = 600;
  const MAX_CACHE = 5000;

  // ---- punctuation normalization --------------------------------------------------------

  /** Normalize typographic quotes and ellipsis to ASCII equivalents without changing letter case. */
  function normPunct(text) {
    return text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2026/g, '...');
  }

  /** Normalize literal typographic quotes and ellipsis in a pattern source (outside character classes). */
  function normPatternSource(source) {
    if (!/[\u2018\u2019\u201C\u201D\u2026]/.test(source)) return source;
    let out = '';
    let inClass = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '\\') {
        out += ch + (source[i + 1] || '');
        i += 1;
      } else if (inClass) {
        if (ch === ']') inClass = false;
        out += ch;
      } else if (ch === '[') {
        inClass = true;
        out += ch;
      } else if (ch === '\u2018' || ch === '\u2019') {
        out += "'";
      } else if (ch === '\u201C' || ch === '\u201D') {
        out += '"';
      } else if (ch === '\u2026') {
        out += '\\.\\.\\.';
      } else {
        out += ch;
      }
    }
    return out;
  }

  const exactNorm = Object.create(null);
  for (const key of Object.keys(exact)) {
    const val = exact[key];
    if (typeof val !== 'string' || val === '') continue;
    const nk = normPunct(key);
    if (nk !== key && !own.call(exact, nk) && !own.call(exactNorm, nk)) exactNorm[nk] = val;
  }

  const inlineNorm = Object.create(null);
  let hasInline = false;
  if (inline) {
    for (const key of Object.keys(inline)) {
      const val = inline[key];
      if (typeof val !== 'string' || val === '') continue;
      hasInline = true;
      const nk = normPunct(key);
      if (nk !== key && !own.call(inline, nk) && !own.call(inlineNorm, nk)) inlineNorm[nk] = val;
    }
  }

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
   * Required \s / \s+ counts as a space in both `text` (weight) and `wordsText` (word count);
   * optional \s* / \s? separates words in `wordsText` without inflating weight; single-char
   * optional literals (such as the `s` in `items?`) do not inflate weight.
   */
  function fixedText(source) {
    let text = '';
    let wordsText = '';
    let depth = 0;
    let inClass = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '\\') {
        const next = source[i + 1] || '';
        const quant = source[i + 2] || '';
        const optional = quant === '?' || quant === '*';
        i += 1;
        if (depth === 0 && !inClass) {
          if (next === 's') {
            wordsText += ' ';
            if (!optional) text += ' ';
          } else if (!/[0-9A-Za-z]/.test(next)) {
            if (!optional) text += next;
            wordsText += next;
          }
        }
      } else if (inClass) {
        if (ch === ']') inClass = false;
      } else if (ch === '[') {
        inClass = true;
        if (depth === 0) wordsText += ' ';
      } else if (ch === '(') {
        depth += 1;
        if (depth === 1) wordsText += ' ';
      } else if (ch === ')') {
        depth -= 1;
      } else if (ch === '{') {
        const close = source.indexOf('}', i);
        if (close !== -1) i = close;
      } else if (depth === 0 && !'^$.*+?|'.includes(ch)) {
        const quant = source[i + 1] || '';
        const optional = quant === '?' || quant === '*';
        if (!optional) text += ch;
        wordsText += ch;
      }
    }
    return { text, wordsText };
  }

  /** Number of unconstrained wildcard groups like (.+), (.+?), (.*), (.*?). */
  function wildcardCount(source) {
    return (source.match(/\((?:\?:)?\.[+*]\??\)/g) || []).length;
  }

  /**
   * Four or more plain English words, or three+ English words inside a 4+-token phrase
   * (e.g. "all 5 remaining items"): a sentence, not a name or a number.
   */
  function isProse(part) {
    if (typeof part !== 'string') return false;
    const words = (part.match(/(?:^|\s)[A-Za-z]+(?=[\s,.;:!?]|$)/g) || []).length;
    if (words >= 4) return true;
    return words >= 3 && part.trim().split(/\s+/).length >= 4;
  }

  // A pattern that starts with a fixed letter is tried only for a text that starts with the
  // same letter. The rest is tried for every text that holds the fixed part of the pattern.
  // The more particular patterns are tried first (more fixed chars, then fewer unconstrained
  // wildcards), so that a general one cannot hide them.
  const byFirstLetter = Object.create(null);
  const forAnyText = [];
  let index = 0;
  for (const row of Array.isArray(data && data.patterns) ? data.patterns : []) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string') continue;
    const src = normPatternSource(row[0]);
    let re;
    try {
      re = new RegExp(src);
    } catch {
      continue;
    }
    const ft = fixedText(src);
    // A pattern with only one fixed word, such as "^Turn (.+?)$", would turn the first word of
    // any sentence into Chinese and leave the rest in English. It is used only for short parts,
    // except explicit colon-prefixed UI labels such as "^Error: (.+?)$" or "^Failed: (.+?)$".
    const wordCount = (ft.wordsText.match(/[A-Za-z]{2,}/g) || []).length;
    const colonPrefix = /^\^[A-Za-z][A-Za-z-]*:(?: |\\s)/.test(src);
    const loose = wordCount <= 1 && !colonPrefix;
    const item = {
      re,
      to: row[1],
      fixed: fixedPart(src),
      weight: ft.text.length,
      wildcards: wildcardCount(src),
      loose,
      index: index++,
    };
    const first = /^\^([A-Za-z])(?![?*+{])/.exec(src);
    if (first) (byFirstLetter[first[1]] || (byFirstLetter[first[1]] = [])).push(item);
    else forAnyText.push(item);
  }
  const moreParticular = (a, b) => b.weight - a.weight || a.wildcards - b.wildcards || a.index - b.index;
  forAnyText.sort(moreParticular);
  const forLetter = Object.create(null);
  for (const letter of Object.keys(byFirstLetter)) forLetter[letter] = byFirstLetter[letter].concat(forAnyText).sort(moreParticular);

  /** The Chinese form of a text without outer spaces, or null. */
  function translate(key) {
    if (own.call(exact, key)) {
      const out = exact[key];
      return typeof out === 'string' && out !== '' ? out : null;
    }
    const nKey = normPunct(key);
    if (nKey !== key && own.call(exact, nKey)) {
      const out = exact[nKey];
      return typeof out === 'string' && out !== '' ? out : null;
    }
    if (own.call(exactNorm, nKey)) {
      const out = exactNorm[nKey];
      return typeof out === 'string' && out !== '' ? out : null;
    }
    for (const item of forLetter[nKey[0]] || forAnyText) {
      if (item.fixed !== '' && nKey.indexOf(item.fixed) === -1) continue;
      const match = item.re.exec(nKey);
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
      if (cache.size >= MAX_CACHE) {
        let drop = MAX_CACHE >> 1;
        for (const k of cache.keys()) {
          cache.delete(k);
          if (--drop <= 0) break;
        }
      }
      cache.set(key, out);
    }
    if (out === null || out === key) return null;
    return /^\s*/.exec(text)[0] + out + /\s*$/.exec(text)[0];
  }

  // ---- which places are translated --------------------------------------------------------

  const CLOSED = 0; // Nothing on or below this element is translated.
  const CONTENT = 1; // Text of the user or of the model. Below it, only controls are translated.
  const OPEN = 2; // No rule of its own.
  const CONTROL = 3; // A button, menu item, tab, switch or tooltip. Its text belongs to the interface.
  const CLOSED_CHILDREN = 4; // Textarea or contenteditable host: own attributes translate if parent is OPEN; children are CLOSED.

  const CLOSED_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, CODE: 1, PRE: 1, SAMP: 1, KBD: 1,
    VAR: 1, IFRAME: 1, CANVAS: 1, MATH: 1, SVG: 1, svg: 1, math: 1,
  };
  // Editors, terminals, formulas, Shiki code blocks and PDF text layers.
  const CLOSED_CLASSES = ['monaco-editor', 'xterm', 'katex', 'cm-editor', 'mermaid', 'code-block', 'textLayer'];
  const CLOSED_ATTRS = ['data-line-tokens'];
  const CLOSED_IDS = { 'pdf-text-layer': 1 };
  // The marks the client puts on text that the user or the model wrote, and on names of things
  // (conversations, projects, branches, files, models). Verified on Antigravity 2.35.2.
  const CONTENT_IDS = {
    'user-message-content': 1,
    'user-message-bubble': 1,
    'planner-response-text': 1,
    'live-user-turn': 1,
    'live-agent-turn': 1,
    'transcript-line-text': 1,
    'conversation-row-sidebar': 1,
    'conversation-row-history': 1,
    'breadcrumb-segment': 1,
    'model-selector-trigger': 1,
    'model-selector-item': 1,
    'model-selector-custom-item': 1,
    'orchestrator-picker-row': 1,
    'side-question-tab-header-name': 1,
    'pending-user-messages': 1,
    'sidecar-logs-content': 1,
    'branch-pill-label': 1,
    'branch-option': 1,
    'branch-repo-label': 1,
    'file-title-name': 1,
    'webview-download-filename': 1,
    'ssh-config-file-name': 1,
    'sidebar-agent-hover-card-title': 1,
    'sidebar-agent-hover-card-description': 1,
    'automation-name': 1,
    'browser-url-display': 1,
    'url-security-host': 1,
    'webview-prompt-origin': 1,
    'webview-prompt-message': 1,
    'voice-transcript-summary': 1,
    'voice-transcript-summary-lead': 1,
    'voice-transcript-summary-point': 1,
    'markdown-frontmatter': 1,
  };
  const CONTENT_ATTRS = [
    'data-markdown-root',
    'data-project-label',
    'data-project-name',
    'data-repo-slug',
    'data-uri',
    'data-file-uri',
    'data-quotable-inline',
  ];
  const CONTROL_ROLES = {
    button: 1,
    tooltip: 1,
    menuitem: 1,
    menuitemcheckbox: 1,
    menuitemradio: 1,
    radio: 1,
    tab: 1,
    switch: 1,
    checkbox: 1,
  };
  const INLINE_TAGS = { SPAN: 1, STRONG: 1, B: 1, EM: 1, A: 1, CODE: 1, KBD: 1, BUTTON: 1 };

  function kindOf(el) {
    if (CLOSED_TAGS[el.tagName] === 1) return CLOSED;
    for (let i = 0; i < CLOSED_ATTRS.length; i++) if (el.hasAttribute(CLOSED_ATTRS[i])) return CLOSED;
    const classes = el.classList;
    if (classes && classes.length > 0) {
      for (let i = 0; i < CLOSED_CLASSES.length; i++) if (classes.contains(CLOSED_CLASSES[i])) return CLOSED;
    }
    const id = el.getAttribute('data-testid');
    if (id !== null && CLOSED_IDS[id] === 1) return CLOSED;
    if (el.tagName === 'TEXTAREA') return CLOSED_CHILDREN;
    const editable = el.getAttribute('contenteditable');
    if (editable !== null && editable !== 'false') return CLOSED_CHILDREN;
    if (id !== null && CONTENT_IDS[id] === 1) return CONTENT;
    for (let i = 0; i < CONTENT_ATTRS.length; i++) if (el.hasAttribute(CONTENT_ATTRS[i])) return CONTENT;
    if (el.tagName === 'BUTTON') return CONTROL;
    const role = el.getAttribute('role');
    if (role !== null && CONTROL_ROLES[role] === 1) return CONTROL;
    return OPEN;
  }

  /** The mode below an element of kind `kind`, when the mode at its parent is `parentMode`. */
  const below = (parentMode, kind) =>
    parentMode === CLOSED || kind === CLOSED || kind === CLOSED_CHILDREN
      ? CLOSED
      : kind === OPEN
        ? parentMode
        : kind === CONTROL
          ? OPEN
          : kind;

  /** CLOSED, CONTENT or OPEN for the text and children of `el`, from `el` and everything above it. */
  function modeOf(el) {
    let decided = null;
    let control = false;
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentNode) {
      const kind = kindOf(cur);
      if (kind === CLOSED || kind === CLOSED_CHILDREN) return CLOSED;
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
   * A contiguous run of text nodes is translated whole: the first part gets the Chinese
   * sentence and the others become empty. A sentence without an entry stays in English,
   * part by part; a translated part next to English parts would not make sense.
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

  function flushRun(run, words) {
    if (words >= 2) translateGroup(run);
    else {
      for (let i = 0; i < run.length; i++) translateText(run[i]);
    }
  }

  /**
   * Translate a sentence split by 1..3 inline child elements in place using the `inline` table.
   * Only existing Text nodes' nodeValue is written; DOM structure and node references never change.
   */
  function translateInline(el) {
    if (!hasInline) return false;
    const segs = [[]];
    let slots = 0;
    let hasLetter = false;
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        segs[slots].push(child);
        if (!hasLetter && /[A-Za-z]/.test(englishOf(child))) hasLetter = true;
      } else if (child.nodeType === 8) {
        continue;
      } else if (child.nodeType === 1) {
        if (INLINE_TAGS[child.tagName] !== 1 || slots >= 3) return false;
        slots += 1;
        segs.push([]);
      } else {
        return false;
      }
    }
    if (slots === 0 || !hasLetter) return false;
    const rawParts = segs.map((run) => run.map(englishOf).join(''));
    let raw = rawParts[0];
    for (let i = 1; i <= slots; i++) raw += `{${i}}${rawParts[i]}`;
    if (raw.length > MAX_CHARS) return false;
    const key = raw.replace(/\s+/g, ' ').trim();
    let tpl = null;
    if (own.call(inline, key)) {
      tpl = inline[key];
    } else {
      const nKey = normPunct(key);
      if (own.call(inline, nKey)) tpl = inline[nKey];
      else if (own.call(inlineNorm, nKey)) tpl = inlineNorm[nKey];
    }
    if (typeof tpl !== 'string' || tpl === '') return false;
    const found = [...tpl.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
    if (found.length !== slots || !found.every((n, i) => n === i + 1)) return false;
    const zhParts = tpl.split(/\{[1-3]\}/);
    if (zhParts.length !== slots + 1) return false;
    // Never create a Text node where the original DOM had none.
    for (let i = 0; i <= slots; i++) {
      if (segs[i].length === 0 && zhParts[i] !== '') return false;
    }
    const lead = /^\s*/.exec(raw)[0];
    const trail = /\s*$/.exec(raw)[0];
    if (segs[0].length > 0 && lead) zhParts[0] = lead + zhParts[0];
    if (segs[slots].length > 0 && trail) zhParts[slots] = zhParts[slots] + trail;
    for (let i = 0; i <= slots; i++) {
      const run = segs[i];
      for (let j = 0; j < run.length; j++) {
        const english = englishOf(run[j]);
        const want = j === 0 ? zhParts[i] : '';
        if (run[j].nodeValue !== want) {
          originals.set(run[j], english);
          run[j].nodeValue = want;
        }
      }
    }
    return true;
  }

  /** The text directly in `el`: try inline-slot template first, otherwise translate each contiguous text run. */
  function translateTextOf(el) {
    if (translateInline(el)) return;
    let run = [];
    let words = 0;
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        run.push(child);
        if (/\S/.test(englishOf(child))) words += 1;
      } else if (child.nodeType === 8) {
        continue;
      } else if (run.length > 0) {
        flushRun(run, words);
        run = [];
        words = 0;
      }
    }
    if (run.length > 0) flushRun(run, words);
  }

  function translateAttribute(el, name) {
    const value = el.getAttribute(name);
    if (value === null) return;
    const out = lookup(value);
    if (out !== null) el.setAttribute(name, out);
  }

  function translateAttributesOf(el) {
    for (let i = 0; i < ATTRS.length; i++) if (el.hasAttribute(ATTRS[i])) translateAttribute(el, ATTRS[i]);
  }

  /** Translate `root` and everything below it. `parentMode` is the mode at the parent of `root`. */
  function walk(root, parentMode) {
    const stack = [[root, parentMode]];
    while (stack.length > 0) {
      const [el, above] = stack.pop();
      const kind = kindOf(el);
      if (kind === CLOSED) continue;
      if (kind === CLOSED_CHILDREN) {
        if (above === OPEN) translateAttributesOf(el);
        continue;
      }
      const mode = below(above, kind);
      if (mode === OPEN) {
        translateAttributesOf(el);
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
    // The structure of the page does not change while this runs, so each ancestor mode is cached once.
    const modes = new Map();
    const mode = (el) => {
      if (!el || el.nodeType !== 1) return OPEN;
      const found = modes.get(el);
      if (found !== undefined) return found;
      const chain = [];
      let cur = el;
      let base = OPEN;
      while (cur && cur.nodeType === 1) {
        const cached = modes.get(cur);
        if (cached !== undefined) {
          base = cached;
          break;
        }
        const kind = kindOf(cur);
        if (kind === CLOSED || kind === CLOSED_CHILDREN) {
          modes.set(cur, CLOSED);
          base = CLOSED;
          break;
        }
        chain.push([cur, kind]);
        cur = cur.parentNode;
      }
      for (let i = chain.length - 1; i >= 0; i--) {
        base = below(base, chain[i][1]);
        modes.set(chain[i][0], base);
      }
      return base;
    };
    const hasRelevantTextChild = (el) => {
      for (let c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3 && (originals.has(c) || /[A-Za-z]/.test(c.nodeValue || ''))) return true;
      }
      return false;
    };
    // A text that the page changed is the new English of that node. Only record for nodes
    // that are tracked or live in an OPEN element (skip CLOSED/CONTENT streaming churn).
    for (const record of records) {
      if (record.type === 'characterData' && record.target.nodeType === 3) {
        const node = record.target;
        const parent = node.parentNode;
        if (originals.has(node) || (parent && parent.nodeType === 1 && mode(parent) === OPEN)) {
          originals.set(node, node.nodeValue);
        }
      }
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
        if (target.nodeType === 1) {
          const kind = kindOf(target);
          const ok = kind === CLOSED_CHILDREN ? mode(target.parentNode) === OPEN : mode(target) === OPEN;
          if (ok) translateAttribute(target, record.attributeName);
        }
      } else {
        // A text or element child was removed: remaining text runs or inline templates may have merged.
        for (const node of record.removedNodes || []) {
          if (target.nodeType === 1 && (node.nodeType === 3 || (node.nodeType === 1 && hasRelevantTextChild(target)))) {
            textChanged(target);
          }
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
            if (above === OPEN && hasRelevantTextChild(parent)) textChanged(parent);
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
const MAX_INLINE = 2000;
const MAX_TEXT = 600;

/** A pattern must be simple enough that it cannot take long on any text. */
export function isSafePattern(source) {
  if (typeof source !== 'string' || source.length < 3 || source.length > 300) return false;
  if (!source.startsWith('^') || !source.endsWith('$') || source.endsWith('\\$')) return false;
  // Leading or trailing whitespace can never match trimmed lookup keys.
  if (/^\^\s|\s\$$/.test(source)) return false;
  // No repeated group ((a+)+ and its relatives), and no reference back.
  if (/\)[+*{]/.test(source) || /\\[1-9]/.test(source)) return false;
  // No adjacent unbounded wildcards and at most 4 unbounded wildcard groups (prevents polynomial backtracking).
  if (/\((?:\?:)?\.[+*]\??\)\((?:\?:)?\.[+*]\??\)/.test(source)) return false;
  if ((source.match(/\((?:\?:)?\.[+*]\??\)/g) || []).length > 4) return false;
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

/** Validate one inline-slot template entry (`{1}`, `{2}`, `{3}` strictly ascending, zero DOM additions). */
function isInlineEntry(from, to, plain) {
  if (!plain(from) || !plain(to) || from !== from.replace(/\s+/g, ' ').trim()) return false;
  if (!/[A-Za-z]/.test(from)) return false;
  const fromSlots = [...from.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
  if (fromSlots.length < 1 || fromSlots.length > 3) return false;
  if (!fromSlots.every((n, i) => n === i + 1)) return false;
  const toSlots = [...to.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
  if (toSlots.length !== fromSlots.length || !toSlots.every((n, i) => n === i + 1)) return false;
  const fromParts = from.split(/\{[1-3]\}/);
  const toParts = to.split(/\{[1-3]\}/);
  if (fromParts.length !== fromSlots.length + 1 || toParts.length !== toSlots.length + 1) return false;
  return fromParts.every((part, i) => part !== '' || toParts[i] === '');
}

/**
 * Is `data` a word list and nothing else? It is written into the page script.
 * { exact: { english: chinese }, patterns: [[regexSource, replacement], ...], inline?: { template: chinese } }
 */
export function isDictionary(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const { exact, patterns, inline } = data;
  if (!exact || typeof exact !== 'object' || Array.isArray(exact)) return false;
  const entries = Object.entries(exact);
  if (entries.length === 0 || entries.length > MAX_ENTRIES) return false;
  const plain = (text) => typeof text === 'string' && text.length > 0 && text.length <= MAX_TEXT && !/[\u0000-\u0008\u000b-\u001f]/.test(text);
  if (!entries.every(([from, to]) => plain(from) && plain(to) && from === from.replace(/\s+/g, ' ').trim())) return false;
  if (!Array.isArray(patterns) || patterns.length > MAX_PATTERNS) return false;
  const patternsOk = patterns.every((row) => {
    if (!Array.isArray(row) || row.length !== 2 || !isSafePattern(row[0]) || !plain(row[1])) return false;
    // In the replacement, a dollar sign may only name a group that the pattern has.
    const groups = groupCount(row[0]);
    const refs = row[1].match(/\$./g) || [];
    return !/\$$/.test(row[1]) && refs.every((ref) => /^\$[1-9]$/.test(ref) && Number(ref[1]) <= groups);
  });
  if (!patternsOk) return false;
  if (inline !== undefined) {
    if (!inline || typeof inline !== 'object' || Array.isArray(inline)) return false;
    const inlineEntries = Object.entries(inline);
    if (inlineEntries.length > MAX_INLINE) return false;
    if (!inlineEntries.every(([from, to]) => isInlineEntry(from, to, plain))) return false;
  }
  return true;
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
  const data =
    parsed?.inline === undefined
      ? { exact: parsed?.exact, patterns: parsed?.patterns }
      : { exact: parsed?.exact, patterns: parsed?.patterns, inline: parsed.inline };
  if (!isDictionary(data)) return null;
  return {
    version: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16),
    data,
    count: Object.keys(data.exact).length + data.patterns.length + (data.inline ? Object.keys(data.inline).length : 0),
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
    `)(${JSON.stringify(data)},${JSON.stringify(L10N_ATTRIBUTES)});globalThis.__agyFlagsL10n.start(document)}}catch(e){try{console.error("[agy-flags]",e)}catch(_){}}})();\n`;
  return { ok: true, source: source + code };
}
