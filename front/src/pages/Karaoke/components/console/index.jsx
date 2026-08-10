import { Grid, Stack } from "../../../../theme/ui";
import MixerPanel from "./mixer";

export default function KaraokeConsole({
  autoHideEnabled,
  onAutoHideChange,
  ...props
}) {
  return (
    <Stack
      className="karaoke-transport-area"
      style={{ backgroundColor: "black" }}
    >
      {/* <SongStrip {...props} /> */}
      <Grid columns={3} gap="1rem" px="1rem">
        <MixerPanel {...props} />
        {/* <ConsoleCenter {...props} />
        <ToolsPanel
          {...props}
          autoHideEnabled={autoHideEnabled}
          onAutoHideChange={onAutoHideChange}
        /> */}
      </Grid>
    </Stack>
  );
}
