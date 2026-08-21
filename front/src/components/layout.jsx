import { Cog, Radio, Volume2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useRadio } from "../contexts/radio";
import { useOnlineRoomNavigation } from "../hooks/useOnlineRoomNavigation";
import { useI18n } from "../i18n";
import { IconButton, Stack } from "../theme/ui";
import cx from "../utils/cx";
import TitleBar from "./TitleBar";
import AppRoutes from "./routes";

const Settings = lazy(() => import("../pages/Settings"));

const ROUTES = {
  karaoke: "/karaoke",
  editor: "/editor/"
};

const Lazy = ({ children }) => <Suspense fallback={null}>{children}</Suspense>;

function useRouteBlackout() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handle = ({ detail }) => setVisible(Boolean(detail?.visible));

    window.addEventListener("app:route-blackout", handle);
    return () => window.removeEventListener("app:route-blackout", handle);
  }, []);

  return visible;
}

function AppFloatingControls({ onOpenSettings }) {
  const { t } = useI18n();
  const { error, isLoading, isPlaying, station, toggle, volume, setVolume } = useRadio();

  return (
    <Stack className="app-floating-controls" direction="row" gap="0.5rem" sx={{ width: "auto" }}>
      <div className="app-radio-fab-wrap">
        <IconButton
          unstyled
          className={cx(
            "app-settings-fab",
            "app-radio-fab",
            isPlaying && "is-playing",
            isLoading && "is-loading"
          )}
          icon={Radio}
          iconSize={28}
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
            onChange={({ target }) => setVolume(target.value)}
          />
          <span>{Math.round(volume * 100)}%</span>
        </div>
      </div>

      <IconButton
        unstyled
        className="app-settings-fab"
        icon={Cog}
        iconSize={28}
        label={t("settings.open")}
        onClick={onOpenSettings}
      />
    </Stack>
  );
}

export default function AppLayout() {
  const { pathname } = useLocation();
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const routeBlackout = useRouteBlackout();

  const isKaraoke = pathname === ROUTES.karaoke;
  const isEditor = pathname.startsWith(ROUTES.editor);
  const showFloatingControls = !isKaraoke && !isEditor;

  const openSettings = () => setSettingsOpen(true);

  useOnlineRoomNavigation();

  return (
    <div
      className={cx(
        "app-shell",
        isKaraoke && "karaoke-app-shell",
        isEditor && "melody-editor-app-shell"
      )}
    >
      <TitleBar hideActions={isEditor} />

      <div className="app-body">
        <main className="app-main">
          <AppRoutes onOpenAppSettings={openSettings} />
        </main>

        {showFloatingControls && <AppFloatingControls onOpenSettings={openSettings} />}

        <div
          className={cx("app-route-blackout", routeBlackout && "is-visible")}
          aria-hidden="true"
        />

        {isSettingsOpen && (
          <Lazy>
            <Settings isOpen onClose={() => setSettingsOpen(false)} />
          </Lazy>
        )}
      </div>
    </div>
  );
}
