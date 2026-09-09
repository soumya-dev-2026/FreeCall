/** Client negotiation regression tests. Models SDP channel association, not RTP
 * transport, physical devices, native audio routing, or browser autoplay policy.
 * Run: npm run test:media (requires the workspace TypeScript dependency).
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

class Stream {
  tracks = [];
  getTracks() { return this.tracks; }
  addTrack(track) { this.tracks.push(track); }
  removeTrack(track) { this.tracks = this.tracks.filter(t => t !== track); }
}
class Description { constructor(value) { Object.assign(this, value); } }
class Connection {
  static instances = [];
  transceivers = [];
  signalingState = 'stable';
  constructor() { Connection.instances.push(this); }
  addEventListener(name, callback) { this[`on${name}`] = callback; }
  addTransceiver(source, options) {
    const kind = typeof source === 'string' ? source : source.kind;
    const tx = {
      mid: null, direction: options.direction,
      receiver: { track: { kind, id: `remote-${kind}` } },
      sender: {
        track: typeof source === 'string' ? null : source,
        async replaceTrack(track) { this.track = track; },
      },
    };
    this.transceivers.push(tx);
    return tx;
  }
  getTransceivers() { return this.transceivers; }
  async createOffer() {
    return { type: 'offer', sdp: JSON.stringify(this.transceivers.map((tx, i) => ({
      mid: tx.mid ?? String(i), kind: tx.receiver.track.kind,
    }))) };
  }
  async setLocalDescription(description) {
    this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
    if (description.type === 'offer') {
      JSON.parse(description.sdp).forEach((m, i) => { this.transceivers[i].mid = m.mid; });
    }
  }
  async setRemoteDescription(description) {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
    if (description.type !== 'offer') return;
    for (const m of JSON.parse(description.sdp)) {
      // An unassociated addTransceiver channel cannot adopt an offered m-line.
      let tx = this.transceivers.find(t => t.mid === m.mid);
      if (!tx) {
        tx = this.addTransceiver(m.kind, { direction: 'recvonly' });
        tx.mid = m.mid;
      }
      this.ontrack?.({ track: tx.receiver.track, streams: [] });
    }
  }
  async createAnswer() {
    const offered = JSON.parse(this.remoteDescription.sdp);
    return { type: 'answer', sdp: JSON.stringify(offered.map(m => {
      const tx = this.transceivers.find(t => t.mid === m.mid);
      return { ...m, direction: tx.direction, track: tx.sender.track?.id ?? null };
    })) };
  }
  async addIceCandidate() {}
  close() {}
}
Object.assign(globalThis, {
  MediaStream: Stream, RTCPeerConnection: Connection,
  RTCSessionDescription: Description, RTCIceCandidate: Description,
});

async function managerFor(client) {
  let source = await readFile(new URL(`../../${client}/src/lib/peer.ts`, import.meta.url), 'utf8');
  source = source.replace(/import\s*\{[^}]*\}\s*from "react-native-webrtc";/, '');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).PeerManager;
}
const clients = { web: await managerFor('web'), mobile: await managerFor('mobile') };
for (const [offerClient, OfferManager] of Object.entries(clients)) {
  for (const [answerClient, AnswerManager] of Object.entries(clients)) {
    for (const video of [true, false]) {
      let offer, answer;
      const streams = [];
      const events = {
        onStream: (_id, stream) => streams.push(stream), onState() {}, onIce() {},
        onOffer: (_id, sdp) => { offer = sdp; },
        onAnswer: (_id, sdp) => { answer = sdp; },
      };
      const a = new OfferManager([], events);
      const b = new AnswerManager([], events);
      const tracks = id => ({
        audio: { kind: 'audio', id: `${id}-mic` },
        video: video ? { kind: 'video', id: `${id}-camera` } : null,
      });
      await a.setLocalTracks(tracks('a'));
      await b.setLocalTracks(tracks('b'));
      await a.addPeer('b', true);
      const pcA = Connection.instances.at(-1);
      await b.addPeer('a', false);
      const pcB = Connection.instances.at(-1);
      await b.handleOffer('a', offer);
      assert.ok(answer, 'answer is generated');
      assert.deepEqual(JSON.parse(answer.sdp).map(m => [m.kind, m.direction, m.track]), [
        ['audio', 'sendrecv', 'b-mic'], ['video', 'sendrecv', video ? 'b-camera' : null],
      ]);
      await a.handleAnswer('b', answer);
      for (const [pc, id] of [[pcA, 'a'], [pcB, 'b']]) {
        assert.equal(pc.signalingState, 'stable');
        assert.equal(pc.transceivers.length, 2, 'no unnegotiated duplicate channels');
        assert.equal(pc.transceivers[0].sender.track.id, `${id}-mic`);
      }
      assert.deepEqual(streams.at(-1).getTracks().map(t => t.kind), ['audio', 'video']);
      await b.replaceVideoTrack({ kind: 'video', id: 'b-new-camera' });
      assert.equal(pcB.transceivers[1].sender.track.id, 'b-new-camera');
      await b.replaceVideoTrack(null);
      assert.equal(pcB.transceivers[1].sender.track, null);
      await b.handleOffer('a', offer);
      assert.equal(pcB.transceivers.length, 2, 'restart reuses negotiated channels');
      a.closeAll(); b.closeAll();
      console.log(`ok ${offerClient} offers → ${answerClient} answers (${video ? 'video' : 'audio + camera upgrade'})`);
    }
  }
}
