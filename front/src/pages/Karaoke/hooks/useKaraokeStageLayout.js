import { useEffect } from "react";
import { getKaraokeStageLayout } from "../utils/layout";

export default function useKaraokeStageLayout(stageRef) {
  useEffect(() => {
    const shell = document.querySelector(".karaoke-app-shell");
    const stage = stageRef.current;
    const main = stage?.parentElement;
    if (!shell || !main || !stage) return undefined;

    const syncStageAspect = () => {
      const currentExtra = Number.parseFloat(
        getComputedStyle(shell).getPropertyValue("--karaoke-nav-extra")
      );
      const layout = getKaraokeStageLayout({
        mainWidth: main.clientWidth,
        mainHeight: main.clientHeight,
        stageWidth: stage.clientWidth,
        stageHeight: stage.clientHeight,
        currentNavExtra: currentExtra
      });

      shell.style.setProperty("--karaoke-nav-extra", `${layout.navExtra}px`);
      stage.style.setProperty("--karaoke-video-width", `${layout.videoWidth}px`);
      stage.style.setProperty("--karaoke-video-height", `${layout.videoHeight}px`);
    };

    const observer = new ResizeObserver(syncStageAspect);
    observer.observe(main);
    observer.observe(stage);
    syncStageAspect();

    return () => {
      observer.disconnect();
      shell.style.removeProperty("--karaoke-nav-extra");
      stage.style.removeProperty("--karaoke-video-width");
      stage.style.removeProperty("--karaoke-video-height");
    };
  }, [stageRef]);
}
