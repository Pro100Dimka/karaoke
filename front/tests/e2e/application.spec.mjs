import { expect, test } from "@playwright/test";

test.skip(process.env.VITE_USE_MOCK_API === "false", "Mock-API browser scenarios");

test.beforeEach(async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  testInfo.errorsInPage = errors;
});

test.afterEach(async ({}, testInfo) => {
  expect(testInfo.errorsInPage).toEqual([]);
});

async function closeProcessingModal(page) {
  const modal = page.getByRole("dialog", { name: /Обработка песни|Обробка пісні/ });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /Закрыть|Закрити/ }).click();
  await expect(modal).toBeHidden();
}

test("processing modal keeps a visible signal while its audio is not ready", async ({ page }) => {
  await page.goto("/");
  const modal = page.getByRole("dialog", { name: /Обработка песни|Обробка пісні/ });
  const signal = modal.getByRole("progressbar");
  await expect(signal).toBeVisible();
  await expect(signal.locator(".ui-waveform__fallback")).toBeVisible();
  expect((await signal.boundingBox()).height).toBeGreaterThan(0);
});

test("library boots and remains interactive", async ({ page }) => {
  await page.goto("/");
  await closeProcessingModal(page);
  await expect(page.getByRole("banner", { name: "A&D Voice" })).toBeVisible();
  const ready = page.getByText("Тестовая песня", { exact: true });
  const processing = page.getByText("Песня в обработке", { exact: true });
  await expect(ready).toBeVisible();
  await expect(processing).toBeVisible();

  const search = page.getByRole("textbox", { name: /Пошук|Поиск/ });
  await search.fill("A&D Voice");
  await expect(ready).toBeVisible();
  await expect(processing).toBeHidden();
  await search.fill("");
  await expect(processing).toBeVisible();
});

test("library card background stays identical across states and hover", async ({ page }) => {
  await page.goto("/");
  await closeProcessingModal(page);
  const cards = page.locator(".library-song-card");
  await expect(cards).toHaveCount(2);
  const backgrounds = await cards.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundImage));

  expect(new Set(backgrounds).size).toBe(1);
  await expect(cards.first()).not.toHaveAttribute("data-variant");
  await expect(cards.last()).not.toHaveAttribute("data-variant");

  await cards.first().hover();
  expect(await cards.first().evaluate((element) => getComputedStyle(element).backgroundImage)).toBe(backgrounds[0]);
});

test("song import enters the visible processing flow", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-song.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("mock audio")
  });
  const review = page.getByRole("dialog", {
    name: /Подтверждение добавления песни|Підтвердження додавання пісні/
  });
  await expect(review).toBeVisible();
  await review.getByRole("textbox", { name: /Назва пісні|Название песни/ }).fill("E2E song");
  await review.getByRole("button", { name: /Підтвердити|Подтвердить/ }).click();
  const processing = page.getByRole("dialog", { name: /Обработка песни|Обробка пісні/ });
  await expect(processing).toBeVisible();
  await expect(processing.getByRole("progressbar")).toBeVisible();
  await expect(processing.getByRole("heading", { name: "E2E song", exact: true })).toBeVisible();
});

test("room creation reaches a usable dock even without microphone access", async ({ page }) => {
  await page.routeWebSocket(/karaoke-studio-online/, () => {});
  await page.goto("/");
  await closeProcessingModal(page);
  await page.getByRole("button", { name: /Співати разом|Пить вместе/ }).click();
  const modal = page.getByRole("dialog", { name: /Спільне виконання|Совместное исполнение/ });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /Створити кімнату|Создать комнату/ }).click();
  const dock = page.getByRole("region", { name: /Учасники кімнати|Участники комнаты/ });
  await expect(dock.getByRole("button", { name: /Сховати панель кімнати|Скрыть панель комнаты/ })).toBeVisible();
  await expect(dock).toContainText(/[A-F0-9]{8}/);
});

test("settings load persisted values and remain navigable", async ({ page }) => {
  await page.goto("/");
  await closeProcessingModal(page);
  await page.getByRole("button", { name: /Налаштування програми|Настройки программы/ }).click();
  const dialog = page.getByRole("dialog", { name: /Налаштування програми|Настройки программы/ });
  await expect(dialog).toBeVisible();
  const tabs = dialog.getByRole("tab");
  await expect(tabs).toHaveCount(4);
  await expect(dialog.getByRole("textbox").first()).toHaveValue("Тестовый пользователь");
  const theme = dialog.getByRole("button", { name: /Тема/ });
  await theme.click();
  await page.getByRole("option", { name: /Зелена|Зелёная/ }).click();
  await expect(theme).toContainText(/Зелена|Зелёная/);
  await tabs.last().click();
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("button", { name: /Про програму|О программе/ })).toBeVisible();
});

test("ready song opens the complete karaoke workspace", async ({ page }) => {
  await page.goto("/#/karaoke");
  const karaoke = page.locator('[data-role="karaoke"]');
  await expect(karaoke).toBeVisible();
  await expect(karaoke.locator('[data-role="performance-stage"]')).toBeVisible();
  await expect(karaoke.locator('[data-role="karaoke-console"]')).toBeVisible();
  await page.keyboard.press("Space");
  await expect(karaoke).toHaveAttribute("data-playing", "true");
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((audio) => audio.paused)
    )
    .toBe(false);
});

test("melody editor loads notes and supports selection", async ({ page }) => {
  await page.goto("/#/editor/mock-song-1");
  const editor = page.getByRole("main", { name: /Редактор мелодии|Редактор мелодії/ });
  await expect(editor).toBeVisible();
  const notes = editor.locator('[data-role="editor-note"]');
  await expect(notes).toHaveCount(2);
  await notes.first().click();
  await expect(editor.locator('[data-role="editor-note"][data-selected="true"]')).toHaveCount(1);
  await page.keyboard.press("Control+s");
  await expect(editor).toBeVisible();
});

test("melody editor persists a merged note across reopening", async ({ page }) => {
  const editorUrl = "/#/editor/e2e-merge-persistence";
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(editorUrl);
  const editor = page.getByRole("main", { name: /Редактор мелодии|Редактор мелодії/ });
  const notes = editor.locator('[data-role="editor-note"]');
  await expect(notes).toHaveCount(2);

  await notes.first().click();
  await notes.last().click({ modifiers: ["Control"] });
  await expect(editor.locator('[data-role="editor-note"][data-selected="true"]')).toHaveCount(2);

  const merge = editor.getByRole("button", { name: /Объединить|Об'єднати/ });
  await expect(merge).toBeEnabled();
  await merge.click();
  await expect(notes).toHaveCount(1);

  await editor.getByRole("button", { name: /Зберегти|Сохранить/ }).click();
  await editor.getByRole("button", { name: /Назад/ }).click();
  await expect(page.getByRole("banner", { name: "A&D Voice" })).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "/editor/e2e-merge-persistence";
  });
  await expect(page.locator('[data-role="editor-note"]')).toHaveCount(1);
});
