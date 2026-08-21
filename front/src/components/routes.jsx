import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const Karaoke = lazy(() => import("../pages/Karaoke"));
const Library = lazy(() => import("../pages/Library"));
const MelodyEditorPage = lazy(() => import("../pages/MelodyEditor"));

export default function AppRoutes({ onOpenAppSettings }) {
  const routes = [
    { path: "/", element: <Library /> },
    { path: "/karaoke", element: <Karaoke onOpenAppSettings={onOpenAppSettings} /> },
    { path: "/editor/:songId", element: <MelodyEditorPage /> }
  ];
  return (
    <Suspense fallback={null}>
      <Routes>
        {routes.map(({ path, element }) => (
          <Route key={path} path={path} element={element} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
