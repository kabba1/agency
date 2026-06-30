import type { ActionPoint, StructureMetadata } from "../shared/types";
import { buildActionAffordances, describeActionOption, type SemanticActionAffordance } from "./ActionAffordances";
import type {
  AgentAction,
  AgentDecisionRead,
  AgentDecisionReadOption,
  AgentDriveId,
  AgentDriveState,
  AgentEventKind,
  AgentEventTone,
  AgentIntention,
  AgentLifePriority,
  AgentMemoryKind,
  AgentPoint,
  AgentRouteResolver,
  AgentSocialFocus,
  DayPhase,
  SimAgent,
  WeatherState
} from "./AgentSimulation";
import type { CityPulse, CityPulseMetricId } from "./CityPulseSystem";
import type { MemorySystem } from "./MemorySystem";
import type { ObjectStateSystem } from "./ObjectStateSystem";
import type { RelationshipSystem } from "./RelationshipSystem";
import {
  ACTION_DWELL_SECONDS,
  clamp,
  distance2d,
  formatTime,
  hashText,
  PHASE_BOOSTS,
  randomFromHash,
  worldPoint,
  type Candidate,
  type TargetPoint
} from "./SimulationPrimitives";

export type DecisionContext = {
  phase: DayPhase;
  phaseLabel: string;
  currentDay: number;
  worldMinutes: number;
  weather: WeatherState;
  agents: readonly SimAgent[];
  memory: MemorySystem;
  objectStates: ObjectStateSystem;
  cityPulse: CityPulse;
  relationship: RelationshipSystem;
  addMemory: (agent: SimAgent, kind: AgentMemoryKind, text: string, importance: number, tags: string[]) => void;
  log: (agent: SimAgent, text: string, kind?: AgentEventKind, tone?: AgentEventTone, importance?: number) => void;
};

type ReachableCandidate = {
  candidate: Candidate;
  destination: AgentPoint;
  waypoints: AgentPoint[];
  choiceScore: number;
  choiceReason: string;
};

export class AgentDecisionSystem {
  updateLifePriority(agent: SimAgent, context: DecisionContext) {
    const drive = this.activeDriveFor(agent, context);
    const priority = this.lifePriorityFor(agent, context);
    agent.activeDrive = drive.info;
    agent.lifePriority = priority.info;
    this.refreshIntention(agent, context, drive.info, priority.info);
    return agent.lifePriority;
  }

  chooseNextTarget(agent: SimAgent, structures: StructureMetadata[], routeResolver: AgentRouteResolver | undefined, context: DecisionContext) {
    const candidates = this.buildCandidates(agent, structures, context).sort((a, b) => b.utility - a.utility);
    agent.availableActions = this.describeRankedOptions(candidates);
    const reachable = this.reachableCandidates(agent, candidates, routeResolver);
    const selected = this.chooseReachableCandidate(agent, reachable, context);

    if (selected) {
      const { candidate, destination, waypoints } = selected;
      agent.goal = candidate.goal;
      agent.plan = candidate.plan;
      agent.socialFocus = candidate.socialFocus ?? null;
      agent.lastDecision = `${context.phaseLabel}: ${agent.lifePriority.label} - ${candidate.reason}. ${selected.choiceReason}`;
      agent.target = {
        ...destination,
        label: `${candidate.structure.name}: ${candidate.point.label}`,
        action: candidate.action,
        structureId: candidate.structure.id,
        structureName: candidate.structure.name,
        actionPointId: candidate.point.id,
        actionPointType: candidate.point.type,
        intent: candidate.intent ? { ...candidate.intent } : undefined,
        waypoints: [...waypoints],
        routeLength: waypoints.length,
        hoursLabel: this.hoursLabel(candidate.structure),
        openNow: this.isOpenForAction(agent, candidate.structure, candidate.point, candidate.action, context)
      };
      const dwellDuration = ACTION_DWELL_SECONDS[candidate.action] + (agent.dna.discipline / 100) * 1.5;
      agent.dwellTotalSeconds = dwellDuration;
      agent.dwellSeconds = dwellDuration;
      agent.actionProgress = 0;
      agent.availableActions = this.describeRankedOptions(candidates, candidate);
      agent.decisionRead = this.describeDeliberation(agent, context, candidates, reachable, selected);
      context.objectStates.stateForTarget(agent.target);
      context.addMemory(agent, "plan", `${agent.goal}. ${agent.lastDecision}`, 4, ["plan", candidate.action, agent.lifePriority.id]);
      return;
    }

    agent.target = null;
    agent.socialFocus = null;
    agent.currentAction = "idle";
    agent.goal = "Wait for a reachable opportunity";
    agent.plan = ["Stay put", "Watch the city", "Try another destination soon"];
    agent.lastDecision = "No reachable semantic target was available.";
    agent.decisionRead = this.describeDeliberation(agent, context, candidates, reachable, null);
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 0;
    context.addMemory(agent, "observation", "Could not find a reachable route to any useful destination.", 8, ["route", "blocked"]);
    context.log(agent, `${agent.name} could not find a reachable route.`, "city", "warn", 6);
  }

  private describeRankedOptions(candidates: Candidate[], selected?: Candidate) {
    const visible = this.visibleDecisionCandidates(candidates, selected);
    return visible.map((candidate) => describeActionOption(candidate, candidate === selected));
  }

  private visibleDecisionCandidates(candidates: Candidate[], selected?: Candidate) {
    const maxVisible = 8;
    const visible: Candidate[] = [];
    const familySeen = new Set<string>();
    const add = (candidate: Candidate) => {
      if (visible.includes(candidate)) return;
      visible.push(candidate);
      familySeen.add(this.optionFamily(candidate));
    };

    if (selected) add(selected);
    if (selected?.intent?.kind) {
      for (const candidate of candidates) {
        if (visible.length >= maxVisible) break;
        if (candidate.intent?.kind === selected.intent.kind) add(candidate);
      }
    }
    for (const candidate of candidates) {
      if (visible.length >= maxVisible) break;
      const family = this.optionFamily(candidate);
      if (!familySeen.has(family)) add(candidate);
    }
    for (const candidate of candidates) {
      if (visible.length >= maxVisible) break;
      add(candidate);
    }
    return visible.slice(0, maxVisible);
  }

  private optionFamily(candidate: Candidate) {
    const strategy = candidate.intent?.strategy ?? candidate.action;
    if (strategy.includes("partial")) return "partial-payment";
    if (strategy === "review_only") return "review-or-delay";
    if (strategy.includes("earn_before")) return "earn-first";
    if (strategy.includes("quick_meal")) return "quick-meal";
    if (strategy.includes("groceries") && !strategy.includes("bulk")) return "groceries";
    if (strategy.includes("bulk_groceries")) return "bulk-groceries";
    if (strategy.includes("earn_food")) return "earn-food";
    if (strategy.includes("unfunded")) return "unfunded";
    if (strategy === "wash_hygiene") return "quick-wash";
    if (strategy === "do_laundry") return "laundry";
    if (strategy === "tidy_clutter") return "tidy";
    if (strategy === "deep_clean") return "deep-clean";
    if (strategy === "sleep_prep") return "sleep-prep";
    if (strategy === "clinic_checkup") return "clinic-checkup";
    if (strategy === "take_aftercare_medicine") return "aftercare";
    if (strategy === "call_in_sick") return "sick-day";
    if (strategy === "treat_symptoms" || strategy === "paid_clinic_visit") return "clinic-treatment";
    if (strategy === "urgent_care") return "urgent-care";
    if (strategy === "seek_unpaid_care") return "unpaid-care";
    if (strategy === "repay_support") return "repay-support";
    if (strategy === "request_payment_plan") return "payment-plan";
    if (candidate.intent?.kind === "civic" && strategy.startsWith("pay_")) return "clear-payment";
    return `${candidate.action}:${candidate.intent?.kind ?? "none"}`;
  }

  private describeDeliberation(
    agent: SimAgent,
    context: DecisionContext,
    candidates: Candidate[],
    reachable: ReachableCandidate[],
    selected: ReachableCandidate | null
  ): AgentDecisionRead {
    const reachableByCandidate = new Map<Candidate, ReachableCandidate>();
    for (const item of reachable) reachableByCandidate.set(item.candidate, item);

    const selectedOption = selected ? describeActionOption(selected.candidate, true) : null;
    const urgency = Math.round(this.decisionUrgency(agent));
    const style = this.decisionStyle(agent, urgency);
    const optionWindow = Math.round(this.choiceWindow(agent, urgency) * 10) / 10;
    const randomness = Math.round(this.choiceNoise(agent) * 10) / 10;

    const options = this.visibleDecisionCandidates(candidates, selected?.candidate).map((candidate) => {
      const reachableItem = reachableByCandidate.get(candidate);
      return this.describeDecisionOption(agent, candidate, reachableItem, selected?.candidate === candidate, selected?.candidate === candidate ? selected.choiceScore : undefined);
    });

    const selectedRead = selected ? this.describeDecisionOption(agent, selected.candidate, selected, true, selected.choiceScore) : null;
    if (selectedRead && !options.some((option) => option.id === selectedRead.id)) {
      options.unshift(selectedRead);
      options.splice(8);
    }

    return {
      worldTime: formatTime(context.worldMinutes),
      phaseLabel: context.phaseLabel,
      primaryNeed: `${agent.activeDrive.label}: ${agent.activeDrive.detail}`,
      intention: agent.activeIntention.label,
      style,
      urgency,
      confidence: agent.activeIntention.confidence,
      optionWindow,
      randomness,
      selectedOptionId: selectedOption?.id ?? null,
      selectedLabel: selectedOption?.label ?? "No reachable action",
      selectedAction: selected?.candidate.action ?? "none",
      selectedIntent: selected?.candidate.intent ? { ...selected.candidate.intent } : undefined,
      reason: selected?.choiceReason ?? (candidates.length > 0 ? "Semantic choices existed, but no reachable route was available." : "No semantic choices were available."),
      factors: this.decisionFactorsFor(agent, context, selected, candidates),
      options
    };
  }

  private describeDecisionOption(
    agent: SimAgent,
    candidate: Candidate,
    reachable: ReachableCandidate | undefined,
    selected: boolean,
    choiceScoreOverride?: number
  ): AgentDecisionReadOption {
    const option = describeActionOption(candidate, selected);
    return {
      id: option.id,
      label: option.label,
      action: option.action,
      location: option.location,
      intentLabel: option.intent?.label ?? option.label,
      intent: option.intent ? { ...option.intent } : undefined,
      utility: option.utility,
      choiceScore: Math.round((choiceScoreOverride ?? reachable?.choiceScore ?? candidate.utility) * 10) / 10,
      personalityNudge: Math.round(this.personalityNudge(agent, candidate) * 10) / 10,
      memoryNudge: Math.round(this.choiceMemoryNudge(agent, candidate) * 10) / 10,
      routeSteps: reachable?.waypoints.length ?? 0,
      reachable: Boolean(reachable),
      selected,
      tone: option.tone,
      reason: option.reason
    };
  }

