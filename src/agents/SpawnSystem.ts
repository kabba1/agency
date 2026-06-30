import type { StructureMetadata } from "../shared/types";
import type {
  AgentAction,
  AgentAutonomy,
  AgentAspiration,
  AgentBudget,
  AgentCareer,
  AgentCivicRecord,
  AgentCommitment,
  AgentCommitmentCategory,
  AgentDailyRoutine,
  AgentDriveState,
  AgentDna,
  AgentEveningPlan,
  AgentEmotion,
  AgentHousehold,
  AgentIntention,
  AgentLeisure,
  AgentLeisureHobby,
  AgentLifeAdmin,
  AgentLifeProfile,
  AgentNutrition,
  AgentOutfit,
  AgentOutfitStyle,
  AgentPoint,
  AgentReputation,
  AgentRoutineRhythm,
  AgentSleepChronotype,
  AgentSleepState,
  AgentSkillId,
  AgentSkillSet,
  AgentSocialCompass,
  AgentTimeManagement,
  AgentValueProfile,
  SimAgent
} from "./AgentSimulation";
import { clamp, FIRST_NAMES, formatTime, hashText, JOBS, LAST_NAMES, randomFromHash, worldPoint } from "./SimulationPrimitives";

export type SpawnSeedInput = {
  walletAddress: string;
  chainId?: string;
  tokenContract?: string;
  txHash?: string;
  logIndex?: number;
  tokenMint?: string;
  slot?: number;
  purchaseOrdinal?: number;
  seasonId?: string;
  publicGenesisSalt?: string;
};

type SpawnMaterial = {
  agentNumber: number;
  id: string;
  walletAddress: string;
  seedMaterial: string;
};

export class SpawnSystem {
  private nextAgentNumber = 1;

  reset() {
    this.nextAgentNumber = 1;
  }

  spawnLocal(structures: StructureMetadata[], startOverride: AgentPoint | undefined, currentDay: number) {
    const agentNumber = this.nextAgentNumber;
    this.nextAgentNumber += 1;
    const id = `agent-${agentNumber.toString().padStart(3, "0")}`;
    const walletAddress = `local-wallet-${agentNumber.toString().padStart(4, "0")}`;
    return this.createAgent({ agentNumber, id, walletAddress, seedMaterial: `${walletAddress}:${id}` }, structures, startOverride, currentDay);
  }

  spawnFromSeed(input: SpawnSeedInput, structures: StructureMetadata[], startOverride: AgentPoint | undefined, currentDay: number) {
    const agentNumber = this.nextAgentNumber;
    this.nextAgentNumber += 1;
    const id = `agent-${agentNumber.toString().padStart(3, "0")}`;
    const seedMaterial = [
      input.chainId ?? "mock-chain",
      input.tokenContract ?? input.tokenMint ?? "mock-token",
      input.txHash ?? "mock-tx",
      input.logIndex ?? 0,
      input.walletAddress,
      input.purchaseOrdinal ?? agentNumber,
      input.seasonId ?? "genesis",
      input.publicGenesisSalt ?? "agency-local"
    ].join("|");
    return this.createAgent({ agentNumber, id, walletAddress: input.walletAddress, seedMaterial }, structures, startOverride, currentDay);
  }

  createRoutine(day: number): AgentDailyRoutine {
    return {
      day,
      ateToday: false,
      workedToday: false,
      sickLeaveToday: false,
      sickLeaveReason: null,
      socializedToday: false,
      sleptToday: false,
      paidRentToday: false,
      washedToday: false,
      checkedMailToday: false,
      medicalVisitToday: false,
      maintenanceToday: 0,
      lastMaintenance: null,
      earningsToday: 0,
      mealsToday: 0,
      recreationToday: 0,
      autonomyMomentsToday: 0,
      conflictsToday: 0,
      deescalationsToday: 0,
      bondsToday: 0
    };
  }

  createEveningPlan(day: number): AgentEveningPlan {
    return {
      day,
      intent: "none",
      label: "No evening plan yet",
      detail: "The day has not reached evening.",
      outcome: "pending",
      resolved: false
    };
  }

  buildDayPlan(agent: SimAgent) {
    const profile = agent.lifeProfile;
    const workLine =
      agent.dna.discipline > 65
        ? "show up for a reliable shift"
        : agent.dna.greed > 62
          ? "earn as many credits as possible"
          : "try to work enough to stay afloat";
    const socialLine =
      agent.dna.sociability > 62
        ? "find people after work"
        : agent.dna.empathy > 65
          ? "check in on someone familiar"
          : "keep the evening quiet";
    const riskLine =
      agent.dna.risk > 70 || agent.dna.greed > 70 ? "look for a future plot opportunity" : "get home before the night gets too late";
    return [profile.habit, workLine, socialLine, profile.motive || riskLine];
  }

