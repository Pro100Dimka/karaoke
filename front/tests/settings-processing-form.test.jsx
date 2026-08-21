/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import SettingsForm from "../src/pages/Settings/SettingsForm.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("processing folder buttons select and persist every directory", async () => {
  const selectFolder = vi.fn().mockResolvedValue("D:/New songs");
  const change = vi.fn();
  const save = vi.fn();
  vi.stubGlobal("electronAPI", { selectFolder });
  render(
    <SettingsForm
      tab="ai"
      settings={{
        app: {
          form: {
            compute_mode: "auto",
            thread_count: 4,
            songs_folder: "D:/Songs",
            ai_folder: "D:/Models",
            cache_folder: "D:/Cache"
          },
          change,
          save
        },
        audio: {},
        radio: {}
      }}
    />
  );

  const folderButtons = screen.getAllByRole("button", { name: /папку:/i });
  fireEvent.click(folderButtons[0]);
  await waitFor(() => expect(selectFolder).toHaveBeenCalledWith("D:/Songs"));
  expect(change).toHaveBeenCalledWith("songs_folder", "D:/New songs");
  expect(save).toHaveBeenCalledWith("songs_folder", "D:/New songs");
  expect(folderButtons).toHaveLength(3);
});

test("browser mode replaces unavailable directory dialogs with editable paths", () => {
  const change = vi.fn();
  const save = vi.fn();
  render(
    <SettingsForm
      tab="ai"
      settings={{
        app: {
          form: { compute_mode: "auto", thread_count: 4, songs_folder: "D:/Songs" },
          change,
          save
        },
        audio: {},
        radio: {}
      }}
    />
  );

  expect(screen.queryByRole("button", { name: /папку:/i })).toBeNull();
  const songs = screen.getAllByRole("textbox")[0];
  expect(songs.readOnly).toBe(false);
  fireEvent.change(songs, { target: { value: "E:/Karaoke" } });
  fireEvent.blur(songs, { target: { value: "E:/Karaoke" } });
  expect(change).toHaveBeenCalledWith("songs_folder", "E:/Karaoke");
  expect(save).toHaveBeenCalledWith("songs_folder", "E:/Karaoke");
});
