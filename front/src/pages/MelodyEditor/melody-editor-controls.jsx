import {
  ArrowLeft,
  Crosshair,
  Merge,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2
} from "lucide-react";
import { RotaryKnob } from "../../components/fields";
import { translateSaved as t } from "../../i18n/runtime";
import { Stack } from "../../theme/ui";
import SongStrip from "../Karaoke/components/console/song-strip";
import MelodyEditorToolbarButton from "./melody-editor-toolbar";

const PLAYBACK_RATES = [0.5, 0.65, 0.75, 0.85, 1];

function EditorActions({
  autoScroll,
  canMerge,
  deleteSelected,
  mergeSelected,
  onBack,
  payload,
  pause,
  play,
  playing,
  redo,
  restoreAi,
  save,
  saving,
  selectedCount,
  toggleAutoScroll,
  undo
}) {
  const groups = [
    [
      "nav",
      [
        { icon: ArrowLeft, label: t("Назад"), tone: "neutral", onClick: onBack },
        {
          icon: Save,
          label: t(saving ? "Сохранение…" : "Сохранить"),
          disabled: saving,
          tone: "pink",
          active: true,
          onClick: save
        }
      ]
    ],
    [
      "history",
      [
        { icon: Undo2, label: t("Отменить"), tone: "blue", onClick: undo },
        { icon: Redo2, label: t("Вернуть отменённое"), tone: "blue", onClick: redo }
      ]
    ],
    [
      "ai",
      [
        payload?.ai_backup_exists && {
          icon: RotateCcw,
          label: t("Вернуть результат AI"),
          tone: "amber",
          onClick: restoreAi
        },
        {
          icon: Crosshair,
          label: t(`Автопрокрутка ${autoScroll ? "включена" : "выключена"}`),
          tone: "cyan",
          active: autoScroll,
          onClick: toggleAutoScroll
        }
      ].filter(Boolean)
    ],
    [
      "transport",
      [
        {
          icon: playing ? Pause : Play,
          label: t(playing ? "Стоп" : "Воспроизвести"),
          tone: "green",
          active: playing,
          onClick: playing ? pause : play
        }
      ]
    ],
    [
      "edit",
      [
        {
          icon: Merge,
          label: t("Соединить выбранные"),
          disabled: !canMerge,
          tone: "amber",
          onClick: mergeSelected
        },
        {
          icon: Trash2,
          label: t("Удалить выбранные"),
          disabled: !selectedCount,
          danger: true,
          tone: "red",
          onClick: deleteSelected
        }
      ]
    ]
  ];

  return (
    <Stack
      role="toolbar"
      direction="row"
      gap={0.5}
      align="center"
      sx={{ width: "auto" }}
      aria-label={t("Инструменты редактора")}
    >
      {groups.map(([group, buttons]) => (
        <Stack
          key={group}
          direction="row"
          gap={0.5}
          align="center"
          sx={{ width: "auto" }}
          className={`melody-editor-tool-group is-${group}`}
        >
          {buttons.map((button) => (
            <MelodyEditorToolbarButton key={button.label} {...button} />
          ))}
        </Stack>
      ))}
    </Stack>
  );
}

function PlaybackRate({ playbackRate, setPlaybackRate }) {
  return (
    <label className="melody-editor-speed" htmlFor="melody-editor-playback-rate">
      <span>{t("Скорость")}</span>
      <select
        id="melody-editor-playback-rate"
        value={playbackRate}
        onChange={({ target }) => setPlaybackRate(Number(target.value))}
      >
        {PLAYBACK_RATES.map((rate) => (
          <option key={rate} value={rate}>
            {rate * 100}%
          </option>
        ))}
      </select>
    </label>
  );
}

export default function MelodyEditorControls({
  autoScroll,
  canMerge,
  deleteSelected,
  duration,
  mergeSelected,
  onBack,
  payload,
  pause,
  play,
  playbackRate,
  playing,
  redo,
  restoreAi,
  save,
  saving,
  seek,
  selected,
  setPlaybackRate,
  setVolumes,
  song,
  time,
  toggleAutoScroll,
  undo,
  volumes
}) {
  const dials = [
    ["vocals", t("Вокал")],
    ["melody", t("Мелодия"), "secondary"],
    ["instrumental", t("Минус")]
  ];
  const setVolume = (key) => (value) =>
    setVolumes((current) => ({ ...current, [key]: Number(value) }));
  return (
    <Stack direction="row" gap={1} align="center" justify="space-between">
      <EditorActions
        {...{
          autoScroll,
          canMerge,
          deleteSelected,
          mergeSelected,
          onBack,
          payload,
          pause,
          play,
          playing,
          redo,
          restoreAi,
          save,
          saving,
          toggleAutoScroll,
          undo
        }}
        selectedCount={selected.length}
      />
      <PlaybackRate {...{ playbackRate, setPlaybackRate }} />
      <Stack direction="row" gap="3rem" sx={{ width: "auto", transform: "scale(0.7)" }}>
        {dials.map(([key, label, accent]) => (
          <RotaryKnob
            key={key}
            label={label}
            value={volumes[key]}
            accent={accent}
            onChange={setVolume(key)}
          />
        ))}
      </Stack>
      <Stack sx={{ width: "auto" }}>
        <SongStrip song={song} currentTime={time} duration={duration} onSeek={seek} disablelabel />
      </Stack>
    </Stack>
  );
}
