export function setGlobalRouteBlackout(visible) {
  if (typeof globalThis.CustomEvent === "function")
    globalThis.dispatchEvent?.(
      new CustomEvent("app:route-blackout", { detail: { visible: Boolean(visible) } })
    );
}
