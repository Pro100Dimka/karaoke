import { api } from "../../../../api/client";
import { Panel } from "../../../../components/ui";
import { useAppDialog } from "../../../../contexts/AppDialog";
import { usePolling } from "../../../../hooks/usePolling";
import ModelsTable from "./table";

export default function Models() {
  const { data: models = [], error } = usePolling(
    api.listWhisperModels,
    4000,
    []
  );
  const dialogs = useAppDialog();
  return (
    <Panel title="Модели AI — Whisper">
      {error && <p className="text-danger">{error.message}</p>}
      <ModelsTable models={models} dialogs={dialogs} />
      <p className="models-hint text-muted">
        Скачивание идёт в фоне — прогресс-бар недоступен, поскольку Whisper не
        отдаёт процент программно. Статус «Скачана» появится, когда файл модели
        окажется на диске.
      </p>
    </Panel>
  );
}
