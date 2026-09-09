/** Live HTTP + Socket.IO smoke check using two isolated temporary accounts.
 * Does not capture or assert real audio/video. Accounts persist until the
 * current in-memory backend restarts. Run: node tools/harness/live.mjs URL
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
const base = process.argv[2];
if (!base) throw new Error('Pass the deployed base URL');
const sockets = [];
const once = (socket, event) => new Promise((resolve, reject) => {
  const cleanup = () => { clearTimeout(timer); socket.off(event, listener); socket.off('connect_error', failed); };
  const timer = setTimeout(() => { cleanup(); reject(new Error(`Timeout: ${event}`)); }, 15000);
  const listener = value => { cleanup(); resolve(value); };
  const failed = error => { cleanup(); reject(new Error(`Connection failed: ${error.message}`)); };
  socket.once(event, listener);
  if (event === 'connect') socket.once('connect_error', failed);
});
const ack = (socket, event, payload) => new Promise((resolve, reject) => {
  socket.timeout(15000).emit(event, payload, (error, value) => error ? reject(error) : resolve(value));
});
let callId;
try {
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const users = [];
  for (const transport of ['websocket', 'polling']) {
    const username = `qa_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const password = randomUUID();
    const registered = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ username, password, displayName: `Deployment QA ${transport}` }),
    });
    assert.equal(registered.status, 201);
    const user = await registered.json();
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(login.status, 200);
    const auth = { Authorization: `Bearer ${user.token}` };
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: auth })).status, 200);
    const ice = await (await fetch(`${base}/api/config/ice`, { headers: auth })).json();
    if (!users.length) console.log('TURN configured:', ice.iceServers.some(s =>
      [].concat(s.urls).some(url => /^turns?:/.test(url))));
    const socket = io(base, { autoConnect: false, transports: [transport], upgrade: false,
      auth: { token: user.token }, extraHeaders: { Origin: base }, reconnection: false });
    sockets.push(socket);
    const connected = once(socket, 'connect');
    socket.connect();
    await connected;
    console.log(`${transport} connected`);
    users.push(user);
  }
  const [a, b] = sockets;
  const incoming = once(b, 'call:incoming');
  const started = await ack(a, 'call:start', { calleeIds: [users[1].user.id], type: 'direct', video: true });
  assert.equal(started.ok, true);
  callId = started.callId;
  assert.equal((await incoming).callId, callId);
  const joinedA = once(a, 'call:peer-joined');
  const joinedB = once(b, 'call:peer-joined');
  assert.equal((await ack(b, 'call:accept', { callId })).ok, true);
  const [peerA, peerB] = await Promise.all([joinedA, joinedB]);
  assert.notEqual(peerA.initiator, peerB.initiator);
  for (const [from, to, target] of [[a, b, users[1]], [b, a, users[0]]]) {
    const media = once(to, 'call:media-state');
    from.emit('call:media-state', { callId, state: { audio: true, video: true, screen: false } });
    assert.equal((await media).state.video, true);
    const ice = once(to, 'webrtc:ice');
    from.emit('webrtc:ice', { callId, toUserId: target.user.id, candidate: { candidate: 'qa-signaling-only' } });
    assert.equal((await ice).candidate.candidate, 'qa-signaling-only');
  }
  const ended = once(b, 'call:ended');
  a.emit('call:leave', { callId });
  await ended;
  console.log('Live checks passed: health, registration/login, authenticated API, WebSocket and polling, call acceptance, media/ICE relay in both directions, hangup');
} finally {
  if (callId) sockets[0]?.emit('call:leave', { callId });
  sockets.forEach(socket => socket.disconnect());
}
