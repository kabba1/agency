import type { DayPhase, SemanticObjectState, SimAgent } from "./AgentSimulation";
import { clamp } from "./SimulationPrimitives";

export type CityPulseTone = "good" | "warn" | "bad" | "neutral";

export type CityPulseMetricId = "food" | "work" | "health" | "housing" | "social" | "maintenance";

export type CityPulseMetric = {
  id: CityPulseMetricId;
  label: string;
  value: number;
  tone: CityPulseTone;
  detail: string;
};

export type CityPulseFlag = {
  id: string;
  label: string;
  detail: string;
  tone: Exclude<CityPulseTone, "neutral">;
};

export type CityWorkOrderCategory = "food" | "health" | "civic" | "security" | "maintenance";

export type CityWorkOrder = {
  id: string;
  label: string;
  detail: string;
  category: CityWorkOrderCategory;
  tone: Exclude<CityPulseTone, "neutral">;
  score: number;
  structureId: string;
  structureName: string;
  actionPointId: string;
  actionPointType: SemanticObjectState["actionPointType"];
  requiredJobs: string[];
  stock?: number;
  capacity?: number;
  unmetDemand: number;
  servicePressure: number;
  lastIssue?: string;
};

export type CityPulse = {
  day: number;
  worldTime: string;
  phase: DayPhase;
  overall: number;
  tone: CityPulseTone;
  headline: string;
  population: number;
  activePlaces: number;
  flags: CityPulseFlag[];
  workOrders: CityWorkOrder[];
  metrics: CityPulseMetric[];
};

const average = (values: number[], fallback = 0) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback);
const count = <T>(items: readonly T[], predicate: (item: T) => boolean) => items.filter(predicate).length;
const roundScore = (value: number) => Math.round(clamp(value));

const toneFor = (value: number): CityPulseTone => {
  if (value < 34) return "bad";
  if (value < 58) return "warn";
  if (value > 74) return "good";
  return "neutral";
};

const metric = (id: CityPulseMetricId, label: string, value: number, detail: string): CityPulseMetric => {
  const score = roundScore(value);
  return { id, label, value: score, tone: toneFor(score), detail };
};

const stockRatioFor = (states: readonly SemanticObjectState[], types: readonly SemanticObjectState["actionPointType"][]) => {
  const stockStates = states.filter((state) => types.includes(state.actionPointType) && state.stock !== undefined && state.capacity !== undefined);
  if (stockStates.length === 0) return 1;
  return average(stockStates.map((state) => (state.capacity && state.capacity > 0 ? (state.stock ?? 0) / state.capacity : 1)), 1);
};

const outOfStockCount = (states: readonly SemanticObjectState[], types: readonly SemanticObjectState["actionPointType"][]) =>
  count(states, (state) => types.includes(state.actionPointType) && state.stock !== undefined && state.stock <= 0);

const cityHeadline = (tone: CityPulseTone, flags: readonly CityPulseFlag[]) => {
  if (flags.length > 0) return `${flags[0]!.label}: ${flags[0]!.detail}`;
  if (tone === "good") return "The district is running smoothly.";
  if (tone === "warn") return "The district is stable, but pressure is building.";
  if (tone === "bad") return "The district needs attention.";
  return "The district is settling into a normal rhythm.";
};

