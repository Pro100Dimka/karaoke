import { MICROPHONE_CAPTURE_CONSTRAINTS } from "../utils/microphone-capture-constraints";
import { createStudioMicrophoneGraph } from "./microphoneStudioQuality";

let active = null;
let pending = null;

const isLive = (stream) =>
  stream?.getAudioTracks?.().some((track) => track.readyState === "live") === true;

const normalizeDeviceId = (deviceId) => {
  const value = String(deviceId || "").trim();
  return value && value !== "default" ? value : "";
};

const constraintsFor = (deviceId) => ({
  audio: {
    ...MICROPHONE_CAPTURE_CONSTRAINTS,
    channelCount: 1,
    sampleRate: { ideal: 44_100 },
    sampleSize: { ideal: 24 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {})
  }
});

async function captureRaw(deviceId) {
  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia(constraintsFor(deviceId)),
      deviceId
    };
  } catch (error) {
    if (!deviceId) throw error;
    return {
      stream: await navigator.mediaDevices.getUserMedia(constraintsFor("")),
      deviceId: ""
    };
  }
}

async function openCapture(deviceId) {
  if (isLive(active?.graph?.stream)) return active;
  const capture = await captureRaw(deviceId);
  const graph = createStudioMicrophoneGraph(capture.stream);
  active = { deviceId: capture.deviceId, graph, users: 0 };
  return active;
}

async function resolveCapture(deviceId) {
  if (!isLive(active?.graph?.stream)) return openCapture(deviceId);
  const entry = active;
  if (!deviceId || entry.deviceId === deviceId) return entry;
  const capture = await captureRaw(deviceId);
  await entry.graph.replaceInput(capture.stream);
  entry.deviceId = capture.deviceId;
  return entry;
}

export async function acquireMicrophone(preferredDeviceId = "", { disabledEffects = false } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is unavailable");
  const deviceId = normalizeDeviceId(preferredDeviceId);
  const request = (pending || Promise.resolve())
    .catch(() => {})
    .then(() => resolveCapture(deviceId));
  pending = request;
  let entry;
  try {
    entry = await request;
  } finally {
    if (pending === request) pending = null;
  }
  entry.users += 1;
  let released = false;
  return {
    stream:
      entry.graph.getStream?.({ disabledEffects }) ??
      (disabledEffects ? entry.graph.rawStream : entry.graph.stream) ??
      entry.graph.stream,
    setNoiseSuppression: entry.graph.setNoiseSuppression,
    async release() {
      if (released) return;
      released = true;
      entry.users = Math.max(0, entry.users - 1);
      if (entry.users || active !== entry) return;
      active = null;
      await entry.graph.close();
    }
  };
}

export async function closeMicrophoneCapture() {
  const entry = active;
  active = null;
  if (entry) await entry.graph.close();
}
