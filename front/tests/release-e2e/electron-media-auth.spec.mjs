import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, _electron as electron } from "@playwright/test";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const frontRoot = path.resolve(dirname, "../..");
const harness = path.join(dirname, "electron-media-auth-harness.cjs");

function waveBuffer() {
  const samples = 8_000;
  const pcm = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8_000, 24);
  header.writeUInt32LE(16_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

test("real Electron media element authenticates localhost playback and preserves Range", async () => {
  const token = "release-e2e-launch-secret";
  const wav = waveBuffer();
  let resolveRequest;
  const requestSeen = new Promise((resolve) => { resolveRequest = resolve; });

  const server = http.createServer((request, response) => {
    if (request.url !== "/songs/release-song/audio/instrumental") {
      response.writeHead(404).end();
      return;
    }
    const observation = {
      token: request.headers["x-advoice-token"],
      range: request.headers.range ?? null,
      method: request.method
    };
    resolveRequest(observation);
    if (observation.token !== token) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(observation.range ?? "");
    if (range) {
      const start = Number(range[1]);
      const requestedEnd = range[2] ? Number(range[2]) : wav.length - 1;
      const end = Math.min(requestedEnd, wav.length - 1);
      response.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${wav.length}`,
        "Content-Length": end - start + 1,
        "Content-Type": "audio/wav"
      });
      response.end(wav.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": wav.length,
      "Content-Type": "audio/wav"
    });
    response.end(wav);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const backendBase = `http://127.0.0.1:${address.port}`;

  let app;
  try {
    app = await electron.launch({
      args: [harness],
      cwd: frontRoot,
      env: {
        ...process.env,
        ADVOICE_E2E_BACKEND: backendBase,
        ADVOICE_E2E_TOKEN: token
      }
    });
    const window = await app.firstWindow();
    await expect(window.locator("#status")).toHaveText(/playing|loaded/, { timeout: 15_000 });
    const observed = await Promise.race([
      requestSeen,
      new Promise((_, reject) => setTimeout(() => reject(new Error("No media request reached the server")), 15_000))
    ]);
    expect(observed.method).toBe("GET");
    expect(observed.token).toBe(token);
    expect(observed.range).toMatch(/^bytes=/);
  } finally {
    if (app) await app.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
