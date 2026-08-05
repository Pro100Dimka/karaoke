import { expect, test } from "@playwright/test";

const VIEWPORT_TOLERANCE = 1;
const INTERNAL_OVERFLOW_TOLERANCE = 8;
const COMPACT_VIEWPORT_WIDTH = 1000;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])'
].join(", ");

async function expectViewportSafe(page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(
    metrics.clientWidth + VIEWPORT_TOLERANCE
  );
}

async function expectElementLayout(
  locator,
  { minWidth = 200, minHeight = 80, requireHorizontalWriting = true } = {}
) {
  await expect(locator).toBeVisible();

  const box = await locator.boundingBox();

  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(minWidth);
  expect(box.height).toBeGreaterThanOrEqual(minHeight);

  const styles = await locator.evaluate((element) => {
    const computed = getComputedStyle(element);

    return {
      display: computed.display,
      visibility: computed.visibility,
      writingMode: computed.writingMode,
      overflowX: computed.overflowX,
      overflowY: computed.overflowY
    };
  });

  expect(styles.display).not.toBe("none");
  expect(styles.visibility).not.toBe("hidden");

  if (requireHorizontalWriting) {
    expect(styles.writingMode).toBe("horizontal-tb");
  }

  return {
    box,
    styles
  };
}

async function expectNoInternalHorizontalOverflow(
  locator,
  tolerance = INTERNAL_OVERFLOW_TOLERANCE
) {
  const metrics = await locator.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(
    metrics.clientWidth + tolerance
  );
}

async function expectFocusTrap(page, dialog) {
  const focusable = dialog.locator(FOCUSABLE_SELECTOR);
  const count = await focusable.count();

  expect(count).toBeGreaterThan(0);

  await focusable.first().focus();

  const iterations = Math.min(count + 3, 20);

  for (let index = 0; index < iterations; index += 1) {
    await page.keyboard.press("Tab");

    const focusState = await dialog.evaluate((element) => ({
      inside: element.contains(document.activeElement),
      activeElement: document.activeElement?.outerHTML?.slice(0, 300) ?? null
    }));

    expect(
      focusState.inside,
      [
        `Фокус вышел из модалки после Tab №${index + 1}.`,
        `Активный элемент: ${focusState.activeElement ?? "не найден"}`
      ].join("\n")
    ).toBe(true);
  }
}

async function expectFormControlsSafe(root, page) {
  const controls = root.locator("input, textarea, select");
  const count = await controls.count();
  const viewport = page.viewportSize();
  const isCompact = (viewport?.width ?? 0) < COMPACT_VIEWPORT_WIDTH;

  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);

    if (!(await control.isVisible())) {
      continue;
    }

    const info = await control.evaluate((element) => ({
      tagName: element.tagName.toLowerCase(),
      type: element.getAttribute("type")?.toLowerCase() ?? "text"
    }));

    const isSmallControl = [
      "checkbox",
      "radio",
      "range",
      "color",
      "file"
    ].includes(info.type);

    if (isSmallControl) {
      const box = await control.boundingBox();

      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);

      continue;
    }

    const minWidth =
      info.tagName === "textarea"
        ? isCompact
          ? 180
          : 300
        : isCompact
          ? 60
          : 100;

    await expectElementLayout(control, {
      minWidth,
      minHeight: info.tagName === "textarea" ? 120 : 24
    });
  }
}

