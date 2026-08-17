/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roomValue: null,
  radioValue: null,
  copyText: vi.fn(),
  pending: false,
  run: vi.fn()
}));
vi.mock("../src/contexts/OnlineRoomContext", () => ({ useOnlineRoom: () => mocks.roomValue }));
vi.mock("../src/contexts/radio", () => ({ useRadio: () => mocks.radioValue }));
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
    volume: 0.1,
    setStation: vi.fn(),
    setVolume: vi.fn(),
    turnOff: vi.fn(),
    turnOn: vi.fn().mockResolvedValue(true)
  };
  mocks.copyText.mockReset().mockResolvedValue(true);
  mocks.pending = false;
  mocks.run.mockReset().mockImplementation((action) => action());
  vi.stubGlobal("requestAnimationFrame", (callback) => { callback(); return 1; });
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
    const view = render(<OnlineRoomParticipant {...props} />);
    expect( document.querySelectorAll(".online-room-speaking-meter i.is-active")
    ).toHaveLength(3);
    fireEvent.click(screen.getByLabelText("room.microphone.disable"));
    fireEvent.click(screen.getByLabelText("room.sound.disable"));
    fireEvent.click(screen.getByLabelText("room.leave"));
    expect(props.onSetMicrophoneMuted).toHaveBeenCalledWith(true);
    expect(props.onSetRoomSoundMuted).toHaveBeenCalledWith(true);
    expect(props.onLeave).toHaveBeenCalledOnce();
    view.rerender( <OnlineRoomParticipant {...props} microphoneMuted roomSoundMuted />
    );
    expect(screen.getByLabelText("room.microphone.enable")).not.toBeNull();
    expect(screen.getByLabelText("room.sound.enable")).not.toBeNull();
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
    vi.useFakeTimers();
    render(<OnlineRoomDock />);
    fireEvent.click(screen.getByLabelText("room.copyCode"));
    await act(async () => Promise.resolve());
    expect(mocks.copyText).toHaveBeenCalledWith("ABCD");
    fireEvent.click(screen.getByLabelText("room.hidePanel"));
    expect(document.querySelector(".online-room-dock").className).toContain( "is-collapsed"
    );
    fireEvent.click(screen.getByLabelText("room.showPanel"));
    expect(document.querySelector(".online-room-dock").className).not.toContain( "is-collapsed"
    );
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.getByLabelText("room.copyCode").textContent).not.toContain( "room.copied"
    );
    vi.useRealTimers();
  });

  test("ignores failed copy and clears a pending copy timer on unmount", async () => {
    mocks.copyText.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const view = render(<OnlineRoomDock />);
    fireEvent.click(screen.getByLabelText("room.copyCode"));
    await act(async () => Promise.resolve());
    expect(screen.getByLabelText("room.copyCode").textContent).not.toContain( "room.copied"
    );
    fireEvent.click(screen.getByLabelText("room.copyCode"));
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByLabelText("room.copyCode"));
    await act(async () => Promise.resolve());
    const clear = vi.spyOn(globalThis, "clearTimeout");
    view.unmount();
    expect(clear).toHaveBeenCalled();
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
    mocks.roomValue = roomValue({ transferStatus: { stage: "error", error: "Network" } });
    view.rerender(<OnlineRoomDock />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/Network/)).not.toBeNull();
    mocks.pending = true;
    mocks.roomValue = roomValue({
      room: { id: "ABCD", selfId: "self", host: false },
      voiceError: "Permission denied",
      transferStatus: { stage: "error", error: "" }
    });
    view.rerender(<OnlineRoomDock />);
    expect(screen.getByText("room.requestingMicrophone")).not.toBeNull();
    expect(screen.getByText(/room.transfer.unknownError/)).not.toBeNull();
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

  test("shows join failures and ignores connection completion after unmount", async () => {
    mocks.roomValue.joinRoom.mockRejectedValueOnce(new Error("join refused"));
    const failed = render( <OnlineRoomModal onlineName="Alice" onClose={vi.fn()} />
    );
    fireEvent.click(screen.getByText("room.joinByCode"));
    const input = screen.getByLabelText("room.code");
    fireEvent.change(input, { target: { value: "ABCD" } });
    fireEvent.click(screen.getByText("room.join"));
    await act(async () => Promise.resolve());
    expect(screen.getByText("join refused")).not.toBeNull();
    failed.unmount();

    let resolveCreate;
    mocks.roomValue.createRoom.mockReturnValueOnce(
      new Promise((resolve) => { resolveCreate = resolve; })
    );
    const staleSuccess = render( <OnlineRoomModal onlineName="Alice" onClose={vi.fn()} />
    );
    fireEvent.click(screen.getByText("room.create"));
    staleSuccess.unmount();
    await act(async () => resolveCreate());

    let rejectCreate;
    mocks.roomValue.createRoom.mockReturnValueOnce(
      new Promise((_resolve, reject) => { rejectCreate = reject; })
    );
    const staleFailure = render( <OnlineRoomModal onlineName="Alice" onClose={vi.fn()} />
    );
    fireEvent.click(screen.getByText("room.create"));
    staleFailure.unmount();
    await act(async () => rejectCreate(new Error("late")));
  });

  test("blocks short codes and repeated pending connections", async () => {
    let release;
    mocks.roomValue.createRoom.mockReturnValueOnce( new Promise((resolve) => { release = resolve; })
    );
    const close = vi.fn();
    render(<OnlineRoomModal onlineName="Alice" onClose={close} />);
    fireEvent.click(screen.getByText("room.joinByCode"));
    const join = screen.getByText("room.join");
    expect(join.disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("room.code"), { key: "Enter" });
    expect(mocks.roomValue.joinRoom).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("room.back"));
    const create = screen.getByText("room.create");
    fireEvent.click(create);
    fireEvent.click(create);
    expect(mocks.roomValue.createRoom).toHaveBeenCalledTimes(1);
    release();
    await act(async () => Promise.resolve());
  });
});

