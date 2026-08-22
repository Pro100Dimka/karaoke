import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { useI18n } from "../../i18n";
import { POLLING_INTERVALS } from "../../runtime-config";
import { Button, Card, Progress, Stack, Typography } from "../../theme/ui";
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
  const loading = data == null && !error;
  const status = data ?? {};
  const downloading = starting || status.state === "downloading";
  const ready = Boolean(status.ready);
  const total = Number(status.total_bytes || status.total || 0);
  const current = Number(status.downloaded_bytes || status.ready_count || 0);
  const Icon = ready ? CheckCircle2 : AlertTriangle;
  const download = async () => {
    setStarting(true);
    setActionError("");
    try {
      await api.downloadAiModels();
      refresh();
    } catch (reason) {
      setActionError(getErrorMessage(reason));
    } finally {
      setStarting(false);
    }
  };
  return (
    <Card sx={{ padding: "1rem", margin: "0 1rem 1rem" }}>
      <Stack gap={0.65}>
        <Stack direction="row" align="center" gap={0.5}>
          {!loading && <Icon size={18} />}
          <Typography sx={{ fontWeight: 800 }}>{t("settings.ai.models.title")}</Typography>
        </Stack>
        <Typography tone="muted" variant="body2">
          {loading
            ? t("settings.loading")
            : ready
              ? t("settings.ai.models.ready")
              : downloading
                ? t("settings.ai.models.downloading", { model: status.current_model || "…" })
                : t("settings.ai.models.missing", {
                    count: status.models?.filter((item) => !item.ready).length ?? 0
                  })}
        </Typography>
        {(loading || downloading || (!ready && total > 0)) && (
          <Progress value={loading || (downloading && !total) ? null : current} max={total || 1} />
        )}
        {(actionError || status.error || error) && (
          <Typography tone="danger" variant="caption">
            {actionError || status.error || getErrorMessage(error)}
          </Typography>
        )}
        {!loading && !ready && (
          <Button
            startIcon={<Download />}
            disabled={downloading}
            onClick={download}
            sx={{ alignSelf: "start" }}
          >
            {t(`settings.ai.models.${downloading ? "buttonDownloading" : "button"}`)}
          </Button>
        )}
      </Stack>
    </Card>
  );
}
