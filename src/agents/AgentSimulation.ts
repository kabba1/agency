import type { ActionPoint, StructureMetadata } from "../shared/types";
import { ActionResolver, type ActionResolverContext } from "./ActionResolver";
import { AgentDecisionSystem, type DecisionContext } from "./AgentDecisionSystem";
import type { AgentActionIntent, AgentActionOption } from "./ActionAffordances";
import { CityPulseSystem, type CityPulse } from "./CityPulseSystem";
import { MemorySystem, type MemoryWriteContext } from "./MemorySystem";
import { ObjectStateSystem } from "./ObjectStateSystem";
import { RelationshipSystem, type RelationshipRuntimeContext } from "./RelationshipSystem";
import { SpawnSystem, type SpawnSeedInput } from "./SpawnSystem";
import { ACTION_EVENT_LABELS, PHASE_LABELS, SIM_MINUTES_PER_SECOND, clamp, formatTime, hashText, phaseForMinutes, randomFromHash, worldPoint } from "./SimulationPrimitives";

const HEALTH_CRISIS_THRESHOLD = 9;
const HOSPITAL_RELEASE_HEALTH = 48;
const HOSPITAL_BASE_STAY_MINUTES = 90;
const HOSPITAL_MAX_EXTRA_MINUTES = 120;
const MINOR_ILLNESS_RISK_THRESHOLD = 44;
const MINOR_ILLNESS_RECOVERY_THRESHOLD = 8;
const MINOR_ILLNESS_COOLDOWN_MINUTES = 180;

export type AgentDna = {
  appearanceHue: number;
  risk: number;
  sociability: number;
  discipline: number;
  greed: number;
  empathy: number;
  preferredJob: string;
};

export type AgentMemoryKind = "observation" | "event" | "plan" | "reflection";

export type AgentMemory = {
  id: string;
  kind: AgentMemoryKind;
  text: string;
  timestamp: number;
  importance: number;
  tags: string[];
};

export type AgentPoint = { x: number; y: number; z: number };

export type AgentAction =
  | "idle"
  | "walking"
  | "sleeping"
  | "eating"
  | "washing"
  | "cleaning"
  | "working"
  | "calling_in_sick"
  | "shopping"
  | "socializing"
  | "healing"
  | "resting"
  | "checking_mail"
  | "budgeting"
  | "paying_rent"
  | "hospitalized"
  | "building";

export type DayPhase = "morning" | "workday" | "evening" | "night";

export type WeatherKind = "clear" | "cloudy" | "rain" | "heat" | "cold";
export type WeatherTone = "good" | "neutral" | "warn" | "bad";

export type WeatherState = {
  id: string;
  label: string;
  kind: WeatherKind;
  tone: WeatherTone;
  temperature: number;
  comfortDelta: number;
  movementMultiplier: number;
  outdoorStressDelta: number;
  socialOutdoorModifier: number;
  clinicRiskModifier: number;
  visibility: number;
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  sunIntensity: number;
  ambientIntensity: number;
  detail: string;
};

export type AgentDailyRoutine = {
  day: number;
  ateToday: boolean;
  workedToday: boolean;
  sickLeaveToday: boolean;
  sickLeaveReason: string | null;
  socializedToday: boolean;
  sleptToday: boolean;
  paidRentToday: boolean;
  washedToday: boolean;
  checkedMailToday: boolean;
  medicalVisitToday: boolean;
  maintenanceToday: number;
  lastMaintenance: string | null;
  earningsToday: number;
  mealsToday: number;
  recreationToday: number;
  autonomyMomentsToday: number;
  conflictsToday: number;
  deescalationsToday: number;
  bondsToday: number;
};

export type AgentCommitmentStatus = "pending" | "due" | "done" | "missed";
export type AgentCommitmentCategory = "self" | "food" | "work" | "civic" | "money" | "health" | "home" | "social" | "sleep";

export type AgentCommitment = {
  id: string;
  label: string;
  detail: string;
  actions: AgentAction[];
  category: AgentCommitmentCategory;
  startWorldMinutes: number;
  dueWorldMinutes: number;
  startLabel: string;
  dueLabel: string;
  windowLabel: string;
  graceMinutes: number;
  status: AgentCommitmentStatus;
  tone: "neutral" | "good" | "warn" | "bad";
  pressure: number;
  completedWorldTime?: string;
  completedLate?: boolean;
  missedWorldTime?: string;
};

export type RelationshipAttitude = "stranger" | "familiar" | "friend" | "rival";

export type AgentRelationship = {
  agentId: string;
  agentName: string;
  score: number;
  attitude: RelationshipAttitude;
  trust: number;
  tension: number;
  familiarity: number;
  supportBalance: number;
  lastGesture: string;
  encounters: number;
  lastSeenWorldTime: string;
  lastObservationWorldMinutes: number;
  lastConflictWorldMinutes: number;
  lastEvent: string;
  history: string[];
};

export type AgentPlaceMemory = {
  structureId: string;
  structureName: string;
  structureType: string;
  visits: number;
  affinity: number;
  trust: number;
  frustration: number;
  goodVisits: number;
  badVisits: number;
  lastVisitedWorldTime: string;
  lastVisitedWorldMinutes: number;
  lastAction: AgentAction;
  lastEvent: string;
  tags: string[];
};

export type AgentPlaceExperienceTone = "good" | "bad" | "warn" | "neutral";

export type AgentPlaceExperience = {
  tone: AgentPlaceExperienceTone;
  amount: number;
  label: string;
  tags: string[];
};

export type AgentActivityMemory = {
  action: AgentAction;
  visits: number;
  affinity: number;
  confidence: number;
  frustration: number;
  goodVisits: number;
  badVisits: number;
  lastWorldTime: string;
  lastWorldMinutes: number;
  lastEvent: string;
  tags: string[];
};

export type AgentSocialFocus = {
  agentId: string;
  agentName: string;
  intent: "seek" | "avoid" | "neutral";
  reason: string;
} | null;

export type AgentEveningPlanIntent = "none" | "seek_friend" | "meet_someone" | "avoid_rival" | "decompress";
export type AgentEveningPlanOutcome = "pending" | "bonded" | "quiet" | "conflict" | "skipped";

export type AgentEveningPlan = {
  day: number;
  intent: AgentEveningPlanIntent;
  label: string;
  detail: string;
  targetAgentId?: string;
  targetAgentName?: string;
  outcome: AgentEveningPlanOutcome;
  resolved: boolean;
};

export type AgentSocialMomentKind =
  | "chat"
  | "perception"
  | "check_in"
  | "joke"
  | "advice"
  | "apology"
  | "favor"
  | "share_food"
  | "spot_credit"
  | "repay_credit"
  | "support_strain"
  | "conflict"
  | "deescalation"
  | "housemate"
  | "public";

export type AgentSocialMoment = {
  id: string;
  kind: AgentSocialMomentKind;
  label: string;
  detail: string;
  tone: "neutral" | "good" | "warn" | "bad";
  otherAgentId?: string;
  otherAgentName?: string;
  scoreDelta: number;
  trustDelta: number;
  supportDelta: number;
  worldTime: string;
  worldMinutes: number;
  expiresWorldMinutes: number;
  tags: string[];
};

export type AgentSocialMomentInput = Omit<AgentSocialMoment, "id" | "worldTime" | "worldMinutes" | "expiresWorldMinutes"> & {
  durationMinutes?: number;
};

export type AgentSocialCompassStance = "newcomer" | "open" | "seeking" | "anchored" | "guarded" | "strained" | "generous";

export type AgentSocialCompass = {
  stance: AgentSocialCompassStance;
  detail: string;
  belonging: number;
  trust: number;
  tension: number;
  supportOwed: number;
  supportGiven: number;
  relationshipCount: number;
  friendCount: number;
  rivalCount: number;
  anchorAgentId?: string;
  anchorName?: string;
  concernAgentId?: string;
  concernName?: string;
  lastUpdatedWorldTime?: string;
  recent: string[];
};

export type AgentLifeAdminCategory = "paperwork" | "supplies" | "homeCare" | "healthFollowup" | "civic" | "money";

export type AgentLifeAdmin = {
  load: number;
  urgency: number;
  paperwork: number;
  supplies: number;
  homeCare: number;
  healthFollowup: number;
  civic: number;
  money: number;
  dominantCategory: AgentLifeAdminCategory;
  nextTask: string;
  detail: string;
  suggestedActions: AgentAction[];
  lastUpdatedWorldTime?: string;
  recent: string[];
};

export type AgentStatusEffect = {
  id: string;
  label: string;
  detail: string;
  tone: "neutral" | "good" | "warn" | "bad";
};

export type AgentMoodletTone = "neutral" | "good" | "warn" | "bad";

export type AgentMoodlet = {
  id: string;
  label: string;
  detail: string;
  tone: AgentMoodletTone;
  intensity: number;
  startedWorldTime: string;
  startedWorldMinutes: number;
  expiresWorldMinutes: number;
  tags: string[];
  actionBiases: Partial<Record<AgentAction, number>>;
};

export type AgentMoodletInput = {
  id: string;
  label: string;
  detail: string;
  tone: AgentMoodletTone;
  intensity: number;
  durationMinutes: number;
  tags: string[];
  actionBiases?: Partial<Record<AgentAction, number>>;
  moodDelta?: number;
  stressDelta?: number;
};

export type AgentWantKind = "want" | "fear";
export type AgentWantStatus = "active" | "fulfilled" | "expired";

export type AgentWant = {
  id: string;
  kind: AgentWantKind;
  status: AgentWantStatus;
  label: string;
  detail: string;
  tone: AgentMoodletTone;
  intensity: number;
  progress: number;
  actions: AgentAction[];
  tags: string[];
  createdWorldTime: string;
  createdWorldMinutes: number;
  expiresWorldMinutes: number;
  lastUpdateWorldTime?: string;
};

export type AgentPersonalNoticeKind = "bill" | "health" | "work" | "social" | "build" | "home";
export type AgentPersonalNoticeStatus = "unread" | "read" | "handled" | "expired";

export type AgentPersonalNotice = {
  id: string;
  kind: AgentPersonalNoticeKind;
  label: string;
  detail: string;
  tone: AgentMoodletTone;
  actions: AgentAction[];
  createdDay: number;
  createdWorldTime: string;
  dueDay: number;
  status: AgentPersonalNoticeStatus;
  importance: number;
  source: string;
  tags: string[];
};

export type AgentMinorIllnessState = {
  active: boolean;
  label: string | null;
  severity: number;
  startedWorldTime: string | null;
  startedWorldMinutes: number;
  recoveryWorldMinutes: number;
  lastResolvedWorldMinutes: number;
};

export type AgentAftercareState = {
  active: boolean;
  label: string | null;
  detail: string | null;
  dosesRemaining: number;
  restMinutesRemaining: number;
  followUpDueWorldMinutes: number;
  expiresWorldMinutes: number;
  lastDoseWorldMinutes: number;
  missedCheckins: number;
};

export type AgentMedicalState = {
  isHospitalized: boolean;
  facilityName: string | null;
  admittedWorldTime: string | null;
  dischargeWorldMinutes: number;
  reason: string | null;
  bill: number;
  minorIllness: AgentMinorIllnessState;
  aftercare: AgentAftercareState;
};

export type AgentFinancialCategory = "income" | "food" | "housing" | "medical" | "civic" | "supplies" | "savings" | "misc";
export type AgentFinancialTone = "income" | "expense" | "debt" | "neutral";

export type AgentFinancialEntry = {
  id: string;
  day: number;
  worldTime: string;
  category: AgentFinancialCategory;
  label: string;
  amount: number;
  balanceAfter: number;
  tone: AgentFinancialTone;
};

export type AgentBudget = {
  savings: number;
  savingsGoal: number;
  dailySpendLimit: number;
  spentToday: number;
  savedToday: number;
  emergencyWithdrawalsToday: number;
  livingCostDue: number;
  livingCostBase: number;
  livingCostCadenceDays: number;
  nextLivingCostDay: number;
  lastLivingCostLabel: string;
  overdueBillDays: number;
  lateFeesToday: number;
  hardshipDeferrals: number;
  creditScore: number;
  onTimeBillStreak: number;
  missedBillCount: number;
  lastReview: string;
};

export type AgentCareer = {
  title: string;
  level: number;
  xp: number;
  xpToNext: number;
  wage: number;
  performance: number;
  satisfaction: number;
  burnout: number;
  attendanceStreak: number;
  missedShifts: number;
  lastShiftWorldTime?: string;
  recent: string[];
};

export type AgentCivicRecord = {
  serviceReputation: number;
  serviceImpactToday: number;
  demandResolvedToday: number;
  pressureRelievedToday: number;
  lastService: string | null;
  recent: string[];
};

export type AgentHousehold = {
  pantry: number;
  pantryCapacity: number;
  toiletries: number;
  cleaningSupplies: number;
  supplyCapacity: number;
  clutter: number;
  laundry: number;
  sleepQuality: number;
  homeComfort: number;
  rentStress: number;
  choresDoneToday: number;
  lastHomeCare?: string;
  recent: string[];
};

export type AgentOutfitStyle = "workwear" | "casual" | "tidy" | "soft" | "bright";

export type AgentOutfit = {
  style: AgentOutfitStyle;
  cleanliness: number;
  wear: number;
  confidence: number;
  lastChangedWorldTime?: string;
  recent: string[];
};

export type AgentNutrition = {
  quality: number;
  hydration: number;
  variety: number;
  fullness: number;
  lastMealLabel?: string;
  lastMealWorldTime?: string;
  recent: string[];
};

export type AgentLeisureHobby = "music" | "games" | "reading" | "fitness" | "people_watching" | "crafting";

export type AgentLeisure = {
  hobby: AgentLeisureHobby;
  fun: number;
  boredom: number;
  curiosity: number;
  lastLeisureWorldTime?: string;
  recent: string[];
};

export type AgentSleepChronotype = "early_bird" | "steady" | "night_owl";

export type AgentSleepState = {
  chronotype: AgentSleepChronotype;
  sleepDebt: number;
  circadianFatigue: number;
  bedtimeTarget: number;
  wakeTarget: number;
  hoursSleptLastNight: number;
  lastSleepWorldTime?: string;
  recent: string[];
};

export type AgentAutonomy = {
  dignity: number;
  control: number;
  overwhelm: number;
  lastChoiceWorldTime?: string;
  recent: string[];
};

export type AgentTimeManagement = {
  punctuality: number;
  timeAwareness: number;
  rush: number;
  keptWindowsToday: number;
  lateWindowsToday: number;
  missedWindowsToday: number;
  lastScheduleWorldTime?: string;
  recent: string[];
};

export type AgentRoutineRhythm = {
  work: number;
  care: number;
  home: number;
  social: number;
  finance: number;
  momentum: number;
  drift: number;
  streak: number;
  strainDays: number;
  identity: string;
  recent: string[];
};

export type AgentEmotion = {
  composure: number;
  loneliness: number;
  confidence: number;
  irritation: number;
  hope: number;
  lastEmotionWorldTime?: string;
  recent: string[];
};

export type AgentLifeProfile = {
  archetype: string;
  motive: string;
  habit: string;
  worry: string;
  actionBiases: Partial<Record<AgentAction, number>>;
};

export type AgentDriveId = "security" | "belonging" | "mastery" | "care" | "comfort" | "autonomy";

export type AgentValueProfile = Record<AgentDriveId, number>;

export type AgentDriveState = {
  id: AgentDriveId;
  label: string;
  detail: string;
  value: number;
  pressure: number;
  tone: "neutral" | "good" | "warn" | "bad";
};

export type AgentLifePriority = {
  id: string;
  label: string;
  detail: string;
  tone: "neutral" | "good" | "warn" | "bad";
};

export type AgentIntentionHorizon = "now" | "today" | "future";

export type AgentIntention = {
  id: string;
  label: string;
  detail: string;
  reason: string;
  horizon: AgentIntentionHorizon;
  urgency: number;
  confidence: number;
  tone: "neutral" | "good" | "warn" | "bad";
  actions: AgentAction[];
  actionBiases: Partial<Record<AgentAction, number>>;
  tags: string[];
  createdWorldTime: string;
  updatedWorldTime: string;
  history: string[];
};

export type AgentAspirationKind = "stability" | "career" | "belonging" | "wellness" | "comfort" | "building";

export type AgentAspiration = {
  id: AgentAspirationKind;
  label: string;
  detail: string;
  actions: AgentAction[];
  signals: string[];
  level: number;
  progress: number;
  dailyProgress: number;
  pressure: number;
  tone: "neutral" | "good" | "warn" | "bad";
  milestone: string;
  history: string[];
  lastProgressWorldTime?: string;
};

export type AgentSkillId = "labor" | "commerce" | "care" | "social" | "homecraft" | "civic";

export type AgentSkill = {
  id: AgentSkillId;
  label: string;
  level: number;
  xp: number;
  xpToNext: number;
  aptitude: number;
  recent: string[];
};

export type AgentSkillSet = Record<AgentSkillId, AgentSkill>;

export type AgentReputation = {
  reliability: number;
  warmth: number;
  ambition: number;
  trouble: number;
};

export type AgentTarget = AgentPoint & {
  label: string;
  action: AgentAction;
  structureId: string;
  structureName: string;
  actionPointId: string;
  actionPointType: ActionPoint["type"];
  intent?: AgentActionIntent;
  waypoints: AgentPoint[];
  routeLength: number;
  hoursLabel?: string;
  openNow?: boolean;
};

export type AgentDecisionReadOption = {
  id: string;
  label: string;
  action: AgentAction;
  location: string;
  intentLabel: string;
  intent?: AgentActionIntent;
  utility: number;
  choiceScore: number;
  personalityNudge: number;
  memoryNudge: number;
  routeSteps: number;
  reachable: boolean;
  selected: boolean;
  tone: "neutral" | "good" | "warn" | "bad";
  reason: string;
};

export type AgentDecisionRead = {
  worldTime: string;
  phaseLabel: string;
  primaryNeed: string;
  intention: string;
  style: string;
  urgency: number;
  confidence: number;
  optionWindow: number;
  randomness: number;
  selectedOptionId: string | null;
  selectedLabel: string;
  selectedAction: AgentAction | "none";
  selectedIntent?: AgentActionIntent;
  reason: string;
  factors: string[];
  options: AgentDecisionReadOption[];
};

export type SemanticObjectState = {
  id: string;
  structureId: string;
  structureName: string;
  actionPointId: string;
  actionPointType: ActionPoint["type"];
  label: string;
  usesToday: number;
  totalUses: number;
  lastUsedBy?: string;
  lastUsedWorldTime?: string;
  lastAction?: AgentAction;
  capacity?: number;
  stock?: number;
  cleanliness: number;
  wear: number;
  heat: number;
  unmetDemand: number;
  servicePressure: number;
  lastIssue?: string;
  occupants: number;
  queued: number;
  crowdPressure: number;
  hoursLabel?: string;
  openNow?: boolean;
};

export type SimAgent = {
  id: string;
  name: string;
  walletAddress: string;
  dna: AgentDna;
  position: AgentPoint;
  target: AgentTarget | null;
  currentAction: AgentAction;
  goal: string;
  plan: string[];
  dayPlan: string[];
  reflection: string;
  lastDecision: string;
  lifeProfile: AgentLifeProfile;
  values: AgentValueProfile;
  activeDrive: AgentDriveState;
  lifePriority: AgentLifePriority;
  activeIntention: AgentIntention;
  decisionRead: AgentDecisionRead;
  aspiration: AgentAspiration;
  skills: AgentSkillSet;
  commitments: AgentCommitment[];
  availableActions: AgentActionOption[];
  reputation: AgentReputation;
  hunger: number;
  energy: number;
  health: number;
  mood: number;
  social: number;
  hygiene: number;
  comfort: number;
  stress: number;
  money: number;
  rentDue: number;
  medicalDebt: number;
  medical: AgentMedicalState;
  finances: AgentFinancialEntry[];
  budget: AgentBudget;
  career: AgentCareer;
  civic: AgentCivicRecord;
  household: AgentHousehold;
  outfit: AgentOutfit;
  nutrition: AgentNutrition;
  leisure: AgentLeisure;
  sleep: AgentSleepState;
  autonomy: AgentAutonomy;
  time: AgentTimeManagement;
  rhythm: AgentRoutineRhythm;
  emotion: AgentEmotion;
  job: string;
  home: string;
  inventory: string[];
  relationships: Record<string, number>;
  relationshipDetails: Record<string, AgentRelationship>;
  placeMemory: Record<string, AgentPlaceMemory>;
  activityMemory: Partial<Record<AgentAction, AgentActivityMemory>>;
  socialFocus: AgentSocialFocus;
  socialCompass: AgentSocialCompass;
  lifeAdmin: AgentLifeAdmin;
  eveningPlan: AgentEveningPlan;
  socialMoments: AgentSocialMoment[];
  memories: AgentMemory[];
  moodlets: AgentMoodlet[];
  wants: AgentWant[];
  personalNotices: AgentPersonalNotice[];
  statusEffects: AgentStatusEffect[];
  routine: AgentDailyRoutine;
  speed: number;
  dwellSeconds: number;
  dwellTotalSeconds: number;
  actionProgress: number;
  observationCooldown: number;
};

export type AgentEventKind = "arrival" | "routine" | "food" | "work" | "social" | "conflict" | "health" | "money" | "home" | "city";
export type AgentEventTone = "neutral" | "good" | "warn" | "bad";

export type AgentEvent = {
  id: string;
  agentId: string;
  agentName: string;
  text: string;
  timestamp: number;
  worldTime: string;
  kind: AgentEventKind;
  tone: AgentEventTone;
  importance: number;
  position?: AgentPoint;
  locationLabel?: string;
  actionLabel?: string;
};

export type CivicNotice = {
  id: string;
  sourceEventId: string;
  sourceAgentId: string;
  sourceAgentName: string;
  day: number;
  worldTime: string;
  worldMinutes: number;
  expiresWorldMinutes: number;
  kind: AgentEventKind;
  tone: AgentEventTone;
  headline: string;
  detail: string;
  importance: number;
  tags: string[];
  acknowledgedBy: string[];
};

export type AgentSummary = {
  day: number;
  worldTime: string;
  phase: DayPhase;
  phaseLabel: string;
  weather: WeatherState;
  cityPulse: CityPulse;
  agents: SimAgent[];
  events: AgentEvent[];
  civicNotices: CivicNotice[];
  objectStates: SemanticObjectState[];
};

export type AgentRouteResolver = (from: AgentPoint, to: AgentPoint) => AgentPoint[] | null;

export class AgentSimulation {
  private readonly agents = new Map<string, SimAgent>();
  private readonly events: AgentEvent[] = [];
  private readonly civicNotices: CivicNotice[] = [];
  private readonly memory = new MemorySystem();
  private readonly objectStates = new ObjectStateSystem();
  private readonly cityPulse = new CityPulseSystem();
  private readonly relationships = new RelationshipSystem();
  private readonly spawns = new SpawnSystem();
  private readonly decisions = new AgentDecisionSystem();
  private readonly actions = new ActionResolver();
  private nextEventNumber = 1;
  private nextSequenceNumber = 1;
  private worldTick = 0;
  private worldMinutes = 8 * 60;
  private latestCityPulse: CityPulse = this.cityPulse.create(1, "08:00", "morning", [], []);
  private latestWeather: WeatherState = this.weatherFor(1, this.worldMinutes);
  private lastPulseAlertKey = "";
  private lastWeatherAlertKey = "";
  private lastAnnouncedPhase: DayPhase = phaseForMinutes(this.worldMinutes);
  private lastAnnouncedDay = 1;

  reset() {
    this.agents.clear();
    this.events.length = 0;
    this.civicNotices.length = 0;
    this.objectStates.reset(1);
    this.spawns.reset();
    this.nextEventNumber = 1;
    this.nextSequenceNumber = 1;
    this.worldTick = 0;
    this.worldMinutes = 8 * 60;
    this.latestCityPulse = this.cityPulse.create(1, this.worldTime, this.currentPhase, [], []);
    this.latestWeather = this.weatherFor(1, this.worldMinutes);
    this.lastPulseAlertKey = "";
    this.lastWeatherAlertKey = "";
    this.lastAnnouncedPhase = phaseForMinutes(this.worldMinutes);
    this.lastAnnouncedDay = 1;
  }

  spawn(structures: StructureMetadata[], startOverride?: AgentPoint, routeResolver?: AgentRouteResolver) {
    const agent = this.spawns.spawnLocal(structures, startOverride, this.currentDay);
    this.agents.set(agent.id, agent);
    this.recordFinance(agent, agent.money, "income", "Starting credits", "income");
    this.addMemory(agent, "observation", `${agent.name} entered Genesis District at ${this.worldTime}.`, 7, ["arrival", "city"]);
    this.addMemory(agent, "plan", `Today's loose plan: ${agent.dayPlan.join(", ")}.`, 5, ["plan", "routine"]);
    this.log(agent, `${agent.name} moved into Genesis District with ${agent.money} credits.`, "arrival", "neutral", 7);
    this.refreshAspiration(agent);
    this.updateCommitments(agent);
    this.refreshWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    this.chooseNextTarget(agent, structures, routeResolver);
    this.refreshCityPulse();
    return agent;
  }

  spawnFromSeed(input: SpawnSeedInput, structures: StructureMetadata[], startOverride?: AgentPoint, routeResolver?: AgentRouteResolver) {
    const agent = this.spawns.spawnFromSeed(input, structures, startOverride, this.currentDay);
    this.agents.set(agent.id, agent);
    this.recordFinance(agent, agent.money, "income", "Starting credits", "income");
    this.addMemory(agent, "observation", `${agent.name} entered Genesis District from a qualifying purchase at ${this.worldTime}.`, 8, ["arrival", "purchase", "city"]);
    this.addMemory(agent, "plan", `Today's loose plan: ${agent.dayPlan.join(", ")}.`, 5, ["plan", "routine"]);
    this.log(agent, `${agent.name} was born from ${agent.walletAddress} and moved into Genesis District.`, "arrival", "good", 8);
    this.refreshAspiration(agent);
    this.updateCommitments(agent);
    this.refreshWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    this.chooseNextTarget(agent, structures, routeResolver);
    this.refreshCityPulse();
    return agent;
  }

