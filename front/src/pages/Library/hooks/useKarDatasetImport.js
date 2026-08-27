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
          const failed = result.items.filter((item) => item.status === "error");
          const details = failed.map((item) => `${item.filename}: ${item.error}`).join("\n");
          return notify(
            tr(
              "Подготовка .kar завершена. Готово: {0}, требует проверки: {1}, ошибок: {2}. Папка: {3}{4}",
              {
                0: ready,
                1: review,
                2: failed.length,
                3: result.output_root,
                4: details ? `\n\n${details}` : ""
              }
            )
          );
        },
        (error) =>
          notify(
            tr("Не удалось подготовить данные из .kar: {0}", {
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
