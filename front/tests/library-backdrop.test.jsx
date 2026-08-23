/* @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { beforeAll, expect, test, vi } from "vitest";
import { QuantumFieldBackdrop as LibraryBackdrop } from "../src/pages/Library/animated-backdrop/index.js";
// jsdom implements neither WebGL nor 2D canvas contexts without the native
// "canvas" package, and has no GPU to actually run post-processing passes
// on. None of that is what these tests check (they only check the static
// wrapper <div> theme/a11y attributes rendered synchronously, before any of
// this ever runs) -- so the renderer, the flare texture's 2D context, and
// the post-processing pipeline are all stubbed out as harmless no-ops, and
// everything else in "three" stays real.
// A constructor that answers any method call or property read with another
// instance of itself, so passes/composers can be chained and called however
// this component likes without ever needing to know their real API.
function NoopEffect() {
  return new Proxy(() => new NoopEffect(), {
    get: (target, prop) => {
      if (prop === "then" || typeof prop === "symbol") return undefined;
      if (!(prop in target)) target[prop] = new NoopEffect();
      return target[prop];
    }
  });
}
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => ({
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {},
    fillStyle: null
  });
});
vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal()),
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
    render() {}
    dispose() {}
  }
}));
vi.mock("three/addons/postprocessing/AfterimagePass.js", () => ({
  AfterimagePass: NoopEffect
}));
vi.mock("three/addons/postprocessing/EffectComposer.js", () => ({ EffectComposer: NoopEffect }));
vi.mock("three/addons/postprocessing/OutputPass.js", () => ({ OutputPass: NoopEffect }));
vi.mock("three/addons/postprocessing/RenderPass.js", () => ({ RenderPass: NoopEffect }));
vi.mock("three/addons/postprocessing/ShaderPass.js", () => ({ ShaderPass: NoopEffect }));
vi.mock("three/addons/postprocessing/UnrealBloomPass.js", () => ({ UnrealBloomPass: NoopEffect }));
test("library backdrop is decorative and cannot intercept controls", () => {
  const { container } = render(<LibraryBackdrop />);
  const backdrop = container.firstElementChild;
  expect(backdrop.getAttribute("aria-hidden")).toBe("true");
  expect(backdrop.style.position).toBe("fixed");
  expect(backdrop.style.pointerEvents).toBe("none");
});

test("library backdrop cleans up its window resize listener on unmount", () => {
  // jsdom's CSS engine doesn't understand color-mix(), the CSS function
  // this component uses to read the theme's colors, so that part can't be
  // verified through a rendered style string here -- what's left to check
  // (and matters just as much) is that the one thing it does listen for at
  // the window level, its resize handler for the canvas, doesn't leak past
  // unmount.
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const { unmount } = render(<LibraryBackdrop />);
  const resizeCall = add.mock.calls.find(([type]) => type === "resize");
  expect(resizeCall).toBeDefined();
  unmount();
  expect(remove).toHaveBeenCalledWith("resize", resizeCall[1]);
  add.mockRestore();
  remove.mockRestore();
});
