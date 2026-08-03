import { HashRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Cog, X } from "lucide-react";
import { api } from "./api/client";
import TitleBar from "./components/TitleBar";
import Library from "./pages/Library";
import Karaoke from "./pages/Karaoke";
import Analysis from "./pages/Analysis";
import SongSettings from "./pages/SongSettings";
import Settings from "./pages/Settings";
import MemoryManager from "./pages/MemoryManager";
import Diagnostics from "./pages/Diagnostics";
import ModelManager from "./pages/ModelManager";
import History from "./pages/History";
import About from "./pages/About";
import { AppDialogProvider } from "./components/AppDialog";
import { useAppDialog } from "./components/AppDialog";

export default function App() {
  useLayoutEffect(() => {
    const savedTheme = window.localStorage.getItem("karaoke-theme");
    document.documentElement.dataset.theme = savedTheme || "dark";
  }, []);

  useEffect(() => {
    let active = true;
    api
      .getAppSettings()
      .then((settings) => {
        if (!active) return;
        const theme = settings.theme || "dark";
        document.documentElement.dataset.theme = theme;
        window.localStorage.setItem("karaoke-theme", theme);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <AppDialogProvider><HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppLayout />
    </HashRouter></AppDialogProvider>
  );
}

function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isKaraoke = location.pathname === "/karaoke";
  const isSongSettings = location.pathname === "/song-settings";
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const { alert } = useAppDialog();

  useEffect(() => {
    let active = true;
    api.getAppSettings().then((settings) => {
      if (!active || settings.online_name?.trim()) return;
      setSettingsOpen(true);
      alert("Укажите своё имя в настройках приложения. Оно нужно для совместного исполнения и будет видно участникам комнаты.");
    }).catch(() => {});
    return () => { active = false; };
  }, [alert]);

  return <div className={`app-shell ${isKaraoke ? "karaoke-app-shell" : ""}`}>
    <TitleBar />
    <div className="app-body">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/karaoke" element={<Karaoke onOpenAppSettings={() => setSettingsOpen(true)} />} />
          <Route path="/analysis" element={<Analysis />} />
          <Route path="/song-settings" element={<Library />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/memory" element={<MemoryManager />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
          <Route path="/models" element={<ModelManager />} />
          <Route path="/history" element={<History />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </main>
      {!isKaraoke && <button type="button" className="app-settings-fab" onClick={() => setSettingsOpen(true)} title="Настройки приложения" aria-label="Настройки приложения"><Cog size={29} /></button>}
      {isSettingsOpen && <div className="settings-modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
        <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Настройки приложения" onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className="settings-modal-close" onClick={() => setSettingsOpen(false)} aria-label="Закрыть настройки"><X size={20} /></button>
          <Settings />
        </section>
      </div>}
      {isSongSettings && createPortal(
        <div className="song-recordings-backdrop" role="presentation" onMouseDown={() => navigate(-1)}>
          <section className="song-settings-modal" role="dialog" aria-modal="true" aria-label="Настройки песни" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="song-recordings-close" onClick={() => navigate(-1)} aria-label="Закрыть настройки"><X size={18} /></button>
            <SongSettings />
          </section>
        </div>,
        document.body,
      )}
    </div>
  </div>;
}
