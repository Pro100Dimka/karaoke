import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { api } from "./api/client";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import Library from "./pages/Library";
import Processing from "./pages/Processing";
import Karaoke from "./pages/Karaoke";
import Recording from "./pages/Recording";
import Analysis from "./pages/Analysis";
import SongSettings from "./pages/SongSettings";
import Settings from "./pages/Settings";
import MemoryManager from "./pages/MemoryManager";
import Diagnostics from "./pages/Diagnostics";
import ModelManager from "./pages/ModelManager";
import History from "./pages/History";
import About from "./pages/About";

export default function App() {
  useEffect(() => {
    api.getAppSettings().then((settings) => {
      const theme = settings.theme || "dark";
      document.documentElement.dataset.theme = theme;
    }).catch(() => {});
  }, []);

  return (
    <HashRouter>
      <AppLayout />
    </HashRouter>
  );
}

function AppLayout() {
  const location = useLocation();
  const isKaraoke = location.pathname === "/karaoke";

  return (
      <div className={`app-shell ${isKaraoke ? "karaoke-app-shell" : ""}`}>
        <TitleBar />
        <div className="app-body">
          <Sidebar />
          <main className="app-main">
            <Routes>
              <Route path="/" element={<Library />} />
              <Route path="/processing" element={<Processing />} />
              <Route path="/karaoke" element={<Karaoke />} />
              <Route path="/recording" element={<Recording />} />
              <Route path="/analysis" element={<Analysis />} />
              <Route path="/song-settings" element={<SongSettings />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/memory" element={<MemoryManager />} />
              <Route path="/diagnostics" element={<Diagnostics />} />
              <Route path="/models" element={<ModelManager />} />
              <Route path="/history" element={<History />} />
              <Route path="/about" element={<About />} />
            </Routes>
          </main>
        </div>
      </div>
  );
}
