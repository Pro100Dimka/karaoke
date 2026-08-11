import { Grid, Stack } from "../../../../theme/ui";
import ConsoleCenter from "./center";
import MixerPanel from "./mixer";
import SongStrip from "./song-strip";
import ToolsPanel from "./tools";

export default function KaraokeConsole({
  autoHideEnabled,
  onAutoHideChange,
  ...props
}) {
  return (
    <Stack
      className="karaoke-transport-area"
      align="center"
      sx={{
        borderRadius: "var(--shape-xl)",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--color-bg-deep) 20%, transparent), color-mix(in srgb, var(--color-bg-deep) 42%, transparent))",
        boxShadow:
          "inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 4%, transparent)",
        backdropFilter: "blur(0.2rem)",
        WebkitBackdropFilter: "blur(0.2rem)"
      }}
    >
      <SongStrip {...props} />
      <Grid columns={3} gap="1rem" sx={{ padding: "0.9rem" }}>
        <MixerPanel {...props} />
        <ConsoleCenter {...props} />
        <ToolsPanel
          {...props}
          autoHideEnabled={autoHideEnabled}
          onAutoHideChange={onAutoHideChange}
        />
      </Grid>
    </Stack>
  );
}
