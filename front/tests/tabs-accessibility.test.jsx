/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Tabs } from "../src/theme/ui";

test("tab arrows move selection and DOM focus while skipping disabled tabs", () => {
  const onChange = vi.fn();
  render(
    <Tabs
      defaultValue="one"
      onChange={onChange}
      items={[
        { value: "one", label: "One", content: "First" },
        { value: "two", label: "Two", content: "Second", disabled: true },
        { value: "three", label: "Three", content: "Third" }
      ]}
    />
  );
  const [first, , third] = screen.getAllByRole("tab");
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(document.activeElement).toBe(third);
  expect(third.getAttribute("aria-selected")).toBe("true");
  expect(onChange).toHaveBeenLastCalledWith("three", expect.anything());

  fireEvent.keyDown(third, { key: "Home" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "End" });
  expect(document.activeElement).toBe(third);
  expect(screen.getByRole("tablist").hasAttribute("tabindex")).toBe(false);
});