const MODAL_SCENARIOS = [
  {
    id: "application-settings",
    title: "Настройки приложения",

    open: async (page) => {
      await page.getByRole("button", { name: "Настройки приложения" }).click();
    },

    root: (page) =>
      page.getByRole("dialog", {
        name: "Настройки приложения"
      }),

    checks: async (dialog, page) => {
      await expectFormControlsSafe(dialog, page);
    },

    screenshot: true
  },

  {
    id: "song-settings",
    title: "Настройки песни",

    open: async (page) => {
      await page
        .getByRole("button", { name: "Настройки песни" })
        .first()
        .click();
    },

    root: (page) =>
      page.getByRole("dialog", {
        name: "Настройки песни"
      }),

    checks: async (dialog, page) => {
      const textarea = dialog.locator("textarea").first();
      const viewport = page.viewportSize();
      const isCompact = (viewport?.width ?? 0) < COMPACT_VIEWPORT_WIDTH;

      const { styles } = await expectElementLayout(textarea, {
        minWidth: isCompact ? 180 : 300,
        minHeight: 250
      });

      expect(styles.overflowX).not.toBe("scroll");
      expect(styles.overflowY).toMatch(/auto|scroll/);

      await expectNoInternalHorizontalOverflow(textarea);
      await expectFormControlsSafe(dialog, page);
    },

    screenshot: true
  }
];

const PAGE_SCENARIOS = [
  {
    id: "library",

    open: async (page) => {
      await page.goto("/");
      await expect(page.locator(".library-page")).toBeVisible();
    },

    root: (page) => page.locator(".library-page"),

    checks: async (root, page) => {
      await expectFormControlsSafe(root, page);
    },

    screenshot: true
  }
];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(#\/)?$/);
});

for (const scenario of MODAL_SCENARIOS) {
  test.describe(`${scenario.title} modal`, () => {
    test("opens without changing URL", async ({ page }) => {
      const originalUrl = page.url();

      await scenario.open(page);

      const dialog = scenario.root(page);

      await expect(dialog).toBeVisible();
      await expect(page).toHaveURL(originalUrl);
    });

    test("has safe layout", async ({ page }) => {
      await scenario.open(page);

      const dialog = scenario.root(page);

      await expectElementLayout(dialog, {
        minWidth: 280,
        minHeight: 100
      });

      await expectNoInternalHorizontalOverflow(dialog);
      await expectViewportSafe(page);

      if (scenario.checks) {
        await scenario.checks(dialog, page);
      }
    });

    test("locks scrolling and restores it", async ({ page }) => {
      await scenario.open(page);

      const dialog = scenario.root(page);

      await expect(dialog).toBeVisible();

      await expect
        .poll(() => page.evaluate(() => document.body.style.overflow))
        .toBe("hidden");

      await page.keyboard.press("Escape");

      await expect(dialog).toBeHidden();

      await expect
        .poll(() => page.evaluate(() => document.body.style.overflow))
        .not.toBe("hidden");
    });

    test("keeps focus inside", async ({ page }) => {
      await scenario.open(page);

      const dialog = scenario.root(page);

      await expect(dialog).toBeVisible();
      await expectFocusTrap(page, dialog);
    });

    if (scenario.screenshot) {
      test("visual regression", async ({ page }) => {
        test.skip(
          process.env.VISUAL_REGRESSION !== "1",
          "Новый CSS требует явного утверждения эталонных снимков"
        );
        await scenario.open(page);

        const dialog = scenario.root(page);

        await expect(dialog).toBeVisible();

        await expect(dialog).toHaveScreenshot(`${scenario.id}.png`, {
          animations: "disabled",
          maxDiffPixelRatio: 0.01
        });
      });
    }
  });
}

for (const scenario of PAGE_SCENARIOS) {
  test.describe(`${scenario.id} page`, () => {
    test("has safe layout", async ({ page }) => {
      await scenario.open(page);

      const root = scenario.root(page);

      await expectElementLayout(root, {
        minWidth: 280,
        minHeight: 200
      });

      await expectViewportSafe(page);

      if (scenario.checks) {
        await scenario.checks(root, page);
      }
    });

    if (scenario.screenshot) {
      test("visual regression", async ({ page }) => {
        test.skip(
          process.env.VISUAL_REGRESSION !== "1",
          "Новый CSS требует явного утверждения эталонных снимков"
        );
        await scenario.open(page);

        const root = scenario.root(page);

        await expect(root).toBeVisible();

        await expect(root).toHaveScreenshot(`${scenario.id}.png`, {
          animations: "disabled",
          maxDiffPixelRatio: 0.01
        });
      });
    }
  });
}
