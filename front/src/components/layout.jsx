import { Cog } from "lucide-react";
import { useCallback, useState } from "react";
import { useLocation } from "react-router-dom";
import { useOnlineRoomNavigation } from "../hooks/useOnlineRoomNavigation";
import { useRequireOnlineName } from "../hooks/useRequireOnlineName";
import SongSettings from "../pages/Library/song-settings";
import Settings from "../pages/Settings";
import Modal from "./Modal";
import TitleBar from "./TitleBar";
import AppRoutes from "./routes";

const ROUTES = { karaoke: "/karaoke" };

function AppSettingsButton({ onClick }) {
  return (
    <button
      type="button"
      className="app-settings-fab"
      onClick={onClick}
      title="Настройки приложения"
      aria-label="Настройки приложения"
    >
      <Cog size={56} strokeWidth={1.8} />
    </button>
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

        {!isKaraoke && <AppSettingsButton onClick={openSettings} />}

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
        >
          <Settings />
        </Modal>

        <Modal
          isOpen={Boolean(songSettingsId)}
          onClose={closeSongSettings}
          ariaLabel="Настройки песни"
          backdropClassName="app-modal-backdrop song-recordings-backdrop"
          modalClassName="app-modal song-settings-modal modal-card"
          cardVariant="neon"
          closeClassName="app-modal-close song-recordings-close"
          closeAriaLabel="Закрыть настройки"
          closeIconSize={18}
          portal
        >
          <SongSettings songId={songSettingsId} />
        </Modal>
      </div>
    </div>
  );
}
