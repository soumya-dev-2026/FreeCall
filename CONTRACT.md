# FreeCall — Signaling & API Contract

This is the **single source of truth** shared by the server, web client, and
mobile client. Every event name and payload shape below must match across all
three packages. The TypeScript definitions in `shared/types.ts` mirror this
document — if you change one, change both.

The transport is:

- **REST (HTTP)** for auth, user lists, call history, push subscriptions, and
  ICE server configuration.
- **Socket.IO** for realtime presence, call setup/teardown, WebRTC signaling,
  in-call chat, and media-state changes.
- **WebRTC** peer connections (mesh topology) for the actual audio/video/screen
  media. The server never touches media — it only relays SDP/ICE.

---

## 1. Data models

```ts
User {
  id: string;
  username: string;        // unique login handle
  displayName: string;
  avatarUrl: string;       // URL or data URI shown on the incoming-call screen
  online: boolean;         // derived from socket presence
  lastSeen: number | null; // epoch ms
}

PublicUser = Omit<User, "online" | "lastSeen"> & { online: boolean; lastSeen: number | null }

CallType = "direct" | "group"
CallStatus = "completed" | "missed" | "rejected" | "canceled"
MediaState { audio: boolean; video: boolean; screen: boolean }

ChatMessage {
  id: string;
  callId: string;
  from: { id: string; displayName: string; avatarUrl: string };
  text: string;
  ts: number;             // epoch ms
}

CallHistoryEntry {
  id: string;
  callId: string;
  type: CallType;
  initiatorId: string;
  participantIds: string[];
  participants: { id: string; displayName: string; avatarUrl: string }[];
  video: boolean;
  status: CallStatus;
  startedAt: number;      // epoch ms
  answeredAt: number | null;
  endedAt: number | null;
  durationSec: number;    // 0 if never answered
}
```

---

## 2. REST API  (base path: `/api`)

All authed routes require `Authorization: Bearer <jwt>`.

| Method | Path                      | Auth | Body                                             | Response |
|--------|---------------------------|------|--------------------------------------------------|----------|
| POST   | `/auth/register`          | no   | `{ username, displayName, password, avatarUrl? }`| `{ token, user }` |
| POST   | `/auth/login`             | no   | `{ username, password }`                         | `{ token, user }` |
| GET    | `/auth/me`                | yes  | —                                                | `{ user }` |
| GET    | `/users`                  | yes  | —                                                | `{ users: PublicUser[] }` (excludes self) |
| GET    | `/users/:id`              | yes  | —                                                | `{ user: PublicUser }` |
| GET    | `/history`                | yes  | —                                                | `{ history: CallHistoryEntry[] }` (newest first) |
| GET    | `/config/ice`             | yes  | —                                                | `{ iceServers: RTCIceServer[] }` |
| GET    | `/push/vapidPublicKey`    | no   | —                                                | `{ key: string \| null }` |
| POST   | `/push/subscribe`         | yes  | `{ subscription: PushSubscriptionJSON }`         | `{ ok: true }` |
| POST   | `/push/unsubscribe`       | yes  | `{ endpoint: string }`                           | `{ ok: true }` |
| POST   | `/push/expo/register`     | yes  | `{ token: string }` (Expo push token)            | `{ ok: true }` |
| POST   | `/push/expo/unregister`   | yes  | `{ token: string }`                              | `{ ok: true }` |

Errors use HTTP status codes with `{ error: string }` bodies.

---

## 3. Socket.IO

### Connection / auth
Client connects with the JWT in the handshake:

```ts
io(SERVER_URL, { auth: { token } })
```

The server verifies the JWT, attaches `userId` to the socket, and joins a
per-user room named `user:<userId>` so it can address a user across devices.
If the token is missing/invalid the connection is rejected with
`connect_error`.

### Presence

| Direction | Event | Payload | Notes |
|-----------|-------|---------|-------|
| S→C | `presence:state` | `{ online: string[] }` | Sent once right after connect: all currently-online user ids. |
| S→C | `presence:update` | `{ userId, online, lastSeen }` | Broadcast whenever anyone connects/disconnects. |

### Call lifecycle

A "call" is a room identified by `callId`. Both direct and group calls use the
same events; a direct call is just a room that starts with two participants.

