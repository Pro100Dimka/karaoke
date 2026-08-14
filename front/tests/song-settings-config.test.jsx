/* @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../src/theme/ui", () => ({
  Stack: ({ children }) => <div>{children}</div>,
  NumberField: ({ id, value, onChange, ...props }) => (
    <input
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...props}
    />
  )
}));
vi.mock("../src/theme/ui/_internal/Field", () => ({
  default: ({ children }) => children({ id: "range" })
}));

import {
  DIFFICULTY_OPTIONS,
  FULL,
  HALF,
  SONG_FIELDS,
  THIRD
} from "../src/pages/Library/modals/song-settings/config.jsx";

afterEach(cleanup);

test("song settings schema exposes stable spans, values and setters", () => {
  expect([HALF, THIRD, FULL]).toEqual([6, 4, 12]);
  expect(DIFFICULTY_OPTIONS.length).toBe(5);
  const artist = SONG_FIELDS.find((field) => field.name === "artist");
  expect(artist.getValue({ form: { artist: "Singer" } })).toBe("Singer");
  expect(artist.getValue({ form: null })).toBeUndefined();
  const change = vi.fn();
  artist.setValue({ onChange: change }, "New");
  expect(change).toHaveBeenCalledWith("artist", "New");
  expect(SONG_FIELDS.find((field) => field.name === "video_url").span).toBe(
    FULL
  );
});

test("note range renderer normalizes empty and numeric input", () => {
  const range = SONG_FIELDS.find((field) => field.name === "note_range");
  const change = vi.fn();
  const { container } = render(
    range.render({
      context: {
        form: { note_range_min: 40, note_range_max: 80 },
        onChange: change
      }
    })
  );
  const inputs = container.querySelectorAll("input");
  fireEvent.change(inputs[0], { target: { value: "" } });
  fireEvent.change(inputs[1], { target: { value: "90" } });
  fireEvent.change(inputs[0], { target: { value: "41" } });
  fireEvent.change(inputs[1], { target: { value: "" } });
  expect(change.mock.calls).toEqual([
    ["note_range_min", null],
    ["note_range_max", 90],
    ["note_range_min", 41],
    ["note_range_max", null]
  ]);

  const empty = render(
    range.render({ context: { form: null, onChange: change } })
  );
  const emptyInputs = empty.container.querySelectorAll("input");
  expect(emptyInputs[0].value).toBe("");
  expect(emptyInputs[1].value).toBe("");
});
