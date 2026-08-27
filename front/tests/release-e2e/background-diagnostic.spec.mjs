import { test, _electron as electron } from "@playwright/test";

test("diagnose packaged library background", async () => {
  const executablePath = process.env.ADVOICE_TEST_EXE;
  if (!executablePath) throw new Error("ADVOICE_TEST_EXE is required");

  const app = await electron.launch({ executablePath });
  try {
    const page = await app.firstWindow();
    await page.waitForTimeout(6000);
    const result = await page.evaluate(() => {
      const themeLayer = document.querySelector("[data-library-theme-background]");
      const frame = document.querySelector(".qft-original-frame");
      const frameDocument = frame?.contentDocument;
      const read = (element) => element ? {
        background: getComputedStyle(element).background,
        backgroundColor: getComputedStyle(element).backgroundColor,
        backgroundImage: getComputedStyle(element).backgroundImage,
      } : null;
      return {
        url: location.href,
        theme: document.documentElement.dataset.theme,
        root: read(document.documentElement),
        body: read(document.body),
        themeLayer: read(themeLayer),
        frame: read(frame),
        frameRoot: read(frameDocument?.documentElement),
        frameBody: read(frameDocument?.body),
        frameReady: frameDocument?.readyState,
      };
    });
    console.log("BACKGROUND_DIAGNOSTIC", JSON.stringify(result, null, 2));
    await page.screenshot({ path: "../generated/tests/packaged-background-before.png" });
  } finally {
    await app.close();
  }
});
