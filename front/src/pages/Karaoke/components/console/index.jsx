import { X } from "lucide-react";
import ConsoleCenter from "./center";
import MixerPanel from "./mixer";
import SongStrip from "./song-strip";
import ToolsPanel from "./tools";

export default function KaraokeConsole({
  autoHideEnabled,
  onAutoHideChange,
  onClose,
  ...props
}) {
  return (
    <div className="karaoke-transport-area karaoke-studio-console">
      <div className="karaoke-console-window-actions">
        <button
          type="button"
          className="karaoke-console-close"
          aria-label="Скрыть консоль"
          title="Скрыть консоль"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>

      <SongStrip {...props} />
      <div className="karaoke-console-grid">
        <MixerPanel {...props} />
        <ConsoleCenter {...props} />
        <ToolsPanel
          {...props}
          autoHideEnabled={autoHideEnabled}
          onAutoHideChange={onAutoHideChange}
        />
      </div>
    </div>
  );
}
