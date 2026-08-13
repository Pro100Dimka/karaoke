import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import OnlineVoiceMesh from "../src/services/onlineVoiceMesh.js";

const track = (id = "audio", readyState = "live") => ({
  id,
  kind: "audio",
  readyState,
  enabled: true,
  stop: vi.fn()
});
const stream = (tracks = [track()]) => ({
  getTracks: () => tracks,
  getAudioTracks: () => tracks.filter((item) => item.kind === "audio")
});

class FakeChannel {
  constructor(state = "open") {
    this.readyState = state;
    this.bufferedAmount = 0;
    this.send = vi.fn();
    this.close = vi.fn(() => {
      this.readyState = "closed";
    });
  }
}

class FakePeer {
  static instances = [];

  constructor(configuration) {
    this.configuration = configuration;
    this.connectionState = "new";
    this.remoteDescription = null;
    this.localDescription = null;
    this.senders = [];
    this.addTrack = vi.fn((mediaTrack) => {
      this.senders.push({ track: mediaTrack });
    });
    this.getSenders = () => this.senders;
    this.createDataChannel = vi.fn(() => new FakeChannel());
    this.createOffer = vi
      .fn()
      .mockResolvedValue({ type: "offer", sdp: "offer" });
    this.createAnswer = vi
      .fn()
      .mockResolvedValue({ type: "answer", sdp: "answer" });
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

const makeMesh = () =>
  new OnlineVoiceMesh({
    send: vi.fn(() => true)
  });

beforeEach(() => {
  FakePeer.instances = [];
  globalThis.RTCPeerConnection = FakePeer;
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.RTCPeerConnection;
  if (globalThis.navigator) delete globalThis.navigator.mediaDevices;
});

describe("online voice mesh", () => {
  test("starts, reuses and restarts microphone streams safely", async () => {
    const mesh = makeMesh();
    await expect(mesh.start()).rejects.toThrow(Error);

    const firstTrack = track("first");
    const firstStream = stream([firstTrack]);
    const secondTrack = track("second");
    const secondStream = stream([secondTrack]);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: vi
            .fn()
            .mockResolvedValueOnce(firstStream)
            .mockResolvedValueOnce(secondStream)
        }
      }
    });
    await expect(mesh.start()).resolves.toBe(firstStream);
    expect(firstTrack.contentHint).toBe("music");
    await expect(mesh.start()).resolves.toBe(firstStream);
    firstTrack.readyState = "ended";
    await expect(mesh.start()).resolves.toBe(secondStream);
    expect(firstTrack.stop).toHaveBeenCalled();
  });

  test("deduplicates concurrent microphone startup and cancels stale capture", async () => {
    let resolveCapture;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(
            () =>
              new Promise((resolve) => {
                resolveCapture = resolve;
              })
          )
        }
      }
    });
    const mesh = makeMesh();
    const media = stream();
    const first = mesh.start();
    const second = mesh.start();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    mesh.stop();
    resolveCapture(media);
    await expect(first).rejects.toThrow(Error);
    await expect(second).rejects.toThrow(Error);
    expect(media.getTracks()[0].stop).toHaveBeenCalled();
  });

  test("creates one peer, routes events and removes failed connections", () => {
    vi.useFakeTimers();
    const mesh = makeMesh();
    const remote = vi.fn();
    const closed = vi.fn();
    mesh.onRemoteStream = remote;
    mesh.onPeerClosed = closed;
    mesh.stream = stream([track("local")]);
    expect(() => mesh.createPeer("")).toThrow(TypeError);
    delete globalThis.RTCPeerConnection;
    expect(() => mesh.createPeer("guest")).toThrow(Error);
    globalThis.RTCPeerConnection = FakePeer;
    const peer = mesh.createPeer("guest");
    expect(mesh.createPeer("guest")).toBe(peer);
    expect(peer.configuration.iceServers[0].urls).toContain("cloudflare");
    expect(peer.addTrack).toHaveBeenCalled();
    peer.onicecandidate({ candidate: { candidate: "ice" } });
    expect(mesh.roomClient.send).toHaveBeenCalledWith("signal", {
      targetId: "guest",
      signal: { candidate: { candidate: "ice" } }
    });
    peer.onicecandidate({ candidate: null });
    const remoteStream = stream([track("remote")]);
    peer.ontrack({ streams: [remoteStream] });
    peer.ontrack({ streams: [] });
    expect(remote).toHaveBeenCalledWith("guest", remoteStream);
    const channel = new FakeChannel();
    peer.ondatachannel({ channel });
    expect(mesh.channels.get("guest")).toBe(channel);
    peer.connectionState = "disconnected";
    peer.onconnectionstatechange();
    peer.connectionState = "connected";
    peer.onconnectionstatechange();
    vi.advanceTimersByTime(10_000);
    expect(mesh.peers.has("guest")).toBe(true);
    peer.connectionState = "failed";
    peer.onconnectionstatechange();
    expect(mesh.peers.has("guest")).toBe(false);
    expect(closed).toHaveBeenCalledWith("guest");
  });

  test("optimizes audio senders without rejecting unsupported senders", async () => {
    const mesh = makeMesh();
    const configured = {
      track: track(),
      getParameters: () => ({ encodings: [] }),
      setParameters: vi.fn().mockResolvedValue(undefined)
    };
    const rejected = {
      track: track("other"),
      getParameters: () => ({ encodings: [{}] }),
      setParameters: vi.fn().mockRejectedValue(new Error("unsupported"))
    };
    await expect(
      mesh.optimizeAudioSenders({
        getSenders: () => [configured, rejected, {}]
      })
    ).resolves.toBeUndefined();
    expect(
      configured.setParameters.mock.calls[0][0].encodings[0]
    ).toMatchObject({
      maxBitrate: 160_000,
      networkPriority: "high"
    });
  });

  test("invites once and sends the current local description", async () => {
    const mesh = makeMesh();
    expect(await mesh.invite("")).toBe(false);
    const first = mesh.invite("guest");
    const second = mesh.invite("guest");
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    const peer = FakePeer.instances[0];
    expect(peer.createOffer).toHaveBeenCalledTimes(1);
    expect(peer.createDataChannel).toHaveBeenCalled();
    expect(mesh.roomClient.send).toHaveBeenCalledWith("signal", {
      targetId: "guest",
      signal: { description: peer.localDescription }
    });
    expect(mesh.invitePromises.size).toBe(0);
  });

  test("queues ICE candidates and answers offers in arrival order", async () => {
    const mesh = makeMesh();
    expect(await mesh.accept("", {})).toBe(false);
    expect(await mesh.accept("guest", [])).toBe(false);
    expect(await mesh.accept("guest", { candidate: "one" })).toBe(true);
    expect(await mesh.accept("guest", { candidate: "two" })).toBe(true);
    expect(
      await mesh.accept("guest", { description: { type: "offer", sdp: "x" } })
    ).toBe(true);
    const peer = FakePeer.instances[0];
    expect(peer.addIceCandidate.mock.calls.map(([value]) => value)).toEqual([
      "one",
      "two"
    ]);
    expect(peer.createAnswer).toHaveBeenCalled();
    expect(mesh.roomClient.send).toHaveBeenLastCalledWith("signal", {
      targetId: "guest",
      signal: { description: peer.localDescription }
    });
    expect(
      await mesh.accept("guest", { description: { type: "answer" } })
    ).toBe(true);
    expect(await mesh.accept("guest", {})).toBe(false);
  });

  test("receives files, reports import progress and confirms completion", async () => {
    const mesh = makeMesh();
    const channel = new FakeChannel();
    const progress = vi.fn();
    const received = vi.fn().mockResolvedValue(undefined);
    mesh.onTransferProgress = progress;
    mesh.onFile = received;
    mesh.setupDataChannel("host", channel);
    channel.onmessage({
      data: JSON.stringify({
        type: "file-start",
        transferId: "transfer",
        size: 3,
        filename: "song.zip",
        mimeType: "application/zip"
      })
    });
    channel.onmessage({ data: new Uint8Array([1, 2]) });
    channel.onmessage({ data: new Uint8Array([3]).buffer });
    channel.onmessage({
      data: JSON.stringify({ type: "file-end", transferId: "transfer" })
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toHaveBeenCalled();
    expect(progress.mock.calls.map(([event]) => event.stage)).toEqual(
      expect.arrayContaining(["receiving", "importing", "complete"])
    );
    expect(channel.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "file-complete", transferId: "transfer" })
    );
  });

  test("rejects malformed, incomplete and failed incoming transfers", async () => {
    const mesh = makeMesh();
    const channel = new FakeChannel();
    mesh.setupDataChannel("host", channel);
    channel.onmessage({ data: "bad" });
    channel.onmessage({ data: "[]" });
    channel.onmessage({ data: "x".repeat(20_000) });
    channel.onmessage({
      data: JSON.stringify({ type: "file-start", transferId: "", size: -1 })
    });
    channel.onmessage({
      data: JSON.stringify({
        type: "file-start",
        transferId: "short",
        size: 2
      })
    });
    channel.onmessage({ data: new Uint8Array([1]) });
    channel.onmessage({
      data: JSON.stringify({ type: "file-end", transferId: "short" })
    });
    expect(JSON.parse(channel.send.mock.calls.at(-1)[0]).type).toBe(
      "file-error"
    );

    mesh.onFile = vi.fn().mockRejectedValue(new Error("import failed"));
    channel.onmessage({
      data: JSON.stringify({
        type: "file-start",
        transferId: "failed",
        size: 1
      })
    });
    channel.onmessage({ data: new Uint8Array([1]) });
    channel.onmessage({
      data: JSON.stringify({ type: "file-end", transferId: "failed" })
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.parse(channel.send.mock.calls.at(-1)[0]).type).toBe(
      "file-error"
    );
  });

  test("sends a file and waits for the matching receiver confirmation", async () => {
    const mesh = makeMesh();
    const channel = new FakeChannel();
    mesh.setupDataChannel("guest", channel);
    const progress = vi.fn();
    mesh.onTransferProgress = progress;
    const sending = mesh.sendFile(
      "guest",
      new Blob([new Uint8Array(40_000)], { type: "application/zip" }),
      { kind: "song-package", songId: "song", filename: "song.zip" }
    );
    await vi.waitFor(() => {
      expect(
        channel.send.mock.calls.some(
          ([value]) =>
            typeof value === "string" && JSON.parse(value).type === "file-end"
        )
      ).toBe(true);
    });
    const end = channel.send.mock.calls
      .map(([value]) => (typeof value === "string" ? JSON.parse(value) : null))
      .find((value) => value?.type === "file-end");
    channel.onmessage({
      data: JSON.stringify({
        type: "file-complete",
        transferId: end.transferId
      })
    });
    await expect(sending).resolves.toBeUndefined();
    expect(progress.mock.calls.at(-1)[0]).toMatchObject({
      participantId: "guest",
      stage: "complete",
      percent: 100
    });
  });

  test("validates outbound files and cleans confirmation when final send throws", async () => {
    const mesh = makeMesh();
    await expect(mesh.sendFile("", new Blob([]))).rejects.toThrow(TypeError);
    const channel = new FakeChannel();
    let sends = 0;
    channel.send.mockImplementation(() => {
      sends += 1;
      if (sends === 2) throw new Error("send failed");
    });
    mesh.setupDataChannel("guest", channel);
    await expect(mesh.sendFile("guest", new Blob([]))).rejects.toThrow(
      "send failed"
    );
    expect(mesh.pendingTransferConfirmations.size).toBe(0);
  });

  test("closes replacement channels and clears all transfer resources on stop", () => {
    vi.useFakeTimers();
    const mesh = makeMesh();
    const first = new FakeChannel();
    const second = new FakeChannel();
    mesh.setupDataChannel("guest", first);
    first.onmessage({
      data: JSON.stringify({
        type: "file-start",
        transferId: "transfer",
        size: 10
      })
    });
    const timer = mesh.incomingFiles.get("guest").timer;
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    mesh.setupDataChannel("guest", second);
    expect(first.close).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    mesh.incomingFiles.set("orphan", { timer: 99 });
    mesh.channels.set("orphan", new FakeChannel());
    mesh.stop();
    expect(mesh.channels.size).toBe(0);
    expect(mesh.incomingFiles.size).toBe(0);
  });

  test("attaches a new microphone to existing peers and flushes pending invites", async () => {
    const mesh = makeMesh();
    const peer = mesh.createPeer("guest");
    peer.senders.push({ track: track("existing") });
    const media = stream([track("existing"), track("new")]);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(media) }
      }
    });
    mesh.pendingInvites.add("queued");
    await mesh.start();
    expect(peer.addTrack).toHaveBeenCalledTimes(1);
    expect(mesh.roomClient.send).toHaveBeenCalled();
    mesh.setMicrophoneMuted(true);
    expect(media.getAudioTracks().every(({ enabled }) => !enabled)).toBe(true);
    mesh.setMicrophoneMuted(false);
    expect(media.getAudioTracks().every(({ enabled }) => enabled)).toBe(true);
  });

  test("rejects stale peer events and expires a disconnected peer", () => {
    vi.useFakeTimers();
    const mesh = makeMesh();
    const peer = mesh.createPeer("guest");
    mesh.removePeer("guest");
    const remoteTrack = track("remote");
    peer.ontrack({ streams: [stream([remoteTrack])] });
    expect(remoteTrack.stop).toHaveBeenCalled();
    const staleChannel = new FakeChannel();
    peer.ondatachannel({ channel: staleChannel });
    expect(staleChannel.close).toHaveBeenCalled();
    peer.connectionState = "disconnected";
    peer.onconnectionstatechange();

    const current = mesh.createPeer("current");
    current.connectionState = "disconnected";
    current.onconnectionstatechange();
    vi.advanceTimersByTime(10_000);
    expect(mesh.peers.has("current")).toBe(false);
  });

  test("clears channels, rejects receiver errors and expires stalled imports", () => {
    vi.useFakeTimers();
    const mesh = makeMesh();
    const channel = new FakeChannel();
    const reject = vi.fn();
    mesh.onTransferProgress = vi.fn();
    mesh.setupDataChannel("guest", channel);
    mesh.pendingTransferConfirmations.set("transfer", {
      participantId: "guest",
      reject,
      resolve: vi.fn(),
      timer: 1
    });
    channel.onmessage({
      data: JSON.stringify({ type: "file-error", transferId: "transfer" })
    });
    expect(reject).toHaveBeenCalledWith(expect.any(Error));

    channel.onmessage({
      data: JSON.stringify({
        type: "file-start",
        transferId: "stalled",
        size: 10
      })
    });
    vi.advanceTimersByTime(30_000);
    expect(JSON.parse(channel.send.mock.calls.at(-1)[0]).type).toBe(
      "file-error"
    );
    channel.onclose();
    expect(mesh.channels.has("guest")).toBe(false);
    channel.onerror();
  });

  test("waits for channels and reports closed, cancelled and timed out states", async () => {
    vi.useFakeTimers();
    const mesh = makeMesh();
    mesh.channels.set("open", new FakeChannel());
    await expect(mesh.waitForDataChannel("open")).resolves.toBe(
      mesh.channels.get("open")
    );
    mesh.channels.set("closed", new FakeChannel("closed"));
    await expect(mesh.waitForDataChannel("closed")).rejects.toThrow(Error);
    await expect(mesh.waitForDataChannel("missing", 0)).rejects.toThrow(Error);
    const cancelled = mesh.waitForDataChannel("missing", 100, -1);
    await expect(cancelled).rejects.toThrow(Error);
    const timeout = mesh.waitForDataChannel("missing", 100);
    const timeoutResult = expect(timeout).rejects.toThrow(Error);
    await vi.advanceTimersByTimeAsync(100);
    await timeoutResult;
  });

  test("rejects oversized files and confirmation timeouts", async () => {
    class LargeBlob extends Blob {
      get size() {
        return 513 * 1024 * 1024;
      }
    }
    const mesh = makeMesh();
    await expect(mesh.sendFile("guest", new LargeBlob([]))).rejects.toThrow(
      RangeError
    );

    vi.useFakeTimers();
    const channel = new FakeChannel();
    mesh.setupDataChannel("guest", channel);
    const sending = mesh.sendFile("guest", new Blob([]));
    const result = expect(sending).rejects.toThrow(Error);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await result;
  });

  test("recovers a failed signal queue and stops an active local stream", async () => {
    const mesh = makeMesh();
    mesh.signalPromises.set("guest", Promise.reject(new Error("old signal")));
    await expect(mesh.accept("guest", { candidate: "next" })).resolves.toBe(
      true
    );
    const localTrack = track("local");
    mesh.stream = stream([localTrack]);
    mesh.stop();
    expect(localTrack.stop).toHaveBeenCalledOnce();
  });
});