  buildDailyCommitments(agent: SimAgent, day: number): AgentCommitment[] {
    const dayOffset = (day - 1) * 1440;
    const at = (minute: number) => dayOffset + minute;
    const commitment = (
      id: string,
      label: string,
      detail: string,
      actions: AgentAction[],
      category: AgentCommitmentCategory,
      startMinute: number,
      dueMinute: number,
      pressure = 0,
      graceMinutes = 60
    ): AgentCommitment => ({
      id: `${day}:${id}`,
      label,
      detail,
      actions,
      category,
      startWorldMinutes: at(startMinute),
      dueWorldMinutes: at(dueMinute),
      startLabel: formatTime(startMinute),
      dueLabel: formatTime(dueMinute),
      windowLabel: `${formatTime(startMinute)}-${formatTime(dueMinute)}`,
      graceMinutes,
      status: "pending",
      tone: "neutral",
      pressure
    });

    const commitments: AgentCommitment[] = [
      commitment("wash", "Wash Up", "Start the day clean enough for public life.", ["washing"], "self", 7 * 60 + 30, 10 * 60, 0, 45),
      commitment("meal", "Eat A Meal", "Get at least one meal before hunger turns into a crisis.", ["eating", "shopping"], "food", 11 * 60, 13 * 60 + 30, 0, 75),
      commitment("work", "Work Shift", "Earn credits and keep a public reputation for reliability.", ["working"], "work", 9 * 60 + 30, 17 * 60, 0, 75),
      commitment("sleep", "Sleep", "Recover before the next day starts.", ["sleeping", "resting"], "sleep", 21 * 60 + 30, 23 * 60 + 15, 0, 90)
    ];

    const civicDue = agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue;
    if (civicDue > 0 || agent.dna.discipline > 58) {
      commitments.push(
        commitment(
          "mail",
          "Check Notices",
          civicDue > 0 ? "Look for bill notices before they become surprises." : "Keep civic mail from piling up.",
          ["checking_mail"],
          "civic",
          15 * 60 + 30,
          18 * 60,
          0,
          45
        )
      );
    }

    if (civicDue > 0) {
      commitments.push(
        commitment(
          "bills",
          "Handle Bills",
          `${civicDue} credits are due or hanging over the agent.`,
          ["paying_rent", "working"],
          "money",
          14 * 60,
          18 * 60 + 30,
          0,
          60
        )
      );
    }

    if (agent.budget.creditScore < 560 || agent.budget.savings < agent.budget.savingsGoal * 0.4) {
      commitments.push(
        commitment(
          "budget",
          "Review Budget",
          agent.budget.creditScore < 560 ? "Credit and bills need a plan, not just hope." : "Savings are below the cushion this agent wants.",
          ["budgeting", "working"],
          "money",
          17 * 60 + 30,
          19 * 60,
          0,
          45
        )
      );
    }

    if (agent.health < 70 || agent.lifeProfile.archetype === "Caregiver") {
      commitments.push(
        commitment(
          "clinic",
          "Health Check",
          agent.health < 70 ? "Health is low enough to justify a clinic visit." : "Caregiver instincts keep health on the radar.",
          ["healing"],
          "health",
          10 * 60,
          16 * 60,
          0,
          60
        )
      );
    }

    if (agent.household.clutter > 72 || agent.household.laundry > 72 || agent.household.sleepQuality < 42 || agent.lifeProfile.archetype === "Quiet Homebody") {
      commitments.push(
        commitment(
          "home",
          "Reset Home",
          agent.household.sleepQuality < 42 ? "Home conditions are making rest unreliable." : "Clutter and laundry are starting to shape the day.",
          ["cleaning", "washing"],
          "home",
          18 * 60,
          20 * 60,
          0,
          60
        )
      );
    }

    if (agent.dna.sociability > 58 || agent.social < 44 || agent.lifeProfile.archetype === "Social Connector") {
      commitments.push(
        commitment(
          "social",
          "Find A Human Moment",
          "A day should include at least one real social beat.",
          ["socializing", "resting"],
          "social",
          18 * 60 + 30,
          21 * 60,
          0,
          60
        )
      );
    }

    return commitments.sort((a, b) => a.dueWorldMinutes - b.dueWorldMinutes);
  }

