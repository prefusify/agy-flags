// Which flag names the installed desktop app contains.
//
// The client can react only to a flag that one of its programs mentions by name. A flag that
// no program of the app contains changes nothing in the app, so the page leaves it out. The
// programs are only read, never written.
//
// Generated code can spell a name in another way (enable_foo, EnableFoo, enableFoo,
// ENABLE_FOO). Every spelling counts: a flag is left out only when no spelling is found.

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { readBundleFile } from './bundle.mjs';

const CHUNK = 8 * 1024 * 1024;
const PAGE_FILE_RE = /\.(?:m?js|html)$/;
/**
 * From this many names on, a part of the app that contains none of them was read wrongly.
 * With fewer names that is normal: the name of a page feature is in the page script only.
 */
export const MIN_NAMES_FOR_CHECK = 50;

/** The spellings of one flag name that are searched for. */
export function nameVariants(name) {
  const out = new Set([name.toUpperCase().replaceAll('-', '_')]);
  // A name with capital letters is searched for in lower case too: code can spell
  // CASCADE_FOO_BAR as cascade_foo_bar or CascadeFooBar.
  for (const text of new Set([name, name.toLowerCase()])) {
    out.add(text);
    out.add(text.replaceAll('-', '_'));
    out.add(text.replaceAll('_', '-'));
    const parts = text.split(/[-_]+/).filter(Boolean);
    if (parts.length > 1) {
      const cap = (part) => part.charAt(0).toUpperCase() + part.slice(1);
      out.add(parts[0].charAt(0).toLowerCase() + parts[0].slice(1) + parts.slice(1).map(cap).join(''));
      out.add(parts.map(cap).join(''));
    }
  }
  return [...out];
}

/**
 * Search for many byte strings at once, in one pass (Aho-Corasick). Give a file to feed() in
 * pieces, one after another; call reset() before the next file.
 * @param {string[]} patterns
 */
export function createMatcher(patterns) {
  const encoded = patterns.map((p) => Buffer.from(p, 'utf8'));
  // Every byte that occurs in a pattern gets a class of its own. All other bytes share class 0.
  const classOf = new Uint8Array(256);
  let classes = 1;
  for (const bytes of encoded) for (const b of bytes) if (classOf[b] === 0) classOf[b] = classes++;

  const children = [new Map()];
  const ends = [[]];
  encoded.forEach((bytes, id) => {
    if (bytes.length === 0) return;
    let s = 0;
    for (const b of bytes) {
      let next = children[s].get(classOf[b]);
      if (next === undefined) {
        next = children.length;
        children.push(new Map());
        ends.push([]);
        children[s].set(classOf[b], next);
      }
      s = next;
    }
    ends[s].push(id);
  });

  const count = children.length;
  const delta = new Int32Array(count * classes);
  const fail = new Int32Array(count);
  // out[s]: the nearest state on the failure chain of s (s included) where a pattern ends, or -1.
  const out = new Int32Array(count).fill(-1);
  const queue = [];
  for (let c = 0; c < classes; c += 1) {
    const s = children[0].get(c);
    if (s !== undefined) {
      delta[c] = s;
      queue.push(s);
    }
  }
  for (let qi = 0; qi < queue.length; qi += 1) {
    const s = queue[qi];
    out[s] = ends[s].length > 0 ? s : out[fail[s]];
    for (let c = 0; c < classes; c += 1) {
      const t = children[s].get(c);
      const viaFail = delta[fail[s] * classes + c];
      if (t === undefined) {
        delta[s * classes + c] = viaFail;
      } else {
        fail[t] = viaFail;
        delta[s * classes + c] = t;
        queue.push(t);
      }
    }
  }

  const found = new Uint8Array(encoded.length);
  // A state whose chain was reported once need not be walked again.
  const reported = new Uint8Array(count);
  let state = 0;
  return {
    reset() {
      state = 0;
    },
    /** @param {Uint8Array} buffer */
    feed(buffer) {
      let s = state;
      for (let i = 0; i < buffer.length; i += 1) {
        s = delta[s * classes + classOf[buffer[i]]];
        let t = out[s];
        while (t !== -1 && reported[t] === 0) {
          reported[t] = 1;
          for (const id of ends[t]) found[id] = 1;
          t = out[fail[t]];
        }
      }
      state = s;
    },
    /** @returns {boolean} */
    has(id) {
      return found[id] === 1;
    },
  };
}

/** Every file below `dir`, in a fixed order. A link to a folder is not followed. */
function filesBelow(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...filesBelow(file));
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(file);
    } catch (err) {
      // A link that points nowhere is not a file of the app.
      if (entry.isSymbolicLink() && err?.code === 'ENOENT') continue;
      throw err;
    }
    if (stat.isFile()) out.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return out;
}

/**
 * The programs of the app that are searched, with what identifies their content: every file
 * in Contents/Resources/bin, Contents/Resources/app.asar, and every file below
 * Contents/Resources/app.asar.unpacked (the files of the main process that are kept outside
 * app.asar). Throws when the language server or app.asar is missing; an app without
 * app.asar.unpacked is complete.
 * @returns {{ file: string, size: number, mtimeMs: number }[]}
 */
