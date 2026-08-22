# FreeCall web client

React 18 + TypeScript + Tailwind + Vite. Socket.IO for signaling, WebRTC for
media.

## Run it

```bash
npm run dev        # → http://localhost:5173
```

From the repo root, `npm run dev:web`. The server must be running on port 4000.

```bash
npm run build      # tsc -b, then vite build → dist/
npm run preview    # serve the build on :4173
npm run typecheck
```

`VITE_SERVER_URL` points the client at the server. Unset, it defaults to
`http://<current-hostname>:4000`, which is right for localhost *and* for a phone
loading the dev server over the LAN. Copy `.env.example` to `.env` to override.

Note that `tsconfig.json` enables `noUnusedLocals` and `noUnusedParameters`, so
a leftover import fails the build here — not just lint.

## Structure

There is no router. `App.tsx` picks a screen from the call phase, because in a
calling app the current screen *is* the call state and a URL that disagrees with
it is a bug waiting to happen:

```
loading  → spinner
no user  → LoginScreen
incoming → IncomingCallScreen   (caller avatar, ringtone, accept/decline)
outgoing → CallScreen           (ringing state)
active   → CallScreen           (media + controls + chat)
otherwise→ HomeScreen           (contacts with presence, call history)
```

| File | Responsibility |
|------|----------------|
| `state/AuthContext.tsx` | Session restore, login/register/logout, the authed socket. |
| `state/useCall.ts` | The whole call state machine and every socket handler. |
| `state/usePresence.ts` | Contact list plus live online/offline updates. |
| `lib/peer.ts` | `PeerManager` — one `RTCPeerConnection` per remote peer. |
| `lib/media.ts` | `getUserMedia`/`getDisplayMedia` wrappers, camera flipping, human-readable errors. |
| `lib/ringer.ts` | Ringtone playback with the autoplay-policy fallbacks. |
| `lib/push.ts` | Service worker registration, VAPID subscribe/unsubscribe, local notifications. |
| `lib/socket.ts` | Socket.IO client, typed against the shared event interfaces. |
| `public/sw.js` | Push handler: notification with Answer/Decline actions. Caches nothing on purpose. |

The Tailwind theme adds an `ink` (deep slate) and `accent` (indigo) palette plus
the `pulse-ring`, `slide-up` and `shimmer` animations the call UI uses. Sticking
to those tokens is what keeps the screens looking like one app.

## Things worth knowing before you edit

**Socket handlers must read refs, not state.** Two events can arrive in the same
websocket batch, so both handlers run before React re-renders and re-registers
the listeners. A handler closed over the old state value will make the wrong
decision — this is how `call:incoming` immediately followed by `call:canceled`
used to leave the phone ringing forever. `useCall.ts` mirrors `callId`,
`phase`, `incoming` and `chatOpen` into refs, assigned **synchronously** at every
`setState` call site rather than in an effect (an effect still lags by a render).
If you add state that a socket handler needs to read, mirror it the same way.

**Peers are built before the accept ack resolves.** The server emits
`call:peer-joined` before it answers `call:accept`, so the client constructs its
`PeerManager` synchronously on accept and buffers any signaling that arrives
early, replaying it once the manager is live.

**Rollback is only legal from `have-local-offer`.** The polite side of a
negotiation collision checks `signalingState` before calling
`setLocalDescription({type:"rollback"})`. Calling it from any other state throws,
and the caught exception would drop the incoming offer and stall that peer
permanently.

**Camera, flip and screen share never renegotiate.** Audio and video
transceivers are created up front, so these are all `sender.replaceTrack()`.
Resist the urge to `addTrack` mid-call.

**`getUserMedia` and service workers need a secure context.** `localhost` counts;
`http://192.168.x.x` does not. See the root README for how to test on a phone.
