# Browser UI tests

These tests run the real Vite application against the deterministic mock API.
They cover modal navigation, focus trapping, overflow and basic responsive UI.

Install the browser test dependency once:

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

Then run:

```bash
npm run build:mock
npm run test:e2e
```

The normal application is unchanged. Mock mode is enabled only by `.env.mock`
and the explicit `--mode mock` scripts.
