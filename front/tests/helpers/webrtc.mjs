import { vi } from "vitest";

export const track = (id = "audio", readyState = "live") => ({
  id,
  kind: "audio",
  readyState,
  enabled: true,
  stop: vi.fn()
});

export const stream = (tracks = [track()]) => ({
  getTracks: () => tracks,
  getAudioTracks: () => tracks.filter(({ kind }) => kind === "audio")
});

export class FakeChannel {
  constructor(state = "open") {
    this.readyState = state;
    this.bufferedAmount = 0;
    this.autoReady = true;
    this.autoCredit = true;
    this.send = vi.fn((value) => this.#respond(value));
    this.close = vi.fn(() => {
      this.readyState = "closed";
    });
  }

  #emit(message) {
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }

  #respond(value) {
    if (value instanceof ArrayBuffer) {
      if (this.autoCredit !== false && this.transferId)
        this.#emit({ type: "file-credit", transferId: this.transferId, bytes: value.byteLength });
      return;
    }
    if (typeof value !== "string") return;
    let message;
    try {
      message = JSON.parse(value);
    } catch {
      return;
    }
    if (message.type !== "file-start" || this.autoReady === false) return;
    this.transferId = message.transferId;
    this.#emit({ type: "file-ready", transferId: message.transferId, windowBytes: 512 * 1024 });
  }
}

export class FakePeer {
  static instances = [];

  constructor(configuration) {
    Object.assign(this, {
      configuration,
      connectionState: "new",
      remoteDescription: null,
      localDescription: null,
      senders: []
    });
    this.addTrack = vi.fn((mediaTrack) => {
      this.senders.push({ track: mediaTrack });
    });
    this.getSenders = () => this.senders;
    this.createDataChannel = vi.fn(() => new FakeChannel());
    this.createOffer = vi.fn().mockResolvedValue({ type: "offer", sdp: "offer" });
    this.createAnswer = vi.fn().mockResolvedValue({ type: "answer", sdp: "answer" });
    this.setLocalDescription = vi.fn(async (description) => {
      this.localDescription = description;
    });
    this.setRemoteDescription = vi.fn(async (description) => {
      this.remoteDescription = description;
    });
    this.addIceCandidate = vi.fn().mockResolvedValue(undefined);
    this.close = vi.fn(() => {
      this.connectionState = "closed";
    });
    FakePeer.instances.push(this);
  }
}
