/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { Circle } from "lucide-react";
import { expect, test } from "vitest";
import Button from "../src/theme/ui/Button";

test("button renders startIcon through its dedicated slot", () => {
  render(
    <Button variant="contained" startIcon={<Circle data-testid="icon" />}>
      Запустить
    </Button>
  );

  const button = screen.getByRole("button", { name: "Запустить" });
  expect(button.getAttribute("data-variant")).toBe("contained");
  expect(button.querySelector(".ui-button-start-icon")).not.toBeNull();
  expect(screen.getByTestId("icon")).not.toBeNull();
  expect(button.hasAttribute("startIcon")).toBe(false);
});
