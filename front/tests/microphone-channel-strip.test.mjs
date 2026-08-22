import { describe, expect, test } from "vitest";
import { buildNoiseGateCurve, buildSoftLimiterCurve, connectMicrophoneChannelStrip } from "../src/services/microphoneChannelStrip.js";
import { same, verify } from "./helpers/assertions.mjs";
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
    same([created.filters[0].frequency.value, 70], [created.filters[1].frequency.value, 2200], [created.filters[1].gain.value, 2.5]);
    verify(
      [created.compressors, "toHaveLength", 1],
      [created.compressors[0].threshold.value, "toBe", -16],
      [created.gains, "toHaveLength", 1],
      [created.gains[0].gain.value, "toBe", 1.08],
      [created.shapers, "toHaveLength", 2],
      [nodes.noiseGate.curve, "toHaveLength", 4096],
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
  test("noise suppression curve remains symmetric and strength-adjustable", () => {
    const weak = buildNoiseGateCurve(0);
    const strong = buildNoiseGateCurve(1);
    verify([weak, "toHaveLength", 4096], [strong, "toHaveLength", 4096]);
    expect(Math.abs(strong[2050])).toBeLessThan(Math.abs(weak[2050]));
    expect(strong[0]).toBeCloseTo(-1, 5);
    expect(strong.at(-1)).toBeCloseTo(1, 5);
  });
});
