const STUN = [{ urls: "stun:stun.cloudflare.com:3478" }];
// Credentials outlive a normal singing session; permanent keys never leave Workers.
const TTL_SECONDS = 86400;

export async function generateRoomIce(env, fetcher = fetch) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN)
    return { iceServers: STUN, relayAvailable: false, expiresAt: Date.now() + 60_000 };
  const response = await fetcher(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw new Error("TURN credential service unavailable");
  const data = await response.json();
  const iceServers = (Array.isArray(data.iceServers) ? data.iceServers : []).slice(0, 8).flatMap((server) => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
      (url) => typeof url === "string" && /^(stun|turn|turns):/.test(url) && !/:53(?:\?|$)/.test(url),
    );
    if (!urls.length) return [];
    const relay = urls.some((url) => /^turns?:/.test(url));
    if (relay && (typeof server.username !== "string" || typeof server.credential !== "string")) return [];
    return [{ urls, ...(relay ? { username: server.username, credential: server.credential } : {}) }];
  });
  if (!iceServers.some((server) => server.urls.some((url) => /^turns?:/.test(url))))
    throw new Error("TURN credential service returned no relay");
  return { iceServers, relayAvailable: true, expiresAt: Date.now() + TTL_SECONDS * 1000 };
}
