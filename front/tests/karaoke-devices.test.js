import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrowserDeviceOptions,
  createBufferSizeOptions,
  createIndexedDeviceOptions
} from "../src/pages/Karaoke/utils/devices.js";

test("createIndexedDeviceOptions includes a default and backend devices", () => {
  assert.deepEqual(
    createIndexedDeviceOptions([{ index: 2, name: "Audient" }]),
    [
      { value: "", label: "По умолчанию" },
      { value: 2, label: "Audient" }
    ]
  );
});

test("createBrowserDeviceOptions falls back for hidden browser labels", () => {
  assert.deepEqual(
    createBrowserDeviceOptions([{ deviceId: "mic-1", label: "" }], "Микрофон"),
    [
      { value: "default", label: "Системное по умолчанию" },
      { value: "mic-1", label: "Микрофон" }
    ]
  );
});

test("createBufferSizeOptions formats sample counts", () => {
  assert.deepEqual(createBufferSizeOptions([64, 128]), [
    { value: 64, label: "64 samples" },
    { value: 128, label: "128 samples" }
  ]);
});
