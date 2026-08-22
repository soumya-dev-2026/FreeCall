/**
 * Socket.IO signaling.
 *
 * Responsibilities:
 *   - authenticate sockets via JWT and track presence
 *   - orchestrate the call lifecycle (ring / accept / reject / cancel / leave)
 *   - relay WebRTC SDP + ICE between specific peers
 *   - relay in-call chat and media-state changes
 *   - record call history and fire push notifications
 *
 * The server never touches media. See CONTRACT.md for the event catalogue.
 */

import type { Server, Socket } from "socket.io";
import { iceServers } from "./config";
import { verifyToken } from "./auth";
import { sendPushToUser } from "./push";
import {
  addSocket,
  createCall,
  currentCallOf,
  endCall,
  findUser,
  getCall,
  isBusy,
  joinCall,
  leaveCall,
  markRejected,
  onlineUserIds,
  publicUser,
  recordHistory,
  removeSocket,
  setMediaState,
  addMessage,
  type CallRecord,
} from "./store";
import type {
  ClientToServerEvents,
  InterServerEvents,
  PublicUser,
  ServerToClientEvents,
  SocketData,
} from "./shared/types";

export type IOServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
type IOSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** How long a call rings before being marked missed (ms). */
const RING_TIMEOUT_MS = 45_000;
/** Max group size (initiator + peers). Mesh topology gets heavy beyond this. */
const MAX_PARTICIPANTS = 6;

const room = (userId: string) => `user:${userId}`;
const callRoom = (callId: string) => `call:${callId}`;

/**
 * Glare-free rule (see CONTRACT.md §4): for a pair of peers, the one with the
 * lexicographically smaller id creates the offer.
 */
function isInitiatorFor(selfId: string, otherId: string): boolean {
  return selfId < otherId;
}

