import { expect, test } from "@playwright/test";

test.skip(process.env.VITE_USE_MOCK_API === "false", "Mock-API desktop geometry matrix");

const profiles = [
  { name: "1920x1080-100", physical: [1920, 1080], scale: 1 },
  { name: "1920x1080-125", physical: [1920, 1080], scale: 1.25 },
  { name: "1920x1080-150", physical: [1920, 1080], scale: 1.5 },
  { name: "2560x1440-200", physical: [2560, 1440], scale: 2 }
];

const logicalViewport = ({ physical: [width, height], scale }) => ({
  width: Math.floor(width / scale),
  height: Math.floor(height / scale)
});

async function expectInsideViewport(page, locator) {
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.y).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
}

test("critical desktop UI stays visible across the Windows DPI matrix", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);

  for (const profile of profiles) {
    const context = await browser.newContext({
      deviceScaleFactor: profile.scale,
      viewport: logicalViewport(profile)
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4173/");

    const processing = page.getByRole("dialog", { name: /Обработка песни|Обробка пісні/ });
    await processing.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    if (await processing.isVisible()) {
      await page.keyboard.press("Escape");
      await expect(processing).toBeHidden();
    }

    await page.getByRole("button", { name: /Налаштування програми|Настройки программы/ }).click();
    const settings = page.getByRole("dialog", {
      name: /Налаштування програми|Настройки программы/
    });
    await expectInsideViewport(page, settings);
    await testInfo.attach(`settings-${profile.name}`, {
      body: await page.screenshot(),
      contentType: "image/png"
    });

    await page.keyboard.press("Escape");
    await page.goto("http://127.0.0.1:4173/#/editor/mock-song-1");
    const editor = page.getByRole("main", { name: /Редактор мелодії|Редактор мелодии/ });
    await expect(editor).toBeVisible();
    await expectInsideViewport(page, editor);
    await testInfo.attach(`editor-${profile.name}`, {
      body: await page.screenshot(),
      contentType: "image/png"
    });

    await page.goto("http://127.0.0.1:4173/#/karaoke");
    const pianoRoll = page.locator('[data-role="piano-roll-canvas"]');
    await expect(pianoRoll).toBeVisible();
    await expectInsideViewport(page, pianoRoll);
    const canvas = pianoRoll.locator("canvas").first();
    await expect(canvas).toBeVisible();
    const pixels = await canvas.evaluate((element) => ({
      bitmapHeight: element.height,
      bitmapWidth: element.width,
      cssHeight: element.clientHeight,
      cssWidth: element.clientWidth
    }));
    expect(pixels.bitmapWidth).toBeGreaterThanOrEqual(pixels.cssWidth);
    expect(pixels.bitmapHeight).toBeGreaterThanOrEqual(pixels.cssHeight);
    await testInfo.attach(`karaoke-${profile.name}`, {
      body: await page.screenshot(),
      contentType: "image/png"
    });
    await context.close();
  }
});
