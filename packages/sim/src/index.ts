import type { SimulationSnapshot } from "../../shared/src/index.js";
import { SNAPSHOT_SCHEMA_VERSION } from "../../shared/src/index.js";

export type LaunchSimulationState = Omit<SimulationSnapshot, "schemaVersion" | "exportedAt">;

export const createEmptyLaunchSimulationState = (): LaunchSimulationState => ({
  world: {
    day: 1,
    worldTime: "08:00",
    paused: false,
    ingestionPaused: false
  },
  purchases: [],
  agents: [],
  agentStates: [],
  events: [],
  objectStates: [],
  relationshipStates: [],
  memoryStates: [],
  cityPulse: []
});

export const exportSimulationSnapshot = (state: LaunchSimulationState): SimulationSnapshot => ({
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  exportedAt: Date.now(),
  world: { ...state.world },
  purchases: state.purchases.map((purchase) => ({ ...purchase })),
  agents: state.agents.map((agent) => ({
    ...agent,
    dnaSeed: { ...agent.dnaSeed },
    publicProfile: { ...agent.publicProfile },
    privateProfile: { ...agent.privateProfile }
  })),
  agentStates: state.agentStates.map((snapshot) => ({ ...snapshot, publicState: { ...snapshot.publicState }, privateState: { ...snapshot.privateState } })),
  events: state.events.map((event) => ({ ...event, payload: { ...event.payload } })),
  objectStates: state.objectStates.map((snapshot) => ({ ...snapshot, state: { ...snapshot.state } })),
  relationshipStates: state.relationshipStates.map((snapshot) => ({ ...snapshot, state: { ...snapshot.state } })),
  memoryStates: state.memoryStates.map((snapshot) => ({ ...snapshot, memories: snapshot.memories.map((memory) => ({ ...memory })) })),
  cityPulse: state.cityPulse.map((snapshot) => ({ ...snapshot, state: { ...snapshot.state } }))
});

export const importSimulationSnapshot = (snapshot: SimulationSnapshot): LaunchSimulationState => {
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Unsupported Agency snapshot schema ${snapshot.schemaVersion}. Expected ${SNAPSHOT_SCHEMA_VERSION}.`);
  }
  return {
    world: { ...snapshot.world },
    purchases: snapshot.purchases.map((purchase) => ({ ...purchase })),
    agents: snapshot.agents.map((agent) => ({
      ...agent,
      dnaSeed: { ...agent.dnaSeed },
      publicProfile: { ...agent.publicProfile },
      privateProfile: { ...agent.privateProfile }
    })),
    agentStates: snapshot.agentStates.map((state) => ({ ...state, publicState: { ...state.publicState }, privateState: { ...state.privateState } })),
    events: snapshot.events.map((event) => ({ ...event, payload: { ...event.payload } })),
    objectStates: snapshot.objectStates.map((state) => ({ ...state, state: { ...state.state } })),
    relationshipStates: snapshot.relationshipStates.map((state) => ({ ...state, state: { ...state.state } })),
    memoryStates: snapshot.memoryStates.map((state) => ({ ...state, memories: state.memories.map((memory) => ({ ...memory })) })),
    cityPulse: snapshot.cityPulse.map((state) => ({ ...state, state: { ...state.state } }))
  };
};

export const assertDeterministicRestore = (snapshot: SimulationSnapshot) => {
  const restored = importSimulationSnapshot(snapshot);
  const exported = exportSimulationSnapshot(restored);
  const normalize = (value: SimulationSnapshot) => JSON.stringify({ ...value, exportedAt: 0 });
  if (normalize(snapshot) !== normalize(exported)) {
    throw new Error("Agency snapshot restore changed persisted simulation state.");
  }
  return true;
};
