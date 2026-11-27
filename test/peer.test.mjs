import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import test from 'node:test';
import { createPeerCheck, judge, parseSockets } from '../src/peer.mjs';
import { waitFor } from './helpers.mjs';

// What `lsof -nP -a -u <uid> -iTCP -Fpn` prints, shortened.
const LISTING = `p688
f11
n*:49152
f14
n[fe80:7::4d4:fb99:aec0:83fe]:49152->[fe80:7::1476:8f69:c009:16fa]:58777
p96036
f7
n127.0.0.1:54720
f8
n127.0.0.1:54721
f20
n127.0.0.1:54720->127.0.0.1:55224
f21
n127.0.0.1:50334->127.0.0.1:47933
f22
n198.18.0.1:60001->142.250.1.1:443
p96017
f30
n127.0.0.1:55224->127.0.0.1:54720
p91483
f14
n127.0.0.1:47933
f15
n127.0.0.1:47933->127.0.0.1:50334
`;

test('parseSockets reads the sockets of each program', () => {
  const sockets = parseSockets(LISTING);
  assert.equal(sockets.length, 10);
  assert.deepEqual(sockets[0], { pid: 688, local: '*:49152', remote: null });
  assert.deepEqual(sockets[1], { pid: 688, local: '[fe80:7::4d4:fb99:aec0:83fe]:49152', remote: '[fe80:7::1476:8f69:c009:16fa]:58777' });
  assert.deepEqual(sockets[4], { pid: 96036, local: '127.0.0.1:54720', remote: '127.0.0.1:55224' });
  assert.deepEqual(sockets.at(-1), { pid: 91483, local: '127.0.0.1:47933', remote: '127.0.0.1:50334' });
  // An address of the old kind inside one of the new kind is the same end.
  assert.deepEqual(parseSockets('p1\nn[::ffff:127.0.0.1]:80->[::FFFF:127.0.0.1]:5000\n'), [{ pid: 1, local: '127.0.0.1:80', remote: '127.0.0.1:5000' }]);
  // A name without a program before it, and a program line that is no number, are left out.
  assert.deepEqual(parseSockets('n127.0.0.1:1\npx\nn127.0.0.1:2\np7\nn127.0.0.1:3\n'), [{ pid: 7, local: '127.0.0.1:3', remote: null }]);
  assert.deepEqual(parseSockets(''), []);
  assert.deepEqual(parseSockets(undefined), []);
});

/** Sockets from short lines: "pid local" or "pid local->remote", ports only (all on 127.0.0.1). */
function sockets(...lines) {
  const end = (text) => (text.includes(':') || text.includes('*') ? text : `127.0.0.1:${text}`);
  return lines.map((line) => {
    const [pid, name] = line.split(' ');
    const [local, remote] = name.split('->');
    return { pid: Number(pid), local: end(local), remote: remote === undefined ? null : end(remote) };
  });
}

test('judge: a program that accepts no connections speaks for itself', () => {
  const list = sockets('1 47933', '1 47933->50001', '2 50001->47933', '2 50002->443');
  assert.equal(judge(list, 47933, 50001), 'own');
  // A connection that no program of ours has opened.
  assert.equal(judge(list, 47933, 50009), 'stranger');
  assert.equal(judge([], 47933, 50001), 'stranger');
  // Our side of a connection is not its other end.
  assert.equal(judge(sockets('1 47933', '1 47933->50001'), 47933, 50001), 'stranger');
  // A connection from another address is not a local one.
  assert.equal(judge(sockets('2 192.168.1.9:50001->127.0.0.1:47933'), 47933, 50001), 'stranger');
});

test('judge: a program that passes requests on is trusted only with the senders it has', () => {
  const relay = ['5 54720', '5 54721', '5 50334->47933', '5 198.18.0.1:60001->142.250.1.1:443'];
  // Nobody is connected to it.
  assert.equal(judge(sockets(...relay), 47933, 50334), 'relayed');
  // A window of ours is connected to it.
  const withWindow = [...relay, '5 54720->55224', '6 55224->54720'];
  assert.equal(judge(sockets(...withWindow), 47933, 50334), 'relayed');
  // And somebody whose program is not in the listing: another user of the machine.
  assert.equal(judge(sockets(...withWindow, '5 54721->61000'), 47933, 50334), 'unknown-sender');
  // The listing of the real machine above.
  assert.equal(judge(parseSockets(LISTING), 47933, 50334), 'relayed');
  assert.equal(judge(parseSockets(LISTING.replace('n127.0.0.1:55224->127.0.0.1:54720\n', '')), 47933, 50334), 'unknown-sender');
  // A connection that the relay opened itself, to a port that nobody of ours has, is no sender.
  assert.equal(judge(sockets(...relay, '5 60500->9999'), 47933, 50334), 'relayed');
  // A program that accepts connections from other machines has senders nobody can look up.
  const open = ['5 *:7000', '5 50334->47933', '5 192.168.1.5:7000->192.168.1.9:51000'];
  assert.equal(judge(sockets(...open), 47933, 50334), 'unknown-sender');
});

