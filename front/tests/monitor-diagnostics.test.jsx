/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import MonitorDiagnostics from "../src/pages/Settings/MonitorDiagnostics";

vi.mock("../src/theme/ui", () => ({
  Stack: ({ children }) => <div>{children}</div>,
  Typography: ({ children, role }) => <span role={role}>{children}</span>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  Select: ({ label, value, onChange, options }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  )
}));

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
  render(<MonitorDiagnostics audio={audio()} />);
  expect(screen.getByRole("status").textContent).toBe("Подключаем микрофон…");
  expect(screen.getByRole("button", { name: "Повторить подключение" }).disabled).toBe(true);
});

test("shows measured driver latency and fallback reason without claiming end-to-end latency", () => {
  render(
    <MonitorDiagnostics
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
  expect(screen.getByText(/Задержка драйвера/).textContent).toContain("12.0 ms");
  expect(screen.getByRole("alert").textContent).toContain("underflows");
  expect(screen.queryByRole("button", { name: /ASIO4ALL/ })).toBeNull();
});

test("manual retry and buffer control are wired without automatic buffer reduction", () => {
  const state = audio({ state: "running" });
  render(<MonitorDiagnostics audio={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Повторить подключение" }));
  expect(state.monitor).toHaveBeenCalledWith(true);
  fireEvent.change(screen.getByLabelText("Запрошенный буфер мониторинга"), { target: { value: "256" } });
  expect(state.update).toHaveBeenCalledWith("buffer_size", 256);
});

test("exclusive mode has an explicit warning", () => {
  render(<MonitorDiagnostics audio={audio({}, { wasapiMode: "exclusive" })} />);
  expect(screen.getByText(/Полный exclusive/).textContent).toContain("минусовку");
});

test("shows asynchronous startup errors", () => {
  render(<MonitorDiagnostics audio={audio({ state: "error", error: "Device busy" })} />);
  expect(screen.getByRole("alert").textContent).toBe("Device busy");
});

test("ASIO4ALL help requires explicit click, never downloads or starts an installer", () => {
  const open = vi.spyOn(globalThis, "open").mockImplementation(() => null);
  render(<MonitorDiagnostics audio={audio({ state: "running" }, { suggestAsio: true })} />);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "ASIO4ALL: официальный сайт" }));
  expect(open).toHaveBeenCalledWith("https://asio4all.org/about/download-asio4all/", "_blank", "noopener,noreferrer");
});
