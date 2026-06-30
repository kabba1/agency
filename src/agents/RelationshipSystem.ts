import type {
  AgentEventKind,
  AgentEventTone,
  AgentEveningPlan,
  AgentEveningPlanOutcome,
  AgentMemoryKind,
  AgentMoodletInput,
  AgentRelationship,
  AgentReputation,
  AgentSocialMomentInput,
  AgentSocialFocus,
  DayPhase,
  SimAgent
} from "./AgentSimulation";
import { clamp, distance2d, hashText, randomFromHash, type ObjectUseDelta } from "./SimulationPrimitives";

const INITIAL_INTERACTION_TIME = -9999;
const CASUAL_OBSERVATION_COOLDOWN_MINUTES = 55;
const SOCIAL_OBSERVATION_COOLDOWN_MINUTES = 25;
const HOUSEMATE_OBSERVATION_COOLDOWN_MINUTES = 220;

export type SocialGestureKind = "chat" | "check_in" | "joke" | "advice" | "apology" | "favor" | "share_food" | "spot_credit" | "repay_credit";

export type SocialGesture = {
  kind: SocialGestureKind;
  label: string;
  agentDelta: number;
  otherDelta: number;
  agentMood: number;
  otherMood: number;
  agentStress: number;
  otherStress: number;
  agentSocial: number;
  otherSocial: number;
  agentSupport: number;
  otherSupport: number;
  publicLine: string;
  agentMemory: string;
  otherMemory: string;
  importance: number;
  tone: AgentEventTone;
  tags: string[];
  transferCredits?: number;
  transferItem?: "meal" | "groceries";
  otherHungerRelief?: number;
};

export type SocialPerceptionCue = {
  id: string;
  label: string;
  detail: string;
  observerMemory: string;
  subjectMemory: string;
  publicLine: string;
  tone: AgentEventTone;
  importance: number;
  observerDelta: number;
  subjectDelta: number;
  observerMood: number;
  subjectMood: number;
  observerStress: number;
  subjectStress: number;
  tensionDelta: number;
  trustDelta: number;
  tags: string[];
};

export type RelationshipRuntimeContext = {
  worldTime: string;
  worldMinutes: number;
  currentDay: number;
  currentPhase: DayPhase;
  addMemory: (agent: SimAgent, kind: AgentMemoryKind, text: string, importance: number, tags: string[]) => void;
  log: (agent: SimAgent, text: string, kind?: AgentEventKind, tone?: AgentEventTone, importance?: number) => void;
  recordObjectUse: (agent: SimAgent, delta?: ObjectUseDelta) => void;
  addMoodlet: (agent: SimAgent, moodlet: AgentMoodletInput) => void;
  recordSocialMoment: (agent: SimAgent, moment: AgentSocialMomentInput) => void;
};

export class RelationshipSystem {
  adjustReputation(agent: SimAgent, deltas: Partial<AgentReputation>) {
    for (const [key, delta] of Object.entries(deltas) as Array<[keyof AgentReputation, number]>) {
      agent.reputation[key] = Math.round(clamp(agent.reputation[key] + delta));
    }
  }

  publicReputationBias(other: SimAgent) {
    return (
      (other.reputation.warmth - 50) * 0.08 +
      (other.reputation.reliability - 50) * 0.045 +
      (other.reputation.ambition - 50) * 0.025 -
      Math.max(0, other.reputation.trouble - 30) * 0.12
    );
  }

  relationshipFor(agent: SimAgent, other: SimAgent, worldTime: string) {
    const existing = agent.relationshipDetails[other.id];
    if (existing) {
      existing.agentName = other.name;
      existing.score = agent.relationships[other.id] ?? existing.score;
      existing.trust ??= this.trustFor(existing.score, existing.encounters);
      existing.tension ??= this.tensionFor(existing.score);
      existing.familiarity ??= Math.min(100, existing.encounters * 8);
      existing.supportBalance ??= 0;
      existing.lastGesture ??= "noticed";
      existing.attitude = this.attitudeFor(existing.score, existing.encounters);
      return existing;
    }

    const score = agent.relationships[other.id] ?? this.initialRelationshipScore(agent, other);
    const relationship: AgentRelationship = {
      agentId: other.id,
      agentName: other.name,
      score,
      attitude: this.attitudeFor(score, 0),
      trust: this.trustFor(score, 0),
      tension: this.tensionFor(score),
      familiarity: Math.max(0, Math.min(18, Math.abs(score) * 0.55)),
      supportBalance: 0,
      lastGesture: score < -10 ? "uneasy read" : score > 10 ? "warm read" : "noticed",
      encounters: 0,
      lastSeenWorldTime: worldTime,
      lastObservationWorldMinutes: INITIAL_INTERACTION_TIME,
      lastConflictWorldMinutes: INITIAL_INTERACTION_TIME,
      lastEvent: score < -10 ? "Bad first impression." : score > 10 ? "Good first impression." : "First noticed in town.",
      history: score === 0 ? [] : [`${worldTime} ${score < 0 ? "Uneasy" : "Warm"} first impression.`]
    };
    agent.relationshipDetails[other.id] = relationship;
    agent.relationships[other.id] = score;
    return relationship;
  }

