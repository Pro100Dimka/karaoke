/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import LibraryActions from "../src/pages/Library/hero/actions";
import { defaultLibraryFilters } from "../src/pages/Library/utils";

test("library search applies sorting from the theme popover", () => {
  const setFilters = vi.fn();
  const setQuery = vi.fn();
  render(
    <LibraryActions
      canManageLibrary
      filterOptions={{ genres: ["Rock"], keys: ["Am"] }}
      filters={defaultLibraryFilters}
      query=""
      setFilters={setFilters}
      setQuery={setQuery}
    />
  );

  const search = screen.getByRole("textbox", { name: "Поиск" });
  expect(search.closest(".ui-text-field").querySelectorAll(".ui-text-field-slot")).toHaveLength(2);
  fireEvent.change(search, {
    target: { value: "Нервы" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Фильтры и сортировка" }));
  fireEvent.click(screen.getByRole("button", { name: "Название" }));
  fireEvent.click(screen.getByRole("button", { name: "Применить" }));

  expect(setQuery).toHaveBeenCalledWith("Нервы", expect.any(Object));
  expect(setFilters).toHaveBeenCalledWith({
    ...defaultLibraryFilters,
    sort: "title"
  });
});

test("library filter popover closes only after an outside click", () => {
  render(<LibraryActions canManageLibrary filters={defaultLibraryFilters} query="" setQuery={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "Фильтры и сортировка" }));
  const popover = document.querySelector(".ui-popover");
  expect(popover.dataset.open).not.toBeUndefined();

  fireEvent.click(screen.getByText("Сортировка"));
  expect(popover.dataset.open).not.toBeUndefined();

  fireEvent.click(document.body);
  expect(popover.dataset.open).toBeUndefined();
});
