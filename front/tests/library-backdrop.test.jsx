/* @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { LibraryBackdrop } from "../src/pages/Library/components.jsx";

afterEach(cleanup);

test("library backdrop is decorative and cannot intercept controls", () => {
  const { container } = render(<LibraryBackdrop />);
  const backdrop = container.firstElementChild;
  expect(backdrop.getAttribute("aria-hidden")).toBe("true");
  expect(backdrop.style.position).toBe("fixed");
  expect(backdrop.style.pointerEvents).toBe("none");
});

test("library backdrop uses shared theme colors without runtime listeners", () => {
  const { container } = render(<LibraryBackdrop />);
  expect(container.firstElementChild.style.background).toContain("var(--ui-primary)");
});
