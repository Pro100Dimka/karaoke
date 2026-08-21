import { closeAudioContext, closeAudioContextQuietly } from "../utils/audio-context";
import { connectMicrophoneChannelStrip } from "./microphoneChannelStrip";

const stopStream = (stream) => stream?.getTracks?.().forEach((track) => track.stop());
let currentNoiseSuppression = 0.35;
globalThis.addEventListener?.("audio-settings-changed", (event) => {
  const value = Number(event.detail?.noise_suppression);
  if (Number.isFinite(value)) currentNoiseSuppression = Math.max(0, Math.min(1, value));
});

/** Always-on microphone cleanup. Creative effects are intentionally not part of this graph. */
export function createStudioMicrophoneGraph(rawStream, options = {}) {
  const noiseSuppression = options.noiseSuppression ?? currentNoiseSuppression;
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass?.prototype || !rawStream) {
    return {
      stream: rawStream,
      rawStream,
      getStream: () => rawStream,
      close: async () => stopStream(rawStream)
    };
  }

  let context;
  let source;
  let inputStream = rawStream;
  try {
    context = new AudioContextClass({ latencyHint: "interactive", sampleRate: 44_100 });
    source = context.createMediaStreamSource(rawStream);
    const destination = context.createMediaStreamDestination();
    const channelStrip = connectMicrophoneChannelStrip(context, source, destination, {
      noiseSuppression
    });
    const syncSettings = (event) => {
      if (event.detail?.noise_suppression == null) return;
      channelStrip.setNoiseSuppression(event.detail.noise_suppression);
    };
    globalThis.addEventListener?.("audio-settings-changed", syncSettings);
    destination.stream.getAudioTracks?.().forEach((track) => {
      track.contentHint = "music";
    });
    context.resume?.().catch(() => {});

    return {
      stream: destination.stream,
      rawStream,
      getStream: ({ disabledEffects = false } = {}) =>
        disabledEffects ? inputStream : destination.stream,
      context,
      setNoiseSuppression: channelStrip.setNoiseSuppression,
      replaceInput: async (nextStream) => {
        const nextSource = context.createMediaStreamSource(nextStream);
        nextSource.connect(channelStrip.highpass);
        try {
          source.disconnect();
        } catch {
          /* already disconnected */
        }
        stopStream(inputStream);
        inputStream = nextStream;
        source = nextSource;
      },
      close: async () => {
        globalThis.removeEventListener?.("audio-settings-changed", syncSettings);
        try {
          source.disconnect();
        } catch {
          /* already disconnected */
        }
        stopStream(inputStream);
        stopStream(destination.stream);
        if (context.state !== "closed") await closeAudioContext(context);
      }
    };
  } catch (error) {
    stopStream(rawStream);
    closeAudioContextQuietly(context);
    throw error;
  }
}
