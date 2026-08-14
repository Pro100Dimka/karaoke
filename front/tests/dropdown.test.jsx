/* @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import Dropdown from "../src/components/fields/Dropdown.jsx";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" }
];

describe("dropdown", () => {
  test("selects a value and restores trigger focus", () => {
    const change = vi.fn();
    render(
      <Dropdown
        id="choice"
        value="a"
        options={options}
        onChange={change}
        className="extra"
        ariaInvalid="true"
        ariaDescribedBy="hint"
      />
    );
    const trigger = screen.getByRole("button", { name: /Alpha/ });
    expect(trigger.id).toBe("choice");
    expect(trigger.getAttribute("aria-describedby")).toBe("hint");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).not.toBeNull();
    fireEvent.pointerDown(trigger);
    expect(screen.getByRole("option", { name: /Alpha/ }).className).toContain(
      "is-selected"
    );
    fireEvent.click(screen.getByRole("option", { name: /Beta/ }));
    expect(change).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("opens from the keyboard and closes on Escape or outside pointer", () => {
    const keyDown = vi.fn();
    render(
      <Dropdown
        value="missing"
        placeholder="Choose"
        options={options}
        onChange={vi.fn()}
        onKeyDown={keyDown}
      />
    );
    const trigger = screen.getByRole("button", { name: /Choose/ });
    fireEvent.keyDown(trigger, { key: "A" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).not.toBeNull();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "A" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(keyDown).toHaveBeenCalledTimes(4);
  });

  test("supports option Escape and trigger toggle", () => {
    render(<Dropdown value="a" options={options} onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /Alpha/ });
    fireEvent.blur(trigger);
    fireEvent.click(trigger);
    const option = screen.getByRole("option", { name: /Beta/ });
    fireEvent.keyDown(option, { key: "A" });
    fireEvent.keyDown(option, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("closes when disabled or another dropdown opens", () => {
    const view = render(
      <>
        <Dropdown id="one" options={options} onChange={vi.fn()} />
        <Dropdown id="two" options={options} onChange={vi.fn()} />
      </>
    );
    fireEvent.click(document.getElementById("one"));
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    fireEvent.click(document.getElementById("two"));
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    expect(screen.getByRole("listbox").id).toBe("two-menu");

    view.rerender(
      <Dropdown id="two" disabled options={options} onChange={vi.fn()} />
    );
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button").disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("commits blur only after focus leaves both trigger and menu", async () => {
    const blur = vi.fn();
    render(<Dropdown options={options} onChange={vi.fn()} onBlur={blur} />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    const option = screen.getByRole("option", { name: /Alpha/ });
    option.focus();
    fireEvent.blur(trigger);
    await act(async () => Promise.resolve());
    expect(blur).not.toHaveBeenCalled();

    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    fireEvent.blur(trigger);
    await act(async () => Promise.resolve());
    expect(blur).toHaveBeenCalledOnce();
  });

  test("positions a long menu above and updates on viewport changes", () => {
    render(
      <Dropdown
        id="positioned"
        options={Array.from({ length: 10 }, (_, index) => ({
          value: index,
          label: `Item ${index}`
        }))}
        onChange={vi.fn()}
      />
    );
    const root = document.querySelector(".app-dropdown");
    root.getBoundingClientRect = () => ({
      left: 10,
      top: 700,
      bottom: 740,
      width: 250
    });
    fireEvent.click(screen.getByRole("button"));
    const menu = screen.getByRole("listbox");
    expect(menu.style.bottom).not.toBe("auto");
    expect(menu.style.width).toBe("250px");
    fireEvent.resize(window);
    fireEvent.scroll(window);
  });
});
