# FreeCall server

Signaling and REST API. Express for HTTP, Socket.IO for realtime, JWT for auth,
plain `Map`s for storage. It relays SDP and ICE between peers and never touches
media.

## Run it

```bash
cp .env.example .env      # optional: every value has a dev default
npm run dev               # tsx watch, restarts on save
```

From the repo root, `npm run dev:server` does the same thing.

```bash
npm run build && npm start   # tsc → dist/, then plain node
npm run typecheck            # tsc --noEmit
npm run genkeys              # generate a VAPID keypair for web push
```

On start it seeds `alice`, `bob` and `carol` (password `password`) and prints
the allowed origins, so a mismatched `CLIENT_ORIGINS` is visible immediately
rather than as a silent CORS failure in the browser.

`GET /health` returns `{ ok, uptime }` without auth, for probes.

## Files

| File | Responsibility |
|------|----------------|
| `index.ts` | Express + Socket.IO wiring, CORS policy, graceful shutdown. |
| `config.ts` | Env parsing; `iceServers()` builds the STUN/TURN list clients receive. |
| `auth.ts` | bcrypt password hashing, JWT sign/verify. |
| `routes.ts` | All `/api` routes (auth, users, history, ICE config, push subscriptions). |
| `socket.ts` | The call lifecycle: ring, accept, reject, cancel, leave, relay, chat, media state. |
| `store.ts` | Every read and write of application state. In-memory. |
| `push.ts` | Web Push (VAPID) and Expo push delivery, best-effort. |
| `shared/types.ts` | Verbatim copy of `../../shared/types.ts`. Do not edit here. |

## Things worth knowing before you edit

**`socket.data.userId` is the only identity that's trusted.** It's set once
during the handshake from the verified JWT. No handler reads a user id out of a
client payload — that's what makes the WebRTC relay guard meaningful, since a
client can otherwise claim to be forwarding on someone else's behalf.

**Users are addressed by room, not by socket.** Every connection joins
`user:<id>`, so `io.to(room(id)).emit(...)` reaches all of a user's devices, and
`socket.to(room(id)).emit(...)` reaches all of them *except* the one that acted.
That asymmetry is exactly what "stop ringing on my other phones" needs.

**Storage is in-memory and that's the design.** `store.ts` holds users, sockets,
calls, chat messages and history in `Map`s, so a restart is a clean slate. Every
mutation goes through a named function there, which is the seam to replace if
you want persistence; nothing outside `store.ts` reaches into the data
structures.

**Call teardown ordering.** `finishCall` calls `endCall` before `recordHistory`
so that history records the real `endedAt` rather than a re-derived one —
`recordHistory` falls back to `Date.now()` if the stamp is missing, so getting
this backwards is a millisecond of drift rather than a broken entry, but there's
no reason to accept it. What *is* load-bearing is the `call.ended` guard at the
top: without it, plus the matching check in `handleLeave`, a second hang-up
writes a second history entry and fires `call:ended` twice. Either guard alone
is enough, which is why `tools/harness/faults.py` has to remove both to
demonstrate the failure.

**The ring timeout re-arms.** `armRingTimeout` is called on `call:start`, and
again on every accept and reject. Before the first answer, firing it ends the
whole call as missed. After an answer, it only clears out invitees who never
picked up — without the re-arm, the first answer in a group call would cancel
the only timer and leave the stragglers ringing forever. It cancels itself when
nobody is left ringing, so a fully connected call holds no timer.

**Push is best-effort.** `sendPushToUser` never rejects into a handler; a dead
subscription is pruned and a failed send is logged. A call must ring on a
foreground client whether or not push works.

## Testing

From the repo root, `npm test` runs every file in this directory — unmodified,
against a fake Socket.IO — through the call lifecycles in `CONTRACT.md`. It
needs no `node_modules`, so it works before you've installed anything. See
`tools/harness/README.md`.
