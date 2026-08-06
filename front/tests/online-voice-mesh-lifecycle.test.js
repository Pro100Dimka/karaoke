import assert from "node:assert/strict";
import test from "node:test";
import OnlineVoiceMesh from "../src/services/onlineVoiceMesh.js";

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test("OnlineVoiceMesh deduplicates simultaneous microphone starts", async () => {
  const originalNavigator = globalThis.navigator;
  const deferred = createDeferred();
  let requests = 0;
  const track = { id: "track-1", stop() {} };
  const stream = { getTracks: () => [track] };

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia() {
          requests += 1;
          return deferred.promise;
        }
      }
    }
  });

  try {
    const voice = new OnlineVoiceMesh({ send() {} });
    const first = voice.start();
    const second = voice.start();
    deferred.resolve(stream);

    assert.equal(await first, stream);
    assert.equal(await second, stream);
    assert.equal(requests, 1);
    assert.equal(voice.stream, stream);
  } finally {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator
    });
  }
});

test("OnlineVoiceMesh stops a stream that resolves after cleanup", async () => {
  const originalNavigator = globalThis.navigator;
  const deferred = createDeferred();
  let stopped = 0;
  const track = {
    id: "track-1",
    stop() {
      stopped += 1;
    }
  };
  const stream = { getTracks: () => [track] };

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () => deferred.promise
      }
    }
  });

  try {
    const voice = new OnlineVoiceMesh({ send() {} });
    const starting = voice.start();
    voice.stop();
    deferred.resolve(stream);

    await assert.rejects(starting, /Запуск микрофона отменён/);
    assert.equal(stopped, 1);
    assert.equal(voice.stream, null);
    assert.equal(voice.startPromise, null);
  } finally {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator
    });
  }
});

test("OnlineVoiceMesh keeps only the visible bytes of typed-array file chunks", async () => {
  const voice = new OnlineVoiceMesh({ send() {} });
  const channel = { readyState: "open" };
  let resolveReceived;
  const receivedPromise = new Promise((resolve) => {
    resolveReceived = resolve;
  });
  voice.onFile = async (_participantId, blob, metadata) => {
    resolveReceived({
      bytes: [...new Uint8Array(await blob.arrayBuffer())],
      metadata
    });
  };
  voice.setupDataChannel("participant-1", channel);

  channel.onmessage({
    data: JSON.stringify({
      type: "file-start",
      transferId: "transfer-1",
      size: 2,
      mimeType: "application/octet-stream"
    })
  });
  const backingBuffer = new Uint8Array([99, 1, 2, 88]);
  channel.onmessage({ data: backingBuffer.subarray(1, 3) });
  channel.onmessage({
    data: JSON.stringify({ type: "file-end", transferId: "transfer-1" })
  });

  const received = await receivedPromise;
  assert.deepEqual(received.bytes, [1, 2]);
  assert.equal(received.metadata.transferId, "transfer-1");
});

test("OnlineVoiceMesh rejects incomplete incoming files", () => {
  const voice = new OnlineVoiceMesh({ send() {} });
  const channel = { readyState: "open" };
  let files = 0;
  voice.onFile = () => {
    files += 1;
  };
  voice.setupDataChannel("participant-1", channel);

  channel.onmessage({
    data: JSON.stringify({
      type: "file-start",
      transferId: "transfer-1",
      size: 3
    })
  });
  channel.onmessage({ data: new Uint8Array([1, 2]).buffer });
  channel.onmessage({
    data: JSON.stringify({ type: "file-end", transferId: "transfer-1" })
  });

  assert.equal(files, 0);
  assert.equal(voice.incomingFiles.size, 0);
});

