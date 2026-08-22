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
import { getSavedTheme } from "../utils/theme";
import { hydrateUiPreferences } from "../utils/ui-preferences";

const icons = { dark: darkIcon, green: greenIcon, light: lightIcon, violet: violetIcon };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default function BackendBootLoader({ children }) {
  const [state, setState] = useState({
    failed: false,
    ready: MOCK_API_ENABLED,
    retry: 0,
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
      for (let attempt = 0; active && attempt < 40; attempt += 1) {
        try {
          await api.getHealth();
          await hydrateUiPreferences(api).catch(() => {});
          if (active) setState((value) => ({ ...value, ready: true }));
          return;
        } catch {
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
          {t(state.failed ? "backend.failed" : "backend.starting")}
        </Typography>
        {state.failed && (
          <Button
            onClick={() =>
              setState((value) => ({ ...value, failed: false, retry: value.retry + 1 }))
            }
          >
            {t("backend.retry")}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
