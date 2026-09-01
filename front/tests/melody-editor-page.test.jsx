/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import MelodyEditorPage from "../src/pages/MelodyEditor";

import { verify } from "./helpers/assertions.mjs";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  confirm: vi.fn(),
  getAudioTrackBlob: vi.fn(),
  getSongEditor: vi.fn(),
  listSongs: vi.fn(),
  navigate: vi.fn(),
  params: { songId: "song" },
  updateUiPreferences: vi.fn(() => Promise.resolve())
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params
}));
vi.mock("../src/contexts/AppDialog", () => ({
  useAppDialog: () => ({ alert: mocks.alert, confirm: mocks.confirm })
}));
vi.mock("../src/api/client", () => ({
  api: {
    getAudioTrackBlob: mocks.getAudioTrackBlob,
    getSongEditor: mocks.getSongEditor,
    listSongs: mocks.listSongs,
    updateUiPreferences: mocks.updateUiPreferences
  }
}));
vi.mock("../src/pages/MelodyEditor/controls", () => ({
  default: ({ song, onBack }) => (
    <button type="button" data-testid="editor" onClick={onBack}>
      {song.id}:{song.title}
    </button>
  )
}));
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  mocks.getAudioTrackBlob.mockRejectedValue(new Error("audio unavailable"));
  mocks.getSongEditor.mockResolvedValue({
    lyrics_sync: { duration: 1, text: "", words: [] },
    ai_backup_exists: false
  });
  mocks.navigate.mockReset();
  mocks.listSongs.mockReset();
  mocks.params = { songId: "song" };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test("loads the selected song and closes back to the library", async () => {
  mocks.listSongs.mockResolvedValue([{ id: "song", title: "Title" }]);
  const result = render(<MelodyEditorPage />);
  verify([result.container.querySelector('[role="progressbar"]'), "not.toBeNull"]);
  await waitFor(() => expect(result.getByTestId("editor").textContent).toBe("song:Title"));
  fireEvent.click(result.getByTestId("editor"));
  expect(mocks.navigate).toHaveBeenCalledWith("/");
});
test("uses a safe editor fallback for missing and failed song lists", async () => {
  mocks.listSongs.mockResolvedValueOnce(null);
  const missing = render(<MelodyEditorPage />);
  await waitFor(() => expect(missing.getByTestId("editor").textContent).toContain("song:"));
  cleanup();
  mocks.listSongs.mockRejectedValueOnce(new Error("offline"));
  const failed = render(<MelodyEditorPage />);
  await waitFor(() => expect(failed.getByTestId("editor").textContent).toContain("song:"));
});
test("ignores a song list returned after the route unmounts", async () => {
  let resolve;
  mocks.listSongs.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const view = render(<MelodyEditorPage />);
  view.unmount();
  await act(async () => resolve([{ id: "song", title: "Late" }]));
});
