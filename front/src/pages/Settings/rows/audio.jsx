import { Volume2 } from "lucide-react";
import LiveSignalWaveform from "../../../components/LiveSignalWaveform";
import { translateSaved } from "../../../i18n/runtime";
import { Stack, Switch } from "../../../theme/ui";

export default function rows({ settings: { audio }, run, tr = translateSaved }) {
  const status = audio.monitorStatus;
  const running = status?.state === "running";
  const input = status?.input_latency_ms;
  const output = status?.output_latency_ms;
  const known = [input, output].every((value) => Number.isFinite(value) && value >= 0);
  const source = status?.latency_source === "asio-driver-report" ? "driver" : "estimate";
  const timed =
    status?.latency_source === "wasapi-stream-report" &&
    Number.isFinite(status?.stream_latency_ms) &&
    status.stream_latency_ms > 0;
  const latency = timed
    ? tr("settings.audio.monitor.compact.sharedTiming", { 0: status.stream_latency_ms.toFixed(3) })
    : known
      ? tr(`settings.audio.monitor.compact.${source}`, {
          0: (input + output).toFixed(3),
          1: input.toFixed(3),
          2: output.toFixed(3)
        })
      : tr("settings.audio.monitor.compact.unavailable");
  return [
    ...[
      ["output_device_id", "settings.audio.output_device_id.label", "outputs"],
      ["input_device_id", "settings.audio.input_device_id.label", "inputs"]
    ].map(([name, label, list]) => ({
      md: 4,
      type: "SelectField",
      tag: `audio.${name}`,
      label: tr(label),
      options: audio.options?.[list] ?? [],
      valueType: "nullable-number"
    })),
    {
      md: 4,
      type: "ButtonField",
      label: tr("settings.audio.speakerTest.label"),
      startIcon: <Volume2 />,
      variant: "outlined",
      disabled: audio.busy,
      onClick: () => run(audio.speaker)
    },
    ...[
      ["volume", "settings.audio.volume.label", 2],
      ["noise_suppression", "settings.audio.noise_suppression.label", 1]
    ].map(([name, label, max]) => ({
      type: "Slider",
      md: 4,
      tag: `audio.${name}`,
      label: tr(label),
      min: 0,
      max,
      step: 0.05,
      formatValue: (value) => `${Math.round(value * 100)}%`
    })),
    {
      md: 4,
      render: () => (
        <Stack>
          <Switch
            label={tr("settings.audio.monitoringEnabled.label")}
            variant="plain"
            checked={!!audio.values?.monitoring_enabled}
            disabled={audio.busy}
            onChange={() => run(() => audio.monitor())}
          />
          <LiveSignalWaveform
            active={status?.state === "running"}
            level={audio.level}
            ariaLabel={tr("settings.audio.microphoneLevel")}
          />
        </Stack>
      )
    },
    {
      type: "Label",
      role: "alert",
      variant: "caption",
      showFor: !!status?.error,
      text: status?.error
    },
    {
      type: "Label",
      role: "alert",
      variant: "caption",
      showFor: !!audio.monitorStatusError,
      text: tr("settings.audio.monitor.status.unavailable")
    },
    {
      type: "Label",
      role: "status",
      variant: "caption",
      showFor: ["starting", "stopping"].includes(status?.state),
      text: tr(`settings.audio.monitor.status.${status?.state ?? "checking"}`)
    },
    {
      md: 6,
      type: "SelectField",
      tag: "audio.asio_driver_name",
      label: tr("settings.audio.audio_driver.label"),
      onSave: audio.selectDriver,
      options: audio.options?.drivers ?? []
    },
    {
      md: 6,
      type: "SelectField",
      tag: "audio.buffer_size",
      tooltip: tr("settings.audio.buffer_size.description"),
      valueType: "number",
      label: tr("settings.audio.buffer_size.label"),
      options: [16, 32, 48, 64, 96, 128, 256, 512, 1024, 2048].map((value) => ({ value, label: String(value) }))
    },
    {
      md: 12,
      type: "Label",
      variant: "caption",
      showFor: running,
      text: tr("settings.audio.monitor.compact.driverName", {
        0:
          status?.mode === "ASIO"
            ? status?.driver || "ASIO"
            : [status?.host_api, status?.mode].filter(Boolean).join(" · ") || "—"
      })
    },
    {
      md: 12,
      type: "Label",
      variant: "caption",
      showFor: running,
      title: tr(
        `settings.audio.monitor.compact.${status?.latency_source === "wasapi-stream-report" ? "shared" : source}Tooltip`
      ),
      text: latency
    },
    {
      type: "ButtonField",
      label: tr("settings.audio.monitor.retry.label"),
      showFor: !!audio.values?.monitoring_enabled,
      disabled: audio.busy || ["starting", "stopping"].includes(status?.state),
      onClick: () => run(() => audio.monitor(true))
    }
  ];
}
