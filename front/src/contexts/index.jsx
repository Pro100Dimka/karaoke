import { I18nProvider } from "../i18n";
import { AppDialogProvider } from "./AppDialog";
import { OnlineRoomProvider } from "./OnlineRoomContext";
import AppSettingsProvider from "./app-settings";
import { RadioProvider } from "./radio";

export default function ContextProviders({ children }) {
  return (
    <AppSettingsProvider>
      <I18nProvider>
        <AppDialogProvider>
          <RadioProvider>
            <OnlineRoomProvider>{children}</OnlineRoomProvider>
          </RadioProvider>
        </AppDialogProvider>
      </I18nProvider>
    </AppSettingsProvider>
  );
}
