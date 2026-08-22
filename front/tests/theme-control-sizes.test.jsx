/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Button, NumberField, RotaryKnob, Select, Slider, Switch, TextField } from "../src/theme/ui";

test("theme controls share the xs, sm, md and lg size contract", () => {
  render(
    <>
      <Button size="xs">Кнопка</Button>
      <TextField label="Текст" size="sm" />
      <NumberField label="Число" size="md" controls={false} />
      <Select label="Выбор" size="lg" options={[]} />
      <Slider aria-label="Уровень" size="xs" showValue={false} />
      <Switch aria-label="Флаг" size="sm" />
      <RotaryKnob label="Эффект" size="md" />
    </>
  );

  expect(screen.getByRole("button", { name: "Кнопка" }).dataset.size).toBe("xs");
  expect(screen.getByRole("textbox", { name: "Текст" }).dataset.size).toBe("sm");
  expect(screen.getByRole("spinbutton", { name: "Число" }).dataset.size).toBe("md");
  expect(screen.getByRole("button", { name: "Выбор" }).dataset.size).toBe("lg");
  expect(screen.getByRole("slider", { name: "Уровень" }).dataset.size).toBe("xs");
  expect(screen.getByRole("switch", { name: "Флаг" }).dataset.size).toBe("sm");
  expect(screen.getByText("Эффект").closest("label")?.dataset.size).toBe("md");
});
