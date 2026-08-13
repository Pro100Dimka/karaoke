# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: front\tests\e2e\application.spec.mjs >> library boots and remains interactive
- Location: front\tests\e2e\application.spec.mjs:3:1

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  1 | import { expect, test } from "@playwright/test";
  2 | 
  3 | test("library boots and remains interactive", async ({ page }) => {
> 4 |   await page.goto("/");
    |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  5 |   await expect(page.locator(".app-shell")).toBeVisible();
  6 |   await expect(page.locator(".library-song-card").first()).toBeVisible();
  7 |   await expect(page.locator(".title-bar")).toBeVisible();
  8 | });
  9 | 
```