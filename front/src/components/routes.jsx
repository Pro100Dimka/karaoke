import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const Karaoke = lazy(() => import("../pages/Karaoke"));
const Library = lazy(() => import("../pages/Library"));
const MelodyEditorPage = lazy(() => import("../pages/MelodyEditor"));

export default function AppRoutes({ onOpenAppSettings }) {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/karaoke" element={<Karaoke onOpenAppSettings={onOpenAppSettings} />} />
        <Route path="/editor/:songId" element={<MelodyEditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