  private createAgent(material: SpawnMaterial, structures: StructureMetadata[], startOverride: AgentPoint | undefined, currentDay: number): SimAgent {
    const seed = hashText(material.seedMaterial);
    const home = this.findSpawnHome(structures);
    const homeDoor = home?.structure.actionPoints.find((point) => point.type === "door");
    const start =
      startOverride ??
      (homeDoor
        ? worldPoint(homeDoor.position)
        : home
          ? worldPoint(home.point.position)
          : { x: 0.5 + material.agentNumber, y: 8.08, z: 0.5 });
    const firstName = FIRST_NAMES[(material.agentNumber - 1) % FIRST_NAMES.length] ?? "Ari";
    const lastName =
      LAST_NAMES[(Math.floor(randomFromHash(seed, 2) * LAST_NAMES.length) + material.agentNumber - 1) % LAST_NAMES.length] ?? "Stone";
    const name = `${firstName} ${lastName}`;
    const dna: AgentDna = {
      appearanceHue: Math.floor(randomFromHash(seed, 3) * 360),
      risk: Math.round(randomFromHash(seed, 4) * 100),
      sociability: Math.round(randomFromHash(seed, 5) * 100),
      discipline: Math.round(randomFromHash(seed, 6) * 100),
      greed: Math.round(randomFromHash(seed, 7) * 100),
      empathy: Math.round(randomFromHash(seed, 8) * 100),
      preferredJob: JOBS[Math.floor(randomFromHash(seed, 9) * JOBS.length)] ?? "builder"
    };
    const lifeProfile = this.buildLifeProfile(dna, seed);
    const values = this.buildValueProfile(dna, lifeProfile, seed);
    const reputation = this.buildInitialReputation(dna, seed);
    const budget = this.buildInitialBudget(dna, seed);
    const aspiration = this.buildAspiration(dna, lifeProfile, seed);
    const career = this.buildInitialCareer(dna, seed);
    const civic = this.buildInitialCivicRecord(dna, seed);
    const household = this.buildInitialHousehold(dna, seed);
    const outfit = this.buildInitialOutfit(dna, lifeProfile, seed);
    const skills = this.buildInitialSkills(dna, seed);
    const initialHunger = Math.round(35 + randomFromHash(seed, 10) * 30);
    const nutrition = this.buildInitialNutrition(dna, seed, initialHunger);
    const leisure = this.buildInitialLeisure(dna, lifeProfile, seed);
    const sleep = this.buildInitialSleep(dna, lifeProfile, household, seed);
    const autonomy = this.buildInitialAutonomy(dna, lifeProfile, values, seed);
    const time = this.buildInitialTimeManagement(dna, lifeProfile, seed);
    const rhythm = this.buildInitialRoutineRhythm(dna, lifeProfile, seed);
    const emotion = this.buildInitialEmotion(dna, lifeProfile, rhythm, seed);
    const socialCompass = this.buildInitialSocialCompass(dna, emotion, seed);
    const lifeAdmin = this.buildInitialLifeAdmin();
    const initialIntention = this.initialIntention();
    const agent: SimAgent = {
      id: material.id,
      name,
      walletAddress: material.walletAddress,
      dna,
      position: start,
      target: null,
      currentAction: "idle",
      goal: "Get oriented in Genesis District",
      plan: ["Look around", "Find the first useful stop"],
      dayPlan: [],
      reflection: "I just arrived and need to learn the town.",
      lastDecision: "Spawned into the world.",
      lifeProfile,
      values,
      activeDrive: this.initialActiveDrive(values),
      lifePriority: {
        id: "orientation",
        label: "Getting Oriented",
        detail: "learning where the useful places are",
        tone: "neutral"
      },
      activeIntention: initialIntention,
      decisionRead: {
        worldTime: "08:00",
        phaseLabel: "Morning",
        primaryNeed: "Getting oriented",
        intention: initialIntention.label,
        style: "new arrival",
        urgency: initialIntention.urgency,
        confidence: initialIntention.confidence,
        optionWindow: 0,
        randomness: 0,
        selectedOptionId: null,
        selectedLabel: "No choice made yet",
        selectedAction: "none",
        reason: "Spawned into the world and has not chosen a semantic action yet.",
        factors: ["new agent", "waiting for first plan"],
        options: []
      },
      aspiration,
      skills,
      commitments: [],
      availableActions: [],
      reputation,
      hunger: initialHunger,
      energy: Math.round(58 + randomFromHash(seed, 11) * 30),
      health: Math.round(76 + randomFromHash(seed, 12) * 18),
      mood: Math.round(45 + randomFromHash(seed, 13) * 35),
      social: Math.round(35 + randomFromHash(seed, 14) * 45),
      hygiene: Math.round(62 + randomFromHash(seed, 15) * 28),
      comfort: Math.round(45 + randomFromHash(seed, 16) * 35),
      stress: Math.round(10 + randomFromHash(seed, 17) * 24),
      money: Math.round(16 + randomFromHash(seed, 18) * 20),
      rentDue: 0,
      medicalDebt: 0,
      medical: {
        isHospitalized: false,
        facilityName: null,
        admittedWorldTime: null,
        dischargeWorldMinutes: 0,
        reason: null,
        bill: 0,
        minorIllness: {
          active: false,
          label: null,
          severity: 0,
          startedWorldTime: null,
          startedWorldMinutes: 0,
          recoveryWorldMinutes: 0,
          lastResolvedWorldMinutes: -9999
        },
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
      },
      finances: [],
      budget,
      career,
      civic,
      household,
      outfit,
      nutrition,
      leisure,
      sleep,
      autonomy,
      time,
      rhythm,
      emotion,
      job: dna.preferredJob,
      home: home?.structure.name ?? "No home",
      inventory: [],
      relationships: {},
      relationshipDetails: {},
      placeMemory: {},
      activityMemory: {},
      socialFocus: null,
      socialCompass,
      lifeAdmin,
      eveningPlan: this.createEveningPlan(currentDay),
      socialMoments: [],
      memories: [],
      moodlets: [],
      wants: [],
      personalNotices: [],
      statusEffects: [],
      routine: this.createRoutine(currentDay),
      speed: 2.35 + randomFromHash(seed, 19) * 0.85,
      dwellSeconds: 0,
      dwellTotalSeconds: 0,
      actionProgress: 0,
      observationCooldown: 1.5
    };
    agent.dayPlan = this.buildDayPlan(agent);
    agent.commitments = this.buildDailyCommitments(agent, currentDay);
    return agent;
  }

  private buildAspiration(dna: AgentDna, profile: AgentLifeProfile, seed: number): AgentAspiration {
    const baseProgress = Math.round(8 + randomFromHash(seed, 42) * 16);
    const aspiration = (
      id: AgentAspiration["id"],
      label: string,
      detail: string,
      actions: AgentAction[],
      signals: string[]
    ): AgentAspiration => ({
      id,
      label,
      detail,
      actions,
      signals,
      level: 1,
      progress: baseProgress,
      dailyProgress: 0,
      pressure: 0,
      tone: "neutral",
      milestone: `${100 - baseProgress} progress to level 2`,
      history: [`Arrived wanting to ${detail.toLowerCase()}.`]
    });

    if (profile.archetype === "Plot Dreamer") {
      return aspiration("building", "Claim A Future Plot", "turn earned credits into a real place in the city", ["building", "working", "checking_mail"], [
        "build",
        "future",
        "ambition",
        "work",
        "money"
      ]);
    }

    if (profile.archetype === "Ambitious Earner" || dna.greed > 66) {
      return aspiration("career", "Become Secure", "build enough income and savings to stop living day to day", ["working", "budgeting", "paying_rent", "checking_mail"], [
        "work",
        "money",
        "career",
        "stability",
        "rent"
      ]);
    }

    if (profile.archetype === "Social Connector" || dna.sociability > 66) {
      return aspiration("belonging", "Belong Somewhere", "make the city feel less anonymous", ["socializing", "resting"], [
        "social",
        "belonging",
        "relationship",
        "park"
      ]);
    }

    if (profile.archetype === "Caregiver" || dna.empathy > 70) {
      return aspiration("wellness", "Keep People Okay", "keep health, care, and public calm from falling apart", ["healing", "socializing", "working"], [
        "health",
        "clinic",
        "wellness",
        "social",
        "maintenance"
      ]);
    }

    if (profile.archetype === "Quiet Homebody" || dna.sociability < 34) {
      return aspiration("comfort", "Make Life Livable", "protect a calm home rhythm in a noisy town", ["sleeping", "resting", "eating", "washing", "cleaning"], [
        "home",
        "comfort",
        "food",
        "hygiene",
        "wellness"
      ]);
    }

    return aspiration("stability", "Hold Life Together", "keep money, needs, work, and people from slipping too far", ["working", "budgeting", "eating", "washing", "cleaning", "checking_mail", "socializing"], [
      "stability",
      "routine",
      "work",
      "food",
      "mail",
      "social"
    ]);
  }