export class CityPulseSystem {
  create(day: number, worldTime: string, phase: DayPhase, agents: readonly SimAgent[], objectStates: readonly SemanticObjectState[]): CityPulse {
    const population = agents.length;
    if (population === 0) {
      const metrics: CityPulseMetric[] = [
        metric("food", "Food Access", 78, "shops are ready"),
        metric("work", "Work Flow", 70, "no shifts yet"),
        metric("health", "Health Care", 76, "clinic is quiet"),
        metric("housing", "Housing", 72, "no rent pressure"),
        metric("social", "Social Climate", 68, "no relationships yet"),
        metric("maintenance", "Upkeep", 74, "places are unused")
      ];
      return {
        day,
        worldTime,
        phase,
        population,
        activePlaces: 0,
        overall: roundScore(average(metrics.map((entry) => entry.value), 70)),
        tone: "neutral",
        headline: "Spawn an agent to start the city pulse.",
        flags: [],
        workOrders: [],
        metrics
      };
    }

    const foodTypes = ["register", "shelf", "vending_machine", "fridge"] as const;
    const clinicTypes = ["clinic_bed", "medicine_cabinet"] as const;
    const serviceStates = objectStates.filter(
      (state) => state.totalUses > 0 || state.occupants > 0 || state.queued > 0 || state.servicePressure > 0 || state.unmetDemand > 0 || Boolean(state.lastIssue)
    );
    const avgHunger = average(agents.map((agent) => agent.hunger), 40);
    const avgMood = average(agents.map((agent) => agent.mood), 55);
    const avgSocial = average(agents.map((agent) => agent.social), 50);
    const avgStress = average(agents.map((agent) => agent.stress), 28);
    const avgHealth = average(agents.map((agent) => agent.health), 80);
    const avgComfort = average(agents.map((agent) => agent.comfort), 55);
    const avgMoney = average(agents.map((agent) => agent.money), 20);
    const avgSavings = average(agents.map((agent) => agent.budget.savings), 8);
    const avgCredit = average(agents.map((agent) => agent.budget.creditScore), 600);
    const totalRent = agents.reduce((sum, agent) => sum + agent.rentDue, 0);
    const totalLivingCosts = agents.reduce((sum, agent) => sum + agent.budget.livingCostDue, 0);
    const totalHousingDue = totalRent + totalLivingCosts;
    const totalMedicalDebt = agents.reduce((sum, agent) => sum + agent.medicalDebt, 0);
    const lowMoney = count(agents, (agent) => agent.money < 8);
    const lowCredit = count(agents, (agent) => agent.budget.creditScore < 540);
    const lowSavings = count(agents, (agent) => agent.budget.savings < agent.budget.dailySpendLimit);
    const hungry = count(agents, (agent) => agent.hunger > 78);
    const hospitalized = count(agents, (agent) => agent.medical.isHospitalized);
    const worked = count(agents, (agent) => agent.routine.workedToday || agent.currentAction === "working");
    const conflicts = agents.reduce((sum, agent) => sum + agent.routine.conflictsToday, 0);
    const bonds = agents.reduce((sum, agent) => sum + agent.routine.bondsToday, 0);
    const calmSaves = agents.reduce((sum, agent) => sum + agent.routine.deescalationsToday, 0);
    const foodStockRatio = stockRatioFor(objectStates, foodTypes);
    const clinicStockRatio = stockRatioFor(objectStates, clinicTypes);
    const avgCrowd = average(objectStates.map((state) => state.crowdPressure), 0);
    const avgCleanliness = average(serviceStates.map((state) => state.cleanliness), 86);
    const avgWear = average(serviceStates.map((state) => state.wear), 0);
    const avgHeat = average(serviceStates.map((state) => state.heat), 0);
    const avgServicePressure = average(serviceStates.map((state) => state.servicePressure), 0);
    const totalUnmetDemand = objectStates.reduce((sum, state) => sum + state.unmetDemand, 0);
    const dirtyPlaces = count(serviceStates, (state) => state.cleanliness < 48);
    const hotPlaces = count(serviceStates, (state) => state.heat > 68 || state.crowdPressure > 72);

    const metrics = [
      metric(
        "food",
        "Food Access",
        96 - avgHunger * 0.42 + foodStockRatio * 34 - outOfStockCount(objectStates, foodTypes) * 12 - hungry * 5 - avgCrowd * 0.07 - totalUnmetDemand * 1.8,
        `${hungry} hungry / ${Math.round(foodStockRatio * 100)}% shop stock / ${totalUnmetDemand} demand`
      ),
      metric(
        "work",
        "Work Flow",
        44 + (worked / population) * 40 + Math.min(16, avgMoney * 0.32) + Math.min(10, avgSavings * 0.24) + Math.max(0, avgCredit - 560) * 0.025 - lowMoney * 6 - lowCredit * 4 - Math.max(0, totalHousingDue + totalMedicalDebt - avgMoney * population) * 0.16,
        `${worked}/${population} worked / ${lowMoney} low cash / ${lowSavings} low savings`
      ),
      metric(
        "health",
        "Health Care",
        24 + avgHealth * 0.55 + clinicStockRatio * 26 - hospitalized * 18 - count(agents, (agent) => agent.health < 50) * 8 - totalMedicalDebt * 0.08 - avgServicePressure * 0.08,
        `${hospitalized} hospitalized / ${Math.round(clinicStockRatio * 100)}% supplies / ${Math.round(avgServicePressure)} backlog`
      ),
      metric(
        "housing",
        "Housing",
        42 + avgComfort * 0.3 + average(agents.map((agent) => agent.energy), 55) * 0.16 + Math.max(0, avgCredit - 560) * 0.025 - totalHousingDue * 1.3 - avgStress * 0.16 - lowCredit * 3,
        `${totalHousingDue} housing due / credit ${Math.round(avgCredit)}`
      ),
      metric(
        "social",
        "Social Climate",
        36 + avgMood * 0.27 + avgSocial * 0.23 - avgStress * 0.2 + bonds * 7 + calmSaves * 4 - conflicts * 15,
        `${bonds} bonds / ${conflicts} conflicts`
      ),
      metric(
        "maintenance",
        "Upkeep",
        52 + avgCleanliness * 0.3 - avgWear * 0.62 - avgHeat * 0.28 - avgServicePressure * 0.18 - dirtyPlaces * 8 - hotPlaces * 5 - totalUnmetDemand * 0.8,
        `${dirtyPlaces} dirty / ${hotPlaces} hot / ${Math.round(avgServicePressure)} service pressure`
      )
    ];
    const workOrders = this.workOrdersFor(objectStates);
    const overall = roundScore(average(metrics.map((entry) => entry.value), 65));
    const flags = this.flagsFor(metrics, {
      foodStockRatio,
      hungry,
      hospitalized,
      totalRent,
      totalHousingDue,
      totalMedicalDebt,
      dirtyPlaces,
      hotPlaces,
      avgServicePressure,
      totalUnmetDemand,
      conflicts,
      lowMoney,
      lowCredit,
      lowSavings
    });
    const tone = toneFor(overall);
    return {
      day,
      worldTime,
      phase,
      population,
      activePlaces: serviceStates.length,
      overall,
      tone,
      headline: cityHeadline(tone, flags),
      flags,
      workOrders,
      metrics
    };
  }