  forceHealthCrisis(agentId: string, structures: StructureMetadata[]) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    agent.health = 0;
    agent.energy = clamp(Math.min(agent.energy, 12));
    agent.hunger = clamp(Math.max(agent.hunger, 96));
    agent.stress = clamp(Math.max(agent.stress, 82));
    this.admitIfHealthCrisis(agent, structures, "dev-forced health crisis");
    return agent;
  }

  forceMinorIllnessForDebug(agentId?: string, severity = 58) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent || agent.medical.isHospitalized) return null;
    this.startMinorIllness(agent, "Debug Cold", Math.round(clamp(severity, 18, 72)), "debug exposure");
    this.refreshWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    this.decisions.updateLifePriority(agent, this.decisionContext());
    this.refreshCityPulse();
    return agent;
  }

  forceObjectIssueForDebug(structures: StructureMetadata[], kind: "food" | "clinic" | "upkeep" = "food") {
    const preferredTypes: Record<"food" | "clinic" | "upkeep", ActionPoint["type"][]> = {
      food: ["shelf", "vending_machine", "register"],
      clinic: ["medicine_cabinet", "clinic_bed"],
      upkeep: ["sink", "desk", "workbench", "storage"]
    };
    const typeSet = preferredTypes[kind];
    for (const structure of structures) {
      let point: ActionPoint | undefined;
      for (const type of typeSet) {
        point = structure.actionPoints.find((candidate) => candidate.type === type);
        if (point) break;
      }
      if (!point) continue;
      const position = worldPoint(point.position);
      const action: AgentAction = kind === "clinic" ? "healing" : kind === "food" ? "shopping" : "working";
      const state = this.objectStates.stateForTarget({
        ...position,
        label: `${structure.name}: ${point.label}`,
        action,
        structureId: structure.id,
        structureName: structure.name,
        actionPointId: point.id,
        actionPointType: point.type,
        waypoints: [position],
        routeLength: 1,
        hoursLabel: structure.hours?.[0]?.label,
        openNow: true
      });
      if (state.stock !== undefined) state.stock = 0;
      state.unmetDemand = Math.round(clamp(state.unmetDemand + (kind === "upkeep" ? 1 : 4), 0, 99));
      state.servicePressure = Math.round(clamp(Math.max(state.servicePressure, kind === "upkeep" ? 74 : 90)));
      state.cleanliness = Math.round(clamp(Math.min(state.cleanliness, kind === "upkeep" ? 32 : 58)));
      state.heat = Math.round(clamp(Math.max(state.heat, kind === "upkeep" ? 68 : 46)));
      state.lastIssue = kind === "clinic" ? "Clinic supplies exhausted" : kind === "food" ? "Empty food shelf" : "Upkeep backlog";
      this.refreshCityPulse();
      this.logCity(`${state.lastIssue} at ${state.label}.`, kind === "clinic" ? "health" : kind === "food" ? "food" : "city", "warn", 7);
      return state;
    }
    return null;
  }

  setFinanceScenarioForDebug(
    agentId: string | undefined,
    values: Partial<Pick<SimAgent, "money" | "rentDue" | "medicalDebt">> & { savings?: number; livingCostDue?: number }
  ) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    if (Number.isFinite(values.money)) agent.money = Math.max(0, Math.round(values.money! * 100) / 100);
    if (Number.isFinite(values.savings)) agent.budget.savings = Math.max(0, Math.round(values.savings! * 100) / 100);
    if (Number.isFinite(values.rentDue)) agent.rentDue = Math.max(0, Math.round(values.rentDue! * 100) / 100);
    if (Number.isFinite(values.medicalDebt)) agent.medicalDebt = Math.max(0, Math.round(values.medicalDebt! * 100) / 100);
    if (Number.isFinite(values.livingCostDue)) agent.budget.livingCostDue = Math.max(0, Math.round(values.livingCostDue! * 100) / 100);
    this.refreshWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    this.decisions.updateLifePriority(agent, this.decisionContext());
    this.refreshCityPulse();
    return agent;
  }

  setHouseholdScenarioForDebug(
    agentId: string | undefined,
    values: Partial<Pick<SimAgent, "hunger" | "energy" | "health" | "hygiene" | "comfort" | "stress">> & {
      pantry?: number;
      pantryCapacity?: number;
      toiletries?: number;
      cleaningSupplies?: number;
      supplyCapacity?: number;
      clutter?: number;
      laundry?: number;
      sleepQuality?: number;
      homeComfort?: number;
    }
  ) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    if (Number.isFinite(values.hunger)) agent.hunger = clamp(values.hunger!);
    if (Number.isFinite(values.energy)) agent.energy = clamp(values.energy!);
    if (Number.isFinite(values.health)) agent.health = clamp(values.health!);
    if (Number.isFinite(values.hygiene)) agent.hygiene = clamp(values.hygiene!);
    if (Number.isFinite(values.comfort)) agent.comfort = clamp(values.comfort!);
    if (Number.isFinite(values.stress)) agent.stress = clamp(values.stress!);
    if (Number.isFinite(values.pantryCapacity)) agent.household.pantryCapacity = Math.max(1, Math.round(values.pantryCapacity!));
    if (Number.isFinite(values.pantry)) agent.household.pantry = Math.max(0, Math.min(agent.household.pantryCapacity, Math.round(values.pantry!)));
    if (Number.isFinite(values.supplyCapacity)) agent.household.supplyCapacity = Math.max(1, Math.round(values.supplyCapacity!));
    if (Number.isFinite(values.toiletries)) agent.household.toiletries = Math.max(0, Math.min(agent.household.supplyCapacity, Math.round(values.toiletries!)));
    if (Number.isFinite(values.cleaningSupplies)) {
      agent.household.cleaningSupplies = Math.max(0, Math.min(agent.household.supplyCapacity, Math.round(values.cleaningSupplies!)));
    }
    if (Number.isFinite(values.clutter)) agent.household.clutter = Math.round(clamp(values.clutter!));
    if (Number.isFinite(values.laundry)) agent.household.laundry = Math.round(clamp(values.laundry!));
    if (Number.isFinite(values.sleepQuality)) agent.household.sleepQuality = Math.round(clamp(values.sleepQuality!));
    if (Number.isFinite(values.homeComfort)) agent.household.homeComfort = Math.round(clamp(values.homeComfort!));
    this.refreshWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    this.decisions.updateLifePriority(agent, this.decisionContext());
    this.refreshCityPulse();
    return agent;
  }

  setOutfitScenarioForDebug(
    agentId: string | undefined,
    values: Partial<Pick<AgentOutfit, "style" | "cleanliness" | "wear" | "confidence">>
  ) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    if (values.style) agent.outfit.style = values.style;
    if (Number.isFinite(values.cleanliness)) agent.outfit.cleanliness = Math.round(clamp(values.cleanliness!));
    if (Number.isFinite(values.wear)) agent.outfit.wear = Math.round(clamp(values.wear!));
    if (Number.isFinite(values.confidence)) agent.outfit.confidence = Math.round(clamp(values.confidence!));
    else this.refreshOutfitConfidence(agent);
    agent.outfit.lastChangedWorldTime = this.worldTime;
    agent.outfit.recent.unshift(`${this.worldTime} Outfit adjusted for testing.`);
    agent.outfit.recent.splice(4);
    this.refreshWantsAndFears(agent);
    this.refreshCityPulse();
    return agent;
  }

  setNutritionScenarioForDebug(
    agentId: string | undefined,
    values: Partial<Pick<AgentNutrition, "quality" | "hydration" | "variety" | "fullness" | "lastMealLabel">>
  ) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    if (Number.isFinite(values.quality)) agent.nutrition.quality = Math.round(clamp(values.quality!));
    if (Number.isFinite(values.hydration)) agent.nutrition.hydration = Math.round(clamp(values.hydration!));
    if (Number.isFinite(values.variety)) agent.nutrition.variety = Math.round(clamp(values.variety!));
    if (Number.isFinite(values.fullness)) agent.nutrition.fullness = Math.round(clamp(values.fullness!));
    if (values.lastMealLabel) {
      agent.nutrition.lastMealLabel = values.lastMealLabel;
      agent.nutrition.lastMealWorldTime = this.worldTime;
    }
    agent.nutrition.recent.unshift(`${this.worldTime} Nutrition adjusted for testing.`);
    agent.nutrition.recent.splice(4);
    this.refreshWantsAndFears(agent);
    this.refreshCityPulse();
    return agent;
  }

  setLeisureScenarioForDebug(agentId: string | undefined, values: Partial<Pick<AgentLeisure, "hobby" | "fun" | "boredom" | "curiosity">>) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    if (values.hobby) agent.leisure.hobby = values.hobby;
    if (Number.isFinite(values.fun)) agent.leisure.fun = Math.round(clamp(values.fun!));
    if (Number.isFinite(values.boredom)) agent.leisure.boredom = Math.round(clamp(values.boredom!));
    if (Number.isFinite(values.curiosity)) agent.leisure.curiosity = Math.round(clamp(values.curiosity!));
    agent.leisure.lastLeisureWorldTime = this.worldTime;
    agent.leisure.recent.unshift(`${this.worldTime} Leisure adjusted for testing.`);
    agent.leisure.recent.splice(4);
    this.refreshWantsAndFears(agent);
    this.refreshCityPulse();
    return agent;
  }

  setSleepScenarioForDebug(
    agentId: string | undefined,
    values: Partial<Pick<AgentSleepState, "chronotype" | "sleepDebt" | "circadianFatigue" | "hoursSleptLastNight">>
  ) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    if (values.chronotype) {
      agent.sleep.chronotype = values.chronotype;
      const schedule = this.sleepScheduleFor(values.chronotype);
      agent.sleep.bedtimeTarget = schedule.bedtimeTarget;
      agent.sleep.wakeTarget = schedule.wakeTarget;
    }
    if (Number.isFinite(values.sleepDebt)) agent.sleep.sleepDebt = Math.round(clamp(values.sleepDebt!));
    if (Number.isFinite(values.circadianFatigue)) agent.sleep.circadianFatigue = Math.round(clamp(values.circadianFatigue!));
    if (Number.isFinite(values.hoursSleptLastNight)) agent.sleep.hoursSleptLastNight = Math.round(clamp(values.hoursSleptLastNight!, 0, 12) * 10) / 10;
    agent.sleep.recent.unshift(`${this.worldTime} Sleep rhythm adjusted for testing.`);
    agent.sleep.recent.splice(4);
    this.refreshWantsAndFears(agent);
    this.refreshCityPulse();
    return agent;
  }

  setAutonomyScenarioForDebug(agentId: string | undefined, values: Partial<Pick<AgentAutonomy, "dignity" | "control" | "overwhelm">>) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    if (Number.isFinite(values.dignity)) agent.autonomy.dignity = Math.round(clamp(values.dignity!));
    if (Number.isFinite(values.control)) agent.autonomy.control = Math.round(clamp(values.control!));
    if (Number.isFinite(values.overwhelm)) agent.autonomy.overwhelm = Math.round(clamp(values.overwhelm!));
    agent.autonomy.lastChoiceWorldTime = this.worldTime;
    agent.autonomy.recent.unshift(`${this.worldTime} Autonomy adjusted for testing.`);
    agent.autonomy.recent.splice(4);
    this.refreshAutonomy(agent);
    this.refreshWantsAndFears(agent);
    this.refreshCityPulse();
    return agent;
  }

  setTimeScenarioForDebug(agentId: string | undefined, values: Partial<Pick<AgentTimeManagement, "punctuality" | "timeAwareness" | "rush">>) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    if (Number.isFinite(values.punctuality)) agent.time.punctuality = Math.round(clamp(values.punctuality!));
    if (Number.isFinite(values.timeAwareness)) agent.time.timeAwareness = Math.round(clamp(values.timeAwareness!));
    if (Number.isFinite(values.rush)) agent.time.rush = Math.round(clamp(values.rush!));
    agent.time.lastScheduleWorldTime = this.worldTime;
    agent.time.recent.unshift(`${this.worldTime} Time pressure adjusted for testing.`);
    agent.time.recent.splice(4);
    this.refreshTimeManagement(agent);
    this.refreshWantsAndFears(agent);
    this.refreshCityPulse();
    return agent;
  }

  setRhythmScenarioForDebug(agentId: string | undefined, values: Partial<Pick<AgentRoutineRhythm, "work" | "care" | "home" | "social" | "finance" | "momentum" | "drift">>) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    if (Number.isFinite(values.work)) agent.rhythm.work = Math.round(clamp(values.work!));
    if (Number.isFinite(values.care)) agent.rhythm.care = Math.round(clamp(values.care!));
    if (Number.isFinite(values.home)) agent.rhythm.home = Math.round(clamp(values.home!));
    if (Number.isFinite(values.social)) agent.rhythm.social = Math.round(clamp(values.social!));
    if (Number.isFinite(values.finance)) agent.rhythm.finance = Math.round(clamp(values.finance!));
    if (Number.isFinite(values.momentum)) agent.rhythm.momentum = Math.round(clamp(values.momentum!));
    if (Number.isFinite(values.drift)) agent.rhythm.drift = Math.round(clamp(values.drift!));
    agent.rhythm.recent.unshift(`${this.worldTime} Daily rhythm adjusted for testing.`);
    this.refreshRoutineRhythm(agent);
    this.refreshWantsAndFears(agent);
    this.refreshCityPulse();
    return agent;
  }

  setEmotionScenarioForDebug(agentId: string | undefined, values: Partial<Pick<AgentEmotion, "composure" | "loneliness" | "confidence" | "irritation" | "hope">>) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    if (Number.isFinite(values.composure)) agent.emotion.composure = Math.round(clamp(values.composure!));
    if (Number.isFinite(values.loneliness)) agent.emotion.loneliness = Math.round(clamp(values.loneliness!));
    if (Number.isFinite(values.confidence)) agent.emotion.confidence = Math.round(clamp(values.confidence!));
    if (Number.isFinite(values.irritation)) agent.emotion.irritation = Math.round(clamp(values.irritation!));
    if (Number.isFinite(values.hope)) agent.emotion.hope = Math.round(clamp(values.hope!));
    agent.emotion.lastEmotionWorldTime = this.worldTime;
    agent.emotion.recent.unshift(`${this.worldTime} Emotional state adjusted for testing.`);
    this.refreshEmotion(agent);
    this.refreshWantsAndFears(agent);
    this.refreshCityPulse();
    return agent;
  }

  replanForDebug(agentId: string | undefined, structures: StructureMetadata[], routeResolver?: AgentRouteResolver) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    if (!agent.medical.isHospitalized) {
      agent.target = null;
      agent.currentAction = "idle";
      agent.dwellSeconds = 0;
      agent.dwellTotalSeconds = 0;
      agent.actionProgress = 0;
      this.refreshWantsAndFears(agent);
      this.refreshLifeAdmin(agent);
      this.decisions.updateLifePriority(agent, this.decisionContext());
      this.chooseNextTarget(agent, structures, routeResolver);
    }
    this.refreshCityPulse();
    return agent;
  }

  resolveCivicBillsForDebug(agentId: string | undefined, structures: StructureMetadata[], strategy = "current") {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    const previousAction = agent.currentAction;
    if (strategy === "request_payment_plan") {
      const target = this.bestCivicTargetForDebug(agent, structures, strategy);
      if (!target) return null;
      agent.target = target;
      this.objectStates.stateForTarget(target);
    }
    agent.currentAction = "paying_rent";
    this.actions.resolve(agent, this.actionContext());
    this.updateCommitments(agent);
    this.resolveWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    this.decisions.updateLifePriority(agent, this.decisionContext());
    agent.currentAction = previousAction === "hospitalized" ? "hospitalized" : "idle";
    this.refreshCityPulse();
    return agent;
  }

  resolveMailForDebug(agentId: string | undefined, structures: StructureMetadata[]) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent) return null;
    const target = this.bestMailTargetForDebug(agent, structures);
    if (!target) return null;
    const previousAction = agent.currentAction;
    agent.target = target;
    this.objectStates.stateForTarget(target);
    agent.currentAction = "checking_mail";
    this.actions.resolve(agent, this.actionContext());
    this.updateCommitments(agent);
    this.resolveWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    this.decisions.updateLifePriority(agent, this.decisionContext());
    agent.currentAction = previousAction === "hospitalized" ? "hospitalized" : "idle";
    this.refreshCityPulse();
    return agent;
  }

  private bestCivicTargetForDebug(agent: SimAgent, structures: StructureMetadata[], strategy: string): AgentTarget | null {
    const structure = structures.find((candidate) => candidate.type === "town_hall");
    if (!structure) return null;
    const point =
      ["desk", "notice_board", "mailbox"]
        .map((type) => structure.actionPoints.find((candidate) => candidate.type === type))
        .find(Boolean) ?? structure.actionPoints[0];
    if (!point) return null;
    const position = worldPoint(point.position);
    return {
      ...position,
      label: `${structure.name}: ${point.label}`,
      action: "paying_rent",
      structureId: structure.id,
      structureName: structure.name,
      actionPointId: point.id,
      actionPointType: point.type,
      intent: {
        kind: "civic",
        strategy,
        label: strategy === "request_payment_plan" ? "Request payment plan" : "Handle bills",
        billType: "none",
        amount: 0,
        paymentSource: "none",
        savingsAllowed: false
      },
      waypoints: [position],
      routeLength: 1,
      hoursLabel: structure.hours?.[0]?.label,
      openNow: true
    };
  }

  private bestMailTargetForDebug(agent: SimAgent, structures: StructureMetadata[]): AgentTarget | null {
    const structure =
      structures.find((candidate) => candidate.actionPoints.some((point) => point.type === "mailbox")) ??
      structures.find((candidate) => candidate.type === "town_hall") ??
      structures[0];
    if (!structure) return null;
    const point = structure.actionPoints.find((candidate) => candidate.type === "mailbox") ?? structure.actionPoints.find((candidate) => candidate.type === "notice_board") ?? structure.actionPoints[0];
    if (!point) return null;
    const position = worldPoint(point.position);
    return {
      ...position,
      label: `${structure.name}: ${point.label}`,
      action: "checking_mail",
      structureId: structure.id,
      structureName: structure.name,
      actionPointId: point.id,
      actionPointType: point.type,
      intent: {
        kind: "civic",
        strategy: "check_mail",
        label: "Check notices",
        billType: this.totalBillsDue(agent) > 0 ? "rent" : "none",
        savingsAllowed: false
      },
      waypoints: [position],
      routeLength: 1,
      hoursLabel: structure.hours?.[0]?.label,
      openNow: true
    };
  }

  resolveWorkShiftForDebug(agentId: string | undefined, structures: StructureMetadata[], strategy = "work_shift") {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent || agent.medical.isHospitalized) return null;
    const target = strategy === "call_in_sick" ? this.bestSickLeaveTargetForDebug(agent, structures) : this.bestWorkTargetForDebug(agent, structures, strategy);
    if (!target) return null;
    agent.target = target;
    agent.currentAction = target.action;
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 1;
    this.objectStates.stateForTarget(target);
    this.actions.resolve(agent, this.actionContext());
    this.updateCommitments(agent);
    this.resolveWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    agent.currentAction = "idle";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 0;
    this.decisions.updateLifePriority(agent, this.decisionContext());
    this.refreshCityPulse();
    return agent;
  }

  resolveFoodPurchaseForDebug(agentId: string | undefined, structures: StructureMetadata[], strategy = "buy_groceries") {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent || agent.medical.isHospitalized) return null;
    const target = this.bestFoodTargetForDebug(agent, structures, strategy);
    if (!target) return null;
    agent.target = target;
    agent.currentAction = "shopping";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 1;
    this.objectStates.stateForTarget(target);
    this.actions.resolve(agent, this.actionContext());
    this.updateCommitments(agent);
    this.resolveWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    agent.currentAction = "idle";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 0;
    this.decisions.updateLifePriority(agent, this.decisionContext());
    this.refreshCityPulse();
    return agent;
  }

  resolveHouseholdSupplyPurchaseForDebug(agentId: string | undefined, structures: StructureMetadata[], strategy = "buy_home_supplies") {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent || agent.medical.isHospitalized) return null;
    const target = this.bestHouseholdSupplyTargetForDebug(agent, structures, strategy);
    if (!target) return null;
    agent.target = target;
    agent.currentAction = "shopping";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 1;
    this.objectStates.stateForTarget(target);
    this.actions.resolve(agent, this.actionContext());
    this.updateCommitments(agent);
    this.resolveWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    agent.currentAction = "idle";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 0;
    this.decisions.updateLifePriority(agent, this.decisionContext());
    this.refreshCityPulse();
    return agent;
  }

  resolveHomeCareForDebug(agentId: string | undefined, structures: StructureMetadata[], strategy = "tidy_clutter") {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent || agent.medical.isHospitalized) return null;
    const target = this.bestHomeCareTargetForDebug(agent, structures, strategy);
    if (!target) return null;
    agent.target = target;
    agent.currentAction = target.action;
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 1;
    this.objectStates.stateForTarget(target);
    this.actions.resolve(agent, this.actionContext());
    this.updateCommitments(agent);
    this.resolveWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    agent.currentAction = "idle";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 0;
    this.decisions.updateLifePriority(agent, this.decisionContext());
    this.refreshCityPulse();
    return agent;
  }

  resolveClinicCareForDebug(agentId: string | undefined, structures: StructureMetadata[], strategy = "treat_symptoms") {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent || agent.medical.isHospitalized) return null;
    const target = strategy === "take_aftercare_medicine" ? this.bestAftercareTargetForDebug(agent, structures) : this.bestClinicTargetForDebug(agent, structures, strategy);
    if (!target) return null;
    agent.target = target;
    agent.currentAction = "healing";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 1;
    this.objectStates.stateForTarget(target);
    this.actions.resolve(agent, this.actionContext());
    this.updateCommitments(agent);
    this.resolveWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    agent.currentAction = "idle";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 0;
    this.decisions.updateLifePriority(agent, this.decisionContext());
    this.refreshCityPulse();
    return agent;
  }

  resolveSleepForDebug(agentId: string | undefined, structures: StructureMetadata[]) {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent || agent.medical.isHospitalized) return null;
    const target = this.bestSleepTargetForDebug(agent, structures);
    if (!target) return null;
    agent.target = target;
    agent.currentAction = "sleeping";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 1;
    this.objectStates.stateForTarget(target);
    this.actions.resolve(agent, this.actionContext());
    this.updateCommitments(agent);
    this.resolveWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    agent.currentAction = "idle";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 0;
    this.decisions.updateLifePriority(agent, this.decisionContext());
    this.refreshCityPulse();
    return agent;
  }

  resolveLeisureForDebug(agentId: string | undefined, structures: StructureMetadata[], strategy = "hobby_break") {
    const agent = (agentId ? this.agents.get(agentId) : null) ?? this.agentList()[0];
    if (!agent || agent.medical.isHospitalized) return null;
    const target = this.bestLeisureTargetForDebug(agent, structures, strategy);
    if (!target) return null;
    agent.target = target;
    agent.currentAction = target.action;
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 1;
    this.objectStates.stateForTarget(target);
    this.actions.resolve(agent, this.actionContext());
    this.updateCommitments(agent);
    this.resolveWantsAndFears(agent);
    this.refreshLifeAdmin(agent);
    agent.currentAction = "idle";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 0;
    this.decisions.updateLifePriority(agent, this.decisionContext());
    this.refreshCityPulse();
    return agent;
  }

  forceSupportDebtForDebug(agentId?: string, amount = 3) {
    const agents = this.agentList();
    const agent = (agentId ? this.agents.get(agentId) : null) ?? agents[0];
    if (!agent || agent.medical.isHospitalized) return null;
    const other = agents.find((candidate) => candidate.id !== agent.id && !candidate.medical.isHospitalized);
    if (!other) return null;

    const owed = Math.max(1, Math.round(clamp(amount, 1, 12) * 10) / 10);
    const agentRel = this.relationships.relationshipFor(agent, other, this.worldTime);
    const otherRel = this.relationships.relationshipFor(other, agent, this.worldTime);
    agentRel.supportBalance = owed;
    agentRel.score = Math.max(agentRel.score, 8);
    agentRel.trust = Math.max(agentRel.trust, 48);
    agentRel.tension = Math.min(agentRel.tension, 36);
    agentRel.lastGesture = "Owes support";
    agentRel.lastEvent = `${other.name} helped earlier; ${owed} support is still owed.`;
    agentRel.history.unshift(`${this.worldTime} Owes ${other.name} ${owed} support.`);
    agentRel.history.splice(4);
    agent.relationships[other.id] = agentRel.score;

    otherRel.supportBalance = -owed;
    otherRel.score = Math.max(otherRel.score, 8);
    otherRel.trust = Math.max(otherRel.trust, 48);
    otherRel.tension = Math.min(otherRel.tension, 34);
    otherRel.lastGesture = "Helped earlier";
    otherRel.lastEvent = `${agent.name} still owes ${owed} support.`;
    otherRel.history.unshift(`${this.worldTime} Helped ${agent.name}; ${owed} support outstanding.`);
    otherRel.history.splice(4);
    other.relationships[agent.id] = otherRel.score;

    this.addMemory(agent, "event", `${other.name} helped earlier, and ${owed} support still needs to be repaid.`, 7, ["social", "support", other.id]);
    this.addMemory(other, "event", `${agent.name} still owes ${owed} support from earlier help.`, 6, ["social", "support", agent.id]);
    this.log(agent, `${agent.name} now owes ${other.name} ${owed} support.`, "social", "warn", 6);
    this.refreshWantsAndFears(agent);
    this.refreshWantsAndFears(other);
    this.refreshSocialCompass(agent);
    this.refreshSocialCompass(other);
    this.refreshLifeAdmin(agent);
    this.refreshLifeAdmin(other);
    this.decisions.updateLifePriority(agent, this.decisionContext());
    this.decisions.updateLifePriority(other, this.decisionContext());
    this.refreshCityPulse();
    return agent;
  }

  forceSocialMomentForDebug(agentId?: string) {
    const agents = this.agentList();
    const agent = (agentId ? this.agents.get(agentId) : null) ?? agents[0];
    if (!agent || agent.medical.isHospitalized) return null;
    const other = agents.find((candidate) => candidate.id !== agent.id && !candidate.medical.isHospitalized);
    if (!other) return null;

    other.position = { x: agent.position.x + 0.85, y: agent.position.y, z: agent.position.z + 0.35 };
    agent.target = null;
    other.target = null;
    agent.currentAction = "socializing";
    other.currentAction = "socializing";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 1;
    this.actions.resolve(agent, this.actionContext(agents));
    this.updateCommitments(agent);
    this.resolveWantsAndFears(agent);
    this.relationships.observeNearbyAgents(other, agents, 5, this.relationshipContext());
    this.refreshWantsAndFears(agent);
    this.refreshWantsAndFears(other);
    this.refreshSocialCompass(agent);
    this.refreshSocialCompass(other);
    this.refreshLifeAdmin(agent);
    this.refreshLifeAdmin(other);
    this.refreshCityPulse();
    return agent;
  }

  private bestWorkTargetForDebug(agent: SimAgent, structures: StructureMetadata[], strategy = "work_shift"): AgentTarget | null {
    const byJob: Record<string, ActionPoint["type"][]> = {
      builder: ["workbench", "storage", "job_station", "locker"],
      materials_clerk: ["storage", "job_station", "locker"],
      grocer: ["shelf", "vending_machine", "register"],
      clinician: ["medicine_cabinet", "clinic_bed", "desk"],
      security_officer: ["desk", "storage"],
      clerk: ["mailbox", "notice_board", "desk"]
    };
    const types = byJob[agent.job] ?? ["job_station", "desk", "register"];
    let best: { structure: StructureMetadata; point: ActionPoint; score: number } | null = null;
    for (const structure of structures) {
      const jobFit = structure.jobs?.some((job) => job.id === agent.job) ? 35 : 0;
      if (jobFit <= 0 && !structure.actionPoints.some((point) => types.includes(point.type))) continue;
      for (const point of structure.actionPoints) {
        const typeIndex = types.indexOf(point.type);
        if (typeIndex < 0) continue;
        const state = this.objectStates.peek(structure.id, point.id);
        const stockNeed = state?.stock !== undefined && state.capacity !== undefined ? Math.max(0, state.capacity - state.stock) * 2.4 : 0;
        const serviceNeed =
          (state?.unmetDemand ?? 0) * 5 +
          (state?.servicePressure ?? 0) * 0.6 +
          stockNeed +
          Math.max(0, 60 - (state?.cleanliness ?? 86)) * 0.2 +
          (state?.wear ?? 0) * 0.12 +
          (state?.heat ?? 0) * 0.08;
        const typePreference = (types.length - typeIndex) * 8;
        const score = jobFit + typePreference + serviceNeed;
        if (!best || score > best.score) best = { structure, point, score };
      }
    }
    if (!best) return null;
    const point = worldPoint(best.point.position);
    return {
      ...point,
      label: `${best.structure.name}: ${best.point.label}`,
      action: "working",
      structureId: best.structure.id,
      structureName: best.structure.name,
      actionPointId: best.point.id,
      actionPointType: best.point.type,
      intent: {
        kind: "work",
        strategy: strategy === "push_through_sick" ? "push_through_sick" : agent.career.burnout > 72 ? "work_through_burnout" : "earn_income",
        label: strategy === "push_through_sick" ? "Push through sick" : agent.career.burnout > 72 ? "Push through burnout" : "Earn income"
      },
      waypoints: [point],
      routeLength: 1,
      hoursLabel: best.structure.hours?.[0]?.label,
      openNow: true
    };
  }

  private bestSickLeaveTargetForDebug(agent: SimAgent, structures: StructureMetadata[]): AgentTarget | null {
    const homeStructure = structures.find((structure) => structure.name === agent.home) ?? structures.find((structure) => structure.type === "apartment");
    if (!homeStructure) return null;
    const point = ["home_anchor", "mailbox", "desk", "bed"]
      .map((type) => homeStructure.actionPoints.find((candidate) => candidate.type === type))
      .find(Boolean);
    if (!point) return null;
    const position = worldPoint(point.position);
    return {
      ...position,
      label: `${homeStructure.name}: ${point.label}`,
      action: "calling_in_sick",
      structureId: homeStructure.id,
      structureName: homeStructure.name,
      actionPointId: point.id,
      actionPointType: point.type,
      intent: {
        kind: "work",
        strategy: "call_in_sick",
        label: "Call in sick",
        amount: 0,
        paymentSource: "none",
        savingsAllowed: false
      },
      waypoints: [position],
      routeLength: 1,
      hoursLabel: homeStructure.hours?.[0]?.label,
      openNow: true
    };
  }

  private bestFoodTargetForDebug(agent: SimAgent, structures: StructureMetadata[], strategy: string): AgentTarget | null {
    const pointTypes: ActionPoint["type"][] = strategy.includes("quick") ? ["register", "vending_machine", "shelf"] : ["shelf", "register", "vending_machine"];
    let best: { structure: StructureMetadata; point: ActionPoint; score: number } | null = null;
    for (const structure of structures) {
      if (structure.type !== "grocery") continue;
      for (const point of structure.actionPoints) {
        const typeIndex = pointTypes.indexOf(point.type);
        if (typeIndex < 0) continue;
        const state = this.objectStates.peek(structure.id, point.id);
        const stockScore = state?.stock !== undefined ? Math.max(0, state.stock) * 0.8 : 8;
        const score = (pointTypes.length - typeIndex) * 10 + stockScore - (state?.crowdPressure ?? 0) * 0.05;
        if (!best || score > best.score) best = { structure, point, score };
      }
    }
    if (!best) return null;
    const amount = strategy.includes("bulk") ? 10 : strategy.includes("groceries") ? 6 : 3;
    const paymentSource = agent.money >= amount ? "cash" : agent.money + agent.budget.savings >= amount ? "liquid" : "none";
    const point = worldPoint(best.point.position);
    return {
      ...point,
      label: `${best.structure.name}: ${best.point.label}`,
      action: "shopping",
      structureId: best.structure.id,
      structureName: best.structure.name,
      actionPointId: best.point.id,
      actionPointType: best.point.type,
      intent: {
        kind: "food",
        strategy,
        label: strategy.includes("bulk") ? "Stock pantry in bulk" : strategy.includes("groceries") ? "Buy groceries" : "Buy quick meal",
        amount,
        paymentSource,
        savingsAllowed: paymentSource === "liquid"
      },
      waypoints: [point],
      routeLength: 1,
      hoursLabel: best.structure.hours?.[0]?.label,
      openNow: true
    };
  }

  private bestHouseholdSupplyTargetForDebug(agent: SimAgent, structures: StructureMetadata[], strategy: string): AgentTarget | null {
    const pointTypes: ActionPoint["type"][] = ["shelf", "register", "storage"];
    let best: { structure: StructureMetadata; point: ActionPoint; score: number } | null = null;
    for (const structure of structures) {
      if (structure.type !== "grocery") continue;
      for (const point of structure.actionPoints) {
        const typeIndex = pointTypes.indexOf(point.type);
        if (typeIndex < 0) continue;
        const state = this.objectStates.peek(structure.id, point.id);
        const stockScore = state?.stock !== undefined ? Math.max(0, state.stock) * 0.7 : 6;
        const score = (pointTypes.length - typeIndex) * 10 + stockScore - (state?.crowdPressure ?? 0) * 0.05;
        if (!best || score > best.score) best = { structure, point, score };
      }
    }
    if (!best) return null;
    const amount = strategy === "buy_toiletries" ? 4 : strategy === "buy_cleaning_supplies" ? 5 : 8;
    const paymentSource = agent.money >= amount ? "cash" : agent.money + agent.budget.savings >= amount ? "liquid" : "none";
    const position = worldPoint(best.point.position);
    return {
      ...position,
      label: `${best.structure.name}: ${best.point.label}`,
      action: "shopping",
      structureId: best.structure.id,
      structureName: best.structure.name,
      actionPointId: best.point.id,
      actionPointType: best.point.type,
      intent: {
        kind: "home",
        strategy,
        label: strategy === "buy_toiletries" ? "Buy toiletries" : strategy === "buy_cleaning_supplies" ? "Buy cleaning supplies" : "Restock home supplies",
        amount,
        paymentSource,
        savingsAllowed: paymentSource === "liquid"
      },
      waypoints: [position],
      routeLength: 1,
      hoursLabel: best.structure.hours?.[0]?.label,
      openNow: true
    };
  }

  private bestClinicTargetForDebug(agent: SimAgent, structures: StructureMetadata[], strategy: string): AgentTarget | null {
    const pointTypes: ActionPoint["type"][] =
      strategy === "clinic_checkup"
        ? ["desk", "medicine_cabinet", "clinic_bed"]
      : strategy === "urgent_care"
          ? ["medicine_cabinet", "clinic_bed", "desk"]
          : strategy === "seek_unpaid_care"
            ? ["desk", "clinic_bed", "medicine_cabinet"]
            : ["medicine_cabinet", "clinic_bed", "desk"];
    let best: { structure: StructureMetadata; point: ActionPoint; score: number } | null = null;
    for (const structure of structures) {
      if (structure.type !== "clinic") continue;
      for (const point of structure.actionPoints) {
        const typeIndex = pointTypes.indexOf(point.type);
        if (typeIndex < 0) continue;
        const state = this.objectStates.peek(structure.id, point.id);
        const stockScore = state?.stock !== undefined ? Math.max(0, state.stock) * 0.7 : 6;
        const servicePenalty = (state?.crowdPressure ?? 0) * 0.05 + (state?.servicePressure ?? 0) * 0.04;
        const score = (pointTypes.length - typeIndex) * 10 + stockScore - servicePenalty;
        if (!best || score > best.score) best = { structure, point, score };
      }
    }
    if (!best) return null;
    const amount = strategy === "clinic_checkup" ? 3 : strategy === "urgent_care" ? 10 : strategy === "seek_unpaid_care" ? 0 : 6;
    const paymentSource = amount <= 0 ? "none" : agent.money >= amount ? "cash" : agent.money + agent.budget.savings >= amount ? "liquid" : "none";
    const position = worldPoint(best.point.position);
    return {
      ...position,
      label: `${best.structure.name}: ${best.point.label}`,
      action: "healing",
      structureId: best.structure.id,
      structureName: best.structure.name,
      actionPointId: best.point.id,
      actionPointType: best.point.type,
      intent: {
        kind: "health",
        strategy,
        label: strategy === "clinic_checkup" ? "Get checkup" : strategy === "urgent_care" ? "Seek urgent care" : strategy === "seek_unpaid_care" ? "Seek unpaid care" : "Treat symptoms",
        amount,
        paymentSource,
        savingsAllowed: paymentSource === "liquid" || strategy === "urgent_care"
      },
      waypoints: [position],
      routeLength: 1,
      hoursLabel: best.structure.hours?.[0]?.label,
      openNow: true
    };
  }

  private bestAftercareTargetForDebug(agent: SimAgent, structures: StructureMetadata[]): AgentTarget | null {
    const homeStructure = structures.find((structure) => structure.name === agent.home) ?? structures.find((structure) => structure.type === "apartment");
    if (!homeStructure) return null;
    const point = ["fridge", "sink", "home_anchor", "bed"]
      .map((type) => homeStructure.actionPoints.find((candidate) => candidate.type === type))
      .find(Boolean);
    if (!point) return null;
    const position = worldPoint(point.position);
    return {
      ...position,
      label: `${homeStructure.name}: ${point.label}`,
      action: "healing",
      structureId: homeStructure.id,
      structureName: homeStructure.name,
      actionPointId: point.id,
      actionPointType: point.type,
      intent: {
        kind: "health",
        strategy: "take_aftercare_medicine",
        label: agent.medical.aftercare.dosesRemaining > 0 ? "Take aftercare medicine" : "Rest after care",
        amount: 0,
        paymentSource: "none",
        savingsAllowed: false
      },
      waypoints: [position],
      routeLength: 1,
      hoursLabel: homeStructure.hours?.[0]?.label,
      openNow: true
    };
  }

  private bestSleepTargetForDebug(agent: SimAgent, structures: StructureMetadata[]): AgentTarget | null {
    const homeStructure = structures.find((structure) => structure.name === agent.home) ?? structures.find((structure) => structure.type === "apartment");
    if (!homeStructure) return null;
    const point = homeStructure.actionPoints.find((candidate) => candidate.type === "bed") ?? homeStructure.actionPoints.find((candidate) => candidate.type === "home_anchor") ?? homeStructure.actionPoints[0];
    if (!point) return null;
    const position = worldPoint(point.position);
    return {
      ...position,
      label: `${homeStructure.name}: ${point.label}`,
      action: "sleeping",
      structureId: homeStructure.id,
      structureName: homeStructure.name,
      actionPointId: point.id,
      actionPointType: point.type,
      intent: {
        kind: "home",
        strategy: "sleep_recover",
        label: "Recover sleep rhythm"
      },
      waypoints: [position],
      routeLength: 1,
      hoursLabel: homeStructure.hours?.[0]?.label,
      openNow: true
    };
  }

  private bestLeisureTargetForDebug(agent: SimAgent, structures: StructureMetadata[], strategy: string): AgentTarget | null {
    const action: AgentAction = strategy === "follow_curiosity" ? "building" : strategy === "public_watch" ? "socializing" : "resting";
    const preferredTypes: ActionPoint["type"][] =
      action === "building"
        ? ["construction_anchor", "notice_board"]
        : action === "socializing"
          ? ["meeting_spot", "seat"]
          : agent.leisure.hobby === "reading" || agent.leisure.hobby === "games" || agent.leisure.hobby === "crafting"
            ? ["home_anchor", "seat", "break_spot", "meeting_spot"]
            : ["seat", "break_spot", "meeting_spot", "home_anchor"];
    const preferredStructures: StructureMetadata["type"][] =
      action === "building" ? ["empty_lot", "town_hall"] : action === "socializing" ? ["park"] : ["apartment", "park", "workplace"];
    let best: { structure: StructureMetadata; point: ActionPoint; score: number } | null = null;
    for (const structure of structures) {
      const structureFit = preferredStructures.includes(structure.type) ? 24 : 0;
      for (const point of structure.actionPoints) {
        const typeIndex = preferredTypes.indexOf(point.type);
        if (typeIndex < 0) continue;
        const homeFit = structure.name === agent.home ? 10 : 0;
        const score = structureFit + homeFit + (preferredTypes.length - typeIndex) * 7;
        if (!best || score > best.score) best = { structure, point, score };
      }
    }
    if (!best) return null;
    const position = worldPoint(best.point.position);
    return {
      ...position,
      label: `${best.structure.name}: ${best.point.label}`,
      action,
      structureId: best.structure.id,
      structureName: best.structure.name,
      actionPointId: best.point.id,
      actionPointType: best.point.type,
      intent: {
        kind: action === "building" ? "build" : action === "socializing" ? "social" : "rest",
        strategy,
        label: action === "building" ? "Follow curiosity" : action === "socializing" ? "People-watch" : "Take a hobby break"
      },
      waypoints: [position],
      routeLength: 1,
      hoursLabel: best.structure.hours?.[0]?.label,
      openNow: true
    };
  }

  private bestHomeCareTargetForDebug(agent: SimAgent, structures: StructureMetadata[], strategy: string): AgentTarget | null {
    const action: AgentAction = strategy === "wash_hygiene" || strategy === "do_laundry" ? "washing" : "cleaning";
    const pointTypes: ActionPoint["type"][] =
      action === "washing" ? ["sink", "home_anchor", "fridge"] : strategy === "sleep_prep" ? ["bed", "home_anchor", "dining_spot", "sink"] : ["dining_spot", "sink", "home_anchor", "fridge"];
    const homeStructure = structures.find((structure) => structure.name === agent.home) ?? structures.find((structure) => structure.type === "apartment");
    if (!homeStructure) return null;
    const point = pointTypes.map((type) => homeStructure.actionPoints.find((candidate) => candidate.type === type)).find(Boolean);
    if (!point) return null;
    const position = worldPoint(point.position);
    return {
      ...position,
      label: `${homeStructure.name}: ${point.label}`,
      action,
      structureId: homeStructure.id,
      structureName: homeStructure.name,
      actionPointId: point.id,
      actionPointType: point.type,
      intent: {
        kind: "home",
        strategy,
        label:
          strategy === "do_laundry"
            ? "Do laundry"
            : strategy === "deep_clean"
              ? "Deep clean home"
              : strategy === "sleep_prep"
                ? "Prep bed for sleep"
                : strategy === "wash_hygiene"
                  ? "Quick wash"
                  : "Tidy clutter"
      },
      waypoints: [position],
      routeLength: 1,
      hoursLabel: homeStructure.hours?.[0]?.label,
      openNow: true
    };
  }

  update(dt: number, structures: StructureMetadata[], routeResolver?: AgentRouteResolver) {
    this.worldTick += 1;
    this.worldMinutes += dt * SIM_MINUTES_PER_SECOND;
    this.updateWeatherState();
    this.objectStates.maintainDailyState(this.currentDay);
    this.announceTimeChanges();
    const agents = this.agentList();
    for (const agent of agents) {
      if (agent.routine.day !== this.currentDay) this.startNewDay(agent);
      this.updateMoodlets(agent);
      this.updateSocialMoments(agent);
      this.refreshSocialCompass(agent);
      this.refreshAspiration(agent);
      this.updateCommitments(agent);
      this.refreshWantsAndFears(agent);
      this.refreshLifeAdmin(agent);
      this.decisions.updateLifePriority(agent, this.decisionContext(agents));
      if (this.processHospitalStay(agent, dt, structures)) continue;
      if (this.currentPhase === "evening" && (agent.eveningPlan.day !== this.currentDay || agent.eveningPlan.intent === "none")) {
        this.relationships.planEvening(agent, this.relationshipContext());
      }
      if (this.currentPhase === "night" && agent.eveningPlan.day === this.currentDay && agent.eveningPlan.intent !== "none" && !agent.eveningPlan.resolved) {
        this.relationships.markEveningPlanOutcome(agent, "skipped", "night arrived before the plan came together", this.relationshipContext());
      }
      this.updateNeeds(agent, dt);
      this.updateMinorIllness(agent, dt);
      this.updateAftercare(agent, dt);
      if (this.admitIfHealthCrisis(agent, structures, "health collapsed under unmet needs")) continue;
      this.refreshLifeAdmin(agent);
      this.decisions.updateLifePriority(agent, this.decisionContext(agents));
      if (this.shouldReplanForPriority(agent)) this.clearTargetForPriority(agent);
      this.relationships.observeNearbyAgents(agent, agents, dt, this.relationshipContext());
      this.relationships.observeHousemates(agent, agents, this.relationshipContext());
      this.refreshSocialCompass(agent);
      if (!agent.target) this.chooseNextTarget(agent, structures, routeResolver, agents);
      if (agent.target) this.moveAlongRoute(agent, dt, structures, routeResolver, agents);
      this.resolveWantsAndFears(agent);
    }
    this.objectStates.syncLiveOccupancy(agents);
    for (const agent of agents) this.applyPlacePressure(agent, dt);
    this.objectStates.syncLiveOccupancy(agents);
    this.refreshCityPulse(agents);
  }

  summary(): AgentSummary {
    return {
      day: this.currentDay,
      worldTime: this.worldTime,
      phase: this.currentPhase,
      phaseLabel: this.phaseLabel,
      weather: { ...this.latestWeather },
      cityPulse: this.latestCityPulse,
      agents: this.agentList().map((agent) => ({
        ...agent,
        position: { ...agent.position },
        target: agent.target
          ? { ...agent.target, intent: agent.target.intent ? { ...agent.target.intent } : undefined, waypoints: agent.target.waypoints.map((point) => ({ ...point })) }
          : null,
        lifeProfile: { ...agent.lifeProfile, actionBiases: { ...agent.lifeProfile.actionBiases } },
        values: { ...agent.values },
        activeDrive: { ...agent.activeDrive },
        lifePriority: { ...agent.lifePriority },
        activeIntention: {
          ...agent.activeIntention,
          actions: [...agent.activeIntention.actions],
          actionBiases: { ...agent.activeIntention.actionBiases },
          tags: [...agent.activeIntention.tags],
          history: [...agent.activeIntention.history]
        },
        decisionRead: {
          ...agent.decisionRead,
          selectedIntent: agent.decisionRead.selectedIntent ? { ...agent.decisionRead.selectedIntent } : undefined,
          factors: [...agent.decisionRead.factors],
          options: agent.decisionRead.options.map((option) => ({
            ...option,
            intent: option.intent ? { ...option.intent } : undefined
          }))
        },
        aspiration: { ...agent.aspiration, actions: [...agent.aspiration.actions], signals: [...agent.aspiration.signals], history: [...agent.aspiration.history] },
        skills: Object.fromEntries(Object.entries(agent.skills).map(([id, skill]) => [id, { ...skill, recent: [...skill.recent] }])) as AgentSkillSet,
        availableActions: agent.availableActions.map((option) => ({ ...option, intent: option.intent ? { ...option.intent } : undefined, plan: [...option.plan], tags: [...option.tags] })),
        reputation: { ...agent.reputation },
        plan: [...agent.plan],
        dayPlan: [...agent.dayPlan],
        inventory: [...agent.inventory],
        relationships: { ...agent.relationships },
        relationshipDetails: Object.fromEntries(
          Object.entries(agent.relationshipDetails).map(([id, relationship]) => [
            id,
            {
              ...relationship,
              history: [...relationship.history]
            }
          ])
        ),
        placeMemory: Object.fromEntries(
          Object.entries(agent.placeMemory).map(([id, place]) => [
            id,
            {
              ...place,
              tags: [...place.tags]
            }
          ])
        ),
        activityMemory: Object.fromEntries(
          Object.entries(agent.activityMemory).map(([id, activity]) => [
            id,
            activity
              ? {
                  ...activity,
                  tags: [...activity.tags]
                }
              : activity
          ])
        ),
        socialFocus: agent.socialFocus ? { ...agent.socialFocus } : null,
        socialCompass: { ...agent.socialCompass, recent: [...agent.socialCompass.recent] },
        lifeAdmin: { ...agent.lifeAdmin, suggestedActions: [...agent.lifeAdmin.suggestedActions], recent: [...agent.lifeAdmin.recent] },
        eveningPlan: { ...agent.eveningPlan },
        socialMoments: agent.socialMoments.map((moment) => ({ ...moment, tags: [...moment.tags] })),
        medical: { ...agent.medical, minorIllness: { ...agent.medical.minorIllness }, aftercare: { ...agent.medical.aftercare } },
        finances: agent.finances.map((entry) => ({ ...entry })),
        budget: { ...agent.budget },
        career: { ...agent.career, recent: [...agent.career.recent] },
        civic: { ...agent.civic, recent: [...agent.civic.recent] },
        household: { ...agent.household, recent: [...agent.household.recent] },
        outfit: { ...agent.outfit, recent: [...agent.outfit.recent] },
        nutrition: { ...agent.nutrition, recent: [...agent.nutrition.recent] },
        leisure: { ...agent.leisure, recent: [...agent.leisure.recent] },
        sleep: { ...agent.sleep, recent: [...agent.sleep.recent] },
        autonomy: { ...agent.autonomy, recent: [...agent.autonomy.recent] },
        time: { ...agent.time, recent: [...agent.time.recent] },
        rhythm: { ...agent.rhythm, recent: [...agent.rhythm.recent] },
        emotion: { ...agent.emotion, recent: [...agent.emotion.recent] },
        commitments: agent.commitments.map((commitment) => ({ ...commitment, actions: [...commitment.actions] })),
        memories: agent.memories.map((memory) => ({ ...memory })),
        moodlets: agent.moodlets.map((moodlet) => ({ ...moodlet, tags: [...moodlet.tags], actionBiases: { ...moodlet.actionBiases } })),
        wants: agent.wants.map((want) => ({ ...want, actions: [...want.actions], tags: [...want.tags] })),
        personalNotices: agent.personalNotices.map((notice) => ({ ...notice, actions: [...notice.actions], tags: [...notice.tags] })),
        statusEffects: this.statusEffectsFor(agent),
        routine: { ...agent.routine },
        actionProgress: this.actionProgressFor(agent)
      })),
      events: this.events.map((event) => ({ ...event, position: event.position ? { ...event.position } : undefined })),
      civicNotices: this.civicNotices
        .filter((notice) => notice.expiresWorldMinutes > this.worldMinutes)
        .map((notice) => ({ ...notice, tags: [...notice.tags], acknowledgedBy: [...notice.acknowledgedBy] })),
      objectStates: this.objectStates.snapshot()
    };
  }

  private get worldTime() {
    return formatTime(this.worldMinutes);
  }

  private get currentDay() {
    return Math.floor(this.worldMinutes / 1440) + 1;
  }

  private get currentPhase() {
    return phaseForMinutes(this.worldMinutes);
  }

  private get phaseLabel() {
    return PHASE_LABELS[this.currentPhase];
  }

  private sleepScheduleFor(chronotype: AgentSleepChronotype) {
    if (chronotype === "early_bird") return { bedtimeTarget: 21 * 60 + 45, wakeTarget: 6 * 60 };
    if (chronotype === "night_owl") return { bedtimeTarget: 23 * 60 + 45, wakeTarget: 8 * 60 };
    return { bedtimeTarget: 22 * 60 + 30, wakeTarget: 7 * 60 };
  }

  private isInsideSleepWindow(minuteOfDay: number, bedtime: number, wake: number) {
    if (bedtime <= wake) return minuteOfDay >= bedtime && minuteOfDay < wake;
    return minuteOfDay >= bedtime || minuteOfDay < wake;
  }

  private totalBillsDue(agent: SimAgent) {
    return Math.round((agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue) * 100) / 100;
  }

  private updateWeatherState() {
    const previous = this.latestWeather;
    const next = this.weatherFor(this.currentDay, this.worldMinutes);
    this.latestWeather = next;
    if (next.id === this.lastWeatherAlertKey) return;
    this.lastWeatherAlertKey = next.id;
    if (this.agents.size === 0 || next.id === previous.id) return;
    if (next.tone === "good" && previous.tone === "good") return;
    this.logCity(
      `${next.label}: ${next.detail}.`,
      "city",
      next.tone === "bad" ? "bad" : next.tone === "warn" ? "warn" : "neutral",
      next.tone === "bad" ? 7 : 5
    );
  }

  private weatherFor(day: number, worldMinutes: number): WeatherState {
    const wrapped = ((Math.floor(worldMinutes) % 1440) + 1440) % 1440;
    const band = Math.floor(wrapped / 240);
    const phase = phaseForMinutes(worldMinutes);
    const seed = hashText(`genesis-weather:${day}:${band}`);
    const roll = randomFromHash(seed, 1);
    const variant = randomFromHash(seed, 2);
    const drift = Math.round((variant - 0.5) * 8);
    let kind: WeatherKind = "clear";
    if (roll < 0.42) kind = "clear";
    else if (roll < 0.64) kind = "cloudy";
    else if (roll < 0.81) kind = "rain";
    else if (roll < 0.92) kind = "heat";
    else kind = "cold";

    if (phase === "night" && kind === "heat" && variant < 0.55) kind = "cloudy";
    if (phase === "workday" && kind === "cold" && variant > 0.55) kind = "cloudy";

    const phaseTemperature = phase === "night" ? -7 : phase === "morning" ? -2 : phase === "workday" ? 5 : 1;
    const base = {
      clear: {
        label: "Clear Skies",
        tone: "good",
        temperature: 72,
        comfortDelta: 0.012,
        movementMultiplier: 1,
        outdoorStressDelta: -0.006,
        socialOutdoorModifier: 5,
        clinicRiskModifier: 0,
        visibility: 1,
        skyColor: "#b8ddec",
        fogColor: "#b8ddec",
        fogDensity: 0.008,
        sunIntensity: 3.35,
        ambientIntensity: 2.15,
        detail: "the streets feel open and easy to cross"
      },
      cloudy: {
        label: "Cloud Cover",
        tone: "neutral",
        temperature: 66,
        comfortDelta: -0.004,
        movementMultiplier: 0.98,
        outdoorStressDelta: 0.002,
        socialOutdoorModifier: 1,
        clinicRiskModifier: 1,
        visibility: 0.92,
        skyColor: "#aebdca",
        fogColor: "#aebdca",
        fogDensity: 0.01,
        sunIntensity: 2.35,
        ambientIntensity: 2,
        detail: "the district is muted but still comfortable"
      },
      rain: {
        label: "Soft Rain",
        tone: "warn",
        temperature: 58,
        comfortDelta: -0.05,
        movementMultiplier: 0.9,
        outdoorStressDelta: 0.028,
        socialOutdoorModifier: -8,
        clinicRiskModifier: 4,
        visibility: 0.68,
        skyColor: "#7f95a4",
        fogColor: "#7f95a4",
        fogDensity: 0.017,
        sunIntensity: 1.25,
        ambientIntensity: 1.75,
        detail: "outdoor errands take more patience"
      },
      heat: {
        label: "Heat Haze",
        tone: "bad",
        temperature: 91,
        comfortDelta: -0.064,
        movementMultiplier: 0.92,
        outdoorStressDelta: 0.042,
        socialOutdoorModifier: -6,
        clinicRiskModifier: 6,
        visibility: 0.82,
        skyColor: "#c9d9e1",
        fogColor: "#c4c9b3",
        fogDensity: 0.011,
        sunIntensity: 3.75,
        ambientIntensity: 2.05,
        detail: "outside work drains people faster"
      },
      cold: {
        label: "Cold Snap",
        tone: "bad",
        temperature: 36,
        comfortDelta: -0.056,
        movementMultiplier: 0.91,
        outdoorStressDelta: 0.036,
        socialOutdoorModifier: -7,
        clinicRiskModifier: 5,
        visibility: 0.78,
        skyColor: "#b6c7d7",
        fogColor: "#cfd8df",
        fogDensity: 0.014,
        sunIntensity: 1.95,
        ambientIntensity: 1.9,
        detail: "people look for warmth and shorter routes"
      }
    } satisfies Record<WeatherKind, Omit<WeatherState, "id" | "kind">>;
    const selected = base[kind];
    return {
      id: `day-${day}-band-${band}-${kind}`,
      kind,
      ...selected,
      temperature: Math.round(selected.temperature + phaseTemperature + drift)
    };
  }

  private agentList() {
    return [...this.agents.values()];
  }

  private nextSequence() {
    const sequence = this.nextSequenceNumber;
    this.nextSequenceNumber += 1;
    return sequence;
  }

  private memoryContext(): MemoryWriteContext {
    return {
      worldMinutes: this.worldMinutes,
      nextSequence: () => this.nextSequence()
    };
  }

  private addMemory(agent: SimAgent, kind: AgentMemoryKind, text: string, importance: number, tags: string[]) {
    this.memory.add(agent, kind, text, importance, tags, this.memoryContext());
  }

  private addMoodlet(agent: SimAgent, input: AgentMoodletInput) {
    const intensity = Math.round(clamp(input.intensity, 1, 10) * 10) / 10;
    const expiresWorldMinutes = this.worldMinutes + Math.max(5, input.durationMinutes);
    const existing = agent.moodlets.find((moodlet) => moodlet.id === input.id);
    if (existing) {
      existing.label = input.label;
      existing.detail = input.detail;
      existing.tone = input.tone;
      existing.intensity = Math.max(existing.intensity, intensity);
      existing.expiresWorldMinutes = Math.max(existing.expiresWorldMinutes, expiresWorldMinutes);
      existing.tags = [...new Set([...existing.tags, ...input.tags])].slice(-8);
      existing.actionBiases = { ...existing.actionBiases, ...(input.actionBiases ?? {}) };
    } else {
      agent.moodlets.unshift({
        id: input.id,
        label: input.label,
        detail: input.detail,
        tone: input.tone,
        intensity,
        startedWorldTime: this.worldTime,
        startedWorldMinutes: this.worldMinutes,
        expiresWorldMinutes,
        tags: input.tags.slice(0, 8),
        actionBiases: { ...(input.actionBiases ?? {}) }
      });
    }
    if (input.moodDelta) agent.mood = clamp(agent.mood + input.moodDelta);
    if (input.stressDelta) agent.stress = clamp(agent.stress + input.stressDelta);
    const severity: Record<AgentMoodletTone, number> = { bad: 4, warn: 3, good: 2, neutral: 1 };
    agent.moodlets.sort((a, b) => severity[b.tone] - severity[a.tone] || b.intensity - a.intensity || b.expiresWorldMinutes - a.expiresWorldMinutes);
    agent.moodlets.splice(8);
  }

  private updateMoodlets(agent: SimAgent) {
    const before = agent.moodlets.length;
    agent.moodlets = agent.moodlets.filter((moodlet) => moodlet.expiresWorldMinutes > this.worldMinutes);
    if (before !== agent.moodlets.length) {
      const severity: Record<AgentMoodletTone, number> = { bad: 4, warn: 3, good: 2, neutral: 1 };
      agent.moodlets.sort((a, b) => severity[b.tone] - severity[a.tone] || b.intensity - a.intensity || b.expiresWorldMinutes - a.expiresWorldMinutes);
    }
  }

  private recordSocialMoment(agent: SimAgent, input: AgentSocialMomentInput) {
    const moment: AgentSocialMoment = {
      ...input,
      id: `social-${agent.id}-${this.nextSequence()}`,
      worldTime: this.worldTime,
      worldMinutes: this.worldMinutes,
      expiresWorldMinutes: this.worldMinutes + Math.max(30, input.durationMinutes ?? 300),
      tags: input.tags.slice(0, 8)
    };
    agent.socialMoments.unshift(moment);
    const severity: Record<AgentSocialMoment["tone"], number> = { bad: 4, warn: 3, good: 2, neutral: 1 };
    agent.socialMoments.sort((a, b) => severity[b.tone] - severity[a.tone] || b.worldMinutes - a.worldMinutes);
    agent.socialMoments.splice(6);
    this.refreshSocialCompass(agent);
    return moment;
  }

  private updateSocialMoments(agent: SimAgent) {
    agent.socialMoments = agent.socialMoments.filter((moment) => moment.expiresWorldMinutes > this.worldMinutes);
  }

  private refreshSocialCompass(agent: SimAgent) {
    const previous = agent.socialCompass;
    const relationships = Object.values(agent.relationshipDetails);
    const byAnchor = [...relationships].sort((a, b) => b.score + b.trust * 0.35 + b.familiarity * 0.12 - (a.score + a.trust * 0.35 + a.familiarity * 0.12));
    const byConcern = [...relationships].sort(
      (a, b) =>
        b.tension + Math.max(0, -b.score) * 0.45 + Math.max(0, b.supportBalance) * 2.5 -
        (a.tension + Math.max(0, -a.score) * 0.45 + Math.max(0, a.supportBalance) * 2.5)
    );
    const anchor = byAnchor.find((relationship) => relationship.score > 8 || relationship.trust > 54) ?? byAnchor[0];
    const concern = byConcern.find((relationship) => relationship.tension > 42 || relationship.score < -8 || relationship.supportBalance > 2);
    const friendCount = relationships.filter((relationship) => relationship.attitude === "friend" || relationship.score > 18).length;
    const rivalCount = relationships.filter((relationship) => relationship.attitude === "rival" || relationship.score < -22).length;
    const supportOwed = Math.round(relationships.reduce((sum, relationship) => sum + Math.max(0, relationship.supportBalance), 0) * 10) / 10;
    const supportGiven = Math.round(relationships.reduce((sum, relationship) => sum + Math.max(0, -relationship.supportBalance), 0) * 10) / 10;
    const trust =
      relationships.length > 0
        ? Math.round(clamp(relationships.reduce((sum, relationship) => sum + relationship.trust, 0) / relationships.length))
        : Math.round(clamp(previous?.trust ?? 34));
    const tension =
      relationships.length > 0
        ? Math.round(clamp(Math.max(...relationships.map((relationship) => relationship.tension))))
        : Math.round(clamp((previous?.tension ?? 16) * 0.98));
    const belonging = Math.round(
      clamp(
        agent.social * 0.34 +
          Math.max(0, 100 - agent.emotion.loneliness) * 0.28 +
          friendCount * 10 +
          (anchor ? anchor.trust * 0.16 : 0) -
          rivalCount * 7 -
          supportOwed * 2 -
          tension * 0.1 +
          (agent.routine.bondsToday > 0 ? 10 : 0) -
          (agent.routine.conflictsToday > 0 ? 12 : 0)
      )
    );

    let stance: AgentSocialCompassStance = "open";
    let detail = "The social field feels manageable.";
    if (relationships.length === 0) {
      stance = "newcomer";
      detail = "No one in town knows them yet.";
    } else if (supportOwed >= 5 || tension >= 78 || agent.routine.conflictsToday > 0) {
      stance = "strained";
      detail = supportOwed >= 5 && concern ? `${supportOwed} support still owed, led by ${concern.agentName}` : concern ? `${concern.agentName} is carrying tension` : "Social pressure is running hot.";
    } else if (concern && (concern.attitude === "rival" || tension >= 58 || concern.score < -12)) {
      stance = "guarded";
      detail = `${concern.agentName} feels socially risky right now.`;
    } else if (anchor && (anchor.attitude === "friend" || anchor.score > 18 || anchor.trust >= 64)) {
      stance = "anchored";
      detail = `${anchor.agentName} feels like a reliable social anchor.`;
    } else if (supportGiven >= 4) {
      stance = "generous";
      detail = `They have given ${supportGiven} support more than they owe.`;
    } else if (agent.emotion.loneliness > 72 || agent.social < 42) {
      stance = "seeking";
      detail = anchor ? `${anchor.agentName} is the easiest person to approach.` : "They want a familiar face.";
    }

    const recent = previous?.recent ? [...previous.recent] : [];
    const anchorChanged = previous?.anchorAgentId !== anchor?.agentId;
    const concernChanged = previous?.concernAgentId !== concern?.agentId;
    if (!previous || previous.stance !== stance || anchorChanged || concernChanged) {
      recent.unshift(`${this.worldTime} ${stance.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}: ${detail}`);
    }
    recent.splice(4);

    agent.socialCompass = {
      stance,
      detail,
      belonging,
      trust,
      tension,
      supportOwed,
      supportGiven,
      relationshipCount: relationships.length,
      friendCount,
      rivalCount,
      anchorAgentId: anchor?.agentId,
      anchorName: anchor?.agentName,
      concernAgentId: concern?.agentId,
      concernName: concern?.agentName,
      lastUpdatedWorldTime: this.worldTime,
      recent
    };
  }

  private refreshLifeAdmin(agent: SimAgent) {
    const previous = agent.lifeAdmin;
    const activeNotices = agent.personalNotices.filter((notice) => notice.status === "unread" || notice.status === "read");
    const leadNotice = this.leadPersonalNotice(agent);
    const unreadNotices = activeNotices.filter((notice) => notice.status === "unread").length;
    const dueNotices = activeNotices.filter((notice) => notice.dueDay <= this.currentDay).length;
    const urgentCommitments = agent.commitments.filter((commitment) => commitment.status === "missed" || commitment.status === "due");
    const missedCommitments = urgentCommitments.filter((commitment) => commitment.status === "missed").length;
    const dueCommitmentPressure = urgentCommitments.reduce(
      (sum, commitment) => sum + commitment.pressure * (commitment.status === "missed" ? 0.8 : 0.56) + (commitment.status === "missed" ? 18 : 7),
      0
    );
    const billsDue = this.totalBillsDue(agent);
    const liquidFunds = agent.money + agent.budget.savings;
    const cashGap = Math.max(0, billsDue - liquidFunds);
    const aftercare = agent.medical.aftercare;
    const aftercareDue = aftercare.active && (this.worldMinutes >= aftercare.followUpDueWorldMinutes || aftercare.dosesRemaining > 0 || aftercare.restMinutesRemaining > 0);
    const healthFollowup = clamp(
      (aftercare.active ? 28 + aftercare.dosesRemaining * 7 + aftercare.restMinutesRemaining * 0.16 + (aftercareDue ? 12 : 0) : 0) +
        (agent.medical.minorIllness.active ? 20 + agent.medical.minorIllness.severity * 0.42 : 0) +
        Math.max(0, 68 - agent.health) * 0.34 +
        (leadNotice?.kind === "health" ? leadNotice.importance * 4 : 0) -
        (agent.routine.medicalVisitToday ? 18 : 0)
    );
    const supplies = clamp(
      Math.max(0, 2 - agent.household.pantry) * 12 +
        Math.max(0, 2 - agent.household.toiletries) * 13 +
        Math.max(0, 2 - agent.household.cleaningSupplies) * 12 +
        (agent.household.pantry <= 0 && agent.hunger > 52 ? 14 : 0) +
        (agent.hygiene < 44 && agent.household.toiletries <= 1 ? 8 : 0) +
        (leadNotice?.kind === "home" ? leadNotice.importance * 2.2 : 0)
    );
    const homeCare = clamp(
      Math.max(0, agent.household.clutter - 48) * 0.72 +
        Math.max(0, agent.household.laundry - 48) * 0.68 +
        Math.max(0, 62 - agent.household.sleepQuality) * 0.42 +
        Math.max(0, 54 - agent.household.homeComfort) * 0.22 -
        agent.household.choresDoneToday * 12
    );
    const paperwork = clamp(
      unreadNotices * 16 +
        Math.max(0, activeNotices.length - unreadNotices) * 8 +
        dueNotices * 12 +
        dueCommitmentPressure * 0.34 +
        (agent.routine.checkedMailToday ? -12 : 8) +
        (leadNotice ? leadNotice.importance * 3.2 : 0)
    );
    const civic = clamp(
      dueCommitmentPressure * 0.24 +
        (billsDue > 0 ? 18 + billsDue * 1.15 : 0) +
        (agent.budget.overdueBillDays > 0 ? 14 + agent.budget.overdueBillDays * 8 : 0) +
        (agent.budget.creditScore < 560 ? (560 - agent.budget.creditScore) * 0.1 : 0) +
        (leadNotice?.kind === "bill" || leadNotice?.kind === "work" || leadNotice?.kind === "build" ? leadNotice.importance * 3.4 : 0)
    );
    const money = clamp(
      (billsDue > 0 ? 22 + billsDue * 1.32 + cashGap * 1.8 : 0) +
        Math.max(0, 14 - agent.money) * 1.6 +
        Math.max(0, agent.budget.spentToday - agent.budget.dailySpendLimit) * 1.7 +
        Math.max(0, agent.budget.savingsGoal - agent.budget.savings) * 0.08 +
        (agent.budget.lateFeesToday > 0 ? 16 : 0)
    );

    const scores: Record<AgentLifeAdminCategory, number> = {
      paperwork,
      supplies,
      homeCare,
      healthFollowup,
      civic,
      money
    };
    const sortedScores = (Object.entries(scores) as Array<[AgentLifeAdminCategory, number]>).sort((a, b) => b[1] - a[1]);
    const dominantCategory = sortedScores[0]?.[0] ?? "paperwork";
    const topScore = sortedScores[0]?.[1] ?? 0;
    const totalScore = Object.values(scores).reduce((sum, score) => sum + score, 0);
    const load = Math.round(clamp(topScore * 0.56 + totalScore * 0.12));
    const urgency = Math.round(
      clamp(topScore + dueNotices * 4 + missedCommitments * 8 + cashGap * 0.35 + (aftercareDue ? 8 : 0) + (agent.routine.checkedMailToday ? -3 : 0))
    );
    const parts = [
      unreadNotices > 0 ? `${unreadNotices} unread notice${unreadNotices === 1 ? "" : "s"}` : "",
      urgentCommitments.length > 0 ? `${urgentCommitments.length} commitment${urgentCommitments.length === 1 ? "" : "s"} hot` : "",
      billsDue > 0 ? `${billsDue} credits due` : "",
      supplies >= 42 ? `supplies ${agent.household.pantry}/${agent.household.toiletries}/${agent.household.cleaningSupplies}` : "",
      homeCare >= 42 ? `home load ${Math.round(Math.max(agent.household.clutter, agent.household.laundry))}` : "",
      healthFollowup >= 42 ? "care follow-up active" : ""
    ].filter(Boolean);

    const leadCommitment = urgentCommitments.sort((a, b) => b.pressure - a.pressure)[0];
    let nextTask = "Keep the day clear.";
    let suggestedActions: AgentAction[] = ["checking_mail", "budgeting"];
    switch (dominantCategory) {
      case "healthFollowup":
        nextTask = aftercare.active ? "Follow the care plan before it slips." : "Get symptoms checked before they become a crisis.";
        suggestedActions = ["healing", "resting", "washing", "checking_mail"];
        break;
      case "supplies":
        nextTask = agent.household.pantry <= 1 ? "Restock food and essentials." : "Restock household supplies.";
        suggestedActions = ["shopping", "working", "eating", "budgeting"];
        break;
      case "homeCare":
        nextTask = agent.household.laundry >= agent.household.clutter ? "Handle laundry and reset the room." : "Clean up the apartment.";
        suggestedActions = ["cleaning", "washing", "resting", "shopping"];
        break;
      case "civic":
        nextTask = leadCommitment ? `Handle ${leadCommitment.label.toLowerCase()}.` : "Clear civic desk obligations.";
        suggestedActions = ["checking_mail", "paying_rent", "budgeting", "working"];
        break;
      case "money":
        nextTask = billsDue > 0 ? "Make a payment plan and clear bills." : "Review money before spending more.";
        suggestedActions = ["budgeting", "paying_rent", "working", "checking_mail"];
        break;
      case "paperwork":
      default:
        nextTask = leadNotice ? (leadNotice.status === "unread" ? `Read ${leadNotice.label.toLowerCase()}.` : `Handle ${leadNotice.label.toLowerCase()}.`) : "Check mail and organize the day.";
        suggestedActions = leadNotice ? ["checking_mail", ...leadNotice.actions] : ["checking_mail", "budgeting", "resting"];
        break;
    }

    const uniqueActions = [...new Set(suggestedActions)].slice(0, 4);
    const detail = parts.slice(0, 3).join(" / ") || "daily errands are manageable";
    const recent = previous?.recent ? [...previous.recent] : [];
    const taskChanged = previous?.dominantCategory !== dominantCategory || previous?.nextTask !== nextTask;
    const pressureJump = !previous || urgency - previous.urgency >= 14 || load - previous.load >= 14;
    if ((taskChanged || pressureJump) && load >= 24) {
      const label: Record<AgentLifeAdminCategory, string> = {
        paperwork: "Paperwork",
        supplies: "Supplies",
        homeCare: "Home care",
        healthFollowup: "Health follow-up",
        civic: "Civic",
        money: "Money"
      };
      recent.unshift(`${this.worldTime} ${label[dominantCategory]}: ${nextTask}`);
    }
    if (recent.length === 0) recent.push("No errands are pressing yet.");
    recent.splice(4);

    agent.lifeAdmin = {
      load,
      urgency,
      paperwork: Math.round(paperwork),
      supplies: Math.round(supplies),
      homeCare: Math.round(homeCare),
      healthFollowup: Math.round(healthFollowup),
      civic: Math.round(civic),
      money: Math.round(money),
      dominantCategory,
      nextTask,
      detail,
      suggestedActions: uniqueActions,
      lastUpdatedWorldTime: this.worldTime,
      recent
    };
  }

  private leadPersonalNotice(agent: SimAgent) {
    return agent.personalNotices
      .filter((notice) => notice.status === "unread" || notice.status === "read")
      .sort((a, b) => {
        const statusWeight = (notice: AgentPersonalNotice) => (notice.status === "unread" ? 8 : 0);
        const deadlineWeight = (notice: AgentPersonalNotice) => Math.max(0, 4 - (notice.dueDay - this.currentDay)) * 3;
        return b.importance + statusWeight(b) + deadlineWeight(b) - (a.importance + statusWeight(a) + deadlineWeight(a));
      })[0];
  }

  private reconcilePersonalNotices(agent: SimAgent) {
    let changed = false;
    for (const notice of agent.personalNotices) {
      if (notice.status !== "unread" && notice.status !== "read") continue;
      if (this.isPersonalNoticeHandled(agent, notice)) {
        notice.status = "handled";
        changed = true;
        this.addMoodlet(agent, {
          id: `notice-handled-${notice.kind}`,
          label: "Notice Handled",
          detail: notice.label,
          tone: "good",
          intensity: Math.min(6, 2 + notice.importance * 0.45),
          durationMinutes: 160,
          tags: ["mail", "notice", ...notice.tags].slice(0, 8),
          actionBiases: { resting: 2, socializing: notice.kind === "social" ? 4 : 0 },
          moodDelta: 1,
          stressDelta: notice.tone === "bad" || notice.tone === "warn" ? -3 : -1
        });
        this.addMemory(agent, "event", `Handled personal notice: ${notice.label}. ${notice.detail}`, Math.min(8, notice.importance), [
          "mail",
          "notice",
          "handled",
          ...notice.tags
        ]);
      } else if (this.currentDay > notice.dueDay) {
        notice.status = "expired";
        changed = true;
        agent.stress = clamp(agent.stress + Math.min(8, 1 + notice.importance * 0.7));
        agent.mood = clamp(agent.mood - Math.min(5, notice.importance * 0.45));
        if (notice.kind === "work") this.relationships.adjustReputation(agent, { reliability: -2, ambition: -1 });
        if (notice.kind === "social") this.relationships.adjustReputation(agent, { warmth: -1 });
        if (notice.kind === "bill") this.relationships.adjustReputation(agent, { reliability: -1, trouble: 1 });
        this.addMoodlet(agent, {
          id: `notice-expired-${notice.kind}`,
          label: "Mail Ignored",
          detail: notice.label,
          tone: notice.tone === "good" ? "warn" : notice.tone,
          intensity: Math.min(7, 3 + notice.importance * 0.45),
          durationMinutes: 240,
          tags: ["mail", "notice", "missed", ...notice.tags].slice(0, 8),
          actionBiases: { checking_mail: 8, budgeting: notice.kind === "bill" ? 8 : 0, resting: 2 }
        });
        this.addMemory(agent, "event", `Ignored personal notice until it expired: ${notice.label}.`, Math.min(8, notice.importance), [
          "mail",
          "notice",
          "missed",
          ...notice.tags
        ]);
        this.log(agent, `${agent.name} let a personal notice expire: ${notice.label}.`, "routine", notice.tone === "bad" ? "bad" : "warn", 6);
      }
    }

    if (changed || agent.personalNotices.length > 8) {
      const statusRank: Record<AgentPersonalNoticeStatus, number> = { unread: 0, read: 1, handled: 2, expired: 3 };
      agent.personalNotices.sort((a, b) => statusRank[a.status] - statusRank[b.status] || b.importance - a.importance || b.createdDay - a.createdDay);
      agent.personalNotices.splice(8);
    }
  }

  private isPersonalNoticeHandled(agent: SimAgent, notice: AgentPersonalNotice) {
    switch (notice.kind) {
      case "bill":
        return this.totalBillsDue(agent) <= 0 || agent.budget.hardshipDeferrals > 0 || agent.routine.paidRentToday;
      case "health":
        return agent.routine.medicalVisitToday || (!agent.medical.minorIllness.active && !agent.medical.aftercare.active && agent.health >= 72);
      case "work":
        return agent.routine.workedToday || agent.routine.sickLeaveToday;
      case "social":
        return agent.routine.socializedToday || agent.routine.bondsToday > 0 || agent.routine.deescalationsToday > 0;
      case "build":
        return agent.aspiration.dailyProgress > 0 || agent.currentAction === "building";
      case "home":
        return (
          agent.household.choresDoneToday > 0 ||
          agent.routine.washedToday ||
          (agent.household.clutter < 54 && agent.household.laundry < 54 && agent.household.toiletries > 0 && agent.household.cleaningSupplies > 0)
        );
      default:
        return notice.actions.some((action) => agent.currentAction === action && agent.actionProgress >= 0.75);
    }
  }

  private generateDailyPersonalNotices(agent: SimAgent) {
    this.reconcilePersonalNotices(agent);
    const activeKinds = new Set(agent.personalNotices.filter((notice) => notice.status === "unread" || notice.status === "read").map((notice) => notice.kind));
    const candidates: Array<Omit<AgentPersonalNotice, "id" | "createdDay" | "createdWorldTime" | "status">> = [];
    const push = (
      kind: AgentPersonalNoticeKind,
      label: string,
      detail: string,
      tone: AgentMoodletTone,
      actions: AgentAction[],
      importance: number,
      dueOffset: number,
      source: string,
      tags: string[]
    ) => {
      if (activeKinds.has(kind)) return;
      candidates.push({
        kind,
        label,
        detail,
        tone,
        actions,
        dueDay: this.currentDay + Math.max(0, dueOffset),
        importance: Math.round(clamp(importance, 1, 10)),
        source,
        tags: [...new Set(tags)].slice(0, 8)
      });
    };

    const billsDue = this.totalBillsDue(agent);
    const liquidFunds = agent.money + agent.budget.savings;
    if (billsDue > 0) {
      push(
        "bill",
        agent.budget.overdueBillDays > 0 ? "Overdue Account Notice" : "Civic Account Notice",
        `${billsDue} credits due; ${Math.round(liquidFunds)} liquid credits available`,
        billsDue > liquidFunds || agent.budget.overdueBillDays > 0 ? "bad" : "warn",
        ["checking_mail", "paying_rent", "budgeting", "working"],
        6 + billsDue * 0.18 + agent.budget.overdueBillDays,
        agent.budget.overdueBillDays > 0 ? 0 : 1,
        "town hall",
        ["money", "bill", "civic"]
      );
    }

    if (agent.medical.aftercare.active || agent.medical.minorIllness.active || agent.health < 62) {
      push(
        "health",
        agent.medical.aftercare.active ? "Clinic Follow-Up" : agent.medical.minorIllness.active ? "Symptom Check" : "Health Check Reminder",
        agent.medical.aftercare.active
          ? agent.medical.aftercare.detail ?? "aftercare still needs attention"
          : agent.medical.minorIllness.active
            ? `${agent.medical.minorIllness.label ?? "symptoms"} should be checked before it spirals`
            : `health is ${Math.round(agent.health)}`,
        agent.health < 46 || agent.medical.minorIllness.severity >= 54 ? "bad" : "warn",
        ["checking_mail", "healing", "resting", "washing"],
        5 + Math.max(0, 70 - agent.health) * 0.08 + (agent.medical.aftercare.active ? 2 : 0),
        agent.health < 50 ? 0 : 1,
        "clinic desk",
        ["health", "clinic", "care"]
      );
    }

    if ((!agent.routine.workedToday && agent.money < 18) || agent.career.performance < 48 || agent.career.burnout > 72) {
      push(
        "work",
        agent.career.burnout > 72 ? "Shift Strain Notice" : "Work Board Note",
        agent.career.burnout > 72
          ? `burnout is ${agent.career.burnout}; plan work or rest deliberately`
          : `${agent.career.title} income would help stabilize the day`,
        agent.money < 8 || agent.career.performance < 42 ? "warn" : "neutral",
        ["checking_mail", "working", "calling_in_sick", "resting"],
        4 + Math.max(0, 22 - agent.money) * 0.18 + Math.max(0, agent.career.burnout - 64) * 0.06,
        1,
        "work board",
        ["work", "career", "money"]
      );
    }

    if (agent.social < 42 || (this.currentPhase === "morning" && agent.dna.sociability > 64 && !agent.routine.socializedToday)) {
      push(
        "social",
        "Park Meetup Flyer",
        agent.socialFocus?.intent === "seek" ? `${agent.socialFocus.agentName} may be around later` : "people are gathering at the park tonight",
        agent.social < 32 ? "warn" : "neutral",
        ["checking_mail", "socializing", "resting"],
        3 + Math.max(0, 62 - agent.social) * 0.08 + agent.dna.sociability * 0.025,
        1,
        "neighborhood board",
        ["social", "relationship", "park"]
      );
    }

    const homeLoad = Math.max(agent.household.clutter, agent.household.laundry);
    const lowSupplies = agent.household.toiletries <= 1 || agent.household.cleaningSupplies <= 1;
    if (homeLoad > 66 || agent.household.sleepQuality < 48 || lowSupplies) {
      push(
        "home",
        lowSupplies ? "Home Supply Reminder" : "Apartment Upkeep Note",
        lowSupplies
          ? `toiletries ${agent.household.toiletries}/${agent.household.supplyCapacity}, cleaning ${agent.household.cleaningSupplies}/${agent.household.supplyCapacity}`
          : `clutter ${Math.round(agent.household.clutter)}, laundry ${Math.round(agent.household.laundry)}, sleep quality ${agent.household.sleepQuality}`,
        homeLoad > 78 || agent.household.sleepQuality < 38 || agent.household.toiletries <= 0 || agent.household.cleaningSupplies <= 0 ? "warn" : "neutral",
        ["checking_mail", "shopping", "cleaning", "washing", "sleeping"],
        3 +
          Math.max(0, homeLoad - 58) * 0.09 +
          Math.max(0, 58 - agent.household.sleepQuality) * 0.08 +
          Math.max(0, 2 - agent.household.toiletries) * 1.8 +
          Math.max(0, 2 - agent.household.cleaningSupplies) * 1.6,
        2,
        "apartment board",
        ["home", "chores", "comfort", "supplies"]
      );
    }

    if (agent.aspiration.id === "building" && agent.aspiration.dailyProgress <= 0 && this.currentDay % 2 === 0) {
      push(
        "build",
        "Lot Opportunity Notice",
        `${agent.aspiration.label}: ${agent.aspiration.milestone}`,
        agent.money + agent.budget.savings > billsDue + 18 ? "good" : "neutral",
        ["checking_mail", "building", "working"],
        3 + agent.aspiration.pressure * 0.05 + agent.dna.risk * 0.025,
        2,
        "buildable lot board",
        ["build", "future", "aspiration"]
      );
    }

    candidates.sort((a, b) => b.importance - a.importance || a.dueDay - b.dueDay);
    const openCount = agent.personalNotices.filter((notice) => notice.status === "unread" || notice.status === "read").length;
    const availableSlots = Math.max(0, 3 - openCount);
    for (const candidate of candidates.slice(0, availableSlots || 0)) {
      const sequence = this.nextSequence();
      agent.personalNotices.unshift({
        ...candidate,
        id: `${agent.id}-notice-${sequence.toString().padStart(6, "0")}`,
        createdDay: this.currentDay,
        createdWorldTime: this.worldTime,
        status: "unread"
      });
      this.addMemory(agent, "observation", `Personal mail arrived: ${candidate.label}. ${candidate.detail}`, Math.min(7, candidate.importance), [
        "mail",
        "notice",
        ...candidate.tags
      ]);
    }
    if (candidates.length > 0) {
      const unread = agent.personalNotices.filter((notice) => notice.status === "unread").length;
      if (unread > 0) this.log(agent, `${agent.name} has ${unread} unread personal notice${unread === 1 ? "" : "s"}.`, "routine", "neutral", 4);
    }
    const statusRank: Record<AgentPersonalNoticeStatus, number> = { unread: 0, read: 1, handled: 2, expired: 3 };
    agent.personalNotices.sort((a, b) => statusRank[a.status] - statusRank[b.status] || b.importance - a.importance || a.dueDay - b.dueDay);
    agent.personalNotices.splice(8);
  }

  private refreshWantsAndFears(agent: SimAgent) {
    this.reconcilePersonalNotices(agent);
    for (const want of agent.wants) {
      if (want.status === "active" && want.expiresWorldMinutes <= this.worldMinutes) {
        want.status = "expired";
        want.progress = 0;
        want.lastUpdateWorldTime = this.worldTime;
        want.expiresWorldMinutes = this.worldMinutes + 45;
      }
    }

    agent.wants = agent.wants.filter((want) => want.status === "active" || want.expiresWorldMinutes > this.worldMinutes);

    for (const want of agent.wants) {
      if (want.status !== "active") continue;
      want.progress = this.wantProgress(agent, want);
      if (this.isWantFulfilled(agent, want)) {
        want.status = "fulfilled";
        want.progress = 100;
        want.lastUpdateWorldTime = this.worldTime;
        want.expiresWorldMinutes = this.worldMinutes + 90;
      }
    }

    const existingIds = new Set(agent.wants.map((want) => want.id));
    const candidates = this.wantCandidatesFor(agent)
      .filter((want) => !existingIds.has(want.id) && !this.isWantFulfilled(agent, want))
      .sort((a, b) => b.intensity - a.intensity);

    for (const candidate of candidates) {
      const activeWants = agent.wants.filter((want) => want.status === "active");
      const candidateWeight = candidate.intensity + (candidate.kind === "fear" ? 16 : 0);
      if (activeWants.length >= 4) {
        const weakest = activeWants
          .map((want) => ({ want, weight: want.intensity + (want.kind === "fear" ? 16 : 0) }))
          .sort((a, b) => a.weight - b.weight)[0];
        if (!weakest || candidateWeight <= weakest.weight + 4) continue;
        const index = agent.wants.findIndex((want) => want.id === weakest.want.id);
        if (index >= 0) agent.wants.splice(index, 1);
      }

      agent.wants.push({
        ...candidate,
        status: "active",
        progress: this.wantProgress(agent, candidate),
        createdWorldTime: this.worldTime,
        createdWorldMinutes: this.worldMinutes,
        expiresWorldMinutes: this.worldMinutes + (candidate.kind === "fear" ? 360 : 240)
      });
    }

    agent.wants.sort((a, b) => {
      const statusRank: Record<AgentWantStatus, number> = { active: 0, fulfilled: 1, expired: 2 };
      const kindRank: Record<AgentWantKind, number> = { fear: 0, want: 1 };
      return statusRank[a.status] - statusRank[b.status] || kindRank[a.kind] - kindRank[b.kind] || b.intensity - a.intensity;
    });
    agent.wants.splice(6);
  }

  private wantCandidatesFor(agent: SimAgent): Array<Omit<AgentWant, "createdWorldTime" | "createdWorldMinutes" | "expiresWorldMinutes" | "status" | "progress">> {
    const candidates: Array<Omit<AgentWant, "createdWorldTime" | "createdWorldMinutes" | "expiresWorldMinutes" | "status" | "progress">> = [];
    const push = (
      id: string,
      kind: AgentWantKind,
      label: string,
      detail: string,
      actions: AgentAction[],
      intensity: number,
      tone: AgentMoodletTone,
      tags: string[]
    ) => {
      candidates.push({
        id,
        kind,
        label,
        detail,
        actions,
        intensity: Math.round(clamp(intensity, 1, 100)),
        tone,
        tags: [...new Set(tags)].slice(0, 8),
        lastUpdateWorldTime: this.worldTime
      });
    };

    const billsDue = this.totalBillsDue(agent);
    const liquidFunds = agent.money + agent.budget.savings;
    const hour = Math.floor((this.worldMinutes % 1440) / 60);
    const activeCommitment = agent.commitments.find((commitment) => commitment.status === "due" || commitment.status === "missed");
    const workCommitment = agent.commitments.find((commitment) => commitment.id.endsWith(":work"));
    const supportDebt = Object.values(agent.relationshipDetails)
      .filter((relationship) => relationship.supportBalance > 0)
      .sort((a, b) => b.supportBalance - a.supportBalance || b.trust - a.trust)[0];
    const leadNotice = this.leadPersonalNotice(agent);

    if (leadNotice) {
      const noticeActions: AgentAction[] =
        leadNotice.status === "unread" ? [...new Set<AgentAction>(["checking_mail", ...leadNotice.actions])].slice(0, 4) : leadNotice.actions;
      push(
        `notice-${leadNotice.id}`,
        leadNotice.tone === "bad" || leadNotice.kind === "bill" || leadNotice.kind === "health" ? "fear" : "want",
        leadNotice.status === "unread" ? "Read Personal Mail" : leadNotice.label,
        leadNotice.status === "unread" ? `${leadNotice.label}: ${leadNotice.detail}` : leadNotice.detail,
        noticeActions,
        leadNotice.importance * 9 + (leadNotice.status === "unread" ? 12 : 0) + Math.max(0, this.currentDay - leadNotice.createdDay) * 8,
        leadNotice.tone,
        ["mail", "personal_notice", ...leadNotice.tags]
      );
    }

    if (activeCommitment) {
      push(
        "want-make-window",
        activeCommitment.status === "missed" ? "fear" : "want",
        activeCommitment.status === "missed" ? "Recover Missed Window" : "Make The Window",
        `${activeCommitment.label}: ${activeCommitment.windowLabel}, pressure ${Math.round(activeCommitment.pressure)}`,
        activeCommitment.actions,
        28 + activeCommitment.pressure * 0.62 + agent.time.rush * 0.28 + Math.max(0, 50 - agent.time.punctuality) * 0.2,
        activeCommitment.status === "missed" ? "bad" : activeCommitment.tone,
        ["time", "commitment", activeCommitment.category, ...activeCommitment.actions]
      );
    }

    if (agent.time.rush > 62 || agent.time.lateWindowsToday > 0 || agent.time.missedWindowsToday > 0) {
      const scheduleActions = activeCommitment ? activeCommitment.actions : (["resting", "budgeting", "checking_mail"] satisfies AgentAction[]);
      push(
        "fear-running-late",
        "fear",
        agent.time.missedWindowsToday > 0 ? "Stop The Day Slipping" : "Stop Running Late",
        `rush ${agent.time.rush}, punctuality ${agent.time.punctuality}, kept/late/missed ${agent.time.keptWindowsToday}/${agent.time.lateWindowsToday}/${agent.time.missedWindowsToday}`,
        [...new Set<AgentAction>(["resting", "budgeting", ...scheduleActions])].slice(0, 4),
        24 + Math.max(0, agent.time.rush - 54) * 0.9 + agent.time.lateWindowsToday * 12 + agent.time.missedWindowsToday * 18 + Math.max(0, 50 - agent.time.punctuality) * 0.2,
        agent.time.rush > 82 || agent.time.missedWindowsToday > 0 ? "bad" : "warn",
        ["time", "rush", "routine", "commitment"]
      );
    }

    const weakestRhythm = [
      { key: "work", score: agent.rhythm.work, actions: ["working", "calling_in_sick"] satisfies AgentAction[] },
      { key: "care", score: agent.rhythm.care, actions: ["eating", "washing", "sleeping", "healing"] satisfies AgentAction[] },
      { key: "home", score: agent.rhythm.home, actions: ["cleaning", "shopping", "sleeping"] satisfies AgentAction[] },
      { key: "social", score: agent.rhythm.social, actions: ["socializing", "resting"] satisfies AgentAction[] },
      { key: "money", score: agent.rhythm.finance, actions: ["budgeting", "paying_rent", "working", "checking_mail"] satisfies AgentAction[] }
    ].sort((a, b) => a.score - b.score)[0];
    if (agent.rhythm.drift > 58 || (weakestRhythm && weakestRhythm.score < 42)) {
      push(
        "fear-routine-drift",
        agent.rhythm.drift > 74 || (weakestRhythm?.score ?? 100) < 30 ? "fear" : "want",
        agent.rhythm.drift > 74 ? "Stop Routine Drift" : "Stabilize Daily Rhythm",
        `${agent.rhythm.identity}; weakest area ${weakestRhythm?.key ?? "routine"} at ${Math.round(weakestRhythm?.score ?? 0)}, drift ${agent.rhythm.drift}`,
        [...new Set<AgentAction>(["resting", "budgeting", ...(weakestRhythm?.actions ?? [])])].slice(0, 5),
        24 + Math.max(0, agent.rhythm.drift - 50) * 0.74 + Math.max(0, 46 - (weakestRhythm?.score ?? 46)) * 0.72,
        agent.rhythm.drift > 78 || (weakestRhythm?.score ?? 100) < 30 ? "bad" : "warn",
        ["routine", "rhythm", weakestRhythm?.key ?? "daily-life"]
      );
    }

    if (agent.emotion.loneliness > 68) {
      push(
        "want-feel-seen",
        agent.emotion.loneliness > 84 ? "fear" : "want",
        agent.emotion.loneliness > 84 ? "Do Not Feel Invisible" : "Feel Seen",
        `loneliness ${agent.emotion.loneliness}, social need ${Math.round(agent.social)}`,
        ["socializing", "resting", "checking_mail"],
        24 + Math.max(0, agent.emotion.loneliness - 54) * 0.82 + Math.max(0, 54 - agent.social) * 0.22,
        agent.emotion.loneliness > 84 ? "bad" : "warn",
        ["emotion", "loneliness", "social"]
      );
    }

    if (agent.emotion.irritation > 74 || agent.emotion.composure < 34) {
      push(
        "fear-lose-composure",
        "fear",
        agent.emotion.irritation > 82 ? "Do Not Snap" : "Regain Composure",
        `composure ${agent.emotion.composure}, irritation ${agent.emotion.irritation}`,
        ["resting", "washing", "socializing", "sleeping"],
        28 + Math.max(0, agent.emotion.irritation - 62) * 0.72 + Math.max(0, 42 - agent.emotion.composure) * 0.86 + agent.routine.conflictsToday * 10,
        agent.emotion.irritation > 86 || agent.emotion.composure < 24 ? "bad" : "warn",
        ["emotion", "composure", "conflict"]
      );
    }

    if (agent.emotion.hope < 34 || agent.emotion.confidence < 32) {
      push(
        "want-restore-hope",
        agent.emotion.hope < 24 ? "fear" : "want",
        agent.emotion.hope < 24 ? "Find A Reason" : "Restore Hope",
        `hope ${agent.emotion.hope}, confidence ${agent.emotion.confidence}`,
        ["resting", "socializing", "working", "building", "budgeting"],
        20 + Math.max(0, 42 - agent.emotion.hope) * 0.74 + Math.max(0, 40 - agent.emotion.confidence) * 0.48,
        agent.emotion.hope < 24 ? "bad" : "warn",
        ["emotion", "hope", "confidence"]
      );
    }

    const autonomyStrain = Math.max(0, 45 - agent.autonomy.control) + Math.max(0, agent.autonomy.overwhelm - 58) + Math.max(0, 38 - agent.autonomy.dignity) * 0.6;
    if (autonomyStrain > 12) {
      push(
        "want-regain-control",
        agent.autonomy.overwhelm > 78 || agent.autonomy.control < 26 ? "fear" : "want",
        agent.autonomy.overwhelm > 78 ? "Stop Spiraling" : "Regain Control",
        `control ${agent.autonomy.control}, overwhelm ${agent.autonomy.overwhelm}`,
        ["resting", "budgeting", "cleaning", "checking_mail"],
        22 + autonomyStrain * 1.24 + agent.values.autonomy * 0.16,
        agent.autonomy.overwhelm > 78 || agent.autonomy.control < 26 ? "warn" : "neutral",
        ["autonomy", "control", "stress", "routine"]
      );
    }

    if (agent.autonomy.dignity < 42) {
      push(
        "fear-lose-dignity",
        "fear",
        "Hold Self-Respect",
        `dignity ${agent.autonomy.dignity}; routines and public standing feel fragile`,
        ["washing", "cleaning", "paying_rent", "socializing"],
        28 + Math.max(0, 50 - agent.autonomy.dignity) * 1.18 + Math.max(0, agent.autonomy.overwhelm - 62) * 0.28,
        agent.autonomy.dignity < 28 ? "bad" : "warn",
        ["autonomy", "dignity", "home", "public"]
      );
    }

    if (agent.medicalDebt > 0) {
      push(
        "fear-medical-bill",
        "fear",
        "Clear Medical Bill",
        liquidFunds >= agent.medicalDebt
          ? `${agent.medicalDebt} due; cash plus savings can clear it`
          : `${agent.medicalDebt} due and only ${Math.round(liquidFunds)} liquid`,
        ["paying_rent", "budgeting", "working"],
        48 + agent.medicalDebt * 1.3 + (liquidFunds >= agent.medicalDebt ? 18 : 0),
        liquidFunds >= agent.medicalDebt ? "warn" : "bad",
        ["money", "medical", "debt", "stability"]
      );
    }

    const civicBills = agent.rentDue + agent.budget.livingCostDue;
    if (civicBills > 0) {
      push(
        "fear-unpaid-bills",
        "fear",
        "Stop Bills Growing",
        `${Math.round(civicBills * 100) / 100} credits due for rent and basics`,
        ["paying_rent", "budgeting", "working", "checking_mail"],
        42 + civicBills * 1.45 + (liquidFunds >= civicBills ? 12 : 0),
        liquidFunds >= civicBills ? "warn" : "bad",
        ["money", "rent", "living", "civic"]
      );
    }

    if ((civicBills > 0 || agent.medicalDebt > 0) && (agent.budget.overdueBillDays > 0 || liquidFunds < billsDue)) {
      push(
        "fear-late-fees",
        "fear",
        agent.budget.overdueBillDays > 0 ? "Stop Late Fees" : "Ask For Time",
        agent.budget.hardshipDeferrals > 0
          ? `${agent.budget.hardshipDeferrals} protected day${agent.budget.hardshipDeferrals === 1 ? "" : "s"} left on a payment plan`
          : agent.budget.overdueBillDays > 0
            ? `${agent.budget.overdueBillDays} overdue day${agent.budget.overdueBillDays === 1 ? "" : "s"} can become fees`
            : "bills are bigger than liquid credits",
        ["paying_rent", "budgeting", "working"],
        34 + Math.max(0, billsDue - liquidFunds) * 1.2 + agent.budget.overdueBillDays * 18 + agent.budget.lateFeesToday * 5,
        agent.budget.overdueBillDays >= 2 || agent.budget.lateFeesToday > 0 ? "bad" : "warn",
        ["money", "bills", "late-fees", "civic"]
      );
    }

    if (agent.health < 48 || agent.medical.minorIllness.active) {
      const severity = agent.medical.minorIllness.active ? agent.medical.minorIllness.severity : 100 - agent.health;
      push(
        "fear-health-collapse",
        "fear",
        "Do Not Crash",
        agent.medical.minorIllness.active ? `${agent.medical.minorIllness.label} is wearing them down` : `health is down to ${agent.health}`,
        ["healing", "resting", "washing", "eating"],
        46 + severity * 0.72 + (agent.stress > 70 ? 10 : 0),
        agent.health < 28 ? "bad" : "warn",
        ["health", "clinic", "rest"]
      );
    }

    if (agent.medical.aftercare.active) {
      const aftercare = agent.medical.aftercare;
      const overdue = aftercare.expiresWorldMinutes > 0 && this.worldMinutes >= aftercare.expiresWorldMinutes;
      const followUpDue = aftercare.followUpDueWorldMinutes > 0 && this.worldMinutes >= aftercare.followUpDueWorldMinutes;
      const careLoad = aftercare.dosesRemaining * 18 + aftercare.restMinutesRemaining * 0.34 + (overdue ? 24 : followUpDue ? 12 : 0);
      push(
        "want-follow-aftercare",
        overdue ? "fear" : "want",
        "Follow Care Plan",
        `${aftercare.label ?? "aftercare"}: ${aftercare.dosesRemaining} doses and ${Math.round(aftercare.restMinutesRemaining)} rest minutes left`,
        ["healing", "resting", "sleeping"],
        34 + careLoad + Math.max(0, 70 - agent.health) * 0.18,
        overdue ? "bad" : followUpDue || aftercare.dosesRemaining > 0 ? "warn" : "neutral",
        ["health", "aftercare", "routine"]
      );
    }

    if (supportDebt && supportDebt.supportBalance >= 1) {
      const canRepay = agent.money >= Math.min(Math.ceil(supportDebt.supportBalance), 6) + Math.max(4, agent.budget.dailySpendLimit * 0.25);
      push(
        "want-repay-support",
        "want",
        `Pay Back ${supportDebt.agentName}`,
        `${supportDebt.supportBalance} support owed after earlier help`,
        ["socializing", "working"],
        24 + supportDebt.supportBalance * 6 + supportDebt.trust * 0.08 + (canRepay ? 12 : 0),
        supportDebt.supportBalance >= 5 ? "warn" : "neutral",
        ["social", "support", "money", "relationship"]
      );
    }

    if (agent.household.pantry <= 1 && (agent.hunger > 45 || !agent.routine.ateToday)) {
      push(
        "fear-empty-pantry",
        "fear",
        "Do Not Run Out",
        "home food is nearly gone",
        ["shopping", "eating", "working"],
        32 + agent.hunger * 0.38 + (agent.household.pantry <= 0 ? 16 : 0),
        agent.household.pantry <= 0 ? "bad" : "warn",
        ["food", "home", "shopping"]
      );
    }

    if (agent.household.toiletries <= 1 || agent.household.cleaningSupplies <= 1) {
      const worst = Math.min(agent.household.toiletries, agent.household.cleaningSupplies);
      const label = agent.household.toiletries <= agent.household.cleaningSupplies ? "Restock Toiletries" : "Restock Cleaning Supplies";
      const detail =
        agent.household.toiletries <= 1 && agent.household.cleaningSupplies <= 1
          ? `toiletries ${agent.household.toiletries}/${agent.household.supplyCapacity}, cleaning ${agent.household.cleaningSupplies}/${agent.household.supplyCapacity}`
          : agent.household.toiletries <= 1
            ? `toiletries ${agent.household.toiletries}/${agent.household.supplyCapacity}`
            : `cleaning supplies ${agent.household.cleaningSupplies}/${agent.household.supplyCapacity}`;
      push(
        "want-restock-home-supplies",
        worst <= 0 ? "fear" : "want",
        label,
        detail,
        ["shopping", "working", "budgeting"],
        22 +
          Math.max(0, 2 - agent.household.toiletries) * 13 +
          Math.max(0, 2 - agent.household.cleaningSupplies) * 12 +
          Math.max(0, agent.household.clutter - 58) * 0.12 +
          Math.max(0, 72 - agent.hygiene) * 0.04,
        worst <= 0 ? "warn" : "neutral",
        ["home", "supplies", "shopping", "routine"]
      );
    }

    if (!agent.routine.workedToday && workCommitment && (workCommitment.status === "due" || workCommitment.status === "missed" || agent.money < 20)) {
      push(
        "fear-missed-work",
        "fear",
        "Keep Work Standing",
        workCommitment.status === "missed" ? "the work window was missed" : "the work window is open",
        ["working", "washing", "eating"],
        36 + workCommitment.pressure * 0.58 + Math.max(0, 24 - agent.money) * 1.2,
        workCommitment.status === "missed" ? "bad" : "warn",
        ["work", "career", "money"]
      );
    }

    if (agent.stress > 66 && (agent.routine.conflictsToday > 0 || agent.dna.risk > agent.dna.empathy + 12)) {
      push(
        "fear-snap-at-someone",
        "fear",
        "Keep Cool",
        agent.routine.conflictsToday > 0 ? "a tense moment already happened today" : "stress is making social contact risky",
        ["resting", "washing", "socializing"],
        28 + agent.stress * 0.42 + agent.routine.conflictsToday * 10,
        "warn",
        ["social", "stress", "conflict"]
      );
    }

    if (agent.hunger > 48 || (!agent.routine.ateToday && hour >= 11)) {
      push(
        "want-eat",
        "want",
        "Get Fed",
        agent.inventory.includes("food") || agent.household.pantry > 0 ? "food is available somewhere close" : "find food before hunger becomes a problem",
        ["eating", "shopping"],
        24 + agent.hunger * 0.52 + (agent.routine.ateToday ? -18 : 10),
        agent.hunger > 78 ? "bad" : agent.hunger > 62 ? "warn" : "neutral",
        ["food", "body"]
      );
    }

    if (agent.nutrition.hydration < 48) {
      push(
        "want-hydrate",
        agent.nutrition.hydration < 26 ? "fear" : "want",
        agent.nutrition.hydration < 26 ? "Do Not Dehydrate" : "Get Hydrated",
        `hydration is ${Math.round(agent.nutrition.hydration)}`,
        ["eating", "shopping", "resting"],
        18 + Math.max(0, 66 - agent.nutrition.hydration) * 0.58 + Math.max(0, agent.energy < 38 ? 8 : 0),
        agent.nutrition.hydration < 30 ? "warn" : "neutral",
        ["food", "hydration", "body"]
      );
    }

    if (agent.nutrition.quality < 44 || agent.nutrition.variety < 38) {
      const weakDiet = agent.nutrition.quality < 30 || agent.nutrition.variety < 26;
      push(
        "want-better-meal",
        weakDiet ? "fear" : "want",
        weakDiet ? "Eat Something Real" : "Eat Better",
        `meal quality ${Math.round(agent.nutrition.quality)}, variety ${Math.round(agent.nutrition.variety)}`,
        ["shopping", "eating", "working"],
        18 + Math.max(0, 58 - agent.nutrition.quality) * 0.36 + Math.max(0, 52 - agent.nutrition.variety) * 0.32 + agent.values.care * 0.08,
        weakDiet ? "warn" : "neutral",
        ["food", "nutrition", "wellness", "shopping"]
      );
    }

    if (agent.energy < 50 || agent.stress > 58) {
      push(
        "want-recover",
        "want",
        "Recover",
        agent.energy < 42 ? "energy is running low" : "stress needs to come down",
        ["resting", "sleeping", "washing"],
        26 + (100 - agent.energy) * 0.32 + agent.stress * 0.22,
        agent.energy < 28 || agent.stress > 78 ? "warn" : "neutral",
        ["rest", "stress", "comfort"]
      );
    }

    if (agent.sleep.sleepDebt > 54 || agent.sleep.circadianFatigue > 58 || (this.currentPhase === "night" && !agent.routine.sleptToday)) {
      const severeSleepPressure = agent.sleep.sleepDebt > 78 || agent.sleep.circadianFatigue > 82;
      push(
        "want-sleep-rhythm",
        severeSleepPressure ? "fear" : "want",
        severeSleepPressure ? "Do Not Crash From Sleep Debt" : "Fix Sleep Rhythm",
        `${agent.sleep.chronotype.replace(/_/g, " ")} rhythm: debt ${Math.round(agent.sleep.sleepDebt)}, fatigue ${Math.round(agent.sleep.circadianFatigue)}`,
        ["sleeping", "resting", "cleaning"],
        22 +
          Math.max(0, agent.sleep.sleepDebt - 38) * 0.46 +
          Math.max(0, agent.sleep.circadianFatigue - 42) * 0.42 +
          (this.currentPhase === "night" ? 18 : 0) +
          Math.max(0, 58 - agent.household.sleepQuality) * 0.12,
        severeSleepPressure ? "warn" : "neutral",
        ["sleep", "energy", "home", "routine"]
      );
    }

    if (agent.hygiene < 58 || (!agent.routine.washedToday && hour >= 9)) {
      push(
        "want-clean-up",
        "want",
        "Clean Up",
        `hygiene is ${agent.hygiene}`,
        ["washing", "resting"],
        24 + (100 - agent.hygiene) * 0.38 + (agent.routine.washedToday ? -16 : 8),
        agent.hygiene < 34 ? "warn" : "neutral",
        ["hygiene", "home", "health"]
      );
    }

    if (agent.outfit.cleanliness < 54 || agent.outfit.wear > 66) {
      const roughOutfit = agent.outfit.cleanliness < 36 || agent.outfit.wear > 78;
      push(
        "want-freshen-outfit",
        roughOutfit ? "fear" : "want",
        roughOutfit ? "Do Not Look Rough" : "Freshen Clothes",
        `${agent.outfit.style} fit: clean ${Math.round(agent.outfit.cleanliness)}, wear ${Math.round(agent.outfit.wear)}, confidence ${Math.round(agent.outfit.confidence)}`,
        ["washing", "cleaning", "shopping"],
        20 + Math.max(0, 72 - agent.outfit.cleanliness) * 0.38 + Math.max(0, agent.outfit.wear - 48) * 0.34 + agent.values.belonging * 0.1,
        roughOutfit ? "warn" : "neutral",
        ["outfit", "laundry", "social", "home"]
      );
    }

    const homeMess = Math.max(agent.household.clutter, agent.household.laundry);
    if (homeMess > 48 && agent.household.choresDoneToday <= 0) {
      push(
        "want-home-reset",
        "want",
        "Reset Home",
        `clutter ${agent.household.clutter}, laundry ${agent.household.laundry}`,
        ["cleaning", "washing", "resting"],
        20 + homeMess * 0.38 + agent.values.comfort * 0.12,
        homeMess > 76 ? "warn" : "neutral",
        ["home", "comfort", "chores"]
      );
    }

    if (!agent.routine.workedToday && (this.currentPhase === "workday" || agent.money < 18)) {
      push(
        "want-earn",
        "want",
        "Earn Credits",
        agent.money < 18 ? `${agent.money} credits is not much cushion` : "a shift would help today's stability",
        ["working"],
        25 + Math.max(0, 26 - agent.money) * 1.5 + agent.values.security * 0.15 + (this.currentPhase === "workday" ? 16 : 0),
        agent.money < 12 ? "warn" : "neutral",
        ["work", "money", "career"]
      );
    }

    if (!agent.routine.socializedToday && (agent.social < 58 || this.currentPhase === "evening")) {
      push(
        "want-connect",
        "want",
        "Find A Person",
        agent.social < 46 ? "loneliness is starting to pull" : "a social beat would make the day feel real",
        ["socializing", "resting"],
        22 + (100 - agent.social) * 0.32 + agent.dna.sociability * 0.18 + (this.currentPhase === "evening" ? 12 : 0),
        agent.social < 34 ? "warn" : "neutral",
        ["social", "relationship", "belonging"]
      );
    }

    if (agent.leisure.boredom > 58 || agent.leisure.fun < 44) {
      const severeBoredom = agent.leisure.boredom > 80 || agent.leisure.fun < 24;
      const hobbyLabel = agent.leisure.hobby.replace(/_/g, " ");
      push(
        "want-unwind",
        severeBoredom ? "fear" : "want",
        severeBoredom ? "Do Not Numb Out" : "Do Something Fun",
        `${hobbyLabel} pull: fun ${Math.round(agent.leisure.fun)}, boredom ${Math.round(agent.leisure.boredom)}`,
        ["resting", "socializing", "building"],
        20 +
          Math.max(0, 72 - agent.leisure.fun) * 0.44 +
          Math.max(0, agent.leisure.boredom - 48) * 0.52 +
          agent.values.autonomy * 0.08 +
          (agent.routine.recreationToday > 0 ? -24 : 0),
        severeBoredom ? "warn" : "neutral",
        ["leisure", "fun", "hobby", "mood"]
      );
    }

    if (agent.leisure.curiosity > 74 && agent.energy > 34 && agent.hunger < 78) {
      push(
        "want-follow-curiosity",
        "want",
        "Follow Curiosity",
        `curiosity is ${Math.round(agent.leisure.curiosity)} and ${agent.leisure.hobby.replace(/_/g, " ")} is on their mind`,
        ["building", "socializing", "resting"],
        14 + Math.max(0, agent.leisure.curiosity - 62) * 0.42 + agent.values.autonomy * 0.12 + (agent.routine.recreationToday > 0 ? -14 : 0),
        "neutral",
        ["leisure", "curiosity", "autonomy", "future"]
      );
    }

    const savingsGap = Math.max(0, agent.budget.savingsGoal - agent.budget.savings);
    if (savingsGap > 0 && agent.money > agent.budget.dailySpendLimit + billsDue + 4) {
      push(
        "want-save-cushion",
        "want",
        "Build Cushion",
        `${Math.round(savingsGap)} credits from their savings target`,
        ["budgeting"],
        18 + savingsGap * 0.2 + agent.values.security * 0.2 + agent.dna.discipline * 0.1,
        "neutral",
        ["money", "savings", "security"]
      );
    }

    if (!agent.routine.checkedMailToday && activeCommitment?.actions.includes("checking_mail")) {
      push(
        "want-check-mail",
        "want",
        "Check Notices",
        activeCommitment.detail,
        ["checking_mail", "paying_rent"],
        22 + activeCommitment.pressure * 0.34,
        activeCommitment.tone,
        ["mail", "civic", "notice"]
      );
    }

    if (agent.aspiration.dailyProgress <= 0) {
      push(
        `want-aspiration-${agent.aspiration.id}`,
        "want",
        `Make ${agent.aspiration.label} Real`,
        agent.aspiration.detail,
        agent.aspiration.actions,
        18 + agent.aspiration.pressure * 0.32 + Math.max(0, 100 - agent.aspiration.progress) * 0.08,
        agent.aspiration.tone,
        ["aspiration", agent.aspiration.id, ...agent.aspiration.signals.slice(0, 3)]
      );
    }

    return candidates;
  }

  private wantProgress(agent: SimAgent, want: Pick<AgentWant, "id" | "kind" | "actions">) {
    const billsDue = this.totalBillsDue(agent);
    const liquidFunds = agent.money + agent.budget.savings;
    if (want.id === "want-regain-control") {
      return clamp(agent.autonomy.control * 0.62 + Math.max(0, 100 - agent.autonomy.overwhelm) * 0.34 + agent.routine.autonomyMomentsToday * 10);
    }
    if (want.id === "fear-lose-dignity") {
      return clamp(agent.autonomy.dignity * 0.82 + Math.max(0, agent.outfit.confidence - 44) * 0.12 + agent.routine.autonomyMomentsToday * 7);
    }
    if (want.id === "want-make-window") {
      const activeCommitment = agent.commitments.find((commitment) => commitment.status === "missed" || commitment.status === "due");
      if (!activeCommitment) return 100;
      return clamp(100 - activeCommitment.pressure + (activeCommitment.actions.includes(agent.currentAction) ? agent.actionProgress * 22 : 0));
    }
    if (want.id === "fear-running-late") {
      return clamp(100 - agent.time.rush + agent.time.keptWindowsToday * 12 - agent.time.lateWindowsToday * 10 - agent.time.missedWindowsToday * 18);
    }
    if (want.id === "fear-routine-drift") {
      const weakest = Math.min(agent.rhythm.work, agent.rhythm.care, agent.rhythm.home, agent.rhythm.social, agent.rhythm.finance);
      return clamp(100 - agent.rhythm.drift + Math.max(0, weakest - 34) * 0.8 + agent.rhythm.momentum * 0.18);
    }
    if (want.id === "want-feel-seen") return clamp(100 - agent.emotion.loneliness + agent.routine.bondsToday * 24 + (agent.routine.socializedToday ? 12 : 0));
    if (want.id === "fear-lose-composure") return clamp(agent.emotion.composure * 0.72 + Math.max(0, 100 - agent.emotion.irritation) * 0.34 + agent.routine.deescalationsToday * 18);
    if (want.id === "want-restore-hope") return clamp(agent.emotion.hope * 0.74 + agent.emotion.confidence * 0.2 + agent.aspiration.dailyProgress * 8 + agent.rhythm.momentum * 0.08);
    if (want.id === "want-eat") return clamp(100 - agent.hunger + agent.routine.mealsToday * 30);
    if (want.id === "want-hydrate") return clamp(agent.nutrition.hydration + (agent.routine.mealsToday > 0 ? 8 : 0));
    if (want.id === "want-better-meal") return clamp(agent.nutrition.quality * 0.6 + agent.nutrition.variety * 0.34 + agent.routine.mealsToday * 8);
    if (want.id === "want-recover") return clamp(Math.max(agent.energy, 100 - agent.stress));
    if (want.id === "want-sleep-rhythm") return clamp(100 - Math.max(agent.sleep.sleepDebt, agent.sleep.circadianFatigue) + (agent.routine.sleptToday ? 28 : 0));
    if (want.id === "want-clean-up") return clamp(agent.hygiene);
    if (want.id === "want-freshen-outfit") {
      return clamp(agent.outfit.cleanliness * 0.72 + Math.max(0, 100 - agent.outfit.wear) * 0.22 + Math.max(0, agent.outfit.confidence - 50) * 0.12);
    }
    if (want.id === "want-home-reset") return clamp(100 - Math.max(agent.household.clutter, agent.household.laundry));
    if (want.id === "want-restock-home-supplies") {
      const stock = agent.household.toiletries + agent.household.cleaningSupplies;
      return clamp((stock / Math.max(1, agent.household.supplyCapacity * 2)) * 100);
    }
    if (want.id === "want-earn") return agent.routine.workedToday ? 100 : clamp(agent.money * 2);
    if (want.id === "want-connect") return clamp(agent.social + agent.routine.bondsToday * 25 + agent.routine.deescalationsToday * 20);
    if (want.id === "want-unwind") return clamp(agent.leisure.fun * 0.66 + (100 - agent.leisure.boredom) * 0.28 + agent.routine.recreationToday * 22);
    if (want.id === "want-follow-curiosity") return clamp(100 - agent.leisure.curiosity + agent.routine.recreationToday * 28 + (agent.currentAction === "building" ? 20 : 0));
    if (want.id === "want-save-cushion") return clamp((agent.budget.savings / Math.max(1, agent.budget.savingsGoal)) * 100);
    if (want.id === "want-check-mail") return agent.routine.checkedMailToday ? 100 : 0;
    if (want.id === "want-repay-support") {
      const supportDebt = Math.max(0, ...Object.values(agent.relationshipDetails).map((relationship) => relationship.supportBalance));
      return supportDebt <= 0 ? 100 : clamp(100 - supportDebt * 18);
    }
    if (want.id === "want-follow-aftercare") {
      const aftercare = agent.medical.aftercare;
      if (!aftercare.active) return 100;
      const remaining = aftercare.dosesRemaining * 28 + aftercare.restMinutesRemaining * 0.42;
      return clamp(100 - remaining);
    }
    if (want.id.startsWith("notice-")) {
      const notice = agent.personalNotices.find((candidate) => want.id === `notice-${candidate.id}`);
      if (!notice) return 100;
      if (notice.status === "handled") return 100;
      if (notice.status === "expired") return 0;
      const base = notice.status === "read" ? 35 : agent.routine.checkedMailToday ? 25 : 0;
      const actionProgress = notice.actions.some((action) => agent.currentAction === action) ? 18 : 0;
      const deadlinePressure = clamp((this.currentDay - notice.createdDay) * 18, 0, 40);
      return clamp(base + actionProgress + deadlinePressure);
    }
    if (want.id.startsWith("want-aspiration")) return clamp(agent.aspiration.dailyProgress * 14);
    if (want.id === "fear-medical-bill") return agent.medicalDebt <= 0 ? 100 : clamp((liquidFunds / Math.max(1, agent.medicalDebt)) * 70);
    if (want.id === "fear-unpaid-bills") return billsDue <= 0 ? 100 : clamp((liquidFunds / Math.max(1, billsDue)) * 70);
    if (want.id === "fear-late-fees") return billsDue <= 0 || agent.budget.hardshipDeferrals > 0 ? 100 : clamp(100 - agent.budget.overdueBillDays * 26 - agent.budget.lateFeesToday * 18);
    if (want.id === "fear-health-collapse") return clamp(agent.health + (agent.routine.medicalVisitToday ? 34 : 0));
    if (want.id === "fear-empty-pantry") return clamp((agent.household.pantry / Math.max(1, agent.household.pantryCapacity)) * 100);
    if (want.id === "fear-missed-work") return agent.routine.workedToday ? 100 : 0;
    if (want.id === "fear-snap-at-someone") return clamp(100 - agent.stress + agent.routine.deescalationsToday * 35);
    return want.actions.includes(agent.currentAction) ? 35 : 0;
  }

  private resolveWantsAndFears(agent: SimAgent) {
    let changed = false;
    for (const want of agent.wants) {
      if (want.status !== "active") continue;
      want.progress = this.wantProgress(agent, want);
      if (!this.isWantFulfilled(agent, want)) continue;

      want.status = "fulfilled";
      want.progress = 100;
      want.lastUpdateWorldTime = this.worldTime;
      want.expiresWorldMinutes = this.worldMinutes + 90;
      changed = true;

      const label = want.kind === "fear" ? "Fear Eased" : "Want Met";
      const relief = want.kind === "fear";
      this.addMoodlet(agent, {
        id: `desire-${want.id}`,
        label,
        detail: want.label,
        tone: "good",
        intensity: Math.max(3, Math.min(8, want.intensity / 12)),
        durationMinutes: relief ? 240 : 160,
        tags: ["desire", want.kind, ...want.tags].slice(0, 8),
        actionBiases: relief ? { resting: 3, socializing: 2 } : { resting: 1 },
        moodDelta: relief ? 2 : 1,
        stressDelta: relief ? -4 : -1
      });
      this.advanceAspiration(agent, want.kind === "fear" ? 2.2 : 1.6, `${label}: ${want.label}`, ["desire", ...want.tags]);
      this.addMemory(
        agent,
        want.kind === "fear" ? "event" : "reflection",
        `${label}: ${want.label}. ${want.detail}`,
        want.kind === "fear" ? 7 : 5,
        ["desire", want.kind, ...want.tags].slice(0, 8)
      );
    }

    if (changed) {
      agent.wants.sort((a, b) => {
        const statusRank: Record<AgentWantStatus, number> = { active: 0, fulfilled: 1, expired: 2 };
        const kindRank: Record<AgentWantKind, number> = { fear: 0, want: 1 };
        return statusRank[a.status] - statusRank[b.status] || kindRank[a.kind] - kindRank[b.kind] || b.intensity - a.intensity;
      });
    }
  }

  private isWantFulfilled(agent: SimAgent, want: Pick<AgentWant, "id" | "actions">) {
    if (want.id.startsWith("notice-")) {
      const notice = agent.personalNotices.find((candidate) => want.id === `notice-${candidate.id}`);
      return !notice || notice.status === "handled";
    }
    switch (want.id) {
      case "want-eat":
        return agent.routine.mealsToday > 0 || agent.hunger < 42;
      case "want-hydrate":
        return agent.nutrition.hydration >= 64;
      case "want-better-meal":
        return agent.nutrition.quality >= 58 && agent.nutrition.variety >= 48;
      case "want-recover":
        return agent.routine.sleptToday || (agent.energy >= 62 && agent.stress <= 52);
      case "want-sleep-rhythm":
        return agent.routine.sleptToday || (agent.sleep.sleepDebt <= 38 && agent.sleep.circadianFatigue <= 44);
      case "want-clean-up":
        return agent.routine.washedToday || agent.hygiene >= 78;
      case "want-freshen-outfit":
        return (agent.routine.washedToday && agent.outfit.cleanliness >= 58) || (agent.outfit.cleanliness >= 70 && agent.outfit.wear <= 60);
      case "want-home-reset":
        return agent.household.choresDoneToday > 0 || (agent.household.clutter < 44 && agent.household.laundry < 44);
      case "want-restock-home-supplies":
        return agent.household.toiletries > 1 && agent.household.cleaningSupplies > 1;
      case "want-earn":
        return agent.routine.workedToday;
      case "want-connect":
        return agent.routine.socializedToday || agent.routine.bondsToday > 0 || agent.routine.deescalationsToday > 0;
      case "want-unwind":
        return agent.routine.recreationToday > 0 || (agent.leisure.fun >= 62 && agent.leisure.boredom <= 48);
      case "want-follow-curiosity":
        return agent.routine.recreationToday > 0 || agent.leisure.curiosity <= 48 || agent.currentAction === "building";
      case "want-save-cushion":
        return agent.budget.savedToday > 0 || agent.budget.savings >= agent.budget.savingsGoal;
      case "want-check-mail":
        return agent.routine.checkedMailToday;
      case "want-repay-support":
        return Object.values(agent.relationshipDetails).every((relationship) => relationship.supportBalance <= 0);
      case "want-follow-aftercare":
        return !agent.medical.aftercare.active || (agent.medical.aftercare.dosesRemaining <= 0 && agent.medical.aftercare.restMinutesRemaining <= 0);
      case "want-regain-control":
        return agent.routine.autonomyMomentsToday > 0 && (agent.autonomy.control >= 50 || agent.autonomy.overwhelm <= 52);
      case "fear-lose-dignity":
        return agent.autonomy.dignity >= 50 || (agent.routine.washedToday && agent.outfit.confidence >= 52) || agent.routine.paidRentToday;
      case "want-make-window":
        return !agent.commitments.some((commitment) => commitment.status === "missed" || commitment.status === "due");
      case "fear-running-late":
        return agent.time.rush <= 48 && !agent.commitments.some((commitment) => commitment.status === "missed" || (commitment.status === "due" && commitment.pressure >= 52));
      case "fear-routine-drift":
        return agent.rhythm.drift <= 48 && Math.min(agent.rhythm.work, agent.rhythm.care, agent.rhythm.home, agent.rhythm.social, agent.rhythm.finance) >= 42;
      case "want-feel-seen":
        return agent.emotion.loneliness <= 48 || agent.routine.bondsToday > 0 || agent.routine.socializedToday;
      case "fear-lose-composure":
        return agent.emotion.composure >= 54 && agent.emotion.irritation <= 48;
      case "want-restore-hope":
        return agent.emotion.hope >= 48 && agent.emotion.confidence >= 40;
      case "fear-medical-bill":
        return agent.medicalDebt <= 0;
      case "fear-unpaid-bills":
        return this.totalBillsDue(agent) <= 0;
      case "fear-late-fees":
        return this.totalBillsDue(agent) <= 0 || agent.budget.hardshipDeferrals > 0;
      case "fear-health-collapse":
        return agent.routine.medicalVisitToday || (!agent.medical.minorIllness.active && agent.health >= 64);
      case "fear-empty-pantry":
        return agent.household.pantry > 1 || agent.inventory.includes("food") || agent.routine.mealsToday > 0;
      case "fear-missed-work":
        return agent.routine.workedToday;
      case "fear-snap-at-someone":
        return agent.routine.deescalationsToday > 0 || (agent.stress < 52 && agent.routine.conflictsToday === 0);
      default:
        if (want.id.startsWith("want-aspiration")) return agent.aspiration.dailyProgress > 0;
        return want.actions.some((action) => agent.currentAction === action && agent.actionProgress >= 0.9);
    }
  }

  private recordPlaceExperience(agent: SimAgent, experience: AgentPlaceExperience) {
    if (!agent.target) return null;
    const target = agent.target;
    const existing = agent.placeMemory[target.structureId];
    const toneWeight: Record<AgentPlaceExperienceTone, number> = {
      good: 1,
      neutral: 0.35,
      warn: -0.55,
      bad: -1
    };
    const amount = clamp(Math.abs(experience.amount), 0, 10);
    const signed = amount * toneWeight[experience.tone];
    const current = existing ?? {
      structureId: target.structureId,
      structureName: target.structureName,
      structureType: target.actionPointType,
      visits: 0,
      affinity: 0,
      trust: 0,
      frustration: 0,
      goodVisits: 0,
      badVisits: 0,
      lastVisitedWorldTime: this.worldTime,
      lastVisitedWorldMinutes: this.worldMinutes,
      lastAction: target.action,
      lastEvent: "First impression.",
      tags: []
    };

    current.structureName = target.structureName;
    current.structureType = target.actionPointType;
    current.visits += 1;
    current.affinity = Math.round(clamp(current.affinity + signed, -100, 100));
    current.trust = Math.round(clamp(current.trust + (experience.tone === "good" ? amount * 0.72 : experience.tone === "neutral" ? amount * 0.2 : -amount * 0.38), -100, 100));
    current.frustration = Math.round(clamp(current.frustration + (experience.tone === "bad" ? amount : experience.tone === "warn" ? amount * 0.65 : -amount * 0.42), 0, 100));
    if (experience.tone === "good") current.goodVisits += 1;
    if (experience.tone === "bad") current.badVisits += 1;
    current.lastVisitedWorldTime = this.worldTime;
    current.lastVisitedWorldMinutes = this.worldMinutes;
    current.lastAction = target.action;
    current.lastEvent = experience.label;
    current.tags = [...new Set([...current.tags, target.action, target.actionPointType, ...experience.tags])].slice(-8);
    agent.placeMemory[target.structureId] = current;

    const entries = Object.entries(agent.placeMemory).sort(([, a], [, b]) => {
      const aWeight = Math.abs(a.affinity) + a.visits * 1.5 + Math.max(0, 1440 - (this.worldMinutes - a.lastVisitedWorldMinutes)) * 0.003;
      const bWeight = Math.abs(b.affinity) + b.visits * 1.5 + Math.max(0, 1440 - (this.worldMinutes - b.lastVisitedWorldMinutes)) * 0.003;
      return bWeight - aWeight;
    });
    if (entries.length > 18) {
      agent.placeMemory = Object.fromEntries(entries.slice(0, 18));
    }
    return current;
  }

  private recordActivityExperience(agent: SimAgent, experience: AgentPlaceExperience) {
    if (agent.currentAction === "walking" || agent.currentAction === "idle" || agent.currentAction === "hospitalized") return null;
    const action = agent.currentAction;
    const existing = agent.activityMemory[action];
    const toneWeight: Record<AgentPlaceExperienceTone, number> = {
      good: 1,
      neutral: 0.28,
      warn: -0.52,
      bad: -1
    };
    const amount = clamp(Math.abs(experience.amount), 0, 10);
    const signed = amount * toneWeight[experience.tone];
    const current = existing ?? {
      action,
      visits: 0,
      affinity: 0,
      confidence: 0,
      frustration: 0,
      goodVisits: 0,
      badVisits: 0,
      lastWorldTime: this.worldTime,
      lastWorldMinutes: this.worldMinutes,
      lastEvent: "First impression.",
      tags: []
    };

    current.visits += 1;
    current.affinity = Math.round(clamp(current.affinity + signed, -100, 100));
    current.confidence = Math.round(clamp(current.confidence + (experience.tone === "good" ? amount * 0.72 : experience.tone === "neutral" ? amount * 0.28 : -amount * 0.18), -100, 100));
    current.frustration = Math.round(clamp(current.frustration + (experience.tone === "bad" ? amount : experience.tone === "warn" ? amount * 0.68 : -amount * 0.36), 0, 100));
    if (experience.tone === "good") current.goodVisits += 1;
    if (experience.tone === "bad") current.badVisits += 1;
    current.lastWorldTime = this.worldTime;
    current.lastWorldMinutes = this.worldMinutes;
    current.lastEvent = experience.label;
    current.tags = [...new Set([action, ...current.tags, ...experience.tags])].slice(-8);
    agent.activityMemory[action] = current;
    return current;
  }

  private relationshipContext(): RelationshipRuntimeContext {
    return {
      worldTime: this.worldTime,
      worldMinutes: this.worldMinutes,
      currentDay: this.currentDay,
      currentPhase: this.currentPhase,
      addMemory: (agent, kind, text, importance, tags) => this.addMemory(agent, kind, text, importance, tags),
      log: (agent, text, kind, tone, importance) => this.log(agent, text, kind, tone, importance),
      addMoodlet: (agent, moodlet) => this.addMoodlet(agent, moodlet),
      recordSocialMoment: (agent, moment) => this.recordSocialMoment(agent, moment),
      recordObjectUse: (agent, delta) => {
        this.objectStates.recordUse(agent, this.worldTime, delta);
        if (!agent.target) return;
        const conflict = agent.routine.conflictsToday > agent.routine.bondsToday;
        const cooled = (delta?.heatDelta ?? 0) < 0;
        this.recordPlaceExperience(agent, {
          tone: conflict ? "bad" : cooled ? "good" : "neutral",
          amount: conflict ? 6 : cooled ? 3 : 2,
          label: conflict ? "A social moment here turned tense." : cooled ? "A tense moment cooled down here." : "Social life here became more familiar.",
          tags: ["social", conflict ? "conflict" : cooled ? "deescalation" : "public"]
        });
        this.recordActivityExperience(agent, {
          tone: conflict ? "bad" : cooled ? "good" : "neutral",
          amount: conflict ? 6 : cooled ? 3 : 2,
          label: conflict ? "Socializing turned tense." : cooled ? "Socializing stayed civil." : "Socializing became more familiar.",
          tags: ["social", conflict ? "conflict" : cooled ? "deescalation" : "public"]
        });
      }
    };
  }

  private decisionContext(agents: readonly SimAgent[] = this.agentList()): DecisionContext {
    return {
      phase: this.currentPhase,
      phaseLabel: this.phaseLabel,
      currentDay: this.currentDay,
      worldMinutes: this.worldMinutes,
      weather: { ...this.latestWeather },
      agents,
      memory: this.memory,
      objectStates: this.objectStates,
      cityPulse: this.latestCityPulse,
      relationship: this.relationships,
      addMemory: (agent, kind, text, importance, tags) => this.addMemory(agent, kind, text, importance, tags),
      log: (agent, text, kind, tone, importance) => this.log(agent, text, kind, tone, importance)
    };
  }

  private actionContext(agents: readonly SimAgent[] = this.agentList()): ActionResolverContext {
    return {
      currentPhase: this.currentPhase,
      currentDay: this.currentDay,
      worldTime: this.worldTime,
      worldMinutes: this.worldMinutes,
      agents,
      memory: this.memory,
      memoryContext: this.memoryContext(),
      objectStates: this.objectStates,
      relationship: this.relationships,
      relationshipContext: this.relationshipContext(),
      addMemory: (agent, kind, text, importance, tags) => this.addMemory(agent, kind, text, importance, tags),
      log: (agent, text, kind, tone, importance) => this.log(agent, text, kind, tone, importance),
      transact: (agent, amount, category, label, tone) => this.transact(agent, amount, category, label, tone),
      recordFinance: (agent, amount, category, label, tone) => this.recordFinance(agent, amount, category, label, tone),
      depositSavings: (agent, amount, label) => this.depositSavings(agent, amount, label),
      withdrawSavings: (agent, amount, label) => this.withdrawSavings(agent, amount, label),
      advanceAspiration: (agent, amount, label, signals) => this.advanceAspiration(agent, amount, label, signals),
      advanceSkill: (agent, skillId, amount, label, tags) => this.advanceSkill(agent, skillId, amount, label, tags),
      adjustCredit: (agent, amount, reason) => this.adjustCredit(agent, amount, reason),
      recordPlaceExperience: (agent, experience) => this.recordPlaceExperience(agent, experience),
      recordActivityExperience: (agent, experience) => this.recordActivityExperience(agent, experience),
      addMoodlet: (agent, moodlet) => this.addMoodlet(agent, moodlet),
      absorbCivicNotice: (agent, channel) => this.absorbCivicNotice(agent, channel)
    };
  }

  private chooseNextTarget(agent: SimAgent, structures: StructureMetadata[], routeResolver?: AgentRouteResolver, agents: readonly SimAgent[] = this.agentList()) {
    this.decisions.chooseNextTarget(agent, structures, routeResolver, this.decisionContext(agents));
  }

  private shouldReplanForPriority(agent: SimAgent) {
    if (!agent.target || agent.currentAction !== "walking") return false;
    const targetAction = agent.target.action;
    const intention = agent.activeIntention;
    const bestIntentionBias = Math.max(0, ...Object.values(intention.actionBiases).map((value) => value ?? 0));
    if (intention.urgency >= 84 && bestIntentionBias >= 24 && !intention.actions.includes(targetAction)) return true;
    switch (agent.lifePriority.id) {
      case "health-safety":
        return !["healing", "hospitalized"].includes(targetAction);
      case "food-security":
        return !["eating", "shopping"].includes(targetAction);
      case "energy-recovery":
        return !["sleeping", "resting"].includes(targetAction);
      case "pay-obligations":
        return !["paying_rent", "checking_mail"].includes(targetAction);
      case "financial-repair":
        return !["budgeting", "working", "paying_rent", "checking_mail"].includes(targetAction);
      case "home-care":
        return !["cleaning", "washing", "eating", "shopping", "sleeping", "resting"].includes(targetAction);
      case "regain-composure":
        return !["resting", "washing", "sleeping", "socializing"].includes(targetAction);
      case "find-connection":
        return !["socializing", "resting", "checking_mail", "shopping"].includes(targetAction);
      case "restore-hope":
        return !["resting", "socializing", "building", "budgeting", "working", "checking_mail"].includes(targetAction);
      case "repair-social-strain":
        return !["socializing", "budgeting", "working", "resting"].includes(targetAction);
      case "life-admin":
        return !agent.lifeAdmin.suggestedActions.includes(targetAction);
      case "cashflow":
        return targetAction !== "working";
      default:
        return false;
    }
  }

  private clearTargetForPriority(agent: SimAgent) {
    const previous = agent.target?.label ?? "the old plan";
    agent.target = null;
    agent.currentAction = "idle";
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 0;
    this.addMemory(agent, "plan", `${agent.lifePriority.label}: rerouted away from ${previous}.`, 5, ["plan", "priority", agent.lifePriority.id]);
  }

  private updateCommitments(agent: SimAgent) {
    if (agent.commitments.length === 0 || agent.commitments.some((commitment) => this.commitmentDay(commitment) !== this.currentDay)) {
      agent.commitments = this.spawns.buildDailyCommitments(agent, this.currentDay);
    }

    for (const commitment of agent.commitments) {
      const complete = this.isCommitmentComplete(agent, commitment);
      if (complete) {
        if (commitment.status !== "done") {
          const completedLate = this.worldMinutes > commitment.dueWorldMinutes;
          commitment.completedWorldTime = this.worldTime;
          commitment.completedLate = completedLate;
          this.noteCompletedCommitment(agent, commitment, completedLate);
        }
        commitment.status = "done";
        commitment.tone = "good";
        commitment.pressure = 0;
        continue;
      }

      const previousStatus = commitment.status;
      const minutesUntilStart = commitment.startWorldMinutes - this.worldMinutes;
      const minutesUntilDue = commitment.dueWorldMinutes - this.worldMinutes;
      const graceMinutes = Math.max(20, commitment.graceMinutes);
      const windowDuration = Math.max(30, commitment.dueWorldMinutes - commitment.startWorldMinutes);

      if (minutesUntilDue < -graceMinutes) {
        commitment.status = "missed";
        commitment.tone = "bad";
        commitment.pressure = 100;
      } else if (minutesUntilStart <= 0) {
        const windowProgress = clamp((this.worldMinutes - commitment.startWorldMinutes) / windowDuration, 0, 1);
        commitment.status = "due";
        commitment.pressure = Math.round(minutesUntilDue < 0 ? 100 : clamp(28 + windowProgress * 72, 0, 100));
        commitment.tone = commitment.pressure >= 82 || minutesUntilDue <= 20 ? "bad" : "warn";
      } else {
        commitment.status = "pending";
        commitment.pressure = Math.round(clamp(30 - (minutesUntilStart / 240) * 30, 0, 30));
        commitment.tone = "neutral";
      }

      if (commitment.status === "missed" && previousStatus !== "missed" && !commitment.missedWorldTime) {
        commitment.missedWorldTime = this.worldTime;
        this.applyMissedCommitment(agent, commitment);
      }
    }

    agent.commitments.sort((a, b) => {
      const statusRank: Record<AgentCommitmentStatus, number> = { missed: 0, due: 1, pending: 2, done: 3 };
      return statusRank[a.status] - statusRank[b.status] || b.pressure - a.pressure || a.startWorldMinutes - b.startWorldMinutes;
    });
  }

  private commitmentDay(commitment: AgentCommitment) {
    return Math.floor(commitment.startWorldMinutes / 1440) + 1;
  }

  private isCommitmentComplete(agent: SimAgent, commitment: AgentCommitment) {
    const key = commitment.id.split(":").pop();
    switch (key) {
      case "wash":
        return agent.routine.washedToday || agent.hygiene >= 78;
      case "meal":
        return agent.routine.mealsToday > 0 || agent.hunger < 42;
      case "work":
        return agent.routine.workedToday || agent.routine.sickLeaveToday;
      case "sleep":
        return agent.routine.sleptToday;
      case "mail":
        return agent.routine.checkedMailToday;
      case "bills":
        return this.totalBillsDue(agent) <= 0;
      case "clinic":
        return agent.routine.medicalVisitToday || agent.health >= 74;
      case "social":
        return agent.routine.socializedToday || agent.routine.bondsToday > 0 || agent.routine.deescalationsToday > 0;
      default:
        return commitment.actions.some((action) => agent.currentAction === action);
    }
  }

  private noteCompletedCommitment(agent: SimAgent, commitment: AgentCommitment, completedLate: boolean) {
    const important = commitment.actions.includes("working") || commitment.actions.includes("paying_rent") || commitment.actions.includes("healing");
    const rushRelief = completedLate ? 8 : 16;
    agent.time.lastScheduleWorldTime = this.worldTime;
    agent.time.rush = Math.round(clamp(agent.time.rush - rushRelief));
    if (completedLate) {
      agent.time.lateWindowsToday += 1;
      agent.time.punctuality = Math.round(clamp(agent.time.punctuality - (important ? 2 : 1)));
      agent.stress = clamp(agent.stress + (important ? 2 : 1));
      agent.autonomy.control = Math.round(clamp(agent.autonomy.control + 2));
      agent.autonomy.overwhelm = Math.round(clamp(agent.autonomy.overwhelm - 4));
      agent.time.recent.unshift(`${this.worldTime} Completed ${commitment.label} late, but still inside the grace window.`);
      this.addMemory(agent, "event", `Completed ${commitment.label} late instead of missing it.`, important ? 6 : 4, ["time", "commitment", "late", ...commitment.actions]);
    } else {
      agent.time.keptWindowsToday += 1;
      agent.time.punctuality = Math.round(clamp(agent.time.punctuality + (important ? 2 : 1)));
      agent.time.timeAwareness = Math.round(clamp(agent.time.timeAwareness + (commitment.pressure >= 60 ? 1 : 0)));
      agent.mood = clamp(agent.mood + (important ? 2 : 1));
      agent.autonomy.control = Math.round(clamp(agent.autonomy.control + (important ? 4 : 2)));
      agent.autonomy.overwhelm = Math.round(clamp(agent.autonomy.overwhelm - (important ? 6 : 3)));
      agent.time.recent.unshift(`${this.worldTime} Kept ${commitment.label} on time.`);
      if (commitment.pressure >= 62 || important) {
        this.addMemory(agent, "event", `Kept the ${commitment.label} window on time.`, important ? 6 : 4, ["time", "commitment", "punctual", ...commitment.actions]);
      }
    }
    agent.time.recent.splice(4);
    this.refreshTimeManagement(agent);
    this.refreshAutonomy(agent);
  }

  private applyMissedCommitment(agent: SimAgent, commitment: AgentCommitment) {
    const important = commitment.actions.includes("working") || commitment.actions.includes("paying_rent") || commitment.actions.includes("healing");
    agent.stress = clamp(agent.stress + (important ? 9 : 5));
    agent.mood = clamp(agent.mood - (important ? 5 : 2));
    agent.time.missedWindowsToday += 1;
    agent.time.rush = Math.round(clamp(agent.time.rush + (important ? 12 : 7)));
    agent.time.punctuality = Math.round(clamp(agent.time.punctuality - (important ? 4 : 2)));
    agent.time.lastScheduleWorldTime = this.worldTime;
    agent.time.recent.unshift(`${this.worldTime} Missed ${commitment.label}.`);
    agent.time.recent.splice(4);
    agent.autonomy.control = Math.round(clamp(agent.autonomy.control - (important ? 5 : 2)));
    agent.autonomy.overwhelm = Math.round(clamp(agent.autonomy.overwhelm + (important ? 9 : 5)));
    agent.autonomy.recent.unshift(`${this.worldTime} Missing ${commitment.label} made the day feel less controlled.`);
    agent.autonomy.recent.splice(4);
    if (commitment.actions.includes("working")) this.relationships.adjustReputation(agent, { reliability: -4, ambition: -1 });
    else if (commitment.actions.includes("paying_rent")) this.relationships.adjustReputation(agent, { reliability: -3, trouble: 1 });
    else if (commitment.actions.includes("socializing")) this.relationships.adjustReputation(agent, { warmth: -1 });
    else this.relationships.adjustReputation(agent, { reliability: -1 });

    this.addMemory(agent, "event", `Missed commitment: ${commitment.label}. ${commitment.detail}`, important ? 8 : 6, [
      "commitment",
      "missed",
      ...commitment.actions
    ]);
    this.log(agent, `${agent.name} missed a commitment: ${commitment.label}.`, "routine", important ? "warn" : "neutral", important ? 7 : 5);
  }

  private announceTimeChanges() {
    const day = this.currentDay;
    const phase = this.currentPhase;
    if (day !== this.lastAnnouncedDay) {
      this.lastAnnouncedDay = day;
      this.lastAnnouncedPhase = phase;
      if (this.agents.size > 0) this.logCity(`Day ${day} begins in Genesis District.`, "city", "neutral", 6);
      return;
    }

    if (phase === this.lastAnnouncedPhase) return;
    this.lastAnnouncedPhase = phase;
    if (this.agents.size === 0) return;
    const line: Record<DayPhase, string> = {
      morning: "Morning returns: groceries, clinics, homes, sinks, mailboxes, and breakfast become important.",
      workday: "Workday starts: workplaces and civic desks are open, so agents weigh wages against errands.",
      evening: "Evening opens up: civic desks wind down while parks, shops, friends, and quiet seats pull attention.",
      night: "Night settles in: shops, offices, lots, and parks close; homes and emergency care carry the city."
    };
    this.logCity(line[phase], "city", "neutral", 6);
  }

  private refreshCityPulse(agents: readonly SimAgent[] = this.agentList()) {
    const pulse = this.cityPulse.create(this.currentDay, this.worldTime, this.currentPhase, agents, this.objectStates.snapshot());
    this.latestCityPulse = pulse;
    const leadFlag = pulse.flags[0];
    if (!leadFlag || agents.length === 0) return;
    const alertKey = `${this.currentDay}:${this.currentPhase}:${leadFlag.id}:${leadFlag.tone}`;
    if (alertKey === this.lastPulseAlertKey) return;
    this.lastPulseAlertKey = alertKey;
    this.logCity(`${leadFlag.label}: ${leadFlag.detail}.`, "city", leadFlag.tone === "bad" ? "bad" : "warn", leadFlag.tone === "bad" ? 8 : 6);
  }

  private actionProgressFor(agent: SimAgent) {
    if (agent.medical.isHospitalized) {
      if (agent.dwellTotalSeconds <= 0) return 0;
      return clamp(1 - agent.dwellSeconds / agent.dwellTotalSeconds, 0, 1);
    }
    if (!agent.target) return 0;
    if (agent.currentAction === "walking") {
      const total = Math.max(1, agent.target.routeLength);
      return clamp((total - agent.target.waypoints.length) / total, 0, 1);
    }
    if (agent.dwellTotalSeconds <= 0) return 0;
    return clamp(1 - agent.dwellSeconds / agent.dwellTotalSeconds, 0, 1);
  }

  private isWeatherExposed(agent: SimAgent) {
    if (agent.medical.isHospitalized) return false;
    if (agent.currentAction === "walking" || agent.currentAction === "building") return true;
    if (agent.currentAction === "socializing") return agent.target?.actionPointType === "meeting_spot";
    if (agent.currentAction === "resting") return agent.target?.actionPointType === "seat" || agent.target?.actionPointType === "meeting_spot";
    return false;
  }

  private conditionLoad(agent: SimAgent) {
    const hungerLoad = Math.max(0, agent.hunger - 70) * 0.9;
    const energyLoad = Math.max(0, 36 - agent.energy) * 1.08;
    const healthLoad = Math.max(0, 68 - agent.health) * 0.82;
    const stressLoad = Math.max(0, agent.stress - 58) * 0.55;
    const hygieneLoad = Math.max(0, 34 - agent.hygiene) * 0.34;
    const nutritionLoad = Math.max(0, 34 - agent.nutrition.hydration) * 0.46 + Math.max(0, 30 - agent.nutrition.quality) * 0.24;
    const leisureLoad = Math.max(0, agent.leisure.boredom - 78) * 0.18 + Math.max(0, 24 - agent.leisure.fun) * 0.16;
    const sleepLoad = Math.max(0, agent.sleep.sleepDebt - 62) * 0.34 + Math.max(0, agent.sleep.circadianFatigue - 66) * 0.3;
    const autonomyLoad = Math.max(0, agent.autonomy.overwhelm - 72) * 0.18 + Math.max(0, 28 - agent.autonomy.control) * 0.16 + Math.max(0, 24 - agent.autonomy.dignity) * 0.12;
    const timeLoad = Math.max(0, agent.time.rush - 72) * 0.18 + Math.max(0, 32 - agent.time.punctuality) * 0.1;
    const rhythmLoad = Math.max(0, agent.rhythm.drift - 70) * 0.14 + Math.max(0, 30 - Math.min(agent.rhythm.work, agent.rhythm.care, agent.rhythm.home, agent.rhythm.social, agent.rhythm.finance)) * 0.1;
    const emotionLoad =
      Math.max(0, agent.emotion.loneliness - 78) * 0.12 +
      Math.max(0, agent.emotion.irritation - 76) * 0.14 +
      Math.max(0, 30 - agent.emotion.composure) * 0.16 +
      Math.max(0, 24 - agent.emotion.hope) * 0.12;
    const burnoutLoad = Math.max(0, agent.career.burnout - 60) * 0.46;
    const debtLoad = Math.min(14, this.totalBillsDue(agent) * 0.12);
    const illnessLoad = agent.medical.minorIllness.active ? agent.medical.minorIllness.severity * 0.38 : 0;
    const weatherLoad = this.isWeatherExposed(agent)
      ? Math.max(0, -this.latestWeather.comfortDelta * 120) + Math.max(0, this.latestWeather.outdoorStressDelta * 90)
      : 0;
    const load = clamp(
      hungerLoad +
        energyLoad +
        healthLoad +
        stressLoad +
        hygieneLoad +
        nutritionLoad +
        leisureLoad +
        sleepLoad +
        autonomyLoad +
        timeLoad +
        rhythmLoad +
        emotionLoad +
        burnoutLoad +
        debtLoad +
        illnessLoad +
        weatherLoad
    );
    const recovery =
      Math.max(0, 62 - agent.hunger) * 0.13 +
      Math.max(0, agent.energy - 62) * 0.1 +
      Math.max(0, agent.health - 72) * 0.08 +
      Math.max(0, 36 - agent.stress) * 0.12 +
      Math.max(0, agent.nutrition.hydration - 62) * 0.05 +
      Math.max(0, agent.nutrition.quality - 62) * 0.04 +
      Math.max(0, agent.leisure.fun - 68) * 0.045 +
      Math.max(0, 42 - agent.leisure.boredom) * 0.035 +
      Math.max(0, 42 - agent.sleep.sleepDebt) * 0.05 +
      Math.max(0, 44 - agent.sleep.circadianFatigue) * 0.04 +
      Math.max(0, agent.autonomy.control - 64) * 0.035 +
      Math.max(0, 42 - agent.autonomy.overwhelm) * 0.035 +
      Math.max(0, agent.autonomy.dignity - 64) * 0.025 +
      Math.max(0, agent.time.punctuality - 64) * 0.025 +
      Math.max(0, 35 - agent.time.rush) * 0.035 +
      Math.max(0, agent.rhythm.momentum - 64) * 0.025 +
      Math.max(0, 42 - agent.rhythm.drift) * 0.025 +
      Math.max(0, agent.emotion.composure - 64) * 0.02 +
      Math.max(0, agent.emotion.hope - 64) * 0.018 +
      Math.max(0, 36 - agent.emotion.irritation) * 0.018 +
      (agent.routine.ateToday ? 3 : 0) +
      (agent.routine.recreationToday > 0 ? 3 : 0) +
      (agent.routine.sleptToday ? 4 : 0) +
      (agent.routine.autonomyMomentsToday > 0 ? 3 : 0) +
      (agent.time.keptWindowsToday > 0 ? 2 : 0);
    return {
      load: Math.round(load),
      recovery: Math.round(clamp(recovery, 0, 40))
    };
  }

  private movementSpeedFor(agent: SimAgent) {
    const condition = this.conditionLoad(agent);
    const urgentNeedPush =
      agent.lifePriority.id === "food-security" || agent.lifePriority.id === "health-safety" || agent.lifePriority.id === "pay-obligations"
        ? condition.load >= 70
          ? 0.08
          : 0.04
        : 0;
    const weatherMultiplier = this.isWeatherExposed(agent) ? this.latestWeather.movementMultiplier : 1;
    const multiplier = clamp((1 - condition.load * 0.0045 + condition.recovery * 0.0025 + urgentNeedPush) * weatherMultiplier, 0.45, 1.18);
    return agent.speed * multiplier;
  }

  private actionEfficiencyFor(agent: SimAgent) {
    const condition = this.conditionLoad(agent);
    const restorative = ["sleeping", "resting", "eating", "washing", "healing"].includes(agent.currentAction);
    const multiplier = restorative ? 1 + condition.recovery * 0.003 - condition.load * 0.0015 : 1 - condition.load * 0.004 + condition.recovery * 0.002;
    return clamp(multiplier, restorative ? 0.78 : 0.52, 1.16);
  }

  private statusEffectsFor(agent: SimAgent): AgentStatusEffect[] {
    const effects: AgentStatusEffect[] = [];
    const push = (id: string, label: string, detail: string, tone: AgentStatusEffect["tone"]) => {
      if (!effects.some((effect) => effect.id === id)) effects.push({ id, label, detail, tone });
    };
    const currentObject = agent.target ? this.objectStates.peek(agent.target.structureId, agent.target.actionPointId) : undefined;
    const condition = this.conditionLoad(agent);

    const liquidFunds = agent.money + agent.budget.savings;
    const totalBillsDue = this.totalBillsDue(agent);
    const leadNotice = this.leadPersonalNotice(agent);

    if (leadNotice) {
      push(
        "personal-notice",
        leadNotice.status === "unread" ? "Unread Mail" : "Personal Notice",
        `${leadNotice.label} / due day ${leadNotice.dueDay}`,
        leadNotice.tone
      );
    }
    if (agent.lifeAdmin.load >= 66 || agent.lifeAdmin.urgency >= 72) {
      push(
        "life-admin-load",
        "Life Admin",
        agent.lifeAdmin.nextTask,
        agent.lifeAdmin.urgency >= 84 ? "bad" : "warn"
      );
    }
    if (agent.lifeAdmin.dominantCategory === "healthFollowup" && agent.lifeAdmin.healthFollowup >= 52) {
      push("health-followup", "Follow-Up", agent.lifeAdmin.nextTask, agent.lifeAdmin.healthFollowup >= 78 ? "bad" : "warn");
    } else if (agent.lifeAdmin.dominantCategory === "supplies" && agent.lifeAdmin.supplies >= 52) {
      push("supply-run", "Supply Run", agent.lifeAdmin.nextTask, agent.lifeAdmin.supplies >= 78 ? "bad" : "warn");
    } else if (agent.lifeAdmin.dominantCategory === "homeCare" && agent.lifeAdmin.homeCare >= 52) {
      push("home-admin", "Home Admin", agent.lifeAdmin.nextTask, agent.lifeAdmin.homeCare >= 78 ? "bad" : "warn");
    }
    if (agent.autonomy.overwhelm >= 82) push("overwhelmed", "Overwhelmed", `overwhelm ${Math.round(agent.autonomy.overwhelm)}`, "bad");
    else if (agent.autonomy.overwhelm >= 68) push("pressure-rising", "Pressure Rising", `overwhelm ${Math.round(agent.autonomy.overwhelm)}`, "warn");
    if (agent.autonomy.control <= 28) push("low-control", "Low Control", `control ${Math.round(agent.autonomy.control)}`, "warn");
    else if (agent.autonomy.control >= 72 && agent.routine.autonomyMomentsToday > 0) {
      push("in-control", "In Control", `${agent.routine.autonomyMomentsToday} agency beat${agent.routine.autonomyMomentsToday === 1 ? "" : "s"}`, "good");
    }
    if (agent.autonomy.dignity <= 26) push("dignity-hit", "Dignity Hit", `self-respect ${Math.round(agent.autonomy.dignity)}`, "bad");
    else if (agent.autonomy.dignity >= 72 && agent.routine.autonomyMomentsToday > 0) push("self-respect", "Self-Respect", `dignity ${Math.round(agent.autonomy.dignity)}`, "good");
    if (agent.time.missedWindowsToday > 0) push("schedule-slip", "Schedule Slipped", `${agent.time.missedWindowsToday} missed window${agent.time.missedWindowsToday === 1 ? "" : "s"}`, "bad");
    else if (agent.time.lateWindowsToday > 0) push("late-window", "Ran Late", `${agent.time.lateWindowsToday} late window${agent.time.lateWindowsToday === 1 ? "" : "s"}`, "warn");
    if (agent.time.rush >= 82) push("rushed", "Rushed", `rush ${Math.round(agent.time.rush)}`, "bad");
    else if (agent.time.rush >= 64) push("time-pressure", "Time Pressure", `rush ${Math.round(agent.time.rush)}`, "warn");
    else if (agent.time.keptWindowsToday > 0 && agent.time.rush < 46) push("on-time", "On Time", `${agent.time.keptWindowsToday} kept window${agent.time.keptWindowsToday === 1 ? "" : "s"}`, "good");
    if (agent.rhythm.drift >= 78) push("routine-drift", "Routine Drift", `${agent.rhythm.identity}, drift ${agent.rhythm.drift}`, "bad");
    else if (agent.rhythm.drift >= 62) push("routine-wobble", "Routine Wobble", `${agent.rhythm.identity}, drift ${agent.rhythm.drift}`, "warn");
    else if (agent.rhythm.momentum >= 74 || agent.rhythm.streak >= 3) push("routine-momentum", "Routine Momentum", `${agent.rhythm.identity}, streak ${agent.rhythm.streak}`, "good");
    if (agent.emotion.composure <= 24 || agent.emotion.irritation >= 86) push("emotion-frayed", "Frayed", `composure ${agent.emotion.composure} / irritation ${agent.emotion.irritation}`, "bad");
    else if (agent.emotion.composure <= 38 || agent.emotion.irritation >= 72) push("emotion-tense", "Tense", `composure ${agent.emotion.composure} / irritation ${agent.emotion.irritation}`, "warn");
    if (agent.emotion.loneliness >= 84) push("lonely", "Lonely", `loneliness ${agent.emotion.loneliness}`, "bad");
    else if (agent.emotion.loneliness >= 68) push("isolated", "Isolated", `loneliness ${agent.emotion.loneliness}`, "warn");
    if (agent.emotion.hope <= 24) push("low-hope", "Low Hope", `hope ${agent.emotion.hope}`, "bad");
    else if (agent.emotion.hope >= 76) push("hopeful", "Hopeful", `hope ${agent.emotion.hope}`, "good");
    if (agent.emotion.confidence >= 78 && agent.emotion.composure >= 52) push("confident", "Confident", `confidence ${agent.emotion.confidence}`, "good");
    else if (agent.emotion.confidence <= 26) push("low-confidence", "Low Confidence", `confidence ${agent.emotion.confidence}`, "warn");
    if (agent.rentDue > 0) push("rent-due", "Rent Due", `${agent.rentDue} credits owed`, liquidFunds >= agent.rentDue ? "warn" : "bad");
    if (agent.budget.livingCostDue > 0) {
      push(
        "living-costs",
        "Living Costs",
        `${agent.budget.livingCostDue} credits for utilities and basics`,
        liquidFunds >= agent.budget.livingCostDue ? "warn" : "bad"
      );
    }
    if (agent.medical.isHospitalized) push("hospitalized", "Hospitalized", `recovering at ${agent.medical.facilityName ?? "clinic"}`, "bad");
    if (agent.medical.minorIllness.active) {
      push(
        "minor-illness",
        agent.medical.minorIllness.label ?? "Under Weather",
        `${Math.round(agent.medical.minorIllness.severity)} severity`,
        agent.medical.minorIllness.severity >= 54 ? "bad" : "warn"
      );
    }
    if (agent.medical.aftercare.active) {
      const aftercare = agent.medical.aftercare;
      const overdue = aftercare.expiresWorldMinutes > 0 && this.worldMinutes >= aftercare.expiresWorldMinutes;
      const followUpDue = aftercare.followUpDueWorldMinutes > 0 && this.worldMinutes >= aftercare.followUpDueWorldMinutes;
      push(
        "aftercare",
        aftercare.label ?? "Aftercare",
        `${aftercare.dosesRemaining} doses / ${Math.round(aftercare.restMinutesRemaining)} rest min`,
        overdue ? "bad" : followUpDue || aftercare.dosesRemaining > 0 ? "warn" : "neutral"
      );
    }
    if (agent.medicalDebt > 0) {
      const tone = liquidFunds >= agent.medicalDebt ? "warn" : "bad";
      const detail =
        agent.money >= agent.medicalDebt
          ? `${agent.medicalDebt} credits owed`
          : liquidFunds >= agent.medicalDebt
            ? `${agent.medicalDebt} owed, cash + savings can clear it`
            : `${agent.medicalDebt} credits owed`;
      push("medical-debt", "Medical Bill", detail, tone);
    }
    if (totalBillsDue > Math.max(18, liquidFunds * 1.8)) push("overextended", "Overextended", `${totalBillsDue} bills vs ${Math.round(liquidFunds)} liquid`, "bad");
    if (totalBillsDue > 0 && liquidFunds - totalBillsDue < 0) {
      push("cashflow-gap", "Cashflow Gap", `${Math.abs(Math.round((liquidFunds - totalBillsDue) * 100) / 100)} credits short`, "bad");
    }
    if (agent.budget.lateFeesToday > 0) push("late-fee", "Late Fee", `${agent.budget.lateFeesToday} added today`, "bad");
    else if (agent.budget.overdueBillDays > 0) {
      push(
        "overdue-bills",
        "Overdue Bills",
        `${agent.budget.overdueBillDays} day${agent.budget.overdueBillDays === 1 ? "" : "s"} overdue`,
        agent.budget.overdueBillDays >= 2 ? "bad" : "warn"
      );
    }
    if (agent.budget.hardshipDeferrals > 0) {
      push(
        "payment-plan",
        "Payment Plan",
        `${agent.budget.hardshipDeferrals} protected day${agent.budget.hardshipDeferrals === 1 ? "" : "s"} left`,
        "good"
      );
    }
    if (agent.budget.creditScore < 520) push("credit-risk", "Credit Risk", `score ${agent.budget.creditScore}`, "bad");
    else if (agent.budget.creditScore >= 700) push("credit-strong", "Good Credit", `score ${agent.budget.creditScore}`, "good");
    if (agent.budget.savings < Math.min(agent.budget.savingsGoal * 0.35, agent.budget.dailySpendLimit)) {
      push("low-savings", "Low Savings", `${agent.budget.savings}/${agent.budget.savingsGoal} saved`, "warn");
    } else if (agent.budget.savings >= agent.budget.savingsGoal) {
      push("saver", "Savings Goal", `${agent.budget.savings} saved`, "good");
    }
    if (agent.aspiration.pressure >= 70) push("aspiration-pressure", "Long Game", `${agent.aspiration.label} needs attention`, agent.aspiration.tone);
    else if (agent.aspiration.progress >= 82) push("aspiration-close", "Near Milestone", agent.aspiration.milestone, "good");
    if (agent.budget.spentToday > agent.budget.dailySpendLimit) {
      push("over-budget", "Over Budget", `${Math.round(agent.budget.spentToday - agent.budget.dailySpendLimit)} over`, "warn");
    }
    const supportDebt = Object.values(agent.relationshipDetails)
      .filter((relationship) => relationship.supportBalance > 0)
      .sort((a, b) => b.supportBalance - a.supportBalance)[0];
    if (supportDebt) {
      push(
        "support-debt",
        "Owes Support",
        `${supportDebt.supportBalance} to ${supportDebt.agentName}`,
        supportDebt.supportBalance >= 5 ? "warn" : "neutral"
      );
    }
    if (agent.socialCompass.stance === "strained") {
      push("social-strain", "Social Strain", agent.socialCompass.detail, agent.socialCompass.tension >= 84 || agent.socialCompass.supportOwed >= 7 ? "bad" : "warn");
    } else if (agent.socialCompass.stance === "guarded") {
      push("guarded", "Guarded", agent.socialCompass.detail, "warn");
    } else if (agent.socialCompass.stance === "anchored" && agent.socialCompass.anchorName) {
      push("anchored", "Anchored", agent.socialCompass.anchorName, "good");
    } else if (agent.socialCompass.stance === "seeking") {
      push("seeking-connection", "Seeking People", agent.socialCompass.detail, "neutral");
    } else if (agent.socialCompass.stance === "generous") {
      push("generous", "Generous", `${agent.socialCompass.supportGiven} support given`, "good");
    }
    if (agent.money < 8) push("low-money", "Low Credits", `${agent.money} credits left`, "warn");
    if (agent.household.pantry <= 0 && agent.hunger > 52) push("empty-pantry", "Empty Pantry", "no food stored at home", "warn");
    else if (agent.household.pantry >= Math.max(2, agent.household.pantryCapacity - 1)) {
      push("stocked-pantry", "Stocked Pantry", `${agent.household.pantry}/${agent.household.pantryCapacity} meals`, "good");
    }
    if (agent.household.toiletries <= 0) push("no-toiletries", "No Toiletries", "washing will be rough", "warn");
    else if (agent.household.toiletries <= 1) push("low-toiletries", "Low Toiletries", `${agent.household.toiletries} left`, "neutral");
    if (agent.household.cleaningSupplies <= 0) push("no-cleaning-supplies", "No Cleaning Supplies", "chores are less effective", "warn");
    else if (agent.household.cleaningSupplies <= 1) push("low-cleaning-supplies", "Low Cleaning", `${agent.household.cleaningSupplies} left`, "neutral");
    if (agent.household.clutter >= 72) push("cluttered-home", "Cluttered Home", `clutter ${Math.round(agent.household.clutter)}`, "warn");
    if (agent.household.laundry >= 72) push("laundry-pile", "Laundry Pile", `laundry ${Math.round(agent.household.laundry)}`, "warn");
    if (agent.household.sleepQuality >= 76 && agent.routine.sleptToday) push("good-sleep", "Good Sleep", `sleep quality ${Math.round(agent.household.sleepQuality)}`, "good");
    if (agent.hunger > 82) push("hungry", "Hungry", `food need ${Math.round(agent.hunger)}`, "bad");
    else if (agent.hunger < 38 && agent.routine.ateToday) push("fed", "Fed", "ate today", "good");
    if (agent.nutrition.hydration < 24) push("dehydrated", "Dehydrated", `hydration ${Math.round(agent.nutrition.hydration)}`, "bad");
    else if (agent.nutrition.hydration < 42) push("low-hydration", "Low Hydration", `hydration ${Math.round(agent.nutrition.hydration)}`, "warn");
    if (agent.nutrition.quality < 30 || agent.nutrition.variety < 24) {
      push("poor-diet", "Poor Diet", `quality ${Math.round(agent.nutrition.quality)} / variety ${Math.round(agent.nutrition.variety)}`, "warn");
    } else if (agent.nutrition.quality >= 70 && agent.nutrition.variety >= 58 && agent.routine.mealsToday > 0) {
      push("balanced-meal", "Balanced Meal", agent.nutrition.lastMealLabel ?? "ate well today", "good");
    }
    if (agent.leisure.boredom > 82 || agent.leisure.fun < 22) {
      push("bored", "Bored", `fun ${Math.round(agent.leisure.fun)} / boredom ${Math.round(agent.leisure.boredom)}`, "warn");
    } else if (agent.leisure.fun >= 72 && agent.routine.recreationToday > 0) {
      push("recharged", "Recharged", agent.leisure.hobby.replace(/_/g, " "), "good");
    }
    if (agent.leisure.curiosity > 82) push("curious", "Curious", `${Math.round(agent.leisure.curiosity)} curiosity`, "neutral");
    if (agent.energy < 28) push("tired", "Tired", `energy ${Math.round(agent.energy)}`, "warn");
    if (agent.sleep.sleepDebt > 78) push("sleep-debt", "Sleep Debt", `debt ${Math.round(agent.sleep.sleepDebt)}`, "bad");
    else if (agent.sleep.sleepDebt > 58) push("sleepy", "Sleepy", `debt ${Math.round(agent.sleep.sleepDebt)}`, "warn");
    if (agent.sleep.circadianFatigue > 82) push("off-rhythm", "Off Rhythm", `${Math.round(agent.sleep.circadianFatigue)} rhythm fatigue`, "warn");
    else if (agent.sleep.sleepDebt < 28 && agent.sleep.circadianFatigue < 36 && agent.routine.sleptToday) {
      push("well-rested", "Well Rested", `${agent.sleep.hoursSleptLastNight}h sleep`, "good");
    }
    if (agent.health < 62) push("unwell", "Unwell", `health ${Math.round(agent.health)}`, "bad");
    if (agent.stress > 68) push("stressed", "Stressed", `stress ${Math.round(agent.stress)}`, "bad");
    else if (agent.stress < 24) push("calm", "Calm", "stress is low", "good");
    if (condition.load >= 72) push("condition-drag", "Dragging", `${condition.load} body strain`, "bad");
    else if (condition.load >= 46) push("condition-load", "Worn Down", `${condition.load} body strain`, "warn");
    else if (condition.recovery >= 18 && agent.hunger < 64 && agent.energy > 58) push("steady-body", "Steady", `${condition.recovery} recovery buffer`, "good");
    if (this.isWeatherExposed(agent) && (this.latestWeather.tone === "warn" || this.latestWeather.tone === "bad")) {
      push("weather-exposure", this.latestWeather.label, this.latestWeather.detail, this.latestWeather.tone);
    }
    if (agent.social < 28 && agent.dna.sociability > 55) push("lonely", "Lonely", "wants company", "warn");
    if (agent.hygiene < 24) push("messy", "Needs Wash", `hygiene ${Math.round(agent.hygiene)}`, "warn");
    if (agent.outfit.cleanliness < 28) push("dirty-outfit", "Dirty Clothes", `clean ${Math.round(agent.outfit.cleanliness)}`, "warn");
    else if (agent.outfit.cleanliness >= 76 && agent.outfit.confidence >= 62) push("fresh-fit", "Fresh Fit", `${agent.outfit.style}, confidence ${Math.round(agent.outfit.confidence)}`, "good");
    if (agent.outfit.wear > 78) push("worn-outfit", "Worn Fit", `wear ${Math.round(agent.outfit.wear)}`, "warn");
    if (agent.routine.workedToday) push("worked", "Shift Done", `earned ${agent.routine.earningsToday}`, "good");
    if (agent.routine.sickLeaveToday) push("sick-day", "Sick Day", agent.routine.sickLeaveReason ?? "called in sick", agent.routine.earningsToday > 0 ? "good" : "warn");
    if (agent.career.burnout >= 72) push("burnout", "Burnout", `${agent.career.burnout} strain`, "bad");
    else if (agent.career.performance >= 76) push("performer", "Strong Work", `${agent.career.performance} performance`, "good");
    if (agent.career.attendanceStreak >= 3) push("streak", "Work Streak", `${agent.career.attendanceStreak} shifts`, "good");
    if (agent.routine.maintenanceToday > 0 && agent.routine.lastMaintenance) {
      push("maintained", "Useful Work", agent.routine.lastMaintenance, "good");
    }
    if (agent.civic.serviceImpactToday > 0) {
      push("public-service", "Public Service", `${agent.civic.serviceImpactToday} impact`, agent.civic.serviceImpactToday >= 12 ? "good" : "neutral");
    }
    if (agent.civic.serviceReputation >= 72) push("trusted-worker", "Trusted Worker", `service rep ${agent.civic.serviceReputation}`, "good");
    if (agent.routine.bondsToday > 0) push("bonded", "Bonded", `${agent.routine.bondsToday} good moment${agent.routine.bondsToday === 1 ? "" : "s"}`, "good");
    if (agent.routine.deescalationsToday > 0) {
      push("deescalated", "Kept Cool", `${agent.routine.deescalationsToday} calm moment${agent.routine.deescalationsToday === 1 ? "" : "s"}`, "good");
    }
    if (agent.routine.conflictsToday > 0) push("conflict", "Conflict", `${agent.routine.conflictsToday} tense moment${agent.routine.conflictsToday === 1 ? "" : "s"}`, "bad");
    if (agent.reputation.trouble >= 62) push("public-trouble", "Town Heat", `trouble ${agent.reputation.trouble}`, "warn");
    if (agent.reputation.reliability >= 72) push("public-reliable", "Reliable", `rep ${agent.reputation.reliability}`, "good");
    if (agent.reputation.warmth >= 72) push("public-warm", "Well Liked", `warmth ${agent.reputation.warmth}`, "good");
    if (agent.reputation.ambition >= 74) push("public-driven", "Driven", `ambition ${agent.reputation.ambition}`, "good");
    if (currentObject && currentObject.crowdPressure >= 48) {
      const liveCount = currentObject.occupants + currentObject.queued;
      push("crowded", "Crowded", `${liveCount} near ${currentObject.label.replace(/^.*?:\s*/, "")}`, currentObject.crowdPressure >= 76 ? "bad" : "warn");
    }
    const urgentCommitment = agent.commitments.find((commitment) => commitment.status === "missed" || commitment.status === "due");
    if (urgentCommitment) {
      push(
        "commitment",
        urgentCommitment.status === "missed" ? "Missed Plan" : "Due Soon",
        `${urgentCommitment.label} ${urgentCommitment.windowLabel}`,
        urgentCommitment.status === "missed" || urgentCommitment.tone === "bad" ? "bad" : "warn"
      );
    }
    if (agent.socialFocus?.intent === "seek") push("seeking", "Seeking", agent.socialFocus.agentName, "good");
    if (agent.socialFocus?.intent === "avoid") push("avoiding", "Avoiding", agent.socialFocus.agentName, "warn");
    if (this.currentPhase === "evening" && agent.eveningPlan.day === this.currentDay && agent.eveningPlan.intent !== "none") {
      push(
        "evening-plan",
        agent.eveningPlan.resolved ? "Evening Done" : "Evening Plan",
        agent.eveningPlan.resolved ? agent.eveningPlan.outcome : agent.eveningPlan.label,
        agent.eveningPlan.outcome === "conflict" || agent.eveningPlan.intent === "avoid_rival" ? "warn" : agent.eveningPlan.resolved ? "good" : "neutral"
      );
    }
    if (effects.length === 0) push("stable", "Stable", "no urgent pressure", "neutral");

    const severity: Record<AgentStatusEffect["tone"], number> = { bad: 4, warn: 3, good: 2, neutral: 1 };
    const priority: Record<string, number> = {
      hospitalized: 90,
      "personal-notice": 88,
      "late-fee": 86,
      "payment-plan": 84,
      "overdue-bills": 82,
      "medical-debt": 80,
      overextended: 78,
      "cashflow-gap": 76,
      "rent-due": 74,
      "living-costs": 72,
      "minor-illness": 70,
      "health-followup": 69,
      "schedule-slip": 69,
      "life-admin-load": 68,
      rushed: 68,
      "routine-drift": 68,
      "emotion-frayed": 68,
      aftercare: 68,
      commitment: 66,
      "supply-run": 65,
      "time-pressure": 65,
      "late-window": 65,
      "routine-wobble": 65,
      "low-hope": 65,
      lonely: 65,
      "emotion-tense": 64,
      "social-strain": 64,
      "support-debt": 64,
      "home-admin": 63,
      guarded: 63,
      dehydrated: 63,
      anchored: 62,
      "poor-diet": 62,
      "sleep-debt": 61,
      "off-rhythm": 60
    };
    return effects.sort((a, b) => (priority[b.id] ?? 0) - (priority[a.id] ?? 0) || severity[b.tone] - severity[a.tone]).slice(0, 5);
  }

  private startNewDay(agent: SimAgent) {
    const recap = this.dailyRecap(agent);
    this.addMemory(agent, "reflection", recap, 7, ["reflection", "routine", "day"]);
    this.log(agent, `${agent.name} starts Day ${this.currentDay}: ${this.publicDailyRecap(agent)}.`, "routine", agent.routine.conflictsToday > 0 ? "warn" : "neutral", 6);

    const missedWork = !agent.routine.workedToday && !agent.routine.sickLeaveToday && agent.money < 24;
    if (missedWork) {
      agent.stress = clamp(agent.stress + 8);
      agent.mood = clamp(agent.mood - 5);
      agent.career.missedShifts += 1;
      agent.career.attendanceStreak = 0;
      agent.career.performance = Math.round(clamp(agent.career.performance - 6));
      agent.career.satisfaction = Math.round(clamp(agent.career.satisfaction - 3));
      agent.career.recent.unshift(`${this.worldTime} Missed a needed shift.`);
      agent.career.recent.splice(4);
      this.relationships.adjustReputation(agent, { reliability: -3, trouble: 1 });
      this.addMemory(agent, "event", "Started a new day worried about yesterday's missed work.", 6, ["work", "stress"]);
    } else if (agent.routine.sickLeaveToday) {
      agent.career.recent.unshift(`${this.worldTime} Sick day logged.`);
      agent.career.recent.splice(4);
      this.addMemory(agent, "reflection", `Yesterday became a sick day because of ${agent.routine.sickLeaveReason ?? "health"}.`, 5, ["work", "health", "routine"]);
    }
    this.reviewSupportObligations(agent);
    if (agent.medicalDebt > 0) {
      agent.stress = clamp(agent.stress + Math.min(12, 4 + agent.medicalDebt * 0.08));
      this.addMemory(agent, "event", `Started the day with ${agent.medicalDebt} credits of medical debt.`, 7, ["health", "money", "debt"]);
      this.log(agent, `${agent.name} still has ${agent.medicalDebt} credits of medical debt.`, "health", "warn", 7);
    }
    agent.career.burnout = Math.round(clamp(agent.career.burnout + (agent.routine.sleptToday ? -8 : 5) + (agent.routine.workedToday ? 0 : -2)));
    if (agent.routine.sleptToday && agent.career.burnout < 42) {
      agent.career.satisfaction = Math.round(clamp(agent.career.satisfaction + 1));
    }
    this.reviewSleepRhythm(agent);
    this.reviewHousehold(agent);
    this.reviewDailyBudget(agent);
    this.reviewRoutineRhythm(agent);

    const sleptYesterday = agent.routine.sleptToday;
    agent.routine = this.spawns.createRoutine(this.currentDay);
    agent.time.rush = Math.round(clamp(agent.time.rush - (sleptYesterday ? 12 : 5)));
    agent.time.keptWindowsToday = 0;
    agent.time.lateWindowsToday = 0;
    agent.time.missedWindowsToday = 0;
    this.refreshTimeManagement(agent);
    agent.eveningPlan = this.spawns.createEveningPlan(this.currentDay);
    agent.budget.spentToday = 0;
    agent.budget.savedToday = 0;
    agent.budget.emergencyWithdrawalsToday = 0;
    agent.aspiration.dailyProgress = 0;
    agent.civic.serviceImpactToday = 0;
    agent.civic.demandResolvedToday = 0;
    agent.civic.pressureRelievedToday = 0;
    agent.civic.lastService = null;
    this.refreshAspiration(agent);
    this.chargeLivingCosts(agent);
    if (this.currentDay % 3 === 0) {
      agent.rentDue += 6;
      this.recordFinance(agent, 6, "housing", "Rent charged", "debt");
      agent.stress = clamp(agent.stress + 8);
      this.addMemory(agent, "event", "Rent is due at town hall.", 8, ["rent", "money"]);
      this.log(agent, `${agent.name} has 6 credits of rent due.`, "money", "warn", 8);
    }
    this.generateDailyPersonalNotices(agent);
    agent.dayPlan = this.spawns.buildDayPlan(agent);
    agent.commitments = this.spawns.buildDailyCommitments(agent, this.currentDay);
    this.refreshLifeAdmin(agent);
    this.addMemory(agent, "plan", `New day plan: ${agent.dayPlan.join(", ")}.`, 5, ["plan", "routine"]);
  }

  private reviewRoutineRhythm(agent: SimAgent) {
    const routine = agent.routine;
    const rhythm = agent.rhythm;
    const billsDue = this.totalBillsDue(agent);
    const socialExpected = agent.dna.sociability > 55 || agent.social < 52 || agent.lifeProfile.archetype === "Social Connector";
    const workHit = routine.workedToday || routine.sickLeaveToday || (agent.money >= 24 && agent.career.burnout > 76);
    const careHit = routine.mealsToday > 0 && (routine.washedToday || agent.hygiene >= 58) && (routine.sleptToday || agent.sleep.sleepDebt < 56);
    const homeHit =
      agent.household.choresDoneToday > 0 ||
      (agent.household.clutter < 64 && agent.household.laundry < 64 && agent.household.sleepQuality >= 50 && agent.household.pantry > 0);
    const socialHit = routine.bondsToday > 0 || routine.deescalationsToday > 0 || routine.socializedToday || (!socialExpected && routine.conflictsToday === 0);
    const financeHit =
      routine.paidRentToday ||
      agent.budget.savedToday > 0 ||
      (billsDue <= 0 && agent.budget.lateFeesToday === 0 && agent.budget.spentToday <= agent.budget.dailySpendLimit + 1);
    const hitCount = [workHit, careHit, homeHit, socialHit, financeHit].filter(Boolean).length;
    const friction =
      (workHit ? 0 : 1) +
      (careHit ? 0 : 1) +
      (homeHit ? 0 : 1) +
      (socialHit ? 0 : socialExpected ? 1 : 0.35) +
      (financeHit ? 0 : 1) +
      routine.conflictsToday * 0.8 +
      agent.time.missedWindowsToday * 1.4 +
      agent.time.lateWindowsToday * 0.55 +
      agent.budget.lateFeesToday * 0.45;
    const shift = (current: number, hit: boolean, missPenalty = 4.4, hitLift = 3.2) => clamp(current + (hit ? hitLift : -missPenalty));

    rhythm.work = shift(rhythm.work, workHit, agent.money < 12 ? 6 : 4.4, routine.workedToday ? 3.8 : 2.2);
    rhythm.care = shift(rhythm.care, careHit, agent.health < 62 || agent.sleep.sleepDebt > 72 ? 6 : 4.6, 3.4);
    rhythm.home = shift(rhythm.home, homeHit, agent.household.clutter > 74 || agent.household.laundry > 74 ? 6 : 4.4, agent.household.choresDoneToday > 0 ? 3.8 : 2.4);
    rhythm.social = shift(rhythm.social, socialHit, socialExpected ? 5 : 2, routine.bondsToday > 0 || routine.deescalationsToday > 0 ? 4 : 2.2);
    rhythm.finance = shift(rhythm.finance, financeHit, billsDue > 0 || agent.budget.lateFeesToday > 0 ? 6 : 3.4, agent.budget.savedToday > 0 || routine.paidRentToday ? 4 : 2.2);
    rhythm.momentum = clamp(rhythm.momentum + hitCount * 2.2 - friction * 2.2 + (routine.sleptToday ? 1.5 : 0) + (agent.time.keptWindowsToday > 0 ? 1.2 : 0));
    rhythm.drift = clamp(rhythm.drift + friction * 3.1 - hitCount * 1.7 + (routine.conflictsToday > 0 ? 3 : 0) + (agent.budget.lateFeesToday > 0 ? 3 : 0));
    if (hitCount >= 4 && agent.time.missedWindowsToday === 0 && routine.conflictsToday === 0) {
      rhythm.streak += 1;
      rhythm.strainDays = Math.max(0, rhythm.strainDays - 1);
    } else {
      rhythm.streak = hitCount <= 2 || agent.time.missedWindowsToday > 0 ? 0 : Math.max(0, rhythm.streak - 1);
      rhythm.strainDays = rhythm.drift >= 68 || hitCount <= 2 ? rhythm.strainDays + 1 : Math.max(0, rhythm.strainDays - 1);
    }
    this.refreshRoutineRhythm(agent);

    const wins = [
      workHit ? "work" : "",
      careHit ? "care" : "",
      homeHit ? "home" : "",
      socialHit ? "social" : "",
      financeHit ? "money" : ""
    ].filter(Boolean);
    const slips = [
      workHit ? "" : "work",
      careHit ? "" : "care",
      homeHit ? "" : "home",
      socialHit ? "" : "social",
      financeHit ? "" : "money"
    ].filter(Boolean);
    const note =
      hitCount >= 4
        ? `${this.worldTime} Rhythm held: ${wins.join(", ")}.`
        : hitCount <= 2
          ? `${this.worldTime} Rhythm slipped around ${slips.join(", ")}.`
          : `${this.worldTime} Rhythm stayed mixed: ${wins.join(", ")} held, ${slips.join(", ")} slipped.`;
    rhythm.recent.unshift(note);
    rhythm.recent.splice(4);

    if (hitCount >= 4 || rhythm.streak >= 3) {
      this.addMoodlet(agent, {
        id: "routine-momentum",
        label: "Routine Momentum",
        detail: `${rhythm.identity}; ${hitCount}/5 domains held yesterday`,
        tone: "good",
        intensity: Math.min(8, 3.5 + rhythm.streak * 0.8 + hitCount * 0.35),
        durationMinutes: 420,
        tags: ["routine", "rhythm", "momentum"],
        actionBiases: { working: 6, socializing: 4, building: rhythm.drift < 38 ? 4 : 0, budgeting: 3 },
        moodDelta: 1.5,
        stressDelta: -2
      });
      this.addMemory(agent, "reflection", `Routine momentum is building: ${wins.join(", ")} held yesterday.`, 6, ["routine", "rhythm", "momentum"]);
    } else if (hitCount <= 2 || rhythm.drift >= 72) {
      this.addMoodlet(agent, {
        id: "routine-drift",
        label: "Routine Drift",
        detail: `${rhythm.identity}; ${slips.join(", ")} need attention`,
        tone: rhythm.drift >= 78 ? "bad" : "warn",
        intensity: Math.min(8.5, 3.5 + rhythm.drift * 0.05 + slips.length * 0.45),
        durationMinutes: 480,
        tags: ["routine", "rhythm", "drift"],
        actionBiases: { resting: 8, cleaning: slips.includes("home") ? 10 : 3, budgeting: slips.includes("money") ? 10 : 4, washing: slips.includes("care") ? 8 : 2, working: slips.includes("work") ? 7 : -2 },
        moodDelta: -1,
        stressDelta: 2
      });
      this.addMemory(agent, "reflection", `Routine drift is visible: ${slips.join(", ")} slipped yesterday.`, 7, ["routine", "rhythm", "drift"]);
    }
  }

  private reviewSleepRhythm(agent: SimAgent) {
    if (!agent.routine.sleptToday) {
      agent.sleep.sleepDebt = Math.round(clamp(agent.sleep.sleepDebt + 18));
      agent.sleep.circadianFatigue = Math.round(clamp(agent.sleep.circadianFatigue + 14));
      agent.energy = clamp(agent.energy - 8);
      agent.stress = clamp(agent.stress + 5);
      agent.mood = clamp(agent.mood - 4);
      agent.sleep.hoursSleptLastNight = 0;
      agent.sleep.recent.unshift(`${this.worldTime} Missed the main sleep window; debt rose to ${agent.sleep.sleepDebt}.`);
      agent.sleep.recent.splice(4);
      this.addMemory(agent, "event", "Missed the main sleep window and started the day off rhythm.", 7, ["sleep", "routine", "energy"]);
      this.log(agent, `${agent.name} started the day with heavier sleep debt.`, "routine", "warn", 6);
      return;
    }

    if (agent.sleep.sleepDebt < 34 && agent.sleep.circadianFatigue < 42) {
      agent.energy = clamp(agent.energy + 4);
      agent.stress = clamp(agent.stress - 3);
      agent.mood = clamp(agent.mood + 2);
      agent.sleep.recent.unshift(`${this.worldTime} Sleep rhythm held: ${agent.sleep.hoursSleptLastNight}h, debt ${agent.sleep.sleepDebt}.`);
      agent.sleep.recent.splice(4);
      this.addMemory(agent, "reflection", "Good sleep made the next day feel more reachable.", 5, ["sleep", "routine", "mood"]);
    }
  }

  private reviewSupportObligations(agent: SimAgent) {
    const debts = Object.values(agent.relationshipDetails)
      .filter((relationship) => relationship.supportBalance > 0)
      .sort((a, b) => b.supportBalance - a.supportBalance || b.trust - a.trust);
    if (debts.length === 0) return;

    const lead = debts[0];
    if (!lead) return;
    const totalOwed = Math.round(debts.reduce((sum, relationship) => sum + Math.max(0, relationship.supportBalance), 0) * 10) / 10;
    const topAmount = Math.round(lead.supportBalance * 10) / 10;
    let totalStrain = 0;

    for (const relationship of debts.slice(0, 4)) {
      const amount = Math.round(relationship.supportBalance * 10) / 10;
      const strain = Math.round(clamp(1.4 + amount * 0.42 + Math.max(0, relationship.trust - 55) * 0.018, 1.5, 7) * 10) / 10;
      totalStrain += strain;
      relationship.score = Math.round(clamp(relationship.score - strain * 0.48, -100, 100) * 10) / 10;
      relationship.trust = Math.round(clamp(relationship.trust - (1 + amount * 0.32)));
      relationship.tension = Math.round(clamp(relationship.tension + 2 + amount * 0.58));
      relationship.lastGesture = "Favor hanging";
      relationship.lastEvent = `${amount} support still owed after a new day started.`;
      relationship.history.unshift(`${this.worldTime} Still owes ${relationship.agentName} ${amount} support.`);
      relationship.history.splice(4);
      agent.relationships[relationship.agentId] = relationship.score;

      const other = this.agents.get(relationship.agentId);
      if (!other) continue;
      const otherRel = this.relationships.relationshipFor(other, agent, this.worldTime);
      otherRel.score = Math.round(clamp(otherRel.score - strain * 0.38, -100, 100) * 10) / 10;
      otherRel.trust = Math.round(clamp(otherRel.trust - (1 + amount * 0.22)));
      otherRel.tension = Math.round(clamp(otherRel.tension + 2 + amount * 0.45));
      otherRel.lastGesture = "Waiting on support";
      otherRel.lastEvent = `${agent.name} still owes ${amount} support.`;
      otherRel.history.unshift(`${this.worldTime} Waiting on ${agent.name} to repay ${amount} support.`);
      otherRel.history.splice(4);
      other.relationships[agent.id] = otherRel.score;
      if (amount >= 3) {
        this.addMemory(other, "observation", `${agent.name} still owes ${amount} support, and it is starting to matter.`, 5, [
          "social",
          "support",
          "trust",
          agent.id
        ]);
      }
    }

    const stressHit = Math.min(10, 2 + totalOwed * 0.8 + debts.length * 1.2);
    agent.stress = clamp(agent.stress + stressHit);
    agent.mood = clamp(agent.mood - Math.min(7, 1 + totalOwed * 0.45));
    if (totalOwed >= 4) this.relationships.adjustReputation(agent, { reliability: -1, warmth: -1 });
    this.addMoodlet(agent, {
      id: "favor-hanging",
      label: "Favor Hanging",
      detail: `${topAmount} support still owed to ${lead.agentName}`,
      tone: totalOwed >= 6 ? "warn" : "neutral",
      intensity: Math.min(7, 3 + totalOwed * 0.45),
      durationMinutes: 300,
      tags: ["social", "support", "money", "trust"],
      actionBiases: { socializing: 14, working: 5, budgeting: 3, resting: -3 },
      moodDelta: 0,
      stressDelta: 0
    });
    this.recordSocialMoment(agent, {
      kind: "support_strain",
      label: "Favor Hanging",
      detail: `${lead.agentName} is still waiting on ${topAmount} support.`,
      tone: totalOwed >= 6 ? "warn" : "neutral",
      otherAgentId: lead.agentId,
      otherAgentName: lead.agentName,
      scoreDelta: -Math.round(totalStrain * 4) / 10,
      trustDelta: -Math.min(5, Math.round(totalOwed * 0.4)),
      supportDelta: 0,
      tags: ["social", "support", "trust"],
      durationMinutes: 420
    });
    this.addMemory(agent, "event", `A new day started with ${totalOwed} support still owed. ${lead.agentName} is waiting on ${topAmount}.`, 7, [
      "social",
      "support",
      "money",
      "trust"
    ]);
    this.log(agent, `${agent.name} started the day with support still owed to ${lead.agentName}.`, "social", totalOwed >= 6 ? "warn" : "neutral", 6);
  }

  private chargeLivingCosts(agent: SimAgent) {
    const budget = agent.budget;
    if (this.currentDay < budget.nextLivingCostDay) return;
    const weatherSurcharge = this.latestWeather.kind === "heat" || this.latestWeather.kind === "cold" ? 1 : 0;
    const homeSurcharge = agent.household.clutter > 78 || agent.household.laundry > 78 ? 1 : 0;
    const charge = Math.max(1, Math.round(budget.livingCostBase + weatherSurcharge + homeSurcharge));
    budget.livingCostDue = Math.round((budget.livingCostDue + charge) * 100) / 100;
    budget.nextLivingCostDay = this.currentDay + Math.max(1, budget.livingCostCadenceDays);
    budget.lastLivingCostLabel = `${charge} utilities and basics due`;
    this.recordFinance(agent, charge, "housing", "Utilities and basics due", "debt");
    agent.stress = clamp(agent.stress + Math.min(5, 1 + charge * 0.55));
    this.addMemory(agent, "event", `Utilities and basics added ${charge} credits to the civic account.`, 6, ["money", "living-costs", "bills"]);
    this.log(agent, `${agent.name} has ${charge} credits of living costs due.`, "money", "warn", 6);
  }

  private reviewHousehold(agent: SimAgent) {
    const household = agent.household;
    const choresHandled = agent.routine.washedToday || household.choresDoneToday > 0;
    const quality = Math.round(
      clamp(42 + household.homeComfort * 0.34 - household.clutter * 0.2 - household.laundry * 0.1 + (agent.routine.sleptToday ? 24 : -8))
    );
    household.sleepQuality = quality;
    household.clutter = Math.round(clamp(household.clutter + (agent.routine.mealsToday > 0 ? 4 : 0) + (agent.routine.sleptToday ? 4 : 1) - (choresHandled ? 7 : 0)));
    household.laundry = Math.round(clamp(household.laundry + (agent.routine.workedToday ? 8 : 3) + (agent.routine.washedToday ? -10 : 0)));
    household.homeComfort = Math.round(clamp(household.homeComfort + (quality >= 72 ? 2 : quality < 42 ? -3 : 0) - (household.clutter > 78 ? 2 : 0)));
    const housingPressure = agent.rentDue + agent.budget.livingCostDue;
    household.rentStress = Math.round(clamp(housingPressure > 0 ? 22 + housingPressure * 2 : household.rentStress - 8));
    household.choresDoneToday = 0;
    household.lastHomeCare = this.worldTime;

    if (quality < 42) {
      agent.energy = clamp(agent.energy - 3);
      agent.mood = clamp(agent.mood - 2);
      agent.stress = clamp(agent.stress + 4);
      household.recent.unshift(`${this.worldTime} Poor sleep made the apartment feel heavier.`);
      this.addMemory(agent, "event", "Home conditions made sleep less restorative.", 5, ["home", "sleep", "comfort"]);
    } else if (quality >= 76 && agent.routine.sleptToday) {
      agent.mood = clamp(agent.mood + 2);
      agent.stress = clamp(agent.stress - 3);
      household.recent.unshift(`${this.worldTime} Good sleep made home feel stable.`);
    } else if (choresHandled) {
      household.recent.unshift(`${this.worldTime} Basic chores kept home manageable.`);
    }
    if (household.pantry <= 0 && agent.routine.mealsToday === 0) {
      household.recent.unshift(`${this.worldTime} The pantry ended the day empty.`);
    }
    if (household.toiletries <= 0 || household.cleaningSupplies <= 0) {
      const missing = household.toiletries <= 0 && household.cleaningSupplies <= 0 ? "toiletries and cleaning supplies" : household.toiletries <= 0 ? "toiletries" : "cleaning supplies";
      household.recent.unshift(`${this.worldTime} Home ran out of ${missing}.`);
      agent.stress = clamp(agent.stress + 2);
      this.addMemory(agent, "observation", `Home ran out of ${missing}, making routine care harder.`, 5, ["home", "supplies", "routine"]);
    }
    if (household.laundry > 70 && agent.outfit.cleanliness < 52) {
      agent.outfit.confidence = Math.round(clamp(agent.outfit.confidence - 3));
      agent.outfit.recent.unshift(`${this.worldTime} Laundry pile made the fit feel harder to carry.`);
      agent.outfit.recent.splice(4);
    }
    this.refreshOutfitConfidence(agent);
    household.recent.splice(4);
  }

  private reviewDailyBudget(agent: SimAgent) {
    const due = this.totalBillsDue(agent);
    const overBudget = Math.max(0, agent.budget.spentToday - agent.budget.dailySpendLimit);
    agent.budget.lateFeesToday = 0;
    if (due > 0) {
      agent.budget.missedBillCount += 1;
      agent.budget.onTimeBillStreak = 0;
      const hadDeferral = agent.budget.hardshipDeferrals > 0;
      if (hadDeferral) agent.budget.hardshipDeferrals = Math.max(0, agent.budget.hardshipDeferrals - 1);
      else agent.budget.overdueBillDays += 1;

      const housingLateBase = agent.rentDue + agent.budget.livingCostDue;
      const lateFee =
        !hadDeferral && agent.budget.overdueBillDays >= 2 && housingLateBase > 0
          ? Math.min(8, Math.max(1, Math.round((housingLateBase * 0.08 + agent.budget.overdueBillDays * 0.5) * 100) / 100))
          : 0;
      if (lateFee > 0) {
        agent.budget.livingCostDue = Math.round((agent.budget.livingCostDue + lateFee) * 100) / 100;
        agent.budget.lateFeesToday = lateFee;
        agent.budget.lastLivingCostLabel = `${lateFee} late fee added`;
        this.recordFinance(agent, lateFee, "housing", "Late fee added", "debt");
      }

      const creditPenalty = hadDeferral ? Math.min(10, 3 + due * 0.18) : Math.min(34, 10 + due * 0.6 + lateFee * 1.5);
      this.adjustCredit(agent, -creditPenalty, hadDeferral ? `${due} bills protected by payment plan` : `${due} credits stayed unpaid overnight`);
      agent.stress = clamp(agent.stress + (hadDeferral ? Math.min(7, 2 + due * 0.06) : Math.min(16, 5 + due * 0.12 + lateFee)));
      this.relationships.adjustReputation(agent, hadDeferral ? { reliability: -1 } : { reliability: -2, trouble: 1 });
      if (hadDeferral) {
        this.addMemory(agent, "event", `A payment plan kept ${due} credits of bills from adding a late fee overnight.`, 6, ["money", "credit", "bills"]);
        this.log(agent, `${agent.name}'s payment plan protected their bills overnight.`, "money", "neutral", 6);
      } else {
        const feeLine = lateFee > 0 ? ` A ${lateFee}-credit late fee was added.` : "";
        this.addMemory(agent, "event", `${due} credits of bills carried into a new day and hurt civic credit.${feeLine}`, 8, ["money", "credit", "debt"]);
        this.log(agent, `${agent.name} carried ${due} credits of unpaid bills into the new day.${feeLine}`, "money", lateFee > 0 ? "bad" : "warn", lateFee > 0 ? 8 : 7);
      }
    } else if (agent.routine.paidRentToday || agent.budget.spentToday > 0 || agent.budget.savedToday > 0) {
      agent.budget.overdueBillDays = 0;
      agent.budget.hardshipDeferrals = 0;
      const creditGain = agent.routine.paidRentToday ? 8 : agent.budget.savedToday > 0 ? 3 : 1;
      agent.budget.onTimeBillStreak += agent.routine.paidRentToday ? 1 : 0;
      this.adjustCredit(agent, creditGain, agent.routine.paidRentToday ? "Bills handled on time" : "Kept spending manageable");
    } else {
      agent.budget.overdueBillDays = 0;
      agent.budget.hardshipDeferrals = 0;
    }

    if (overBudget > 0) {
      agent.stress = clamp(agent.stress + Math.min(8, overBudget * 0.55));
      agent.mood = clamp(agent.mood - Math.min(5, overBudget * 0.28));
      this.addMemory(agent, "reflection", `Overspent by ${Math.round(overBudget)} credits and felt less secure.`, 5, ["money", "budget"]);
    }

    if (agent.budget.savedToday > 0 && agent.budget.savings >= Math.min(agent.budget.savingsGoal, agent.budget.dailySpendLimit * 2)) {
      this.adjustCredit(agent, 2, "Savings cushion improved");
      agent.stress = clamp(agent.stress - 2);
    }
  }

  private advanceAspiration(agent: SimAgent, amount: number, label: string, signals: string[]) {
    const aspiration = agent.aspiration;
    const actionFit = aspiration.actions.includes(agent.currentAction);
    const signalFit = signals.some((signal) => aspiration.signals.includes(signal));
    if (!actionFit && !signalFit) return 0;

    const gain = Math.max(0, Math.round(amount * (actionFit ? 1 : 0.6) * (signalFit ? 1 : 0.72) * 10) / 10);
    if (gain <= 0) return 0;

    aspiration.progress = Math.round((aspiration.progress + gain) * 10) / 10;
    aspiration.dailyProgress = Math.round((aspiration.dailyProgress + gain) * 10) / 10;
    aspiration.lastProgressWorldTime = this.worldTime;
    aspiration.history.unshift(`${this.worldTime} +${gain} ${label}`);
    aspiration.history.splice(4);

    if (aspiration.progress >= 100) {
      aspiration.progress = Math.round((aspiration.progress - 100) * 10) / 10;
      aspiration.level += 1;
      aspiration.history.unshift(`${this.worldTime} Level ${aspiration.level}: ${aspiration.label}`);
      aspiration.history.splice(4);
      agent.mood = clamp(agent.mood + 8);
      agent.stress = clamp(agent.stress - 8);
      this.addMemory(agent, "reflection", `${aspiration.label} became more real: ${label}.`, 9, ["aspiration", aspiration.id, ...signals]);
      this.log(agent, `${agent.name} reached a new step in ${aspiration.label}.`, "routine", "good", 8);
    }

    this.refreshAspiration(agent);
    return gain;
  }

  private advanceSkill(agent: SimAgent, skillId: AgentSkillId, amount: number, label: string, tags: string[] = []) {
    const skill = agent.skills[skillId];
    const aptitudeMultiplier = 0.82 + skill.aptitude / 125;
    const xpGain = Math.max(0.2, Math.round(amount * aptitudeMultiplier * 10) / 10);
    skill.xp = Math.round((skill.xp + xpGain) * 10) / 10;
    let leveled = false;

    while (skill.xp >= skill.xpToNext) {
      skill.xp = Math.round((skill.xp - skill.xpToNext) * 10) / 10;
      skill.level += 1;
      skill.xpToNext = Math.round(skill.xpToNext * 1.34 + 16 + skill.level * 3);
      skill.recent.unshift(`${this.worldTime} Level ${skill.level}: ${label}`);
      leveled = true;
    }

    if (!leveled) skill.recent.unshift(`${this.worldTime} +${xpGain} ${label}`);
    skill.recent.splice(4);

    if (leveled) {
      agent.mood = clamp(agent.mood + 3);
      agent.stress = clamp(agent.stress - 2);
      this.addMemory(agent, "reflection", `${skill.label} improved to level ${skill.level}: ${label}.`, 7, ["skill", skillId, ...tags]);
      this.log(agent, `${agent.name} improved ${skill.label} to level ${skill.level}.`, "routine", "good", 6);
    }

    return { xpGain, leveled, level: skill.level };
  }

  private refreshAspiration(agent: SimAgent) {
    const aspiration = agent.aspiration;
    const phasePressure = this.currentPhase === "evening" ? 22 : this.currentPhase === "workday" ? 12 : this.currentPhase === "night" ? 8 : 5;
    const neglectPressure = aspiration.dailyProgress > 0 ? -Math.min(18, aspiration.dailyProgress * 1.8) : phasePressure;
    aspiration.pressure = Math.round(clamp(12 + (100 - aspiration.progress) * 0.22 + neglectPressure));
    aspiration.tone = aspiration.progress >= 82 ? "good" : aspiration.pressure >= 74 ? "bad" : aspiration.pressure >= 52 ? "warn" : "neutral";
    aspiration.milestone = `${Math.max(0, Math.round(100 - aspiration.progress))} progress to level ${aspiration.level + 1}`;
  }

  private dailyRecap(agent: SimAgent) {
    const routine = agent.routine;
    const pieces = [
      routine.workedToday ? `earned ${routine.earningsToday} credits` : routine.sickLeaveToday ? `called in sick for ${routine.sickLeaveReason ?? "health"}` : "missed work",
      routine.maintenanceToday > 0 && routine.lastMaintenance ? `kept ${routine.lastMaintenance.toLowerCase()} running` : "",
      routine.mealsToday > 0
        ? `ate ${routine.mealsToday} meal${routine.mealsToday === 1 ? "" : "s"} with nutrition ${Math.round(agent.nutrition.quality)} and hydration ${Math.round(agent.nutrition.hydration)}`
        : "did not eat enough",
      routine.recreationToday > 0 ? `made time for ${routine.recreationToday} leisure beat${routine.recreationToday === 1 ? "" : "s"}` : "did not really unwind",
      routine.bondsToday > 0 ? `had ${routine.bondsToday} good social moment${routine.bondsToday === 1 ? "" : "s"}` : "kept mostly to themself"
    ].filter(Boolean);
    if (routine.conflictsToday > 0) pieces.push(`had ${routine.conflictsToday} conflict${routine.conflictsToday === 1 ? "" : "s"}`);
    if (routine.deescalationsToday > 0) {
      pieces.push(`kept calm through ${routine.deescalationsToday} tense moment${routine.deescalationsToday === 1 ? "" : "s"}`);
    }
    if (routine.medicalVisitToday) pieces.push("visited the clinic");
    if (agent.medical.minorIllness.active) pieces.push(`felt ${agent.medical.minorIllness.label?.toLowerCase() ?? "under the weather"}`);
    if (agent.medicalDebt > 0) pieces.push(`carried ${agent.medicalDebt} credits of medical debt`);
    if (agent.budget.livingCostDue > 0) pieces.push(`carried ${agent.budget.livingCostDue} credits of living costs`);
    if (agent.budget.lateFeesToday > 0) pieces.push(`got hit with ${agent.budget.lateFeesToday} credits of late fees`);
    else if (agent.budget.hardshipDeferrals > 0) pieces.push("kept bills protected by a payment plan");
    if (agent.household.pantry <= 0) pieces.push("ended with an empty pantry");
    if (agent.nutrition.hydration < 34) pieces.push("felt dehydrated");
    if (agent.nutrition.quality < 34 || agent.nutrition.variety < 28) pieces.push("ate poorly enough to feel it");
    if (agent.leisure.boredom > 78 || agent.leisure.fun < 28) pieces.push("felt bored enough for the day to drag");
    if (agent.autonomy.overwhelm > 78) pieces.push("felt overwhelmed enough that choices narrowed");
    else if (agent.autonomy.control > 70 && routine.autonomyMomentsToday > 0) pieces.push(`had ${routine.autonomyMomentsToday} moment${routine.autonomyMomentsToday === 1 ? "" : "s"} that restored control`);
    if (agent.autonomy.dignity < 34) pieces.push("felt their dignity take a hit");
    else if (agent.autonomy.dignity > 72 && routine.autonomyMomentsToday > 0) pieces.push("kept self-respect intact");
    if (agent.time.missedWindowsToday > 0) {
      pieces.push(`missed ${agent.time.missedWindowsToday} commitment window${agent.time.missedWindowsToday === 1 ? "" : "s"}`);
    } else if (agent.time.lateWindowsToday > 0) {
      pieces.push(`recovered ${agent.time.lateWindowsToday} late commitment window${agent.time.lateWindowsToday === 1 ? "" : "s"}`);
    } else if (agent.time.keptWindowsToday > 0) {
      pieces.push(`kept ${agent.time.keptWindowsToday} commitment window${agent.time.keptWindowsToday === 1 ? "" : "s"} on time`);
    }
    if (agent.time.rush > 76) pieces.push("felt rushed enough that the day narrowed");
    if (agent.rhythm.drift > 72) pieces.push(`felt ${agent.rhythm.identity} pulling the day off course`);
    else if (agent.rhythm.momentum > 72 || agent.rhythm.streak >= 3) pieces.push(`carried ${agent.rhythm.identity} into the morning`);
    if (agent.emotion.loneliness > 78) pieces.push("felt lonely enough for it to color choices");
    if (agent.emotion.irritation > 78 || agent.emotion.composure < 30) pieces.push("felt emotionally frayed");
    if (agent.emotion.hope < 30) pieces.push("had to fight low hope");
    else if (agent.emotion.hope > 76 && agent.emotion.confidence > 62) pieces.push("felt hopeful and more capable");
    if (agent.household.clutter > 72 || agent.household.laundry > 72) pieces.push("let home chores pile up");
    if (agent.outfit.cleanliness < 38 || agent.outfit.wear > 76) pieces.push("looked a little worn down in public");
    else if (agent.outfit.confidence > 72 && agent.outfit.cleanliness > 72) pieces.push("felt put together in their fit");
    if (agent.household.sleepQuality >= 76 && routine.sleptToday) pieces.push("slept well at home");
    else if (agent.sleep.sleepDebt > 72 || agent.sleep.circadianFatigue > 78) pieces.push("carried real sleep debt");
    if (agent.budget.savedToday > 0) pieces.push(`saved ${agent.budget.savedToday} credits`);
    if (agent.budget.emergencyWithdrawalsToday > 0) pieces.push(`used ${agent.budget.emergencyWithdrawalsToday} emergency savings`);
    const supportDebt = Object.values(agent.relationshipDetails)
      .filter((relationship) => relationship.supportBalance > 0)
      .sort((a, b) => b.supportBalance - a.supportBalance)[0];
    if (supportDebt) pieces.push(`still owed ${supportDebt.agentName} ${supportDebt.supportBalance} support`);
    if (agent.aspiration.dailyProgress > 0) pieces.push(`moved ${agent.aspiration.label.toLowerCase()} forward by ${agent.aspiration.dailyProgress}`);
    if (agent.civic.serviceImpactToday > 0) {
      pieces.push(`created ${agent.civic.serviceImpactToday} public service impact`);
    }
    if (agent.budget.spentToday > agent.budget.dailySpendLimit) pieces.push(`overspent by ${Math.round(agent.budget.spentToday - agent.budget.dailySpendLimit)} credits`);
    if (routine.paidRentToday) pieces.push("handled rent");
    if (agent.eveningPlan.day === routine.day && agent.eveningPlan.intent !== "none" && agent.eveningPlan.resolved) {
      pieces.push(`ended the evening with ${agent.eveningPlan.outcome === "bonded" ? "a social win" : agent.eveningPlan.outcome === "conflict" ? "social tension" : "a quiet reset"}`);
    }
    return `Yesterday I ${pieces.join(", ")}. As a ${agent.lifeProfile.archetype.toLowerCase()}, I still want to ${agent.lifeProfile.motive}. I start today with ${agent.money} credits, ${agent.budget.savings} saved, credit ${agent.budget.creditScore}, mood ${agent.mood.toFixed(0)}, and stress ${agent.stress.toFixed(0)}.`;
  }

  private publicDailyRecap(agent: SimAgent) {
    const routine = agent.routine;
    const work = routine.workedToday ? `earned ${routine.earningsToday} credits` : routine.sickLeaveToday ? `called in sick for ${routine.sickLeaveReason ?? "health"}` : "missed work";
    const maintenance = routine.maintenanceToday > 0 && routine.lastMaintenance ? `, maintained ${routine.lastMaintenance.toLowerCase()}` : "";
    const food =
      routine.mealsToday > 0
        ? `ate ${routine.mealsToday} meal${routine.mealsToday === 1 ? "" : "s"} / nutrition ${Math.round(agent.nutrition.quality)}`
        : "skipped meals";
    const budget = agent.budget.savedToday > 0 ? `, saved ${agent.budget.savedToday}` : agent.budget.spentToday > agent.budget.dailySpendLimit ? `, overspent ${Math.round(agent.budget.spentToday - agent.budget.dailySpendLimit)}` : "";
    const billStatus = agent.budget.lateFeesToday > 0 ? `, late fee +${agent.budget.lateFeesToday}` : agent.budget.hardshipDeferrals > 0 ? ", payment plan active" : "";
    const supportDebt = Object.values(agent.relationshipDetails)
      .filter((relationship) => relationship.supportBalance > 0)
      .sort((a, b) => b.supportBalance - a.supportBalance)[0];
    const support = supportDebt ? `, owed ${supportDebt.agentName} ${supportDebt.supportBalance} support` : "";
    const home =
      agent.household.clutter > 72 || agent.household.laundry > 72
        ? ", home chores piled up"
        : agent.household.sleepQuality >= 76 && routine.sleptToday
          ? ", slept well"
          : agent.household.pantry <= 0
            ? ", pantry ran empty"
            : "";
    const outfit =
      agent.outfit.cleanliness < 38 || agent.outfit.wear > 76
        ? ", looked worn down"
        : agent.outfit.confidence > 72 && agent.outfit.cleanliness > 72
          ? ", looked put together"
          : "";
    const bodyFuel = agent.nutrition.hydration < 34 ? ", ran dry" : agent.nutrition.quality < 34 ? ", ate poorly" : "";
    const leisure = routine.recreationToday > 0 ? `, ${routine.recreationToday} leisure beat${routine.recreationToday === 1 ? "" : "s"}` : agent.leisure.boredom > 78 ? ", visibly bored" : "";
    const sleep = agent.sleep.sleepDebt > 72 ? ", sleep debt showed" : agent.sleep.sleepDebt < 30 && routine.sleptToday ? ", well rested" : "";
    const autonomy =
      agent.autonomy.overwhelm > 78
        ? ", looked overwhelmed"
        : routine.autonomyMomentsToday > 0 && agent.autonomy.control > 66
          ? ", looked more in control"
          : agent.autonomy.dignity < 34
            ? ", dignity took a hit"
            : "";
    const schedule =
      agent.time.missedWindowsToday > 0
        ? `, missed ${agent.time.missedWindowsToday} time window${agent.time.missedWindowsToday === 1 ? "" : "s"}`
        : agent.time.lateWindowsToday > 0
          ? `, recovered ${agent.time.lateWindowsToday} late window${agent.time.lateWindowsToday === 1 ? "" : "s"}`
          : agent.time.keptWindowsToday > 0
            ? `, kept ${agent.time.keptWindowsToday} window${agent.time.keptWindowsToday === 1 ? "" : "s"}`
            : agent.time.rush > 76
              ? ", seemed rushed"
              : "";
    const rhythm =
      agent.rhythm.drift > 72
        ? `, ${agent.rhythm.identity}`
        : agent.rhythm.momentum > 72 || agent.rhythm.streak >= 3
          ? `, ${agent.rhythm.identity}`
          : "";
    const emotion =
      agent.emotion.irritation > 78 || agent.emotion.composure < 30
        ? ", emotionally frayed"
        : agent.emotion.loneliness > 78
          ? ", visibly lonely"
          : agent.emotion.hope > 76 && agent.emotion.confidence > 62
            ? ", hopeful"
            : "";
    const social =
      routine.conflictsToday > 0
        ? `${routine.conflictsToday} tense moment${routine.conflictsToday === 1 ? "" : "s"}`
        : routine.bondsToday > 0
          ? `${routine.bondsToday} good social moment${routine.bondsToday === 1 ? "" : "s"}`
          : routine.deescalationsToday > 0
            ? `${routine.deescalationsToday} calm social save${routine.deescalationsToday === 1 ? "" : "s"}`
          : "a quiet social day";
    return `${work}${maintenance}${budget}${billStatus}${support}${home}${outfit}${bodyFuel}${leisure}${sleep}${autonomy}${schedule}${rhythm}${emotion}, ${food}, ${social}`;
  }

  private refreshNutrition(agent: SimAgent) {
    agent.nutrition.fullness = Math.round(clamp(100 - agent.hunger + Math.max(0, agent.nutrition.quality - 50) * 0.08));
    agent.nutrition.quality = Math.round(clamp(agent.nutrition.quality));
    agent.nutrition.hydration = Math.round(clamp(agent.nutrition.hydration));
    agent.nutrition.variety = Math.round(clamp(agent.nutrition.variety));
  }

  private refreshLeisure(agent: SimAgent) {
    agent.leisure.fun = Math.round(clamp(agent.leisure.fun));
    agent.leisure.boredom = Math.round(clamp(agent.leisure.boredom));
    agent.leisure.curiosity = Math.round(clamp(agent.leisure.curiosity));
  }

  private refreshSleep(agent: SimAgent) {
    agent.sleep.sleepDebt = Math.round(clamp(agent.sleep.sleepDebt));
    agent.sleep.circadianFatigue = Math.round(clamp(agent.sleep.circadianFatigue));
    agent.sleep.hoursSleptLastNight = Math.round(clamp(agent.sleep.hoursSleptLastNight, 0, 12) * 10) / 10;
  }

  private refreshAutonomy(agent: SimAgent) {
    agent.autonomy.dignity = Math.round(clamp(agent.autonomy.dignity));
    agent.autonomy.control = Math.round(clamp(agent.autonomy.control));
    agent.autonomy.overwhelm = Math.round(clamp(agent.autonomy.overwhelm));
    agent.autonomy.recent.splice(4);
  }

  private refreshTimeManagement(agent: SimAgent) {
    agent.time.punctuality = Math.round(clamp(agent.time.punctuality));
    agent.time.timeAwareness = Math.round(clamp(agent.time.timeAwareness));
    agent.time.rush = Math.round(clamp(agent.time.rush));
    agent.time.recent.splice(4);
  }

  private refreshRoutineRhythm(agent: SimAgent) {
    const rhythm = agent.rhythm;
    rhythm.work = Math.round(clamp(rhythm.work));
    rhythm.care = Math.round(clamp(rhythm.care));
    rhythm.home = Math.round(clamp(rhythm.home));
    rhythm.social = Math.round(clamp(rhythm.social));
    rhythm.finance = Math.round(clamp(rhythm.finance));
    rhythm.momentum = Math.round(clamp(rhythm.momentum));
    rhythm.drift = Math.round(clamp(rhythm.drift));
    const low = Math.min(rhythm.work, rhythm.care, rhythm.home, rhythm.social, rhythm.finance);
    const average = (rhythm.work + rhythm.care + rhythm.home + rhythm.social + rhythm.finance) / 5;
    rhythm.identity =
      rhythm.drift >= 76
        ? "drifting routine"
        : low < 32
          ? "uneven routine"
          : rhythm.momentum >= 74 && average >= 62
            ? "steady routine"
            : rhythm.streak >= 3
              ? "building rhythm"
              : "forming rhythm";
    rhythm.recent.splice(4);
  }

  private refreshEmotion(agent: SimAgent) {
    const emotion = agent.emotion;
    emotion.composure = Math.round(clamp(emotion.composure));
    emotion.loneliness = Math.round(clamp(emotion.loneliness));
    emotion.confidence = Math.round(clamp(emotion.confidence));
    emotion.irritation = Math.round(clamp(emotion.irritation));
    emotion.hope = Math.round(clamp(emotion.hope));
    emotion.recent.splice(4);
  }

  private refreshOutfitConfidence(agent: SimAgent) {
    agent.outfit.cleanliness = Math.round(clamp(agent.outfit.cleanliness));
    agent.outfit.wear = Math.round(clamp(agent.outfit.wear));
    agent.outfit.confidence = Math.round(
      clamp(
        24 +
          agent.outfit.cleanliness * 0.38 -
          agent.outfit.wear * 0.26 +
          agent.hygiene * 0.16 +
          agent.mood * 0.08 +
          agent.dna.sociability * 0.04 +
          (agent.outfit.style === "bright" ? 5 : agent.outfit.style === "tidy" ? 3 : agent.outfit.style === "workwear" && agent.currentAction === "working" ? 4 : 0)
      )
    );
  }

  private updateNeeds(agent: SimAgent, dt: number) {
    const phase = this.currentPhase;
    const awakeDrain = phase === "night" ? 0.07 : 0.17;
    agent.hunger = clamp(agent.hunger + dt * (phase === "night" ? 0.23 : 0.38));
    agent.energy = clamp(agent.energy - dt * awakeDrain);
    agent.social = clamp(agent.social - dt * (0.035 + agent.dna.sociability / 2500));
    agent.hygiene = clamp(agent.hygiene - dt * 0.036);
    agent.comfort = clamp(agent.comfort - dt * (agent.currentAction === "resting" || agent.currentAction === "sleeping" ? 0 : 0.028));
    agent.nutrition.hydration = clamp(agent.nutrition.hydration - dt * (phase === "night" ? 0.025 : agent.currentAction === "working" ? 0.09 : 0.052));
    agent.nutrition.quality = clamp(agent.nutrition.quality - dt * (agent.hunger > 76 ? 0.018 : 0.007));
    agent.nutrition.variety = clamp(agent.nutrition.variety - dt * 0.006);
    this.refreshNutrition(agent);

    const minuteOfDay = ((this.worldMinutes % 1440) + 1440) % 1440;
    const inSleepWindow = this.isInsideSleepWindow(minuteOfDay, agent.sleep.bedtimeTarget, agent.sleep.wakeTarget);
    const awakeForSleep = agent.currentAction !== "sleeping" && agent.currentAction !== "hospitalized";
    if (awakeForSleep) {
      agent.sleep.sleepDebt = clamp(agent.sleep.sleepDebt + dt * (inSleepWindow ? 0.48 : agent.currentAction === "working" ? 0.055 : 0.026));
      agent.sleep.circadianFatigue = clamp(agent.sleep.circadianFatigue + dt * (inSleepWindow ? 0.36 : this.currentPhase === "morning" && agent.sleep.sleepDebt > 58 ? 0.04 : -0.008));
    } else if (agent.currentAction === "sleeping") {
      agent.sleep.sleepDebt = clamp(agent.sleep.sleepDebt - dt * (0.42 + agent.household.sleepQuality * 0.004));
      agent.sleep.circadianFatigue = clamp(agent.sleep.circadianFatigue - dt * 0.36);
    }
    this.refreshSleep(agent);

    const activeLeisureAction = agent.currentAction === "resting" || agent.currentAction === "socializing" || agent.currentAction === "building";
    const grindAction = agent.currentAction === "working" || agent.currentAction === "budgeting" || agent.currentAction === "paying_rent";
    const solitaryDrag = agent.currentAction === "idle" || agent.currentAction === "walking" || agent.currentAction === "checking_mail";
    agent.leisure.fun = clamp(agent.leisure.fun - dt * (phase === "night" ? 0.012 : grindAction ? 0.05 : activeLeisureAction ? -0.028 : 0.026));
    agent.leisure.boredom = clamp(agent.leisure.boredom + dt * (activeLeisureAction ? -0.09 : grindAction ? 0.075 : solitaryDrag ? 0.045 : 0.025));
    agent.leisure.curiosity = clamp(agent.leisure.curiosity + dt * (agent.currentAction === "building" ? -0.12 : agent.currentAction === "working" ? 0.012 : agent.leisure.boredom > 62 ? 0.034 : 0.01));
    this.refreshLeisure(agent);

    const hasBillsDue = this.totalBillsDue(agent) > 0;
    const autonomyRecoverAction =
      agent.currentAction === "resting" || agent.currentAction === "sleeping" || agent.currentAction === "cleaning" || agent.currentAction === "washing" || agent.currentAction === "budgeting";
    const autonomyGrindAction = agent.currentAction === "working" || agent.currentAction === "paying_rent" || agent.currentAction === "calling_in_sick";
    agent.autonomy.control = clamp(
      agent.autonomy.control +
        dt *
          (autonomyRecoverAction
            ? 0.07
            : autonomyGrindAction
              ? -0.038
              : agent.currentAction === "socializing" && agent.socialFocus?.intent !== "avoid"
                ? 0.018
                : -0.01)
    );
    agent.autonomy.overwhelm = clamp(
      agent.autonomy.overwhelm +
        dt *
          (hasBillsDue ? 0.034 : -0.012) +
        dt * (agent.stress > 68 ? 0.04 : agent.stress < 32 ? -0.026 : 0) +
        dt * (autonomyRecoverAction ? -0.07 : autonomyGrindAction ? 0.028 : 0)
    );
    agent.autonomy.dignity = clamp(
      agent.autonomy.dignity +
        dt *
          ((agent.hygiene < 34 || agent.outfit.cleanliness < 34 || agent.household.clutter > 82 || agent.budget.overdueBillDays > 0 ? -0.032 : 0) +
            (agent.routine.washedToday || agent.routine.paidRentToday || agent.household.choresDoneToday > 0 ? 0.012 : 0) +
            (agent.routine.bondsToday > 0 || agent.routine.deescalationsToday > 0 ? 0.014 : 0) -
            agent.routine.conflictsToday * 0.004)
    );
    this.refreshAutonomy(agent);

    const socialReliefAction = agent.currentAction === "socializing" && agent.socialFocus?.intent !== "avoid";
    const restorativeEmotionAction = agent.currentAction === "resting" || agent.currentAction === "sleeping" || agent.currentAction === "washing";
    const strainEmotionAction = agent.currentAction === "working" || agent.currentAction === "paying_rent" || agent.currentAction === "calling_in_sick";
    agent.emotion.composure = clamp(
      agent.emotion.composure +
        dt *
          ((restorativeEmotionAction ? 0.09 : strainEmotionAction ? -0.035 : -0.004) +
            (agent.stress > 68 ? -0.07 : agent.stress < 32 ? 0.028 : 0) +
            (agent.routine.deescalationsToday > 0 ? 0.018 : 0) -
            agent.routine.conflictsToday * 0.006)
    );
    agent.emotion.loneliness = clamp(
      agent.emotion.loneliness +
        dt *
          (socialReliefAction
            ? -0.16
            : agent.routine.bondsToday > 0
              ? -0.035
              : agent.social < 34
                ? 0.052 + agent.dna.sociability * 0.0005
                : 0.006)
    );
    agent.emotion.confidence = clamp(
      agent.emotion.confidence +
        dt *
          ((agent.routine.workedToday ? 0.014 : 0) +
            (agent.time.keptWindowsToday > 0 ? 0.018 : 0) +
            (agent.rhythm.momentum > 68 ? 0.018 : 0) +
            (agent.currentAction === "building" ? 0.018 : 0) -
            (agent.rhythm.drift > 72 ? 0.026 : 0) -
            (agent.autonomy.dignity < 34 ? 0.03 : 0))
    );
    agent.emotion.irritation = clamp(
      agent.emotion.irritation +
        dt *
          ((agent.hunger > 78 ? 0.06 : 0) +
            (agent.stress > 64 ? 0.052 : -0.018) +
            (agent.time.rush > 72 ? 0.034 : 0) +
            (agent.routine.conflictsToday > 0 ? 0.035 : 0) -
            (restorativeEmotionAction || agent.routine.deescalationsToday > 0 ? 0.055 : 0))
    );
    agent.emotion.hope = clamp(
      agent.emotion.hope +
        dt *
          ((agent.aspiration.dailyProgress > 0 ? 0.024 : 0) +
            (agent.rhythm.momentum > 70 ? 0.018 : 0) +
            (agent.money + agent.budget.savings > this.totalBillsDue(agent) + 10 ? 0.012 : 0) +
            (agent.routine.bondsToday > 0 ? 0.018 : 0) -
            (agent.medicalDebt > 0 ? 0.012 : 0) -
            (agent.rhythm.drift > 76 ? 0.026 : 0) -
            (agent.emotion.loneliness > 76 ? 0.014 : 0))
    );
    this.refreshEmotion(agent);

    if (this.isWeatherExposed(agent)) {
      const weather = this.latestWeather;
      agent.comfort = clamp(agent.comfort + dt * weather.comfortDelta);
      agent.stress = clamp(agent.stress + dt * weather.outdoorStressDelta);
      if (weather.kind === "heat") {
        agent.energy = clamp(agent.energy - dt * 0.05);
        agent.hygiene = clamp(agent.hygiene - dt * 0.045);
        agent.nutrition.hydration = clamp(agent.nutrition.hydration - dt * 0.045);
      } else if (weather.kind === "cold") {
        agent.energy = clamp(agent.energy - dt * 0.035);
      } else if (weather.kind === "rain") {
        agent.hygiene = clamp(agent.hygiene - dt * 0.025);
      }
    }

    const household = agent.household;
    const atHomeAction = ["sleeping", "eating", "washing", "cleaning"].includes(agent.currentAction);
    household.clutter = clamp(household.clutter + dt * (atHomeAction ? 0.004 : 0.006) + (agent.currentAction === "eating" ? dt * 0.008 : 0));
    household.laundry = clamp(household.laundry + dt * (agent.currentAction === "working" ? 0.014 : 0.005));
    household.homeComfort = clamp(
      household.homeComfort + dt * ((agent.currentAction === "sleeping" || agent.currentAction === "resting" ? 0.006 : -0.002) - Math.max(0, household.clutter - 72) * 0.0009)
    );

    if (agent.currentAction !== "sleeping" && agent.currentAction !== "hospitalized") {
      const exposed = this.isWeatherExposed(agent);
      const workDirt = agent.currentAction === "working" ? 0.055 : agent.currentAction === "cleaning" ? 0.038 : agent.currentAction === "walking" ? 0.018 : 0.009;
      const weatherDirt = exposed && (this.latestWeather.kind === "rain" || this.latestWeather.kind === "heat") ? 0.02 : 0;
      const styleCare = agent.outfit.style === "workwear" ? -0.004 : agent.outfit.style === "tidy" ? 0.004 : 0;
      agent.outfit.cleanliness = clamp(agent.outfit.cleanliness - dt * Math.max(0.004, workDirt + weatherDirt + styleCare));
      agent.outfit.wear = clamp(agent.outfit.wear + dt * (agent.currentAction === "working" ? 0.012 : agent.currentAction === "cleaning" ? 0.008 : agent.currentAction === "walking" ? 0.004 : 0.002));
      this.refreshOutfitConfidence(agent);
    }

    if (agent.hunger > 78) agent.stress = clamp(agent.stress + dt * 0.32);
    if (agent.energy < 30) agent.stress = clamp(agent.stress + dt * 0.24);
    if (agent.sleep.sleepDebt > 70 || agent.sleep.circadianFatigue > 76) {
      agent.energy = clamp(agent.energy - dt * 0.055);
      agent.stress = clamp(agent.stress + dt * 0.07);
      agent.mood = clamp(agent.mood - dt * 0.045);
    } else if (agent.sleep.sleepDebt < 24 && agent.sleep.circadianFatigue < 32 && agent.routine.sleptToday) {
      agent.energy = clamp(agent.energy + dt * 0.018);
      agent.mood = clamp(agent.mood + dt * 0.016);
    }
    if (agent.social < 25 && agent.dna.sociability > 55) agent.stress = clamp(agent.stress + dt * 0.18);
    const activeSchedulePressure = agent.commitments
      .filter((commitment) => commitment.status === "due" || commitment.status === "missed" || (commitment.status === "pending" && commitment.pressure > 18))
      .sort((a, b) => b.pressure - a.pressure)[0];
    if (activeSchedulePressure) {
      const awarenessBuffer = agent.time.timeAwareness * 0.0015;
      const pressureRate =
        activeSchedulePressure.status === "missed"
          ? 0.11
          : activeSchedulePressure.status === "due"
            ? 0.045 + activeSchedulePressure.pressure * 0.0014
            : Math.max(0, activeSchedulePressure.pressure - 12) * 0.0009;
      agent.time.rush = clamp(agent.time.rush + dt * Math.max(0.006, pressureRate - awarenessBuffer));
    } else {
      agent.time.rush = clamp(agent.time.rush - dt * (agent.currentAction === "resting" || agent.currentAction === "sleeping" ? 0.09 : 0.035));
    }
    this.refreshTimeManagement(agent);
    if (agent.time.rush > 72) {
      agent.stress = clamp(agent.stress + dt * 0.07);
      agent.mood = clamp(agent.mood - dt * 0.035);
    } else if (agent.time.rush < 28 && agent.time.keptWindowsToday > 0) {
      agent.mood = clamp(agent.mood + dt * 0.012);
    }
    if (agent.rentDue > 0) agent.stress = clamp(agent.stress + dt * 0.08);
    if (agent.medicalDebt > 0) agent.stress = clamp(agent.stress + dt * 0.04);
    if (agent.budget.livingCostDue > 0) agent.stress = clamp(agent.stress + dt * 0.035);
    if (household.pantry <= 0 && agent.hunger > 64) agent.stress = clamp(agent.stress + dt * 0.08);
    if (household.toiletries <= 0 && agent.hygiene < 50) agent.stress = clamp(agent.stress + dt * 0.026);
    if (household.cleaningSupplies <= 0 && (household.clutter > 60 || household.laundry > 60)) agent.stress = clamp(agent.stress + dt * 0.022);
    if (household.clutter > 74) agent.stress = clamp(agent.stress + dt * 0.05);
    if (household.laundry > 74) agent.mood = clamp(agent.mood - dt * 0.035);
    if (agent.nutrition.hydration < 34) {
      agent.energy = clamp(agent.energy - dt * 0.045);
      agent.stress = clamp(agent.stress + dt * 0.07);
    }
    if (agent.nutrition.hydration < 18) agent.health = clamp(agent.health - dt * 0.045);
    if (agent.nutrition.quality < 32 && agent.hunger > 58) {
      agent.mood = clamp(agent.mood - dt * 0.035);
      agent.health = clamp(agent.health - dt * 0.018);
    }
    if (agent.nutrition.quality > 68 && agent.nutrition.hydration > 58 && agent.hunger < 62) {
      agent.energy = clamp(agent.energy + dt * 0.018);
      agent.mood = clamp(agent.mood + dt * 0.012);
    }
    if (agent.leisure.boredom > 76 || agent.leisure.fun < 24) {
      agent.mood = clamp(agent.mood - dt * 0.048);
      agent.stress = clamp(agent.stress + dt * 0.038);
    } else if (agent.leisure.fun > 70 && agent.leisure.boredom < 44) {
      agent.mood = clamp(agent.mood + dt * 0.026);
      agent.stress = clamp(agent.stress - dt * 0.018);
    }
    if (agent.outfit.cleanliness < 28 && agent.currentAction === "socializing") agent.stress = clamp(agent.stress + dt * 0.035);
    if (agent.outfit.confidence > 72 && agent.currentAction === "socializing") agent.mood = clamp(agent.mood + dt * 0.028);
    if (household.sleepQuality < 42 && agent.energy < 52) agent.stress = clamp(agent.stress + dt * 0.03);
    if (agent.hunger > 94) agent.health = clamp(agent.health - dt * 0.14);
    if (agent.energy < 8 && agent.hunger > 72) agent.health = clamp(agent.health - dt * 0.08);
    if (agent.hygiene < 12 && agent.stress > 70) agent.health = clamp(agent.health - dt * 0.06);
    if (agent.hygiene < 20) agent.mood = clamp(agent.mood - dt * 0.08);

    const moodDelta =
      (agent.comfort - 50) * 0.0009 +
      (agent.social - 50) * 0.0008 -
      (agent.stress - 35) * 0.0012 -
      (agent.hunger > 80 ? 0.08 : 0) -
      (agent.energy < 25 ? 0.06 : 0);
    agent.mood = clamp(agent.mood + moodDelta * dt * 60);
  }

  private updateMinorIllness(agent: SimAgent, dt: number) {
    const illness = agent.medical.minorIllness;
    if (agent.medical.isHospitalized) return;

    const currentObject = agent.target ? this.objectStates.peek(agent.target.structureId, agent.target.actionPointId) : undefined;
    const risk = this.minorIllnessRiskFor(agent, currentObject);

    if (illness.active) {
      const restorative = ["sleeping", "resting", "washing", "healing"].includes(agent.currentAction);
      const activelyCaring = restorative || agent.health > 74 || agent.hygiene > 64 || agent.stress < 42;
      const recovery =
        0.018 +
        (restorative ? 0.11 : 0) +
        (agent.currentAction === "healing" ? 0.22 : 0) +
        (agent.currentAction === "washing" ? 0.08 : 0) +
        Math.max(0, agent.health - 62) * 0.0015 +
        Math.max(0, 48 - agent.stress) * 0.0012;
      const worsening = risk > 58 && !restorative ? (risk - 58) * 0.0014 : 0;
      illness.severity = Math.round(clamp(illness.severity - dt * recovery * 60 + dt * worsening * 60) * 10) / 10;
      const projectedRecovery = this.worldMinutes + Math.max(20, illness.severity * 1.6);
      illness.recoveryWorldMinutes =
        worsening > recovery ? Math.max(illness.recoveryWorldMinutes, projectedRecovery) : Math.min(illness.recoveryWorldMinutes, projectedRecovery);

      agent.energy = clamp(agent.energy - dt * (0.018 + illness.severity * 0.0009));
      agent.mood = clamp(agent.mood - dt * (0.012 + illness.severity * 0.00055));
      agent.stress = clamp(agent.stress + dt * (0.014 + illness.severity * 0.00065));
      if (illness.severity > 42) agent.health = clamp(agent.health - dt * (0.01 + illness.severity * 0.0007));

      if (illness.severity <= MINOR_ILLNESS_RECOVERY_THRESHOLD || (activelyCaring && this.worldMinutes >= illness.recoveryWorldMinutes)) {
        this.clearMinorIllness(agent, restorative ? "Recovered after taking care of it." : "Recovered as the day steadied.");
      }
      return;
    }

    if (risk < MINOR_ILLNESS_RISK_THRESHOLD) return;
    if (this.worldMinutes - illness.lastResolvedWorldMinutes < MINOR_ILLNESS_COOLDOWN_MINUTES) return;

    const bucket = Math.floor(this.worldMinutes / 45);
    const roll = randomFromHash(hashText(`${agent.id}:minor-illness:${this.currentDay}:${bucket}`), 13);
    const triggerChance = clamp((risk - MINOR_ILLNESS_RISK_THRESHOLD) / 220, 0, 0.18);
    if (roll > triggerChance) return;

    const label = this.minorIllnessLabelFor(agent, risk, currentObject);
    const severity = Math.round(clamp(22 + (risk - MINOR_ILLNESS_RISK_THRESHOLD) * 0.42 + randomFromHash(hashText(`${agent.id}:${label}:${bucket}`), 19) * 16, 18, 68));
    const reasons = [
      agent.hygiene < 30 ? "low hygiene" : "",
      agent.stress > 66 ? "high stress" : "",
      agent.energy < 28 ? "poor rest" : "",
      currentObject && currentObject.cleanliness < 46 ? "a dirty shared object" : "",
      currentObject && currentObject.crowdPressure > 55 ? "a crowded place" : ""
    ].filter(Boolean);
    this.startMinorIllness(agent, label, severity, reasons.length > 0 ? reasons.join(", ") : "being run down");
  }

  private updateAftercare(agent: SimAgent, dt: number) {
    const aftercare = agent.medical.aftercare;
    if (!aftercare.active || agent.medical.isHospitalized) return;

    if (agent.currentAction === "resting" || agent.currentAction === "sleeping") {
      aftercare.restMinutesRemaining = Math.max(0, Math.round((aftercare.restMinutesRemaining - dt * SIM_MINUTES_PER_SECOND) * 10) / 10);
      agent.health = clamp(agent.health + dt * 0.03);
    }

    if (aftercare.dosesRemaining <= 0 && aftercare.restMinutesRemaining <= 0) {
      aftercare.active = false;
      aftercare.detail = "Completed";
      this.addMoodlet(agent, {
        id: "aftercare-complete",
        label: "Care Plan Done",
        detail: "followed through after treatment",
        tone: "good",
        intensity: 4.5,
        durationMinutes: 220,
        tags: ["health", "aftercare", "routine"],
        actionBiases: { working: 4, socializing: 2, healing: -8 },
        moodDelta: 2,
        stressDelta: -3
      });
      this.addMemory(agent, "event", "Finished the aftercare plan after treatment.", 6, ["health", "aftercare", "routine"]);
      this.log(agent, `${agent.name} finished their aftercare plan.`, "health", "good", 6);
      return;
    }

    if (aftercare.expiresWorldMinutes <= 0 || this.worldMinutes < aftercare.expiresWorldMinutes || aftercare.missedCheckins > 0) return;

    aftercare.missedCheckins += 1;
    const missedSeverity = aftercare.dosesRemaining * 9 + aftercare.restMinutesRemaining * 0.12;
    agent.health = clamp(agent.health - Math.min(10, 2 + missedSeverity * 0.18));
    agent.stress = clamp(agent.stress + Math.min(12, 4 + missedSeverity * 0.12));
    agent.mood = clamp(agent.mood - Math.min(8, 2 + missedSeverity * 0.08));
    if (!agent.medical.minorIllness.active && missedSeverity >= 18) {
      this.startMinorIllness(agent, "Aftercare Relapse", Math.round(clamp(24 + missedSeverity * 0.45, 24, 62)), "unfinished aftercare");
    }
    aftercare.active = false;
    aftercare.detail = "Missed";
    this.addMoodlet(agent, {
      id: "aftercare-missed",
      label: "Aftercare Slipped",
      detail: "recovery instructions were not finished",
      tone: "warn",
      intensity: 5.5,
      durationMinutes: 280,
      tags: ["health", "aftercare", "routine"],
      actionBiases: { healing: 12, resting: 8, working: -6 },
      moodDelta: -1,
      stressDelta: 2
    });
    this.addMemory(agent, "event", "Let aftercare slip and felt recovery wobble.", 7, ["health", "aftercare", "risk"]);
    this.log(agent, `${agent.name} missed aftercare and felt recovery wobble.`, "health", "warn", 7);
  }

  private minorIllnessRiskFor(agent: SimAgent, currentObject?: SemanticObjectState) {
    const hygieneRisk = Math.max(0, 42 - agent.hygiene) * 0.74;
    const stressRisk = Math.max(0, agent.stress - 58) * 0.62;
    const fatigueRisk = Math.max(0, 34 - agent.energy) * 0.76;
    const hungerRisk = Math.max(0, agent.hunger - 76) * 0.38;
    const nutritionRisk = Math.max(0, 36 - agent.nutrition.hydration) * 0.32 + Math.max(0, 34 - agent.nutrition.quality) * 0.2;
    const healthRisk = Math.max(0, 72 - agent.health) * 0.44;
    const homeRisk =
      agent.currentAction === "sleeping" || agent.currentAction === "eating" || agent.currentAction === "washing" || agent.currentAction === "cleaning"
        ? Math.max(0, agent.household.clutter - 70) * 0.18 + Math.max(0, agent.household.laundry - 70) * 0.14
        : 0;
    const objectRisk = currentObject
      ? Math.max(0, 52 - currentObject.cleanliness) * 0.38 + Math.max(0, currentObject.crowdPressure - 44) * 0.22 + Math.max(0, currentObject.heat - 58) * 0.12
      : 0;
    const weatherRisk = this.isWeatherExposed(agent) ? this.latestWeather.clinicRiskModifier : 0;
    const resilience =
      Math.max(0, agent.health - 74) * 0.22 +
      Math.max(0, agent.energy - 66) * 0.12 +
      Math.max(0, 36 - agent.stress) * 0.18 +
      Math.max(0, agent.nutrition.hydration - 62) * 0.06 +
      Math.max(0, agent.nutrition.quality - 62) * 0.05 +
      (agent.routine.washedToday ? 5 : 0) +
      (agent.routine.sleptToday ? 5 : 0) +
      agent.dna.discipline * 0.035;
    return clamp(hygieneRisk + stressRisk + fatigueRisk + hungerRisk + nutritionRisk + healthRisk + homeRisk + objectRisk + weatherRisk - resilience);
  }

  private minorIllnessLabelFor(agent: SimAgent, risk: number, currentObject?: SemanticObjectState) {
    if (this.isWeatherExposed(agent) && this.latestWeather.kind === "cold") return "Cold Snap Chill";
    if (this.isWeatherExposed(agent) && this.latestWeather.kind === "rain") return "Rain Chill";
    if (this.isWeatherExposed(agent) && this.latestWeather.kind === "heat") return "Heat Exhaustion";
    if (currentObject && currentObject.crowdPressure > 62) return "Crowd Cold";
    if (agent.stress > 72 && agent.energy < 38) return "Stress Fever";
    if (agent.hygiene < 24) return "Grimy Bug";
    if (agent.nutrition.hydration < 24) return "Dehydration Crash";
    if (agent.nutrition.quality < 28) return "Diet Slump";
    if (agent.hunger > 84) return "Stomach Bug";
    return risk > 64 ? "Run-Down Cold" : "Under the Weather";
  }

  private startMinorIllness(agent: SimAgent, label: string, severity: number, reason: string) {
    agent.medical.minorIllness = {
      active: true,
      label,
      severity,
      startedWorldTime: this.worldTime,
      startedWorldMinutes: this.worldMinutes,
      recoveryWorldMinutes: this.worldMinutes + Math.max(75, 110 + severity * 2.2),
      lastResolvedWorldMinutes: agent.medical.minorIllness.lastResolvedWorldMinutes
    };
    agent.stress = clamp(agent.stress + 5);
    agent.mood = clamp(agent.mood - 4);
    this.addMemory(agent, "event", `Started feeling ${label.toLowerCase()} after ${reason}.`, 7, ["health", "illness", "routine"]);
    this.log(agent, `${agent.name} started feeling ${label.toLowerCase()} after ${reason}.`, "health", severity >= 54 ? "bad" : "warn", 7);
  }

  private clearMinorIllness(agent: SimAgent, reason: string) {
    const label = agent.medical.minorIllness.label ?? "minor illness";
    agent.medical.minorIllness = {
      active: false,
      label: null,
      severity: 0,
      startedWorldTime: null,
      startedWorldMinutes: 0,
      recoveryWorldMinutes: 0,
      lastResolvedWorldMinutes: this.worldMinutes
    };
    agent.mood = clamp(agent.mood + 3);
    agent.stress = clamp(agent.stress - 5);
    this.addMemory(agent, "event", `${label} cleared up. ${reason}`, 6, ["health", "recovery"]);
    this.log(agent, `${agent.name}'s ${label.toLowerCase()} cleared up.`, "health", "good", 6);
  }

  private applyPlacePressure(agent: SimAgent, dt: number) {
    if (!agent.target || agent.currentAction === "walking" || agent.currentAction === "idle" || agent.currentAction === "hospitalized") return;
    const state = this.objectStates.peek(agent.target.structureId, agent.target.actionPointId);
    if (!state) return;
    const liveLoad = Math.max(0, state.occupants - 1) + state.queued * 0.35;
    if (liveLoad <= 0) return;

    const crowd = Math.min(3.5, liveLoad);
    const tolerance = agent.dna.sociability * 0.58 + agent.dna.empathy * 0.27 + (100 - agent.dna.risk) * 0.15;
    const privateAction = ["sleeping", "eating", "washing", "healing", "resting"].includes(agent.currentAction);
    state.heat = Math.round(clamp(state.heat + dt * (0.16 + crowd * 0.08)));

    if (agent.currentAction === "socializing") {
      agent.social = clamp(agent.social + dt * (0.16 + agent.dna.sociability / 680) * crowd);
      agent.mood = clamp(agent.mood + dt * ((agent.dna.sociability - 45) / 180) * crowd);
      agent.stress = clamp(agent.stress + dt * (agent.dna.sociability < 42 ? 0.1 : -0.045) * crowd);
      return;
    }

    if (privateAction) {
      agent.stress = clamp(agent.stress + dt * (0.07 + Math.max(0, 58 - tolerance) * 0.0014) * crowd);
      agent.comfort = clamp(agent.comfort - dt * 0.08 * crowd);
      agent.mood = clamp(agent.mood - dt * 0.025 * crowd);
      return;
    }

    agent.stress = clamp(agent.stress + dt * (0.02 + Math.max(0, 56 - tolerance) * 0.0013) * crowd);
    agent.mood = clamp(agent.mood - dt * Math.max(0, 42 - agent.dna.sociability) * 0.0016 * crowd);
  }

  private processHospitalStay(agent: SimAgent, dt: number, structures: StructureMetadata[]) {
    if (!agent.medical.isHospitalized) return false;

    if (!agent.target || agent.target.action !== "hospitalized") this.setHospitalTarget(agent, structures);
    agent.currentAction = "hospitalized";
    agent.socialFocus = null;
    agent.goal = "Recover without dying";
    agent.plan = [
      `Stay at ${agent.medical.facilityName ?? "the clinic"}`,
      "Stabilize health",
      `Leave with a ${agent.medical.bill}-credit bill`
    ];
    const remainingSeconds = Math.max(0, (agent.medical.dischargeWorldMinutes - this.worldMinutes) / SIM_MINUTES_PER_SECOND);
    agent.dwellSeconds = remainingSeconds;
    agent.dwellTotalSeconds = Math.max(agent.dwellTotalSeconds, remainingSeconds);
    agent.health = clamp(agent.health + dt * 0.52, 0, 100);
    agent.energy = clamp(agent.energy + dt * 0.42, 0, 100);
    agent.hunger = clamp(agent.hunger + dt * 0.05, 0, 100);
    agent.hygiene = clamp(agent.hygiene + dt * 0.16, 0, 100);
    agent.stress = clamp(agent.stress - dt * 0.22, 0, 100);
    if (agent.medical.minorIllness.active) {
      agent.medical.minorIllness.severity = Math.round(clamp(agent.medical.minorIllness.severity - dt * 0.78 * 60) * 10) / 10;
      if (agent.medical.minorIllness.severity <= MINOR_ILLNESS_RECOVERY_THRESHOLD) this.clearMinorIllness(agent, "Hospital care handled the lingering symptoms.");
    }

    if (this.worldMinutes < agent.medical.dischargeWorldMinutes && agent.health < HOSPITAL_RELEASE_HEALTH) return true;
    this.dischargeFromHospital(agent);
    return true;
  }

  private admitIfHealthCrisis(agent: SimAgent, structures: StructureMetadata[], reason: string) {
    if (agent.medical.isHospitalized || agent.health > HEALTH_CRISIS_THRESHOLD) return false;
    const severity = clamp(100 - agent.health, 0, 100);
    const stayMinutes = HOSPITAL_BASE_STAY_MINUTES + Math.round((severity / 100) * HOSPITAL_MAX_EXTRA_MINUTES);
    const bill = Math.max(18, Math.round(18 + severity * 0.42 + agent.stress * 0.12));
    const hospitalTarget = this.setHospitalTarget(agent, structures);
    const minorIllness = agent.medical.minorIllness.active
      ? {
          active: false,
          label: null,
          severity: 0,
          startedWorldTime: null,
          startedWorldMinutes: 0,
          recoveryWorldMinutes: 0,
          lastResolvedWorldMinutes: this.worldMinutes
        }
      : { ...agent.medical.minorIllness };
    agent.medical = {
      isHospitalized: true,
      facilityName: hospitalTarget?.structureName ?? "Genesis Clinic",
      admittedWorldTime: this.worldTime,
      dischargeWorldMinutes: this.worldMinutes + stayMinutes,
      reason,
      bill,
      minorIllness,
      aftercare: {
        active: false,
        label: null,
        detail: null,
        dosesRemaining: 0,
        restMinutesRemaining: 0,
        followUpDueWorldMinutes: 0,
        expiresWorldMinutes: 0,
        lastDoseWorldMinutes: -9999,
        missedCheckins: 0
      }
    };
    agent.medicalDebt += bill;
    this.recordFinance(agent, bill, "medical", "Hospital bill opened", "debt");
    agent.routine.medicalVisitToday = true;
    agent.health = clamp(Math.max(6, agent.health));
    agent.energy = clamp(Math.max(18, agent.energy));
    agent.stress = clamp(agent.stress + 12);
    agent.mood = clamp(agent.mood - 12);
    agent.currentAction = "hospitalized";
    agent.dwellTotalSeconds = stayMinutes / SIM_MINUTES_PER_SECOND;
    agent.dwellSeconds = agent.dwellTotalSeconds;
    this.objectStates.recordUse(agent, this.worldTime, { stockDelta: -1, cleanlinessDelta: -4, wearDelta: 1, heatDelta: 12 });
    this.addMemory(agent, "event", `Collapsed from poor health and was admitted to ${agent.medical.facilityName}. The bill is ${bill} credits.`, 10, ["health", "hospital", "debt"]);
    this.log(agent, `${agent.name} had a health crisis and was admitted to ${agent.medical.facilityName}. A ${bill}-credit bill was added.`, "health", "bad", 10);
    return true;
  }

  private dischargeFromHospital(agent: SimAgent) {
    const facility = agent.medical.facilityName ?? "the clinic";
    const bill = agent.medical.bill;
    const minorIllness = { ...agent.medical.minorIllness, active: false, label: null, severity: 0, lastResolvedWorldMinutes: this.worldMinutes };
    agent.medical = {
      isHospitalized: false,
      facilityName: null,
      admittedWorldTime: null,
      dischargeWorldMinutes: 0,
      reason: null,
      bill: 0,
      minorIllness,
      aftercare: {
        active: true,
        label: "Hospital Aftercare",
        detail: `${facility} discharge plan`,
        dosesRemaining: 3,
        restMinutesRemaining: 140,
        followUpDueWorldMinutes: this.worldMinutes + 360,
        expiresWorldMinutes: this.worldMinutes + 960,
        lastDoseWorldMinutes: -9999,
        missedCheckins: 0
      }
    };
    agent.health = clamp(Math.max(agent.health, HOSPITAL_RELEASE_HEALTH));
    agent.energy = clamp(Math.max(agent.energy, 38));
    agent.hunger = clamp(Math.min(agent.hunger, 58));
    agent.stress = clamp(agent.stress + 4);
    agent.target = null;
    agent.dwellSeconds = 0;
    agent.dwellTotalSeconds = 0;
    agent.actionProgress = 0;
    this.addMemory(agent, "event", `Discharged from ${facility}. The medical bill is ${agent.medicalDebt} credits.`, 9, ["health", "hospital", "debt"]);
    this.log(agent, `${agent.name} was discharged from ${facility} with ${bill} credits added to their medical bills.`, "health", "warn", 9);
  }

  private setHospitalTarget(agent: SimAgent, structures: StructureMetadata[]) {
    const target = this.findHospitalTarget(structures);
    if (!target) return null;
    agent.target = target;
    agent.position = { x: target.x, y: target.y, z: target.z };
    return target;
  }

  private findHospitalTarget(structures: StructureMetadata[]): AgentTarget | null {
    for (const structure of structures) {
      if (structure.type !== "clinic") continue;
      const point =
        structure.actionPoints.find((candidate) => candidate.type === "clinic_bed") ??
        structure.actionPoints.find((candidate) => candidate.type === "medicine_cabinet" || candidate.type === "desk");
      if (!point) continue;
      const destination = worldPoint(point.position);
      return {
        ...destination,
        label: `${structure.name}: ${point.label}`,
        action: "hospitalized",
        structureId: structure.id,
        structureName: structure.name,
        actionPointId: point.id,
        actionPointType: point.type,
        waypoints: [],
        routeLength: 1
      };
    }
    return null;
  }

  private moveAlongRoute(agent: SimAgent, dt: number, structures: StructureMetadata[], routeResolver: AgentRouteResolver | undefined, agents: readonly SimAgent[]) {
    const target = agent.target;
    if (!target) return;
    const waypoint = target.waypoints[0] ?? target;
    const dx = waypoint.x - agent.position.x;
    const dz = waypoint.z - agent.position.z;
    const distance = Math.hypot(dx, dz);
    agent.currentAction = distance > 0.18 || target.waypoints.length > 1 ? "walking" : target.action;

    if (distance > 0.18) {
      const step = Math.min(distance, this.movementSpeedFor(agent) * dt);
      agent.position.x += (dx / distance) * step;
      agent.position.z += (dz / distance) * step;
      agent.position.y += (waypoint.y - agent.position.y) * Math.min(1, dt * 8);
      return;
    }

    agent.position.x = waypoint.x;
    agent.position.y = waypoint.y;
    agent.position.z = waypoint.z;
    if (target.waypoints.length > 1) {
      target.waypoints.shift();
      return;
    }

    agent.dwellSeconds -= dt * this.actionEfficiencyFor(agent);
    if (agent.dwellSeconds > 0) return;

    this.actions.resolve(agent, this.actionContext(agents));
    this.updateCommitments(agent);
    this.chooseNextTarget(agent, structures, routeResolver, agents);
  }

  private pruneCivicNotices() {
    for (let index = this.civicNotices.length - 1; index >= 0; index -= 1) {
      if ((this.civicNotices[index]?.expiresWorldMinutes ?? 0) <= this.worldMinutes) this.civicNotices.splice(index, 1);
    }
  }

  private publishCivicNotice(event: AgentEvent) {
    if (!this.shouldPublishCivicNotice(event)) return;
    this.pruneCivicNotices();
    const duplicate = this.civicNotices.find(
      (notice) => notice.kind === event.kind && notice.detail === event.text && this.worldMinutes - notice.worldMinutes < 45
    );
    if (duplicate) {
      duplicate.importance = Math.max(duplicate.importance, event.importance);
      duplicate.expiresWorldMinutes = Math.max(duplicate.expiresWorldMinutes, this.noticeExpiryFor(event));
      return;
    }

    this.civicNotices.unshift({
      id: `notice-${event.id}`,
      sourceEventId: event.id,
      sourceAgentId: event.agentId,
      sourceAgentName: event.agentName,
      day: this.currentDay,
      worldTime: this.worldTime,
      worldMinutes: this.worldMinutes,
      expiresWorldMinutes: this.noticeExpiryFor(event),
      kind: event.kind,
      tone: event.tone,
      headline: this.noticeHeadlineFor(event),
      detail: event.text,
      importance: event.importance,
      tags: this.noticeTagsFor(event),
      acknowledgedBy: event.agentId === "city" ? [] : [event.agentId]
    });
    this.civicNotices.splice(12);
  }

  private shouldPublishCivicNotice(event: AgentEvent) {
    if (event.kind === "arrival" || event.kind === "home") return false;
    if (event.kind === "routine") return event.importance >= 9 && event.tone !== "neutral";
    if (event.agentId === "city") return event.importance >= 6;
    if (event.kind === "conflict") return true;
    if (event.kind === "health") return event.importance >= 7 || event.tone !== "neutral";
    if (event.kind === "money" || event.kind === "food" || event.kind === "city") return event.importance >= 8 || event.tone === "bad";
    if (event.kind === "work") return event.importance >= 8 || event.text.includes("Public service impact") || event.text.includes("bonus credits");
    if (event.kind === "social") {
      return event.importance >= 8 || event.tone === "warn" || event.tone === "bad" || event.text.includes("shared") || event.text.includes("friendship");
    }
    return false;
  }

  private noticeExpiryFor(event: AgentEvent) {
    const duration = event.tone === "bad" ? 720 : event.tone === "warn" ? 520 : event.importance >= 8 ? 460 : 340;
    return this.worldMinutes + duration;
  }

  private noticeHeadlineFor(event: AgentEvent) {
    const subject = event.agentId === "city" ? "Genesis District" : event.agentName;
    switch (event.kind) {
      case "conflict":
        return `Conflict involving ${subject}`;
      case "health":
        return `Health concern: ${subject}`;
      case "food":
        return "Food access notice";
      case "money":
        return `Civic account: ${subject}`;
      case "work":
        return `Public service: ${subject}`;
      case "social":
        return `Town life: ${subject}`;
      case "city":
        return "District notice";
      default:
        return subject;
    }
  }

  private noticeTagsFor(event: AgentEvent) {
    const tags = ["notice", event.kind, event.tone];
    if (event.agentId !== "city") tags.push(event.agentId);
    if (event.text.toLowerCase().includes("medical")) tags.push("medical");
    if (event.text.toLowerCase().includes("rent")) tags.push("rent");
    if (event.text.toLowerCase().includes("stock") || event.text.toLowerCase().includes("food")) tags.push("food");
    if (event.text.toLowerCase().includes("service")) tags.push("service");
    return [...new Set(tags)].slice(0, 8);
  }

  private absorbCivicNotice(agent: SimAgent, channel: "mail" | "civic" | "social" | "public") {
    this.pruneCivicNotices();
    const notice = this.civicNotices
      .filter((candidate) => !candidate.acknowledgedBy.includes(agent.id) && this.noticeMatchesChannel(candidate, channel))
      .sort((a, b) => this.noticePullFor(agent, b, channel) - this.noticePullFor(agent, a, channel))[0];
    if (!notice) return false;

    notice.acknowledgedBy.push(agent.id);
    const source = notice.sourceAgentId !== "city" ? this.agents.get(notice.sourceAgentId) : null;
    const personalLine = source && source.id !== agent.id ? ` about ${source.name}` : "";
    this.addMemory(agent, "observation", `Heard around town${personalLine}: ${notice.headline}. ${notice.detail}`, Math.min(9, notice.importance), [
      "civic_notice",
      ...notice.tags
    ]);
    this.addMoodlet(agent, {
      id: `noticed-${notice.id}`,
      label: notice.tone === "good" ? "Town Feels Alive" : notice.tone === "bad" ? "Town Unease" : "Town Awareness",
      detail: notice.headline,
      tone: notice.tone,
      intensity: Math.min(7, 2.5 + notice.importance * 0.45),
      durationMinutes: notice.tone === "bad" ? 240 : 160,
      tags: ["notice", ...notice.tags],
      actionBiases: this.noticeActionBiases(notice),
      moodDelta: notice.tone === "good" ? 1.5 : notice.tone === "bad" ? -1.5 : 0,
      stressDelta: notice.tone === "bad" ? 2 : notice.tone === "warn" ? 0.8 : -0.6
    });

    if (source && source.id !== agent.id) {
      const delta = notice.kind === "conflict" ? -1.4 : notice.tone === "good" ? 0.9 : notice.tone === "bad" ? -0.7 : notice.tone === "warn" ? -0.2 : 0.25;
      const relationship = this.relationships.adjustRelationship(agent, source, delta, `Heard town talk: ${notice.headline}.`, this.worldTime);
      relationship.lastGesture = "Town talk";
    }
    return true;
  }

  private noticeMatchesChannel(notice: CivicNotice, channel: "mail" | "civic" | "social" | "public") {
    if (channel === "mail" || channel === "civic") return true;
    if (channel === "social") return ["social", "conflict", "work", "health", "city"].includes(notice.kind);
    return notice.importance >= 8 || notice.tone !== "neutral";
  }

  private noticePullFor(agent: SimAgent, notice: CivicNotice, channel: "mail" | "civic" | "social" | "public") {
    const tonePull = notice.tone === "bad" ? 12 : notice.tone === "warn" ? 7 : notice.tone === "good" ? 4 : 0;
    const empathyPull = (notice.kind === "health" || notice.kind === "conflict" || notice.kind === "social") ? agent.dna.empathy * 0.06 : 0;
    const civicPull = channel === "mail" || channel === "civic" ? agent.skills.civic.level * 0.8 + agent.dna.discipline * 0.03 : 0;
    const socialPull = channel === "social" ? agent.dna.sociability * 0.04 + agent.values.belonging * 0.03 : 0;
    const recency = Math.max(0, 1 - (this.worldMinutes - notice.worldMinutes) / 720) * 6;
    return notice.importance * 2 + tonePull + empathyPull + civicPull + socialPull + recency;
  }

  private noticeActionBiases(notice: CivicNotice): Partial<Record<AgentAction, number>> {
    switch (notice.kind) {
      case "conflict":
        return { socializing: notice.tone === "bad" ? -8 : -3, resting: 8, working: 2 };
      case "health":
        return { healing: 10, resting: 5, socializing: -3 };
      case "food":
        return { shopping: 8, working: 5, eating: 4 };
      case "money":
        return { budgeting: 9, paying_rent: 8, working: 6, socializing: -2 };
      case "work":
        return { working: 6, socializing: 3, budgeting: 2 };
      case "social":
        return { socializing: notice.tone === "good" ? 8 : 3, resting: notice.tone === "bad" ? 5 : 0 };
      default:
        return { checking_mail: 5, budgeting: 3 };
    }
  }

  private log(agent: SimAgent, text: string, kind: AgentEventKind = "routine", tone: AgentEventTone = "neutral", importance = 5) {
    const target = agent.target;
    const event: AgentEvent = {
      id: `event-${this.nextEventNumber.toString().padStart(4, "0")}`,
      agentId: agent.id,
      agentName: agent.name,
      text,
      timestamp: this.worldTick,
      worldTime: this.worldTime,
      kind,
      tone,
      importance,
      position: target ? { x: target.x, y: target.y + 1.25, z: target.z } : { x: agent.position.x, y: agent.position.y + 1.25, z: agent.position.z },
      locationLabel: target?.label,
      actionLabel: target ? ACTION_EVENT_LABELS[target.action] : ACTION_EVENT_LABELS[agent.currentAction]
    };
    this.nextEventNumber += 1;
    this.events.unshift(event);
    this.events.splice(40);
    this.publishCivicNotice(event);
  }

  private logCity(text: string, kind: AgentEventKind = "city", tone: AgentEventTone = "neutral", importance = 5) {
    const event: AgentEvent = {
      id: `event-${this.nextEventNumber.toString().padStart(4, "0")}`,
      agentId: "city",
      agentName: "Genesis District",
      text,
      timestamp: this.worldTick,
      worldTime: this.worldTime,
      kind,
      tone,
      importance
    };
    this.nextEventNumber += 1;
    this.events.unshift(event);
    this.events.splice(40);
    this.publishCivicNotice(event);
  }

  private transact(agent: SimAgent, amount: number, category: AgentFinancialCategory, label: string, tone?: AgentFinancialTone) {
    agent.money = Math.max(0, Math.round((agent.money + amount) * 100) / 100);
    if (amount < 0 && tone !== "debt") {
      agent.budget.spentToday = Math.round((agent.budget.spentToday + Math.abs(amount)) * 100) / 100;
    }
    this.recordFinance(agent, amount, category, label, tone ?? (amount >= 0 ? "income" : "expense"));
    return agent.money;
  }

  private depositSavings(agent: SimAgent, amount: number, label: string) {
    const moved = Math.max(0, Math.min(agent.money, Math.round(amount * 100) / 100));
    if (moved <= 0) return 0;
    agent.money = Math.round((agent.money - moved) * 100) / 100;
    agent.budget.savings = Math.round((agent.budget.savings + moved) * 100) / 100;
    agent.budget.savedToday = Math.round((agent.budget.savedToday + moved) * 100) / 100;
    this.recordFinance(agent, moved, "savings", label, "neutral");
    return moved;
  }

  private withdrawSavings(agent: SimAgent, amount: number, label: string) {
    const moved = Math.max(0, Math.min(agent.budget.savings, Math.round(amount * 100) / 100));
    if (moved <= 0) return 0;
    agent.budget.savings = Math.round((agent.budget.savings - moved) * 100) / 100;
    agent.budget.emergencyWithdrawalsToday = Math.round((agent.budget.emergencyWithdrawalsToday + moved) * 100) / 100;
    agent.money = Math.round((agent.money + moved) * 100) / 100;
    this.recordFinance(agent, moved, "savings", label, "neutral");
    return moved;
  }

  private adjustCredit(agent: SimAgent, amount: number, reason: string) {
    const previous = agent.budget.creditScore;
    agent.budget.creditScore = Math.round(clamp(agent.budget.creditScore + amount, 300, 850));
    if (agent.budget.creditScore !== previous) agent.budget.lastReview = reason;
  }

  private recordFinance(agent: SimAgent, amount: number, category: AgentFinancialCategory, label: string, tone: AgentFinancialTone) {
    const sequence = this.nextSequence();
    agent.finances.unshift({
      id: `${agent.id}-finance-${sequence.toString().padStart(6, "0")}`,
      day: this.currentDay,
      worldTime: this.worldTime,
      category,
      label,
      amount: Math.round(amount * 100) / 100,
      balanceAfter: Math.round(agent.money * 100) / 100,
      tone
    });
    agent.finances.splice(12);
  }
}
