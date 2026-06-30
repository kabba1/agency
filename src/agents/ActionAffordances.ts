import type { ActionPoint, StructureMetadata } from "../shared/types";
import type { AgentAction, AgentEveningPlan, AgentSocialFocus, DayPhase, SimAgent, WeatherState } from "./AgentSimulation";
import type { Candidate } from "./SimulationPrimitives";

export type AgentActionOptionTone = "neutral" | "good" | "warn" | "bad";

export type AgentActionIntent = {
  kind: "home" | "food" | "work" | "civic" | "health" | "social" | "rest" | "build";
  strategy: string;
  label: string;
  amount?: number;
  billType?: "rent" | "medical" | "living" | "none";
  paymentSource?: "cash" | "savings" | "liquid" | "none";
  savingsAllowed?: boolean;
  preserveCash?: number;
};

export type AgentActionOption = {
  id: string;
  label: string;
  action: AgentAction;
  intent?: AgentActionIntent;
  location: string;
  utility: number;
  reason: string;
  plan: string[];
  selected: boolean;
  tone: AgentActionOptionTone;
  tags: string[];
};

export type AffordanceSignals = {
  phase: DayPhase;
  worldMinutes: number;
  weather: WeatherState;
  socialFocus: AgentSocialFocus;
  eveningPlan: AgentEveningPlan | null;
  liquidFunds: number;
  moneyPressure: number;
  foodMemory: number;
  workMemory: number;
  socialMemory: number;
  savingsGap: number;
  creditRepairPressure: number;
  civicObligationPressure: number;
  workedPenalty: number;
  atePenalty: number;
  socialPenalty: number;
  mailPenalty: number;
  seekBoost: number;
  avoidSocialPenalty: number;
  avoidRestBoost: number;
  eveningSocialBoost: number;
  eveningQuietBoost: number;
  eveningQuietPenalty: number;
  foodPressure: number;
  healthPressure: number;
  illnessPressure: number;
  housingPressure: number;
  socialPressure: number;
  upkeepPressure: number;
  discretionaryPenalty: number;
};

export type SemanticActionAffordance = {
  id: string;
  label: string;
  action: AgentAction;
  pointTypes: ActionPoint["type"][];
  structureTypes?: StructureMetadata["type"][];
  targetMode?: "semantic" | "job";
  utility: number;
  goal: string;
  reason: string;
  plan: string[];
  intent?: AgentActionIntent;
  socialFocus?: AgentSocialFocus;
  tone: AgentActionOptionTone;
  tags: string[];
};

