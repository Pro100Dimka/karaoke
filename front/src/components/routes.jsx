import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const Karaoke = lazy(() => import("../pages/Karaoke"));
const Library = lazy(() => import("../pages/Library"));
const MelodyEditorPage = lazy(() => import("../pages/MelodyEditor"));

const routes = [
  { path: "/", Comp: Library },
  { path: "/karaoke", Comp: Karaoke },
  { path: "/editor/:songId", Comp: MelodyEditorPage }
];

export default function AppRoutes({ onOpenAppSettings, onOpenSongSettings }) {
  return (
    <Suspense fallback={null}>
      <Routes>
        {routes.map(({ path, Comp }) => (
          <Route
            key={path}
            path={path}
            element={
              <Comp onOpenAppSettings={onOpenAppSettings} onOpenSongSettings={onOpenSongSettings} />
            }
          />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
