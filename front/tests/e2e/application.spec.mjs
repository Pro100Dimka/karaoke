import { expect, test } from "@playwright/test";

test("library boots and remains interactive", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".library-song-card").first()).toBeVisible();
  await expect(page.locator(".title-bar")).toBeVisible();
});
