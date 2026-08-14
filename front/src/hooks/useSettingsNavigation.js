import { useState } from "react";

export default function useSettingsNavigation(initialTab = "audio") {
  const [navigation, setNavigation] = useState({
    tab: initialTab,
    service: null
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
