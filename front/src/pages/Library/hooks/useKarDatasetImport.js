import { useCallback, useRef } from "react";
import { api } from "../../../api/client";
import useExclusiveAsyncAction from "../../../hooks/useExclusiveAsyncAction";
import { translateSaved as tr } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";

export default function useKarDatasetImport({ notify }) {
  const inputRef = useRef(null);
  const { pending, run } = useExclusiveAsyncAction();
  const importFiles = useCallback(
    (event) => {
      const input = event.currentTarget;
      const files = [...(input.files || [])];
      input.value = "";
      if (!files.length) return undefined;
      return run(() => api.prepareKarDataset(files)).then(
        (result) => {
          const ready = result.items.filter((item) => item.status === "ready").length;
          const review = result.items.filter((item) => item.status === "review").length;
          const skipped = result.items.filter((item) => item.status === "skipped");
          const failed = result.items.filter((item) => item.status === "error");
          const details = failed.map((item) => `${item.filename}: ${item.error}`).join("\n");
          const skippedDetails = skipped
            .map((item) => `${item.filename}: ${item.error}`)
            .join("\n");
          const detailBlocks = [skippedDetails, details].filter(Boolean);
          return notify(
            tr(
              "Подготовка .kar/.kfn завершена. Готово: {0}, требует проверки: {1}, пропущено: {2}, ошибок: {3}. Папка: {4}{5}",
              {
                0: ready,
                1: review,
                2: skipped.length,
                3: failed.length,
                4: result.output_root,
                5: detailBlocks.length ? `\n\n${detailBlocks.join("\n\n")}` : ""
              }
            )
          );
        },
        (error) =>
          notify(
            tr("Не удалось подготовить данные из .kar/.kfn: {0}", {
              0: getErrorMessage(error)
            })
          )
      );
    },
    [notify, run]
  );
  return {
    inputRef,
    pending,
    importFiles,
    openFilePicker: () => !pending && inputRef.current?.click()
  };
}
