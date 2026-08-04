import { Cog } from "lucide-react";
import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useOnlineRoomNavigation } from "../hooks/useOnlineRoomNavigation";
import { useRequireOnlineName } from "../hooks/useRequireOnlineName";
import SongSettings from "../pages/Library/song-settings";
import Settings from "../pages/Settings";
import Modal from "./Modal";
import TitleBar from "./TitleBar";
import AppRoutes from "./routes";

const ROUTES = {
  karaoke: "/karaoke",
  songSettings: "/song-settings"
};

function AppSettingsButton({ onClick }) {
  return (
    <button
      type="button"
      className="app-settings-fab"
      onClick={onClick}
      title="Настройки приложения"
      aria-label="Настройки приложения"
    >
      <Cog size={29} />
    </button>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const [isSettingsOpen, setSettingsOpen] = useState(false);

  const isKaraoke = location.pathname === ROUTES.karaoke;
  const isSongSettings = location.pathname === ROUTES.songSettings;

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const closeSongSettings = useCallback(() => {
    navigate(-1);
  }, [navigate]);

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
          <AppRoutes onOpenAppSettings={openSettings} />
        </main>

        {!isKaraoke && <AppSettingsButton onClick={openSettings} />}

        <Modal
          isOpen={isSettingsOpen}
          onClose={closeSettings}
          ariaLabel="Настройки приложения"
          backdropClassName="settings-modal-backdrop"
          modalClassName="settings-modal"
          closeClassName="settings-modal-close"
          closeAriaLabel="Закрыть настройки"
          closeIconSize={20}
        >
          <Settings />
        </Modal>

        <Modal
          isOpen={isSongSettings}
          onClose={closeSongSettings}
          ariaLabel="Настройки песни"
          backdropClassName="song-recordings-backdrop"
          modalClassName="song-settings-modal"
          closeClassName="song-recordings-close"
          closeAriaLabel="Закрыть настройки"
          closeIconSize={18}
          portal
        >
          <SongSettings />
        </Modal>
      </div>
    </div>
  );
}