  private buildLifeProfile(dna: AgentDna, seed: number): AgentLifeProfile {
    const profileRoll = randomFromHash(seed, 20);
    if (dna.greed > 68 && dna.discipline > 45) {
      return {
        archetype: "Ambitious Earner",
        motive: "stack credits before comfort",
        habit: "look for paid work early",
        worry: "falling behind on money",
        actionBiases: { working: 22, budgeting: 12, paying_rent: 9, shopping: 5, building: 8, resting: -9, socializing: -4 }
      };
    }
    if (dna.risk > 74 || (dna.risk > 62 && dna.greed > 62)) {
      return {
        archetype: "Plot Dreamer",
        motive: "find a way into future land and builds",
        habit: "inspect civic rules and buildable lots",
        worry: "missing the next big opportunity",
        actionBiases: { building: 24, working: 7, shopping: 5, socializing: 3, sleeping: -8, resting: -6 }
      };
    }
    if (dna.sociability > 68 && dna.empathy > 45) {
      return {
        archetype: "Social Connector",
        motive: "turn strangers into familiar faces",
        habit: "check the park after obligations",
        worry: "ending the day alone",
        actionBiases: { socializing: 26, resting: 4, working: -5, checking_mail: 4, building: -5 }
      };
    }
    if (dna.empathy > 72) {
      return {
        archetype: "Caregiver",
        motive: "keep people and places stable",
        habit: "notice health, conflict, and civic errands",
        worry: "someone needing help nearby",
        actionBiases: { healing: 16, socializing: 12, cleaning: 8, paying_rent: 8, checking_mail: 6, working: 2, building: -4 }
      };
    }
    if (dna.discipline > 72) {
      return {
        archetype: "Reliable Citizen",
        motive: "finish the day's obligations cleanly",
        habit: "wash, work, check mail, and pay what is due",
        worry: "leaving routine tasks unfinished",
        actionBiases: { washing: 12, cleaning: 14, working: 20, budgeting: 12, checking_mail: 10, paying_rent: 14, resting: -4, socializing: -3 }
      };
    }
    if (dna.sociability < 34 || profileRoll < 0.18) {
      return {
        archetype: "Quiet Homebody",
        motive: "keep life small, calm, and manageable",
        habit: "return home when pressure rises",
        worry: "being pulled into noisy crowds",
        actionBiases: { resting: 18, sleeping: 9, eating: 8, cleaning: 12, washing: 7, socializing: -18, building: -4 }
      };
    }
    return {
      archetype: "Balanced Local",
      motive: "keep needs, work, and people in balance",
      habit: "follow the most obvious pressure",
      worry: "letting one part of life slip",
      actionBiases: { eating: 5, working: 5, budgeting: 4, socializing: 5, cleaning: 4, resting: 4, checking_mail: 3 }
    };
  }

  private buildValueProfile(dna: AgentDna, profile: AgentLifeProfile, seed: number): AgentValueProfile {
    const jitter = (salt: number) => (randomFromHash(seed, salt) - 0.5) * 10;
    const values: AgentValueProfile = {
      security: Math.round(clamp(45 + dna.discipline * 0.24 - dna.risk * 0.12 + Math.max(0, 58 - dna.greed) * 0.08 + jitter(46))),
      belonging: Math.round(clamp(38 + dna.sociability * 0.34 + dna.empathy * 0.11 - dna.greed * 0.06 + jitter(47))),
      mastery: Math.round(clamp(40 + dna.discipline * 0.18 + dna.greed * 0.2 + dna.risk * 0.08 + jitter(48))),
      care: Math.round(clamp(34 + dna.empathy * 0.42 + dna.sociability * 0.08 - dna.greed * 0.1 + jitter(49))),
      comfort: Math.round(clamp(42 + Math.max(0, 62 - dna.risk) * 0.18 + Math.max(0, 58 - dna.sociability) * 0.1 + dna.discipline * 0.08 + jitter(50))),
      autonomy: Math.round(clamp(36 + dna.risk * 0.26 + dna.greed * 0.12 + Math.max(0, 55 - dna.discipline) * 0.06 + jitter(51)))
    };

    const nudge = (key: keyof AgentValueProfile, amount: number) => {
      values[key] = Math.round(clamp(values[key] + amount));
    };
    switch (profile.archetype) {
      case "Ambitious Earner":
        nudge("security", 9);
        nudge("mastery", 10);
        break;
      case "Plot Dreamer":
        nudge("autonomy", 12);
        nudge("mastery", 6);
        break;
      case "Social Connector":
        nudge("belonging", 13);
        nudge("care", 4);
        break;
      case "Caregiver":
        nudge("care", 14);
        nudge("belonging", 4);
        break;
      case "Reliable Citizen":
        nudge("security", 10);
        nudge("mastery", 5);
        break;
      case "Quiet Homebody":
        nudge("comfort", 14);
        nudge("security", 5);
        break;
      default:
        break;
    }

    return values;
  }

  private initialActiveDrive(values: AgentValueProfile): AgentDriveState {
    const labels: Record<keyof AgentValueProfile, string> = {
      security: "Security",
      belonging: "Belonging",
      mastery: "Mastery",
      care: "Care",
      comfort: "Comfort",
      autonomy: "Autonomy"
    };
    const [id, value] = Object.entries(values).sort(([, a], [, b]) => b - a)[0] as [keyof AgentValueProfile, number];
    return {
      id,
      label: labels[id],
      detail: "baseline personality pull",
      value,
      pressure: Math.round(clamp(value * 0.58)),
      tone: "neutral"
    };
  }

  private initialIntention(): AgentIntention {
    return {
      id: "orientation",
      label: "Get Oriented",
      detail: "learn what this district can offer",
      reason: "new arrival",
      horizon: "now",
      urgency: 32,
      confidence: 52,
      tone: "neutral",
      actions: ["checking_mail", "resting", "socializing"],
      actionBiases: { checking_mail: 6, resting: 4, socializing: 3 },
      tags: ["orientation", "arrival"],
      createdWorldTime: "08:00",
      updatedWorldTime: "08:00",
      history: ["Arrived needing to learn the district."]
    };
  }