| Direction | Event | Payload | Notes |
|-----------|-------|---------|-------|
| C→S | `call:start` | `{ calleeIds: string[]; video: boolean; type: CallType }` | Ack: `{ ok, callId, iceServers, participants }` or `{ ok:false, error }`. |
| S→C | `call:incoming` | `{ callId, type, video, from: PublicUser, participants: PublicUser[], startedAt }` | Sent to each callee. |
| C→S | `call:accept` | `{ callId }` | Ack: `{ ok, iceServers, participants }`. Server then notifies peers. |
| C→S | `call:reject` | `{ callId, reason? }` | Server tells the room the callee rejected. |
| C→S | `call:cancel` | `{ callId }` | Caller aborts before it's answered. |
| C→S | `call:leave`  | `{ callId }` | Leave an active call (also used to hang up). |
| S→C | `call:ringing` | `{ callId, userId }` | A callee's device is now ringing. |
| S→C | `call:accepted` | `{ callId, user: PublicUser }` | Someone accepted; sent to existing participants. |
| S→C | `call:peer-joined` | `{ callId, user: PublicUser, initiator: boolean }` | A new peer is in the room. `initiator` tells THIS client whether it should create the offer to that peer (glare-free rule, see §4). |
| S→C | `call:peer-left` | `{ callId, userId }` | A peer left; tear down that RTCPeerConnection. |
| S→C | `call:rejected` | `{ callId, userId, reason? }` | A callee rejected. |
| S→C | `call:canceled` | `{ callId }` | Caller canceled the ring. |
| S→C | `call:ended` | `{ callId, reason }` | The whole call is over (last peer left / server teardown). Also used to retire a *ringing* invitation — see "Ending a ring" below. |
| S→C | `call:busy` | `{ callId, userId }` | A callee was already in another call. |

### Ending a ring

Because `call:incoming` goes to a user's room, every device that user is signed
in on rings. `call:ended` is what retires an invitation, so a client must handle
it while it is still in the `incoming` phase (matching on the ringing `callId`,
not just the active one) and stop its ringtone. The server sends it in three
situations beyond a normal hangup:

| `reason` | Sent to | Why |
|----------|---------|-----|
| `Answered on another device` | the accepting user's *other* sockets | One device picked up; the rest must stop ringing. |
| `Declined on another device` | the declining user's *other* sockets | Same, for a decline. Matters most in group calls, where the call itself continues. |
| `No answer` | invitees who never picked up | The ring timeout (45s) fired. Before the first answer this ends the whole call as `missed`; afterwards it only retires the stragglers and leaves the people already talking connected. |


### WebRTC signaling (relayed verbatim, per peer)

| Direction | Event | Payload |
|-----------|-------|---------|
| C→S | `webrtc:offer`  | `{ callId, toUserId, sdp }` |
| S→C | `webrtc:offer`  | `{ callId, fromUserId, sdp }` |
| C→S | `webrtc:answer` | `{ callId, toUserId, sdp }` |
| S→C | `webrtc:answer` | `{ callId, fromUserId, sdp }` |
| C→S | `webrtc:ice`    | `{ callId, toUserId, candidate }` |
| S→C | `webrtc:ice`    | `{ callId, fromUserId, candidate }` |

### In-call chat

| Direction | Event | Payload |
|-----------|-------|---------|
| C→S | `chat:message` | `{ callId, text }` |
| S→C | `chat:message` | `ChatMessage` (relayed to the rest of the room) |

### Media state (for mute / camera-off / screen-share indicators)

| Direction | Event | Payload |
|-----------|-------|---------|
| C→S | `call:media-state` | `{ callId, state: MediaState }` |
| S→C | `call:media-state` | `{ callId, userId, state: MediaState }` |

---

## 4. Glare-free mesh negotiation rule

For any pair of peers **(A, B)** exactly one side creates the SDP offer, to
avoid offer/offer "glare". The rule:

> The peer whose `userId` is **lexicographically smaller** is the **initiator**
> for that pair and creates the offer. The other side waits for it.

The server computes this per recipient and sets the `initiator` flag on
`call:peer-joined` so each client knows what to do without extra coordination.
Screen-sharing, mute, and camera toggles that require renegotiation reuse the
same initiator direction.

---

## 5. Environment / infra-dependent features

- **STUN/TURN**: `GET /api/config/ice` returns whatever is configured via env
  (`STUN_URLS`, `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`). A public STUN
  server is used by default; a TURN server is required for calls that cross
  strict NATs/firewalls.
- **Web Push**: enabled only when `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are
  set. `GET /api/push/vapidPublicKey` returns `null` when disabled so clients
  can degrade gracefully.
- **Mobile push (Expo)**: the RN client registers an Expo push token via
  `POST /api/push/expo/register`; the server delivers through Expo's push
  service with a plain HTTPS POST, so no server-side keys are needed. Requires
  a development/production build (not Expo Go) and, for Android, an FCM key
  uploaded to your Expo project. See `mobile/README.md`.
- **Screen sharing on mobile**: Android only (MediaProjection). iOS requires a
  Broadcast Upload Extension, which `expo prebuild` can't generate, so the RN
  client hides the button on iOS.
