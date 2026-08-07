# Karaoke Studio Frontend

Desktop frontend for Karaoke Studio built with React, Vite and Electron. The application manages the local song library, karaoke playback, microphone monitoring, performance recording and optional online rooms.

## Requirements

- Node.js 20 or newer
- npm
- The local Karaoke Studio backend, unless mock mode is used

## Development

```bash
npm ci
npm run dev
```

Electron development:

```bash
npm run dev:electron
```

Mock mode without a backend:

```bash
npm run dev:mock
```

## Quality checks

```bash
npm run verify
```

The repository also contains dependency, reachability, architecture, React cleanup, CSS, complexity and duplicate-code audits:

```bash
npm run audit
```

See `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/SECURITY.md` and `docs/CONTRIBUTING.md` before making structural changes.


## Audit rounds 11–15

Последующие проверки описаны в `AUDIT-ROUND-11.md` — `AUDIT-ROUND-15.md`. Вёрстка и CSS не изменялись.
