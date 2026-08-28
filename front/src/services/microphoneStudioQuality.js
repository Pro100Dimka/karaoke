import { closeAudioContext, closeAudioContextQuietly } from "../utils/audio-context";
import { connectMicrophoneChannelStrip } from "./microphoneChannelStrip";

const stop = (stream) => stream?.getTracks?.().forEach((track) => track.stop());
const disconnect = (node) => {
  try {
    node?.disconnect?.();
  } catch {
    // A source can already be detached by the browser.
  }
};

let noiseSuppression = 0.35;
globalThis.addEventListener?.("audio-settings-changed", ({ detail }) => {
  const value = Number(detail?.noise_suppression);
  if (Number.isFinite(value)) noiseSuppression = Math.max(0, Math.min(1, value));
});

function rawGraph(stream) {
  return {
    stream,
    rawStream: stream,
    getStream: () => stream,
    close: async () => stop(stream)
  };
}

export function createStudioMicrophoneGraph(rawStream, options = {}) {
  const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContext?.prototype || !rawStream) return rawGraph(rawStream);
  let context;
  let source;
  let input = rawStream;
  try {
    // Let the browser use the endpoint's native rate. 41 kHz is not a standard
    // hardware rate and makes some Windows devices resample or fail to open.
    context = new AudioContext({ latencyHint: "interactive" });
    source = context.createMediaStreamSource(input);
    const destination = context.createMediaStreamDestination();
    const strip = connectMicrophoneChannelStrip(context, source, destination, {
      noiseSuppression: options.noiseSuppression ?? noiseSuppression
    });
    const sync = ({ detail }) => {
      if (detail?.noise_suppression != null) strip.setNoiseSuppression(detail.noise_suppression);
    };
    globalThis.addEventListener?.("audio-settings-changed", sync);
    destination.stream.getAudioTracks?.().forEach((track) => {
      track.contentHint = "music";
    });
    context.resume?.().catch(() => {});
    return {
      stream: destination.stream,
      rawStream,
      context,
      setNoiseSuppression: strip.setNoiseSuppression,
      getStream: ({ disabledEffects = false } = {}) =>
        disabledEffects ? input : destination.stream,
      async replaceInput(stream) {
        const next = context.createMediaStreamSource(stream);
        next.connect(strip.highpass);
        disconnect(source);
        stop(input);
        input = stream;
        source = next;
      },
      async close() {
        globalThis.removeEventListener?.("audio-settings-changed", sync);
        strip.close?.();
        disconnect(source);
        stop(input);
        stop(destination.stream);
        if (context.state !== "closed") await closeAudioContext(context);
      }
    };
  } catch (error) {
    stop(rawStream);
    closeAudioContextQuietly(context);
    throw error;
  }
}
