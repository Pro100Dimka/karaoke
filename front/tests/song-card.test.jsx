/* @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { verify } from "./helpers/assertions.mjs";
import { mockUseI18nWithFallback } from "./helpers/mocks.mjs";
vi.mock("../src/i18n", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useI18n: mockUseI18nWithFallback };
});
import { LibrarySongCard } from "../src/pages/Library/components.jsx";
const handlers = () => ({
  onDelete: vi.fn(),
  onOpenFolder: vi.fn(),
  onOpenKaraoke: vi.fn(),
  onOpenProcessing: vi.fn(),
  onOpenRecordings: vi.fn(),
  onOpenSettings: vi.fn(),
  onProcess: vi.fn(),
  onReprocess: vi.fn()
});
test("ready song opens from card click and keyboard but not nested actions", () => {
  const actions = handlers();
  const song = {
    id: "song",
    title: "Title",
    artist: "Artist",
    status: "done",
    key_override: "C",
    tempo_override: 120,
    difficulty_override: "easy"
  };
  const view = render(<LibrarySongCard cardIndex={1} song={song} canManageLibrary {...actions} />);
  const card = view.getByRole("button", { name: /Открыть Title|Відкрити Title/ });
  expect(card.getAttribute("role")).toBe("button");
  fireEvent.click(card);
  fireEvent.keyDown(card, { key: "Enter" });
  fireEvent.keyDown(card, { key: " " });
  fireEvent.keyDown(card, { key: "Escape" });
  expect(actions.onOpenKaraoke).toHaveBeenCalledTimes(3);
  const nested = view.getByRole("button", { name: /Прослушать записи|Прослухати записи/ });
  fireEvent.click(nested);
  verify([actions.onOpenKaraoke, "toHaveBeenCalledTimes", 3], [view.container.textContent, "toContain", "120 BPM"]);
});
test("working song shows progress and opens its processing modal", () => {
  const actions = handlers();
  const song = { id: "song", title: "Title", status: "processing", progress_percent: 42 };
  const view = render(<LibrarySongCard cardIndex={0} song={song} canManageLibrary {...actions} />);
  expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
  fireEvent.click(view.getByRole("progressbar").closest("button"));
  expect(actions.onOpenProcessing).toHaveBeenCalledWith(song);
  expect(view.queryByRole("button", { name: /Открыть Title|Відкрити Title/ })).toBeNull();
});
test("unknown song status uses safe badge fallback", () => {
  const actions = handlers();
  const { container } = render(<LibrarySongCard cardIndex={0} song={{ id: "song", title: "Title", status: "custom" }} {...actions} />);
  expect(container.textContent).toContain("custom");
  const empty = render(<LibrarySongCard cardIndex={0} song={{ id: "empty", title: "Title", status: "" }} {...actions} />);
  expect(empty.container.textContent).toMatch(/Ожидает обработки|Очікує обробки/);
});
