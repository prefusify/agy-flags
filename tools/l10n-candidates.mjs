#!/usr/bin/env node
// Lists user-facing English texts in Antigravity's page script (`main.js`) that the word list
// does not translate yet, and audits `src/l10n/zh-CN.json` for structural health issues.
//
//   node tools/l10n-candidates.mjs [path/to/Antigravity.app]              # untranslated candidates
//   node tools/l10n-candidates.mjs --audit [--strict] [appPath]           # audit zh-CN.json health
//   node tools/l10n-candidates.mjs --mismatches [appPath]                 # case/punct near-misses
//   node tools/l10n-candidates.mjs --inline [appPath]                     # inline-split sentences
//   node tools/l10n-candidates.mjs --json ...                             # JSON output
//
// Reads the client and the word list only; writes nothing except stdout/stderr.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUiBundle, readBundleFile } from '../src/bundle.mjs';
import { DEFAULT_CONFIG } from '../src/config.mjs';
import { isDictionary, isSafePattern, l10nFactory } from '../src/l10n.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORD_LIST_PATH = path.join(ROOT, 'src', 'l10n', 'zh-CN.json');
const MAX_CHARS = 600;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const appPath = positional[0] || DEFAULT_CONFIG.appPath;
const modeAudit = flags.has('--audit');
const modeMismatches = flags.has('--mismatches');
const modeInline = flags.has('--inline');
const modeJson = flags.has('--json');
const modeStrict = flags.has('--strict');

const words = JSON.parse(fs.readFileSync(WORD_LIST_PATH, 'utf8'));
const { lookup } = l10nFactory({
  exact: words.exact,
  patterns: words.patterns,
  ...(words.inline ? { inline: words.inline } : {}),
});

// ---- helpers ----------------------------------------------------------------------------

function normSpace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function normPunct(text) {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...');
}

function decodeJsString(raw) {
  if (!raw.includes('\\')) return raw;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i += 1;
    if (i >= raw.length) break;
    const esc = raw[i];
    if (esc === 'n') out += '\n';
    else if (esc === 'r') out += '\r';
    else if (esc === 't') out += '\t';
    else if (esc === 'b') out += '\b';
    else if (esc === 'f') out += '\f';
    else if (esc === 'v') out += '\v';
    else if (esc === '0') out += '\0';
    else if (esc === '\n') continue;
    else if (esc === '\r') {
      if (raw[i + 1] === '\n') i += 1;
    } else if (esc === 'x') {
      const hex = raw.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2;
      } else out += 'x';
    } else if (esc === 'u') {
      if (raw[i + 1] === '{') {
        const close = raw.indexOf('}', i + 2);
        if (close !== -1) {
          const cp = parseInt(raw.slice(i + 2, close), 16);
          if (!Number.isNaN(cp)) out += String.fromCodePoint(cp);
          i = close;
          continue;
        }
      }
      const hex = raw.slice(i + 1, i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else out += 'u';
    } else {
      out += esc;
    }
  }
  return out;
}

