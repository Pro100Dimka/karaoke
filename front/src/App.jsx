import { HashRouter } from "react-router-dom";
import { OnlineRoomDock } from "./components/OnlineRoomDock";
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
      <ContextProviders>
        <HashRouter future={routerFutureConfig}>
          <AppLayout />
          <OnlineRoomDock />
        </HashRouter>
      </ContextProviders>
    </ErrorBoundary>
  );
}
