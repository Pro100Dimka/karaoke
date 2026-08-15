import { useEffect, useState } from "react";
import { api } from "../../../../api/client";
import { persistUiPreferences } from "../../../../utils/ui-preferences";
import { editorPreferences } from "./melody-editor-state";

export default function useMelodyEditorPreferences() {
  const [zoom, setZoom] = useState(() => Number(editorPreferences().zoom) || 68);
  const [verticalZoom, setVerticalZoom] = useState(
    () => Number(editorPreferences().verticalZoom) || 14
  );
  const [autoScroll, setAutoScroll] = useState(() => editorPreferences().autoScroll ?? true);
  const [playbackRate, setPlaybackRate] = useState(
    () => Number(editorPreferences().playbackRate) || 1
  );
  const [volumes, setVolumes] = useState(() => ({
    vocals: Number(editorPreferences().volumes?.vocals ?? 0.7),
    melody: Number(editorPreferences().volumes?.melody ?? 0.9),
    instrumental: Number(editorPreferences().volumes?.instrumental ?? 0.45)
  }));

  useEffect(() => {
    persistUiPreferences(api, "melody_editor", {
      zoom,
      verticalZoom,
      autoScroll,
      playbackRate,
      volumes
    });
  }, [autoScroll, playbackRate, verticalZoom, volumes, zoom]);

  return {
    autoScroll,
    playbackRate,
    setAutoScroll,
    setPlaybackRate,
    setVerticalZoom,
    setVolumes,
    setZoom,
    verticalZoom,
    volumes,
    zoom
  };
}