  private buildInitialSkills(dna: AgentDna, seed: number): AgentSkillSet {
    const labels: Record<AgentSkillId, string> = {
      labor: "Labor",
      commerce: "Commerce",
      care: "Care",
      social: "Social Tact",
      homecraft: "Homecraft",
      civic: "Civic Sense"
    };
    const aptitudeFor = (skillId: AgentSkillId, salt: number) => {
      const base: Record<AgentSkillId, number> = {
        labor: 36 + dna.discipline * 0.18 + dna.risk * 0.12,
        commerce: 34 + dna.greed * 0.22 + dna.discipline * 0.08,
        care: 32 + dna.empathy * 0.32 + dna.discipline * 0.08,
        social: 32 + dna.sociability * 0.28 + dna.empathy * 0.16,
        homecraft: 36 + dna.discipline * 0.2 + Math.max(0, 62 - dna.risk) * 0.1,
        civic: 34 + dna.discipline * 0.24 + Math.max(0, 60 - dna.risk) * 0.08
      };
      return Math.round(clamp(base[skillId] + (randomFromHash(seed, salt) - 0.5) * 14));
    };
    const preferred: Record<string, AgentSkillId> = {
      builder: "labor",
      materials_clerk: "labor",
      grocer: "commerce",
      clinician: "care",
      security_officer: "social",
      clerk: "civic"
    };
    const jobSkill = preferred[dna.preferredJob] ?? "labor";
    const makeSkill = (skillId: AgentSkillId, index: number) => {
      const aptitude = aptitudeFor(skillId, 52 + index);
      const jobBoost = skillId === jobSkill ? 1 : 0;
      const level = Math.max(1, Math.min(3, 1 + jobBoost + (aptitude >= 72 ? 1 : 0)));
      const xpToNext = 46 + level * 18;
      return {
        id: skillId,
        label: labels[skillId],
        level,
        xp: Math.round(randomFromHash(seed, 60 + index) * 18 * 10) / 10,
        xpToNext,
        aptitude,
        recent: [`Arrived with ${aptitude} aptitude for ${labels[skillId].toLowerCase()}.`]
      };
    };
    return {
      labor: makeSkill("labor", 0),
      commerce: makeSkill("commerce", 1),
      care: makeSkill("care", 2),
      social: makeSkill("social", 3),
      homecraft: makeSkill("homecraft", 4),
      civic: makeSkill("civic", 5)
    };
  }

  private buildInitialReputation(dna: AgentDna, seed: number): AgentReputation {
    const variance = (salt: number) => (randomFromHash(seed, salt) - 0.5) * 12;
    return {
      reliability: Math.round(clamp(44 + (dna.discipline - 50) * 0.26 - (dna.risk - 50) * 0.06 + variance(31))),
      warmth: Math.round(clamp(42 + (dna.empathy - 50) * 0.22 + (dna.sociability - 50) * 0.16 + variance(32))),
      ambition: Math.round(clamp(42 + (dna.greed - 50) * 0.18 + (dna.risk - 50) * 0.14 + (dna.discipline - 50) * 0.08 + variance(33))),
      trouble: Math.round(clamp(24 + (dna.risk - 50) * 0.16 + (dna.greed - 50) * 0.08 - (dna.empathy - 50) * 0.1 + variance(34)))
    };
  }

  private buildInitialBudget(dna: AgentDna, seed: number): AgentBudget {
    const startingSavings = Math.round(4 + dna.discipline * 0.1 + randomFromHash(seed, 35) * 10 - dna.risk * 0.03);
    const livingCostBase = Math.round(2 + randomFromHash(seed, 38) * 2 + Math.max(0, 58 - dna.discipline) * 0.018);
    const creditScore = Math.round(
      clamp(560 + (dna.discipline - 50) * 1.25 - (dna.risk - 50) * 0.7 - (dna.greed - 50) * 0.35 + randomFromHash(seed, 36) * 64, 420, 780)
    );
    return {
      savings: Math.max(0, startingSavings),
      savingsGoal: Math.round(24 + dna.discipline * 0.28 + Math.max(0, 60 - dna.risk) * 0.12),
      dailySpendLimit: Math.round(8 + dna.discipline * 0.06 + Math.max(0, 45 - dna.greed) * 0.04),
      spentToday: 0,
      savedToday: 0,
      emergencyWithdrawalsToday: 0,
      livingCostDue: 0,
      livingCostBase,
      livingCostCadenceDays: dna.discipline > 62 ? 3 : 2,
      nextLivingCostDay: 2,
      lastLivingCostLabel: "No living costs due yet",
      overdueBillDays: 0,
      lateFeesToday: 0,
      hardshipDeferrals: 0,
      creditScore,
      onTimeBillStreak: Math.floor(randomFromHash(seed, 37) * 2),
      missedBillCount: 0,
      lastReview: "New arrival"
    };
  }

  private buildInitialHousehold(dna: AgentDna, seed: number): AgentHousehold {
    const pantryCapacity = Math.round(4 + randomFromHash(seed, 41) * 2 + (dna.discipline > 64 ? 1 : 0));
    const pantry = Math.min(pantryCapacity, Math.max(0, Math.round(1 + dna.discipline * 0.025 + randomFromHash(seed, 42) * 2 - dna.risk * 0.012)));
    const supplyCapacity = Math.round(4 + randomFromHash(seed, 46) * 2 + (dna.discipline > 68 ? 1 : 0));
    const toiletries = Math.min(supplyCapacity, Math.max(0, Math.round(1 + dna.discipline * 0.022 + randomFromHash(seed, 47) * 2 - dna.risk * 0.01)));
    const cleaningSupplies = Math.min(supplyCapacity, Math.max(0, Math.round(1 + dna.discipline * 0.02 + randomFromHash(seed, 48) * 2 - dna.risk * 0.012)));
    const clutter = Math.round(clamp(28 + Math.max(0, 58 - dna.discipline) * 0.32 + dna.risk * 0.08 + randomFromHash(seed, 43) * 18));
    const laundry = Math.round(clamp(22 + Math.max(0, 55 - dna.discipline) * 0.3 + randomFromHash(seed, 44) * 22));
    const homeComfort = Math.round(clamp(48 + dna.empathy * 0.06 + dna.discipline * 0.11 - clutter * 0.12 + randomFromHash(seed, 45) * 14));
    const sleepQuality = Math.round(clamp(50 + homeComfort * 0.25 - clutter * 0.12 - laundry * 0.08));
    return {
      pantry,
      pantryCapacity,
      toiletries,
      cleaningSupplies,
      supplyCapacity,
      clutter,
      laundry,
      sleepQuality,
      homeComfort,
      rentStress: 0,
      choresDoneToday: 0,
      recent: ["Moved into a small apartment and started setting a rhythm."]
    };
  }

