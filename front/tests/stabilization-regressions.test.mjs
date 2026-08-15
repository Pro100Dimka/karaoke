import fs from "node:fs";
import { expect, test } from "vitest";

const read = (path) => fs.readFileSync(path, "utf8");

test("backend child exit 23 cannot create an Electron restart storm", () => {
  const main = read("electron/main.cjs");
  expect(main).toContain("if (code === 23)");
  expect(main).toContain("backendStopRequested = true");
  expect(main).toContain('spawn("taskkill", ["/PID", String(pid), "/T", "/F"]');
});

test("room output mute never toggles the outgoing WebRTC microphone", () => {
  const context = read("src/contexts/OnlineRoomContext.jsx");
  const start = context.indexOf("const setRoomSoundMuted = useCallback");
  const end = context.indexOf("const resetRoomState", start);
  const body = context.slice(start, end);
  expect(body).not.toContain("setMicrophoneMuted(");
  expect(body).toContain("applyRemoteAudioMute()");
});

test("room self-monitor reuses the existing WebRTC stream", () => {
  const audio = read("src/contexts/hooks/useOnlineRoomAudio.js");
  expect(audio).toContain("const stream = await voice.start()");
  expect(audio).toContain("context.createMediaStreamSource(stream)");
  const karaoke = read("src/pages/Karaoke/index.jsx");
  expect(karaoke).toContain("onlineRoom.setLocalMonitoring(enabled)");
});

test("waveform progress uses a single moving clip instead of per-bar progress branches", () => {
  const source = read("src/pages/Karaoke/components/waveform-timeline.jsx");
  expect(source).toContain("clipPath");
  expect(source).not.toContain("index / BAR_COUNT <= progress");
});
