export async function createRoomVoiceCapture(streams, startPlaybackSec = 0) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  const MediaRecorderClass = globalThis.MediaRecorder;
  const live = (Array.isArray(streams) ? streams : []).filter((stream) =>
    stream?.getAudioTracks?.().some((track) => track.readyState === "live")
  );
  if (!live.length || !MediaRecorderClass) return null;
  let context = null;
  let destination = null;
  let sources = [];
  let captureStream = live[0];
  if (live.length > 1) {
    if (!AudioContextClass) return null;
    context = new AudioContextClass({ latencyHint: "interactive" });
    destination = context.createMediaStreamDestination();
    sources = live.map((stream) => {
      const source = context.createMediaStreamSource(stream);
      source.connect(destination);
      return source;
    });
    await context.resume?.();
    captureStream = destination.stream;
  }
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  const mimeType = candidates.find((type) => MediaRecorderClass.isTypeSupported?.(type));
  const recorder = new MediaRecorderClass(captureStream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.addEventListener("dataavailable", ({ data }) => {
    if (data?.size) chunks.push(data);
  });
  recorder.start(500);
  return {
    startPlaybackSec: Math.max(0, Number(startPlaybackSec) || 0),
    pause: () => recorder.state === "recording" && recorder.pause(),
    resume: () => recorder.state === "paused" && recorder.resume(),
    stop: () =>
      new Promise((resolve) => {
        const finish = async () => {
          sources.forEach((source) => source.disconnect?.());
          destination?.stream.getTracks?.().forEach((track) => track.stop());
          await Promise.resolve(context?.close?.()).catch(() => {});
          resolve(
            chunks.length
              ? new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" })
              : null
          );
        };
        if (recorder.state === "inactive") finish();
        else {
          recorder.addEventListener("stop", finish, { once: true });
          recorder.stop();
        }
      })
  };
}
