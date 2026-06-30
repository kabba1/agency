import { strict as assert } from "node:assert";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createAgencyApi } from "./server.js";

const dbPath = path.join("data", "agency-smoke.db");
await mkdir("data", { recursive: true });
await rm(dbPath, { force: true });
process.env.AGENCY_DB_URL = `file:${dbPath}`;
const adminToken = "agency-dev-admin";

const { app } = await createAgencyApi();

const health = await app.inject({ method: "GET", url: "/health" });
assert.equal(health.statusCode, 200);
assert.equal(health.json().ok, true);

const walletAddress = "11111111111111111111111111111111";
const purchaseBody = {
  walletAddress,
  tokenMint: "agency-smoke-mint",
  tokenAmountDelta: 10,
  solDelta: 0.2,
  txSignature: "smoke-tx-1",
  slot: 12345,
  blockTime: 1_700_000_000
};

const purchase = await app.inject({
  method: "POST",
  url: "/api/admin/mock-purchase",
  headers: { "x-admin-token": adminToken },
  payload: purchaseBody
});
assert.equal(purchase.statusCode, 200);
assert.equal(purchase.json().result.agentCreated, true);
const agentId = purchase.json().result.agentId;
assert.ok(agentId);

const duplicate = await app.inject({
  method: "POST",
  url: "/api/admin/mock-purchase",
  headers: { "x-admin-token": adminToken },
  payload: purchaseBody
});
assert.equal(duplicate.statusCode, 200);
assert.equal(duplicate.json().result.duplicate, true);
assert.equal(duplicate.json().result.agentCreated, false);

const nonce = await app.inject({ method: "POST", url: "/api/auth/nonce", payload: { walletAddress } });
assert.equal(nonce.statusCode, 200);
const nonceBody = nonce.json();
const session = await app.inject({
  method: "POST",
  url: "/api/auth/verify",
  payload: {
    walletAddress,
    nonce: nonceBody.nonce,
    signature: `dev:${nonceBody.nonce}`
  }
});
assert.equal(session.statusCode, 200);
const token = session.json().token;

const publicState = await app.inject({ method: "GET", url: "/api/world/bootstrap" });
assert.equal(publicState.statusCode, 200);
assert.equal(publicState.json().agents[0].ownerPrivate, undefined);

const ownerState = await app.inject({
  method: "GET",
  url: "/api/world/bootstrap",
  headers: { authorization: `Bearer ${token}` }
});
assert.equal(ownerState.statusCode, 200);
assert.ok(ownerState.json().agents[0].ownerPrivate.walletAddress);

const snapshot = await app.inject({
  method: "GET",
  url: "/api/admin/export-snapshot",
  headers: { "x-admin-token": adminToken }
});
assert.equal(snapshot.statusCode, 200);
assert.equal(snapshot.json().agents.length, 1);
assert.equal(snapshot.json().purchases.length, 1);

await app.close();
console.log("Agency API smoke passed.");