describe("room radio synchronization", () => {
  test("broadcasts local radio state", () => {
    render(<RoomRadioSync />);
    expect(mocks.roomValue.syncUi).toHaveBeenCalledWith({
      radio: { isPlaying: false, stationId: "one", volume: 0.1 }
    });
  });

  test("does not overwrite an already-present remote state on mount", () => {
    mocks.roomValue.roomUi = { __eventId: 10, radio: { stationId: "two", isPlaying: true } };
    render(<RoomRadioSync />);
    expect(mocks.roomValue.syncUi).not.toHaveBeenCalled();
    expect(mocks.radioValue.setStation).toHaveBeenCalledWith("two");
    expect(mocks.radioValue.turnOn).toHaveBeenCalled();
  });

  test("applies remote station playback and stop", async () => {
    mocks.roomValue.roomUi = { __eventId: 1, radio: { stationId: "two", isPlaying: true } };
    const view = render(<RoomRadioSync />);
    expect(mocks.radioValue.setStation).toHaveBeenCalledWith("two");
    expect(mocks.radioValue.turnOn).toHaveBeenCalledWith(
      expect.objectContaining({ remember: false, fadeIn: true })
    );
    await act(async () => Promise.resolve());

    mocks.radioValue = { ...mocks.radioValue, stationId: "two", isPlaying: true };
    mocks.roomValue = roomValue({
      roomUi: { __eventId: 2, radio: { stationId: "two", isPlaying: false } }
    });
    view.rerender(<RoomRadioSync />);
    expect(mocks.radioValue.turnOff).toHaveBeenCalledWith({ remember: false });
  });

  test("ignores missing rooms and already-applied remote radio state", () => {
    mocks.roomValue = roomValue({ room: null });
    const view = render(<RoomRadioSync />);
    expect(mocks.roomValue.syncUi).not.toHaveBeenCalled();
    mocks.roomValue = roomValue({ roomUi: { radio: { stationId: "one", isPlaying: false } } });
    view.rerender(<RoomRadioSync />);
    expect(mocks.radioValue.turnOn).not.toHaveBeenCalled();
    expect(mocks.radioValue.turnOff).not.toHaveBeenCalled();
  });

  test("uses station fallbacks without changing stopped playback", async () => {
    mocks.roomValue.roomUi = { __eventId: 3, radio: { stationId: "missing", isPlaying: true } };
    const view = render(<RoomRadioSync />);
    expect(mocks.radioValue.turnOn).toHaveBeenCalledWith(
      expect.objectContaining({ targetStation: mocks.radioValue.stations[0] })
    );
    await act(async () => Promise.resolve());

    mocks.radioValue = { ...mocks.radioValue, isPlaying: false };
    mocks.roomValue = roomValue({
      roomUi: { __eventId: 4, radio: { stationId: "two", isPlaying: false } }
    });
    view.rerender(<RoomRadioSync />);
    expect(mocks.radioValue.setStation).toHaveBeenCalledWith("two");

    mocks.roomValue = roomValue({ roomUi: { __eventId: 5, radio: { isPlaying: true } } });
    view.rerender(<RoomRadioSync />);
    expect(mocks.radioValue.turnOn).toHaveBeenCalled();
  });
});
