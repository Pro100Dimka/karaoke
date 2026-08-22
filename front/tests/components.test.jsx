/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { suppressWindowErrors } from "./helpers/browser.mjs";
import { same, calledWith, verify } from "./helpers/assertions.mjs";
import { mockUseI18nWithFallback } from "./helpers/mocks.mjs";
vi.mock("../src/i18n", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useI18n: mockUseI18nWithFallback };
});
import { AudioPlayer } from "../src/components/AudioPlayer.jsx";
import {
  clampFinite,
  formatAudioTime,
  normalizeAudioDuration,
  normalizeAudioPosition,
  normalizeAudioVolume,
  toggleAudioPlayback
} from "../src/components/audio-player-utils.js";
import FieldInput from "../src/theme/ui/FieldInput/index.jsx";
import RangeInput from "../src/theme/ui/RangeInput/index.jsx";
import ErrorBoundary from "../src/components/ui/ErrorBoundary.jsx";
import { Button, Card, IconButton } from "../src/theme/ui";
const Icon = (props) => <svg data-testid="icon" {...props} />;
beforeAll(() => {
  Object.defineProperties(HTMLMediaElement.prototype, {
    play: { configurable: true, value: vi.fn(async () => {}) },
    pause: { configurable: true, value: vi.fn() },
    load: { configurable: true, value: vi.fn() }
  });
});
describe("primitive UI components", () => {
  test("renders buttons, icons, fields and rows", () => {
    const clicked = vi.fn();
    render(
      <>
        <Button startIcon={<Icon />} tone="primary" onClick={clicked}>
          Save
        </Button>
        <Button unstyled className="raw">
          Raw
        </Button>
        <Button unstyled>Bare</Button>
        <IconButton icon={Icon} label="Icon action" title="Custom" />
        <IconButton icon={Icon} label="Raw icon" unstyled />
      </>
    );
    fireEvent.click(screen.getByText("Save"));
    expect(clicked).toHaveBeenCalledOnce();
    verify(
      [screen.getByText("Save").className, "toContain", "ui-button"],
      [screen.getByText("Raw").className, "toBe", "raw"],
      [screen.getByText("Bare").getAttribute("class"), "toBeNull"],
      [screen.getByLabelText("Icon action").title, "toBe", "Custom"],
      [screen.getByLabelText("Raw icon").getAttribute("class"), "toBeNull"]
    );
  });
  test("applies neon card pointer effects and delegates handlers", () => {
    const moved = vi.fn();
    const left = vi.fn();
    const { rerender } = render(
      <Card
        variant="neon"
        onPointerMove={moved}
        onPointerLeave={left}
        overlay={<b>Overlay</b>}
        cardPanel={{ className: "panel" }}
        cardContent={{ className: "content" }}
      >
        Body
      </Card>
    );
    const card = document.querySelector(".ui-card");
    card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
    fireEvent.pointerMove(card, { clientX: 75, clientY: 25 });
    same([card.style.getPropertyValue("--card-mx"), "75%"], [card.style.getPropertyValue("--tilt-y"), "2.5deg"]);
    fireEvent.pointerLeave(card);
    expect(card.style.getPropertyValue("--card-mx")).toBe("");
    expect(moved).toHaveBeenCalledOnce();
    expect(left).toHaveBeenCalledOnce();
    expect(document.querySelector(".panel .content")).not.toBeNull();
    rerender(
      <Card as="article" variant="neon" tilt={false}>
        {" "}
        Flat{" "}
      </Card>
    );
    const flat = document.querySelector("article");
    fireEvent.pointerMove(flat, { clientX: 1, clientY: 1 });
    fireEvent.pointerLeave(flat);
    expect(flat.className).toContain("no-tilt");
    rerender(
      <Card variant="glass" overlay={<i>Layer</i>}>
        {" "}
        Plain{" "}
      </Card>
    );
    fireEvent.pointerMove(document.querySelector(".ui-card"));
    fireEvent.pointerLeave(document.querySelector(".ui-card"));
    expect(screen.getByText("Plain")).not.toBeNull();
  });
});
describe("field controls", () => {
  test.each([
    ["text", "hello", "world"],
    ["url", "https://a", "https://b"],
    ["textarea", "a", "b"]
  ])("edits %s values", (type, value, next) => {
    const change = vi.fn();
    const blur = vi.fn();
    render(
      <FieldInput field={{ name: type, type, label: type, hint: "hint", error: "error" }} value={value} onChange={change} onBlur={blur} />
    );
    const control = screen.getByRole("textbox");
    fireEvent.change(control, { target: { value: next } });
    fireEvent.blur(control, { target: { value: next } });
    calledWith([change, [next]], [blur, [next]]);
    expect(control.getAttribute("aria-invalid")).toBe("true");
  });
  test("supports numeric, toggle, readonly, select, bare and invalid controls", async () => {
    const change = vi.fn();
    const blur = vi.fn();
    const { rerender } = render(
      <FieldInput id="n" field={{ name: "n", type: "number", label: "Number" }} value={1} onChange={change} onBlur={blur} />
    );
    const number = screen.getByLabelText("Number");
    fireEvent.change(number, { target: { value: "" } });
    fireEvent.blur(number, { target: { value: "bad" } });
    calledWith([change, [null]], [blur, [null]]);
    fireEvent.change(number, { target: { value: "2.5" } });
    fireEvent.blur(number, { target: { value: "3" } });
    expect(change).toHaveBeenLastCalledWith(2.5);
    expect(blur).toHaveBeenLastCalledWith(3);
    rerender(<FieldInput field={{ name: "flag", type: "toggle", label: "Flag" }} value={false} onChange={change} onBlur={blur} />);
    fireEvent.click(screen.getByLabelText("Flag"));
    fireEvent.blur(screen.getByLabelText("Flag"));
    expect(change).toHaveBeenCalledWith(true);
    rerender(<FieldInput field={{ name: "read", type: "readonly", label: "Read" }} value="locked" onChange={change} />);
    expect(screen.getByDisplayValue("locked").readOnly).toBe(true);
    rerender(
      <FieldInput
        bare
        field={{ name: "select", type: "select", options: [{ value: "a", label: "A" }] }}
        value="a"
        onChange={change}
        onBlur={blur}
      />
    );
    const select = screen.getByRole("button");
    fireEvent.blur(select);
    await act(async () => Promise.resolve());
    expect(blur).toHaveBeenLastCalledWith("a");
    rerender(<FieldInput field={{ name: "bad", type: "missing" }} onChange={change} />);
    expect(document.body.textContent).toBe("");
  });
  test("accepts the default blur handler", () => {
    render(<FieldInput field={{ name: "text", type: "text", label: "Text" }} value="value" onChange={vi.fn()} />);
    expect(() => fireEvent.blur(screen.getByLabelText("Text"))).not.toThrow();
  });
  test("handles range commit semantics", () => {
    const change = vi.fn();
    const commit = vi.fn();
    const { rerender } = render(<RangeInput aria-label="Range" value={1} onChange={change} onCommit={commit} />);
    const range = screen.getByLabelText("Range");
    fireEvent.change(range, { target: { value: "2" } });
    fireEvent.pointerUp(range, { target: { value: "2" } });
    fireEvent.keyUp(range, { key: "ArrowRight", target: { value: "2" } });
    fireEvent.keyUp(range, { key: "A", target: { value: "2" } });
    expect(commit).toHaveBeenCalledTimes(2);
    rerender(<RangeInput aria-label="Text range" numeric={false} value="2" />);
    fireEvent.change(screen.getByLabelText("Text range"), { target: { value: "3" } });
  });
});
describe("AudioPlayer and error boundary", () => {
  test("normalizes every audio value boundary", () => {
    expect([clampFinite(0.5, 0, 1), clampFinite(-2, 0, 1), clampFinite(3, 0, 1), clampFinite("bad", 0, 1, 0.25)]).toEqual([
      0.5, 0, 1, 0.25
    ]);
    expect([normalizeAudioDuration(3), normalizeAudioDuration(0), normalizeAudioDuration(-1), normalizeAudioDuration("bad")]).toEqual([
      3, 0, 0, 0
    ]);
    expect([
      normalizeAudioPosition("bad"),
      normalizeAudioPosition(0),
      normalizeAudioPosition(-1),
      normalizeAudioPosition(4),
      normalizeAudioPosition(4, 10),
      normalizeAudioPosition(12, 10),
      normalizeAudioPosition(4, 0)
    ]).toEqual([0, 0, 0, 4, 4, 10, 0]);
    expect([
      normalizeAudioVolume(null),
      normalizeAudioVolume(true),
      normalizeAudioVolume({}),
      normalizeAudioVolume(" "),
      normalizeAudioVolume("bad"),
      normalizeAudioVolume("0.4"),
      normalizeAudioVolume(-1),
      normalizeAudioVolume(0.4),
      normalizeAudioVolume(2)
    ]).toEqual([1, 1, 1, 1, 1, 0.4, 0, 0.4, 1]);
    expect(formatAudioTime(5)).toBe("00:05");
  });
  test("toggles absent, playing, successful and rejected audio", async () => {
    expect(await toggleAudioPlayback(null)).toBe(false);
    const playing = { paused: false, pause: vi.fn() };
    expect(await toggleAudioPlayback(playing)).toBe(false);
    expect(playing.pause).toHaveBeenCalledOnce();
    expect(await toggleAudioPlayback({ paused: true, play: vi.fn().mockResolvedValue() })).toBe(true);
    expect(
      await toggleAudioPlayback({
        paused: true,
        play: vi.fn().mockRejectedValue(new Error("blocked"))
      })
    ).toBe(false);
  });
  test("handles playback, media events, seeking and volume", async () => {
    render(<AudioPlayer src="one.wav" initialDuration={10} className="extra" />);
    const audio = document.querySelector("audio");
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
    expect(audio.play).toHaveBeenCalled();
    fireEvent.play(audio);
    fireEvent.pause(audio);
    Object.defineProperty(audio, "duration", { configurable: true, value: 12 });
    fireEvent.loadedMetadata(audio);
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 4 });
    fireEvent.timeUpdate(audio);
    const ranges = screen.getAllByRole("slider");
    fireEvent.change(ranges[0], { target: { value: "6" } });
    fireEvent.change(ranges[1], { target: { value: "0.5" } });
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[1]);
    fireEvent.ended(audio);
    expect(audio.currentTime).toBe(0);
    verify([document.querySelector(".performance-player").className, "toContain", "extra"]);
  });
  test("ignores browser media property assignment failures", () => {
    render(<AudioPlayer src="one.wav" initialDuration={10} />);
    const audio = document.querySelector("audio");
    const sliders = screen.getAllByRole("slider");
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      set: () => {
        throw new Error("seek blocked");
      }
    });
    verify([() => fireEvent.change(sliders[0], { target: { value: "5" } }), "not.toThrow"]);
    Object.defineProperty(audio, "volume", {
      configurable: true,
      set: () => {
        throw new Error("volume blocked");
      }
    });
    verify([() => fireEvent.change(sliders[1], { target: { value: "0.5" } }), "not.toThrow"]);
  });
  test("keeps zero duration when media metadata is invalid", () => {
    render(<AudioPlayer src="empty.wav" />);
    const audio = document.querySelector("audio");
    Object.defineProperties(audio, {
      duration: { configurable: true, value: Number.NaN },
      currentTime: { configurable: true, writable: true, value: 0 }
    });
    fireEvent.loadedMetadata(audio);
    fireEvent.timeUpdate(audio);
    const position = screen.getByLabelText("audio.recordingPosition");
    same([position.max, "0"], [position.value, "0"]);
  });
  test("renders the fallback after a descendant throws", () => {
    const { log, restore } = suppressWindowErrors();
    const Crash = () => {
      throw new Error("boom");
    };
    render(
      <ErrorBoundary>
        {" "}
        <Crash />{" "}
      </ErrorBoundary>
    );
    verify([screen.getByRole("alert"), "not.toBeNull"], [screen.getByText("boom"), "not.toBeNull"], [log, "toHaveBeenCalled"]);
    restore();
    fireEvent.click(screen.getByRole("button"));
  });
});
