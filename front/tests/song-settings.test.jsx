/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poll: {},
  notify: vi.fn(),
  navigate: vi.fn(),
  updateSong: vi.fn(),
  refresh: vi.fn()
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../src/contexts/AppDialog", () => ({ useAppDialog: () => ({ alert: mocks.notify }) }));
vi.mock("../src/hooks/usePolling", () => ({
  usePolling: () => ({ refresh: mocks.refresh, ...mocks.poll })
}));
vi.mock("../src/api/client", () => ({ api: { listSongs: vi.fn(), updateSong: mocks.updateSong } }));
vi.mock("../src/components/modal", () => ({
  default: ({ children, titleProps }) => (
    <section>
      <span data-testid="description">{titleProps?.description}</span>
      {titleProps?.actions}
      {children}
    </section>
  )
}));
vi.mock("../src/components/fields/button", () => ({
  default: ({ children, icon: _icon, ...props }) => (
    <button {...props}>{children}</button>
  )
}));
vi.mock("../src/theme/ui", () => ({
  Stack: ({ children, ...props }) => <div {...props}>{children}</div>,
  NumberField: ({ value, onChange, placeholder }) => (
    <input
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  ConfigForm: ({ context, renderers }) => (
    <div data-testid="form">
      <input
        aria-label="title"
        value={context.form.title}
        onChange={(event) => context.onChange("title", event.target.value)}
      />
      {renderers.noteRange({ field: { label: "Range" }, context })}
    </div>
  )
}));

import SongSettings from "../src/pages/Library/modals/song-settings/index.jsx";

const song = {
  id: "song",
  title: "Title",
  artist: "Artist",
  status: "done",
  note_range_min: 50,
  note_range_max: 70
};

beforeEach(() => {
  mocks.poll = { data: [song], error: null };
  mocks.notify.mockReset().mockResolvedValue(undefined);
  mocks.navigate.mockReset();
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.updateSong.mockReset().mockResolvedValue({ title: "Updated" });
});
afterEach(cleanup);

describe("song settings", () => {
  test("edits, validates and saves song fields", async () => {
    const result = render(<SongSettings songId="song" onClose={vi.fn()} />);
    await waitFor(() => expect(result.getByTestId("form")).not.toBeNull());
    fireEvent.change(result.getByLabelText("title"), { target: { value: "New title" } });
    const numericFields = result.container.querySelectorAll(
      '[data-testid="form"] input:not([aria-label="title"])'
    );
    fireEvent.change(numericFields[0], { target: { value: "48" } });
    fireEvent.change(numericFields[1], { target: { value: "72" } });
    fireEvent.change(numericFields[0], { target: { value: "" } });
    fireEvent.change(numericFields[0], { target: { value: "48" } });
    const save = result.container.querySelector(".modal-title-action");
    fireEvent.click(save);
    await waitFor(() => expect(mocks.updateSong).toHaveBeenCalled());
    expect(mocks.updateSong.mock.calls[0][0]).toBe("song");
    expect(mocks.updateSong.mock.calls[0][1]).toMatchObject({
      title: "New title",
      note_range_min: 48,
      note_range_max: 72
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  test("opens melody editor after closing settings", async () => {
    const close = vi.fn();
    const result = render(<SongSettings songId="song" onClose={close} />);
    await waitFor(() => expect(result.getByTestId("form")).not.toBeNull());
    const editor = [...result.container.querySelectorAll("button")].find(
      (button) =>
        button !== result.container.querySelector(".modal-title-action")
    );
    fireEvent.click(editor);
    expect(close).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/editor/song");
  });

  test("renders loading, missing and request-error states", () => {
    mocks.poll = { data: null, error: null };
    const loading = render(<SongSettings songId="song" />);
    expect(loading.container.textContent).toMatch(/Загружаем|Завантажуємо/);
    cleanup();
    mocks.poll = { data: [], error: null };
    const missing = render(<SongSettings songId="song" />);
    expect(missing.container.querySelector(".field-error")).not.toBeNull();
    cleanup();
    mocks.poll = { data: null, error: new Error("offline") };
    const failed = render(<SongSettings songId="song" />);
    expect(failed.container.textContent).toContain("offline");
    fireEvent.click(failed.container.querySelector("button"));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  test("reports validation and backend save errors", async () => {
    const result = render(<SongSettings songId="song" />);
    await waitFor(() => expect(result.getByTestId("form")).not.toBeNull());
    fireEvent.change(result.getByLabelText("title"), { target: { value: "" } });
    fireEvent.click(result.container.querySelector(".modal-title-action"));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled());
    mocks.updateSong.mockRejectedValueOnce(new Error("save failed"));
    fireEvent.change(result.getByLabelText("title"), { target: { value: "Valid" } });
    fireEvent.click(result.container.querySelector(".modal-title-action"));
    await waitFor(() => expect(mocks.notify.mock.calls.at(-1)[0]).toContain("save failed")
    );
  });

  test("accepts a successful save without a response payload", async () => {
    mocks.poll = { data: [{ ...song, note_range_max: null }], error: null };
    mocks.updateSong.mockResolvedValueOnce(null);
    const result = render(<SongSettings songId="song" />);
    await waitFor(() => expect(result.getByTestId("form")).not.toBeNull());
    fireEvent.click(result.container.querySelector(".modal-title-action"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  test("tracks a song appearing after the polling result changes", async () => {
    mocks.poll = { data: [], error: null };
    const result = render(<SongSettings songId="song" />);
    expect(result.container.querySelector(".field-error")).not.toBeNull();
    mocks.poll = { data: [song], error: null };
    await act(() => result.rerender(<SongSettings songId="song" />));
    await waitFor(() => expect(result.getByTestId("form")).not.toBeNull());
  });
});
