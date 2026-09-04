/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ data: { ready: true }, settings: null }));
vi.mock("../src/hooks/usePolling", () => ({ usePolling: () => ({ data: mocks.data }) }));
vi.mock("../src/i18n", () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock("../src/contexts/AppDialog", () => ({
  useAppDialog: () => ({ alert: vi.fn(), confirm: vi.fn().mockResolvedValue(true) })
}));
vi.mock("../src/pages/Settings/use-settings", () => ({ default: () => mocks.settings }));
vi.mock("../src/theme/ui", async (importOriginal) => ({
  ...(await importOriginal()),
  Modal: ({ children, titleProps }) => (
    <main>
      {titleProps?.actions}
      {children}
    </main>
  )
}));

import ModelStatus from "../src/pages/Settings/ModelStatus.jsx";
import Settings from "../src/pages/Settings/index.jsx";

afterEach(() => {
  cleanup();
  mocks.data = { ready: true };
});

describe("new settings components", () => {
  test("shows ready model state", () => {
    render(<ModelStatus />);
    expect(screen.getByText("settings.ai.models.ready")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("shows a neutral loading state before model status arrives", () => {
    mocks.data = null;
    render(<ModelStatus />);
    expect(screen.getByText("settings.loading")).not.toBeNull();
    expect(screen.queryByText("settings.ai.models.missing")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("renders all primary tabs", () => {
    mocks.settings = { app: { form: null, replace: vi.fn() }, audio: {}, radio: {} };
    render(<Settings />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByText("settings.loading")).not.toBeNull();
  });

  test("advanced services open and back returns to their cards", () => {
    mocks.settings = { app: { form: null, replace: vi.fn() }, audio: {}, radio: {} };
    render(<Settings initialTab="advanced" />);
    expect(screen.getByRole("button", { name: /settings.service.about.title/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /settings.service.about.title/ }));
    expect(screen.getByText("A&D Voice")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "settings.back" }));
    expect(screen.getByRole("button", { name: /settings.service.about.title/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "settings.tab.audio" }));
    expect(screen.queryByRole("button", { name: "settings.back" })).toBeNull();
    expect(screen.getByText("settings.loading")).toBeTruthy();
  });
});
