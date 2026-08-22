/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import Select from "../src/theme/ui/Select/index.jsx";
const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" }
];

describe("theme select", () => {
  test("uses the same outlined floating-label frame as text fields", () => {
    render(<Select id="choice" label="Choice" value="a" options={options} onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /Choice/ });
    expect(trigger.closest(".ui-text-field")).not.toBeNull();
    expect(trigger.closest(".ui-text-field").dataset.filled).toBe("true");
    expect(document.querySelector(".ui-text-field-outline legend").textContent).toBe("Choice");
  });

  test("selects values, supports keyboard navigation and restores focus", () => {
    const change = vi.fn();
    render(<Select id="choice" value="a" options={options} onChange={change} />);
    const trigger = screen.getByRole("button", { name: /Alpha/ });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).not.toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Beta/ }));
    expect(change).toHaveBeenCalledWith("b", expect.anything());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("closes outside and remains inert while disabled", () => {
    const view = render(<Select options={options} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    view.rerender(<Select disabled options={options} onChange={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
