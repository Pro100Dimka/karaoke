import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const pages = {
  "/": lazy(() => import("../pages/Library")),
  "/karaoke": lazy(() => import("../pages/Karaoke")),
  "/editor/:songId": lazy(() => import("../pages/MelodyEditor"))
};

export default function AppRoutes({ onOpenAppSettings }) {
  return (
    <Suspense fallback={null}>
      <Routes>
        {Object.entries(pages).map(([path, Page]) => (
          <Route key={path} path={path} element={<Page onOpenAppSettings={onOpenAppSettings} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
