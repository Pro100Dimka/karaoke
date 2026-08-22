export function playParticipantJoinedSound() {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContext) return;
  try {
    const context = new AudioContext({ latencyHint: "interactive" });
    const gain = context.createGain();
    const { currentTime } = context;
    gain.gain.setValueAtTime(0.0001, currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.24);
    gain.connect(context.destination);
    const tones = [660, 880].map((frequency, index) => {
      const tone = context.createOscillator();
      tone.frequency.value = frequency;
      tone.connect(gain);
      tone.start(currentTime + index * 0.05);
      tone.stop(currentTime + 0.22);
      return tone;
    });
    const lastTone = tones.at(-1);
    lastTone.onended = () => {
      lastTone.onended = null;
      Promise.resolve(context.close?.()).catch(() => undefined);
    };
    context.resume?.()?.catch?.(() => undefined);
  } catch {
    // Optional feedback must never break room state.
  }
}
