/* @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
vi.mock("../src/pages/Library", () => ({ default: () => <div data-testid="library" /> }));
vi.mock("../src/pages/Karaoke", () => ({ default: () => <div data-testid="karaoke" /> }));
vi.mock("../src/pages/MelodyEditor.jsx", () => ({ default: () => <div data-testid="editor" /> }));
import AppRoutes from "../src/components/routes.jsx";
afterEach(cleanup);
test.each([
  ["/", "library"],
  ["/karaoke", "karaoke"],
  ["/editor/song", "editor"],
  ["/missing", "library"]
])("routes %s to %s", async (path, testId) => {
  const result = render( <MemoryRouter initialEntries={[path]}> <AppRoutes /> </MemoryRouter>
  );
  await waitFor(() => expect(result.getByTestId(testId)).not.toBeNull());
});
