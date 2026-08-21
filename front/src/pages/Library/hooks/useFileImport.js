import { useCallback, useState } from "react";
import { api } from "../../../api/client";
import { isAmbiguousTransportError } from "../../../api/core";
import useExclusiveAsyncAction from "../../../hooks/useExclusiveAsyncAction";
import { translateSaved } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";

function suggestedIdentity(file, detected = {}) {
  const stem = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim();
  const parts = stem.split(/\s+[-–—]\s+/, 2).map((part) => part.trim());
  return {
    file,
    coverUrl: detected.cover_data_url || "",
    artist: detected.artist || (parts.length === 2 ? parts[0] : ""),
    title: detected.title || (parts.length === 2 ? parts[1] : stem)
  };
}

export default function useLibraryFileImport({ fileInputRef, notify, onStarted }) {
  const { pending, run } = useExclusiveAsyncAction();
  const [review, setReview] = useState(null);

  const openFilePicker = useCallback(() => {
    if (!pending && !review) fileInputRef.current?.click();
  }, [fileInputRef, pending, review]);

  const processApproved = useCallback(
    (approved) =>
      run(async () => {
        for (const item of approved) {
          let song;
          try {
            song = await api.addSong(item.file, item.title, item.artist);
          } catch (error) {
            await notify(
              translateSaved("Не удалось добавить песню: {0}", {
                0: `${item.file.name}: ${getErrorMessage(error)}`
              })
            );
            continue;
          }
          try {
            await api.processSong(song.id);
            onStarted(song);
          } catch (error) {
            if (isAmbiguousTransportError(error)) {
              onStarted(song);
              await notify(
                translateSaved("Песня добавлена, но backend не подтвердил запуск обработки: {0}", {
                  0: getErrorMessage(error)
                })
              );
              continue;
            }
            await api.deleteSong(song.id).catch(() => {});
            await notify(
              translateSaved("Не удалось запустить обработку песни: {0}", {
                0: `${item.file.name}: ${getErrorMessage(error)}`
              })
            );
          }
        }
      }),
    [notify, onStarted, run]
  );

  const advance = useCallback(
    (approved) => {
      setReview((current) => {
        if (!current) return null;
        const index = current.index + 1;
        if (index < current.items.length) return { ...current, index, approved };
        queueMicrotask(() => processApproved(approved));
        return null;
      });
    },
    [processApproved]
  );

  const importFile = useCallback(
    (event) => {
      const input = event.currentTarget;
      const files = Array.from(input.files || []);
      input.value = "";
      if (!files.length) return undefined;
      return run(async () => {
        const items = [];
        for (const file of files) {
          let detected = {};
          try {
            detected = await api.inspectSongIdentity(file);
          } catch {
            // A missing/corrupt tag must not block a valid audio import. The
            // same filename parser remains the deterministic fallback.
          }
          items.push(suggestedIdentity(file, detected));
        }
        setReview({ items, index: 0, approved: [] });
      });
    },
    [run]
  );

  const updateDraft = useCallback((patch) => {
    setReview((current) => {
      if (!current) return null;
      const items = [...current.items];
      items[current.index] = { ...items[current.index], ...patch };
      return { ...current, items };
    });
  }, []);

  const confirmDraft = useCallback(() => {
    if (!review) return;
    const current = review.items[review.index];
    if (!current.title.trim()) return;
    advance([
      ...review.approved,
      { ...current, title: current.title.trim(), artist: current.artist.trim() }
    ]);
  }, [advance, review]);

  const cancelDraft = useCallback(() => {
    if (review) advance(review.approved);
  }, [advance, review]);

  return {
    cancelDraft,
    confirmDraft,
    importFile,
    importing: pending || Boolean(review),
    openFilePicker,
    review,
    updateDraft
  };
}
