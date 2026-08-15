/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  polling: { data: null, error: null, refresh: vi.fn() },
  downloadAiModels: vi.fn(),
  pollingOptions: null,
  settingsForm: null,
  navigation: null
}));
vi.mock("../src/api/client", () => ({
  api: { getAiModelsStatus: vi.fn(), downloadAiModels: mocks.downloadAiModels }
}));
vi.mock("../src/hooks/usePolling", () => ({
  usePolling: (_fetcher, _interval, _dependencies, options) => {
    mocks.pollingOptions = options;
    return mocks.polling;
  }
}));
vi.mock("../src/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: () => ({
    t: (key, values) =>
      values ? `${key}:${Object.values(values).join(",")}` : key
  })
}));
vi.mock("../src/hooks/useSettingsForm", () => ({ default: () => mocks.settingsForm }));
vi.mock("../src/hooks/useSettingsNavigation", () => ({ default: () => mocks.navigation }));
vi.mock("../src/contexts/AppDialog", () => ({ useAppDialog: () => ({ alert: vi.fn() }) }));
vi.mock("../src/pages/Settings/settings-content", () => ({
  default: ({ tab }) => <div data-testid={`settings-${tab}`}>{tab}</div>
}));

import ModelRecovery from "../src/pages/Settings/model-recovery.jsx";
import Settings from "../src/pages/Settings/index.jsx";

beforeEach(() => {
  mocks.polling = { data: null, error: null, refresh: vi.fn() };
  mocks.downloadAiModels.mockReset().mockResolvedValue({});
  mocks.pollingOptions = null;
  mocks.settingsForm = { form: { theme: "dark" }, updateField: vi.fn(), saveField: vi.fn() };
  mocks.navigation = {
    tab: "appearance",
    service: null,
    selectTab: vi.fn(),
    openService: vi.fn(),
    closeService: vi.fn()
  };
  vi.stubGlobal("requestAnimationFrame", (callback) => { callback(); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AI model recovery", () => {
  test("shows ready state without a download button", () => {
    mocks.polling.data = { ready: true, state: "ready", models: [], total: 2, ready_count: 2 };
    render(<ModelRecovery />);
    expect(mocks.pollingOptions.shouldContinue({ state: "downloading" })).toBe( true
    );
    expect(mocks.pollingOptions.shouldContinue({ state: "ready" })).toBe(false);
    expect(screen.getByText("settings.ai.models.ready")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("offers retry and refreshes after a successful download request", async () => {
    mocks.polling.data = {
      ready: false,
      state: "missing",
      models: [{ name: "pitch", ready: false }],
      total: 2,
      ready_count: 1
    };
    render(<ModelRecovery />);
    expect(screen.getByText(/settings.ai.models.missing/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button"));
    await act(async () => Promise.resolve());
    expect(mocks.downloadAiModels).toHaveBeenCalledOnce();
    expect(mocks.polling.refresh).toHaveBeenCalledOnce();
  });

  test("shows real byte progress, ETA and download failures", async () => {
    mocks.polling.data = {
      ready: false,
      state: "downloading",
      current_model: "separator",
      models: [],
      total: 2,
      ready_count: 0,
      downloaded_bytes: 1024 ** 3,
      total_bytes: 2 * 1024 ** 3,
      remaining_seconds: 90
    };
    const view = render(<ModelRecovery />);
    expect( Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))
    ).toBe(1024 ** 3);
    expect(screen.getByText(/1\.0.*2\.0/)).not.toBeNull();
    expect(screen.getByRole("button").disabled).toBe(true);

    mocks.polling = {
      data: {
        ready: false,
        state: "downloading",
        downloaded_bytes: 1,
        total_bytes: 2,
        remaining_seconds: -1
      },
      error: null,
      refresh: vi.fn()
    };
    view.rerender(<ModelRecovery />);

    mocks.polling = {
      data: { ready: false, state: "missing", models: [] },
      error: new Error("status offline"),
      refresh: vi.fn()
    };
    mocks.downloadAiModels.mockRejectedValueOnce(new Error("download failed"));
    view.rerender(<ModelRecovery />);
    expect(screen.getByText("status offline")).not.toBeNull();
    fireEvent.click(screen.getByRole("button"));
    await act(async () => Promise.resolve());
    expect(screen.getByText("download failed")).not.toBeNull();
  });
});

describe("settings modal", () => {
  test("renders translated tabs and delegates tab selection", () => {
    render(<Settings />);
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByTestId("settings-appearance")).not.toBeNull();
    const audio = screen.getByRole("tab", { name: /settings.tab.audio/ });
    fireEvent.click(audio);
    expect(mocks.navigation.selectTab).toHaveBeenCalledWith( "audio", expect.any(Object)
    );
  });

  test("shows a loading state until settings arrive and can stay closed", () => {
    mocks.settingsForm = { ...mocks.settingsForm, form: null };
    const view = render(<Settings initialTab="audio" />);
    expect(screen.getAllByText("settings.loading").length).toBeGreaterThan(0);
    view.rerender(<Settings isOpen={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
