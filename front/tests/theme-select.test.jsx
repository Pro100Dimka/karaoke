/* @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Select from "../src/theme/ui/Select";
import { selectPosition } from "../src/theme/ui/Select/position";

test("only menu options wrap; the closed field keeps its single-line layout", () => {
  const css = postcss.parse(readFileSync("src/theme/ui/Select/select.css", "utf8"));
  const declarations = (selector) => {
    const result = {};
    css.walkRules(selector, (rule) => rule.walkDecls((decl) => { result[decl.prop] = decl.value; }));
    return result;
  };
  expect(declarations(".ui-select-value")).toMatchObject({
    overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap"
  });
  expect(declarations(".ui-select-trigger")["padding-block"]).toBeUndefined();
  for (const selector of [".ui-select-option-label", ".ui-select-option-description"]) {
    expect(declarations(selector)).toMatchObject({ "white-space": "normal", "overflow-wrap": "anywhere" });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("menu fits below a field and moves away from the right edge", () => {
  expect(
    selectPosition(
      { top: 50, bottom: 90, left: 700, width: 200 },
      {
        width: 800,
        height: 600,
        menuHeight: 160
      }
    )
  ).toEqual({ top: 96, left: 592, width: 200, maxHeight: 496, above: false });
});

test("wrapped menu opens above a field near the bottom", () => {
  expect(
    selectPosition(
      { top: 500, bottom: 540, left: 20, width: 250 },
      {
        width: 800,
        height: 600,
        menuHeight: 200
      }
    )
  ).toEqual({ top: 494, left: 20, width: 250, maxHeight: 486, above: true });
});

test("oversized menu stays scrollable inside a narrow viewport", () => {
  const position = selectPosition(
    { top: 100, bottom: 140, left: -10, width: 500 },
    {
      width: 180,
      height: 300,
      menuHeight: 900
    }
  );
  expect(position).toEqual({ top: 146, left: 8, width: 164, maxHeight: 146, above: false });
});

test("short menus do not flip unnecessarily; narrow triggers get readable menus", () => {
  const position = selectPosition(
    { top: 500, bottom: 540, left: 20, width: 80 },
    {
      width: 800,
      height: 600,
      menuHeight: 40
    }
  );
  expect(position.above).toBe(false);
  expect(position.width).toBe(192);
});

test("long labels and descriptions remain complete; selection and Escape still work", () => {
  const label = "Эксклюзивный микрофон, совместный выход — звук других приложений";
  const description = "Подробное описание устройства без сокращения названия или возможностей";
  const onChange = vi.fn();
  render(
    <Select
      label="Режим"
      defaultValue="shared"
      onChange={onChange}
      options={[
        { value: "shared", label: "Совместный" },
        { value: "exclusive", label, description },
        { value: "disabled", label: "Недоступный", disabled: true }
      ]}
    />
  );
  const trigger = screen.getByRole("button", { name: "Режим" });
  trigger.getBoundingClientRect = () => ({ top: 500, bottom: 540, left: 20, width: 250 });
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
  fireEvent.click(trigger);
  expect(screen.getByRole("listbox").style.transform).toBe("translateY(-100%)");
  expect(screen.getByText(description).textContent).toBe(description);
  fireEvent.click(screen.getByRole("option", { name: new RegExp(label) }));
  expect(onChange).toHaveBeenCalledWith("exclusive", expect.anything());
  expect(trigger.textContent).toBe(label);
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
