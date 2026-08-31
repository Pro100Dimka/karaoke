import { expect, test, vi } from "vitest";
import appearanceRows from "../src/pages/Settings/rows/appearance";
import audioRows from "../src/pages/Settings/rows/audio";

test("appearance rows only override saving for custom radio actions", async () => {
  const radio = {
    stations: [{ id: "one", name: "One", group: "Music" }],
    turnOn: vi.fn(),
    turnOff: vi.fn(),
    setStation: vi.fn(),
    setVolume: vi.fn()
  };
  const rows = appearanceRows({ settings: { radio } });
  for (const row of rows) {
    expect(row.onChange).toBeUndefined();
    expect(row.onBlur).toBeUndefined();
    if (!row.tag?.startsWith("radio.")) expect(row.onSave).toBeUndefined();
  }
  const toggle = rows.find(({ tag }) => tag === "radio.enabled");
  toggle.onSave(true);
  toggle.onSave(false);
  expect(radio.turnOn).toHaveBeenCalledOnce();
  expect(radio.turnOff).toHaveBeenCalledOnce();
  const station = rows.find(({ tag }) => tag === "radio.stationId");
  expect(station.options).toEqual([{ value: "one", label: "One", group: "Music" }]);
  station.onSave("one");
  expect(radio.setStation).toHaveBeenCalledWith("one");
});

test("audio rows declare value types without repeating field bindings", () => {
  const audio = { options: { inputs: [{ value: 5, label: "Mic" }] }, update: vi.fn() };
  const rows = audioRows({ settings: { audio }, run: (action) => action() });
  const input = rows.find(({ tag }) => tag === "audio.input_device_id");
  expect(input.options).toEqual(audio.options.inputs);
  expect(input.valueType).toBe("nullable-number");
  for (const row of rows.filter(({ tag }) => tag?.startsWith("audio."))) {
    expect(row.parse).toBeUndefined();
    expect(row.onChange).toBeUndefined();
    expect(row.onBlur).toBeUndefined();
    expect(row.onSave).toBeUndefined();
  }
});
