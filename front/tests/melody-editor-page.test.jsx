/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSongs: vi.fn(),
  navigate: vi.fn(),
  params: { songId: "song" }
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params
}));
vi.mock("../src/api/client", () => ({ api: { listSongs: mocks.listSongs } }));
vi.mock("../src/pages/Library/modals/song-settings/melody-editor", () => ({
  default: ({ song, onClose }) => (
    <button type="button" data-testid="editor" onClick={onClose}>
      {song.id}:{song.title}
    </button>
  )
}));

import MelodyEditorPage from "../src/pages/MelodyEditor.jsx";

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.listSongs.mockReset();
  mocks.params = { songId: "song" };
});
afterEach(cleanup);

test("loads the selected song and closes back to the library", async () => {
  mocks.listSongs.mockResolvedValue([{ id: "song", title: "Title" }]);
  const result = render(<MelodyEditorPage />);
  expect( result.container.querySelector(".melody-editor-route-loading")
  ).not.toBeNull();
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
