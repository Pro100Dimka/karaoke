import ConsoleCenter from "./center";
import MixerPanel from "./mixer";
import SongStrip from "./song-strip";
import ToolsPanel from "./tools";

export default function KaraokeConsole(props) {
  return (
    <div className="karaoke-transport-area karaoke-studio-console">
      <SongStrip {...props} />
      <div className="karaoke-console-grid">
        <MixerPanel {...props} />
        <ConsoleCenter {...props} />
        <ToolsPanel {...props} />
      </div>
    </div>
  );
}
