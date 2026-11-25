import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { findUiBundle } from '../src/bundle.mjs';
import { MIN_NAMES_FOR_CHECK, createMatcher, nameVariants, scanClient, scanClientInWorker } from '../src/usage.mjs';
import { fakeApp, tempHome } from './helpers.mjs';

test('every spelling that generated code uses is searched for', () => {
  assert.deepEqual(
    new Set(nameVariants('enable-foo-bar')),
    new Set(['enable-foo-bar', 'enable_foo_bar', 'ENABLE_FOO_BAR', 'enableFooBar', 'EnableFooBar'])
  );
  assert.deepEqual(
    new Set(nameVariants('max_injected_skills')),
    new Set(['max_injected_skills', 'max-injected-skills', 'MAX_INJECTED_SKILLS', 'maxInjectedSkills', 'MaxInjectedSkills'])
  );
  assert.deepEqual(new Set(nameVariants('x')), new Set(['x', 'X']));
});

test('a name with capital letters is searched for in lower case too', () => {
  const upper = nameVariants('CASCADE_FOO_BAR');
  for (const spelling of ['CASCADE_FOO_BAR', 'cascade_foo_bar', 'cascade-foo-bar', 'cascadeFooBar', 'CascadeFooBar']) {
    assert.ok(upper.includes(spelling), spelling);
  }
  const mixed = nameVariants('Chat__enable_foo');
  for (const spelling of ['Chat__enable_foo', 'chat__enable_foo', 'CHAT__ENABLE_FOO', 'chatEnableFoo', 'ChatEnableFoo']) {
    assert.ok(mixed.includes(spelling), spelling);
  }
});

test('the matcher finds overlapping patterns, also across the pieces of one file', () => {
  const patterns = ['he', 'she', 'his', 'hers', 'enable-a', 'enable-ab'];
  const text = Buffer.from('ushers and enable-ab');
  for (let cut = 0; cut <= text.length; cut += 1) {
    const m = createMatcher(patterns);
    m.feed(text.subarray(0, cut));
    m.feed(text.subarray(cut));
    assert.deepEqual(
      patterns.filter((_, id) => m.has(id)),
      ['he', 'she', 'hers', 'enable-a', 'enable-ab'],
      `cut at ${cut}`
    );
  }
});

test('a pattern split over two files is not found', () => {
  const m = createMatcher(['enable-x']);
  m.feed(Buffer.from('... enable'));
  m.reset();
  m.feed(Buffer.from('-x ...'));
  assert.equal(m.has(0), false);
});

function setupApp(t, options = {}) {
  const dir = tempHome();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const page = options.page ?? 'var f={pdf:{customFlag:"page-only-flag"}};'.repeat(50);
  const appPath = fakeApp(
    dir,
    [
      { name: 'index.html', data: Buffer.from('<!doctype html><script src="/main.js"></script>') },
      { name: 'main.js', data: Buffer.from(page) },
      { name: 'icons/a.svg', data: Buffer.from('<svg>svg-only-flag</svg>') },
    ],
    { serverText: 'server-flag\u0000', asar: 'main process: asar-flag', programs: { helper: 'xx EnableVariantFlag xx' }, ...options.app }
  );
  const getBundle = () => findUiBundle(path.join(appPath, 'Contents', 'Resources', 'bin', 'language_server'));
  return { appPath, getBundle };
}

test('the app is searched in its programs, in app.asar and in the unpacked page files', async (t) => {
  const { appPath, getBundle } = setupApp(t);
  // The page script is compressed inside the language server: only unpacking finds its names.
  const raw = fs.readFileSync(path.join(appPath, 'Contents', 'Resources', 'bin', 'language_server'));
  assert.equal(raw.includes('page-only-flag'), false);
  assert.equal(raw.includes('svg-only-flag'), false);

  const names = ['page-only-flag', 'server-flag', 'asar-flag', 'enable-variant-flag', 'svg-only-flag', 'missing-flag'];
  const result = await scanClient({ appPath, names, getBundle });
  // Icons are not searched: only scripts and pages can read a flag.
  assert.deepEqual([...result.used].sort(), ['asar-flag', 'enable-variant-flag', 'page-only-flag', 'server-flag']);
  assert.equal(result.files, 5);
});