  private decisionFactorsFor(agent: SimAgent, context: DecisionContext, selected: ReachableCandidate | null, candidates: Candidate[]) {
    const factors: string[] = [
      `${agent.activeIntention.label} urgency ${agent.activeIntention.urgency}, confidence ${agent.activeIntention.confidence}`,
      `${agent.lifePriority.label}: ${agent.lifePriority.detail}`,
      `Rhythm ${agent.rhythm.identity}: momentum ${agent.rhythm.momentum}, drift ${agent.rhythm.drift}`
    ];

    const billsDue = Math.round((agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue) * 100) / 100;
    const liquidFunds = Math.round((agent.money + agent.budget.savings) * 100) / 100;
    if (billsDue > 0) factors.push(`${billsDue} due against ${liquidFunds} liquid credits`);
    if (agent.hunger > 66) factors.push(`hunger pressure ${Math.round(agent.hunger)}`);
    if (agent.energy < 36) factors.push(`low energy ${Math.round(agent.energy)}`);
    if (agent.stress > 58) factors.push(`stress ${Math.round(agent.stress)}`);
    if (agent.medical.minorIllness.active) factors.push(`${agent.medical.minorIllness.label ?? "illness"} severity ${Math.round(agent.medical.minorIllness.severity)}`);
    const leadWant = agent.wants[0];
    if (leadWant) factors.push(`${leadWant.kind === "fear" ? "fear" : "want"}: ${leadWant.label}`);
    const strainedMetric = context.cityPulse.metrics.find((metric) => metric.tone === "bad" || metric.tone === "warn");
    if (strainedMetric) factors.push(`city ${strainedMetric.label.toLowerCase()}: ${strainedMetric.detail}`);
    if (selected) {
      const routeSteps = selected.waypoints.length;
      factors.push(`${this.choiceLabel(selected.candidate)} was reachable in ${routeSteps} step${routeSteps === 1 ? "" : "s"}`);
    } else if (candidates.length > 0) {
      factors.push(`${candidates.length} options were considered but routes failed`);
    }

    return factors.slice(0, 6);
  }

  private reachableCandidates(agent: SimAgent, candidates: Candidate[], routeResolver: AgentRouteResolver | undefined): ReachableCandidate[] {
    const reachable: ReachableCandidate[] = [];
    for (const candidate of candidates) {
      const point = worldPoint(candidate.point.position);
      const waypoints = routeResolver ? routeResolver(agent.position, point) : [point];
      if (!waypoints || waypoints.length === 0) continue;
      reachable.push({
        candidate,
        destination: waypoints[waypoints.length - 1] ?? point,
        waypoints,
        choiceScore: candidate.utility,
        choiceReason: "Chose the most reachable useful option."
      });
    }
    return reachable;
  }

  private chooseReachableCandidate(agent: SimAgent, reachable: ReachableCandidate[], context: DecisionContext): ReachableCandidate | null {
    if (reachable.length === 0) return null;

    const ranked = [...reachable].sort((a, b) => b.candidate.utility - a.candidate.utility);
    const top = ranked[0];
    if (!top) return null;
    const next = ranked[1];
    const topUtility = top.candidate.utility;
    const urgency = this.decisionUrgency(agent);
    const optionWindow = this.choiceWindow(agent, urgency);
    const urgentLock = urgency >= 86 && (!next || topUtility - next.candidate.utility >= 7);
    const style = this.decisionStyle(agent, urgency);

    if (urgentLock) {
      return {
        ...top,
        choiceScore: topUtility,
        choiceReason: `Urgency narrowed the choice, so ${this.decisionArticle(style)} ${style} read stayed with ${this.choiceLabel(top.candidate)}.`
      };
    }

    const seed = hashText(`${agent.id}:${context.currentDay}:${Math.floor(context.worldMinutes / 12)}:${agent.activeIntention.id}:${agent.goal}`);
    const noiseRange = this.choiceNoise(agent);
    const scored = ranked
      .map((item, index) => {
        const margin = topUtility - item.candidate.utility;
        const personality = this.personalityNudge(agent, item.candidate);
        const memory = this.choiceMemoryNudge(agent, item.candidate);
        const routePenalty = Math.max(0, item.waypoints.length - 1) * 0.24;
        const noise = (randomFromHash(seed, index) - 0.5) * noiseRange;
        return {
          ...item,
          choiceScore: item.candidate.utility - margin * 0.28 + personality + memory + noise - routePenalty
        };
      })
      .filter((item, index) => index === 0 || topUtility - item.candidate.utility <= optionWindow)
      .slice(0, 5)
      .sort((a, b) => b.choiceScore - a.choiceScore || b.candidate.utility - a.candidate.utility);

    const selected = scored[0] ?? top;
    const selectedLabel = this.choiceLabel(selected.candidate);
    const topLabel = this.choiceLabel(top.candidate);
    const article = this.decisionArticle(style);
    const choiceReason =
      selected.candidate === top.candidate
        ? `${article} ${style} read compared nearby options and stayed with ${selectedLabel}.`
        : `${article} ${style} read weighed ${topLabel} against ${selectedLabel} and chose the option that fit this agent right now.`;

    return { ...selected, choiceReason };
  }

  private decisionUrgency(agent: SimAgent) {
    const priorityUrgency = agent.lifePriority.tone === "bad" ? 88 : agent.lifePriority.tone === "warn" ? 66 : 42;
    return clamp(Math.max(agent.activeIntention.urgency, agent.activeDrive.pressure, priorityUrgency));
  }

  private choiceWindow(agent: SimAgent, urgency: number) {
    return clamp(
      7 +
        agent.dna.risk * 0.13 +
        Math.max(0, agent.stress - 52) * 0.1 +
        Math.max(0, 62 - agent.activeIntention.confidence) * 0.1 -
        agent.dna.discipline * 0.08 -
        urgency * 0.075,
      3,
      24
    );
  }

  private choiceNoise(agent: SimAgent) {
    return clamp(2.5 + agent.dna.risk * 0.08 + agent.stress * 0.035 + Math.max(0, 72 - agent.activeIntention.confidence) * 0.05 - agent.dna.discipline * 0.035, 1, 12);
  }

  private decisionStyle(agent: SimAgent, urgency: number) {
    if (urgency >= 82) return "urgent";
    if (agent.stress >= 72) return "stressed";
    if (agent.dna.discipline >= 72 && agent.activeIntention.confidence >= 58) return "disciplined";
    if (agent.dna.risk >= 70 && agent.values.autonomy >= 54) return "exploratory";
    if (agent.dna.empathy >= 70 && agent.values.care >= 54) return "care-minded";
    if (agent.dna.sociability >= 72 && agent.values.belonging >= 54) return "social";
    return "balanced";
  }

  private decisionArticle(style: string) {
    return /^[aeiou]/i.test(style) ? "An" : "A";
  }

  private choiceLabel(candidate: Candidate) {
    return candidate.optionLabel ?? candidate.goal;
  }

  private personalityNudge(agent: SimAgent, candidate: Candidate) {
    switch (candidate.action) {
      case "working":
        return agent.dna.discipline * 0.055 + agent.dna.greed * 0.035 + agent.values.mastery * 0.025 - Math.max(0, agent.career.burnout - 58) * 0.12;
      case "calling_in_sick":
        return agent.dna.discipline * 0.035 + agent.values.security * 0.035 + agent.values.care * 0.025 - agent.dna.greed * 0.025;
      case "socializing":
        return agent.dna.sociability * 0.07 + agent.dna.empathy * 0.025 + agent.values.belonging * 0.03 - Math.max(0, agent.stress - 70) * 0.08;
      case "healing":
        return (100 - agent.health) * 0.035 + agent.dna.discipline * 0.025 + agent.values.security * 0.025 + agent.values.care * 0.018;
      case "paying_rent":
      case "budgeting":
      case "checking_mail":
        return agent.dna.discipline * 0.055 + agent.values.security * 0.035 - agent.dna.risk * 0.015;
      case "shopping":
      case "eating":
        return agent.hunger * 0.035 + agent.values.comfort * 0.018;
      case "resting":
      case "sleeping":
        return agent.stress * 0.035 + (100 - agent.energy) * 0.035 + agent.values.comfort * 0.025 - agent.dna.greed * 0.018;
      case "cleaning":
      case "washing":
        return agent.dna.discipline * 0.04 + agent.values.comfort * 0.035 + agent.skills.homecraft.level * 0.8;
      case "building":
        return agent.dna.risk * 0.045 + agent.dna.greed * 0.025 + agent.values.autonomy * 0.035 + agent.values.mastery * 0.025;
      default:
        return 0;
    }
  }

  private choiceMemoryNudge(agent: SimAgent, candidate: Candidate) {
    const memory = agent.activityMemory[candidate.action];
    if (!memory) return agent.values.autonomy * 0.02 + agent.dna.risk * 0.018;
    return clamp(memory.affinity * 0.045 + memory.confidence * 0.03 - memory.frustration * 0.055 + Math.min(4, memory.visits * 0.22), -8, 9);
  }

