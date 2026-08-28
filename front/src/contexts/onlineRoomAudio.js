import roomJoinLeaveSound from "../assets/sounds/room-join-leave.mp3";

const setAudioParam = (parameter, value, time) => {
  if (typeof parameter?.setValueAtTime === "function") parameter.setValueAtTime(value, time);
  else if (parameter) parameter.value = value;
};

const bendAudioParam = (parameter, value, time) => {
  if (typeof parameter?.exponentialRampToValueAtTime === "function")
    parameter.exponentialRampToValueAtTime(value, time);
  else if (parameter) parameter.value = value;
};

function playSynthesizedRoomSound(direction) {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContext || typeof AudioContext.prototype?.createOscillator !== "function") return false;
  let context;
  try {
    context = new AudioContext({ latencyHint: "interactive" });
    const gain = context.createGain();
    const { currentTime } = context;
    gain.gain.setValueAtTime(0.0001, currentTime);
    gain.gain.exponentialRampToValueAtTime(0.038, currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.014, currentTime + 0.19);
    gain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.42);

    const filter = context.createBiquadFilter?.();
    if (filter) {
      filter.type = "lowpass";
      setAudioParam(filter.frequency, 3200, currentTime);
      setAudioParam(filter.Q, 1.3, currentTime);
      gain.connect(filter);
      filter.connect(context.destination);
    } else gain.connect(context.destination);

    const notes =
      direction === "leave"
        ? [
            [783.99, 659.25, 0],
            [587.33, 440, 0.11]
          ]
        : [
            [493.88, 659.25, 0],
            [659.25, 987.77, 0.11]
          ];
    const wave = context.createPeriodicWave?.(
      new Float32Array(7),
      new Float32Array([0, 1, 0.52, 0.31, 0.17, 0.09, 0.04])
    );
    const tones = notes.map(([startFrequency, endFrequency, offset], index) => {
      const tone = context.createOscillator();
      if (wave && typeof tone.setPeriodicWave === "function") tone.setPeriodicWave(wave);
      else tone.type = index ? "triangle" : "sawtooth";
      setAudioParam(tone.frequency, startFrequency, currentTime + offset);
      bendAudioParam(tone.frequency, endFrequency, currentTime + offset + 0.19);
      setAudioParam(tone.detune, index ? -4 : 3, currentTime + offset);
      tone.connect(gain);
      tone.start(currentTime + offset);
      tone.stop(currentTime + 0.4);
      return tone;
    });
    const lastTone = tones.at(-1);
    lastTone.onended = () => {
      lastTone.onended = null;
      Promise.resolve(context.close?.()).catch(() => undefined);
    };
    context.resume?.()?.catch?.(() => undefined);
    return true;
  } catch {
    // Optional feedback must never break room state.
    Promise.resolve(context?.close?.()).catch(() => undefined);
    return false;
  }
}

function playRoomSound(direction) {
  if (typeof globalThis.Audio !== "function") return playSynthesizedRoomSound(direction);
  try {
    const audio = new globalThis.Audio(roomJoinLeaveSound);
    audio.preload = "auto";
    audio.volume = 0.18;
    audio.playbackRate = 1;
    const release = () => {
      audio.onended = null;
      audio.onerror = null;
      audio.src = "";
    };
    audio.onended = release;
    audio.onerror = release;
    Promise.resolve(audio.play()).catch(() => {
      release();
      playSynthesizedRoomSound(direction);
    });
    return true;
  } catch {
    return playSynthesizedRoomSound(direction);
  }
}

export const playParticipantJoinedSound = () => playRoomSound("join");
export const playParticipantLeftSound = () => playRoomSound("leave");
