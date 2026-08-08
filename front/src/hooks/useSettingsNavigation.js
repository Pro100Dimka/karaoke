import { useState } from "react";

const DEFAULT_NAVIGATION = { tab: "audio", service: null };

export default function useSettingsNavigation(initialTab = "audio") {
  const [navigation, setNavigation] = useState({
    ...DEFAULT_NAVIGATION,
    tab: initialTab
  });

  return {
    ...navigation,
    selectTab: (tab) => setNavigation({ tab, service: null }),
    openService: (service) => setNavigation({ tab: "service", service }),
    closeService: () => setNavigation((c) => ({ ...c, service: null }))
  };
}
