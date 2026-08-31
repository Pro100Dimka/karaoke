import { translateSaved as tr } from "../../i18n/runtime";
import { Button, Select, Stack, Typography } from "../../theme/ui";

export default function MonitorDiagnostics({ audio }) {
  const status = audio.monitorStatus;
  const changing = ["starting", "stopping"].includes(status?.state);
  const states = {
    idle: tr("Выключено"),
    starting: tr("Подключаем микрофон…"),
    stopping: tr("Останавливаем…"),
    running: tr("Микрофон подключён"),
    error: tr("Ошибка подключения")
  };
  return (
    <Stack gap={0.5}>
      <Typography variant="caption" role="status">
        {audio.monitorStatusError
          ? tr("Не удалось получить состояние микрофона")
          : states[status?.state] || tr("Проверяем состояние…")}
      </Typography>
      {status?.error && (
        <Typography variant="caption" role="alert">
          {status.error}
        </Typography>
      )}
      {status?.state === "running" && (
        <Typography variant="caption">
          {status.host_api || status.driver} · {status.mode || "ASIO"} · {tr("Буфер")}:{" "}
          {status.blocksize === 0 ? tr("авто") : (status.blocksize ?? "—")} ·{" "}
          {status.sample_rate ?? "—"} Hz
          {Number.isFinite(status.input_latency_ms) &&
            Number.isFinite(status.output_latency_ms) && (
              <>
                {" "}
                · {tr("Задержка драйвера (вход + выход)")}:{" "}
                {(status.input_latency_ms + status.output_latency_ms).toFixed(1)} ms
              </>
            )}
        </Typography>
      )}
      {status?.input_device && (
        <Typography variant="caption">
          {status.input_device} → {status.output_device}
        </Typography>
      )}
      {Number(status?.fallback_count) > 0 && (
        <Typography variant="caption" role="alert">
          {tr("Драйвер перешёл на резервный режим. Задержка может увеличиться.")}{" "}
          {status.fallback_reason}
        </Typography>
      )}
      {audio.values.audio_driver !== "asio" && (
        <>
          <Select
            label={tr("Режим WASAPI при следующем запуске")}
            value={audio.wasapiMode}
            onChange={audio.setWasapiMode}
            options={[
              { value: "shared", label: tr("Совместный — звук других приложений доступен") },
              { value: "input-exclusive", label: tr("Эксклюзивный микрофон, совместный выход") },
              { value: "exclusive", label: tr("Полностью эксклюзивный — только мониторинг") }
            ]}
          />
          {audio.wasapiMode !== "shared" && (
            <Typography variant="caption">
              {tr(
                "Exclusive может занять устройство и помешать записи или комнате. Полный exclusive также может отключить минусовку. При отказе драйвера включится совместный режим."
              )}
            </Typography>
          )}
          <Select
            label={tr("Запрошенный буфер мониторинга")}
            value={Math.max(128, Number(audio.values.buffer_size) || 128)}
            onChange={(value) => audio.update("buffer_size", Number(value))}
            options={[128, 256, 512, 1024, 2048].map((value) => ({ value, label: String(value) }))}
          />
          <Typography variant="caption">
            {tr(
              "Меньше буфер — меньше задержка, но выше риск треска. Изменение буфера перезапускает прослушивание. Это не измерение полной задержки голоса."
            )}
          </Typography>
        </>
      )}
      {audio.values.monitoring_enabled && (
        <Button disabled={audio.busy || changing} onClick={() => audio.monitor(true)}>
          {tr("Повторить подключение")}
        </Button>
      )}
      {audio.suggestAsio && (
        <>
          <Typography variant="caption">
            {tr(
              "Повторяются сбои аудио. Приложение не обнаружило ASIO-драйверов. ASIO4ALL можно установить самостоятельно; снижение задержки не гарантируется."
            )}
          </Typography>
          <Button
            onClick={() =>
              globalThis.open(
                "https://asio4all.org/about/download-asio4all/",
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            {tr("ASIO4ALL: официальный сайт")}
          </Button>
        </>
      )}
    </Stack>
  );
}
