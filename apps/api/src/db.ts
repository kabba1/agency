import { createClient, type Client } from "@libsql/client";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  SNAPSHOT_SCHEMA_VERSION,
  agentDnaSeedForPurchase,
  createPublicAgentView,
  deterministicUnit,
  hashText,
  purchaseDedupeKey,
  type AgentGenesisRecord,
  type BootstrapState,
  type PurchaseEvent,
  type PurchaseIngestionResult,
  type SimEvent,
  type SimulationSnapshot,
  walletLabel
} from "../../../packages/shared/src/index.js";
import { assertDeterministicRestore, exportSimulationSnapshot, type LaunchSimulationState } from "../../../packages/sim/src/index.js";

type Row = Record<string, unknown>;

const firstNames = ["Mara", "Jules", "Theo", "Nia", "Sol", "Iris", "Kai", "Vera", "Ezra", "Lena"];
const lastNames = ["Vale", "Cross", "Lane", "Park", "Nova", "Fox", "Stone", "Quill", "North", "Reed"];

const json = (value: unknown) => JSON.stringify(value);
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const valueString = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const valueNumber = (value: unknown) => Number(value ?? 0);

export type LaunchDb = {
  client: Client;
  close(): void;
  ingestPurchase(event: PurchaseEvent): Promise<PurchaseIngestionResult>;
  getBootstrap(ownerWallet?: string | null): Promise<BootstrapState>;
  getRawPurchases(): Promise<PurchaseEvent[]>;
  exportSnapshot(): Promise<SimulationSnapshot>;
  setOpsFlag(key: "paused" | "ingestionPaused", value: boolean): Promise<void>;
  getOpsFlags(): Promise<{ paused: boolean; ingestionPaused: boolean }>;
  createNonce(walletAddress: string): Promise<{ nonce: string; message: string; expiresAt: number }>;
  consumeNonce(walletAddress: string, nonce: string): Promise<boolean>;
  createSession(walletAddress: string): Promise<{ token: string; walletAddress: string; expiresAt: number }>;
  walletForSession(token: string | undefined): Promise<string | null>;
  hideAgent(agentId: string, hidden: boolean, adminId: string): Promise<boolean>;
  audit(adminId: string, action: string, payload: Record<string, unknown>): Promise<void>;
};

export const createLaunchDb = async (url = process.env.AGENCY_DB_URL ?? "file:data/agency-local.db"): Promise<LaunchDb> => {
  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    const directory = path.dirname(filePath);
    if (directory && directory !== ".") await mkdir(directory, { recursive: true });
  }

  const client = createClient({ url });
  await migrate(client);

  return {
    client,
    close: () => client.close(),
    ingestPurchase: (event) => ingestPurchase(client, event),
    getBootstrap: (ownerWallet) => getBootstrap(client, ownerWallet),
    getRawPurchases: () => getRawPurchases(client),
    exportSnapshot: () => exportDbSnapshot(client),
    setOpsFlag: (key, value) => setOpsFlag(client, key, value),
    getOpsFlags: () => getOpsFlags(client),
    createNonce: (walletAddress) => createNonce(client, walletAddress),
    consumeNonce: (walletAddress, nonce) => consumeNonce(client, walletAddress, nonce),
    createSession: (walletAddress) => createSession(client, walletAddress),
    walletForSession: (token) => walletForSession(client, token),
    hideAgent: (agentId, hidden, adminId) => hideAgent(client, agentId, hidden, adminId),
    audit: (adminId, action, payload) => audit(client, adminId, action, payload)
  };
};

