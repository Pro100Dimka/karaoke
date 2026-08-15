import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { MOCK_API_ENABLED } from "../api/core";
import darkIcon from "../assets/icons/dark.png";
import greenIcon from "../assets/icons/green.png";
import lightIcon from "../assets/icons/light.png";
import violetIcon from "../assets/icons/violet.png";
import { BACKEND_BOOT_RETRY_MS } from "../runtime-config";
import { translateMessage } from "../i18n";
import { getSavedLanguage } from "../utils/language";
import { getSavedTheme } from "../utils/theme";
import { hydrateUiPreferences } from "../utils/ui-preferences";

const ICONS = { dark: darkIcon, green: greenIcon, light: lightIcon, violet: violetIcon };
const sleep = (ms) =>
  new Promise((resolve) => { setTimeout(resolve, ms); });

export default function BackendBootLoader({ children }) {
  const [ready, setReady] = useState(MOCK_API_ENABLED);
  const [failed, setFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [theme, setTheme] = useState(() => getSavedTheme());
  const icon = useMemo(() => ICONS[theme] || ICONS.dark, [theme]);

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme || getSavedTheme())
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (ready) return undefined;
    let cancelled = false;
    const waitForBackend = async () => {
      for (let attempt = 0; !cancelled && attempt < 40; attempt += 1) {
        try {
          await api.getHealth();
          await hydrateUiPreferences(api).catch(() => {});
          if (!cancelled) setReady(true);
          return;
        } catch {
          await sleep(BACKEND_BOOT_RETRY_MS);
        }
      }
      if (!cancelled) setFailed(true);
    };
    waitForBackend();
    return () => {
      cancelled = true;
    };
  }, [ready, retryToken]);

  if (ready) return children;

  return (
    <div className="backend-boot-loader" role="status" aria-live="polite">
      <div className="backend-boot-loader__aurora" aria-hidden="true" />
      <svg
        className="backend-boot-loader__logo"
        viewBox="0 0 220 220"
        aria-hidden="true"
      >
        <defs>
          <filter
            id="backend-loader-glow"
            x="-80%"
            y="-80%"
            width="260%"
            height="260%"
          >
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="backend-loader-ring" cx="50%" cy="50%" r="50%">
            <stop
              offset="0"
              stopColor="var(--color-primary-hover)"
              stopOpacity=".95"
            />
            <stop
              offset=".66"
              stopColor="var(--color-primary)"
              stopOpacity=".5"
            />
            <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle
          className="backend-boot-loader__halo"
          cx="110"
          cy="110"
          r="88"
          fill="none"
          stroke="url(#backend-loader-ring)"
          strokeWidth="3"
        />
        <circle
          className="backend-boot-loader__orbit"
          cx="110"
          cy="110"
          r="101"
          fill="none"
          stroke="var(--color-primary)"
          strokeOpacity=".28"
          strokeWidth="1.5"
          strokeDasharray="8 14"
        />
        <image
          href={icon}
          x="45"
          y="45"
          width="130"
          height="130"
          preserveAspectRatio="xMidYMid meet"
          filter="url(#backend-loader-glow)"
        />
        <circle
          className="backend-boot-loader__spark"
          cx="110"
          cy="9"
          r="4.5"
          fill="var(--color-primary-hover)"
        />
      </svg>
      <div className="backend-boot-loader__copy">
        <strong>A&amp;D Voice</strong>
        <span>
          {failed
            ? translateMessage(getSavedLanguage(), "backend.failed")
            : translateMessage(getSavedLanguage(), "backend.starting")}
        </span>
        {failed ? (
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setRetryToken((value) => value + 1);
            }}
          >
            {translateMessage(getSavedLanguage(), "backend.retry")}
          </button>
        ) : null}
      </div>
      <div className="backend-boot-loader__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
