/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import TitleBar from "../src/components/TitleBar.jsx";
import BackendBootLoader from "../src/components/backend-boot-loader.jsx";
import AppLayout from "../src/components/layout.jsx";
import { called, verify } from "./helpers/assertions.mjs";

const mocks = vi.hoisted(() => ({
  location: { pathname: "/" },
  radio: {
    error: "",
    isLoading: false,
    isPlaying: false,
    station: { name: "Radio" },
    toggle: vi.fn(),
    volume: 0.5,
    setVolume: vi.fn()
  },
  missingName: null,
  getHealth: vi.fn(),
  hydrate: vi.fn(),
  getTheme: vi.fn(() => "dark")
}));
vi.mock("react-router-dom", () => ({ useLocation: () => mocks.location }));
vi.mock("../src/contexts/radio", () => ({ useRadio: () => mocks.radio }));
vi.mock("../src/hooks/useOnlineRoomNavigation", () => ({ useOnlineRoomNavigation: vi.fn() }));
vi.mock("../src/i18n", () => ({
  useI18n: () => ({
    t: (key, values) => `${key}${values?.station ? `:${values.station}` : ""}`
  }),
  translateMessage: (_language, key) => key
}));
vi.mock("../src/pages/Settings", () => ({
  default: ({ onClose }) => <button type="button" data-testid="settings" onClick={onClose} />
}));
vi.mock("../src/components/routes", () => ({
  default: ({ onOpenAppSettings }) => <button type="button" data-testid="route-settings" onClick={onOpenAppSettings} />
}));
vi.mock("../src/api/client", () => ({ api: { getHealth: mocks.getHealth } }));
vi.mock("../src/api/core", () => ({ MOCK_API_ENABLED: false }));
vi.mock("../src/runtime-config", () => ({ BACKEND_BOOT_RETRY_MS: 5 }));
vi.mock("../src/utils/theme", () => ({ getSavedTheme: mocks.getTheme }));
vi.mock("../src/utils/language", () => ({ getSavedLanguage: () => "uk" }));
vi.mock("../src/utils/ui-preferences", () => ({ hydrateUiPreferences: mocks.hydrate }));
beforeEach(() => {
  mocks.location = { pathname: "/" };
  mocks.radio.error = "";
  mocks.radio.isLoading = false;
  mocks.radio.isPlaying = false;
  mocks.radio.volume = 0.5;
  mocks.radio.toggle.mockReset();
  mocks.radio.setVolume.mockReset();
  mocks.getHealth.mockReset().mockResolvedValue({ ok: true });
  mocks.hydrate.mockReset().mockResolvedValue(undefined);
  window.electronAPI = undefined;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.electronAPI;
});
describe("application shell", () => {
  test("title bar invokes desktop actions and isolates rejected actions", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    window.electronAPI = {
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleFullscreen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockRejectedValue(new Error("close failed"))
    };
    const { getByLabelText, rerender } = render(<TitleBar title="Voice" />);
    fireEvent.click(getByLabelText("common.minimizeWindow"));
    fireEvent.click(getByLabelText("common.maximizeWindow"));
    fireEvent.click(getByLabelText("common.closeWindow"));
    await waitFor(() => expect(error).toHaveBeenCalled());
    called(window.electronAPI.minimize, window.electronAPI.toggleFullscreen);
    rerender(<TitleBar hideActions />);
    expect(document.querySelectorAll(".title-bar__button")).toHaveLength(0);
    error.mockRestore();
  });
  test("layout opens global settings, radio and blackout state", async () => {
    const { container, getByLabelText, getByRole, getByTestId, rerender } = render(<AppLayout />);
    verify([container.querySelector(".app-shell").classList.contains("karaoke-app-shell"), "toBe", false]);
    fireEvent.click(getByLabelText("radio.enable:Radio"));
    expect(mocks.radio.toggle).toHaveBeenCalled();
    mocks.radio.isPlaying = true;
    rerender(<AppLayout />);
    fireEvent.change(getByRole("slider"), {
      target: { value: "0.7" }
    });
    expect(mocks.radio.setVolume).toHaveBeenCalledWith(0.7);
    fireEvent.click(getByTestId("route-settings"));
    await waitFor(() => expect(getByTestId("settings")).not.toBeNull());
    fireEvent.click(getByTestId("settings"));
    fireEvent(window, new CustomEvent("app:route-blackout", { detail: { visible: true } }));
    verify([container.querySelector(".app-route-blackout").classList.contains("is-visible"), "toBe", true]);
    fireEvent(window, new CustomEvent("app:route-blackout"));
    verify([container.querySelector(".app-route-blackout").classList.contains("is-visible"), "toBe", false]);
  });
  test("layout exposes active and failed radio states", () => {
    mocks.radio.error = "radio failed";
    mocks.radio.isLoading = true;
    mocks.radio.isPlaying = true;
    const view = render(<AppLayout />);
    const radio = view.getByLabelText("radio failed");
    verify(
      [radio.disabled, "toBe", true],
      [radio.getAttribute("data-variant"), "toBe", "contained"],
      [radio.getAttribute("data-tone"), "toBe", "success"]
    );
    mocks.radio.error = "";
    view.rerender(<AppLayout />);
    expect(view.getByLabelText("radio.disable:Radio")).not.toBeNull();
  });
  test("layout applies route-specific shells and suppresses floating controls", () => {
    mocks.location = { pathname: "/karaoke" };
    const karaoke = render(<AppLayout />);
    verify([karaoke.container.querySelector(".app-shell").classList.contains("karaoke-app-shell"), "toBe", true]);
    verify([karaoke.container.querySelector(".app-floating-controls"), "toBeNull"]);
    cleanup();
    mocks.location = { pathname: "/editor/song" };
    const editor = render(<AppLayout />);
    verify([editor.container.querySelector(".app-shell").classList.contains("melody-editor-app-shell"), "toBe", true]);
    expect(editor.container.querySelector(".title-bar__button")).toBeNull();
  });
  test("backend loader hydrates preferences and reacts to theme changes", async () => {
    mocks.hydrate.mockRejectedValueOnce(new Error("optional"));
    const { getByRole, getByText } = render(
      <BackendBootLoader>
        <div>ready-child</div>
      </BackendBootLoader>
    );
    verify([getByRole("status"), "not.toBeNull"], [getByText("backend.starting"), "not.toBeNull"]);
    document.documentElement.dataset.theme = "green";
    await waitFor(() => expect(mocks.getHealth).toHaveBeenCalled());
    await waitFor(() => expect(getByText("ready-child")).not.toBeNull());
  });
  test("backend loader retries health checks", async () => {
    vi.useFakeTimers();
    mocks.getHealth.mockRejectedValueOnce(new Error("offline"));
    render(
      <BackendBootLoader>
        {" "}
        <div>ready-after-retry</div>{" "}
      </BackendBootLoader>
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5);
    await Promise.resolve();
    expect(mocks.getHealth).toHaveBeenCalledTimes(2);
  });
  test("backend loader exposes a terminal error and can retry", async () => {
    vi.useFakeTimers();
    mocks.getHealth.mockRejectedValue(new Error("offline"));
    const view = render(
      <BackendBootLoader>
        <div>ready-after-manual-retry</div>
      </BackendBootLoader>
    );
    await vi.advanceTimersByTimeAsync(40 * 5);
    verify([view.getByText("backend.failed"), "not.toBeNull"], [mocks.getHealth, "toHaveBeenCalledTimes", 40]);
    mocks.getHealth.mockResolvedValue({ ok: true });
    fireEvent.click(view.getByText("backend.retry"));
    await act(async () => Promise.resolve());
    verify([mocks.getHealth, "toHaveBeenCalledTimes", 41], [view.getByText("ready-after-manual-retry"), "not.toBeNull"]);
  });
  test("backend loader falls back for unknown themes and ignores late health", async () => {
    mocks.getTheme.mockReturnValue("unknown");
    let resolveHealth;
    mocks.getHealth.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHealth = resolve;
      })
    );
    const view = render(
      <BackendBootLoader>
        {" "}
        <div>too late</div>{" "}
      </BackendBootLoader>
    );
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.setAttribute("data-probe", "changed");
    await act(async () => Promise.resolve());
    view.unmount();
    resolveHealth({ ok: true });
    await act(async () => Promise.resolve());
  });
});
