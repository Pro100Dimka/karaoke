/* @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../src/components/fields", () => ({
  RangeInput: ({ onChange, ...props }) => (
    <input {...props} type="range" onChange={(e) => onChange(e.target.value)} />
  )
}));
vi.mock("../src/theme/ui", () => ({
  Stack: ({ children, ...props }) => <div {...props}>{children}</div>,
  Grid: ({ children, ...props }) => <div {...props}>{children}</div>,
  Typography: ({ children, ...props }) => <span {...props}>{children}</span>,
  Card: ({ children, surface: _surface, tilt: _tilt, sx: _sx, ...props }) => (
    <div {...props}>{children}</div>
  ),
  Button: ({ children, sx: _sx, ...props }) => (
    <button {...props}>{children}</button>
  ),
  IconButton: ({ icon: Icon, sx: _sx, ...props }) => (
    <button {...props}>{Icon ? <Icon /> : null}</button>
  )
}));
vi.mock("../src/pages/Karaoke/components/waveform-timeline", () => ({
  default: ({ onChange }) => (
    <button data-testid="timeline" onClick={() => onChange(3)} />
  )
}));

import EffectDial from "../src/pages/Karaoke/components/console/effect-dial.jsx";
import ConsoleCenter from "../src/pages/Karaoke/components/console/center.jsx";
import MixerPanel from "../src/pages/Karaoke/components/console/mixer.jsx";
import SongStrip from "../src/pages/Karaoke/components/console/song-strip.jsx";
import ToolsPanel from "../src/pages/Karaoke/components/console/tools.jsx";

afterEach(cleanup);

test("effect dial supports range, wheel and pointer dragging with clamping", () => {
  const change = vi.fn();
  const { container, getByLabelText } = render(
    <EffectDial label="Echo" value={0.5} onChange={change} />
  );
  const dial = container.querySelector("label");
  fireEvent.wheel(dial, { deltaY: -1 });
  fireEvent.wheel(dial, { deltaY: 1 });
  fireEvent.pointerDown(dial, { button: 1, clientY: 100, pointerId: 1 });
  fireEvent.pointerDown(dial, { button: 0, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(dial, { clientY: 0, pointerId: 1 });
  fireEvent.pointerUp(dial, { pointerId: 1 });
  fireEvent.change(getByLabelText("Echo"), { target: { value: "0.3" } });
  expect(change.mock.calls.length).toBeGreaterThanOrEqual(4);
  expect(change.mock.calls[2][0]).toBe(1);
});

test("song strip formats metadata and delegates seeking", () => {
  const seek = vi.fn();
  const result = render(
    <SongStrip
      song={{ title: "Song", performer: "Singer" }}
      currentTime={65}
      duration={130}
      onSeek={seek}
    />
  );
  expect(result.container.textContent).toContain("Singer");
  expect(result.container.textContent).toContain("1:05");
  fireEvent.click(result.getByTestId("timeline"));
  expect(seek).toHaveBeenCalledWith(3);
});

test("mixer changes and commits volumes and effects", () => {
  const microphone = vi.fn();
  const commit = vi.fn();
  const effect = vi.fn();
  const { container } = render(
    <MixerPanel
      microphoneLevel={2}
      volumes={{ microphone: 0.4, music: 0.5, vocal: 0.6, melody: 0.7 }}
      onVolumeChange={{
        microphone,
        music: vi.fn(),
        vocal: vi.fn(),
        melody: vi.fn()
      }}
      onMicrophoneCommit={commit}
      microphoneEffects={{ echo: 0.1, reverb: 0.2, delay: 0.3 }}
      onEffectChange={effect}
    />
  );
  const slider = container.querySelector('input[type="range"]');
  fireEvent.change(slider, { target: { value: "0.8" } });
  fireEvent.pointerUp(slider, { currentTarget: { value: "0.8" } });
  fireEvent.keyUp(slider, { currentTarget: { value: "0.8" } });
  fireEvent.change(container.querySelector(".karaoke-effect-dial input"), {
    target: { value: "0.6" }
  });
  expect(microphone).toHaveBeenCalledWith(0.8);
  expect(commit).toHaveBeenCalled();
  expect(effect).toHaveBeenCalled();
});

test("tools toggle visibility, monitoring, auto-hide, settings and presets", () => {
  const handlers = {
    onToggleNotes: vi.fn(),
    onToggleLyrics: vi.fn(),
    onMonitoringChange: vi.fn(),
    onAutoHideChange: vi.fn(),
    onOpenAppSettings: vi.fn(),
    onApplyEffectPreset: vi.fn()
  };
  const { container } = render(
    <ToolsPanel
      {...handlers}
      showNotes
      showLyrics={false}
      monitoringEnabled
      autoHideEnabled={false}
      effectPreset="hall"
    />
  );
  const toolButtons = container.querySelectorAll("div > button");
  for (const button of [...toolButtons].slice(0, 5)) fireEvent.click(button);
  const preset = [...container.querySelectorAll("button")].find((button) =>
    button.title?.includes("%")
  );
  fireEvent.click(preset);
  expect(handlers.onToggleNotes).toHaveBeenCalled();
  expect(handlers.onToggleLyrics).toHaveBeenCalled();
  expect(handlers.onMonitoringChange).toHaveBeenCalledWith(false);
  expect(handlers.onAutoHideChange).toHaveBeenCalledWith(true);
  expect(handlers.onOpenAppSettings).toHaveBeenCalled();
  expect(handlers.onApplyEffectPreset).toHaveBeenCalled();
});

test("center controls transport, tempo and bounded key changes", () => {
  const handlers = {
    onSkip: vi.fn(),
    onTogglePlay: vi.fn(),
    onStop: vi.fn(),
    onTempoChange: vi.fn(),
    onKeyShiftChange: vi.fn()
  };
  const result = render(
    <ConsoleCenter
      {...handlers}
      song={{ note_range_min: "A2", note_range_max: "E5" }}
      currentTempo={128}
      compactKey="Dm"
      keyShift={12}
      isPlaying={false}
    />
  );

  fireEvent.click(result.getByLabelText("Назад на 5 секунд"));
  fireEvent.click(result.getByLabelText("Вперед на 5 секунд"));
  fireEvent.click(result.getByLabelText("Відтворити"));
  fireEvent.click(result.getByLabelText("Зупинити"));
  fireEvent.click(result.getByLabelText("Зменшити темп на 1 BPM"));
  fireEvent.click(result.getByLabelText("Збільшити темп на 1 BPM"));
  fireEvent.click(result.getByLabelText("Зменшити тональність"));
  fireEvent.click(result.getByLabelText("Підвищити тональність"));

  expect(handlers.onSkip.mock.calls).toEqual([[-5], [5]]);
  expect(handlers.onTogglePlay).toHaveBeenCalledOnce();
  expect(handlers.onStop).toHaveBeenCalledOnce();
  expect(handlers.onTempoChange.mock.calls).toEqual([[-1], [1]]);
  expect(handlers.onKeyShiftChange.mock.calls).toEqual([[11], [12]]);
  expect(result.container.textContent).toContain("A2 – E5");
});

test("center uses fallback note range and pause state", () => {
  const result = render(
    <ConsoleCenter
      song={{}}
      currentTempo={100}
      compactKey="C"
      keyShift={-12}
      isPlaying
      onSkip={vi.fn()}
      onTogglePlay={vi.fn()}
      onStop={vi.fn()}
      onTempoChange={vi.fn()}
      onKeyShiftChange={vi.fn()}
    />
  );

  fireEvent.click(result.getByLabelText("Зменшити тональність"));
  expect(result.getByLabelText("Пауза")).toBeTruthy();
  expect(result.container.textContent).toContain("C2 – C5");
});
