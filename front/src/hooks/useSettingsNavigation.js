import { useState } from "react";

const DEFAULT_NAVIGATION = { tab: "appearance", service: null };

export default function useSettingsNavigation() {
  const [navigation, setNavigation] = useState(DEFAULT_NAVIGATION);

  return {
    ...navigation,
    selectTab: (tab) => setNavigation({ tab, service: null }),
    openService: (service) => setNavigation({ tab: "service", service }),
    closeService: () => setNavigation((c) => ({ ...c, service: null }))
  };
}
