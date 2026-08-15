const connect = (from, to) => {
  from.connect(to);
  return to;
};

/** Always-on microphone cleanup. Creative effects are intentionally not part of this graph. */
export function createStudioMicrophoneGraph(rawStream) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass?.prototype || !rawStream) {
    return { stream: rawStream, rawStream, close: async () => {} };
  }
  const context = new AudioContextClass({ latencyHint: "interactive", sampleRate: 48_000 });
  const source = context.createMediaStreamSource(rawStream);
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 70;
  highpass.Q.value = 0.7;

  const mud = context.createBiquadFilter();
  mud.type = "peaking";
  mud.frequency.value = 300;
  mud.Q.value = 0.85;
  mud.gain.value = -2.2;

  const presence = context.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3200;
  presence.Q.value = 0.8;
  presence.gain.value = 2.0;

  const air = context.createBiquadFilter();
  air.type = "highshelf";
  air.frequency.value = 8500;
  air.gain.value = 1.4;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 18;
  compressor.ratio.value = 2.6;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;

  const makeup = context.createGain();
  makeup.gain.value = 1.08;

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;

  const destination = context.createMediaStreamDestination();
  connect(connect(connect(connect(connect(connect(source, highpass), mud), presence), air), compressor), makeup);
  makeup.connect(limiter);
  limiter.connect(destination);
  destination.stream.getAudioTracks?.().forEach((track) => { track.contentHint = "music"; });
  context.resume?.().catch(() => {});
  return {
    stream: destination.stream,
    rawStream,
    context,
    close: async () => {
      try { source.disconnect(); } catch {}
      rawStream.getTracks?.().forEach((track) => track.stop());
      destination.stream.getTracks?.().forEach((track) => track.stop());
      if (context.state !== "closed") await context.close().catch(() => {});
    }
  };
}
