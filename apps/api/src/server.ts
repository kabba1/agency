import websocket from "@fastify/websocket";
import bs58 from "bs58";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { pathToFileURL } from "node:url";
import nacl from "tweetnacl";
import { z } from "zod";
import { MockPurchaseIngestor, SolanaPurchaseIngestor } from "../../../packages/chain/src/index.js";
import { purchaseEventSchema, type PurchaseEvent } from "../../../packages/shared/src/index.js";
import { createLaunchDb, type LaunchDb } from "./db.js";

const adminToken = process.env.AGENCY_ADMIN_TOKEN ?? "agency-dev-admin";
const launchedMint = process.env.AGENCY_TOKEN_MINT ?? "agency-dev-mint";
const port = Number(process.env.AGENCY_API_PORT ?? 8787);
const host = process.env.AGENCY_API_HOST ?? "127.0.0.1";

const mockPurchaseBodySchema = z.object({
  walletAddress: z.string().min(8),
  tokenMint: z.string().min(4).default(launchedMint),
  tokenAmountDelta: z.number().positive().default(1),
  solDelta: z.number().default(0),
  txSignature: z.string().optional(),
  slot: z.number().int().nonnegative().optional(),
  blockTime: z.number().int().nonnegative().optional(),
  instructionIndex: z.number().int().min(0).default(0),
  logIndex: z.number().int().min(0).default(0)
});

const nonceRequestSchema = z.object({
  walletAddress: z.string().min(8)
});

const nonceVerifySchema = z.object({
  walletAddress: z.string().min(8),
  nonce: z.string().min(8),
  signature: z.string().min(4)
});

const bearerToken = (request: FastifyRequest) => {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim();
};

const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
  if (request.headers["x-admin-token"] !== adminToken) {
    await reply.status(401).send({ error: "Admin token required." });
    return null;
  }
  return "local-admin";
};

const verifyWalletSignature = (walletAddress: string, signature: string, message: string, nonce: string) => {
  if ((process.env.AGENCY_ALLOW_DEV_SIGNATURES ?? "true") !== "false" && signature === `dev:${nonce}`) return true;
  try {
    const publicKey = bs58.decode(walletAddress);
    const signatureBytes = bs58.decode(signature);
    const messageBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
  } catch {
    return false;
  }
};

