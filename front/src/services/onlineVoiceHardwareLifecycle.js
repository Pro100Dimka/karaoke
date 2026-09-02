import { closeAudioContext } from "../utils/audio-context";

export async function suspendVoiceMicrophone(voice) {
  voice.lifecycleVersion += 1;
  voice.startPromise = null;
  const detach = [];
  for (const peer of voice.peers.values()) {
    for (const sender of peer.getSenders?.() || []) {
      if (sender.track?.kind === "audio" && typeof sender.replaceTrack === "function")
        detach.push(sender.replaceTrack(null));
    }
  }
  await Promise.allSettled(detach);
  if (voice.microphoneGraph) {
    await closeAudioContext(voice.microphoneGraph);
    voice.microphoneGraph = null;
  } else {
    new Set([
      ...(voice.stream?.getTracks?.() || []),
      ...(voice.effectsStream?.getTracks?.() || [])
    ]).forEach((track) => track.stop());
  }
  voice.stream = null;
  voice.effectsStream = null;
}
