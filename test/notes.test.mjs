import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isValidFlagName } from '../src/patch.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', name), 'utf8'));

test('every flag note has a known group, a basis and a text in both languages', () => {
  const notes = read('flag-notes.json');
  // The page compares this with the version of the installed client.
  assert.match(notes.checked, /^\d+\.\d+\.\d+$/);
  const ids = notes.groups.map((group) => group.id);
  assert.equal(new Set(ids).size, ids.length, 'group ids are unique');
  for (const group of notes.groups) {
    assert.match(group.id, /^[a-z]+$/);
    assert.ok(group.title.zh && group.title.en, group.id);
  }
  for (const [name, note] of Object.entries(notes.flags)) {
    assert.ok(isValidFlagName(name), name);
    assert.ok(ids.includes(note.group), `${name}: group ${note.group}`);
    assert.ok(['code', 'name'].includes(note.basis), `${name}: basis`);
    assert.ok(note.hide === undefined || ['internal', 'noEffect'].includes(note.hide), `${name}: hide`);
    assert.ok(note.keep === undefined || (note.keep === true && note.hide === undefined), `${name}: keep`);
    assert.ok(typeof note.text?.zh === 'string' && note.text.zh.trim(), `${name}: zh`);
    assert.ok(typeof note.text?.en === 'string' && note.text.en.trim(), `${name}: en`);
  }
});

test('every flag of a curated feature has a note and is not hidden', () => {
  const notes = read('flag-notes.json');
  for (const group of read('catalog.json').groups) {
    for (const name of [...(group.flags || []), ...(group.params || []).map((p) => p.flag)]) {
      // Without a note the flag would be alone in the group "Other (no description yet)".
      assert.ok(Object.hasOwn(notes.flags, name), `${name} (${group.id}): no note`);
      assert.equal(notes.flags[name].hide, undefined, `${name} (${group.id})`);
    }
  }
});