export function registerSocketHandlers(io: IOServer): void {
  /* ------------------------------------------------------------- auth */
  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization as string | undefined)?.replace(
        /^Bearer /,
        ""
      );
    if (!token) return next(new Error("Missing auth token"));
    try {
      const payload = verifyToken(token);
      if (!findUser(payload.sub)) return next(new Error("Unknown user"));
      socket.data.userId = payload.sub;
      return next();
    } catch {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket: IOSocket) => {
    const userId = socket.data.userId;
    const me = findUser(userId);
    if (!me) {
      socket.disconnect(true);
      return;
    }

    socket.join(room(userId));
    const cameOnline = addSocket(userId, socket.id);

    // Tell this client who's online, and tell everyone else about this user.
    socket.emit("presence:state", { online: onlineUserIds() });
    if (cameOnline) {
      io.emit("presence:update", { userId, online: true, lastSeen: null });
    }

    /* ------------------------------------------------------ helpers */

    /** Everyone in the call except `exceptId`, as public users. */
    const participantsOf = (call: CallRecord, exceptId?: string): PublicUser[] =>
      [...call.activeIds]
        .filter((id) => id !== exceptId)
        .map((id) => publicUser(id))
        .filter((u): u is PublicUser => !!u);

    /**
     * Stop this user's OTHER devices from ringing.
     *
     * `call:incoming` is sent to the user's room, so every device they're
     * signed in on rings. Once one device answers or declines, the rest must
     * be told or they ring forever. `socket.to(room)` excludes the socket that
     * acted, which is exactly the set we want. We reuse `call:ended` rather
     * than inventing an event: the client's handler already tears down its
     * incoming-call state, and the reason string is displayable.
     */
    const stopRingingElsewhere = (callId: string, reason: string) => {
      socket.to(room(userId)).emit("call:ended", { callId, reason });
    };

    /** Finish a call: notify the room, record history, clean up. */
    const finishCall = (
      call: CallRecord,
      status: "completed" | "missed" | "rejected" | "canceled",
      reason: string
    ) => {
      if (call.ended) return;
      const invited = [...call.invitedIds];
      endCall(call.id);
      recordHistory(call, status);
      for (const uid of invited) {
        io.to(room(uid)).emit("call:ended", { callId: call.id, reason });
      }
      io.socketsLeave(callRoom(call.id));
    };

    /**
     * (Re-)arm the "nobody answered" timeout.
     *
     * Before the first answer it turns the whole call into a missed call. After
     * an answer it only clears out the invitees who never picked up, leaving
     * the people already talking alone — without this, a group invitee who
     * never answers rings forever, because the first answer used to cancel the
     * only timer. It self-cancels when nobody is left ringing, so a fully
     * connected call holds no timer.
     */
    const armRingTimeout = (call: CallRecord) => {
      if (call.ringTimer) {
        clearTimeout(call.ringTimer);
        call.ringTimer = null;
      }
      if (call.ended) return;
      const ringing = [...call.invitedIds].filter(
        (id) => !call.activeIds.has(id) && !call.rejectedIds.has(id)
      );
      if (!ringing.length) return;

      call.ringTimer = setTimeout(() => {
        const fresh = getCall(call.id);
        if (!fresh || fresh.ended) return;
        fresh.ringTimer = null;

        if (fresh.answeredAt === null) {
          finishCall(fresh, "missed", "No answer");
          return;
        }
        for (const id of [...fresh.invitedIds]) {
          if (fresh.activeIds.has(id) || fresh.rejectedIds.has(id)) continue;
          markRejected(fresh.id, id);
          io.to(room(id)).emit("call:ended", {
            callId: fresh.id,
            reason: "No answer",
          });
        }
      }, RING_TIMEOUT_MS);
    };

    /* -------------------------------------------------- call:start */

    socket.on("call:start", (payload, ack) => {
      const respond = typeof ack === "function" ? ack : () => {};
      const calleeIds = Array.isArray(payload?.calleeIds)
        ? [...new Set(payload.calleeIds.filter((id) => id && id !== userId))]
        : [];

      if (!calleeIds.length) {
        return respond({ ok: false, error: "No one to call" });
      }
      if (calleeIds.length + 1 > MAX_PARTICIPANTS) {
        return respond({
          ok: false,
          error: `Group calls support up to ${MAX_PARTICIPANTS} participants`,
        });
      }
      if (isBusy(userId)) {
        return respond({ ok: false, error: "You are already in a call" });
      }
      const unknown = calleeIds.filter((id) => !findUser(id));
      if (unknown.length) {
        return respond({ ok: false, error: "Some users no longer exist" });
      }

      const type = payload.type === "group" || calleeIds.length > 1
        ? "group"
        : "direct";
      const video = Boolean(payload.video);

      const call = createCall({
        type,
        video,
        initiatorId: userId,
        calleeIds,
      });
      socket.join(callRoom(call.id));

      const fromUser = publicUser(userId)!;
      const allInvited = [...call.invitedIds]
        .map((id) => publicUser(id))
        .filter((u): u is PublicUser => !!u);

      // Ring each callee (all their devices), or report busy.
      for (const calleeId of calleeIds) {
        if (isBusy(calleeId)) {
          markRejected(call.id, calleeId);
          socket.emit("call:busy", { callId: call.id, userId: calleeId });
          continue;
        }

        io.to(room(calleeId)).emit("call:incoming", {
          callId: call.id,
          type,
          video,
          from: fromUser,
          participants: allInvited,
          startedAt: call.startedAt,
        });
        socket.emit("call:ringing", { callId: call.id, userId: calleeId });

        // Push notification for devices that aren't in the foreground.
        void sendPushToUser(calleeId, {
          title: `Incoming ${video ? "video" : "audio"} call`,
          body: `${fromUser.displayName} is calling you`,
          icon: fromUser.avatarUrl,
          tag: `call-${call.id}`,
          data: { callId: call.id, type: "incoming-call", from: fromUser },
        });
      }

      // If every callee was busy, the call is over before it began.
      const anyRingable = calleeIds.some((id) => !call.rejectedIds.has(id));
      if (!anyRingable) {
        finishCall(call, "rejected", "All participants are busy");
        return respond({ ok: false, error: "All participants are busy" });
      }

      // Auto-miss if nobody answers.
      armRingTimeout(call);

      return respond({
        ok: true,
        callId: call.id,
        iceServers: iceServers(),
        participants: allInvited.filter((u) => u.id !== userId),
      });
    });

    /* ------------------------------------------------- call:accept */

    socket.on("call:accept", (payload, ack) => {
      const respond = typeof ack === "function" ? ack : () => {};
      const call = getCall(payload?.callId ?? "");

      if (!call || call.ended) {
        return respond({ ok: false, error: "Call is no longer available" });
      }
      if (!call.invitedIds.has(userId)) {
        return respond({ ok: false, error: "You were not invited" });
      }

      // Busy check ignores this call itself (e.g. accepting from a 2nd device).
      const existing = currentCallOf(userId);
      if (existing && existing.id !== call.id && !existing.ended) {
        return respond({ ok: false, error: "You are already in a call" });
      }

      if (call.ringTimer) {
        clearTimeout(call.ringTimer);
        call.ringTimer = null;
      }

      const peersBefore = participantsOf(call, userId);
      joinCall(call.id, userId);
      socket.join(callRoom(call.id));

      // Everyone else signed in as this user should stop ringing now.
      stopRingingElsewhere(call.id, "Answered on another device");

      // Re-arm for anyone still ringing: in a group call the first answer must
      // not silence the invitees who haven't picked up yet. Clears itself when
      // that set is empty, which is the normal 1-to-1 case.
      armRingTimeout(call);

      const meUser = publicUser(userId)!;

      // Existing participants learn about the newcomer...
      for (const peer of peersBefore) {
        io.to(room(peer.id)).emit("call:accepted", {
          callId: call.id,
          user: meUser,
        });
        io.to(room(peer.id)).emit("call:peer-joined", {
          callId: call.id,
          user: meUser,
          initiator: isInitiatorFor(peer.id, userId),
        });
      }

      // ...and the newcomer learns about them.
      for (const peer of peersBefore) {
        socket.emit("call:peer-joined", {
          callId: call.id,
          user: peer,
          initiator: isInitiatorFor(userId, peer.id),
        });
      }

      return respond({
        ok: true,
        iceServers: iceServers(),
        participants: peersBefore,
      });
    });

    /* ------------------------------------------------- call:reject */

    socket.on("call:reject", (payload) => {
      const call = getCall(payload?.callId ?? "");
      if (!call || call.ended) return;
      if (!call.invitedIds.has(userId)) return;

      markRejected(call.id, userId);
      stopRingingElsewhere(call.id, "Declined on another device");
      for (const uid of call.invitedIds) {
        if (uid === userId) continue;
        io.to(room(uid)).emit("call:rejected", {
          callId: call.id,
          userId,
          reason: payload?.reason,
        });
      }

      // Direct call, or nobody left to ring/talk → end it.
      const stillPossible = [...call.invitedIds].some(
        (id) => id !== call.initiatorId && !call.rejectedIds.has(id)
      );
      if (call.type === "direct" || !stillPossible) {
        if (call.answeredAt === null) {
          finishCall(call, "rejected", "Call declined");
        } else if (call.activeIds.size <= 1) {
          finishCall(call, "completed", "Call ended");
        }
      }

      // One fewer phone ringing; drop the timeout if that was the last one.
      armRingTimeout(call);
    });

    /* ------------------------------------------------- call:cancel */

    socket.on("call:cancel", (payload) => {
      const call = getCall(payload?.callId ?? "");
      if (!call || call.ended) return;
      if (call.initiatorId !== userId) return;

      for (const uid of call.invitedIds) {
        if (uid === userId) continue;
        io.to(room(uid)).emit("call:canceled", { callId: call.id });
      }
      finishCall(
        call,
        call.answeredAt === null ? "canceled" : "completed",
        "Call canceled"
      );
    });

    /* -------------------------------------------------- call:leave */

    socket.on("call:leave", (payload) => {
      handleLeave(payload?.callId ?? "");
    });

    const handleLeave = (callId: string) => {
      const call = getCall(callId);
      if (!call || call.ended) return;
      if (!call.invitedIds.has(userId)) return;

      const wasActive = call.activeIds.has(userId);
      leaveCall(call.id, userId);
      socket.leave(callRoom(call.id));

      if (wasActive) {
        for (const uid of call.activeIds) {
          io.to(room(uid)).emit("call:peer-left", { callId: call.id, userId });
        }
      }

      // Initiator hanging up before an answer == cancel.
      if (call.answeredAt === null) {
        if (call.initiatorId === userId) {
          for (const uid of call.invitedIds) {
            if (uid === userId) continue;
            io.to(room(uid)).emit("call:canceled", { callId: call.id });
          }
          finishCall(call, "canceled", "Caller hung up");
        }
        return;
      }

      // Fewer than two people left means there's no call anymore.
      if (call.activeIds.size < 2) {
        finishCall(call, "completed", "Call ended");
      }
    };

    /* -------------------------------------------- webrtc relaying */

    const relayGuard = (callId: string, toUserId: string): boolean => {
      const call = getCall(callId);
      if (!call || call.ended) return false;
      // Both sides must belong to the call.
      return call.invitedIds.has(userId) && call.invitedIds.has(toUserId);
    };

    socket.on("webrtc:offer", ({ callId, toUserId, sdp }) => {
      if (!relayGuard(callId, toUserId)) return;
      io.to(room(toUserId)).emit("webrtc:offer", {
        callId,
        fromUserId: userId,
        sdp,
      });
    });

    socket.on("webrtc:answer", ({ callId, toUserId, sdp }) => {
      if (!relayGuard(callId, toUserId)) return;
      io.to(room(toUserId)).emit("webrtc:answer", {
        callId,
        fromUserId: userId,
        sdp,
      });
    });

    socket.on("webrtc:ice", ({ callId, toUserId, candidate }) => {
      if (!relayGuard(callId, toUserId)) return;
      io.to(room(toUserId)).emit("webrtc:ice", {
        callId,
        fromUserId: userId,
        candidate,
      });
    });

    /* ---------------------------------------------------- in-call chat */

    socket.on("chat:message", ({ callId, text }) => {
      const call = getCall(callId);
      if (!call || call.ended) return;
      if (!call.activeIds.has(userId)) return;
      const clean = typeof text === "string" ? text.trim().slice(0, 2000) : "";
      if (!clean) return;

      const msg = addMessage(callId, me, clean);
      if (!msg) return;
      // Relay to everyone else in the call; sender renders optimistically.
      for (const uid of call.activeIds) {
        if (uid === userId) continue;
        io.to(room(uid)).emit("chat:message", msg);
      }
    });

    /* --------------------------------------------------- media state */

    socket.on("call:media-state", ({ callId, state }) => {
      const call = getCall(callId);
      if (!call || call.ended) return;
      if (!call.activeIds.has(userId)) return;

      const clean = {
        audio: Boolean(state?.audio),
        video: Boolean(state?.video),
        screen: Boolean(state?.screen),
      };
      setMediaState(callId, userId, clean);
      for (const uid of call.activeIds) {
        if (uid === userId) continue;
        io.to(room(uid)).emit("call:media-state", {
          callId,
          userId,
          state: clean,
        });
      }
    });

    /* ----------------------------------------------------- disconnect */

    socket.on("disconnect", () => {
      const wentOffline = removeSocket(userId, socket.id);

      // Only tear the user out of their call when their LAST device drops.
      if (wentOffline) {
        const call = currentCallOf(userId);
        if (call && !call.ended) handleLeave(call.id);

        const rec = findUser(userId);
        io.emit("presence:update", {
          userId,
          online: false,
          lastSeen: rec?.lastSeen ?? Date.now(),
        });
      }
    });
  });
}
