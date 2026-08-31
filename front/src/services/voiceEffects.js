const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));

// Adds wet branches to an existing graph; the caller retains the dry path,
// output gain and AudioContext lifecycle. No extra processing on dry audio.
export function connectVoiceEffects(context, source, destination, effects = {}) {
  const connections = [],
    nodes = [];
  const connect = (from, to) => {
    from.connect(to);
    connections.push([from, to]);
  };
  const close = () => {
    for (const [from, to] of connections.splice(0)) {
      try {
        from.disconnect(to);
      } catch {
        /* Already detached. */
      }
    }
    for (const node of nodes.splice(0)) {
      try {
        node.disconnect();
      } catch {
        /* Already detached. */
      }
    }
  };
  try {
    const echo = clamp(effects.echo),
      delayAmount = clamp(effects.delay);
    if (echo || delayAmount) {
      const delay = context.createDelay(1);
      const feedback = context.createGain();
      const wet = context.createGain();
      nodes.push(delay, feedback, wet);
      delay.delayTime.value = 0.06 + delayAmount * 0.34;
      feedback.gain.value = Math.min(0.72, echo * 0.55 + delayAmount * 0.3);
      wet.gain.value = Math.min(0.65, echo * 0.46 + delayAmount * 0.24);
      connect(source, delay);
      connect(delay, feedback);
      connect(feedback, delay);
      connect(delay, wet);
      connect(wet, destination);
    }
    const reverb = clamp(effects.reverb);
    if (reverb) {
      const convolver = context.createConvolver();
      const wet = context.createGain();
      nodes.push(convolver, wet);
      const frames = Math.floor(context.sampleRate * (0.35 + reverb * 1.15));
      const impulse = context.createBuffer(2, frames, context.sampleRate);
      for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
        const data = impulse.getChannelData(channel);
        for (let index = 0; index < frames; index += 1)
          data[index] = (Math.random() * 2 - 1) * (1 - index / frames) ** (1.5 + reverb * 2);
      }
      convolver.buffer = impulse;
      wet.gain.value = Math.min(0.58, reverb * 0.48);
      connect(source, convolver);
      connect(convolver, wet);
      connect(wet, destination);
    }
    return { close };
  } catch (error) {
    close();
    throw error;
  }
}
