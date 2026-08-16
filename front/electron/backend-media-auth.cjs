const BACKEND_FILE_PATHS = [
  /^\/songs\/[^/]+\/audio\/(?:instrumental|vocals|song|diagnostic)$/,
  /^\/songs\/[^/]+\/cover$/,
  /^\/recording\/[^/]+\/(?:file|performance)$/
];

function shouldAuthenticateBackendFileRequest(details, backendUrl) {
  if (String(details?.method || "GET").toUpperCase() !== "GET") return false;
  let requestUrl;
  let expectedOrigin;
  try {
    requestUrl = new URL(details?.url || "");
    expectedOrigin = new URL(backendUrl).origin;
  } catch {
    return false;
  }
  if (requestUrl.origin !== expectedOrigin) return false;
  return BACKEND_FILE_PATHS.some((pattern) => pattern.test(requestUrl.pathname));
}

function installBackendFileAuthentication(webRequest, backendUrl, apiToken) {
  if (!webRequest?.onBeforeSendHeaders || !apiToken) return;
  const origin = new URL(backendUrl).origin;
  webRequest.onBeforeSendHeaders(
    { urls: [`${origin}/*`] },
    (details, callback) => {
      const requestHeaders = { ...(details.requestHeaders || {}) };
      if (shouldAuthenticateBackendFileRequest(details, backendUrl)) {
        requestHeaders["X-ADVoice-Token"] = apiToken;
      }
      callback({ requestHeaders });
    }
  );
}

module.exports = {
  installBackendFileAuthentication,
  shouldAuthenticateBackendFileRequest
};