export const createAgencyApi = async () => {
  const db = await createLaunchDb();
  const app = Fastify({ logger: true });
  const sockets = new Set<{ send: (payload: string) => void; readyState?: number }>();
  const mockIngestor = new MockPurchaseIngestor();
  const solanaIngestor = new SolanaPurchaseIngestor({
    tokenMint: launchedMint,
    heliusApiKey: process.env.HELIUS_API_KEY,
    rpcUrl: process.env.SOLANA_RPC_URL,
    startSlot: process.env.AGENCY_START_SLOT ? Number(process.env.AGENCY_START_SLOT) : undefined
  });
  await mockIngestor.start();
  await solanaIngestor.start();

  const broadcast = (type: string, payload: unknown) => {
    const message = JSON.stringify({ type, payload, sentAt: Date.now() });
    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch {
        sockets.delete(socket);
      }
    }
  };

  app.addHook("onSend", async (_request, reply, payload) => {
    const origin = _request.headers.origin;
    const configuredOrigins = (process.env.AGENCY_WEB_ORIGIN ?? "http://127.0.0.1:5173")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const localhostOrigin = origin && /^https?:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
    reply.header("access-control-allow-origin", localhostOrigin ? origin : configuredOrigins[0]);
    reply.header("access-control-allow-headers", "content-type, authorization, x-admin-token");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    return payload;
  });

  app.options("/*", async (_request, reply) => {
    await reply.status(204).send();
  });

  await app.register(websocket);

  app.get("/health", async () => ({
    ok: true,
    service: "agency-api",
    launchedMint,
    mockIngestor: mockIngestor.status(),
    solanaIngestor: solanaIngestor.status()
  }));

  app.get("/api/world/bootstrap", async (request) => {
    const wallet = await db.walletForSession(bearerToken(request));
    return db.getBootstrap(wallet);
  });

  app.get("/api/agents", async (request) => {
    const wallet = await db.walletForSession(bearerToken(request));
    const state = await db.getBootstrap(wallet);
    return { agents: state.agents };
  });

  app.post("/api/auth/nonce", async (request, reply) => {
    const parsed = nonceRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return db.createNonce(parsed.data.walletAddress);
  });

  app.post("/api/auth/verify", async (request, reply) => {
    const parsed = nonceVerifySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const message = `Agency login nonce: ${parsed.data.nonce}`;
    const valid = verifyWalletSignature(parsed.data.walletAddress, parsed.data.signature, message, parsed.data.nonce);
    if (!valid) return reply.status(401).send({ error: "Wallet signature could not be verified." });
    const consumed = await db.consumeNonce(parsed.data.walletAddress, parsed.data.nonce);
    if (!consumed) return reply.status(401).send({ error: "Nonce expired or already used." });
    return db.createSession(parsed.data.walletAddress);
  });

  app.post("/api/admin/mock-purchase", async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const parsed = mockPurchaseBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const event: PurchaseEvent = purchaseEventSchema.parse({
      chainId: "solana-devnet",
      walletAddress: parsed.data.walletAddress,
      txSignature: parsed.data.txSignature ?? `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      instructionIndex: parsed.data.instructionIndex,
      logIndex: parsed.data.logIndex,
      tokenMint: parsed.data.tokenMint,
      tokenAmountDelta: parsed.data.tokenAmountDelta,
      solDelta: parsed.data.solDelta,
      slot: parsed.data.slot ?? Date.now(),
      blockTime: parsed.data.blockTime ?? Math.floor(Date.now() / 1000),
      source: "mock",
      receivedAt: Date.now()
    });
    const result = await db.ingestPurchase(event);
    await db.audit(adminId, "mock_purchase", { event, result });
    const state = await db.getBootstrap();
    broadcast("purchase.ingested", { event, result, state });
    return { event, result, state };
  });

  app.get("/api/admin/status", async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    return {
      ops: await db.getOpsFlags(),
      mockIngestor: mockIngestor.status(),
      solanaIngestor: solanaIngestor.status()
    };
  });

  app.post("/api/admin/pause", async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const parsed = z.object({ paused: z.boolean().optional(), ingestionPaused: z.boolean().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    if (parsed.data.paused !== undefined) await db.setOpsFlag("paused", parsed.data.paused);
    if (parsed.data.ingestionPaused !== undefined) {
      await db.setOpsFlag("ingestionPaused", parsed.data.ingestionPaused);
      mockIngestor.pause(parsed.data.ingestionPaused);
      solanaIngestor.pause(parsed.data.ingestionPaused);
    }
    await db.audit(adminId, "set_pause_flags", parsed.data);
    const ops = await db.getOpsFlags();
    broadcast("ops.updated", ops);
    return { ops };
  });

  app.get("/api/admin/raw-purchases", async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    return { purchases: await db.getRawPurchases() };
  });

  app.get("/api/admin/export-snapshot", async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    await db.audit(adminId, "export_snapshot", {});
    return db.exportSnapshot();
  });

  app.post("/api/admin/replay-purchases", async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const parsed = z.object({ fromSlot: z.number().int().optional(), txSignature: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    await db.audit(adminId, "replay_purchases_requested", parsed.data);
    return {
      accepted: true,
      detail: "Replay request recorded. Production provider replay is still gated behind SolanaPurchaseIngestor configuration.",
      request: parsed.data
    };
  });

  app.post("/api/admin/resync", async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    await db.audit(adminId, "force_resync_requested", {});
    const state = await db.getBootstrap();
    broadcast("world.resync", state);
    return { accepted: true, state };
  });

  app.post("/api/admin/hide-agent-name", async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const parsed = z.object({ agentId: z.string().min(1), hidden: z.boolean().default(true) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const updated = await db.hideAgent(parsed.data.agentId, parsed.data.hidden, adminId);
    if (!updated) return reply.status(404).send({ error: "Agent not found." });
    const state = await db.getBootstrap();
    broadcast("agent.moderated", state);
    return { updated, state };
  });

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: "hello", payload: { service: "agency-api" }, sentAt: Date.now() }));
    socket.on("close", () => sockets.delete(socket));
  });

  return { app, db, broadcast };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app } = await createAgencyApi();
  await app.listen({ host, port });
  app.log.info(`Agency API listening on http://${host}:${port}`);
}

export type AgencyApiInstance = Awaited<ReturnType<typeof createAgencyApi>>;
