import { Cog, Radio, Volume2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useRadio } from "../contexts/radio";
import { useOnlineRoomNavigation } from "../hooks/useOnlineRoomNavigation";
import { useRequireOnlineName } from "../hooks/useRequireOnlineName";
import { useI18n } from "../i18n";
import SongSettings from "../pages/Library/modals/song-settings";
import Settings from "../pages/Settings";
import TitleBar from "./TitleBar";
import AppRoutes from "./routes";
import { IconButton } from "./ui";

const ROUTES = { karaoke: "/karaoke" };

function AppFloatingControls({ onOpenSettings }) {
  const { t } = useI18n();
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
            t(isPlaying ? "radio.disable" : "radio.enable", {
              station: station.name
            })
          }
          onClick={toggle}
        />
        <div className="app-radio-volume" aria-label={t("radio.volume")}>
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
        label={t("settings.open")}
        onClick={onOpenSettings}
      />
    </div>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [songSettingsId, setSongSettingsId] = useState(null);
  const [routeBlackout, setRouteBlackout] = useState(false);

  const isKaraoke = location.pathname === ROUTES.karaoke;
  const isEditor = location.pathname.startsWith("/editor/");

  useEffect(() => {
    const handleRouteBlackout = (event) => {
      setRouteBlackout(Boolean(event?.detail?.visible));
    };

    window.addEventListener("app:route-blackout", handleRouteBlackout);
    return () =>
      window.removeEventListener("app:route-blackout", handleRouteBlackout);
  }, []);

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
      className={[
        "app-shell",
        isKaraoke && "karaoke-app-shell",
        isEditor && "melody-editor-app-shell"
      ]
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
        {!isKaraoke && !isEditor && (
          <AppFloatingControls onOpenSettings={openSettings} />
        )}
        {songSettingsId && (
          <SongSettings songId={songSettingsId} onClose={closeSongSettings} />
        )}
        <div
          className={`app-route-blackout ${routeBlackout ? "is-visible" : ""}`}
          aria-hidden="true"
        />
        {isSettingsOpen && <Settings isOpen onClose={closeSettings} />}
      </div>
    </div>
  );
}
