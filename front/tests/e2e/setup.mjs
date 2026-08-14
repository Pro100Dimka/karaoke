import { createServer } from "vite";

export default async function setup() {
  const previousMockApi = process.env.VITE_USE_MOCK_API;
  process.env.VITE_USE_MOCK_API = "true";
  const server = await createServer({
    configFile: "vite.config.mjs",
    mode: "mock",
    server: { host: "127.0.0.1", port: 4173, strictPort: true }
  });

  await server.listen();
  return async () => {
    await server.close();
    if (previousMockApi === undefined) delete process.env.VITE_USE_MOCK_API;
    else process.env.VITE_USE_MOCK_API = previousMockApi;
  };
}
