import { useEffect, useRef } from "react";
import useAppSettings from "../hooks/useAppSettings";
import { lightingColor, readLightingMusic } from "../services/keyboardLighting";
import { configureLighting, isElectron, sendLightingFrame } from "../utils/platform";

export default function KeyboardLighting() {
  const { settings } = useAppSettings();
  const latest = useRef(settings);
  latest.current = settings;
  const enabled = !!settings?.keyboard_lighting_enabled;
  useEffect(() => {
    if (!isElectron()) return undefined;
    let cancelled = false,
      busy = false;
    configureLighting(enabled).catch(() => {});
    if (!enabled) return undefined;
    const tick = async () => {
      if (cancelled || busy) return;
      busy = true;
      try {
        const { current } = latest,
          music = readLightingMusic();
        const color = getComputedStyle(document.documentElement)
          .getPropertyValue("--color-primary")
          .trim();
        const theme = current.keyboard_lighting_mode === "theme";
        await sendLightingFrame({
          active: theme || music.active,
          rgb: lightingColor(
            color,
            current.keyboard_lighting_brightness,
            music.level,
            current.keyboard_lighting_mode
          )
        });
      } catch {
        /* Optional peripheral failures never affect audio. */
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, 50);
    const stop = () => {
      cancelled = true;
      clearInterval(timer);
      configureLighting(false).catch(() => {});
    };
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [enabled]);
  return null;
}