const migrate = async (client: Client) => {
  const statements = [
    `create table if not exists purchase_events (
      dedupe_key text primary key,
      wallet_address text not null,
      tx_signature text not null,
      token_mint text not null,
      token_amount_delta real not null,
      sol_delta real not null,
      slot integer not null,
      block_time integer not null,
      source text not null,
      qualifies integer not null,
      spawned_agent_id text,
      raw_json text not null,
      created_at integer not null
    )`,
    `create table if not exists agent_genesis (
      id text primary key,
      wallet_address text not null,
      wallet_label text not null,
      token_mint text not null,
      first_purchase_dedupe_key text not null,
      dna_seed_json text not null,
      public_name text not null,
      hidden integer not null,
      public_json text not null,
      private_json text not null,
      created_at integer not null
    )`,
    `create unique index if not exists agent_genesis_wallet_unique on agent_genesis(wallet_address)`,
    `create table if not exists sim_events (
      id text primary key,
      kind text not null,
      agent_id text,
      wallet_address text,
      visibility text not null,
      text text not null,
      payload_json text not null,
      created_at integer not null
    )`,
    `create table if not exists wallet_nonces (
      nonce text primary key,
      wallet_address text not null,
      message text not null,
      expires_at integer not null,
      used integer not null
    )`,
    `create table if not exists wallet_sessions (
      token text primary key,
      wallet_address text not null,
      created_at integer not null,
      expires_at integer not null
    )`,
    `create table if not exists admin_audit (
      id text primary key,
      admin_id text not null,
      action text not null,
      payload_json text not null,
      created_at integer not null
    )`,
    `create table if not exists system_state (
      key text primary key,
      value_json text not null,
      updated_at integer not null
    )`,
    `create table if not exists object_states (
      key text primary key,
      state_json text not null,
      updated_at integer not null
    )`,
    `create table if not exists relationship_states (
      key text primary key,
      agent_id text not null,
      other_agent_id text not null,
      state_json text not null,
      updated_at integer not null
    )`,
    `create table if not exists memory_states (
      key text primary key,
      agent_id text not null,
      memories_json text not null,
      updated_at integer not null
    )`,
    `create table if not exists city_pulse_snapshots (
      id text primary key,
      day integer not null,
      world_time text not null,
      state_json text not null,
      created_at integer not null
    )`
  ];

  for (const statement of statements) await client.execute(statement);
};

const rows = async (client: Client, sql: string, args: unknown[] = []) => (await client.execute({ sql, args: args as never[] })).rows as Row[];

const one = async (client: Client, sql: string, args: unknown[] = []) => (await rows(client, sql, args))[0];

const now = () => Date.now();

const randomToken = () => crypto.randomUUID().replace(/-/g, "");

const createAgentFromPurchase = (event: PurchaseEvent, dedupeKey: string): AgentGenesisRecord => {
  const seed = agentDnaSeedForPurchase(event);
  const hash = hashText(seed.seedMaterial);
  const id = `agent-${hash.toString(36).padStart(8, "0").slice(0, 8)}`;
  const firstName = firstNames[hash % firstNames.length] ?? "Agent";
  const lastName = lastNames[Math.floor(deterministicUnit(seed.seedMaterial, 2) * lastNames.length)] ?? "Genesis";
  const publicName = `${firstName} ${lastName}`;
  const dna = {
    appearanceHue: Math.floor(deterministicUnit(seed.seedMaterial, 3) * 360),
    risk: Math.round(deterministicUnit(seed.seedMaterial, 4) * 100),
    sociability: Math.round(deterministicUnit(seed.seedMaterial, 5) * 100),
    discipline: Math.round(deterministicUnit(seed.seedMaterial, 6) * 100),
    greed: Math.round(deterministicUnit(seed.seedMaterial, 7) * 100),
    empathy: Math.round(deterministicUnit(seed.seedMaterial, 8) * 100)
  };
  return {
    id,
    walletAddress: event.walletAddress,
    walletLabel: walletLabel(event.walletAddress),
    tokenMint: event.tokenMint,
    firstPurchaseDedupeKey: dedupeKey,
    dnaSeed: seed,
    createdAt: now(),
    publicName,
    hidden: false,
    publicProfile: {
      dna,
      status: "Genesis resident",
      tokenMint: event.tokenMint,
      bornFrom: "qualifying_purchase",
      renderSeedInput: {
        chainId: event.chainId,
        walletAddress: walletLabel(event.walletAddress),
        tokenMint: event.tokenMint,
        txHash: `public-${hash.toString(36)}`,
        logIndex: event.logIndex,
        slot: event.slot,
        purchaseOrdinal: 1,
        seasonId: "genesis",
        publicGenesisSalt: "agency-public-render"
      }
    },
    privateProfile: {
      walletAddress: event.walletAddress,
      txSignature: event.txSignature,
      seedMaterial: seed.seedMaterial,
      purchase: event
    }
  };
};

