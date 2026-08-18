/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { same, called, verify } from "./helpers/assertions.mjs";
const mocks = vi.hoisted(() => ({
  polling: [],
  pollingIndex: 0,
  diagnostics: {},
  notify: vi.fn(),
  optimizeSong: vi.fn(),
  getAbout: vi.fn(),
  getHistory: vi.fn(),
  getCacheSize: vi.fn(),
  getFreeSpace: vi.fn(),
  listSongs: vi.fn(),
  clearCache: vi.fn(),
  clearRecordings: vi.fn()
}));
vi.mock("../src/hooks/usePolling", () => ({
  usePolling: () => {
    if (!mocks.polling.length) return { data: null };
    return mocks.polling[mocks.pollingIndex++ % mocks.polling.length];
  }
}));
vi.mock("../src/hooks/useDiagnostics", () => ({ default: () => mocks.diagnostics }));
vi.mock("../src/contexts/AppDialog", () => ({ useAppDialog: () => ({ alert: mocks.notify }) }));
vi.mock("../src/api/client", () => ({
  api: {
    getAbout: mocks.getAbout,
    getHistory: mocks.getHistory,
    getCacheSize: mocks.getCacheSize,
    getFreeSpace: mocks.getFreeSpace,
    listSongs: mocks.listSongs,
    optimizeSong: mocks.optimizeSong,
    clearCache: mocks.clearCache,
    clearRecordings: mocks.clearRecordings
  }
}));
vi.mock("../src/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: () => ({
    language: "en",
    t: (key, values, fallback) =>
      fallback || (values ? `${key}:${Object.values(values).join(",")}` : key)
  })
}));
import About from "../src/pages/Settings/screens/about.jsx";
import Diagnostics from "../src/pages/Settings/screens/diagnostics/index.jsx";
import {
  DiagnosticCheck,
  ErrorList,
  VersionList,
  getErrorKey
} from "../src/pages/Settings/screens/diagnostics/utils.jsx";
import History from "../src/pages/Settings/screens/history/index.jsx";
import MemoryManager from "../src/pages/Settings/screens/memory/index.jsx";
import MemoryBreakdown from "../src/pages/Settings/screens/memory/memory-breakdown.jsx";
import {
  MemoryActions,
  MemoryStats,
  OptimizeSong,
  runMemoryAction
} from "../src/pages/Settings/screens/memory/utils.jsx";
import { translateSaved } from "../src/i18n/runtime.js";
beforeEach(() => {
  mocks.polling = [];
  mocks.pollingIndex = 0;
  mocks.diagnostics = {};
  Object.values(mocks).forEach((mock) => mock?.mockReset?.());
  mocks.notify.mockResolvedValue(undefined);
  mocks.optimizeSong.mockResolvedValue({ freed_human: "1 GB" });
  mocks.clearCache.mockResolvedValue({});
  mocks.clearRecordings.mockResolvedValue({});
});
afterEach(cleanup);
describe("settings information screens", () => {
  test("renders about data and missing placeholders", () => {
    mocks.polling = [
      {
        data: {
          backend_version: "1.0",
          frontend_version: "2.0",
          ai_version: null,
          data_dir: "D:/Data"
        }
      }
    ];
    render(<About />);
    verify([screen.getByText("A&D Voice"), 'not.toBeNull'], [screen.getByText("1.0"), 'not.toBeNull'], [screen.getByText("D:/Data"), 'not.toBeNull']);
    cleanup();
    mocks.polling = [{ data: null }];
    expect(() => render(<About />)).not.toThrow();
  });
  test("renders diagnostic checks, versions and errors", () => {
    mocks.diagnostics = {
      health: { ok: true },
      pipeline: { separation: true, pitch: false },
      versions: { components: { backend: "1", ai: null } },
      errors: {
        errors: [ { id: 1, title: "Pipeline", updated_at: "today", error_message: "failed" } ]
      }
    };
    render(<Diagnostics />);
    verify([screen.getByText("backend"), 'not.toBeNull'], [screen.getByText("failed"), 'not.toBeNull']);
    verify([document.querySelectorAll(".diagnostics-icon").length, 'toBeGreaterThan', 1]);
  });
  test("covers standalone diagnostic empty and fallback states", () => {
    const view = render(
      <>
        <DiagnosticCheck label="Broken" ok={false} />
        <VersionList />
        <ErrorList />
      </>
    );
    expect(screen.getByText("settings.diagnostics.noErrors")).not.toBeNull();
    view.rerender(
      <ErrorList
        errors={[ { title: "No id", updated_at: "now", error_message: "message" } ]}
      />
    );
    expect(screen.getByText("message")).not.toBeNull();
    cleanup();
    mocks.diagnostics = { health: null, pipeline: null, versions: null, errors: null };
    expect(() => render(<Diagnostics />)).not.toThrow();
  });
  test("renders exact version contracts and stable error keys", () => {
    const empty = render(<VersionList components={{}} />);
    expect(empty.container.innerHTML).toBe("");
    empty.unmount();
    render( <VersionList components={{ backend: "1.0", zero: 0, empty: "", missing: null }} />
    );
    verify([screen.getByText("settings.diagnostics.versions"), 'not.toBeNull'], [screen.getByText("1.0"), 'not.toBeNull'], [screen.getByText("0"), 'not.toBeNull'], [screen.getByText("—"), 'not.toBeNull']);
    const values = document.querySelectorAll(".settings-version-row .mono");
    expect(values).toHaveLength(4);
    values.forEach((value) => {
      same([value.style.overflowWrap, "anywhere"], [value.style.textAlign, "right"]);
    });
    same([getErrorKey({ id: 0, updated_at: "now", title: "Zero" }), 0], [getErrorKey({ id: 7, updated_at: "now", title: "Known" }), 7]);
    verify([getErrorKey({ updated_at: "now", title: "Fallback" }), 'toBe', "now-Fallback"]);
  });
  test("renders history rows, statuses and polling errors", () => {
    mocks.polling = [
      {
        data: [
          {
            id: 1,
            song_title: "Song",
            kind: "processing",
            status: "done",
            duration_seconds: 61.2,
            timestamp: "2026-01-01T00:00:00Z"
          },
          {
            song_title: null,
            kind: "recording",
            status: "saved",
            duration_seconds: "bad",
            timestamp: "bad"
          },
          {
            song_title: "Unknown time",
            kind: "recording",
            status: "saved",
            duration_seconds: null,
            timestamp: null
          }
        ],
        error: new Error("history offline")
      }
    ];
    render(<History />);
    verify([screen.getByText("history offline"), 'not.toBeNull'], [screen.getByText("Song"), 'not.toBeNull'], [screen.getByText(/settings.history.seconds/), 'not.toBeNull'], [screen.getByText("done"), 'not.toBeNull']);
  });
  test("renders empty and unknown history values defensively", () => {
    mocks.polling = [{ data: null }];
    const empty = render(<History />);
    expect(screen.getByText("settings.history.empty")).not.toBeNull();
    empty.unmount();
    mocks.pollingIndex = 0;
    mocks.polling = [
      {
        data: [
          { song_title: "Unknown action", kind: "custom", status: null },
          { song_title: "Missing action", kind: null, status: "recorded" },
          { song_title: "Unknown processing", kind: "processing", status: "custom-status" },
          { song_title: "Missing processing", kind: "processing", status: null }
        ]
      }
    ];
    render(<History />);
    verify([screen.getByText("custom"), 'not.toBeNull'], [screen.getByText("custom-status"), 'not.toBeNull'], [screen.getByText("status.unknown"), 'not.toBeNull']);
  });
});
describe("memory management", () => {
  test("runs memory actions with success and failure notifications", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    await expect(
      runMemoryAction({
        request: vi.fn().mockResolvedValue({ freed: 1 }),
        getMessage: () => "Freed",
        notify
      })
    ).resolves.toBe(true);
    await expect(
      runMemoryAction({
        request: vi.fn().mockRejectedValue(new Error("locked")),
        getMessage: vi.fn(),
        notify
      })
    ).resolves.toBe(false);
    expect(notify).toHaveBeenLastCalledWith("locked");
    await expect(
      runMemoryAction({ request: vi.fn().mockRejectedValue(null), getMessage: vi.fn(), notify })
    ).resolves.toBe(false);
    verify([notify, 'toHaveBeenLastCalledWith', translateSaved("Не удалось выполнить действие")]);
  });
  test("renders exact memory statistics and empty fallbacks", () => {
    const view = render(
      <MemoryStats
        size={{ total_human: "10 GB" }}
        free={{ free_human: "5 GB", total_human: "20 GB" }}
      />
    );
    verify([screen.getByText(translateSaved("Всего занято")), 'not.toBeNull'], [screen.getByText("10 GB"), 'not.toBeNull']);
    verify([screen.getByText(translateSaved("Свободно на диске")), 'not.toBeNull']);
    verify([screen.getByText(translateSaved("{0} из {1}", { 0: "5 GB", 1: "20 GB" })), 'not.toBeNull']);
    expect(document.querySelectorAll(".settings-metric-item")).toHaveLength(2);
    view.rerender(<MemoryStats size={null} free={null} />);
    verify([screen.getByText("—"), 'not.toBeNull'], [document.querySelectorAll(".settings-metric-item"), 'toHaveLength', 1], [screen.queryByText(translateSaved("Свободно на диске")), 'toBeNull']);
  });
  test("maps memory action variants and optional icons exactly", () => {
    const Icon = (props) => <svg data-testid="memory-action-icon" {...props} />;
    render(
      <MemoryActions
        actions={[
          ["ghost", "Ghost", Icon, "ghost", vi.fn(), vi.fn()],
          ["solid", "Solid", null, "primary", vi.fn(), vi.fn()]
        ]}
        notify={vi.fn()}
      />
    );
    verify([screen.getByRole("button", { name: "Ghost" }).getAttribute("data-variant"), 'toBe', "outline"]);
    verify([screen.getByRole("button", { name: "Solid" }).getAttribute("data-variant"), 'toBe', "solid"]);
    verify([screen.getByTestId("memory-action-icon").getAttribute("size"), 'toBe', "15"]);
    verify([document.querySelectorAll(".settings-memory-actions button"), 'toHaveLength', 2]);
  });
  test("keeps the optimize-song heading and alignment contract", () => {
    render( <OptimizeSong value="" options={[]} onChange={vi.fn()} onOptimize={vi.fn()} />
    );
    verify([screen.getByText(translateSaved("Оптимизация песни")), 'not.toBeNull']);
    const grid = document.querySelector(".settings-optimize-section .ui-grid");
    expect(grid.style.alignItems).toBe("end");
  });
  test("renders breakdown, stats, actions and optimizer controls", () => {
    const action = vi.fn().mockResolvedValue({});
    const optimize = vi.fn();
    const change = vi.fn();
    const view = render(
      <>
        <MemoryBreakdown breakdown={{ models: 1024 ** 2 }} />
        <MemoryStats
          size={{ total_human: "10 GB" }}
          free={{ free_human: "5 GB", total_human: "20 GB" }}
        />
        <MemoryActions
          actions={[["clear", "Clear", null, "ghost", action, () => "Done"]]}
          notify={mocks.notify}
        />
        <OptimizeSong
          value="song"
          options={[{ value: "song", label: "Song" }]}
          onChange={change}
          onOptimize={optimize}
        />
      </>
    );
    expect(screen.getByText(/1\.0/)).not.toBeNull();
    fireEvent.click(screen.getByText("Clear"));
    fireEvent.click( screen.getByText(/Оптимізувати|РћРїС‚РёРјРёР·РёСЂРѕРІР°С‚СЊ/)
    );
    called(action, optimize);
    view.rerender(<MemoryBreakdown />);
    expect(view.container.textContent).toBe("");
    view.rerender(<MemoryStats size={null} free={null} />);
  });
  test("loads memory data and optimizes a selected song", async () => {
    mocks.polling = [
      {
        data: { total_human: "10 GB", breakdown: { models: 1024 ** 2 } },
        error: new Error("size stale")
      },
      { data: { free_human: "5 GB", total_human: "20 GB" } },
      { data: [{ id: "song", title: "Song", status: "done" }] }
    ];
    render(<MemoryManager />);
    expect(screen.getByText("size stale")).not.toBeNull();
    const select = screen.getByRole("button", { name: /Пісня|РџРµСЃРЅСЏ/ });
    fireEvent.click(select);
    const option = await screen.findByRole("option", { name: "Song" });
    fireEvent.click(option);
    const optimize = screen.getByText( /Оптимізувати|РћРїС‚РёРјРёР·РёСЂРѕРІР°С‚СЊ/
    );
    mocks.optimizeSong.mockResolvedValueOnce({});
    fireEvent.click(optimize);
    await act(async () => Promise.resolve());
    expect(mocks.optimizeSong).toHaveBeenCalledWith("song");
  });
  test("handles missing songs and a failed memory optimization", async () => {
    mocks.polling = [
      { data: { total_human: "1 GB", breakdown: {} }, error: null },
      { data: null },
      { data: null }
    ];
    mocks.optimizeSong.mockRejectedValueOnce(new Error("locked"));
    render(<MemoryManager />);
    verify([screen.getByRole("button", { name: "Оптимізувати" }).disabled, 'toBe', true]);
    cleanup();
    mocks.pollingIndex = 0;
    mocks.polling = [
      { data: { total_human: "1 GB", breakdown: {} }, error: null },
      { data: null },
      { data: [{ id: "song", title: "Song", status: "done" }] }
    ];
    render(<MemoryManager />);
    fireEvent.click(screen.getByRole("button", { name: /Пісня/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Song" }));
    const optimize = screen.getByRole("button", { name: "Оптимізувати" });
    fireEvent.click(optimize);
    await act(async () => Promise.resolve());
    expect(mocks.notify).toHaveBeenCalledWith("locked");
  });
});
