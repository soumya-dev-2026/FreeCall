/**
 * WebRTC mesh peer manager.
 *
 * One RTCPeerConnection per remote participant. Handles offer/answer, ICE,
 * track replacement (camera flip / screen share), and reconnection.
 *
 * Two design decisions worth knowing:
 *
 * 1. **Reserved transceivers.** Each offer reserves audio and video channels.
 *    The answerer adopts them, even for audio-only calls. Turning the camera
 *    on later, flipping cameras, or starting a screen
 *    share is just `sender.replaceTrack()` — no SDP renegotiation, which is
 *    where most mesh-calling bugs live.
 *
 * 2. **Deterministic offerer.** The server tells each side whether it is the
 *    `initiator` for a given pair (lexicographically smaller user id wins), so
 *    offers never collide. See CONTRACT.md §4.
 */

export interface PeerEvents {
  /** A remote stream became available (or changed) for this peer. */
  onStream: (userId: string, stream: MediaStream) => void;
  /** Connection state changed — used to show "connecting…" / "reconnecting…". */
  onState: (userId: string, state: RTCPeerConnectionState) => void;
  /** We produced an SDP offer that must be signaled to this peer. */
  onOffer: (userId: string, sdp: RTCSessionDescriptionInit) => void;
  /** We produced an SDP answer that must be signaled to this peer. */
  onAnswer: (userId: string, sdp: RTCSessionDescriptionInit) => void;
  /** We gathered a local ICE candidate for this peer. */
  onIce: (userId: string, candidate: RTCIceCandidateInit) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  /** Stable stream object we hand to the UI; tracks get added to it. */
  remoteStream: MediaStream;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  /** ICE candidates that arrived before the remote description was set. */
  pendingIce: RTCIceCandidateInit[];
  /** True while we're creating/sending an offer (glare guard). */
  makingOffer: boolean;
  /** Whether this side is responsible for offering. */
  initiator: boolean;
  /** Suppress renegotiation while we're setting up the initial tracks. */
  ready: boolean;
}

export class PeerManager {
  private peers = new Map<string, PeerEntry>();
  private iceServers: RTCIceServer[];
  private events: PeerEvents;

  /** The tracks we're currently sending. */
  private audioTrack: MediaStreamTrack | null = null;
  private videoTrack: MediaStreamTrack | null = null;

  constructor(iceServers: RTCIceServer[], events: PeerEvents) {
    this.iceServers = iceServers.length
      ? iceServers
      : [{ urls: ["stun:stun.l.google.com:19302"] }];
    this.events = events;
  }

  setIceServers(servers: RTCIceServer[]): void {
    if (servers.length) this.iceServers = servers;
  }

  /** Set/replace the local tracks sent to every peer. */
  async setLocalTracks(opts: {
    audio: MediaStreamTrack | null;
    video: MediaStreamTrack | null;
  }): Promise<void> {
    this.audioTrack = opts.audio;
    this.videoTrack = opts.video;
    await Promise.all(
      [...this.peers.values()].map(async (entry) => {
        await this.safeReplace(entry.audioSender, this.audioTrack);
        await this.safeReplace(entry.videoSender, this.videoTrack);
      })
    );
  }

