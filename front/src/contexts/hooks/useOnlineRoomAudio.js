import { useCallback, useRef } from "react";
import { clamp01 as clampUnit } from "../../utils/math";

const clamp01 = (value) => clampUnit(Number(value) || 0);
const closeContext = (context) => {
  try {
    const result = context?.close?.();
    result?.catch?.(() => {});
  } catch {
    // Closing an already-closed Web Audio context is harmless.
  }
};

export default function useOnlineRoomAudio({
  mutedPeopleRef,
  roomSoundMutedRef,
  roomUiRef,
  participantVolumesRef,
  startSpeakingMeter,
  stopSpeakingMeter,
  voiceRef
}) {
  const remoteAudioRef = useRef(new Map());
  const remoteEffectsRef = useRef(new Map());
  const remoteEffectVersionsRef = useRef(new Map());
  const localMonitorRef = useRef(null);

  const applyRemoteAudioMute = useCallback(() => {
    for (const [participantId, audio] of remoteAudioRef.current) {
      const muted = roomSoundMutedRef.current || mutedPeopleRef.current.has(participantId);
      const effectGraph = remoteEffectsRef.current.get(participantId);
      const volume = Math.max(
        0,
        Math.min(1, Number(participantVolumesRef.current?.[participantId] ?? 1))
      );
      const ownerVolume = Math.max(
        0,
        Math.min(2, Number(roomUiRef.current.effectsByParticipant?.[participantId]?.volume ?? 1))
      );
      audio.muted = muted || Boolean(effectGraph);
      audio.volume = effectGraph ? 1 : Math.min(1, volume);
      if (effectGraph) effectGraph.master.gain.value = muted ? 0 : volume * ownerVolume;
    }
  }, [mutedPeopleRef, participantVolumesRef, roomSoundMutedRef, roomUiRef]);

  const setParticipantVolume = useCallback(
    (participantId, value) => {
      participantVolumesRef.current = {
        ...(participantVolumesRef.current || {}),
        [participantId]: clamp01(value)
      };
      applyRemoteAudioMute();
    },
    [applyRemoteAudioMute, participantVolumesRef]
  );

  const removeRemoteAudio = useCallback(
    (participantId) => {
      // Deleting (rather than just bumping) still invalidates any in-flight
      // applyParticipantEffects activation for this participant -- it reads
      // undefined back, which never equals a real (>=1) effectVersion, so a
      // stale activation still correctly closes its context instead of
      // attaching. Participant ids are fresh crypto.randomUUID()s per
      // connection (see cloudflare/src/worker.js), never reused, so a
      // future join can't collide with a version number left behind here.
      // OnlineRoomProvider mounts once for the whole app session, so
      // without this the map only ever grew, one entry per participant who
      // ever passed through any room, for the process's entire lifetime.
      remoteEffectVersionsRef.current.delete(participantId);
      stopSpeakingMeter(participantId);
      const effectGraph = remoteEffectsRef.current.get(participantId);
      remoteEffectsRef.current.delete(participantId);
      closeContext(effectGraph?.context);
      const audio = remoteAudioRef.current.get(participantId);
      if (!audio) return;
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      remoteAudioRef.current.delete(participantId);
    },
    [stopSpeakingMeter]
  );

  const removeAllRemoteAudio = useCallback(() => {
    [...remoteAudioRef.current.keys()].forEach(removeRemoteAudio);
  }, [removeRemoteAudio]);

  const getRemoteVoiceStreams = useCallback(
    () =>
      [...remoteAudioRef.current.values()]
        .map((audio) => audio.srcObject)
        .filter((stream) =>
          stream?.getAudioTracks?.().some((track) => track.readyState === "live")
        ),
    []
  );

  const attachRemoteStream = useCallback(
    (participantId, stream, onPlayBlocked) => {
      removeRemoteAudio(participantId);
      const audio = document.createElement("audio");
      audio.dataset.onlineRoomParticipant = participantId;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.srcObject = stream;
      audio.style.display = "none";
      document.body.append(audio);
      remoteAudioRef.current.set(participantId, audio);
      startSpeakingMeter(participantId, stream);
      applyRemoteAudioMute();
      audio.play().catch(() => onPlayBlocked?.());
      return audio;
    },
    [applyRemoteAudioMute, removeRemoteAudio, startSpeakingMeter]
  );

  const applyParticipantEffects = useCallback(
    (participantId, enabled) => {
      const effectVersion = (remoteEffectVersionsRef.current.get(participantId) || 0) + 1;
      remoteEffectVersionsRef.current.set(participantId, effectVersion);
      const previous = remoteEffectsRef.current.get(participantId);
      remoteEffectsRef.current.delete(participantId);
      closeContext(previous?.context);
      const audio = remoteAudioRef.current.get(participantId);
      const stream = audio?.srcObject;
      if (!enabled || !stream) {
        applyRemoteAudioMute();
        return;
      }
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) {
        applyRemoteAudioMute();
        return;
      }
      const effects = roomUiRef.current.effectsByParticipant?.[participantId] || {};
      const context = new AudioContextClass({ latencyHint: 0.005 });
      const source = context.createMediaStreamSource(stream);
      const master = context.createGain();
      master.gain.value = 1;
      source.connect(master);

      const echo = clamp01(effects.echo);
      const delayAmount = clamp01(effects.delay);
      if (echo || delayAmount) {
        const delay = context.createDelay(1);
        const feedback = context.createGain();
        const wet = context.createGain();
        delay.delayTime.value = 0.06 + delayAmount * 0.34;
        feedback.gain.value = Math.min(0.72, echo * 0.55 + delayAmount * 0.3);
        wet.gain.value = Math.min(0.65, echo * 0.46 + delayAmount * 0.24);
        source.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(master);
      }

      const reverb = clamp01(effects.reverb);
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
        source.connect(convolver);
        convolver.connect(wet);
        wet.connect(master);
      }
      master.connect(context.destination);
      const activate = () => {
        if (
          remoteEffectVersionsRef.current.get(participantId) !== effectVersion ||
          remoteAudioRef.current.get(participantId)?.srcObject !== stream
        ) {
          closeContext(context);
          return;
        }
        remoteEffectsRef.current.set(participantId, { context, master });
        applyRemoteAudioMute();
      };
      if (typeof context.resume === "function") {
        Promise.resolve(context.resume())
          .then(activate)
          .catch(() => {
            closeContext(context);
            applyRemoteAudioMute();
          });
      } else activate();
    },
    [applyRemoteAudioMute, roomUiRef]
  );

  const stopLocalMonitoring = useCallback(() => {
    const monitor = localMonitorRef.current;
    localMonitorRef.current = null;
    if (!monitor) return;
    try {
      monitor.source.disconnect();
      monitor.gain.disconnect();
    } catch {
      // Already disconnected.
    }
    closeContext(monitor.context);
  }, []);

  const setLocalMonitoring = useCallback(
    async (enabled, effects = {}) => {
      if (!enabled) {
        stopLocalMonitoring();
        return false;
      }
      if (localMonitorRef.current) return true;
      const voice = voiceRef.current;
      if (!voice) return false;
      const stream = await voice.start();
      if (voiceRef.current !== voice) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) return false;
      let context;
      try {
        context = new AudioContextClass({ latencyHint: 0.005 });
        const source = context.createMediaStreamSource(stream);
        const gain = context.createGain();
        gain.gain.value = Math.max(0, Math.min(2, Number(effects.volume ?? 1)));
        // voice.start() returns the already processed stream from the central
        // microphone service. Applying the channel strip again would gate and
        // compress the singer twice.
        source.connect(gain);

        const echo = clamp01(effects.echo);
        const delayAmount = clamp01(effects.delay);
        if (echo || delayAmount) {
          const delay = context.createDelay(1);
          const feedback = context.createGain();
          const wet = context.createGain();
          delay.delayTime.value = 0.06 + delayAmount * 0.34;
          feedback.gain.value = Math.min(0.72, echo * 0.55 + delayAmount * 0.3);
          wet.gain.value = Math.min(0.65, echo * 0.46 + delayAmount * 0.24);
          source.connect(delay);
          delay.connect(feedback);
          feedback.connect(delay);
          delay.connect(wet);
          wet.connect(gain);
        }

        const reverb = clamp01(effects.reverb);
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
          source.connect(convolver);
          convolver.connect(wet);
          wet.connect(gain);
        }
        gain.connect(context.destination);
        await context.resume?.();
        if (voiceRef.current !== voice) {
          closeContext(context);
          return false;
        }
        localMonitorRef.current = { context, source, gain };
        return true;
      } catch {
        closeContext(context);
        return false;
      }
    },
    [stopLocalMonitoring, voiceRef]
  );

  return {
    applyParticipantEffects,
    applyRemoteAudioMute,
    attachRemoteStream,
    getRemoteVoiceStreams,
    removeAllRemoteAudio,
    removeRemoteAudio,
    setParticipantVolume,
    setLocalMonitoring,
    stopLocalMonitoring
  };
}
