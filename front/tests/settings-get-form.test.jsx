/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import SettingsPage from "./helpers/settings-page";
import { saveLanguage } from "../src/utils/language";

beforeEach(() => saveLanguage("ru"));

const createSettings = () => ({
  app: {
    form: { online_name: "Имя", language: "ru", theme: "dark", compute_mode: "auto", thread_count: 4 },
    change: vi.fn(),
    save: vi.fn(async () => {})
  },
  radio: {
    isPlaying: false,
    stationId: "one",
    volume: 0.5,
    stations: [
      { id: "one", name: "One" },
      { id: "two", name: "Two" }
    ],
    turnOn: vi.fn(),
    turnOff: vi.fn(),
    setStation: vi.fn(),
    setVolume: vi.fn()
  },
  audio: {
    values: { input_device_id: null, output_device_id: null, volume: 1, noise_suppression: 0.1, monitoring_enabled: false },
    options: {
      inputs: [
        { value: "", label: "Авто" },
        { value: 5, label: "USB Mic" }
      ],
      outputs: []
    },
    update: vi.fn(),
    busy: false,
    speaker: vi.fn(),
    monitor: vi.fn(),
    level: 0
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("general form loads saved values, saves name on blur and allows an empty optional name", async () => {
  const settings = createSettings();
  render(<SettingsPage tab="appearance" settings={settings} />);
  const input = screen.getByLabelText("Имя в сети");
  expect(input.value).toBe("Имя");
  fireEvent.change(input, { target: { value: "Новое имя" } });
  expect(settings.app.change).not.toHaveBeenCalled();
  expect(settings.app.save).not.toHaveBeenCalled();
  fireEvent.blur(input);
  await waitFor(() => expect(settings.app.save).toHaveBeenCalledWith("online_name", "Новое имя"));
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  await waitFor(() => expect(settings.app.save).toHaveBeenLastCalledWith("online_name", ""));
  await act(async () => {});
  expect(screen.queryByText("Введите название песни")).toBeNull();
});

test("theme and language save on selection; radio uses its own state/actions", async () => {
  const user = userEvent.setup();
  const settings = createSettings();
  render(<SettingsPage tab="appearance" settings={settings} />);
  await user.click(screen.getByRole("button", { name: "Тема", exact: true }));
  await user.click(screen.getByRole("option", { name: "Зелёная" }));
  expect(settings.app.change).toHaveBeenCalledWith("theme", "green");
  expect(settings.app.save).toHaveBeenCalledWith("theme", "green");
  await user.click(screen.getByRole("button", { name: "Язык", exact: true }));
  await user.click(screen.getByRole("option", { name: "English" }));
  expect(settings.app.save).toHaveBeenCalledWith("language", "en");
  await user.click(screen.getByRole("switch"));
  expect(settings.radio.turnOn).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("switch"));
  expect(settings.radio.turnOff).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Радиостанция" }));
  await user.click(screen.getByRole("option", { name: "Two" }));
  expect(settings.radio.setStation).toHaveBeenCalledWith("two");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "0.7" } });
  await waitFor(() => expect(settings.radio.setVolume).toHaveBeenCalledWith(0.7));
});

test("external refresh updates untouched fields without resetting an unsaved draft or focus", async () => {
  const settings = createSettings();
  const { rerender } = render(<SettingsPage tab="appearance" settings={settings} />);
  const name = screen.getByLabelText("Имя в сети");
  name.focus();
  fireEvent.change(name, { target: { value: "Черновик" } });
  rerender(
    <SettingsPage
      tab="appearance"
      settings={{ ...settings, app: { ...settings.app, form: { ...settings.app.form, online_name: "Ответ сервера", theme: "green" } } }}
    />
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Тема" }).textContent).toBe("Зелёная"));
  expect(name.value).toBe("Черновик");
  expect(document.activeElement).toBe(name);
  expect(settings.app.save).not.toHaveBeenCalled();
});

test("audio device ids stay numeric/null and microphone monitoring does not get a retry argument", async () => {
  const user = userEvent.setup();
  const settings = createSettings();
  render(<SettingsPage tab="audio" settings={settings} />);
  await user.click(screen.getByRole("button", { name: "Микрофон", exact: true }));
  await user.click(screen.getByRole("option", { name: "USB Mic" }));
  expect(settings.audio.update).toHaveBeenLastCalledWith("input_device_id", 5);
  await user.click(screen.getByRole("button", { name: "Микрофон", exact: true }));
  await user.click(screen.getByRole("option", { name: "Авто" }));
  expect(settings.audio.update).toHaveBeenLastCalledWith("input_device_id", null);
  await user.click(screen.getByRole("switch", { name: "Слышать свой голос" }));
  expect(settings.audio.monitor.mock.calls).toEqual([[]]);
  expect(settings.audio.update).not.toHaveBeenCalledWith("monitoring_enabled", expect.anything());
  // A failed start must not leave the UI claiming that monitoring was enabled.
  expect(screen.getByRole("switch", { name: "Слышать свой голос" }).checked).toBe(false);
});

test("processing validates thread count before persistence and Enter saves the draft", async () => {
  const settings = createSettings();
  const { container } = render(<SettingsPage tab="ai" settings={settings} />);
  const threads = screen.getByLabelText("Потоки процессора");
  fireEvent.change(threads, { target: { value: "0" } });
  fireEvent.blur(threads);
  expect(await screen.findByText("Укажите целое число от 1 до 64")).toBeTruthy();
  expect(settings.app.save).not.toHaveBeenCalled();
  fireEvent.change(threads, { target: { value: "8" } });
  fireEvent.submit(container.querySelector("form"));
  await waitFor(() => expect(settings.app.save).toHaveBeenCalledWith("thread_count", 8));
  expect(screen.queryByText("Укажите целое число от 1 до 64")).toBeNull();
});

test("switching tabs does not leak radio volume into microphone volume", async () => {
  const settings = createSettings();
  const { rerender } = render(<SettingsPage tab="appearance" settings={settings} />);
  fireEvent.change(screen.getByRole("slider"), { target: { value: "0.8" } });
  rerender(<SettingsPage tab="audio" settings={settings} />);
  expect(screen.getByRole("slider", { name: "Громкость голоса" }).value).toBe("1");
  expect(screen.queryByLabelText("Имя в сети")).toBeNull();
  await act(async () => {});
});

test("directory cancellation leaves the form untouched and picker failures are visible", async () => {
  const settings = createSettings();
  const selectFolder = vi.fn().mockResolvedValue(null);
  vi.stubGlobal("electronAPI", { selectFolder });
  render(<SettingsPage tab="ai" settings={settings} />);
  fireEvent.click(screen.getAllByRole("button", { name: /папку:/i })[0]);
  await waitFor(() => expect(selectFolder).toHaveBeenCalledOnce());
  expect(settings.app.save).not.toHaveBeenCalled();
  selectFolder.mockRejectedValueOnce(new Error("Нет доступа"));
  fireEvent.click(screen.getAllByRole("button", { name: /папку:/i })[0]);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Нет доступа");
});