  private buildInitialOutfit(dna: AgentDna, lifeProfile: AgentLifeProfile, seed: number): AgentOutfit {
    const jobStyle: Partial<Record<string, AgentOutfitStyle>> = {
      builder: "workwear",
      materials_clerk: "workwear",
      grocer: "tidy",
      clinician: "tidy",
      security_officer: "workwear",
      clerk: "tidy"
    };
    const style =
      jobStyle[dna.preferredJob] ??
      (lifeProfile.archetype === "Social Connector" || dna.sociability > 72 ? "bright" : lifeProfile.archetype === "Quiet Homebody" ? "soft" : "casual");
    const cleanliness = Math.round(clamp(56 + dna.discipline * 0.22 - dna.risk * 0.08 + randomFromHash(seed, 49) * 22, 32, 94));
    const wear = Math.round(clamp(14 + Math.max(0, 62 - dna.discipline) * 0.18 + dna.risk * 0.08 + randomFromHash(seed, 50) * 22, 6, 64));
    const confidence = Math.round(
      clamp(24 + cleanliness * 0.38 - wear * 0.26 + dna.sociability * 0.08 + (style === "bright" ? 6 : style === "tidy" ? 4 : 0), 18, 88)
    );
    return {
      style,
      cleanliness,
      wear,
      confidence,
      recent: [`Arrived in a ${style} outfit that already says something about them.`]
    };
  }

  private buildInitialNutrition(dna: AgentDna, seed: number, hunger: number): AgentNutrition {
    const disciplineCare = dna.discipline * 0.14 + dna.empathy * 0.04 - dna.risk * 0.06;
    const quality = Math.round(clamp(42 + disciplineCare + randomFromHash(seed, 52) * 24, 24, 86));
    const hydration = Math.round(clamp(48 + dna.discipline * 0.16 - dna.risk * 0.05 + randomFromHash(seed, 53) * 28, 26, 92));
    const variety = Math.round(clamp(38 + dna.sociability * 0.08 + dna.discipline * 0.09 - dna.greed * 0.04 + randomFromHash(seed, 54) * 30, 20, 88));
    const fullness = Math.round(clamp(100 - hunger + randomFromHash(seed, 55) * 12 - 4, 22, 78));
    return {
      quality,
      hydration,
      variety,
      fullness,
      lastMealLabel: "arrival snack",
      recent: [`Arrived with ${quality >= 62 ? "decent" : quality < 38 ? "rough" : "ordinary"} food habits and ${hydration >= 62 ? "steady" : "thin"} hydration.`]
    };
  }

  private buildInitialLeisure(dna: AgentDna, lifeProfile: AgentLifeProfile, seed: number): AgentLeisure {
    const hobbies: AgentLeisureHobby[] =
      lifeProfile.archetype === "Social Connector"
        ? ["people_watching", "music", "games"]
        : lifeProfile.archetype === "Quiet Homebody"
          ? ["reading", "games", "crafting"]
          : dna.preferredJob === "builder" || dna.preferredJob === "materials_clerk"
            ? ["crafting", "fitness", "games"]
            : dna.preferredJob === "clinician"
              ? ["reading", "fitness", "music"]
              : ["music", "games", "people_watching", "reading", "crafting"];
    const hobby = hobbies[Math.floor(randomFromHash(seed, 56) * hobbies.length)] ?? "music";
    const fun = Math.round(clamp(42 + dna.sociability * 0.08 + Math.max(0, 58 - dna.discipline) * 0.05 + randomFromHash(seed, 57) * 28, 24, 86));
    const boredom = Math.round(clamp(38 + Math.max(0, 62 - fun) * 0.52 + Math.max(0, dna.discipline - 68) * 0.08 + randomFromHash(seed, 58) * 18, 10, 78));
    const curiosity = Math.round(clamp(36 + dna.risk * 0.12 + dna.sociability * 0.08 + randomFromHash(seed, 59) * 30, 18, 88));
    return {
      hobby,
      fun,
      boredom,
      curiosity,
      recent: [`Arrived with ${hobby.replace(/_/g, " ")} as their favorite way to unwind.`]
    };
  }

  private buildInitialSleep(dna: AgentDna, lifeProfile: AgentLifeProfile, household: AgentHousehold, seed: number): AgentSleepState {
    const chronotype: AgentSleepChronotype =
      lifeProfile.archetype === "Quiet Homebody" || dna.discipline >= 72
        ? "early_bird"
        : dna.risk >= 68 || dna.sociability >= 72
          ? "night_owl"
          : "steady";
    const schedule =
      chronotype === "early_bird"
        ? { bedtimeTarget: 21 * 60 + 45, wakeTarget: 6 * 60 }
        : chronotype === "night_owl"
          ? { bedtimeTarget: 23 * 60 + 45, wakeTarget: 8 * 60 }
          : { bedtimeTarget: 22 * 60 + 30, wakeTarget: 7 * 60 };
    const sleepDebt = Math.round(clamp(24 + Math.max(0, 58 - household.sleepQuality) * 0.42 + randomFromHash(seed, 60) * 28, 8, 76));
    const circadianFatigue = Math.round(clamp(18 + Math.max(0, dna.risk - dna.discipline) * 0.18 + randomFromHash(seed, 61) * 24, 6, 72));
    const hoursSleptLastNight = Math.round(clamp(7.2 - sleepDebt * 0.025 + household.sleepQuality * 0.012, 4.2, 8.8) * 10) / 10;
    return {
      chronotype,
      sleepDebt,
      circadianFatigue,
      bedtimeTarget: schedule.bedtimeTarget,
      wakeTarget: schedule.wakeTarget,
      hoursSleptLastNight,
      recent: [`Arrived as a ${chronotype.replace(/_/g, " ")} with ${hoursSleptLastNight}h of recent sleep.`]
    };
  }

