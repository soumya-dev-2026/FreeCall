/**
 * FreeCall — shared types.
 *
 * This file is the TypeScript mirror of CONTRACT.md and is copied into each
 * package (server/src/shared, web/src/shared, mobile/src/shared) so all three
 * agree on event names and payloads. Keep them identical.
 */

/* ------------------------------------------------------------------ models */

export type CallType = "direct" | "group";
export type CallStatus = "completed" | "missed" | "rejected" | "canceled";

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  online: boolean;
  lastSeen: number | null;
}

export interface AuthUser extends PublicUser {}

export interface MediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
}

export interface ChatMessage {
  id: string;
  callId: string;
  from: { id: string; displayName: string; avatarUrl: string };
  text: string;
  ts: number;
}

export interface CallHistoryEntry {
  id: string;
  callId: string;
  type: CallType;
  initiatorId: string;
  participantIds: string[];
  participants: { id: string; displayName: string; avatarUrl: string }[];
  video: boolean;
  status: CallStatus;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  durationSec: number;
}

/* -------------------------------------------------------------- REST types */

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface IceConfigResponse {
  iceServers: RTCIceServer[];
}

/* ------------------------------------------------ socket: server -> client */

export interface ServerToClientEvents {
  "presence:state": (p: { online: string[] }) => void;
  "presence:update": (p: {
    userId: string;
    online: boolean;
    lastSeen: number | null;
  }) => void;

  "call:incoming": (p: {
    callId: string;
    type: CallType;
    video: boolean;
    from: PublicUser;
    participants: PublicUser[];
    startedAt: number;
  }) => void;
  "call:ringing": (p: { callId: string; userId: string }) => void;
  "call:accepted": (p: { callId: string; user: PublicUser }) => void;
  "call:peer-joined": (p: {
    callId: string;
    user: PublicUser;
    initiator: boolean;
  }) => void;
  "call:peer-left": (p: { callId: string; userId: string }) => void;
  "call:rejected": (p: {
    callId: string;
    userId: string;
    reason?: string;
  }) => void;
  "call:canceled": (p: { callId: string }) => void;
  "call:ended": (p: { callId: string; reason: string }) => void;
  "call:busy": (p: { callId: string; userId: string }) => void;

  "webrtc:offer": (p: {
    callId: string;
    fromUserId: string;
    sdp: RTCSessionDescriptionInit;
  }) => void;
  "webrtc:answer": (p: {
    callId: string;
    fromUserId: string;
    sdp: RTCSessionDescriptionInit;
  }) => void;
  "webrtc:ice": (p: {
    callId: string;
    fromUserId: string;
    candidate: RTCIceCandidateInit;
  }) => void;

  "chat:message": (m: ChatMessage) => void;
  "call:media-state": (p: {
    callId: string;
    userId: string;
    state: MediaState;
  }) => void;
}

/* ------------------------------------------------ socket: client -> server */

export interface StartCallAck {
  ok: boolean;
  error?: string;
  callId?: string;
  iceServers?: RTCIceServer[];
  participants?: PublicUser[];
}

export interface AcceptCallAck {
  ok: boolean;
  error?: string;
  iceServers?: RTCIceServer[];
  participants?: PublicUser[];
}

export interface ClientToServerEvents {
  "call:start": (
    p: { calleeIds: string[]; video: boolean; type: CallType },
    ack: (res: StartCallAck) => void
  ) => void;
  "call:accept": (
    p: { callId: string },
    ack: (res: AcceptCallAck) => void
  ) => void;
  "call:reject": (p: { callId: string; reason?: string }) => void;
  "call:cancel": (p: { callId: string }) => void;
  "call:leave": (p: { callId: string }) => void;

  "webrtc:offer": (p: {
    callId: string;
    toUserId: string;
    sdp: RTCSessionDescriptionInit;
  }) => void;
  "webrtc:answer": (p: {
    callId: string;
    toUserId: string;
    sdp: RTCSessionDescriptionInit;
  }) => void;
  "webrtc:ice": (p: {
    callId: string;
    toUserId: string;
    candidate: RTCIceCandidateInit;
  }) => void;

  "chat:message": (p: { callId: string; text: string }) => void;
  "call:media-state": (p: { callId: string; state: MediaState }) => void;
}

/* --------------------------------------------------- socket: server internals */

/**
 * Both are required by Socket.IO's four type parameters on the server side.
 * `InterServerEvents` is empty because there's only one node; `SocketData`
 * carries the authenticated user id set during the handshake, which is what
 * lets every handler trust `socket.data.userId` instead of a client-sent id.
 */
export interface InterServerEvents {}

export interface SocketData {
  userId: string;
}
