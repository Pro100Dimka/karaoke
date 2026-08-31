import {
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRightToLine,
  Crosshair,
  Merge,
  Pause,
  Play,
  Redo2,
  Save,
  Trash2,
  Undo2
} from "lucide-react";
import { translateSaved as t } from "../../../i18n/runtime";
import { Box, RotaryKnob, Select, Stack, Typography, Waveform } from "../../../theme/ui";
import { formatClockTime } from "../../../utils/time-format";
import ActionGroup from "./action-group";

const RATES = [0.5, 0.65, 0.75, 0.85, 1].map((value) => ({ value, label: `${value * 100}%` }));

export default function EditorControls({ controller, onBack, save, saving, transport }) {
  const selectedWords = !!controller.selectedWords.length;
  const groups = [
    [
      "var(--color-primary)",
      [
        [ArrowLeft, t("room.back"), onBack],
        [Save, t("library.save"), save, true, saving]
      ]
    ],
    [
      "var(--color-studio-history)",
      [
        [Undo2, t("library.cancel"), controller.undo, false, false, "secondary"],
        [Redo2, t("editor.redo"), controller.redo, false, false, "secondary"]
      ]
    ],
    [
      "var(--color-studio-follow)",
      [
        [
          Crosshair,
          t("editor.autoScroll"),
          () => controller.setAutoScroll((value) => !value),
          controller.autoScroll
        ]
      ]
    ],
    [
      "var(--color-studio-transport)",
      [
        [
          transport.playing ? Pause : Play,
          t(transport.playing ? "audio.pause" : "editor.listen"),
          transport.playing ? transport.pause : transport.play,
          transport.playing
        ]
      ]
    ],
    [
      "var(--color-studio-edit)",
      [
        [Merge, t("editor.merge"), controller.merge, false, !controller.canMerge, "warning"],
        [
          Trash2,
          t("editor.delete"),
          controller.remove,
          false,
          !controller.selected.length,
          "danger"
        ],
        [
          ArrowLeftToLine,
          t("editor.shiftLyricsBackAlt"),
          () => controller.shiftWords(-1),
          false,
          !selectedWords
        ],
        [
          ArrowRightToLine,
          t("editor.shiftLyricsForwardAlt"),
          () => controller.shiftWords(1),
          false,
          !selectedWords
        ]
      ]
    ]
  ];

  const volumes = [
    ["vocals", t("karaoke.vocals")],
    ["melody", t("karaoke.melody"), "secondary"],
    ["instrumental", t("editor.minus")]
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
      {groups.map(([color, actions]) => (
        <ActionGroup key={color + actions[0][1]} color={color} actions={actions} />
      ))}
      <Box
        sx={{
          inlineSize: "calc(var(--space-16) + var(--space-8))",
          flex: "none",
          marginInlineStart: "calc(var(--space-16) + var(--space-4))"
        }}
      >
        <Select
          label={t("editor.speed")}
          value={controller.playbackRate}
          options={RATES}
          onChange={(value) => controller.setPlaybackRate(Number(value))}
          sx={{ "--control-pad": "var(--space-1)" }}
        />
      </Box>
      <Stack
        direction="row"
        align="center"
        gap="var(--space-8)"
        sx={{
          inlineSize: "auto",
          flex: "none",
          marginBlock: "calc(var(--space-4) * -1)",
          marginInlineStart: "var(--space-12)",
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
      <Typography variant="caption" sx={{ marginInlineStart: "var(--space-16)" }}>
        {formatClockTime(transport.time)}
      </Typography>
      <Waveform
        label={t("karaoke.songPosition")}
        value={transport.time}
        duration={controller.duration}
        onChange={transport.seek}
        url={transport.urls.instrumental || transport.urls.vocals}
      />
      <Typography variant="caption">{formatClockTime(controller.duration)}</Typography>
    </Stack>
  );
}
