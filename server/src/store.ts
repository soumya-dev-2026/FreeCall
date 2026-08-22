/**
 * In-memory data store.
 *
 * Everything lives in process memory and resets on restart (per the chosen
 * setup). The shape mirrors what a real DB layer would expose, so swapping in
 * Prisma/Mongo later is mostly a matter of reimplementing these functions.
 */

import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import type {
  CallHistoryEntry,
  CallStatus,
  CallType,
  ChatMessage,
  MediaState,
  PublicUser,
} from "./shared/types";

/* ---------------------------------------------------------------- users */

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  avatarUrl: string;
  lastSeen: number | null;
}

const users = new Map<string, UserRecord>();
const usersByUsername = new Map<string, string>(); // lowercase username -> id

/** socket ids per user — a user may be connected from several devices. */
const sockets = new Map<string, Set<string>>();

/** Deterministic, pleasant default avatar so the incoming-call screen always
 *  has a real image to show. DiceBear renders an SVG from the seed. */
export function defaultAvatar(seed: string): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
    seed
  )}&backgroundType=gradientLinear`;
}

export function createUser(input: {
  username: string;
  displayName: string;
  password: string;
  avatarUrl?: string;
}): UserRecord {
  const key = input.username.toLowerCase();
  if (usersByUsername.has(key)) {
    throw Object.assign(new Error("Username already taken"), { status: 409 });
  }
  const rec: UserRecord = {
    id: uuid(),
    username: input.username,
    displayName: input.displayName || input.username,
    passwordHash: bcrypt.hashSync(input.password, 10),
    avatarUrl: input.avatarUrl?.trim() || defaultAvatar(input.username),
    lastSeen: null,
  };
  users.set(rec.id, rec);
  usersByUsername.set(key, rec.id);
  return rec;
}

export function findUserByUsername(username: string): UserRecord | undefined {
  const id = usersByUsername.get(username.toLowerCase());
  return id ? users.get(id) : undefined;
}

export function findUser(id: string): UserRecord | undefined {
  return users.get(id);
}

export function verifyPassword(rec: UserRecord, password: string): boolean {
  return bcrypt.compareSync(password, rec.passwordHash);
}

export function isOnline(userId: string): boolean {
  const s = sockets.get(userId);
  return !!s && s.size > 0;
}

export function toPublicUser(rec: UserRecord): PublicUser {
  return {
    id: rec.id,
    username: rec.username,
    displayName: rec.displayName,
    avatarUrl: rec.avatarUrl,
    online: isOnline(rec.id),
    lastSeen: rec.lastSeen,
  };
}

export function publicUser(id: string): PublicUser | undefined {
  const rec = users.get(id);
  return rec ? toPublicUser(rec) : undefined;
}

export function allUsers(): PublicUser[] {
  return [...users.values()]
    .map(toPublicUser)
    .sort((a, b) =>
      a.online === b.online
        ? a.displayName.localeCompare(b.displayName)
        : a.online
        ? -1
        : 1
    );
}

export function onlineUserIds(): string[] {
  return [...users.keys()].filter(isOnline);
}

/* ------------------------------------------------------------- presence */

/** @returns true if this is the user's FIRST socket (i.e. they just came online) */
export function addSocket(userId: string, socketId: string): boolean {
  let set = sockets.get(userId);
  if (!set) {
    set = new Set();
    sockets.set(userId, set);
  }
  const wasEmpty = set.size === 0;
  set.add(socketId);
  return wasEmpty;
}

/** @returns true if that was the user's LAST socket (i.e. they went offline) */
export function removeSocket(userId: string, socketId: string): boolean {
  const set = sockets.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    const rec = users.get(userId);
    if (rec) rec.lastSeen = Date.now();
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------- calls */

export interface CallRecord {
  id: string;
  type: CallType;
  video: boolean;
  initiatorId: string;
  /** everyone invited (initiator included) */
  invitedIds: Set<string>;
  /** everyone who accepted and is currently connected */
  activeIds: Set<string>;
  /** who explicitly rejected */
  rejectedIds: Set<string>;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  ended: boolean;
  messages: ChatMessage[];
  mediaState: Map<string, MediaState>;
  /** ring timeout handle, cleared on answer/cancel */
  ringTimer: NodeJS.Timeout | null;
}

const calls = new Map<string, CallRecord>();
/** userId -> callId, so we can detect "busy" and clean up on disconnect. */
const userCall = new Map<string, string>();

export function createCall(input: {
  type: CallType;
  video: boolean;
  initiatorId: string;
  calleeIds: string[];
}): CallRecord {
  const rec: CallRecord = {
    id: uuid(),
    type: input.type,
    video: input.video,
    initiatorId: input.initiatorId,
    invitedIds: new Set([input.initiatorId, ...input.calleeIds]),
    activeIds: new Set([input.initiatorId]),
    rejectedIds: new Set(),
    startedAt: Date.now(),
    answeredAt: null,
    endedAt: null,
    ended: false,
    messages: [],
    mediaState: new Map(),
    ringTimer: null,
  };
  calls.set(rec.id, rec);
  userCall.set(input.initiatorId, rec.id);
  return rec;
}

export function getCall(callId: string): CallRecord | undefined {
  return calls.get(callId);
}

export function currentCallOf(userId: string): CallRecord | undefined {
  const id = userCall.get(userId);
  return id ? calls.get(id) : undefined;
}

/** A user is "busy" if they're already active in a live call. */
export function isBusy(userId: string): boolean {
  const call = currentCallOf(userId);
  return !!call && !call.ended && call.activeIds.has(userId);
}

export function joinCall(callId: string, userId: string): void {
  const call = calls.get(callId);
  if (!call) return;
  call.activeIds.add(userId);
  call.rejectedIds.delete(userId);
  userCall.set(userId, callId);
  if (call.answeredAt === null) call.answeredAt = Date.now();
}

export function leaveCall(callId: string, userId: string): void {
  const call = calls.get(callId);
  if (!call) return;
  call.activeIds.delete(userId);
  if (userCall.get(userId) === callId) userCall.delete(userId);
}

export function markRejected(callId: string, userId: string): void {
  const call = calls.get(callId);
  if (!call) return;
  call.rejectedIds.add(userId);
  call.activeIds.delete(userId);
  if (userCall.get(userId) === callId) userCall.delete(userId);
}

export function endCall(callId: string): CallRecord | undefined {
  const call = calls.get(callId);
  if (!call || call.ended) return call;
  call.ended = true;
  call.endedAt = Date.now();
  if (call.ringTimer) {
    clearTimeout(call.ringTimer);
    call.ringTimer = null;
  }
  for (const uid of call.invitedIds) {
    if (userCall.get(uid) === callId) userCall.delete(uid);
  }
  call.activeIds.clear();
  return call;
}

export function addMessage(
  callId: string,
  from: UserRecord,
  text: string
): ChatMessage | undefined {
  const call = calls.get(callId);
  if (!call) return undefined;
  const msg: ChatMessage = {
    id: uuid(),
    callId,
    from: {
      id: from.id,
      displayName: from.displayName,
      avatarUrl: from.avatarUrl,
    },
    text,
    ts: Date.now(),
  };
  call.messages.push(msg);
  return msg;
}

export function setMediaState(
  callId: string,
  userId: string,
  state: MediaState
): void {
  calls.get(callId)?.mediaState.set(userId, state);
}

/* -------------------------------------------------------------- history */

/** userId -> entries (newest first) */
const history = new Map<string, CallHistoryEntry[]>();

export function recordHistory(call: CallRecord, status: CallStatus): void {
  const participantIds = [...call.invitedIds];
  const participants = participantIds.map((id) => {
    const u = users.get(id);
    return {
      id,
      displayName: u?.displayName ?? "Unknown",
      avatarUrl: u?.avatarUrl ?? defaultAvatar(id),
    };
  });

  const answered = call.answeredAt;
  const ended = call.endedAt ?? Date.now();
  const durationSec = answered
    ? Math.max(0, Math.round((ended - answered) / 1000))
    : 0;

  const base: Omit<CallHistoryEntry, "id"> = {
    callId: call.id,
    type: call.type,
    initiatorId: call.initiatorId,
    participantIds,
    participants,
    video: call.video,
    status,
    startedAt: call.startedAt,
    answeredAt: answered,
    endedAt: ended,
    durationSec,
  };

  // One entry per participant so each user's history is independent.
  for (const uid of participantIds) {
    const entry: CallHistoryEntry = { id: uuid(), ...base };
    const arr = history.get(uid) ?? [];
    arr.unshift(entry);
    // keep memory bounded
    history.set(uid, arr.slice(0, 200));
  }
}

export function historyFor(userId: string): CallHistoryEntry[] {
  return history.get(userId) ?? [];
}

/* ----------------------------------------------------------------- push */

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const pushSubs = new Map<string, PushSub[]>();

export function addPushSub(userId: string, sub: PushSub): void {
  const arr = pushSubs.get(userId) ?? [];
  if (!arr.some((s) => s.endpoint === sub.endpoint)) arr.push(sub);
  pushSubs.set(userId, arr);
}

export function removePushSub(userId: string, endpoint: string): void {
  const arr = pushSubs.get(userId) ?? [];
  pushSubs.set(
    userId,
    arr.filter((s) => s.endpoint !== endpoint)
  );
}

export function pushSubsFor(userId: string): PushSub[] {
  return pushSubs.get(userId) ?? [];
}

/* ------------------------------------------------------ expo push tokens */

/**
 * The mobile client can't use Web Push — it registers an Expo push token
 * instead, which the server delivers through Expo's push service. Stored
 * separately from Web Push subscriptions because the transport differs.
 */
const expoTokens = new Map<string, string[]>();

export function addExpoToken(userId: string, token: string): void {
  const arr = expoTokens.get(userId) ?? [];
  if (!arr.includes(token)) arr.push(token);
  expoTokens.set(userId, arr);
}

export function removeExpoToken(userId: string, token: string): void {
  const arr = expoTokens.get(userId) ?? [];
  expoTokens.set(
    userId,
    arr.filter((t) => t !== token)
  );
}

export function expoTokensFor(userId: string): string[] {
  return expoTokens.get(userId) ?? [];
}

/* ------------------------------------------------------------ dev seed */

/** Seed a couple of demo accounts so the app is usable immediately. */
export function seedDemoUsers(): void {
  const demo = [
    { username: "alice", displayName: "Alice Nguyen", password: "password" },
    { username: "bob", displayName: "Bob Martinez", password: "password" },
    { username: "carol", displayName: "Carol Smith", password: "password" },
  ];
  for (const d of demo) {
    if (!findUserByUsername(d.username)) createUser(d);
  }
}
