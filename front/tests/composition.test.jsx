/* @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../src/theme/ui", () => ({
  Stack: ({ children }) => <div>{children}</div>,
  Grid: ({ children }) => <div>{children}</div>
}));
vi.mock("../src/i18n", () => ({
  I18nProvider: ({ children }) => <div data-provider="i18n">{children}</div>
}));
vi.mock("../src/contexts/AppDialog", () => ({
  AppDialogProvider: ({ children }) => (
    <div data-provider="dialog">{children}</div>
  )
}));
vi.mock("../src/contexts/OnlineRoomContext", () => ({
  OnlineRoomProvider: ({ children }) => (
    <div data-provider="room">{children}</div>
  )
}));
vi.mock("../src/contexts/app-settings", () => ({
  default: ({ children }) => <div data-provider="settings">{children}</div>
}));
vi.mock("../src/contexts/radio", () => ({
  RadioProvider: ({ children }) => <div data-provider="radio">{children}</div>
}));
vi.mock("../src/pages/Library/components/hero/hero", () => ({
  default: ({ marker }) => <span data-testid="hero">{marker}</span>
}));
vi.mock("../src/pages/Library/components/hero/actions", () => ({
  default: ({ marker }) => <span data-testid="actions">{marker}</span>
}));
vi.mock("../src/pages/Karaoke/components/console/center", () => ({
  default: ({ marker }) => <span data-testid="center">{marker}</span>
}));
vi.mock("../src/pages/Karaoke/components/console/mixer", () => ({
  default: ({ marker }) => <span data-testid="mixer">{marker}</span>
}));
vi.mock("../src/pages/Karaoke/components/console/song-strip", () => ({
  default: ({ marker }) => <span data-testid="strip">{marker}</span>
}));
vi.mock("../src/pages/Karaoke/components/console/tools", () => ({
  default: ({ marker }) => <span data-testid="tools">{marker}</span>
}));

import ContextProviders from "../src/contexts/index.jsx";
import KaraokeConsole from "../src/pages/Karaoke/components/console/index.jsx";
import LibraryHero from "../src/pages/Library/components/hero/index.jsx";

afterEach(cleanup);

test("context composition preserves provider ownership order", () => {
  const result = render( <ContextProviders> <span data-testid="child" /> </ContextProviders>
  );
  expect( result.getByTestId("child").closest('[data-provider="room"]')
  ).toBeTruthy();
  expect(result.container.querySelectorAll("[data-provider]")).toHaveLength(5);
});

test("library hero forwards its contract to hero and actions", () => {
  const result = render(<LibraryHero marker="library" />);
  expect(result.getByTestId("hero").textContent).toBe("library");
  expect(result.getByTestId("actions").textContent).toBe("library");
});

test("karaoke console forwards shared and auto-hide contracts", () => {
  const result = render(
    <KaraokeConsole
      marker="karaoke"
      autoHideEnabled
      onAutoHideChange={vi.fn()}
    />
  );
  for (const id of ["strip", "mixer", "center", "tools"]) {
    expect(result.getByTestId(id).textContent).toBe("karaoke");
  }
});
