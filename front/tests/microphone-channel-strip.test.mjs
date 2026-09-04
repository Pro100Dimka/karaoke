import { describe, expect, test, vi } from "vitest";
import { buildSoftLimiterCurve, connectMicrophoneChannelStrip } from "../src/services/microphoneChannelStrip.js";
import { same, verify } from "./helpers/assertions.mjs";
class Param {
  constructor() {
    this.value = 0;
  }
  setTargetAtTime(value) {
    this.value = value;
  }
}
class Node {
  constructor() {
    ["frequency", "gain", "threshold", "knee", "ratio", "attack", "release"].forEach((name) => {
      this[name] = new Param();
    });
  }
  connect(target) {
    this.target = target;
    return target;
  }
  getByteTimeDomainData(samples) {
    samples.fill(this.sample ?? 128);
  }
}
function createContext(created) {
  return {
    createBiquadFilter() {
      const node = new Node();
      created.filters.push(node);
      return node;
    },
    createDynamicsCompressor() {
      const node = new Node();
      created.compressors.push(node);
      return node;
    },
    createGain() {
      const node = new Node();
      created.gains.push(node);
      return node;
    },
    createAnalyser() {
      if (!created.analysers) return undefined;
      const node = new Node();
      created.analysers.push(node);
      return node;
    },
    createWaveShaper() {
      const node = new Node();
      created.shapers.push(node);
      return node;
    }
  };
}
describe("microphoneChannelStrip", () => {
  test("connects one highpass -> presence -> compressor -> makeup -> limiter chain", () => {
    const created = { filters: [], compressors: [], gains: [], shapers: [] };
    const context = createContext(created);
    const source = new Node();
    const destination = new Node();
    const nodes = connectMicrophoneChannelStrip(context, source, destination);
    expect(created.filters.map((node) => node.type)).toEqual(["highpass", "highshelf"]);
    same([created.filters[0].frequency.value, 70], [created.filters[1].frequency.value, 2200], [created.filters[1].gain.value, 1.2]);
    verify(
      [created.compressors, "toHaveLength", 1],
      [created.compressors[0].threshold.value, "toBe", -16],
      [created.gains, "toHaveLength", 2],
      [nodes.noiseGate.gain.value, "toBe", 1],
      [nodes.makeup.gain.value, "toBe", 1.04],
      [created.shapers, "toHaveLength", 1],
      [nodes.limiter.curve, "toHaveLength", 1024]
    );
    // Every node hands off to exactly the next stage, ending at destination.
    same(
      [source.target, nodes.highpass],
      [nodes.highpass.target, nodes.noiseGate],
      [nodes.noiseGate.target, nodes.presence],
      [nodes.presence.target, nodes.compressor],
      [nodes.compressor.target, nodes.makeup],
      [nodes.makeup.target, nodes.limiter],
      [nodes.limiter.target, destination]
    );
  });
  test("soft limiter curve is a monotonic, symmetric tanh shape bounded within [-1, 1]", () => {
    const curve = buildSoftLimiterCurve();
    verify(
      [curve, "toHaveLength", 1024],
      [curve[0], "toBeCloseTo", -1, 5],
      [curve[curve.length - 1], "toBeCloseTo", 1, 5],
      [curve[Math.floor(curve.length / 2)], "toBeCloseTo", 0, 2]
    );
    for (let index = 1; index < curve.length; index += 1) {
      verify(
        [curve[index], "toBeGreaterThanOrEqual", curve[index - 1]],
        [curve[index], "toBeGreaterThanOrEqual", -1],
        [curve[index], "toBeLessThanOrEqual", 1]
      );
    }
  });
  test("realtime mode removes compressor look-ahead and limiter oversampling", () => {
    const created = { filters: [], compressors: [], gains: [], shapers: [] };
    const source = new Node();
    const destination = new Node();
    const nodes = connectMicrophoneChannelStrip(createContext(created), source, destination, {
      realtime: true
    });
    same(
      [nodes.limiter.oversample, "none"],
      [nodes.presence.target, nodes.makeup],
      [nodes.makeup.target, nodes.limiter],
      [nodes.limiter.target, destination]
    );
    expect(nodes.compressor.target).toBeUndefined();
  });
  test("noise gate follows the signal envelope instead of reshaping individual samples", () => {
    vi.useFakeTimers();
    const created = { filters: [], compressors: [], gains: [], shapers: [], analysers: [] };
    const nodes = connectMicrophoneChannelStrip(createContext(created), new Node(), new Node(), { noiseSuppression: 1 });
    vi.advanceTimersByTime(48);
    expect(nodes.noiseGate.gain.value).toBeLessThan(1);
    created.analysers[0].sample = 160;
    vi.advanceTimersByTime(24);
    expect(nodes.noiseGate.gain.value).toBe(1);
    nodes.close();
    vi.useRealTimers();
  });
});
