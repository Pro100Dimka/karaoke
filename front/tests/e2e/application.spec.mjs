import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  testInfo.errorsInPage = errors;
});

test.afterEach(async ({}, testInfo) => {
  expect(testInfo.errorsInPage).toEqual([]);
});

test("library boots and remains interactive", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".library-song-card")).toHaveCount(2);
  await expect(page.locator(".title-bar")).toBeVisible();

  const search = page.locator('input[type="search"], input[placeholder]').first();
  await search.fill("A&D Voice");
  await expect(page.locator(".library-song-card")).toHaveCount(1);
  await search.fill("");
  await expect(page.locator(".library-song-card")).toHaveCount(2);
});

test("song import enters the visible processing flow", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-song.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("mock audio")
  });
  await expect(page.locator(".processing-modal-body")).toBeVisible();
  await expect(page.locator(".library-song-card")).toHaveCount(3);
});

test("room creation reaches a usable dock even without microphone access", async ({
  page
}) => {
  await page.routeWebSocket(/karaoke-studio-online/, () => {});
  await page.goto("/");
  await page.locator(".library-action-card").first().click();
  const modal = page.locator(".online-room-modal");
  await expect(modal).toBeVisible();
  await modal.locator(".modal-title-action").click();
  await expect(page.locator(".online-room-dock")).toBeVisible();
  await expect(page.locator(".online-room-dock-code")).not.toBeEmpty();
});

test("settings load persisted values and remain navigable", async ({ page }) => {
  await page.goto("/");
  await page.locator(".app-floating-controls > .app-settings-fab").click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[role="tab"]')).toHaveCount(3);
  await dialog.locator('[role="tab"]').last().click();
  await expect(dialog.locator(".settings-neon-card")).toBeVisible();
});

test("ready song opens the complete karaoke workspace", async ({ page }) => {
  await page.goto("/#/karaoke");
  await expect(page.locator(".karaoke-stage")).toBeVisible();
  await expect(page.locator(".karaoke-performance-stage")).toBeVisible();
  await expect(page.locator(".karaoke-transport-area")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator(".karaoke-stage")).toBeVisible();
});

test("melody editor loads notes and supports selection", async ({ page }) => {
  await page.goto("/#/editor/mock-song-1");
  const editor = page.locator(".melody-editor-workspace");
  await expect(editor).toBeVisible();
  await expect(editor.locator(".melody-editor-note")).toHaveCount(2);
  await editor.locator(".melody-editor-note").first().click();
  await expect(editor.locator(".melody-editor-note.is-selected")).toHaveCount(1);
  await page.keyboard.press("Control+s");
  await expect(editor).toBeVisible();
});
