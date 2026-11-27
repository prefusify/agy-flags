// Who sent a request that arrived on one of our local ports?
//
// The settings page of agy-flags lives inside the Antigravity window, and its requests reach
// us through the language server (see api.mjs). Nothing secret can travel with them: the
// language server takes its page files from a plain address, and every file we serve there
// can be read by any program on this machine. So the sender is not asked for a secret. It is
// looked up instead: a request is answered only when it comes from a program that runs as
// the same user as agy-flags.
//
// lsof gives the answer. Without root rights it lists only the processes of the user who
// runs it, so a connection that it lists belongs to that user. There are two cases:
//
//   - The program on the other end of the connection accepts no connections itself. Then it
//     is the sender (the command line of agy-flags, for example), and it is one of ours.
//
//   - The program on the other end accepts connections itself: it may pass on the request of
//     somebody else. The language server does exactly that, for anybody who can reach its
//     local port, without asking who it is. So every connection that it has accepted must
//     come from a program of ours as well, and so on along the chain. One connection whose
//     other end is not in the listing (a program of another user of this machine) is enough
//     to refuse the request: we cannot tell which of the connections it came through.
//
// A program can also go away right after it sent its request, so that its connection is
// missing from the listing. The program that passed the request on then ends its connection
// to us, or still holds the dead connection. Both are noticed: a request is answered only
// while the connection it came through is still open after the listing.

import { execFile } from 'node:child_process';

const LSOF = '/usr/sbin/lsof';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** "[::ffff:127.0.0.1]:80" is the same end as "127.0.0.1:80". */
function plain(end) {
  const mapped = /^\[::ffff:(\d+\.\d+\.\d+\.\d+)\](:\d+)$/i.exec(end);
  return mapped ? mapped[1] + mapped[2] : end;
}

const portOf = (end) => end.slice(end.lastIndexOf(':') + 1);

/**
 * The TCP sockets in the output of `lsof -Fpn`: [{ pid, local, remote }].
 * A socket that waits for connections has a line "n127.0.0.1:54720", and its `remote` is
 * null. A connection has a line "n127.0.0.1:50001->127.0.0.1:47933": this end first.
 */
export function parseSockets(text) {
  const out = [];
  let pid = null;
  for (const row of String(text).split('\n')) {
    const line = row.trim();
    if (line.startsWith('p')) {
      pid = /^p\d+$/.test(line) ? Number(line.slice(1)) : null;
    } else if (line.startsWith('n') && pid !== null) {
      const at = line.indexOf('->');
      if (at === -1) out.push({ pid, local: plain(line.slice(1)), remote: null });
      else out.push({ pid, local: plain(line.slice(1, at)), remote: plain(line.slice(at + 2)) });
    }
  }
  return out;
}

/**
 * Where does a request come from that arrived on the connection from 127.0.0.1:`peerPort`
 * to our `port`? `sockets` are the TCP sockets of every program of our user.
 * @returns {'own'|'relayed'|'stranger'|'unknown-sender'}
 *   'own':            from a program of ours that accepts no connections itself.
 *   'relayed':        through a program of ours that accepts connections, and every
 *                     connection into the chain comes from a program of ours.
 *   'stranger':       the other end of the connection is not a program of ours.
 *   'unknown-sender': a program in the chain has accepted a connection whose other end is
 *                     not a program of ours.
 */
export function judge(sockets, port, peerPort) {
  const byPid = new Map();
  const opener = new Map();
  for (const socket of sockets) {
    if (!byPid.has(socket.pid)) byPid.set(socket.pid, []);
    byPid.get(socket.pid).push(socket);
    if (socket.remote !== null) opener.set(`${socket.local}->${socket.remote}`, socket.pid);
  }
  const first = opener.get(`127.0.0.1:${peerPort}->127.0.0.1:${port}`);
  if (first === undefined) return 'stranger';

  let relayed = false;
  const seen = new Set([first]);
  const queue = [first];
  while (queue.length > 0) {
    const mine = byPid.get(queue.pop()) || [];
    const listening = new Set(mine.filter((socket) => socket.remote === null).map((socket) => portOf(socket.local)));
    if (listening.size === 0) continue;
    relayed = true;
    for (const socket of mine) {
      // A connection that the program opened itself has a port of its own on this end.
      if (socket.remote === null || !listening.has(portOf(socket.local))) continue;
      const from = opener.get(`${socket.remote}->${socket.local}`);
      if (from === undefined) return 'unknown-sender';
      if (!seen.has(from)) {
        seen.add(from);
        queue.push(from);
      }
    }
  }
  return relayed ? 'relayed' : 'own';
}

function listSockets({ lsof, uid, timeoutMs }) {
  return new Promise((resolve) => {
    const args = ['-nP', '-a', '-u', String(uid), '-iTCP', '-Fpn'];
    execFile(lsof, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      // lsof ends with a status of its own when it lists nothing or cannot read one process.
      // A listing that was cut short is worse than none: a connection may be missing from it.
      const cut = err && (err.killed || err.signal || typeof err.code !== 'number');
      resolve(cut ? [] : parseSockets(stdout || ''));
    });
  });
}

/**
 * @param {object} [options]
 * @param {number} [options.retries]   lsof reads one process after the other, so a connection
 *                                     that is opened or closed meanwhile can look like the
 *                                     connection of an unknown sender. A later listing tells
 *                                     them apart: this many more are made, `retryMs` apart.
 * @param {number} [options.retryMs]
 * @param {number} [options.settleMs]  How long a relayed request waits after the listing for
 *                                     the news that its connection has ended.
 * @returns {(socket: import('node:net').Socket) => Promise<boolean>}
 *          Resolves to true when the request on `socket` comes from a program of our own
 *          user. When that cannot be found out, the answer is false.
 */
export function createPeerCheck({
  lsof = LSOF,
  uid = process.getuid?.(),
  timeoutMs = 3000,
  retries = 2,
  retryMs = 80,
  settleMs = 10,
  list = listSockets,
} = {}) {
  // At most one listing runs at a time, and requests that arrive meanwhile share the next
  // one: a listing must start after the request has arrived. No answer is remembered: the
  // language server sends the requests of all its callers over the same connection.
  let running = null;
  let waiting = null;

  function listing() {
    if (!running) {
      running = Promise.resolve()
        .then(() => list({ lsof, uid, timeoutMs }))
        .catch(() => [])
        .finally(() => {
          running = null;
        });
      return running;
    }
    if (!waiting) {
      waiting = running.then(() => {
        waiting = null;
        return listing();
      });
    }
    return waiting;
  }

  const open = (socket) => !socket.destroyed && !socket.readableEnded && !socket.writableEnded;

  return async function isOurs(socket) {
    if (!socket || !open(socket)) return false;
    if (uid === undefined || uid === null) return false;
    if (socket.remoteAddress !== '127.0.0.1' || !socket.remotePort || !socket.localPort) return false;
    let verdict = judge(await listing(), socket.localPort, socket.remotePort);
    for (let left = retries; verdict === 'unknown-sender' && left > 0; left -= 1) {
      await wait(retryMs);
      if (!open(socket)) return false;
      verdict = judge(await listing(), socket.localPort, socket.remotePort);
    }
    if (verdict === 'own') return open(socket);
    if (verdict !== 'relayed') return false;
    await wait(settleMs);
    return open(socket);
  };
}