  private buildCandidates(agent: SimAgent, structures: StructureMetadata[], context: DecisionContext): Candidate[] {
    const candidates: Candidate[] = [];
    const socialFocus = context.relationship.chooseSocialFocus(agent, context.phase, context.currentDay);
    const eveningPlan = context.relationship.activeEveningPlan(agent, context.phase, context.currentDay);
    const drive = this.activeDriveFor(agent, context);
    const priority = this.lifePriorityFor(agent, context);
    agent.activeDrive = drive.info;
    agent.lifePriority = priority.info;
    this.refreshIntention(agent, context, drive.info, priority.info);
    const add = (target: TargetPoint | null, affordance: SemanticActionAffordance) => {
      if (target) {
        candidates.push({
          ...target,
          affordanceId: affordance.id,
          optionLabel: affordance.label,
          optionTone: affordance.tone,
          optionTags: affordance.tags,
          intent: affordance.intent ? { ...affordance.intent } : undefined,
          utility:
            affordance.utility +
            (PHASE_BOOSTS[context.phase][target.action] ?? 0) +
            this.actionPreference(agent, target.action) +
            this.activityMemoryActionBoost(agent, target.action, context) +
            this.skillActionReadiness(agent, target.action) +
            (drive.actionBoosts[target.action] ?? 0) +
            (priority.actionBoosts[target.action] ?? 0) +
            this.intentionActionBoost(agent, target.action) +
            this.moodletActionBoost(agent, target.action, context) +
            this.wantActionBoost(agent, target.action, context) +
            this.routineRhythmActionBoost(agent, target.action) +
            this.emotionalActionBoost(agent, target.action) +
            this.commitmentActionBoost(agent, target.action, context) +
            this.aspirationActionBoost(agent, target.action) +
            (target.action === "working" ? this.careerWorkPressure(agent) : 0) +
            (target.action === "working" ? this.jobServicePressure(agent, context) : 0),
          goal: affordance.goal,
          reason: affordance.reason,
          plan: affordance.plan,
          socialFocus: affordance.socialFocus ?? null
        });
      }
    };

    const liquidFunds = agent.money + agent.budget.savings;
    const moneyPressure = agent.money < 12 ? 25 : agent.money < 24 ? 12 : 0;
    const foodMemory = context.memory.signal(agent, "food", context.worldMinutes);
    const workMemory = context.memory.signal(agent, "work", context.worldMinutes);
    const socialMemory = context.memory.signal(agent, "social", context.worldMinutes);
    const savingsGap = Math.max(0, agent.budget.savingsGoal - agent.budget.savings);
    const creditRepairPressure = Math.max(0, 620 - agent.budget.creditScore) * 0.08 + agent.budget.missedBillCount * 3;
    const budgetOverage = Math.max(0, agent.budget.spentToday - agent.budget.dailySpendLimit);
    const discretionaryPenalty = agent.hunger < 74 ? budgetOverage * 0.8 : budgetOverage * 0.2;
    const livingPressure =
      agent.budget.livingCostDue > 0 ? 26 + agent.budget.livingCostDue * 1.5 + (liquidFunds >= agent.budget.livingCostDue ? 8 : -2) : -42;
    const rentPressure = agent.rentDue > 0 ? 38 + agent.rentDue * 2 + (liquidFunds >= agent.rentDue ? 10 : -3) : -42;
    const medicalBillPressure =
      agent.medicalDebt > 0 ? 22 + Math.min(48, agent.medicalDebt * 1.2) + (liquidFunds >= agent.medicalDebt ? 12 : liquidFunds > 0 ? 5 : -4) + (agent.health < 55 ? 8 : 0) : -38;
    const civicObligationPressure = Math.max(rentPressure, medicalBillPressure, livingPressure);
    const workedPenalty = agent.routine.workedToday ? -34 : 0;
    const atePenalty = agent.routine.ateToday && agent.hunger < 62 ? -24 : 0;
    const socialPenalty = agent.routine.socializedToday && agent.social > 58 ? -18 : 0;
    const mailPenalty = agent.routine.checkedMailToday ? -28 : 0;
    const illnessPressure = agent.medical.minorIllness.active ? 18 + agent.medical.minorIllness.severity * 0.9 : 0;
    const seekBoost = socialFocus?.intent === "seek" ? 18 : 0;
    const avoidSocialPenalty = socialFocus?.intent === "avoid" ? -28 : 0;
    const avoidRestBoost = socialFocus?.intent === "avoid" ? 18 : 0;
    const eveningSocialBoost = eveningPlan?.intent === "seek_friend" ? 34 : eveningPlan?.intent === "meet_someone" ? 30 : 0;
    const eveningQuietBoost = eveningPlan?.intent === "decompress" ? 28 : eveningPlan?.intent === "avoid_rival" ? 14 : 0;
    const eveningQuietPenalty = eveningPlan?.intent === "decompress" ? -18 : 0;
    const foodPressure = this.cityPressure(context, "food", 66);
    const healthPressure = this.cityPressure(context, "health", 66);
    const housingPressure = this.cityPressure(context, "housing", 62);
    const socialPressure = this.cityPressure(context, "social", 58);
    const upkeepPressure = this.cityPressure(context, "maintenance", 64);

    const affordances = buildActionAffordances(agent, {
      phase: context.phase,
      weather: context.weather,
      socialFocus,
      eveningPlan,
      liquidFunds,
      moneyPressure,
      foodMemory,
      workMemory,
      socialMemory,
      savingsGap,
      creditRepairPressure,
      worldMinutes: context.worldMinutes,
      civicObligationPressure,
      workedPenalty,
      atePenalty,
      socialPenalty,
      mailPenalty,
      seekBoost,
      avoidSocialPenalty,
      avoidRestBoost,
      eveningSocialBoost,
      eveningQuietBoost,
      eveningQuietPenalty,
      foodPressure,
      healthPressure,
      illnessPressure,
      housingPressure,
      socialPressure,
      upkeepPressure,
      discretionaryPenalty
    });

    for (const affordance of affordances) {
      const target =
        affordance.targetMode === "job"
          ? this.findJobTarget(agent, structures, context)
          : this.findTarget(agent, structures, affordance.pointTypes, affordance.action, context, affordance.structureTypes);
      add(target, affordance);
    }

    return candidates;
  }

  private actionPreference(agent: SimAgent, action: SimAgent["currentAction"]) {
    return agent.lifeProfile.actionBiases[action] ?? 0;
  }

  private activityMemoryActionBoost(agent: SimAgent, action: SimAgent["currentAction"], context: DecisionContext) {
    const memory = agent.activityMemory[action];
    if (!memory) return 0;
    const ageMinutes = Math.max(1, context.worldMinutes - memory.lastWorldMinutes);
    const recency = clamp(1 - ageMinutes / (1440 * 4), 0.22, 1);
    const familiarity = Math.min(8, Math.log2(memory.visits + 1) * 2.3);
    const learnedPull = clamp(memory.affinity * 0.13 + memory.confidence * 0.08 - memory.frustration * 0.14, -20, 18);
    return (learnedPull + familiarity * (memory.affinity >= 0 ? 0.9 : 0.25)) * recency;
  }

  private moodletActionBoost(agent: SimAgent, action: SimAgent["currentAction"], context: DecisionContext) {
    return agent.moodlets.reduce((sum, moodlet) => {
      if (moodlet.expiresWorldMinutes <= context.worldMinutes) return sum;
      const minutesLeft = Math.max(0, moodlet.expiresWorldMinutes - context.worldMinutes);
      const fade = clamp(minutesLeft / 180, 0.25, 1);
      return sum + (moodlet.actionBiases[action] ?? 0) * (0.55 + moodlet.intensity * 0.045) * fade;
    }, 0);
  }

  private wantActionBoost(agent: SimAgent, action: SimAgent["currentAction"], context: DecisionContext) {
    return agent.wants.reduce((sum, want) => {
      if (want.status !== "active" || want.expiresWorldMinutes <= context.worldMinutes || !want.actions.includes(action)) return sum;
      const minutesLeft = Math.max(0, want.expiresWorldMinutes - context.worldMinutes);
      const timePressure = clamp(1 - minutesLeft / (want.kind === "fear" ? 420 : 300), 0.24, 1.08);
      const progressGap = clamp((100 - want.progress) / 100, 0.12, 1);
      const kindPressure = want.kind === "fear" ? 0.38 : 0.24;
      return sum + want.intensity * kindPressure * (0.72 + timePressure) * progressGap;
    }, 0);
  }

  private routineRhythmActionBoost(agent: SimAgent, action: SimAgent["currentAction"]) {
    const rhythm = agent.rhythm;
    const low = Math.min(rhythm.work, rhythm.care, rhythm.home, rhythm.social, rhythm.finance);
    const driftPressure = Math.max(0, rhythm.drift - 54) * 0.18 + Math.max(0, 40 - low) * 0.12;
    const momentumLift = Math.max(0, rhythm.momentum - 64) * 0.08 + Math.max(0, rhythm.streak - 1) * 0.8;
    switch (action) {
      case "working":
        return Math.max(0, 54 - rhythm.work) * 0.24 + Math.max(0, 54 - rhythm.finance) * 0.16 + momentumLift * 0.6;
      case "calling_in_sick":
        return Math.max(0, 42 - rhythm.care) * 0.14 + Math.max(0, rhythm.drift - 70) * 0.08;
      case "eating":
      case "washing":
      case "sleeping":
      case "healing":
        return Math.max(0, 56 - rhythm.care) * 0.22 + driftPressure * 0.55;
      case "cleaning":
        return Math.max(0, 58 - rhythm.home) * 0.26 + driftPressure * 0.65;
      case "shopping":
        return Math.max(0, 50 - rhythm.home) * 0.12 + Math.max(0, 52 - rhythm.care) * 0.12;
      case "budgeting":
      case "paying_rent":
      case "checking_mail":
        return Math.max(0, 58 - rhythm.finance) * 0.28 + driftPressure * 0.5;
      case "socializing":
        return Math.max(0, 54 - rhythm.social) * 0.22 + (rhythm.momentum >= 70 ? momentumLift : 0) - Math.max(0, rhythm.drift - 82) * 0.12;
      case "resting":
        return driftPressure * 0.72 + Math.max(0, 46 - rhythm.care) * 0.12;
      case "building":
        return momentumLift * 0.85 - Math.max(0, rhythm.drift - 68) * 0.18 - Math.max(0, 34 - low) * 0.16;
      default:
        return 0;
    }
  }

  private emotionalActionBoost(agent: SimAgent, action: SimAgent["currentAction"]) {
    const emotion = agent.emotion;
    const frayed = Math.max(0, emotion.irritation - 68) * 0.22 + Math.max(0, 38 - emotion.composure) * 0.28;
    const lonely = Math.max(0, emotion.loneliness - 58) * 0.2;
    const capable = Math.max(0, emotion.confidence - 62) * 0.12 + Math.max(0, emotion.hope - 62) * 0.1;
    const lowHope = Math.max(0, 36 - emotion.hope) * 0.16 + Math.max(0, 34 - emotion.confidence) * 0.1;
    switch (action) {
      case "resting":
        return frayed * 1.15 + lowHope * 0.45;
      case "socializing":
        return lonely * 1.2 + capable * 0.42 - Math.max(0, emotion.irritation - 84) * 0.18;
      case "washing":
      case "sleeping":
        return frayed * 0.45 + lowHope * 0.25;
      case "working":
        return capable * 0.72 + lowHope * 0.32 - frayed * 0.3;
      case "budgeting":
      case "checking_mail":
        return frayed * 0.22 + lowHope * 0.28 + Math.max(0, 54 - emotion.confidence) * 0.08;
      case "building":
        return capable * 0.95 - lowHope * 0.42 - frayed * 0.25;
      case "healing":
        return lowHope * 0.3 + frayed * 0.18;
      default:
        return 0;
    }
  }

  private refreshIntention(agent: SimAgent, context: DecisionContext, drive: AgentDriveState, priority: AgentLifePriority) {
    const next = this.intentionFor(agent, context, drive, priority);
    const previous = agent.activeIntention;
    const worldTime = formatTime(context.worldMinutes);
    const changed = previous.id !== next.id;
    const urgencyJump = next.urgency - previous.urgency >= 18;
    const history = changed
      ? [`${worldTime} ${next.label}: ${next.detail}`, ...previous.history].slice(0, 5)
      : previous.history.length > 0
        ? [...previous.history]
        : [`${worldTime} ${next.label}: ${next.detail}`];

    agent.activeIntention = {
      ...next,
      createdWorldTime: changed ? worldTime : previous.createdWorldTime,
      updatedWorldTime: worldTime,
      history
    };

    if (changed && next.urgency >= 46) {
      context.addMemory(agent, "plan", `${next.label}: ${next.reason}`, Math.min(8, 4 + Math.round(next.urgency / 24)), ["intention", ...next.tags]);
    } else if (urgencyJump && next.urgency >= 72) {
      context.addMemory(agent, "reflection", `${next.label} started feeling urgent: ${next.reason}`, 6, ["intention", "urgency", ...next.tags]);
    }
  }

