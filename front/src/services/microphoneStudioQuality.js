import { closeAudioContext, closeAudioContextQuietly } from "../utils/audio-context";
import { connectMicrophoneChannelStrip } from "./microphoneChannelStrip";

const stopStream = (stream) => stream?.getTracks?.().forEach((track) => track.stop());

/** Always-on microphone cleanup. Creative effects are intentionally not part of this graph. */
export function createStudioMicrophoneGraph(rawStream) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass?.prototype || !rawStream) {
    return { stream: rawStream, rawStream, close: async () => stopStream(rawStream) };
  }

  let context;
  let source;
  try {
    context = new AudioContextClass({ latencyHint: "interactive", sampleRate: 48_000 });
    source = context.createMediaStreamSource(rawStream);
    const destination = context.createMediaStreamDestination();
    connectMicrophoneChannelStrip(context, source, destination);
    destination.stream.getAudioTracks?.().forEach((track) => {
      track.contentHint = "music";
    });
    context.resume?.().catch(() => {});

    return {
      stream: destination.stream,
      rawStream,
      context,
      close: async () => {
        try {
          source.disconnect();
        } catch {
          /* already disconnected */
        }
        stopStream(rawStream);
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
