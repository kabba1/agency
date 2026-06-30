import type { AgentMemoryKind, AgentRelationship, SimAgent } from "./AgentSimulation";
import { clamp, MEMORY_LIMIT } from "./SimulationPrimitives";

export type MemoryWriteContext = {
  worldMinutes: number;
  nextSequence: () => number;
};

export class MemorySystem {
  signal(agent: SimAgent, tag: string, worldMinutes: number) {
    let score = 0;
    for (const memory of agent.memories) {
      if (!memory.tags.includes(tag)) continue;
      const ageMinutes = Math.max(1, worldMinutes - memory.timestamp);
      score += memory.importance / Math.sqrt(ageMinutes);
    }
    return score;
  }

  add(agent: SimAgent, kind: AgentMemoryKind, text: string, importance: number, tags: string[], context: MemoryWriteContext) {
    const sequence = context.nextSequence();
    agent.memories.unshift({
      id: `${agent.id}-memory-${sequence.toString().padStart(6, "0")}`,
      kind,
      text,
      timestamp: Math.floor(context.worldMinutes),
      importance: clamp(importance, 1, 10),
      tags
    });
    agent.memories.sort((a, b) => b.importance - a.importance || b.timestamp - a.timestamp || b.id.localeCompare(a.id));
    agent.memories.splice(MEMORY_LIMIT);
  }

  reflect(agent: SimAgent, strongestRelationship: (predicate: (relationship: AgentRelationship) => boolean) => AgentRelationship | undefined, context: MemoryWriteContext) {
    const friend = strongestRelationship((relationship) => relationship.score > 14);
    const rival = strongestRelationship((relationship) => relationship.score < -12);
    const socialLine = rival
      ? `${rival.agentName} is becoming difficult to be around.`
      : friend
        ? `I keep feeling drawn toward ${friend.agentName}.`
        : "I do not know anyone well yet.";
    const pressure =
      agent.medical.isHospitalized
        ? "I am stuck in care until my health stabilizes."
        : agent.lifePriority && agent.lifePriority.id !== "balanced-day"
          ? `${agent.lifePriority.label}: ${agent.lifePriority.detail}.`
        : agent.medicalDebt > 0
          ? "The medical bill is hanging over me."
          : agent.rentDue > 0
        ? "Rent is hanging over me."
        : agent.hunger > 70
          ? "Food is becoming important."
          : agent.energy < 35
            ? "I need to preserve energy."
            : agent.stress > 65
              ? "I need a calmer place soon."
              : agent.money < 12
                ? "I need credits soon."
                : "My immediate needs are stable.";
    agent.reflection = `${pressure} ${socialLine}`;
    agent.reflection += ` I tend to ${agent.lifeProfile.habit} because I worry about ${agent.lifeProfile.worry}.`;
    this.add(agent, "reflection", agent.reflection, 6, ["reflection"], context);
  }
}
