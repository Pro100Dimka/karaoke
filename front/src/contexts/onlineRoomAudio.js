export function playParticipantJoinedSound() {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass({ latencyHint: "interactive" });
    const play = () => {
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.09, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.24);
      gain.connect(context.destination);
      const oscillators = [660, 880].map((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(context.currentTime + index * 0.05);
        oscillator.stop(context.currentTime + 0.22);
        return oscillator;
      });
      const finalOscillator = oscillators.at(-1);
      if (finalOscillator)
        finalOscillator.onended = () => {
          finalOscillator.onended = null;
          Promise.resolve(context.close()).catch(() => {});
        };
    };
    Promise.resolve(context.resume?.())
      .then(play)
      .catch(() => context.close?.());
  } catch {
    // A notification sound is optional and must never affect room state.
  }
}
