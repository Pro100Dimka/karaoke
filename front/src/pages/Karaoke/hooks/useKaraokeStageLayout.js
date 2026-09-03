import { useEffect } from "react";
import { getKaraokeStageLayout } from "../utils/layout";

export default function useKaraokeStageLayout(stageRef) {
  useEffect(() => {
    const shell = globalThis.document?.querySelector?.(".karaoke-app-shell");
    const stage = stageRef.current;
    const main = stage?.parentElement;
    if (!shell || !main || !stage) return;

    const sync = () => {
      const currentNavExtra = Number.parseFloat(
        getComputedStyle(shell).getPropertyValue("--karaoke-nav-extra")
      );
      const { navExtra, videoWidth, videoHeight } = getKaraokeStageLayout({
        mainWidth: main.clientWidth,
        mainHeight: main.clientHeight,
        stageWidth: stage.clientWidth,
        stageHeight: stage.clientHeight,
        currentNavExtra
      });

      shell.style.setProperty("--karaoke-nav-extra", `${navExtra}px`);
      stage.style.setProperty("--karaoke-video-width", `${videoWidth}px`);
      stage.style.setProperty("--karaoke-video-height", `${videoHeight}px`);
    };

    const observer = globalThis.ResizeObserver ? new ResizeObserver(sync) : null;
    observer?.observe(main);
    observer?.observe(stage);
    if (!observer) globalThis.addEventListener?.("resize", sync);
    sync();

    return () => {
      observer?.disconnect();
      globalThis.removeEventListener?.("resize", sync);
      shell.style.removeProperty("--karaoke-nav-extra");
      stage.style.removeProperty("--karaoke-video-width");
      stage.style.removeProperty("--karaoke-video-height");
    };
  }, [stageRef]);
}
