/* @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import Grid from "../src/theme/ui/Grid";
import { GRID_BREAKPOINTS, gridColumnStyles, gridItemStyles } from "../src/theme/ui/Grid/responsive";

afterEach(cleanup);

test("each item has its own breakpoint spans without leaking MUI props to DOM", () => {
  render(
    <Grid container gap={16} data-testid="container">
      <Grid item xs={12} sm={6} md={8} lg={3} xl={2} data-testid="first">
        First
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={9} xl={10} data-testid="second">
        Second
      </Grid>
    </Grid>
  );
  const parent = screen.getByTestId("container");
  const first = screen.getByTestId("first");
  const second = screen.getByTestId("second");
  expect(parent.style.getPropertyValue("--grid-columns")).toBe("12");
  expect(parent.style.getPropertyValue("--grid-column-gap")).toBe("16px");
  expect(first.style.getPropertyValue("--grid-item-column-md")).toBe("span 8");
  expect(second.style.getPropertyValue("--grid-item-column-md")).toBe("span 4");
  expect(first.hasAttribute("data-grid-container")).toBe(false);
  for (const node of [parent, first, second]) {
    for (const prop of ["container", "item", "xs", "sm", "md", "lg", "xl", "size"]) {
      expect(node.hasAttribute(prop)).toBe(false);
    }
  }
});

test("sparse breakpoints inherit smaller sizes, not a neighbouring item's sizes", () => {
  const first = gridItemStyles(undefined, { xs: 12, md: 6 });
  const second = gridItemStyles(undefined, { sm: 4 });
  expect(first.style).toEqual({
    "--grid-item-column-xs": "span 12",
    "--grid-item-column-sm": "span 12",
    "--grid-item-column-md": "span 6",
    "--grid-item-column-lg": "span 6",
    "--grid-item-column-xl": "span 6"
  });
  expect(second.style["--grid-item-column-xs"]).toBe("auto");
  expect(second.style["--grid-item-column-md"]).toBe("span 4");
});

test("supports size number/map as well as legacy xs/sm props", () => {
  expect(gridItemStyles(6, {}).style["--grid-item-column-xl"]).toBe("span 6");
  const result = gridItemStyles({ xs: 12, sm: 6, lg: 4 }, { sm: 8 });
  expect(result.style["--grid-item-column-sm"]).toBe("span 8");
  expect(result.style["--grid-item-column-md"]).toBe("span 8");
  expect(result.style["--grid-item-column-xl"]).toBe("span 4");
});

test("fixed and adaptive Grid retain existing layout and gap contracts", () => {
  const view = render(<Grid data-testid="grid" columns={3} gap={8} rowGap="1rem" columnGap={0} />);
  const grid = screen.getByTestId("grid");
  expect(grid.style.getPropertyValue("--grid-columns")).toBe("3");
  expect(grid.style.getPropertyValue("--grid-row-gap")).toBe("1rem");
  expect(grid.style.getPropertyValue("--grid-column-gap")).toBe("0px");
  expect(grid.hasAttribute("data-adaptive")).toBe(false);
  view.rerender(<Grid data-testid="grid" minItemWidth={240} collapseEmpty={false} />);
  expect(grid.hasAttribute("data-adaptive")).toBe(true);
  expect(grid.dataset.collapseEmpty).toBe("false");
  expect(grid.style.getPropertyValue("--grid-min-item-width")).toBe("240px");
});

test("nested item/container owns its columns and resets inherited responsive variables", () => {
  render(
    <Grid container columns={{ xs: 4, md: 12 }}>
      <Grid item container xs={4} md={6} columns={2} data-testid="nested">
        <Grid xs={1} data-testid="inner">
          Inner
        </Grid>
      </Grid>
    </Grid>
  );
  const nested = screen.getByTestId("nested");
  expect(nested.style.getPropertyValue("--grid-columns-md")).toBe("var(--grid-columns)");
  expect(nested.style.getPropertyValue("--grid-columns")).toBe("2");
  expect(nested.style.getPropertyValue("--grid-item-column-md")).toBe("span 6");
  expect(nested.hasAttribute("data-grid-container")).toBe(true);
  expect(screen.getByTestId("inner").style.getPropertyValue("--grid-item-column-md")).toBe("span 1");
});

test("responsive container columns inherit and ignore invalid counts", () => {
  const styles = gridColumnStyles({ xs: 1, sm: 2, md: 0, lg: 4 }, 12);
  expect(styles["--grid-columns-md"]).toBe(2);
  expect(styles["--grid-columns-xl"]).toBe(4);
  expect(gridItemStyles(undefined, { xs: NaN, sm: -1, md: 2.5 }).sized).toBe(false);
});

test("explicit styles, sx, custom tag and accessibility props still work", () => {
  render(<Grid as="section" item xs={6} aria-label="Example" className="custom" sx={{ color: "red" }} style={{ gridColumn: "1 / -1" }} />);
  const grid = screen.getByRole("region", { name: "Example" });
  expect(grid.classList.contains("custom")).toBe(true);
  expect(grid.style.gridColumn).toBe("1 / -1");
  expect(grid.style.color).toBe("red");
});

test("CSS includes all MUI breakpoint boundaries and uses responsive item placement", () => {
  const css = readFileSync("src/theme/ui/Grid/grid.css", "utf8");
  for (const [point, width] of Object.entries(GRID_BREAKPOINTS)) {
    if (width > 0) expect(css).toContain(`@media (min-width: ${width}px)`);
    expect(css).toContain(`var(--grid-item-column-${point})`);
  }
  expect(css).toContain("grid-column: var(--grid-active-item-column)");
});
