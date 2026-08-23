import { memo } from "react";
import { translateSaved as tr } from "../../../i18n/runtime";
import {
  Box,
  Button,
  Card,
  Chip,
  IconButton,
  ProcessingSignal,
  Stack,
  Typography
} from "../../../theme/ui";
import { getSongActions, SongCoverArt } from "../components";
import { formatSongKey, getSongCardState } from "../utils";

const statusTone = { done: "success", error: "danger", processing: "primary", queued: "default" };
const statusText = {
  done: tr("Готово"),
  error: tr("Ошибка"),
  processing: tr("Обрабатывается"),
  queued: tr("В очереди"),
  cancelling: tr("Отменяется"),
  cancelled: tr("Отменено"),
  pending: tr("Ожидает обработки")
};

const LibrarySongCard = memo(
  ({ cardIndex = 0, song, transferStatus, onOpenKaraoke, onOpenProcessing, ...handlers }) => {
    const { status, isReady, isWorking } = getSongCardState(song);
    const metadata = [
      formatSongKey(song.key_override),
      song.tempo_override && `${song.tempo_override} BPM`,
      song.difficulty_override
    ]
      .filter(Boolean)
      .join(" · ");
    const activate = () => isReady && onOpenKaraoke(song);
    return (
      <Card
        variant="laser"
        tilt={false}
        interactive={isReady}
        role={isReady ? "button" : undefined}
        tabIndex={isReady ? 0 : undefined}
        aria-label={isReady ? tr("Открыть {0} в караоке", { 0: song.title }) : undefined}
        onClick={(event) => !event.target.closest?.("button, a, input") && activate()}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget &&
            ["Enter", " "].includes(event.key) &&
            isReady
          ) {
            event.preventDefault();
            activate();
          }
        }}
        sx={{ contentVisibility: "auto" }}
        style={{ "--card-sheen": "transparent", "--card-sheen-soft": "transparent" }}
        cardPanel={{
          style: {
            background: `
              radial-gradient(ellipse at 28% 14%, color-mix(in srgb, var(--ui-primary-hover) 8%, transparent), transparent 42%),
              linear-gradient(108deg,
                color-mix(in srgb, var(--ui-bg-deep) 88%, transparent),
                color-mix(in srgb, var(--ui-surface) 92%, transparent) 58%,
                color-mix(in srgb, var(--ui-bg-deep) 94%, transparent))`
          }
        }}
      >
        <Stack direction="row">
          <Stack sx={{ flex: 1 }}>
            <SongCoverArt
              cardIndex={cardIndex}
              song={song}
              sx={{ borderRadius: "var(--shape-lg)" }}
            />
          </Stack>
          <Stack
            gap="var(--space-2)"
            justify="space-between"
            sx={{ flex: 4, padding: "var(--space-4)" }}
          >
            <Stack direction="row" justify="space-between" align="start" gap="var(--space-3)">
              <Stack gap="var(--space-2)" sx={{ minWidth: 0 }}>
                <Typography variant="h3">
                  <strong>{song.title}</strong>
                </Typography>
                <Typography variant="h5" tone="muted" sx={{ fontWeight: "normal" }}>
                  {song.artist || tr("Исполнитель не указан")}
                </Typography>
              </Stack>
              <Chip tone={statusTone[status] ?? "default"}>{tr(statusText[status] ?? status)}</Chip>
            </Stack>
            <Stack direction="row" align="center" justify="space-between" wrap gap="var(--space-3)">
              {isWorking || transferStatus ? (
                <Box sx={{ flex: 1 }}>
                  <Button
                    variant="outlined"
                    sx={{ background: "unset", border: "unset", boxShadow: "unset" }}
                    fullWidth
                    onClick={isWorking ? () => onOpenProcessing(song) : undefined}
                  >
                    <ProcessingSignal
                      progress={transferStatus?.percent ?? song.progress_percent}
                      compact
                    />
                  </Button>
                </Box>
              ) : (
                <Typography variant="body2" tone="muted">
                  {metadata}
                </Typography>
              )}
              <Stack
                direction="row"
                justify="flex-end"
                align="center"
                gap="var(--space-2)"
                sx={{ width: "auto" }}
              >
                {getSongActions({ ...handlers, activate, isReady, isWorking, song }).map(
                  ([Icon, label, variant, onClick, disabled]) => (
                    <IconButton
                      key={label}
                      icon={Icon}
                      variant={variant}
                      label={label}
                      title={label}
                      disabled={disabled}
                      onClick={onClick}
                    />
                  )
                )}
              </Stack>
            </Stack>
          </Stack>
        </Stack>
      </Card>
    );
  }
);
export default LibrarySongCard;