test('judge: the senders of a sender are looked at too', () => {
  const chain = ['5 54720', '5 50334->47933', '5 54720->55224', '6 55224->54720', '6 8080'];
  assert.equal(judge(sockets(...chain), 47933, 50334), 'relayed');
  assert.equal(judge(sockets(...chain, '6 8080->62000', '7 62000->8080'), 47933, 50334), 'relayed');
  assert.equal(judge(sockets(...chain, '6 8080->62000'), 47933, 50334), 'unknown-sender');
  // Two programs that are connected to each other do not keep the search going for ever.
  const loop = ['5 54720', '5 50334->47933', '5 54720->55224', '6 55224->54720', '6 8080', '6 8080->50400', '5 50400->8080'];
  assert.equal(judge(sockets(...loop), 47933, 50334), 'relayed');
  // A program that is connected to itself.
  assert.equal(judge(sockets('5 54720', '5 50334->47933', '5 54720->50500', '5 50500->54720'), 47933, 50334), 'relayed');
});

/** A stand-in for a connection of the page-file server. */
const fakeSocket = (remotePort = 50334, more = {}) => ({
  remoteAddress: '127.0.0.1',
  remotePort,
  localPort: 47933,
  destroyed: false,
  readableEnded: false,
  writableEnded: false,
  ...more,
});

const OWN = sockets('2 50334->47933');
const RELAYED = sockets('5 54720', '5 50334->47933', '5 54720->55224', '6 55224->54720');
const UNKNOWN = sockets('5 54720', '5 50334->47933', '5 54720->61000');

/** A check whose listings are the given ones, one after the other; the last one stays. */
function checkWith(listings, options = {}) {
  const calls = [];
  const check = createPeerCheck({
    uid: 501,
    retryMs: 1,
    settleMs: 1,
    list: async (args) => {
      calls.push(args);
      return listings[Math.min(calls.length, listings.length) - 1];
    },
    ...options,
  });
  return { check, calls };
}

test('a program of the user is recognized, and every request is looked up again', async () => {
  const { check, calls } = checkWith([OWN]);
  const socket = fakeSocket();
  assert.equal(await check(socket), true);
  assert.equal(await check(socket), true);
  // The language server sends the requests of all its callers over one connection, so the
  // answer for a connection is not remembered.
  assert.equal(calls.length, 2);
  assert.equal(calls[0].uid, 501);
  assert.equal(await check(fakeSocket(50999)), false);
});

test('a connection that cannot be a local program of the user is refused without a lookup', async () => {
  const { check, calls } = checkWith([OWN]);
  assert.equal(await check(null), false);
  assert.equal(await check(fakeSocket(50334, { destroyed: true })), false);
  assert.equal(await check(fakeSocket(50334, { readableEnded: true })), false);
  assert.equal(await check(fakeSocket(50334, { remoteAddress: '192.168.1.9' })), false);
  assert.equal(await check(fakeSocket(50334, { remoteAddress: '::1' })), false);
  assert.equal(await check(fakeSocket(0)), false);
  assert.equal(await check(fakeSocket(50334, { localPort: undefined })), false);
  assert.equal(calls.length, 0);
  // Without a user to ask for, nothing can be looked up.
  const nobody = createPeerCheck({ uid: null, list: async () => OWN });
  assert.equal(await nobody(fakeSocket()), false);
});

test('a listing that fails refuses the request', async () => {
  const failing = createPeerCheck({
    uid: 501,
    list: async () => {
      throw new Error('no lsof');
    },
  });
  assert.equal(await failing(fakeSocket()), false);
  assert.equal(await checkWith([[]]).check(fakeSocket()), false);
  // A program that cannot be run at all.
  const missing = createPeerCheck({ lsof: '/nonexistent/lsof', uid: 501 });
  assert.equal(await missing(fakeSocket()), false);
});

test('a request that the language server passes on is answered while all its callers are programs of the user', async () => {
  const { check, calls } = checkWith([RELAYED]);
  assert.equal(await check(fakeSocket()), true);
  assert.equal(calls.length, 1);
});