export const buildActionAffordances = (agent: SimAgent, signals: AffordanceSignals): SemanticActionAffordance[] => {
  const eveningPlan = signals.eveningPlan;
  const storedFoodCount = agent.inventory.filter((item) => item === "meal" || item === "groceries").length + agent.household.pantry;
  const pantryPressure = agent.household.pantry <= 0 ? 18 : agent.household.pantry <= 1 ? 9 : 0;
  const householdSupplyPressure = Math.max(0, 2 - agent.household.toiletries) * 8 + Math.max(0, 2 - agent.household.cleaningSupplies) * 7;
  const householdChorePressure = Math.max(0, agent.household.clutter - 58) * 0.22 + Math.max(0, agent.household.laundry - 58) * 0.28;
  const sleepQualityPressure = Math.max(0, 64 - agent.household.sleepQuality) * 0.22;
  const sleepRhythmPressure = Math.max(0, agent.sleep.sleepDebt - 38) * 0.72 + Math.max(0, agent.sleep.circadianFatigue - 42) * 0.64;
  const homeUpkeepPressure = householdChorePressure + sleepQualityPressure + Math.max(0, 58 - agent.household.homeComfort) * 0.18;
  const hydrationPressure = Math.max(0, 58 - agent.nutrition.hydration) * 0.34;
  const nutritionPressure = Math.max(0, 54 - agent.nutrition.quality) * 0.28 + Math.max(0, 48 - agent.nutrition.variety) * 0.22;
  const leisurePressure =
    Math.max(0, agent.leisure.boredom - 52) * 0.42 + Math.max(0, 48 - agent.leisure.fun) * 0.36 + Math.max(0, agent.leisure.curiosity - 70) * 0.22;
  const autonomyPressure =
    Math.max(0, 48 - agent.autonomy.control) * 0.36 + Math.max(0, agent.autonomy.overwhelm - 58) * 0.42 + Math.max(0, 42 - agent.autonomy.dignity) * 0.28;
  const homeCareAffordances = buildHomeCareAffordances(agent, signals, {
    householdChorePressure,
    sleepQualityPressure,
    homeUpkeepPressure
  });
  const outdoorWeatherPenalty = signals.weather.tone === "bad" ? 12 : signals.weather.tone === "warn" ? 7 : 0;
  const shelterBoost = signals.weather.tone === "bad" ? 8 : signals.weather.tone === "warn" ? 4 : 0;
  const weatherDetail = signals.weather.tone === "good" ? "" : ` ${signals.weather.label.toLowerCase()} changes the outside calculus.`;
  const baseFoodUtility =
    agent.hunger * 0.96 +
    signals.foodMemory * 0.22 +
    (signals.liquidFunds >= 4 ? 10 : -42) +
    (storedFoodCount === 0 ? 14 : -6) +
    pantryPressure +
    hydrationPressure +
    nutritionPressure +
    signals.atePenalty +
    signals.foodPressure * 0.14 -
    signals.discretionaryPenalty;
  const foodAffordances = buildFoodAffordances(agent, signals, baseFoodUtility);
  const supplyAffordances = buildHouseholdSupplyAffordances(agent, signals, householdSupplyPressure, homeUpkeepPressure);
  const civicAffordances = buildCivicAffordances(agent, signals);
  const budgetAffordances = buildBudgetAffordances(agent, signals);
  const healthAffordances = buildHealthAffordances(agent, signals);
  const socialGoal =
    signals.socialFocus?.intent === "seek" ? `Find ${signals.socialFocus.agentName}` : eveningPlan?.intent === "meet_someone" ? eveningPlan.label : "Find company";
  const socialReason =
    signals.socialFocus?.intent === "seek"
      ? signals.socialFocus.reason
      : eveningPlan?.intent === "meet_someone"
        ? eveningPlan.detail
        : `social need is ${agent.social.toFixed(0)} and mood is ${agent.mood.toFixed(0)}`;
  const socialPlan =
    signals.socialFocus?.intent === "seek"
      ? ["Go to the park", `Look for ${signals.socialFocus.agentName}`, "Talk if the mood holds"]
      : eveningPlan?.intent === "meet_someone"
        ? ["Go to the park", "Look for an approachable person", "Turn the evening into a story"]
        : ["Go to the park", "Notice who is nearby", "Talk or decompress"];
  const supportDebt = Object.values(agent.relationshipDetails)
    .filter((relationship) => relationship.supportBalance > 0)
    .sort((a, b) => b.supportBalance - a.supportBalance || b.trust - a.trust)[0];
  const repaymentReserve = Math.max(5, agent.budget.dailySpendLimit * 0.35);
  const repaymentCapacity = Math.max(0, Math.floor(agent.money - repaymentReserve));
  const repaymentAmount = supportDebt ? Math.min(Math.ceil(supportDebt.supportBalance), repaymentCapacity, 6) : 0;
  const repaySupportAffordances: SemanticActionAffordance[] =
    supportDebt && repaymentAmount > 0
      ? [
          {
            id: "social.repay_support",
            label: `Repay ${supportDebt.agentName}`,
            action: "socializing",
            pointTypes: ["meeting_spot", "seat", "break_spot"],
            structureTypes: ["park"],
            utility:
              18 +
              supportDebt.supportBalance * 5.4 +
              supportDebt.trust * 0.08 +
              agent.dna.discipline * 0.12 +
              agent.dna.empathy * 0.08 +
              (signals.phase === "evening" ? 5 : 0) -
              Math.max(0, supportDebt.tension - 62) * 0.12 -
              signals.discretionaryPenalty * 0.4,
            goal: `Repay ${supportDebt.agentName}`,
            reason: `${supportDebt.agentName} has helped before; ${repaymentAmount} credits can reduce the owed support`,
            plan: ["Go to a public meeting spot", `Find ${supportDebt.agentName}`, "Pay back part of the help"],
            intent: {
              kind: "social",
              strategy: "repay_support",
              label: `Repay ${supportDebt.agentName}`,
              amount: repaymentAmount,
              paymentSource: "cash",
              savingsAllowed: false
            },
            socialFocus: {
              agentId: supportDebt.agentId,
              agentName: supportDebt.agentName,
              intent: "seek",
              reason: `${repaymentAmount} credits can pay back old help`
            },
            tone: supportDebt.supportBalance >= 5 ? "warn" : "good",
            tags: ["social", "support", "money", "repayment"]
          }
        ]
      : [];
  const restGoal = signals.socialFocus?.intent === "avoid" ? `Avoid ${signals.socialFocus.agentName}` : eveningPlan?.intent === "decompress" ? eveningPlan.label : "Calm down";
  const restReason =
    signals.socialFocus?.intent === "avoid"
      ? signals.socialFocus.reason
      : eveningPlan?.intent === "decompress"
        ? eveningPlan.detail
        : leisurePressure > 10
          ? `${agent.leisure.hobby.replace(/_/g, " ")} sounds better than letting boredom sit`
        : `stress is ${agent.stress.toFixed(0)} and comfort is ${agent.comfort.toFixed(0)}`;
  const restPlan =
    signals.socialFocus?.intent === "avoid"
      ? ["Find a quieter spot", `Keep distance from ${signals.socialFocus.agentName}`, "Let the stress drop"]
      : eveningPlan?.intent === "decompress"
        ? ["Find a quiet spot", "Skip the crowd", "Let the day settle"]
        : ["Find a quiet spot", "Rest briefly", "Lower stress"];
  const workCommitment = agent.commitments.find((commitment) => commitment.id.endsWith(":work"));
  const aftercareLoad = agent.medical.aftercare.active ? agent.medical.aftercare.dosesRemaining * 10 + agent.medical.aftercare.restMinutesRemaining * 0.16 : 0;
  const illnessWorkLoad = agent.medical.minorIllness.active ? agent.medical.minorIllness.severity * 0.72 : 0;
  const lowHealthWorkLoad = Math.max(0, 64 - agent.health) * 0.62 + Math.max(0, 36 - agent.energy) * 0.34 + Math.max(0, agent.stress - 64) * 0.22;
  const healthWorkPressure = illnessWorkLoad + aftercareLoad + lowHealthWorkLoad;
  const workWindowPressure = workCommitment?.status === "due" ? workCommitment.pressure : workCommitment?.status === "missed" ? 100 : signals.phase === "workday" ? 32 : 8;
  const shouldOfferSickCall = !agent.routine.workedToday && !agent.routine.sickLeaveToday && healthWorkPressure >= 30;
  const workStrategy =
    healthWorkPressure >= 36
      ? "push_through_sick"
      : agent.career.burnout > 72
        ? "work_through_burnout"
        : agent.budget.creditScore < 540
          ? "repair_credit"
          : signals.savingsGap > 0
            ? "earn_and_save"
            : "earn_income";
  const workLabel =
    workStrategy === "push_through_sick"
      ? "Push through sick"
      : workStrategy === "work_through_burnout"
        ? "Push through burnout"
        : workStrategy === "repair_credit"
          ? "Repair credit through work"
          : workStrategy === "earn_and_save"
            ? "Earn and save"
            : "Earn income";
  const sickCallAffordances: SemanticActionAffordance[] = shouldOfferSickCall
    ? [
        {
          id: "job.call_in_sick",
          label: "Call in sick",
          action: "calling_in_sick",
          pointTypes: ["home_anchor", "mailbox", "desk"],
          structureTypes: ["apartment"],
          utility:
            healthWorkPressure * 1.05 +
            workWindowPressure * 0.46 +
            agent.dna.discipline * 0.08 +
            agent.values.security * 0.08 -
            signals.moneyPressure * 0.36 -
            agent.dna.greed * 0.08,
          goal: "Protect health without ghosting work",
          reason: agent.medical.aftercare.active
            ? `${agent.medical.aftercare.label ?? "aftercare"} needs follow-through before a shift`
            : agent.medical.minorIllness.active
              ? `${agent.medical.minorIllness.label ?? "illness"} makes work risky`
              : `health ${Math.round(agent.health)} and energy ${Math.round(agent.energy)} make work risky`,
          plan: ["Contact work from home", "Explain the health issue", "Use the day to recover"],
          intent: {
            kind: "work",
            strategy: "call_in_sick",
            label: "Call in sick",
            amount: 0,
            paymentSource: "none",
            savingsAllowed: false
          },
          tone: healthWorkPressure >= 54 ? "bad" : "warn",
          tags: ["work", "health", "career"]
        }
      ]
    : [];
  const unreadPersonalMail = agent.personalNotices.filter((notice) => notice.status === "unread").length;
  const activePersonalMail = agent.personalNotices.filter((notice) => notice.status === "unread" || notice.status === "read").length;

  return [
    {
      id: "home.sleep",
      label: "Sleep at home",
      action: "sleeping",
      pointTypes: ["bed", "home_anchor"],
      structureTypes: ["apartment"],
      utility:
        (100 - agent.energy) * 0.88 +
        sleepRhythmPressure +
        sleepQualityPressure +
        shelterBoost +
        (signals.phase === "night" ? 20 : 0) +
        (agent.routine.sleptToday && agent.energy > 48 ? -36 : 0),
      goal: "Sleep at home",
      reason: `energy is ${agent.energy.toFixed(0)}, sleep debt ${Math.round(agent.sleep.sleepDebt)}, rhythm fatigue ${Math.round(agent.sleep.circadianFatigue)}`,
      plan: ["Go home", "Use the bed", "Recover based on home conditions"],
      intent: { kind: "home", strategy: "sleep_recover", label: "Recover energy" },
      tone: agent.energy < 30 || agent.sleep.sleepDebt > 70 ? "warn" : "neutral",
      tags: ["home", "sleep", "recovery"]
    },
    {
      id: "home.eat",
      label: "Eat stored food",
      action: "eating",
      pointTypes: ["dining_spot", "fridge", "home_anchor"],
      structureTypes: ["apartment"],
      utility: (storedFoodCount > 0 ? 18 : -18) + agent.hunger * 1.08 + signals.foodMemory * 0.18 + signals.atePenalty,
      goal: "Eat something",
      reason: storedFoodCount > 0 ? `hunger is ${agent.hunger.toFixed(0)} and ${storedFoodCount} stored meal${storedFoodCount === 1 ? "" : "s"} are at home` : "food is needed, but home storage looks empty",
      plan: ["Go home", "Use the shared kitchen", "Eat if food is available"],
      intent: { kind: "food", strategy: "eat_inventory", label: "Use stored food", savingsAllowed: false },
      tone: agent.hunger > 72 ? "warn" : "neutral",
      tags: ["home", "food", "need"]
    },
    ...homeCareAffordances,
    ...foodAffordances,
    ...supplyAffordances,
    ...sickCallAffordances,
    {
      id: "job.work_shift",
      label: workStrategy === "push_through_sick" ? "Work while sick" : "Work a shift",
      action: "working",
      pointTypes: [],
      targetMode: "job",
      utility:
        signals.moneyPressure +
        signals.savingsGap * 0.42 +
        signals.creditRepairPressure +
        agent.dna.discipline * 0.38 +
        agent.dna.greed * 0.18 +
        signals.workMemory * 0.22 +
        signals.workedPenalty +
        (agent.career.xp >= agent.career.xpToNext * 0.78 ? 9 : 0) -
        Math.max(0, agent.career.burnout - 58) * (signals.moneyPressure > 0 ? 0.16 : 0.46) -
        (healthWorkPressure >= 36 ? healthWorkPressure * (signals.moneyPressure > 20 ? 0.18 : 0.55) : 0),
      goal: "Work a shift",
      reason: agent.routine.workedToday
        ? `already worked; burnout ${agent.career.burnout}`
        : workStrategy === "push_through_sick"
          ? `health pressure ${Math.round(healthWorkPressure)}, cash ${agent.money}, wage ${agent.career.wage}`
          : `${agent.career.title}, wage ${agent.career.wage}, performance ${agent.career.performance}, cash ${agent.money}`,
      plan: workStrategy === "push_through_sick" ? ["Go to the workplace", "Push through carefully", "Trade recovery for credits"] : ["Go to the workplace", "Work a short shift", "Trade energy for credits"],
      intent: {
        kind: "work",
        strategy: workStrategy,
        label: workLabel
      },
      tone: workStrategy === "push_through_sick" ? "bad" : agent.career.burnout > 72 ? "bad" : agent.money < 12 || agent.budget.creditScore < 540 ? "warn" : "good",
      tags: ["work", "money", "service"]
    },
    ...civicAffordances,
    ...budgetAffordances,
    {
      id: "civic.check_mail",
      label: "Check mail",
      action: "checking_mail",
      pointTypes: ["mailbox"],
      utility:
        8 +
        unreadPersonalMail * 18 +
        activePersonalMail * 6 +
        (agent.rentDue + agent.budget.livingCostDue > 0 ? 10 : 0) +
        (signals.phase === "morning" || signals.phase === "evening" ? 6 : 0) +
        autonomyPressure * (agent.autonomy.overwhelm > 66 && !agent.routine.checkedMailToday ? 0.16 : 0.06) +
        signals.mailPenalty,
      goal: "Check mail",
      reason:
        unreadPersonalMail > 0
          ? `${unreadPersonalMail} unread personal notice${unreadPersonalMail === 1 ? "" : "s"} in the mailbox`
          : agent.rentDue + agent.budget.livingCostDue > 0
            ? "mail may explain the housing and living-cost pressure"
            : "mail is a small daily obligation",
      plan: ["Go to a mailbox", "Check notices", "Update routine memory"],
      intent: { kind: "civic", strategy: "check_mail", label: "Check notices", billType: agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue > 0 ? "rent" : "none", savingsAllowed: false },
      tone: agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue > 0 ? "warn" : "neutral",
      tags: ["mail", "civic", "routine"]
    },
    ...healthAffordances,
    ...repaySupportAffordances,
    {
      id: "social.public",
      label: socialGoal,
      action: "socializing",
      pointTypes: ["meeting_spot"],
      structureTypes: ["park"],
      utility:
        (100 - agent.social) * 0.56 +
        (100 - agent.mood) * 0.2 +
        agent.dna.sociability * 0.46 +
        signals.socialMemory * 0.15 +
        signals.socialPenalty +
        signals.seekBoost +
        signals.eveningSocialBoost +
        signals.avoidSocialPenalty +
        signals.eveningQuietPenalty +
        signals.socialPressure * 0.16 +
        leisurePressure * (agent.leisure.hobby === "people_watching" || agent.leisure.hobby === "music" || agent.leisure.hobby === "games" ? 0.38 : 0.18) +
        signals.weather.socialOutdoorModifier,
      goal: socialGoal,
      reason: `${socialReason}${weatherDetail}`,
      plan: signals.weather.tone === "bad" ? [...socialPlan, "Keep the outing short if the weather turns rough"] : socialPlan,
      intent: { kind: "social", strategy: signals.socialFocus?.intent ?? "public_social", label: socialGoal },
      socialFocus: signals.socialFocus?.intent === "seek" ? signals.socialFocus : null,
      tone: signals.socialFocus?.intent === "avoid" ? "warn" : agent.social < 34 ? "warn" : "neutral",
      tags: ["social", "relationship", "park"]
    },
    {
      id: "rest.quiet",
      label: restGoal,
      action: "resting",
      pointTypes: ["break_spot", "seat", "meeting_spot", "home_anchor"],
      utility:
        agent.stress * 0.72 +
        (100 - agent.comfort) * 0.24 +
        (agent.energy < 45 ? 9 : 0) +
        signals.illnessPressure * 0.28 +
        signals.avoidRestBoost +
        signals.eveningQuietBoost +
        signals.socialPressure * 0.08 +
        leisurePressure * (agent.leisure.hobby === "reading" || agent.leisure.hobby === "games" || agent.leisure.hobby === "fitness" ? 0.46 : 0.28) +
        autonomyPressure * 0.42 +
        shelterBoost,
      goal: restGoal,
      reason: `${restReason}${autonomyPressure > 8 ? ` Control ${agent.autonomy.control}, overwhelm ${agent.autonomy.overwhelm}.` : ""}${weatherDetail}`,
      plan: signals.weather.tone === "bad" ? [...restPlan, "Choose shelter over lingering outside"] : restPlan,
      intent: { kind: "rest", strategy: signals.socialFocus?.intent === "avoid" ? "avoid_rival" : "decompress", label: restGoal },
      socialFocus: signals.socialFocus?.intent === "avoid" ? signals.socialFocus : null,
      tone: agent.stress > 70 ? "warn" : "neutral",
      tags: ["rest", "mood", "public"]
    },
    {
      id: "city.inspect_build",
      label: "Inspect opportunity",
      action: "building",
      pointTypes: ["construction_anchor", "notice_board"],
      utility:
        9 +
        agent.dna.risk * 0.13 +
        agent.dna.greed * 0.12 +
        (agent.money > 28 ? 8 : 0) +
        (signals.phase === "evening" ? 4 : 0) +
        Math.max(0, agent.leisure.curiosity - 62) * 0.42 +
        (agent.leisure.hobby === "crafting" ? 9 : 0) +
        signals.upkeepPressure * 0.08 -
        outdoorWeatherPenalty,
      goal: "Inspect future opportunities",
      reason: `risk ${agent.dna.risk} and greed ${agent.dna.greed} make future building interesting${weatherDetail}`,
      plan:
        signals.weather.tone === "bad"
          ? ["Visit a civic or buildable point", "Inspect quickly despite the weather", "Store the idea as a memory"]
          : ["Visit a civic or buildable point", "Inspect rules", "Store the idea as a memory"],
      intent: { kind: "build", strategy: "inspect_opportunity", label: "Consider future build" },
      tone: signals.liquidFunds > 30 ? "good" : "neutral",
      tags: ["future", "building", "city"]
    }
  ];
};

