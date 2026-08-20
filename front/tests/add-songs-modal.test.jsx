/* @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import AddSongsModal from "../src/pages/Library/modals/add-songs.jsx";

afterEach(cleanup);

test("song confirmation presents metadata in a compact two-field layout", () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const onUpdate = vi.fn();
  const view = render(
    <AddSongsModal
      review={{
        index: 0,
        items: [
          {
            file: new File(["audio"], "Artist - Track.flac"),
            title: "Track",
            artist: "Artist"
          }
        ]
      }}
      onCancel={onCancel}
      onConfirm={onConfirm}
      onUpdate={onUpdate}
    />
  );

  expect(view.container.querySelector(".library-add-song-fields")).not.toBeNull();
  expect(view.getByDisplayValue("Track")).not.toBeNull();
  expect(view.getByDisplayValue("Artist")).not.toBeNull();
  fireEvent.change(view.getByDisplayValue("Track"), { target: { value: "New title" } });
  expect(onUpdate).toHaveBeenCalledWith({ title: "New title" });
  fireEvent.submit(view.container.querySelector("form"));
  expect(onConfirm).toHaveBeenCalledOnce();
  fireEvent.click(view.getByText("Пропустить"));
  expect(onCancel).toHaveBeenCalledOnce();
});
