// Shared helpers for the tests. Nothing here touches launchctl or the real data directory.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { TITLE_OLD } from '../src/forward.mjs';

export function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

export function close(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

export async function freePorts(count) {
  const servers = [];
  const ports = [];
  for (let i = 0; i < count; i += 1) {
    const server = http.createServer();
    ports.push(await listen(server));
    servers.push(server);
  }
  await Promise.all(servers.map(close));
  return ports;
}

/** The User-Agent values the real programs send. */
export const DESKTOP_AGENT = 'antigravity/hub/2.35.1 (aidev_client; os_type=darwin; arch=arm64; cl=1029194470)';
export const CLI_AGENT = 'antigravity/cli/1.5.17 (aidev_client; os_type=darwin; arch=arm64; cl=1029496841; auth_method=consumer)';

/**
 * One HTTP request. Resolves to { status, headers, body: Buffer }.
 * It is sent as the desktop app unless `as` says otherwise ('cli', or any other User-Agent text;
 * an empty string sends no User-Agent at all).
 */
export function request({ port, method = 'GET', path: pathname = '/', headers = {}, body, agent = false, as = 'desktop' }) {
  const sender = as === 'desktop' ? DESKTOP_AGENT : as === 'cli' ? CLI_AGENT : as;
  const all = sender ? { 'user-agent': sender, ...headers } : headers;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: all, agent }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

export function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agy-flags-test-'));
}

/** Stands in for launchctl: the "login session environment" is a plain object. */
export function fakeRunner(initial = {}) {
  const vars = { ...initial };
  const calls = [];
  return {
    vars,
    calls,
    get: async (name) => vars[name] || '',
    set: async (name, value) => {
      calls.push(['set', name, value]);
      vars[name] = value;
    },
    unset: async (name) => {
      calls.push(['unset', name]);
      delete vars[name];
    },
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await sleep(20);
  }
}

/** Build a small ZIP archive by hand: [{ name, data, store }]. */
export function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, store = false } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const body = store ? data : zlib.deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A page script with the same shapes as the real one, under other names. */
export function fakePageScript({ anchor = 'contextUsageIndicator:void 0,' } = {}) {
  return [
    'var Q={useState(){},createElement(){},Component:class{}};',
    `var noise=[${Array.from({ length: 30 }, () => '(0,Q.useState)').join(',')}];`,
    'var x=Q.createElement("div");',
    'var rp=a=>a,zz9=(a,b)=>{var c=[],{optimisticState:d,trueState:f}=rp(a);return d};',
    `var bindings={cider:void 0,${anchor}contextWindow:void 0};`,
  ].join('');
}

/**
 * A directory that looks like the app as far as its programs go: a "language server" that is
 * some bytes with a page archive inside, other programs in the same folder, and app.asar.
 * `unpacked` are files below app.asar.unpacked: { 'folder/name.js': text }.
 * Returns the .app path.
 */
export function fakeApp(dir, files, { serverText = '', asar = 'asar', programs = {}, unpacked = {} } = {}) {
  const appPath = path.join(dir, 'Fake.app');
  const bin = path.join(appPath, 'Contents', 'Resources', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const padding = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 31) % 251));
  fs.writeFileSync(path.join(bin, 'language_server'), Buffer.concat([padding, Buffer.from(serverText), makeZip(files), padding]));
  for (const [name, text] of Object.entries(programs)) fs.writeFileSync(path.join(bin, name), text);
  if (asar !== null) fs.writeFileSync(path.join(appPath, 'Contents', 'Resources', 'app.asar'), asar);
  for (const [name, text] of Object.entries(unpacked)) {
    const file = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return appPath;
}

/** A title request as the desktop app 2.35.1 sends it, with made-up words. */
export function titleRequest({ message = 'make the tests pass', prompt } = {}) {
  const instruction =
    prompt ??
    `You are a conversation title generator. Read the USER's first message. ${TITLE_OLD} Do not answer the request itself.`;
  return Buffer.from(
    JSON.stringify({
      project: 'test-project',
      requestId: 'checkpoint/00000000-0000-4000-8000-000000000001',
      request: {
        contents: [{ role: 'user', parts: [{ text: message }] }],
        systemInstruction: { role: 'user', parts: [{ text: instruction }] },
        generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'LOW' } },
        sessionId: 's-1',
      },
      model: 'test-model',
      userAgent: 'antigravity',
      requestType: 'checkpoint',
    })
  );
}
