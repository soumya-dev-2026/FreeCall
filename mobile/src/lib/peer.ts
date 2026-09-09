/**
 * WebRTC mesh peer manager (React Native).
 *
 * Mirrors web/src/lib/peer.ts — same glare-free initiator rule, same
 * pre-created transceivers so camera flips and track swaps need no
 * renegotiation. The only difference is that the WebRTC primitives come from
 * `react-native-webrtc` rather than the browser global scope.
 */

import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  type MediaStreamTrack,
} from "react-native-webrtc";

export interface PeerEvents {
  onStream: (userId: string, stream: MediaStream) => void;
  onState: (userId: string, state: string) => void;
  onOffer: (userId: string, sdp: RTCSessionDescriptionInit) => void;
  onAnswer: (userId: string, sdp: RTCSessionDescriptionInit) => void;
  onIce: (userId: string, candidate: RTCIceCandidateInit) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  remoteStream: MediaStream | null;
  audioSender: any;
  videoSender: any;
  pendingIce: RTCIceCandidateInit[];
  makingOffer: boolean;
  initiator: boolean;
  ready: boolean;
}

export class PeerManager {
  private peers = new Map<string, PeerEntry>();
  private iceServers: RTCIceServer[];
  private events: PeerEvents;
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

  async setLocalTracks(opts: {
    audio: MediaStreamTrack | null;
    video: MediaStreamTrack | null;
  }): Promise<void> {
    this.audioTrack = opts.audio;
    this.videoTrack = opts.video;
    await Promise.all(
      [...this.peers.values()].map(async (e) => {
        await this.safeReplace(e.audioSender, this.audioTrack);
        await this.safeReplace(e.videoSender, this.videoTrack);
      })
    );
  }

  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    this.videoTrack = track;
    await Promise.all(
      [...this.peers.values()].map((e) => this.safeReplace(e.videoSender, track))
    );
  }

  async replaceAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    this.audioTrack = track;
    await Promise.all(
      [...this.peers.values()].map((e) => this.safeReplace(e.audioSender, track))
    );
  }

  private async safeReplace(
    sender: any,
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

  async addPeer(userId: string, initiator: boolean): Promise<void> {
    if (this.peers.has(userId)) return;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    } as any);

    const entry: PeerEntry = {
      pc,
      remoteStream: null,
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
      const audioTx = (pc as any).addTransceiver(this.audioTrack ?? "audio", {
        direction: "sendrecv",
      });
      const videoTx = (pc as any).addTransceiver(this.videoTrack ?? "video", {
        direction: "sendrecv",
      });
      entry.audioSender = audioTx?.sender ?? null;
      entry.videoSender = videoTx?.sender ?? null;
    }

    (pc as any).addEventListener("icecandidate", (ev: any) => {
      if (ev.candidate) {
        this.events.onIce(userId, {
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid,
          sdpMLineIndex: ev.candidate.sdpMLineIndex,
        });
      }
    });

    (pc as any).addEventListener("track", (ev: any) => {
      // react-native-webrtc hands us the stream directly on the event.
      const stream: MediaStream | undefined = ev.streams?.[0];
      if (stream) {
        entry.remoteStream = stream;
        this.events.onStream(userId, stream);
      } else if (ev.track) {
        const s = entry.remoteStream ?? new MediaStream([] as any);
        (s as any).addTrack(ev.track);
        entry.remoteStream = s;
        this.events.onStream(userId, s);
      }
    });

    (pc as any).addEventListener("connectionstatechange", () => {
      const state = (pc as any).connectionState as string;
      this.events.onState(userId, state);
      if (state === "failed" && entry.initiator) {
        void this.renegotiate(userId, true);
      }
    });

    (pc as any).addEventListener("negotiationneeded", () => {
      if (!entry.ready || !entry.initiator) return;
      void this.renegotiate(userId, false);
    });

    entry.ready = true;
    if (initiator) await this.renegotiate(userId, false);
  }

  private async renegotiate(userId: string, iceRestart: boolean): Promise<void> {
    const entry = this.peers.get(userId);
    if (!entry) return;
    const { pc } = entry;
    if (entry.makingOffer) return;
    entry.makingOffer = true;
    try {
      const offer = await pc.createOffer(
        (iceRestart ? { iceRestart: true } : {}) as any
      );
      if ((pc as any).signalingState !== "stable" && !iceRestart) return;
      await pc.setLocalDescription(offer);
      const ld = (pc as any).localDescription;
      if (ld) this.events.onOffer(userId, { type: ld.type, sdp: ld.sdp });
    } catch (err) {
      console.warn("[rtc] renegotiate failed:", (err as Error).message);
    } finally {
      entry.makingOffer = false;
    }
  }

  async handleOffer(
    userId: string,
    sdp: RTCSessionDescriptionInit
  ): Promise<void> {
    if (!this.peers.has(userId)) await this.addPeer(userId, false);
    const entry = this.peers.get(userId);
    if (!entry) return;
    const { pc } = entry;

    try {
      const collision =
        entry.makingOffer || (pc as any).signalingState !== "stable";
      if (collision) {
        // Impolite side (the designated initiator) keeps its own offer.
        if (entry.initiator) return;
        // Rollback is only legal from "have-local-offer". Attempting it from
        // e.g. "have-remote-offer" (a second offer arriving while our answer
        // is still in flight) throws, which would drop the offer entirely and
        // stall this peer — so only roll back when we actually have an offer.
        if ((pc as any).signalingState === "have-local-offer") {
          await pc.setLocalDescription({ type: "rollback" } as any);
        }
      }
      await pc.setRemoteDescription(new RTCSessionDescription(sdp as any));
      // Explicitly pre-created transceivers cannot adopt an incoming offer.
      // Bind local tracks to the transceivers created by setRemoteDescription.
      for (const tx of pc.getTransceivers()) {
        if (tx.mid === null) continue;
        const kind = tx.receiver.track?.kind;
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
      const ld = (pc as any).localDescription;
      if (ld) this.events.onAnswer(userId, { type: ld.type, sdp: ld.sdp });
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
      if ((entry.pc as any).signalingState !== "have-local-offer") return;
      await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp as any));
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
    if (!(entry.pc as any).remoteDescription) {
      entry.pendingIce.push(candidate);
      return;
    }
    try {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate as any));
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
        await entry.pc.addIceCandidate(new RTCIceCandidate(c as any));
      } catch {
        /* stale candidate */
      }
    }
  }

  removePeer(userId: string): void {
    const entry = this.peers.get(userId);
    if (!entry) return;
    try {
      (entry.pc as any).close();
    } catch {
      /* ignore */
    }
    this.peers.delete(userId);
  }

  closeAll(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.audioTrack = null;
    this.videoTrack = null;
  }
}
