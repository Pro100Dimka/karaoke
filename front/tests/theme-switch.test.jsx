/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Switch from "../src/theme/ui/Switch";

afterEach(cleanup);

test("switch uses an outlined field and reports its state", () => {
  const change = vi.fn();
  render(
    <Switch
      label="Радио"
      checked={false}
      checkedText="Включено"
      uncheckedText="Выключено"
      onChange={change}
    />
  );

  const control = screen.getByRole("switch", { name: "Радио" });
  const field = control.closest(".ui-switch-field");
  expect(field).not.toBeNull();
  expect(control.dataset.size).toBe("md");
  expect(control.required).toBe(false);
  expect(control.disabled).toBe(false);
  expect(control.classList.contains("ui-switch")).toBe(true);
  expect(control.classList.contains("ui-focus-ring")).toBe(true);
  expect(control.classList.contains("ui-disabled")).toBe(true);
  expect(control.classList.contains("ui-motion")).toBe(true);
  expect(field.closest(".ui-switch-field-wrap")?.classList.contains("ui-field")).toBe(true);
  expect(field.closest(".ui-switch-field-wrap")?.hasAttribute("data-error")).toBe(false);
  expect(screen.getByText("Выключено")).not.toBeNull();
  expect(document.querySelector(".ui-switch-status")?.textContent).toBe("Выключено");
  fireEvent.click(control);
  expect(change).toHaveBeenCalledWith(true, expect.anything());
});

test("plain switch keeps its compact label layout", () => {
  render(<Switch variant="plain" label="Мониторинг" />);
  expect(screen.getByRole("switch", { name: "Мониторинг" })).not.toBeNull();
  expect(document.querySelector(".ui-switch-field")).toBeNull();
});

test("switch supports native uncontrolled, required and disabled states", () => {
  render(
    <Switch
      variant="plain"
      label="Автозапуск"
      defaultChecked
      disabled
      required
      size="lg"
    />
  );
  const control = screen.getByRole("switch", { name: "Автозапуск" });
  expect(control.checked).toBe(true);
  expect(control.disabled).toBe(true);
  expect(control.required).toBe(true);
  expect(control.dataset.size).toBe("lg");
  expect(control.closest(".ui-switch-label")?.hasAttribute("data-disabled")).toBe(true);
});

test("switch wires hint and error accessibility", () => {
  const { rerender } = render(<Switch label="Сеть" hint="Подсказка" />);
  let control = screen.getByRole("switch", { name: "Сеть" });
  let message = screen.getByText("Подсказка");
  expect(control.getAttribute("aria-describedby")).toBe(message.id);
  expect(message.id.endsWith("-hint")).toBe(true);
  expect(control.hasAttribute("aria-invalid")).toBe(false);

  rerender(<Switch label="Сеть" error="Ошибка" />);
  control = screen.getByRole("switch", { name: "Сеть" });
  message = screen.getByText("Ошибка");
  expect(control.getAttribute("aria-describedby")).toBe(message.id);
  expect(message.id.endsWith("-error")).toBe(true);
  expect(control.getAttribute("aria-invalid")).toBe("true");
  expect(control.closest(".ui-switch-field-wrap")?.hasAttribute("data-error")).toBe(true);
});

test("switch without a label stays a standalone native control", () => {
  render(<Switch aria-label="Без подписи" />);
  const control = screen.getByRole("switch", { name: "Без подписи" });
  expect(control.checked).toBe(false);
  expect(control.closest(".ui-switch-field-wrap")).toBeNull();
  expect(control.id).not.toContain("Stryker was here");
});
