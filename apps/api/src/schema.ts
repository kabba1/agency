import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const purchaseEvents = sqliteTable("purchase_events", {
  dedupeKey: text("dedupe_key").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  txSignature: text("tx_signature").notNull(),
  tokenMint: text("token_mint").notNull(),
  tokenAmountDelta: integer("token_amount_delta").notNull(),
  solDelta: integer("sol_delta").notNull(),
  slot: integer("slot").notNull(),
  blockTime: integer("block_time").notNull(),
  source: text("source").notNull(),
  qualifies: integer("qualifies").notNull(),
  spawnedAgentId: text("spawned_agent_id"),
  rawJson: text("raw_json").notNull(),
  createdAt: integer("created_at").notNull()
});

export const agentGenesis = sqliteTable("agent_genesis", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  walletLabel: text("wallet_label").notNull(),
  tokenMint: text("token_mint").notNull(),
  firstPurchaseDedupeKey: text("first_purchase_dedupe_key").notNull(),
  dnaSeedJson: text("dna_seed_json").notNull(),
  publicName: text("public_name").notNull(),
  hidden: integer("hidden").notNull(),
  publicJson: text("public_json").notNull(),
  privateJson: text("private_json").notNull(),
  createdAt: integer("created_at").notNull()
});

export const simEvents = sqliteTable("sim_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  agentId: text("agent_id"),
  walletAddress: text("wallet_address"),
  visibility: text("visibility").notNull(),
  text: text("text").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: integer("created_at").notNull()
});

export const walletSessions = sqliteTable("wallet_sessions", {
  token: text("token").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull()
});
