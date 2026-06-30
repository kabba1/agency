import { deterministicUnit, hashText } from "../../shared/src/index.js";

export type BrainActionOption = {
  id: string;
  label: string;
  action: string;
  location: string;
  utility: number;
  reachable: boolean;
  reason: string;
  intent?: {
    kind: string;
    strategy: string;
    label: string;
  };
};

export type BrainObservation = {
  agent: Record<string, unknown>;
  time: Record<string, unknown>;
  location: Record<string, unknown>;
  needs: Record<string, unknown>;
  relationships: Record<string, unknown>[];
  memories: Record<string, unknown>[];
  availableActions: BrainActionOption[];
  cityPulse: Record<string, unknown>;
};

export type BrainDecision = {
  actionOptionId: string;
  intent: string;
  reason: string;
  confidence: number;
  privateThought?: string;
  publicLine?: string;
};

export type BrainDecisionTrace = {
  adapterId: string;
  observation: BrainObservation;
  consideredOptions: BrainActionOption[];
  decision: BrainDecision;
  resolverAccepted: boolean;
  resolverReason: string;
};

export type BrainAdapter = {
  id: string;
  decideNextAction(observation: BrainObservation): Promise<BrainDecision>;
};

export type BrainBudgetTier = "local_only" | "nano_background" | "mini_active" | "premium_story";

export type BrainBudgetEntry = {
  agentId: string;
  worldDay: number;
  tier: BrainBudgetTier;
  reason: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  createdAt: number;
};

const sortedReachableOptions = (observation: BrainObservation) =>
  observation.availableActions.filter((option) => option.reachable).sort((a, b) => b.utility - a.utility || a.id.localeCompare(b.id));

export class LocalRuleBrainAdapter implements BrainAdapter {
  readonly id = "local-rule";

  async decideNextAction(observation: BrainObservation): Promise<BrainDecision> {
    const selected = sortedReachableOptions(observation)[0] ?? observation.availableActions[0];
    if (!selected) {
      return {
        actionOptionId: "none",
        intent: "wait",
        reason: "No action options were available.",
        confidence: 0.1
      };
    }
    return {
      actionOptionId: selected.id,
      intent: selected.intent?.label ?? selected.action,
      reason: selected.reason,
      confidence: selected.reachable ? 0.82 : 0.38
    };
  }
}

export class MockLLMBrainAdapter implements BrainAdapter {
  readonly id = "mock-llm";

  async decideNextAction(observation: BrainObservation): Promise<BrainDecision> {
    const options = sortedReachableOptions(observation).slice(0, 5);
    const fallback = options[0] ?? observation.availableActions[0];
    if (!fallback) {
      return {
        actionOptionId: "none",
        intent: "wait",
        reason: "Mock cognition saw no useful options.",
        confidence: 0.1,
        privateThought: "There is nothing grounded to choose."
      };
    }

    const agentId = String(observation.agent.id ?? observation.agent.name ?? "agent");
    const seed = `${agentId}:${JSON.stringify(observation.time)}:${options.map((option) => option.id).join("|")}`;
    const index = Math.min(options.length - 1, Math.floor(deterministicUnit(seed, hashText(seed) % 17) * options.length));
    const selected = options[index] ?? fallback;
    return {
      actionOptionId: selected.id,
      intent: selected.intent?.label ?? selected.action,
      reason: `Mock LLM picked a grounded option: ${selected.reason}`,
      confidence: 0.66 + deterministicUnit(seed, 3) * 0.2,
      privateThought: `I should ${selected.label.toLowerCase()} because it fits what I can actually do.`,
      publicLine: selected.label
    };
  }
}

export class BrainBudgetSimulator {
  private readonly entries: BrainBudgetEntry[] = [];

  record(input: {
    agentId: string;
    worldDay: number;
    tier: BrainBudgetTier;
    reason: string;
    observation: BrainObservation;
    decision: BrainDecision;
  }) {
    const inputTokens = Math.ceil(JSON.stringify(input.observation).length / 4);
    const outputTokens = Math.ceil(JSON.stringify(input.decision).length / 4);
    const estimatedCostUsd = this.estimateCost(input.tier, inputTokens, outputTokens);
    const entry: BrainBudgetEntry = {
      agentId: input.agentId,
      worldDay: input.worldDay,
      tier: input.tier,
      reason: input.reason,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      createdAt: Date.now()
    };
    this.entries.push(entry);
    return entry;
  }

  summaryForDay(worldDay: number) {
    const entries = this.entries.filter((entry) => entry.worldDay === worldDay);
    return {
      worldDay,
      calls: entries.length,
      inputTokens: entries.reduce((sum, entry) => sum + entry.inputTokens, 0),
      outputTokens: entries.reduce((sum, entry) => sum + entry.outputTokens, 0),
      estimatedCostUsd: Number(entries.reduce((sum, entry) => sum + entry.estimatedCostUsd, 0).toFixed(6)),
      byTier: Object.fromEntries(
        ["local_only", "nano_background", "mini_active", "premium_story"].map((tier) => [tier, entries.filter((entry) => entry.tier === tier).length])
      ) as Record<BrainBudgetTier, number>
    };
  }

  allEntries() {
    return [...this.entries];
  }

  private estimateCost(tier: BrainBudgetTier, inputTokens: number, outputTokens: number) {
    if (tier === "local_only") return 0;
    const perMillion: Record<Exclude<BrainBudgetTier, "local_only">, { input: number; output: number }> = {
      nano_background: { input: 0.05, output: 0.2 },
      mini_active: { input: 0.15, output: 0.6 },
      premium_story: { input: 2.5, output: 10 }
    };
    const price = perMillion[tier];
    return Number(((inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output).toFixed(6));
  }
}
