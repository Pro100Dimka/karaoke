import { HashRouter } from "react-router-dom";
import { OnlineRoomDock } from "./components/OnlineRoomDock";
import RoomRadioSync from "./components/RoomRadioSync";
import BackendBootLoader from "./components/backend-boot-loader";
import AppLayout from "./components/layout";
import { ErrorBoundary } from "./components/ui";
import ContextProviders from "./contexts";

const routerFutureConfig = {
  v7_startTransition: true,
  v7_relativeSplatPath: true
};

export default function App() {
  return (
    <ErrorBoundary>
      <BackendBootLoader>
        <ContextProviders>
          <HashRouter future={routerFutureConfig}>
            <AppLayout />
            <OnlineRoomDock />
            <RoomRadioSync />
          </HashRouter>
        </ContextProviders>
      </BackendBootLoader>
    </ErrorBoundary>
  );
}
