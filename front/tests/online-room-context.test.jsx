/* @vitest-environment jsdom */
/* eslint-disable max-classes-per-file, lines-between-class-members */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import React from "react";
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
      this.unsubscribe = vi.fn();
      this.onMessage = vi.fn(() => this.unsubscribe);
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

let OnlineRoomProvider;
let useOnlineRoom;

const wrapper = ({ children }) => (
  <OnlineRoomProvider>{children}</OnlineRoomProvider>
);
const stream = () => ({
  getTracks: () => [{ stop: vi.fn() }]
});

beforeEach(async () => {
  vi.resetModules();
  ({ OnlineRoomProvider, useOnlineRoom } =
    await import("../src/contexts/OnlineRoomContext"));
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
      transferStatus: null,
      localSpeakingLevel: 0.4,
      speakingLevels: { guest: 0.2 }
    });
    expect(
      Object.values(result.current).filter(
        (value) => typeof value === "function"
      )
    ).toHaveLength(11);
    expect(() => result.current.setMicrophoneMuted(true)).not.toThrow();
    expect(() => result.current.syncUi({ radio: true })).not.toThrow();
    expect(() => result.current.syncCommand({ type: "pause" })).not.toThrow();
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
      selfId: "pending-room-id",
      host: true,
      role: "host"
    });
    expect(result.current.participants).toEqual([
      {
        id: "pending-room-id",
        name: "Alice",
        role: "host",
        pending: true
      }
    ]);
    expect(mocks.startSpeakingMeter).toHaveBeenCalledWith(
      "local",
      expect.any(Object)
    );
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenCalledWith(false);
    expect(mocks.clients[0].send).toHaveBeenCalledWith("presence", {
      micMuted: false
    });
    expect(mocks.clients[0].onMessage).toHaveBeenCalledWith(
      mocks.messageHandler
    );
    expect(mocks.createOnlineRoomMessageHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "created-room",
        client: mocks.clients[0],
        voice: mocks.voices[0]
      })
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
      expect.objectContaining({
        songId: "song-1",
        room: result.current.room,
        client: mocks.clients[0]
      })
    );
    expect(
      mocks.openKaraokeInRoom.mock.calls.at(-1)[0].isCurrentConnection()
    ).toBe(true);
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
    expect(mocks.clients[0].send).not.toHaveBeenLastCalledWith("presence", {
      micMuted: false
    });

    const muteCalls = mocks.voices[0].setMicrophoneMuted.mock.calls.length;
    const restoreCalls = mocks.restoreApplicationAudio.mock.calls.length;
    act(() => hook.result.current.setRoomSoundMuted(false));
    expect(mocks.restoreApplicationAudio).toHaveBeenCalledTimes(restoreCalls);
    act(() => hook.result.current.setRoomSoundMuted(true));
    expect(mocks.muteApplicationAudio).toHaveBeenCalledWith(document);
    expect(hook.result.current.roomSoundMuted).toBe(true);
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenCalledTimes(muteCalls);
    act(() => hook.result.current.setRoomSoundMuted(true));
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenCalledTimes(muteCalls);
    act(() => hook.result.current.setRoomSoundMuted(false));
    expect(mocks.restoreApplicationAudio).toHaveBeenCalledTimes(
      restoreCalls + 1
    );
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
    expect(hook.result.current.voiceError).toBe(
      "Спочатку підключіться до кімнати."
    );

    await act(() => hook.result.current.createRoom("Alice"));
    const unmutedStream = stream();
    mocks.start.mockResolvedValueOnce(unmutedStream);
    await act(() => hook.result.current.requestMicrophoneAccess());
    expect(mocks.startSpeakingMeter).toHaveBeenLastCalledWith(
      "local",
      unmutedStream
    );
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenLastCalledWith(false);
    expect(mocks.clients[0].send).toHaveBeenLastCalledWith("presence", {
      micMuted: false
    });
    act(() =>
      mocks.voices[0].onTransferProgress({ stage: "sending", percent: 1 })
    );
    act(() => hook.result.current.setMicrophoneMuted(true));
    mocks.start.mockResolvedValueOnce(stream());
    await act(async () => {
      expect(await hook.result.current.requestMicrophoneAccess()).toBe(true);
    });
    expect(hook.result.current.voiceError).toBe("");
    expect(hook.result.current.transferStatus).toBeNull();
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenLastCalledWith(true);
    expect(mocks.clients[0].send).toHaveBeenLastCalledWith("presence", {
      micMuted: true
    });

    act(() => {
      hook.result.current.setRoomSoundMuted(true);
      hook.result.current.setMicrophoneMuted(false, false);
    });
    mocks.start.mockResolvedValueOnce(stream());
    await act(() => hook.result.current.requestMicrophoneAccess());
    expect(mocks.voices[0].setMicrophoneMuted).toHaveBeenLastCalledWith(false);
    expect(mocks.clients[0].send).toHaveBeenLastCalledWith("presence", {
      micMuted: false
    });

    mocks.start.mockRejectedValueOnce(new Error("permission denied"));
    await act(async () => {
      expect(await hook.result.current.requestMicrophoneAccess()).toBe(false);
    });
    expect(hook.result.current.voiceError).toBe(
      "Не вдалося отримати доступ до мікрофону: permission denied. " +
        "Перевірте роздільну здатність Windows і повторіть спробу."
    );

    mocks.start.mockRejectedValueOnce(null);
    await act(() => hook.result.current.requestMicrophoneAccess());
    expect(hook.result.current.voiceError).toBe(
      "Не вдалося отримати доступ до мікрофону: немає доступу до мікрофону. " +
        "Перевірте роздільну здатність Windows і повторіть спробу."
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
      room: {
        id: "replacement",
        selfId: "pending-replacement",
        host: false,
        role: "guest"
      },
      participants: [
        {
          id: "pending-replacement",
          name: "Bob",
          role: "guest",
          pending: true
        }
      ],
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
    expect(mocks.clients[1].send).toHaveBeenCalledWith("presence", {
      micMuted: false
    });
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
    expect(audio.autoplay).toBe(true);
    expect(audio.playsInline).toBe(true);
    expect(audio.style.display).toBe("none");
    expect(mocks.startSpeakingMeter).toHaveBeenCalledWith(
      "guest",
      remoteStream
    );
    expect(audio.muted).toBe(false);
    act(() => hook.result.current.togglePersonMuted("guest"));
    await act(async () => Promise.resolve());
    expect(audio.muted).toBe(true);
    act(() => hook.result.current.togglePersonMuted("guest"));
    await act(async () => Promise.resolve());
    expect(audio.muted).toBe(false);

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
    expect(hook.result.current.transferStatus).toBeNull();
    expect(hook.result.current.roomCommand).toBeNull();
    await act(() => voice.onFile("host", new Blob(), { kind: "other" }));

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
    await expect(
      voice.onFile("host", new Blob(), undefined)
    ).resolves.toBeUndefined();
    await expect(voice.onFile("host", new Blob(), {})).resolves.toBeUndefined();
    await expect(
      voice.onFile("host", new Blob(), { kind: "other", songId: "song" })
    ).resolves.toBeUndefined();
    await expect(
      voice.onFile("host", new Blob(), { kind: "song-package" })
    ).resolves.toBeUndefined();
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
        const node = {
          maximum,
          delayTime: { value: 0 },
          connect: vi.fn()
        };
        this.delays.push(node);
        return node;
      };
      createConvolver = () => {
        const node = { buffer: null, connect: vi.fn() };
        this.convolvers.push(node);
        return node;
      };
      createBuffer = (channels, frames, sampleRate) => {
        const data = Array.from(
          { length: channels },
          () => new Float32Array(frames)
        );
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
    expect(context.buffers[0]).toMatchObject({
      channels: 2,
      frames: 104,
      sampleRate: 100
    });
    expect(context.buffers[0].data[0][0]).toBeCloseTo(0.5);
    expect(context.buffers[0].data[0][52]).toBeCloseTo(0.5 * 0.5 ** 2.7);
    expect(context.buffers[0].data[1][103]).toBeCloseTo(
      0.5 * (1 - 103 / 104) ** 2.7
    );
    expect(context.convolvers[0].buffer).toBe(context.buffers[0]);
    expect(context.source.connect).toHaveBeenCalledWith(context.gains[0]);
    expect(context.source.connect).toHaveBeenCalledWith(context.delays[0]);
    expect(context.source.connect).toHaveBeenCalledWith(context.convolvers[0]);
    expect(context.delays[0].connect).toHaveBeenCalledWith(context.gains[1]);
    expect(context.delays[0].connect).toHaveBeenCalledWith(context.gains[2]);
    expect(context.gains[1].connect).toHaveBeenCalledWith(context.delays[0]);
    expect(context.convolvers[0].connect).toHaveBeenCalledWith(
      context.gains[3]
    );
    expect(context.gains[0].connect).toHaveBeenCalledWith(context.destination);
    expect(context.gains[0].gain.value).toBe(1);
    const audio = document.querySelector("audio");
    expect(audio.muted).toBe(true);
    act(() => hook.result.current.setRoomSoundMuted(true));
    expect(context.gains[0].gain.value).toBe(0);
    act(() => hook.result.current.setRoomSoundMuted(false));

    act(() =>
      providerControls.setRoomUi({
        effectsByParticipant: {
          guest: { echo: 2, delay: -1, reverb: "invalid" }
        }
      })
    );
    expect(contexts).toHaveLength(2);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(contexts[1].delays[0].delayTime.value).toBeCloseTo(0.06);
    expect(contexts[1].gains[1].gain.value).toBeCloseTo(0.55);
    expect(contexts[1].gains[2].gain.value).toBeCloseTo(0.46);
    expect(contexts[1].convolvers).toHaveLength(0);

    act(() => hook.result.current.togglePersonEffects("guest"));
    await act(async () => Promise.resolve());
    expect(contexts[1].close).toHaveBeenCalledTimes(1);
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
    await expect(hook.result.current.joinRoom("room", "Bob")).rejects.toThrow(
      "socket failed"
    );
    expect(mocks.clients[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.clients[0].disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.voices[0].stop).toHaveBeenCalledTimes(1);
    expect(mocks.stopAllSpeakingMeters).toHaveBeenCalledTimes(2);

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
    expect(hook.result.current.transferStatus).toEqual({
      stage: "error",
      error: "Неможливо імпортувати пісню: bad package",
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
    await act(async () => {
      expect(await requesting).toBe(false);
    });
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
    await waitFor(() =>
      expect(hook.result.current.voiceError).toBe(
        "Натисніть у будь-якому місці програми, щоб дозволити звук кімнати."
      )
    );
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
    const karaokeOptions = mocks.openKaraokeInRoom.mock.calls.at(-1)[0];
    await act(() => hook.result.current.leaveRoom());
    expect(karaokeOptions.isCurrentConnection()).toBe(false);
  });

  test("keeps a room connected when initial microphone startup fails", async () => {
    mocks.start.mockRejectedValueOnce(new Error("no microphone"));
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    await waitFor(() =>
      expect(hook.result.current.voiceError).toBe(
        "Кімната підключена без голосу: no microphone"
      )
    );
    expect(hook.result.current.room.id).toBe("room-id");
  });

  test("uses the microphone fallback for a message-less startup error", async () => {
    mocks.start.mockRejectedValueOnce(null);
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.createRoom("Alice"));
    await waitFor(() =>
      expect(hook.result.current.voiceError).toBe(
        "Кімната підключена без голосу: немає доступу до мікрофону"
      )
    );
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
    expect(mocks.clients[0].send).toHaveBeenLastCalledWith("presence", {
      micMuted: true
    });
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

  test("publishes an imported pending song and ignores a stale import result", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    vi.spyOn(Math, "random").mockReturnValue(0.25);
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
    expect(hook.result.current.roomCommand).toEqual({
      type: "open-karaoke",
      songId: "song",
      __originatedHere: true,
      __eventId: "import-1234-0.25"
    });

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
    actionOptions.pendingSongCommandRef.current = {
      type: "open-karaoke",
      songId: "late",
      __originatedHere: false
    };
    const staleImport = voice.onFile("host", new Blob(), {
      kind: "song-package",
      songId: "late"
    });
    await act(async () => Promise.resolve());
    expect(hook.result.current.transferStatus).toEqual({
      stage: "importing",
      percent: 100
    });
    await act(() => hook.result.current.leaveRoom());
    const postLeaveCommand = {
      type: "open-karaoke",
      songId: "late",
      __originatedHere: false
    };
    actionOptions.pendingSongCommandRef.current = postLeaveCommand;
    releaseImport({ id: "late" });
    await act(async () => staleImport);
    expect(hook.result.current.room).toBeNull();
    expect(hook.result.current.roomCommand).toBeNull();
    expect(actionOptions.pendingSongCommandRef.current).toBe(postLeaveCommand);
  });

  test("uses a guest fallback name and ignores stale import errors", async () => {
    const hook = renderHook(() => useOnlineRoom(), { wrapper });
    await act(() => hook.result.current.joinRoom("room"));
    expect(hook.result.current.participants[0].name).toBe("Гість");
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
    await act(async () => {
      await expect(staleImport).rejects.toThrow("obsolete import");
    });
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
    mocks.clients[0].disconnect.mockClear();
    mocks.voices[0].stop.mockClear();
    releaseFirst("old-room");
    await expect(first).rejects.toThrow("З'єднання скасовано новим запитом");
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
