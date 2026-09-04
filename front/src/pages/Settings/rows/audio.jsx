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
  // Priority: an actually-measured mic-to-speaker round trip (driver ADC/DAC
  // timestamps, covers the whole DSP path) beats the WASAPI stream's own
  // requested-buffer-size figure, which in turn beats the driver-reported
  // input+output estimate -- each is a coarser fallback for hosts/engines
  // that don't report the one above it.
  const measured = Number.isFinite(status?.real_latency_ms) && status.real_latency_ms > 0;
  const timed =
    !measured &&
    status?.latency_source === "wasapi-stream-report" &&
    Number.isFinite(status?.stream_latency_ms) &&
    status.stream_latency_ms > 0;
  const latency = measured
    ? tr("settings.audio.monitor.compact.measured", { 0: status.real_latency_ms.toFixed(3) })
    : timed
      ? tr("settings.audio.monitor.compact.sharedTiming", {
          0: status.stream_latency_ms.toFixed(3)
        })
      : known
        ? tr(`settings.audio.monitor.compact.${source}`, {
            0: (input + output).toFixed(3),
            1: input.toFixed(3),
            2: output.toFixed(3)
          })
        : tr("settings.audio.monitor.compact.unavailable");
  const negotiatedPeriod =
    Number.isFinite(status?.input_period_frames) && Number.isFinite(status?.output_period_frames)
      ? tr("settings.audio.monitor.compact.negotiatedPeriod", {
          0: status.input_period_frames,
          1: status.output_period_frames,
          2: status?.sample_rate ?? "—"
        })
      : null;
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
    ...[["volume", "settings.audio.volume.label", 2]].map(([name, label, max]) => ({
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
        <Stack direction="row" align="center" gap={1}>
          <LiveSignalWaveform
            active={status?.state === "running"}
            level={audio.level}
            ariaLabel={tr("settings.audio.microphoneLevel")}
          />
          <Switch
            label={tr("settings.audio.monitoringEnabled.label")}
            variant="plain"
            checked={!!audio.values?.monitoring_enabled}
            disabled={audio.busy}
            onChange={() => run(() => audio.monitor())}
          />
        </Stack>
      )
    },
    {
      md: 4,
      type: "SelectField",
      tag: "audio.buffer_size",
      tooltip: tr("settings.audio.buffer_size.description"),
      valueType: "number",
      label: tr("settings.audio.buffer_size.label"),
      options: [16, 32, 48, 64, 96, 128, 256, 512, 1024, 2048].map((value) => ({
        value,
        label: value
      }))
    },
    {
      md: 12,
      type: "SelectField",
      tag: "audio.asio_driver_name",
      label: tr("settings.audio.audio_driver.label"),
      onSave: audio.selectDriver,
      options: audio.options?.drivers ?? []
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
      md: 12,
      type: "Label",
      variant: "caption",
      tone: "muted",
      // buffer_size above is only what was requested; Windows/the driver can
      // negotiate a different period, and that's what actually applies.
      showFor: running && !!negotiatedPeriod,
      text: negotiatedPeriod
    },
    {
      md: 6,
      type: "Label",
      variant: "caption",
      showFor: running,
      title: tr(
        `settings.audio.monitor.compact.${status?.latency_source === "wasapi-stream-report" ? "shared" : source}Tooltip`
      ),
      text: latency
    },
    {
      md: 6,
      type: "Label",
      variant: "caption",
      showFor: running,
      text: tr("settings.audio.monitor.compact.driverName", {
        0:
          status?.mode === "ASIO"
            ? status?.driver || "ASIO"
            : [status?.host_api, status?.mode].filter(Boolean).join(" · ") || "—"
      })
    }
  ];
}
