import assert from "node:assert/strict";
import test from "node:test";
import {
  findMatchingBrowserOutput,
  findPreferredOutputDevice,
  groupBrowserAudioDevices,
  normalizeAudioEffects,
  normalizeAudioRuntimeSettings
} from "../src/pages/Karaoke/utils/audio-settings.js";

test("normalizeAudioEffects clamps invalid negative values", () => {
  assert.deepEqual(
    normalizeAudioEffects({ reverb: "0.4", echo: -2, delay: null }),
    {
      reverb: 0.4,
      echo: 0,
      delay: 0
    }
  );
});

test("normalizeAudioRuntimeSettings supplies stable defaults", () => {
  assert.deepEqual(normalizeAudioRuntimeSettings(null), {
    volume: 0,
    audioDriver: "auto",
    asioDriverName: "",
    bufferSize: 64,
    monitoringEnabled: false,
    outputDeviceId: ""
  });
  assert.deepEqual(
    normalizeAudioRuntimeSettings({
      volume: 5,
      audio_driver: "asio",
      asio_driver_name: "Driver",
      buffer_size: "128",
      monitoring_enabled: 1,
      output_device_id: 4
    }),
    {
      volume: 1,
      audioDriver: "asio",
      asioDriverName: "Driver",
      bufferSize: 128,
      monitoringEnabled: true,
      outputDeviceId: 4
    }
  );
});

test("findPreferredOutputDevice is null-safe and case-insensitive", () => {
  const devices = [null, { index: 1 }, { index: 2, name: "Audient iD4" }];
  assert.equal(findPreferredOutputDevice(devices)?.index, 2);
  assert.equal(findPreferredOutputDevice(devices, "missing"), null);
});

test("findMatchingBrowserOutput matches labels in either containment direction", () => {
  const entries = [
    { kind: "audioinput", deviceId: "in", label: "Audient" },
    { kind: "audiooutput", deviceId: "out", label: "Speakers (Audient iD4)" }
  ];
  assert.equal(
    findMatchingBrowserOutput(entries, { name: "Audient iD4" })?.deviceId,
    "out"
  );
  assert.equal(findMatchingBrowserOutput(entries, { name: "" }), null);
});

test("groupBrowserAudioDevices ignores unrelated device kinds", () => {
  const grouped = groupBrowserAudioDevices([
    { kind: "audioinput", deviceId: "in" },
    { kind: "audiooutput", deviceId: "out" },
    { kind: "videoinput", deviceId: "cam" },
    null
  ]);
  assert.deepEqual(
    grouped.inputs.map((item) => item.deviceId),
    ["in"]
  );
  assert.deepEqual(
    grouped.outputs.map((item) => item.deviceId),
    ["out"]
  );
});
