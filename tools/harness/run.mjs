/**
 * Runs the real FreeCall server code — routes.ts, socket.ts, store.ts, auth.ts,
 * push.ts — against a fake Socket.IO and fake HTTP layer, and asserts the
 * behaviour CONTRACT.md promises. No node_modules required.
 *
 * Usage, from the repo root:
 *   npm test
 * or directly:
 *   node --experimental-strip-types --import ./tools/harness/hooks.mjs tools/harness/run.mjs
 *
 * Set SRC to point at a different copy of server/src (see faults.py).
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createFakeIO } from "./fakeio.mjs";

// A directory URL, so this works on Windows too (import() needs file:// URLs,
// not bare drive-letter paths).
const SRC = process.env.SRC
  ? pathToFileURL(resolve(process.env.SRC) + "/").href
  : new URL("../../server/src/", import.meta.url).href;

const store = await import(`${SRC}store.ts`);
const { api } = await import(`${SRC}routes.ts`);
const { registerSocketHandlers } = await import(`${SRC}socket.ts`);
const { initPush } = await import(`${SRC}push.ts`);

/* ------------------------------------------------------------ test harness */

let pass = 0;
const failures = [];
let group = "";

const heading = (name) => {
  group = name;
  console.log(`\n${name}`);
};

function check(what, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${what}`);
  } else {
    failures.push(`${group} → ${what}${detail ? ` (${detail})` : ""}`);
    console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

const eq = (what, actual, expected) =>
  check(
    what,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );

const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------- fixtures */

initPush();
store.seedDemoUsers();

const rest = (method, path, { token, body } = {}) =>
  api._dispatch(method, path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
  });

async function login(username, password = "password") {
  const res = await rest("POST", "/auth/login", { body: { username, password } });
  if (res.status !== 200) throw new Error(`login ${username}: ${res.body.error}`);
  return { token: res.body.token, user: res.body.user };
}

const alice = await login("alice");
const bob = await login("bob");
const carol = await login("carol");

/** Fresh signaling server + connected clients for one scenario. */
async function session(specs) {
  const io = createFakeIO();
  registerSocketHandlers(io);
  const clients = {};
  for (const [name, { token, label }] of Object.entries(specs)) {
    clients[name] = await io.connect(token, label ?? name);
  }
  await tick();
  Object.values(clients).forEach((c) => c.clear());
  return {
    io,
    ...clients,
    async end() {
      for (const c of Object.values(clients)) {
        if (!c.socket.disconnected) c.disconnect();
      }
      await tick();
    },
  };
}

/* ============================================================== REST layer */

heading("REST API");
{
  const bad = await rest("POST", "/auth/login", {
    body: { username: "alice", password: "wrong" },
  });
  eq("wrong password is rejected", bad.status, 401);

  const me = await rest("GET", "/auth/me", { token: alice.token });
  eq("GET /auth/me returns the caller", me.body.user.username, "alice");

  const noAuth = await rest("GET", "/users");
  eq("unauthenticated /users is 401", noAuth.status, 401);

  const users = await rest("GET", "/users", { token: alice.token });
  check(
    "GET /users excludes self",
    users.body.users.every((u) => u.id !== alice.user.id),
    JSON.stringify(users.body.users.map((u) => u.username))
  );

  const reg = await rest("POST", "/auth/register", {
    body: { username: "dave", displayName: "Dave Park", password: "hunter2" },
  });
  eq("register creates a user", reg.status, 201);
  check("register returns a usable token", Boolean(reg.body.token));
  check(
    "blank avatar gets a generated one",
    typeof reg.body.user.avatarUrl === "string" &&
      reg.body.user.avatarUrl.includes("dicebear")
  );

  const dupe = await rest("POST", "/auth/register", {
    body: { username: "dave", displayName: "Impostor", password: "hunter2" },
  });
  eq("duplicate username is rejected", dupe.status, 409);

  const shortPw = await rest("POST", "/auth/register", {
    body: { username: "eve", displayName: "Eve", password: "123" },
  });
  eq("short password is rejected", shortPw.status, 400);

  const ice = await rest("GET", "/config/ice", { token: alice.token });
  check(
    "ICE config includes STUN",
    JSON.stringify(ice.body.iceServers).includes("stun:"),
    JSON.stringify(ice.body.iceServers)
  );

  const vapid = await rest("GET", "/push/vapidPublicKey");
  eq("push key is null when VAPID is unset", vapid.body.key, null);

  const sub = await rest("POST", "/push/subscribe", {
    token: bob.token,
    body: {
      subscription: {
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
      },
    },
  });
  eq("push subscribe accepted", sub.body, { ok: true });

  const badSub = await rest("POST", "/push/subscribe", {
    token: bob.token,
    body: { subscription: { endpoint: "https://push.example/abc" } },
  });
  eq("malformed subscription rejected", badSub.status, 400);

  const expo = await rest("POST", "/push/expo/register", {
    token: bob.token,
    body: { token: "ExponentPushToken[xyz]" },
  });
  eq("expo token accepted", expo.body, { ok: true });
}

/* ======================================================== socket handshake */

heading("Socket handshake");
{
  const io = createFakeIO();
  registerSocketHandlers(io);

  let rejected = null;
  try {
    await io.connect("not-a-jwt", "impostor");
  } catch (err) {
    rejected = err.message;
  }
  check("a bad token is refused", rejected !== null, String(rejected));

  const a = await io.connect(alice.token, "alice");
  await tick();
  check("connect delivers presence:state", a.got("presence:state"));
  check(
    "presence:state lists the connected user",
    a.last("presence:state")?.online?.includes(alice.user.id)
  );

  const b = await io.connect(bob.token, "bob");
  await tick();
  const update = a.last("presence:update");
  eq("peer coming online is broadcast", [update?.userId, update?.online], [
    bob.user.id,
    true,
  ]);

  b.disconnect();
  await tick();
  const off = a.last("presence:update");
  eq("peer going offline is broadcast", [off?.userId, off?.online], [
    bob.user.id,
    false,
  ]);
  check("lastSeen is stamped on disconnect", typeof off?.lastSeen === "number");
  a.disconnect();
}

/* ================================================ 1-to-1 call, happy path */

heading("1-to-1 call: ring → accept → media → chat → hang up");
let directCallId = null;
{
  const s = await session({ a: alice, b: bob });

  const ack = await s.a.send("call:start", {
    calleeIds: [bob.user.id],
    video: false,
    type: "direct",
  });
  await tick();
  directCallId = ack.callId;

  check("call:start acked ok", ack.ok === true, JSON.stringify(ack));
  check("ack carries ICE servers", Array.isArray(ack.iceServers));
  const incoming = s.b.last("call:incoming");
  check("callee receives call:incoming", Boolean(incoming));
  eq("incoming names the caller", incoming?.from?.username, "alice");
  check(
    "incoming carries the caller image for the ring screen",
    typeof incoming?.from?.avatarUrl === "string" && incoming.from.avatarUrl.length > 0
  );
  eq("incoming call type", incoming?.type, "direct");
  eq("caller is told the callee is ringing", s.a.last("call:ringing")?.userId, bob.user.id);

  const initialMedia = { audio: false, video: true, screen: false };
  await s.a.send("call:media-state", { callId: ack.callId, state: initialMedia });
  check("ringing callee does not receive active media yet", !s.b.got("call:media-state"));
  let configuredBeforeJoin = false;
  let acceptAck;
  s.b.socket.listeners.set("call:peer-joined", [() => {
    configuredBeforeJoin = Boolean(acceptAck?.iceServers?.length);
  }]);
  s.b.socket.handlers.get("call:accept")({ callId: ack.callId }, (value) => {
    acceptAck = value;
  });
  check("ICE configuration arrives before peer creation", configuredBeforeJoin);
  eq("answerer receives caller's existing camera and mic state",
    s.b.last("call:media-state")?.state, initialMedia);
  check("participant arrives before its media state",
    s.b.inbox.findIndex((m) => m.event === "call:peer-joined") <
    s.b.inbox.findIndex((m) => m.event === "call:media-state"));
  await tick();
  check("call:accept acked ok", acceptAck.ok === true, JSON.stringify(acceptAck));
  eq("caller learns who accepted", s.a.last("call:accepted")?.user?.username, "bob");

  const aJoin = s.a.last("call:peer-joined");
  const bJoin = s.b.last("call:peer-joined");
  check("both sides get call:peer-joined", Boolean(aJoin && bJoin));
  check(
    "exactly one side is the initiator",
    aJoin?.initiator !== bJoin?.initiator,
    `alice=${aJoin?.initiator} bob=${bJoin?.initiator}`
  );
  const smallerId = alice.user.id < bob.user.id ? alice.user.id : bob.user.id;
  const offererIsSmaller = aJoin?.initiator
    ? alice.user.id === smallerId
    : bob.user.id === smallerId;
  check("the lexicographically smaller id offers", offererIsSmaller);

  // SDP + ICE relay, in the direction the initiator flag chose.
  const [offerer, answerer, offererId] = aJoin?.initiator
    ? [s.a, s.b, alice.user.id]
    : [s.b, s.a, bob.user.id];
  const targetId = offererId === alice.user.id ? bob.user.id : alice.user.id;

  await offerer.send("webrtc:offer", {
    callId: ack.callId,
    toUserId: targetId,
    sdp: { type: "offer", sdp: "v=0 fake-offer" },
  });
  await tick();
  const relayedOffer = answerer.last("webrtc:offer");
  check("offer is relayed to the peer", Boolean(relayedOffer));
  eq("relayed offer is attributed to the sender", relayedOffer?.fromUserId, offererId);
  check(
    "the SDP is passed through untouched",
    relayedOffer?.sdp?.sdp === "v=0 fake-offer"
  );

  await answerer.send("webrtc:answer", {
    callId: ack.callId,
    toUserId: offererId,
    sdp: { type: "answer", sdp: "v=0 fake-answer" },
  });
  await answerer.send("webrtc:ice", {
    callId: ack.callId,
    toUserId: offererId,
    candidate: { candidate: "candidate:1 1 udp 1 10.0.0.1 5000 typ host" },
  });
  await tick();
  check("answer is relayed back", Boolean(offerer.last("webrtc:answer")));
  check("ICE candidate is relayed back", Boolean(offerer.last("webrtc:ice")));

  // Mute + camera + screen indicators.
  await s.a.send("call:media-state", {
    callId: ack.callId,
    state: { audio: false, video: true, screen: true },
  });
  await tick();
  const ms = s.b.last("call:media-state");
  eq("media state relays to the peer", [ms?.userId, ms?.state], [
    alice.user.id,
    { audio: false, video: true, screen: true },
  ]);

  // In-call chat.
  await s.a.send("chat:message", { callId: ack.callId, text: "  can you hear me?  " });
  await tick();
  const msg = s.b.last("chat:message");
  check("chat message is relayed", Boolean(msg));
  eq("chat text is trimmed", msg?.text, "can you hear me?");
  // Per CONTRACT.md a ChatMessage carries id/displayName/avatarUrl — not the
  // username — so the UI can render an avatar without a second lookup.
  eq("chat message names the sender", msg?.from?.displayName, "Alice Nguyen");
  eq("chat message identifies the sender", msg?.from?.id, alice.user.id);
  check("chat message carries the sender avatar", Boolean(msg?.from?.avatarUrl));
  check("chat message has an id and timestamp", Boolean(msg?.id) && typeof msg?.ts === "number");

  await s.a.send("chat:message", { callId: ack.callId, text: "   " });
  await tick();
  eq("empty chat is dropped", s.b.all("chat:message").length, 1);

  await sleep(15); // so the recorded duration is measurable
  await s.a.send("call:leave", { callId: ack.callId });
  await tick();
  check("peer is told the other side left", Boolean(s.b.last("call:peer-left")));
  eq("both sides get call:ended", [s.a.got("call:ended"), s.b.got("call:ended")], [
    true,
    true,
  ]);

  // A client that taps hang up twice — or races with the peer hanging up — must
  // not produce a second call:ended or a duplicate history entry.
  const endedCount = s.a.all("call:ended").length;
  const historyCount = store.historyFor(alice.user.id).length;
  await s.a.send("call:leave", { callId: ack.callId });
  await tick();
  eq("hanging up twice ends the call once", s.a.all("call:ended").length, endedCount);
  eq(
    "hanging up twice writes one history entry",
    store.historyFor(alice.user.id).length,
    historyCount
  );

  await s.end();
}

heading("Call history");
{
  const aHist = store.historyFor(alice.user.id);
  const bHist = store.historyFor(bob.user.id);
  const entry = aHist.find((h) => h.callId === directCallId);
  check("caller has a history entry", Boolean(entry));
  eq("status is completed", entry?.status, "completed");
  eq("history records the participants", entry?.participantIds?.length, 2);
  check("answeredAt is set", typeof entry?.answeredAt === "number");
  check("endedAt is recorded", typeof entry?.endedAt === "number",
    `endedAt=${JSON.stringify(entry?.endedAt)}`);
  check("the call ended no earlier than it was answered", (entry?.endedAt ?? 0) >= (entry?.answeredAt ?? 0));
  check("duration is a number of seconds", typeof entry?.durationSec === "number");
  check(
    "both participants see the call",
    bHist.some((h) => h.callId === directCallId)
  );
  check(
    "history is written exactly once per participant",
    aHist.filter((h) => h.callId === directCallId).length === 1
  );

  const viaRest = await rest("GET", "/history", { token: alice.token });
  check(
    "GET /history serves it",
    viaRest.body.history.some((h) => h.callId === directCallId)
  );
}

/* ================================================== decline, cancel, busy */

heading("Decline");
{
  const s = await session({ a: alice, b: bob });
  const ack = await s.a.send("call:start", {
    calleeIds: [bob.user.id],
    video: false,
    type: "direct",
  });
  await tick();
  await s.b.send("call:reject", { callId: ack.callId, reason: "Busy right now" });
  await tick();

  const rejected = s.a.last("call:rejected");
  check("caller is told it was declined", Boolean(rejected));
  eq("decline reason is passed along", rejected?.reason, "Busy right now");
  check("caller's call ends", s.a.got("call:ended"));
  const entry = store.historyFor(alice.user.id).find((h) => h.callId === ack.callId);
  eq("history records it as rejected", entry?.status, "rejected");
  eq("an unanswered call has no duration", entry?.durationSec, 0);
  await s.end();
}

heading("Caller cancels before pickup");
{
  const s = await session({ a: alice, b: bob });
  const ack = await s.a.send("call:start", {
    calleeIds: [bob.user.id],
    video: true,
    type: "direct",
  });
  await tick();
  await s.a.send("call:cancel", { callId: ack.callId });
  await tick();

  check("callee's ring is canceled", s.b.got("call:canceled"));
  const entry = store.historyFor(bob.user.id).find((h) => h.callId === ack.callId);
  eq("history records it as canceled", entry?.status, "canceled");
  eq("a video call is recorded as video", entry?.video, true);
  await s.end();
}

heading("Busy");
{
  const s = await session({ a: alice, b: bob, c: carol });
  const ack = await s.a.send("call:start", {
    calleeIds: [bob.user.id],
    video: false,
    type: "direct",
  });
  await tick();
  await s.b.send("call:accept", { callId: ack.callId });
  await tick();

  const second = await s.c.send("call:start", {
    calleeIds: [bob.user.id],
    video: false,
    type: "direct",
  });
  await tick();
  check("calling a busy user fails", second.ok === false, JSON.stringify(second));
  check("caller is told which user was busy", s.c.got("call:busy"));
  check("the ongoing call is undisturbed", !s.a.got("call:ended"));

  const selfCall = await s.a.send("call:start", {
    calleeIds: [carol.user.id],
    video: false,
    type: "direct",
  });
  eq("you cannot start a second call yourself", selfCall.ok, false);

  await s.a.send("call:leave", { callId: ack.callId });
  await tick();
  await s.end();
}

/* ================================================== multi-device ringing */

heading("Multi-device: answering on one device silences the others");
{
  const s = await session({
    a: alice,
    b1: { ...bob, label: "bob-phone" },
    b2: { ...bob, label: "bob-laptop" },
  });

  const ack = await s.a.send("call:start", {
    calleeIds: [bob.user.id],
    video: false,
    type: "direct",
  });
  await tick();
  eq("both of the callee's devices ring", [s.b1.got("call:incoming"), s.b2.got("call:incoming")], [
    true,
    true,
  ]);

  await s.b1.send("call:accept", { callId: ack.callId });
  await tick();

  const ended = s.b2.last("call:ended");
  check("the other device is told to stop ringing", Boolean(ended));
  eq("with a displayable reason", ended?.reason, "Answered on another device");
  check("the answering device is not told to stop", !s.b1.got("call:ended"));

  await s.a.send("call:leave", { callId: ack.callId });
  await tick();
  await s.end();
}

heading("Multi-device: declining on one device silences the others");
{
  const s = await session({
    a: alice,
    b1: { ...bob, label: "bob-phone" },
    b2: { ...bob, label: "bob-laptop" },
  });
  const ack = await s.a.send("call:start", {
    calleeIds: [bob.user.id],
    video: false,
    type: "direct",
  });
  await tick();
  await s.b1.send("call:reject", { callId: ack.callId });
  await tick();

  eq(
    "the other device stops ringing",
    s.b2.all("call:ended").some((e) => e.reason === "Declined on another device"),
    true
  );
  await s.end();
}

/* ============================================================ group calls */

heading("Group call: mesh negotiation");
let groupCallId = null;
{
  const s = await session({ a: alice, b: bob, c: carol });
  const ack = await s.a.send("call:start", {
    calleeIds: [bob.user.id, carol.user.id],
    video: true,
    type: "group",
  });
  await tick();
  groupCallId = ack.callId;
  eq("group call starts", ack.ok, true);
  eq("both invitees ring", [s.b.got("call:incoming"), s.c.got("call:incoming")], [true, true]);
  eq(
    "the ring screen lists everyone invited",
    s.b.last("call:incoming")?.participants?.length,
    3
  );

  await s.b.send("call:accept", { callId: ack.callId });
  await tick();
  await s.a.send("call:media-state", {
    callId: ack.callId, state: { audio: true, video: false, screen: true },
  });
  await s.b.send("call:media-state", {
    callId: ack.callId, state: { audio: false, video: true, screen: false },
  });
  await s.c.send("call:accept", { callId: ack.callId });
  await tick();
  eq("late group joiner receives every existing participant's media state",
    s.c.all("call:media-state").map((p) => [p.userId, p.state]), [
      [alice.user.id, { audio: true, video: false, screen: true }],
      [bob.user.id, { audio: false, video: true, screen: false }],
    ]);

  // Every pair must agree on exactly one offerer.
  const pairs = [
    ["alice→bob", s.a.all("call:peer-joined").filter((p) => p.user.id === bob.user.id)],
    ["bob→alice", s.b.all("call:peer-joined").filter((p) => p.user.id === alice.user.id)],
    ["alice→carol", s.a.all("call:peer-joined").filter((p) => p.user.id === carol.user.id)],
    ["carol→alice", s.c.all("call:peer-joined").filter((p) => p.user.id === alice.user.id)],
    ["bob→carol", s.b.all("call:peer-joined").filter((p) => p.user.id === carol.user.id)],
    ["carol→bob", s.c.all("call:peer-joined").filter((p) => p.user.id === bob.user.id)],
  ];
  check(
    "all six mesh links are announced",
    pairs.every(([, list]) => list.length === 1),
    pairs.map(([n, l]) => `${n}:${l.length}`).join(" ")
  );
  const oneOfferer = (x, y) =>
    pairs.find(([n]) => n === x)[1][0]?.initiator !==
    pairs.find(([n]) => n === y)[1][0]?.initiator;
  check("alice/bob agree on one offerer", oneOfferer("alice→bob", "bob→alice"));
  check("alice/carol agree on one offerer", oneOfferer("alice→carol", "carol→alice"));
  check("bob/carol agree on one offerer", oneOfferer("bob→carol", "carol→bob"));

  // Chat fans out to the whole room.
  await s.a.send("chat:message", { callId: ack.callId, text: "hi both" });
  await tick();
  eq("group chat reaches everyone else", [
    s.b.all("chat:message").length,
    s.c.all("chat:message").length,
  ], [1, 1]);

  // One person leaving does not end a group call.
  await s.c.send("call:leave", { callId: ack.callId });
  await tick();
  check("remaining peers are told carol left", Boolean(s.a.last("call:peer-left")));
  eq(
    "the group call continues with two people",
    [s.a.got("call:ended"), s.b.got("call:ended")],
    [false, false]
  );

  // Dropping to one participant ends it.
  await s.b.send("call:leave", { callId: ack.callId });
  await tick();
  check("the call ends when only one person is left", s.a.got("call:ended"));

  const entry = store.historyFor(alice.user.id).find((h) => h.callId === ack.callId);
  eq("group call recorded as group", entry?.type, "group");
  eq("with all three participants", entry?.participantIds?.length, 3);
  await s.end();
}

heading("Group size limit");
{
  const s = await session({ a: alice });
  const many = ["u1", "u2", "u3", "u4", "u5", "u6", "u7"];
  const ack = await s.a.send("call:start", {
    calleeIds: many,
    video: false,
    type: "group",
  });
  eq("oversized group is refused", ack.ok, false);
  check("with an explanatory error", /up to 6/.test(ack?.error ?? ""), ack?.error);

  const ghosts = await s.a.send("call:start", {
    calleeIds: ["nope-not-a-user"],
    video: false,
    type: "direct",
  });
  eq("calling a nonexistent user is refused", ghosts.ok, false);

  const nobody = await s.a.send("call:start", { calleeIds: [], video: false, type: "direct" });
  eq("calling nobody is refused", nobody.ok, false);
  await s.end();
}

/* ========================================================== authorization */

heading("Authorization");
{
  const s = await session({ a: alice, b: bob, c: carol });
  const ack = await s.a.send("call:start", {
    calleeIds: [bob.user.id],
    video: false,
    type: "direct",
  });
  await tick();
  await s.b.send("call:accept", { callId: ack.callId });
  await tick();
  s.b.clear();

  // Carol is not in this call: her signaling must not be relayed.
  await s.c.send("webrtc:offer", {
    callId: ack.callId,
    toUserId: bob.user.id,
    sdp: { type: "offer", sdp: "v=0 hijack" },
  });
  await s.c.send("chat:message", { callId: ack.callId, text: "let me in" });
  await s.c.send("call:media-state", {
    callId: ack.callId,
    state: { audio: true, video: true, screen: true },
  });
  await tick();
  check("an outsider's SDP is dropped", !s.b.got("webrtc:offer"));
  check("an outsider's chat is dropped", !s.b.got("chat:message"));
  check("an outsider's media state is dropped", !s.b.got("call:media-state"));

  // Nor can an outsider accept or end someone else's call.
  const steal = await s.c.send("call:accept", { callId: ack.callId });
  eq("an outsider cannot accept the call", steal.ok, false);
  await s.c.send("call:cancel", { callId: ack.callId });
  await tick();
  check("an outsider cannot cancel the call", !s.a.got("call:ended"));

  await s.a.send("call:leave", { callId: ack.callId });
  await tick();
  await s.end();
}

/* ============================================================ ring timeout */

heading("Ring timeout");
{
  // socket.ts arms a 45s timer; shrink just that delay so the test is quick.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) =>
    realSetTimeout(fn, ms === 45_000 ? 30 : ms, ...rest);
  try {
    const s = await session({ a: alice, b: bob });
    const ack = await s.a.send("call:start", {
      calleeIds: [bob.user.id],
      video: false,
      type: "direct",
    });
    await sleep(80);
    const ended = s.a.last("call:ended");
    check("an unanswered call ends itself", Boolean(ended));
    eq("with reason 'No answer'", ended?.reason, "No answer");
    check("the callee stops ringing too", s.b.got("call:ended"));
    const entry = store.historyFor(bob.user.id).find((h) => h.callId === ack.callId);
    eq("history records a missed call", entry?.status, "missed");
    await s.end();

    // In a group, one straggler must not silence the people already talking.
    const g = await session({ a: alice, b: bob, c: carol });
    const gack = await g.a.send("call:start", {
      calleeIds: [bob.user.id, carol.user.id],
      video: false,
      type: "group",
    });
    await tick();
    await g.b.send("call:accept", { callId: gack.callId });
    await sleep(80);
    check("the straggler's invitation is retired", g.c.got("call:ended"));
    eq(
      "the people already talking stay connected",
      [g.a.got("call:ended"), g.b.got("call:ended")],
      [false, false]
    );
    await g.a.send("call:leave", { callId: gack.callId });
    await tick();
    await g.end();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

/* ====================================================== disconnect cleanup */

heading("Disconnect during a call");
{
  const s = await session({ a: alice, b: bob });
  const ack = await s.a.send("call:start", {
    calleeIds: [bob.user.id],
    video: false,
    type: "direct",
  });
  await tick();
  await s.b.send("call:accept", { callId: ack.callId });
  await tick();
  s.a.clear();

  s.b.disconnect();
  await tick();
  check("the surviving peer is told the call ended", s.a.got("call:ended"));
  // currentCallOf returns undefined once the record is gone; either way the
  // call must not be live.
  check(
    "no live call is left behind",
    store.currentCallOf(alice.user.id)?.ended !== false,
    JSON.stringify(store.currentCallOf(alice.user.id)?.ended)
  );
  check("alice is free to call again", !store.isBusy(alice.user.id));
  await s.end();
}

heading("Push notification on an incoming call");
{
  const s = await session({ a: alice, b: bob });
  // bob registered a web-push subscription and an Expo token over REST above.
  const ack = await s.a.send("call:start", {
    calleeIds: [bob.user.id],
    video: true,
    type: "direct",
  });
  await tick();
  check(
    "a call still rings in-app when push is disabled",
    s.b.got("call:incoming"),
    "VAPID keys are unset in this run, so delivery is skipped by design"
  );
  await s.a.send("call:cancel", { callId: ack.callId });
  await tick();
  await s.end();
}

/* ------------------------------------------------------------------ report */

console.log(`\n${"─".repeat(64)}`);
if (failures.length === 0) {
  console.log(`ALL GREEN — ${pass} assertions passed`);
} else {
  console.log(`${pass} passed, ${failures.length} FAILED:`);
  for (const f of failures) console.log(`  x ${f}`);
}
console.log(`${"─".repeat(64)}\n`);
process.exit(failures.length === 0 ? 0 : 1);
