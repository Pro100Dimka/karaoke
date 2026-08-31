import { Ellipsis } from "lucide-react";
import { memo, useRef, useState } from "react";
import { api } from "../../../api/client";
import { translateSaved as tr } from "../../../i18n/runtime";
import {
  Box,
  Button,
  Card,
  Chip,
  IconButton,
  Popover,
  ProcessingSignal,
  Stack,
  Typography
} from "../../../theme/ui";
import { apiToken } from "../../../utils/platform";
import { getSongActions, SongCoverArt } from "../components";
import { formatSongKey, getSongCardState } from "../utils";

const statuses = {
  done: ["success", "status.done"],
  error: ["danger", "status.error"],
  processing: ["primary", "status.processing"],
  queued: ["default", "status.queued"],
  cancelling: ["default", "library.cancelling"],
  cancelled: ["default", "status.cancelled"],
  pending: ["default", "library.awaitingProcessing"]
};

export default memo(
  ({
    cardIndex = 0,
    song,
    transferStatus: transfer,
    onOpenKaraoke,
    onOpenProcessing,
    ...handlers
  }) => {
    const [open, setOpen] = useState(false);
    const anchor = useRef(null);
    const { status, isReady, isWorking } = getSongCardState(song);
    const retry = ["error", "cancelled"].includes(transfer?.stage);
    const activate = () => isReady && onOpenKaraoke(song);
    const actions = getSongActions({ ...handlers, song, isReady, isWorking, activate });
    const split = isReady || !handlers.canManageLibrary ? 2 : 1;
    const token = apiToken();
    const action = ([Icon, label, variant, onClick, disabled], close) => (
      <IconButton
        key={label}
        {...{ icon: Icon, label, title: label, variant, disabled }}
        onClick={(e) => {
          e.stopPropagation();
          close && setOpen(false);
          onClick?.();
        }}
      />
    );
    const [tone = "default", text = status] = statuses[status] || [];
    return (
      <Card
        variant="laser"
        tilt={false}
        interactive={isReady}
        role={isReady ? "button" : undefined}
        tabIndex={isReady ? 0 : undefined}
        aria-label={isReady ? tr("library.openInKaraoke", { 0: song.title }) : undefined}
        onClick={isReady ? activate : undefined}
        onKeyDown={
          isReady
            ? (event) => {
                if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key))
                  return;
                event.preventDefault();
                activate();
              }
            : undefined
        }
        sx={{ contentVisibility: "auto" }}
        style={{ "--card-sheen": "transparent", "--card-sheen-soft": "transparent" }}
        cardPanel={{
          style: {
            background: `
            radial-gradient(ellipse at 28% 14%, color-mix(in srgb, var(--ui-primary-hover) 8%, transparent), transparent 42%),
            linear-gradient(108deg, color-mix(in srgb, var(--ui-bg-deep) 88%, transparent),
            color-mix(in srgb, var(--ui-surface) 92%, transparent) 58%,
            color-mix(in srgb, var(--ui-bg-deep) 94%, transparent))`
          }
        }}
      >
        <Stack direction="row">
          <SongCoverArt cardIndex={cardIndex} song={song} />
          <Stack
            gap="var(--space-2)"
            justify="space-between"
            sx={{ flex: 4, padding: "var(--space-4)" }}
          >
            <Stack direction="row" justify="space-between" align="start" gap="var(--space-3)">
              <Stack gap="var(--space-2)">
                <Typography variant="h4">{song.title}</Typography>
                <Typography variant="h5" tone="muted" sx={{ fontWeight: "normal" }}>
                  {song.artist || tr("library.artistNotSpecified")}
                </Typography>
              </Stack>
              <Chip tone={tone}>{statuses[status] ? tr(text) : status}</Chip>
            </Stack>
            <Stack direction="row" align="center" justify="space-between" wrap gap="var(--space-3)">
              {isWorking || transfer ? (
                <Button
                  variant="outlined"
                  fullWidth
                  sx={{ flex: 1, background: "unset", border: "unset", boxShadow: "unset" }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isWorking) onOpenProcessing(song);
                    else if (retry) activate();
                  }}
                >
                  {retry ? (
                    <Typography variant="body2" tone="danger">
                      {tr("library.transferInterruptedClickToRetry")}
                    </Typography>
                  ) : (
                    <Stack gap="var(--space-1)" sx={{ width: "100%" }}>
                      {transfer && (
                        <Typography variant="body2" tone="muted">
                          {tr(
                            song.__roomLocal
                              ? "library.waitingForOtherParticipantsToReceiveTheSong"
                              : "library.downloadingSong"
                          )}
                        </Typography>
                      )}
                      <ProcessingSignal
                        compact
                        progress={transfer?.percent ?? song.progress_percent}
                        url={isWorking ? api.getAudioTrackUrl(song.id, "song") : undefined}
                        fetchParams={token ? { headers: { "X-ADVoice-Token": token } } : undefined}
                      />
                    </Stack>
                  )}
                </Button>
              ) : (
                <Typography variant="body2" tone="muted">
                  {[
                    formatSongKey(song.key_override),
                    song.tempo_override && tr("common.bpm", { 0: song.tempo_override }),
                    song.difficulty_override
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
              )}

              <Stack direction="row" align="center" gap="var(--space-2)" sx={{ width: "auto" }}>
                {actions.slice(0, split).map((x) => action(x))}
                {actions.length > split && (
                  <Box sx={{ position: "relative" }}>
                    <IconButton
                      ref={anchor}
                      icon={Ellipsis}
                      variant="contained"
                      label={tr("library.moreActions")}
                      aria-haspopup="menu"
                      aria-expanded={open}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(!open);
                      }}
                    />
                    <Popover
                      open={open}
                      anchorRef={anchor}
                      placement="bottom-end"
                      role="menu"
                      onClose={() => setOpen(false)}
                      aria-label={tr("library.moreActionsForSong", { 0: song.title })}
                      style={{ minWidth: "auto" }}
                    >
                      <Stack align="center" gap="var(--space-1)">
                        {actions.slice(split).map((x) => action(x, true))}
                      </Stack>
                    </Popover>
                  </Box>
                )}
              </Stack>
            </Stack>
          </Stack>
        </Stack>
      </Card>
    );
  }
);
