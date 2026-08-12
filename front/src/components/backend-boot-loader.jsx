import { useEffect, useMemo, useState } from "react";

import darkIcon from "../assets/icons/dark.png";
import greenIcon from "../assets/icons/green.png";
import lightIcon from "../assets/icons/light.png";
import violetIcon from "../assets/icons/violet.png";
import { api } from "../api/client";
import { MOCK_API_ENABLED } from "../api/core";
import { getSavedTheme } from "../utils/theme";

const ICONS = { dark: darkIcon, green: greenIcon, light: lightIcon, violet: violetIcon };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default function BackendBootLoader({ children }) {
  const [ready, setReady] = useState(MOCK_API_ENABLED);
  const [theme, setTheme] = useState(() => getSavedTheme());
  const icon = useMemo(() => ICONS[theme] || ICONS.dark, [theme]);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme || getSavedTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (ready) return undefined;
    let cancelled = false;
    const waitForBackend = async () => {
      while (!cancelled) {
        try {
          await api.getHealth();
          if (!cancelled) setReady(true);
          return;
        } catch {
          await sleep(450);
        }
      }
    };
    waitForBackend();
    return () => { cancelled = true; };
  }, [ready]);

  if (ready) return children;

  return (
    <div className="backend-boot-loader" role="status" aria-live="polite">
      <div className="backend-boot-loader__aurora" aria-hidden="true" />
      <svg className="backend-boot-loader__logo" viewBox="0 0 220 220" aria-hidden="true">
        <defs>
          <filter id="backend-loader-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="backend-loader-ring" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="var(--color-primary-hover)" stopOpacity=".95" />
            <stop offset=".66" stopColor="var(--color-primary)" stopOpacity=".5" />
            <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="backend-boot-loader__halo" cx="110" cy="110" r="88" fill="none" stroke="url(#backend-loader-ring)" strokeWidth="3" />
        <circle className="backend-boot-loader__orbit" cx="110" cy="110" r="101" fill="none" stroke="var(--color-primary)" strokeOpacity=".28" strokeWidth="1.5" strokeDasharray="8 14" />
        <image href={icon} x="45" y="45" width="130" height="130" preserveAspectRatio="xMidYMid meet" filter="url(#backend-loader-glow)" />
        <circle className="backend-boot-loader__spark" cx="110" cy="9" r="4.5" fill="var(--color-primary-hover)" />
      </svg>
      <div className="backend-boot-loader__copy">
        <strong>A&amp;D Voice</strong>
        <span>Запускаем локальный сервер…</span>
      </div>
      <div className="backend-boot-loader__dots" aria-hidden="true"><i /><i /><i /></div>
    </div>
  );
}
