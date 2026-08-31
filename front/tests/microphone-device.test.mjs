/* @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { resolveMicrophoneDevice } from "../src/services/microphoneDevice";

afterEach(() => vi.unstubAllGlobals());

const install = (labels) => {
  const enumerateDevices = vi.fn().mockResolvedValue(
    labels.map((label, index) => ({
      label,
      deviceId: `mic-${index}`,
      kind: "audioinput"
    }))
  );
  vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices } });
  return enumerateDevices;
};

test("system default does not force a physical input", async () => {
  const enumerate = install([]);
  expect(await resolveMicrophoneDevice({ input_device_id: null })).toBe("");
  expect(enumerate).not.toHaveBeenCalled();
});

test.each(["Microphone (USB Sound Card)", "Analogue 1/2 (Audio Interface)", "Microphone (Built-in Audio)"])(
  "matches selected %s without brand-specific rules",
  async (name) => {
    install(["Another microphone", `${name} (1234:5678)`]);
    expect(await resolveMicrophoneDevice({ input_device_id: 8, input_device_name: `${name} [Windows WASAPI]` })).toBe("mic-1");
  }
);

test.each([[["Other input"]], [["Selected", "Selected"]], [[""]]])(
  "does not silently select a wrong or ambiguous device: %s",
  async (labels) => {
    install(labels);
    await expect(resolveMicrophoneDevice({ input_device_id: 8, input_device_name: "Selected" })).rejects.toThrow();
  }
);
