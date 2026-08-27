import fs from "node:fs";
import { expect, test } from "vitest";
import { verify } from "./helpers/assertions.mjs";
const read = (path) => fs.readFileSync(path, "utf8");
test("backend child exit 23 cannot create an Electron restart storm", () => {
  const main = read("electron/main.cjs");
  verify(
    [main, "toContain", "if (code === 23)"],
    [main, "toContain", "watchDuplicateBackend()"],
    [main, "toContain", "backendDuplicateDetected = false"],
    [main, "toContain", "backendDuplicateWatchGeneration"],
    [main, "toContain", "if (!active()) return"],
    [main, "toMatch", /function startBackend\(\)[\s\S]{0,260}isQuitting[\s\S]*backendStopRequested/],
    [main, "not.toMatch", /if \(code === 23\)[\s\S]{0,300}backendStopRequested = true/],
    [main, "toContain", 'spawn("taskkill", ["/PID", String(pid), "/T", "/F"]']
  );
});
test("room output mute never toggles the outgoing WebRTC microphone", () => {
  const context = read("src/contexts/OnlineRoomContext.jsx");
  const start = context.indexOf("const setRoomSoundMuted = useCallback");
  const end = context.indexOf("const resetRoomState", start);
  const body = context.slice(start, end);
  verify([body, "not.toContain", "setMicrophoneMuted("], [body, "toContain", "applyRemoteAudioMute()"]);
});
test("room self-monitor keeps WebRTC transport but uses the configured native output", () => {
  const audio = read("src/contexts/hooks/useOnlineRoomAudio.js");
  verify([audio, "toContain", "const stream = await voice.start()"], [audio, "toContain", "context.createMediaStreamSource(stream)"]);
  const karaoke = read("src/pages/Karaoke/index.jsx");
  verify(
    [karaoke, "toContain", "onlineRoom.setLocalMonitoring(false)"],
    [karaoke, "toContain", "api.startDirectMonitoring"],
    [karaoke, "toContain", "api.stopDirectMonitoring"]
  );
});
test("karaoke waveform loads the real instrumental through WaveSurfer", () => {
  const timeline = read("src/pages/Karaoke/components/waveform-timeline.jsx");
  const waveform = read("src/theme/ui/Waveform/index.jsx");
  verify(
    [timeline, "toContain", 'api.getAudioTrackUrl(songId, "instrumental")'],
    [waveform, "toContain", 'import("wavesurfer.js")'],
    [waveform, "toContain", "fetchParams"],
    [waveform, "not.toContain", "barWidth:"],
    [waveform, "not.toContain", "index / BAR_COUNT <= progress"]
  );
});
test("recording and processing waveforms use their real audio files", () => {
  const player = read("src/components/AudioPlayer.jsx");
  const processing = read("src/pages/Library/modals.jsx");
  verify(
    [player, "toContain", "url={src}"],
    [processing, "toContain", 'api.getAudioTrackUrl(song.id, "song")'],
    [processing, "toContain", "fetchParams={waveformFetchParams}"]
  );
});
