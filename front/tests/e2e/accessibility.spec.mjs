import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.skip(process.env.VITE_USE_MOCK_API === "false", "Mock-API accessibility scenarios");

const themes = ["dark", "light", "green", "violet"];

async function closeProcessingModal(page) {
  const modal = page.getByRole("dialog", { name: /Обработка песни|Обробка пісні/ });
  if (await modal.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
  }
}

async function assertAccessible(page, label) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const violations = result.violations
    .filter(({ impact }) => impact === "serious" || impact === "critical")
    .map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.slice(0, 5).map(({ target, html, failureSummary }) => ({
        target: target.join(" "),
        html,
        failureSummary
      }))
    }));
  expect(violations, `${label}: serious/critical axe violations`).toEqual([]);
}

async function applyTheme(page, theme) {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.waitForTimeout(250);
}

async function closeVisibleDialog(page) {
  const dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test("critical screens have no serious or critical axe violations in every theme", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await closeProcessingModal(page);

  for (const theme of themes) {
    await applyTheme(page, theme);
    await assertAccessible(page, `library/${theme}`);

    const settingsButton = page.getByRole("button", {
      name: /Налаштування програми|Настройки программы/
    });
    await settingsButton.click();
    await assertAccessible(page, `settings/${theme}`);
    await closeVisibleDialog(page);

    const roomButton = page.getByRole("button", { name: /Співати разом|Пить вместе/ });
    await roomButton.click();
    await assertAccessible(page, `online-room/${theme}`);
    await closeVisibleDialog(page);
  }

  await page.goto("/#/karaoke");
  for (const theme of themes) {
    await applyTheme(page, theme);
    await assertAccessible(page, `karaoke/${theme}`);
  }

  await page.goto("/#/editor/mock-song-1");
  for (const theme of themes) {
    await applyTheme(page, theme);
    await assertAccessible(page, `editor/${theme}`);
  }
});

test("settings journey is keyboard-only and restores focus after the modal closes", async ({ page }) => {
  await page.goto("/");
  await closeProcessingModal(page);
  const trigger = page.getByRole("button", {
    name: /Налаштування програми|Настройки программы/
  });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", {
    name: /Налаштування програми|Настройки программы/
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);

  const activeTab = dialog.getByRole("tab", { selected: true });
  await activeTab.focus();
  await page.keyboard.press("ArrowRight");
  const nextTab = dialog.getByRole("tab", { selected: true });
  await expect(nextTab).toBeFocused();

  await page.keyboard.press("Home");
  await expect(dialog.getByRole("tab").first()).toBeFocused();

  const theme = dialog.getByRole("button", { name: /Тема/ });
  await theme.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[role="option"]:focus')).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const option = page.getByRole("option", { name: /Зелена|Зелёная/ });
  await expect(option).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(theme).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
