/**
 * useCall (mobile) — single source of truth for call state.
 *
 * Mirrors web/src/state/useCall.ts, including the important bit: the server
 * emits `call:peer-joined` *before* the `call:accept` ack, so the PeerManager
 * is created synchronously (from ICE servers cached at launch) before we emit,
 * and anything that still arrives early is buffered and replayed.
 *
 * Mobile-specific differences:
 *   - Camera flip is an in-place native swap (`_switchCamera`), so unlike the
 *     web there is no track replacement and no renegotiation at all.
 *   - The screen stays awake for the duration of a call.
 *   - Screen sharing is Android-only (see lib/media.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from "expo-keep-awake";
import type { MediaStream, MediaStreamTrack } from "react-native-webrtc";
import { PeerManager } from "../lib/peer";
import {
  canShareScreen,
  getCameraTrack,
  getLocalStream,
  getScreenStream,
  stopStream,
  switchCamera,
} from "../lib/media";
import {
  configureAudioSession,
  pulse,
  startRinging,
  stopRinging,
} from "../lib/ringer";
import { api } from "../lib/api";
import { dismissCallNotifications } from "../lib/push";
import type { AppSocket } from "../lib/socket";
import type {
  CallType,
  ChatMessage,
  MediaState,
  PublicUser,
} from "../shared/types";

export type CallPhase = "idle" | "incoming" | "outgoing" | "active";

export interface Participant {
  user: PublicUser;
  stream: MediaStream | null;
  media: MediaState;
  connState: string;
}

export interface IncomingCall {
  callId: string;
  type: CallType;
  video: boolean;
  from: PublicUser;
  participants: PublicUser[];
}

interface BufferedSignal {
  kind: "peer-joined" | "offer" | "answer" | "ice";
  userId: string;
  initiator?: boolean;
  user?: PublicUser;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

const DEFAULT_MEDIA: MediaState = { audio: true, video: false, screen: false };

export function useCall(socket: AppSocket | null, selfId: string | null) {
  /* ------------------------------------------------------------- state */
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [callType, setCallType] = useState<CallType>("direct");
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [participants, setParticipants] = useState<Record<string, Participant>>(
    {}
  );
  const [ringingUsers, setRingingUsers] = useState<PublicUser[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localVersion, setLocalVersion] = useState(0);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [frontCamera, setFrontCamera] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  const canFlip = true; // Every phone we support has at least two cameras.
  const canShare = canShareScreen();

  /* --------------------------------------------------------------- refs */
  const managerRef = useRef<PeerManager | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const bufferRef = useRef<BufferedSignal[]>([]);
  const callIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const parkedCameraRef = useRef<MediaStreamTrack | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const phaseRef = useRef<CallPhase>("idle");
  const chatOpenRef = useRef(false);
  const incomingRef = useRef<IncomingCall | null>(null);

  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);
  useEffect(() => {
    incomingRef.current = incoming;
  }, [incoming]);

  // Cache ICE servers once so PeerManager can be built without awaiting.
  useEffect(() => {
    if (!selfId) return;
    api
      .iceConfig()
      .then(({ iceServers }) => {
        iceServersRef.current = iceServers;
      })
      .catch(() => {
        iceServersRef.current = [{ urls: ["stun:stun.l.google.com:19302"] }];
      });
  }, [selfId]);

  /* ------------------------------------------------- duration ticker */
  useEffect(() => {
    if (phase !== "active" || startedAt === null) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => clearInterval(t);
  }, [phase, startedAt]);

  /* ----------------------------------------------- keep screen awake */
  useEffect(() => {
    if (phase === "idle") return;
    void activateKeepAwakeAsync("freecall");
    return () => {
      try {
        deactivateKeepAwake("freecall");
      } catch {
        /* ignore */
      }
    };
  }, [phase]);

  /* ------------------------------------------------------- teardown */

  const resetCallState = useCallback(() => {
    void stopRinging();
    void dismissCallNotifications();

    managerRef.current?.closeAll();
    managerRef.current = null;
    bufferRef.current = [];

    stopStream(screenStreamRef.current);
    screenStreamRef.current = null;
    if (parkedCameraRef.current) {
      try {
        parkedCameraRef.current.stop();
      } catch {
        /* ignore */
      }
      parkedCameraRef.current = null;
    }
    stopStream(localStreamRef.current);
    localStreamRef.current = null;

    setLocalStream(null);
    setParticipants({});
    setRingingUsers([]);
    setMessages([]);
    setUnread(0);
    setStartedAt(null);
    setCallId(null);
    incomingRef.current = null;
    setIncoming(null);
    setPhase("idle");
    setMicOn(true);
    setCamOn(false);
    setScreenOn(false);
    setFrontCamera(true);
    void configureAudioSession(false);
  }, []);

  /* ------------------------------------------- peer manager plumbing */

  const emitMediaState = useCallback(
    (state: MediaState) => {
      const id = callIdRef.current;
      if (socket && id) socket.emit("call:media-state", { callId: id, state });
    },
    [socket]
  );

  const ensureManager = useCallback((): PeerManager => {
    if (managerRef.current) return managerRef.current;

    const mgr = new PeerManager(iceServersRef.current, {
      onStream: (userId, stream) => {
        setParticipants((prev) => {
          const existing = prev[userId];
          if (!existing) return prev;
          return { ...prev, [userId]: { ...existing, stream } };
        });
      },
      onState: (userId, state) => {
        setParticipants((prev) => {
          const existing = prev[userId];
          if (!existing) return prev;
          return { ...prev, [userId]: { ...existing, connState: state } };
        });
      },
      onOffer: (userId, sdp) => {
        const id = callIdRef.current;
        if (socket && id)
          socket.emit("webrtc:offer", { callId: id, toUserId: userId, sdp });
      },
      onAnswer: (userId, sdp) => {
        const id = callIdRef.current;
        if (socket && id)
          socket.emit("webrtc:answer", { callId: id, toUserId: userId, sdp });
      },
      onIce: (userId, candidate) => {
        const id = callIdRef.current;
        if (socket && id)
          socket.emit("webrtc:ice", { callId: id, toUserId: userId, candidate });
      },
    });

    managerRef.current = mgr;
    return mgr;
  }, [socket]);

  /** Replay signals that arrived before the manager existed. */
  const flushBuffer = useCallback(async () => {
    const mgr = managerRef.current;
    if (!mgr) return;
    const queued = bufferRef.current.splice(0);
    for (const sig of queued) {
      if (sig.kind === "peer-joined" && sig.user) {
        const joined = sig.user;
        setParticipants((prev) =>
          prev[sig.userId]
            ? prev
            : {
                ...prev,
                [sig.userId]: {
                  user: joined,
                  stream: null,
                  media: { ...DEFAULT_MEDIA },
                  connState: "new",
                },
              }
        );
        await mgr.addPeer(sig.userId, Boolean(sig.initiator));
      } else if (sig.kind === "offer" && sig.sdp) {
        await mgr.handleOffer(sig.userId, sig.sdp);
      } else if (sig.kind === "answer" && sig.sdp) {
        await mgr.handleAnswer(sig.userId, sig.sdp);
      } else if (sig.kind === "ice" && sig.candidate) {
        await mgr.handleIce(sig.userId, sig.candidate);
      }
    }
  }, []);

  /* ------------------------------------------------------ local media */

  const acquireLocal = useCallback(
    async (wantVideo: boolean) => {
      await configureAudioSession(true);
      const media = await getLocalStream(wantVideo);
      localStreamRef.current = media.stream;
      setLocalStream(media.stream);
      setLocalVersion((v) => v + 1);

      setMicOn(Boolean(media.audio?.enabled));
      setCamOn(Boolean(media.video));
      setFrontCamera(true);
      if (media.videoDegraded) {
        setStatusNote("Camera unavailable — continuing with audio only.");
      }

      const mgr = ensureManager();
      await mgr.setLocalTracks({ audio: media.audio, video: media.video });
      return media;
    },
    [ensureManager]
  );

  /* ------------------------------------------------------ start a call */

  const startCall = useCallback(
    async (callees: PublicUser[], video: boolean) => {
      if (!socket || !selfId) {
        setError("Not connected to the server.");
        return;
      }
      if (!callees.length) return;
      if (phaseRef.current !== "idle") {
        setError("You're already in a call.");
        return;
      }

      setError(null);
      setStatusNote(null);
      const type: CallType = callees.length > 1 ? "group" : "direct";

      try {
        // Media first — no point ringing if we can't capture.
        ensureManager();
        await acquireLocal(video);

        setCallType(type);
        setIsVideoCall(video);
        setRingingUsers(callees);
        setPhase("outgoing");
        void startRinging(false);

        socket.emit(
          "call:start",
          { calleeIds: callees.map((c) => c.id), video, type },
          (ack) => {
            if (!ack.ok || !ack.callId) {
              setError(ack.error ?? "Could not start the call.");
              resetCallState();
              return;
            }
            setCallId(ack.callId);
            callIdRef.current = ack.callId;
            if (ack.iceServers?.length) {
              iceServersRef.current = ack.iceServers;
              managerRef.current?.setIceServers(ack.iceServers);
            }
            emitMediaState({
              audio: micOn,
              video: Boolean(localStreamRef.current?.getVideoTracks().length),
              screen: false,
            });
            void flushBuffer();
          }
        );
      } catch (err) {
        setError((err as Error).message);
        resetCallState();
      }
    },
    [
      socket,
      selfId,
      ensureManager,
      acquireLocal,
      resetCallState,
      emitMediaState,
      micOn,
      flushBuffer,
    ]
  );

  /* ----------------------------------------------------- accept/reject */

  const acceptCall = useCallback(async () => {
    const inc = incomingRef.current;
    if (!socket || !inc) return;

    await stopRinging();
    void dismissCallNotifications();
    setError(null);
    setStatusNote(null);

    try {
      // Manager + callId must exist before we emit: peer-joined arrives first.
      setCallId(inc.callId);
      callIdRef.current = inc.callId;
      setCallType(inc.type);
      setIsVideoCall(inc.video);
      ensureManager();
      await acquireLocal(inc.video);

      socket.emit("call:accept", { callId: inc.callId }, (ack) => {
        if (!ack.ok) {
          setError(ack.error ?? "Could not join the call.");
          resetCallState();
          return;
        }
        if (ack.iceServers?.length) {
          iceServersRef.current = ack.iceServers;
          managerRef.current?.setIceServers(ack.iceServers);
        }
        setIncoming(null);
        incomingRef.current = null;
        setPhase("active");
        setStartedAt(Date.now());
        pulse();
        emitMediaState({
          audio: true,
          video: Boolean(localStreamRef.current?.getVideoTracks().length),
          screen: false,
        });
        void flushBuffer();
      });
    } catch (err) {
      setError((err as Error).message);
      // Let the caller know we couldn't pick up.
      socket.emit("call:reject", {
        callId: inc.callId,
        reason: "Could not access microphone",
      });
      resetCallState();
    }
  }, [
    socket,
    ensureManager,
    acquireLocal,
    resetCallState,
    emitMediaState,
    flushBuffer,
  ]);

  const rejectCall = useCallback(() => {
    const inc = incomingRef.current;
    if (!socket || !inc) return;
    socket.emit("call:reject", { callId: inc.callId });
    resetCallState();
  }, [socket, resetCallState]);

  /* --------------------------------------------------------- hang up */

  const hangUp = useCallback(() => {
    const id = callIdRef.current;
    if (socket && id) {
      if (phaseRef.current === "outgoing")
        socket.emit("call:cancel", { callId: id });
      else socket.emit("call:leave", { callId: id });
    }
    pulse();
    resetCallState();
  }, [socket, resetCallState]);

  /* -------------------------------------------------------- controls */

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    const next = !track.enabled;
    track.enabled = next;
    setMicOn(next);
    emitMediaState({ audio: next, video: camOn, screen: screenOn });
  }, [emitMediaState, camOn, screenOn]);

  const toggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const mgr = managerRef.current;

    if (screenOn) {
      setStatusNote("Stop screen sharing first to use your camera.");
      return;
    }

    const existing = stream.getVideoTracks()[0];

    if (existing && camOn) {
      // Turn off: stop and remove the track so the camera indicator clears.
      try {
        existing.stop();
      } catch {
        /* ignore */
      }
      stream.removeTrack(existing);
      await mgr?.replaceVideoTrack(null);
      setCamOn(false);
      setLocalVersion((v) => v + 1);
      emitMediaState({ audio: micOn, video: false, screen: false });
      return;
    }

    // Turn on: acquire a fresh camera track.
    try {
      const track = await getCameraTrack();
      stream.getVideoTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
        stream.removeTrack(t);
      });
      stream.addTrack(track);
      await mgr?.replaceVideoTrack(track);
      setCamOn(true);
      setIsVideoCall(true);
      setFrontCamera(true);
      setLocalVersion((v) => v + 1);
      emitMediaState({ audio: micOn, video: true, screen: false });
    } catch (err) {
      setStatusNote((err as Error).message);
    }
  }, [camOn, screenOn, micOn, emitMediaState]);

  /**
   * Flip the camera.
   *
   * `_switchCamera()` mutates the existing native track, so the sender, the
   * transceiver and the SDP are all untouched — nothing to renegotiate.
   */
  const flipCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream || !camOn || screenOn) return;
    const track = stream.getVideoTracks()[0] ?? null;
    const ok = await switchCamera(track);
    if (ok) {
      setFrontCamera((f) => !f);
      setLocalVersion((v) => v + 1);
    } else {
      setStatusNote("Could not switch camera on this device.");
    }
  }, [camOn, screenOn]);

  const toggleScreenShare = useCallback(async () => {
    const stream = localStreamRef.current;
    const mgr = managerRef.current;
    if (!stream || !mgr) return;

    // ---- stop sharing: restore the parked camera track (if any) ----
    if (screenOn) {
      stopStream(screenStreamRef.current);
      screenStreamRef.current = null;
      stream.getVideoTracks().forEach((t) => stream.removeTrack(t));

      const parked = parkedCameraRef.current;
      parkedCameraRef.current = null;
      if (parked) {
        parked.enabled = true;
        stream.addTrack(parked);
        await mgr.replaceVideoTrack(parked);
        setCamOn(true);
        emitMediaState({ audio: micOn, video: true, screen: false });
      } else {
        await mgr.replaceVideoTrack(null);
        setCamOn(false);
        emitMediaState({ audio: micOn, video: false, screen: false });
      }
      setScreenOn(false);
      setLocalVersion((v) => v + 1);
      return;
    }

    // ---- start sharing ----
    try {
      const display = await getScreenStream();
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) return;
      screenStreamRef.current = display;

      // Park the camera track rather than stopping it, so we can come back.
      const cam = stream.getVideoTracks()[0] ?? null;
      if (cam) {
        parkedCameraRef.current = cam;
        stream.removeTrack(cam);
        cam.enabled = false;
      }
      stream.addTrack(screenTrack);
      await mgr.replaceVideoTrack(screenTrack);

      setScreenOn(true);
      setCamOn(false);
      setIsVideoCall(true);
      setLocalVersion((v) => v + 1);
      emitMediaState({ audio: micOn, video: false, screen: true });
    } catch (err) {
      setStatusNote((err as Error).message);
    }
  }, [screenOn, micOn, emitMediaState]);

  /* ------------------------------------------------------------- chat */

  const sendMessage = useCallback(
    (text: string) => {
      const id = callIdRef.current;
      const clean = text.trim();
      if (!socket || !id || !clean || !selfId) return;

      socket.emit("chat:message", { callId: id, text: clean });
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          callId: id,
          from: { id: selfId, displayName: "You", avatarUrl: "" },
          text: clean,
          ts: Date.now(),
        },
      ]);
    },
    [socket, selfId]
  );

  const setChatOpen = useCallback((open: boolean) => {
    chatOpenRef.current = open;
    if (open) setUnread(0);
  }, []);

  /* -------------------------------------------------- socket handlers */

  useEffect(() => {
    if (!socket) return;

    const onIncoming = (p: {
      callId: string;
      type: CallType;
      video: boolean;
      from: PublicUser;
      participants: PublicUser[];
    }) => {
      // Already busy? Politely decline so the caller isn't left hanging.
      if (phaseRef.current !== "idle") {
        socket.emit("call:reject", { callId: p.callId, reason: "Busy" });
        return;
      }
      const inc: IncomingCall = {
        callId: p.callId,
        type: p.type,
        video: p.video,
        from: p.from,
        participants: p.participants,
      };
      // Ref first and synchronously: `call:incoming` and an immediately
      // following `call:canceled` can arrive in the same websocket batch, i.e.
      // before React commits. The effect-based mirror would still hold `null`
      // at that point and the cancel would be dropped by the callId guard,
      // leaving the phone ringing forever.
      incomingRef.current = inc;
      setIncoming(inc);
      setCallType(p.type);
      setIsVideoCall(p.video);
      setPhase("incoming");
      void startRinging(true);
    };

    const onRinging = (p: { callId: string; userId: string }) => {
      if (callIdRef.current && p.callId !== callIdRef.current) return;
      // The server only emits this once a callee's devices were actually
      // reachable, so this is the honest point to claim their phone is ringing.
      if (phaseRef.current === "outgoing") setStatusNote("Ringing…");
    };

    const onAccepted = (p: { callId: string; user: PublicUser }) => {
      if (p.callId !== callIdRef.current) return;
      void stopRinging();
      pulse();
      setRingingUsers((prev) => prev.filter((u) => u.id !== p.user.id));
      setPhase((prev) => (prev === "outgoing" ? "active" : prev));
      setStartedAt((prev) => prev ?? Date.now());
    };

    const onPeerJoined = async (p: {
      callId: string;
      user: PublicUser;
      initiator: boolean;
    }) => {
      if (callIdRef.current && p.callId !== callIdRef.current) return;

      setParticipants((prev) =>
        prev[p.user.id]
          ? prev
          : {
              ...prev,
              [p.user.id]: {
                user: p.user,
                stream: null,
                media: { ...DEFAULT_MEDIA },
                connState: "new",
              },
            }
      );
      setRingingUsers((prev) => prev.filter((u) => u.id !== p.user.id));

      const mgr = managerRef.current;
      if (!mgr) {
        bufferRef.current.push({
          kind: "peer-joined",
          userId: p.user.id,
          user: p.user,
          initiator: p.initiator,
        });
        return;
      }
      // Re-publish live state for newcomers, including older signaling servers
      // that don't replay state sent before the participant answered.
      const local = localStreamRef.current;
      if (local && callIdRef.current) {
        const screen = Boolean(screenStreamRef.current);
        socket.emit("call:media-state", {
          callId: callIdRef.current,
          state: {
            audio: Boolean(local.getAudioTracks()[0]?.enabled),
            video: !screen && Boolean(local.getVideoTracks()[0]?.enabled),
            screen,
          },
        });
      }
      await mgr.addPeer(p.user.id, p.initiator);
    };

    const onPeerLeft = (p: { callId: string; userId: string }) => {
      if (p.callId !== callIdRef.current) return;
      managerRef.current?.removePeer(p.userId);
      setParticipants((prev) => {
        const next = { ...prev };
        const who = next[p.userId];
        delete next[p.userId];
        if (who) setStatusNote(`${who.user.displayName} left the call.`);
        return next;
      });
    };

    const onRejected = (p: {
      callId: string;
      userId: string;
      reason?: string;
    }) => {
      if (p.callId !== callIdRef.current) return;
      setRingingUsers((prev) => {
        const who = prev.find((u) => u.id === p.userId);
        if (who) {
          setStatusNote(
            `${who.displayName} ${
              p.reason === "Busy" ? "is on another call" : "declined"
            }.`
          );
        }
        return prev.filter((u) => u.id !== p.userId);
      });
    };

    const onBusy = (p: { callId: string; userId: string }) => {
      if (callIdRef.current && p.callId !== callIdRef.current) return;
      setRingingUsers((prev) => {
        const who = prev.find((u) => u.id === p.userId);
        if (who) setStatusNote(`${who.displayName} is on another call.`);
        return prev.filter((u) => u.id !== p.userId);
      });
    };

    const onCanceled = (p: { callId: string }) => {
      if (
        p.callId !== incomingRef.current?.callId &&
        p.callId !== callIdRef.current
      )
        return;
      setStatusNote("Call canceled.");
      resetCallState();
      setHistoryVersion((v) => v + 1);
    };

    const onEnded = (p: { callId: string; reason: string }) => {
      if (
        p.callId !== callIdRef.current &&
        p.callId !== incomingRef.current?.callId
      )
        return;
      setStatusNote(p.reason || "Call ended.");
      resetCallState();
      setHistoryVersion((v) => v + 1);
    };

    const onOffer = async (p: {
      callId: string;
      fromUserId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (callIdRef.current && p.callId !== callIdRef.current) return;
      const mgr = managerRef.current;
      if (!mgr) {
        bufferRef.current.push({
          kind: "offer",
          userId: p.fromUserId,
          sdp: p.sdp,
        });
        return;
      }
      await mgr.handleOffer(p.fromUserId, p.sdp);
    };

    const onAnswer = async (p: {
      callId: string;
      fromUserId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (callIdRef.current && p.callId !== callIdRef.current) return;
      const mgr = managerRef.current;
      if (!mgr) {
        bufferRef.current.push({
          kind: "answer",
          userId: p.fromUserId,
          sdp: p.sdp,
        });
        return;
      }
      await mgr.handleAnswer(p.fromUserId, p.sdp);
    };

    const onIce = async (p: {
      callId: string;
      fromUserId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      if (callIdRef.current && p.callId !== callIdRef.current) return;
      const mgr = managerRef.current;
      if (!mgr) {
        bufferRef.current.push({
          kind: "ice",
          userId: p.fromUserId,
          candidate: p.candidate,
        });
        return;
      }
      await mgr.handleIce(p.fromUserId, p.candidate);
    };

    const onChat = (m: ChatMessage) => {
      if (m.callId !== callIdRef.current) return;
      setMessages((prev) => [...prev, m]);
      if (!chatOpenRef.current) setUnread((n) => n + 1);
    };

    const onMediaState = (p: {
      callId: string;
      userId: string;
      state: MediaState;
    }) => {
      if (p.callId !== callIdRef.current) return;
      setParticipants((prev) => {
        const existing = prev[p.userId];
        if (!existing) return prev;
        return { ...prev, [p.userId]: { ...existing, media: p.state } };
      });
    };

    socket.on("call:incoming", onIncoming);
    socket.on("call:ringing", onRinging);
    socket.on("call:accepted", onAccepted);
    socket.on("call:peer-joined", onPeerJoined);
    socket.on("call:peer-left", onPeerLeft);
    socket.on("call:rejected", onRejected);
    socket.on("call:busy", onBusy);
    socket.on("call:canceled", onCanceled);
    socket.on("call:ended", onEnded);
    socket.on("webrtc:offer", onOffer);
    socket.on("webrtc:answer", onAnswer);
    socket.on("webrtc:ice", onIce);
    socket.on("chat:message", onChat);
    socket.on("call:media-state", onMediaState);

    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:ringing", onRinging);
      socket.off("call:accepted", onAccepted);
      socket.off("call:peer-joined", onPeerJoined);
      socket.off("call:peer-left", onPeerLeft);
      socket.off("call:rejected", onRejected);
      socket.off("call:busy", onBusy);
      socket.off("call:canceled", onCanceled);
      socket.off("call:ended", onEnded);
      socket.off("webrtc:offer", onOffer);
      socket.off("webrtc:answer", onAnswer);
      socket.off("webrtc:ice", onIce);
      socket.off("chat:message", onChat);
      socket.off("call:media-state", onMediaState);
    };
  }, [socket, resetCallState]);

  /* ----------------------------------- re-arm the ringer on foreground */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      // Coming back to a still-ringing call: expo-av may have been suspended.
      if (state === "active" && phaseRef.current === "incoming") {
        void startRinging(true);
      }
    });
    return () => sub.remove();
  }, []);

  /* ------------------------------------------------ unmount cleanup */
  useEffect(() => resetCallState, [resetCallState]);

  /* ------------------------------------------- auto-clear status note */
  useEffect(() => {
    if (!statusNote) return;
    const t = setTimeout(() => setStatusNote(null), 4200);
    return () => clearTimeout(t);
  }, [statusNote]);

  const participantList = useMemo(
    () => Object.values(participants),
    [participants]
  );

  return {
    // state
    phase,
    callId,
    callType,
    isVideoCall,
    incoming,
    participants: participantList,
    ringingUsers,
    localStream,
    localVersion,
    micOn,
    camOn,
    screenOn,
    frontCamera,
    canFlip,
    canShare,
    messages,
    unread,
    elapsed,
    error,
    statusNote,
    historyVersion,
    // actions
    startCall,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMic,
    toggleCamera,
    flipCamera,
    toggleScreenShare,
    sendMessage,
    setChatOpen,
    clearError: () => setError(null),
  };
}

export type CallController = ReturnType<typeof useCall>;