export const describeActionOption = (candidate: Candidate, selected: boolean): AgentActionOption => ({
  id: `${candidate.affordanceId ?? candidate.action}:${candidate.structure.id}:${candidate.point.id}`,
  label: candidate.optionLabel ?? candidate.goal,
  action: candidate.action,
  location: `${candidate.structure.name}: ${candidate.point.label}`,
  intent: candidate.intent ? { ...candidate.intent } : undefined,
  utility: Math.round(candidate.utility),
  reason: candidate.reason,
  plan: [...candidate.plan],
  selected,
  tone: candidate.optionTone ?? toneForUtility(candidate.utility),
  tags: candidate.optionTags ? [...candidate.optionTags] : [candidate.action]
});

const buildHomeCareAffordances = (
  agent: SimAgent,
  signals: AffordanceSignals,
  pressure: { householdChorePressure: number; sleepQualityPressure: number; homeUpkeepPressure: number }
): SemanticActionAffordance[] => {
  const homeStructure = ["apartment"] as StructureMetadata["type"][];
  const washShared = {
    action: "washing" as const,
    pointTypes: ["sink", "home_anchor", "fridge"] as ActionPoint["type"][],
    structureTypes: homeStructure,
    goal: "Wash up",
    tags: ["home", "hygiene", "routine"]
  };
  const cleanShared = {
    action: "cleaning" as const,
    pointTypes: ["sink", "dining_spot", "home_anchor", "fridge"] as ActionPoint["type"][],
    structureTypes: homeStructure,
    goal: "Care for home",
    tags: ["home", "chores", "comfort"]
  };
  const options: SemanticActionAffordance[] = [];
  const hygieneNeed = (100 - agent.hygiene) * 0.72 + signals.illnessPressure * 0.14 + (signals.phase === "morning" ? 8 : 0);
  const alreadyWashedPenalty = agent.routine.washedToday && signals.illnessPressure < 18 ? -34 : 0;
  const toiletryPenalty = agent.household.toiletries <= 0 ? -14 : agent.household.toiletries <= 1 ? -5 : 0;
  const cleaningSupplyPenalty = agent.household.cleaningSupplies <= 0 ? -16 : agent.household.cleaningSupplies <= 1 ? -6 : 0;
  const autonomyPressure =
    Math.max(0, 48 - agent.autonomy.control) * 0.34 + Math.max(0, agent.autonomy.overwhelm - 58) * 0.38 + Math.max(0, 42 - agent.autonomy.dignity) * 0.36;

  options.push({
    ...washShared,
    id: "home.wash.quick",
    label: agent.household.toiletries <= 0 ? "Wash without toiletries" : "Quick wash",
    utility: hygieneNeed + autonomyPressure * 0.26 + alreadyWashedPenalty + Math.max(0, 44 - agent.hygiene) * 0.24 + toiletryPenalty,
    reason: `hygiene is ${agent.hygiene.toFixed(0)}, dignity ${Math.round(agent.autonomy.dignity)}, and toiletries are ${agent.household.toiletries}/${agent.household.supplyCapacity}`,
    plan: ["Go home", "Use the sink", "Get clean enough for the next errand"],
    intent: { kind: "home", strategy: "wash_hygiene", label: "Quick wash" },
    tone: agent.household.toiletries <= 0 || agent.hygiene < 35 ? "warn" : "neutral"
  });

  if (agent.household.laundry > 42 || (agent.routine.washedToday && agent.household.laundry > 28)) {
    options.push({
      ...washShared,
      id: "home.wash.laundry",
      label: "Do laundry",
      utility:
        agent.household.laundry * 0.78 +
        pressure.householdChorePressure * 1.7 +
        agent.dna.discipline * 0.12 +
        autonomyPressure * 0.26 +
        (signals.phase === "evening" ? 6 : 0) -
        (agent.energy < 24 ? 18 : 0) +
        cleaningSupplyPenalty,
      goal: "Do laundry",
      reason: `laundry is ${Math.round(agent.household.laundry)} and cleaning supplies are ${agent.household.cleaningSupplies}/${agent.household.supplyCapacity}`,
      plan: ["Go home", "Sort the laundry pile", "Recover comfort for tomorrow"],
      intent: { kind: "home", strategy: "do_laundry", label: "Do laundry" },
      tone: agent.household.laundry >= 76 ? "bad" : agent.household.laundry >= 58 ? "warn" : "neutral",
      tags: ["home", "laundry", "comfort"]
    });
  }

  if (agent.household.clutter > 40 || pressure.homeUpkeepPressure > 6) {
    options.push({
      ...cleanShared,
      id: "home.clean.tidy",
      label: "Tidy clutter",
      utility:
        agent.household.clutter * 0.72 +
        pressure.householdChorePressure * 1.4 +
        agent.values.comfort * 0.08 +
        autonomyPressure * 0.34 +
        (signals.phase === "morning" ? 5 : 0) -
        (agent.energy < 22 ? 14 : 0) +
        cleaningSupplyPenalty,
      goal: "Tidy clutter",
      reason: `clutter is ${Math.round(agent.household.clutter)} and cleaning supplies are ${agent.household.cleaningSupplies}/${agent.household.supplyCapacity}`,
      plan: ["Go home", "Clear surfaces and floor clutter", "Make the room easier to use"],
      intent: { kind: "home", strategy: "tidy_clutter", label: "Tidy clutter" },
      tone: agent.household.clutter >= 76 ? "bad" : agent.household.clutter >= 58 ? "warn" : "neutral",
      tags: ["home", "clutter", "comfort"]
    });
  }

  if (pressure.homeUpkeepPressure > 10 || agent.aspiration.id === "comfort") {
    options.push({
      ...cleanShared,
      id: "home.clean.deep",
      label: "Deep clean home",
      utility:
        pressure.homeUpkeepPressure * 1.9 +
        (agent.aspiration.id === "comfort" ? 10 : 0) +
        agent.dna.discipline * 0.1 +
        autonomyPressure * 0.32 +
        (signals.phase === "evening" ? 8 : 0) -
        (agent.energy < 34 ? 22 : 0) +
        cleaningSupplyPenalty,
      goal: "Deep clean home",
      reason: `clutter ${Math.round(agent.household.clutter)}, laundry ${Math.round(agent.household.laundry)}, supplies ${agent.household.cleaningSupplies}/${agent.household.supplyCapacity}`,
      plan: ["Go home", "Handle several chores", "Make the apartment feel livable"],
      intent: { kind: "home", strategy: "deep_clean", label: "Deep clean home" },
      tone: pressure.homeUpkeepPressure > 16 ? "bad" : "warn"
    });
  }

  if (agent.household.sleepQuality < 58 || signals.phase === "night") {
    const sleepRhythmPressure = Math.max(0, agent.sleep.sleepDebt - 48) * 0.22 + Math.max(0, agent.sleep.circadianFatigue - 54) * 0.18;
    options.push({
      ...cleanShared,
      id: "home.clean.sleep_prep",
      label: "Prep bed for sleep",
      utility:
        pressure.sleepQualityPressure * 4.8 +
        sleepRhythmPressure +
        autonomyPressure * 0.18 +
        Math.max(0, 62 - agent.energy) * 0.24 +
        (signals.phase === "night" ? 18 : signals.phase === "evening" ? 9 : 0) -
        (agent.routine.sleptToday && agent.energy > 45 ? 20 : 0),
      goal: "Prep for better sleep",
      reason: `sleep quality is ${Math.round(agent.household.sleepQuality)} and tonight depends on the room`,
      plan: ["Go home", "Clear the bed area", "Improve tonight's sleep quality"],
      intent: { kind: "home", strategy: "sleep_prep", label: "Prep bed for sleep" },
      tone: agent.household.sleepQuality < 42 ? "bad" : "warn",
      tags: ["home", "sleep", "comfort"]
    });
  }

  return options;
};

