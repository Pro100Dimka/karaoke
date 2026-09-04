/* @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import LibraryActions from "../src/pages/Library/hero/actions";
import LibrarySongsGrid from "../src/pages/Library/songs-grid";

function LibraryResults({ songs, importing, onFileChosen, canManageLibrary }) {
  return (
    <LibrarySongsGrid
      state={{ filteredSongs: songs, canManageLibrary, songActions: {} }}
      fileImport={{ importing, importFile: onFileChosen }}
      processing={{}}
      recordings={{}}
    />
  );
}

afterEach(cleanup);

test("deleting the last song keeps the single file picker owned by the hero", () => {
  const picker = createRef();
  const props = {
    canManageLibrary: true,
    fileInputRef: picker,
    importing: false,
    onAdd: vi.fn(),
    onFileChosen: vi.fn(),
    onOpenRoom: vi.fn(),
    query: "",
    setQuery: vi.fn()
  };
  const view = render(
    <>
      <LibraryActions {...props} />
      <LibraryResults {...props} songs={[{ id: "song" }]}>
        song
      </LibraryResults>
    </>
  );
  const heroInput = view.container.querySelector("input[type=file]");
  expect(view.container.querySelectorAll("input[type=file]")).toHaveLength(1);
  expect(picker.current).toBe(heroInput);

  view.rerender(
    <>
      <LibraryActions {...props} />
      <LibraryResults {...props} songs={[]}>
        empty
      </LibraryResults>
    </>
  );

  expect(picker.current).toBe(heroInput);
});
