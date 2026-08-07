import { Cog, Radio, Volume2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useLocation } from "react-router-dom";
import { useRadio } from "../contexts/radio";
import { useOnlineRoomNavigation } from "../hooks/useOnlineRoomNavigation";
import { useRequireOnlineName } from "../hooks/useRequireOnlineName";
import SongSettings from "../pages/Library/modals/song-settings";
import Settings from "../pages/Settings";
import TitleBar from "./TitleBar";
import Modal from "./modal";
import AppRoutes from "./routes";
import { IconButton } from "./ui";

const ROUTES = { karaoke: "/karaoke" };

function AppFloatingControls({ onOpenSettings }) {
  const { error, isLoading, isPlaying, station, toggle, volume, setVolume } =
    useRadio();

  return (
    <div className="app-floating-controls">
      <div className="app-radio-fab-wrap">
        <IconButton
          unstyled
          className={[
            "app-settings-fab",
            "app-radio-fab",
            isPlaying && "is-playing",
            isLoading && "is-loading"
          ]
            .filter(Boolean)
            .join(" ")}
          icon={Radio}
          size={28}
          label={
            error ||
            (isPlaying
              ? `Выключить ${station.name}`
              : `Включить ${station.name}`)
          }
          onClick={toggle}
        />
        <div className="app-radio-volume" aria-label="Громкость радио">
          <Volume2 size={15} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => setVolume(event.target.value)}
          />
          <span>{Math.round(volume * 100)}%</span>
        </div>
      </div>

      <IconButton
        unstyled
        className="app-settings-fab"
        icon={Cog}
        size={28}
        label="Настройки приложения"
        onClick={onOpenSettings}
      />
    </div>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [songSettingsId, setSongSettingsId] = useState(null);

  const isKaraoke = location.pathname === ROUTES.karaoke;

  const openSettings = useCallback(() => {
    setSongSettingsId(null);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const openSongSettings = useCallback((songId) => {
    setSettingsOpen(false);
    setSongSettingsId(songId || null);
  }, []);

  const closeSongSettings = useCallback(() => {
    setSongSettingsId(null);
  }, []);

  useOnlineRoomNavigation();

  useRequireOnlineName({
    onMissingName: openSettings
  });

  return (
    <div
      className={["app-shell", isKaraoke && "karaoke-app-shell"]
        .filter(Boolean)
        .join(" ")}
    >
      <TitleBar />
      <div className="app-body">
        <main className="app-main">
          <AppRoutes
            onOpenAppSettings={openSettings}
            onOpenSongSettings={openSongSettings}
          />
        </main>
        {!isKaraoke && <AppFloatingControls onOpenSettings={openSettings} />}
        {songSettingsId && (
          <SongSettings songId={songSettingsId} onClose={closeSongSettings} />
        )}
        <Modal
          isOpen={isSettingsOpen}
          onClose={closeSettings}
          ariaLabel="Настройки приложения"
          backdropClassName="app-modal-backdrop settings-modal-backdrop"
          modalClassName="app-modal settings-modal modal-card"
          cardVariant="neon"
          closeClassName="app-modal-close settings-modal-close"
          closeAriaLabel="Закрыть настройки"
          closeIconSize={20}
          portal
        >
          <Settings />
        </Modal>
      </div>
    </div>
  );
}
