/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import SettingsForm from "../src/pages/Settings/SettingsForm.jsx";

test("audio settings group devices, actions and levels semantically", () => {
  const monitor = vi.fn();
  render(
    <SettingsForm
      tab="audio"
      settings={{
        app: { form: {} },
        audio: {
          values: { volume: 1, noise_suppression: 0.35, monitoring_enabled: false },
          options: { inputs: [], outputs: [] },
          busy: false,
          level: 0,
          update: vi.fn(),
          speaker: vi.fn(),
          monitor
        },
        radio: {}
      }}
    />
  );

  expect(screen.getAllByRole("slider")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Проверить динамики" })).not.toBeNull();
  fireEvent.click(screen.getByRole("switch"));
  expect(monitor).toHaveBeenCalledOnce();
});