const buildFoodAffordances = (agent: SimAgent, signals: AffordanceSignals, baseUtility: number): SemanticActionAffordance[] => {
  const shared = {
    action: "shopping" as const,
    pointTypes: ["register", "vending_machine", "shelf"] as ActionPoint["type"][],
    structureTypes: ["grocery"] as StructureMetadata["type"][],
    goal: "Buy food",
    plan: ["Go to the grocery", "Use the register", "Buy a meal if affordable"],
    tags: ["food", "money", "shop"]
  };
  const options: SemanticActionAffordance[] = [];
  const pantryGap = Math.max(0, agent.household.pantryCapacity - agent.household.pantry);
  const billsDue = agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue;
  const cashAfterBills = agent.money - billsDue;
  const canPay = (price: number) => signals.liquidFunds >= price;
  const cashCanPay = (price: number) => agent.money >= price;
  const paymentSourceFor = (price: number): AgentActionIntent["paymentSource"] => (cashCanPay(price) ? "cash" : canPay(price) ? "liquid" : "none");
  const savingsAllowedFor = (price: number) => !cashCanPay(price) && canPay(price);
  const addPurchase = (
    id: string,
    label: string,
    strategy: string,
    price: number,
    utility: number,
    reason: string,
    plan: string[],
    tone: AgentActionOptionTone
  ) => {
    options.push({
      ...shared,
      id,
      label,
      utility,
      reason,
      plan,
      intent: {
        kind: "food",
        strategy,
        label,
        amount: price,
        paymentSource: paymentSourceFor(price),
        savingsAllowed: savingsAllowedFor(price)
      },
      tone
    });
  };

  if (canPay(3)) {
    addPurchase(
      "shop.food.quick_meal",
      cashCanPay(3) ? "Buy quick meal" : "Use savings for quick meal",
      cashCanPay(3) ? "buy_quick_meal" : "emergency_quick_meal",
      3,
      baseUtility + (agent.hunger > 72 ? 15 : 4) - (agent.household.pantry > 1 ? 6 : 0),
      cashCanPay(3) ? `hunger is ${agent.hunger.toFixed(0)} and cash covers a quick meal` : `cash is short, but liquid funds can cover one quick meal`,
      ["Go to the grocery", "Buy a quick meal", "Eat enough to keep moving"],
      agent.hunger > 78 ? "bad" : agent.hunger > 64 ? "warn" : "neutral"
    );
  }

  if (canPay(6) && pantryGap > 0) {
    addPurchase(
      "shop.food.groceries",
      cashCanPay(6) ? "Buy groceries" : "Use savings for groceries",
      cashCanPay(6) ? "buy_groceries" : "emergency_groceries",
      6,
      baseUtility + pantryGap * 4 + agent.dna.discipline * 0.07 + (cashAfterBills >= 6 ? 8 : -4),
      pantryGap >= 2
        ? `${pantryGap} pantry slots are open and groceries create future meals`
        : `one pantry slot is open and groceries can stabilize tomorrow`,
      ["Go to the grocery", "Buy groceries", "Stock the home pantry"],
      pantryGap >= 3 ? "good" : "neutral"
    );
  }

  if (canPay(8) && (pantryGap > 0 || agent.nutrition.quality < 46 || agent.nutrition.variety < 42)) {
    addPurchase(
      "shop.food.fresh_groceries",
      cashCanPay(8) ? "Buy better groceries" : "Use savings for better groceries",
      cashCanPay(8) ? "buy_fresh_groceries" : "emergency_fresh_groceries",
      8,
      baseUtility +
        pantryGap * 3.5 +
        Math.max(0, 62 - agent.nutrition.quality) * 0.56 +
        Math.max(0, 58 - agent.nutrition.variety) * 0.44 +
        agent.values.care * 0.08 -
        signals.discretionaryPenalty * 0.22,
      `nutrition is quality ${Math.round(agent.nutrition.quality)}, variety ${Math.round(agent.nutrition.variety)}, so better groceries would improve body fuel`,
      ["Go to the grocery", "Choose better ingredients", "Turn food money into better body fuel"],
      agent.nutrition.quality < 34 || agent.nutrition.variety < 30 ? "warn" : "good"
    );
  }

  if (canPay(10) && pantryGap >= 3 && cashAfterBills >= 10) {
    addPurchase(
      "shop.food.bulk_groceries",
      "Stock pantry in bulk",
      "bulk_groceries",
      10,
      baseUtility + pantryGap * 5 + agent.dna.discipline * 0.09 + agent.values.security * 0.06 - signals.discretionaryPenalty * 0.35,
      `${pantryGap} pantry slots are open and enough cash remains after bills for a bulk shop`,
      ["Go to the grocery", "Buy bulk groceries", "Fill several pantry slots"],
      "good"
    );
  }

  if (!canPay(3)) {
    options.push({
      ...shared,
      id: "shop.food.unfunded",
      label: "Try to buy food",
      utility: baseUtility,
      reason: `hunger is ${agent.hunger.toFixed(0)}, but there are not enough liquid credits`,
      intent: { kind: "food", strategy: "attempt_without_funds", label: "Cannot afford yet", amount: 3, paymentSource: "none", savingsAllowed: false },
      tone: "bad"
    });
    if (!agent.routine.workedToday) {
      options.push({
        id: "shop.food.work_first",
        label: "Work before buying food",
        action: "working",
        pointTypes: ["job_station"],
        targetMode: "job",
        utility: baseUtility + 14 + signals.moneyPressure * 0.5,
        goal: "Earn food money",
        reason: `food is needed, but ${Math.round(signals.liquidFunds)} liquid credits cannot cover even a quick meal`,
        plan: ["Go to work", "Earn credits", "Buy food after the shift"],
        intent: { kind: "work", strategy: "earn_food_money", label: "Earn food money", paymentSource: "none", savingsAllowed: false },
        tone: "warn",
        tags: ["work", "food", "money"]
      });
    }
  }

  return options;
};

