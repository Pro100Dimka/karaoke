/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AddSongsModal, { SelectedFilePreview } from "../src/pages/Library/modals/add-songs.jsx";

beforeEach(() => {
  URL.createObjectURL = vi.fn((file) => `blob:${file.name}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("song confirmation presents metadata in a compact two-field layout", async () => {
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
            coverUrl: "data:image/png;base64,cover",
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
  expect(view.container.querySelector(".modal-title__image")?.src).toContain(
    "data:image/png;base64,cover"
  );
  expect(view.container.querySelectorAll(".settings-field.library-add-song-field")).toHaveLength(2);
  const title = view.getByDisplayValue("Track");
  const artist = view.getByDisplayValue("Artist");
  const preview = view.container.querySelector(".library-add-song-file-icon");
  const audio = view.container.querySelector(".library-add-song-file audio");
  expect(preview.disabled).toBe(false);
  expect(preview.getAttribute("aria-label")).toMatch(/Прослушать|Прослухати/);
  expect(audio.src).toContain("blob:Artist - Track.flac");
  audio.play = vi.fn().mockResolvedValue(undefined);
  audio.pause = vi.fn();
  fireEvent.click(preview);
  expect(audio.play).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(preview.getAttribute("aria-label")).toMatch(/Приостановить|Призупинити/)
  );
  fireEvent.pause(audio);
  expect(preview.getAttribute("aria-label")).toMatch(/Прослушать|Прослухати/);
  fireEvent.play(audio);
  expect(preview.getAttribute("aria-label")).toMatch(/Приостановить|Призупинити/);
  fireEvent.ended(audio);
  expect(preview.getAttribute("aria-label")).toMatch(/Прослушать|Прослухати/);
  expect(title.closest("label").textContent.trim()).not.toBe("");
  expect(artist.closest("label").textContent.trim()).not.toBe("");
  expect(title.closest("label").textContent).not.toBe(artist.closest("label").textContent);
  expect(title.required).toBe(true);
  expect(title.value).toBe("Track");
  expect(artist.value).toBe("Artist");
  fireEvent.change(title, { target: { value: "New title" } });
  expect(onUpdate).toHaveBeenCalledWith({ title: "New title" });
  fireEvent.change(artist, { target: { value: "New artist" } });
  expect(onUpdate).toHaveBeenCalledWith({ artist: "New artist" });
  fireEvent.submit(view.container.querySelector("form"));
  expect(onConfirm).toHaveBeenCalledOnce();
  fireEvent.click(view.getByText("Пропустить"));
  expect(onCancel).toHaveBeenCalledOnce();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:Artist - Track.flac");
});

test("selected file preview stays inert without a usable object URL", () => {
  const missingFile = render(<SelectedFilePreview />);
  expect(missingFile.getByRole("button").disabled).toBe(true);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  missingFile.unmount();

  URL.createObjectURL = undefined;
  const unsupportedBrowser = render(<SelectedFilePreview file={new File(["audio"], "song.mp3")} />);
  expect(unsupportedBrowser.getByRole("button").disabled).toBe(true);
});

test("selected file preview replaces and releases its object URL", () => {
  const view = render(<SelectedFilePreview file={new File(["first"], "first.mp3")} />);
  const audio = view.container.querySelector("audio");
  audio.pause = vi.fn();
  expect(audio.src).toContain("blob:first.mp3");
  view.rerender(<SelectedFilePreview file={new File(["second"], "second.mp3")} />);
  expect(audio.src).toContain("blob:second.mp3");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first.mp3");
});