  adjustRelationship(agent: SimAgent, other: SimAgent, delta: number, eventText: string, worldTime: string) {
    const relationship = this.relationshipFor(agent, other, worldTime);
    relationship.score = clamp(relationship.score + delta, -100, 100);
    relationship.encounters += 1;
    relationship.lastSeenWorldTime = worldTime;
    relationship.lastEvent = eventText;
    relationship.familiarity = Math.round(clamp((relationship.familiarity ?? 0) + 2 + Math.abs(delta) * 0.45));
    relationship.trust = Math.round(clamp((relationship.trust ?? this.trustFor(relationship.score, relationship.encounters)) + (delta > 0 ? delta * 0.48 : delta * 0.22)));
    relationship.tension = Math.round(clamp((relationship.tension ?? this.tensionFor(relationship.score)) + (delta < 0 ? Math.abs(delta) * 0.82 : -delta * 0.42)));
    relationship.attitude = this.attitudeFor(relationship.score, relationship.encounters);
    relationship.history.unshift(`${worldTime} ${eventText}`);
    relationship.history.splice(4);
    agent.relationships[other.id] = relationship.score;
    return relationship;
  }

  chooseSocialGesture(agent: SimAgent, other: SimAgent, relationship: AgentRelationship): SocialGesture {
    const needsHelp = other.stress > 62 || other.energy < 28 || other.money < 6 || other.hunger > 72;
    const carriedFood = agent.inventory.find((item) => item === "meal" || item === "groceries") as "meal" | "groceries" | undefined;
    const canShareFood = Boolean(
      carriedFood && other.hunger > 72 && agent.hunger < 78 && agent.dna.empathy > 52 && relationship.score > -8 && relationship.tension < 66
    );
    const canSpotCredit = other.money < 5 && agent.money >= 12 && agent.dna.empathy > 58 && relationship.score > 3 && relationship.tension < 62;
    const canApologize = relationship.tension > 34 && agent.dna.empathy + agent.dna.discipline > 104 && agent.stress < 78;
    const canFavor = needsHelp && agent.dna.empathy > 48 && relationship.score > -12;
    const canJoke = agent.dna.sociability > 62 && agent.mood > 36 && relationship.tension < 58;
    const canAdvise = agent.career.performance > 66 && other.stress > 38 && relationship.familiarity > 8;
    const supportOwed = Math.max(0, relationship.supportBalance ?? 0);
    const repaymentCash = Math.max(0, Math.floor(agent.money - Math.max(5, agent.budget.dailySpendLimit * 0.35)));
    const canRepayCredit = supportOwed >= 1 && repaymentCash >= 1 && relationship.tension < 76;

    if (canRepayCredit) {
      const amount = Math.min(Math.ceil(supportOwed), repaymentCash, 6);
      return {
        kind: "repay_credit",
        label: "Repaid help",
        agentDelta: 5.2 + agent.dna.discipline / 80 + Math.max(0, relationship.trust - 40) / 45,
        otherDelta: 4.8 + other.dna.empathy / 110,
        agentMood: 4,
        otherMood: 5,
        agentStress: -5,
        otherStress: -3,
        agentSocial: 16,
        otherSocial: 12,
        agentSupport: -amount,
        otherSupport: amount,
        transferCredits: amount,
        publicLine: `${agent.name} paid ${other.name} back ${amount} credits instead of letting the favor hang there.`,
        agentMemory: `Paid ${other.name} back ${amount} credits. It felt better to not leave the help unanswered.`,
        otherMemory: `${agent.name} paid me back ${amount} credits.`,
        importance: supportOwed >= 4 ? 8 : 7,
        tone: "good",
        tags: ["social", "support", "money", "repayment"]
      };
    }

    if (canShareFood && carriedFood) {
      const relief = carriedFood === "groceries" ? 34 : 26;
      return {
        kind: "share_food",
        label: "Shared food",
        agentDelta: 5.8 + agent.dna.empathy / 64,
        otherDelta: 7.6 + other.dna.empathy / 90,
        agentMood: 3,
        otherMood: 9,
        agentStress: -1,
        otherStress: -10,
        agentSocial: 15,
        otherSocial: 20,
        agentSupport: -2,
        otherSupport: 3,
        transferItem: carriedFood,
        otherHungerRelief: relief,
        publicLine: `${agent.name} shared ${carriedFood === "groceries" ? "groceries" : "a meal"} with ${other.name} when hunger was getting loud.`,
        agentMemory: `Shared ${carriedFood === "groceries" ? "groceries" : "a meal"} with ${other.name} instead of letting them stay hungry.`,
        otherMemory: `${agent.name} shared food when I was hungry.`,
        importance: 8,
        tone: "good",
        tags: ["social", "support", "food"]
      };
    }

    if (canSpotCredit) {
      const amount = Math.min(3, Math.max(1, Math.floor(agent.money - 9)));
      return {
        kind: "spot_credit",
        label: "Spotted credits",
        agentDelta: 5.4 + agent.dna.empathy / 60,
        otherDelta: 7.2 + other.dna.empathy / 90,
        agentMood: 2,
        otherMood: 8,
        agentStress: 1,
        otherStress: -9,
        agentSocial: 14,
        otherSocial: 18,
        agentSupport: -amount,
        otherSupport: amount,
        transferCredits: amount,
        publicLine: `${agent.name} spotted ${other.name} ${amount} credits when money looked tight.`,
        agentMemory: `Spotted ${other.name} ${amount} credits. It made the friendship feel practical, not just polite.`,
        otherMemory: `${agent.name} spotted me ${amount} credits when I was low.`,
        importance: 8,
        tone: "good",
        tags: ["social", "support", "money"]
      };
    }

    if (canApologize) {
      return {
        kind: "apology",
        label: "Apologized",
        agentDelta: 4.8 + agent.dna.empathy / 80,
        otherDelta: 3.8 + other.dna.empathy / 120,
        agentMood: 3,
        otherMood: 4,
        agentStress: -8,
        otherStress: -6,
        agentSocial: 12,
        otherSocial: 8,
        agentSupport: 1,
        otherSupport: 1,
        publicLine: `${agent.name} tried to clear the air with ${other.name}.`,
        agentMemory: `Apologized to ${other.name} instead of letting tension sit there.`,
        otherMemory: `${agent.name} tried to clear the air.`,
        importance: 7,
        tone: "good",
        tags: ["social", "apology", "repair"]
      };
    }

    if (canFavor) {
      return {
        kind: "favor",
        label: "Checked in",
        agentDelta: 4.6 + agent.dna.empathy / 70,
        otherDelta: 5.4 + other.dna.empathy / 100,
        agentMood: 4,
        otherMood: 7,
        agentStress: -3,
        otherStress: -8,
        agentSocial: 18,
        otherSocial: 20,
        agentSupport: -1,
        otherSupport: 2,
        publicLine: `${agent.name} checked in on ${other.name} and helped the day feel less heavy.`,
        agentMemory: `Checked in on ${other.name} when they seemed strained.`,
        otherMemory: `${agent.name} checked in when the day felt heavy.`,
        importance: 7,
        tone: "good",
        tags: ["social", "support", "care"]
      };
    }

    if (canAdvise) {
      return {
        kind: "advice",
        label: "Gave advice",
        agentDelta: 4.2,
        otherDelta: 4.6 + other.dna.discipline / 120,
        agentMood: 3,
        otherMood: 4,
        agentStress: -2,
        otherStress: -5,
        agentSocial: 16,
        otherSocial: 14,
        agentSupport: -0.5,
        otherSupport: 1,
        publicLine: `${agent.name} gave ${other.name} some practical advice.`,
        agentMemory: `Gave ${other.name} practical advice from work experience.`,
        otherMemory: `${agent.name} gave me practical advice.`,
        importance: 6,
        tone: "good",
        tags: ["social", "advice", "work"]
      };
    }

    if (canJoke) {
      return {
        kind: "joke",
        label: "Shared a joke",
        agentDelta: 3.8 + agent.dna.sociability / 90,
        otherDelta: 3.2 + other.dna.sociability / 120,
        agentMood: 7,
        otherMood: 5,
        agentStress: -5,
        otherStress: -4,
        agentSocial: 20,
        otherSocial: 12,
        agentSupport: 0,
        otherSupport: 0,
        publicLine: `${agent.name} got ${other.name} laughing for a minute.`,
        agentMemory: `Shared a joke with ${other.name}.`,
        otherMemory: `${agent.name} made me laugh for a minute.`,
        importance: 6,
        tone: "good",
        tags: ["social", "joke", "mood"]
      };
    }

    return {
      kind: "chat",
      label: "Talked",
      agentDelta: 4 + agent.dna.empathy / 35 + Math.max(0, relationship.score) / 35,
      otherDelta: 3 + other.dna.empathy / 50,
      agentMood: 8,
      otherMood: 4,
      agentStress: -7,
      otherStress: -3,
      agentSocial: 22,
      otherSocial: 9,
      agentSupport: 0,
      otherSupport: 0,
      publicLine: `${agent.name} and ${other.name} had a friendly exchange.`,
      agentMemory: `Had a good exchange with ${other.name}.`,
      otherMemory: `${agent.name} made time to talk.`,
      importance: 7,
      tone: "good",
      tags: ["social", "conversation", "relationship"]
    };
  }

