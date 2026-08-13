/* @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("../src/i18n", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useI18n: () => ({ t: (key, _values, fallback) => fallback || key })
  };
});

import { AudioPlayer } from "../src/components/AudioPlayer.jsx";
import Button from "../src/components/fields/button.jsx";
import Field, { FieldRow } from "../src/components/fields/field.jsx";
import FieldInput from "../src/components/fields/field-input.jsx";
import FieldList from "../src/components/fields/field-list.jsx";
import RangeInput from "../src/components/fields/range-input.jsx";
import Table from "../src/components/table/index.jsx";
import Card from "../src/components/ui/Card.jsx";
import ErrorBoundary from "../src/components/ui/ErrorBoundary.jsx";
import IconButton from "../src/components/ui/IconButton.jsx";
import PageState from "../src/components/ui/PageState.jsx";
import Panel from "../src/components/ui/Panel.jsx";
import ProgressBar from "../src/components/ui/ProgressBar.jsx";
import StatusBadge from "../src/components/ui/StatusBadge.jsx";

const Icon = (props) => <svg data-testid="icon" {...props} />;

beforeAll(() => {
  Object.defineProperties(HTMLMediaElement.prototype, {
    play: { configurable: true, value: vi.fn(async () => {}) },
    pause: { configurable: true, value: vi.fn() },
    load: { configurable: true, value: vi.fn() }
  });
});
afterEach(cleanup);

describe("primitive UI components", () => {
  test("renders buttons, icons, fields, rows and panels", () => {
    const clicked = vi.fn();
    render(
      <>
        <Button icon={Icon} iconSize={12} variant="primary" onClick={clicked}>
          Save
        </Button>
        <Button unstyled className="raw">
          Raw
        </Button>
        <IconButton icon={Icon} label="Icon action" title="Custom" />
        <IconButton icon={Icon} label="Raw icon" unstyled />
        <Field
          id="field"
          label="Label"
          hint="Hint"
          error="Error"
          variant="wide"
        >
          <input id="field" />
        </Field>
        <Field inline>
          <input />
        </Field>
        <FieldRow className="extra">Row</FieldRow>
        <Panel>Panel</Panel>
      </>
    );
    fireEvent.click(screen.getByText("Save"));
    expect(clicked).toHaveBeenCalledOnce();
    expect(screen.getByText("Save").className).toContain("btn-primary");
    expect(screen.getByText("Raw").className).toBe("raw");
    expect(screen.getByLabelText("Icon action").title).toBe("Custom");
    expect(screen.getByLabelText("Raw icon").getAttribute("class")).toBeNull();
    expect(screen.getByText("Error").className).toBe("field-error");
    expect(screen.getByText("Row").className).toContain("extra");
  });

  test("renders progress, statuses, page states and tables", () => {
    const { rerender } = render(<ProgressBar percent="bad" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "0"
    );
    rerender(<ProgressBar percent={150} label="Work" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100"
    );
    rerender(<StatusBadge status="done" />);
    expect(document.querySelector(".badge-done")).not.toBeNull();
    rerender(<StatusBadge status="custom" />);
    expect(document.querySelector(".badge-pending")).not.toBeNull();
    rerender(<StatusBadge />);
    expect(screen.getByText("status.unknown")).not.toBeNull();
    rerender(<PageState loading>Child</PageState>);
    expect(screen.getByRole("status")).not.toBeNull();
    rerender(<PageState error="Broken">Child</PageState>);
    expect(screen.getByRole("alert")).not.toBeNull();
    rerender(
      <PageState empty emptyTitle="Empty">
        Child
      </PageState>
    );
    expect(screen.getByText("Empty")).not.toBeNull();
    rerender(<PageState empty>Child</PageState>);
    expect(screen.getByText("common.noData")).not.toBeNull();
    rerender(<PageState>Child</PageState>);
    expect(screen.getByText("Child")).not.toBeNull();
    rerender(
      <Table
        columns={[["name", "Name"]]}
        data={[]}
        renderRow={() => []}
        getRowKey={() => "x"}
      />
    );
    expect(screen.getByText("common.noData")).not.toBeNull();
    rerender(
      <Table
        columns={[["name", "Name", "head"]]}
        data={[{ id: 1, name: "One" }]}
        getRowKey={(row) => row.id}
        renderRow={(row) => [[row.name, "cell"]]}
      />
    );
    expect(screen.getByText("One").className).toBe("cell");
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
    card.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 100
    });
    fireEvent.pointerMove(card, { clientX: 75, clientY: 25 });
    expect(card.style.getPropertyValue("--card-mx")).toBe("75%");
    expect(card.style.getPropertyValue("--tilt-y")).toBe("2.5deg");
    fireEvent.pointerLeave(card);
    expect(card.style.getPropertyValue("--card-mx")).toBe("");
    expect(moved).toHaveBeenCalledOnce();
    expect(left).toHaveBeenCalledOnce();
    expect(document.querySelector(".panel .content")).not.toBeNull();
    rerender(
      <Card as="article" variant="neon" tilt={false}>
        Flat
      </Card>
    );
    const flat = document.querySelector("article");
    fireEvent.pointerMove(flat, { clientX: 1, clientY: 1 });
    fireEvent.pointerLeave(flat);
    expect(flat.className).toContain("no-tilt");
    rerender(
      <Card variant="glass" overlay={<i>Layer</i>}>
        Plain
      </Card>
    );
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
      <FieldInput
        field={{ name: type, type, label: type, hint: "hint", error: "error" }}
        value={value}
        onChange={change}
        onBlur={blur}
      />
    );
    const control = screen.getByRole("textbox");
    fireEvent.change(control, { target: { value: next } });
    fireEvent.blur(control, { target: { value: next } });
    expect(change).toHaveBeenCalledWith(next);
    expect(blur).toHaveBeenCalledWith(next);
    expect(control.getAttribute("aria-invalid")).toBe("true");
  });

  test("supports numeric, toggle, readonly, select, bare and invalid controls", () => {
    const change = vi.fn();
    const blur = vi.fn();
    const { rerender } = render(
      <FieldInput
        id="n"
        field={{ name: "n", type: "number", label: "Number" }}
        value={1}
        onChange={change}
        onBlur={blur}
      />
    );
    const number = screen.getByLabelText("Number");
    fireEvent.change(number, { target: { value: "" } });
    fireEvent.blur(number, { target: { value: "bad" } });
    expect(change).toHaveBeenCalledWith(null);
    expect(blur).toHaveBeenCalledWith(null);
    rerender(
      <FieldInput
        field={{ name: "flag", type: "toggle", label: "Flag" }}
        value={false}
        onChange={change}
        onBlur={blur}
      />
    );
    fireEvent.click(screen.getByLabelText("Flag"));
    fireEvent.blur(screen.getByLabelText("Flag"));
    expect(change).toHaveBeenCalledWith(true);
    rerender(
      <FieldInput
        field={{ name: "read", type: "readonly", label: "Read" }}
        value="locked"
        onChange={change}
      />
    );
    expect(screen.getByDisplayValue("locked").readOnly).toBe(true);
    rerender(
      <FieldInput
        bare
        field={{
          name: "select",
          type: "select",
          options: [{ value: "a", label: "A" }]
        }}
        value="a"
        onChange={change}
        onBlur={blur}
      />
    );
    expect(screen.getByRole("button")).not.toBeNull();
    rerender(
      <FieldInput field={{ name: "bad", type: "missing" }} onChange={change} />
    );
    expect(document.body.textContent).toBe("");
  });

  test("maps field lists and range commit semantics", () => {
    const change = vi.fn();
    const blur = vi.fn();
    const { rerender } = render(
      <FieldList
        fields={[{ name: "x", label: "X" }]}
        values={{ x: "a" }}
        onChange={change}
        onBlur={blur}
        className="list"
      />
    );
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "b" } });
    fireEvent.blur(screen.getByLabelText("X"));
    expect(change).toHaveBeenCalledWith("x", "b");
    expect(blur).toHaveBeenCalledWith(
      "x",
      "a",
      expect.objectContaining({ name: "x" })
    );
    const commit = vi.fn();
    rerender(
      <RangeInput
        aria-label="Range"
        value={1}
        onChange={change}
        onCommit={commit}
      />
    );
    const range = screen.getByLabelText("Range");
    fireEvent.change(range, { target: { value: "2" } });
    fireEvent.pointerUp(range, { target: { value: "2" } });
    fireEvent.keyUp(range, { key: "ArrowRight", target: { value: "2" } });
    fireEvent.keyUp(range, { key: "A", target: { value: "2" } });
    expect(commit).toHaveBeenCalledTimes(2);
    rerender(<RangeInput aria-label="Text range" numeric={false} value="2" />);
    fireEvent.change(screen.getByLabelText("Text range"), {
      target: { value: "3" }
    });
  });
});

describe("AudioPlayer and error boundary", () => {
  test("handles playback, media events, seeking and volume", async () => {
    render(
      <AudioPlayer src="one.wav" initialDuration={10} className="extra" />
    );
    const audio = document.querySelector("audio");
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
    expect(audio.play).toHaveBeenCalled();
    fireEvent.play(audio);
    fireEvent.pause(audio);
    Object.defineProperty(audio, "duration", { configurable: true, value: 12 });
    fireEvent.loadedMetadata(audio);
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      writable: true,
      value: 4
    });
    fireEvent.timeUpdate(audio);
    const ranges = screen.getAllByRole("slider");
    fireEvent.change(ranges[0], { target: { value: "6" } });
    fireEvent.change(ranges[1], { target: { value: "0.5" } });
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[1]);
    fireEvent.ended(audio);
    expect(audio.currentTime).toBe(0);
    expect(document.querySelector(".performance-player").className).toContain(
      "extra"
    );
  });

  test("renders the fallback after a descendant throws", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const suppress = (event) => event.preventDefault();
    window.addEventListener("error", suppress);
    const Crash = () => {
      throw new Error("boom");
    };
    render(
      <ErrorBoundary>
        <Crash />
      </ErrorBoundary>
    );
    window.removeEventListener("error", suppress);
    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.getByText("boom")).not.toBeNull();
    expect(log).toHaveBeenCalled();
  });
});
