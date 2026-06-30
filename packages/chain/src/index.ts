import type { ChainPurchaseEvent, MockPurchaseEvent, PurchaseEvent } from "../../shared/src/index.js";
import { purchaseEventSchema } from "../../shared/src/index.js";

export type PurchaseIngestorStatus = {
  id: string;
  running: boolean;
  paused: boolean;
  source: PurchaseEvent["source"];
  lastCursor?: string;
  detail: string;
};

export type PurchaseIngestor = {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(paused: boolean): void;
  status(): PurchaseIngestorStatus;
  drain(): Promise<PurchaseEvent[]>;
};

export class MockPurchaseIngestor implements PurchaseIngestor {
  readonly id = "mock-purchase-ingestor";
  private running = false;
  private paused = false;
  private readonly queue: MockPurchaseEvent[] = [];

  async start() {
    this.running = true;
  }

  async stop() {
    this.running = false;
  }

  pause(paused: boolean) {
    this.paused = paused;
  }

  enqueue(event: MockPurchaseEvent) {
    this.queue.push(purchaseEventSchema.parse({ ...event, source: "mock", receivedAt: event.receivedAt ?? Date.now() }) as MockPurchaseEvent);
  }

  async drain() {
    if (!this.running || this.paused) return [];
    return this.queue.splice(0);
  }

  status(): PurchaseIngestorStatus {
    return {
      id: this.id,
      running: this.running,
      paused: this.paused,
      source: "mock",
      detail: `${this.queue.length} queued mock purchase event(s)`
    };
  }
}

export class SolanaPurchaseIngestor implements PurchaseIngestor {
  readonly id = "solana-purchase-ingestor";
  private running = false;
  private paused = true;

  constructor(
    private readonly config: {
      tokenMint: string;
      heliusApiKey?: string;
      rpcUrl?: string;
      startSlot?: number;
    }
  ) {}

  async start() {
    this.running = true;
    this.paused = true;
  }

  async stop() {
    this.running = false;
  }

  pause(paused: boolean) {
    this.paused = paused;
  }

  async drain(): Promise<ChainPurchaseEvent[]> {
    return [];
  }

  status(): PurchaseIngestorStatus {
    return {
      id: this.id,
      running: this.running,
      paused: this.paused,
      source: "helius",
      lastCursor: this.config.startSlot === undefined ? undefined : `slot:${this.config.startSlot}`,
      detail: "Production Solana ingestion is intentionally stubbed until provider keys, mint, and replay policy are configured."
    };
  }
}
