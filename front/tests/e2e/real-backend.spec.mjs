import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.skip(process.env.VITE_USE_MOCK_API !== "false", "Requires test:e2e:real");

const backendUrl = process.env.VITE_API_BASE_URL;
const headers = { "X-ADVoice-Token": process.env.VITE_API_TOKEN };

test("real backend imports a processed song and opens editor and karaoke", async ({ page, request }) => {
  const health = await request.get(`${backendUrl}/diagnostics/health`, { headers });
  expect(health.ok()).toBeTruthy();

  const packageBuffer = await readFile(process.env.ADVOICE_E2E_PACKAGE);
  const imported = await request.post(`${backendUrl}/songs/package/import`, {
    headers,
    multipart: {
      file: {
        name: "real-song.karaoke.zip",
        mimeType: "application/zip",
        buffer: packageBuffer
      }
    }
  });
  expect(imported.status()).toBe(201);
  const song = await imported.json();
  expect(song.status).toBe("done");

  const editorApi = await request.get(`${backendUrl}/songs/${song.id}/editor`, { headers });
  expect(editorApi.ok()).toBeTruthy();
  expect((await editorApi.json()).lyrics_sync.words[0].text).toBe("la");

  await page.goto(`/editor/${song.id}`);
  await expect(page.getByRole("main", { name: /Real backend E2E/ })).toBeVisible();
  await expect(page.locator('[data-role="editor-note"]')).toHaveCount(1);

  await page.goto("/");
  const card = page.getByRole("button", { name: /Real backend E2E/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('[data-role="karaoke"]')).toBeVisible({ timeout: 10_000 });
});
