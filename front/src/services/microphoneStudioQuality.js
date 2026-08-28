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
    setMonitoring: () => false,
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
    // A numeric hint asks Chromium for the smallest practical realtime
    // quantum instead of its broader generic "interactive" profile. The
    // browser may clamp this for a particular Windows device, so this remains
    // a safe preference rather than a hard hardware requirement.
    context = new AudioContext({ latencyHint: 0.005 });
    source = context.createMediaStreamSource(input);
    const destination = context.createMediaStreamDestination();
    const strip = connectMicrophoneChannelStrip(context, source, destination, {
      noiseSuppression: options.noiseSuppression ?? noiseSuppression
    });
    let monitor = null;
    const stopMonitoring = () => {
      if (!monitor) return false;
      try {
        strip.limiter.disconnect(monitor.gain);
      } catch {
        // The monitor can already be detached while the context is closing.
      }
      monitor.nodes.forEach(disconnect);
      monitor = null;
      return false;
    };
    const setMonitoring = (enabled, effects = {}) => {
      stopMonitoring();
      if (!enabled) return false;
      const clamp = (value, maximum = 1) => Math.max(0, Math.min(maximum, Number(value) || 0));
      const gain = context.createGain();
      const nodes = [gain];
      gain.gain.value = clamp(effects.volume ?? 1, 2);
      strip.limiter.connect(gain);

      const echo = clamp(effects.echo);
      const delayAmount = clamp(effects.delay);
      if (echo || delayAmount) {
        const delay = context.createDelay(1);
        const feedback = context.createGain();
        const wet = context.createGain();
        delay.delayTime.value = 0.06 + delayAmount * 0.34;
        feedback.gain.value = Math.min(0.72, echo * 0.55 + delayAmount * 0.3);
        wet.gain.value = Math.min(0.65, echo * 0.46 + delayAmount * 0.24);
        strip.limiter.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(gain);
        nodes.push(delay, feedback, wet);
      }

      const reverb = clamp(effects.reverb);
      if (reverb) {
        const convolver = context.createConvolver();
        const wet = context.createGain();
        const frames = Math.floor(context.sampleRate * (0.35 + reverb * 1.15));
        const impulse = context.createBuffer(2, frames, context.sampleRate);
        for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
          const data = impulse.getChannelData(channel);
          for (let index = 0; index < frames; index += 1)
            data[index] = (Math.random() * 2 - 1) * (1 - index / frames) ** (1.5 + reverb * 2);
        }
        convolver.buffer = impulse;
        wet.gain.value = Math.min(0.58, reverb * 0.48);
        strip.limiter.connect(convolver);
        convolver.connect(wet);
        wet.connect(gain);
        nodes.push(convolver, wet);
      }
      gain.connect(context.destination);
      monitor = { gain, nodes };
      return true;
    };
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
      setMonitoring,
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
        stopMonitoring();
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