  private intentionFor(agent: SimAgent, context: DecisionContext, drive: AgentDriveState, priority: AgentLifePriority): Omit<AgentIntention, "createdWorldTime" | "updatedWorldTime" | "history"> {
    const billTotal = agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue;
    const liquidFunds = agent.money + agent.budget.savings;
    const highestCommitment = agent.commitments.find((commitment) => commitment.status === "missed" || commitment.status === "due");
    const actionMemory = (action: AgentAction) => agent.activityMemory[action];
    const rememberedConfidence = (actions: AgentAction[]) =>
      actions.reduce((sum, action) => {
        const memory = actionMemory(action);
        return sum + (memory ? memory.confidence * 0.08 - memory.frustration * 0.05 + Math.min(4, memory.visits * 0.45) : 0);
      }, 0);
    const common = {
      reason: `${priority.label.toLowerCase()} because ${priority.detail}`,
      tags: [priority.id, drive.id]
    };
    const option = (
      id: string,
      label: string,
      detail: string,
      horizon: AgentIntention["horizon"],
      urgency: number,
      confidence: number,
      actions: AgentAction[],
      actionBiases: Partial<Record<AgentAction, number>>,
      tags: string[] = [],
      reason = common.reason
    ): Omit<AgentIntention, "createdWorldTime" | "updatedWorldTime" | "history"> => {
      const clampedUrgency = Math.round(clamp(urgency));
      const clampedConfidence = Math.round(clamp(confidence + rememberedConfidence(actions), 8, 96));
      const tone: AgentIntention["tone"] =
        clampedUrgency >= 84 ? "bad" : clampedUrgency >= 62 ? "warn" : horizon === "future" || clampedConfidence >= 70 ? "good" : "neutral";
      return {
        id,
        label,
        detail,
        reason,
        horizon,
        urgency: clampedUrgency,
        confidence: clampedConfidence,
        tone,
        actions,
        actionBiases,
        tags: [...common.tags, ...tags]
      };
    };

    const options: Array<Omit<AgentIntention, "createdWorldTime" | "updatedWorldTime" | "history">> = [];
    const leadNotice = agent.personalNotices
      .filter((notice) => notice.status === "unread" || notice.status === "read")
      .sort((a, b) => {
        const statusWeight = (notice: (typeof agent.personalNotices)[number]) => (notice.status === "unread" ? 8 : 0);
        const deadlineWeight = (notice: (typeof agent.personalNotices)[number]) => Math.max(0, 4 - (notice.dueDay - context.currentDay)) * 3;
        return b.importance + statusWeight(b) + deadlineWeight(b) - (a.importance + statusWeight(a) + deadlineWeight(a));
      })[0];

    if (leadNotice) {
      const urgent = leadNotice.tone === "bad" || leadNotice.tone === "warn" || leadNotice.dueDay <= context.currentDay;
      const noticeActions: AgentAction[] =
        leadNotice.status === "unread" ? [...new Set<AgentAction>(["checking_mail", ...leadNotice.actions])].slice(0, 4) : leadNotice.actions;
      options.push(
        option(
          `personal-notice-${leadNotice.kind}`,
          leadNotice.status === "unread" ? "Read Personal Mail" : leadNotice.label,
          leadNotice.detail,
          urgent ? "now" : "today",
          leadNotice.importance * 8 + (leadNotice.status === "unread" ? 14 : 0) + (urgent ? 12 : 0),
          48 + agent.skills.civic.level * 4 + agent.dna.discipline * 0.08,
          noticeActions,
          Object.fromEntries(noticeActions.map((action) => [action, action === "checking_mail" ? 28 : urgent ? 24 : 14])) as Partial<
            Record<AgentAction, number>
          >,
          ["mail", "personal_notice", ...leadNotice.tags],
          `${leadNotice.source} sent ${leadNotice.label.toLowerCase()}`
        )
      );
    }

    if (agent.lifeAdmin.load >= 44 || agent.lifeAdmin.urgency >= 54) {
      const adminActions = agent.lifeAdmin.suggestedActions.length > 0 ? agent.lifeAdmin.suggestedActions : (["checking_mail", "budgeting"] as AgentAction[]);
      options.push(
        option(
          "handle-life-admin",
          "Handle Life Admin",
          agent.lifeAdmin.nextTask,
          agent.lifeAdmin.urgency >= 72 ? "now" : "today",
          agent.lifeAdmin.urgency + agent.lifeAdmin.load * 0.34,
          44 + agent.skills.civic.level * 3 + agent.skills.homecraft.level * 2 + agent.dna.discipline * 0.1,
          adminActions,
          Object.fromEntries(adminActions.map((action, index) => [action, Math.max(14, 38 - index * 6)])) as Partial<Record<AgentAction, number>>,
          ["life_admin", agent.lifeAdmin.dominantCategory],
          agent.lifeAdmin.detail
        )
      );
    }

    options.push(
      option(
        "health-stabilize",
        "Stabilize Health",
        agent.medical.minorIllness.active
          ? `${agent.medical.minorIllness.label ?? "illness"} is shaping the day`
          : agent.health < 56
            ? `health is down to ${Math.round(agent.health)}`
            : "avoid letting small symptoms turn into a crisis",
        "now",
        (100 - agent.health) * 0.9 + (agent.medical.minorIllness.active ? agent.medical.minorIllness.severity * 0.9 : 0),
        55 + agent.skills.care.level * 5 + agent.dna.discipline * 0.08,
        ["healing", "resting", "sleeping", "washing"],
        { healing: 34, resting: 18, sleeping: 14, washing: 10, working: -20, building: -16, socializing: -10 },
        ["health", "care", "body"],
        agent.medical.minorIllness.active ? "symptoms are visible and treatment is available" : common.reason
      )
    );

    options.push(
      option(
        "food-secure",
        "Secure Food",
        agent.household.pantry > 0 || agent.inventory.some((item) => item === "meal" || item === "groceries")
          ? "food exists at home, so eating is possible"
          : liquidFunds >= 4
            ? "credits can become a meal"
            : "food is needed, but credits are tight",
        "now",
        agent.hunger * 0.95 + (agent.household.pantry <= 0 ? 12 : 0) - (agent.routine.mealsToday > 0 ? 22 : 0),
        54 + agent.skills.homecraft.level * 4 + agent.skills.commerce.level * 2,
        ["eating", "shopping", "working"],
        { eating: 34, shopping: liquidFunds >= 4 ? 30 : -12, working: liquidFunds < 4 ? 18 : -2, socializing: -12, building: -12 },
        ["food", "home", "money"],
        agent.hunger > 76 ? "hunger is high enough to override less urgent plans" : common.reason
      )
    );

    options.push(
      option(
        "clear-obligation",
        "Clear Obligations",
        billTotal > 0
          ? `${billTotal} credits due against ${Math.round(liquidFunds)} liquid credits`
          : agent.budget.creditScore < 560
            ? `credit score ${agent.budget.creditScore} needs repair`
            : "keep civic accounts tidy before problems pile up",
        "today",
        billTotal > 0 ? 44 + billTotal * 1.15 + (liquidFunds >= billTotal ? 14 : 2) : Math.max(0, 600 - agent.budget.creditScore) * 0.16,
        50 + agent.skills.civic.level * 6 + agent.dna.discipline * 0.1,
        ["paying_rent", "budgeting", "checking_mail", "working"],
        { paying_rent: 36, budgeting: 26, checking_mail: 16, working: liquidFunds < billTotal ? 20 : 2, shopping: -12, building: -16, socializing: -8 },
        ["bills", "civic", "money"],
        billTotal > 0 ? "unpaid bills can become stress, debt, and worse credit" : common.reason
      )
    );

    options.push(
      option(
        "earn-stability",
        "Earn Stability",
        agent.routine.workedToday
          ? `already worked, with burnout ${agent.career.burnout}`
          : `${agent.career.title} work can turn time into credits`,
        "today",
        Math.max(0, 24 - agent.money) * 1.8 +
          Math.max(0, agent.budget.savingsGoal - agent.budget.savings) * 0.34 +
          Math.max(0, 620 - agent.budget.creditScore) * 0.05 +
          (agent.routine.workedToday ? -24 : 18) -
          Math.max(0, agent.career.burnout - 62) * 0.5,
        52 + agent.skills.labor.level * 2 + agent.dna.discipline * 0.16 + agent.career.performance * 0.08,
        ["working", "budgeting", "paying_rent"],
        { working: 36, budgeting: 10, paying_rent: billTotal > 0 ? 12 : 0, resting: agent.career.burnout > 70 ? 8 : -8, socializing: -8 },
        ["work", "career", "security"],
        "work is the most reliable path to cash and future options"
      )
    );

    const homeStrain =
      Math.max(0, agent.household.clutter - 56) * 0.42 +
      Math.max(0, agent.household.laundry - 56) * 0.38 +
      Math.max(0, 58 - agent.household.sleepQuality) * 0.35 +
      Math.max(0, 54 - agent.household.homeComfort) * 0.24 +
      Math.max(0, 2 - agent.household.toiletries) * 5.4 +
      Math.max(0, 2 - agent.household.cleaningSupplies) * 5.1;
    options.push(
      option(
        "restore-home",
        "Restore Home Base",
        agent.household.toiletries <= 1 || agent.household.cleaningSupplies <= 1
          ? `toiletries ${agent.household.toiletries}, cleaning ${agent.household.cleaningSupplies}`
          : `clutter ${Math.round(agent.household.clutter)}, laundry ${Math.round(agent.household.laundry)}, sleep quality ${Math.round(agent.household.sleepQuality)}`,
        "today",
        homeStrain + (agent.energy < 36 ? 12 : 0) + (agent.hygiene < 44 ? 10 : 0),
        56 + agent.skills.homecraft.level * 6 + agent.dna.discipline * 0.1,
        ["cleaning", "washing", "shopping", "sleeping", "resting", "eating"],
        {
          cleaning: 32,
          washing: 20,
          shopping: agent.household.toiletries <= 1 || agent.household.cleaningSupplies <= 1 ? 28 : 0,
          sleeping: agent.energy < 40 ? 18 : 6,
          resting: 10,
          eating: agent.hunger > 52 ? 10 : 0,
          working: -10
        },
        ["home", "comfort", "chores"],
        "the apartment is part of the agent's health, sleep, and mood loop"
      )
    );

    options.push(
      option(
        "find-connection",
        "Find Connection",
        agent.socialFocus?.intent === "seek"
          ? `look for ${agent.socialFocus.agentName}`
          : agent.socialFocus?.intent === "avoid"
            ? `avoid ${agent.socialFocus.agentName}`
            : `social need ${Math.round(agent.social)}, warmth ${agent.reputation.warmth}`,
        context.phase === "evening" ? "now" : "today",
        Math.max(0, 74 - agent.social) * 0.46 +
          agent.dna.sociability * 0.24 +
          agent.values.belonging * 0.22 +
          (context.phase === "evening" ? 14 : 0) +
          (agent.socialFocus?.intent === "seek" ? 18 : agent.socialFocus?.intent === "avoid" ? 8 : 0) -
          (billTotal > liquidFunds ? 16 : 0),
        48 + agent.skills.social.level * 7 + agent.dna.empathy * 0.08,
        agent.socialFocus?.intent === "avoid" ? ["resting", "socializing"] : ["socializing", "resting"],
        agent.socialFocus?.intent === "avoid"
          ? { resting: 28, socializing: -20, working: -4 }
          : { socializing: 34, resting: 8, working: agent.money < 8 ? -8 : -4 },
        ["social", "relationship", "belonging"],
        agent.socialFocus?.reason ?? common.reason
      )
    );

    options.push(
      option(
        "pursue-long-game",
        "Pursue Long Game",
        `${agent.aspiration.label}: ${agent.aspiration.milestone}`,
        "future",
        agent.aspiration.pressure * 0.72 +
          agent.values.mastery * 0.18 +
          agent.values.autonomy * 0.16 +
          (liquidFunds > billTotal + 18 ? 10 : -14) +
          (context.phase === "evening" ? 8 : 0),
        44 + agent.dna.risk * 0.12 + agent.dna.discipline * 0.08,
        [...agent.aspiration.actions],
        Object.fromEntries(agent.aspiration.actions.map((action) => [action, action === "building" ? 34 : 22])) as Partial<Record<AgentAction, number>>,
        ["aspiration", "future", agent.aspiration.id],
        agent.aspiration.detail
      )
    );

    if (highestCommitment) {
      options.push(
        option(
          `commitment-${highestCommitment.id}`,
          `Keep ${highestCommitment.label}`,
          `${highestCommitment.detail} Window ${highestCommitment.windowLabel}.`,
          highestCommitment.status === "missed" ? "now" : "today",
          42 + highestCommitment.pressure * 0.7 + (highestCommitment.status === "missed" ? 18 : 0),
          58 + agent.dna.discipline * 0.12,
          [...highestCommitment.actions],
          Object.fromEntries(highestCommitment.actions.map((action) => [action, highestCommitment.status === "missed" ? 38 : 30])) as Partial<
            Record<AgentAction, number>
          >,
          ["commitment", highestCommitment.status],
          `${highestCommitment.label} is ${highestCommitment.status} in the ${highestCommitment.windowLabel} window`
        )
      );
    }

    return options.sort((a, b) => b.urgency - a.urgency || b.confidence - a.confidence)[0] ?? {
      id: "stay-oriented",
      label: "Stay Oriented",
      detail: "watch the day and choose a reasonable next step",
      reason: common.reason,
      horizon: "now",
      urgency: 24,
      confidence: 50,
      tone: "neutral",
      actions: ["resting", "checking_mail"],
      actionBiases: { resting: 6, checking_mail: 4 },
      tags: ["orientation"]
    };
  }