  private workOrdersFor(states: readonly SemanticObjectState[]): CityWorkOrder[] {
    const orders: CityWorkOrder[] = [];

    for (const state of states) {
      const category = this.workOrderCategoryFor(state);
      const stockGap = state.stock !== undefined && state.capacity !== undefined ? Math.max(0, state.capacity - state.stock) : 0;
      const cleanlinessNeed = Math.max(0, 58 - state.cleanliness);
      const wearNeed = Math.max(0, state.wear - 34);
      const heatNeed = Math.max(0, state.heat - 48);
      const score = Math.round(
        clamp(
          state.servicePressure * 0.62 +
            state.unmetDemand * 9 +
            stockGap * (category === "food" || category === "health" ? 2.5 : 0.8) +
            cleanlinessNeed * 0.22 +
            wearNeed * 0.28 +
            heatNeed * 0.16 +
            (state.lastIssue ? 12 : 0),
          0,
          100
        )
      );

      if (score < 24) continue;

      const stockLine =
        state.stock !== undefined && state.capacity !== undefined ? `${state.stock}/${state.capacity} stock` : `${state.cleanliness} clean`;
      const issue = state.lastIssue ?? this.issueLabelFor(category);

      orders.push({
        id: state.id,
        label: issue,
        detail: `${state.structureName}: ${state.label.replace(/^.*?:\s*/, "")} / ${stockLine} / demand ${state.unmetDemand} / pressure ${state.servicePressure}`,
        category,
        tone: score >= 74 ? "bad" : "warn",
        score,
        structureId: state.structureId,
        structureName: state.structureName,
        actionPointId: state.actionPointId,
        actionPointType: state.actionPointType,
        requiredJobs: this.requiredJobsFor(category, state.actionPointType),
        stock: state.stock,
        capacity: state.capacity,
        unmetDemand: state.unmetDemand,
        servicePressure: state.servicePressure,
        lastIssue: state.lastIssue
      });
    }

    return orders.sort((a, b) => b.score - a.score || b.servicePressure - a.servicePressure).slice(0, 5);
  }

