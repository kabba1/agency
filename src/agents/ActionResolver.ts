import type { ActionPoint } from "../shared/types";
import type {
  AgentEventKind,
  AgentEventTone,
  AgentFinancialCategory,
  AgentFinancialTone,
  AgentMemoryKind,
  AgentMoodletInput,
  AgentPlaceExperience,
  AgentSkillId,
  DayPhase,
  SimAgent
} from "./AgentSimulation";
import type { AgentActionIntent } from "./ActionAffordances";
import type { MemorySystem, MemoryWriteContext } from "./MemorySystem";
import type { ObjectServiceSnapshot, ObjectStateSystem } from "./ObjectStateSystem";
import type { RelationshipRuntimeContext, RelationshipSystem, SocialPerceptionCue } from "./RelationshipSystem";
import { clamp, distance2d, type ObjectUseDelta } from "./SimulationPrimitives";

export type ActionResolverContext = {
  currentPhase: DayPhase;
  currentDay: number;
  worldTime: string;
  worldMinutes: number;
  agents: readonly SimAgent[];
  memory: MemorySystem;
  memoryContext: MemoryWriteContext;
  objectStates: ObjectStateSystem;
  relationship: RelationshipSystem;
  relationshipContext: RelationshipRuntimeContext;
  addMemory: (agent: SimAgent, kind: AgentMemoryKind, text: string, importance: number, tags: string[]) => void;
  log: (agent: SimAgent, text: string, kind?: AgentEventKind, tone?: AgentEventTone, importance?: number) => void;
  transact: (agent: SimAgent, amount: number, category: AgentFinancialCategory, label: string, tone?: AgentFinancialTone) => number;
  recordFinance: (agent: SimAgent, amount: number, category: AgentFinancialCategory, label: string, tone: AgentFinancialTone) => void;
  depositSavings: (agent: SimAgent, amount: number, label: string) => number;
  withdrawSavings: (agent: SimAgent, amount: number, label: string) => number;
  advanceAspiration: (agent: SimAgent, amount: number, label: string, signals: string[]) => number;
  advanceSkill: (agent: SimAgent, skillId: AgentSkillId, amount: number, label: string, tags?: string[]) => { xpGain: number; leveled: boolean; level: number };
  adjustCredit: (agent: SimAgent, amount: number, reason: string) => void;
  recordPlaceExperience: (agent: SimAgent, experience: AgentPlaceExperience) => void;
  recordActivityExperience: (agent: SimAgent, experience: AgentPlaceExperience) => void;
  addMoodlet: (agent: SimAgent, moodlet: AgentMoodletInput) => void;
  absorbCivicNotice: (agent: SimAgent, channel: "mail" | "civic" | "social" | "public") => boolean;
};

type ServiceRelief = {
  score: number;
  demandResolved: number;
  pressureRelieved: number;
  stockRestored: number;
  cleanlinessImproved: number;
};

export class ActionResolver {
  private totalBillsDue(agent: SimAgent) {
    return Math.round((agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue) * 100) / 100;
  }

  private applyAutonomy(
    agent: SimAgent,
    context: ActionResolverContext,
    change: { dignity?: number; control?: number; overwhelm?: number; note: string }
  ) {
    agent.autonomy.dignity = Math.round(clamp(agent.autonomy.dignity + (change.dignity ?? 0)));
    agent.autonomy.control = Math.round(clamp(agent.autonomy.control + (change.control ?? 0)));
    agent.autonomy.overwhelm = Math.round(clamp(agent.autonomy.overwhelm + (change.overwhelm ?? 0)));
    agent.autonomy.lastChoiceWorldTime = context.worldTime;
    agent.autonomy.recent.unshift(`${context.worldTime} ${change.note}`);
    agent.autonomy.recent.splice(4);
    agent.routine.autonomyMomentsToday += Math.max(0, Math.round(((change.control ?? 0) + Math.max(0, -(change.overwhelm ?? 0))) / 8));
  }

