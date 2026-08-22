#!/usr/bin/env node
/**
 * End-to-end smoke test against a *running* FreeCall server.
 *
 *   node tools/smoke.mjs [http://localhost:4000]
 *
 * Unlike tools/harness (which runs the server's modules in-process against a
 * fake Socket.IO), this drives the real thing: real HTTP, real WebSockets, real
 * socket.io-client — the same library the browser uses. It logs in over REST,
 * connects two clients, and puts a call through the whole lifecycle.
 *
 * Needs `npm install` to have run, because it uses the real socket.io-client.
 */
import { io } from "socket.io-client";

const BASE = (process.argv[2] ?? "http://localhost:4000").replace(/\/$/, "");
const API = `${BASE}/api`;

let pass = 0;
const failures = [];

function check(what, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${what}`);
  } else {
    failures.push(what);
    console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

const eq = (what, actual, expected) =>
  check(
    what,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );

/**
 * Resolve when `event` arrives, or reject after `ms`.
 *
 * Events that already arrived are served from the buffer `connect()` installs —
 * `presence:state` in particular is pushed during the handshake, so a listener
 * attached after `await connect()` would miss it entirely.
 */
function waitFor(socket, event, ms = 5000) {
  const buffered = socket.seen.findIndex((m) => m.event === event);
  if (buffered !== -1) {
    return Promise.resolve(socket.seen.splice(buffered, 1)[0].payload);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timed out waiting for "${event}"`));
    }, ms);
    const onEvent = (payload) => {
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    };
    socket.on(event, onEvent);
  });
}

const post = async (path, body, token) => {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const get = async (path, token) => {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function connect(token, label) {
  const socket = io(BASE, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
  });
  // Record everything from the first instant, so nothing is missed in the gap
  // between connecting and attaching a listener.
  socket.seen = [];
  socket.onAny((event, payload) => socket.seen.push({ event, payload }));
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", (err) =>
      reject(new Error(`${label} could not connect: ${err.message}`))
    );
    setTimeout(() => reject(new Error(`${label} connect timed out`)), 5000);
  });
  return socket;
}

console.log(`\nFreeCall smoke test → ${BASE}\n`);

/* --------------------------------------------------------------- REST layer */

console.log("REST");
const healthRes = await fetch(`${BASE}/health`).then((r) => r.json());
check("GET /health is ok", healthRes.ok === true && typeof healthRes.uptime === "number");

const alice = await post("/auth/login", { username: "alice", password: "password" });
const bob = await post("/auth/login", { username: "bob", password: "password" });
eq("alice can log in", alice.status, 200);
eq("bob can log in", bob.status, 200);

const wrong = await post("/auth/login", { username: "alice", password: "nope" });
eq("a wrong password is refused", wrong.status, 401);

const contacts = await get("/users", alice.body.token);
check(
  "GET /users lists the other demo users",
  contacts.body.users.some((u) => u.username === "bob") &&
    contacts.body.users.every((u) => u.username !== "alice")
);

const ice = await get("/config/ice", alice.body.token);
check(
  "GET /config/ice hands out STUN servers",
  JSON.stringify(ice.body.iceServers).includes("stun:")
);

/* ------------------------------------------------------------ the live call */

console.log("\nA real call over a real socket");
const A = await connect(alice.body.token, "alice");
const B = await connect(bob.body.token, "bob");
check("both clients connected over websocket", A.connected && B.connected);

const presence = await waitFor(A, "presence:state");
check("the server pushes presence on connect", Array.isArray(presence.online));

const incomingPromise = waitFor(B, "call:incoming");
const ack = await new Promise((resolve) =>
  A.emit(
    "call:start",
    { calleeIds: [bob.body.user.id], video: true, type: "direct" },
    resolve
  )
);
check("call:start is acked", ack?.ok === true, JSON.stringify(ack));
check("the ack carries ICE servers", Array.isArray(ack?.iceServers));

const incoming = await incomingPromise;
eq("bob's phone rings, from alice", incoming.from.username, "alice");
check("the ring screen gets a caller image", Boolean(incoming.from.avatarUrl));
eq("it rings as a video call", incoming.video, true);

