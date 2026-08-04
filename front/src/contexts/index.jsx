import { AppDialogProvider } from "./AppDialog";
import { AppSettingsProvider } from "./AppSettingsContext";
import { OnlineRoomProvider } from "./OnlineRoomContext";

export default function ContextProviders({ children }) {
  return (
    <AppDialogProvider>
      <AppSettingsProvider>
        <OnlineRoomProvider>{children}</OnlineRoomProvider>
      </AppSettingsProvider>
    </AppDialogProvider>
  );
}
