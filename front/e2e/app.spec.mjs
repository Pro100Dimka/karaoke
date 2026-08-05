import { expect, test } from "@playwright/test";

async function expectViewportSafe(page) {
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight
  }));
  expect(overflow.width).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(#\/)?$/);
});

test("library renders mock songs without horizontal overflow", async ({
  page
}) => {
  await expect(page.getByText("Тестовая песня")).toBeVisible();
  await expect(page.getByText("Песня в обработке")).toBeVisible();
  await expectViewportSafe(page);
});

test("application settings open as a modal without changing the URL", async ({
  page
}) => {
  const originalUrl = page.url();
  await page.getByRole("button", { name: "Настройки приложения" }).click();
  await expect(
    page.getByRole("dialog", { name: "Настройки приложения" })
  ).toBeVisible();
  await expect(page).toHaveURL(originalUrl);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Настройки приложения" })
  ).toBeHidden();
});

test("song settings open as a modal without route navigation", async ({
  page
}) => {
  const originalUrl = page.url();
  await page.getByRole("button", { name: "Настройки песни" }).first().click();
  await expect(
    page.getByRole("dialog", { name: "Настройки песни" })
  ).toBeVisible();
  await expect(page).toHaveURL(originalUrl);
});

test("modal locks body scrolling and restores it after close", async ({
  page
}) => {
  await page.getByRole("button", { name: "Настройки приложения" }).click();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .not.toBe("hidden");
});

test("focus stays inside the settings modal", async ({ page }) => {
  await page.getByRole("button", { name: "Настройки приложения" }).click();
  const dialog = page.getByRole("dialog", { name: "Настройки приложения" });
  await expect(dialog).toBeVisible();
  await [...Array(20)].reduce(
    (promise) => promise.then(() => page.keyboard.press("Tab")),
    Promise.resolve()
  );
  const focusIsInside = await dialog.evaluate((node) =>
    node.contains(document.activeElement)
  );
  expect(focusIsInside).toBe(true);
});

test("search filters the mock library", async ({ page }) => {
  const search = page.getByRole("textbox");
  await search.fill("обработке");
  await expect(page.getByText("Песня в обработке")).toBeVisible();
  await expect(page.getByText("Тестовая песня")).toBeHidden();
});
