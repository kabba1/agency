import type { ActionPoint } from "../shared/types";
import type { AgentTarget, SemanticObjectState, SimAgent } from "./AgentSimulation";
import { clamp, type ObjectUseDelta } from "./SimulationPrimitives";

export type ObjectServiceSnapshot = {
  stock?: number;
  capacity?: number;
  cleanliness: number;
  wear: number;
  heat: number;
  unmetDemand: number;
  servicePressure: number;
};

export type ObjectServiceResult = {
  state: SemanticObjectState;
  before: ObjectServiceSnapshot;
  after: ObjectServiceSnapshot;
};

export class ObjectStateSystem {
  private readonly states = new Map<string, SemanticObjectState>();
  private stateDay = 1;

  reset(currentDay = 1) {
    this.states.clear();
    this.stateDay = currentDay;
  }

  snapshot() {
    return [...this.states.values()].map((state) => ({ ...state }));
  }

  maintainDailyState(currentDay: number) {
    if (currentDay === this.stateDay) return;
    this.stateDay = currentDay;
    for (const state of this.states.values()) {
      state.usesToday = 0;
      state.heat = Math.round(clamp(state.heat - 28));
      state.wear = Math.round(clamp(state.wear - 3));
      state.cleanliness = Math.round(clamp(state.cleanliness + 16));
      state.unmetDemand = Math.round(clamp(state.unmetDemand - Math.max(1, Math.ceil(state.unmetDemand * 0.36))));
      state.servicePressure = Math.round(clamp(state.servicePressure - 22));
      if (state.servicePressure <= 0 && state.unmetDemand <= 0) state.lastIssue = undefined;
      if (state.capacity !== undefined && state.stock !== undefined) {
        state.stock = Math.round(clamp(state.stock + Math.ceil(state.capacity * 0.35), 0, state.capacity));
      }
    }
  }

  stateId(structureId: string, actionPointId: string) {
    return `${structureId}:${actionPointId}`;
  }

  peek(structureId: string, actionPointId: string) {
    return this.states.get(this.stateId(structureId, actionPointId));
  }

  stateForTarget(target: AgentTarget) {
    const id = this.stateId(target.structureId, target.actionPointId);
    const existing = this.states.get(id);
    if (existing) {
      existing.hoursLabel = target.hoursLabel;
      existing.openNow = target.openNow;
      return existing;
    }

    const capacity = this.capacityFor(target.actionPointType);
    const state: SemanticObjectState = {
      id,
      structureId: target.structureId,
      structureName: target.structureName,
      actionPointId: target.actionPointId,
      actionPointType: target.actionPointType,
      label: target.label,
      usesToday: 0,
      totalUses: 0,
      capacity,
      stock: capacity,
      cleanliness: 86,
      wear: 0,
      heat: 0,
      unmetDemand: 0,
      servicePressure: 0,
      occupants: 0,
      queued: 0,
      crowdPressure: 0,
      hoursLabel: target.hoursLabel,
      openNow: target.openNow
    };
    this.states.set(id, state);
    return state;
  }

  currentForAgent(agent: SimAgent) {
    return agent.target ? this.stateForTarget(agent.target) : null;
  }

  recordUse(agent: SimAgent, worldTime: string, delta: ObjectUseDelta = {}) {
    const state = this.currentForAgent(agent);
    if (!state) return null;
    this.touchState(state, agent, worldTime, delta);
    return state;
  }

  recordStructureService(
    agent: SimAgent,
    worldTime: string,
    actionPointTypes: readonly ActionPoint["type"][],
    delta: ObjectUseDelta = {},
    maxStates = 3
  ) {
    if (!agent.target) return [];
    const currentStateId = this.stateId(agent.target.structureId, agent.target.actionPointId);
    const serviced = [...this.states.values()]
      .filter((state) => state.structureId === agent.target?.structureId && state.id !== currentStateId && actionPointTypes.includes(state.actionPointType))
      .sort((a, b) => this.serviceNeed(b) - this.serviceNeed(a))
      .slice(0, maxStates);

    const results: ObjectServiceResult[] = [];
    for (const state of serviced) {
      const before = this.snapshotState(state);
      this.touchState(state, agent, worldTime, delta);
      results.push({ state, before, after: this.snapshotState(state) });
    }
    return results;
  }