test('the files next to app.asar that are not packed into it are searched too', async (t) => {
  const { appPath, getBundle } = setupApp(t, {
    app: { unpacked: { 'node_modules/tool/build/index.js': 'if (flags["unpacked-flag"]) run();', 'node_modules/tool/LICENSE': 'text' } },
  });
  // A link to a folder is not followed: the search must not run in a circle.
  const unpackedDir = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked');
  fs.symlinkSync(unpackedDir, path.join(unpackedDir, 'node_modules', 'loop'));
  // A link that points nowhere is not a file of the app, and does not make the search fail.
  fs.symlinkSync(path.join(unpackedDir, 'no-such-file'), path.join(unpackedDir, 'node_modules', 'dead'));
  const result = await scanClient({ appPath, names: ['unpacked-flag', 'missing-flag'], getBundle });
  assert.deepEqual([...result.used], ['unpacked-flag']);
  assert.equal(result.files, 7);
});

test('a part that cannot be read makes the whole search fail', async (t) => {
  const names = ['page-only-flag', 'server-flag'];

  const noAsar = setupApp(t, { app: { asar: null } });
  await assert.rejects(scanClient({ ...noAsar, names }), /app\.asar|ENOENT/);

  const brokenPage = setupApp(t);
  await assert.rejects(
    scanClient({ ...brokenPage, names, getBundle: () => { throw new Error('no page archive in the language server program'); } }),
    /no page archive/
  );

  const stopped = setupApp(t);
  await assert.rejects(scanClient({ ...stopped, names, stopped: () => true }), /stopped/);
});

test('with a long list of names, a part that contains none of them makes the search fail', async (t) => {
  // Then the wrong files were read. The list is as long as a server list makes it.
  const names = ['page-only-flag', 'server-flag', ...Array.from({ length: MIN_NAMES_FOR_CHECK }, (_, i) => `filler-flag-${i}`)];

  const emptyPage = setupApp(t, { page: 'console.log(1);' });
  await assert.rejects(scanClient({ ...emptyPage, names }), /page files contain none/);

  const emptyPrograms = setupApp(t, { app: { serverText: '', asar: 'asar', programs: {} } });
  await assert.rejects(scanClient({ ...emptyPrograms, names }), /programs contain none/);
});

test('a short list of names is searched without that check', async (t) => {
  // Before the server list was seen, the names are the few overrides. It is normal that the
  // name of a page feature is in the page script only, and another name in a program only.
  const app = setupApp(t);
  const pageOnly = await scanClient({ ...app, names: ['page-only-flag', 'missing-flag'] });
  assert.deepEqual([...pageOnly.used], ['page-only-flag']);
  const programOnly = await scanClient({ ...app, names: ['server-flag'] });
  assert.deepEqual([...programOnly.used], ['server-flag']);
  const nowhere = await scanClient({ ...app, names: ['missing-flag'] });
  assert.deepEqual([...nowhere.used], []);
});

test('the search in a thread of its own gives the same answer, passes an error on, and can be cancelled', async (t) => {
  const { appPath, getBundle } = setupApp(t);
  const names = ['page-only-flag', 'server-flag', 'asar-flag', 'enable-variant-flag', 'missing-flag'];
  const direct = await scanClient({ appPath, names, getBundle });
  const threaded = await scanClientInWorker({ appPath, names }).result;
  assert.deepEqual([...threaded.used].sort(), [...direct.used].sort());
  assert.equal(threaded.files, direct.files);

  const noAsar = setupApp(t, { app: { asar: null } });
  await assert.rejects(scanClientInWorker({ appPath: noAsar.appPath, names }).result, /app\.asar|ENOENT/);

  const scan = scanClientInWorker({ appPath, names });
  scan.cancel();
  await assert.rejects(scan.result, /stopped/);
});
