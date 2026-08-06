import { AppDialogProvider } from "./AppDialog";
import { OnlineRoomProvider } from "./OnlineRoomContext";
import AppSettingsProvider from "./app-settings";
import { RadioProvider } from "./radio";

export default function ContextProviders({ children }) {
  return (
    <AppDialogProvider>
      <AppSettingsProvider>
        <RadioProvider>
          <OnlineRoomProvider>{children}</OnlineRoomProvider>
        </RadioProvider>
      </AppSettingsProvider>
    </AppDialogProvider>
  );
}