const buildHouseholdSupplyAffordances = (agent: SimAgent, signals: AffordanceSignals, supplyPressure: number, homeUpkeepPressure: number): SemanticActionAffordance[] => {
  const shared = {
    action: "shopping" as const,
    pointTypes: ["shelf", "register", "storage"] as ActionPoint["type"][],
    structureTypes: ["grocery"] as StructureMetadata["type"][],
    goal: "Restock home supplies",
    tags: ["home", "supplies", "shop"]
  };
  const options: SemanticActionAffordance[] = [];
  const billsDue = agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue;
  const cashAfterBills = agent.money - billsDue;
  const toiletryGap = Math.max(0, agent.household.supplyCapacity - agent.household.toiletries);
  const cleaningGap = Math.max(0, agent.household.supplyCapacity - agent.household.cleaningSupplies);
  const canPay = (price: number) => signals.liquidFunds >= price;
  const cashCanPay = (price: number) => agent.money >= price;
  const paymentSourceFor = (price: number): AgentActionIntent["paymentSource"] => (cashCanPay(price) ? "cash" : canPay(price) ? "liquid" : "none");
  const savingsAllowedFor = (price: number) => !cashCanPay(price) && canPay(price);
  const addSupplyPurchase = (
    id: string,
    label: string,
    strategy: string,
    price: number,
    utility: number,
    reason: string,
    plan: string[],
    tone: AgentActionOptionTone
  ) => {
    options.push({
      ...shared,
      id,
      label,
      utility,
      reason,
      plan,
      intent: {
        kind: "home",
        strategy,
        label,
        amount: price,
        paymentSource: paymentSourceFor(price),
        savingsAllowed: savingsAllowedFor(price)
      },
      tone
    });
  };

  if (toiletryGap > 0 && (agent.household.toiletries <= 1 || agent.hygiene < 54) && canPay(4)) {
    addSupplyPurchase(
      "shop.home.toiletries",
      cashCanPay(4) ? "Buy toiletries" : "Use savings for toiletries",
      "buy_toiletries",
      4,
      supplyPressure * 2.1 + Math.max(0, 62 - agent.hygiene) * 0.22 + agent.dna.discipline * 0.08 + (cashAfterBills >= 4 ? 6 : -3),
      `toiletries are ${agent.household.toiletries}/${agent.household.supplyCapacity}, which shapes washing and public readiness`,
      ["Go to the grocery", "Pick up toiletries", "Keep washing routines reliable"],
      agent.household.toiletries <= 0 ? "warn" : "neutral"
    );
  }

  if (cleaningGap > 0 && (agent.household.cleaningSupplies <= 1 || homeUpkeepPressure > 8) && canPay(5)) {
    addSupplyPurchase(
      "shop.home.cleaning",
      cashCanPay(5) ? "Buy cleaning supplies" : "Use savings for cleaning supplies",
      "buy_cleaning_supplies",
      5,
      supplyPressure * 1.9 + homeUpkeepPressure * 1.2 + agent.dna.discipline * 0.07 + (cashAfterBills >= 5 ? 5 : -3),
      `cleaning supplies are ${agent.household.cleaningSupplies}/${agent.household.supplyCapacity}, and home upkeep depends on them`,
      ["Go to the grocery", "Pick up cleaning supplies", "Make chores work better"],
      agent.household.cleaningSupplies <= 0 ? "warn" : "neutral"
    );
  }

  if ((toiletryGap >= 2 || cleaningGap >= 2) && (agent.household.toiletries <= 2 || agent.household.cleaningSupplies <= 2) && canPay(8)) {
    addSupplyPurchase(
      "shop.home.bundle",
      cashCanPay(8) ? "Restock home supplies" : "Use savings for home supplies",
      "buy_home_supplies",
      8,
      supplyPressure * 2.4 + homeUpkeepPressure * 0.7 + agent.values.security * 0.08 + agent.dna.discipline * 0.06 - signals.discretionaryPenalty * 0.28,
      `home supplies are thin: toiletries ${agent.household.toiletries}, cleaning ${agent.household.cleaningSupplies}`,
      ["Go to the grocery", "Buy a small home supply bundle", "Make chores and washing reliable again"],
      agent.household.toiletries <= 0 || agent.household.cleaningSupplies <= 0 ? "warn" : "good"
    );
  }

  if (supplyPressure > 0 && options.length === 0 && !canPay(4)) {
    options.push({
      ...shared,
      id: "shop.home.supplies_unfunded",
      label: "Need home supplies",
      utility: supplyPressure + homeUpkeepPressure * 0.4 + signals.moneyPressure * 0.35,
      reason: `supplies are low, but ${Math.round(signals.liquidFunds)} liquid credits cannot cover them`,
      plan: ["Notice the home supply shortage", "Earn or budget credits", "Restock when possible"],
      intent: { kind: "home", strategy: "buy_home_supplies", label: "Cannot afford supplies", amount: 4, paymentSource: "none", savingsAllowed: false },
      tone: "warn"
    });
  }

  return options;
};

