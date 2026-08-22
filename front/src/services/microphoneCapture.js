import { MICROPHONE_CAPTURE_CONSTRAINTS } from "../utils/microphone-capture-constraints";
import { createStudioMicrophoneGraph } from "./microphoneStudioQuality";

let active = null;
let queue = Promise.resolve();

const live = (stream) =>
  stream?.getAudioTracks?.().some(({ readyState }) => readyState === "live") === true;
const device = (value) => {
  const id = String(value ?? "").trim();
  return id && id !== "default" ? id : "";
};
const constraints = (id) => ({
  audio: {
    ...MICROPHONE_CAPTURE_CONSTRAINTS,
    channelCount: 1,
    sampleRate: { ideal: 44_100 },
    sampleSize: { ideal: 24 },
    ...(id && { deviceId: { exact: id } })
  }
});

async function capture(id) {
  try {
    return { stream: await navigator.mediaDevices.getUserMedia(constraints(id)), deviceId: id };
  } catch (error) {
    if (!id) throw error;
    return {
      stream: await navigator.mediaDevices.getUserMedia(constraints("")),
      deviceId: ""
    };
  }
}

async function resolve(id) {
  if (!live(active?.graph?.stream)) {
    const next = await capture(id);
    active = { deviceId: next.deviceId, graph: createStudioMicrophoneGraph(next.stream), users: 0 };
  } else if (id && active.deviceId !== id) {
    const next = await capture(id);
    await active.graph.replaceInput(next.stream);
    active.deviceId = next.deviceId;
  }
  return active;
}

export async function acquireMicrophone(preferredDeviceId = "", { disabledEffects = false } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is unavailable");
  const request = queue.catch(() => {}).then(() => resolve(device(preferredDeviceId)));
  queue = request;
  const entry = await request;
  entry.users += 1;
  let released = false;
  return {
    stream:
      entry.graph.getStream?.({ disabledEffects }) ??
      (disabledEffects ? entry.graph.rawStream : entry.graph.stream),
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
