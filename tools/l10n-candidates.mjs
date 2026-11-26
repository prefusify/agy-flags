#!/usr/bin/env node
// Lists the texts in the page script of the installed Antigravity that look like interface
// text and that the word list does not translate yet. For the upkeep of the word list after
// a client update: run it before and after the update and compare the two outputs.
//
//   node tools/l10n-candidates.mjs [path/to/Antigravity.app] > candidates.txt
//
// A text with variable parts is written with {1}, {2} in their place. It reads the client
// and the word list only; it writes nothing but its output.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUiBundle, readBundleFile } from '../src/bundle.mjs';
import { DEFAULT_CONFIG } from '../src/config.mjs';
import { l10nFactory } from '../src/l10n.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appPath = process.argv[2] || DEFAULT_CONFIG.appPath;
const bundle = findUiBundle(path.join(appPath, 'Contents', 'Resources', 'bin', 'language_server'));
const source = readBundleFile(bundle, 'main.js').toString('utf8');
const words = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'l10n', 'zh-CN.json'), 'utf8'));
const { lookup } = l10nFactory({ exact: words.exact, patterns: words.patterns });

// Words and sentences: a capital letter first, ordinary punctuation, a word of small letters somewhere.
const HUMAN = /^[A-Z][A-Za-z0-9 ,.'’\-!?:;()/&%+…“”"#@*<>=[\]_|~$]*$/;
function looksHuman(text) {
  if (text.length < 2 || text.length > 400 || !HUMAN.test(text) || !/[a-z]{2}/.test(text)) return false;
  // A call in code or in a style: rgba(…), var(…), translate(…).
  if (/[a-z]\(/.test(text)) return false;
  // One word that looks like a name in code: fooBar, foo_bar, or a long run of letters.
  if (!text.includes(' ') && (/[a-z][A-Z]/.test(text) || /[_=<>[\]|~$#@*]/.test(text) || text.length > 24)) return false;
  return true;
}

const found = new Set();
for (const match of source.matchAll(/"((?:[^"\\\n]|\\.){2,400})"/g)) {
  let text;
  try {
    text = JSON.parse(`"${match[1]}"`);
  } catch {
    continue;
  }
  if (looksHuman(text)) found.add(text);
}
for (const match of source.matchAll(/`((?:[^`\\]|\\.){2,400})`/g)) {
  if (!match[1].includes('${')) continue;
  let n = 0;
  const text = match[1].replace(/\$\{[^{}]*\}/g, () => `{${++n}}`);
  if (text.includes('${') || text.includes('\n')) continue;
  // The check of a text without its variable parts; the translation with a sample value in each.
  if (looksHuman(text.replace(/\{\d\}/g, 'X')) && lookup(text.replace(/\{\d\}/g, 'Sample')) === null) found.add(text);
}

const missing = [...found].filter((text) => text.includes('{1}') || lookup(text) === null).sort();
console.log(missing.join('\n'));
console.error(`${found.size} candidates, ${found.size - missing.length} translated, ${missing.length} not translated`);
