/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import Slider from "../src/theme/ui/Slider";

test("slider is an outlined field with a formatted live value", () => {
  const change = vi.fn();
  render(
    <Slider
      label="Громкость"
      tooltip="Уровень звука"
      min={0}
      max={1}
      step={0.01}
      value={0.6}
      formatValue={(value) => `${Math.round(value * 100)}%`}
      onChange={change}
    />
  );

  const slider = screen.getByRole("slider", { name: "Громкость" });
  expect(screen.getByText("60%")).not.toBeNull();
  expect(slider.closest(".ui-slider-frame")).not.toBeNull();
  fireEvent.change(slider, { target: { value: "0.8" } });
  expect(change).toHaveBeenCalledWith(0.8, expect.anything());
});

test("slider accepts compact control geometry without leaking native field sizing", () => {
  render(
    <Slider aria-label="Масштаб" min={10} max={36} value={14} showValue={false} controlSx={{ minBlockSize: 0, inlineSize: "5rem" }} />
  );

  const control = screen.getByRole("slider", { name: "Масштаб" }).parentElement;
  expect(control.style.minBlockSize).toBe("0px");
  expect(control.style.inlineSize).toBe("5rem");
  expect(control.querySelector("output")).toBeNull();
});
