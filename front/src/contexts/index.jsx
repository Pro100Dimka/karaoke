import { AppDialogProvider } from "./AppDialog";
import { OnlineRoomProvider } from "./OnlineRoomContext";
import AppSettingsProvider from "./app-settings";

export default function ContextProviders({ children }) {
  return (
    <AppDialogProvider>
      <AppSettingsProvider>
        <OnlineRoomProvider>{children}</OnlineRoomProvider>
      </AppSettingsProvider>
    </AppDialogProvider>
  );
}
