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

  if (isDev) {
    return url.origin === devOrigin;
  }

  if (url.protocol !== "file:") return false;
  return url.href === packagedIndexUrl || url.href.startsWith(`${packagedIndexUrl}#`);
}

function isTrustedIpcEvent(event, expectedWebContents) {
  return Boolean(
    expectedWebContents &&
      event?.sender === expectedWebContents &&
      !expectedWebContents.isDestroyed()
  );
}

module.exports = {
  getPackagedRendererUrl,
  isAllowedRendererUrl,
  isTrustedIpcEvent
};