const buildHealthAffordances = (agent: SimAgent, signals: AffordanceSignals): SemanticActionAffordance[] => {
  const illness = agent.medical.minorIllness;
  const aftercare = agent.medical.aftercare;
  const illnessSeverity = illness.active ? illness.severity : 0;
  const seriousSymptoms = illness.active && illnessSeverity >= 54;
  const lowHealth = agent.health < 58;
  const urgent = agent.health < 45 || seriousSymptoms;
  const alreadyVisitedPenalty = agent.routine.medicalVisitToday ? (urgent ? -8 : -24) : 0;
  const carePressure =
    (100 - agent.health) * 0.86 +
    signals.illnessPressure * 0.96 +
    signals.weather.clinicRiskModifier * 0.55 +
    (lowHealth ? 18 : 0) +
    (urgent ? 18 : 0) +
    signals.healthPressure * 0.15 +
    alreadyVisitedPenalty;
  const options: SemanticActionAffordance[] = [];
  const shared = {
    action: "healing" as const,
    pointTypes: ["clinic_bed", "medicine_cabinet", "desk"] as ActionPoint["type"][],
    structureTypes: ["clinic"] as StructureMetadata["type"][],
    goal: "Get care",
    tags: ["health", "clinic", "care"]
  };
  const canPay = (price: number) => signals.liquidFunds >= price;
  const cashCanPay = (price: number) => agent.money >= price;
  const paymentSourceFor = (price: number): AgentActionIntent["paymentSource"] => (price <= 0 ? "none" : cashCanPay(price) ? "cash" : canPay(price) ? "liquid" : "none");
  const savingsAllowedFor = (price: number) => price > 0 && !cashCanPay(price) && canPay(price);
  const illnessReason = illness.active
    ? `${illness.label ?? "illness"} severity ${Math.round(illnessSeverity)}, health ${agent.health.toFixed(0)}`
    : `health is ${agent.health.toFixed(0)}`;

  if (aftercare.active) {
    const doses = Math.max(0, aftercare.dosesRemaining);
    const rest = Math.max(0, Math.round(aftercare.restMinutesRemaining));
    const overdue = aftercare.expiresWorldMinutes > 0 && signals.worldMinutes >= aftercare.expiresWorldMinutes;
    const dueSoon = aftercare.followUpDueWorldMinutes > 0 && signals.worldMinutes >= aftercare.followUpDueWorldMinutes;
    options.push({
      id: "health.aftercare.home",
      label: doses > 0 ? "Take aftercare meds" : "Rest after treatment",
      action: "healing",
      pointTypes: ["fridge", "sink", "home_anchor", "bed"],
      structureTypes: ["apartment"],
      utility:
        38 +
        doses * 14 +
        rest * 0.24 +
        (overdue ? 24 : dueSoon ? 12 : 0) +
        signals.illnessPressure * 0.22 +
        Math.max(0, 72 - agent.health) * 0.28 -
        (agent.routine.medicalVisitToday && doses <= 0 ? 6 : 0),
      goal: "Follow care plan",
      reason:
        doses > 0
          ? `${aftercare.label ?? "aftercare"} has ${doses} dose${doses === 1 ? "" : "s"} left${rest > 0 ? ` and ${rest} rest minutes` : ""}`
          : `${aftercare.label ?? "aftercare"} needs ${rest} more quiet minutes`,
      plan: ["Go home", doses > 0 ? "Take the next dose" : "Rest quietly", "Lower relapse risk"],
      intent: {
        kind: "health",
        strategy: "take_aftercare_medicine",
        label: doses > 0 ? "Take aftercare medicine" : "Rest after care",
        amount: 0,
        paymentSource: "none",
        savingsAllowed: false
      },
      tone: overdue ? "bad" : dueSoon || doses > 0 ? "warn" : "neutral",
      tags: ["health", "aftercare", "home"]
    });
  }
  const addCare = (
    id: string,
    label: string,
    strategy: string,
    price: number,
    utility: number,
    reason: string,
    plan: string[],
    tone: AgentActionOptionTone,
    pointTypes: ActionPoint["type"][] = shared.pointTypes
  ) => {
    options.push({
      ...shared,
      id,
      label,
      pointTypes,
      utility,
      reason,
      plan,
      intent: {
        kind: "health",
        strategy,
        label,
        amount: price,
        paymentSource: paymentSourceFor(price),
        savingsAllowed: savingsAllowedFor(price) || urgent
      },
      tone
    });
  };

  if (agent.health < 82 || illness.active || signals.weather.clinicRiskModifier > 8) {
    addCare(
      "clinic.checkup",
      cashCanPay(3) ? "Get checkup" : canPay(3) ? "Use savings for checkup" : "Ask about a checkup",
      "clinic_checkup",
      3,
      carePressure * 0.42 + agent.dna.discipline * 0.08 + agent.values.security * 0.06 + (agent.health < 72 ? 7 : 0),
      illness.active ? `${illnessReason}; a small check could catch it early` : `${illnessReason}; a cheap checkup could prevent worse care later`,
      ["Go to the clinic", "Check in at the desk", "Get basic advice and supplies if affordable"],
      lowHealth || illness.active ? "warn" : "neutral",
      ["desk", "medicine_cabinet", "clinic_bed"]
    );
  }

  if (illness.active || agent.health < 72) {
    addCare(
      "clinic.treat_symptoms",
      cashCanPay(6) ? "Treat symptoms" : canPay(6) ? "Use savings for treatment" : "Ask for treatment",
      "treat_symptoms",
      6,
      carePressure + (illness.active ? 16 : 0) + (agent.health < 62 ? 8 : 0),
      illness.active ? `${illnessReason}; treatment can stop escalation` : `${illnessReason}; treatment can stabilize the body`,
      ["Go to the clinic", "Use the care supplies", "Treat the immediate health problem"],
      urgent ? "bad" : "warn",
      ["medicine_cabinet", "clinic_bed", "desk"]
    );
  }

  if (urgent) {
    addCare(
      "clinic.urgent_care",
      canPay(10) ? "Seek urgent care" : "Seek urgent care anyway",
      "urgent_care",
      10,
      carePressure + 28 + Math.max(0, 55 - agent.health) * 0.5 + illnessSeverity * 0.28,
      `${illnessReason}; waiting risks a hospital stay and a larger bill`,
      ["Go to the clinic now", "Use a treatment bed", "Stabilize before it becomes a crisis"],
      "bad",
      ["medicine_cabinet", "clinic_bed", "desk"]
    );
  }

  if (!canPay(3) || (urgent && !canPay(10))) {
    addCare(
      "clinic.unpaid_care",
      "Seek unpaid care",
      "seek_unpaid_care",
      0,
      carePressure + (urgent ? 18 : 5) - agent.dna.greed * 0.04 + agent.values.security * 0.04,
      `${illnessReason}; money is tight, but care still matters`,
      ["Go to the clinic", "Ask for help without payment", "Accept whatever care is available"],
      urgent ? "bad" : "warn",
      ["desk", "medicine_cabinet", "clinic_bed"]
    );
  }

  return options;
};

