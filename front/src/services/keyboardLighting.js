const sources = new Map();
export function registerLightingSource(name, read) {
  sources.set(name, read);
  return () => {
    if (sources.get(name) === read) sources.delete(name);
  };
}
export function readLightingMusic() {
  for (const name of ["karaoke", "radio"]) {
    try {
      const sample = sources.get(name)?.();
      if (sample?.active) return sample;
    } catch {
      /* Visuals must not interrupt playback. */
    }
  }
  return { active: false, level: 0 };
}
export function lightingColor(hex, brightness, level, mode) {
  const base = /^#[a-f\d]{6}$/i.test(hex) ? hex : "#ffffff";
  const clamp = (value) => Math.min(1, Math.max(0, Number(value) || 0));
  const gain = clamp(brightness) * (mode === "theme" ? 1 : clamp(level));
  return [1, 3, 5].map((offset) => Math.round(parseInt(base.slice(offset, offset + 2), 16) * gain));
}

export function musicLightingColor(brightness, level, phase) {
  const clamp = (value) => Math.min(1, Math.max(0, Number(value) || 0));
  const hue = (((Number(phase) || 0) % 1) + 1) % 1;
  const sector = hue * 6;
  const chroma = 1;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const colors = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary]
  ];
  const gain = clamp(brightness) * (0.16 + clamp(level) * 0.84);
  return colors[Math.floor(sector) % colors.length].map((channel) =>
    Math.round(channel * gain * 255)
  );
}

// Read a copy of already playing media. Never re-route the original element,
// open the microphone, or connect audible analysis output.
export function observeLightingMedia(media, register = registerLightingSource) {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!media?.captureStream || !AudioContext) return () => {};
  let context,
    stream,
    source,
    analyser,
    samples,
    silent,
    disposed = false;
  const unregister = register("karaoke", () => {
    if (!analyser || media.paused || media.ended || context?.state !== "running")
      return { active: false, level: 0 };
    analyser.getByteFrequencyData(samples);
    let sum = 0;
    const end = Math.min(
      samples.length,
      Math.max(2, Math.ceil((250 * analyser.fftSize) / context.sampleRate))
    );
    for (let i = 1; i < end; i++) sum += samples[i] / 255;
    return { active: true, level: Math.min(1, (sum / (end - 1)) ** 1.8) };
  });
  const attach = () => {
    if (disposed || source || !stream?.getAudioTracks().length) return;
    try {
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      samples = new Uint8Array(analyser.frequencyBinCount);
      silent = context.createGain();
      silent.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silent);
      silent.connect(context.destination);
      context.resume().catch(() => {});
    } catch {
      cleanupAudio();
    }
  };
  const cleanupAudio = () => {
    source?.disconnect();
    analyser?.disconnect();
    silent?.disconnect();
    context?.close().catch(() => {});
    source = null;
    analyser = null;
    context = null;
  };
  const start = () => {
    if (disposed) return;
    try {
      if (!stream) {
        stream = media.captureStream();
        stream.addEventListener("addtrack", attach);
      }
      attach();
      context?.resume().catch(() => {});
    } catch {
      /* Unsupported/cross-origin capture: leave audio unchanged. */
    }
  };
  media.addEventListener("playing", start);
  if (!media.paused) start();
  return () => {
    disposed = true;
    unregister();
    media.removeEventListener("playing", start);
    stream?.removeEventListener("addtrack", attach);
    stream?.getTracks().forEach((track) => track.stop());
    cleanupAudio();
  };
}
