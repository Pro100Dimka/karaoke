import { I18nProvider } from "../i18n";
import { AppDialogProvider } from "./AppDialog";
import { OnlineRoomProvider } from "./OnlineRoomContext";
import AppSettingsProvider from "./app-settings";
import { RadioProvider } from "./radio";

export default function ContextProviders({ children }) {
  return (
    <AppDialogProvider>
      <AppSettingsProvider>
        <I18nProvider>
          <RadioProvider>
            <OnlineRoomProvider>{children}</OnlineRoomProvider>
          </RadioProvider>
        </I18nProvider>
      </AppSettingsProvider>
    </AppDialogProvider>
  );
}
