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
    effectsStream: stream,
    rawStream: stream,
    getStream: () => stream,
    getEffectsStream: () => stream,
    setEffects: () => false,
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
    context = new AudioContext({ latencyHint: 0 });
    source = context.createMediaStreamSource(input);
    const destination = context.createMediaStreamDestination();
    const effectsDestination = context.createMediaStreamDestination();
    const processedBus = context.createGain();
    const finalOutput = context.createGain();
    const effectsMix = context.createGain();
    const strip = connectMicrophoneChannelStrip(context, source, processedBus, {
      noiseSuppression: options.noiseSuppression ?? noiseSuppression,
      realtime: true
    });
    const clamp = (value, maximum = 1) => Math.max(0, Math.min(maximum, Number(value) || 0));
    processedBus.connect(finalOutput);
    finalOutput.gain.value = clamp(options.volume ?? 1, 2);
    finalOutput.connect(destination);
    // Keep an immediate dry path in the effects stream. Reverb/echo are mixed
    // alongside it, never inserted before it, so enabling studio effects does
    // not move the singer's consonants later in time.
    finalOutput.connect(effectsMix);
    effectsMix.connect(effectsDestination);
    let pitchNode = null;
    let pitchModulePromise = null;
    let pitchVersion = 0;
    const setPitchShift = async (value) => {
      const octave = Math.max(-1, Math.min(1, Number(value) || 0));
      const version = ++pitchVersion;
      if (Math.abs(octave) < 0.001) {
        disconnect(processedBus);
        disconnect(pitchNode);
        pitchNode = null;
        processedBus.connect(finalOutput);
        return 0;
      }
      if (pitchNode) {
        const parameter = pitchNode.parameters?.get?.("ratio");
        const ratio = 2 ** octave;
        if (typeof parameter?.setTargetAtTime === "function")
          parameter.setTargetAtTime(ratio, context.currentTime, 0.012);
        else if (typeof parameter?.setValueAtTime === "function")
          parameter.setValueAtTime(ratio, context.currentTime);
        else if (parameter) parameter.value = ratio;
        return octave;
      }
      if (!context.audioWorklet || typeof globalThis.AudioWorkletNode !== "function") return 0;
      pitchModulePromise ??= context.audioWorklet.addModule(
        new URL("./pitchShiftProcessor.js", import.meta.url)
      );
      await pitchModulePromise;
      if (version !== pitchVersion || context.state === "closed") return octave;
      const nextNode = new globalThis.AudioWorkletNode(context, "advoice-pitch-shift", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1]
      });
      const ratio = 2 ** octave;
      const parameter = nextNode.parameters?.get?.("ratio");
      if (typeof parameter?.setValueAtTime === "function")
        parameter.setValueAtTime(ratio, context.currentTime);
      else if (parameter) parameter.value = ratio;
      disconnect(processedBus);
      disconnect(pitchNode);
      pitchNode = nextNode;
      processedBus.connect(pitchNode);
      pitchNode.connect(finalOutput);
      return octave;
    };
    setPitchShift(options.octave).catch(() => {});
    let effectConnections = [];
    let effectNodes = [];
    const clearEffects = () => {
      effectConnections.forEach(([from, to]) => {
        try {
          from.disconnect(to);
        } catch {
          // A previous effect graph can already be detached.
        }
      });
      effectConnections = [];
      effectNodes.forEach(disconnect);
      effectNodes = [];
    };
    const connectEffect = (from, to) => {
      from.connect(to);
      effectConnections.push([from, to]);
    };
    const setEffects = (effects = {}) => {
      clearEffects();
      finalOutput.gain.value = clamp(effects.volume ?? finalOutput.gain.value ?? 1, 2);
      const echo = clamp(effects.echo);
      const delayAmount = clamp(effects.delay);
      if (echo || delayAmount) {
        const delay = context.createDelay(1);
        const feedback = context.createGain();
        const wet = context.createGain();
        delay.delayTime.value = 0.06 + delayAmount * 0.34;
        feedback.gain.value = Math.min(0.72, echo * 0.55 + delayAmount * 0.3);
        wet.gain.value = Math.min(0.65, echo * 0.46 + delayAmount * 0.24);
        connectEffect(finalOutput, delay);
        connectEffect(delay, feedback);
        connectEffect(feedback, delay);
        connectEffect(delay, wet);
        connectEffect(wet, effectsMix);
        effectNodes.push(delay, feedback, wet);
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
        connectEffect(finalOutput, convolver);
        connectEffect(convolver, wet);
        connectEffect(wet, effectsMix);
        effectNodes.push(convolver, wet);
      }
      return true;
    };
    setEffects(options);
    let monitor = null;
    const stopMonitoring = () => {
      if (!monitor) return false;
      try {
        effectsMix.disconnect(monitor.gain);
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
      const gain = context.createGain();
      const nodes = [gain];
      gain.gain.value = 1;
      setEffects(effects);
      effectsMix.connect(gain);
      gain.connect(context.destination);
      monitor = { gain, nodes };
      return true;
    };
    const sync = ({ detail }) => {
      if (detail?.noise_suppression != null) strip.setNoiseSuppression(detail.noise_suppression);
      if (detail?.octave != null) setPitchShift(detail.octave).catch(() => {});
      if (["volume", "reverb", "echo", "delay"].some((name) => detail?.[name] != null))
        setEffects(detail);
    };
    globalThis.addEventListener?.("audio-settings-changed", sync);
    destination.stream.getAudioTracks?.().forEach((track) => {
      track.contentHint = "music";
    });
    effectsDestination.stream.getAudioTracks?.().forEach((track) => {
      track.contentHint = "music";
    });
    context.resume?.().catch(() => {});
    return {
      stream: destination.stream,
      effectsStream: effectsDestination.stream,
      rawStream,
      context,
      setNoiseSuppression: strip.setNoiseSuppression,
      setPitchShift,
      setEffects,
      setMonitoring,
      getStream: ({ disabledEffects = false, effectsEnabled = false } = {}) =>
        disabledEffects ? input : effectsEnabled ? effectsDestination.stream : destination.stream,
      getEffectsStream: () => effectsDestination.stream,
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
        clearEffects();
        strip.close?.();
        pitchVersion += 1;
        disconnect(pitchNode);
        disconnect(processedBus);
        disconnect(finalOutput);
        disconnect(effectsMix);
        disconnect(source);
        stop(input);
        stop(destination.stream);
        stop(effectsDestination.stream);
        if (context.state !== "closed") await closeAudioContext(context);
      }
    };
  } catch (error) {
    stop(rawStream);
    closeAudioContextQuietly(context);
    throw error;
  }
}
