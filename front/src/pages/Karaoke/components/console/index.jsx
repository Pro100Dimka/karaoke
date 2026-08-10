import { Grid, Stack } from "../../../../theme/ui";
import ConsoleCenter from "./center";
import MixerPanel from "./mixer";
import ToolsPanel from "./tools";

export default function KaraokeConsole({
  autoHideEnabled,
  onAutoHideChange,
  ...props
}) {
  return (
    <Stack className="karaoke-transport-area">
      {/* <SongStrip {...props} /> */}
      <Grid columns={3} gap="1rem" px="1rem" sx={{ paddingInline: "unset" }}>
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
