import { Volume2 } from "lucide-react";
import LiveSignalWaveform from "../../../components/LiveSignalWaveform";
import { translateSaved } from "../../../i18n/runtime";
import { Stack, Switch } from "../../../theme/ui";

export default function rows({ settings: { audio }, run, tr = translateSaved }) {
  const status = audio.monitorStatus;
  const wasapi = audio.values?.audio_driver !== "asio";
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
      showFor: Number(status?.fallback_count) > 0,
      text: `${tr("settings.audio.monitor.fallback")} ${status?.fallback_reason ?? ""}`
    },
    {
      md: 6,
      type: "SelectField",
      tag: "monitor.wasapiMode",
      ...(wasapi &&
        audio.wasapiMode !== "shared" && {
          tooltip: tr("settings.audio.wasapiMode.warning")
        }),
      showFor: wasapi,
      label: tr("settings.audio.wasapiMode.label"),
      onSave: audio.setWasapiMode,
      options: [
        { value: "shared", label: tr("settings.audio.wasapiMode.options.shared") },
        { value: "input-exclusive", label: tr("settings.audio.wasapiMode.options.inputExclusive") },
        { value: "exclusive", label: tr("settings.audio.wasapiMode.options.exclusive") }
      ]
    },
    {
      md: 6,
      type: "SelectField",
      tag: "audio.buffer_size",
      tooltip: tr("settings.audio.buffer_size.description"),
      showFor: wasapi,
      valueType: "number",
      label: tr("settings.audio.buffer_size.label"),
      options: [128, 256, 512, 1024, 2048].map((value) => ({ value, label: String(value) }))
    },
    {
      md: 12,
      type: "Switch",
      tag: "monitor.autoBuffer",
      showFor: wasapi,
      label: tr("settings.audio.monitor.autoBuffer.label"),
      tooltip: tr("settings.audio.monitor.autoBuffer.tooltip"),
      onSave: audio.setAutoBuffer
    },
    {
      type: "Label",
      variant: "caption",
      showFor: status?.state === "running",
      text: `${status?.host_api || status?.driver} · ${status?.mode || "ASIO"} · ${tr("settings.audio.monitor.buffer.label")}: ${status?.blocksize === 0 ? tr("settings.audio.monitor.buffer.auto") : (status?.blocksize ?? "—")} · ${status?.sample_rate ?? "—"} Hz${
        Number.isFinite(status?.input_latency_ms) && Number.isFinite(status?.output_latency_ms)
          ? ` · ${tr("settings.audio.monitor.latency.label")}: ${(status.input_latency_ms + status.output_latency_ms).toFixed(1)} ms`
          : ""
      }`
    },
    {
      type: "Label",
      variant: "caption",
      showFor: !!status?.input_device,
      text: `${status?.input_device} → ${status?.output_device}`
    },
    {
      type: "Label",
      variant: "caption",
      showFor: status?.state === "running" && status?.engine === "wasapi-split",
      text: tr("settings.audio.monitor.splitEngine.label")
    },
    ...[
      ["input_latency_ms", "settings.audio.monitor.inputLatency.label", "ms"],
      ["output_latency_ms", "settings.audio.monitor.outputLatency.label", "ms"],
      ["callback_frames", "settings.audio.monitor.callbackFrames.label", ""],
      ["glitch_count", "settings.audio.monitor.glitchCount.label", ""],
      ["queue_ms", "settings.audio.monitor.queueLatency.label", "ms"],
      ["queue_capacity_ms", "settings.audio.monitor.queueLimit.label", "ms"],
      ["queue_underruns", "settings.audio.monitor.queueUnderruns.label", ""]
    ].map(([key, label, unit]) => ({
      type: "Label",
      variant: "caption",
      showFor: status?.state === "running" && Number.isFinite(status?.[key]),
      text: `${tr(label)}: ${status?.[key]} ${unit}`.trim()
    })),
    {
      type: "ButtonField",
      label: tr("settings.audio.monitor.retry.label"),
      showFor: !!audio.values?.monitoring_enabled,
      disabled: audio.busy || ["starting", "stopping"].includes(status?.state),
      onClick: () => run(() => audio.monitor(true))
    },
    {
      type: "Label",
      variant: "caption",
      showFor: audio.suggestAsio === true,
      text: tr("settings.audio.asioHelp.description")
    },
    {
      type: "ButtonField",
      showFor: audio.suggestAsio === true,
      label: tr("settings.audio.asioHelp.label"),
      onClick: () =>
        globalThis.open(
          "https://asio4all.org/about/download-asio4all/",
          "_blank",
          "noopener,noreferrer"
        )
    }
  ];
}