const ringing = await waitFor(A, "call:ringing");
eq("alice hears that it's ringing", ringing.userId, bob.body.user.id);

const acceptedByCaller = waitFor(A, "call:accepted");
const peerJoined = waitFor(B, "call:peer-joined");
const acceptAck = await new Promise((resolve) =>
  B.emit("call:accept", { callId: ack.callId }, resolve)
);
check("call:accept is acked", acceptAck?.ok === true, JSON.stringify(acceptAck));

const accepted = await acceptedByCaller;
eq("alice is told bob picked up", accepted.user.username, "bob");
const joined = await peerJoined;
check(
  "exactly one side is told to make the offer",
  typeof joined.initiator === "boolean",
  JSON.stringify(joined)
);

/* SDP and ICE are relayed verbatim; the server never parses them. */
const offerAtB = waitFor(B, "webrtc:offer");
A.emit("webrtc:offer", {
  callId: ack.callId,
  toUserId: bob.body.user.id,
  sdp: { type: "offer", sdp: "v=0 smoke-offer" },
});
const offer = await offerAtB;
eq("the offer reaches bob untouched", offer.sdp.sdp, "v=0 smoke-offer");
eq("and is attributed to alice", offer.fromUserId, alice.body.user.id);

const answerAtA = waitFor(A, "webrtc:answer");
B.emit("webrtc:answer", {
  callId: ack.callId,
  toUserId: alice.body.user.id,
  sdp: { type: "answer", sdp: "v=0 smoke-answer" },
});
eq("the answer comes back", (await answerAtA).sdp.sdp, "v=0 smoke-answer");

const iceAtB = waitFor(B, "webrtc:ice");
A.emit("webrtc:ice", {
  callId: ack.callId,
  toUserId: bob.body.user.id,
  candidate: { candidate: "candidate:smoke", sdpMid: "0", sdpMLineIndex: 0 },
});
eq("ICE candidates are relayed", (await iceAtB).candidate.candidate, "candidate:smoke");

const mediaAtB = waitFor(B, "call:media-state");
A.emit("call:media-state", {
  callId: ack.callId,
  state: { audio: false, video: true, screen: false },
});
const media = await mediaAtB;
eq("muting is announced to the peer", media.state.audio, false);

const chatAtA = waitFor(A, "chat:message");
B.emit("chat:message", { callId: ack.callId, text: "  hello from the smoke test  " });
const chat = await chatAtA;
eq("chat is delivered, trimmed", chat.text, "hello from the smoke test");
eq("chat says who sent it", chat.from.displayName, bob.body.user.displayName);

const endedAtB = waitFor(B, "call:ended");
const leftAtB = waitFor(B, "call:peer-left");
A.emit("call:leave", { callId: ack.callId });
await leftAtB;
check("bob sees alice leave", true);
const ended = await endedAtB;
eq("and the call ends for bob", ended.callId, ack.callId);

/* ------------------------------------------------------------------ history */

console.log("\nHistory");
const hist = await get("/history", alice.body.token);
const entry = hist.body.history.find((h) => h.callId === ack.callId);
check("the call is in alice's history", Boolean(entry));
eq("recorded as completed", entry?.status, "completed");
eq("recorded as a video call", entry?.video, true);
check("with both participants", entry?.participantIds?.length === 2);
check("and an end timestamp", typeof entry?.endedAt === "number");

const bobHist = await get("/history", bob.body.token);
check(
  "bob has his own copy of the entry",
  bobHist.body.history.some((h) => h.callId === ack.callId)
);

/* -------------------------------------------------------------------- close */

A.close();
B.close();

console.log(`\n${"-".repeat(60)}`);
if (failures.length === 0) {
  console.log(`ALL GREEN — ${pass} checks passed against a live server`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:`);
  for (const f of failures) console.log(`  x ${f}`);
}
console.log(`${"-".repeat(60)}\n`);
process.exit(failures.length === 0 ? 0 : 1);