  private intentionActionBoost(agent: SimAgent, action: AgentAction) {
    const intention = agent.activeIntention;
    if (!intention || intention.urgency <= 0) return 0;
    const direct = intention.actionBiases[action] ?? 0;
    const actionFit = intention.actions.includes(action) ? 6 : 0;
    const urgencyScale = clamp(intention.urgency / 100, 0.28, 1.12);
    const confidenceScale = clamp(intention.confidence / 82, 0.55, 1.18);
    return (direct + actionFit) * urgencyScale * confidenceScale;
  }

  private commitmentActionBoost(agent: SimAgent, action: SimAgent["currentAction"], context: DecisionContext) {
    let boost = 0;
    for (const commitment of agent.commitments) {
      if (commitment.status === "done" || !commitment.actions.includes(action)) continue;
      const minutesUntilStart = commitment.startWorldMinutes - context.worldMinutes;
      const minutesUntilDue = commitment.dueWorldMinutes - context.worldMinutes;
      const windowOpen = minutesUntilStart <= 0;
      const soon = Math.max(0, 140 - minutesUntilStart) * 0.045;
      const urgency =
        commitment.status === "missed"
          ? 44
          : commitment.status === "due"
            ? 24 + (minutesUntilDue <= 30 ? 14 : 0)
            : windowOpen
              ? 12
              : soon;
      boost += urgency + commitment.pressure * (windowOpen ? 0.38 : 0.14);
    }
    return boost;
  }

  private aspirationActionBoost(agent: SimAgent, action: SimAgent["currentAction"]) {
    if (!agent.aspiration.actions.includes(action)) return 0;
    const base = agent.aspiration.pressure * 0.16 + Math.max(0, 100 - agent.aspiration.progress) * 0.045;
    const identityFit = agent.lifeProfile.actionBiases[action] ? 3 : 0;
    return base + identityFit;
  }

  private skillActionReadiness(agent: SimAgent, action: SimAgent["currentAction"]) {
    const skillIdByAction: Partial<Record<SimAgent["currentAction"], keyof SimAgent["skills"]>> = {
      working: this.jobSkillFor(agent.job),
      shopping: "commerce",
      socializing: "social",
      healing: "care",
      budgeting: "civic",
      washing: "homecraft",
      cleaning: "homecraft",
      eating: "homecraft",
      sleeping: "homecraft",
      resting: "homecraft",
      checking_mail: "civic",
      paying_rent: "civic",
      building: "labor"
    };
    const skillId = skillIdByAction[action];
    if (!skillId) return 0;
    const skill = agent.skills[skillId];
    return Math.max(0, skill.level - 1) * 2.8 + Math.max(0, skill.aptitude - 58) * 0.08;
  }

  private jobSkillFor(job: string): keyof SimAgent["skills"] {
    const byJob: Record<string, keyof SimAgent["skills"]> = {
      builder: "labor",
      materials_clerk: "labor",
      grocer: "commerce",
      clinician: "care",
      security_officer: "social",
      clerk: "civic"
    };
    return byJob[job] ?? "labor";
  }

  private cityPressure(context: DecisionContext, id: CityPulseMetricId, stableAt: number) {
    const value = context.cityPulse.metrics.find((metric) => metric.id === id)?.value ?? stableAt;
    return Math.max(0, stableAt - value);
  }

  private jobServicePressure(agent: SimAgent, context: DecisionContext) {
    const serviceIdentity = Math.max(0, agent.civic.serviceReputation - 42) * 0.045 + agent.values.care * 0.025 + agent.dna.discipline * 0.015;
    const alreadyServedPenalty = Math.min(8, agent.civic.serviceImpactToday * 0.22);
    const workOrderPull =
      context.cityPulse.workOrders
        .filter((order) => order.requiredJobs.includes(agent.job))
        .slice(0, 3)
        .reduce((sum, order) => sum + order.score * 0.075, 0) + (context.cityPulse.workOrders.some((order) => order.requiredJobs.includes(agent.job)) ? 3 : 0);
    const pressureFor = (id: CityPulseMetricId, stableAt: number, scale: number) => this.cityPressure(context, id, stableAt) * scale + serviceIdentity - alreadyServedPenalty;
    switch (agent.job) {
      case "grocer":
        return pressureFor("food", 72, 0.42) + workOrderPull;
      case "clinician":
        return pressureFor("health", 72, 0.38) + workOrderPull;
      case "clerk":
        return pressureFor("housing", 68, 0.32) + workOrderPull;
      case "security_officer":
        return pressureFor("social", 62, 0.28) + workOrderPull;
      case "builder":
      case "materials_clerk":
        return pressureFor("maintenance", 70, 0.36) + workOrderPull;
      default:
        return 0;
    }
  }

  private careerWorkPressure(agent: SimAgent) {
    const nearPromotion = agent.career.xpToNext > 0 ? agent.career.xp / agent.career.xpToNext : 0;
    const growthPull = nearPromotion > 0.78 ? 12 : nearPromotion > 0.55 ? 5 : 0;
    const satisfactionPull = (agent.career.satisfaction - 50) * 0.08;
    const burnoutPenalty = Math.max(0, agent.career.burnout - 56) * (agent.money < 10 ? 0.12 : 0.42);
    const streakPull = agent.career.attendanceStreak >= 2 ? 4 : 0;
    return growthPull + satisfactionPull + streakPull - burnoutPenalty;
  }

  private activeDriveFor(agent: SimAgent, context: DecisionContext): { info: AgentDriveState; actionBoosts: Partial<Record<SimAgent["currentAction"], number>> } {
    const values = agent.values;
    const billTotal = agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue;
    const liquidFunds = agent.money + agent.budget.savings;
    const maxRelationshipTension = Math.max(0, ...Object.values(agent.relationshipDetails).map((relationship) => relationship.tension));
    const strainedPeople = context.agents.filter(
      (other) =>
        other.id !== agent.id &&
        (other.health < 58 || other.stress > 70 || other.money < 5 || other.hunger > 78 || other.medical.isHospitalized)
    );
    const nearbyStrain = strainedPeople.reduce((total, other) => {
      const distance = distance2d(agent.position, other.position);
      const proximity = distance < 14 ? 1 : distance < 28 ? 0.45 : 0.15;
      const need =
        Math.max(0, 62 - other.health) * 0.18 +
        Math.max(0, other.stress - 62) * 0.14 +
        Math.max(0, 7 - other.money) * 0.9 +
        Math.max(0, other.hunger - 70) * 0.12 +
        (other.medical.isHospitalized ? 8 : 0);
      return total + need * proximity;
    }, 0);
    const cityGap = (id: CityPulseMetricId, stableAt: number) => this.cityPressure(context, id, stableAt);
    const homeStrain =
      Math.max(0, agent.household.clutter - 58) * 0.18 +
      Math.max(0, agent.household.laundry - 58) * 0.16 +
      Math.max(0, 58 - agent.household.sleepQuality) * 0.2 +
      (agent.household.pantry <= 0 ? 6 : 0) +
      Math.max(0, 2 - agent.household.toiletries) * 2.4 +
      Math.max(0, 2 - agent.household.cleaningSupplies) * 2.2;
    const fulfilledCommitments = agent.commitments.filter((commitment) => commitment.status === "done").length;
    const openCommitments = agent.commitments.filter((commitment) => commitment.status !== "done").length;
    const nearPromotion = agent.career.xpToNext > 0 ? agent.career.xp / agent.career.xpToNext : 0;
    const stableEnough = liquidFunds - billTotal > 18 && agent.hunger < 68 && agent.energy > 38 && agent.health > 62;

    const entries: Array<{
      id: AgentDriveId;
      label: string;
      detail: string;
      pressure: number;
      actionBoosts: Partial<Record<SimAgent["currentAction"], number>>;
    }> = [
      {
        id: "security",
        label: "Security",
        detail:
          billTotal > 0
            ? `${billTotal} credits due`
            : agent.money < 12
              ? `${agent.money} credits on hand`
              : agent.budget.creditScore < 560
                ? `credit ${agent.budget.creditScore}`
                : `${Math.round(liquidFunds)} liquid credits`,
        pressure:
          values.security * 0.42 +
          Math.max(0, 16 - agent.money) * 1.9 +
          billTotal * 1.15 +
          Math.max(0, 620 - agent.budget.creditScore) * 0.05 +
          Math.max(0, agent.hunger - 68) * 0.18 +
          Math.max(0, 54 - agent.health) * 0.22 +
          cityGap("housing", 66) * 0.16 +
          cityGap("food", 68) * 0.1,
        actionBoosts: {
          working: 18,
          paying_rent: 24,
          checking_mail: 10,
          budgeting: agent.budget.savings < agent.budget.savingsGoal || agent.budget.creditScore < 560 ? 16 : 4,
          shopping: agent.hunger > 58 ? 14 : -4,
          eating: agent.hunger > 58 ? 10 : 0,
          healing: agent.health < 62 ? 14 : 0,
          building: stableEnough ? 0 : -14,
          socializing: billTotal > liquidFunds ? -9 : -2
        }
      },
      {
        id: "belonging",
        label: "Belonging",
        detail:
          agent.socialFocus?.intent === "seek"
            ? `looking for ${agent.socialFocus.agentName}`
            : maxRelationshipTension > 55
              ? `tension ${Math.round(maxRelationshipTension)}`
              : `social need ${Math.round(agent.social)}`,
        pressure:
          values.belonging * 0.44 +
          Math.max(0, 72 - agent.social) * 0.4 +
          maxRelationshipTension * 0.1 +
          (context.phase === "evening" ? 10 : 0) +
          (agent.routine.bondsToday > 0 ? -12 : 0) +
          cityGap("social", 62) * 0.16,
        actionBoosts: {
          socializing: 26,
          resting: maxRelationshipTension > 62 ? 13 : 6,
          working: agent.money < 10 ? -4 : -9,
          building: -4,
          checking_mail: 2
        }
      },
      {
        id: "mastery",
        label: "Mastery",
        detail:
          nearPromotion > 0.72
            ? `${Math.round(nearPromotion * 100)}% to promotion`
            : agent.aspiration.dailyProgress <= 0
              ? `${agent.aspiration.label} untouched today`
              : `${agent.career.performance} performance`,
        pressure:
          values.mastery * 0.42 +
          agent.aspiration.pressure * 0.18 +
          nearPromotion * 18 +
          Math.max(0, 62 - agent.career.satisfaction) * 0.08 +
          (agent.routine.workedToday ? -10 : 6) +
          cityGap("maintenance", 68) * 0.18,
        actionBoosts: {
          working: 24,
          building: 18,
          checking_mail: agent.aspiration.id === "building" ? 8 : 2,
          resting: agent.career.burnout > 68 ? 6 : -8,
          socializing: -3
        }
      },
      {
        id: "care",
        label: "Care",
        detail:
          strainedPeople.length > 0
            ? `${strainedPeople[0]?.name ?? "someone"} needs help`
            : cityGap("health", 68) > 8
              ? "clinic pressure is rising"
              : "keeping people okay",
        pressure:
          values.care * 0.44 +
          nearbyStrain +
          cityGap("health", 70) * 0.28 +
          cityGap("social", 58) * 0.12 +
          (agent.routine.bondsToday > 0 || agent.routine.medicalVisitToday ? -8 : 0),
        actionBoosts: {
          healing: agent.health < 70 ? 13 : 7,
          socializing: 20,
          working: ["clinician", "security_officer", "clerk", "grocer"].includes(agent.job) ? 13 : 4,
          resting: agent.stress > 70 ? 8 : 0,
          building: -5
        }
      },
      {
        id: "comfort",
        label: "Comfort",
        detail:
          agent.stress > 58
            ? `stress ${Math.round(agent.stress)}`
            : homeStrain > 12
              ? "home needs care"
              : `energy ${Math.round(agent.energy)}`,
        pressure:
          values.comfort * 0.42 +
          agent.stress * 0.24 +
          Math.max(0, 46 - agent.energy) * 0.2 +
          Math.max(0, 42 - agent.mood) * 0.16 +
          homeStrain +
          (agent.routine.sleptToday && agent.routine.washedToday ? -10 : 0),
        actionBoosts: {
          resting: 24,
          sleeping: 26,
          washing: homeStrain > 9 ? 18 : 8,
          cleaning: homeStrain > 9 ? 28 : 6,
          eating: agent.hunger > 52 ? 10 : 3,
          shopping: agent.household.pantry <= 0 ? 8 : -3,
          working: agent.money < 10 ? 0 : -14,
          building: -10
        }
      },
      {
        id: "autonomy",
        label: "Autonomy",
        detail:
          stableEnough
            ? "stable enough to look outward"
            : openCommitments <= fulfilledCommitments
              ? "routine feels handled"
              : "wants more room to choose",
        pressure:
          values.autonomy * 0.42 +
          agent.dna.risk * 0.08 +
          (stableEnough ? 12 : -8) +
          (openCommitments <= fulfilledCommitments ? 8 : 0) +
          (agent.aspiration.id === "building" ? agent.aspiration.pressure * 0.16 : 0) +
          (context.phase === "evening" ? 5 : 0),
        actionBoosts: {
          building: 28,
          resting: 8,
          socializing: context.phase === "evening" ? 8 : 2,
          working: agent.dna.greed > 64 ? 7 : -4,
          checking_mail: agent.aspiration.id === "building" ? 8 : 0
        }
      }
    ];

    const rankedEntries = entries
      .map((entry) => ({
        ...entry,
        pressure: Math.round(clamp(entry.pressure))
      }))
      .sort((a, b) => b.pressure - a.pressure || values[b.id] - values[a.id]);
    const best = rankedEntries[0] ?? {
      id: "security" as const,
      label: "Security",
      detail: "baseline stability",
      pressure: Math.round(clamp(values.security * 0.42)),
      actionBoosts: { working: 8, checking_mail: 4 }
    };
    const actionScale = best.pressure >= 78 ? 1.12 : best.pressure >= 54 ? 0.9 : 0.62;
    const actionBoosts = Object.fromEntries(
      Object.entries(best.actionBoosts).map(([action, boost]) => [action, Math.round((boost ?? 0) * actionScale)])
    ) as Partial<Record<SimAgent["currentAction"], number>>;
    const tone: AgentDriveState["tone"] =
      best.pressure >= 82 ? (best.id === "mastery" || best.id === "autonomy" ? "good" : "bad") : best.pressure >= 58 ? "warn" : "neutral";
    return {
      info: {
        id: best.id,
        label: best.label,
        detail: best.detail,
        value: values[best.id],
        pressure: best.pressure,
        tone
      },
      actionBoosts
    };
  }

