/* @vitest-environment jsdom */
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clients: [],
  voices: [],
  connect: vi.fn(),
  start: vi.fn(),
  importSongPackage: vi.fn(),
  openKaraokeInRoom: vi.fn(),
  messageHandler: vi.fn(),
  createOnlineRoomMessageHandler: vi.fn(),
  muteApplicationAudio: vi.fn(),
  restoreApplicationAudio: vi.fn(),
  startSpeakingMeter: vi.fn(),
  stopSpeakingMeter: vi.fn(),
  stopAllSpeakingMeters: vi.fn()
}));

vi.mock("../src/services/onlineRoom", () => {
  class OnlineRoomClient {
    constructor() {
      this.send = vi.fn();
      this.disconnect = vi.fn();
      this.connect = mocks.connect;
      this.onMessage = vi.fn(() => vi.fn());
      mocks.clients.push(this);
    }
  }
  class OnlineVoiceMesh {
    constructor(client) {
      this.client = client;
      this.start = mocks.start;
      this.stop = vi.fn();
      this.setMicrophoneMuted = vi.fn();
      mocks.voices.push(this);
    }
  }
  return {
    createRoomId: () => "created-room",
    OnlineRoomClient,
    OnlineVoiceMesh
  };
});
vi.mock("../src/api/client", () => ({
  api: { importSongPackage: mocks.importSongPackage }
}));
vi.mock("../src/contexts/hooks/useApplicationAudioMute", () => ({
  default: () => ({
    muteApplicationAudio: mocks.muteApplicationAudio,
    restoreApplicationAudio: mocks.restoreApplicationAudio
  })
}));
vi.mock("../src/contexts/hooks/useSpeakingLevels", () => ({
  default: () => ({
    localSpeakingLevel: 0.4,
    speakingLevels: { guest: 0.2 },
    startSpeakingMeter: mocks.startSpeakingMeter,
    stopSpeakingMeter: mocks.stopSpeakingMeter,
    stopAllSpeakingMeters: mocks.stopAllSpeakingMeters
  })
}));
vi.mock("../src/contexts/onlineRoomActions", () => ({
  openKaraokeInRoom: mocks.openKaraokeInRoom
}));
vi.mock("../src/contexts/onlineRoomMessages", () => ({
  createOnlineRoomMessageHandler: mocks.createOnlineRoomMessageHandler
}));

import {
  OnlineRoomProvider,
  useOnlineRoom
} from "../src/contexts/OnlineRoomContext.jsx";

const wrapper = ({ children }) => (
  <OnlineRoomProvider>{children}</OnlineRoomProvider>
);
const stream = () => ({
  getTracks: () => [{ stop: vi.fn() }]
});

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock?.mockReset?.());
  mocks.clients.length = 0;
  mocks.voices.length = 0;
  mocks.connect.mockResolvedValue("room-id");
  mocks.start.mockResolvedValue(stream());
  mocks.importSongPackage.mockResolvedValue({ id: "song" });
  mocks.openKaraokeInRoom.mockResolvedValue(true);
  mocks.createOnlineRoomMessageHandler.mockReturnValue(mocks.messageHandler);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
});

