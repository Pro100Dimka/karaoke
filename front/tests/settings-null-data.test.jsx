/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Service } from "../src/pages/Settings/Services.jsx";
import { usePolling } from "../src/hooks/usePolling";

vi.mock("../src/hooks/usePolling", () => ({ usePolling: vi.fn() }));
vi.mock("../src/i18n", () => ({ useI18n: () => ({ t: (key) => key, language: "ru" }) }));
afterEach(cleanup);

test.each(["about", "history"])("%s survives initial null, request error, and loaded data", (id) => {
  usePolling.mockReturnValue({ data: null, error: null });
  const view = render(<Service id={id} />);
  expect(view.container.textContent).not.toBe("");
  usePolling.mockReturnValue({ data: null, error: new Error("backend offline") });
  view.rerender(<Service id={id} />);
  expect(screen.getByText("backend offline")).toBeTruthy();
  const data =
    id === "about" ? { backend_version: "version-test" } : [{ id: "song", song_title: "Song-test", kind: "processing", status: "done" }];
  usePolling.mockReturnValue({ data, error: null });
  view.rerender(<Service id={id} />);
  expect(screen.getByText(id === "about" ? "version-test" : "Song-test")).toBeTruthy();
});
