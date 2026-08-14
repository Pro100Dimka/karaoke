/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useOnlineRoom: vi.fn(),
  useAppDialog: vi.fn(),
  useAppSettings: vi.fn(),
  usePolling: vi.fn(),
  getHealth: vi.fn(),
  getPipelineHealth: vi.fn(),
  getVersions: vi.fn(),
  getErrors: vi.fn()
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../src/contexts/OnlineRoomContext", () => ({
  useOnlineRoom: mocks.useOnlineRoom
}));
vi.mock("../src/contexts/AppDialog", () => ({
  useAppDialog: mocks.useAppDialog
}));
vi.mock("../src/hooks/useAppSettings", () => ({
  default: mocks.useAppSettings
}));
vi.mock("../src/hooks/usePolling", () => ({ usePolling: mocks.usePolling }));
vi.mock("../src/api/client", () => ({
  api: {
    getHealth: mocks.getHealth,
    getPipelineHealth: mocks.getPipelineHealth,
    getVersions: mocks.getVersions,
    getErrors: mocks.getErrors
  }
}));

import { POLLING_INTERVALS } from "../src/config/runtime.js";
import useDiagnostics from "../src/hooks/useDiagnostics.js";
import { useOnlineRoomNavigation } from "../src/hooks/useOnlineRoomNavigation.js";
import { useRequireOnlineName } from "../src/hooks/useRequireOnlineName.js";

afterEach(cleanup);
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.useOnlineRoom.mockReturnValue({ roomCommand: null });
  mocks.useAppDialog.mockReturnValue({ alert: vi.fn() });
  mocks.useAppSettings.mockReturnValue({
    settings: { online_name: "Singer" },
    isLoading: false,
    error: null
  });
});

describe("application hooks", () => {
  test("collects every diagnostics stream with its configured interval", () => {
    const results = ["health", "pipeline", "versions", "errors"];
    mocks.usePolling.mockImplementation(() => ({ data: results.shift() }));
    const { result } = renderHook(() => useDiagnostics());

    expect(result.current).toEqual({
      health: "health",
      pipeline: "pipeline",
      versions: "versions",
      errors: "errors"
    });
    expect(mocks.usePolling.mock.calls).toEqual([
      [mocks.getHealth, POLLING_INTERVALS.health, []],
      [mocks.getPipelineHealth, POLLING_INTERVALS.health, []],
      [mocks.getVersions, POLLING_INTERVALS.versions, []],
      [mocks.getErrors, POLLING_INTERVALS.errors, []]
    ]);
  });

  test.each([
    [
      { type: "open-karaoke", songId: "song-1" },
      ["/karaoke", { state: { songId: "song-1" } }]
    ],
    [{ type: "open-library" }, ["/"]]
  ])("routes room command %#", (roomCommand, expected) => {
    mocks.useOnlineRoom.mockReturnValue({ roomCommand });
    renderHook(() => useOnlineRoomNavigation());
    expect(mocks.navigate).toHaveBeenCalledWith(...expected);
  });

  test("ignores unknown or incomplete room commands", () => {
    mocks.useOnlineRoom.mockReturnValue({
      roomCommand: { type: "open-karaoke" }
    });
    const hook = renderHook(() => useOnlineRoomNavigation());
    expect(mocks.navigate).not.toHaveBeenCalled();
    mocks.useOnlineRoom.mockReturnValue({ roomCommand: { type: "unknown" } });
    hook.rerender();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  test("ignores an absent room command", () => {
    mocks.useOnlineRoom.mockReturnValue({ roomCommand: null });
    renderHook(() => useOnlineRoomNavigation());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  test("shows the missing-name explanation once", async () => {
    const alert = vi.fn().mockRejectedValue(new Error("dialog closed"));
    const onMissingName = vi.fn(() => {
      throw new Error("navigation rejected");
    });
    mocks.useAppDialog.mockReturnValue({ alert });
    mocks.useAppSettings.mockReturnValue({
      settings: { online_name: "  " },
      isLoading: false,
      error: null
    });
    const hook = renderHook(() => useRequireOnlineName({ onMissingName }));
    await act(async () => Promise.resolve());
    hook.rerender();
    expect(onMissingName).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledOnce();
  });

  test.each([
    { settings: null, isLoading: true, error: null },
    { settings: null, isLoading: false, error: new Error("offline") },
    { settings: null, isLoading: false, error: null },
    { settings: { online_name: "Singer" }, isLoading: false, error: null }
  ])("does not warn while a usable name cannot be required %#", (state) => {
    const alert = vi.fn();
    mocks.useAppDialog.mockReturnValue({ alert });
    mocks.useAppSettings.mockReturnValue(state);
    renderHook(() => useRequireOnlineName({ onMissingName: vi.fn() }));
    expect(alert).not.toHaveBeenCalled();
  });
});
