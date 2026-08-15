const { pathToFileURL } = require("url");

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function getPackagedRendererUrl(distIndexPath) {
  return pathToFileURL(distIndexPath).href;
}

function isAllowedRendererUrl(value, { isDev, devOrigin, packagedIndexUrl }) {
  const url = parseUrl(value);
  if (!url) return false;

  if (isDev) return url.origin === devOrigin;

  if (url.protocol !== "file:") return false;
  return (
    url.href === packagedIndexUrl || url.href.startsWith(`${packagedIndexUrl}#`)
  );
}

function isAllowedPermissionRequest({
  permission,
  requestUrl,
  mediaTypes,
  webContents,
  expectedWebContents,
  rendererOptions
}) {
  if (
    permission !== "media" ||
    webContents !== expectedWebContents ||
    expectedWebContents?.isDestroyed() ||
    !isAllowedRendererUrl(requestUrl, rendererOptions)
  ) {
    return false;
  }
  if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) return true;
  return mediaTypes.every((type) => type === "audio");
}

function isTrustedIpcEvent(event, expectedWebContents) {
  return Boolean(
    expectedWebContents &&
    event?.sender === expectedWebContents &&
    !expectedWebContents.isDestroyed()
  );
}

function registerTrustedIpc(ipcMain, channel, getExpectedWebContents, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcEvent(event, getExpectedWebContents())) {
      throw new Error(`Rejected IPC request: ${channel}`);
    }
    return handler(...args);
  });
}

module.exports = {
  isAllowedPermissionRequest,
  getPackagedRendererUrl,
  isAllowedRendererUrl,
  isTrustedIpcEvent,
  registerTrustedIpc
};
