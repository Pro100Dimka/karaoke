import { useCallback, useState } from "react";
import { api } from "../../../api/client";
import { isAmbiguousTransportError } from "../../../api/core";
import useExclusiveAsyncAction from "../../../hooks/useExclusiveAsyncAction";
import { translateSaved as tr } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";

const DEFAULT_PROCESSING_MODE = "auto";

const MODES = new Set([DEFAULT_PROCESSING_MODE, "fast", "quality"]);

const normalizeProcessingMode = (value) => (MODES.has(value) ? value : DEFAULT_PROCESSING_MODE);
export const suggestedIdentity = (file, metadata = {}) => {
  const stem = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim();
  const parts = stem.split(/\s+[-–—]\s+/, 2).map((part) => part.trim());
  return {
    file,
    coverUrl: metadata.cover_data_url || "",
    artist: metadata.artist || (parts.length === 2 ? parts[0] : ""),
    title: metadata.title || (parts.length === 2 ? parts[1] : stem),
    processingMode: DEFAULT_PROCESSING_MODE
  };
};

export default function useLibraryFileImport({ fileInputRef, notify, onStarted }) {
  const { pending, run } = useExclusiveAsyncAction();
  const [review, setReview] = useState(null);
  const process = useCallback(
    (items) =>
      run(async () => {
        for (const item of items) {
          let song;
          try {
            song = await api.addSong(item.file, item.title, item.artist);
            await api.processSong(song.id, normalizeProcessingMode(item.processingMode));
            onStarted(song);
          } catch (error) {
            if (song && isAmbiguousTransportError(error)) {
              onStarted(song);
              await notify(
                tr("library.songAddedButBackendDidNotConfirmProcessingStarted", {
                  0: getErrorMessage(error)
                })
              );
            } else {
              if (song) await api.deleteSong(song.id).catch(() => {});
              await notify(
                tr(song ? "library.couldNotStartSongProcessing" : "library.couldNotAddSong", {
                  0: `${item.file.name}: ${getErrorMessage(error)}`
                })
              );
            }
          }
        }
      }),
    [notify, onStarted, run]
  );

  const advance = useCallback(
    (approved) =>
      setReview((current) => {
        if (!current) return null;
        const index = current.index + 1;
        if (index < current.items.length) return { ...current, index, approved };
        queueMicrotask(() => process(approved));
        return null;
      }),
    [process]
  );

  const importFile = useCallback(
    (source) => {
      const input = Array.isArray(source) ? null : source.currentTarget;
      const files = Array.isArray(source) ? source : [...(input.files || [])];
      if (input) input.value = "";
      if (!files.length) return undefined;
      return run(async () => {
        const items = [];
        for (const file of files) {
          let metadata = {};
          try {
            metadata = await api.inspectSongIdentity(file);
          } catch {
            /* filename fallback */
          }
          items.push(suggestedIdentity(file, metadata));
        }
        setReview({ items, index: 0, approved: [] });
      });
    },
    [run]
  );

  const updateDraft = useCallback(
    (patch) =>
      setReview((current) => {
        if (!current) return null;
        const items = current.items.map((item, index) =>
          index === current.index ? { ...item, ...patch } : item
        );
        return { ...current, items };
      }),
    []
  );

  const confirmDraft = useCallback(
    (values) => {
      const draft = review?.items[review.index];
      const item = draft && { ...draft, ...values };
      if (!item?.title.trim()) return;
      advance([
        ...review.approved,
        {
          ...item,
          title: item.title.trim(),
          artist: item.artist.trim()
        }
      ]);
    },
    [advance, review]
  );

  return {
    review,
    importing: pending || Boolean(review),
    importFile,
    updateDraft,
    confirmDraft,
    cancelDraft: () => review && advance(review.approved),
    openFilePicker: () => !pending && !review && fileInputRef.current?.click()
  };
}
