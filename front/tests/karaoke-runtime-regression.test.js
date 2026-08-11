import assert from "node:assert/strict";
import test from "node:test";

import { normalizePreset } from "../src/pages/Karaoke/components/console/utils.js";
import {
  normalizeAudioEffects
} from "../src/pages/Karaoke/utils/audio-settings.js";
import {
  normalizeKaraokePreferences
} from "../src/pages/Karaoke/utils/preferences.js";
import { getMicrophoneLevel } from "../src/pages/Karaoke/utils/transport.js";


test("effect presets preserve delay for karaoke recording/monitoring", () => {
  assert.deepEqual(
    normalizePreset({
      id: "hall",
      label: "Hall",
      symbol: "#",
      echo: 0.2,
      reverb: 0.7,
      delay: 0.16
    }),
    ["hall", "Hall", "#", 0.2, 0.7, 0.16]
  );
});


test("karaoke preferences recover from stale and invalid localStorage values", () => {
  assert.deepEqual(
    normalizeKaraokePreferences({
      musicVolume: 12,
      vocalVolume: -3,
      melodyVolume: "0.4",
      speed: "not-a-number",
      keyShift: "99",
      showLyrics: "false",
      showNotes: "true",
      autoHideConsole: "0",
      effectPreset: "  hall  "
    }),
    {
      musicVolume: 1,
      vocalVolume: 0,
      melodyVolume: 0.4,
      speed: 1,
      keyShift: 12,
      showLyrics: false,
      showNotes: true,
      autoHideConsole: false,
      effectPreset: "hall"
    }
  );
});


test("audio effects are always normalized to the supported 0..1 range", () => {
  assert.deepEqual(normalizeAudioEffects({ reverb: 2, echo: -1, delay: "0.3" }), {
    reverb: 1,
    echo: 0,
    delay: 0.3
  });
});


test("microphone meter accepts both backend rms field names", () => {
  assert.equal(getMicrophoneLevel({ rms_db: -30 }), 50);
  assert.equal(getMicrophoneLevel({ rms_dbfs: -30 }), 50);
  assert.equal(getMicrophoneLevel({ rms_dbfs: Number.NaN }), 0);
});

import { detectMidiFromAnalyser } from "../src/pages/Karaoke/utils/pitch.js";

function detectSyntheticFrequency(frequency, sampleRate = 44100) {
  const buffer = new Float32Array(2048);
  const analyser = {
    getFloatTimeDomainData(target) {
      for (let index = 0; index < target.length; index += 1) {
        target[index] = 0.2 * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
      }
    }
  };
  return detectMidiFromAnalyser(analyser, buffer, sampleRate);
}

test("pitch detection covers low male and high female karaoke notes", () => {
  const cases = [
    [65.406, 36],
    [440, 69],
    [1046.502, 84]
  ];

  for (const [frequency, expectedMidi] of cases) {
    const actual = detectSyntheticFrequency(frequency);
    assert.ok(Number.isFinite(actual), `expected ${frequency} Hz to be detected`);
    assert.ok(
      Math.abs(actual - expectedMidi) < 0.35,
      `${frequency} Hz resolved to MIDI ${actual}, expected about ${expectedMidi}`
    );
  }
});