const insertEvent = async (client: Client, event: Omit<SimEvent, "id" | "createdAt">) => {
  const createdAt = now();
  const id = `event-${createdAt}-${hashText(`${event.kind}:${event.agentId ?? ""}:${event.text}:${createdAt}`).toString(36)}`;
  await client.execute({
    sql: `insert into sim_events (id, kind, agent_id, wallet_address, visibility, text, payload_json, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, event.kind, event.agentId ?? null, event.walletAddress ?? null, event.visibility, event.text, json(event.payload), createdAt]
  });
  return { ...event, id, createdAt };
};

const ingestPurchase = async (client: Client, event: PurchaseEvent): Promise<PurchaseIngestionResult> => {
  const receivedEvent = { ...event, receivedAt: event.receivedAt ?? now() };
  const dedupeKey = purchaseDedupeKey(receivedEvent);
  const existing = await one(client, "select dedupe_key, spawned_agent_id from purchase_events where dedupe_key = ?", [dedupeKey]);
  if (existing) {
    return {
      dedupeKey,
      accepted: false,
      qualifies: false,
      duplicate: true,
      agentCreated: false,
      agentId: valueString(existing.spawned_agent_id) || undefined,
      reason: "Duplicate purchase event ignored."
    };
  }

  const existingAgent = await one(client, "select id from agent_genesis where wallet_address = ?", [receivedEvent.walletAddress]);
  const qualifies = receivedEvent.tokenAmountDelta > 0 && !existingAgent;
  const agent = qualifies ? createAgentFromPurchase(receivedEvent, dedupeKey) : null;

  await client.execute({
    sql: `insert into purchase_events
      (dedupe_key, wallet_address, tx_signature, token_mint, token_amount_delta, sol_delta, slot, block_time, source, qualifies, spawned_agent_id, raw_json, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      dedupeKey,
      receivedEvent.walletAddress,
      receivedEvent.txSignature,
      receivedEvent.tokenMint,
      receivedEvent.tokenAmountDelta,
      receivedEvent.solDelta ?? 0,
      receivedEvent.slot,
      receivedEvent.blockTime,
      receivedEvent.source,
      qualifies ? 1 : 0,
      agent?.id ?? null,
      json(receivedEvent),
      now()
    ]
  });

  if (agent) {
    await client.execute({
      sql: `insert into agent_genesis
        (id, wallet_address, wallet_label, token_mint, first_purchase_dedupe_key, dna_seed_json, public_name, hidden, public_json, private_json, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        agent.id,
        agent.walletAddress,
        agent.walletLabel,
        agent.tokenMint,
        agent.firstPurchaseDedupeKey,
        json(agent.dnaSeed),
        agent.publicName,
        agent.hidden ? 1 : 0,
        json(agent.publicProfile),
        json(agent.privateProfile),
        agent.createdAt
      ]
    });
    await insertEvent(client, {
      kind: "purchase_agent_created",
      agentId: agent.id,
      walletAddress: agent.walletAddress,
      visibility: "public",
      text: `${agent.publicName} entered Genesis District from a qualifying purchase.`,
      payload: { dedupeKey, tokenMint: agent.tokenMint }
    });
  } else {
    await insertEvent(client, {
      kind: "purchase_recorded",
      walletAddress: receivedEvent.walletAddress,
      visibility: "admin",
      text: existingAgent ? "Purchase recorded; wallet already has a Genesis agent." : "Purchase recorded but did not qualify.",
      payload: { dedupeKey, tokenMint: receivedEvent.tokenMint, tokenAmountDelta: receivedEvent.tokenAmountDelta }
    });
  }

  return {
    dedupeKey,
    accepted: true,
    qualifies,
    duplicate: false,
    agentCreated: Boolean(agent),
    agentId: agent?.id,
    reason: agent ? "Qualifying purchase created a wallet-linked Genesis agent." : existingAgent ? "Wallet already has a Genesis agent." : "Purchase did not meet qualifying rules."
  };
};

const agentFromRow = (row: Row): AgentGenesisRecord => ({
  id: valueString(row.id),
  walletAddress: valueString(row.wallet_address),
  walletLabel: valueString(row.wallet_label),
  tokenMint: valueString(row.token_mint),
  firstPurchaseDedupeKey: valueString(row.first_purchase_dedupe_key),
  dnaSeed: parseJson(row.dna_seed_json, {
    walletAddress: valueString(row.wallet_address),
    tokenMint: valueString(row.token_mint),
    txSignature: "",
    slot: 0,
    seedMaterial: ""
  }),
  createdAt: valueNumber(row.created_at),
  publicName: valueString(row.public_name),
  hidden: valueNumber(row.hidden) === 1,
  publicProfile: parseJson(row.public_json, {}),
  privateProfile: parseJson(row.private_json, {})
});

const eventFromRow = (row: Row): SimEvent => ({
  id: valueString(row.id),
  kind: valueString(row.kind),
  agentId: valueString(row.agent_id) || undefined,
  walletAddress: valueString(row.wallet_address) || undefined,
  visibility: valueString(row.visibility) as SimEvent["visibility"],
  text: valueString(row.text),
  payload: parseJson(row.payload_json, {}),
  createdAt: valueNumber(row.created_at)
});

const purchaseFromRow = (row: Row): PurchaseEvent =>
  parseJson(row.raw_json, {
    chainId: "unknown",
    walletAddress: valueString(row.wallet_address),
    txSignature: valueString(row.tx_signature),
    instructionIndex: 0,
    logIndex: 0,
    tokenMint: valueString(row.token_mint),
    tokenAmountDelta: valueNumber(row.token_amount_delta),
    solDelta: valueNumber(row.sol_delta),
    slot: valueNumber(row.slot),
    blockTime: valueNumber(row.block_time),
    source: valueString(row.source) as PurchaseEvent["source"]
  });

const getOpsFlags = async (client: Client) => {
  const flags = Object.fromEntries((await rows(client, "select key, value_json from system_state where key in ('paused', 'ingestionPaused')")).map((row) => [valueString(row.key), parseJson(row.value_json, false)]));
  return {
    paused: Boolean(flags.paused),
    ingestionPaused: Boolean(flags.ingestionPaused)
  };
};

const setOpsFlag = async (client: Client, key: "paused" | "ingestionPaused", value: boolean) => {
  await client.execute({
    sql: `insert into system_state (key, value_json, updated_at) values (?, ?, ?)
      on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at`,
    args: [key, json(value), now()]
  });
};

const getBootstrap = async (client: Client, ownerWallet?: string | null): Promise<BootstrapState> => {
  const agents = (await rows(client, "select * from agent_genesis order by created_at asc")).map(agentFromRow);
  const eventRows = await rows(client, "select * from sim_events order by created_at desc limit 80");
  const flags = await getOpsFlags(client);
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now(),
    currentWallet: ownerWallet ?? null,
    world: {
      day: 1,
      worldTime: "08:00",
      paused: flags.paused,
      ingestionPaused: flags.ingestionPaused
    },
    agents: agents.map((agent) => createPublicAgentView(agent, ownerWallet)),
    events: eventRows.map(eventFromRow).filter((event) => event.visibility === "public" || (ownerWallet && event.walletAddress === ownerWallet))
  };
};

const getRawPurchases = async (client: Client) => (await rows(client, "select * from purchase_events order by created_at desc")).map(purchaseFromRow);

const exportDbSnapshot = async (client: Client) => {
  const flags = await getOpsFlags(client);
  const state: LaunchSimulationState = {
    world: {
      day: 1,
      worldTime: "08:00",
      paused: flags.paused,
      ingestionPaused: flags.ingestionPaused
    },
    purchases: await getRawPurchases(client),
    agents: (await rows(client, "select * from agent_genesis order by created_at asc")).map(agentFromRow),
    agentStates: [],
    events: (await rows(client, "select * from sim_events order by created_at asc")).map(eventFromRow),
    objectStates: (await rows(client, "select * from object_states")).map((row) => ({
      key: valueString(row.key),
      state: parseJson(row.state_json, {}),
      updatedAt: valueNumber(row.updated_at)
    })),
    relationshipStates: (await rows(client, "select * from relationship_states")).map((row) => ({
      key: valueString(row.key),
      agentId: valueString(row.agent_id),
      otherAgentId: valueString(row.other_agent_id),
      state: parseJson(row.state_json, {}),
      updatedAt: valueNumber(row.updated_at)
    })),
    memoryStates: (await rows(client, "select * from memory_states")).map((row) => ({
      key: valueString(row.key),
      agentId: valueString(row.agent_id),
      memories: parseJson(row.memories_json, []),
      updatedAt: valueNumber(row.updated_at)
    })),
    cityPulse: (await rows(client, "select * from city_pulse_snapshots")).map((row) => ({
      id: valueString(row.id),
      day: valueNumber(row.day),
      worldTime: valueString(row.world_time),
      state: parseJson(row.state_json, {}),
      createdAt: valueNumber(row.created_at)
    }))
  };
  const snapshot = exportSimulationSnapshot(state);
  assertDeterministicRestore(snapshot);
  return snapshot;
};

const createNonce = async (client: Client, walletAddress: string) => {
  const nonce = randomToken();
  const expiresAt = now() + 5 * 60 * 1000;
  const message = `Agency login nonce: ${nonce}`;
  await client.execute({
    sql: "insert into wallet_nonces (nonce, wallet_address, message, expires_at, used) values (?, ?, ?, ?, 0)",
    args: [nonce, walletAddress, message, expiresAt]
  });
  return { nonce, message, expiresAt };
};

const consumeNonce = async (client: Client, walletAddress: string, nonce: string) => {
  const row = await one(client, "select * from wallet_nonces where wallet_address = ? and nonce = ? and used = 0", [walletAddress, nonce]);
  if (!row || valueNumber(row.expires_at) < now()) return false;
  await client.execute({ sql: "update wallet_nonces set used = 1 where nonce = ?", args: [nonce] });
  return true;
};

const createSession = async (client: Client, walletAddress: string) => {
  const token = randomToken();
  const createdAt = now();
  const expiresAt = createdAt + 7 * 24 * 60 * 60 * 1000;
  await client.execute({
    sql: "insert into wallet_sessions (token, wallet_address, created_at, expires_at) values (?, ?, ?, ?)",
    args: [token, walletAddress, createdAt, expiresAt]
  });
  return { token, walletAddress, expiresAt };
};

const walletForSession = async (client: Client, token: string | undefined) => {
  if (!token) return null;
  const row = await one(client, "select wallet_address, expires_at from wallet_sessions where token = ?", [token]);
  if (!row || valueNumber(row.expires_at) < now()) return null;
  return valueString(row.wallet_address);
};

const hideAgent = async (client: Client, agentId: string, hidden: boolean, adminId: string) => {
  const existing = await one(client, "select id from agent_genesis where id = ?", [agentId]);
  if (!existing) return false;
  await client.execute({ sql: "update agent_genesis set hidden = ? where id = ?", args: [hidden ? 1 : 0, agentId] });
  await audit(client, adminId, hidden ? "hide_agent_name" : "restore_agent_name", { agentId });
  return true;
};

const audit = async (client: Client, adminId: string, action: string, payload: Record<string, unknown>) => {
  await client.execute({
    sql: "insert into admin_audit (id, admin_id, action, payload_json, created_at) values (?, ?, ?, ?, ?)",
    args: [`audit-${now()}-${randomToken().slice(0, 8)}`, adminId, action, json(payload), now()]
  });
};
