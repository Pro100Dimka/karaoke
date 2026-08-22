import { ArrowLeft, Crosshair, Merge, Pause, Play, Redo2, Save, Trash2, Undo2 } from "lucide-react";
import { translateSaved as t } from "../../i18n/runtime";
import {
  Box,
  IconButton,
  RotaryKnob,
  Select,
  Stack,
  Tooltip,
  Typography,
  Waveform
} from "../../theme/ui";
import { formatClockTime } from "../../utils/time-format";

const rates = [0.5, 0.65, 0.75, 0.85, 1].map((value) => ({
  value,
  label: `${value * 100}%`
}));

function ActionGroup({ actions, color = "var(--color-primary)" }) {
  return (
    <Stack
      direction="row"
      align="center"
      gap="var(--space-1)"
      sx={{
        inlineSize: "auto",
        padding: "var(--space-1)",
        border: `1px solid color-mix(in srgb, ${color} 42%, transparent)`,
        borderRadius: "var(--radius-pill)",
        background: "var(--color-bg-deep)"
      }}
    >
      {actions.map(({ Icon, label, variant = "outline", disabled, ...props }) => (
        <Tooltip key={label} title={label}>
          <IconButton
            unstyled
            icon={Icon}
            label={label}
            iconSize={18}
            disabled={disabled}
            aria-pressed={variant === "solid" || undefined}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              inlineSize: "var(--space-10)",
              blockSize: "var(--space-10)",
              minInlineSize: "var(--space-10)",
              padding: 0,
              border: `1px solid color-mix(in srgb, ${color} 68%, transparent)`,
              borderRadius: "50%",
              color,
              background:
                variant === "solid"
                  ? `color-mix(in srgb, ${color} 18%, var(--color-bg-deep))`
                  : "var(--color-bg-deep)",
              boxShadow: `inset 0 1px color-mix(in srgb, var(--color-text) 10%, transparent), 0 0 var(--space-3) color-mix(in srgb, ${color} ${variant === "solid" ? 42 : 18}%, transparent)`,
              opacity: disabled ? 0.26 : 1,
              cursor: disabled ? "not-allowed" : "pointer"
            }}
            {...props}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}

export default function EditorControls({ controller, onBack, save, saving, transport }) {
  const navigation = [
    { Icon: ArrowLeft, label: t("Назад"), onClick: onBack },
    {
      Icon: Save,
      label: t("Сохранить"),
      disabled: saving,
      variant: "solid",
      onClick: save
    }
  ];
  const history = [
    { Icon: Undo2, label: t("Отменить"), tone: "secondary", onClick: controller.undo },
    { Icon: Redo2, label: t("Вернуть"), tone: "secondary", onClick: controller.redo }
  ];
  const follow = [
    {
      Icon: Crosshair,
      label: t("Автопрокрутка"),
      variant: controller.autoScroll ? "solid" : "outline",
      onClick: () => controller.setAutoScroll((value) => !value)
    }
  ];
  const playback = [
    {
      Icon: transport.playing ? Pause : Play,
      label: transport.playing ? t("Пауза") : t("Слушать"),
      variant: transport.playing ? "solid" : "outline",
      onClick: transport.playing ? transport.pause : transport.play
    }
  ];
  const edit = [
    {
      Icon: Merge,
      label: t("Объединить"),
      tone: "warning",
      disabled: !controller.canMerge,
      onClick: controller.merge
    },
    {
      Icon: Trash2,
      label: t("Удалить"),
      tone: "danger",
      disabled: !controller.selected.length,
      onClick: controller.remove
    }
  ];
  const volumes = [
    ["vocals", t("Вокал")],
    ["melody", t("Мелодия"), "secondary"],
    ["instrumental", t("Минус")]
  ];
  return (
    <Stack
      as="header"
      direction="row"
      align="center"
      gap="var(--space-2)"
      sx={{
        flex: "none",
        padding: "calc(var(--space-1) / 2) 0",
        borderBlock: "1px solid color-mix(in srgb, var(--color-primary) 45%, transparent)",
        background: "color-mix(in srgb, var(--color-bg-deep) 96%, transparent)",
        boxShadow: "0 var(--space-1) var(--space-4) #0008",
        overflow: "hidden"
      }}
    >
      <ActionGroup actions={navigation} />
      <ActionGroup actions={history} color="var(--color-studio-history)" />
      <ActionGroup actions={follow} color="var(--color-studio-follow)" />
      <ActionGroup actions={playback} color="var(--color-studio-transport)" />
      <ActionGroup actions={edit} color="var(--color-studio-edit)" />
      <Stack
        direction="row"
        align="center"
        gap="var(--space-2)"
        sx={{
          inlineSize: "auto",
          marginInlineStart: "calc(var(--space-16) + var(--space-4))"
        }}
      >
        <Box
          sx={{
            inlineSize: "calc(var(--space-16) + var(--space-8))",
            flex: "none",
            marginInlineEnd: "calc(var(--space-4) * -1)"
          }}
        >
          <Select
            aria-label={t("Скорость")}
            options={rates}
            label={t("Скорость")}
            value={controller.playbackRate}
            onChange={(value) => controller.setPlaybackRate(Number(value))}
            sx={{ "--control-pad": "var(--space-1)" }}
          />
        </Box>
      </Stack>
      <Stack
        direction="row"
        align="center"
        gap="var(--space-8)"
        sx={{
          inlineSize: "auto",
          flex: "none",
          marginBlock: "calc(var(--space-4) * -1)",
          marginInlineStart: "var(--space-16)",
          marginInlineEnd: "calc(var(--space-3) * -1)",
          transform: "scale(.74)"
        }}
      >
        {volumes.map(([key, label, accent]) => (
          <RotaryKnob
            key={key}
            label={label}
            accent={accent}
            value={controller.volumes[key]}
            onChange={(value) =>
              controller.setVolumes((current) => ({ ...current, [key]: Number(value) }))
            }
          />
        ))}
      </Stack>
      <Typography
        variant="caption"
        sx={{ marginInlineStart: "calc(var(--space-16) + var(--space-8))" }}
      >
        {formatClockTime(transport.time)}
      </Typography>
      <Waveform
        label={t("Позиция песни")}
        value={transport.time}
        duration={controller.duration}
        onChange={transport.seek}
      />
      <Typography variant="caption">{formatClockTime(controller.duration)}</Typography>
    </Stack>
  );
}