describe("online room provider", () => {
  test("returns no room outside the provider", () => {
    const { result } = renderHook(() => useOnlineRoom());
    expect(result.current).toBeNull();
  });

  test("creates a room, starts voice and exposes synchronization actions", async () => {
    const { result } = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => result.current.createRoom("Alice"));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    expect(mocks.connect).toHaveBeenCalledWith({
      id: "created-room",
      name: "Alice",
      host: true
    });
    expect(result.current.room).toMatchObject({
      id: "room-id",
      host: true,
      role: "host"
    });
    expect(result.current.participants[0].name).toBe("Alice");
    expect(mocks.startSpeakingMeter).toHaveBeenCalledWith(
      "local",
      expect.any(Object)
    );

    act(() => result.current.syncUi({ radio: true }));
    act(() => result.current.syncCommand({ type: "pause" }));
    expect(mocks.clients[0].send).toHaveBeenCalledWith("ui", {
      state: { radio: true }
    });
    expect(mocks.clients[0].send).toHaveBeenCalledWith("sync", {
      state: { type: "pause" }
    });

    await act(() => result.current.openKaraoke("song-1"));
    expect(mocks.openKaraokeInRoom).toHaveBeenCalledWith(
      expect.objectContaining({ songId: "song-1" })
    );
  });

  test("joins, mutes participants and fully leaves the room", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("shared", "Bob"));
    expect(hook.result.current.room.role).toBe("guest");

    act(() => hook.result.current.togglePersonMuted("guest"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.mutedPeople.has("guest")).toBe(true);
    act(() => hook.result.current.togglePersonMuted("guest"));
    expect(hook.result.current.mutedPeople.has("guest")).toBe(false);

    act(() => hook.result.current.setMicrophoneMuted(true));
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenLastCalledWith(true);
    expect(mocks.clients[0].send).toHaveBeenCalledWith("presence", {
      micMuted: true
    });
    act(() => hook.result.current.setMicrophoneMuted(false, false));

    act(() => hook.result.current.setRoomSoundMuted(true));
    expect(mocks.muteApplicationAudio).toHaveBeenCalledWith(document);
    expect(hook.result.current.roomSoundMuted).toBe(true);
    act(() => hook.result.current.setRoomSoundMuted(true));
    act(() => hook.result.current.setRoomSoundMuted(false));
    expect(mocks.restoreApplicationAudio).toHaveBeenCalled();

    await act(() => hook.result.current.leaveRoom());
    expect(hook.result.current.room).toBeNull();
    expect(hook.result.current.participants).toEqual([]);
    expect(mocks.voices[0].stop).toHaveBeenCalled();
    expect(mocks.clients[0].disconnect).toHaveBeenCalled();
    expect(mocks.stopAllSpeakingMeters).toHaveBeenCalled();
  });

  test("can retry microphone access and reports its failures", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    let initialAccess;
    await act(async () => {
      initialAccess = await hook.result.current.requestMicrophoneAccess();
    });
    expect(initialAccess).toBe(false);
    expect(hook.result.current.voiceError).not.toBe("");

    await act(() => hook.result.current.createRoom("Alice"));
    mocks.start.mockResolvedValueOnce(stream());
    await act(async () => {
      expect(await hook.result.current.requestMicrophoneAccess()).toBe(true);
    });
    mocks.start.mockRejectedValueOnce(new Error("permission denied"));
    await act(async () => {
      expect(await hook.result.current.requestMicrophoneAccess()).toBe(false);
    });
    expect(hook.result.current.voiceError).toContain("permission denied");
  });

  test("manages remote streams, transfer progress and song imports", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    const voice = mocks.voices[0];
    const remoteStream = stream();
    await act(async () => voice.onRemoteStream("guest", remoteStream));
    const audio = document.querySelector(
      'audio[data-online-room-participant="guest"]'
    );
    expect(audio.srcObject).toBe(remoteStream);
    expect(mocks.startSpeakingMeter).toHaveBeenCalledWith(
      "guest",
      remoteStream
    );

    act(() => voice.onTransferProgress({ stage: "sending", percent: "42" }));
    expect(hook.result.current.transferStatus).toEqual({
      stage: "sending",
      percent: 42
    });
    act(() => voice.onTransferProgress({ stage: "complete", percent: 100 }));
    expect(hook.result.current.transferStatus).toBeNull();

    await act(() =>
      voice.onFile("host", new Blob(["song"]), {
        kind: "song-package",
        songId: "song",
        filename: "song.zip"
      })
    );
    expect(mocks.importSongPackage).toHaveBeenCalledWith(
      expect.any(Blob),
      "song.zip"
    );
    await act(() => voice.onFile("host", new Blob(), { kind: "other" }));

    act(() => voice.onPeerClosed("guest"));
    expect(document.body.contains(audio)).toBe(false);
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledWith("guest");
  });

  test("can render and remove participant effects without leaking audio graphs", async () => {
    const contexts = [];
    globalThis.AudioContext = class {
      constructor(options) {
        this.options = options;
        this.sampleRate = 100;
        this.destination = {};
        this.resume = vi.fn().mockResolvedValue(undefined);
        this.close = vi.fn().mockResolvedValue(undefined);
        this.source = { connect: vi.fn() };
        this.master = {
          gain: { value: 1 },
          connect: vi.fn()
        };
        contexts.push(this);
      }
      createMediaStreamSource = () => this.source;
      createGain = () =>
        this.master.connect.mock.calls.length
          ? { gain: { value: 0 }, connect: vi.fn() }
          : this.master;
      createDelay = () => ({ delayTime: { value: 0 }, connect: vi.fn() });
      createConvolver = () => ({ buffer: null, connect: vi.fn() });
      createBuffer = () => ({
        numberOfChannels: 2,
        getChannelData: () => new Float32Array(100)
      });
    };
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    const voice = mocks.voices[0];
    await act(async () => voice.onRemoteStream("guest", stream()));
    const providerControls =
      mocks.createOnlineRoomMessageHandler.mock.calls[0][0];
    act(() =>
      providerControls.setRoomUi({
        effectsByParticipant: {
          guest: { echo: 0.5, delay: 0.4, reverb: 0.6 }
        }
      })
    );
    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.effectPeople.has("guest")).toBe(true);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].resume).toHaveBeenCalled();
    const audio = document.querySelector("audio");
    expect(audio.muted).toBe(true);

    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    expect(contexts[0].close).toHaveBeenCalled();
    expect(audio.muted).toBe(false);
  });

  test("falls back cleanly when participant effects are unsupported", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    await act(async () => mocks.voices[0].onRemoteStream("guest", stream()));
    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.effectPeople.has("guest")).toBe(true);
    expect(document.querySelector("audio").muted).toBe(false);
  });

  test("cleans up and rethrows connection and import failures", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("socket failed"));
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await expect(hook.result.current.joinRoom("room", "Bob")).rejects.toThrow(
      "socket failed"
    );
    expect(mocks.clients[0].disconnect).toHaveBeenCalled();

    mocks.connect.mockResolvedValueOnce("room");
    await act(() => hook.result.current.joinRoom("room", "Bob"));
    mocks.importSongPackage.mockRejectedValueOnce(new Error("bad package"));
    let importError;
    await act(async () => {
      try {
        await mocks.voices[1].onFile("host", new Blob(), {
          kind: "song-package",
          songId: "song"
        });
      } catch (error) {
        importError = error;
      }
    });
    expect(importError?.message).toBe("bad package");
    expect(hook.result.current.transferStatus).toMatchObject({
      stage: "error",
      percent: 0
    });
  });
});