const buildBudgetAffordances = (agent: SimAgent, signals: AffordanceSignals): SemanticActionAffordance[] => {
  const billTotal = agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue;
  const cashAfterBills = agent.money - billTotal;
  const savingsGap = Math.max(0, agent.budget.savingsGoal - agent.budget.savings);
  const budgetOverage = Math.max(0, agent.budget.spentToday - agent.budget.dailySpendLimit);
  const preserveCash = Math.max(5, agent.budget.dailySpendLimit * 0.65);
  const spareCash = Math.max(0, cashAfterBills - preserveCash);
  const canDeposit = savingsGap > 0 && spareCash >= 1;
  const autonomyPressure =
    Math.max(0, 48 - agent.autonomy.control) * 0.28 + Math.max(0, agent.autonomy.overwhelm - 58) * 0.34 + Math.max(0, 42 - agent.autonomy.dignity) * 0.18;
  const strategy =
    canDeposit
      ? "planned_savings"
      : budgetOverage > 0
        ? "spending_review"
        : agent.budget.creditScore < 560
          ? "credit_review"
          : "budget_review";
  const label =
    strategy === "planned_savings"
      ? "Move cash to savings"
      : strategy === "spending_review"
        ? "Review spending"
        : strategy === "credit_review"
          ? "Review credit plan"
          : "Review budget";
  const utility =
    signals.creditRepairPressure * 0.72 +
    Math.min(22, savingsGap * 0.42) +
    budgetOverage * 1.7 +
    spareCash * 0.5 +
    autonomyPressure * 0.34 +
    (agent.routine.workedToday ? 7 : 0) +
    (signals.phase === "morning" || signals.phase === "evening" ? 6 : 0) -
    (billTotal > signals.liquidFunds ? 18 : 0) -
    (agent.budget.savedToday > 0 && budgetOverage <= 0 ? 18 : 0);

  return [
    {
      id: `finance.${strategy}`,
      label,
      action: "budgeting",
      pointTypes: ["desk", "mailbox", "notice_board"],
      structureTypes: ["town_hall"],
      utility,
      goal: label,
      reason:
        strategy === "planned_savings"
          ? `${Math.round(spareCash)} spare cash can close a ${savingsGap}-credit savings gap`
          : strategy === "spending_review"
            ? `${Math.round(budgetOverage)} credits over today's spend limit`
            : strategy === "credit_review"
              ? `credit ${agent.budget.creditScore} needs attention`
              : `${agent.money} cash, ${agent.budget.savings}/${agent.budget.savingsGoal} saved, control ${agent.autonomy.control}`,
      plan: ["Go to town hall", "Review cash, bills, and savings", canDeposit ? "Move safe spare cash into savings" : "Update the budget note"],
      intent: {
        kind: "civic",
        strategy,
        label,
        billType: "none",
        amount: canDeposit ? Math.min(savingsGap, spareCash) : 0,
        paymentSource: canDeposit ? "cash" : "none",
        preserveCash
      },
      tone: budgetOverage > 0 || agent.budget.creditScore < 520 ? "warn" : canDeposit ? "good" : "neutral",
      tags: ["budget", "savings", "money"]
    }
  ];
};