  resolve(agent: SimAgent, context: ActionResolverContext) {
    const noticeChannel = this.noticeChannelFor(agent);
    switch (agent.currentAction) {
      case "sleeping":
        const sleepHomeSkill = this.skillEffect(agent, "homecraft");
        const sleepDebtBefore = agent.sleep.sleepDebt;
        const circadianBefore = agent.sleep.circadianFatigue;
        const sleepEnergy = Math.round(clamp(34 + agent.household.sleepQuality * 0.24 + agent.household.homeComfort * 0.08 + sleepHomeSkill * 0.1, 30, 64));
        const sleepStressRelief = Math.round(clamp(10 + agent.household.sleepQuality * 0.12 + sleepHomeSkill * 0.06, 8, 25));
        const sleepDebtRelief = Math.round(clamp(30 + agent.household.sleepQuality * 0.34 + sleepHomeSkill * 0.08, 28, 72));
        const circadianRelief = Math.round(clamp(22 + agent.household.sleepQuality * 0.3 + (context.currentPhase === "night" ? 8 : -4), 12, 64));
        agent.routine.sleptToday = true;
        agent.energy = clamp(agent.energy + sleepEnergy);
        agent.hunger = clamp(agent.hunger + 8);
        agent.stress = clamp(agent.stress - sleepStressRelief);
        agent.comfort = clamp(agent.comfort + 12 + agent.household.homeComfort * 0.08);
        agent.mood = clamp(agent.mood + (agent.household.sleepQuality >= 68 ? 7 : 3));
        agent.sleep.sleepDebt = Math.round(clamp(agent.sleep.sleepDebt - sleepDebtRelief));
        agent.sleep.circadianFatigue = Math.round(clamp(agent.sleep.circadianFatigue - circadianRelief));
        agent.sleep.hoursSleptLastNight = Math.round(clamp(4.2 + agent.household.sleepQuality * 0.048 + sleepHomeSkill * 0.012 - sleepDebtBefore * 0.014, 3.4, 9.2) * 10) / 10;
        agent.sleep.lastSleepWorldTime = context.worldTime;
        agent.sleep.recent.unshift(
          `${context.worldTime} Slept ${agent.sleep.hoursSleptLastNight}h: debt ${Math.round(sleepDebtBefore)} -> ${agent.sleep.sleepDebt}, rhythm ${Math.round(circadianBefore)} -> ${agent.sleep.circadianFatigue}.`
        );
        agent.sleep.recent.splice(4);
        this.applyAutonomy(agent, context, { control: 8, dignity: agent.household.sleepQuality >= 58 ? 2 : 0, overwhelm: -13, note: "Sleep restored a sense of control." });
        agent.household.clutter = Math.round(clamp(agent.household.clutter + 4));
        agent.household.laundry = Math.round(clamp(agent.household.laundry + 3));
        agent.household.homeComfort = Math.round(clamp(agent.household.homeComfort + (agent.household.sleepQuality >= 68 ? 2 : -1)));
        agent.household.sleepQuality = Math.round(clamp(agent.household.sleepQuality * 0.76 + (70 - agent.household.clutter * 0.15 - agent.household.laundry * 0.08) * 0.24));
        this.easeMinorIllness(agent, 18 + sleepHomeSkill * 0.06, context, "sleep and stable home care");
        context.addMoodlet(agent, {
          id: agent.household.sleepQuality >= 68 ? "rested-well" : "rough-sleep",
          label: agent.household.sleepQuality >= 68 ? "Rested Well" : "Rough Sleep",
          detail: `sleep quality ${agent.household.sleepQuality}, debt ${agent.sleep.sleepDebt}`,
          tone: agent.household.sleepQuality >= 68 ? "good" : "warn",
          intensity: agent.household.sleepQuality >= 68 ? 5.5 : 4,
          durationMinutes: agent.household.sleepQuality >= 68 ? 210 : 150,
          tags: ["sleep", "home", "energy"],
          actionBiases: agent.household.sleepQuality >= 68 ? { working: 8, socializing: 5 } : { resting: 12, sleeping: 10, working: -8 }
        });
        this.addHouseholdNote(agent, agent.household.sleepQuality >= 68 ? "Rested well at home." : "Slept, but home conditions dragged at the edges.", context);
        context.relationship.adjustReputation(agent, { trouble: -1 });
        this.recordObjectUse(agent, context, { cleanlinessDelta: -3, wearDelta: 1, heatDelta: 5 });
        context.advanceSkill(agent, "homecraft", 1.8, "Learned what helps sleep at home", ["sleep", "home"]);
        context.advanceAspiration(agent, 4, "Protected rest at home", ["home", "comfort", "wellness", "routine"]);
        context.addMemory(agent, "event", `Slept at home with ${agent.household.sleepQuality} sleep quality and ${agent.sleep.sleepDebt} sleep debt left.`, 6, ["sleep", "home"]);
        context.log(agent, `${agent.name} slept at home and woke up ${agent.household.sleepQuality >= 68 ? "steadier" : "a little worn"}.`, "home", agent.household.sleepQuality >= 68 ? "good" : "neutral", 6);
        break;
      case "eating":
        this.eatFromInventory(agent, context);
        break;
      case "washing":
        this.washUp(agent, context);
        break;
      case "cleaning":
        this.cleanHome(agent, context);
        break;
      case "working":
        this.workShift(agent, context);
        break;
      case "calling_in_sick":
        this.callInSick(agent, context);
        break;
      case "shopping":
        if (agent.target?.intent?.kind === "home" && agent.target.intent.strategy.startsWith("buy_")) this.buyHouseholdSupplies(agent, context);
        else this.buyFood(agent, context);
        break;
      case "socializing":
        this.socialize(agent, context);
        break;
      case "healing":
        if (agent.target?.intent?.kind === "health" && agent.target.intent.strategy === "take_aftercare_medicine") this.followAftercare(agent, context);
        else this.visitClinic(agent, context);
        break;
      case "resting":
        const comfortSkill = this.skillEffect(agent, "homecraft");
        const restLeisure = this.applyLeisure(agent, context, {
          label: this.restLeisureLabel(agent),
          fun: 14 + (agent.leisure.hobby === "reading" || agent.leisure.hobby === "games" || agent.leisure.hobby === "people_watching" ? 6 : 2),
          boredom: -20,
          curiosity: agent.leisure.hobby === "reading" || agent.leisure.hobby === "people_watching" ? -4 : -1,
          mood: 2,
          stress: -2,
          tags: ["rest", "hobby", agent.leisure.hobby]
        });
        agent.energy = clamp(agent.energy + 12 + comfortSkill * 0.12);
        agent.stress = clamp(agent.stress - (16 + comfortSkill * 0.18));
        agent.comfort = clamp(agent.comfort + 10 + comfortSkill * 0.16);
        agent.mood = clamp(agent.mood + 7 + comfortSkill * 0.08);
        this.applyAutonomy(agent, context, { control: 10, dignity: 1, overwhelm: -12, note: "A quiet reset made the day feel manageable." });
        this.easeMinorIllness(agent, 12 + comfortSkill * 0.05, context, "a quiet rest");
        context.addMoodlet(agent, {
          id: "calmed-down",
          label: "Calmed Down",
          detail: "a quiet reset took the edge off",
          tone: "good",
          intensity: 4.5,
          durationMinutes: 160,
          tags: ["rest", "comfort", "stress"],
          actionBiases: { socializing: 5, working: 4, resting: -5 }
        });
        context.relationship.adjustReputation(agent, { trouble: -1 });
        this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 4 });
        context.advanceSkill(agent, "homecraft", 1.5, "Found a better way to reset", ["rest", "comfort"]);
        context.advanceAspiration(agent, 3, "Took a calm reset", ["comfort", "wellness", "mood", "routine"]);
        context.addMemory(agent, "event", `Took a quiet pause to settle down. ${restLeisure}`, 5, ["rest", "mood", "leisure"]);
        context.log(agent, `${agent.name} took a quiet break and looked calmer.`, "routine", "good", 5);
        if (
          context.relationship.activeEveningPlan(agent, context.currentPhase, context.currentDay)?.intent === "decompress" ||
          context.relationship.activeEveningPlan(agent, context.currentPhase, context.currentDay)?.intent === "avoid_rival"
        ) {
          context.relationship.markEveningPlanOutcome(agent, "quiet", "kept the evening quiet and stress dropped", context.relationshipContext);
        }
        break;
      case "checking_mail":
        this.checkMail(agent, context);
        break;
      case "budgeting":
        this.reviewBudget(agent, context);
        break;
      case "paying_rent":
        this.handleCivicBills(agent, context);
        break;
      case "hospitalized":
        break;
      case "building":
        const laborSkill = this.skillEffect(agent, "labor");
        this.applyLeisure(agent, context, {
          label: agent.leisure.hobby === "crafting" ? "sketched build ideas" : "followed curiosity at a future lot",
          fun: agent.leisure.hobby === "crafting" ? 12 : 7,
          boredom: -12,
          curiosity: -24,
          mood: 2,
          stress: -1,
          tags: ["build", "curiosity", agent.leisure.hobby]
        });
        agent.mood = clamp(agent.mood + 4 + laborSkill * 0.08);
        agent.energy = clamp(agent.energy - Math.max(4, 7 - laborSkill * 0.08));
        agent.stress = clamp(agent.stress - (2 + laborSkill * 0.08));
        this.applyAutonomy(agent, context, { control: 5, dignity: 2, overwhelm: -2, note: "Thinking about a future build restored agency." });
        context.relationship.adjustReputation(agent, { ambition: 4 });
        this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 1, heatDelta: 8 });
        context.advanceSkill(agent, "labor", 3.2, "Studied a future build site", ["build", "labor"]);
        context.advanceSkill(agent, "civic", 1.2, "Read land rules", ["build", "civic"]);
        context.advanceAspiration(agent, 5, "Inspected a future build site", ["build", "future", "ambition"]);
        context.addMoodlet(agent, {
          id: "future-idea",
          label: "Future Idea",
          detail: "a buildable place sparked ambition",
          tone: "neutral",
          intensity: 3.5,
          durationMinutes: 240,
          tags: ["build", "future", "ambition"],
          actionBiases: { working: 4, building: 8, budgeting: 4 }
        });
        context.addMemory(agent, "event", "Inspected the buildable lot and imagined a future structure.", 5, ["build", "plot"]);
        context.log(agent, `${agent.name} inspected a future plot opportunity.`, "city", "neutral", 5);
        break;
      default:
        break;
    }
    if (noticeChannel) context.absorbCivicNotice(agent, noticeChannel);
    context.memory.reflect(agent, (predicate) => context.relationship.strongestRelationship(agent, predicate), context.memoryContext);
  }

  private noticeChannelFor(agent: SimAgent): "mail" | "civic" | "social" | "public" | null {
    switch (agent.currentAction) {
      case "checking_mail":
        return "mail";
      case "budgeting":
      case "paying_rent":
        return "civic";
      case "socializing":
        return "social";
      case "shopping":
      case "healing":
        return "public";
      case "resting":
        return agent.target?.actionPointType === "home_anchor" ? null : "public";
      case "working":
        return ["desk", "mailbox", "notice_board", "register", "shelf", "vending_machine", "clinic_bed", "medicine_cabinet", "storage", "workbench", "job_station"].includes(
          agent.target?.actionPointType ?? ""
        )
          ? "public"
          : null;
      case "building":
        return agent.target?.actionPointType === "notice_board" ? "civic" : null;
      default:
        return null;
    }
  }

  private eatFromInventory(agent: SimAgent, context: ActionResolverContext) {
    const homeSkill = this.skillEffect(agent, "homecraft");
    const foodIndex = agent.inventory.findIndex((item) => item === "meal" || item === "groceries");
    if (foodIndex >= 0) {
      const [food] = agent.inventory.splice(foodIndex, 1);
      agent.hunger = clamp(agent.hunger - (food === "groceries" ? 44 : 34) - homeSkill * 0.09);
      agent.energy = clamp(agent.energy + 4 + homeSkill * 0.05);
      agent.comfort = clamp(agent.comfort + 7 + homeSkill * 0.08);
      agent.mood = clamp(agent.mood + 5 + homeSkill * 0.06);
      this.recordMeal(agent, context, {
        label: food === "groceries" ? "home groceries" : "stored meal",
        quality: food === "groceries" ? 72 + homeSkill * 0.08 : 54 + homeSkill * 0.04,
        hydration: food === "groceries" ? 18 : 10,
        variety: food === "groceries" ? 68 : 42,
        fullness: food === "groceries" ? 66 : 54
      });
      agent.routine.ateToday = true;
      agent.routine.mealsToday += 1;
      context.relationship.adjustReputation(agent, { reliability: 1 });
      this.recordObjectUse(agent, context, { cleanlinessDelta: -3, wearDelta: 0.5, heatDelta: 5 });
      context.advanceSkill(agent, "homecraft", 1.4, "Made stored food go further", ["food", "home"]);
      context.advanceAspiration(agent, 2.4, "Ate enough to stay functional", ["food", "home", "wellness", "routine"]);
      context.addMoodlet(agent, {
        id: "fed",
        label: "Fed",
        detail: "food made the next few hours easier",
        tone: "good",
        intensity: 4.5,
        durationMinutes: 180,
        tags: ["food", "wellness"],
        actionBiases: { working: 5, socializing: 4, shopping: -8 }
      });
      context.addMemory(agent, "event", `Ate ${food === "groceries" ? "groceries from home" : "a meal"} and felt less distracted.`, 7, ["food", "home"]);
      context.log(agent, `${agent.name} ate at home before heading back out.`, "food", "good", 7);
      return;
    }

    if (agent.household.pantry > 0) {
      agent.household.pantry -= 1;
      agent.hunger = clamp(agent.hunger - 32 - homeSkill * 0.09);
      agent.energy = clamp(agent.energy + 3 + homeSkill * 0.04);
      agent.comfort = clamp(agent.comfort + 6 + homeSkill * 0.08);
      agent.mood = clamp(agent.mood + 4 + homeSkill * 0.05);
      agent.household.clutter = Math.round(clamp(agent.household.clutter + Math.max(2, 5 - homeSkill * 0.05)));
      this.recordMeal(agent, context, {
        label: "pantry meal",
        quality: 60 + homeSkill * 0.08,
        hydration: 14,
        variety: 52 + homeSkill * 0.04,
        fullness: 56
      });
      agent.routine.ateToday = true;
      agent.routine.mealsToday += 1;
      context.relationship.adjustReputation(agent, { reliability: 1 });
      this.recordObjectUse(agent, context, { cleanlinessDelta: -4, wearDelta: 0.5, heatDelta: 5 });
      context.advanceSkill(agent, "homecraft", 1.5, "Prepared a pantry meal", ["food", "home", "pantry"]);
      this.addHouseholdNote(agent, `Ate from the pantry. ${agent.household.pantry}/${agent.household.pantryCapacity} meals left.`, context);
      context.advanceAspiration(agent, 2.4, "Ate enough to stay functional", ["food", "home", "wellness", "routine"]);
      context.addMoodlet(agent, {
        id: "fed",
        label: "Fed",
        detail: "a pantry meal took hunger off the front burner",
        tone: "good",
        intensity: 4,
        durationMinutes: 160,
        tags: ["food", "home", "wellness"],
        actionBiases: { working: 4, socializing: 3, shopping: -6 }
      });
      context.addMemory(agent, "event", "Ate from the home pantry and felt less distracted.", 7, ["food", "home", "pantry"]);
      context.log(agent, `${agent.name} ate from the home pantry.`, "food", "good", 7);
      return;
    }

    agent.mood = clamp(agent.mood - 5);
    agent.stress = clamp(agent.stress + 6);
    context.addMoodlet(agent, {
      id: "empty-pantry-hit",
      label: "Empty Pantry",
      detail: "checking home made the food problem feel real",
      tone: "warn",
      intensity: 5,
      durationMinutes: 180,
      tags: ["food", "home", "scarcity"],
      actionBiases: { shopping: 16, working: 8, resting: -8, socializing: -6 }
    });
    context.addMemory(agent, "event", "Checked for food at home but had nothing stored.", 7, ["food", "money"]);
    context.log(agent, `${agent.name} checked home for food and found nothing.`, "food", "warn", 7);
  }

  private washUp(agent: SimAgent, context: ActionResolverContext) {
    const homeSkill = this.skillEffect(agent, "homecraft");
    const intent = agent.target?.intent?.kind === "home" ? agent.target.intent : null;
    const strategy = intent?.strategy ?? "wash_hygiene";
    const doingLaundry = strategy === "do_laundry";
    const supplyKind = doingLaundry ? "cleaningSupplies" : "toiletries";
    const hadSupply = this.consumeHouseholdSupply(agent, supplyKind, 1);
    const supplyFactor = hadSupply ? 1 : doingLaundry ? 0.38 : 0.52;
    const clutterBefore = agent.household.clutter;
    const laundryBefore = agent.household.laundry;
    const hygieneGain = (doingLaundry ? 10 + homeSkill * 0.04 : 42 + homeSkill * 0.12) * supplyFactor;
    const clutterCleaned = (doingLaundry ? 4 + homeSkill * 0.08 : 3 + homeSkill * 0.05) * supplyFactor;
    const laundryCleaned = (doingLaundry ? 30 + homeSkill * 0.35 : 2 + homeSkill * 0.04) * supplyFactor;
    agent.hygiene = clamp(agent.hygiene + hygieneGain);
    agent.household.clutter = Math.round(clamp(agent.household.clutter - clutterCleaned));
    agent.household.laundry = Math.round(clamp(agent.household.laundry - laundryCleaned));
    agent.household.homeComfort = Math.round(clamp(agent.household.homeComfort + ((doingLaundry ? 6 : 3) + homeSkill * 0.08) * (hadSupply ? 1 : 0.45)));
    agent.household.choresDoneToday += 1;
    agent.household.lastHomeCare = context.worldTime;
    const outfitBefore = { cleanliness: agent.outfit.cleanliness, wear: agent.outfit.wear };
    if (doingLaundry) {
      const cleanGain = hadSupply ? 38 + homeSkill * 0.08 : 12 + homeSkill * 0.03;
      const wearGain = hadSupply ? -5 : -1;
      this.applyOutfitChange(
        agent,
        cleanGain,
        wearGain,
        hadSupply ? 5 : 1,
        `${hadSupply ? "Laundry refreshed" : "Laundry tried with thin supplies"}: outfit clean ${Math.round(outfitBefore.cleanliness)}->${Math.round(clamp(outfitBefore.cleanliness + cleanGain))}, wear ${Math.round(outfitBefore.wear)}->${Math.round(clamp(outfitBefore.wear + wearGain))}.`,
        context
      );
    } else {
      const cleanGain = hadSupply ? 8 + homeSkill * 0.03 : 3;
      this.applyOutfitChange(
        agent,
        cleanGain,
        0.4,
        hadSupply ? 2 : -1,
        `${hadSupply ? "Freshened up" : "Rough wash"}: outfit clean ${Math.round(outfitBefore.cleanliness)}->${Math.round(clamp(outfitBefore.cleanliness + cleanGain))}.`,
        context
      );
    }
    agent.energy = clamp(agent.energy - (doingLaundry ? Math.max(2, 5 - homeSkill * 0.03) : 0) - (hadSupply ? 0 : 2));
    agent.comfort = clamp(agent.comfort + (hadSupply ? (doingLaundry ? 7 : 5) : 1));
    agent.stress = clamp(agent.stress + (hadSupply ? -(doingLaundry ? 6 : 5) : 2));
    agent.mood = clamp(agent.mood + (hadSupply ? (doingLaundry ? 4 : 3) : -1));
    this.applyAutonomy(agent, context, {
      dignity: hadSupply ? (doingLaundry ? 8 : 7) : 3,
      control: doingLaundry ? 4 : 3,
      overwhelm: hadSupply ? -5 : -1,
      note: doingLaundry ? "Laundry restored public confidence." : "Washing up restored self-respect."
    });
    this.easeMinorIllness(agent, doingLaundry ? 4 + homeSkill * 0.02 : 10 + homeSkill * 0.04, context, doingLaundry ? "clean clothes lowering home exposure" : "washing up and lowering exposure");
    if (!doingLaundry || agent.hygiene >= 55) agent.routine.washedToday = true;
    context.relationship.adjustReputation(agent, { reliability: 1 });
    this.recordObjectUse(agent, context, {
      cleanlinessDelta: hadSupply ? (doingLaundry ? 5 : -5) : -3,
      wearDelta: 1,
      heatDelta: doingLaundry ? 7 : 5,
      issue: hadSupply ? undefined : doingLaundry ? "Laundry supply shortage" : "Toiletry shortage"
    });
    const skillResult = context.advanceSkill(agent, "homecraft", doingLaundry ? 3.8 : 2.6, doingLaundry ? "Handled laundry" : "Handled hygiene", [
      "home",
      doingLaundry ? "laundry" : "hygiene",
      "routine"
    ]);
    context.advanceAspiration(agent, doingLaundry ? 3.4 : 2.4, doingLaundry ? "Kept laundry from taking over" : "Kept a basic routine clean", [
      "home",
      doingLaundry ? "laundry" : "hygiene",
      "stability",
      "routine"
    ]);
    context.addMoodlet(agent, {
      id: hadSupply ? (doingLaundry ? "laundry-done" : "freshened-up") : doingLaundry ? "laundry-short-supplies" : "washed-without-toiletries",
      label: hadSupply ? (doingLaundry ? "Laundry Done" : "Freshened Up") : doingLaundry ? "Short On Laundry Supplies" : "Rough Wash",
      detail: hadSupply ? (doingLaundry ? "clean clothes made home feel less heavy" : "clean enough to face people") : "the routine worked, but not well",
      tone: hadSupply ? "good" : "warn",
      intensity: hadSupply ? (doingLaundry ? 4.5 : 3.5) : 4,
      durationMinutes: doingLaundry ? 240 : 180,
      tags: [doingLaundry ? "laundry" : "hygiene", "home", "routine"],
      actionBiases: hadSupply ? (doingLaundry ? { sleeping: 5, resting: 4, washing: -12 } : { socializing: 6, working: 4, washing: -10 }) : { shopping: 14, working: 6, washing: -3 }
    });
    this.addHouseholdNote(
      agent,
      doingLaundry
        ? `${hadSupply ? "Did laundry" : "Tried laundry without enough supplies"}: laundry ${Math.round(laundryBefore)}->${agent.household.laundry}, clutter ${Math.round(clutterBefore)}->${agent.household.clutter}.`
        : `${hadSupply ? "Washed up" : "Washed up without toiletries"}: hygiene ${Math.round(agent.hygiene)}, clutter ${Math.round(clutterBefore)}->${agent.household.clutter}.`,
      context
    );
    context.addMemory(agent, "event", doingLaundry ? "Did laundry at home and made the apartment feel lighter." : "Washed up at home and felt more ready for public life.", 5, [
      "home",
      doingLaundry ? "laundry" : "hygiene",
      "chores"
    ]);
    context.log(
      agent,
      `${agent.name} ${doingLaundry ? "did laundry" : "washed up"} at home${hadSupply ? "" : ", but supplies were thin"}${skillResult.leveled ? " with a better homecare rhythm" : ""}.`,
      "home",
      hadSupply ? "good" : "warn",
      5
    );
  }

  private cleanHome(agent: SimAgent, context: ActionResolverContext) {
    const homeSkill = this.skillEffect(agent, "homecraft");
    const intent = agent.target?.intent?.kind === "home" ? agent.target.intent : null;
    const strategy = intent?.strategy ?? "reset_home";
    const clutterBefore = agent.household.clutter;
    const laundryBefore = agent.household.laundry;
    const sleepBefore = agent.household.sleepQuality;
    const deepClean = strategy === "deep_clean";
    const sleepPrep = strategy === "sleep_prep";
    const tidyOnly = strategy === "tidy_clutter";
    const usesCleaningSupply = !sleepPrep;
    const hadCleaningSupply = usesCleaningSupply ? this.consumeHouseholdSupply(agent, "cleaningSupplies", deepClean ? 2 : 1) : true;
    const supplyFactor = hadCleaningSupply ? 1 : 0.46;
    const clutterCleaned = (sleepPrep ? 8 + homeSkill * 0.12 : deepClean ? 26 + homeSkill * 0.34 : tidyOnly ? 24 + homeSkill * 0.3 : 18 + homeSkill * 0.28) * supplyFactor;
    const laundryCleaned = (sleepPrep ? 5 + homeSkill * 0.08 : deepClean ? 20 + homeSkill * 0.26 : tidyOnly ? 4 + homeSkill * 0.08 : 14 + homeSkill * 0.22) * supplyFactor;
    const sleepGain = (sleepPrep ? 16 + homeSkill * 0.18 : deepClean ? 10 + homeSkill * 0.12 : tidyOnly ? 4 + homeSkill * 0.08 : 8 + homeSkill * 0.1) * supplyFactor;
    const comfortGain = (sleepPrep ? 6 + homeSkill * 0.08 : deepClean ? 10 + homeSkill * 0.14 : tidyOnly ? 6 + homeSkill * 0.1 : 7 + homeSkill * 0.12) * supplyFactor;
    const energyCost =
      (sleepPrep ? Math.max(2, 4 - homeSkill * 0.04) : deepClean ? Math.max(6, 12 - homeSkill * 0.07) : tidyOnly ? Math.max(3, 7 - homeSkill * 0.06) : Math.max(4, 8 - homeSkill * 0.06)) +
      (usesCleaningSupply && !hadCleaningSupply ? 2 : 0);
    agent.household.clutter = Math.round(clamp(agent.household.clutter - clutterCleaned));
    agent.household.laundry = Math.round(clamp(agent.household.laundry - laundryCleaned));
    agent.household.sleepQuality = Math.round(clamp(agent.household.sleepQuality + sleepGain + Math.max(0, clutterBefore - agent.household.clutter) * (sleepPrep ? 0.04 : 0.08)));
    agent.household.homeComfort = Math.round(clamp(agent.household.homeComfort + comfortGain));
    agent.household.choresDoneToday += 1;
    agent.energy = clamp(agent.energy - energyCost);
    agent.hygiene = clamp(agent.hygiene - (deepClean ? Math.max(2, 5 - homeSkill * 0.03) : tidyOnly ? Math.max(1, 3 - homeSkill * 0.03) : 1));
    if (!sleepPrep) {
      this.applyOutfitChange(agent, deepClean ? -8 : tidyOnly ? -4 : -5, deepClean ? 2.2 : 1.1, -1, undefined, context);
    }
    agent.comfort = clamp(agent.comfort + ((sleepPrep ? 7 : deepClean ? 10 : 8) + homeSkill * 0.1) * (hadCleaningSupply ? 1 : 0.45));
    agent.stress = clamp(agent.stress + (hadCleaningSupply ? -((sleepPrep ? 6 : deepClean ? 9 : 7) + homeSkill * 0.12) : 2));
    agent.mood = clamp(agent.mood + (hadCleaningSupply ? (sleepPrep ? 2 : 3) + homeSkill * 0.06 : -1));
    this.applyAutonomy(agent, context, {
      dignity: hadCleaningSupply ? (deepClean ? 4 : 2) : 1,
      control: hadCleaningSupply ? (sleepPrep ? 7 : deepClean ? 10 : 8) : 4,
      overwhelm: hadCleaningSupply ? (sleepPrep ? -5 : deepClean ? -9 : -7) : -2,
      note: sleepPrep ? "Sleep space felt under control." : deepClean ? "Deep cleaning made home feel manageable." : "Tidying reduced the mental pileup."
    });
    context.relationship.adjustReputation(agent, { reliability: 2, trouble: -1 });
    this.recordObjectUse(agent, context, {
      cleanlinessDelta: hadCleaningSupply ? (deepClean ? 16 : tidyOnly ? 9 : 10) : 3,
      wearDelta: -0.25,
      heatDelta: sleepPrep ? -1 : -3,
      issue: usesCleaningSupply && !hadCleaningSupply ? "Cleaning supply shortage" : undefined
    });
    const label = sleepPrep ? "Prepped sleep space" : deepClean ? "Deep cleaned home" : tidyOnly ? "Tidied clutter" : "Reset home";
    const skillResult = context.advanceSkill(agent, "homecraft", deepClean ? 4.8 : sleepPrep ? 3.4 : 4.1, label, ["home", "chores", "comfort"]);
    context.advanceAspiration(agent, deepClean ? 4.8 : sleepPrep ? 3.6 : 4.2, sleepPrep ? "Protected tonight's rest" : "Made home easier to live in", [
      "home",
      "comfort",
      "stability",
      "routine"
    ]);
    context.addMoodlet(agent, {
      id: hadCleaningSupply ? (sleepPrep ? "sleep-prepped" : deepClean ? "deep-cleaned" : tidyOnly ? "clutter-cleared" : "home-reset") : "cleaned-without-supplies",
      label: hadCleaningSupply ? (sleepPrep ? "Sleep Prepped" : deepClean ? "Deep Cleaned" : tidyOnly ? "Clutter Cleared" : "Home Reset") : "Low Cleaning Supplies",
      detail: hadCleaningSupply ? (sleepPrep ? "the bed area should rest better tonight" : deepClean ? "the apartment feels genuinely livable" : "the room feels easier to live in") : "chores helped, but supplies limited the result",
      tone: hadCleaningSupply ? "good" : "warn",
      intensity: hadCleaningSupply ? (deepClean ? 5.5 : sleepPrep ? 4.2 : 4.5) : 4,
      durationMinutes: deepClean ? 340 : sleepPrep ? 240 : 260,
      tags: ["home", "comfort", "cleaning"],
      actionBiases: hadCleaningSupply ? (sleepPrep ? { sleeping: 14, resting: 5, cleaning: -8 } : { sleeping: 8, resting: 5, cleaning: -10 }) : { shopping: 14, working: 6, cleaning: -4 }
    });
    this.addHouseholdNote(
      agent,
      `${hadCleaningSupply ? label : `${label} with low supplies`}: clutter ${Math.round(clutterBefore)}->${agent.household.clutter}, laundry ${Math.round(laundryBefore)}->${agent.household.laundry}, sleep ${Math.round(sleepBefore)}->${agent.household.sleepQuality}.`,
      context
    );
    context.addMemory(
      agent,
      "event",
      `${label} enough to make home feel easier${hadCleaningSupply ? "" : ", though missing supplies limited the work"}${skillResult.leveled ? " and got better at home routines" : ""}.`,
      6,
      ["home", "chores", "comfort"]
    );
    context.log(
      agent,
      `${agent.name} ${sleepPrep ? "prepped the bed area" : deepClean ? "deep cleaned home" : tidyOnly ? "tidied clutter" : "reset their home"}${hadCleaningSupply ? "" : ", but needed more supplies"}.`,
      "home",
      hadCleaningSupply ? "good" : "warn",
      6
    );
  }

  private callInSick(agent: SimAgent, context: ActionResolverContext) {
    context.absorbCivicNotice(agent, "public");
    const illness = agent.medical.minorIllness;
    const aftercare = agent.medical.aftercare;
    const reason = aftercare.active
      ? aftercare.label ?? "aftercare"
      : illness.active
        ? illness.label ?? "illness"
        : agent.health < 62
          ? `low health ${Math.round(agent.health)}`
          : "feeling run down";
    const paidSickLeave = agent.career.attendanceStreak >= 2 || agent.career.performance >= 66;
    const sickPay = paidSickLeave ? Math.max(2, Math.round(agent.career.wage * 0.42)) : 0;
    if (sickPay > 0) context.transact(agent, sickPay, "income", "Sick leave pay");

    agent.routine.sickLeaveToday = true;
    agent.routine.sickLeaveReason = reason;
    agent.routine.earningsToday += sickPay;
    agent.career.attendanceStreak = 0;
    agent.career.performance = Math.round(clamp(agent.career.performance - (paidSickLeave ? 1 : 3)));
    agent.career.satisfaction = Math.round(clamp(agent.career.satisfaction + (paidSickLeave ? 2 : -1)));
    agent.career.burnout = Math.round(clamp(agent.career.burnout - 9));
    agent.energy = clamp(agent.energy + 9);
    agent.health = clamp(agent.health + 4);
    agent.stress = clamp(agent.stress - (paidSickLeave ? 10 : 6));
    agent.mood = clamp(agent.mood + (paidSickLeave ? 3 : 1));
    this.applyAutonomy(agent, context, {
      dignity: paidSickLeave ? 4 : 2,
      control: paidSickLeave ? 7 : 4,
      overwhelm: paidSickLeave ? -8 : -4,
      note: paidSickLeave ? "Calling in sick kept health and standing intact." : "Calling in sick kept the day honest."
    });
    if (aftercare.active) aftercare.restMinutesRemaining = Math.max(0, Math.round((aftercare.restMinutesRemaining - 35) * 10) / 10);
    const illnessImproved = this.easeMinorIllness(agent, 10, context, "calling in sick and resting");
    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.2, heatDelta: 2 });
    context.relationship.adjustReputation(agent, { reliability: paidSickLeave ? 1 : -1, trouble: -1 });
    context.advanceSkill(agent, "civic", paidSickLeave ? 2.2 : 1.4, "Handled a sick day instead of ghosting work", ["work", "health", "routine"]);
    context.advanceAspiration(agent, 3.8, "Protected health and work standing", ["health", "work", "stability"]);
    agent.career.recent.unshift(`${context.worldTime} Called in sick${sickPay > 0 ? ` / +${sickPay} sick pay` : ""}.`);
    agent.career.recent.splice(4);
    context.addMoodlet(agent, {
      id: "called-in-sick",
      label: paidSickLeave ? "Paid Sick Day" : "Sick Day",
      detail: paidSickLeave ? `${sickPay} credits sick pay, recovery protected` : "work was notified, but the shift was unpaid",
      tone: paidSickLeave ? "good" : "warn",
      intensity: paidSickLeave ? 4.5 : 4,
      durationMinutes: 280,
      tags: ["work", "health", "career"],
      actionBiases: { resting: 16, healing: aftercare.active ? 12 : 6, working: -18, sleeping: 8 },
      stressDelta: paidSickLeave ? -2 : 0
    });
    context.addMemory(
      agent,
      "event",
      `Called in sick because of ${reason}${sickPay > 0 ? ` and received ${sickPay} sick pay` : ""}${illnessImproved ? "; symptoms eased a bit" : ""}.`,
      7,
      ["work", "health", "career"]
    );
    context.log(
      agent,
      `${agent.name} called in sick for ${reason}${sickPay > 0 ? ` and got ${sickPay} credits sick pay` : ""}.`,
      "work",
      paidSickLeave ? "good" : "warn",
      7
    );
  }

  private workShift(agent: SimAgent, context: ActionResolverContext) {
    context.absorbCivicNotice(agent, "public");
    const outsideShift = context.currentPhase === "night" || context.currentPhase === "evening";
    const repeatedShift = agent.routine.workedToday;
    const intent = agent.target?.intent?.kind === "work" ? agent.target.intent : null;
    const healthWorkLoad =
      (agent.medical.minorIllness.active ? agent.medical.minorIllness.severity * 0.58 : 0) +
      (agent.medical.aftercare.active ? agent.medical.aftercare.dosesRemaining * 8 + agent.medical.aftercare.restMinutesRemaining * 0.12 : 0) +
      Math.max(0, 62 - agent.health) * 0.42 +
      Math.max(0, 34 - agent.energy) * 0.22;
    const pushingSick = intent?.strategy === "push_through_sick" || healthWorkLoad >= 42;
    const jobSkillId = this.jobSkillFor(agent.job);
    const jobSkill = this.skillEffect(agent, jobSkillId);
    const shiftQuality = Math.round(
      clamp(
        42 +
          agent.dna.discipline * 0.28 +
          agent.dna.empathy * 0.06 +
          jobSkill * 0.36 +
          agent.energy * 0.18 +
          agent.mood * 0.1 -
          agent.hunger * 0.14 -
          agent.stress * 0.18 -
          agent.career.burnout * 0.28 -
          (pushingSick ? Math.min(24, healthWorkLoad * 0.28) : 0) -
          (outsideShift ? 8 : 0) -
          (repeatedShift ? 18 : 0)
      )
    );
    const earned = Math.max(4, Math.round(agent.career.wage * (0.82 + shiftQuality / 260 + agent.career.level * 0.035 + jobSkill * 0.0015) + (outsideShift ? -2 : 0)));
    context.transact(agent, earned, "income", outsideShift ? "Late work shift" : "Work shift");
    const savingsRate = clamp(0.08 + agent.dna.discipline * 0.002 - agent.dna.greed * 0.0012 - agent.dna.risk * 0.0005, 0, 0.34);
    const urgentBills = this.totalBillsDue(agent);
    const saveAmount =
      urgentBills > agent.money
        ? 0
        : Math.min(Math.max(0, Math.floor(earned * savingsRate)), Math.max(0, agent.money - Math.max(6, agent.budget.dailySpendLimit * 0.6)));
    const saved = saveAmount >= 1 ? context.depositSavings(agent, saveAmount, "Paycheck savings") : 0;
    agent.routine.workedToday = true;
    agent.routine.earningsToday += earned;
    agent.household.laundry = Math.round(clamp(agent.household.laundry + (outsideShift ? 8 : 5)));
    agent.household.clutter = Math.round(clamp(agent.household.clutter + 1));
    agent.household.homeComfort = Math.round(clamp(agent.household.homeComfort - (outsideShift ? 2 : 1)));
    const outfitCleanLoss = outsideShift ? -14 : -10;
    const outfitWearGain = outsideShift ? 4 : 2.5;
    this.applyOutfitChange(
      agent,
      outfitCleanLoss,
      outfitWearGain,
      shiftQuality >= 70 ? 1 : -1,
      `${outsideShift ? "Late shift" : "Work shift"} left the outfit at clean ${Math.round(clamp(agent.outfit.cleanliness + outfitCleanLoss))}, wear ${Math.round(clamp(agent.outfit.wear + outfitWearGain))}.`,
      context
    );
    agent.career.performance = Math.round(clamp(agent.career.performance * 0.72 + shiftQuality * 0.28));
    agent.career.satisfaction = Math.round(clamp(agent.career.satisfaction + (shiftQuality >= 72 ? 4 : shiftQuality < 42 ? -5 : 1) + (saved > 0 ? 1 : 0) - (outsideShift ? 2 : 0)));
    agent.career.burnout = Math.round(
      clamp(
        agent.career.burnout +
          (outsideShift ? 7 : 3) +
          (agent.energy < 32 ? 5 : 0) +
          (agent.hunger > 72 ? 4 : 0) +
          (pushingSick ? Math.min(10, 3 + healthWorkLoad * 0.08) : 0) +
          (repeatedShift ? 9 : 0) -
          agent.dna.discipline / 45
      )
    );
    agent.career.attendanceStreak = repeatedShift ? agent.career.attendanceStreak : agent.career.attendanceStreak + 1;
    agent.career.lastShiftWorldTime = context.worldTime;
    agent.energy = clamp(agent.energy - (outsideShift ? 19 : 14));
    agent.hunger = clamp(agent.hunger + 12);
    agent.stress = clamp(agent.stress + (shiftQuality >= 70 ? 1 : shiftQuality < 42 ? 7 : 4));
    agent.mood = clamp(agent.mood + (shiftQuality >= 70 ? 4 : shiftQuality < 42 ? -4 : 1));
    this.applyAutonomy(agent, context, {
      dignity: shiftQuality >= 70 ? 5 : shiftQuality < 42 ? -4 : 2,
      control: saved > 0 ? 4 : shiftQuality >= 70 ? 2 : 0,
      overwhelm: pushingSick ? 8 : shiftQuality < 42 ? 5 : 2,
      note: pushingSick ? "Working sick cost some agency." : shiftQuality >= 70 ? "A solid shift built self-respect." : "Work moved the day forward."
    });
    if (pushingSick) {
      const recoveryCost = Math.min(12, 3 + healthWorkLoad * 0.12);
      agent.health = clamp(agent.health - recoveryCost);
      agent.stress = clamp(agent.stress + Math.min(8, 2 + healthWorkLoad * 0.06));
      agent.mood = clamp(agent.mood - Math.min(6, 1 + healthWorkLoad * 0.05));
      if (agent.medical.aftercare.active) agent.medical.aftercare.restMinutesRemaining = Math.round(clamp(agent.medical.aftercare.restMinutesRemaining + 28, 0, 240) * 10) / 10;
      if (agent.medical.minorIllness.active) {
        agent.medical.minorIllness.severity = Math.round(clamp(agent.medical.minorIllness.severity + Math.min(10, 3 + healthWorkLoad * 0.04)) * 10) / 10;
        agent.medical.minorIllness.recoveryWorldMinutes = Math.max(agent.medical.minorIllness.recoveryWorldMinutes, context.worldMinutes + agent.medical.minorIllness.severity * 1.9);
      }
    }
    context.relationship.adjustReputation(agent, { reliability: outsideShift ? 2 : 4, ambition: 2, trouble: -1 });
    const impact = this.applyWorkImpact(agent, context);
    const skillResult = context.advanceSkill(agent, jobSkillId, 4.4 + Math.max(0, shiftQuality - 54) / 18, `Worked as ${agent.career.title}`, [
      "work",
      "career",
      jobSkillId,
      ...impact.tags
    ]);
    const careerResult = this.advanceCareer(agent, Math.max(4, Math.round(shiftQuality / 9 + (impact.tone === "good" ? 2 : 0) + (saved > 0 ? 1 : 0))), context);
    context.advanceAspiration(agent, 5 + (saved > 0 ? 1.5 : 0), saved > 0 ? "Worked and saved part of the paycheck" : "Worked a useful shift", [
      "work",
      "money",
      "career",
      "stability",
      ...impact.tags
    ]);
    context.addMoodlet(agent, {
      id: pushingSick ? "worked-sick" : shiftQuality >= 70 ? "good-shift" : shiftQuality < 42 ? "bad-shift" : "worked-shift",
      label: pushingSick ? "Worked Sick" : shiftQuality >= 70 ? "Good Shift" : shiftQuality < 42 ? "Draining Shift" : "Worked Shift",
      detail: pushingSick ? `${earned} credits earned, recovery set back` : `${earned} credits earned, performance ${agent.career.performance}`,
      tone: pushingSick ? "warn" : shiftQuality >= 70 ? "good" : shiftQuality < 42 ? "warn" : "neutral",
      intensity: pushingSick ? 5.5 : shiftQuality >= 70 ? 5.5 : shiftQuality < 42 ? 5 : 3.5,
      durationMinutes: shiftQuality >= 70 ? 240 : 190,
      tags: ["work", "career", jobSkillId],
      actionBiases: pushingSick ? { resting: 18, healing: 12, sleeping: 10, working: -18 } : shiftQuality >= 70 ? { budgeting: saved > 0 ? 5 : 2, socializing: 4 } : { resting: 12, sleeping: 8, working: -10 }
    });
    const savingsLine = saved > 0 ? ` Saved ${saved} toward a ${agent.budget.savingsGoal}-credit cushion.` : "";
    const careerLine = `${careerResult.xpGain} career XP, ${skillResult.xpGain} ${agent.skills[jobSkillId].label} XP, performance ${agent.career.performance}.`;
    const promotionLine = careerResult.promoted ? ` Promoted to ${agent.career.title}.` : "";
    const sickLine = pushingSick ? " Pushed through poor health and recovery got harder." : "";
    context.addMemory(agent, "event", `Worked as ${agent.job} and earned ${earned} credits.${sickLine} ${careerLine}${promotionLine}${savingsLine} ${impact.detail}`, 7, [
      "work",
      "money",
      "career",
      ...impact.tags
    ]);
    context.log(
      agent,
      `${agent.name} worked a ${outsideShift ? "late " : ""}${pushingSick ? "sick " : ""}shift and earned ${earned} credits. ${careerLine}${promotionLine}${saved > 0 ? ` ${saved} went into savings.` : ""} ${impact.publicLine}`,
      "work",
      careerResult.promoted ? "good" : impact.tone,
      careerResult.promoted ? 8 : 7
    );
  }

  private advanceCareer(agent: SimAgent, xpGain: number, context: ActionResolverContext) {
    agent.career.xp += xpGain;
    let promoted = false;
    while (agent.career.xp >= agent.career.xpToNext) {
      agent.career.xp -= agent.career.xpToNext;
      agent.career.level += 1;
      agent.career.xpToNext = Math.round(agent.career.xpToNext * 1.28 + 18);
      agent.career.wage = Math.round((agent.career.wage + 1.25 + agent.career.performance / 90) * 100) / 100;
      agent.career.title = this.careerTitleFor(agent.job, agent.career.level);
      agent.career.satisfaction = Math.round(clamp(agent.career.satisfaction + 8));
      agent.career.burnout = Math.round(clamp(agent.career.burnout - 8));
      context.relationship.adjustReputation(agent, { ambition: 4, reliability: 2 });
      promoted = true;
    }
    agent.career.recent.unshift(`${context.worldTime} +${xpGain} XP / ${agent.career.performance} performance`);
    if (promoted) agent.career.recent.unshift(`${context.worldTime} Promoted to ${agent.career.title}`);
    agent.career.recent.splice(4);
    return { xpGain, promoted };
  }

  private careerTitleFor(job: string, level: number) {
    const tier = level >= 5 ? "Lead" : level >= 3 ? "Senior" : level >= 2 ? "Skilled" : "Apprentice";
    const titleByJob: Record<string, string> = {
      builder: "Builder",
      materials_clerk: "Materials Clerk",
      grocer: "Market Associate",
      clinician: "Clinic Worker",
      security_officer: "Security Officer",
      clerk: "Civic Clerk"
    };
    return `${tier} ${titleByJob[job] ?? "Worker"}`;
  }

  private applyWorkImpact(agent: SimAgent, context: ActionResolverContext) {
    const objectState = context.objectStates.currentForAgent(agent);
    const primaryBefore = objectState ? this.snapshotServiceState(objectState) : null;
    const stockGap =
      objectState?.stock !== undefined && objectState.capacity !== undefined ? Math.max(0, objectState.capacity - objectState.stock) : 0;
    const restockDelta = objectState?.stock !== undefined ? Math.max(stockGap > 0 ? 1 : 0, Math.ceil(stockGap * 0.7)) : undefined;
    const targetType = agent.target?.actionPointType;
    const targetLabel = objectState?.label.replace(/^.*?:\s*/, "") ?? "the station";
    let impact: {
      label: string;
      detail: string;
      publicLine: string;
      tags: string[];
      tone: AgentEventTone;
      delta: ObjectUseDelta;
      serviceTypes?: ActionPoint["type"][];
      serviceDelta?: ObjectUseDelta;
      maxServiceObjects?: number;
    };

    switch (agent.job) {
      case "grocer":
        impact = {
          label: targetType === "shelf" || targetType === "vending_machine" ? "Store stock" : "Checkout counter",
          detail:
            targetType === "shelf" || targetType === "vending_machine"
              ? `Restocked ${targetLabel} so shoppers have more to buy.`
              : "Cleaned the checkout and front-stock area.",
          publicLine:
            targetType === "shelf" || targetType === "vending_machine"
              ? "Store stock looks healthier."
              : "The checkout looks more orderly.",
          tags: ["shop", "stock", "maintenance"],
          tone: "good",
          delta: { stockDelta: restockDelta, cleanlinessDelta: 6, wearDelta: -0.5, heatDelta: 7, unmetDemandDelta: -2, servicePressureDelta: -18 },
          serviceTypes: ["shelf", "vending_machine", "register"],
          serviceDelta: { restockRatio: 0.7, minStockDelta: 1, cleanlinessDelta: 4, wearDelta: -0.5, heatDelta: 3, unmetDemandDelta: -3, servicePressureDelta: -24 },
          maxServiceObjects: 3
        };
        context.relationship.adjustReputation(agent, { reliability: 1 });
        break;
      case "clinician":
        impact = {
          label: targetType === "clinic_bed" ? "Clinic bed" : "Clinic supplies",
          detail:
            targetType === "clinic_bed"
              ? "Reset a clinic bed and made care feel safer."
              : "Checked medicine supplies and organized treatment gear.",
          publicLine: targetType === "clinic_bed" ? "A clinic bed is ready for the next patient." : "Clinic supplies are better organized.",
          tags: ["clinic", "health", "maintenance"],
          tone: "good",
          delta: {
            stockDelta: targetType === "medicine_cabinet" ? Math.max(1, restockDelta ?? 1) : undefined,
            cleanlinessDelta: 10,
            wearDelta: -1,
            heatDelta: 5,
            unmetDemandDelta: -2,
            servicePressureDelta: -20
          },
          serviceTypes: ["medicine_cabinet", "clinic_bed", "desk"],
          serviceDelta: { restockRatio: 0.65, minStockDelta: 1, cleanlinessDelta: 7, wearDelta: -1, heatDelta: 2, unmetDemandDelta: -2, servicePressureDelta: -20 },
          maxServiceObjects: 3
        };
        context.relationship.adjustReputation(agent, { warmth: 1, reliability: 1 });
        break;
      case "security_officer":
        impact = {
          label: "Security watch",
          detail: "Logged patrol notes and cooled down the security desk.",
          publicLine: "The security desk looks calmer.",
          tags: ["security", "civic", "maintenance"],
          tone: "neutral",
          delta: { cleanlinessDelta: 3, wearDelta: -0.5, heatDelta: -12, servicePressureDelta: -12 },
          serviceTypes: ["desk", "storage"],
          serviceDelta: { cleanlinessDelta: 2, wearDelta: -0.5, heatDelta: -8, servicePressureDelta: -10 },
          maxServiceObjects: 2
        };
        context.relationship.adjustReputation(agent, { reliability: 1, trouble: -2 });
        break;
      case "clerk":
        impact = {
          label: targetType === "mailbox" ? "Mail route" : "Civic notices",
          detail: targetType === "mailbox" ? "Sorted mail so rent and bill notices stay visible." : "Updated civic notes for the district.",
          publicLine: targetType === "mailbox" ? "Mail is more organized." : "The civic board looks current.",
          tags: ["mail", "civic", "maintenance"],
          tone: "good",
          delta: { cleanlinessDelta: 5, wearDelta: -0.5, heatDelta: -6, servicePressureDelta: -12 },
          serviceTypes: ["mailbox", "notice_board", "desk"],
          serviceDelta: { cleanlinessDelta: 3, wearDelta: -0.5, heatDelta: -4, servicePressureDelta: -10 },
          maxServiceObjects: 3
        };
        context.relationship.adjustReputation(agent, { reliability: 2 });
        break;
      case "builder":
      case "materials_clerk":
        impact = {
          label: targetType === "storage" ? "Material storage" : "Build station",
          detail: targetType === "storage" ? "Staged building materials for future construction." : "Tuned up a work station for future builds.",
          publicLine: targetType === "storage" ? "Material storage is more useful." : "A build station is ready for more work.",
          tags: ["materials", "build", "maintenance"],
          tone: "good",
          delta: { stockDelta: restockDelta, cleanlinessDelta: targetType === "storage" ? 2 : -1, wearDelta: -0.5, heatDelta: 10, servicePressureDelta: -10 },
          serviceTypes: ["storage", "workbench", "job_station"],
          serviceDelta: { restockRatio: 0.55, minStockDelta: 1, cleanlinessDelta: 2, wearDelta: -1, heatDelta: 4, servicePressureDelta: -10 },
          maxServiceObjects: 3
        };
        context.relationship.adjustReputation(agent, { ambition: 2 });
        break;
      default:
        impact = {
          label: "Work station",
          detail: "Kept the station usable for the next person.",
          publicLine: "The station is a little more usable.",
          tags: ["maintenance"],
          tone: "good",
          delta: { cleanlinessDelta: 2, wearDelta: -0.5, heatDelta: 6 }
        };
        break;
    }

    agent.routine.maintenanceToday += 1;
    agent.routine.lastMaintenance = impact.label;
    const primaryAfter = this.recordObjectUse(agent, context, impact.delta);
    const serviced =
      impact.serviceTypes && impact.serviceTypes.length > 0
        ? context.objectStates.recordStructureService(agent, context.worldTime, impact.serviceTypes, impact.serviceDelta ?? impact.delta, impact.maxServiceObjects ?? 2)
        : [];
    if (serviced.length > 0) {
      const serviceLine = ` Also refreshed ${serviced.length} nearby ${serviced.length === 1 ? "station" : "stations"}.`;
      impact.detail += serviceLine;
      impact.publicLine += serviceLine;
    }
    const relief = this.combineServiceRelief([
      this.serviceRelief(primaryBefore, primaryAfter ? this.snapshotServiceState(primaryAfter) : null),
      ...serviced.map((result) => this.serviceRelief(result.before, result.after))
    ]);
    const civicResult = this.recordCivicService(agent, context, impact.label, impact.tags, relief);
    if (civicResult.impactScore > 0) {
      const serviceLine = ` Public service impact +${civicResult.impactScore}${civicResult.bonus > 0 ? ` and ${civicResult.bonus} bonus credits` : ""}.`;
      impact.detail += serviceLine;
      impact.publicLine += serviceLine;
    }
    return impact;
  }

  private snapshotServiceState(state: {
    stock?: number;
    capacity?: number;
    cleanliness: number;
    wear: number;
    heat: number;
    unmetDemand: number;
    servicePressure: number;
  }): ObjectServiceSnapshot {
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

  private serviceRelief(before: ObjectServiceSnapshot | null, after: ObjectServiceSnapshot | null) {
    if (!before || !after) return { score: 0, demandResolved: 0, pressureRelieved: 0, stockRestored: 0, cleanlinessImproved: 0 };
    const stockRestored = before.stock !== undefined && after.stock !== undefined ? Math.max(0, after.stock - before.stock) : 0;
    const demandResolved = Math.max(0, before.unmetDemand - after.unmetDemand);
    const pressureRelieved = Math.max(0, before.servicePressure - after.servicePressure);
    const cleanlinessImproved = Math.max(0, after.cleanliness - before.cleanliness);
    const wearReduced = Math.max(0, before.wear - after.wear);
    const heatReduced = Math.max(0, before.heat - after.heat);
    const score = Math.round(
      clamp(stockRestored * 0.8 + demandResolved * 4.5 + pressureRelieved * 0.16 + cleanlinessImproved * 0.08 + wearReduced * 0.18 + heatReduced * 0.06, 0, 40)
    );
    return { score, demandResolved, pressureRelieved, stockRestored, cleanlinessImproved };
  }

  private combineServiceRelief(reliefs: ServiceRelief[]): ServiceRelief {
    return reliefs.reduce(
      (total, relief) => ({
        score: total.score + relief.score,
        demandResolved: total.demandResolved + relief.demandResolved,
        pressureRelieved: total.pressureRelieved + relief.pressureRelieved,
        stockRestored: total.stockRestored + relief.stockRestored,
        cleanlinessImproved: total.cleanlinessImproved + relief.cleanlinessImproved
      }),
      { score: 0, demandResolved: 0, pressureRelieved: 0, stockRestored: 0, cleanlinessImproved: 0 }
    );
  }

  private recordCivicService(
    agent: SimAgent,
    context: ActionResolverContext,
    label: string,
    tags: string[],
    relief: ServiceRelief
  ) {
    const baseline = tags.includes("maintenance") ? 2 : 1;
    const impactScore = Math.round(clamp(relief.score + (relief.score > 0 ? baseline : 0), 0, 48));
    if (impactScore <= 0) return { impactScore: 0, bonus: 0 };

    agent.civic.serviceImpactToday += impactScore;
    agent.civic.demandResolvedToday += relief.demandResolved;
    agent.civic.pressureRelievedToday += Math.round(relief.pressureRelieved);
    agent.civic.serviceReputation = Math.round(clamp(agent.civic.serviceReputation + impactScore * 0.26 + relief.demandResolved * 0.7 + Math.min(5, relief.pressureRelieved * 0.025)));
    agent.civic.lastService = `${label} +${impactScore} impact`;
    agent.civic.recent.unshift(
      `${context.worldTime} ${label}: +${impactScore} impact, ${relief.demandResolved} demand, ${Math.round(relief.pressureRelieved)} pressure`
    );
    agent.civic.recent.splice(4);

    agent.career.satisfaction = Math.round(clamp(agent.career.satisfaction + Math.min(5, impactScore * 0.18)));
    agent.career.performance = Math.round(clamp(agent.career.performance + Math.min(4, impactScore * 0.12)));
    context.relationship.adjustReputation(agent, {
      reliability: Math.min(4, Math.max(1, Math.round(impactScore / 9))),
      warmth: tags.includes("clinic") || tags.includes("shop") ? 1 : 0,
      trouble: impactScore >= 8 ? -1 : 0
    });

    const bonus = impactScore >= 10 ? Math.min(6, Math.max(1, Math.floor(impactScore / 5))) : 0;
    if (bonus > 0) context.transact(agent, bonus, "income", "Public service bonus");

    if (impactScore >= 6) {
      context.addMoodlet(agent, {
        id: "useful-service",
        label: "Useful Service",
        detail: `${label} mattered to the district`,
        tone: "good",
        intensity: Math.min(7, 3 + impactScore / 6),
        durationMinutes: 240,
        tags: ["service", "work", ...tags],
        actionBiases: { working: 5, socializing: 3, budgeting: bonus > 0 ? 3 : 0 }
      });
    }

    if (impactScore >= 8) {
      context.addMemory(agent, "event", `${label} visibly helped the district: ${impactScore} service impact.`, 7, [
        "service",
        "work",
        ...tags
      ]);
    }

    return { impactScore, bonus };
  }

  private buyFood(agent: SimAgent, context: ActionResolverContext) {
    const objectState = context.objectStates.currentForAgent(agent);
    const outOfStock = objectState?.stock !== undefined && objectState.stock <= 0;
    const commerceSkill = this.skillEffect(agent, "commerce");
    const intent = agent.target?.intent?.kind === "food" ? agent.target.intent : null;
    const strategy = intent?.strategy ?? "buy_quick_meal";
    const basePrice = Math.max(1, intent?.amount ?? 4);
    const scarcityMarkup = objectState?.stock !== undefined && objectState.stock <= 3 ? 1 : 0;
    const price = Math.round(Math.max(1, basePrice + scarcityMarkup - (commerceSkill >= 22 && scarcityMarkup > 0 ? 0.5 : 0)) * 100) / 100;
    const savingsAllowed = intent ? intent.savingsAllowed === true : agent.hunger > 68;
    const isQuickMeal = strategy.includes("quick_meal") || strategy === "cash_purchase" || strategy === "emergency_savings_purchase";
    const isFreshGroceries = strategy.includes("fresh") || strategy.includes("balanced");
    const isBulk = strategy.includes("bulk_groceries");
    const isGroceries = strategy.includes("groceries") || isBulk;
    const isEmergency = strategy.includes("emergency") || strategy === "emergency_savings_purchase";

    if (outOfStock) {
      this.recordObjectUse(agent, context, {
        cleanlinessDelta: -1,
        wearDelta: 0.5,
        heatDelta: 4,
        unmetDemandDelta: 1,
        servicePressureDelta: 20,
        issue: "Empty food shelf"
      });
      agent.mood = clamp(agent.mood - 6);
      agent.stress = clamp(agent.stress + 7);
      context.addMoodlet(agent, {
        id: "store-letdown",
        label: "Store Letdown",
        detail: "the shelf was empty when food mattered",
        tone: "warn",
        intensity: 5.5,
        durationMinutes: 210,
        tags: ["food", "shop", "stock"],
        actionBiases: { shopping: 10, working: 5, socializing: -6 }
      });
      context.addMemory(agent, "event", `${objectState.label} was out of stock.`, 8, ["food", "shop", "stock"]);
      context.log(agent, `${agent.name} tried ${objectState.label} but it was out of stock.`, "food", "warn", 8);
      return;
    }

    if (agent.money < price && agent.budget.savings > 0 && savingsAllowed) {
      context.withdrawSavings(agent, price - agent.money, isEmergency ? "Emergency food savings" : "Grocery savings withdrawal");
    }

    if (agent.money >= price) {
      const purchaseLabel = isBulk ? "Bulk grocery purchase" : isGroceries ? "Grocery purchase" : objectState?.stock !== undefined && objectState.stock <= 3 ? "Scarce meal purchase" : "Meal purchase";
      context.transact(agent, -price, "food", purchaseLabel);
      const pantryBefore = agent.household.pantry;
      const desiredPantryAmount = isBulk ? 4 + (commerceSkill >= 35 ? 1 : 0) : isGroceries ? 2 + (commerceSkill >= 30 ? 1 : 0) : 0;
      const stockedPantry = desiredPantryAmount > 0 ? this.stockPantry(agent, desiredPantryAmount, context) : false;
      const pantryAdded = Math.max(0, agent.household.pantry - pantryBefore);
      if (isQuickMeal) {
        agent.hunger = clamp(agent.hunger - (agent.hunger > 68 ? 34 : 24) - commerceSkill * 0.05);
        this.recordMeal(agent, context, {
          label: isEmergency ? "emergency quick meal" : "quick meal",
          quality: 38 + commerceSkill * 0.03,
          hydration: 16,
          variety: 32,
          fullness: 46
        });
        agent.routine.ateToday = true;
        agent.routine.mealsToday += 1;
      } else {
        if (!stockedPantry) agent.inventory.push("groceries");
        if (stockedPantry || isGroceries) {
          agent.nutrition.variety = Math.round(clamp(agent.nutrition.variety + (isFreshGroceries ? 8 : isBulk ? 6 : 4)));
          agent.nutrition.recent.unshift(`${context.worldTime} Pantry options improved future meals.`);
          agent.nutrition.recent.splice(4);
        }
        agent.hunger = clamp(agent.hunger - (agent.hunger > 76 ? 14 : 5) - commerceSkill * 0.02);
        if (agent.hunger < 62 && agent.hunger > 36) {
          this.recordMeal(agent, context, {
            label: isFreshGroceries ? "fresh grocery snack" : "grocery snack",
            quality: isFreshGroceries ? 68 + commerceSkill * 0.04 : 52 + commerceSkill * 0.03,
            hydration: isFreshGroceries ? 18 : 10,
            variety: isFreshGroceries ? 66 : 48,
            fullness: 32
          });
          agent.routine.ateToday = true;
          agent.routine.mealsToday += 1;
        }
      }
      agent.mood = clamp(agent.mood + (isBulk ? 6 : isGroceries ? 5 : 4));
      agent.stress = clamp(agent.stress - (isBulk ? 8 : isGroceries ? 6 : 5));
      context.relationship.adjustReputation(agent, { reliability: 1 });
      this.recordObjectUse(agent, context, {
        stockDelta: objectState?.stock !== undefined ? -(isQuickMeal ? 1 : Math.max(1, pantryAdded || desiredPantryAmount)) : undefined,
        cleanlinessDelta: -2,
        wearDelta: 1,
        heatDelta: isBulk ? 10 : 7,
        servicePressureDelta: objectState?.stock !== undefined && objectState.stock <= Math.max(1, pantryAdded || desiredPantryAmount) + 2 ? 8 : undefined,
        issue: objectState?.stock !== undefined && objectState.stock <= Math.max(1, pantryAdded || desiredPantryAmount) + 2 ? "Food stock running low" : undefined
      });
      const skillResult = context.advanceSkill(agent, "commerce", objectState?.stock !== undefined && objectState.stock <= 3 ? 3.2 : 2.2, "Shopped for food", [
        "shop",
        "food",
        "budget"
      ]);
      context.advanceAspiration(agent, isBulk ? 3.4 : isGroceries ? 2.8 : 2.2, isQuickMeal ? "Bought food before it became a crisis" : "Turned credits into future meals", [
        "food",
        "shop",
        "wellness",
        "stability"
      ]);
      context.addMoodlet(agent, {
        id: isBulk ? "pantry-stocked" : stockedPantry ? "pantry-secure" : isQuickMeal ? "meal-secured" : "groceries-carried",
        label: isBulk ? "Pantry Stocked" : stockedPantry ? "Pantry Secure" : isQuickMeal ? "Meal Secured" : "Groceries Carried",
        detail: stockedPantry
          ? `${agent.household.pantry}/${agent.household.pantryCapacity} pantry meals now`
          : isQuickMeal
            ? "ate enough to keep moving"
            : "saved groceries for home",
        tone: objectState?.stock !== undefined && objectState.stock <= 2 ? "warn" : "good",
        intensity: isBulk ? 6 : stockedPantry ? 5 : 3.5,
        durationMinutes: isBulk ? 360 : stockedPantry ? 260 : 180,
        tags: ["food", "shop", "security"],
        actionBiases: { working: stockedPantry || isBulk ? 6 : 3, shopping: isBulk || stockedPantry ? -18 : -10, budgeting: stockedPantry || isBulk ? 3 : 0 }
      });
      const foodResult = isQuickMeal ? "ate a quick meal" : stockedPantry ? `stocked ${pantryAdded} pantry meal${pantryAdded === 1 ? "" : "s"}` : "kept groceries for later";
      context.addMemory(
        agent,
        "event",
        isEmergency
          ? `Used emergency savings and ${foodResult} at the grocery${skillResult.leveled ? " while learning the store better" : ""}.`
          : `Bought food and ${foodResult}${skillResult.leveled ? " while learning the store better" : ""}.`,
        7,
        ["food", "shop", "commerce"]
      );
      context.log(
        agent,
        isEmergency
          ? `${agent.name} used savings for food and ${foodResult}.`
          : `${agent.name} bought food and ${foodResult}.`,
        "food",
        objectState?.stock !== undefined && objectState.stock <= 2 ? "warn" : "good",
        7
      );
    } else {
      this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 3 });
      agent.mood = clamp(agent.mood - 8);
      agent.stress = clamp(agent.stress + 10);
      agent.budget.lastReview = "Could not afford food";
      context.relationship.adjustReputation(agent, { reliability: -1 });
      context.addMoodlet(agent, {
        id: "could-not-afford-food",
        label: "Could Not Afford Food",
        detail: "cash blocked a basic need",
        tone: "bad",
        intensity: 7,
        durationMinutes: 240,
        tags: ["food", "money", "scarcity"],
        actionBiases: { working: 22, budgeting: 12, shopping: -8, socializing: -10, resting: -8 }
      });
      context.addMemory(agent, "event", "Could not afford food.", 8, ["food", "money"]);
      context.log(agent, `${agent.name} wanted food but did not have enough credits.`, "food", "bad", 8);
    }
  }

  private buyHouseholdSupplies(agent: SimAgent, context: ActionResolverContext) {
    const objectState = context.objectStates.currentForAgent(agent);
    const outOfStock = objectState?.stock !== undefined && objectState.stock <= 0;
    const commerceSkill = this.skillEffect(agent, "commerce");
    const intent = agent.target?.intent?.kind === "home" ? agent.target.intent : null;
    const strategy = intent?.strategy ?? "buy_home_supplies";
    const isToiletries = strategy === "buy_toiletries";
    const isCleaning = strategy === "buy_cleaning_supplies";
    const isBundle = strategy === "buy_home_supplies" || strategy === "restock_home_supplies";
    const basePrice = Math.max(1, intent?.amount ?? (isBundle ? 8 : isCleaning ? 5 : 4));
    const scarcityMarkup = objectState?.stock !== undefined && objectState.stock <= 3 ? 1 : 0;
    const price = Math.round(Math.max(1, basePrice + scarcityMarkup - (commerceSkill >= 22 && scarcityMarkup > 0 ? 0.5 : 0)) * 100) / 100;
    const savingsAllowed = intent?.savingsAllowed === true;

    if (outOfStock) {
      this.recordObjectUse(agent, context, {
        cleanlinessDelta: -1,
        wearDelta: 0.5,
        heatDelta: 4,
        unmetDemandDelta: 1,
        servicePressureDelta: 14,
        issue: "Home supply shelf empty"
      });
      agent.mood = clamp(agent.mood - 4);
      agent.stress = clamp(agent.stress + 5);
      context.addMoodlet(agent, {
        id: "supply-shelf-empty",
        label: "Supply Shelf Empty",
        detail: "home routines will stay harder for now",
        tone: "warn",
        intensity: 4.5,
        durationMinutes: 190,
        tags: ["home", "supplies", "shop"],
        actionBiases: { shopping: 8, working: 4, cleaning: -4, washing: -4 }
      });
      context.addMemory(agent, "event", `${objectState.label} was out of home supplies.`, 6, ["home", "supplies", "shop"]);
      context.log(agent, `${agent.name} tried to restock home supplies, but the shelf was empty.`, "home", "warn", 6);
      return;
    }

    if (agent.money < price && agent.budget.savings > 0 && savingsAllowed) {
      context.withdrawSavings(agent, price - agent.money, "Home supply savings withdrawal");
    }

    if (agent.money < price) {
      this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 3 });
      agent.mood = clamp(agent.mood - 4);
      agent.stress = clamp(agent.stress + 5);
      agent.budget.lastReview = "Could not afford home supplies";
      context.addMoodlet(agent, {
        id: "could-not-afford-supplies",
        label: "Could Not Restock",
        detail: "home supplies stayed low",
        tone: "warn",
        intensity: 4.8,
        durationMinutes: 180,
        tags: ["home", "supplies", "money"],
        actionBiases: { working: 12, budgeting: 6, shopping: -4 }
      });
      context.addMemory(agent, "event", "Could not afford household supplies.", 6, ["home", "supplies", "money"]);
      context.log(agent, `${agent.name} wanted household supplies but did not have enough credits.`, "home", "warn", 6);
      return;
    }

    context.transact(agent, -price, "supplies", isBundle ? "Household supply bundle" : isCleaning ? "Cleaning supply purchase" : "Toiletry purchase");
    const toiletriesBefore = agent.household.toiletries;
    const cleaningBefore = agent.household.cleaningSupplies;
    const supplyUnits = 2 + (commerceSkill >= 30 ? 1 : 0);
    const toiletriesAdded = isCleaning ? 0 : this.stockHouseholdSupply(agent, "toiletries", isBundle ? 2 : supplyUnits);
    const cleaningAdded = isToiletries ? 0 : this.stockHouseholdSupply(agent, "cleaningSupplies", isBundle ? 2 : supplyUnits);
    const totalAdded = toiletriesAdded + cleaningAdded;
    agent.mood = clamp(agent.mood + (isBundle ? 4 : 3));
    agent.stress = clamp(agent.stress - (isBundle ? 5 : 4));
    context.relationship.adjustReputation(agent, { reliability: 1 });
    this.recordObjectUse(agent, context, {
      stockDelta: objectState?.stock !== undefined ? -Math.max(1, Math.ceil(totalAdded / 2)) : undefined,
      cleanlinessDelta: -1,
      wearDelta: 0.5,
      heatDelta: isBundle ? 8 : 5,
      servicePressureDelta: objectState?.stock !== undefined && objectState.stock <= 3 ? 6 : undefined,
      issue: objectState?.stock !== undefined && objectState.stock <= 3 ? "Home supplies running low" : undefined
    });
    const skillResult = context.advanceSkill(agent, "commerce", objectState?.stock !== undefined && objectState.stock <= 3 ? 2.6 : 1.8, "Shopped for household supplies", [
      "shop",
      "home",
      "supplies"
    ]);
    context.advanceAspiration(agent, 2.4, "Turned credits into a more livable routine", ["home", "comfort", "stability", "supplies"]);
    context.addMoodlet(agent, {
      id: isBundle ? "home-supplies-restocked" : isCleaning ? "cleaning-supplies-restocked" : "toiletries-restocked",
      label: isBundle ? "Home Supplies Restocked" : isCleaning ? "Cleaning Supplies" : "Toiletries Restocked",
      detail: `toiletries ${agent.household.toiletries}/${agent.household.supplyCapacity}, cleaning ${agent.household.cleaningSupplies}/${agent.household.supplyCapacity}`,
      tone: "good",
      intensity: isBundle ? 4.8 : 3.8,
      durationMinutes: isBundle ? 260 : 200,
      tags: ["home", "supplies", "shop"],
      actionBiases: { washing: toiletriesAdded > 0 ? 6 : 0, cleaning: cleaningAdded > 0 ? 7 : 0, shopping: -12 }
    });
    this.addHouseholdNote(
      agent,
      `Restocked supplies: toiletries ${toiletriesBefore}->${agent.household.toiletries}, cleaning ${cleaningBefore}->${agent.household.cleaningSupplies}.`,
      context
    );
    context.addMemory(
      agent,
      "event",
      `Bought household supplies${skillResult.leveled ? " and learned the store better" : ""}: toiletries ${agent.household.toiletries}, cleaning ${agent.household.cleaningSupplies}.`,
      6,
      ["home", "supplies", "commerce"]
    );
    context.log(agent, `${agent.name} restocked household supplies.`, "home", "good", 6);
  }

  private socialize(agent: SimAgent, context: ActionResolverContext) {
    agent.routine.socializedToday = true;
    const socialSkill = this.skillEffect(agent, "social");
    let bestNearby: SimAgent | null = null;
    let bestDesire = -Infinity;
    for (const other of context.agents) {
      if (other.id === agent.id) continue;
      const distance = distance2d(agent.position, other.position);
      if (distance > 4.2) continue;
      const relationship = context.relationship.relationshipFor(agent, other, context.worldTime);
      const focusBoost = agent.socialFocus?.agentId === other.id ? 34 : 0;
      const rivalPenalty = relationship.attitude === "rival" && agent.stress < 70 ? 34 : 0;
      const visibleNeedPull =
        other.health < 56 || other.stress > 74 || other.hunger > 78 || other.energy < 24 || other.medical.minorIllness.active
          ? agent.dna.empathy * 0.08 + relationship.trust * 0.04
          : 0;
      const awkwardSignalPenalty = other.hygiene < 26 && agent.dna.empathy < 54 && relationship.score < 10 ? 9 : 0;
      const desire =
        focusBoost +
        relationship.score * 0.58 +
        context.relationship.publicReputationBias(other) +
        agent.dna.empathy * 0.08 +
        agent.dna.sociability * 0.12 -
        awkwardSignalPenalty +
        visibleNeedPull -
        distance * 3 -
        rivalPenalty;
      if (desire > bestDesire) {
        bestNearby = other;
        bestDesire = desire;
      }
    }

    if (!bestNearby || bestDesire < -16) {
      const leisureLine = this.applyLeisure(agent, context, {
        label: agent.leisure.hobby === "people_watching" ? "people-watched in public" : "let the city be background noise",
        fun: agent.leisure.hobby === "people_watching" || agent.leisure.hobby === "music" ? 18 : 10,
        boredom: -18,
        curiosity: agent.leisure.hobby === "people_watching" ? -10 : -4,
        mood: 2,
        stress: -1,
        tags: ["social", "public", "leisure", agent.leisure.hobby]
      });
      agent.social = clamp(agent.social + 13);
      agent.mood = clamp(agent.mood + 7);
      agent.stress = clamp(agent.stress - 7);
      this.applyAutonomy(agent, context, {
        dignity: agent.socialFocus?.intent === "avoid" ? 5 : 2,
        control: agent.socialFocus?.intent === "avoid" ? 7 : 4,
        overwhelm: -5,
        note: agent.socialFocus?.intent === "avoid" ? "Holding a boundary restored agency." : "Public time made the city feel less isolating."
      });
      const avoidLine =
        agent.socialFocus?.intent === "avoid" ? ` while keeping distance from ${agent.socialFocus.agentName}` : " and watched the city move around them";
      this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 5 });
      context.advanceSkill(agent, "social", 1.4, agent.socialFocus?.intent === "avoid" ? "Held a boundary in public" : "Spent time in public", ["social", "park"]);
      context.advanceAspiration(agent, 2.4, "Spent time in public without spiraling", ["social", "park", "belonging", "comfort"]);
      context.addMoodlet(agent, {
        id: agent.socialFocus?.intent === "avoid" ? "held-boundary" : "public-reset",
        label: agent.socialFocus?.intent === "avoid" ? "Held Boundary" : "Public Reset",
        detail: agent.socialFocus?.intent === "avoid" ? "kept distance without hiding" : "being around the city helped a little",
        tone: "good",
        intensity: 3.5,
        durationMinutes: 180,
        tags: ["social", "public", "park"],
        actionBiases: { socializing: 3, resting: 3, working: 2 }
      });
      context.addMemory(agent, "event", `Spent time in public${avoidLine}. ${leisureLine}`, 5, ["social", "park", "leisure"]);
      context.log(agent, `${agent.name} hung around the park${avoidLine}.`, "social", "good", 5);
      context.relationshipContext.recordSocialMoment(agent, {
        kind: "public",
        label: agent.socialFocus?.intent === "avoid" ? "Held Boundary" : "Public Reset",
        detail: agent.socialFocus?.intent === "avoid" ? `Stayed public while keeping distance from ${agent.socialFocus.agentName}.` : "Being around the city helped the day feel less isolated.",
        tone: "good",
        scoreDelta: 0,
        trustDelta: 0,
        supportDelta: 0,
        tags: ["social", "public", agent.socialFocus?.intent === "avoid" ? "boundary" : "park"],
        durationMinutes: 220
      });
      if (context.relationship.activeEveningPlan(agent, context.currentPhase, context.currentDay)) {
        context.relationship.markEveningPlanOutcome(agent, "quiet", "went out, found space, and let the evening stay low-pressure", context.relationshipContext);
      }
      return;
    }

    const other = bestNearby;
    const relationship = context.relationship.relationshipFor(agent, other, context.worldTime);
    const reciprocalRelationship = context.relationship.relationshipFor(other, agent, context.worldTime);
    const socialRead = context.relationship.readSocialCue(agent, other, relationship);
    const reciprocalRead = context.relationship.readSocialCue(other, agent, reciprocalRelationship);
    const readTension = (socialRead?.tensionDelta ?? 0) + (reciprocalRead?.tensionDelta ?? 0) * 0.6;
    const readCareRelief =
      (socialRead?.tags.includes("care") ? 6 : 0) +
      (reciprocalRead?.tags.includes("care") ? 3 : 0) +
      (socialRead?.tags.includes("composure") ? 3 : 0) +
      (reciprocalRead?.tags.includes("composure") ? 2 : 0);
    const pressure =
      agent.stress +
      other.stress +
      agent.dna.risk * 0.35 +
      agent.reputation.trouble * 0.1 +
      other.reputation.trouble * 0.06 -
      agent.dna.empathy * 0.32 -
      relationship.score * 0.4 -
      socialSkill * 0.22 +
      readTension * 2.2 -
      readCareRelief;
    if ((relationship.attitude === "rival" && pressure > 48) || pressure > 76) {
      if (context.relationship.applyConflict(agent, other, "got tense with", context.relationshipContext)) {
        this.applyAutonomy(agent, context, { dignity: -7, control: -5, overwhelm: 12, note: `Conflict with ${other.name} hurt composure.` });
        this.applyAutonomy(other, context, { dignity: -5, control: -4, overwhelm: 10, note: `Conflict with ${agent.name} raised pressure.` });
        return;
      }
      context.relationship.noteDeescalation(agent, other, context.relationshipContext);
      this.applyAutonomy(agent, context, { dignity: 5, control: 5, overwhelm: -8, note: `Deescalating with ${other.name} restored composure.` });
      this.applyAutonomy(other, context, { dignity: 3, control: 4, overwhelm: -7, note: `${agent.name} helped a tense moment cool down.` });
      return;
    }

    const gesture = context.relationship.chooseSocialGesture(agent, other, relationship);
    if (gesture.transferCredits && gesture.transferCredits > 0 && agent.money >= gesture.transferCredits) {
      context.transact(agent, -gesture.transferCredits, "misc", `Helped ${other.name}`);
      context.transact(other, gesture.transferCredits, "misc", `${agent.name} helped out`, "income");
    }
    if (gesture.transferItem) {
      this.shareFood(agent, other, gesture.transferItem, gesture.otherHungerRelief ?? 24, context);
    }
    const agentDelta = gesture.agentDelta + (socialRead?.observerDelta ?? 0) + (reciprocalRead?.subjectDelta ?? 0) * 0.35;
    const otherDelta = gesture.otherDelta + (socialRead?.subjectDelta ?? 0) + (reciprocalRead?.observerDelta ?? 0) * 0.35;
    const agentMood = gesture.agentMood + (socialRead?.observerMood ?? 0) + (reciprocalRead?.subjectMood ?? 0) * 0.35;
    const otherMood = gesture.otherMood + (socialRead?.subjectMood ?? 0) + (reciprocalRead?.observerMood ?? 0) * 0.35;
    const agentStress = gesture.agentStress + (socialRead?.observerStress ?? 0) + (reciprocalRead?.subjectStress ?? 0) * 0.35;
    const otherStress = gesture.otherStress + (socialRead?.subjectStress ?? 0) + (reciprocalRead?.observerStress ?? 0) * 0.35;
    const agentMemory = socialRead ? `${gesture.agentMemory} ${socialRead.observerMemory}` : gesture.agentMemory;
    const otherMemory = socialRead ? `${gesture.otherMemory} ${socialRead.subjectMemory}` : gesture.otherMemory;
    const agentRel = context.relationship.adjustRelationship(agent, other, agentDelta, agentMemory, context.worldTime);
    const otherRel = context.relationship.adjustRelationship(other, agent, otherDelta, otherMemory, context.worldTime);
    context.relationship.recordGesture(agentRel, otherRel, gesture);
    if (socialRead) this.applySocialPerceptionCue(agent, other, socialRead, agentRel, otherRel, context);
    if (reciprocalRead) this.applySocialPerceptionCue(other, agent, reciprocalRead, otherRel, agentRel, context);
    context.relationshipContext.recordSocialMoment(agent, {
      kind: gesture.kind,
      label: gesture.label,
      detail: socialRead ? `${gesture.agentMemory} ${socialRead.detail}.` : gesture.agentMemory,
      tone: gesture.tone,
      otherAgentId: other.id,
      otherAgentName: other.name,
      scoreDelta: Math.round(agentDelta * 10) / 10,
      trustDelta: gesture.kind === "favor" || gesture.kind === "share_food" || gesture.kind === "spot_credit" || gesture.kind === "repay_credit" ? 2 : gesture.kind === "apology" ? 1 : 0,
      supportDelta: gesture.agentSupport,
      tags: ["social", agentRel.attitude, ...gesture.tags, ...(socialRead?.tags ?? [])].slice(0, 8),
      durationMinutes: gesture.importance >= 8 ? 420 : 320
    });
    context.relationshipContext.recordSocialMoment(other, {
      kind: gesture.kind,
      label: gesture.label,
      detail: socialRead ? `${gesture.otherMemory} ${socialRead.subjectMemory}` : gesture.otherMemory,
      tone: gesture.tone,
      otherAgentId: agent.id,
      otherAgentName: agent.name,
      scoreDelta: Math.round(otherDelta * 10) / 10,
      trustDelta: gesture.kind === "favor" || gesture.kind === "share_food" || gesture.kind === "spot_credit" || gesture.kind === "repay_credit" ? 5 : gesture.kind === "apology" ? 1 : 0,
      supportDelta: gesture.otherSupport,
      tags: ["social", otherRel.attitude, ...gesture.tags, ...(socialRead?.tags ?? [])].slice(0, 8),
      durationMinutes: gesture.importance >= 8 ? 420 : 320
    });
    agent.social = clamp(agent.social + gesture.agentSocial);
    other.social = clamp(other.social + gesture.otherSocial);
    agent.mood = clamp(agent.mood + agentMood);
    other.mood = clamp(other.mood + otherMood);
    agent.stress = clamp(agent.stress + agentStress);
    other.stress = clamp(other.stress + otherStress);
    this.applyAutonomy(agent, context, {
      dignity: gesture.tone === "good" ? 5 : gesture.tone === "warn" ? 1 : -3,
      control: gesture.kind === "apology" || gesture.kind === "repay_credit" ? 4 : 2,
      overwhelm: gesture.tone === "good" ? -5 : gesture.tone === "warn" ? -2 : 2,
      note: `A social beat with ${other.name} changed their self-read.`
    });
    this.applyAutonomy(other, context, {
      dignity: gesture.tone === "good" ? 4 : gesture.tone === "warn" ? 1 : -2,
      control: gesture.kind === "favor" || gesture.kind === "share_food" || gesture.kind === "spot_credit" ? 3 : 1,
      overwhelm: gesture.tone === "good" ? -4 : gesture.tone === "warn" ? -1 : 2,
      note: `${agent.name}'s social choice changed the day.`
    });
    this.applyLeisure(agent, context, {
      label: gesture.kind === "favor" || gesture.kind === "share_food" || gesture.kind === "repay_credit" ? `meaningful time with ${other.name}` : `hung out with ${other.name}`,
      fun: gesture.tone === "bad" ? 2 : gesture.tone === "warn" ? 5 : 13,
      boredom: gesture.tone === "bad" ? -4 : -16,
      curiosity: -5,
      mood: gesture.tone === "bad" ? -1 : 1,
      stress: gesture.tone === "bad" ? 1 : -1,
      tags: ["social", "relationship", "leisure", agent.leisure.hobby]
    });
    this.applyLeisure(other, context, {
      label: gesture.kind === "favor" || gesture.kind === "share_food" || gesture.kind === "repay_credit" ? `meaningful time with ${agent.name}` : `hung out with ${agent.name}`,
      fun: gesture.tone === "bad" ? 2 : gesture.tone === "warn" ? 5 : 11,
      boredom: gesture.tone === "bad" ? -3 : -14,
      curiosity: -4,
      mood: gesture.tone === "bad" ? -1 : 1,
      stress: gesture.tone === "bad" ? 1 : -1,
      tags: ["social", "relationship", "leisure", other.leisure.hobby]
    });
    agent.routine.bondsToday += 1;
    other.routine.bondsToday += 1;
    other.routine.socializedToday = true;
    context.addMoodlet(agent, {
      id: "connected",
      label: "Connected",
      detail: `a good moment with ${other.name}`,
      tone: "good",
      intensity: gesture.kind === "favor" || gesture.kind === "share_food" || gesture.kind === "spot_credit" || gesture.kind === "repay_credit" ? 6 : 4.5,
      durationMinutes: 260,
      tags: ["social", "relationship", gesture.kind],
      actionBiases: { socializing: 8, resting: 2, working: 2 }
    });
    context.addMoodlet(other, {
      id: "noticed-kindness",
      label: "Noticed Kindness",
      detail: `${agent.name} made the day feel less anonymous`,
      tone: "good",
      intensity: 4,
      durationMinutes: 220,
      tags: ["social", "relationship", gesture.kind],
      actionBiases: { socializing: 6, resting: 2 }
    });
    context.relationship.adjustReputation(agent, { warmth: 4, trouble: -1 });
    context.relationship.adjustReputation(other, { warmth: 2, trouble: -1 });
    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 7 });
    const skillResult = context.advanceSkill(agent, "social", 3.2 + Math.max(0, gesture.agentDelta) * 0.18, gesture.label, [
      "social",
      "relationship",
      ...gesture.tags
    ]);
    context.advanceAspiration(agent, gesture.kind === "spot_credit" || gesture.kind === "share_food" || gesture.kind === "favor" || gesture.kind === "repay_credit" ? 6 : 5.2, `Built trust with ${other.name}`, [
      "social",
      "belonging",
      "relationship",
      ...gesture.tags
    ]);
    context.addMemory(agent, "observation", agentMemory, gesture.importance, ["social", other.id, agentRel.attitude, ...gesture.tags]);
    context.addMemory(other, "observation", otherMemory, Math.max(5, gesture.importance - 1), ["social", agent.id, otherRel.attitude, ...gesture.tags]);
    const friendshipLine = agentRel.attitude === "friend" || otherRel.attitude === "friend" ? " They are starting to feel like friends." : "";
    const skillLine = skillResult.leveled ? ` ${agent.name} is getting better at reading people.` : "";
    const readLine = socialRead && socialRead.importance >= 6 ? ` ${socialRead.publicLine}` : "";
    context.log(agent, `${gesture.publicLine}${readLine}${friendshipLine}${skillLine}`, "social", gesture.tone, Math.max(gesture.importance, socialRead?.importance ?? 0));
    context.relationship.markEveningPlanOutcome(agent, "bonded", `found ${other.name} and left the park feeling more connected`, context.relationshipContext);
    context.relationship.markEveningPlanOutcome(other, "bonded", `${agent.name} made the evening feel less anonymous`, context.relationshipContext);
  }

  private applySocialPerceptionCue(
    observer: SimAgent,
    subject: SimAgent,
    cue: SocialPerceptionCue,
    observerRel: ReturnType<RelationshipSystem["relationshipFor"]>,
    subjectRel: ReturnType<RelationshipSystem["relationshipFor"]>,
    context: ActionResolverContext
  ) {
    observerRel.tension = Math.round(clamp(observerRel.tension + cue.tensionDelta));
    subjectRel.tension = Math.round(clamp(subjectRel.tension + cue.tensionDelta * 0.7));
    observerRel.trust = Math.round(clamp(observerRel.trust + cue.trustDelta));
    subjectRel.trust = Math.round(clamp(subjectRel.trust + cue.trustDelta * 0.7));
    observerRel.lastGesture = cue.label;
    observerRel.lastEvent = cue.observerMemory;
    subjectRel.lastEvent = cue.subjectMemory;
    observerRel.history.unshift(`${context.worldTime} ${cue.observerMemory}`);
    subjectRel.history.unshift(`${context.worldTime} ${cue.subjectMemory}`);
    observerRel.history.splice(4);
    subjectRel.history.splice(4);

    context.relationshipContext.recordSocialMoment(observer, {
      kind: "perception",
      label: cue.label,
      detail: cue.detail,
      tone: cue.tone,
      otherAgentId: subject.id,
      otherAgentName: subject.name,
      scoreDelta: Math.round(cue.observerDelta * 10) / 10,
      trustDelta: cue.trustDelta,
      supportDelta: 0,
      tags: cue.tags,
      durationMinutes: cue.importance >= 7 ? 360 : 240
    });

    if (cue.tone === "warn" || cue.tone === "bad") {
      context.addMoodlet(observer, {
        id: `social-read-${cue.id}`,
        label: cue.label,
        detail: cue.detail,
        tone: cue.tone,
        intensity: Math.min(7, 3 + cue.importance * 0.45),
        durationMinutes: 160,
        tags: ["social", ...cue.tags].slice(0, 8),
        actionBiases: cue.tensionDelta > 0 ? { resting: 4, socializing: -3, washing: cue.tags.includes("hygiene") ? 2 : 0 } : { socializing: 3, resting: 2 }
      });
    }

    context.addMemory(observer, "observation", cue.observerMemory, cue.importance, ["social", "perception", subject.id, ...cue.tags].slice(0, 8));
    context.addMemory(subject, "observation", cue.subjectMemory, Math.max(4, cue.importance - 1), ["social", "perception", observer.id, ...cue.tags].slice(0, 8));
  }

  private shareFood(agent: SimAgent, other: SimAgent, item: "meal" | "groceries", hungerRelief: number, context: ActionResolverContext) {
    const foodIndex = agent.inventory.findIndex((entry) => entry === item);
    if (foodIndex < 0) return false;

    agent.inventory.splice(foodIndex, 1);
    other.hunger = clamp(other.hunger - hungerRelief);
    other.energy = clamp(other.energy + (item === "groceries" ? 4 : 3));
    other.comfort = clamp(other.comfort + 4);
    this.recordMeal(other, context, {
      label: item === "groceries" ? "shared groceries" : "shared meal",
      quality: item === "groceries" ? 68 : 52,
      hydration: item === "groceries" ? 16 : 10,
      variety: item === "groceries" ? 62 : 42,
      fullness: item === "groceries" ? 60 : 48
    });
    other.routine.ateToday = true;
    other.routine.mealsToday += 1;
    context.relationship.adjustReputation(agent, { warmth: 2, reliability: 1 });
    context.relationship.adjustReputation(other, { warmth: 1 });
    context.addMemory(other, "event", `${agent.name} shared ${item === "groceries" ? "groceries" : "a meal"} and made hunger easier to handle.`, 7, [
      "food",
      "social",
      agent.id
    ]);
    return true;
  }

  private recordMeal(
    agent: SimAgent,
    context: ActionResolverContext,
    meal: { label: string; quality: number; hydration: number; variety: number; fullness: number }
  ) {
    const qualityTarget = clamp(meal.quality);
    const varietyTarget = clamp(meal.variety);
    const fullnessTarget = clamp(Math.max(meal.fullness, 100 - agent.hunger));
    agent.nutrition.quality = Math.round(clamp(agent.nutrition.quality * 0.66 + qualityTarget * 0.34));
    agent.nutrition.hydration = Math.round(clamp(agent.nutrition.hydration + meal.hydration));
    agent.nutrition.variety = Math.round(clamp(agent.nutrition.variety * 0.72 + varietyTarget * 0.28));
    agent.nutrition.fullness = Math.round(clamp(Math.max(agent.nutrition.fullness * 0.62, fullnessTarget)));
    agent.nutrition.lastMealLabel = meal.label;
    agent.nutrition.lastMealWorldTime = context.worldTime;
    agent.nutrition.recent.unshift(
      `${context.worldTime} ${meal.label}: quality ${Math.round(agent.nutrition.quality)}, hydration ${Math.round(agent.nutrition.hydration)}, variety ${Math.round(agent.nutrition.variety)}.`
    );
    agent.nutrition.recent.splice(4);
  }

  private easeMinorIllness(agent: SimAgent, amount: number, context: ActionResolverContext, reason: string) {
    const illness = agent.medical.minorIllness;
    if (!illness.active || amount <= 0) return false;
    const before = illness.severity;
    illness.severity = Math.round(clamp(illness.severity - amount) * 10) / 10;
    illness.recoveryWorldMinutes = Math.min(illness.recoveryWorldMinutes, context.worldMinutes + Math.max(18, illness.severity * 1.4));
    if (illness.severity > 8) return before - illness.severity >= 4;

    const label = illness.label ?? "minor illness";
    agent.medical.minorIllness = {
      active: false,
      label: null,
      severity: 0,
      startedWorldTime: null,
      startedWorldMinutes: 0,
      recoveryWorldMinutes: 0,
      lastResolvedWorldMinutes: context.worldMinutes
    };
    agent.stress = clamp(agent.stress - 4);
    agent.mood = clamp(agent.mood + 3);
    context.addMemory(agent, "event", `${label} cleared after ${reason}.`, 6, ["health", "recovery"]);
    context.log(agent, `${agent.name}'s ${label.toLowerCase()} cleared after ${reason}.`, "health", "good", 6);
    return true;
  }

  private followAftercare(agent: SimAgent, context: ActionResolverContext) {
    const aftercare = agent.medical.aftercare;
    if (!aftercare.active) {
      agent.stress = clamp(agent.stress - 3);
      agent.energy = clamp(agent.energy + 3);
      this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.4, heatDelta: 2 });
      context.addMemory(agent, "reflection", "Checked for aftercare, but there was no active care plan.", 3, ["health", "aftercare"]);
      context.log(agent, `${agent.name} checked their health routine at home.`, "health", "neutral", 3);
      return;
    }

    const doseReady = aftercare.dosesRemaining > 0 && (aftercare.lastDoseWorldMinutes < 0 || context.worldMinutes - aftercare.lastDoseWorldMinutes >= 45);
    const tookDose = doseReady;
    if (tookDose) {
      aftercare.dosesRemaining = Math.max(0, aftercare.dosesRemaining - 1);
      aftercare.lastDoseWorldMinutes = context.worldMinutes;
    }
    const restMinutes = Math.min(aftercare.restMinutesRemaining, tookDose ? 35 : 45);
    aftercare.restMinutesRemaining = Math.max(0, Math.round((aftercare.restMinutesRemaining - restMinutes) * 10) / 10);
    const careSkill = this.skillEffect(agent, "care");
    const recovery = (tookDose ? 7 : 3) + restMinutes * 0.08 + careSkill * 0.08;
    agent.health = clamp(agent.health + recovery);
    agent.energy = clamp(agent.energy + 4 + restMinutes * 0.04);
    agent.stress = clamp(agent.stress - (5 + restMinutes * 0.06 + careSkill * 0.04));
    agent.mood = clamp(agent.mood + (tookDose ? 3 : 1));
    const illnessImproved = this.easeMinorIllness(agent, (tookDose ? 20 : 9) + restMinutes * 0.08 + careSkill * 0.06, context, "aftercare follow-through");
    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.4, heatDelta: 3 });
    const completed = aftercare.dosesRemaining <= 0 && aftercare.restMinutesRemaining <= 0;
    if (completed) {
      aftercare.active = false;
      aftercare.detail = "Completed";
    }
    const skillResult = context.advanceSkill(agent, "care", tookDose ? 2.8 : 1.6, "Followed an aftercare plan", ["health", "aftercare", "home"]);
    context.advanceAspiration(agent, completed ? 4.8 : 2.6, completed ? "Finished aftercare" : "Followed aftercare", ["health", "routine", "stability"]);
    context.addMoodlet(agent, {
      id: completed ? "aftercare-complete" : "aftercare-followed",
      label: completed ? "Care Plan Done" : tookDose ? "Dose Taken" : "Recovery Rest",
      detail: completed
        ? "the treatment plan is complete"
        : `${aftercare.dosesRemaining} doses and ${Math.round(aftercare.restMinutesRemaining)} rest minutes left`,
      tone: "good",
      intensity: completed ? 5.5 : 4.5,
      durationMinutes: completed ? 240 : 180,
      tags: ["health", "aftercare", "home"],
      actionBiases: completed ? { working: 4, socializing: 2, healing: -8 } : { resting: 6, healing: aftercare.dosesRemaining > 0 ? 6 : -4 },
      moodDelta: completed ? 2 : 1,
      stressDelta: completed ? -3 : -1
    });
    context.addMemory(
      agent,
      "event",
      completed
        ? `Finished the aftercare plan${skillResult.leveled ? " and got better at self-care" : ""}.`
        : `${tookDose ? "Took an aftercare dose" : "Rested for aftercare"}${illnessImproved ? " and symptoms eased" : ""}; ${aftercare.dosesRemaining} doses remain.`,
      completed ? 7 : 6,
      ["health", "aftercare", "home"]
    );
    context.log(
      agent,
      completed
        ? `${agent.name} finished their aftercare plan.`
        : `${agent.name} followed aftercare at home${tookDose ? " and took medicine" : ""}.`,
      "health",
      "good",
      completed ? 7 : 6
    );
  }

  private prescribeAftercare(
    agent: SimAgent,
    context: ActionResolverContext,
    input: { label: string; detail: string; doses: number; restMinutes: number; followUpMinutes: number; expiresMinutes: number }
  ) {
    const current = agent.medical.aftercare.active ? agent.medical.aftercare : null;
    agent.medical.aftercare = {
      active: true,
      label: input.label,
      detail: input.detail,
      dosesRemaining: Math.max(input.doses, current?.dosesRemaining ?? 0),
      restMinutesRemaining: Math.max(input.restMinutes, current?.restMinutesRemaining ?? 0),
      followUpDueWorldMinutes: context.worldMinutes + input.followUpMinutes,
      expiresWorldMinutes: context.worldMinutes + input.expiresMinutes,
      lastDoseWorldMinutes: current?.lastDoseWorldMinutes ?? -9999,
      missedCheckins: 0
    };
  }

  private visitClinic(agent: SimAgent, context: ActionResolverContext) {
    const hadIllnessBefore = agent.medical.minorIllness.active;
    const healthBefore = agent.health;
    const intent = agent.target?.intent?.kind === "health" ? agent.target.intent : null;
    const strategy = intent?.strategy ?? "treat_symptoms";
    const profile =
      strategy === "clinic_checkup"
        ? {
            label: "Checkup",
            cost: 3,
            deferredBill: 2,
            healthGain: 10,
            energyGain: 2,
            stressRelief: 4,
            illnessRelief: 18,
            moodDelta: 1,
            stockUse: agent.medical.minorIllness.active || agent.health < 72 ? 1 : 0,
            skillXp: 2,
            aspiration: 2.6,
            memory: "Got a clinic checkup",
            log: "got a checkup at the clinic"
          }
        : strategy === "urgent_care"
          ? {
              label: "Urgent Care",
              cost: 10,
              deferredBill: 8,
              healthGain: 34,
              energyGain: 6,
              stressRelief: 12,
              illnessRelief: 62,
              moodDelta: 3,
              stockUse: 2,
              skillXp: 4.6,
              aspiration: 6,
              memory: "Used urgent clinic care",
              log: "used urgent care at the clinic"
            }
          : strategy === "seek_unpaid_care"
            ? {
                label: "Unpaid Care",
                cost: 0,
                deferredBill: agent.health < 50 || agent.medical.minorIllness.severity >= 54 ? 4 : 2,
                healthGain: 11,
                energyGain: 2,
                stressRelief: 2,
                illnessRelief: 22,
                moodDelta: -2,
                stockUse: agent.health < 50 || agent.medical.minorIllness.active ? 1 : 0,
                skillXp: 2.4,
                aspiration: 3.4,
                memory: "Asked for clinic care without paying up front",
                log: "asked for clinic help without paying up front"
              }
            : {
                label: "Treated",
                cost: 6,
                deferredBill: 4,
                healthGain: 24,
                energyGain: 4,
                stressRelief: 8,
                illnessRelief: 48,
                moodDelta: 2,
                stockUse: 1,
                skillXp: 3.4,
                aspiration: 4.6,
                memory: "Got clinic treatment",
                log: "paid for treatment at the clinic"
              };
    const intendedCost = Math.max(0, intent?.amount ?? profile.cost);
    const paymentSource = intent?.paymentSource ?? (agent.money >= intendedCost ? "cash" : agent.money + agent.budget.savings >= intendedCost ? "liquid" : "none");
    const savingsAllowed =
      paymentSource === "savings" ||
      paymentSource === "liquid" ||
      intent?.savingsAllowed === true ||
      strategy === "urgent_care" ||
      agent.health < 58 ||
      agent.medical.minorIllness.severity >= 54;
    const spendableCash = paymentSource === "savings" || paymentSource === "none" ? 0 : agent.money;
    const spendableSavings = savingsAllowed ? agent.budget.savings : 0;
    const canPayNow = intendedCost <= 0 || (paymentSource !== "none" && spendableCash + spendableSavings >= intendedCost);
    let paidCost = 0;
    let savingsWithdrawn = 0;
    if (intendedCost > 0 && canPayNow) {
      const cashToUse = Math.min(spendableCash, intendedCost);
      const withdrawalNeeded = Math.max(0, intendedCost - cashToUse);
      savingsWithdrawn =
        withdrawalNeeded > 0 && savingsAllowed && agent.budget.savings > 0
          ? context.withdrawSavings(agent, withdrawalNeeded, strategy === "urgent_care" ? "Urgent clinic savings" : "Clinic care savings")
          : 0;
      paidCost = Math.min(intendedCost, cashToUse + savingsWithdrawn);
    }
    const objectState = context.objectStates.currentForAgent(agent);
    const limitedCare = objectState?.stock !== undefined && objectState.stock <= 0;
    const underfundedCare = intendedCost > 0 && paidCost < intendedCost;
    const billedLater = underfundedCare || strategy === "seek_unpaid_care";
    const careSkill = this.skillEffect(agent, "care");
    if (paidCost > 0) context.transact(agent, -paidCost, "medical", profile.label);
    if (billedLater) {
      const bill = Math.max(1, Math.round(profile.deferredBill * (limitedCare ? 0.7 : 1)));
      agent.medicalDebt = Math.round((agent.medicalDebt + bill) * 100) / 100;
      context.recordFinance(agent, bill, "medical", `${profile.label} bill`, "debt");
      agent.budget.lastReview = `${agent.medicalDebt} medical debt due`;
    }
    agent.routine.medicalVisitToday = true;
    const careMultiplier = (limitedCare ? 0.56 : 1) * (underfundedCare ? 0.58 : 1);
    agent.health = clamp(agent.health + profile.healthGain * careMultiplier + careSkill * 0.16);
    agent.energy = clamp(agent.energy + profile.energyGain * careMultiplier + careSkill * 0.04);
    agent.stress = clamp(agent.stress - (profile.stressRelief * careMultiplier + careSkill * 0.08) + (underfundedCare ? 3 : 0));
    agent.mood = clamp(agent.mood + profile.moodDelta + (limitedCare ? -4 : 0) + (underfundedCare ? -3 : paidCost > 0 ? 1 : 0));
    const illnessImproved = this.easeMinorIllness(
      agent,
      profile.illnessRelief * careMultiplier + careSkill * 0.08,
      context,
      limitedCare ? "thin clinic care" : underfundedCare ? "deferred clinic care" : profile.label.toLowerCase()
    );
    context.relationship.adjustReputation(
      agent,
      paidCost > 0 ? { reliability: strategy === "urgent_care" ? 3 : 2 } : billedLater ? { reliability: -1, trouble: 1 } : { reliability: -1 }
    );
    const stockAfterUse = objectState?.stock !== undefined ? objectState.stock - profile.stockUse : undefined;
    this.recordObjectUse(agent, context, {
      stockDelta: objectState?.stock !== undefined && !limitedCare && profile.stockUse > 0 ? -profile.stockUse : undefined,
      cleanlinessDelta: -2,
      wearDelta: strategy === "urgent_care" ? 1.8 : 1,
      heatDelta: strategy === "urgent_care" ? 10 : 6,
      unmetDemandDelta: limitedCare || underfundedCare ? 1 : 0,
      servicePressureDelta: limitedCare ? 22 : stockAfterUse !== undefined && stockAfterUse <= 2 ? 8 : undefined,
      issue: limitedCare ? "Clinic supplies exhausted" : stockAfterUse !== undefined && stockAfterUse <= 2 ? "Clinic supplies running low" : undefined
    });
    const skillResult = context.advanceSkill(agent, "care", profile.skillXp * (limitedCare ? 0.75 : 1), "Navigated care at the clinic", [
      "health",
      "clinic",
      "care"
    ]);
    context.advanceAspiration(agent, profile.aspiration * (limitedCare ? 0.7 : 1), "Handled health before collapse", ["health", "clinic", "wellness", "stability"]);
    if (strategy === "urgent_care" || strategy === "treat_symptoms" || strategy === "seek_unpaid_care" || hadIllnessBefore || healthBefore < 72) {
      this.prescribeAftercare(agent, context, {
        label:
          strategy === "urgent_care"
            ? "Urgent Care Aftercare"
            : strategy === "seek_unpaid_care"
              ? "Clinic Aftercare"
              : strategy === "clinic_checkup"
                ? "Checkup Advice"
                : "Treatment Aftercare",
        detail: billedLater ? "care helped, but payment and recovery still need attention" : "follow the care plan to avoid relapse",
        doses: strategy === "urgent_care" ? 3 : strategy === "clinic_checkup" ? 1 : 2,
        restMinutes: strategy === "urgent_care" ? 120 : strategy === "clinic_checkup" ? 35 : 70,
        followUpMinutes: strategy === "urgent_care" ? 360 : 480,
        expiresMinutes: strategy === "urgent_care" ? 900 : 720
      });
    }
    const moodletLabel = limitedCare ? "Thin Care" : underfundedCare ? "Care Bill Added" : profile.label;
    context.addMoodlet(agent, {
      id: limitedCare ? "thin-care" : underfundedCare ? "care-bill-added" : `clinic-${strategy}`,
      label: moodletLabel,
      detail: limitedCare
        ? "clinic supplies were stretched"
        : underfundedCare
          ? "care helped, but the bill moved to civic debt"
          : savingsWithdrawn > 0
            ? "care was covered by combining cash and savings"
            : "clinic care made the body feel safer",
      tone: limitedCare || underfundedCare ? "warn" : "good",
      intensity: limitedCare || underfundedCare ? 4.5 : strategy === "urgent_care" ? 6.5 : 5.5,
      durationMinutes: limitedCare || underfundedCare ? 190 : strategy === "urgent_care" ? 320 : 260,
      tags: ["health", "clinic", "care"],
      actionBiases:
        limitedCare || underfundedCare
          ? { resting: 8, healing: 5, working: underfundedCare ? 8 : -4, budgeting: underfundedCare ? 8 : 0 }
          : { resting: 4, working: 3, healing: -10 }
    });
    const savingsLine = savingsWithdrawn > 0 ? ` using ${savingsWithdrawn} from savings` : "";
    const billLine = billedLater ? ` and took on a ${agent.medicalDebt}-credit medical balance` : "";
    context.addMemory(
      agent,
      "event",
      limitedCare
        ? `Clinic supplies were thin, but the visit still helped${illnessImproved ? " the symptoms" : ""}${skillResult.leveled ? " and taught a little self-care" : ""}.`
        : paidCost > 0
          ? `${profile.memory}${savingsLine}${illnessImproved ? " and treated symptoms" : ""}${skillResult.leveled ? " and learned the care routine better" : ""}.`
          : `${profile.memory}${billLine}${illnessImproved ? " and still got symptom care" : ""}${skillResult.leveled ? " and learned how care works here" : ""}.`,
      7,
      ["health", "clinic", "care"]
    );
    context.log(
      agent,
      limitedCare
        ? `${agent.name} visited the clinic, but supplies were running thin.`
        : paidCost > 0
          ? `${agent.name} ${profile.log}${savingsWithdrawn > 0 ? " by combining cash and savings" : ""}.`
          : `${agent.name} got clinic help with payment deferred.`,
      "health",
      limitedCare || underfundedCare ? "warn" : "good",
      7
    );
  }

  private checkMail(agent: SimAgent, context: ActionResolverContext) {
    const civicSkill = this.skillEffect(agent, "civic");
    agent.routine.checkedMailToday = true;
    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 3 });
    const unreadNotice = agent.personalNotices
      .filter((notice) => notice.status === "unread")
      .sort((a, b) => b.importance - a.importance || a.dueDay - b.dueDay)[0];
    if (unreadNotice) {
      unreadNotice.status = "read";
      const urgent = unreadNotice.tone === "bad" || unreadNotice.tone === "warn";
      agent.stress = clamp(agent.stress + (urgent ? Math.max(1, 4 - civicSkill * 0.05) : -1));
      agent.mood = clamp(agent.mood + (unreadNotice.tone === "good" ? 2 : urgent ? -1 : 0));
      context.advanceAspiration(agent, 1.8, "Opened personal mail", ["mail", "notice", ...unreadNotice.tags]);
      context.advanceSkill(agent, "civic", 1.4, "Read a personal notice", ["mail", "notice", "civic"]);
      context.addMoodlet(agent, {
        id: `personal-notice-${unreadNotice.kind}`,
        label: unreadNotice.label,
        detail: unreadNotice.detail,
        tone: unreadNotice.tone,
        intensity: Math.min(7, 2.5 + unreadNotice.importance * 0.5),
        durationMinutes: urgent ? 260 : 180,
        tags: ["mail", "notice", ...unreadNotice.tags].slice(0, 8),
        actionBiases: Object.fromEntries(unreadNotice.actions.map((action) => [action, action === "checking_mail" ? -8 : urgent ? 10 : 5])) as Partial<
          Record<SimAgent["currentAction"], number>
        >
      });
      context.addMemory(agent, "event", `Read personal mail: ${unreadNotice.label}. ${unreadNotice.detail}`, Math.min(8, unreadNotice.importance), [
        "mail",
        "notice",
        ...unreadNotice.tags
      ]);
      context.log(agent, `${agent.name} opened personal mail: ${unreadNotice.label}.`, "routine", unreadNotice.tone === "bad" ? "warn" : "neutral", 5);
      if (this.totalBillsDue(agent) <= 0) return;
    }
    if (this.totalBillsDue(agent) > 0) {
      agent.stress = clamp(agent.stress + Math.max(1, 4 - civicSkill * 0.08));
      const reminders = [
        agent.rentDue > 0 ? `${agent.rentDue}-credit rent reminder` : "",
        agent.medicalDebt > 0 ? `${agent.medicalDebt}-credit medical bill` : "",
        agent.budget.livingCostDue > 0 ? `${agent.budget.livingCostDue}-credit utilities/basic costs notice` : ""
      ].filter(Boolean);
      context.advanceAspiration(agent, 1.8, "Faced a civic notice instead of ignoring it", ["mail", "civic", "stability", "money"]);
      context.advanceSkill(agent, "civic", 1.8, "Read bill notices", ["mail", "bill", "civic"]);
      context.addMoodlet(agent, {
        id: "bill-notice",
        label: "Bill Notice",
        detail: reminders.join(" and "),
        tone: "warn",
        intensity: 4.5,
        durationMinutes: 200,
        tags: ["mail", "money", "bill"],
        actionBiases: { paying_rent: 12, budgeting: 8, working: 6, socializing: -4 }
      });
      context.addMemory(agent, "event", `Checked mail and saw a ${reminders.join(" and a ")}.`, 6, ["mail", "rent", "health", "living-costs", "money"]);
      context.log(agent, `${agent.name} checked mail and saw ${reminders.join(" and ")}.`, "money", "warn", 6);
      return;
    }

    agent.stress = clamp(agent.stress - (3 + civicSkill * 0.04));
    agent.mood = clamp(agent.mood + 1);
    context.advanceAspiration(agent, 1.6, "Kept mail from piling up", ["mail", "civic", "stability"]);
    context.advanceSkill(agent, "civic", 1.2, "Kept notices sorted", ["mail", "civic"]);
    context.addMoodlet(agent, {
      id: "clear-mail",
      label: "Clear Mail",
      detail: "nothing urgent in the box",
      tone: "neutral",
      intensity: 2.5,
      durationMinutes: 120,
      tags: ["mail", "routine"],
      actionBiases: { checking_mail: -8, resting: 2 }
    });
    context.addMemory(agent, "event", "Checked mail and found nothing urgent.", 4, ["mail", "routine"]);
    context.log(agent, `${agent.name} checked mail and found nothing urgent.`, "routine", "neutral", 4);
  }

  private reviewBudget(agent: SimAgent, context: ActionResolverContext) {
    const civicSkill = this.skillEffect(agent, "civic");
    const intent = agent.target?.intent?.kind === "civic" ? agent.target.intent : null;
    const billTotal = this.totalBillsDue(agent);
    const savingsGap = Math.max(0, agent.budget.savingsGoal - agent.budget.savings);
    const preserveCash = Math.max(5, intent?.preserveCash ?? agent.budget.dailySpendLimit * 0.65, billTotal);
    const spareCash = Math.max(0, agent.money - preserveCash);
    const requestedDeposit = Math.max(0, intent?.amount ?? 0);
    const plannedDeposit = Math.min(savingsGap, spareCash, requestedDeposit > 0 ? requestedDeposit : spareCash);
    const deposited = plannedDeposit >= 1 ? context.depositSavings(agent, plannedDeposit, "Planned savings deposit") : 0;
    const overBudget = Math.max(0, agent.budget.spentToday - agent.budget.dailySpendLimit);
    const oldLimit = agent.budget.dailySpendLimit;

    if (overBudget > 0 && deposited === 0 && agent.budget.dailySpendLimit > 6) {
      agent.budget.dailySpendLimit = Math.max(6, Math.round((agent.budget.dailySpendLimit - 1) * 100) / 100);
    } else if (deposited > 0 && agent.budget.savings >= agent.budget.savingsGoal && overBudget === 0) {
      agent.budget.dailySpendLimit = Math.min(18, Math.round((agent.budget.dailySpendLimit + 0.5) * 100) / 100);
    }

    const limitChanged = agent.budget.dailySpendLimit !== oldLimit;
    agent.budget.lastReview =
      deposited > 0
        ? `Moved ${deposited} to savings`
        : overBudget > 0
          ? `Reviewed ${Math.round(overBudget)} over budget`
          : agent.budget.creditScore < 560
            ? `Reviewed credit ${agent.budget.creditScore}`
            : "Budget reviewed";
    agent.stress = clamp(agent.stress - (deposited > 0 ? 8 : 4) - civicSkill * 0.05);
    agent.mood = clamp(agent.mood + (deposited > 0 ? 3 : 1));
    this.applyAutonomy(agent, context, {
      dignity: deposited > 0 ? 3 : 1,
      control: deposited > 0 ? 9 : 7,
      overwhelm: deposited > 0 ? -7 : -5,
      note: deposited > 0 ? "Budgeting converted spare cash into control." : "Budget review made the numbers feel less vague."
    });
    context.relationship.adjustReputation(agent, { reliability: deposited > 0 ? 3 : 1 });
    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 4 });
    const skillResult = context.advanceSkill(agent, "civic", deposited > 0 ? 3.6 : 2.4, deposited > 0 ? "Planned savings from spare cash" : "Reviewed budget tradeoffs", [
      "budget",
      "savings",
      "money"
    ]);
    context.advanceAspiration(agent, deposited > 0 ? 4.8 : 2.8, deposited > 0 ? "Protected future savings" : "Reviewed money before drifting", [
      "money",
      "stability",
      "budget"
    ]);
    context.addMoodlet(agent, {
      id: deposited > 0 ? "budget-control" : "budget-reviewed",
      label: deposited > 0 ? "Budget Control" : "Budget Reviewed",
      detail: deposited > 0 ? `${deposited} credits moved to savings` : agent.budget.lastReview,
      tone: deposited > 0 ? "good" : overBudget > 0 ? "warn" : "neutral",
      intensity: deposited > 0 ? 4.5 : overBudget > 0 ? 4 : 2.5,
      durationMinutes: deposited > 0 ? 220 : 150,
      tags: ["money", "budget", "civic"],
      actionBiases: deposited > 0 ? { budgeting: -8, working: 4, socializing: 2 } : { budgeting: overBudget > 0 ? 8 : -4, working: overBudget > 0 ? 4 : 0 }
    });
    const limitLine = limitChanged ? ` Daily spend limit is now ${agent.budget.dailySpendLimit}.` : "";
    context.addMemory(
      agent,
      "event",
      deposited > 0
        ? `Budgeted at town hall and moved ${deposited} credits to savings.${limitLine}${skillResult.leveled ? " Civic planning got sharper." : ""}`
        : `Reviewed the budget at town hall without moving money.${limitLine}${skillResult.leveled ? " Civic planning got sharper." : ""}`,
      6,
      ["money", "budget", "savings", "civic"]
    );
    context.log(
      agent,
      deposited > 0
        ? `${agent.name} budgeted carefully and moved ${deposited} credits into savings.`
        : `${agent.name} reviewed their budget${limitChanged ? " and adjusted the daily limit" : ""}.`,
      "money",
      deposited > 0 ? "good" : overBudget > 0 ? "warn" : "neutral",
      6
    );
  }

  private handleCivicBills(agent: SimAgent, context: ActionResolverContext) {
    const civicSkill = this.skillEffect(agent, "civic");
    if (this.totalBillsDue(agent) <= 0) {
      agent.stress = clamp(agent.stress - (2 + civicSkill * 0.05));
      this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 3 });
      context.advanceSkill(agent, "civic", 1.1, "Reviewed civic account", ["civic", "money"]);
      context.addMemory(agent, "event", "Checked town hall and had no bills due.", 4, ["rent", "health", "city"]);
      context.log(agent, `${agent.name} checked their civic account at town hall.`, "money", "neutral", 4);
      return;
    }

    const intent = agent.target?.intent?.kind === "civic" ? agent.target.intent : null;
    if (intent?.strategy === "review_only") {
      agent.stress = clamp(agent.stress + (this.totalBillsDue(agent) > 0 ? Math.max(1, 4 - civicSkill * 0.06) : -2));
      agent.budget.lastReview = intent.label;
      this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 3 });
      context.advanceSkill(agent, "civic", 1.6, "Reviewed bills without panicking", ["civic", "bill"]);
      context.addMemory(agent, "event", `Reviewed civic bills instead of paying immediately: ${intent.label}.`, 6, ["money", "civic", "bill"]);
      context.log(agent, `${agent.name} reviewed bills at town hall and held off for now.`, "money", this.totalBillsDue(agent) > 0 ? "warn" : "neutral", 6);
      return;
    }

    if (intent?.strategy === "request_payment_plan") {
      this.requestPaymentPlan(agent, context);
      return;
    }

    if (intent?.billType === "rent" && agent.rentDue > 0) {
      if (this.payRent(agent, context, intent)) return;
      this.failRent(agent, context);
      return;
    }

    if (intent?.billType === "medical" && agent.medicalDebt > 0) {
      if (this.payMedicalBill(agent, context, intent)) return;
      this.failMedicalBill(agent, context);
      return;
    }

    if (intent?.billType === "living" && agent.budget.livingCostDue > 0) {
      if (this.payLivingCosts(agent, context, intent)) return;
      this.failLivingCosts(agent, context);
      return;
    }

    if (agent.rentDue > 0) {
      if (agent.money + agent.budget.savings > 0 && this.payRent(agent, context, intent ?? undefined)) return;
      this.failRent(agent, context);
      return;
    }

    if (agent.medicalDebt > 0 && agent.money + agent.budget.savings > 0) {
      if (this.payMedicalBill(agent, context, intent ?? undefined)) return;
      this.failMedicalBill(agent, context);
      return;
    }

    if (agent.budget.livingCostDue > 0 && agent.money + agent.budget.savings > 0) {
      if (this.payLivingCosts(agent, context, intent ?? undefined)) return;
      this.failLivingCosts(agent, context);
      return;
    }

    if (agent.medicalDebt > 0) this.failMedicalBill(agent, context);
    else this.failLivingCosts(agent, context);
  }

  private requestPaymentPlan(agent: SimAgent, context: ActionResolverContext) {
    const civicSkill = this.skillEffect(agent, "civic");
    const due = this.totalBillsDue(agent);
    if (due <= 0) {
      agent.budget.lastReview = "No payment plan needed";
      agent.stress = clamp(agent.stress - 2);
      this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 2 });
      context.advanceSkill(agent, "civic", 1.2, "Asked about civic account options", ["civic", "money"]);
      context.addMemory(agent, "reflection", "Asked about bill extensions, but nothing was due.", 3, ["money", "civic"]);
      context.log(agent, `${agent.name} asked about payment plans, but their account was clear.`, "money", "neutral", 3);
      return;
    }

    const hardshipLoad = Math.max(0, due - (agent.money + agent.budget.savings));
    const approvalScore =
      civicSkill * 0.8 +
      agent.dna.discipline * 0.18 +
      agent.reputation.reliability * 0.16 +
      Math.max(0, 640 - agent.budget.creditScore) * 0.015 -
      agent.budget.hardshipDeferrals * 8 -
      Math.max(0, agent.budget.overdueBillDays - 2) * 4;
    const approved = approvalScore >= 18 || hardshipLoad >= 3 || agent.budget.overdueBillDays <= 1;
    const deferralDays = approved ? (agent.budget.overdueBillDays >= 2 ? 2 : 1) : 0;

    if (approved) {
      agent.budget.hardshipDeferrals = Math.min(3, Math.max(agent.budget.hardshipDeferrals, deferralDays));
      agent.budget.lastReview = deferralDays > 1 ? "Payment plan approved" : "Bill extension approved";
      agent.stress = clamp(agent.stress - (8 + civicSkill * 0.06));
      agent.mood = clamp(agent.mood + 3);
      agent.budget.overdueBillDays = Math.max(0, agent.budget.overdueBillDays - 1);
      context.adjustCredit(agent, agent.budget.creditScore < 560 ? 2 : 1, "Arranged payment plan before fees got worse");
      context.relationship.adjustReputation(agent, { reliability: 2, trouble: -1 });
    } else {
      agent.budget.lastReview = "Payment plan denied";
      agent.stress = clamp(agent.stress + 5);
      agent.mood = clamp(agent.mood - 2);
      context.relationship.adjustReputation(agent, { reliability: -1 });
    }
    this.applyAutonomy(agent, context, {
      dignity: approved ? 3 : -3,
      control: approved ? 8 : -2,
      overwhelm: approved ? -10 : 5,
      note: approved ? "A payment plan made the bills feel survivable." : "A denied extension made the bills feel tighter."
    });

    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: approved ? 5 : 9, servicePressureDelta: approved ? -6 : 3 });
    const skillResult = context.advanceSkill(agent, "civic", approved ? 2.6 : 1.7, approved ? "Arranged a payment plan" : "Tried to arrange payment plan", [
      "civic",
      "money",
      "bills"
    ]);
    context.advanceAspiration(agent, approved ? 4 : 2, approved ? "Kept bills from becoming a spiral" : "Tried to handle bills responsibly", [
      "money",
      "stability",
      "civic"
    ]);
    context.addMoodlet(agent, {
      id: approved ? "payment-plan" : "payment-plan-denied",
      label: approved ? "Payment Plan" : "Extension Denied",
      detail: approved ? `${deferralDays} day${deferralDays === 1 ? "" : "s"} of fee protection` : "town hall did not grant extra time",
      tone: approved ? "good" : "warn",
      intensity: approved ? 4.8 : 5.5,
      durationMinutes: approved ? 260 : 190,
      tags: ["money", "bills", "civic"],
      actionBiases: approved ? { working: 8, paying_rent: 6, budgeting: 3, resting: 2 } : { working: 14, paying_rent: 10, budgeting: 8 }
    });
    context.addMemory(
      agent,
      approved ? "event" : "reflection",
      approved
        ? `Town hall approved a short payment plan on ${due} credits of bills${skillResult.leveled ? ", and civic paperwork felt easier" : ""}.`
        : `Tried to get a payment plan for ${due} credits of bills, but town hall would not grant extra time.`,
      approved ? 7 : 6,
      ["money", "bills", "civic"]
    );
    context.log(
      agent,
      approved
        ? `${agent.name} arranged a short payment plan before bills got worse.`
        : `${agent.name} asked for a payment plan, but town hall did not grant one.`,
      "money",
      approved ? "good" : "warn",
      7
    );
  }

  private payRent(agent: SimAgent, context: ActionResolverContext, intent?: AgentActionIntent) {
    const civicSkill = this.skillEffect(agent, "civic");
    const dueBeforePayment = agent.rentDue;
    const paymentGoal = Math.min(dueBeforePayment, Math.max(0, intent?.amount ?? dueBeforePayment));
    const strategyAllowsSavings = intent?.strategy.includes("savings") === true || intent?.strategy.includes("liquid") === true;
    const paymentSource = intent?.paymentSource ?? (intent && intent.savingsAllowed !== true && !strategyAllowsSavings ? "cash" : "liquid");
    const savingsAllowed = paymentSource === "savings" || paymentSource === "liquid";
    const sourceAllowsCash = paymentSource !== "savings" && paymentSource !== "none";
    const preserveCash = Math.max(0, intent?.preserveCash ?? 0);
    if (paymentSource === "none" || paymentGoal <= 0) return false;

    const preserveForPartial = intent?.strategy === "pay_rent_partial" ? preserveCash : 0;
    const spendableCash = sourceAllowsCash ? Math.max(0, agent.money - preserveForPartial) : 0;
    const spendableSavings = savingsAllowed ? agent.budget.savings : 0;
    const plannedPayment = Math.min(paymentGoal, dueBeforePayment, spendableCash + spendableSavings);
    const cashToUse = Math.min(spendableCash, plannedPayment);
    const withdrawalNeeded = Math.max(0, plannedPayment - cashToUse);
    const savingsWithdrawn =
      withdrawalNeeded > 0 && savingsAllowed && agent.budget.savings > 0
        ? context.withdrawSavings(agent, withdrawalNeeded, "Rent savings withdrawal")
        : 0;
    const paid = Math.min(cashToUse + savingsWithdrawn, paymentGoal, dueBeforePayment);
    if (paid <= 0) return false;

    context.transact(agent, -paid, "housing", "Rent payment");
    agent.rentDue = Math.round((agent.rentDue - paid) * 100) / 100;
    if (agent.rentDue === 0) {
      agent.routine.paidRentToday = true;
      agent.budget.onTimeBillStreak += 1;
      context.adjustCredit(agent, 8 + Math.min(8, agent.budget.onTimeBillStreak), "Rent paid on time");
      agent.comfort = clamp(agent.comfort + 6);
      agent.budget.lastReview = "Rent paid";
    } else {
      agent.budget.lastReview = `${agent.rentDue} rent still due`;
    }
    agent.stress = clamp(agent.stress - (agent.rentDue === 0 ? 16 : 6) - civicSkill * 0.08);
    agent.mood = clamp(agent.mood + (agent.rentDue === 0 ? 4 : 1));
    this.applyAutonomy(agent, context, {
      dignity: agent.rentDue === 0 ? 8 : 3,
      control: agent.rentDue === 0 ? 10 : 4,
      overwhelm: agent.rentDue === 0 ? -14 : -5,
      note: agent.rentDue === 0 ? "Clearing rent restored housing dignity." : "Reducing rent pressure helped the day feel less trapped."
    });
    context.relationship.adjustReputation(agent, { reliability: paid >= dueBeforePayment ? 6 : 2, trouble: paid >= dueBeforePayment ? -2 : 0 });
    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 4 });
    const skillResult = context.advanceSkill(agent, "civic", agent.rentDue === 0 ? 3.4 : 2, agent.rentDue === 0 ? "Paid rent cleanly" : "Reduced rent due", [
      "rent",
      "civic",
      "money"
    ]);
    context.advanceAspiration(agent, agent.rentDue === 0 ? 6 : 3, agent.rentDue === 0 ? "Paid rent before it got worse" : "Reduced rent pressure", [
      "rent",
      "housing",
      "money",
      "stability"
    ]);
    const savingsLine = savingsWithdrawn > 0 ? ` using ${savingsWithdrawn} from savings` : "";
    context.addMoodlet(agent, {
      id: agent.rentDue === 0 ? "rent-relief" : "rent-reduced",
      label: agent.rentDue === 0 ? "Rent Relief" : "Rent Reduced",
      detail: agent.rentDue === 0 ? `${paid} credits handled before it got worse` : `${agent.rentDue} credits still due`,
      tone: agent.rentDue === 0 ? "good" : "warn",
      intensity: agent.rentDue === 0 ? 6 : 4.5,
      durationMinutes: agent.rentDue === 0 ? 300 : 210,
      tags: ["rent", "money", "home"],
      actionBiases: agent.rentDue === 0 ? { resting: 5, socializing: 4, paying_rent: -16, working: 3 } : { working: 14, budgeting: 8, paying_rent: 10 }
    });
    context.addMemory(
      agent,
      "event",
      `Paid ${paid} credits toward rent${savingsLine}${agent.rentDue > 0 ? `, leaving ${agent.rentDue}` : ""}${skillResult.leveled ? " and got better at civic paperwork" : ""}.`,
      8,
      ["rent", "money", "home", "civic"]
    );
    context.log(
      agent,
      agent.rentDue > 0
        ? `${agent.name} paid ${paid} credits toward rent${savingsLine} and still owes ${agent.rentDue}.`
        : `${agent.name} paid rent${savingsWithdrawn > 0 ? " by combining cash and savings" : ""} and looked relieved.`,
      "money",
      agent.rentDue > 0 ? "warn" : "good",
      8
    );
    return true;
  }

  private failRent(agent: SimAgent, context: ActionResolverContext) {
    const civicSkill = this.skillEffect(agent, "civic");
    agent.stress = clamp(agent.stress + Math.max(8, 15 - civicSkill * 0.08));
    agent.mood = clamp(agent.mood - 8);
    agent.budget.lastReview = "Rent could not be covered";
    this.applyAutonomy(agent, context, { dignity: -7, control: -5, overwhelm: 11, note: "Unpaid rent hurt control and self-respect." });
    context.relationship.adjustReputation(agent, { reliability: -4, trouble: 2 });
    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 5 });
    context.advanceSkill(agent, "civic", 1.2, "Learned from a rent shortfall", ["rent", "civic", "money"]);
    context.addMoodlet(agent, {
      id: "rent-pressure",
      label: "Rent Pressure",
      detail: "housing still is not covered",
      tone: "bad",
      intensity: 7,
      durationMinutes: 320,
      tags: ["rent", "money", "home"],
      actionBiases: { working: 22, budgeting: 12, paying_rent: 14, socializing: -12, building: -14 }
    });
    context.addMemory(agent, "event", "Could not cover rent yet.", 8, ["rent", "money"]);
    context.log(agent, `${agent.name} checked rent and came up short.`, "money", "bad", 8);
  }

  private payLivingCosts(agent: SimAgent, context: ActionResolverContext, intent?: AgentActionIntent) {
    const civicSkill = this.skillEffect(agent, "civic");
    const dueBeforePayment = agent.budget.livingCostDue;
    const paymentGoal = Math.min(dueBeforePayment, Math.max(0, intent?.amount ?? dueBeforePayment));
    const strategyAllowsSavings = intent?.strategy.includes("savings") === true || intent?.strategy.includes("liquid") === true;
    const paymentSource = intent?.paymentSource ?? (intent && intent.savingsAllowed !== true && !strategyAllowsSavings ? "cash" : "liquid");
    const savingsAllowed = paymentSource === "savings" || paymentSource === "liquid";
    const sourceAllowsCash = paymentSource !== "savings" && paymentSource !== "none";
    if (paymentSource === "none" || paymentGoal <= 0) return false;

    const spendableCash = sourceAllowsCash ? agent.money : 0;
    const spendableSavings = savingsAllowed ? agent.budget.savings : 0;
    const plannedPayment = Math.min(paymentGoal, dueBeforePayment, spendableCash + spendableSavings);
    const cashToUse = Math.min(spendableCash, plannedPayment);
    const withdrawalNeeded = Math.max(0, plannedPayment - cashToUse);
    const savingsWithdrawn =
      withdrawalNeeded > 0 && savingsAllowed && agent.budget.savings > 0
        ? context.withdrawSavings(agent, withdrawalNeeded, "Living costs savings withdrawal")
        : 0;
    const paid = Math.min(cashToUse + savingsWithdrawn, paymentGoal, dueBeforePayment);
    if (paid <= 0) return false;

    context.transact(agent, -paid, "housing", "Living costs payment");
    agent.budget.livingCostDue = Math.round((agent.budget.livingCostDue - paid) * 100) / 100;
    if (agent.budget.livingCostDue === 0) {
      agent.budget.onTimeBillStreak += 1;
      context.adjustCredit(agent, 4 + Math.min(4, agent.budget.onTimeBillStreak), "Living costs handled");
      agent.budget.lastReview = "Living costs paid";
    } else {
      agent.budget.lastReview = `${agent.budget.livingCostDue} living costs still due`;
    }
    agent.stress = clamp(agent.stress - (agent.budget.livingCostDue === 0 ? 8 : 3) - civicSkill * 0.04);
    agent.mood = clamp(agent.mood + (agent.budget.livingCostDue === 0 ? 3 : 1));
    this.applyAutonomy(agent, context, {
      dignity: agent.budget.livingCostDue === 0 ? 5 : 2,
      control: agent.budget.livingCostDue === 0 ? 8 : 4,
      overwhelm: agent.budget.livingCostDue === 0 ? -9 : -4,
      note: agent.budget.livingCostDue === 0 ? "Covering basics made daily life feel controlled." : "Reducing basic costs eased the pressure."
    });
    context.relationship.adjustReputation(agent, { reliability: paid >= dueBeforePayment ? 3 : 1, trouble: paid >= dueBeforePayment ? -1 : 0 });
    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 4 });
    const skillResult = context.advanceSkill(agent, "civic", agent.budget.livingCostDue === 0 ? 2.8 : 1.8, "Handled living costs", [
      "living-costs",
      "budget",
      "civic"
    ]);
    context.advanceAspiration(agent, agent.budget.livingCostDue === 0 ? 4.2 : 2, "Kept basic life costs from piling up", [
      "money",
      "stability",
      "home"
    ]);
    const savingsLine = savingsWithdrawn > 0 ? ` using ${savingsWithdrawn} from savings` : "";
    context.addMoodlet(agent, {
      id: agent.budget.livingCostDue === 0 ? "living-costs-clear" : "living-costs-reduced",
      label: agent.budget.livingCostDue === 0 ? "Basics Covered" : "Basics Reduced",
      detail: agent.budget.livingCostDue === 0 ? "utilities and everyday costs are handled" : `${agent.budget.livingCostDue} credits still due`,
      tone: agent.budget.livingCostDue === 0 ? "good" : "warn",
      intensity: agent.budget.livingCostDue === 0 ? 4.5 : 3.5,
      durationMinutes: agent.budget.livingCostDue === 0 ? 220 : 150,
      tags: ["money", "living-costs", "home"],
      actionBiases: agent.budget.livingCostDue === 0 ? { resting: 3, socializing: 2, paying_rent: -8 } : { working: 8, budgeting: 6, paying_rent: 8 }
    });
    context.addMemory(
      agent,
      "event",
      `Paid ${paid} credits toward living costs${savingsLine}${agent.budget.livingCostDue > 0 ? `, leaving ${agent.budget.livingCostDue}` : ""}${skillResult.leveled ? " and got sharper at civic basics" : ""}.`,
      7,
      ["money", "living-costs", "civic", "home"]
    );
    context.log(
      agent,
      agent.budget.livingCostDue > 0
        ? `${agent.name} paid ${paid} credits toward living costs and still owes ${agent.budget.livingCostDue}.`
        : `${agent.name} covered their living costs${savingsWithdrawn > 0 ? " by combining cash and savings" : ""}.`,
      "money",
      agent.budget.livingCostDue > 0 ? "warn" : "good",
      7
    );
    return true;
  }

  private failLivingCosts(agent: SimAgent, context: ActionResolverContext) {
    const civicSkill = this.skillEffect(agent, "civic");
    agent.stress = clamp(agent.stress + Math.max(5, 9 - civicSkill * 0.08));
    agent.mood = clamp(agent.mood - 4);
    agent.budget.lastReview = "Living costs still unpaid";
    this.applyAutonomy(agent, context, { dignity: -4, control: -3, overwhelm: 7, note: "Unpaid basics made the day feel less manageable." });
    context.relationship.adjustReputation(agent, { reliability: -1 });
    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 4 });
    context.advanceSkill(agent, "civic", 1.1, "Learned from unpaid living costs", ["living-costs", "budget", "civic"]);
    context.addMoodlet(agent, {
      id: "living-cost-pressure",
      label: "Basics Pressure",
      detail: "utilities and everyday costs are still due",
      tone: "warn",
      intensity: 5,
      durationMinutes: 220,
      tags: ["money", "living-costs", "home"],
      actionBiases: { working: 14, budgeting: 10, paying_rent: 10, socializing: -5 }
    });
    context.addMemory(agent, "event", "Could not cover living costs yet.", 7, ["money", "living-costs", "budget"]);
    context.log(agent, `${agent.name} checked living costs but could not cover them yet.`, "money", "warn", 7);
  }

  private payMedicalBill(agent: SimAgent, context: ActionResolverContext, intent?: AgentActionIntent) {
    const civicSkill = this.skillEffect(agent, "civic");
    const debtBeforePayment = agent.medicalDebt;
    const paymentGoal = Math.min(debtBeforePayment, Math.max(0, intent?.amount ?? debtBeforePayment));
    const strategyAllowsSavings = intent?.strategy.includes("savings") === true || intent?.strategy.includes("liquid") === true;
    const paymentSource = intent?.paymentSource ?? (intent && intent.savingsAllowed !== true && !strategyAllowsSavings ? "cash" : "liquid");
    const savingsAllowed = paymentSource === "savings" || paymentSource === "liquid";
    const sourceAllowsCash = paymentSource !== "savings" && paymentSource !== "none";
    const preserveCash = Math.max(0, intent?.preserveCash ?? 0);
    if (paymentSource === "none") return false;
    if (paymentGoal <= 0) return false;
    const preserveForPartial = intent?.strategy === "pay_medical_partial" ? preserveCash : 0;
    const spendableCash = sourceAllowsCash ? Math.max(0, agent.money - preserveForPartial) : 0;
    const spendableSavings = savingsAllowed ? agent.budget.savings : 0;
    const plannedPayment = Math.min(paymentGoal, debtBeforePayment, spendableCash + spendableSavings);
    const cashToUse = Math.min(spendableCash, plannedPayment);
    const withdrawalNeeded = Math.max(0, plannedPayment - cashToUse);
    const savingsWithdrawn =
      withdrawalNeeded > 0 && savingsAllowed && agent.budget.savings > 0
        ? context.withdrawSavings(agent, withdrawalNeeded, "Medical bill savings withdrawal")
        : 0;
    const paid = Math.min(cashToUse + savingsWithdrawn, paymentGoal, debtBeforePayment);
    if (paid <= 0) return false;
    context.transact(agent, -paid, "medical", "Medical bill payment");
    agent.medicalDebt = Math.round((agent.medicalDebt - paid) * 100) / 100;
    if (agent.medicalDebt === 0) {
      agent.budget.onTimeBillStreak += 1;
      context.adjustCredit(agent, 6 + Math.min(6, agent.budget.onTimeBillStreak), "Medical bill cleared");
      agent.budget.lastReview = "Medical bill cleared";
    } else {
      agent.budget.lastReview = `${agent.medicalDebt} medical debt still due`;
    }
    agent.stress = clamp(agent.stress - (agent.medicalDebt === 0 ? 14 : 5) - civicSkill * 0.06);
    agent.mood = clamp(agent.mood + (agent.medicalDebt === 0 ? 5 : 1));
    this.applyAutonomy(agent, context, {
      dignity: agent.medicalDebt === 0 ? 7 : 2,
      control: agent.medicalDebt === 0 ? 10 : 4,
      overwhelm: agent.medicalDebt === 0 ? -13 : -4,
      note: agent.medicalDebt === 0 ? "Clearing the medical bill removed a heavy worry." : "Reducing the medical bill eased the pressure."
    });
    context.relationship.adjustReputation(agent, { reliability: paid >= debtBeforePayment ? 5 : paid >= 8 ? 4 : 2, trouble: -1 });
    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 4 });
    const skillResult = context.advanceSkill(agent, "civic", agent.medicalDebt === 0 ? 3.2 : 2.2, agent.medicalDebt === 0 ? "Cleared medical debt" : "Reduced medical debt", [
      "medical",
      "debt",
      "civic"
    ]);
    const savingsLine = savingsWithdrawn > 0 ? ` using ${savingsWithdrawn} from savings` : "";
    context.advanceAspiration(agent, agent.medicalDebt === 0 ? 6 : 3.2, agent.medicalDebt === 0 ? "Cleared a medical bill" : "Reduced medical debt", [
      "medical",
      "health",
      "money",
      "stability"
    ]);
    context.addMoodlet(agent, {
      id: agent.medicalDebt === 0 ? "medical-bill-cleared" : "medical-bill-reduced",
      label: agent.medicalDebt === 0 ? "Medical Bill Cleared" : "Medical Bill Reduced",
      detail: agent.medicalDebt === 0 ? "care debt is no longer hanging over the day" : `${agent.medicalDebt} credits still owed`,
      tone: agent.medicalDebt === 0 ? "good" : "warn",
      intensity: agent.medicalDebt === 0 ? 6 : 4,
      durationMinutes: agent.medicalDebt === 0 ? 280 : 190,
      tags: ["medical", "money", "debt"],
      actionBiases: agent.medicalDebt === 0 ? { resting: 4, socializing: 3, paying_rent: -10 } : { working: 10, budgeting: 8, paying_rent: 6 }
    });
    context.addMemory(
      agent,
      "event",
      `Paid ${paid} credits toward medical bills${savingsLine}${agent.medicalDebt > 0 ? `, leaving ${agent.medicalDebt}` : ""}${skillResult.leveled ? " and learned civic billing better" : ""}.`,
      8,
      ["health", "money", "debt", "civic"]
    );
    context.log(
      agent,
      agent.medicalDebt > 0
        ? `${agent.name} paid ${paid} credits toward medical bills${savingsLine} and still owes ${agent.medicalDebt}.`
        : `${agent.name} cleared their medical bill at town hall${savingsWithdrawn > 0 ? " by combining cash and savings" : ""}.`,
      "money",
      agent.medicalDebt > 0 ? "warn" : "good",
      8
    );
    return true;
  }

  private failMedicalBill(agent: SimAgent, context: ActionResolverContext) {
    const civicSkill = this.skillEffect(agent, "civic");
    agent.stress = clamp(agent.stress + Math.max(7, 12 - civicSkill * 0.08));
    agent.mood = clamp(agent.mood - 6);
    agent.budget.lastReview = "Medical bills still unpaid";
    this.applyAutonomy(agent, context, { dignity: -5, control: -4, overwhelm: 9, note: "Unpaid medical debt kept pressure in the room." });
    context.relationship.adjustReputation(agent, { reliability: -2 });
    this.recordObjectUse(agent, context, { cleanlinessDelta: -1, wearDelta: 0.5, heatDelta: 4 });
    context.advanceSkill(agent, "civic", 1.2, "Learned from unpaid medical bills", ["medical", "debt", "civic"]);
    context.addMoodlet(agent, {
      id: "medical-debt-pressure",
      label: "Medical Debt Pressure",
      detail: "the bill is still unresolved",
      tone: "bad",
      intensity: 6.5,
      durationMinutes: 260,
      tags: ["medical", "money", "debt"],
      actionBiases: { working: 18, budgeting: 12, paying_rent: 10, resting: -5, socializing: -8 }
    });
    context.addMemory(agent, "event", "Could not pay medical bills yet.", 8, ["health", "money", "debt"]);
    context.log(agent, `${agent.name} checked medical bills but had no credits to pay them.`, "money", "bad", 8);
  }

  private stockPantry(agent: SimAgent, amount: number, context: ActionResolverContext) {
    const before = agent.household.pantry;
    const next = Math.min(agent.household.pantryCapacity, before + amount);
    agent.household.pantry = next;
    if (next <= before) return false;
    this.addHouseholdNote(agent, `Stocked pantry to ${next}/${agent.household.pantryCapacity} meals.`, context);
    return true;
  }

  private stockHouseholdSupply(agent: SimAgent, kind: "toiletries" | "cleaningSupplies", amount: number) {
    const before = agent.household[kind];
    const next = Math.min(agent.household.supplyCapacity, before + Math.max(0, Math.round(amount)));
    agent.household[kind] = next;
    return Math.max(0, next - before);
  }

  private consumeHouseholdSupply(agent: SimAgent, kind: "toiletries" | "cleaningSupplies", amount: number) {
    const needed = Math.max(1, Math.round(amount));
    if (agent.household[kind] < needed) return false;
    agent.household[kind] = Math.max(0, agent.household[kind] - needed);
    return true;
  }

  private applyOutfitChange(agent: SimAgent, cleanlinessDelta: number, wearDelta: number, confidenceDelta = 0, note?: string, context?: ActionResolverContext) {
    agent.outfit.cleanliness = Math.round(clamp(agent.outfit.cleanliness + cleanlinessDelta));
    agent.outfit.wear = Math.round(clamp(agent.outfit.wear + wearDelta));
    agent.outfit.confidence = Math.round(
      clamp(
        24 +
          agent.outfit.cleanliness * 0.38 -
          agent.outfit.wear * 0.26 +
          agent.hygiene * 0.16 +
          agent.mood * 0.08 +
          agent.dna.sociability * 0.04 +
          confidenceDelta
      )
    );
    if (context && note) {
      agent.outfit.lastChangedWorldTime = context.worldTime;
      agent.outfit.recent.unshift(`${context.worldTime} ${note}`);
      agent.outfit.recent.splice(4);
    }
  }

  private addHouseholdNote(agent: SimAgent, text: string, context: ActionResolverContext) {
    agent.household.lastHomeCare = context.worldTime;
    agent.household.recent.unshift(`${context.worldTime} ${text}`);
    agent.household.recent.splice(4);
  }

  private restLeisureLabel(agent: SimAgent) {
    switch (agent.leisure.hobby) {
      case "reading":
        return "read a little";
      case "games":
        return "played a small game";
      case "music":
        return "listened for a song they liked";
      case "fitness":
        return "stretched and shook off the day";
      case "people_watching":
        return "people-watched for a while";
      case "crafting":
        return "fiddled with a small idea";
      default:
        return "took a hobby break";
    }
  }

  private applyLeisure(
    agent: SimAgent,
    context: ActionResolverContext,
    change: { label: string; fun: number; boredom: number; curiosity: number; mood?: number; stress?: number; tags?: string[] }
  ) {
    const beforeFun = agent.leisure.fun;
    const beforeBoredom = agent.leisure.boredom;
    agent.leisure.fun = Math.round(clamp(agent.leisure.fun + change.fun));
    agent.leisure.boredom = Math.round(clamp(agent.leisure.boredom + change.boredom));
    agent.leisure.curiosity = Math.round(clamp(agent.leisure.curiosity + change.curiosity));
    agent.leisure.lastLeisureWorldTime = context.worldTime;
    agent.leisure.recent.unshift(
      `${context.worldTime} ${change.label}: fun ${Math.round(beforeFun)} -> ${agent.leisure.fun}, boredom ${Math.round(beforeBoredom)} -> ${agent.leisure.boredom}.`
    );
    agent.leisure.recent.splice(4);
    if (change.fun > 0 || change.boredom < 0 || change.curiosity < 0) agent.routine.recreationToday += 1;
    if (change.mood) agent.mood = clamp(agent.mood + change.mood);
    if (change.stress) agent.stress = clamp(agent.stress + change.stress);
    context.recordActivityExperience(agent, {
      tone: agent.leisure.fun >= beforeFun || agent.leisure.boredom < beforeBoredom ? "good" : "neutral",
      amount: Math.min(5, 1.5 + Math.abs(change.fun) * 0.08 + Math.abs(change.boredom) * 0.05),
      label: change.label,
      tags: ["leisure", ...(change.tags ?? [])].slice(0, 8)
    });
    return `${change.label} (${agent.leisure.hobby.replace(/_/g, " ")}).`;
  }

  private recordObjectUse(agent: SimAgent, context: ActionResolverContext, delta: ObjectUseDelta = {}) {
    const state = context.objectStates.recordUse(agent, context.worldTime, delta);
    const experience = this.placeExperienceFor(agent, delta, state);
    if (experience) {
      context.recordPlaceExperience(agent, experience);
      context.recordActivityExperience(agent, experience);
    }
    return state;
  }

  private placeExperienceFor(agent: SimAgent, delta: ObjectUseDelta, state: ReturnType<ObjectStateSystem["recordUse"]>): AgentPlaceExperience | null {
    if (!agent.target) return null;
    const tags = [agent.currentAction, agent.target.actionPointType];
    const depletedByUse = delta.stockDelta !== undefined && delta.stockDelta < 0;
    const wasUnavailable = state?.stock !== undefined && state.stock <= 0 && !depletedByUse;
    const objectTrouble =
      (wasUnavailable ? 4 : 0) +
      Math.max(0, (state?.crowdPressure ?? 0) - 58) * 0.04 +
      Math.max(0, 42 - (state?.cleanliness ?? 86)) * 0.05 +
      Math.max(0, (state?.wear ?? 0) - 72) * 0.03 +
      (state?.unmetDemand ?? 0) * 0.08 +
      (state?.servicePressure ?? 0) * 0.035;

    switch (agent.currentAction) {
      case "sleeping":
        return {
          tone: agent.household.sleepQuality >= 64 ? "good" : "warn",
          amount: agent.household.sleepQuality >= 64 ? 5 : 3,
          label: agent.household.sleepQuality >= 64 ? "Slept well here." : "Slept here, but it was not fully restorative.",
          tags: [...tags, "home", "sleep"]
        };
      case "eating":
        return {
          tone: agent.hunger < 64 ? "good" : "warn",
          amount: agent.hunger < 64 ? 4 : 2.5,
          label: agent.hunger < 64 ? "Food here helped." : "Tried to eat here, but hunger still lingered.",
          tags: [...tags, "food"]
        };
      case "shopping":
        return {
          tone: wasUnavailable ? "bad" : state?.stock !== undefined && state.stock <= 0 ? "warn" : agent.money < 4 && agent.household.pantry <= 0 ? "warn" : "good",
          amount: 4 + objectTrouble,
          label: wasUnavailable ? "This place was out of stock." : state?.stock !== undefined && state.stock <= 0 ? "Bought the last useful food here." : "Bought useful food here.",
          tags: [...tags, "shop", "food"]
        };
      case "working":
        return {
          tone: agent.career.burnout > 76 ? "warn" : "good",
          amount: 4 + Math.min(3, agent.routine.maintenanceToday),
          label: agent.career.burnout > 76 ? "Work here paid, but felt draining." : "Work here felt useful.",
          tags: [...tags, "work", agent.job]
        };
      case "healing":
        return {
          tone: state?.stock !== undefined && state.stock <= 0 ? "warn" : "good",
          amount: 5 + Math.max(0, 72 - agent.health) * 0.04,
          label: state?.stock !== undefined && state.stock <= 0 ? "Care helped, but supplies felt thin." : "Care here helped stabilize health.",
          tags: [...tags, "health", "clinic"]
        };
      case "socializing":
        return {
          tone: agent.routine.conflictsToday > agent.routine.bondsToday ? "bad" : agent.routine.bondsToday > 0 ? "good" : "neutral",
          amount: agent.routine.conflictsToday > agent.routine.bondsToday ? 5 : agent.routine.bondsToday > 0 ? 4 : 2,
          label:
            agent.routine.conflictsToday > agent.routine.bondsToday
              ? "Social time here turned tense."
              : agent.routine.bondsToday > 0
                ? "Social time here made the city feel warmer."
                : "Spent quiet public time here.",
          tags: [...tags, "social", "public"]
        };
      case "washing":
      case "cleaning":
        return {
          tone: "good",
          amount: 3.5,
          label: "This place helped reset the home routine.",
          tags: [...tags, "home", "hygiene"]
        };
      case "resting":
        return {
          tone: objectTrouble > 3 ? "warn" : "good",
          amount: 3 + objectTrouble * 0.4,
          label: objectTrouble > 3 ? "Rested here, but the place felt a little rough." : "This place made a quiet reset easier.",
          tags: [...tags, "rest", "comfort"]
        };
      case "paying_rent":
      case "budgeting":
      case "checking_mail":
        return {
          tone: this.totalBillsDue(agent) > agent.money + agent.budget.savings ? "warn" : "neutral",
          amount: 2.5,
          label: "Handled civic admin here.",
          tags: [...tags, "civic", "money"]
        };
      case "building":
        return {
          tone: "neutral",
          amount: 2.5,
          label: "This place suggested a future possibility.",
          tags: [...tags, "future", "build"]
        };
      default:
        return {
          tone: objectTrouble > 4 ? "warn" : "neutral",
          amount: 1 + objectTrouble * 0.25,
          label: objectTrouble > 4 ? "This place felt strained." : "This place became more familiar.",
          tags
        };
    }
  }

  private skillEffect(agent: SimAgent, skillId: AgentSkillId) {
    const skill = agent.skills[skillId];
    return skill.level * 3 + skill.aptitude * 0.12;
  }

  private jobSkillFor(job: string): AgentSkillId {
    const byJob: Record<string, AgentSkillId> = {
      builder: "labor",
      materials_clerk: "labor",
      grocer: "commerce",
      clinician: "care",
      security_officer: "social",
      clerk: "civic"
    };
    return byJob[job] ?? "labor";
  }
}
