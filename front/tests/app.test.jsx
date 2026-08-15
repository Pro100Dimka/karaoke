/* @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("react-router-dom", () => ({
  HashRouter: ({ children }) => <div data-testid="router">{children}</div>
}));
vi.mock("../src/components/ui", () => ({
  ErrorBoundary: ({ children }) => <div data-testid="boundary">{children}</div>
}));
vi.mock("../src/components/backend-boot-loader", () => ({
  default: ({ children }) => <div data-testid="loader">{children}</div>
}));
vi.mock("../src/contexts", () => ({
  default: ({ children }) => <div data-testid="contexts">{children}</div>
}));
vi.mock("../src/components/layout", () => ({ default: () => <div data-testid="layout" /> }));
vi.mock("../src/components/OnlineRoomDock", () => ({
  OnlineRoomDock: () => <div data-testid="room" />
}));
vi.mock("../src/components/RoomRadioSync", () => ({ default: () => <div data-testid="radio" /> }));

import App from "../src/App.jsx";

afterEach(cleanup);

test("composes the application providers and global room controls", () => {
  const result = render(<App />);
  for (const id of [
    "boundary",
    "loader",
    "contexts",
    "router",
    "layout",
    "room",
    "radio"
  ]) {
    expect(result.getByTestId(id)).not.toBeNull();
  }
});
