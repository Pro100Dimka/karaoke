import { vi } from "vitest";
const fixture = vi.hoisted(() => ({ settings: null }));
vi.mock("../../src/pages/Settings/use-settings", () => ({ default: () => fixture.settings }));
vi.mock("../../src/pages/Settings/ModelStatus", () => ({ default: () => null }));
vi.mock("../../src/theme/ui", async (importOriginal) => ({
  ...(await importOriginal()),
  Modal: ({ children, titleProps }) => (
    <main>
      {titleProps.actions}
      {children}
    </main>
  )
}));
import { I18nContext, translateMessage } from "../../src/i18n";
import Settings from "../../src/pages/Settings";

export default function SettingsPage({ tab, settings, language = "ru" }) {
  fixture.settings = settings;
  return (
    <I18nContext.Provider value={{ language, t: (key, values, fallback) => translateMessage(language, key, values, fallback) }}>
      <Settings key={tab} initialTab={tab} />
    </I18nContext.Provider>
  );
}