  private lifePriorityFor(agent: SimAgent, context: DecisionContext): { info: AgentLifePriority; actionBoosts: Partial<Record<SimAgent["currentAction"], number>> } {
    const billTotal = agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue;
    const liquidFunds = agent.money + agent.budget.savings;
    const liquidAfterBills = liquidFunds - billTotal;
    const hasStoredFood = agent.household.pantry > 0 || agent.inventory.some((item) => item === "meal" || item === "groceries");
    const canBuyFood = liquidFunds >= 4;
    const urgentCommitment = agent.commitments.find((commitment) => commitment.status === "missed" || commitment.status === "due");
    const homeNeedsCare = agent.household.clutter > 76 || agent.household.laundry > 76 || agent.household.sleepQuality < 38;
    const homeNeedsSupplies = agent.household.toiletries <= 1 || agent.household.cleaningSupplies <= 1;

    const seriousMinorIllness = agent.medical.minorIllness.active && agent.medical.minorIllness.severity >= 54;

    if (agent.medical.isHospitalized || agent.health < 42 || seriousMinorIllness) {
      return {
        info: {
          id: "health-safety",
          label: "Health Safety",
          detail: agent.medical.isHospitalized
            ? "recovering before anything else"
            : seriousMinorIllness
              ? `${agent.medical.minorIllness.label ?? "illness"} severity ${Math.round(agent.medical.minorIllness.severity)}`
              : `health is ${agent.health.toFixed(0)}`,
          tone: "bad"
        },
        actionBoosts: { healing: seriousMinorIllness ? 78 : 70, sleeping: 30, resting: 34, washing: 18, working: -34, socializing: -24, building: -28 }
      };
    }

    if (agent.hunger > 78) {
      return {
        info: {
          id: "food-security",
          label: "Find Food",
          detail: hasStoredFood ? "food is at home" : canBuyFood ? "buy a meal before hunger spirals" : "needs credits before buying food",
          tone: agent.hunger > 88 ? "bad" : "warn"
        },
        actionBoosts: {
          eating: hasStoredFood ? 62 : 14,
          shopping: canBuyFood ? 56 : -18,
          working: canBuyFood ? -12 : 26,
          resting: -8,
          socializing: -22,
          building: -18
        }
      };
    }

    if (agent.energy < 26) {
      return {
        info: {
          id: "energy-recovery",
          label: "Recover Energy",
          detail: `energy is ${agent.energy.toFixed(0)}`,
          tone: "warn"
        },
        actionBoosts: { sleeping: 58, resting: 34, working: -28, socializing: -10, building: -18 }
      };
    }

    if ((agent.sleep.sleepDebt > 72 || agent.sleep.circadianFatigue > 76 || (context.phase === "night" && !agent.routine.sleptToday && agent.sleep.sleepDebt > 42)) && liquidFunds >= billTotal) {
      return {
        info: {
          id: "sleep-rhythm",
          label: "Sleep Rhythm",
          detail: `debt ${Math.round(agent.sleep.sleepDebt)}, rhythm ${Math.round(agent.sleep.circadianFatigue)}`,
          tone: agent.sleep.sleepDebt > 84 || agent.sleep.circadianFatigue > 86 ? "bad" : "warn"
        },
        actionBoosts: {
          sleeping: context.phase === "night" ? 124 : 104,
          resting: 36,
          cleaning: agent.household.sleepQuality < 58 ? 28 : 4,
          working: agent.money < 10 ? 4 : -42,
          socializing: -28,
          building: -52
        }
      };
    }

    if (agent.career.burnout > 76 && agent.money >= 10 && billTotal <= liquidFunds) {
      return {
        info: {
          id: "burnout-recovery",
          label: "Recover From Burnout",
          detail: `${agent.career.burnout} work strain after ${agent.career.attendanceStreak} shift streak`,
          tone: "warn"
        },
        actionBoosts: { resting: 50, sleeping: 36, socializing: agent.social < 52 ? 12 : 4, working: -44, building: -16 }
      };
    }

    if ((agent.autonomy.overwhelm > 80 || agent.autonomy.control < 26) && liquidFunds >= billTotal && agent.hunger < 78 && agent.energy > 22) {
      return {
        info: {
          id: "regain-control",
          label: "Regain Control",
          detail: `control ${Math.round(agent.autonomy.control)}, overwhelm ${Math.round(agent.autonomy.overwhelm)}`,
          tone: agent.autonomy.overwhelm > 88 || agent.autonomy.control < 18 ? "bad" : "warn"
        },
        actionBoosts: {
          resting: 58,
          budgeting: billTotal > 0 || agent.budget.spentToday > agent.budget.dailySpendLimit ? 44 : 28,
          cleaning: agent.household.clutter > 42 || agent.household.laundry > 50 ? 42 : 20,
          checking_mail: agent.routine.checkedMailToday ? -4 : 20,
          washing: agent.hygiene < 64 || agent.outfit.confidence < 50 ? 24 : 8,
          working: agent.money < 8 ? 8 : -34,
          socializing: agent.socialFocus?.intent === "seek" ? 4 : -14,
          building: -24
        }
      };
    }

    if (agent.autonomy.dignity < 30 && agent.energy > 18 && agent.hunger < 84) {
      return {
        info: {
          id: "restore-dignity",
          label: "Restore Dignity",
          detail: `dignity ${Math.round(agent.autonomy.dignity)} with hygiene ${Math.round(agent.hygiene)}`,
          tone: "warn"
        },
        actionBoosts: {
          washing: 54,
          cleaning: agent.household.clutter > 52 || agent.household.laundry > 52 ? 42 : 18,
          paying_rent: billTotal > 0 && liquidFunds > 0 ? 28 : 4,
          budgeting: billTotal > 0 ? 22 : 10,
          socializing: agent.social > 36 ? 12 : 4,
          resting: 18,
          working: agent.money < 8 ? 12 : -12,
          building: -14
        }
      };
    }

    if ((agent.emotion.irritation > 86 || agent.emotion.composure < 24) && liquidFunds >= billTotal && agent.hunger < 82 && agent.energy > 18) {
      return {
        info: {
          id: "regain-composure",
          label: "Regain Composure",
          detail: `composure ${Math.round(agent.emotion.composure)}, irritation ${Math.round(agent.emotion.irritation)}`,
          tone: agent.emotion.irritation > 92 || agent.emotion.composure < 16 ? "bad" : "warn"
        },
        actionBoosts: {
          resting: 62,
          washing: 36,
          sleeping: 28,
          socializing: agent.emotion.irritation > 88 ? -14 : 14,
          budgeting: billTotal > 0 ? 12 : 4,
          working: agent.money < 8 ? 8 : -30,
          building: -26
        }
      };
    }

    if (agent.emotion.loneliness > 86 && context.phase !== "night" && agent.energy > 18 && agent.hunger < 84) {
      return {
        info: {
          id: "find-connection",
          label: "Find Connection",
          detail: `loneliness ${Math.round(agent.emotion.loneliness)}, social need ${Math.round(agent.social)}`,
          tone: "warn"
        },
        actionBoosts: {
          socializing: 66,
          resting: 18,
          checking_mail: agent.routine.checkedMailToday ? -4 : 10,
          shopping: agent.hunger > 58 && liquidFunds >= 4 ? 12 : 0,
          working: billTotal > liquidFunds || agent.money < 8 ? 10 : -10,
          building: -8
        }
      };
    }

    if (agent.emotion.hope < 22 && agent.health > 42 && agent.hunger < 78 && agent.energy > 18) {
      return {
        info: {
          id: "restore-hope",
          label: "Restore Hope",
          detail: `hope ${Math.round(agent.emotion.hope)}, confidence ${Math.round(agent.emotion.confidence)}`,
          tone: "bad"
        },
        actionBoosts: {
          resting: 44,
          socializing: agent.emotion.loneliness > 58 ? 40 : 28,
          building: agent.leisure.curiosity > 54 ? 24 : 10,
          budgeting: billTotal > 0 || agent.budget.creditScore < 560 ? 22 : 12,
          working: liquidAfterBills < 8 ? 18 : 8,
          checking_mail: agent.routine.checkedMailToday ? -6 : 8
        }
      };
    }

    if ((agent.socialCompass.supportOwed >= 4 || agent.socialCompass.tension >= 74) && agent.hunger < 82 && agent.energy > 18) {
      const owesSupport = agent.socialCompass.supportOwed >= 4;
      return {
        info: {
          id: "repair-social-strain",
          label: owesSupport ? "Repair Support Debt" : "Ease Social Tension",
          detail: owesSupport
            ? `${agent.socialCompass.supportOwed} support owed${agent.socialCompass.concernName ? ` to ${agent.socialCompass.concernName}` : ""}`
            : `${agent.socialCompass.tension} social tension${agent.socialCompass.concernName ? ` around ${agent.socialCompass.concernName}` : ""}`,
          tone: agent.socialCompass.supportOwed >= 7 || agent.socialCompass.tension >= 84 ? "bad" : "warn"
        },
        actionBoosts: {
          socializing: owesSupport ? 68 : agent.socialCompass.stance === "guarded" ? 18 : 54,
          budgeting: owesSupport ? 24 : 8,
          working: owesSupport && agent.money < agent.budget.dailySpendLimit + 6 ? 28 : agent.money < 8 ? 10 : -4,
          resting: agent.socialCompass.tension >= 78 ? 26 : 8,
          building: -18
        }
      };
    }

    if (urgentCommitment && urgentCommitment.status === "missed") {
      const actionBoosts = Object.fromEntries(urgentCommitment.actions.map((action) => [action, 52])) as Partial<Record<SimAgent["currentAction"], number>>;
      if (urgentCommitment.actions.includes("working")) actionBoosts.working = 68;
      if (urgentCommitment.actions.includes("paying_rent")) actionBoosts.paying_rent = 68;
      return {
        info: {
          id: "missed-commitment",
          label: "Recover Commitment",
          detail: `${urgentCommitment.label} slipped after ${urgentCommitment.windowLabel}`,
          tone: "warn"
        },
        actionBoosts: { ...actionBoosts, socializing: urgentCommitment.actions.includes("socializing") ? actionBoosts.socializing : -8, building: -14 }
      };
    }

    if (urgentCommitment && urgentCommitment.status === "due" && urgentCommitment.pressure >= 35) {
      const actionBoosts = Object.fromEntries(urgentCommitment.actions.map((action) => [action, 58])) as Partial<Record<SimAgent["currentAction"], number>>;
      return {
        info: {
          id: "due-commitment",
          label: "Keep Commitment",
          detail: `${urgentCommitment.label} during ${urgentCommitment.windowLabel}`,
          tone: urgentCommitment.tone === "bad" ? "bad" : "warn"
        },
        actionBoosts: { ...actionBoosts, building: -10 }
      };
    }

    if ((agent.lifeAdmin.load >= 62 || agent.lifeAdmin.urgency >= 70) && agent.hunger < 82 && agent.energy > 18) {
      const adminActions = agent.lifeAdmin.suggestedActions.length > 0 ? agent.lifeAdmin.suggestedActions : (["checking_mail", "budgeting"] as AgentAction[]);
      const actionBoosts = Object.fromEntries(adminActions.map((action, index) => [action, Math.max(18, 58 - index * 8)])) as Partial<
        Record<SimAgent["currentAction"], number>
      >;
      if (!adminActions.includes("socializing")) actionBoosts.socializing = agent.lifeAdmin.dominantCategory === "paperwork" ? -4 : -10;
      if (!adminActions.includes("building")) actionBoosts.building = -16;
      if (agent.lifeAdmin.dominantCategory === "money" && billTotal > 0) actionBoosts.paying_rent = Math.max(actionBoosts.paying_rent ?? 0, 62);
      return {
        info: {
          id: "life-admin",
          label: "Handle Life Admin",
          detail: agent.lifeAdmin.detail,
          tone: agent.lifeAdmin.urgency >= 82 ? "bad" : "warn"
        },
        actionBoosts
      };
    }

    const weakestRhythmScore = Math.min(agent.rhythm.work, agent.rhythm.care, agent.rhythm.home, agent.rhythm.social, agent.rhythm.finance);
    if (agent.rhythm.drift > 78 || (weakestRhythmScore < 30 && agent.hunger < 82 && agent.energy > 18)) {
      const actionBoosts: Partial<Record<SimAgent["currentAction"], number>> = {
        resting: 24,
        budgeting: agent.rhythm.finance < 42 ? 48 : 20,
        cleaning: agent.rhythm.home < 42 ? 46 : 18,
        washing: agent.rhythm.care < 42 ? 38 : 12,
        eating: agent.rhythm.care < 38 ? 24 : 6,
        sleeping: agent.rhythm.care < 36 ? 26 : 10,
        socializing: agent.rhythm.social < 38 ? 28 : -8,
        working: agent.rhythm.work < 38 || agent.rhythm.finance < 36 ? 30 : -8,
        building: -24
      };
      return {
        info: {
          id: "stabilize-rhythm",
          label: "Stabilize Routine",
          detail: `${agent.rhythm.identity}: drift ${agent.rhythm.drift}, weakest ${Math.round(weakestRhythmScore)}`,
          tone: agent.rhythm.drift > 84 || weakestRhythmScore < 24 ? "bad" : "warn"
        },
        actionBoosts
      };
    }

    if (agent.time.rush > 84 && liquidFunds >= billTotal && agent.hunger < 78 && agent.energy > 22) {
      return {
        info: {
          id: "time-pressure",
          label: "Lower Time Pressure",
          detail: `rush ${Math.round(agent.time.rush)}, punctuality ${Math.round(agent.time.punctuality)}`,
          tone: "warn"
        },
        actionBoosts: {
          resting: 46,
          budgeting: billTotal > 0 || agent.budget.spentToday > agent.budget.dailySpendLimit ? 38 : 22,
          checking_mail: agent.routine.checkedMailToday ? -4 : 18,
          cleaning: agent.household.clutter > 58 || agent.household.laundry > 58 ? 18 : 4,
          washing: agent.hygiene < 52 ? 18 : 4,
          working: agent.money < 8 ? 8 : -20,
          socializing: agent.socialFocus?.intent === "seek" ? 8 : -10,
          building: -18
        }
      };
    }

    if (billTotal > 0 && liquidFunds >= Math.min(billTotal, Math.max(agent.rentDue, agent.medicalDebt, agent.budget.livingCostDue))) {
      return {
        info: {
          id: "pay-obligations",
          label: "Pay Bills",
          detail: `${billTotal} credits due, ${Math.round(liquidFunds)} liquid`,
          tone: "warn"
        },
        actionBoosts: { paying_rent: 68, checking_mail: 14, working: 12, socializing: -12, building: -18 }
      };
    }

    if (liquidAfterBills < 8 || agent.money < 12) {
      return {
        info: {
          id: "cashflow",
          label: "Earn Credits",
          detail: liquidAfterBills < 0 ? `${Math.abs(Math.round(liquidAfterBills))} credits short after bills` : `${agent.money} credits on hand`,
          tone: liquidAfterBills < 0 ? "bad" : "warn"
        },
        actionBoosts: { working: 62, paying_rent: billTotal > 0 ? 10 : 0, shopping: agent.hunger > 68 ? 2 : -18, socializing: -16, building: -20 }
      };
    }

    if ((agent.leisure.boredom > 78 || agent.leisure.fun < 28) && liquidFunds >= billTotal && agent.hunger < 76 && agent.energy > 28) {
      return {
        info: {
          id: "needs-spark",
          label: "Needs Spark",
          detail: `fun ${Math.round(agent.leisure.fun)}, boredom ${Math.round(agent.leisure.boredom)}`,
          tone: agent.leisure.fun < 20 || agent.leisure.boredom > 88 ? "warn" : "neutral"
        },
        actionBoosts: {
          resting: agent.leisure.hobby === "reading" || agent.leisure.hobby === "games" || agent.leisure.hobby === "fitness" ? 48 : 28,
          socializing: agent.leisure.hobby === "people_watching" || agent.leisure.hobby === "music" ? 42 : 24,
          building: agent.leisure.hobby === "crafting" || agent.leisure.curiosity > 72 ? 30 : 8,
          working: agent.money < 10 ? 8 : -18,
          budgeting: billTotal > 0 ? 8 : -8
        }
      };
    }

    if (agent.leisure.curiosity > 84 && agent.energy > 42 && agent.hunger < 66 && liquidFunds >= billTotal) {
      return {
        info: {
          id: "curiosity",
          label: "Follow Curiosity",
          detail: `${agent.leisure.hobby.replace(/_/g, " ")} idea is pulling`,
          tone: "neutral"
        },
        actionBoosts: { building: agent.leisure.hobby === "crafting" ? 46 : 34, socializing: 16, resting: 12, working: agent.money < 10 ? 8 : -8 }
      };
    }

    if (agent.budget.creditScore < 540 || (agent.budget.savings < agent.budget.savingsGoal * 0.35 && agent.money > 8)) {
      return {
        info: {
          id: "financial-repair",
          label: agent.budget.creditScore < 540 ? "Repair Credit" : "Build Savings",
          detail:
            agent.budget.creditScore < 540
              ? `credit ${agent.budget.creditScore}, ${agent.budget.missedBillCount} missed bill${agent.budget.missedBillCount === 1 ? "" : "s"}`
              : `${agent.budget.savings}/${agent.budget.savingsGoal} saved`,
          tone: agent.budget.creditScore < 500 ? "bad" : "warn"
        },
        actionBoosts: { working: 42, budgeting: 48, paying_rent: billTotal > 0 ? 36 : 8, checking_mail: 10, shopping: -18, building: -22, socializing: -10 }
      };
    }

    if (agent.stress > 72 || agent.mood < 28) {
      return {
        info: {
          id: "stabilize-mood",
          label: "Stabilize Mood",
          detail: agent.stress > 72 ? `stress is ${agent.stress.toFixed(0)}` : `mood is ${agent.mood.toFixed(0)}`,
          tone: "warn"
        },
        actionBoosts: { resting: 48, socializing: agent.social > 38 ? 12 : 24, sleeping: 14, working: -16, building: -10 }
      };
    }

    if (homeNeedsCare || homeNeedsSupplies || (agent.household.pantry <= 0 && canBuyFood && agent.hunger > 46)) {
      const detail =
        agent.household.pantry <= 0 && agent.hunger > 46
          ? "pantry is empty"
          : homeNeedsSupplies
            ? `supplies are ${agent.household.toiletries}/${agent.household.cleaningSupplies}`
          : agent.household.laundry > agent.household.clutter
            ? `laundry is ${Math.round(agent.household.laundry)}`
            : agent.household.sleepQuality < 38
              ? `sleep quality is ${Math.round(agent.household.sleepQuality)}`
              : `clutter is ${Math.round(agent.household.clutter)}`;
      return {
        info: {
          id: "home-care",
          label: "Handle Home",
          detail,
          tone: homeNeedsCare || homeNeedsSupplies ? "warn" : "neutral"
        },
        actionBoosts: {
          cleaning: homeNeedsCare ? 60 : 12,
          washing: homeNeedsCare ? 54 : 18,
          shopping: homeNeedsSupplies ? 44 : agent.household.pantry <= 0 && canBuyFood ? 40 : 0,
          eating: hasStoredFood && agent.hunger > 50 ? 24 : 0,
          sleeping: agent.household.sleepQuality < 42 ? 26 : 6,
          working: agent.money < 10 ? 10 : -8,
          socializing: -6,
          building: -12
        }
      };
    }

    if (agent.social < 32 && agent.dna.sociability > 52) {
      return {
        info: {
          id: "connection",
          label: "Find People",
          detail: `social need is ${agent.social.toFixed(0)}`,
          tone: "neutral"
        },
        actionBoosts: { socializing: 46, resting: 8, working: -8 }
      };
    }

    if (agent.aspiration.pressure >= 58 && agent.aspiration.dailyProgress < 4) {
      const actionBoosts = Object.fromEntries(agent.aspiration.actions.map((action) => [action, 36])) as Partial<Record<SimAgent["currentAction"], number>>;
      if (agent.aspiration.actions.includes("working")) actionBoosts.working = Math.max(actionBoosts.working ?? 0, 44);
      if (agent.aspiration.actions.includes("socializing") && context.phase === "evening") actionBoosts.socializing = Math.max(actionBoosts.socializing ?? 0, 46);
      return {
        info: {
          id: "life-aspiration",
          label: agent.aspiration.label,
          detail: agent.aspiration.milestone,
          tone: agent.aspiration.tone === "bad" ? "bad" : "warn"
        },
        actionBoosts: { ...actionBoosts, building: agent.aspiration.actions.includes("building") ? actionBoosts.building : -8 }
      };
    }

    if ((context.phase === "evening" || liquidFunds > 30) && agent.health > 65 && agent.energy > 42 && agent.hunger < 68) {
      return {
        info: {
          id: "future-growth",
          label: "Future Growth",
          detail: liquidFunds > 30 ? "stable enough to look ahead" : "evening is open for ideas",
          tone: "good"
        },
        actionBoosts: { building: 28, socializing: context.phase === "evening" ? 12 : 0, working: agent.dna.greed > 64 ? 10 : -6 }
      };
    }

    return {
      info: {
        id: "balanced-day",
        label: "Stay Balanced",
        detail: "needs, money, and mood are manageable",
        tone: "neutral"
      },
      actionBoosts: {
        working: agent.routine.workedToday ? -4 : 8,
        budgeting: agent.budget.savedToday > 0 ? -8 : agent.money > agent.budget.dailySpendLimit + agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue ? 6 : 0,
        checking_mail: agent.routine.checkedMailToday ? -6 : 6,
        socializing: context.phase === "evening" ? 10 : 0
      }
    };
  }

