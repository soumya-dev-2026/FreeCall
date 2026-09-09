# The call-lifecycle test harness

This runs the **real** server code — `server/src/socket.ts`, `routes.ts`,
`store.ts`, `auth.ts`, `push.ts`, `config.ts`, imported unmodified — and asserts
the behaviour `CONTRACT.md` promises. 113 assertions, about a second, and
**no `node_modules`**: it needs nothing but Node 22.

```bash
npm test                              # from the repo root
python3 tools/harness/faults.py       # prove the suite still has teeth
```

## Why it needs no dependencies

Two things make this possible.

Node 22 strips TypeScript types at runtime (`--experimental-strip-types`), and
`import type` is erased entirely — so `socket.io` and `express` cost nothing at
run time, because the server only imports *types* from them. What's left is a
short list of packages the server genuinely calls: `bcryptjs`, `jsonwebtoken`,
`uuid`, `dotenv`, `web-push`, and `express` (for `Router`). Those are the files
in `shims/`, each a faithful but minimal stand-in — `bcryptjs` really hashes
(scrypt), `jsonwebtoken` really signs and verifies HS256.

`hooks.mjs` then does the wiring, via `module.registerHooks`: bare specifiers
resolve to those shims, and extensionless relative imports get `.ts` appended.
That second part is needed because a `.ts` file under a `package.json` with no
`"type"` field loads as ESM, where `import "./store"` is not a valid specifier.

## The pieces

| File | What it is |
| --- | --- |
| `run.mjs` | The suite: fixtures, assertions, and the report |
| `fakeio.mjs` | A fake Socket.IO server — `io.use`, rooms, acks, and the three emit targets |
| `hooks.mjs` | Module resolution: shims for bare imports, `.ts` for relative ones |
| `shims/*.mjs` | Minimal stand-ins for the six packages the server calls at run time |
| `faults.py` | Mutation testing: breaks a copy of the server, requires the suite to notice |

`fakeio.mjs` is careful about one asymmetry the app depends on:
`io.to(room).emit` reaches every socket in the room, while
`socket.to(room).emit` reaches every socket **except the one acting**. That is
exactly what stops your other devices from ringing once you answer on one of
them, so the fake has to model it or the multi-device tests would pass
vacuously.

## What it covers

REST auth and registration, the socket handshake and presence, the 1-to-1
lifecycle (ring → accept → offer/answer/ICE relay → media state → chat → hang
up), call history, decline, cancel, busy, multi-device answer and decline, group
mesh negotiation and its 6-participant cap, authorization (an outsider's
signaling, chat and control messages are all dropped), the 45-second ring
timeout, disconnect cleanup, and push degrading quietly when it isn't
configured.

Time is not faked wholesale — the suite only shortens the one 45-second ring
timer, by patching `setTimeout` to collapse exactly that duration:

```js
globalThis.setTimeout = (fn, ms, ...rest) =>
  realSetTimeout(fn, ms === 45_000 ? 30 : ms, ...rest);
```

## faults.py

A green suite proves nothing unless a broken server turns it red, so `faults.py`
copies `server/src` to a temp directory, injects one known regression, and runs
the suite against the copy. Every fault must produce at least one red
assertion; the unmodified control must stay green. The real tree is only ever
read.

Two things worth knowing if you add a fault. It refuses to run when the anchor
text matches more than once — an ambiguous injection silently patches the wrong
handler and looks like a gap in the suite. And some guards are deliberately
redundant: `handleLeave` and `finishCall` both check `call.ended`, so removing
either one alone changes no behaviour at all. That fault removes both.

## Limits

This exercises the signaling server, not media. There is no `RTCPeerConnection`
here: SDP and ICE payloads are opaque strings, and the suite checks that they
reach the right peer untouched, not that they describe a valid session. Client negotiation has a separate regression suite:

```bash
npm run test:media
```

This requires the workspace TypeScript dependency and exercises both real peer
managers against a model of WebRTC channel association. Eight cases cover web
and mobile offerer/answerer combinations, audio/video negotiation, camera
replacement, and camera upgrades in audio-only calls. It catches the original
answerer bug where microphone and camera tracks used unnegotiated channels.
It does not verify actual RTP packets, physical microphones/cameras, browser
autoplay, or native audio routing.

Before release, call between two devices in both directions. Confirm both
people hear speech and see moving video; test mute/unmute, camera off/on,
camera flip, and hangup. Repeat across Wi-Fi and mobile data with TURN
configured. If the browser shows “Tap to hear call audio”, activate it and
confirm sound resumes.