test('a caller of the language server that nobody can look up refuses the request', async () => {
  const { check, calls } = checkWith([UNKNOWN]);
  assert.equal(await check(fakeSocket()), false);
  // The first listing, and two more to be sure.
  assert.equal(calls.length, 3);
  assert.equal(await checkWith([UNKNOWN], { retries: 0 }).check(fakeSocket()), false);
});

test('a connection that was only on its way out during the listing does not refuse the request', async () => {
  const { check, calls } = checkWith([UNKNOWN, RELAYED]);
  assert.equal(await check(fakeSocket()), true);
  assert.equal(calls.length, 2);
  const late = checkWith([UNKNOWN, UNKNOWN, RELAYED]);
  assert.equal(await late.check(fakeSocket()), true);
  assert.equal(late.calls.length, 3);
});

test('a relayed request is refused when its connection ends while it is looked up', async () => {
  // The sender went away before the listing, so it is missing there. The program that
  // passed the request on has ended its connection to us because of that.
  for (const gone of [{ readableEnded: true }, { destroyed: true }, { writableEnded: true }]) {
    const socket = fakeSocket();
    const check = createPeerCheck({
      uid: 501,
      settleMs: 20,
      list: async () => {
        setTimeout(() => Object.assign(socket, gone), 5);
        return RELAYED;
      },
    });
    assert.equal(await check(socket), false, JSON.stringify(gone));
  }
  // The same while it waits for another listing.
  const socket = fakeSocket();
  const calls = [];
  const check = createPeerCheck({
    uid: 501,
    retryMs: 20,
    list: async () => {
      calls.push(1);
      setTimeout(() => Object.assign(socket, { destroyed: true }), 5);
      return UNKNOWN;
    },
  });
  assert.equal(await check(socket), false);
  assert.equal(calls.length, 1);
});

test('requests that arrive during a listing share the next one, which starts after them', async () => {
  const started = [];
  const release = [];
  const check = createPeerCheck({
    uid: 501,
    settleMs: 1,
    list: () =>
      new Promise((resolve) => {
        started.push(Date.now());
        release.push(() => resolve(OWN));
      }),
  });
  const first = check(fakeSocket());
  await waitFor(() => started.length === 1);
  const second = check(fakeSocket());
  const third = check(fakeSocket());
  // The listing that is running started before these two arrived: it cannot speak for them.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(started.length, 1);
  release[0]();
  assert.equal(await first, true);
  await waitFor(() => started.length === 2);
  release[1]();
  assert.deepEqual(await Promise.all([second, third]), [true, true]);
  assert.equal(started.length, 2);
});

// ---- the real lookup ---------------------------------------------------------------------

const realLsof = process.platform === 'darwin' && fs.existsSync('/usr/sbin/lsof') && process.getuid() !== 0;

/** A server in this process, and the connections it has accepted. */
async function acceptor(t) {
  const accepted = [];
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.resume();
    accepted.push(socket);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of accepted) socket.destroy();
    server.close();
  });
  return { port: server.address().port, accepted };
}

test('lsof: another program of the same user is recognized', { skip: !realLsof }, async (t) => {
  const { port, accepted } = await acceptor(t);
  // A program that only connects, like the command line of agy-plus.
  const child = spawn(process.execPath, ['-e', `require('net').connect(${port},'127.0.0.1').on('error',()=>{}).resume();setTimeout(()=>{},30000)`], {
    stdio: 'ignore',
  });
  t.after(() => child.kill());
  await waitFor(() => accepted.length === 1);
  const check = createPeerCheck();
  assert.equal(await check(accepted[0]), true);
  // Asked about another user, lsof does not list our programs: nobody is recognized.
  const asRoot = createPeerCheck({ uid: 0, retries: 0 });
  assert.equal(await asRoot(accepted[0]), false);
  // After the program is gone, its connection is no longer answered.
  child.kill();
  await waitFor(() => accepted[0].destroyed || accepted[0].readableEnded);
  assert.equal(await check(accepted[0]), false);
});

test('lsof: a program that accepts connections itself is recognized with its callers', { skip: !realLsof }, async (t) => {
  // This process listens and connects to itself: it could be passing a request on.
  const { port, accepted } = await acceptor(t);
  const client = net.connect(port, '127.0.0.1');
  client.on('error', () => {});
  t.after(() => client.destroy());
  await waitFor(() => accepted.length === 1);
  assert.equal(await createPeerCheck()(accepted[0]), true);
});
