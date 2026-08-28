/* @vitest-environment jsdom */
/* eslint-disable max-classes-per-file, lines-between-class-members */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clients: [],
  voices: [],
  connect: vi.fn(),
  start: vi.fn(),
  importSongPackage: vi.fn(),
  getSongRevision: vi.fn(),
  exportSongPackage: vi.fn(),
  openKaraokeInRoom: vi.fn(),
  messageHandler: vi.fn(),
  createOnlineRoomMessageHandler: vi.fn(),
  muteApplicationAudio: vi.fn(),
  restoreApplicationAudio: vi.fn(),
  prepareSpeakingMeter: vi.fn(),
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
      this.unsubscribe = vi.fn();
      this.onMessage = vi.fn(() => this.unsubscribe);
      mocks.clients.push(this);
    }
  }
  class OnlineVoiceMesh {
    constructor(client) {
      this.client = client;
      this.start = mocks.start;
      this.getMeterStream = () => this.meterStream;
      this.stop = vi.fn();
      this.setMicrophoneMuted = vi.fn();
      this.lifecycleVersion = 0;
      this.channels = new Map();
      this.waitForDataChannel = vi.fn().mockResolvedValue({ send: vi.fn() });
      this.sendFile = vi.fn().mockResolvedValue(true);
      this.sendSongSyncError = vi.fn();
      mocks.voices.push(this);
    }
  }
  return {
    createHostToken: () => "host-token",
    createRoomId: () => "created-room",
    OnlineRoomClient,
    OnlineVoiceMesh
  };
});
vi.mock("../src/api/client", () => ({
  api: {
    importSongPackage: mocks.importSongPackage,
    getSongRevision: mocks.getSongRevision,
    exportSongPackage: mocks.exportSongPackage
  }
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
    prepareSpeakingMeter: mocks.prepareSpeakingMeter,
    startSpeakingMeter: mocks.startSpeakingMeter,
    stopSpeakingMeter: mocks.stopSpeakingMeter,
    stopAllSpeakingMeters: mocks.stopAllSpeakingMeters
  })
}));
vi.mock("../src/contexts/onlineRoomActions", () => ({
  openKaraokeInRoom: mocks.openKaraokeInRoom,
  createCommandId: () => "command-id"
}));
vi.mock("../src/contexts/onlineRoomMessages", () => ({
  createOnlineRoomMessageHandler: mocks.createOnlineRoomMessageHandler
}));

let OnlineRoomProvider;
let shouldBroadcastRoomTransferProgress;
let useOnlineRoom;
let useOnlineRoomSpeaking;

const wrapper = ({ children }) => <OnlineRoomProvider>{children}</OnlineRoomProvider>;
const stream = () => ({ getTracks: () => [{ stop: vi.fn() }] });

