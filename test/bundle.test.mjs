import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { findUiBundle, readBundleFile } from '../src/bundle.mjs';
import { makeZip, tempHome } from './helpers.mjs';

function fakeProgram(t, parts) {
  const dir = tempHome();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'language_server');
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

const junk = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251));

test('the page archive is found inside a program that also holds another archive', (t) => {
  const page = makeZip([
    { name: 'index.html', data: Buffer.from('<!doctype html><script src="/main.js"></script>') },
    { name: 'main.js', data: Buffer.from('console.log("hello");'.repeat(500)) },
    { name: 'icons/', data: Buffer.alloc(0), store: true },
    { name: 'icons/a.svg', data: Buffer.from('<svg/>'), store: true },
  ]);
  const other = makeZip([{ name: 'UTC', data: Buffer.from('TZif'), store: true }]);
  // A stray signature in the code must not confuse the search.
  const file = fakeProgram(t, [junk(5000, 1), other, junk(3000, 2), Buffer.from('PK\x05\x06'), junk(777, 3), page, junk(4000, 4)]);

  const bundle = findUiBundle(file);
  assert.deepEqual([...bundle.entries.keys()].sort(), ['icons/a.svg', 'index.html', 'main.js']);
  assert.equal(readBundleFile(bundle, 'index.html').toString('utf8'), '<!doctype html><script src="/main.js"></script>');
  assert.equal(readBundleFile(bundle, 'main.js').toString('utf8'), 'console.log("hello");'.repeat(500));
  assert.equal(readBundleFile(bundle, 'icons/a.svg').toString('utf8'), '<svg/>');
  assert.equal(readBundleFile(bundle, 'missing.js'), null);
  assert.equal(readBundleFile(bundle, '../etc/passwd'), null);
});

test('a program without the page archive is refused', (t) => {
  const other = makeZip([{ name: 'UTC', data: Buffer.from('TZif'), store: true }]);
  assert.throws(() => findUiBundle(fakeProgram(t, [junk(2000, 5), other])), /no page archive/);
  assert.throws(() => findUiBundle(fakeProgram(t, [junk(2000, 6)])), /no page archive/);
});

test('a program that changed after the archive was found is not read with the old positions', (t) => {
  const page = makeZip([
    { name: 'index.html', data: Buffer.from('a') },
    { name: 'main.js', data: Buffer.from('b') },
  ]);
  const file = fakeProgram(t, [junk(100, 7), page]);
  const bundle = findUiBundle(file);
  fs.writeFileSync(file, Buffer.concat([junk(300, 8), page]));
  assert.throws(() => readBundleFile(bundle, 'main.js'), /changed/);
});
