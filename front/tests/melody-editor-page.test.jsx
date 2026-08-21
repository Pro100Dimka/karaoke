/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { verify } from "./helpers/assertions.mjs";
const mocks = vi.hoisted(() => ({
  getAudioTrackBlob: vi.fn(),
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
  useAppDialog: () => ({ alert: vi.fn(), confirm: vi.fn() })
}));
vi.mock("../src/api/client", () => ({
  api: {
    getAudioTrackBlob: mocks.getAudioTrackBlob,
    listSongs: mocks.listSongs,
    updateUiPreferences: mocks.updateUiPreferences
  }
}));
vi.mock("../src/pages/MelodyEditor/melody-editor-controls", () => ({
  default: ({ song, onBack }) => (
    <button type="button" data-testid="editor" onClick={onBack}>
      {song.id}:{song.title}
    </button>
  )
}));
vi.mock("../src/pages/MelodyEditor/useMelodyEditorDocument", () => ({
  default: () => ({
    loading: false,
    payload: { duration: 1, words: [] },
    restoreAi: vi.fn(),
    save: vi.fn(),
    saving: false
  })
}));
import MelodyEditorPage from "../src/pages/MelodyEditor";
beforeEach(() => {
  mocks.getAudioTrackBlob.mockRejectedValue(new Error("audio unavailable"));
  mocks.navigate.mockReset();
  mocks.listSongs.mockReset();
  mocks.params = { songId: "song" };
});
afterEach(cleanup);
test("loads the selected song and closes back to the library", async () => {
  mocks.listSongs.mockResolvedValue([{ id: "song", title: "Title" }]);
  const result = render(<MelodyEditorPage />);
  verify([result.container.querySelector(".melody-editor-route-loading"), 'not.toBeNull']);
  await waitFor(() => expect(result.getByTestId("editor").textContent).toBe("song:Title")
  );
  fireEvent.click(result.getByTestId("editor"));
  expect(mocks.navigate).toHaveBeenCalledWith("/");
});
test("uses a safe editor fallback for missing and failed song lists", async () => {
  mocks.listSongs.mockResolvedValueOnce(null);
  const missing = render(<MelodyEditorPage />);
  await waitFor(() => expect(missing.getByTestId("editor").textContent).toContain("song:")
  );
  cleanup();
  mocks.listSongs.mockRejectedValueOnce(new Error("offline"));
  const failed = render(<MelodyEditorPage />);
  await waitFor(() => expect(failed.getByTestId("editor").textContent).toContain("song:")
  );
});
test("ignores a song list returned after the route unmounts", async () => {
  let resolve;
  mocks.listSongs.mockReturnValue( new Promise((done) => { resolve = done; })
  );
  const view = render(<MelodyEditorPage />);
  view.unmount();
  await act(async () => resolve([{ id: "song", title: "Late" }]));
});