  private findTarget(
    agent: SimAgent,
    structures: StructureMetadata[],
    actionTypes: ActionPoint["type"][],
    action: SimAgent["currentAction"],
    context: DecisionContext,
    structureTypes?: StructureMetadata["type"][]
  ): TargetPoint | null {
    let best: TargetPoint | null = null;
    let bestScore = -Infinity;
    for (const structure of structures) {
      if (structureTypes && !structureTypes.includes(structure.type)) continue;
      for (const point of structure.actionPoints) {
        if (!actionTypes.includes(point.type)) continue;
        if (!this.isOpenForAction(agent, structure, point, action, context)) continue;
        const score = this.scoreTarget(agent, structure, point, actionTypes, action, context);
        if (score <= bestScore) continue;
        bestScore = score;
        best = { point, structure, action };
      }
    }
    return best;
  }

  private findJobTarget(agent: SimAgent, structures: StructureMetadata[], context: DecisionContext): TargetPoint | null {
    const byJob: Record<string, ActionPoint["type"][]> = {
      builder: ["workbench", "storage", "job_station", "locker"],
      materials_clerk: ["storage", "job_station", "locker"],
      grocer: ["shelf", "register", "vending_machine"],
      clinician: ["medicine_cabinet", "clinic_bed", "desk"],
      security_officer: ["desk", "storage"],
      clerk: ["mailbox", "notice_board", "desk"]
    };
    const jobActionTypes = byJob[agent.job] ?? ["job_station", "desk", "register"];
    const matchingStructures = structures.filter((structure) => structure.jobs?.some((job) => job.id === agent.job));
    return this.findTarget(agent, matchingStructures.length > 0 ? matchingStructures : structures, jobActionTypes, "working", context);
  }