const UI_CHARS = /^[A-Za-z0-9 ,.'’‘\-!?:;()/&%+…“”"#@*<>=[\]_|~$·—–→←↗↕✓↻⏎•‹›🍌⚠️\u26a0\ufe0f]+$/;
const NOISE_RE =
  /^(?:https?:\/\/|file:\/\/|data:|M\d|rgba?\(|hsla?\(|var\(|calc\(|cubic-bezier|linear-gradient|translate[XY]?\(|rotate\(|scale\(|[a-z]+-[a-z0-9-]+(?:\s+[a-z0-9:/[\]-]+){2,}|Lexical node |Failed to parse |Invalid .*Resolution|Cannot read propert|Expected .* to |Specifies whether |Indicates with what percentage|Algorithm for packing)/;

function looksHuman(text, allowLower = false) {
  const s = normSpace(text);
  if (s.length < 2 || s.length > MAX_CHARS) return false;
  if (!/[A-Za-z]/.test(s) || !UI_CHARS.test(s)) return false;
  if (!allowLower && !/^[A-Z+#(·✓⚠️0-9]/.test(s)) return false;
  if (!allowLower && !/[a-z]{2}/.test(s)) return false;
  if (NOISE_RE.test(s)) return false;
  // Function call in code or CSS: rgba(...), var(...), foo(...).
  if (/[a-z]\(/.test(s)) return false;
  // Single token looking like a code identifier, CSS utility, or long run of letters.
  if (!s.includes(' ')) {
    if (/[a-z][A-Z]/.test(s) || /[_=<>[\]|~$#@*]/.test(s) || s.length > 24) return false;
    if (/^[a-z0-9]+-[a-z0-9-]+$/.test(s)) return false;
  }
  // Tailwind utility class strings: mostly hyphenated lowercase tokens.
  const parts = s.split(' ');
  if (parts.length >= 3) {
    const cssLike = parts.filter((p) => /^(?:!?[a-z]+(?:-[a-z0-9/[\].]+)+|(?:hover|focus|dark|group|peer|sm|md|lg|xl|aria|data|before|after):.+)$/.test(p)).length;
    if (cssLike / parts.length >= 0.5) return false;
  }
  return true;
}

/** Check whether a `{1}`-style template is already translated by probing both numeric and text values. */
function isTemplateTranslated(template) {
  if (lookup(template.replace(/\{\d+\}/g, '42')) !== null) return true;
  if (lookup(template.replace(/\{\d+\}/g, 'Sample')) !== null) return true;
  return false;
}

// ---- JS string & template scanner (single pass, balanced ${...}) ------------------------

function scanLiterals(source) {
  const strings = new Set();
  const templates = new Set();
  const len = source.length;
  let i = 0;

  while (i < len) {
    const ch = source.charCodeAt(i);
    // Double- or single-quoted string
    if (ch === 34 || ch === 39) {
      const start = i + 1;
      i += 1;
      while (i < len) {
        const c = source.charCodeAt(i);
        if (c === 92) {
          i += 2;
          continue;
        }
        if (c === ch || c === 10 || c === 13) break;
        i += 1;
      }
      if (i < len && source.charCodeAt(i) === ch && i - start >= 2 && i - start <= MAX_CHARS + 120) {
        const decoded = decodeJsString(source.slice(start, i));
        const normalized = normSpace(decoded);
        if (looksHuman(normalized, false)) {
          // Skip strings directly inside throw Error(...) or console.*(...) or .describe(...)
          const prev = source.slice(Math.max(0, start - 32), start - 1);
          if (!/(?:Error\(|console\.\w+\(|\.describe\(|type:\s*|kind:\s*)$/.test(prev)) {
            strings.add(normalized);
          }
        }
      }
      i += 1;
      continue;
    }
    // Template literal with balanced ${...} scanning
    if (ch === 96) {
      i += 1;
      let out = '';
      let n = 0;
      let ok = true;
      let segStart = i;
      const tplStart = i;
      while (i < len) {
        const c = source.charCodeAt(i);
        if (c === 92) {
          i += 2;
          continue;
        }
        if (c === 96) {
          out += decodeJsString(source.slice(segStart, i));
          i += 1;
          break;
        }
        if (c === 36 && source.charCodeAt(i + 1) === 123) {
          out += decodeJsString(source.slice(segStart, i));
          i += 2;
          const exprStart = i;
          let depth = 1;
          let inS = 0;
          while (i < len && depth > 0) {
            const ec = source.charCodeAt(i);
            if (inS) {
              if (ec === 92) {
                i += 2;
                continue;
              }
              if (ec === inS) inS = 0;
            } else if (ec === 34 || ec === 39 || ec === 96) {
              inS = ec;
            } else if (ec === 123) {
              depth += 1;
            } else if (ec === 125) {
              depth -= 1;
              if (depth === 0) break;
            }
            i += 1;
          }
          const expr = source.slice(exprStart, i);
          if (i < len) i += 1;
          // Expand trivial plural ternaries like `n===1?"":"s"` into the plural form for discovery.
          const plural = /===\s*1\s*\?\s*""\s*:\s*"(s|es)"$|!==\s*1\s*\?\s*"(s|es)"\s*:\s*""$/.exec(expr.trim());
          if (plural) out += plural[1] || plural[2];
          else out += `{${++n}}`;
          segStart = i;
          if (i - tplStart > MAX_CHARS + 200) {
            ok = false;
            break;
          }
          continue;
        }
        if (i - tplStart > MAX_CHARS + 200) {
          ok = false;
          break;
        }
        i += 1;
      }
      if (ok) {
        const normalized = normSpace(out);
        if (n === 0) {
          if (looksHuman(normalized, false)) strings.add(normalized);
        } else if (looksHuman(normalized.replace(/\{\d+\}/g, 'X'), false)) {
          templates.add(normalized);
        }
      }
      continue;
    }
    i += 1;
  }
  return { strings, templates };
}

// ---- React createElement extractor (JSX attrs, textGroups, mixed runs, inline splits) ---

const INLINE_HTML_TAGS = new Set(['span', 'strong', 'b', 'em', 'a', 'code', 'kbd', 'button']);
const UI_PROP_NAMES = new Set([
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
  'label',
  'description',
  'tooltip',
  'subtitle',
  'heading',
  'emptyText',
  'confirmText',
  'cancelText',
  'ariaLabel',
]);

function detectReactName(source) {
  const counts = new Map();
  const call = '.useState)';
  const before = /\(0,([A-Za-z_$][\w$]*)$/;
  for (let at = source.indexOf(call); at !== -1; at = source.indexOf(call, at + 1)) {
    const match = before.exec(source.slice(Math.max(0, at - 40), at));
    if (match) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  let best = null;
  let max = 0;
  for (const [name, count] of counts) {
    if (count > max) {
      best = name;
      max = count;
    }
  }
  return max >= 20 ? best : null;
}

function splitCallArgs(str, startIdx, maxLen = 4000) {
  const out = [];
  let i = startIdx;
  let argStart = i;
  let dParen = 0;
  let dBrace = 0;
  let dBrack = 0;
  let inStr = 0;
  while (i < str.length && i - startIdx <= maxLen) {
    const ch = str.charCodeAt(i);
    if (inStr) {
      if (ch === 92) {
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = 0;
      i += 1;
      continue;
    }
    if (ch === 34 || ch === 39 || ch === 96) {
      inStr = ch;
      i += 1;
      continue;
    }
    if (ch === 40) dParen += 1;
    else if (ch === 41) {
      if (dParen === 0) {
        out.push(str.slice(argStart, i).trim());
        return out;
      }
      dParen -= 1;
    } else if (ch === 123) dBrace += 1;
    else if (ch === 125) dBrace -= 1;
    else if (ch === 91) dBrack += 1;
    else if (ch === 93) dBrack -= 1;
    else if (ch === 44 && dParen === 0 && dBrace === 0 && dBrack === 0) {
      out.push(str.slice(argStart, i).trim());
      argStart = i + 1;
    }
    i += 1;
  }
  return null;
}

function unquoteSimple(raw) {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    // Ensure it is a single string literal, not `"a" + "b"`.
    const q = raw.charCodeAt(0);
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw.charCodeAt(i);
      if (c === 92) {
        i += 1;
        continue;
      }
      if (c === q) return null;
    }
    return decodeJsString(raw.slice(1, -1));
  }
  return null;
}

function scanReact(source) {
  const react = detectReactName(source);
  const jsxExact = new Set();
  const jsxTemplates = new Set();
  const jsxInline = new Set();
  if (!react) return { jsxExact, jsxTemplates, jsxInline };

  const prefix = `${react}.createElement(`;
  const elTagRe = new RegExp(`^${react}\\.createElement\\((?:"([a-z0-9-]+)"|'([a-z0-9-]+)'|([A-Za-z_$][\\w$]*))`);
  const propRe = /(?:["']([a-zA-Z0-9-]+)["']|([a-zA-Z_$][\w$]*))\s*:\s*(?:"((?:[^"\\\n]|\\.){2,500})"|'((?:[^'\\\n]|\\.){2,500})')/g;

  for (let at = source.indexOf(prefix); at !== -1; at = source.indexOf(prefix, at + prefix.length)) {
    const callArgs = splitCallArgs(source, at + prefix.length);
    if (!callArgs || callArgs.length < 2) continue;
    const tag = unquoteSimple(callArgs[0]);
    const propsRaw = callArgs[1];

    // 1. Extract visible props/attributes
    if (propsRaw && propsRaw.startsWith('{')) {
      for (const m of propsRaw.matchAll(propRe)) {
        const propName = m[1] || m[2];
        if (!UI_PROP_NAMES.has(propName)) continue;
        const val = normSpace(decodeJsString(m[3] ?? m[4] ?? ''));
        if (looksHuman(val, true)) jsxExact.add(val);
      }
    }

    if (callArgs.length < 3 || !tag) continue;
    const children = callArgs.slice(2);
    const items = children.map((c) => {
      const str = unquoteSimple(c);
      if (str !== null) return { kind: 'str', text: str };
      if (c.startsWith(prefix)) {
        const m = elTagRe.exec(c);
        return { kind: 'el', tag: m ? m[1] || m[2] || m[3] : '?' };
      }
      if (c.includes(prefix)) return { kind: 'condEl' };
      return { kind: 'expr', raw: c };
    });

    // 2. Single-child static string
    if (items.length === 1 && items[0].kind === 'str') {
      const s = normSpace(items[0].text);
      if (looksHuman(s, true)) jsxExact.add(s);
      continue;
    }

    // 3. Inline-element split sentence (1..3 inline HTML elements, no other element types)
    const elItems = items.filter((x) => x.kind === 'el' || x.kind === 'condEl');
    const exprItems = items.filter((x) => x.kind === 'expr');
    if (elItems.length >= 1 && elItems.length <= 3 && exprItems.length === 0 && elItems.every((x) => x.kind === 'el' && INLINE_HTML_TAGS.has(x.tag))) {
      let slot = 0;
      let tpl = '';
      let hasLetter = false;
      for (const it of items) {
        if (it.kind === 'str') {
          tpl += it.text;
          if (/[A-Za-z]/.test(it.text)) hasLetter = true;
        } else {
          tpl += `{${++slot}}`;
        }
      }
      const normalized = normSpace(tpl);
      if (hasLetter && normalized.length <= MAX_CHARS && looksHuman(normalized.replace(/\{\d+\}/g, 'X'), true)) {
        jsxInline.add(normalized);
      }
    }

    // 4. Maximal contiguous runs of text + expr children (covers both pure textGroup and Icon + text runs!)
    let run = [];
    const flushRun = () => {
      if (run.length === 0) return;
      const hasStrWithLetter = run.some((x) => x.kind === 'str' && /[A-Za-z]/.test(x.text));
      const hasExpr = run.some((x) => x.kind === 'expr');
      if (hasStrWithLetter && hasExpr) {
        let n = 0;
        const tpl = normSpace(run.map((x) => (x.kind === 'str' ? x.text : `{${++n}}`)).join(''));
        if (looksHuman(tpl.replace(/\{\d+\}/g, 'X'), true)) jsxTemplates.add(tpl);
      } else if (hasStrWithLetter && !hasExpr) {
        const joined = normSpace(run.map((x) => x.text).join(''));
        if (looksHuman(joined, true)) jsxExact.add(joined);
      }
      run = [];
    };
    for (const it of items) {
      if (it.kind === 'str' || it.kind === 'expr') run.push(it);
      else flushRun();
    }
    flushRun();
  }
  return { jsxExact, jsxTemplates, jsxInline };
}

// ---- --audit mode (dictionary health check) ---------------------------------------------

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
      const close = source.indexOf('}', i);
      if (close !== -1) i = close;
      end();
    } else if (ch === '|' && depth === 0) {
      return '';
    } else if (depth > 0 || !/[A-Za-z ]/.test(ch)) {
      end();
    } else if (/[?*+{]/.test(source[i + 1] || '')) {
      end();
    } else {
      run += ch;
    }
  }
  end();
  return best;
}

function synthesizeSample(src) {
  const s = src.slice(1, -1);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      const next = s[i + 1] || '';
      if (next === 'd') out += '42';
      else if (next === 's') out += ' ';
      else if (next === 'w') out += 'x';
      else out += next;
      i += 2;
      if (s[i] === '+' || s[i] === '*') {
        i += 1;
        if (s[i] === '?') i += 1;
      } else if (s[i] === '?') {
        i += 1;
      }
      continue;
    }
    if (ch === '(') {
      let d = 1;
      let j = i + 1;
      let inC = false;
      while (j < s.length && d > 0) {
        if (s[j] === '\\') j += 2;
        else if (inC) {
          if (s[j] === ']') inC = false;
          j += 1;
        } else if (s[j] === '[') {
          inC = true;
          j += 1;
        } else if (s[j] === '(') {
          d += 1;
          j += 1;
        } else if (s[j] === ')') {
          d -= 1;
          j += 1;
        } else j += 1;
      }
      const inner = s.slice(i + 1, j - 1);
      const opt = s[j] === '?';
      const body = inner.startsWith('?:') ? inner.slice(2) : inner;
      if (body.includes('|')) out += body.split('|')[0].replace(/\\(.)/g, '$1');
      else if (/\\d|\[0-9\]/.test(body)) out += '42';
      else if (/^\.\+\??$|^\.\*\??$|^\[\^/.test(body)) out += 'foo';
      else out += body.replace(/\\d[+*]?/g, '42').replace(/\.\+\??/g, 'foo').replace(/\\(.)/g, '$1');
      i = j + (opt ? 1 : 0);
      continue;
    }
    if (ch === '[') {
      let j = i + 1;
      while (j < s.length && s[j] !== ']') {
        if (s[j] === '\\') j += 1;
        j += 1;
      }
      const cls = s.slice(i + 1, j);
      out += cls.includes('0-9') ? '4' : cls.includes('A-Z') ? 'A' : cls.includes('a-z') ? 'a' : cls[0] || 'x';
      i = j + 1;
      if (s[i] === '+' || s[i] === '*') {
        i += 1;
        if (s[i] === '?') i += 1;
      } else if (s[i] === '?') i += 1;
      continue;
    }
    if (s[i + 1] === '?') {
      out += ch;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function runAudit() {
  const report = {
    validDictionary: isDictionary({
      exact: words.exact,
      patterns: words.patterns,
      ...(words.inline !== undefined ? { inline: words.inline } : {}),
    }),
    counts: {
      exact: Object.keys(words.exact || {}).length,
      patterns: (words.patterns || []).length,
      inline: words.inline ? Object.keys(words.inline).length : 0,
    },
    unsafePatterns: [],
    chineseInPatternRegex: [],
    forbiddenWords: [],
    unnormalizedWhitespacePatterns: [],
    emptyFixedPartPatterns: [],
    duplicatePatterns: [],
    shadowedPatterns: [],
  };

  for (const [k, v] of Object.entries(words.exact || {})) {
    if (/智能体|您/.test(v)) report.forbiddenWords.push({ section: 'exact', key: k, value: v });
  }
  for (const [k, v] of Object.entries(words.inline || {})) {
    if (/智能体|您/.test(v)) report.forbiddenWords.push({ section: 'inline', key: k, value: v });
  }

  const seenSrc = new Map();
  const taggedPatterns = (words.patterns || []).map((row, index) => [row[0], `__PAT_${index}__`]);
  const tagLookup = l10nFactory({ exact: {}, patterns: taggedPatterns }).lookup;

  (words.patterns || []).forEach(([src, to], index) => {
    if (!isSafePattern(src)) report.unsafePatterns.push({ index, src });
    if (/[\u4e00-\u9fff]/.test(src)) report.chineseInPatternRegex.push({ index, src, to });
    if (/智能体|您/.test(src) || /智能体|您/.test(to)) report.forbiddenWords.push({ section: 'patterns', index, src, to });
    if (/\\s/.test(src)) report.unnormalizedWhitespacePatterns.push({ index, src });
    if (fixedPart(src) === '') report.emptyFixedPartPatterns.push({ index, src, to });
    if (seenSrc.has(src)) report.duplicatePatterns.push({ index, duplicateOf: seenSrc.get(src), src });
    else seenSrc.set(src, index);

    try {
      const re = new RegExp(src);
      const sample = synthesizeSample(src);
      if (re.test(sample)) {
        const won = tagLookup(sample);
        if (won !== `__PAT_${index}__`) {
          const m = /^__PAT_(\d+)__$/.exec(won || '');
          report.shadowedPatterns.push({
            index,
            src,
            sample,
            winnerIndex: m ? Number(m[1]) : null,
            winnerSrc: m ? words.patterns[Number(m[1])][0] : null,
          });
        }
      }
    } catch {
      // Reported under unsafePatterns.
    }
  });

  if (modeJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Dictionary valid: ${report.validDictionary}`);
    console.log(`Counts: exact=${report.counts.exact}, patterns=${report.counts.patterns}, inline=${report.counts.inline}`);
    console.log(`Unsafe patterns (isSafePattern=false): ${report.unsafePatterns.length}`);
    for (const x of report.unsafePatterns) console.log(`  [#${x.index}] ${x.src}`);
    console.log(`Chinese chars in pattern regex: ${report.chineseInPatternRegex.length}`);
    for (const x of report.chineseInPatternRegex) console.log(`  [#${x.index}] ${x.src}`);
    console.log(`Forbidden words (智能体/您): ${report.forbiddenWords.length}`);
    for (const x of report.forbiddenWords) console.log(`  [${x.section}${x.index !== undefined ? '#' + x.index : ''}] ${x.key || x.src} -> ${x.value || x.to}`);
    console.log(`Patterns with \\s: ${report.unnormalizedWhitespacePatterns.length}`);
    console.log(`Empty fixedPart patterns: ${report.emptyFixedPartPatterns.length}`);
    for (const x of report.emptyFixedPartPatterns) console.log(`  [#${x.index}] ${x.src}`);
    console.log(`Duplicate patterns: ${report.duplicatePatterns.length}`);
    console.log(`Shadowed patterns (on synthesized sample): ${report.shadowedPatterns.length}`);
    for (const x of report.shadowedPatterns.slice(0, 30)) {
      console.log(`  [#${x.index}] ${x.src}  <- shadowed by [#${x.winnerIndex}] ${x.winnerSrc}`);
    }
    if (report.shadowedPatterns.length > 30) console.log(`  ... and ${report.shadowedPatterns.length - 30} more`);
  }

  const hardIssues =
    (!report.validDictionary ? 1 : 0) +
    report.unsafePatterns.length +
    report.chineseInPatternRegex.length +
    report.forbiddenWords.length +
    report.emptyFixedPartPatterns.length +
    report.duplicatePatterns.length +
    report.shadowedPatterns.length;
  if (modeStrict && hardIssues > 0) process.exit(1);
}

if (modeAudit) {
  runAudit();
  process.exit(0);
}

// ---- main.js extraction modes -----------------------------------------------------------

const bundle = findUiBundle(path.join(appPath, 'Contents', 'Resources', 'bin', 'language_server'));
const source = readBundleFile(bundle, 'main.js').toString('utf8');

const { strings, templates } = scanLiterals(source);
const { jsxExact, jsxTemplates, jsxInline } = scanReact(source);

const allExact = new Set([...strings, ...jsxExact]);
const allTemplates = new Set([...templates, ...jsxTemplates]);

if (modeInline) {
  const inlineDict = words.inline || {};
  const inlineNorm = new Set(Object.keys(inlineDict).map(normPunct));
  const missingInline = [...jsxInline].filter((t) => !Object.prototype.hasOwnProperty.call(inlineDict, t) && !inlineNorm.has(normPunct(t))).sort();
  if (modeJson) console.log(JSON.stringify({ total: jsxInline.size, missing: missingInline }, null, 2));
  else console.log(missingInline.join('\n'));
  console.error(`${jsxInline.size} inline candidates, ${jsxInline.size - missingInline.length} translated, ${missingInline.length} not translated`);
  process.exit(0);
}

if (modeMismatches) {
  const exactKeys = Object.keys(words.exact || {});
  const byLower = new Map();
  const byBare = new Map();
  for (const k of exactKeys) {
    const lk = normPunct(k).toLowerCase();
    if (!byLower.has(lk)) byLower.set(lk, k);
    const bare = lk.replace(/[.…:!?]+$/, '');
    if (bare.length >= 2 && !byBare.has(bare)) byBare.set(bare, k);
  }
  const mismatches = [];
  for (const text of [...allExact].sort()) {
    if (lookup(text) !== null) continue;
    const nk = normPunct(text);
    const lk = nk.toLowerCase();
    const bare = lk.replace(/[.…:!?]+$/, '');
    if (byLower.has(lk)) {
      mismatches.push({ kind: 'case', text, existingKey: byLower.get(lk), existingZh: words.exact[byLower.get(lk)] });
    } else if (byBare.has(bare)) {
      mismatches.push({ kind: 'trailing_punct', text, existingKey: byBare.get(bare), existingZh: words.exact[byBare.get(bare)] });
    }
  }
  if (modeJson) console.log(JSON.stringify(mismatches, null, 2));
  else {
    for (const m of mismatches) console.log(`[${m.kind}] ${JSON.stringify(m.text)}  <=>  ${JSON.stringify(m.existingKey)} (${m.existingZh})`);
  }
  console.error(`${mismatches.length} near-miss candidates`);
  process.exit(0);
}

const missingExact = [...allExact].filter((text) => lookup(text) === null);
const missingTemplates = [...allTemplates].filter((text) => !isTemplateTranslated(text));
const missing = [...new Set([...missingExact, ...missingTemplates])].sort();
const totalCandidates = allExact.size + allTemplates.size;
const translatedCount = totalCandidates - missingExact.length - missingTemplates.length;

if (modeJson) {
  console.log(JSON.stringify({ exact: missingExact.sort(), templates: missingTemplates.sort() }, null, 2));
} else {
  console.log(missing.join('\n'));
}
console.error(
  `${totalCandidates} candidates (${allExact.size} exact, ${allTemplates.size} templates), ${translatedCount} translated, ${missing.length} not translated`
);