  readSocialCue(observer: SimAgent, subject: SimAgent, relationship: AgentRelationship): SocialPerceptionCue | null {
    const cues: Array<SocialPerceptionCue & { salience: number }> = [];
    const empathy = observer.dna.empathy + observer.values.care * 0.35;
    const patientRead = empathy >= 72 || relationship.score > 10 || relationship.trust > 56;
    const awkwardRead = !patientRead && (observer.stress > 62 || relationship.tension > 44 || observer.dna.risk > observer.dna.empathy + 16);
    const push = (cue: SocialPerceptionCue, salience: number) => cues.push({ ...cue, salience });

    if (subject.medical.minorIllness.active || subject.health < 52) {
      const illnessLabel = subject.medical.minorIllness.active ? (subject.medical.minorIllness.label ?? "illness") : "poor health";
      push(
        {
          id: "unwell",
          label: "Looked Unwell",
          detail: `${subject.name} looked like ${illnessLabel} was wearing them down`,
          observerMemory: `Noticed ${subject.name} looked unwell and adjusted the conversation.`,
          subjectMemory: `${observer.name} seemed to notice I was not feeling right.`,
          publicLine: `${observer.name} noticed ${subject.name} looked unwell.`,
          tone: patientRead ? "warn" : "neutral",
          importance: subject.health < 42 ? 8 : 6,
          observerDelta: patientRead ? 1.8 : 0.3,
          subjectDelta: patientRead ? 2.2 : -0.4,
          observerMood: patientRead ? 0 : -1,
          subjectMood: patientRead ? 2 : -1,
          observerStress: patientRead ? 1 : 0,
          subjectStress: patientRead ? -3 : 1,
          tensionDelta: patientRead ? -1 : 1,
          trustDelta: patientRead ? 2 : 0,
          tags: ["social-read", "health", "care"]
        },
        28 + Math.max(0, 58 - subject.health) * 0.9 + (subject.medical.minorIllness.active ? 12 : 0)
      );
    }

    if (subject.hunger > 76) {
      push(
        {
          id: "hungry",
          label: "Looked Hungry",
          detail: `${subject.name} looked distracted by hunger`,
          observerMemory: `Noticed ${subject.name} seemed hungry during the exchange.`,
          subjectMemory: `${observer.name} could tell hunger was making me distracted.`,
          publicLine: `${observer.name} noticed ${subject.name} looked hungry.`,
          tone: patientRead ? "warn" : "neutral",
          importance: subject.hunger > 88 ? 7 : 5,
          observerDelta: patientRead ? 1.3 : 0,
          subjectDelta: patientRead ? 1.6 : -0.2,
          observerMood: patientRead ? 1 : 0,
          subjectMood: patientRead ? 1 : -1,
          observerStress: 0,
          subjectStress: patientRead ? -2 : 1,
          tensionDelta: patientRead ? -1 : 0,
          trustDelta: patientRead ? 1 : 0,
          tags: ["social-read", "food", "need"]
        },
        16 + Math.max(0, subject.hunger - 72) * 0.72
      );
    }

    const outfitLooksRough = subject.outfit.cleanliness < 38 || subject.outfit.wear > 74;
    if (subject.hygiene < 34 || outfitLooksRough) {
      const supportive = patientRead && empathy >= 78;
      const outfitDetail =
        subject.hygiene >= 34
          ? subject.outfit.cleanliness < 38
            ? "their clothes looked overdue for laundry"
            : "their clothes looked worn down"
          : "the day had been hard to keep clean";
      push(
        {
          id: "messy",
          label: supportive ? "Noticed Rough Morning" : "Awkward Read",
          detail: `${subject.name} looked like ${outfitDetail}`,
          observerMemory: supportive
            ? `Noticed ${subject.name} looked rough and tried not to make it weird.`
            : `Noticed ${subject.name} looked rough around the edges, and the exchange felt a little awkward.`,
          subjectMemory: supportive
            ? `${observer.name} noticed I was having a rough day without making it worse.`
            : `${observer.name} seemed to notice I was not fully put together.`,
          publicLine: supportive
            ? `${observer.name} noticed ${subject.name} looked like they had a rough morning.`
            : `${observer.name} caught the rough edges in ${subject.name}'s day.`,
          tone: supportive ? "neutral" : "warn",
          importance: subject.hygiene < 22 || subject.outfit.cleanliness < 24 || subject.outfit.wear > 84 ? 7 : 5,
          observerDelta: supportive ? 0.8 : -1.4,
          subjectDelta: supportive ? 1.2 : -1.8,
          observerMood: supportive ? 0 : -1,
          subjectMood: supportive ? 1 : -2,
          observerStress: supportive ? 0 : 1,
          subjectStress: supportive ? -1 : 3,
          tensionDelta: supportive ? 0 : 3,
          trustDelta: supportive ? 1 : -1,
          tags: ["social-read", "hygiene", "outfit", supportive ? "care" : "awkward"]
        },
        14 + Math.max(0, 42 - subject.hygiene) * 0.65 + Math.max(0, 44 - subject.outfit.cleanliness) * 0.38 + Math.max(0, subject.outfit.wear - 66) * 0.3 + (awkwardRead ? 9 : 0)
      );
    }

    if (subject.stress > 74 || subject.mood < 28) {
      const volatile = awkwardRead || (subject.stress > 84 && observer.stress > 58);
      push(
        {
          id: "on-edge",
          label: volatile ? "Felt On Edge" : "Noticed Stress",
          detail: `${subject.name} seemed tense before the words even landed`,
          observerMemory: volatile
            ? `${subject.name} seemed tense, and I kept bracing for the exchange to turn.`
            : `Noticed ${subject.name} seemed tense and tried to keep the exchange gentle.`,
          subjectMemory: volatile
            ? `${observer.name} seemed guarded around me while I was tense.`
            : `${observer.name} noticed I was tense and slowed the conversation down.`,
          publicLine: `${observer.name} picked up on ${subject.name}'s stress.`,
          tone: volatile ? "warn" : "neutral",
          importance: subject.stress > 86 ? 8 : 6,
          observerDelta: volatile ? -1.6 : 1,
          subjectDelta: volatile ? -1.2 : 1.4,
          observerMood: volatile ? -1 : 0,
          subjectMood: volatile ? -1 : 1,
          observerStress: volatile ? 3 : 0,
          subjectStress: volatile ? 1 : -3,
          tensionDelta: volatile ? 5 : -1,
          trustDelta: volatile ? -1 : 1,
          tags: ["social-read", "stress", volatile ? "tension" : "care"]
        },
        18 + Math.max(0, subject.stress - 68) * 0.82 + Math.max(0, 34 - subject.mood) * 0.5
      );
    }

    if (subject.hygiene > 74 && subject.outfit.cleanliness > 72 && subject.outfit.wear < 62 && subject.mood > 58 && subject.stress < 46 && !subject.medical.minorIllness.active) {
      push(
        {
          id: "put-together",
          label: "Put Together",
          detail: `${subject.name} seemed steady, clean, and easy to be around`,
          observerMemory: `${subject.name} seemed put together today, clean fit and all, which made the exchange easy.`,
          subjectMemory: `${observer.name} seemed comfortable around me today.`,
          publicLine: `${subject.name} carried themself like the day was under control.`,
          tone: "good",
          importance: 4,
          observerDelta: 1.2,
          subjectDelta: 0.9,
          observerMood: 1,
          subjectMood: 1,
          observerStress: -1,
          subjectStress: -1,
          tensionDelta: -1,
          trustDelta: 1,
          tags: ["social-read", "composure", "hygiene", "outfit"]
        },
        11 + Math.max(0, subject.hygiene - 72) * 0.2 + Math.max(0, subject.outfit.cleanliness - 70) * 0.16 + Math.max(0, subject.mood - 56) * 0.18
      );
    }

    const best = cues.sort((a, b) => b.salience - a.salience)[0];
    if (!best || best.salience < 18) return null;
    const { salience: _salience, ...cue } = best;
    return cue;
  }