  private workOrderCategoryFor(state: SemanticObjectState): CityWorkOrderCategory {
    switch (state.actionPointType) {
      case "register":
      case "shelf":
      case "vending_machine":
      case "fridge":
        return "food";
      case "clinic_bed":
      case "medicine_cabinet":
        return "health";
      case "mailbox":
      case "notice_board":
        return "civic";
      case "desk":
        return state.structureName.toLowerCase().includes("security") ? "security" : "civic";
      default:
        return "maintenance";
    }
  }

  private requiredJobsFor(category: CityWorkOrderCategory, pointType: SemanticObjectState["actionPointType"]) {
    if (category === "food") return ["grocer"];
    if (category === "health") return ["clinician"];
    if (category === "security") return ["security_officer"];
    if (category === "civic") return pointType === "desk" ? ["clerk", "security_officer"] : ["clerk"];
    return ["builder", "materials_clerk"];
  }

  private issueLabelFor(category: CityWorkOrderCategory) {
    switch (category) {
      case "food":
        return "Food service order";
      case "health":
        return "Clinic service order";
      case "civic":
        return "Civic service order";
      case "security":
        return "Security service order";
      default:
        return "Upkeep service order";
    }
  }

  private flagsFor(
    metrics: readonly CityPulseMetric[],
    context: {
      foodStockRatio: number;
      hungry: number;
      hospitalized: number;
      totalRent: number;
      totalHousingDue: number;
      totalMedicalDebt: number;
      dirtyPlaces: number;
      hotPlaces: number;
      avgServicePressure: number;
      totalUnmetDemand: number;
      conflicts: number;
      lowMoney: number;
      lowCredit: number;
      lowSavings: number;
    }
  ) {
    const metricById = new Map(metrics.map((entry) => [entry.id, entry]));
    const flags: CityPulseFlag[] = [];
    const push = (id: string, label: string, detail: string, tone: CityPulseFlag["tone"]) => flags.push({ id, label, detail, tone });

    if ((metricById.get("food")?.value ?? 100) < 52) {
      push(
        "food-pressure",
        "Food Pressure",
        `${context.hungry} hungry, stock ${Math.round(context.foodStockRatio * 100)}%, demand ${context.totalUnmetDemand}`,
        context.foodStockRatio < 0.25 || context.totalUnmetDemand >= 4 ? "bad" : "warn"
      );
    }
    if ((metricById.get("work")?.value ?? 100) < 48) push("cash-pressure", "Cash Pressure", `${context.lowMoney} agents nearly broke`, "warn");
    if (context.lowCredit > 0 && (metricById.get("housing")?.value ?? 100) < 62) {
      push("credit-pressure", "Credit Pressure", `${context.lowCredit} low credit, ${context.lowSavings} low savings`, "warn");
    }
    if ((metricById.get("health")?.value ?? 100) < 50) push("clinic-strain", "Clinic Strain", `${context.hospitalized} hospitalized, ${context.totalMedicalDebt} medical debt`, "bad");
    if ((metricById.get("housing")?.value ?? 100) < 52) push("housing-pressure", "Housing Pressure", `${context.totalHousingDue} credits due`, "warn");
    if ((metricById.get("social")?.value ?? 100) < 44) push("social-tension", "Social Tension", `${context.conflicts} conflicts today`, "bad");
    if ((metricById.get("maintenance")?.value ?? 100) < 54) {
      push("upkeep-backlog", "Upkeep Backlog", `${context.dirtyPlaces} dirty, ${context.hotPlaces} overheated, ${Math.round(context.avgServicePressure)} pressure`, "warn");
    }
    return flags.slice(0, 4);
  }
}
