import { z } from "zod";

export const SNAPSHOT_SCHEMA_VERSION = 1;

export const purchaseSourceSchema = z.enum(["mock", "helius", "rpc_backfill", "admin_replay"]);

export const purchaseEventSchema = z.object({
  chainId: z.string().min(1).default("solana-mainnet"),
  walletAddress: z.string().min(8),
  txSignature: z.string().min(4),
  instructionIndex: z.number().int().min(0).default(0),
  logIndex: z.number().int().min(0).default(0),
  tokenMint: z.string().min(4),
  tokenAmountDelta: z.number(),
  solDelta: z.number().optional().default(0),
  slot: z.number().int().nonnegative(),
  blockTime: z.number().int().nonnegative(),
  source: purchaseSourceSchema,
  receivedAt: z.number().int().nonnegative().optional()
});

export type PurchaseEventSource = z.infer<typeof purchaseSourceSchema>;
export type PurchaseEvent = z.infer<typeof purchaseEventSchema>;

export type PurchaseIngestionResult = {
  dedupeKey: string;
  accepted: boolean;
  qualifies: boolean;
  duplicate: boolean;
  agentCreated: boolean;
  agentId?: string;
  reason: string;
};

export type AgentDnaSeed = {
  walletAddress: string;
  tokenMint: string;
  txSignature: string;
  slot: number;
  seedMaterial: string;
};

export type AgentGenesisRecord = {
  id: string;
  walletAddress: string;
  walletLabel: string;
  tokenMint: string;
  firstPurchaseDedupeKey: string;
  dnaSeed: AgentDnaSeed;
  createdAt: number;
  publicName: string;
  hidden: boolean;
  publicProfile: Record<string, unknown>;
  privateProfile: Record<string, unknown>;
};

export type AgentStateSnapshot = {
  agentId: string;
  walletAddress: string;
  publicState: Record<string, unknown>;
  privateState: Record<string, unknown>;
  updatedAt: number;
};

export type SimEventVisibility = "public" | "owner" | "admin";

export type SimEvent = {
  id: string;
  kind: string;
  agentId?: string;
  walletAddress?: string;
  visibility: SimEventVisibility;
  text: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

export type ObjectStateSnapshot = {
  key: string;
  state: Record<string, unknown>;
  updatedAt: number;
};

export type RelationshipStateSnapshot = {
  key: string;
  agentId: string;
  otherAgentId: string;
  state: Record<string, unknown>;
  updatedAt: number;
};

export type MemoryStateSnapshot = {
  key: string;
  agentId: string;
  memories: Record<string, unknown>[];
  updatedAt: number;
};

export type CityPulseSnapshot = {
  id: string;
  worldTime: string;
  day: number;
  state: Record<string, unknown>;
  createdAt: number;
};

export type WalletSession = {
  token: string;
  walletAddress: string;
  createdAt: number;
  expiresAt: number;
};

export type MockPurchaseEvent = PurchaseEvent & {
  source: "mock";
};

export type ChainPurchaseEvent = PurchaseEvent & {
  source: "helius" | "rpc_backfill" | "admin_replay";
};

export type SimulationSnapshot = {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  exportedAt: number;
  world: {
    day: number;
    worldTime: string;
    paused: boolean;
    ingestionPaused: boolean;
  };
  purchases: PurchaseEvent[];
  agents: AgentGenesisRecord[];
  agentStates: AgentStateSnapshot[];
  events: SimEvent[];
  objectStates: ObjectStateSnapshot[];
  relationshipStates: RelationshipStateSnapshot[];
  memoryStates: MemoryStateSnapshot[];
  cityPulse: CityPulseSnapshot[];
};

export type PublicAgentView = {
  id: string;
  name: string;
  walletLabel: string;
  tokenMint: string;
  createdAt: number;
  hidden: boolean;
  publicProfile: Record<string, unknown>;
  ownerPrivate?: Record<string, unknown>;
};

export type BootstrapState = {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  generatedAt: number;
  currentWallet: string | null;
  world: SimulationSnapshot["world"];
  agents: PublicAgentView[];
  events: SimEvent[];
};

export const walletLabel = (walletAddress: string) =>
  walletAddress.length > 14 ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : walletAddress;

export const purchaseDedupeKey = (event: Pick<PurchaseEvent, "chainId" | "txSignature" | "instructionIndex" | "logIndex">) =>
  `${event.chainId}:${event.txSignature}:${event.instructionIndex}:${event.logIndex}`;

export const agentDnaSeedForPurchase = (event: Pick<PurchaseEvent, "walletAddress" | "tokenMint" | "txSignature" | "slot">): AgentDnaSeed => ({
  walletAddress: event.walletAddress,
  tokenMint: event.tokenMint,
  txSignature: event.txSignature,
  slot: event.slot,
  seedMaterial: `${event.walletAddress}:${event.tokenMint}:${event.txSignature}:${event.slot}`
});

export const hashText = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

export const deterministicUnit = (seed: string, salt: number) => {
  let value = hashText(seed) + Math.imul(salt + 1, 0x9e3779b1);
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
};

export const createPublicAgentView = (agent: AgentGenesisRecord, ownerWallet?: string | null): PublicAgentView => ({
  id: agent.id,
  name: agent.hidden ? "Hidden Agent" : agent.publicName,
  walletLabel: agent.walletLabel,
  tokenMint: agent.tokenMint,
  createdAt: agent.createdAt,
  hidden: agent.hidden,
  publicProfile: agent.hidden ? { status: "hidden" } : agent.publicProfile,
  ownerPrivate: ownerWallet && ownerWallet === agent.walletAddress ? agent.privateProfile : undefined
});
