export const setGlobalRouteBlackout = (visible) => {
  window.dispatchEvent(
    new CustomEvent("app:route-blackout", { detail: { visible: Boolean(visible) } })
  );
};
