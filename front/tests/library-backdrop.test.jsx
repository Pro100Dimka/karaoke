/* @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
// jsdom has no real GPU/WebGL context, so THREE.WebGLRenderer throws on
// construction there -- only the renderer is stubbed (via importOriginal),
// everything else in "three" stays real, so the scene/geometry/shader setup
// this component does is still exercised as normal.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      setPixelRatio() {}
      setSize() {}
      setClearColor() {}
      render() {}
      dispose() {}
    }
  };
});
import LibraryBackdrop from "../src/pages/Library/animated-backdrop/index.jsx";
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