  recordGesture(agentRel: AgentRelationship, otherRel: AgentRelationship, gesture: SocialGesture) {
    agentRel.lastGesture = gesture.label;
    otherRel.lastGesture = gesture.label;
    agentRel.supportBalance = Math.round(clamp((agentRel.supportBalance ?? 0) + gesture.agentSupport, -50, 50) * 10) / 10;
    otherRel.supportBalance = Math.round(clamp((otherRel.supportBalance ?? 0) + gesture.otherSupport, -50, 50) * 10) / 10;
    if (gesture.kind === "apology") {
      agentRel.tension = Math.round(clamp(agentRel.tension - 12));
      otherRel.tension = Math.round(clamp(otherRel.tension - 9));
    }
    if (gesture.kind === "favor" || gesture.kind === "share_food" || gesture.kind === "spot_credit" || gesture.kind === "repay_credit") {
      agentRel.trust = Math.round(clamp(agentRel.trust + 2));
      otherRel.trust = Math.round(clamp(otherRel.trust + 5));
    }
    if (gesture.kind === "repay_credit") {
      agentRel.tension = Math.round(clamp(agentRel.tension - 4));
      otherRel.tension = Math.round(clamp(otherRel.tension - 5));
    }
  }

  strongestRelationship(agent: SimAgent, predicate: (relationship: AgentRelationship) => boolean) {
    return Object.values(agent.relationshipDetails)
      .filter(predicate)
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || b.encounters - a.encounters)[0];
  }

  activeEveningPlan(agent: SimAgent, currentPhase: DayPhase, currentDay: number) {
    return currentPhase === "evening" && agent.eveningPlan.day === currentDay && agent.eveningPlan.intent !== "none" && !agent.eveningPlan.resolved
      ? agent.eveningPlan
      : null;
  }

  chooseSocialFocus(agent: SimAgent, currentPhase: DayPhase, currentDay: number): AgentSocialFocus {
    const eveningPlan = this.activeEveningPlan(agent, currentPhase, currentDay);
    if (eveningPlan?.targetAgentId && eveningPlan.targetAgentName) {
      return {
        agentId: eveningPlan.targetAgentId,
        agentName: eveningPlan.targetAgentName,
        intent: eveningPlan.intent === "avoid_rival" ? "avoid" : "seek",
        reason: eveningPlan.detail
      };
    }

    const rival = this.strongestRelationship(agent, (relationship) => relationship.attitude === "rival");
    if (rival && (agent.stress > 48 || agent.mood < 34)) {
      return {
        agentId: rival.agentId,
        agentName: rival.agentName,
        intent: "avoid",
        reason: `${rival.agentName} has been making the day harder`
      };
    }

    const friend = this.strongestRelationship(agent, (relationship) => relationship.attitude === "friend" || relationship.score > 18);
    if (friend && (agent.social < 72 || currentPhase === "evening")) {
      return {
        agentId: friend.agentId,
        agentName: friend.agentName,
        intent: "seek",
        reason: `${friend.agentName} feels like a reliable person to find`
      };
    }

    const familiar = this.strongestRelationship(agent, (relationship) => relationship.attitude === "familiar");
    if (familiar && agent.social < 42) {
      return {
        agentId: familiar.agentId,
        agentName: familiar.agentName,
        intent: "seek",
        reason: `${familiar.agentName} is at least familiar`
      };
    }

    return null;
  }

  planEvening(agent: SimAgent, context: RelationshipRuntimeContext) {
    const rival = this.strongestRelationship(agent, (relationship) => relationship.attitude === "rival");
    const friend = this.strongestRelationship(agent, (relationship) => relationship.attitude === "friend" || relationship.score > 18);
    const familiar = this.strongestRelationship(agent, (relationship) => relationship.attitude === "familiar" || relationship.score > 6);
    let plan: AgentEveningPlan;

    if (rival && (agent.stress > 44 || agent.mood < 42 || agent.reputation.trouble > 46)) {
      plan = {
        day: context.currentDay,
        intent: "avoid_rival",
        label: `Avoid ${rival.agentName}`,
        detail: `${rival.agentName} has been making the evening feel tense.`,
        targetAgentId: rival.agentId,
        targetAgentName: rival.agentName,
        outcome: "pending",
        resolved: false
      };
    } else if (friend && (agent.social < 84 || context.currentPhase === "evening")) {
      plan = {
        day: context.currentDay,
        intent: "seek_friend",
        label: `Find ${friend.agentName}`,
        detail: `${friend.agentName} feels like the best person to end the day near.`,
        targetAgentId: friend.agentId,
        targetAgentName: friend.agentName,
        outcome: "pending",
        resolved: false
      };
    } else if ((familiar && agent.dna.sociability > 42) || agent.dna.sociability > 64 || agent.social < 46) {
      plan = {
        day: context.currentDay,
        intent: familiar ? "seek_friend" : "meet_someone",
        label: familiar ? `Catch up with ${familiar.agentName}` : "Meet someone after work",
        detail: familiar ? `${familiar.agentName} is familiar enough to look for.` : "The park might turn strangers into familiar faces.",
        targetAgentId: familiar?.agentId,
        targetAgentName: familiar?.agentName,
        outcome: "pending",
        resolved: false
      };
    } else {
      plan = {
        day: context.currentDay,
        intent: "decompress",
        label: "Keep the evening quiet",
        detail: agent.stress > 44 ? "Stress is high enough that a quiet seat sounds better than a crowd." : "A low-pressure evening fits their mood.",
        outcome: "pending",
        resolved: false
      };
    }

    agent.eveningPlan = plan;
    context.addMemory(agent, "plan", `Evening plan: ${plan.label}. ${plan.detail}`, 6, ["plan", "evening", "social"]);
    context.log(agent, `${agent.name} made an evening plan: ${plan.label}.`, "social", plan.intent === "avoid_rival" ? "warn" : "neutral", 5);
  }

  markEveningPlanOutcome(agent: SimAgent, outcome: AgentEveningPlanOutcome, detail: string, context: RelationshipRuntimeContext) {
    const plan = agent.eveningPlan;
    if (plan.day !== context.currentDay || plan.intent === "none" || plan.resolved) return;
    plan.outcome = outcome;
    plan.resolved = true;
    plan.detail = `${plan.detail} Outcome: ${detail}`;
    context.addMemory(agent, outcome === "conflict" ? "event" : "reflection", `Evening plan: ${plan.label}. ${detail}`, outcome === "conflict" ? 8 : 6, [
      "evening",
      "social",
      outcome
    ]);
    context.log(
      agent,
      `${agent.name}'s evening plan resolved: ${detail}`,
      "social",
      outcome === "conflict" ? "warn" : outcome === "quiet" || outcome === "skipped" ? "neutral" : "good",
      outcome === "conflict" ? 8 : 6
    );
  }

  observeNearbyAgents(agent: SimAgent, agents: readonly SimAgent[], dt: number, context: RelationshipRuntimeContext) {
    agent.observationCooldown -= dt;
    if (agent.observationCooldown > 0) return;
    agent.observationCooldown = 5 + (100 - agent.dna.sociability) / 40;

    for (const other of agents) {
      if (other.id === agent.id || distance2d(agent.position, other.position) > 2.6) continue;
      const relationship = this.relationshipFor(agent, other, context.worldTime);
      const otherRelationship = this.relationshipFor(other, agent, context.worldTime);
      const socialContext = agent.currentAction === "socializing" || other.currentAction === "socializing";
      const observationCooldown = socialContext ? SOCIAL_OBSERVATION_COOLDOWN_MINUTES : CASUAL_OBSERVATION_COOLDOWN_MINUTES;
      const lastPairObservation = Math.max(relationship.lastObservationWorldMinutes, otherRelationship.lastObservationWorldMinutes);
      if (context.worldMinutes - lastPairObservation < observationCooldown) continue;

      relationship.lastObservationWorldMinutes = context.worldMinutes;
      otherRelationship.lastObservationWorldMinutes = context.worldMinutes;
      const current = relationship.score;
      const delta =
        current < -16 && agent.socialFocus?.intent === "avoid"
          ? -0.18
          : socialContext
            ? 1.35
            : 0.25;
      const eventText =
        delta < 0
          ? `Kept distance from ${other.name}.`
          : agent.currentAction === "socializing" || other.currentAction === "socializing"
            ? `Spent a little social time near ${other.name}.`
            : `Crossed paths with ${other.name}.`;
      const updated = this.adjustRelationship(agent, other, delta, eventText, context.worldTime);
      context.addMemory(agent, "observation", eventText, 3 + Math.abs(delta), ["social", other.id, updated.attitude]);

      const conflictPressure =
        agent.stress +
        other.stress +
        agent.dna.risk * 0.35 +
        agent.reputation.trouble * 0.08 +
        other.reputation.trouble * 0.05 -
        agent.dna.empathy * 0.18 -
        current * 0.22;
      const minuteBucket = Math.floor(context.worldMinutes / 15);
      const roll = randomFromHash(hashText(`${agent.id}:${other.id}:${minuteBucket}`), 1);
      if ((updated.attitude === "rival" && conflictPressure > 60 && roll > 0.68) || (conflictPressure > 90 && roll > 0.82)) {
        this.applyConflict(agent, other, "bumped into", context);
      }
      break;
    }
  }

  observeHousemates(agent: SimAgent, agents: readonly SimAgent[], context: RelationshipRuntimeContext) {
    if (!agent.home || agent.home === "No home") return;
    for (const other of agents) {
      if (other.id === agent.id || other.home !== agent.home) continue;
      const relationship = this.relationshipFor(agent, other, context.worldTime);
      if (context.worldMinutes - relationship.lastObservationWorldMinutes < HOUSEMATE_OBSERVATION_COOLDOWN_MINUTES) continue;

      relationship.lastObservationWorldMinutes = context.worldMinutes;
      const delta = 0.55 + agent.dna.sociability * 0.008 + agent.dna.empathy * 0.004 - Math.max(0, agent.stress - 70) * 0.01;
      const updated = this.adjustRelationship(agent, other, delta, `Shared the rhythm of ${agent.home}.`, context.worldTime);
      updated.lastGesture = "Housemate rhythm";
      updated.familiarity = Math.round(clamp(updated.familiarity + 3));
      updated.tension = Math.round(clamp(updated.tension - 0.4));
      context.addMemory(agent, "observation", `${other.name} is part of the everyday rhythm at ${agent.home}.`, 3, [
        "social",
        "home",
        other.id,
        updated.attitude
      ]);
      context.recordSocialMoment(agent, {
        kind: "housemate",
        label: "Housemate Rhythm",
        detail: `${other.name} is becoming part of home life at ${agent.home}.`,
        tone: updated.tension > 44 ? "warn" : updated.score > 10 ? "good" : "neutral",
        otherAgentId: other.id,
        otherAgentName: other.name,
        scoreDelta: Math.round(delta * 10) / 10,
        trustDelta: 1,
        supportDelta: 0,
        tags: ["social", "home", updated.attitude],
        durationMinutes: 260
      });
      break;
    }
  }

  applyConflict(agent: SimAgent, other: SimAgent, verb: string, context: RelationshipRuntimeContext) {
    const existingAgentRel = this.relationshipFor(agent, other, context.worldTime);
    const existingOtherRel = this.relationshipFor(other, agent, context.worldTime);
    if (!this.canStartConflict(agent, other, context, existingAgentRel, existingOtherRel)) return false;

    const agentLoss = 5 + agent.dna.risk / 30;
    const otherLoss = 4 + other.dna.risk / 36;
    const agentRel = this.adjustRelationship(agent, other, -agentLoss, `${verb} ${other.name}; the mood soured.`, context.worldTime);
    const otherRel = this.adjustRelationship(other, agent, -otherLoss, `${agent.name} ${verb} me; the mood soured.`, context.worldTime);
    agentRel.lastConflictWorldMinutes = context.worldMinutes;
    otherRel.lastConflictWorldMinutes = context.worldMinutes;
    agentRel.lastGesture = "Conflict";
    otherRel.lastGesture = "Conflict";
    agentRel.tension = Math.round(clamp(agentRel.tension + 16));
    otherRel.tension = Math.round(clamp(otherRel.tension + 14));
    agentRel.trust = Math.round(clamp(agentRel.trust - 6));
    otherRel.trust = Math.round(clamp(otherRel.trust - 5));
    agent.stress = clamp(agent.stress + 12);
    other.stress = clamp(other.stress + 8);
    agent.mood = clamp(agent.mood - 10);
    other.mood = clamp(other.mood - 6);
    agent.social = clamp(agent.social - 6);
    other.social = clamp(other.social - 3);
    agent.routine.conflictsToday += 1;
    other.routine.conflictsToday += 1;
    this.adjustReputation(agent, { warmth: -4, trouble: 7 });
    this.adjustReputation(other, { warmth: -2, trouble: 4 });
    context.recordObjectUse(agent, { cleanlinessDelta: -2, wearDelta: 1, heatDelta: 12 });
    context.addMoodlet(agent, {
      id: "rattled-by-conflict",
      label: "Rattled",
      detail: `${other.name} got under their skin`,
      tone: "bad",
      intensity: 7,
      durationMinutes: 260,
      tags: ["social", "conflict", other.id],
      actionBiases: { resting: 14, socializing: -16, working: -6 }
    });
    context.addMoodlet(other, {
      id: "socially-bruised",
      label: "Socially Bruised",
      detail: `${agent.name} made the day feel hostile`,
      tone: "warn",
      intensity: 5.5,
      durationMinutes: 220,
      tags: ["social", "conflict", agent.id],
      actionBiases: { resting: 10, socializing: -10, working: -4 }
    });
    context.addMemory(agent, "event", `I ${verb} ${other.name}, and it left a mark.`, 8, ["social", "conflict", other.id, agentRel.attitude]);
    context.addMemory(other, "event", `${agent.name} ${verb} me, and the mood soured.`, 7, ["social", "conflict", agent.id, otherRel.attitude]);
    const rivalLine = agentRel.attitude === "rival" || otherRel.attitude === "rival" ? " That rivalry is becoming hard to ignore." : "";
    context.log(agent, `${agent.name} ${verb} ${other.name}; both walked away irritated.${rivalLine}`, "conflict", "warn", 8);
    context.recordSocialMoment(agent, {
      kind: "conflict",
      label: "Conflict",
      detail: `${other.name} got under their skin. ${agentRel.attitude === "rival" ? "This is becoming a rivalry." : "The relationship took a hit."}`,
      tone: agentRel.attitude === "rival" ? "bad" : "warn",
      otherAgentId: other.id,
      otherAgentName: other.name,
      scoreDelta: -Math.round(agentLoss * 10) / 10,
      trustDelta: -6,
      supportDelta: 0,
      tags: ["social", "conflict", agentRel.attitude],
      durationMinutes: 420
    });
    context.recordSocialMoment(other, {
      kind: "conflict",
      label: "Conflict",
      detail: `${agent.name} made the day feel hostile. ${otherRel.attitude === "rival" ? "This is becoming a rivalry." : "The relationship took a hit."}`,
      tone: otherRel.attitude === "rival" ? "bad" : "warn",
      otherAgentId: agent.id,
      otherAgentName: agent.name,
      scoreDelta: -Math.round(otherLoss * 10) / 10,
      trustDelta: -5,
      supportDelta: 0,
      tags: ["social", "conflict", otherRel.attitude],
      durationMinutes: 420
    });
    this.markEveningPlanOutcome(agent, "conflict", `${other.name} turned the evening tense`, context);
    this.markEveningPlanOutcome(other, "conflict", `${agent.name} turned the evening tense`, context);
    return true;
  }

  noteDeescalation(agent: SimAgent, other: SimAgent, context: RelationshipRuntimeContext) {
    const agentRel = this.adjustRelationship(agent, other, 0.9 + agent.dna.empathy / 90, `Kept things civil with ${other.name}.`, context.worldTime);
    const otherRel = this.adjustRelationship(other, agent, 0.5 + other.dna.empathy / 120, `${agent.name} kept things civil.`, context.worldTime);
    agentRel.lastObservationWorldMinutes = context.worldMinutes;
    otherRel.lastObservationWorldMinutes = context.worldMinutes;
    agentRel.lastGesture = "Kept civil";
    otherRel.lastGesture = "Kept civil";
    agentRel.tension = Math.round(clamp(agentRel.tension - 8));
    otherRel.tension = Math.round(clamp(otherRel.tension - 5));
    agentRel.trust = Math.round(clamp(agentRel.trust + 1));
    otherRel.trust = Math.round(clamp(otherRel.trust + 1));
    agent.stress = clamp(agent.stress - 5);
    other.stress = clamp(other.stress - 2);
    agent.mood = clamp(agent.mood + 3);
    other.mood = clamp(other.mood + 1);
    agent.social = clamp(agent.social + 8);
    other.social = clamp(other.social + 3);
    agent.routine.deescalationsToday += 1;
    other.routine.deescalationsToday += 1;
    this.adjustReputation(agent, { warmth: 2, trouble: -3 });
    this.adjustReputation(other, { warmth: 1, trouble: -1 });
    context.recordObjectUse(agent, { cleanlinessDelta: -0.5, wearDelta: 0.25, heatDelta: -4 });
    context.addMoodlet(agent, {
      id: "kept-cool",
      label: "Kept Cool",
      detail: `did not let ${other.name} pull them into a fight`,
      tone: "good",
      intensity: 4,
      durationMinutes: 180,
      tags: ["social", "deescalation", other.id],
      actionBiases: { socializing: 4, resting: 2, working: 3 }
    });
    context.addMemory(agent, "reflection", `Tension with ${other.name} stayed civil instead of turning into another fight.`, 6, [
      "social",
      "deescalation",
      other.id,
      agentRel.attitude
    ]);
    context.addMemory(other, "observation", `${agent.name} kept a tense moment civil.`, 4, ["social", "deescalation", agent.id, otherRel.attitude]);
    context.log(agent, `${agent.name} kept things civil with ${other.name} instead of escalating again.`, "social", "neutral", 6);
    context.recordSocialMoment(agent, {
      kind: "deescalation",
      label: "Kept Civil",
      detail: `Tension with ${other.name} cooled instead of turning into another fight.`,
      tone: "good",
      otherAgentId: other.id,
      otherAgentName: other.name,
      scoreDelta: Math.round((0.9 + agent.dna.empathy / 90) * 10) / 10,
      trustDelta: 1,
      supportDelta: 0,
      tags: ["social", "deescalation", agentRel.attitude],
      durationMinutes: 260
    });
    context.recordSocialMoment(other, {
      kind: "deescalation",
      label: "Kept Civil",
      detail: `${agent.name} kept a tense moment from getting worse.`,
      tone: "good",
      otherAgentId: agent.id,
      otherAgentName: agent.name,
      scoreDelta: Math.round((0.5 + other.dna.empathy / 120) * 10) / 10,
      trustDelta: 1,
      supportDelta: 0,
      tags: ["social", "deescalation", otherRel.attitude],
      durationMinutes: 240
    });
    this.markEveningPlanOutcome(agent, "quiet", `${other.name} did not turn the moment into another fight`, context);
  }

  private attitudeFor(score: number, encounters: number) {
    if (score <= -10) return "rival";
    if (score >= 22) return "friend";
    if (score >= 4 || encounters >= 2) return "familiar";
    return "stranger";
  }

  private trustFor(score: number, encounters: number) {
    return Math.round(clamp(35 + score * 0.45 + Math.min(26, encounters * 2.4), 0, 100));
  }

  private tensionFor(score: number) {
    return Math.round(clamp(28 - score * 0.55, 0, 100));
  }

  private initialRelationshipScore(agent: SimAgent, other: SimAgent) {
    const seed = hashText(`${agent.id}:${other.id}:first-impression`);
    const temperamentFit =
      3 -
      Math.abs(agent.dna.discipline - other.dna.discipline) * 0.05 -
      Math.abs(agent.dna.risk - other.dna.risk) * 0.06 -
      Math.abs(agent.dna.greed - other.dna.greed) * 0.035;
    const socialFit = (agent.dna.sociability + other.dna.sociability - 100) * 0.055;
    const empathyFit = (agent.dna.empathy + other.dna.empathy - 100) * 0.04;
    const riskFriction = agent.dna.risk > 72 && other.dna.discipline > 65 ? -7 : 0;
    const greedFriction = agent.dna.greed > 72 && other.dna.empathy > 65 ? -6 : 0;
    const publicRead = this.publicReputationBias(other);
    const roll = (randomFromHash(seed, 1) - 0.5) * 28;
    return Math.round(clamp(temperamentFit + socialFit + empathyFit + riskFriction + greedFriction + publicRead + roll, -28, 28));
  }

  private canStartConflict(
    agent: SimAgent,
    other: SimAgent,
    context: RelationshipRuntimeContext,
    agentRelationship: AgentRelationship,
    otherRelationship: AgentRelationship
  ) {
    if (agent.routine.conflictsToday >= 3 || other.routine.conflictsToday >= 3) return false;
    const lastConflict = Math.max(agentRelationship.lastConflictWorldMinutes, otherRelationship.lastConflictWorldMinutes);
    const minutesSinceConflict = context.worldMinutes - lastConflict;
    const averageRisk = (agent.dna.risk + other.dna.risk) / 2;
    const averageEmpathy = (agent.dna.empathy + other.dna.empathy) / 2;
    const cooldown = clamp(210 - averageRisk * 0.8 + averageEmpathy * 0.5, 80, 260);
    return minutesSinceConflict >= cooldown;
  }
}
