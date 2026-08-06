import { expect, test } from "@playwright/test";

async function expectViewportSafe(page) {
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth
  }));
  expect(overflow.width).toBeLessThanOrEqual(overflow.viewport + 1);
}

test("modal navigation and focus remain stable", async ({ page }) => {
  await page.goto("/");
  const originalUrl = page.url();

  for (const label of ["Настройки приложения", "Настройки песни"]) {
    const trigger = page.getByRole("button", { name: label }).first();
    if (!(await trigger.isVisible().catch(() => false))) continue;
    await trigger.click();
    await expect(page).toHaveURL(originalUrl);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    expect(
      await page.locator('[role="dialog"]').evaluate((node) =>
        node.contains(document.activeElement)
      )
    ).toBe(true);
    await page.keyboard.press("Escape");
  }

  await expectViewportSafe(page);
});
