import { afterEach, describe, expect, test, vi } from "vitest";
import { createStudioMicrophoneGraph } from "../src/services/microphoneStudioQuality.js";
import { verify } from "./helpers/assertions.mjs";
class Param {
  constructor() {
    this.value = 0;
  }
}
class Node {
  constructor() {
    ["frequency", "Q", "gain", "threshold", "knee", "ratio", "attack", "release"].forEach(
      (name) => {
        this[name] = new Param();
      }
    );
  }
  connect(target) {
    this.target = target;
    return target;
  }
  disconnect() {}
}
describe("studio microphone quality", () => {
  afterEach(() => {
    delete globalThis.AudioContext;
  });
  test("builds an always-on cleanup graph through the shared channel strip", async () => {
    // Room self-monitor and room outgoing-to-peers must sound identical --
    // both now build the exact same node chain (see
    // src/services/microphoneChannelStrip.js) instead of two independently
    // hand-tuned graphs.
    const processedTrack = { kind: "audio", contentHint: "", stop: vi.fn() };
    const destination = {
      stream: { getAudioTracks: () => [processedTrack], getTracks: () => [processedTrack] }
    };
    const created = { filters: [], compressors: [], shapers: [] };
    globalThis.AudioContext = class {
      constructor() {
        this.state = "running";
      }
      createMediaStreamSource() {
        return new Node();
      }
      createBiquadFilter() {
        const node = new Node();
        created.filters.push(node);
        return node;
      }
      createDynamicsCompressor() {
        const node = new Node();
        created.compressors.push(node);
        return node;
      }
      createGain() {
        return new Node();
      }
      createWaveShaper() {
        const node = new Node();
        created.shapers.push(node);
        return node;
      }
      createMediaStreamDestination() {
        return destination;
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        this.state = "closed";
        return Promise.resolve();
      }
    };
    const rawTrack = { kind: "audio", stop: vi.fn() };
    const rawStream = { getTracks: () => [rawTrack] };
    const graph = createStudioMicrophoneGraph(rawStream);
    verify(
      [graph.stream, "toBe", destination.stream],
      [graph.getStream(), "toBe", destination.stream],
      [graph.getStream({ disabledEffects: true }), "toBe", rawStream],
      [created.filters.map((node) => node.type), "toEqual", ["highpass", "highshelf"]],
      [created.compressors, "toHaveLength", 1],
      [created.shapers, "toHaveLength", 2],
      [processedTrack.contentHint, "toBe", "music"]
    );
    await graph.close();
    expect(rawTrack.stop).toHaveBeenCalledOnce();
    expect(processedTrack.stop).toHaveBeenCalledOnce();
  });
  test("degrades to the raw stream without leaking capture when WebAudio is unavailable", async () => {
    const track = { stop: vi.fn() };
    const rawStream = { getTracks: () => [track] };
    const graph = createStudioMicrophoneGraph(rawStream);
    expect(graph.stream).toBe(rawStream);
    await graph.close();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  test("rolls back the raw stream when graph construction fails", () => {
    const track = { stop: vi.fn() };
    const rawStream = { getTracks: () => [track] };
    globalThis.AudioContext = class {
      constructor() {
        this.state = "running";
      }
      createMediaStreamSource() {
        throw new Error("audio graph failed");
      }
      close() {
        this.state = "closed";
        return Promise.resolve();
      }
    };
    expect(() => createStudioMicrophoneGraph(rawStream)).toThrow("audio graph failed");
    expect(track.stop).toHaveBeenCalledOnce();
  });
});
