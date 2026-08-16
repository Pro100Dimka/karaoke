const nodeNet = require("net");

function freeLoopbackPort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = nodeNet.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host, port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not allocate a backend loopback port"));
        else resolve(port);
      });
    });
  });
}

async function chooseRuntimeBackendEndpoint({ isDev, explicitUrl, defaultUrl }) {
  const parsed = new URL(defaultUrl);
  if (isDev || explicitUrl) {
    return { url: parsed.origin, host: parsed.hostname, port: Number(parsed.port || 80) };
  }
  const host = "127.0.0.1";
  const port = await freeLoopbackPort(host);
  return { url: `http://${host}:${port}`, host, port };
}

module.exports = { chooseRuntimeBackendEndpoint, freeLoopbackPort };
