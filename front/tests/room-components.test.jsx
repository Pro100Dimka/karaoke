/* @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roomValue: null,
  radioValue: null,
  copyText: vi.fn(),
  pending: false,
  run: vi.fn()
}));
vi.mock("../src/contexts/OnlineRoomContext", () => ({
  useOnlineRoom: () => mocks.roomValue
}));
vi.mock("../src/contexts/radio", () => ({
  useRadio: () => mocks.radioValue
}));
vi.mock("../src/utils/clipboard", () => ({ copyText: mocks.copyText }));
vi.mock("../src/hooks/useExclusiveAsyncAction", () => ({
  default: () => ({ pending: mocks.pending, run: mocks.run })
}));
vi.mock("../src/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: () => ({
    t: (key, values) =>
      values ? `${key}:${Object.values(values).join(",")}` : key
  })
}));

import { OnlineRoomDock } from "../src/components/OnlineRoomDock.jsx";
import { OnlineRoomModal } from "../src/components/OnlineRoomModal.jsx";
import OnlineRoomParticipant from "../src/components/OnlineRoomParticipant.jsx";
import RoomRadioSync from "../src/components/RoomRadioSync.jsx";

const roomValue = (overrides = {}) => ({
  room: { id: "ABCD", selfId: "self", host: true },
  roomUi: {},
  participants: [
    { id: "self", name: "Alice", role: "host", micMuted: false },
    { id: "guest", name: "Bob", role: "guest", micMuted: false }
  ],
  localSpeakingLevel: 0.7,
  speakingLevels: { guest: 0.5 },
  microphoneMuted: false,
  roomSoundMuted: false,
  mutedPeople: new Set(),
  effectPeople: new Set(),
  voiceError: "",
  transferStatus: null,
  createRoom: vi.fn().mockResolvedValue("ABCD"),
  joinRoom: vi.fn().mockResolvedValue("ABCD"),
  leaveRoom: vi.fn(),
  requestMicrophoneAccess: vi.fn().mockResolvedValue(true),
  setMicrophoneMuted: vi.fn(),
  setRoomSoundMuted: vi.fn(),
  togglePersonMuted: vi.fn(),
  togglePersonEffects: vi.fn(),
  syncUi: vi.fn(),
  ...overrides
});

beforeEach(() => {
  mocks.roomValue = roomValue();
  mocks.radioValue = {
    isPlaying: false,
    stationId: "one",
    stations: [{ id: "one" }, { id: "two" }],
    setStation: vi.fn(),
    turnOff: vi.fn(),
    turnOn: vi.fn().mockResolvedValue(true)
  };
  mocks.copyText.mockReset().mockResolvedValue(true);
  mocks.pending = false;
  mocks.run.mockReset().mockImplementation((action) => action());
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    callback();
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("online room participants", () => {
  test("renders self controls, voice level and leave action", () => {
    const props = {
      person: mocks.roomValue.participants[0],
      room: mocks.roomValue.room,
      localSpeakingLevel: 0.7,
      speakingLevel: 0,
      microphoneMuted: false,
      roomSoundMuted: false,
      isLocallyMuted: false,
      effectsEnabled: false,
      onLeave: vi.fn(),
      onSetMicrophoneMuted: vi.fn(),
      onSetRoomSoundMuted: vi.fn(),
      onTogglePersonMuted: vi.fn(),
      onTogglePersonEffects: vi.fn()
    };
    render(<OnlineRoomParticipant {...props} />);
    expect(
      document.querySelectorAll(".online-room-speaking-meter i.is-active")
    ).toHaveLength(3);
    fireEvent.click(screen.getByLabelText("room.microphone.disable"));
    fireEvent.click(screen.getByLabelText("room.sound.disable"));
    fireEvent.click(screen.getByLabelText("room.leave"));
    expect(props.onSetMicrophoneMuted).toHaveBeenCalledWith(true);
    expect(props.onSetRoomSoundMuted).toHaveBeenCalledWith(true);
    expect(props.onLeave).toHaveBeenCalledOnce();
  });

  test("renders remote mute and effects controls", () => {
    const toggleMuted = vi.fn();
    const toggleEffects = vi.fn();
    render(
      <OnlineRoomParticipant
        person={{ id: "guest", name: "Bob", role: "guest", micMuted: true }}
        room={{ selfId: "self" }}
        localSpeakingLevel={0}
        speakingLevel={0.9}
        microphoneMuted={false}
        roomSoundMuted={false}
        isLocallyMuted
        effectsEnabled
        onTogglePersonMuted={toggleMuted}
        onTogglePersonEffects={toggleEffects}
      />
    );
    fireEvent.click(screen.getByLabelText(/room.person.effects.disable/));
    fireEvent.click(screen.getByLabelText(/room.person.enable/));
    expect(toggleEffects).toHaveBeenCalledWith("guest");
    expect(toggleMuted).toHaveBeenCalledWith("guest");
    expect(document.querySelector(".is-speaking")).toBeNull();
  });
});

describe("online room dock", () => {
  test("hides without a room", () => {
    mocks.roomValue = roomValue({ room: null });
    const { container } = render(<OnlineRoomDock />);
    expect(container.textContent).toBe("");
  });

  test("copies code, collapses and restores the panel", async () => {
    render(<OnlineRoomDock />);
    fireEvent.click(screen.getByLabelText("room.copyCode"));
    await act(async () => Promise.resolve());
    expect(mocks.copyText).toHaveBeenCalledWith("ABCD");
    fireEvent.click(screen.getByLabelText("room.hidePanel"));
    expect(document.querySelector("aside").className).toContain("is-collapsed");
    fireEvent.click(screen.getByLabelText("room.showPanel"));
    expect(document.querySelector("aside").className).not.toContain(
      "is-collapsed"
    );
  });

  test("shows microphone recovery and transfer states", async () => {
    mocks.roomValue = roomValue({
      voiceError: "Permission denied",
      transferStatus: { stage: "sending", percent: 42 }
    });
    const view = render(<OnlineRoomDock />);
    fireEvent.click(screen.getByText("room.allowMicrophone"));
    await act(async () => Promise.resolve());
    expect(mocks.roomValue.requestMicrophoneAccess).toHaveBeenCalled();
    expect(screen.getByRole("progressbar").value).toBe(42);
    mocks.roomValue = roomValue({
      transferStatus: { stage: "error", error: "Network" }
    });
    view.rerender(<OnlineRoomDock />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/Network/)).not.toBeNull();
  });
});

describe("online room modal", () => {
  test("creates a room and closes on success", async () => {
    const close = vi.fn();
    render(<OnlineRoomModal onlineName="Alice" onClose={close} />);
    fireEvent.click(screen.getByText("room.create"));
    await act(async () => Promise.resolve());
    expect(mocks.roomValue.createRoom).toHaveBeenCalledWith("Alice");
    expect(close).toHaveBeenCalled();
  });

  test("validates, normalizes and joins by code or Enter", async () => {
    const close = vi.fn();
    render(<OnlineRoomModal onlineName="Bob" onClose={close} />);
    fireEvent.click(screen.getByText("room.joinByCode"));
    const input = screen.getByLabelText("room.code");
    fireEvent.change(input, { target: { value: " ab-cd " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => Promise.resolve());
    expect(mocks.roomValue.joinRoom).toHaveBeenCalledWith("AB-CD", "Bob");
    fireEvent.click(screen.getByText("room.back"));
  });

  test("shows connection failures", async () => {
    mocks.roomValue.createRoom.mockRejectedValue(new Error("socket refused"));
    render(<OnlineRoomModal onlineName="Alice" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("room.create"));
    await act(async () => Promise.resolve());
    expect(screen.getByText("socket refused")).not.toBeNull();
  });
});

describe("room radio synchronization", () => {
  test("broadcasts local radio state", () => {
    render(<RoomRadioSync />);
    expect(mocks.roomValue.syncUi).toHaveBeenCalledWith({
      radio: { isPlaying: false, stationId: "one" }
    });
  });

  test("applies remote station playback and stop", async () => {
    mocks.roomValue.roomUi = {
      __eventId: 1,
      radio: { stationId: "two", isPlaying: true }
    };
    const view = render(<RoomRadioSync />);
    expect(mocks.radioValue.setStation).toHaveBeenCalledWith("two");
    expect(mocks.radioValue.turnOn).toHaveBeenCalledWith(
      expect.objectContaining({ remember: false, fadeIn: true })
    );
    await act(async () => Promise.resolve());

    mocks.radioValue = {
      ...mocks.radioValue,
      stationId: "two",
      isPlaying: true
    };
    mocks.roomValue = roomValue({
      roomUi: { __eventId: 2, radio: { stationId: "two", isPlaying: false } }
    });
    view.rerender(<RoomRadioSync />);
    expect(mocks.radioValue.turnOff).toHaveBeenCalledWith({ remember: false });
  });
});
