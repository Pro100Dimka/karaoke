import { useCallback, useEffect, useState } from "react";
import { api } from "../../../../../api/client";
import { getErrorMessage } from "../../../../../utils/errors";
import { EMPTY_LYRICS } from "../config";
import { buildLyricsData, lyricsToText, parseLyricsText } from "../utils";

export default function useSongLyrics(song) {
  const [lyrics, setLyrics] = useState(EMPTY_LYRICS);
  useEffect(() => {
    let active = true;
    if (song?.status !== "done") {
      setLyrics(EMPTY_LYRICS);
      return () => {
        active = false;
      };
    }
    api
      .getResult(song.id)
      .then((result) => {
        if (!active) return;
        const data = Array.isArray(result?.lyrics_sync)
          ? result.lyrics_sync
          : [];
        setLyrics({ data, text: lyricsToText(data), error: null });
      })
      .catch((error) => {
        if (!active) return;
        setLyrics({ ...EMPTY_LYRICS, error: getErrorMessage(error, null) });
      });
    return () => {
      active = false;
    };
  }, [song?.id, song?.status]);

  const updateText = useCallback((text) => {
    setLyrics((current) => ({ ...current, text, error: null }));
  }, []);

  const save = useCallback(async () => {
    if (!song) return false;
    const lines = parseLyricsText(lyrics.text);
    if (lines.length > lyrics.data.length) {
      setLyrics((current) => ({
        ...current,
        error:
          "Нельзя добавить новые строки без таймингов. Сначала добавьте их при обработке песни."
      }));
      return false;
    }
    try {
      const data = buildLyricsData(lyrics.data, lines);
      await api.updateLyrics(song.id, data);
      setLyrics({ data, text: lyricsToText(data), error: null });
      return true;
    } catch (error) {
      setLyrics((current) => ({
        ...current,
        error: getErrorMessage(error, "Не удалось сохранить текст")
      }));
      return false;
    }
  }, [lyrics.data, lyrics.text, song]);
  return { lyrics, saveLyrics: save, updateLyricsText: updateText };
}
