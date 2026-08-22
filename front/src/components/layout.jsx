import { Cog, Radio, Volume2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useRadio } from "../contexts/radio";
import { useOnlineRoomNavigation } from "../hooks/useOnlineRoomNavigation";
import { useI18n } from "../i18n";
import { Box, IconButton, Slider, Stack } from "../theme/ui";
import TitleBar from "./TitleBar";
import AppRoutes from "./routes";

const Settings = lazy(() => import("../pages/Settings"));
const useBlackout = () => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const listener = ({ detail }) => setVisible(Boolean(detail?.visible));
    window.addEventListener("app:route-blackout", listener);
    return () => window.removeEventListener("app:route-blackout", listener);
  }, []);
  return visible;
};

function FloatingControls({ openSettings }) {
  const { t } = useI18n();
  const radio = useRadio();
  const radioLabel =
    radio.error ||
    t(radio.isPlaying ? "radio.disable" : "radio.enable", { station: radio.station.name });
  return (
    <Stack
      className="app-floating-controls"
      direction="row"
      align="end"
      gap="var(--space-2)"
      sx={{
        position: "fixed",
        inset: "auto var(--space-5) var(--space-5) auto",
        inlineSize: "auto",
        zIndex: 20
      }}
    >
      <Stack
        className="app-radio-fab-wrap"
        align="end"
        gap="var(--space-2)"
        sx={{ inlineSize: "auto" }}
      >
        <IconButton
          icon={Radio}
          iconSize={28}
          label={radioLabel}
          onClick={radio.toggle}
          className={`app-settings-fab app-radio-fab${radio.isPlaying ? " is-playing" : ""}${radio.isLoading ? " is-loading" : ""}`}
        />
        <Stack
          className="app-radio-volume"
          direction="row"
          align="center"
          gap="var(--space-2)"
          aria-label={t("radio.volume")}
          sx={{
            inlineSize: "auto",
            padding: "var(--space-2)",
            borderRadius: "var(--radius-pill)",
            background: "var(--color-surface-glass)"
          }}
        >
          <Volume2 size={15} />
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={radio.volume}
            showValue={false}
            onChange={(value) => radio.setVolume(value)}
            controlSx={{ inlineSize: "var(--space-16)" }}
          />
          <span>{Math.round(radio.volume * 100)}%</span>
        </Stack>
      </Stack>
      <IconButton
        icon={Cog}
        iconSize={28}
        label={t("settings.open")}
        onClick={openSettings}
        className="app-settings-fab"
      />
    </Stack>
  );
}

export default function AppLayout() {
  const { pathname } = useLocation();
  const [settings, setSettings] = useState(false);
  const blackout = useBlackout();
  const karaoke = pathname === "/karaoke";
  const editor = pathname.startsWith("/editor/");
  useOnlineRoomNavigation();
  return (
    <Box
      className={`app-shell${karaoke ? " karaoke-app-shell" : ""}${editor ? " melody-editor-app-shell" : ""}`}
      sx={{ display: "flex", flexDirection: "column", minBlockSize: "100vh" }}
    >
      <TitleBar hideActions={editor} />
      <Box className="app-body" sx={{ position: "relative", flex: 1, minBlockSize: 0 }}>
        <Box as="main" className="app-main" sx={{ blockSize: "100%" }}>
          <AppRoutes onOpenAppSettings={() => setSettings(true)} />
        </Box>
        {!karaoke && !editor && <FloatingControls openSettings={() => setSettings(true)} />}
        <Box
          className={`app-route-blackout${blackout ? " is-visible" : ""}`}
          aria-hidden="true"
          sx={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            opacity: blackout ? 1 : 0,
            background: "var(--color-bg-deep)",
            transition: "opacity var(--duration-fast)"
          }}
        />
        {settings && (
          <Suspense fallback={null}>
            <Settings isOpen onClose={() => setSettings(false)} />
          </Suspense>
        )}
      </Box>
    </Box>
  );
}