  private buildInitialAutonomy(dna: AgentDna, lifeProfile: AgentLifeProfile, values: AgentValueProfile, seed: number): AgentAutonomy {
    const profileControl = lifeProfile.archetype === "Reliable Citizen" ? 8 : lifeProfile.archetype === "Quiet Homebody" ? 5 : lifeProfile.archetype === "Plot Dreamer" ? -2 : 0;
    const dignity = Math.round(clamp(50 + dna.discipline * 0.16 + dna.empathy * 0.08 - dna.risk * 0.05 + randomFromHash(seed, 62) * 22, 34, 92));
    const control = Math.round(clamp(42 + values.autonomy * 0.28 + dna.discipline * 0.14 - dna.risk * 0.08 + profileControl + randomFromHash(seed, 63) * 18, 28, 90));
    const overwhelm = Math.round(clamp(28 + Math.max(0, 58 - control) * 0.34 + Math.max(0, dna.risk - dna.discipline) * 0.12 + randomFromHash(seed, 64) * 18, 8, 78));
    return {
      dignity,
      control,
      overwhelm,
      recent: [`Arrived with ${control >= 64 ? "a clear sense of control" : "a shaky sense of control"} and ${dignity >= 64 ? "solid" : "fragile"} self-respect.`]
    };
  }

  private buildInitialTimeManagement(dna: AgentDna, lifeProfile: AgentLifeProfile, seed: number): AgentTimeManagement {
    const profileBoost =
      lifeProfile.archetype === "Reliable Citizen"
        ? 10
        : lifeProfile.archetype === "Ambitious Earner"
          ? 5
          : lifeProfile.archetype === "Quiet Homebody"
            ? 3
            : lifeProfile.archetype === "Plot Dreamer"
              ? -4
              : 0;
    const punctuality = Math.round(clamp(42 + dna.discipline * 0.36 - dna.risk * 0.14 + profileBoost + randomFromHash(seed, 65) * 18, 20, 92));
    const timeAwareness = Math.round(clamp(36 + dna.discipline * 0.28 + dna.empathy * 0.05 - dna.greed * 0.04 + profileBoost * 0.5 + randomFromHash(seed, 66) * 22, 18, 90));
    const rush = Math.round(clamp(18 + Math.max(0, 54 - punctuality) * 0.28 + Math.max(0, dna.risk - dna.discipline) * 0.1 + randomFromHash(seed, 67) * 16, 6, 62));
    return {
      punctuality,
      timeAwareness,
      rush,
      keptWindowsToday: 0,
      lateWindowsToday: 0,
      missedWindowsToday: 0,
      recent: [`Arrived with ${punctuality >= 64 ? "reliable" : punctuality < 38 ? "loose" : "ordinary"} timing and ${timeAwareness >= 62 ? "strong" : "developing"} time awareness.`]
    };
  }

  private buildInitialRoutineRhythm(dna: AgentDna, lifeProfile: AgentLifeProfile, seed: number): AgentRoutineRhythm {
    const profileBoost =
      lifeProfile.archetype === "Reliable Citizen"
        ? 8
        : lifeProfile.archetype === "Caregiver"
          ? 5
          : lifeProfile.archetype === "Ambitious Earner"
            ? 4
            : lifeProfile.archetype === "Plot Dreamer"
              ? -3
              : 0;
    const work = Math.round(clamp(42 + dna.discipline * 0.28 + dna.greed * 0.08 - dna.risk * 0.08 + profileBoost + randomFromHash(seed, 68) * 18, 18, 88));
    const care = Math.round(clamp(38 + dna.discipline * 0.2 + dna.empathy * 0.12 - dna.risk * 0.08 + profileBoost * 0.6 + randomFromHash(seed, 69) * 20, 18, 88));
    const home = Math.round(clamp(36 + dna.discipline * 0.24 + dna.empathy * 0.08 - dna.risk * 0.07 + (lifeProfile.archetype === "Quiet Homebody" ? 9 : 0) + randomFromHash(seed, 70) * 20, 18, 90));
    const social = Math.round(clamp(34 + dna.sociability * 0.32 + dna.empathy * 0.08 - dna.discipline * 0.03 + (lifeProfile.archetype === "Social Connector" ? 10 : 0) + randomFromHash(seed, 71) * 18, 16, 92));
    const finance = Math.round(clamp(38 + dna.discipline * 0.25 + dna.greed * 0.06 - dna.risk * 0.12 + profileBoost + randomFromHash(seed, 72) * 20, 18, 88));
    const average = (work + care + home + social + finance) / 5;
    const drift = Math.round(clamp(68 - average + Math.max(0, dna.risk - dna.discipline) * 0.12 + randomFromHash(seed, 73) * 12, 8, 72));
    const momentum = Math.round(clamp(average * 0.72 + Math.max(0, dna.discipline - 52) * 0.16 + randomFromHash(seed, 74) * 12, 12, 82));
    return {
      work,
      care,
      home,
      social,
      finance,
      momentum,
      drift,
      streak: 0,
      strainDays: 0,
      identity: average >= 68 ? "settled rhythm" : drift >= 54 ? "fragile rhythm" : "forming rhythm",
      recent: [`Arrived with a ${average >= 68 ? "settled" : drift >= 54 ? "fragile" : "forming"} daily rhythm.`]
    };
  }

