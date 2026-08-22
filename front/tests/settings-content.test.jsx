import { describe, expect, test, vi } from "vitest";
import { bindField } from "../src/pages/Settings/bindings.js";

const createSettings = () => ({
  app: { form: { theme: "dark" }, change: vi.fn(), save: vi.fn() },
  audio: { values: { volume: 1 }, options: { inputs: [], outputs: [] }, update: vi.fn() },
  radio: {
    isPlaying: false,
    stationId: "one",
    volume: 0.5,
    stations: [{ id: "one", name: "One", description: "Station" }],
    turnOn: vi.fn(),
    turnOff: vi.fn(),
    setStation: vi.fn(),
    setVolume: vi.fn()
  }
});

describe("settings field binding", () => {
  test("binds app values and persistence", () => {
    const source = createSettings();
    const options = [{ value: "dark", label: "Dark" }];
    const field = bindField(source, {
      source: "app",
      type: "select",
      name: "theme",
      options
    });
    expect(field.getValue()).toBe("dark");
    expect(field.options).toBe(options);
    field.setValue(null, "light");
    field.saveValue(null, "light");
    expect(source.app.change).toHaveBeenCalledWith("theme", "light");
    expect(source.app.save).toHaveBeenCalledWith("theme", "light");
  });

  test("maps radio stations and controls", () => {
    const source = createSettings();
    const field = bindField(source, {
      source: "radio",
      type: "select",
      name: "stationId",
      optionsKey: "stations"
    });
    expect(field.options[0]).toEqual({ value: "one", label: "One", description: "Station" });
    field.setValue(null, "two");
    expect(source.radio.setStation).toHaveBeenCalledWith("two");
  });

  test("binds audio options and values", () => {
    const source = createSettings();
    source.audio.options.inputs = [{ value: 1, label: "Mic" }];
    const field = bindField(source, {
      source: "audio",
      type: "select",
      name: "volume",
      optionsKey: "inputs",
      percent: true,
      label: "Volume"
    });
    expect(field.getValue()).toBe(1);
    expect(field.options).toEqual(source.audio.options.inputs);
    expect(field.saveValue).toBeUndefined();
    expect(field.formatValue(1.25)).toBe("125%");
    field.setValue(null, 1.5);
    expect(source.audio.update).toHaveBeenCalledWith("volume", 1.5);
  });

  test("toggles radio in both directions and changes volume", () => {
    const source = createSettings();
    const enabled = bindField(source, { source: "radio", type: "toggle", name: "enabled" });
    expect(enabled.getValue()).toBe(false);
    enabled.setValue(null, true);
    enabled.setValue(null, false);
    expect(source.radio.turnOn).toHaveBeenCalledOnce();
    expect(source.radio.turnOff).toHaveBeenCalledOnce();
    const volume = bindField(source, { source: "radio", type: "slider", name: "volume" });
    expect(volume.getValue()).toBe(0.5);
    volume.setValue(null, 0.8);
    expect(source.radio.setVolume).toHaveBeenCalledWith(0.8);
  });

  test("opens folder picker only for folder fields", async () => {
    const selectFolder = vi.fn().mockResolvedValue("D:/Songs");
    vi.stubGlobal("electronAPI", { selectFolder });
    const source = createSettings();
    const folder = bindField(source, { source: "app", type: "folder", name: "songs_folder" });
    const text = bindField(source, { source: "app", type: "text", name: "theme" });
    expect(await folder.pick(null, "D:/Old")).toBe("D:/Songs");
    expect(selectFolder).toHaveBeenCalledWith("D:/Old");
    expect(text.pick).toBeUndefined();
    vi.unstubAllGlobals();
    expect(bindField(source, { source: "app", type: "folder", name: "songs_folder" }).pick).toBeUndefined();
    vi.stubGlobal("electronAPI", {});
    expect(bindField(source, { source: "app", type: "folder", name: "songs_folder" }).pick).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
