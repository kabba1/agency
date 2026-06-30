# Agency Token Launch Runbook

## T-7 Days

- Freeze feature work.
- Run `npm run typecheck`, `npm run build`, and `npm run api:smoke`.
- Confirm production database, backups, API host, web host, domain, and SSL.
- Confirm `AGENCY_ADMIN_TOKEN` is rotated and not exposed to the browser.
- Confirm legal review for site copy, token copy, risk disclaimer, privacy notice, and terms.
- Prepare moderation policy and support contact.

## T-3 Days

- Run a full staging rehearsal with at least 100 mock purchase events.
- Export a snapshot and restore it in a clean database.
- Test admin pause, ingestion pause, raw purchase inspection, forced resync, and snapshot export.
- Prepare token icon, banner, description, social links, and public FAQ.
- Prepare launch clips showing purchase-to-agent, spectator view, and wallet-owned private detail view.

## T-1 Day

- Production smoke test:
  - `/health` returns `ok: true`;
  - `/api/world/bootstrap` returns public state;
  - wallet nonce login works with a real wallet signature;
  - admin snapshot export works;
  - database backup is available.
- Configure the real token mint in `AGENCY_TOKEN_MINT`.
- Configure provider keys and start slot for chain ingestion.
- Keep ingestion paused until the controlled launch test buy.

## Launch Hour

- Create the token.
- Record mint address, launch wallet, deploy/admin wallet, and ops wallet details offline.
- Set `AGENCY_TOKEN_MINT` to the final mint.
- Start API and web services.
- Unpause ingestion.
- Send one controlled test buy.
- Confirm:
  - purchase event stored;
  - dedupe key stored;
  - one agent created;
  - anonymous viewers see public agent info only;
  - owner wallet sees private details;
  - WebSocket or bootstrap refresh shows the event.
- Publish token link and site.

## First 24 Hours

- Keep admin dashboard/API logs open.
- Watch:
  - ingestion lag;
  - duplicate event count;
  - API errors;
  - WebSocket reconnects;
  - database write errors;
  - snapshot export health;
  - support/moderation reports.
- Use pause switches before risky hotfixes.
- Export scheduled snapshots.

## Never Do During Launch

- Do not promise profit, revenue share, staking, dividends, buybacks, or guaranteed utility.
- Do not connect paid LLM decisions globally.
- Do not hot-edit database rows without exporting a snapshot first.
- Do not expose admin tokens in production browser code.
- Do not claim every buy creates unlimited agents unless that rule is intentionally changed and tested.

