import { Grid } from "../../../../theme/ui";
import ConsoleCenter from "./center";
import MixerPanel from "./mixer";
// import ToolsPanel from "./tools";

export default function KaraokeConsole({
  autoHideEnabled,
  onAutoHideChange,
  onClose,
  ...props
}) {
  return (
    <div className="karaoke-transport-area karaoke-studio-console">
      {/* <SongStrip {...props} /> */}
      <Grid columns={3}>
        <MixerPanel {...props} />
        <ConsoleCenter {...props} />
        {/*  <ToolsPanel
          {...props}
          autoHideEnabled={autoHideEnabled}
          onAutoHideChange={onAutoHideChange}
        /> */}
      </Grid>
    </div>
  );
}
