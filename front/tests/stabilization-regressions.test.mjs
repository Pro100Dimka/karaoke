import fs from "node:fs";
import { expect, test } from "vitest";
import { verify } from "./helpers/assertions.mjs";
const read = (path) => fs.readFileSync(path, "utf8");
test("backend child exit 23 cannot create an Electron restart storm", () => {
  const main = read("electron/main.cjs");
  verify([main, 'toContain', "if (code === 23)"], [main, 'toContain', "watchDuplicateBackend()"], [main, 'toContain', "backendDuplicateDetected = false"], [main, 'toContain', "backendDuplicateWatchGeneration"], [main, 'toContain', "if (!active()) return"], [main, 'toMatch', /function startBackend\(\)[\s\S]{0,260}isQuitting[\s\S]*backendStopRequested/], [main, 'not.toMatch', /if \(code === 23\)[\s\S]{0,300}backendStopRequested = true/], [main, 'toContain', 'spawn("taskkill", ["/PID", String(pid), "/T", "/F"]']);
});
test("room output mute never toggles the outgoing WebRTC microphone", () => {
  const context = read("src/contexts/OnlineRoomContext.jsx");
  const start = context.indexOf("const setRoomSoundMuted = useCallback");
  const end = context.indexOf("const resetRoomState", start);
  const body = context.slice(start, end);
  verify([body, 'not.toContain', "setMicrophoneMuted("], [body, 'toContain', "applyRemoteAudioMute()"]);
});
test("room self-monitor reuses the existing WebRTC stream", () => {
  const audio = read("src/contexts/hooks/useOnlineRoomAudio.js");
  verify([audio, 'toContain', "const stream = await voice.start()"], [audio, 'toContain', "context.createMediaStreamSource(stream)"]);
  const karaoke = read("src/pages/Karaoke/index.jsx");
  expect(karaoke).toContain("onlineRoom.setLocalMonitoring(enabled)");
});
test("waveform progress uses a single moving clip instead of per-bar progress branches", () => {
  const source = read("src/pages/Karaoke/components/waveform-timeline.jsx");
  verify([source, 'toContain', "clipPath"], [source, 'not.toContain', "index / BAR_COUNT <= progress"]);
});