test("OnlineVoiceMesh cancels buffered file sends after cleanup", async () => {
  const voice = new OnlineVoiceMesh({ send() {} });
  const channel = {
    readyState: "open",
    bufferedAmount: 1024 * 1024,
    send() {}
  };
  voice.channels.set("participant-1", channel);

  const sending = voice.sendFile(
    "participant-1",
    new Blob([new Uint8Array(64 * 1024)])
  );
  voice.stop();

  await assert.rejects(sending, /Передача файла отменена/);
});

test("OnlineVoiceMesh serializes simultaneous invitations per participant", async () => {
  const offerDeferred = createDeferred();
  const peer = {
    connectionState: "new",
    localDescription: null,
    createDataChannel: () => ({ readyState: "connecting", close() {} }),
    createOfferCalls: 0,
    async createOffer() {
      this.createOfferCalls += 1;
      return offerDeferred.promise;
    },
    async setLocalDescription(description) {
      this.localDescription = description;
    }
  };
  const sent = [];
  const voice = new OnlineVoiceMesh({
    send(type, payload) {
      sent.push({ type, payload });
      return true;
    }
  });
  voice.createPeer = () => {
    voice.peers.set("participant-1", peer);
    return peer;
  };

  const first = voice.invite("participant-1");
  const second = voice.invite("participant-1");
  offerDeferred.resolve({ type: "offer", sdp: "test" });

  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(peer.createOfferCalls, 1);
  assert.equal(sent.length, 1);
  assert.equal(voice.invitePromises.size, 0);
});

test("OnlineVoiceMesh does not send an offer from a peer removed mid-invite", async () => {
  const offerDeferred = createDeferred();
  const peer = {
    connectionState: "new",
    localDescription: null,
    createDataChannel: () => ({ readyState: "connecting", close() {} }),
    createOffer: () => offerDeferred.promise,
    async setLocalDescription(description) {
      this.localDescription = description;
    },
    close() {
      this.connectionState = "closed";
    }
  };
  let sends = 0;
  const voice = new OnlineVoiceMesh({
    send() {
      sends += 1;
      return true;
    }
  });
  voice.createPeer = () => {
    voice.peers.set("participant-1", peer);
    return peer;
  };

  const inviting = voice.invite("participant-1");
  voice.removePeer("participant-1");
  offerDeferred.resolve({ type: "offer", sdp: "stale" });

  assert.equal(await inviting, false);
  assert.equal(sends, 0);
  assert.equal(voice.invitePromises.size, 0);
});

test("OnlineVoiceMesh keeps protocol fields authoritative over file metadata", async () => {
  const sent = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    send(value) {
      sent.push(value);
    }
  };
  const voice = new OnlineVoiceMesh({ send() {} });
  voice.channels.set("participant-1", channel);

  await voice.sendFile(
    "participant-1",
    new Blob([new Uint8Array([1, 2, 3])], { type: "application/zip" }),
    {
      type: "unexpected",
      transferId: "spoofed",
      size: 999,
      mimeType: "text/plain",
      kind: "song-package"
    }
  );

  const start = JSON.parse(sent[0]);
  assert.equal(start.type, "file-start");
  assert.notEqual(start.transferId, "spoofed");
  assert.equal(start.size, 3);
  assert.equal(start.mimeType, "application/zip");
  assert.equal(start.kind, "song-package");
});

test("OnlineVoiceMesh drops partial incoming files when their channel closes", () => {
  const voice = new OnlineVoiceMesh({ send() {} });
  const channel = { readyState: "open" };
  voice.setupDataChannel("participant-1", channel);

  channel.onmessage({
    data: JSON.stringify({
      type: "file-start",
      transferId: "transfer-1",
      size: 100
    })
  });
  assert.equal(voice.incomingFiles.size, 1);

  channel.onclose();
  assert.equal(voice.incomingFiles.size, 0);
  assert.equal(voice.channels.size, 0);
});