const buildCivicAffordances = (agent: SimAgent, signals: AffordanceSignals): SemanticActionAffordance[] => {
  const shared = {
    action: "paying_rent" as const,
    pointTypes: ["desk", "mailbox", "notice_board"] as ActionPoint["type"][],
    structureTypes: ["town_hall"] as StructureMetadata["type"][],
    plan: ["Go to town hall", "Check account", "Act on the bill"],
    tags: ["civic", "bills", "money"]
  };
  const baseUtility = signals.civicObligationPressure + signals.housingPressure * 0.2 + signals.creditRepairPressure;
  const options: SemanticActionAffordance[] = [];
  const reserveCash = Math.max(3, Math.min(8, agent.budget.dailySpendLimit * 0.35));
  const totalDue = Math.round((agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue) * 100) / 100;
  const partialPaymentFrom = (due: number) => {
    const spendable = Math.round(Math.max(0, signals.liquidFunds - reserveCash) * 100) / 100;
    if (spendable <= 0 || due <= 1) return 0;
    const obligationCap = totalDue > signals.liquidFunds ? Math.max(1, Math.round(due * 0.55 * 100) / 100) : due;
    const protectedCap = Math.max(1, Math.min(due - 0.01, obligationCap));
    return Math.round(Math.min(spendable, protectedCap) * 100) / 100;
  };
  const reviewUtility = (due: number, canClear: boolean) => baseUtility + Math.min(8, due * 0.25) + agent.dna.risk * 0.05 - agent.dna.discipline * 0.08 - (canClear ? 22 : 4);
  const canCoverAllDue = totalDue > 0 && signals.liquidFunds >= totalDue;
  const paymentPlanPressure =
    totalDue > 0 && (!canCoverAllDue || agent.budget.overdueBillDays > 0)
      ? baseUtility +
        Math.min(22, totalDue * 0.45) +
        agent.budget.overdueBillDays * 12 +
        agent.budget.missedBillCount * 3 +
        Math.max(0, 540 - agent.budget.creditScore) * 0.03 -
        agent.budget.hardshipDeferrals * 16 -
        (canCoverAllDue ? 20 : 0)
      : -Infinity;

  if (paymentPlanPressure > -20) {
    options.push({
      ...shared,
      id: "civic.payment_plan",
      label: agent.budget.overdueBillDays > 0 ? "Ask for payment plan" : "Ask for bill extension",
      utility: paymentPlanPressure,
      goal: "Buy time on bills",
      reason:
        agent.budget.overdueBillDays > 0
          ? `${totalDue} credits are ${agent.budget.overdueBillDays} day${agent.budget.overdueBillDays === 1 ? "" : "s"} overdue`
          : `${totalDue} credits are due and only ${Math.round(signals.liquidFunds)} liquid credits are available`,
      plan: ["Go to town hall", "Explain the shortfall", "Get a short payment plan before late fees hit"],
      intent: {
        kind: "civic",
        strategy: "request_payment_plan",
        label: "Request payment plan",
        billType: "none",
        amount: 0,
        paymentSource: "none",
        savingsAllowed: false
      },
      tone: agent.budget.overdueBillDays >= 2 || totalDue > signals.liquidFunds ? "warn" : "neutral"
    });
  }

  if (agent.rentDue > 0) {
    const canCash = agent.money >= agent.rentDue;
    const canLiquid = !canCash && signals.liquidFunds >= agent.rentDue;
    const partialAmount = partialPaymentFrom(agent.rentDue);
    if (canCash || canLiquid) {
      options.push({
        ...shared,
        id: canCash ? "civic.rent.cash.clear" : "civic.rent.liquid.clear",
        label: canCash ? "Pay rent from cash" : "Clear rent with cash + savings",
        utility: baseUtility + (canCash ? 18 : 12) + agent.dna.discipline * 0.04 + agent.values.security * 0.04,
        goal: "Clear rent",
        reason: canCash
          ? `${agent.rentDue} rent due and cash can cover it`
          : `${agent.rentDue} rent due; ${Math.round(signals.liquidFunds)} liquid credits can clear it`,
        intent: {
          kind: "civic",
          strategy: canCash ? "pay_rent_cash" : "pay_rent_with_liquid_funds",
          label: canCash ? "Pay rent now" : "Combine cash and savings for rent",
          billType: "rent",
          amount: agent.rentDue,
          paymentSource: canCash ? "cash" : "liquid",
          savingsAllowed: canLiquid
        },
        tone: canCash ? "good" : "warn"
      });
    }

    if (partialAmount > 0 && partialAmount < agent.rentDue) {
      options.push({
        ...shared,
        id: "civic.rent.partial",
        label: "Make partial rent payment",
        utility: baseUtility + 4 + Math.min(8, partialAmount * 0.35) + agent.dna.discipline * 0.02 - agent.dna.risk * 0.03,
        goal: "Reduce rent pressure",
        reason: `${partialAmount} credits can reduce ${agent.rentDue} rent while preserving ${Math.round(reserveCash)} cash`,
        plan: ["Go to town hall", "Keep some cash liquid", "Pay what can safely move today"],
        intent: {
          kind: "civic",
          strategy: "pay_rent_partial",
          label: "Pay part and keep cash buffer",
          billType: "rent",
          amount: partialAmount,
          paymentSource: "liquid",
          savingsAllowed: true,
          preserveCash: reserveCash
        },
        tone: "warn"
      });
    }

    options.push({
      ...shared,
      id: "civic.rent.review",
      label: signals.liquidFunds >= agent.rentDue ? "Consider holding rent cash" : "Review rent shortfall",
      utility: reviewUtility(agent.rentDue, canCash || canLiquid),
      goal: "Review rent",
      reason:
        signals.liquidFunds >= agent.rentDue
          ? `${agent.rentDue} rent can be paid, but the agent may preserve liquidity`
          : `${agent.rentDue} rent due and only ${Math.round(signals.liquidFunds)} liquid credits available`,
      intent: {
        kind: "civic",
        strategy: "review_only",
        label: signals.liquidFunds >= agent.rentDue ? "Delay rent decision" : "Assess rent shortfall",
        billType: "rent",
        amount: 0,
        paymentSource: "none",
        savingsAllowed: false
      },
      tone: signals.liquidFunds >= agent.rentDue ? "warn" : "bad"
    });
  }

  if (agent.medicalDebt > 0) {
    const canCash = agent.money >= agent.medicalDebt;
    const canClear = !canCash && signals.liquidFunds >= agent.medicalDebt;
    const partialAmount = partialPaymentFrom(agent.medicalDebt);
    const savingsNeededToClear = Math.max(0, Math.round((agent.medicalDebt - agent.money) * 100) / 100);
    const mixedFundsCanClear = canClear && agent.money > 0 && savingsNeededToClear > 0;
    const mixedPaymentLabel = savingsNeededToClear > 0 ? "Use cash + savings for medical bill" : "Use savings for medical bill";
    if (canCash || canClear) {
      const clearanceBonus =
        mixedFundsCanClear
          ? 30 + agent.dna.discipline * 0.08 + Math.max(0, 620 - agent.budget.creditScore) * 0.025 + agent.budget.overdueBillDays * 4
          : canCash
            ? 16
            : 18;
      options.push({
        ...shared,
        id: canCash ? "civic.medical.cash.clear" : "civic.medical.liquid.clear",
        label: canCash ? "Clear medical bill" : mixedPaymentLabel,
        utility: baseUtility + clearanceBonus + (agent.health < 55 ? 8 : 0) + agent.values.security * 0.03,
        goal: "Clear medical bill",
        reason: canCash
          ? `${agent.medicalDebt} medical debt can be cleared from cash`
          : `${agent.money} cash plus ${savingsNeededToClear} savings can clear ${agent.medicalDebt} medical debt`,
        intent: {
          kind: "civic",
          strategy: canCash ? "pay_medical_cash" : "pay_medical_with_liquid_funds",
          label: canCash ? "Pay medical bill now" : "Combine cash and savings to clear care bill",
          billType: "medical",
          amount: agent.medicalDebt,
          paymentSource: canCash ? "cash" : "liquid",
          savingsAllowed: canClear
        },
        tone: canCash ? "good" : "warn"
      });
    }

    if (partialAmount > 0 && partialAmount < agent.medicalDebt) {
      const clearableDebtPenalty = canClear ? 26 + agent.dna.discipline * 0.06 : 0;
      options.push({
        ...shared,
        id: "civic.medical.partial.protected",
        label: "Pay part of medical bill",
        utility: baseUtility + 3 + Math.min(10, partialAmount * 0.28) + (agent.health < 55 ? 4 : 0) + agent.dna.risk * 0.02 - clearableDebtPenalty,
        goal: "Reduce medical debt",
        reason: canClear
          ? `${agent.medicalDebt} medical debt can be cleared with liquid funds; partial payment would keep debt open`
          : `${partialAmount} credits can reduce ${agent.medicalDebt} medical debt while preserving ${Math.round(reserveCash)} cash`,
        plan: ["Go to town hall", "Preserve a small cash buffer", "Reduce the care bill"],
        intent: {
          kind: "civic",
          strategy: "pay_medical_partial",
          label: "Make protected medical payment",
          billType: "medical",
          amount: partialAmount,
          paymentSource: "liquid",
          savingsAllowed: true,
          preserveCash: reserveCash
        },
        tone: "warn"
      });
    }

    options.push({
      ...shared,
      id: "civic.medical.review",
      label: signals.liquidFunds > 0 ? "Review medical bill" : "Face medical shortfall",
      utility: reviewUtility(agent.medicalDebt, canCash || canClear) + (agent.health < 45 ? -8 : 0),
      goal: "Review medical bill",
      reason:
        signals.liquidFunds > 0
          ? `${agent.medicalDebt} medical debt remains a choice against ${Math.round(signals.liquidFunds)} liquid credits`
          : `${agent.medicalDebt} medical debt is due, but no credits are available`,
      intent: {
        kind: "civic",
        strategy: "review_only",
        label: signals.liquidFunds > 0 ? "Delay medical payment" : "Assess medical debt",
        billType: "medical",
        amount: 0,
        paymentSource: "none",
        savingsAllowed: false
      },
      tone: signals.liquidFunds > 0 ? "warn" : "bad"
    });
  }

  if (agent.budget.livingCostDue > 0) {
    const canCash = agent.money >= agent.budget.livingCostDue;
    const canSavings = !canCash && signals.liquidFunds >= agent.budget.livingCostDue;
    const partialAmount = partialPaymentFrom(agent.budget.livingCostDue);
    if (canCash || canSavings) {
      options.push({
        ...shared,
        id: canCash ? "civic.living.cash.clear" : "civic.living.liquid.clear",
        label: canCash ? "Pay living costs" : "Use savings for living costs",
        utility: baseUtility + (canCash ? 13 : 8) + agent.values.security * 0.025,
        goal: "Handle living costs",
        reason: canCash
          ? `${agent.budget.livingCostDue} living costs due and cash can cover it`
          : `${agent.budget.livingCostDue} living costs due; savings can close the gap`,
        intent: {
          kind: "civic",
          strategy: canCash ? "pay_living_cash" : "pay_living_with_savings",
          label: canCash ? "Pay living costs now" : "Pull from savings for living costs",
          billType: "living",
          amount: agent.budget.livingCostDue,
          paymentSource: canCash ? "cash" : "liquid",
          savingsAllowed: canSavings
        },
        tone: canCash ? "good" : "warn"
      });
    }

    if (partialAmount > 0 && partialAmount < agent.budget.livingCostDue) {
      options.push({
        ...shared,
        id: "civic.living.partial",
        label: "Pay part of living costs",
        utility: baseUtility + 2 + Math.min(7, partialAmount * 0.3),
        goal: "Reduce living costs",
        reason: `${partialAmount} credits can reduce ${agent.budget.livingCostDue} living costs while preserving ${Math.round(reserveCash)} cash`,
        plan: ["Go to town hall", "Protect a small cash buffer", "Reduce the basics bill"],
        intent: {
          kind: "civic",
          strategy: "pay_living_partial",
          label: "Make protected basics payment",
          billType: "living",
          amount: partialAmount,
          paymentSource: "liquid",
          savingsAllowed: true,
          preserveCash: reserveCash
        },
        tone: "warn"
      });
    }

    options.push({
      ...shared,
      id: "civic.living.review",
      label: canCash || canSavings ? "Consider delaying basics" : "Review living-cost shortfall",
      utility: reviewUtility(agent.budget.livingCostDue, canCash || canSavings),
      goal: "Review living costs",
      reason:
        canCash || canSavings
          ? `${agent.budget.livingCostDue} living costs can be paid, but timing still matters`
          : `${agent.budget.livingCostDue} living costs due and ${Math.round(signals.liquidFunds)} liquid credits available`,
      intent: {
        kind: "civic",
        strategy: "review_only",
        label: canCash || canSavings ? "Delay basics payment" : "Assess living costs",
        billType: "living",
        amount: 0,
        paymentSource: "none",
        savingsAllowed: false
      },
      tone: canCash || canSavings ? "warn" : "bad"
    });
  }

  if (thisNeedsIncome(agent, signals)) {
    const due = Math.round((agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue) * 100) / 100;
    options.push({
      id: "civic.work_first",
      label: "Work before paying bills",
      action: "working",
      pointTypes: ["job_station"],
      targetMode: "job",
      utility: baseUtility + 14 + signals.moneyPressure * 0.42 + (agent.routine.workedToday ? -30 : 12),
      goal: "Earn before bills",
      reason: `${due} credits are due and only ${Math.round(signals.liquidFunds)} liquid credits are available`,
      plan: ["Go to work", "Earn credits", "Return to civic bills"],
      intent: {
        kind: "work",
        strategy: "earn_before_bills",
        label: "Earn before paying bills",
        billType: "none",
        paymentSource: "none",
        savingsAllowed: false
      },
      tone: "warn",
      tags: ["work", "bills", "money"]
    });
  }

  if (options.length === 0) {
    options.push({
      ...shared,
      id: "civic.account.review",
      label: "Review civic account",
      utility: baseUtility,
      goal: "Handle civic account",
      reason: "civic bills are not urgent",
      intent: { kind: "civic", strategy: "review_only", label: "Review account", billType: "none", savingsAllowed: false },
      tone: "neutral"
    });
  }

  return options;
};

const thisNeedsIncome = (agent: SimAgent, signals: AffordanceSignals) => {
  const due = agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue;
  return due > 0 && signals.liquidFunds < due && !agent.routine.workedToday;
};

const toneForUtility = (utility: number): AgentActionOptionTone => {
  if (utility >= 95) return "good";
  if (utility >= 62) return "neutral";
  if (utility >= 35) return "warn";
  return "bad";
};