  /** Replace just the outgoing video track (camera flip, screen share). */
  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    this.videoTrack = track;
    await Promise.all(
      [...this.peers.values()].map((entry) =>
        this.safeReplace(entry.videoSender, track)
      )
    );
  }

  /** Replace just the outgoing audio track. */
  async replaceAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    this.audioTrack = track;
    await Promise.all(
      [...this.peers.values()].map((entry) =>
        this.safeReplace(entry.audioSender, track)
      )
    );
  }

  private async safeReplace(
    sender: RTCRtpSender | null,
    track: MediaStreamTrack | null
  ): Promise<void> {
    if (!sender) return;
    try {
      await sender.replaceTrack(track);
    } catch (err) {
      console.warn("[rtc] replaceTrack failed:", (err as Error).message);
    }
  }

  hasPeer(userId: string): boolean {
    return this.peers.has(userId);
  }

  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  /**
   * Create the connection to a peer. If `initiator` is true we immediately
   * create and send an offer.
   */
  async addPeer(userId: string, initiator: boolean): Promise<void> {
    if (this.peers.has(userId)) return;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 4,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });

    const entry: PeerEntry = {
      pc,
      remoteStream: new MediaStream(),
      audioSender: null,
      videoSender: null,
      pendingIce: [],
      makingOffer: false,
      initiator,
      ready: false,
    };
    this.peers.set(userId, entry);

    // Only the offerer creates channels. The answerer adopts the offered ones.
    if (initiator) {
      const audioTx = pc.addTransceiver(this.audioTrack ?? "audio", {
        direction: "sendrecv",
      });
      const videoTx = pc.addTransceiver(this.videoTrack ?? "video", {
        direction: "sendrecv",
      });
      entry.audioSender = audioTx.sender;
      entry.videoSender = videoTx.sender;
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.events.onIce(userId, ev.candidate.toJSON());
    };

    pc.ontrack = (ev) => {
      // Add the incoming track to our stable stream object for this peer.
      const stream = entry.remoteStream;
      const existing = stream
        .getTracks()
        .find((t) => t.kind === ev.track.kind && t.id !== ev.track.id);
      if (existing) stream.removeTrack(existing);
      if (!stream.getTracks().some((t) => t.id === ev.track.id)) {
        stream.addTrack(ev.track);
      }
      this.events.onStream(userId, stream);
    };

    pc.onconnectionstatechange = () => {
      this.events.onState(userId, pc.connectionState);
      // Try an ICE restart when the path breaks; only the offerer may do this.
      if (pc.connectionState === "failed" && entry.initiator) {
        void this.renegotiate(userId, true);
      }
    };

    pc.onnegotiationneeded = () => {
      if (!entry.ready || !entry.initiator) return;
      void this.renegotiate(userId, false);
    };

    entry.ready = true;

    if (initiator) {
      await this.renegotiate(userId, false);
    }
  }

  private async renegotiate(userId: string, iceRestart: boolean): Promise<void> {
    const entry = this.peers.get(userId);
    if (!entry) return;
    const { pc } = entry;

    if (entry.makingOffer) return;
    entry.makingOffer = true;
    try {
      const offer = await pc.createOffer(
        iceRestart ? { iceRestart: true } : undefined
      );
      // Guard against state changing while we awaited.
      if (pc.signalingState !== "stable" && !iceRestart) return;
      await pc.setLocalDescription(offer);
      if (pc.localDescription) {
        this.events.onOffer(userId, {
          type: pc.localDescription.type,
          sdp: pc.localDescription.sdp,
        });
      }
    } catch (err) {
      console.warn("[rtc] renegotiate failed:", (err as Error).message);
    } finally {
      entry.makingOffer = false;
    }
  }

  /** Handle an inbound offer, replying with an answer. */
  async handleOffer(
    userId: string,
    sdp: RTCSessionDescriptionInit
  ): Promise<void> {
    // A peer may offer before we've been told they joined.
    if (!this.peers.has(userId)) await this.addPeer(userId, false);
    const entry = this.peers.get(userId);
    if (!entry) return;
    const { pc } = entry;

    try {
      const collision = entry.makingOffer || pc.signalingState !== "stable";
      if (collision) {
        // We're the polite side whenever we're not the designated initiator.
        if (entry.initiator) {
          // Impolite: ignore the incoming offer, ours wins.
          return;
        }
        if (pc.signalingState === "have-local-offer") {
          // Roll our own offer back so theirs can be applied. Rollback is only
          // legal from here — attempting it from e.g. "have-remote-offer"
          // (a second offer arriving while our answer is still in flight)
          // throws and would drop the offer entirely, stalling the peer.
          await Promise.all([
            pc.setLocalDescription({ type: "rollback" }),
            pc.setRemoteDescription(new RTCSessionDescription(sdp)),
          ]);
        } else {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
      } else {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }

      // Explicitly pre-created transceivers cannot adopt an incoming offer.
      // Bind local tracks to the transceivers created by setRemoteDescription.
      for (const tx of pc.getTransceivers()) {
        if (tx.mid === null) continue;
        const kind = tx.receiver.track.kind;
        if (kind === "audio") {
          tx.direction = "sendrecv";
          entry.audioSender = tx.sender;
          await tx.sender.replaceTrack(this.audioTrack);
        } else if (kind === "video") {
          tx.direction = "sendrecv";
          entry.videoSender = tx.sender;
          await tx.sender.replaceTrack(this.videoTrack);
        }
      }

      await this.flushIce(userId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (pc.localDescription) {
        this.events.onAnswer(userId, {
          type: pc.localDescription.type,
          sdp: pc.localDescription.sdp,
        });
      }
    } catch (err) {
      console.warn("[rtc] handleOffer failed:", (err as Error).message);
    }
  }

  async handleAnswer(
    userId: string,
    sdp: RTCSessionDescriptionInit
  ): Promise<void> {
    const entry = this.peers.get(userId);
    if (!entry) return;
    try {
      // Ignore stray answers when we're not expecting one.
      if (entry.pc.signalingState !== "have-local-offer") return;
      await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.flushIce(userId);
    } catch (err) {
      console.warn("[rtc] handleAnswer failed:", (err as Error).message);
    }
  }

  async handleIce(
    userId: string,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    const entry = this.peers.get(userId);
    if (!entry) return;
    // Candidates are useless until a remote description exists — queue them.
    if (!entry.pc.remoteDescription) {
      entry.pendingIce.push(candidate);
      return;
    }
    try {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn("[rtc] addIceCandidate failed:", (err as Error).message);
    }
  }

  private async flushIce(userId: string): Promise<void> {
    const entry = this.peers.get(userId);
    if (!entry) return;
    const queued = entry.pendingIce.splice(0);
    for (const c of queued) {
      try {
        await entry.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        /* stale candidate — safe to drop */
      }
    }
  }

  removePeer(userId: string): void {
    const entry = this.peers.get(userId);
    if (!entry) return;
    try {
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.onnegotiationneeded = null;
      entry.pc.close();
    } catch {
      /* ignore */
    }
    this.peers.delete(userId);
  }

  /** Tear down every connection. Does not stop local tracks (caller's job). */
  closeAll(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.audioTrack = null;
    this.videoTrack = null;
  }

  /** Round-trip stats for a simple connection-quality indicator. */
  async getRoundTripMs(userId: string): Promise<number | null> {
    const entry = this.peers.get(userId);
    if (!entry) return null;
    try {
      const stats = await entry.pc.getStats();
      let rtt: number | null = null;
      stats.forEach((report) => {
        if (
          report.type === "candidate-pair" &&
          (report as RTCIceCandidatePairStats).state === "succeeded"
        ) {
          const t = (report as RTCIceCandidatePairStats)
            .currentRoundTripTime;
          if (typeof t === "number") rtt = Math.round(t * 1000);
        }
      });
      return rtt;
    } catch {
      return null;
    }
  }
}