  private snapshotState(state: SemanticObjectState): ObjectServiceSnapshot {
    return {
      stock: state.stock,
      capacity: state.capacity,
      cleanliness: state.cleanliness,
      wear: state.wear,
      heat: state.heat,
      unmetDemand: state.unmetDemand,
      servicePressure: state.servicePressure
    };
  }

  private touchState(state: SemanticObjectState, agent: SimAgent, worldTime: string, delta: ObjectUseDelta = {}) {
    state.usesToday += 1;
    state.totalUses += 1;
    state.lastUsedBy = agent.name;
    state.lastUsedWorldTime = worldTime;
    state.lastAction = agent.currentAction;
    state.heat = Math.round(clamp(state.heat + (delta.heatDelta ?? 4)));
    state.wear = Math.round(clamp(state.wear + (delta.wearDelta ?? 0.5)));
    state.cleanliness = Math.round(clamp(state.cleanliness + (delta.cleanlinessDelta ?? -1)));
    if (delta.unmetDemandDelta !== undefined) state.unmetDemand = Math.round(clamp(state.unmetDemand + delta.unmetDemandDelta, 0, 99));
    if (delta.servicePressureDelta !== undefined) state.servicePressure = Math.round(clamp(state.servicePressure + delta.servicePressureDelta));
    if (delta.issue) state.lastIssue = delta.issue;
    if (state.servicePressure <= 0 && state.unmetDemand <= 0 && delta.servicePressureDelta !== undefined && delta.servicePressureDelta < 0) state.lastIssue = undefined;
    if (state.stock !== undefined) {
      const capacity = state.capacity ?? state.stock;
      const stockGap = Math.max(0, capacity - state.stock);
      const ratioDelta =
        delta.restockRatio !== undefined && stockGap > 0 ? Math.max(delta.minStockDelta ?? 0, Math.ceil(stockGap * delta.restockRatio)) : undefined;
      const stockDelta = delta.stockDelta ?? ratioDelta;
      if (stockDelta !== undefined) state.stock = Math.round(clamp(state.stock + stockDelta, 0, capacity));
    }
  }

  private serviceNeed(state: SemanticObjectState) {
    const stockNeed = state.stock !== undefined && state.capacity !== undefined ? Math.max(0, state.capacity - state.stock) * 3 : 0;
    const cleanNeed = Math.max(0, 76 - state.cleanliness) * 0.2;
    const wearNeed = state.wear * 0.18;
    const heatNeed = state.heat * 0.1;
    const crowdNeed = state.crowdPressure * 0.08;
    const demandNeed = state.unmetDemand * 4.2;
    const pressureNeed = state.servicePressure * 0.55;
    return stockNeed + cleanNeed + wearNeed + heatNeed + crowdNeed + demandNeed + pressureNeed;
  }

  syncLiveOccupancy(agents: readonly SimAgent[]) {
    for (const state of this.states.values()) {
      state.occupants = 0;
      state.queued = 0;
      state.crowdPressure = 0;
    }

    for (const agent of agents) {
      if (!agent.target) continue;
      const state = this.stateForTarget(agent.target);
      if (agent.currentAction === "walking") {
        state.queued += 1;
      } else if (agent.currentAction !== "idle") {
        state.occupants += 1;
      }
    }

    for (const state of this.states.values()) {
      const liveLoad = Math.max(0, state.occupants + state.queued * 0.5 - 1);
      state.crowdPressure = Math.round(clamp(liveLoad * 28 + state.heat * 0.22));
    }
  }

  private capacityFor(type: ActionPoint["type"]) {
    const capacities: Partial<Record<ActionPoint["type"], number>> = {
      register: 18,
      shelf: 14,
      vending_machine: 10,
      fridge: 8,
      medicine_cabinet: 8,
      storage: 12,
      water_source: 30,
      crop_plot: 10
    };
    return capacities[type];
  }
}
