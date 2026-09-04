import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { useI18n } from "../../i18n";
import { POLLING_INTERVALS } from "../../runtime-config";
import { Button, Progress, Stack, Typography } from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";

export default function ModelStatus() {
  const { t } = useI18n();
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState("");
  const { data, error, refresh } = usePolling(
    api.getAiModelsStatus,
    POLLING_INTERVALS.modelDownload,
    [],
    { shouldContinue: ({ state } = {}) => state === "downloading" }
  );
  const s = data ?? {};
  const loading = !data && !error;
  const ready = !!s.ready;
  const downloading = starting || s.state === "downloading";
  const total = +(s.total_bytes || s.total || 0);
  const current = +(s.downloaded_bytes || s.ready_count || 0);
  const Icon = ready ? CheckCircle2 : AlertTriangle;
  const failure = actionError || s.error || (error && getErrorMessage(error));
  const download = async () => {
    setStarting(true);
    setActionError("");
    try {
      await api.downloadAiModels();
      refresh();
    } catch (e) {
      setActionError(getErrorMessage(e));
    } finally {
      setStarting(false);
    }
  };
  const state = ready ? "ready" : downloading ? "downloading" : "missing";
  return (
    <Stack gap={0.65}>
      <Stack direction="row" align="center" gap={0.5}>
        {!loading && <Icon size={18} />}
        <Typography sx={{ fontWeight: 800 }}>{t("settings.ai.models.title")}</Typography>
      </Stack>
      <Typography tone="muted" variant="body2">
        {loading
          ? t("settings.loading")
          : t(`settings.ai.models.${state}`, {
              model: s.current_model || "…",
              count: s.models?.filter((m) => !m.ready).length ?? 0
            })}
      </Typography>
      {(loading || downloading || (!ready && total > 0)) && (
        <Progress value={loading || (downloading && !total) ? null : current} max={total || 1} />
      )}
      {failure && (
        <Typography tone="danger" variant="caption">
          {failure}
        </Typography>
      )}
      {!loading && !ready && (
        <Button
          sx={{ alignSelf: "start" }}
          variant="contained"
          startIcon={<Download />}
          disabled={downloading}
          onClick={download}
        >
          {t(`settings.ai.models.${downloading ? "buttonDownloading" : "button"}`)}
        </Button>
      )}
    </Stack>
  );
}
