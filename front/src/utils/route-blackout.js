export function setGlobalRouteBlackout(visible) {
  const Event = globalThis.CustomEvent;
  if (typeof Event === "function")
    globalThis.dispatchEvent?.(
      new Event("app:route-blackout", { detail: { visible: Boolean(visible) } })
    );
}
