import { api } from "../../../../api/client";
import { translateSaved as tr } from "../../../../i18n/runtime";
import { Button, ProcessingSignal, Stack, Typography } from "../../../../theme/ui";
import { apiToken } from "../../../../utils/platform";
import { formatSongKey } from "../../utils";

export default ({ song, transfer, isWorking, onOpenProcessing, openKaraoke }) => {
  if (!isWorking && !transfer)
    return (
      <Typography variant="body2" tone="muted">
        {[
          formatSongKey(song.key_override),
          song.tempo_override && tr("common.bpm", { 0: song.tempo_override }),
          song.difficulty_override
        ]
          .filter(Boolean)
          .join(" · ")}
      </Typography>
    );
  const retry = ["error", "cancelled"].includes(transfer?.stage);
  const token = apiToken();
  return (
    <Button
      variant="outlined"
      fullWidth
      sx={{ flex: 1, background: "unset", border: "unset", boxShadow: "unset" }}
      onClick={(e) => {
        e.stopPropagation();
        isWorking ? onOpenProcessing(song) : retry && openKaraoke();
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
                `library.${
                  song.__roomLocal
                    ? "waitingForOtherParticipantsToReceiveTheSong"
                    : "downloadingSong"
                }`
              )}
            </Typography>
          )}

          <ProcessingSignal
            compact
            progress={transfer?.percent ?? song.progress_percent}
            url={isWorking && api.getAudioTrackUrl(song.id, "song")}
            fetchParams={token && { headers: { "X-ADVoice-Token": token } }}
          />
        </Stack>
      )}
    </Button>
  );
};
