# Agency Launch Readiness

Agency now has the first production-facing skeleton around the local city viewer:

- a Node API with health, bootstrap, wallet nonce login, admin controls, mock purchase ingestion, and snapshot export;
- a local SQLite/libSQL database under `data/`;
- shared launch contracts for purchases, wallet sessions, public/private agent views, and snapshots;
- a chain abstraction with working mock ingestion and a deliberately paused Solana ingestion placeholder;
- a local-only brain adapter seam and LLM budget simulator;
- browser controls for a dev wallet and mock purchase-to-agent spawning.

This is not yet a real token launch build. It is the local launch harness that lets us harden the purchase-to-agent contract before connecting a live mint.

## Local Launch Harness

Run the API:

```bash
npm run dev:api
```

Run the viewer in another terminal:

```bash
npm run dev
```

Open `http://127.0.0.1:5173/`.

Use the top bar:

- `Dev Wallet` creates a local signed-nonce session using the current wallet address field.
- `Mock Buy` sends a backend mock purchase event and spawns the resulting wallet-linked agent in the city.
- `Spawn Agent` remains a local fallback for non-purchase sim testing.

## Launch Gates Still Required

- Replace dev wallet flow with real Solana wallet adapter signing.
- Configure production database hosting/backups.
- Configure `SolanaPurchaseIngestor` with provider webhook/backfill logic.
- Run a staging launch rehearsal against a mocked or staging mint.
- Complete legal/copy review.
- Remove dev admin token exposure from the browser before production.

## Current Commands

```bash
npm run typecheck
npm run build
npm run api:smoke
```

`npm run api:smoke` verifies:

- mock purchase creates one agent;
- duplicate purchase creates no extra agent;
- anonymous state hides owner-private details;
- connected wallet sees owner-private details;
- snapshot export restores deterministically.

