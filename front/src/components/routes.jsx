import { Route, Routes } from "react-router-dom";
import Karaoke from "../pages/Karaoke";
import Library from "../pages/Library";

const routes = [
  { path: "/", Comp: Library },
  { path: "/karaoke", Comp: Karaoke }
];

export default function AppRoutes({ onOpenAppSettings }) {
  return (
    <Routes>
      {routes.map(({ path, Comp }, index) => (
        <Route
          key={index}
          path={path}
          element={<Comp onOpenAppSettings={onOpenAppSettings} />}
        />
      ))}
    </Routes>
  );
}
