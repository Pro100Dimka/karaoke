import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MOCK_API_ENABLED } from "../api/core";
import darkIcon from "../assets/icons/dark.png";
import greenIcon from "../assets/icons/green.png";
import lightIcon from "../assets/icons/light.png";
import violetIcon from "../assets/icons/violet.png";
import { translateMessage } from "../i18n";
import { BACKEND_BOOT_RETRY_MS } from "../runtime-config";
import { Button, Box, Stack, Typography } from "../theme/ui";
import { getSavedLanguage } from "../utils/language";
import { recordStartupMilestone } from "../utils/platform";
import { getSavedTheme } from "../utils/theme";
import { hydrateUiPreferences } from "../utils/ui-preferences";

const icons = { dark: darkIcon, green: greenIcon, light: lightIcon, violet: violetIcon };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A fresh install's backend executable is large (bundled Python/AI runtime),
// so on first launch antivirus real-time scanning can hold up the very first
// connection well past what a normal startup takes. Budget generously for
// that one-off delay rather than declaring the backend dead too eagerly, but
// tell the user why it's taking a while instead of leaving a bare spinner.
const MAX_STARTUP_ATTEMPTS = 160;
const SLOW_STARTUP_AFTER_ATTEMPTS = 18;

export default function BackendBootLoader({ children }) {
  const [state, setState] = useState({
    failed: false,
    ready: MOCK_API_ENABLED,
    retry: 0,
    slow: false,
    startup: null,
    theme: getSavedTheme()
  });
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setState((value) => ({
        ...value,
        theme: document.documentElement.dataset.theme || getSavedTheme()
      }))
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (state.ready) return undefined;
    let active = true;
    (async () => {
      for (let attempt = 0; active && attempt < MAX_STARTUP_ATTEMPTS; attempt += 1) {
        try {
          const health = await api.getHealth();
          if (health.startup && !health.startup.ready && !health.startup.interactive) {
            if (health.startup.error) {
              if (active)
                setState((value) => ({ ...value, failed: true, startup: health.startup }));
              return;
            }
            if (active) {
              setState((value) => ({
                ...value,
                slow: value.slow || !!health.startup.budget_exceeded,
                startup: health.startup
              }));
            }
            await wait(BACKEND_BOOT_RETRY_MS);
            continue;
          }
          recordStartupMilestone("backend-healthy");
          await hydrateUiPreferences(api).catch(() => {});
          if (active) setState((value) => ({ ...value, ready: true }));
          return;
        } catch {
          if (active && attempt >= SLOW_STARTUP_AFTER_ATTEMPTS) {
            setState((value) => (value.slow ? value : { ...value, slow: true }));
          }
          await wait(BACKEND_BOOT_RETRY_MS);
        }
      }
      if (active) setState((value) => ({ ...value, failed: true }));
    })();
    return () => {
      active = false;
    };
  }, [state.ready, state.retry]);
  if (state.ready) return children;
  const t = (key) => translateMessage(getSavedLanguage(), key);
  const phase = state.startup?.phase;
  const phaseText = phase ? t(`backend.starting.phase.${phase}`) : null;
  return (
    <Stack
      role="status"
      aria-live="polite"
      align="center"
      justify="center"
      gap="var(--space-5)"
      sx={{ minBlockSize: "100vh", background: "var(--color-bg-deep)" }}
    >
      <Box
        as="img"
        src={icons[state.theme] || icons.dark}
        alt=""
        sx={{
          inlineSize: "min(24vw, 10rem)",
          filter: "drop-shadow(0 0 var(--space-5) var(--color-primary))"
        }}
      />
      <Stack align="center" gap="var(--space-2)">
        <Typography variant="h1">A&amp;D Voice</Typography>
        <Typography tone="muted">
          {t(
            state.failed
              ? "backend.failed"
              : state.slow
                ? "backend.starting.slow"
                : "backend.starting"
          )}
        </Typography>
        {!state.failed && phaseText && (
          <Typography tone="muted">
            {phaseText} · {state.startup.progress}%
          </Typography>
        )}
        {state.failed && (
          <Button
            variant="contained"
            onClick={() =>
              setState((value) => ({
                ...value,
                failed: false,
                slow: false,
                retry: value.retry + 1
              }))
            }
          >
            {t("backend.retry")}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
