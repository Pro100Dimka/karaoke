# Patches

`patch-package` applies these automatically via the `postinstall` script in
`package.json`. Each entry below explains why the patch exists and what
condition would let it be removed — a patch with no documented reason is a
maintenance trap, since nothing else records what it's protecting against.

## playwright-core+1.62.1.patch

Removes `--remote-debugging-port=0` from the Electron launch arguments that
`playwright-core` passes to `electron.launch()`.

**Why:** Electron 30+ rejects that flag on its raw CLI, and Playwright's
`electron.launch()` no longer works around it
(see [microsoft/playwright#39008](https://github.com/microsoft/playwright/issues/39008)).
Without this patch, launching the Electron app under Playwright for E2E tests
fails outright. The release-e2e harness (`tests/release-e2e/electron-media-auth-harness.cjs`)
sets the same switch itself instead, via
`app.commandLine.appendSwitch("remote-debugging-port", "0")` inside the
Electron main process — Chromium still logs the same
`DevTools listening on ws://...` line Playwright waits for, so nothing else
about the test setup needed to change.

**When to remove:** once Playwright ships a fix for #39008 (or bumps its
minimum supported Electron in a way that resolves it) and a
`patch-package` diff against the updated `playwright-core` version comes back
empty.
