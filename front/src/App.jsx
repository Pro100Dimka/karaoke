import { HashRouter } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { OnlineRoomDock } from "./components/OnlineRoomDock";
import RoomRadioSync from "./components/RoomRadioSync";
import KeyboardLighting from "./components/KeyboardLighting";
import BackendBootLoader from "./components/backend-boot-loader";
import AppLayout from "./components/layout";
import ContextProviders from "./contexts";

const future = { v7_startTransition: true, v7_relativeSplatPath: true };
export default function App() {
  return (
    <ErrorBoundary>
      <BackendBootLoader>
        <ContextProviders>
          <HashRouter future={future}>
            <AppLayout />
            <OnlineRoomDock />
            <RoomRadioSync />
            <KeyboardLighting />
          </HashRouter>
        </ContextProviders>
      </BackendBootLoader>
    </ErrorBoundary>
  );
}