export function clientFiles(appPath) {
  const resources = path.join(appPath, 'Contents', 'Resources');
  const bin = path.join(resources, 'bin');
  const out = [];
  for (const name of fs.readdirSync(bin).sort()) {
    const stat = fs.statSync(path.join(bin, name));
    if (stat.isFile()) out.push({ file: path.join(bin, name), size: stat.size, mtimeMs: stat.mtimeMs });
  }
  if (!out.some((entry) => path.basename(entry.file) === 'language_server')) throw new Error('no language_server in the app');
  const asar = path.join(resources, 'app.asar');
  const stat = fs.statSync(asar);
  if (!stat.isFile()) throw new Error('app.asar is not a file');
  out.push({ file: asar, size: stat.size, mtimeMs: stat.mtimeMs });
  const unpacked = `${asar}.unpacked`;
  if (fs.existsSync(unpacked)) out.push(...filesBelow(unpacked));
  return out;
}

const pause = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Find which of `names` the app contains: in its programs, and in the page files that the
 * language server carries (they are compressed there, so they are unpacked and read one by one).
 *
 * Any part that cannot be read makes the whole search fail: a partial answer would leave out
 * flags that the unread part uses. With a long list of names (MIN_NAMES_FOR_CHECK or more),
 * the search also fails when the page files or the programs contain none of them, because
 * then the wrong files were read. A short list is not checked in this way: it is normal that
 * one part contains none of a few names.
 *
 * @param {object} options
 * @param {string} options.appPath
 * @param {string[]} options.names
 * @param {() => { entries: Map<string, object> }} options.getBundle The page archive (see bundle.mjs).
 * @param {() => boolean} [options.stopped] Checked between pieces; the search then gives up.
 * @returns {Promise<{ used: Set<string>, files: number }>}
 */
export async function scanClient({ appPath, names, getBundle, stopped = () => false }) {
  const files = clientFiles(appPath);
  const bundle = getBundle();
  const pageFiles = [...bundle.entries.keys()].filter((name) => PAGE_FILE_RE.test(name)).sort();
  if (!pageFiles.includes('main.js')) throw new Error('the page archive has no main.js');

  const patterns = [];
  const owners = [];
  const idOf = new Map();
  for (const name of names) {
    for (const spelling of nameVariants(name)) {
      let id = idOf.get(spelling);
      if (id === undefined) {
        id = patterns.length;
        idOf.set(spelling, id);
        patterns.push(spelling);
        owners.push([]);
      }
      owners[id].push(name);
    }
  }
  const usedBy = (matcher) => {
    const used = new Set();
    patterns.forEach((_, id) => {
      if (matcher.has(id)) for (const name of owners[id]) used.add(name);
    });
    return used;
  };
  const check = () => {
    if (stopped()) throw new Error('stopped');
  };

  const inPage = createMatcher(patterns);
  for (const name of pageFiles) {
    const data = readBundleFile(bundle, name);
    if (data === null) throw new Error(`${name}: missing from the page archive`);
    inPage.reset();
    for (let at = 0; at < data.length; at += CHUNK) {
      inPage.feed(data.subarray(at, at + CHUNK));
      await pause();
      check();
    }
  }

  const inPrograms = createMatcher(patterns);
  const buffer = Buffer.alloc(CHUNK);
  for (const entry of files) {
    const handle = await fs.promises.open(entry.file, 'r');
    try {
      inPrograms.reset();
      let position = 0;
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, CHUNK, position);
        if (bytesRead === 0) break;
        inPrograms.feed(buffer.subarray(0, bytesRead));
        position += bytesRead;
        await pause();
        check();
      }
      const stat = await handle.stat();
      if (position !== entry.size || stat.size !== entry.size || stat.mtimeMs !== entry.mtimeMs) {
        throw new Error(`${path.basename(entry.file)} changed while it was read`);
      }
    } finally {
      await handle.close();
    }
  }

  const pageUsed = usedBy(inPage);
  const programUsed = usedBy(inPrograms);
  if (names.length >= MIN_NAMES_FOR_CHECK) {
    if (pageUsed.size === 0) throw new Error('the page files contain none of the flag names');
    if (programUsed.size === 0) throw new Error('the programs contain none of the flag names');
  }
  return { used: new Set([...pageUsed, ...programUsed]), files: files.length + pageFiles.length };
}

/**
 * The same search as scanClient(), in a thread of its own. The search reads a few hundred
 * megabytes and builds a large table; in the calling thread it would hold up everything else
 * for a moment, again and again. The thread finds the page archive by itself.
 *
 * @param {object} options
 * @param {string} options.appPath
 * @param {string[]} options.names
 * @returns {{ result: Promise<{ used: Set<string>, files: number }>, cancel: () => void }}
 *          `result` rejects with the error of the search, or with "stopped" after cancel().
 */
export function scanClientInWorker({ appPath, names }) {
  const worker = new Worker(new URL('./usage-worker.mjs', import.meta.url), { workerData: { appPath, names } });
  let cancelled = false;
  const result = new Promise((resolve, reject) => {
    // The first of the three events decides; a promise ignores what comes after it.
    worker.once('message', (message) => {
      if (message?.ok) resolve({ used: new Set(message.used), files: message.files });
      else reject(new Error(message?.error || 'the search failed'));
    });
    worker.once('error', (err) => reject(err));
    worker.once('exit', (code) => reject(new Error(cancelled ? 'stopped' : `the search thread ended early (code ${code})`)));
  });
  return {
    result,
    cancel() {
      cancelled = true;
      worker.terminate();
    },
  };
}
