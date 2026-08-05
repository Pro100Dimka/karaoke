import assert from "node:assert/strict";
import test from "node:test";

import { detectMidiFromAnalyser } from "../src/pages/Karaoke/utils/pitch.js";

function analyserFor(samples) {
  return {
    getFloatTimeDomainData(buffer) {
      buffer.set(samples.subarray(0, buffer.length));
    }
  };
}

test("detectMidiFromAnalyser returns null for silence", () => {
  const buffer = new Float32Array(2048);
  assert.equal(
    detectMidiFromAnalyser(analyserFor(buffer), buffer, 48000),
    null
  );
});

test("detectMidiFromAnalyser detects a stable A4 tone", () => {
  const sampleRate = 48000;
  const samples = new Float32Array(4096);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 0.2 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
  }
  const midi = detectMidiFromAnalyser(
    analyserFor(samples),
    new Float32Array(samples.length),
    sampleRate
  );
  assert.ok(Number.isFinite(midi));
  assert.ok(Math.abs(midi - 69) < 0.2, `expected A4, received MIDI ${midi}`);
});
