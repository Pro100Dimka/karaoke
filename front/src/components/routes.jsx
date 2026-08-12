import { Navigate, Route, Routes } from "react-router-dom";
import Karaoke from "../pages/Karaoke";
import Library from "../pages/Library";
import MelodyEditorPage from "../pages/MelodyEditor";

const routes = [
  { path: "/", Comp: Library },
  { path: "/karaoke", Comp: Karaoke },
  { path: "/editor/:songId", Comp: MelodyEditorPage }
];

export default function AppRoutes({ onOpenAppSettings, onOpenSongSettings }) {
  return (
    <Routes>
      {routes.map(({ path, Comp }) => (
        <Route
          key={path}
          path={path}
          element={
            <Comp
              onOpenAppSettings={onOpenAppSettings}
              onOpenSongSettings={onOpenSongSettings}
            />
          }
        />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
