import { useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAppDialog } from "../../contexts/AppDialog";
import { translateSaved as t } from "../../i18n/runtime";
import { Box, Progress, Stack, Typography } from "../../theme/ui";
import EditorControls from "./EditorControls";
import EditorSurface from "./EditorSurface";
import useEditorAudio from "./useEditorAudio";
import useEditorController from "./useEditorController";
import useEditorDocument from "./useEditorDocument";

export default function MelodyEditor() {
  const { songId } = useParams();
  const navigate = useNavigate();
  const { alert: notify, confirm } = useAppDialog();
  const editor = useEditorDocument({ songId, confirm, notify });
  const transportRef = useRef({});
  const controller = useEditorController({
    document: editor.document,
    dispatch: editor.dispatch,
    payload: editor.payload,
    save: editor.save,
    transportRef
  });
  const transport = useEditorAudio({
    autoScroll: controller.autoScroll,
    duration: controller.duration,
    keyboardWidth: controller.keyboardWidth,
    notes: controller.notes,
    notify,
    playbackRate: controller.playbackRate,
    shellRef: controller.shellRef,
    songId: editor.song?.id,
    volumes: controller.volumes,
    zoom: controller.zoom
  });
  transportRef.current = transport;

  if (!editor.song)
    return (
      <Stack align="center" justify="center" sx={{ position: "absolute", inset: 0 }}>
        <Typography tone="muted">{t("Открываем редактор…")}</Typography>
        <Progress />
      </Stack>
    );

  const back = () => {
    transport.pause();
    navigate("/");
  };

  return (
    <Stack
      as="main"
      aria-label={t("Редактор мелодии {0}", { 0: editor.song.title || "" })}
      gap={0}
      sx={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "var(--color-bg-deep)"
      }}
    >
      <EditorControls
        controller={controller}
        onBack={back}
        payload={editor.payload}
        restore={editor.restore}
        save={editor.save}
        saving={editor.saving}
        song={editor.song}
        transport={transport}
      />
      <Box
        as="audio"
        ref={transport.vocalsRef}
        src={transport.urls.vocals}
        preload="metadata"
        sx={{ display: "none" }}
      />
      <Box
        as="audio"
        ref={transport.instrumentalRef}
        src={transport.urls.instrumental}
        preload="metadata"
        onEnded={transport.pause}
        sx={{ display: "none" }}
      />
      {editor.loading ? (
        <Stack align="center" justify="center" sx={{ flex: 1 }}>
          <Typography tone="muted">{t("Загружаем lyricsSync.json…")}</Typography>
          <Progress />
        </Stack>
      ) : editor.payload ? (
        <EditorSurface controller={controller} transport={transport} />
      ) : (
        <Stack align="center" justify="center" sx={{ flex: 1 }}>
          <Typography tone="muted">{t("Не удалось загрузить данные редактора")}</Typography>
        </Stack>
      )}
    </Stack>
  );
}