beforeEach(async () => {
  globalThis.localStorage?.setItem("advoice-language", "ru");
  vi.resetModules();
  ({ OnlineRoomProvider, shouldBroadcastRoomTransferProgress, useOnlineRoom, useOnlineRoomSpeaking } =
    await import("../src/contexts/OnlineRoomContext"));
  Object.values(mocks).forEach((mock) => mock?.mockReset?.());
  mocks.clients.length = 0;
  mocks.voices.length = 0;
  mocks.connect.mockResolvedValue("room-id");
  mocks.start.mockResolvedValue(stream());
  mocks.importSongPackage.mockResolvedValue({ id: "song" });
  mocks.getSongRevision.mockImplementation(async () => ({ revision: "sha256:" + "a".repeat(64) }));
  mocks.exportSongPackage.mockResolvedValue(new Blob(["x"]));
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
  test("bounds room-wide transfer progress without dropping terminal updates", () => {
    const previous = { commandId: "command", stage: "sending", percent: 10, at: 1_000 };

    expect(shouldBroadcastRoomTransferProgress(previous, { commandId: "command", stage: "sending", percent: 11 }, 1_499)).toBe(false);
    expect(shouldBroadcastRoomTransferProgress(previous, { commandId: "command", stage: "sending", percent: 11 }, 1_500)).toBe(true);
    expect(shouldBroadcastRoomTransferProgress(previous, { commandId: "command", stage: "complete", percent: 100 }, 1_001)).toBe(true);

    let published = null;
    let count = 0;
    for (let index = 1; index <= 1_000; index += 1) {
      const update = {
        commandId: "command",
        stage: "sending",
        percent: Math.min(99, Math.floor(index / 10)),
        at: index * 10
      };
      if (shouldBroadcastRoomTransferProgress(published, update, update.at)) {
        published = update;
        count += 1;
      }
    }
    expect(count).toBeLessThanOrEqual(20);
  });

  test("returns no room outside the provider", () => {
    const { result } = renderHook(() => useOnlineRoom());
    expect(result.current).toBeNull();
  });

  test("exposes the exact disconnected-room state", () => {
    const { result } = renderHook(() => useOnlineRoom(), { wrapper });
    expect(result.current).toMatchObject({
      room: null,
      participants: [],
      mutedPeople: new Set(),
      effectPeople: new Set(),
      microphoneMuted: false,
      roomSoundMuted: false,
      roomUi: {},
      roomCommand: null,
      voiceError: "",
      transferStatus: null
    });
    expect(Object.values(result.current).filter((value) => typeof value === "function")).toHaveLength(17);
    expect(() => result.current.setMicrophoneMuted(true)).not.toThrow();
    expect(() => result.current.syncUi({ radio: true })).not.toThrow();
    expect(() => result.current.syncCommand({ type: "pause" })).not.toThrow();
  });

  test("exposes speaking levels through a separate context", () => {
    const { result } = renderHook(() => useOnlineRoomSpeaking(), { wrapper });
    expect(result.current).toEqual({ localSpeakingLevel: 0.4, speakingLevels: { guest: 0.2 } });
  });

  test("fully restores application audio after an unexpected disconnect", async () => {
    const { result } = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => result.current.createRoom("Alice"));
    act(() => result.current.setRoomSoundMuted(true));
    expect(result.current.roomSoundMuted).toBe(true);
    const { onConnectionClosed, isCurrentConnection } = mocks.createOnlineRoomMessageHandler.mock.calls.at(-1)[0];
    expect(isCurrentConnection()).toBe(true);
    await act(async () => onConnectionClosed());
    expect(isCurrentConnection()).toBe(false);
    expect(mocks.restoreApplicationAudio).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.room).toBeNull();
      expect(result.current.roomSoundMuted).toBe(false);
      expect(result.current.voiceError).toBe("Соединение с комнатой потеряно.");
    });
  });

  test("shows a specific reason when the room closes (e.g. the host left)", async () => {
    const { result } = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => result.current.createRoom("Alice"));
    const { onConnectionClosed } = mocks.createOnlineRoomMessageHandler.mock.calls.at(-1)[0];
    await act(async () => onConnectionClosed("Хост покинул комнату. Комната закрыта."));
    await waitFor(() => {
      expect(result.current.room).toBeNull();
      expect(result.current.voiceError).toBe("Хост покинул комнату. Комната закрыта.");
    });
  });

  test("creates a room, starts voice and exposes synchronization actions", async () => {
    const { result } = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => result.current.createRoom("Alice"));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    expect(mocks.connect).toHaveBeenCalledWith({
      id: "created-room",
      name: "Alice",
      host: true,
      hostToken: "host-token"
    });
    expect(result.current.room).toMatchObject({
      id: "room-id",
      selfId: "pending-room-id",
      host: true,
      role: "host"
    });
    expect(result.current.participants).toEqual([{ id: "pending-room-id", name: "Alice", role: "host", pending: true }]);
    expect(mocks.startSpeakingMeter).toHaveBeenCalledWith("local", expect.any(Object));
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenCalledWith(false);
    expect(mocks.clients[0].send).toHaveBeenCalledWith("presence", { micMuted: false });
    expect(mocks.clients[0].onMessage).toHaveBeenCalledWith(mocks.messageHandler);
    expect(mocks.createOnlineRoomMessageHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "created-room",
        client: mocks.clients[0],
        voice: mocks.voices[0]
      })
    );

    act(() => result.current.syncUi({ radio: true }));
    act(() => result.current.syncCommand({ type: "pause" }));
    expect(mocks.clients[0].send).toHaveBeenCalledWith("ui", { state: { radio: true } });
    expect(mocks.clients[0].send).toHaveBeenCalledWith("sync", { state: { type: "pause" } });

    await act(() => result.current.openKaraoke("song-1"));
    expect(mocks.openKaraokeInRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        songId: "song-1",
        room: result.current.room,
        client: mocks.clients[0]
      })
    );
    expect(mocks.openKaraokeInRoom.mock.calls.at(-1)[0].isCurrentConnection()).toBe(true);
  });

  test("joins, mutes participants and fully leaves the room", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("shared", "Bob"));
    expect(hook.result.current.room.role).toBe("guest");

    const sharedPlay = {
      type: "karaoke-player",
      action: "play",
      songId: "song",
      position: 4,
      commandId: "guest-play"
    };
    act(() => hook.result.current.syncCommand(sharedPlay));
    expect(mocks.clients[0].send).toHaveBeenCalledWith("sync", { state: sharedPlay });
    mocks.clients[0].send.mockClear();
    act(() => hook.result.current.syncCommand({ type: "open-library" }));
    expect(mocks.clients[0].send).not.toHaveBeenCalled();

    act(() => hook.result.current.togglePersonMuted("guest"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.mutedPeople.has("guest")).toBe(true);
    act(() => hook.result.current.togglePersonMuted("guest"));
    expect(hook.result.current.mutedPeople.has("guest")).toBe(false);

    act(() => hook.result.current.setMicrophoneMuted(true));
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenLastCalledWith(true);
    expect(mocks.clients[0].send).toHaveBeenCalledWith("presence", { micMuted: true });
    act(() => hook.result.current.setMicrophoneMuted(false, false));
    expect(mocks.clients[0].send).not.toHaveBeenLastCalledWith("presence", { micMuted: false });

    const muteCalls = mocks.voices[0].setMicrophoneMuted.mock.calls.length;
    const restoreCalls = mocks.restoreApplicationAudio.mock.calls.length;
    act(() => hook.result.current.setRoomSoundMuted(false));
    expect(mocks.restoreApplicationAudio).toHaveBeenCalledTimes(restoreCalls);
    act(() => hook.result.current.setRoomSoundMuted(true));
    expect(mocks.muteApplicationAudio).not.toHaveBeenCalled();
    expect(hook.result.current.roomSoundMuted).toBe(true);
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenCalledTimes(muteCalls);
    act(() => hook.result.current.setRoomSoundMuted(true));
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenCalledTimes(muteCalls);
    act(() => hook.result.current.setRoomSoundMuted(false));
    expect(mocks.restoreApplicationAudio).toHaveBeenCalledTimes(restoreCalls + 2);
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenCalledTimes(muteCalls);

    const controls = mocks.createOnlineRoomMessageHandler.mock.calls[0][0];
    act(() => {
      hook.result.current.togglePersonMuted("guest");
      hook.result.current.togglePersonEffects("guest");
      hook.result.current.setRoomSoundMuted(true);
      controls.setRoomUi({ radio: true });
      controls.setRoomCommand({ type: "pause" });
      controls.setVoiceError("voice failure");
      controls.setTransferStatus({ stage: "sending", percent: 12 });
    });
    controls.pendingSongCommandRef.current = { songId: "pending" };
    const disconnectStates = [];
    mocks.clients[0].disconnect.mockImplementation(() => {
      disconnectStates.push(controls.intentionalDisconnectRef.current);
    });

    await act(() => hook.result.current.leaveRoom());
    expect(hook.result.current).toMatchObject({
      room: null,
      participants: [],
      mutedPeople: new Set(),
      effectPeople: new Set(),
      microphoneMuted: false,
      roomSoundMuted: false,
      roomUi: {},
      roomCommand: null,
      voiceError: "",
      transferStatus: null
    });
    expect(mocks.voices[0].stop).toHaveBeenCalled();
    expect(mocks.clients[0].disconnect).toHaveBeenCalled();
    expect(mocks.clients[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.stopAllSpeakingMeters).toHaveBeenCalled();
    expect(controls.pendingSongCommandRef.current).toBeNull();
    expect(controls.intentionalDisconnectRef.current).toBe(false);
    expect(disconnectStates).toEqual([true]);
  });

  test("can retry microphone access and reports its failures", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    let initialAccess;
    await act(async () => {
      initialAccess = await hook.result.current.requestMicrophoneAccess();
    });
    expect(initialAccess).toBe(false);
    expect(hook.result.current.voiceError).toBe("Сначала подключитесь к комнате.");

    await act(() => hook.result.current.createRoom("Alice"));
    const unmutedStream = stream();
    const rawMeterStream = stream();
    mocks.voices[0].meterStream = rawMeterStream;
    mocks.start.mockResolvedValueOnce(unmutedStream);
    await act(() => hook.result.current.requestMicrophoneAccess());
    expect(mocks.prepareSpeakingMeter).toHaveBeenCalled();
    expect(mocks.startSpeakingMeter).toHaveBeenLastCalledWith("local", rawMeterStream);
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenLastCalledWith(false);
    expect(mocks.clients[0].send).toHaveBeenLastCalledWith("presence", { micMuted: false });
    act(() => mocks.voices[0].onTransferProgress({ stage: "sending", percent: 1 }));
    act(() => hook.result.current.setMicrophoneMuted(true));
    mocks.start.mockResolvedValueOnce(stream());
    await act(async () => {
      expect(await hook.result.current.requestMicrophoneAccess()).toBe(true);
    });
    expect(hook.result.current.voiceError).toBe("");
    expect(hook.result.current.transferStatus).toBeNull();
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenLastCalledWith(true);
    expect(mocks.clients[0].send).toHaveBeenLastCalledWith("presence", { micMuted: true });

    act(() => {
      hook.result.current.setRoomSoundMuted(true);
      hook.result.current.setMicrophoneMuted(false, false);
    });
    mocks.start.mockResolvedValueOnce(stream());
    await act(() => hook.result.current.requestMicrophoneAccess());
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenLastCalledWith(false);
    expect(mocks.clients[0].send).toHaveBeenLastCalledWith("presence", { micMuted: false });

    mocks.start.mockRejectedValueOnce(new Error("permission denied"));
    await act(async () => {
      expect(await hook.result.current.requestMicrophoneAccess()).toBe(false);
    });
    expect(hook.result.current.voiceError).toBe(
      "Не удалось получить доступ к микрофону: permission denied. " + "Проверьте разрешение Windows и повторите попытку."
    );

    mocks.start.mockRejectedValueOnce(null);
    await act(() => hook.result.current.requestMicrophoneAccess());
    expect(hook.result.current.voiceError).toBe(
      "Не удалось получить доступ к микрофону: нет доступа к микрофону. " + "Проверьте разрешение Windows и повторите попытку."
    );
  });

  test("resets every per-room value before reconnecting", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    const oldClient = mocks.clients[0];
    const oldVoice = mocks.voices[0];
    const controls = mocks.createOnlineRoomMessageHandler.mock.calls[0][0];
    act(() => {
      hook.result.current.togglePersonMuted("guest");
      hook.result.current.togglePersonEffects("guest");
      hook.result.current.setMicrophoneMuted(true);
      hook.result.current.setRoomSoundMuted(true);
      controls.setRoomUi({ radio: true });
      controls.setRoomCommand({ type: "pause" });
      controls.setVoiceError("failure");
      controls.setTransferStatus({ stage: "sending", percent: 33 });
    });
    controls.pendingSongCommandRef.current = { songId: "old-song" };
    const disconnectStates = [];
    oldClient.disconnect.mockImplementation(() => {
      disconnectStates.push(controls.intentionalDisconnectRef.current);
    });

    mocks.connect.mockResolvedValueOnce("replacement");
    await act(() => hook.result.current.joinRoom("next", " Bob "));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));

    expect(oldClient.unsubscribe).toHaveBeenCalledTimes(1);
    expect(oldClient.disconnect).toHaveBeenCalledTimes(1);
    expect(oldVoice.stop).toHaveBeenCalledTimes(1);
    expect(controls.pendingSongCommandRef.current).toBeNull();
    expect(controls.intentionalDisconnectRef.current).toBe(false);
    expect(disconnectStates).toEqual([true]);
    expect(hook.result.current).toMatchObject({
      room: { id: "replacement", selfId: "pending-replacement", host: false, role: "guest" },
      participants: [{ id: "pending-replacement", name: "Bob", role: "guest", pending: true }],
      mutedPeople: new Set(),
      effectPeople: new Set(),
      microphoneMuted: false,
      roomSoundMuted: false,
      roomUi: {},
      roomCommand: null,
      voiceError: "",
      transferStatus: null
    });
    expect(mocks.voices[1].setMicrophoneMuted).toHaveBeenCalledWith(false);
    expect(mocks.clients[1].send).toHaveBeenCalledWith("presence", { micMuted: false });
  });

  test("manages remote streams, transfer progress and song imports", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    const voice = mocks.voices[0];
    const remoteStream = stream();
    await act(async () => voice.onRemoteStream("guest", remoteStream));
    const audio = document.querySelector('audio[data-online-room-participant="guest"]');
    expect(audio.srcObject).toBe(remoteStream);
    expect(audio.autoplay).toBe(true);
    expect(audio.playsInline).toBe(true);
    expect(audio.style.display).toBe("none");
    expect(mocks.startSpeakingMeter).toHaveBeenCalledWith("guest", remoteStream);
    expect(audio.muted).toBe(false);
    act(() => hook.result.current.togglePersonMuted("guest"));
    await act(async () => Promise.resolve());
    expect(audio.muted).toBe(true);
    act(() => hook.result.current.togglePersonMuted("guest"));
    await act(async () => Promise.resolve());
    expect(audio.muted).toBe(false);

    act(() => voice.onTransferProgress({ stage: "sending", percent: "42" }));
    expect(hook.result.current.transferStatus).toEqual({ stage: "sending", percent: 42 });
    act(() => voice.onTransferProgress({ stage: "sending", percent: "bad" }));
    expect(hook.result.current.transferStatus.percent).toBe(0);
    act(() => voice.onTransferProgress({ stage: "complete", percent: 100 }));
    expect(hook.result.current.transferStatus).toBeNull();

    await act(async () => {
      await expect(
        voice.onFile("host", new Blob(["song"]), {
          kind: "song-package",
          songId: "song",
          filename: "song.zip"
        })
      ).rejects.toThrow("Получение пакета песни больше не разрешено");
    });
    expect(mocks.importSongPackage).not.toHaveBeenCalled();
    expect(hook.result.current.transferStatus).toBeNull();
    expect(hook.result.current.roomCommand).toBeNull();
    await act(async () => {
      await expect(voice.onFile("host", new Blob(), { kind: "other" })).rejects.toThrow();
    });

    act(() => voice.onPeerClosed("guest"));
    expect(document.body.contains(audio)).toBe(false);
    expect(audio.srcObject).toBeNull();
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledWith("guest");
    expect(() => voice.onPeerClosed("missing")).not.toThrow();
  });

  test("rejects incomplete song-transfer metadata without importing", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    const voice = mocks.voices[0];
    await expect(voice.onFile("host", new Blob(), undefined)).rejects.toThrow();
    await expect(voice.onFile("host", new Blob(), {})).rejects.toThrow();
    await expect(voice.onFile("host", new Blob(), { kind: "other", songId: "song" })).rejects.toThrow();
    await expect(voice.onFile("host", new Blob(), { kind: "song-package" })).rejects.toThrow();
    expect(mocks.importSongPackage).not.toHaveBeenCalled();
  });

  test("can render and remove participant effects without leaking audio graphs", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    const contexts = [];
    globalThis.AudioContext = class {
      constructor(options) {
        this.options = options;
        this.sampleRate = 100;
        this.destination = {};
        this.resume = vi.fn().mockResolvedValue(undefined);
        this.close = vi.fn().mockResolvedValue(undefined);
        this.source = { connect: vi.fn() };
        this.gains = [];
        this.delays = [];
        this.convolvers = [];
        this.buffers = [];
        contexts.push(this);
      }
      createMediaStreamSource = () => this.source;
      createGain = () => {
        const node = { gain: { value: 0 }, connect: vi.fn() };
        this.gains.push(node);
        return node;
      };
      createDelay = (maximum) => {
        const node = { maximum, delayTime: { value: 0 }, connect: vi.fn() };
        this.delays.push(node);
        return node;
      };
      createConvolver = () => {
        const node = { buffer: null, connect: vi.fn() };
        this.convolvers.push(node);
        return node;
      };
      createBuffer = (channels, frames, sampleRate) => {
        const data = Array.from({ length: channels }, () => new Float32Array(frames));
        const buffer = {
          channels,
          frames,
          sampleRate,
          numberOfChannels: channels,
          data,
          getChannelData: (channel) => data[channel]
        };
        this.buffers.push(buffer);
        return buffer;
      };
    };
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    const voice = mocks.voices[0];
    await act(async () => voice.onRemoteStream("guest", stream()));
    const providerControls = mocks.createOnlineRoomMessageHandler.mock.calls[0][0];
    act(() =>
      providerControls.setRoomUi({
        effectsByParticipant: { guest: { echo: 0.5, delay: 0.4, reverb: 0.6 } }
      })
    );
    act(() => hook.result.current.togglePersonEffects("guest"));
    await waitFor(() => expect(contexts).toHaveLength(1));
    expect(hook.result.current.effectPeople.has("guest")).toBe(true);
    const [context] = contexts;
    expect(context.options).toEqual({ latencyHint: "interactive" });
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.gains).toHaveLength(4);
    expect(context.delays).toHaveLength(1);
    expect(context.delays[0].maximum).toBe(1);
    expect(context.delays[0].delayTime.value).toBeCloseTo(0.196);
    expect(context.gains[1].gain.value).toBeCloseTo(0.395);
    expect(context.gains[2].gain.value).toBeCloseTo(0.326);
    expect(context.gains[3].gain.value).toBeCloseTo(0.288);
    expect(context.buffers[0]).toMatchObject({ channels: 2, frames: 104, sampleRate: 100 });
    expect(context.buffers[0].data[0][0]).toBeCloseTo(0.5);
    expect(context.buffers[0].data[0][52]).toBeCloseTo(0.5 * 0.5 ** 2.7);
    expect(context.buffers[0].data[1][103]).toBeCloseTo(0.5 * (1 - 103 / 104) ** 2.7);
    expect(context.convolvers[0].buffer).toBe(context.buffers[0]);
    expect(context.source.connect).toHaveBeenCalledWith(context.gains[0]);
    expect(context.source.connect).toHaveBeenCalledWith(context.delays[0]);
    expect(context.source.connect).toHaveBeenCalledWith(context.convolvers[0]);
    expect(context.delays[0].connect).toHaveBeenCalledWith(context.gains[1]);
    expect(context.delays[0].connect).toHaveBeenCalledWith(context.gains[2]);
    expect(context.gains[1].connect).toHaveBeenCalledWith(context.delays[0]);
    expect(context.convolvers[0].connect).toHaveBeenCalledWith(context.gains[3]);
    expect(context.gains[0].connect).toHaveBeenCalledWith(context.destination);
    expect(context.gains[0].gain.value).toBe(1);
    const audio = document.querySelector("audio");
    expect(audio.muted).toBe(true);
    act(() => hook.result.current.setRoomSoundMuted(true));
    expect(context.gains[0].gain.value).toBe(0);
    act(() => hook.result.current.setRoomSoundMuted(false));

    act(() =>
      providerControls.setRoomUi({
        effectsByParticipant: { guest: { echo: 2, delay: -1, reverb: "invalid" } }
      })
    );
    await waitFor(() => expect(contexts).toHaveLength(2));
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(contexts[1].delays[0].delayTime.value).toBeCloseTo(0.06);
    expect(contexts[1].gains[1].gain.value).toBeCloseTo(0.55);
    expect(contexts[1].gains[2].gain.value).toBeCloseTo(0.46);
    expect(contexts[1].convolvers).toHaveLength(0);

    act(() => hook.result.current.togglePersonEffects("guest"));
    await waitFor(() => expect(contexts[1].close).toHaveBeenCalledTimes(1));
    expect(hook.result.current.effectPeople.has("guest")).toBe(false);
    expect(audio.muted).toBe(false);
  });

  test("falls back cleanly when participant effects are unsupported", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    act(() => hook.result.current.togglePersonEffects("missing"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.effectPeople.has("missing")).toBe(true);
    await act(async () => mocks.voices[0].onRemoteStream("guest", stream()));
    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.effectPeople.has("guest")).toBe(true);
    expect(document.querySelector("audio").muted).toBe(false);
  });

  test("supports the webkit audio fallback and optional graph methods", async () => {
    const contexts = [];
    globalThis.webkitAudioContext = class {
      constructor(options) {
        this.options = options;
        this.destination = {};
        this.master = { gain: { value: 0 }, connect: vi.fn() };
        this.source = { connect: vi.fn() };
        contexts.push(this);
      }
      createMediaStreamSource = () => this.source;
      createGain = () => this.master;
    };
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    await act(async () => mocks.voices[0].onRemoteStream("guest", stream()));
    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    expect(contexts).toHaveLength(1);
    expect(contexts[0].options).toEqual({ latencyHint: "interactive" });
    expect(contexts[0].master.gain.value).toBe(1);
    expect(document.querySelector("audio").muted).toBe(true);
    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    expect(document.querySelector("audio").muted).toBe(false);
    await act(async () => mocks.voices[0].onRemoteStream("guest-2", stream()));
    act(() => hook.result.current.togglePersonEffects("guest-2"));
    await act(async () => Promise.resolve());
    expect(contexts).toHaveLength(2);
    expect(() => mocks.voices[0].onPeerClosed("guest-2")).not.toThrow();
  });

  test("cleans up and rethrows connection and import failures", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("socket failed"));
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await expect(hook.result.current.joinRoom("room", "Bob")).rejects.toThrow("socket failed");
    expect(mocks.clients[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.clients[0].disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.voices[0].stop).toHaveBeenCalledTimes(1);
    expect(mocks.stopAllSpeakingMeters).toHaveBeenCalledTimes(2);

    mocks.connect.mockResolvedValueOnce("room");
    await act(() => hook.result.current.joinRoom("room", "Bob"));
    mocks.importSongPackage.mockRejectedValueOnce(new Error("bad package"));
    const importOptions = mocks.createOnlineRoomMessageHandler.mock.calls.at(-1)[0];
    const revision = "sha256:" + "a".repeat(64);
    act(() => {
      importOptions.setRoom({ id: "room-id", selfId: "guest", host: false, role: "guest" });
      importOptions.setParticipants([{ id: "host", role: "host" }]);
      importOptions.pendingSongCommandRef.current = {
        type: "open-karaoke",
        songId: "song",
        commandId: "cmd-song",
        revision,
        __originatedHere: false
      };
    });
    let importError;
    await act(async () => {
      try {
        await mocks.voices[1].onFile("host", new Blob(), {
          kind: "song-package",
          songId: "song",
          commandId: "cmd-song",
          revision
        });
      } catch (error) {
        importError = error;
      }
    });
    expect(importError?.message).toBe("bad package");
    expect(hook.result.current.transferStatus).toEqual({
      songId: "song",
      stage: "error",
      error: "Не удалось импортировать песню: bad package",
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
    await act(async () => oldVoice.onRemoteStream("stale", { getTracks: () => [remoteTrack] }));
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
    await act(async () => {
      expect(await requesting).toBe(false);
    });
    expect(retryTrack.stop).toHaveBeenCalled();
  });

  test("discards a stale local-monitor stream after leaving the room", async () => {
    let releaseMonitor;
    const monitorTrack = { stop: vi.fn() };
    const monitorStream = { getTracks: () => [monitorTrack], getAudioTracks: () => [] };
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    mocks.start.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseMonitor = resolve;
      })
    );
    const monitoring = hook.result.current.setLocalMonitoring(true);
    await act(() => hook.result.current.leaveRoom());
    releaseMonitor(monitorStream);
    await act(async () => {
      expect(await monitoring).toBe(false);
    });
    expect(monitorTrack.stop).toHaveBeenCalled();
  });

  test("reports voice playback failures and isolates rejected audio graph promises", async () => {
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(new Error("autoplay blocked"));
    const contexts = [];
    globalThis.AudioContext = class {
      constructor() {
        this.destination = {};
        this.state = "suspended";
        this.source = { connect: vi.fn() };
        this.master = { gain: { value: 1 }, connect: vi.fn() };
        this.resume = vi.fn().mockRejectedValue(new Error("resume"));
        this.close = vi.fn().mockRejectedValue(new Error("close"));
        contexts.push(this);
      }
      createMediaStreamSource = () => this.source;
      createGain = () => (this.master.connect.mock.calls.length ? { gain: { value: 0 }, connect: vi.fn() } : this.master);
      createDelay = () => ({ delayTime: { value: 0 }, connect: vi.fn() });
      createConvolver = () => ({ buffer: null, connect: vi.fn() });
      createBuffer = () => ({ numberOfChannels: 2, getChannelData: () => new Float32Array(10) });
    };
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    await act(async () => mocks.voices[0].onRemoteStream("guest", stream()));
    await waitFor(() => expect(hook.result.current.voiceError).toBe("Нажмите в любом месте приложения, чтобы разрешить звук комнаты."));
    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    expect(document.querySelector("audio").muted).toBe(false);
    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    expect(contexts[0].close).toHaveBeenCalled();
    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    act(() => mocks.voices[0].onPeerClosed("guest"));
    await act(async () => Promise.resolve());

    mocks.openKaraokeInRoom.mockImplementationOnce((options) => options.isCurrentConnection());
    expect(hook.result.current.openKaraoke("song")).toBe(true);
    const karaokeOptions = mocks.openKaraokeInRoom.mock.calls.at(-1)[0];
    await act(() => hook.result.current.leaveRoom());
    expect(karaokeOptions.isCurrentConnection()).toBe(false);
  });

  test("keeps a room connected when initial microphone startup fails", async () => {
    mocks.start.mockRejectedValueOnce(new Error("no microphone"));
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    await waitFor(() => expect(hook.result.current.voiceError).toBe("Комната подключена без голоса: no microphone"));
    expect(hook.result.current.room.id).toBe("room-id");
  });

  test("uses the microphone fallback for a message-less startup error", async () => {
    mocks.start.mockRejectedValueOnce(null);
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    await waitFor(() => expect(hook.result.current.voiceError).toBe("Комната подключена без голоса: нет доступа к микрофону"));
    expect(hook.result.current.room.id).toBe("room-id");
  });

  test("applies a mute selected while microphone startup is pending", async () => {
    let releaseVoice;
    mocks.start.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseVoice = resolve;
      })
    );
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    act(() => hook.result.current.setMicrophoneMuted(true, false));
    const liveStream = stream();
    releaseVoice(liveStream);
    await act(async () => Promise.resolve());
    expect(mocks.startSpeakingMeter).toHaveBeenCalledWith("local", liveStream);
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenLastCalledWith(true);
    expect(mocks.clients[0].send).toHaveBeenLastCalledWith("presence", { micMuted: true });
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
    await act(async () => {
      rejectRetry(new Error("stale microphone"));
      await expect(retry).resolves.toBe(false);
    });
    expect(hook.result.current.voiceError).toBe("");

    act(() => voice.onTransferProgress({ stage: "sending", percent: 10 }));
    expect(hook.result.current.transferStatus).toBeNull();
    mocks.stopSpeakingMeter.mockClear();
    act(() => voice.onPeerClosed("stale"));
    expect(mocks.stopSpeakingMeter).not.toHaveBeenCalled();

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

  test("ignores stale transfer progress from an older song command", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Host"));
    const voice = mocks.voices[0];
    const options = mocks.createOnlineRoomMessageHandler.mock.calls.at(-1)[0];
    options.hostSongCommandRef.current = { commandId: "cmd-b", songId: "B" };
    act(() =>
      voice.onTransferProgress({
        participantId: "guest",
        stage: "sending",
        percent: 30,
        metadata: { commandId: "cmd-b" }
      })
    );
    expect(hook.result.current.transferStatus).toEqual({ stage: "sending", percent: 30 });
    act(() =>
      voice.onTransferProgress({
        participantId: "guest",
        stage: "error",
        percent: 0,
        metadata: { commandId: "cmd-a" }
      })
    );
    expect(hook.result.current.transferStatus).toEqual({ stage: "sending", percent: 30 });
    options.hostSongCommandRef.current = null;
    act(() =>
      voice.onTransferProgress({
        participantId: "guest",
        stage: "error",
        percent: 0,
        metadata: { commandId: "cmd-b" }
      })
    );
    expect(hook.result.current.transferStatus).toEqual({ stage: "sending", percent: 30 });
  });

  test("keeps another participant transfer visible when one transfer completes", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Host"));
    const voice = mocks.voices[0];
    act(() => voice.onTransferProgress({ participantId: "guest-1", stage: "sending", percent: 20 }));
    act(() => voice.onTransferProgress({ participantId: "guest-2", stage: "sending", percent: 60 }));
    expect(hook.result.current.transferStatus).toEqual({ stage: "sending", percent: 60 });
    act(() => voice.onTransferProgress({ participantId: "guest-1", stage: "complete", percent: 100 }));
    expect(hook.result.current.transferStatus).toEqual({ stage: "sending", percent: 60 });
  });

  test("publishes an imported pending song and ignores a stale import result", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("room", "Guest"));
    const voice = mocks.voices[0];
    const contextOptions = mocks.createOnlineRoomMessageHandler.mock.calls.at(-1)[0];
    act(() => {
      contextOptions.setRoom({ id: "room-id", selfId: "guest", host: false, role: "guest" });
      contextOptions.setParticipants([
        { id: "host", name: "Host", role: "host" },
        { id: "guest", name: "Guest", role: "guest" }
      ]);
    });
    await hook.result.current.openKaraoke("missing-song");
    const actionOptions = mocks.createOnlineRoomMessageHandler.mock.calls.at(-1)[0];
    const revision = "sha256:" + "a".repeat(64);
    actionOptions.pendingSongCommandRef.current = {
      type: "open-karaoke",
      songId: "song",
      commandId: "cmd-song",
      revision,
      __originatedHere: false
    };
    const sentBeforeRemoteImport = mocks.clients[0].send.mock.calls.length;
    await act(() =>
      voice.onFile("host", new Blob(), {
        kind: "song-package",
        songId: "song",
        commandId: "cmd-song",
        revision,
        filename: "song.zip"
      })
    );
    expect(mocks.clients[0].send).toHaveBeenCalledTimes(sentBeforeRemoteImport + 1);
    expect(mocks.clients[0].send).toHaveBeenLastCalledWith("sync", {
      state: {
        type: "song-ready",
        commandId: "cmd-song",
        songId: "song",
        revision,
        requesterId: "guest"
      }
    });
    expect(hook.result.current.roomCommand).toBeNull();
    actionOptions.pendingSongCommandRef.current = {
      type: "open-karaoke",
      songId: "remote-song",
      commandId: "cmd-remote",
      revision,
      __originatedHere: false
    };
    await act(() =>
      voice.onFile("host", new Blob(), {
        kind: "song-package",
        songId: "remote-song",
        commandId: "cmd-remote",
        revision
      })
    );
    expect(mocks.clients[0].send).toHaveBeenCalledTimes(sentBeforeRemoteImport + 2);
    expect(mocks.clients[0].send).toHaveBeenLastCalledWith("sync", {
      state: {
        type: "song-ready",
        commandId: "cmd-remote",
        songId: "remote-song",
        revision,
        requesterId: "guest"
      }
    });
    expect(hook.result.current.roomCommand).toBeNull();

    let releaseImport;
    mocks.importSongPackage.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseImport = resolve;
      })
    );
    actionOptions.pendingSongCommandRef.current = {
      type: "open-karaoke",
      songId: "late",
      commandId: "cmd-late",
      revision,
      __originatedHere: false
    };
    const staleImport = voice.onFile("host", new Blob(), {
      kind: "song-package",
      songId: "late",
      commandId: "cmd-late",
      revision
    });
    await act(async () => Promise.resolve());
    expect(hook.result.current.transferStatus).toEqual({
      songId: "late",
      stage: "importing",
      percent: 100
    });
    await act(() => hook.result.current.leaveRoom());
    const postLeaveCommand = {
      type: "open-karaoke",
      songId: "late",
      commandId: "cmd-post",
      revision,
      __originatedHere: false
    };
    actionOptions.pendingSongCommandRef.current = postLeaveCommand;
    releaseImport({ id: "late" });
    await act(async () => staleImport);
    expect(hook.result.current.room).toBeNull();
    expect(hook.result.current.roomCommand).toBeNull();
    expect(actionOptions.pendingSongCommandRef.current).toBe(postLeaveCommand);
  });

  test("does not let a stale same-room import override a newer song command", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("room", "Guest"));
    const voice = mocks.voices[0];
    const options = mocks.createOnlineRoomMessageHandler.mock.calls.at(-1)[0];
    act(() => {
      options.setRoom({ id: "room-id", selfId: "guest", host: false, role: "guest" });
      options.setParticipants([{ id: "host", role: "host" }]);
    });
    const revision = "sha256:" + "a".repeat(64);
    let resolveImport;
    mocks.importSongPackage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveImport = resolve;
      })
    );
    const commandA = {
      type: "open-karaoke",
      songId: "A",
      commandId: "cmd-A",
      revision,
      __originatedHere: false
    };
    const commandB = {
      type: "open-karaoke",
      songId: "B",
      commandId: "cmd-B",
      revision,
      __originatedHere: false
    };
    options.pendingSongCommandRef.current = commandA;
    const importingA = voice.onFile("host", new Blob(["A"]), {
      kind: "song-package",
      songId: "A",
      commandId: "cmd-A",
      revision,
      filename: "A.zip"
    });
    await act(async () => Promise.resolve());
    options.pendingSongCommandRef.current = commandB;
    resolveImport({ id: "A" });
    await act(async () => {
      await importingA;
    });
    expect(options.pendingSongCommandRef.current).toBe(commandB);
    expect(hook.result.current.roomCommand).toBeNull();
  });

  test("uses a guest fallback name and ignores stale import errors", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("room"));
    expect(hook.result.current.participants[0].name).toBe("Гость");
    const voice = mocks.voices[0];
    const options = mocks.createOnlineRoomMessageHandler.mock.calls.at(-1)[0];
    const revision = "sha256:" + "a".repeat(64);
    act(() => {
      options.setRoom({ id: "room-id", selfId: "guest", host: false, role: "guest" });
      options.setParticipants([{ id: "host", role: "host" }]);
      options.pendingSongCommandRef.current = {
        type: "open-karaoke",
        songId: "late",
        commandId: "cmd-late",
        revision,
        __originatedHere: false
      };
    });
    let rejectImport;
    mocks.importSongPackage.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectImport = reject;
      })
    );
    const staleImport = voice.onFile("host", new Blob(), {
      kind: "song-package",
      songId: "late",
      commandId: "cmd-late",
      revision
    });
    await act(() => hook.result.current.leaveRoom());
    rejectImport(new Error("obsolete import"));
    await act(async () => {
      await expect(staleImport).rejects.toThrow("obsolete import");
    });
    expect(hook.result.current.transferStatus).toBeNull();
  });

  test("imports only the expected song package from the room host", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("room", "Guest"));
    const voice = mocks.voices[0];
    const options = mocks.createOnlineRoomMessageHandler.mock.calls.at(-1)[0];
    act(() => {
      options.setRoom({ id: "room-id", selfId: "guest", host: false, role: "guest" });
      options.setParticipants([
        { id: "host", role: "host" },
        { id: "attacker", role: "guest" }
      ]);
    });
    const revision = "sha256:" + "a".repeat(64);
    options.pendingSongCommandRef.current = {
      type: "open-karaoke",
      songId: "expected",
      commandId: "cmd-expected",
      revision,
      __originatedHere: false
    };
    const expected = {
      kind: "song-package",
      songId: "expected",
      commandId: "cmd-expected",
      revision
    };
    expect(voice.canAcceptFile("attacker", expected)).toBe(false);
    expect(voice.canAcceptFile("host", { ...expected, songId: "wrong" })).toBe(false);
    expect(voice.canAcceptFile("host", { ...expected, commandId: "wrong" })).toBe(false);
    expect(voice.canAcceptFile("host", expected)).toBe(true);
    await expect(voice.onFile("attacker", new Blob(), expected)).rejects.toThrow();
    await expect(voice.onFile("host", new Blob(), { ...expected, songId: "wrong" })).rejects.toThrow();
    expect(mocks.importSongPackage).not.toHaveBeenCalled();
    await expect(voice.onFile("host", new Blob(), { ...expected, filename: "expected.zip" })).resolves.toBe(true);
    expect(mocks.importSongPackage).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), "expected.zip", { expectedRevision: revision });
  });

  test("syncs a library song directly between two participants without a host push", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("room", "Guest"));
    const voice = mocks.voices[0];
    const options = mocks.createOnlineRoomMessageHandler.mock.calls.at(-1)[0];
    act(() => {
      options.setRoom({ id: "room-id", selfId: "self", host: false, role: "guest" });
    });
    const channel = { send: vi.fn() };
    voice.waitForDataChannel.mockResolvedValue(channel);

    let syncResult;
    act(() => {
      syncResult = hook.result.current.requestSongSync("song-1", "peer");
    });
    await waitFor(() => expect(channel.send).toHaveBeenCalled());
    expect(voice.waitForDataChannel).toHaveBeenCalledWith("peer", 15_000, 0);
    const sent = JSON.parse(channel.send.mock.calls[0][0]);
    expect(sent.type).toBe("song-sync-request");
    expect(sent.songId).toBe("song-1");
    expect(typeof sent.commandId).toBe("string");
    await waitFor(() => expect(hook.result.current.transferStatus).toMatchObject({ stage: "waiting", percent: 0 }));

    // A second sync cannot start while one is already in flight.
    await expect(hook.result.current.requestSongSync("song-2", "peer")).resolves.toBe(false);
    const expectedFile = {
      kind: "library-song-package",
      commandId: sent.commandId,
      songId: "song-1"
    };
    expect(voice.canAcceptFile("peer", expectedFile)).toBe(true);
    expect(voice.canAcceptFile("attacker", expectedFile)).toBe(false);

    await act(async () => {
      await voice.onFile("peer", new Blob(["song"]), {
        kind: "library-song-package",
        songId: "song-1",
        commandId: sent.commandId,
        filename: "song-1.karaoke.zip"
      });
    });
    expect(await syncResult).toBe(true);
    expect(mocks.importSongPackage).toHaveBeenCalledWith(expect.any(Blob), "song-1.karaoke.zip", {
      expectedRevision: undefined
    });
    expect(hook.result.current.transferStatus).toBeNull();
  });

  test("serves an incoming library sync request from any participant, host or guest", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("room", "Host"));
    const voice = mocks.voices[0];
    const revision = "sha256:" + "b".repeat(64);
    mocks.getSongRevision.mockResolvedValueOnce({ revision });
    await act(async () => {
      await voice.onSongPullRequest("peer", { send: vi.fn() }, { commandId: "cmd-1", songId: "song-9" });
    });
    expect(mocks.exportSongPackage).toHaveBeenCalledWith("song-9", revision);
    expect(voice.sendFile).toHaveBeenCalledWith(
      "peer",
      expect.any(Blob),
      expect.objectContaining({
        kind: "library-song-package",
        songId: "song-9",
        commandId: "cmd-1",
        revision,
        filename: "song-9.karaoke.zip"
      })
    );
    expect(voice.sendSongSyncError).not.toHaveBeenCalled();

    // The sender sees the recipient's download percentage too -- this has no
    // host/pending-command to correlate against (unlike the karaoke push), so
    // it must not be dropped by that unrelated gate.
    act(() =>
      voice.onTransferProgress({
        participantId: "peer",
        stage: "sending",
        percent: 55,
        metadata: { kind: "library-song-package", commandId: "cmd-1" }
      })
    );
    expect(hook.result.current.transferStatus).toEqual({ stage: "sending", percent: 55 });
  });

  test("reports song-sync-error instead of hanging when the song cannot be exported", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("room", "Host"));
    const voice = mocks.voices[0];
    mocks.getSongRevision.mockRejectedValueOnce(new Error("missing"));
    await act(async () => {
      await voice.onSongPullRequest("peer", { send: vi.fn() }, { commandId: "cmd-2", songId: "song-9" });
    });
    expect(voice.sendFile).not.toHaveBeenCalled();
    expect(voice.sendSongSyncError).toHaveBeenCalledWith("peer", "cmd-2", expect.any(String));

    const hook2 = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook2.result.current.joinRoom("room2", "Guest"));
    const voice2 = mocks.voices[1];
    const channel = { send: vi.fn() };
    voice2.waitForDataChannel.mockResolvedValue(channel);
    let syncResult;
    act(() => {
      syncResult = hook2.result.current.requestSongSync("song-1", "peer");
    });
    await waitFor(() => expect(channel.send).toHaveBeenCalled());
    const sent = JSON.parse(channel.send.mock.calls[0][0]);
    act(() => voice2.onSongPullError("peer", { commandId: sent.commandId, error: "не в сети" }));
    expect(await syncResult).toBe(false);
    expect(hook2.result.current.transferStatus).toMatchObject({ stage: "error" });
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
    mocks.clients[0].disconnect.mockClear();
    mocks.voices[0].stop.mockClear();
    releaseFirst("old-room");
    await expect(first).rejects.toThrow("Подключение отменено новым запросом");
    expect(mocks.clients[0].disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.voices[0].stop).toHaveBeenCalledTimes(1);
    expect(hook.result.current.room.id).toBe("new-room");
    expect(mocks.clients[1].disconnect).not.toHaveBeenCalled();
    expect(mocks.voices[1].stop).not.toHaveBeenCalled();
  });

  test("releases the room connection and remote media on unmount", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    await act(async () => mocks.voices[0].onRemoteStream("guest", stream()));
    const audio = document.querySelector("audio");

    hook.unmount();

    expect(mocks.clients[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.clients[0].disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.voices[0].stop).toHaveBeenCalledTimes(1);
    expect(mocks.stopAllSpeakingMeters).toHaveBeenCalledTimes(2);
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledWith("guest");
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.srcObject).toBeNull();
    expect(document.body.contains(audio)).toBe(false);
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