test("OnlineVoiceMesh clears partial transfer state when replacing a data channel", () => {
  let previousClosed = 0;
  const previous = {
    readyState: "open",
    close() {
      previousClosed += 1;
      this.readyState = "closed";
    }
  };
  const next = { readyState: "open" };
  const voice = new OnlineVoiceMesh({ send() {} });
  voice.setupDataChannel("participant-1", previous);
  previous.onmessage({
    data: JSON.stringify({
      type: "file-start",
      transferId: "old-transfer",
      size: 10
    })
  });

  voice.setupDataChannel("participant-1", next);

  assert.equal(previousClosed, 1);
  assert.equal(voice.incomingFiles.size, 0);
  assert.equal(voice.channels.get("participant-1"), next);
});

test("OnlineVoiceMesh ignores callbacks from a replaced peer", () => {
  const originalPeerConnection = globalThis.RTCPeerConnection;
  const createdPeers = [];

  class FakePeerConnection {
    constructor() {
      this.connectionState = "new";
      createdPeers.push(this);
    }

    getSenders() {
      return [];
    }

    close() {
      this.connectionState = "closed";
    }
  }

  Object.defineProperty(globalThis, "RTCPeerConnection", {
    configurable: true,
    value: FakePeerConnection
  });

  try {
    const sent = [];
    const voice = new OnlineVoiceMesh({
      send(type, payload) {
        sent.push({ type, payload });
        return true;
      }
    });
    let remoteStreams = 0;
    voice.onRemoteStream = () => {
      remoteStreams += 1;
    };

    const oldPeer = voice.createPeer("participant-1");
    voice.peers.delete("participant-1");
    const currentPeer = voice.createPeer("participant-1");
    let staleTrackStopped = 0;
    let staleChannelClosed = 0;

    oldPeer.onicecandidate({ candidate: { candidate: "stale" } });
    oldPeer.ontrack({
      streams: [
        {
          getTracks: () => [
            {
              stop() {
                staleTrackStopped += 1;
              }
            }
          ]
        }
      ]
    });
    oldPeer.ondatachannel({
      channel: {
        close() {
          staleChannelClosed += 1;
        }
      }
    });
    oldPeer.connectionState = "failed";
    oldPeer.onconnectionstatechange();

    assert.equal(sent.length, 0);
    assert.equal(remoteStreams, 0);
    assert.equal(staleTrackStopped, 1);
    assert.equal(staleChannelClosed, 1);
    assert.equal(voice.peers.get("participant-1"), currentPeer);
  } finally {
    Object.defineProperty(globalThis, "RTCPeerConnection", {
      configurable: true,
      value: originalPeerConnection
    });
  }
});

test("OnlineVoiceMesh serializes incoming signals and drops a stale answer", async () => {
  const remoteDescription = createDeferred();
  const peer = {
    connectionState: "new",
    remoteDescription: null,
    localDescription: null,
    async setRemoteDescription(description) {
      await remoteDescription.promise;
      this.remoteDescription = description;
    },
    async addIceCandidate(candidate) {
      this.candidates = [...(this.candidates || []), candidate];
    },
    async createAnswer() {
      return { type: "answer", sdp: "answer" };
    },
    async setLocalDescription(description) {
      this.localDescription = description;
    },
    close() {
      this.connectionState = "closed";
    }
  };
  let sends = 0;
  const voice = new OnlineVoiceMesh({
    send() {
      sends += 1;
      return true;
    }
  });
  voice.createPeer = () => {
    if (!voice.peers.has("participant-1")) {
      voice.peers.set("participant-1", peer);
    }
    return voice.peers.get("participant-1");
  };

  const offer = voice.accept("participant-1", {
    description: { type: "offer", sdp: "offer" }
  });
  const candidate = voice.accept("participant-1", {
    candidate: { candidate: "candidate-1" }
  });

  await Promise.resolve();
  voice.removePeer("participant-1");
  remoteDescription.resolve();

  assert.equal(await offer, false);
  assert.equal(await candidate, false);
  assert.equal(sends, 0);
  assert.equal(voice.signalPromises.size, 0);
});
