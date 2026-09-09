/**
 * useCall — the single source of truth for call state.
 *
 * Wires together: Socket.IO signaling, the WebRTC PeerManager, local media,
 * the ringtone, in-call chat, and notifications.
 *
 * A note on ordering: the server emits `call:peer-joined` *before* the
 * `call:accept` acknowledgement arrives, so the PeerManager is created
 * synchronously (using ICE servers cached at app start) before we emit, and any
 * signal that still arrives early is buffered and replayed. That buffering is
 * what makes joining reliable rather than racy.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PeerManager } from "../lib/peer";
import {
  canFlipCamera,
  getDisplayStream,
  getFlippedVideoTrack,
  getLocalStream,
  stopStream,
  type Facing,
} from "../lib/media";
import { ringer, stopVibrate, vibrateIncoming } from "../lib/ringer";
import {
  createVirtualBackground,
  type BackgroundMode,
  type VirtualBackgroundProcessor,
} from "../lib/virtualBackground";
import { api } from "../lib/api";
import {
  clearCallNotification,
  showLocalCallNotification,
} from "../lib/push";
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
  connState: RTCPeerConnectionState | "new";
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
  /** Everyone we invited who hasn't answered yet (outgoing ring UI). */
  const [ringingUsers, setRingingUsers] = useState<PublicUser[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localVersion, setLocalVersion] = useState(0);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [facing, setFacing] = useState<Facing>("user");
  const [canFlip, setCanFlip] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>("none");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  /** Bumped whenever a call finishes, so history views can refetch. */
  const [historyVersion, setHistoryVersion] = useState(0);

  /* --------------------------------------------------------------- refs */
  const managerRef = useRef<PeerManager | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const bufferRef = useRef<BufferedSignal[]>([]);
  const callIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  /** Camera track parked while a screen share is active. */
  const parkedCameraRef = useRef<MediaStreamTrack | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const backgroundRef = useRef<VirtualBackgroundProcessor | null>(null);
  const phaseRef = useRef<CallPhase>("idle");
  const chatOpenRef = useRef(false);
  /**
   * Mirror of `incoming`, read by the socket handlers.
   *
   * The handlers must NOT depend on the `incoming` state value: `call:incoming`
   * and an immediately-following `call:canceled` can arrive in the same
   * websocket batch, i.e. before React re-renders and re-registers the
   * listeners. A handler closed over the stale `null` would fail its callId
   * guard and drop the cancel, leaving the phone ringing forever.
   *
   * Assigned synchronously wherever `setIncoming` is called (same pattern as
   * `callIdRef`); the effect below is just a backstop.
   */
  const incomingRef = useRef<IncomingCall | null>(null);


  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    incomingRef.current = incoming;
  }, [incoming]);
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  // Cache ICE servers once so PeerManager can be built without awaiting.
  useEffect(() => {
    if (!selfId) return;
    api
      .iceConfig()
      .then(({ iceServers }) => {
        iceServersRef.current = iceServers;
      })
      .catch(() => {
        iceServersRef.current = [
          { urls: ["stun:stun.l.google.com:19302"] },
        ];
      });
  }, [selfId]);

  useEffect(() => {
    void canFlipCamera().then(setCanFlip);
  }, []);

  /* ------------------------------------------------- duration ticker */
  useEffect(() => {
    if (phase !== "active" || startedAt === null) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const t = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => clearInterval(t);
  }, [phase, startedAt]);

  /* ------------------------------------------------------- teardown */

  const resetCallState = useCallback(() => {
    ringer.stop();
    stopVibrate();

    managerRef.current?.closeAll();
    managerRef.current = null;
    bufferRef.current = [];

    stopStream(screenStreamRef.current);
    screenStreamRef.current = null;
    if (backgroundRef.current) {
      void backgroundRef.current.stop(true);
      backgroundRef.current = null;
    }
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
    setFacing("user");
    setBackgroundMode("none");
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
        if (socket && id) socket.emit("webrtc:offer", { callId: id, toUserId: userId, sdp });
      },
      onAnswer: (userId, sdp) => {
        const id = callIdRef.current;
        if (socket && id) socket.emit("webrtc:answer", { callId: id, toUserId: userId, sdp });
      },
      onIce: (userId, candidate) => {
        const id = callIdRef.current;
        if (socket && id) socket.emit("webrtc:ice", { callId: id, toUserId: userId, candidate });
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
        setParticipants((prev) =>
          prev[sig.userId]
            ? prev
            : {
                ...prev,
                [sig.userId]: {
                  user: sig.user!,
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
      const { stream, videoFailed } = await getLocalStream({
        video: wantVideo,
        facing: "user",
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setLocalVersion((v) => v + 1);

      const audio = stream.getAudioTracks()[0] ?? null;
      const video = stream.getVideoTracks()[0] ?? null;
      setMicOn(Boolean(audio?.enabled));
      setCamOn(Boolean(video));
      if (videoFailed) {
        setStatusNote("Camera unavailable — continuing with audio only.");
      }

      const mgr = ensureManager();
      await mgr.setLocalTracks({ audio, video });
      return { audio, video };
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
        void ringer.start(true);

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
    if (!socket || !incoming) return;
    const inc = incoming;

    ringer.stop();
    stopVibrate();
    void clearCallNotification(inc.callId);
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
    incoming,
    ensureManager,
    acquireLocal,
    resetCallState,
    emitMediaState,
    flushBuffer,
  ]);

  const rejectCall = useCallback(() => {
    if (!socket || !incoming) return;
    socket.emit("call:reject", { callId: incoming.callId });
    void clearCallNotification(incoming.callId);
    resetCallState();
  }, [socket, incoming, resetCallState]);

  /* --------------------------------------------------------- hang up */

  const hangUp = useCallback(() => {
    const id = callIdRef.current;
    if (socket && id) {
      if (phaseRef.current === "outgoing") socket.emit("call:cancel", { callId: id });
      else socket.emit("call:leave", { callId: id });
    }
    if (id) void clearCallNotification(id);
    resetCallState();
  }, [socket, resetCallState]);

  /* -------------------------------------------------------- controls */

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    const next = !track.enabled;
    track.enabled = next;
    setMicOn(next);
    emitMediaState({
      audio: next,
      video: camOn,
      screen: screenOn,
    });
  }, [emitMediaState, camOn, screenOn]);

  const toggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const mgr = managerRef.current;

    // Can't toggle the camera while sharing the screen.
    if (screenOn) {
      setStatusNote("Stop screen sharing first to use your camera.");
      return;
    }

    const existing = stream.getVideoTracks()[0];

    if (existing && existing.readyState === "live" && camOn) {
      // Turn off: stop and remove the track so the camera light goes out.
      if (backgroundRef.current) {
        await backgroundRef.current.stop(true);
        backgroundRef.current = null;
        setBackgroundMode("none");
      } else {
        existing.stop();
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
      const { stream: camStream } = await getLocalStream({
        video: true,
        facing,
      });
      const newTrack = camStream.getVideoTracks()[0];
      // We only wanted video; drop the extra audio track it may have opened.
      camStream.getAudioTracks().forEach((t) => t.stop());
      if (!newTrack) {
        setStatusNote("No camera available on this device.");
        return;
      }
      stream.getVideoTracks().forEach((t) => {
        t.stop();
        stream.removeTrack(t);
      });
      stream.addTrack(newTrack);
      await mgr?.replaceVideoTrack(newTrack);
      setCamOn(true);
      setIsVideoCall(true);
      setLocalVersion((v) => v + 1);
      emitMediaState({ audio: micOn, video: true, screen: false });
    } catch (err) {
      setStatusNote((err as Error).message);
    }
  }, [camOn, screenOn, facing, micOn, emitMediaState]);

  const changeBackground = useCallback(async (mode: BackgroundMode) => {
    const stream = localStreamRef.current;
    const mgr = managerRef.current;
    if (!stream || !mgr || !camOn || screenOn) {
      setStatusNote("Turn on your camera and stop screen sharing first.");
      return;
    }

    try {
      const active = backgroundRef.current;
      if (mode === "none") {
        if (!active) return;
        const raw = active.sourceTrack;
        stream.getVideoTracks().forEach((track) => stream.removeTrack(track));
        await active.stop(false);
        backgroundRef.current = null;
        stream.addTrack(raw);
        await mgr.replaceVideoTrack(raw);
        setBackgroundMode("none");
        setLocalVersion((v) => v + 1);
        return;
      }
      if (active) {
        active.setMode(mode);
        setBackgroundMode(mode);
        return;
      }

      const raw = stream.getVideoTracks()[0];
      if (!raw) return;
      setStatusNote("Preparing virtual background…");
      const processor = await createVirtualBackground(raw, mode);
      stream.removeTrack(raw);
      stream.addTrack(processor.track);
      backgroundRef.current = processor;
      await mgr.replaceVideoTrack(processor.track);
      setBackgroundMode(mode);
      setLocalVersion((v) => v + 1);
      setStatusNote("Virtual background is on.");
    } catch (err) {
      setStatusNote((err as Error).message || "Could not change the background.");
    }
  }, [camOn, screenOn]);

  const flipCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream || !camOn || screenOn) return;
    if (backgroundRef.current) {
      setStatusNote("Turn off the virtual background before switching cameras.");
      return;
    }
    const current = stream.getVideoTracks()[0] ?? null;
    const desired: Facing = facing === "user" ? "environment" : "user";

    try {
      const { track, facing: got } = await getFlippedVideoTrack(
        current,
        desired
      );
      if (current) {
        current.stop();
        stream.removeTrack(current);
      }
      stream.addTrack(track);
      await managerRef.current?.replaceVideoTrack(track);
      setFacing(got);
      setLocalVersion((v) => v + 1);
    } catch (err) {
      setStatusNote(
        (err as Error).message || "Could not switch camera."
      );
    }
  }, [camOn, screenOn, facing]);

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
      if (parked && parked.readyState === "live") {
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
      const display = await getDisplayStream();
      if (!display) return; // user canceled the picker
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

      // The browser's own "Stop sharing" button ends the track directly.
      screenTrack.onended = () => {
        void (async () => {
          const s = localStreamRef.current;
          const m = managerRef.current;
          if (!s || !m) return;
          // Read the mic from the live track: this callback outlives the render
          // it was created in, so the captured `micOn` may be stale if the user
          // muted while sharing.
          const audioOn = s.getAudioTracks()[0]?.enabled ?? micOn;
          s.getVideoTracks().forEach((t) => s.removeTrack(t));
          screenStreamRef.current = null;
          const parked = parkedCameraRef.current;
          parkedCameraRef.current = null;
          if (parked && parked.readyState === "live") {
            parked.enabled = true;
            s.addTrack(parked);
            await m.replaceVideoTrack(parked);
            setCamOn(true);
            emitMediaState({ audio: audioOn, video: true, screen: false });
          } else {
            await m.replaceVideoTrack(null);
            setCamOn(false);
            emitMediaState({ audio: audioOn, video: false, screen: false });
          }
          setScreenOn(false);
          setLocalVersion((v) => v + 1);
        })();
      };
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
      // Render our own message immediately.
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
      // Ref first and synchronously — see the note on `incomingRef`.
      incomingRef.current = inc;
      setIncoming(inc);
      setCallType(p.type);
      setIsVideoCall(p.video);
      setPhase("incoming");
      void ringer.start(false);
      vibrateIncoming();

      // If the tab is hidden, surface a notification too.
      if (document.visibilityState === "hidden") {
        void showLocalCallNotification({
          title: `Incoming ${p.video ? "video" : "audio"} call`,
          body: `${p.from.displayName} is calling you`,
          icon: p.from.avatarUrl,
          callId: p.callId,
        });
      }
    };

    const onRinging = (p: { callId: string; userId: string }) => {
      if (callIdRef.current && p.callId !== callIdRef.current) return;
      // The server only emits this once a callee's devices were actually
      // reachable, so this — not the moment the user pressed call — is the
      // honest point to claim the other phone is ringing.
      if (phaseRef.current === "outgoing") setStatusNote("Ringing…");
    };

    const onAccepted = (p: { callId: string; user: PublicUser }) => {
      if (p.callId !== callIdRef.current) return;
      ringer.stop();
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
      void clearCallNotification(p.callId);
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
      void clearCallNotification(p.callId);
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
    // `incoming` is deliberately NOT a dependency — the handlers read
    // `incomingRef` instead, so a cancel arriving in the same websocket batch
    // as the incoming call can't be dropped against a stale closure. It also
    // keeps us from re-registering fourteen listeners on every call.
  }, [socket, resetCallState]);

  /* -------------------------- answer/decline from a notification click */
  useEffect(() => {
    const onSwMessage = (ev: MessageEvent) => {
      const data = ev.data as
        | { source?: string; action?: string; callId?: string }
        | undefined;
      if (data?.source !== "freecall-sw") return;
      if (data.action === "answer") void acceptCall();
      else if (data.action === "decline") rejectCall();
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);
    return () =>
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
  }, [acceptCall, rejectCall]);

  /* ------------------------------------- warn before closing mid-call */
  useEffect(() => {
    if (phase !== "active" && phase !== "outgoing") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

  /* ------------------------------------------------ unmount cleanup */
  useEffect(() => resetCallState, [resetCallState]);

  /* ------------------------------------------- auto-clear status note */
  useEffect(() => {
    if (!statusNote) return;
    const t = window.setTimeout(() => setStatusNote(null), 4200);
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
    facing,
    canFlip,
    backgroundMode,
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
    changeBackground,
    sendMessage,
    setChatOpen,
    clearError: () => setError(null),
  };
}

export type CallController = ReturnType<typeof useCall>;
