/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ServiceCards, formatBytes, formatDate } from "../src/pages/Settings/Services.jsx";

vi.mock("../src/i18n", () => ({
  useI18n: () => ({ t: (key) => key, language: "ru" })
}));
describe("settings services", () => {
  test("formats defensive service values", () => {
    expect(formatBytes(0)).toBe("0 Б");
    expect(formatBytes(1024 ** 2)).toBe("1.0 МБ");
    expect(formatDate(null, "ru")).toBe("—");
    expect(formatDate("bad", "ru")).toBe("—");
  });

  test("renders every service from one map", () => {
    const open = vi.fn();
    render(<ServiceCards open={open} />);
    fireEvent.click(screen.getByText("settings.service.memory.title"));
    expect(open).toHaveBeenCalledWith("memory");
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });
});
