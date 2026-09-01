import { useEffect, useRef } from "react";
import useAppSettings from "../hooks/useAppSettings";
import {
  advanceMusicLighting,
  lightingColor,
  readLightingMusic,
  sameLightingPalette
} from "../services/keyboardLighting";
import { configureLighting, isElectron, sendLightingFrame } from "../utils/platform";

export default function KeyboardLighting() {
  const { settings } = useAppSettings();
  const latest = useRef(settings);
  const animation = useRef();
  latest.current = settings;
  const enabled = !!settings?.keyboard_lighting_enabled;
  useEffect(() => {
    if (!isElectron()) return undefined;
    let cancelled = false,
      busy = false,
      palette = readThemePalette();
    const themeObserver = new MutationObserver(() => {
      const nextPalette = readThemePalette();
      if (!sameLightingPalette(palette, nextPalette)) {
        palette = nextPalette;
        animation.current = undefined;
      }
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
        const frame = advanceMusicLighting(
          animation.current,
          music,
          palette,
          current.keyboard_lighting_brightness,
          80
        );
        animation.current = frame.state;
        await sendLightingFrame({
          // While the feature is enabled we retain hardware control. Sending
          // inactive during a quiet passage restores the keyboard's onboard
          // rainbow animation, which looks like an unrelated RGB flash.
          active: true,
          rgb: theme
            ? lightingColor(palette[0], current.keyboard_lighting_brightness, 1, "theme")
            : frame.rgb
        });
      } catch {
        /* Optional peripheral failures never affect audio. */
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, 80);
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

function readThemePalette() {
  const style = getComputedStyle(document.documentElement);
  return ["--color-primary", "--color-secondary"].map((name) =>
    style.getPropertyValue(name).trim()
  );
}
