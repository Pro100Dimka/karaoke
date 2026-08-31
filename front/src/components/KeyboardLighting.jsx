import { useEffect, useRef } from "react";
import useAppSettings from "../hooks/useAppSettings";
import {
  lightingColor,
  musicLightingColor,
  readLightingMusic
} from "../services/keyboardLighting";
import { configureLighting, isElectron, sendLightingFrame } from "../utils/platform";

export default function KeyboardLighting() {
  const { settings } = useAppSettings();
  const latest = useRef(settings);
  const animation = useRef({ hue: 0, level: 0, peak: 0.05 });
  latest.current = settings;
  const enabled = !!settings?.keyboard_lighting_enabled;
  useEffect(() => {
    if (!isElectron()) return undefined;
    let cancelled = false,
      busy = false,
      primaryColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-primary")
        .trim();
    const themeObserver = new MutationObserver(() => {
      primaryColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-primary")
        .trim();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"]
    });
    configureLighting(enabled).catch(() => {});
    if (!enabled) {
      themeObserver.disconnect();
      return undefined;
    }
    const tick = async () => {
      if (cancelled || busy) return;
      busy = true;
      try {
        const { current } = latest,
          music = readLightingMusic();
        const theme = current.keyboard_lighting_mode === "theme";
        const rawLevel = Math.min(1, Math.max(0, Number(music.level) || 0));
        const frame = animation.current;
        frame.peak = Math.max(rawLevel, frame.peak * 0.985, 0.025);
        const normalized = Math.min(1, rawLevel / frame.peak);
        const attack = Math.max(0, normalized - frame.level);
        frame.hue = (frame.hue + 0.008 + normalized * 0.025 + attack * 0.14) % 1;
        frame.level += (normalized - frame.level) * (normalized > frame.level ? 0.72 : 0.2);
        await sendLightingFrame({
          active: theme || music.active,
          rgb: theme
            ? lightingColor(primaryColor, current.keyboard_lighting_brightness, 1, "theme")
            : musicLightingColor(
                current.keyboard_lighting_brightness,
                frame.level,
                frame.hue
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
      themeObserver.disconnect();
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
