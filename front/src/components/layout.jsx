import { Cog } from "lucide-react";
import { useCallback, useState } from "react";
import { useLocation } from "react-router-dom";
import { useOnlineRoomNavigation } from "../hooks/useOnlineRoomNavigation";
import { useRequireOnlineName } from "../hooks/useRequireOnlineName";
import Settings from "../pages/Settings";
import TitleBar from "./TitleBar";
import Modal from "./modal";
import AppRoutes from "./routes";
import { IconButton } from "./ui";

const ROUTES = { karaoke: "/karaoke" };

function AppSettingsButton({ onClick }) {
  return (
    <IconButton
      unstyled
      className="app-settings-fab"
      icon={Cog}
      size={56}
      label="Настройки приложения"
      onClick={onClick}
    />
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
      </div>
    </div>
  );
}
