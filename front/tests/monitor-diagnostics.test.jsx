/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import audioRows from "../src/pages/Settings/rows/audio";
import { RenderFormikFields, useGetForm } from "../src/theme/ui";

function AudioFields({ audio }) {
  const formik = useGetForm({
    initialValues: { audio: audio.values, monitor: { wasapiMode: audio.wasapiMode } }
  });
  return (
    <RenderFormikFields
      formik={formik}
      items={audioRows({ settings: { audio }, run: (action) => action() })}
      onFieldCommit={(name, value) => audio.update(name.slice(6), value)}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const audio = (status = {}, rest = {}) => ({
  values: { monitoring_enabled: true, audio_driver: "auto", buffer_size: 128 },
  wasapiMode: "shared",
  setWasapiMode: vi.fn(),
  update: vi.fn(),
  monitor: vi.fn(),
  monitorStatus: { state: "starting", ...status },
  ...rest
});

test("accepted start is shown as starting, not running", () => {
  render(<AudioFields audio={audio()} />);
  expect(screen.getByText("Подключаем микрофон…").getAttribute("role")).toBe("status");
  expect(screen.getByRole("button", { name: "Повторить подключение" }).disabled).toBe(true);
});

test("shows measured driver latency and fallback reason without claiming end-to-end latency", () => {
  render(
    <AudioFields
      audio={audio({
        state: "running",
        mode: "shared",
        blocksize: 256,
        sample_rate: 48000,
        input_latency_ms: 4,
        output_latency_ms: 8,
        fallback_count: 1,
        fallback_reason: "underflows"
      })}
    />
  );
  expect(screen.queryByText(/Задержка драйвера/)).toBeNull();
  expect(screen.getByText(/Полная задержка микрофон → наушники: не измерена/)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("underflows");
  expect(screen.queryByRole("button", { name: /ASIO4ALL/ })).toBeNull();
});

test("manual retry and buffer control are wired without automatic buffer reduction", async () => {
  const state = audio({ state: "running" });
  render(<AudioFields audio={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Повторить подключение" }));
  expect(state.monitor).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Аудиобуфер" }));
  fireEvent.click(screen.getByRole("option", { name: "256" }));
  await waitFor(() => expect(state.update).toHaveBeenCalledWith("buffer_size", 256));
});

test("exclusive mode has an explicit warning", () => {
  render(<AudioFields audio={audio({}, { wasapiMode: "exclusive" })} />);
  expect(screen.getByText(/Полный exclusive/).textContent).toContain("минусовку");
});

test("WASAPI mode is a custom next-start action, not an audio settings API update", async () => {
  const state = audio();
  render(<AudioFields audio={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Режим WASAPI при следующем запуске" }));
  fireEvent.click(screen.getByRole("option", { name: "Эксклюзивный микрофон, совместный выход" }));
  await waitFor(() => expect(state.setWasapiMode).toHaveBeenCalledWith("input-exclusive"));
  expect(state.update).not.toHaveBeenCalled();
  expect(state.monitor).not.toHaveBeenCalled();
  expect(screen.getByText(/Полный exclusive/)).toBeTruthy();
});

test("ASIO hides WASAPI fields, polling failures remain visible", () => {
  render(
    <AudioFields
      audio={audio(
        {},
        {
          values: { audio_driver: "asio", monitoring_enabled: false },
          monitorStatusError: true
        }
      )}
    />
  );
  expect(screen.queryByRole("button", { name: "Режим WASAPI при следующем запуске" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Аудиобуфер" })).toBeNull();
  expect(screen.getByText("Не удалось получить состояние микрофона")).toBeTruthy();
});

test("shows asynchronous startup errors", () => {
  render(<AudioFields audio={audio({ state: "error", error: "Device busy" })} />);
  expect(screen.getByRole("alert").textContent).toBe("Device busy");
});

test("automatic buffer is not offered for any WASAPI mode", () => {
  for (const wasapiMode of ["shared", "input-exclusive", "exclusive"]) {
    render(<AudioFields audio={audio({}, { wasapiMode })} />);
    expect(screen.queryByRole("switch", { name: /Автобуфер/ })).toBeNull();
    cleanup();
  }
});

test("split input/output latency and actual callback statistics are visible", () => {
  render(<AudioFields audio={audio({ state: "running", blocksize: 0, input_latency_ms: 9.2, output_latency_ms: 12.4, callback_frames: 480, glitch_count: 2 })} />);
  expect(screen.getByText("Оценка входа аудиобэкендом (не замер): 9.2 ms")).toBeTruthy();
  expect(screen.getByText("Оценка выхода аудиобэкендом (не замер): 12.4 ms")).toBeTruthy();
  expect(screen.getByText("Последний блок аудио, отсчётов: 480")).toBeTruthy();
  expect(screen.getByText("События сбоя текущего потока: 2")).toBeTruthy();
});

test("ASIO does not offer the automatic WASAPI buffer override", () => {
  render(<AudioFields audio={audio({}, { values: { audio_driver: "asio" } })} />);
  expect(screen.queryByRole("switch", { name: "Автобуфер WASAPI при следующем запуске" })).toBeNull();
});

test("split WASAPI queue is shown separately from driver endpoint latency", () => {
  render(<AudioFields audio={audio({ state: "running", engine: "wasapi-split", input_latency_ms: 5.8, output_latency_ms: 5.8, queue_ms: 2.9, queue_capacity_ms: 11.61, queue_underruns: 6 })} />);
  expect(screen.getByText("Раздельные WASAPI-потоки входа и выхода")).toBeTruthy();
  expect(screen.queryByText(/Задержка драйвера/)).toBeNull();
  expect(screen.getByText(/Полная задержка микрофон → наушники: не измерена/)).toBeTruthy();
  expect(screen.getByText("Остаток аудио в очереди (не время ожидания): 2.9 ms")).toBeTruthy();
  expect(screen.getByText("Вместимость очереди в миллисекундах аудио: 11.61 ms")).toBeTruthy();
});

test("measured software timings are separate from unmeasured physical latency", () => {
  render(<AudioFields audio={audio({ state: "running", queue_wait_ms: 4.1, dsp_compute_ms: .03 })} />);
  expect(screen.getByText("Измеренное ожидание последнего блока в программной очереди: 4.1 ms")).toBeTruthy();
  expect(screen.getByText("Время вычислений последнего блока (не задержка звука): 0.03 ms")).toBeTruthy();
  expect(screen.getByText(/Полная задержка микрофон → наушники: не измерена/)).toBeTruthy();
});

test("ASIO4ALL help requires explicit click, never downloads or starts an installer", () => {
  const open = vi.spyOn(globalThis, "open").mockImplementation(() => null);
  render(<AudioFields audio={audio({ state: "running" }, { suggestAsio: true })} />);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "ASIO4ALL: официальный сайт" }));
  expect(open).toHaveBeenCalledWith("https://asio4all.org/about/download-asio4all/", "_blank", "noopener,noreferrer");
});
