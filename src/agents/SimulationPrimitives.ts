import type { ActionPoint, StructureMetadata, Vec3i } from "../shared/types";
import type { AgentAction, AgentPoint, AgentSocialFocus, DayPhase } from "./AgentSimulation";
import type { AgentActionIntent, AgentActionOptionTone } from "./ActionAffordances";

export type TargetPoint = {
  point: ActionPoint;
  structure: StructureMetadata;
  action: AgentAction;
};

export type Candidate = TargetPoint & {
  affordanceId?: string;
  optionLabel?: string;
  optionTone?: AgentActionOptionTone;
  optionTags?: string[];
  intent?: AgentActionIntent;
  utility: number;
  goal: string;
  reason: string;
  plan: string[];
  socialFocus?: AgentSocialFocus;
};

export type ObjectUseDelta = {
  stockDelta?: number;
  restockRatio?: number;
  minStockDelta?: number;
  cleanlinessDelta?: number;
  wearDelta?: number;
  heatDelta?: number;
  unmetDemandDelta?: number;
  servicePressureDelta?: number;
  issue?: string;
};

export const FIRST_NAMES = ["Mara", "Jules", "Theo", "Nia", "Sol", "Iris", "Kai", "Vera", "Ezra", "Lina"];
export const LAST_NAMES = ["Vale", "Cross", "Stone", "Park", "Reed", "Nova", "Bell", "Quinn", "Lane", "Fox"];
export const JOBS = ["builder", "grocer", "clinician", "security_officer", "clerk", "materials_clerk"];
export const SIM_MINUTES_PER_SECOND = 3;
export const MEMORY_LIMIT = 24;

export const PHASE_LABELS: Record<DayPhase, string> = {
  morning: "Morning",
  workday: "Workday",
  evening: "Evening",
  night: "Night"
};

export const PHASE_BOOSTS: Record<DayPhase, Partial<Record<AgentAction, number>>> = {
  morning: {
    eating: 24,
    washing: 16,
    cleaning: 10,
    checking_mail: 9,
    budgeting: 10,
    shopping: 8,
    paying_rent: 8,
    hospitalized: 0,
    calling_in_sick: 12,
    working: 4,
    socializing: -6,
    resting: -4,
    sleeping: -28
  },
  workday: {
    working: 34,
    paying_rent: 10,
    hospitalized: 0,
    eating: 3,
    washing: -6,
    cleaning: -2,
    checking_mail: -2,
    budgeting: 4,
    shopping: -2,
    healing: 2,
    calling_in_sick: 8,
    socializing: -10,
    resting: -4,
    sleeping: -36
  },
  evening: {
    socializing: 24,
    shopping: 12,
    eating: 8,
    washing: 5,
    cleaning: 12,
    checking_mail: 8,
    budgeting: 11,
    resting: 14,
    building: 7,
    paying_rent: 6,
    hospitalized: 0,
    calling_in_sick: -2,
    sleeping: 5,
    working: -22
  },
  night: {
    sleeping: 45,
    eating: 4,
    washing: -4,
    cleaning: -2,
    checking_mail: -8,
    budgeting: -4,
    resting: 12,
    healing: 2,
    building: -6,
    hospitalized: 0,
    shopping: -14,
    paying_rent: -16,
    calling_in_sick: -8,
    socializing: -12,
    working: -38
  }
};

export const ACTION_DWELL_SECONDS: Record<AgentAction, number> = {
  idle: 2,
  walking: 0,
  sleeping: 9,
  eating: 3,
  washing: 3,
  cleaning: 5,
  working: 8,
  calling_in_sick: 3,
  shopping: 4,
  socializing: 5,
  healing: 4,
  resting: 5,
  checking_mail: 3,
  budgeting: 4,
  paying_rent: 3,
  hospitalized: 30,
  building: 4
};

export const ACTION_EVENT_LABELS: Record<AgentAction, string> = {
  idle: "Thinking",
  walking: "Moving",
  sleeping: "Slept",
  eating: "Ate",
  washing: "Washed",
  cleaning: "Cleaned",
  working: "Worked",
  calling_in_sick: "Sick call",
  shopping: "Bought food",
  socializing: "Social",
  healing: "Clinic",
  resting: "Rested",
  checking_mail: "Mail",
  budgeting: "Budget",
  paying_rent: "Rent",
  hospitalized: "Hospital",
  building: "Inspected"
};

export const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export const distance2d = (a: AgentPoint, b: AgentPoint) => Math.hypot(a.x - b.x, a.z - b.z);

export const hashText = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const randomFromHash = (seed: number, salt: number) => {
  let value = seed + Math.imul(salt + 1, 0x9e3779b1);
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
};

export const worldPoint = (point: Vec3i): AgentPoint => ({
  x: point.x + 0.5,
  y: point.y + 0.08,
  z: point.z + 0.5
});

export const formatTime = (minutes: number) => {
  const wrapped = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
};

export const phaseForMinutes = (minutes: number): DayPhase => {
  const wrapped = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  if (wrapped >= 360 && wrapped < 600) return "morning";
  if (wrapped >= 600 && wrapped < 1020) return "workday";
  if (wrapped >= 1020 && wrapped < 1320) return "evening";
  return "night";
};
