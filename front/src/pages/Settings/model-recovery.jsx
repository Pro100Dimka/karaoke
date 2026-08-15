import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { POLLING_INTERVALS } from "../../runtime-config";
import { usePolling } from "../../hooks/usePolling";
import { useI18n } from "../../i18n";
import { translateSaved } from "../../i18n/runtime";
import { Button, Card, Progress, Stack, Typography } from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";

function getModelProgressValue(totalBytes, downloadedBytes, downloading, readyCount) {
  if (totalBytes > 0) return downloadedBytes;
  return downloading ? null : readyCount;
}

function getModelStatusText({ ready, downloading, data, missingCount, total, readyCount, t }) {
  if (ready) return t("settings.ai.models.ready");
  if (downloading) {
    return t("settings.ai.models.downloading", {
      model: data?.current_model || t("settings.ai.models.preparing")
    });
  }
  return t("settings.ai.models.missing", { count: missingCount || Math.max(0, total - readyCount) });
}

export default function ModelRecovery() {
  const { t } = useI18n();
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState("");
  const { data, error, refresh } = usePolling(
    api.getAiModelsStatus,
    POLLING_INTERVALS.modelDownload,
    [],
    { shouldContinue: (status) => status?.state === "downloading" }
  );
  const downloading = starting || data?.state === "downloading";
  const ready = data?.ready === true;
  const missing = data?.models?.filter((model) => !model.ready) ?? [];
  const total = data?.total ?? 0;
  const readyCount = data?.ready_count ?? 0;
  const visibleError =
    actionError || data?.error || (error && getErrorMessage(error));
  const downloadedBytes = Number(data?.downloaded_bytes) || 0;
  const totalBytes = Number(data?.total_bytes) || 0;
  const remainingSeconds = Number(data?.remaining_seconds);
  const downloadDetail =
    downloading && totalBytes > 0
      ? translateSaved("{0} / {1} ГБ{2}", {
          0: (downloadedBytes / 1024 ** 3).toFixed(1),
          1: (totalBytes / 1024 ** 3).toFixed(1),
          2:
            remainingSeconds >= 0
              ? translateSaved("· ~{0} мин", { 0: Math.max(1, Math.ceil(remainingSeconds / 60)) })
              : ""
        })
      : "";
  const statusText = getModelStatusText({
    ready,
    downloading,
    data,
    missingCount: missing.length,
    total,
    readyCount,
    t
  });
  const progressValue = getModelProgressValue( totalBytes, downloadedBytes, downloading, readyCount
  );
  const startDownload = async () => {
    setStarting(true);
    setActionError("");
    try {
      await api.downloadAiModels();
      refresh();
    } catch (requestError) {
      setActionError(getErrorMessage(requestError));
    } finally {
      setStarting(false);
    }
  };
  return (
    <Card
      className="settings-neon-card"
      sx={{ margin: "0 1rem 1rem", minWidth: 0 }}
      cardContent={{ style: { padding: "1rem 1.1rem" } }}
    >
      <Stack
        gap={0.65}
        sx={{ minWidth: 0 }}
      >
        <Stack direction="row" align="center" gap={0.55}>
          {ready ? (
            <CheckCircle2 size={18} aria-hidden="true" />
          ) : (
            <AlertTriangle size={18} aria-hidden="true" />
          )}
          <Typography
            variant="body1"
            sx={{ fontWeight: 800 }}
          >
            {t("settings.ai.models.title")}
          </Typography>
        </Stack>

        <Typography
          variant="body2"
          tone="muted"
          sx={{ overflowWrap: "anywhere" }}
        >
          {statusText}
          {downloadDetail ? ` · ${downloadDetail}` : ""}
        </Typography>

        {(downloading || (!ready && total > 0)) && (
          <Progress
            value={progressValue}
            max={totalBytes > 0 ? totalBytes : Math.max(1, total)}
            aria-label={t("settings.ai.models.progress")}
          />
        )}

        {visibleError && (
          <Typography
            tone="danger"
            variant="caption"
            sx={{ overflowWrap: "anywhere" }}
          >
            {visibleError}
          </Typography>
        )}

        {!ready && (
          <Button
            variant="solid"
            onClick={startDownload}
            disabled={downloading}
            sx={{ alignSelf: "start" }}
          >
            <Stack direction="row" align="center" gap={0.5}>
              <Download size={17} aria-hidden="true" />
              <span>
                {downloading
                  ? t("settings.ai.models.buttonDownloading")
                  : t("settings.ai.models.button")}
              </span>
            </Stack>
          </Button>
        )}
      </Stack>
    </Card>
  );
}