  private scoreTarget(
    agent: SimAgent,
    structure: StructureMetadata,
    point: ActionPoint,
    actionTypes: ActionPoint["type"][],
    action: SimAgent["currentAction"],
    context: DecisionContext
  ) {
    const typeIndex = actionTypes.indexOf(point.type);
    const typeScore = (actionTypes.length - typeIndex) * 36;
    const target = worldPoint(point.position);
    const distancePenalty = distance2d(agent.position, target) * (action === "resting" || action === "checking_mail" || action === "budgeting" ? 0.48 : 0.28);
    const homeBoost = structure.name === agent.home ? 32 : structure.tags.includes("home") && ["sleeping", "eating", "washing", "cleaning"].includes(action) ? 12 : 0;
    const jobBoost = structure.jobs?.some((job) => job.id === agent.job) ? 34 : 0;
    const quietBoost = action === "resting" && point.type === "seat" && agent.socialFocus?.intent === "avoid" ? 18 : 0;
    const loadPenalty = this.targetLoad(agent, point.id, context.agents) * (action === "socializing" ? 4 : 22);
    const objectState = context.objectStates.peek(structure.id, point.id);
    const objectNeed = objectState ? this.objectServiceNeed(objectState) : 0;
    const workOrderBoost = action === "working" ? this.workOrderTargetBoost(agent, structure.id, point.id, context) : 0;
    const objectPenalty =
      objectState && action !== "working"
        ? objectState.heat * (action === "socializing" ? 0.04 : 0.08) +
          objectState.crowdPressure * (action === "socializing" ? 0.03 : 0.13) +
          objectState.wear * 0.04 +
          Math.max(0, 42 - objectState.cleanliness) * 0.1 +
          (objectState.stock !== undefined && objectState.stock <= 0 ? 32 : 0) +
          objectState.servicePressure * 0.08 +
          objectState.unmetDemand * 0.7
        : 0;
    const workNeedBoost = action === "working" ? objectNeed : 0;
    const placeMemoryBoost = this.placeMemoryTargetBoost(agent, structure.id, action, context);
    const preference = randomFromHash(hashText(`${agent.id}:${action}:${point.id}`), 1) * 10;
    const closingPenalty = this.minutesUntilClose(structure, context) <= 45 ? 8 : 0;
    return typeScore + homeBoost + jobBoost + quietBoost + preference + workNeedBoost + workOrderBoost + placeMemoryBoost - distancePenalty - loadPenalty - objectPenalty - closingPenalty;
  }

  private workOrderTargetBoost(agent: SimAgent, structureId: string, actionPointId: string, context: DecisionContext) {
    const order = context.cityPulse.workOrders.find((candidate) => candidate.structureId === structureId && candidate.actionPointId === actionPointId);
    if (!order || !order.requiredJobs.includes(agent.job)) return 0;
    const identity = Math.max(0, agent.civic.serviceReputation - 42) * 0.05 + agent.values.care * 0.035;
    return order.score * 0.72 + identity;
  }

  private placeMemoryTargetBoost(agent: SimAgent, structureId: string, action: SimAgent["currentAction"], context: DecisionContext) {
    const place = agent.placeMemory[structureId];
    if (!place) return 0;
    const ageMinutes = Math.max(1, context.worldMinutes - place.lastVisitedWorldMinutes);
    const recency = clamp(1 - ageMinutes / (1440 * 5), 0.18, 1);
    const actionMatch = place.tags.includes(action) || place.lastAction === action ? 1.18 : 0.78;
    const familiarity = Math.min(7, Math.log2(place.visits + 1) * 2.2);
    const affinity = clamp(place.affinity * 0.11 + place.trust * 0.06 - place.frustration * 0.12, -18, 16);
    const returnToComfort = action === "resting" || action === "socializing" || action === "shopping" || action === "healing" ? familiarity : familiarity * 0.45;
    return (affinity + returnToComfort) * recency * actionMatch;
  }

  private objectServiceNeed(objectState: ReturnType<ObjectStateSystem["peek"]>) {
    if (!objectState) return 0;
    const stockNeed =
      objectState.stock !== undefined && objectState.capacity !== undefined ? Math.max(0, objectState.capacity - objectState.stock) * 2.8 : 0;
    const cleanNeed = Math.max(0, 76 - objectState.cleanliness) * 0.18;
    const wearNeed = objectState.wear * 0.12;
    const heatNeed = objectState.heat * 0.07;
    const crowdNeed = objectState.crowdPressure * 0.04;
    const demandNeed = objectState.unmetDemand * 4.6;
    const pressureNeed = objectState.servicePressure * 0.5;
    return stockNeed + cleanNeed + wearNeed + heatNeed + crowdNeed + demandNeed + pressureNeed;
  }

  private isOpenForAction(
    agent: SimAgent,
    structure: StructureMetadata,
    point: ActionPoint,
    action: SimAgent["currentAction"],
    context: DecisionContext
  ) {
    if (action === "hospitalized") return true;
    if (structure.type === "apartment" || structure.tags.includes("home")) return true;
    if (structure.type === "police_station" || structure.type === "guard_post") return true;
    if (action === "healing" && agent.health < 34) return true;

    const windows = structure.hours;
    if (!windows || windows.length === 0) return true;
    return windows.some((window) => {
      if (window.actionTypes && !window.actionTypes.includes(point.type)) return false;
      return this.isMinuteInsideWindow(context.worldMinutes, window.opensAt, window.closesAt);
    });
  }

  private minutesUntilClose(structure: StructureMetadata, context: DecisionContext) {
    const windows = structure.hours;
    if (!windows || windows.length === 0) return Number.POSITIVE_INFINITY;
    const now = this.minuteOfDay(context.worldMinutes);
    let soonest = Number.POSITIVE_INFINITY;
    for (const window of windows) {
      if (!this.isMinuteInsideWindow(context.worldMinutes, window.opensAt, window.closesAt)) continue;
      const close = this.normalizedMinute(window.closesAt);
      const remaining = close >= now ? close - now : 1440 - now + close;
      soonest = Math.min(soonest, remaining);
    }
    return soonest;
  }

  private hoursLabel(structure: StructureMetadata) {
    return structure.hours?.map((window) => window.label).join(" / ");
  }

  private isMinuteInsideWindow(worldMinutes: number, opensAt: number, closesAt: number) {
    const now = this.minuteOfDay(worldMinutes);
    const open = this.normalizedMinute(opensAt);
    const close = this.normalizedMinute(closesAt);
    if (open === close) return true;
    if (open < close) return now >= open && now < close;
    return now >= open || now < close;
  }

  private minuteOfDay(worldMinutes: number) {
    return this.normalizedMinute(worldMinutes);
  }

  private normalizedMinute(minutes: number) {
    return ((Math.floor(minutes) % 1440) + 1440) % 1440;
  }

  private targetLoad(agent: SimAgent, actionPointId: string, agents: readonly SimAgent[]) {
    let load = 0;
    for (const other of agents) {
      if (other.id === agent.id) continue;
      if (other.target?.actionPointId === actionPointId) load += 1;
    }
    return load;
  }
}
