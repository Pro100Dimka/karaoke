import { useCallback, useEffect, useState } from "react";

const isDomFullscreen = () => Boolean(document.fullscreenElement);

export default function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() => isDomFullscreen());

  useEffect(() => {
    const handleDomChange = () => setIsFullscreen(isDomFullscreen());
    document.addEventListener("fullscreenchange", handleDomChange);
    // Electron's native window fullscreen (used so the OS taskbar also
    // disappears, not just the page content) never fires the DOM
    // fullscreenchange event, so the main process reports it separately.
    const unsubscribeElectron = window.electronAPI?.onFullscreenChange?.(setIsFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", handleDomChange);
      unsubscribeElectron?.();
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (window.electronAPI?.toggleFullscreen) {
      Promise.resolve(window.electronAPI.toggleFullscreen()).catch(() => {});
      return;
    }
    const promise = isDomFullscreen()
      ? document.exitFullscreen?.()
      : document.documentElement.requestFullscreen?.();
    Promise.resolve(promise).catch(() => {});
  }, []);

  return { isFullscreen, toggleFullscreen };
}
