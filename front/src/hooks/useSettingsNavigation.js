import { useState } from "react";

const DEFAULT_NAVIGATION = {
  tab: "audio",
  service: null
};

export default function useSettingsNavigation(initialTab = "audio") {
  const [navigation, setNavigation] = useState({
    ...DEFAULT_NAVIGATION,
    tab: initialTab
  });

  const selectTab = (tab) => {
    setNavigation({
      tab,
      service: null
    });
  };

  const openService = (service) => {
    setNavigation((current) => ({
      ...current,
      service
    }));
  };

  const closeService = () => {
    setNavigation((current) => ({
      ...current,
      service: null
    }));
  };

  return {
    ...navigation,
    selectTab,
    openService,
    closeService
  };
}
