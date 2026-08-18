import { describe, expect, test } from "vitest";
import {
  buildSoftLimiterCurve,
  connectMicrophoneChannelStrip
} from "../src/services/microphoneChannelStrip.js";

class Param {
  constructor() {
    this.value = 0;
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
    expect(created.filters[0].frequency.value).toBe(70);
    expect(created.filters[1].frequency.value).toBe(2200);
    expect(created.filters[1].gain.value).toBe(2.5);
    expect(created.compressors).toHaveLength(1);
    expect(created.compressors[0].threshold.value).toBe(-16);
    expect(created.gains).toHaveLength(1);
    expect(created.gains[0].gain.value).toBe(1.08);
    expect(created.shapers).toHaveLength(1);
    expect(created.shapers[0].oversample).toBe("2x");
    expect(created.shapers[0].curve).toHaveLength(1024);

    // Every node hands off to exactly the next stage, ending at destination.
    expect(source.target).toBe(nodes.highpass);
    expect(nodes.highpass.target).toBe(nodes.presence);
    expect(nodes.presence.target).toBe(nodes.compressor);
    expect(nodes.compressor.target).toBe(nodes.makeup);
    expect(nodes.makeup.target).toBe(nodes.limiter);
    expect(nodes.limiter.target).toBe(destination);
  });

  test("soft limiter curve is a monotonic, symmetric tanh shape bounded within [-1, 1]", () => {
    const curve = buildSoftLimiterCurve();
    expect(curve).toHaveLength(1024);
    expect(curve[0]).toBeCloseTo(-1, 5);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 5);
    expect(curve[Math.floor(curve.length / 2)]).toBeCloseTo(0, 2);
    for (let index = 1; index < curve.length; index += 1) {
      expect(curve[index]).toBeGreaterThanOrEqual(curve[index - 1]);
      expect(curve[index]).toBeGreaterThanOrEqual(-1);
      expect(curve[index]).toBeLessThanOrEqual(1);
    }
  });
});