  private buildInitialEmotion(dna: AgentDna, lifeProfile: AgentLifeProfile, rhythm: AgentRoutineRhythm, seed: number): AgentEmotion {
    const socialConnector = lifeProfile.archetype === "Social Connector";
    const quietHomebody = lifeProfile.archetype === "Quiet Homebody";
    const composure = Math.round(clamp(42 + dna.discipline * 0.24 + dna.empathy * 0.08 - dna.risk * 0.12 + randomFromHash(seed, 75) * 22, 22, 90));
    const loneliness = Math.round(
      clamp(42 + (socialConnector ? 12 : quietHomebody ? -6 : 0) + Math.max(0, 58 - dna.sociability) * 0.16 - dna.empathy * 0.04 + randomFromHash(seed, 76) * 22, 10, 86)
    );
    const confidence = Math.round(clamp(34 + dna.discipline * 0.12 + dna.sociability * 0.11 + rhythm.momentum * 0.12 - dna.risk * 0.04 + randomFromHash(seed, 77) * 24, 18, 90));
    const irritation = Math.round(clamp(16 + dna.risk * 0.16 + dna.greed * 0.06 - dna.empathy * 0.08 + Math.max(0, rhythm.drift - 48) * 0.12 + randomFromHash(seed, 78) * 18, 4, 72));
    const hope = Math.round(clamp(38 + dna.risk * 0.08 + dna.empathy * 0.1 + rhythm.momentum * 0.16 - rhythm.drift * 0.08 + randomFromHash(seed, 79) * 24, 18, 92));
    return {
      composure,
      loneliness,
      confidence,
      irritation,
      hope,
      recent: [`Arrived feeling ${hope >= 62 ? "hopeful" : hope < 34 ? "uncertain" : "cautiously open"} and ${composure >= 62 ? "composed" : "a little raw"}.`]
    };
  }

  private buildInitialSocialCompass(dna: AgentDna, emotion: AgentEmotion, seed: number): AgentSocialCompass {
    const trust = Math.round(clamp(30 + dna.empathy * 0.2 + dna.sociability * 0.08 + randomFromHash(seed, 80) * 16, 18, 72));
    const tension = Math.round(clamp(12 + dna.risk * 0.12 - dna.empathy * 0.04 + randomFromHash(seed, 81) * 14, 2, 58));
    const belonging = Math.round(clamp(28 + dna.sociability * 0.18 + emotion.hope * 0.12 - emotion.loneliness * 0.2 + randomFromHash(seed, 82) * 18, 8, 64));
    return {
      stance: "newcomer",
      detail: "No one in town knows them yet.",
      belonging,
      trust,
      tension,
      supportOwed: 0,
      supportGiven: 0,
      relationshipCount: 0,
      friendCount: 0,
      rivalCount: 0,
      recent: ["Arrived socially anonymous."]
    };
  }

  private buildInitialLifeAdmin(): AgentLifeAdmin {
    return {
      load: 12,
      urgency: 10,
      paperwork: 8,
      supplies: 8,
      homeCare: 8,
      healthFollowup: 0,
      civic: 6,
      money: 6,
      dominantCategory: "paperwork",
      nextTask: "Learn the apartment, mailbox, store, clinic, and town hall.",
      detail: "new arrival with no urgent errands yet",
      suggestedActions: ["checking_mail", "resting"],
      recent: ["Arrived with a clear slate."]
    };
  }

  private buildInitialCareer(dna: AgentDna, seed: number): AgentCareer {
    const jobTitles: Record<string, string> = {
      builder: "Apprentice Builder",
      materials_clerk: "Materials Clerk",
      grocer: "Market Associate",
      clinician: "Clinic Aide",
      security_officer: "Security Cadet",
      clerk: "Civic Clerk"
    };
    const baseWageByJob: Record<string, number> = {
      builder: 11,
      materials_clerk: 10,
      grocer: 9,
      clinician: 11,
      security_officer: 10,
      clerk: 9
    };
    const baseWage = baseWageByJob[dna.preferredJob] ?? 9;
    const performance = Math.round(clamp(45 + dna.discipline * 0.26 + dna.empathy * 0.08 - dna.risk * 0.05 + (randomFromHash(seed, 38) - 0.5) * 12));
    const satisfaction = Math.round(clamp(50 + dna.discipline * 0.06 + dna.greed * 0.04 + dna.empathy * 0.03 - dna.risk * 0.03));
    return {
      title: jobTitles[dna.preferredJob] ?? "District Worker",
      level: 1,
      xp: Math.round(randomFromHash(seed, 39) * 18),
      xpToNext: 60,
      wage: Math.max(7, Math.round(baseWage + dna.discipline / 45 + dna.greed / 80)),
      performance,
      satisfaction,
      burnout: Math.round(clamp(8 + dna.risk * 0.08 + Math.max(0, 52 - dna.discipline) * 0.1 + randomFromHash(seed, 40) * 10)),
      attendanceStreak: 0,
      missedShifts: 0,
      recent: ["New to the district workforce."]
    };
  }

  private buildInitialCivicRecord(dna: AgentDna, seed: number): AgentCivicRecord {
    const publicInstinct = 34 + dna.empathy * 0.18 + dna.discipline * 0.12 - dna.greed * 0.05 + (randomFromHash(seed, 45) - 0.5) * 10;
    return {
      serviceReputation: Math.round(clamp(publicInstinct, 18, 72)),
      serviceImpactToday: 0,
      demandResolvedToday: 0,
      pressureRelievedToday: 0,
      lastService: null,
      recent: ["New arrival with no public service history yet."]
    };
  }

  private findSpawnHome(structures: StructureMetadata[]) {
    for (const structure of structures) {
      if (structure.type !== "apartment") continue;
      const point = structure.actionPoints.find((candidate) => candidate.type === "home_anchor" || candidate.type === "bed");
      if (point) return { point, structure, action: "idle" as const };
    }
    return null;
  }
}
