import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { useI18n } from "../../i18n";
import { translateSaved as tr } from "../../i18n/runtime";
import { POLLING_INTERVALS } from "../../runtime-config";
import { Button, Progress, Stack, Typography } from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";

const GB = 1024 ** 3;

export default function ModelRecovery() {
  const { t } = useI18n();
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState("");
  const { data, error, refresh } = usePolling(
    api.getAiModelsStatus,
    POLLING_INTERVALS.modelDownload,
    [],
    { shouldContinue: ({ state } = {}) => state === "downloading" }
  );
  const {
    state,
    ready = false,
    models = [],
    total = 0,
    ready_count: readyCount = 0,
    downloaded_bytes: downloadedRaw = 0,
    total_bytes: totalRaw = 0,
    remaining_seconds: remainingRaw,
    current_model: currentModel,
    error: modelError
  } = data ?? {};
  const downloading = starting || state === "downloading";
  const missingCount = models.filter(({ ready }) => !ready).length;
  const downloadedBytes = Number(downloadedRaw) || 0;
  const totalBytes = Number(totalRaw) || 0;
  const remainingSeconds = Number(remainingRaw);
  const visibleError = actionError || modelError || (error ? getErrorMessage(error) : "");
  const statusText = ready
    ? t("settings.ai.models.ready")
    : downloading
      ? t("settings.ai.models.downloading", {
          model: currentModel || t("settings.ai.models.preparing")
        })
      : t("settings.ai.models.missing", {
          count: missingCount || Math.max(0, total - readyCount)
        });
  const downloadDetail =
    downloading &&
    totalBytes > 0 &&
    tr("{0} / {1} ГБ{2}", {
      0: (downloadedBytes / GB).toFixed(1),
      1: (totalBytes / GB).toFixed(1),
      2:
        remainingSeconds >= 0
          ? tr(" · ~{0} мин", {
              0: Math.max(1, Math.ceil(remainingSeconds / 60))
            })
          : ""
    });
  const progressValue = totalBytes ? downloadedBytes : downloading ? null : readyCount;
  const startDownload = async () => {
    setStarting(true);
    setActionError("");
    try {
      await api.downloadAiModels();
      refresh();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setStarting(false);
    }
  };
  const StatusIcon = ready ? CheckCircle2 : AlertTriangle;
  return (
    <Stack gap={0.65}>
      <Stack direction="row" align="center" gap={0.55}>
        <StatusIcon size={18} aria-hidden />
        <Typography variant="body1" sx={{ fontWeight: 800 }}>
          {t("settings.ai.models.title")}
        </Typography>
      </Stack>
      <Typography variant="body2" tone="muted" sx={{ overflowWrap: "anywhere" }}>
        {statusText}
        {downloadDetail && ` · ${downloadDetail}`}
      </Typography>
      {(downloading || (!ready && total > 0)) && (
        <Progress
          value={progressValue}
          max={totalBytes || Math.max(1, total)}
          aria-label={t("settings.ai.models.progress")}
        />
      )}
      {visibleError && (
        <Typography tone="danger" variant="caption" sx={{ overflowWrap: "anywhere" }}>
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
            <Download size={17} aria-hidden />

            <span>{t(`settings.ai.models.${downloading ? "buttonDownloading" : "button"}`)}</span>
          </Stack>
        </Button>
      )}
    </Stack>
  );
}
