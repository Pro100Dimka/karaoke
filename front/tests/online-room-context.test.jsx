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
    act(() => voice.onTransferProgress({ stage: "sending", percent: "bad" }));
    expect(hook.result.current.transferStatus.percent).toBe(0);
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
    expect(contexts[0].master.gain.value).toBe(1);
    const audio = document.querySelector("audio");
    expect(audio.muted).toBe(true);
    act(() => hook.result.current.setRoomSoundMuted(true));
    expect(contexts[0].master.gain.value).toBe(0);
    act(() => hook.result.current.setRoomSoundMuted(false));

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

  test("cancels stale microphone and remote-stream work", async () => {
    let releaseVoice;
    const lateTrack = { stop: vi.fn() };
    mocks.start.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseVoice = resolve;
      })
    );
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    const oldVoice = mocks.voices[0];
    await act(() => hook.result.current.leaveRoom());
    releaseVoice({ getTracks: () => [lateTrack], getAudioTracks: () => [] });
    await act(async () => Promise.resolve());
    expect(lateTrack.stop).toHaveBeenCalled();

    const remoteTrack = { stop: vi.fn() };
    await act(async () =>
      oldVoice.onRemoteStream("stale", {
        getTracks: () => [remoteTrack]
      })
    );
    expect(remoteTrack.stop).toHaveBeenCalled();

    let releaseRetry;
    const retry = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => retry.result.current.createRoom("Retry"));
    mocks.start.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseRetry = resolve;
      })
    );
    const requesting = retry.result.current.requestMicrophoneAccess();
    await act(() => retry.result.current.leaveRoom());
    const retryTrack = { stop: vi.fn() };
    releaseRetry({ getTracks: () => [retryTrack], getAudioTracks: () => [] });
    await act(async () => requesting);
    expect(retryTrack.stop).toHaveBeenCalled();
  });

  test("reports voice playback failures and isolates rejected audio graph promises", async () => {
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(
      new Error("autoplay blocked")
    );
    const contexts = [];
    globalThis.AudioContext = class {
      constructor() {
        this.destination = {};
        this.source = { connect: vi.fn() };
        this.master = { gain: { value: 1 }, connect: vi.fn() };
        this.resume = vi.fn().mockRejectedValue(new Error("resume"));
        this.close = vi.fn().mockRejectedValue(new Error("close"));
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
        getChannelData: () => new Float32Array(10)
      });
    };
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    await act(async () => mocks.voices[0].onRemoteStream("guest", stream()));
    await waitFor(() => expect(hook.result.current.voiceError).not.toBe(""));
    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    expect(contexts[0].close).toHaveBeenCalled();
    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    act(() => mocks.voices[0].onPeerClosed("guest"));
    await act(async () => Promise.resolve());

    mocks.openKaraokeInRoom.mockImplementationOnce((options) =>
      options.isCurrentConnection()
    );
    expect(hook.result.current.openKaraoke("song")).toBe(true);
  });

  test("keeps a room connected when initial microphone startup fails", async () => {
    mocks.start.mockRejectedValueOnce(new Error("no microphone"));
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    await waitFor(() =>
      expect(hook.result.current.voiceError).toContain("no microphone")
    );
    expect(hook.result.current.room.id).toBe("room-id");
  });

  test("ignores stale microphone, playback, transfer and import failures", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    const voice = mocks.voices[0];

    let rejectRetry;
    mocks.start.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRetry = reject;
      })
    );
    const retry = hook.result.current.requestMicrophoneAccess();
    await act(() => hook.result.current.leaveRoom());
    rejectRetry(new Error("stale microphone"));
    await expect(retry).resolves.toBe(false);

    act(() => voice.onTransferProgress({ stage: "sending", percent: 10 }));
    expect(hook.result.current.transferStatus).toBeNull();
    act(() => voice.onPeerClosed("stale"));

    await act(() => hook.result.current.createRoom("Alice"));
    const currentVoice = mocks.voices.at(-1);
    let rejectPlay;
    HTMLMediaElement.prototype.play.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectPlay = reject;
      })
    );
    await currentVoice.onRemoteStream("guest", stream());
    await act(() => hook.result.current.leaveRoom());
    rejectPlay(new Error("stale autoplay"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.voiceError).toBe("");
  });

  test("publishes an imported pending song and ignores a stale import result", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    const voice = mocks.voices[0];
    await hook.result.current.openKaraoke("missing-song");
    const actionOptions = mocks.openKaraokeInRoom.mock.calls.at(-1)?.[0];
    actionOptions.pendingSongCommandRef.current = {
      type: "open-karaoke",
      songId: "song",
      __originatedHere: true
    };
    await act(() =>
      voice.onFile("host", new Blob(), {
        kind: "song-package",
        songId: "song",
        filename: "song.zip"
      })
    );
    expect(mocks.clients[0].send).toHaveBeenCalledWith("sync", {
      state: { type: "open-karaoke", songId: "song" }
    });
    expect(hook.result.current.roomCommand).toMatchObject({ songId: "song" });

    const sentBeforeRemoteImport = mocks.clients[0].send.mock.calls.length;
    actionOptions.pendingSongCommandRef.current = {
      type: "open-karaoke",
      songId: "remote-song",
      __originatedHere: false
    };
    await act(() =>
      voice.onFile("host", new Blob(), {
        kind: "song-package",
        songId: "remote-song"
      })
    );
    expect(mocks.clients[0].send).toHaveBeenCalledTimes(sentBeforeRemoteImport);
    expect(hook.result.current.roomCommand).toMatchObject({
      songId: "remote-song"
    });

    let releaseImport;
    mocks.importSongPackage.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseImport = resolve;
      })
    );
    const staleImport = voice.onFile("host", new Blob(), {
      kind: "song-package",
      songId: "late"
    });
    await act(() => hook.result.current.leaveRoom());
    releaseImport({ id: "late" });
    await act(async () => staleImport);
    expect(hook.result.current.room).toBeNull();
  });

  test("uses a guest fallback name and ignores stale import errors", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("room", "   "));
    expect(hook.result.current.participants[0].name).not.toBe("");
    const voice = mocks.voices[0];
    let rejectImport;
    mocks.importSongPackage.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectImport = reject;
      })
    );
    const staleImport = voice.onFile("host", new Blob(), {
      kind: "song-package",
      songId: "late"
    });
    await act(() => hook.result.current.leaveRoom());
    rejectImport(new Error("obsolete import"));
    await expect(staleImport).rejects.toThrow("obsolete import");
    expect(hook.result.current.transferStatus).toBeNull();
  });

  test("cancels an older connection when a newer request wins", async () => {
    let releaseFirst;
    mocks.connect
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirst = resolve;
        })
      )
      .mockResolvedValueOnce("new-room");
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    const first = hook.result.current.joinRoom("old", "Alice");
    await act(async () => Promise.resolve());
    await act(() => hook.result.current.joinRoom("new", "Alice"));
    releaseFirst("old-room");
    await expect(first).rejects.toThrow(Error);
    expect(mocks.clients[0].disconnect).toHaveBeenCalled();
    expect(mocks.voices[0].stop).toHaveBeenCalled();
  });

  test("ignores an initial microphone failure from an obsolete connection", async () => {
    let rejectOldVoice;
    mocks.start.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectOldVoice = reject;
      })
    );
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("old", "Alice"));
    await act(() => hook.result.current.joinRoom("new", "Alice"));
    rejectOldVoice(new Error("obsolete microphone"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.room.id).toBe("room-id");
    expect(hook.result.current.voiceError).not.toContain("obsolete");
  });
});
