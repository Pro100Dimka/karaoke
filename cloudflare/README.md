# Karaoke Studio Online

Cloudflare Worker and Durable Object for room state and WebRTC signalling.

## Cloudflare Git deployment

- Root directory: `cloudflare`
- Build command: `npm install`
- Deploy command: `npm run deploy`

The first deploy creates the `KaraokeRoom` Durable Object. The Worker URL is
used by the desktop application as its online signalling endpoint.

TURN credentials are deliberately not stored in this repository. They are
added later as Cloudflare Worker secrets.
