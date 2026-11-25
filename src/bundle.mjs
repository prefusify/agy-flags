// Reads the files of Antigravity's own page out of the language server program.
//
// The language server carries its page (index.html, main.js, style sheets, icons, sounds)
// as a ZIP archive inside the executable. This module finds that archive and reads single
// files from it. The executable is only read, never written.
//
// Only what is needed is implemented: one disk, no ZIP64, no encryption, stored (0) and
// deflated (8) entries. Anything else is refused.

import fs from 'node:fs';
import zlib from 'node:zlib';

const END_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const CHUNK = 16 * 1024 * 1024;
/** No file of the page is larger than this. A larger entry is refused. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = fs.readSync(fd, buffer, done, length - done, position + done);
    if (n === 0) break;
    done += n;
  }
  return done === length ? buffer : buffer.subarray(0, done);
}

/** Every position in the file where an end-of-archive record may start. */
function endRecordCandidates(fd, size) {
  const out = [];
  let position = 0;
  while (position < size) {
    // Overlap the chunks, so that a signature on a boundary is not missed.
    const chunk = readAt(fd, position, Math.min(CHUNK + 3, size - position));
    for (let at = chunk.indexOf(END_SIGNATURE); at !== -1; at = chunk.indexOf(END_SIGNATURE, at + 1)) {
      const absolute = position + at;
      if (out[out.length - 1] !== absolute) out.push(absolute);
    }
    position += CHUNK;
  }
  return out;
}

/** Parse one archive whose end record is at `endAt`. Returns null when it is not a usable archive. */
function readArchive(fd, size, endAt) {
  if (endAt + 22 > size) return null;
  const end = readAt(fd, endAt, 22);
  if (end.length < 22) return null;
  const disk = end.readUInt16LE(4);
  const directoryDisk = end.readUInt16LE(6);
  const countHere = end.readUInt16LE(8);
  const count = end.readUInt16LE(10);
  const directorySize = end.readUInt32LE(12);
  const directoryOffset = end.readUInt32LE(16);
  if (disk !== 0 || directoryDisk !== 0 || count === 0 || count !== countHere) return null;
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return null; // ZIP64
  const directoryAt = endAt - directorySize;
  // The archive sits somewhere inside the executable; its own offsets count from its start.
  const start = directoryAt - directoryOffset;
  if (start < 0 || directorySize < 46 || directorySize > 64 * 1024 * 1024) return null;
  const directory = readAt(fd, directoryAt, directorySize);
  if (directory.length < directorySize) return null;

  const entries = new Map();
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL_SIGNATURE) return null;
    const flags = directory.readUInt16LE(at + 8);
    const method = directory.readUInt16LE(at + 10);
    const compressedSize = directory.readUInt32LE(at + 20);
    const uncompressedSize = directory.readUInt32LE(at + 24);
    const nameLength = directory.readUInt16LE(at + 28);
    const extraLength = directory.readUInt16LE(at + 30);
    const commentLength = directory.readUInt16LE(at + 32);
    const localOffset = directory.readUInt32LE(at + 42);
    const name = directory.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    entries.set(name, { name, method, flags, compressedSize, uncompressedSize, at: start + localOffset });
  }
  return { start, entries };
}

/**
 * Find the archive that holds the page.
 * @returns {{ file: string, size: number, mtimeMs: number, entries: Map<string, object> }}
 * Throws when the executable has no such archive.
 */
export function findUiBundle(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    for (const endAt of endRecordCandidates(fd, stat.size)) {
      const archive = readArchive(fd, stat.size, endAt);
      if (archive && archive.entries.has('index.html') && archive.entries.has('main.js')) {
        return { file, size: stat.size, mtimeMs: stat.mtimeMs, entries: archive.entries };
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  throw new Error('no page archive in the language server program');
}

/** The content of one file of the page, or null when the page has no such file. */
export function readBundleFile(bundle, name) {
  const entry = bundle.entries.get(name);
  if (!entry) return null;
  if (entry.flags & 0x1) throw new Error(`${name}: encrypted entry`);
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`${name}: unsupported compression ${entry.method}`);
  if (entry.compressedSize > MAX_ENTRY_BYTES || entry.uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`${name}: entry too large`);
  const fd = fs.openSync(bundle.file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (stat.size !== bundle.size || stat.mtimeMs !== bundle.mtimeMs) throw new Error('the language server program changed');
    const header = readAt(fd, entry.at, 30);
    if (header.length < 30 || header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error(`${name}: bad entry header`);
    const dataAt = entry.at + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const raw = readAt(fd, dataAt, entry.compressedSize);
    if (raw.length < entry.compressedSize) throw new Error(`${name}: entry is cut off`);
    const data = entry.method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }) : raw;
    if (data.length !== entry.uncompressedSize) throw new Error(`${name}: wrong size after unpacking`);
    return data;
  } finally {
    fs.closeSync(fd);
  }
}
