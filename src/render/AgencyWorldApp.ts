import * as THREE from "three";
import { isSolidBlock } from "../world/blocks";
import { VoxelWorld } from "../world/VoxelWorld";
import { AgentPathfinder, type AgentNavPoint } from "../world/AgentPathfinder";
import { PlayerController } from "../player/PlayerController";
import { ChunkRenderer } from "./ChunkRenderer";
import { createScene } from "./createScene";
import { SemanticDioramaLayer } from "./SemanticDioramaLayer";
import {
  AgentSimulation,
  type AgentAutonomy,
  type AgentDriveId,
  type AgentEmotion,
  type AgentLeisure,
  type AgentNutrition,
  type AgentOutfitStyle,
  type AgentRoutineRhythm,
  type AgentSleepState,
  type AgentSkillId,
  type AgentTimeManagement,
  type AgentSummary,
  type SimAgent,
  type WeatherState
} from "../agents/AgentSimulation";
import { clamp, SIM_MINUTES_PER_SECOND } from "../agents/SimulationPrimitives";
import type { CityMapMetadata, FlatWorldOptions, StructureMetadata, WorldGenerationConfig } from "../shared/types";

const MAX_DEVICE_PIXEL_RATIO = 1.5;
const DEBUG_REFRESH_SECONDS = 0.2;
const FPS_SAMPLE_SECONDS = 0.5;
const MIN_RENDER_DISTANCE_CHUNKS = 1;
const MAX_RENDER_DISTANCE_CHUNKS = 128;
const MAX_AGENT_INSTANCES = 128;
const MAX_EVENT_MARKERS = 6;
const EVENT_MARKER_LIFETIME_TICKS = 520;
const CUTAWAY_ENTER_MARGIN = 0.18;
const CUTAWAY_EXIT_MARGIN = 1.4;
const SKIN_COLOR = new THREE.Color("#f0c89c");
const FACE_COLOR = new THREE.Color("#2d2830");

const DRIVE_COLORS: Record<AgentDriveId, string> = {
  security: "#93e6a9",
  belonging: "#e986a1",
  mastery: "#f4c95d",
  care: "#78d7ff",
  comfort: "#c9a6ff",
  autonomy: "#ffb15d"
};

const SKILL_COLORS: Record<AgentSkillId, string> = {
  labor: "#d99a3a",
  commerce: "#8ee47b",
  care: "#74d4dc",
  social: "#e986a1",
  homecraft: "#c9a6ff",
  civic: "#f6d36b"
};

const ACTION_MARKER_LABELS: Record<SimAgent["currentAction"], string> = {
  idle: "Thinking",
  walking: "On the way",
  sleeping: "Sleeping",
  eating: "Eating",
  washing: "Washing",
  cleaning: "Cleaning",
  working: "Working",
  calling_in_sick: "Sick call",
  shopping: "Buying food",
  socializing: "Social",
  healing: "Clinic",
  resting: "Resting",
  checking_mail: "Mail",
  budgeting: "Budgeting",
  paying_rent: "Rent",
  hospitalized: "Hospital",
  building: "Inspecting"
};

type HeldItemVisual = {
  visible: boolean;
  color: string;
  scale: readonly [number, number, number];
  forwardOffset: number;
  sideOffset: number;
  height: number;
  pulse: number;
  accent?: {
    color: string;
    scale: readonly [number, number, number];
    forwardOffset?: number;
    sideOffset?: number;
    heightOffset?: number;
    pulse?: number;
  };
};

type AgentRoleUniformVisual = {
  panel: {
    visible: boolean;
    scale: readonly [number, number, number];
    y: number;
    forwardOffset: number;
    sideOffset: number;
  };
  accent: {
    visible: boolean;
    scale: readonly [number, number, number];
    y: number;
    forwardOffset: number;
    sideOffset: number;
  };
};

type AgentConditionVisual = {
  load: number;
  recovery: number;
  drag: number;
  steady: number;
  slump: number;
  heightAdjust: number;
  widthAdjust: number;
  headAdjust: number;
  walkTempo: number;
  bobAmount: number;
  tint: string;
};

type AgentRenderMeshes = {
  body: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
  hair: THREE.InstancedMesh;
  hat: THREE.InstancedMesh;
  face: THREE.InstancedMesh;
  rolePanel: THREE.InstancedMesh;
  roleAccent: THREE.InstancedMesh;
  leftArm: THREE.InstancedMesh;
  rightArm: THREE.InstancedMesh;
  leftLeg: THREE.InstancedMesh;
  rightLeg: THREE.InstancedMesh;
  badge: THREE.InstancedMesh;
  pack: THREE.InstancedMesh;
  marker: THREE.InstancedMesh;
  shadow: THREE.InstancedMesh;
  aspirationCrest: THREE.InstancedMesh;
  heldItem: THREE.InstancedMesh;
  heldAccent: THREE.InstancedMesh;
  statusPip: THREE.InstancedMesh;
  motiveBubble: THREE.InstancedMesh;
  motiveIcon: THREE.InstancedMesh;
  selectedRing: THREE.Mesh;
};

export type AgentWorldMarker = {
  id: string;
  name: string;
  variant: "agent" | "event";
  selected: boolean;
  visible: boolean;
  xPercent: number;
  yPercent: number;
  actionLabel: string;
  intentLabel: string;
  detail: string;
  tone: "neutral" | "good" | "warn" | "bad";
  progress: number;
  motiveKind?: "none" | "want" | "fear";
  socialKind?: "none" | "moment";
};

declare global {
  interface Window {
    agencyWorldDebug?: {
      seed: string;
      stats: ReturnType<VoxelWorld["getStats"]>;
      generation: WorldGenerationConfig;
      cityMap: CityMapMetadata | null;
      structures: StructureMetadata[];
      semantic: SemanticSummary;
      diorama: ReturnType<SemanticDioramaLayer["debugStats"]>;
      agents: AgentSummary;
      player: { x: number; y: number; z: number };
      fps: number;
      drawCalls: number;
      triangles: number;
      flyMode: boolean;
      selectedAgentId: string | null;
      cameraMode: CameraMode;
      visibleChunks: number;
      cutawayStructure: string | null;
      weatherEnvironment: ReturnType<AgencyWorldApp["getWeatherEnvironmentDebug"]>;
      agentRenderParts: Record<string, number>;
      agentPropVisuals: ReturnType<AgencyWorldApp["getAgentPropVisualDebug"]>;
    };
    agencyWorldDebugControls?: {
      forceHealthCrisis: (agentId?: string) => boolean;
      forceMinorIllness: (agentId?: string, severity?: number) => boolean;
      forceObjectIssue: (kind?: "food" | "clinic" | "upkeep") => boolean;
      setAgentFinance: (
        agentId: string | undefined,
        values: { money?: number; savings?: number; rentDue?: number; medicalDebt?: number; livingCostDue?: number }
      ) => boolean;
      setAgentHousehold: (
        agentId: string | undefined,
        values: {
          hunger?: number;
          energy?: number;
          health?: number;
          hygiene?: number;
          comfort?: number;
          stress?: number;
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
      ) => boolean;
      setAgentOutfit: (
        agentId: string | undefined,
        values: {
          style?: AgentOutfitStyle;
          cleanliness?: number;
          wear?: number;
          confidence?: number;
        }
      ) => boolean;
      setAgentNutrition: (agentId: string | undefined, values: Partial<Pick<AgentNutrition, "quality" | "hydration" | "variety" | "fullness" | "lastMealLabel">>) => boolean;
      setAgentLeisure: (agentId: string | undefined, values: Partial<Pick<AgentLeisure, "hobby" | "fun" | "boredom" | "curiosity">>) => boolean;
      setAgentSleep: (agentId: string | undefined, values: Partial<Pick<AgentSleepState, "chronotype" | "sleepDebt" | "circadianFatigue" | "hoursSleptLastNight">>) => boolean;
      setAgentAutonomy: (agentId: string | undefined, values: Partial<Pick<AgentAutonomy, "dignity" | "control" | "overwhelm">>) => boolean;
      setAgentTime: (agentId: string | undefined, values: Partial<Pick<AgentTimeManagement, "punctuality" | "timeAwareness" | "rush">>) => boolean;
      setAgentRhythm: (agentId: string | undefined, values: Partial<Pick<AgentRoutineRhythm, "work" | "care" | "home" | "social" | "finance" | "momentum" | "drift">>) => boolean;
      setAgentEmotion: (
        agentId: string | undefined,
        values: Partial<Pick<AgentEmotion, "composure" | "loneliness" | "confidence" | "irritation" | "hope">>
      ) => boolean;
      resolveCivicBills: (agentId?: string, strategy?: string) => boolean;
      resolveWorkShift: (agentId?: string, strategy?: string) => boolean;
      resolveFoodPurchase: (agentId?: string, strategy?: string) => boolean;
      resolveHouseholdSupplyPurchase: (agentId?: string, strategy?: string) => boolean;
      resolveMail: (agentId?: string) => boolean;
      resolveHomeCare: (agentId?: string, strategy?: string) => boolean;
      resolveClinicCare: (agentId?: string, strategy?: string) => boolean;
      resolveSleep: (agentId?: string) => boolean;
      resolveLeisure: (agentId?: string, strategy?: string) => boolean;
      forceSupportDebt: (agentId?: string, amount?: number) => boolean;
      forceSocialMoment: (agentId?: string) => boolean;
      focusStructure: (structureId?: string) => boolean;
      advanceMinutes: (minutes: number) => boolean;
    };
  }
}

type SemanticSummary = {
  structureCount: number;
  actionPointCount: number;
  homes: number;
  jobs: number;
  services: number;
  inventoryItems: number;
  buildableLots: number;
  byType: Record<string, number>;
  actionPointsByType: Record<string, number>;
  serviceIds: string[];
  jobIds: string[];
};

type AppOptions = {
  canvas: HTMLCanvasElement;
  onStats: (text: string) => void;
  onPointerLockChange: (locked: boolean) => void;
  onDiagnostics: (text: string) => void;
  onAgentStatus: (summary: AgentSummary, view: AppViewState) => void;
  onWorldMarkers: (markers: AgentWorldMarker[]) => void;
};

export type CameraMode = "spectate" | "free";

export type AppViewState = {
  selectedAgentId: string | null;
  cameraMode: CameraMode;
};

export class AgencyWorldApp {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = createScene();
  private readonly ambientLight = this.scene.getObjectByName("agency-ambient-light") as THREE.HemisphereLight | null;
  private readonly sunLight = this.scene.getObjectByName("agency-sun-light") as THREE.DirectionalLight | null;
  private readonly camera = new THREE.PerspectiveCamera(74, 1, 0.05, 6000);
  private readonly clock = new THREE.Clock();
  private readonly chunkRenderer: ChunkRenderer;
  private readonly dioramaLayer = new SemanticDioramaLayer(this.scene);
  private readonly agentSimulation = new AgentSimulation();
  private readonly agentMeshes: AgentRenderMeshes;
  private readonly agentMatrix = new THREE.Matrix4();
  private readonly agentPosition = new THREE.Vector3();
  private readonly agentRotation = new THREE.Quaternion();
  private readonly agentPoseRotation = new THREE.Quaternion();
  private readonly agentLimbRotation = new THREE.Quaternion();
  private readonly agentGroundRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly agentTiltRotation = new THREE.Quaternion();
  private readonly agentScale = new THREE.Vector3(1, 1, 1);
  private readonly agentPoseScale = new THREE.Vector3(1, 1, 1);
  private readonly agentUpAxis = new THREE.Vector3(0, 1, 0);
  private readonly agentSideAxis = new THREE.Vector3(1, 0, 0);
  private readonly agentTiltAxis = new THREE.Vector3(0, 0, 1);
  private readonly agentBodyColor = new THREE.Color();
  private readonly agentHairColor = new THREE.Color();
  private readonly agentFaceColor = new THREE.Color();
  private readonly agentTrimColor = new THREE.Color();
  private readonly agentBadgeColor = new THREE.Color();
  private readonly weatherSkyColor = new THREE.Color("#b8ddec");
  private readonly weatherFogColor = new THREE.Color("#b8ddec");
  private readonly agentRoleColor = new THREE.Color();
  private readonly agentRoleAccentColor = new THREE.Color();
  private readonly agentPackColor = new THREE.Color();
  private readonly agentItemColor = new THREE.Color();
  private readonly agentItemAccentColor = new THREE.Color();
  private readonly agentStatusColor = new THREE.Color();
  private readonly agentMotiveColor = new THREE.Color();
  private readonly agentMotiveIconColor = new THREE.Color();
  private readonly agentHatColor = new THREE.Color();
  private readonly agentCrestColor = new THREE.Color();
  private readonly agentMarkerColor = new THREE.Color();
  private readonly agentBlendColor = new THREE.Color();
  private readonly agentShadowColor = new THREE.Color("#111817");
  private readonly player: PlayerController;
  private world: VoxelWorld | null = null;
  private pathfinder: AgentPathfinder | null = null;
  private currentSeed = "bootstrap";
  private debugStats: ReturnType<VoxelWorld["getStats"]> | null = null;
  private debugRefreshElapsed = DEBUG_REFRESH_SECONDS;
  private fpsElapsed = 0;
  private fpsFrames = 0;
  private measuredFps = 0;
  private renderDistanceChunks = MAX_RENDER_DISTANCE_CHUNKS;
  private selectedAgentId: string | null = null;
  private activeCutawayStructureId: string | null = null;
  private cameraMode: CameraMode = "spectate";
  private readonly followForward = new THREE.Vector3(0, 0, 1);
  private readonly followLookAt = new THREE.Vector3();
  private readonly introLookAt = new THREE.Vector3();
  private readonly cameraSide = new THREE.Vector3();
  private readonly cameraProbe = new THREE.Vector3();
  private readonly cameraClearPoint = new THREE.Vector3();
  private readonly markerProjection = new THREE.Vector3();

  constructor(private readonly options: AppOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas: options.canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.chunkRenderer = new ChunkRenderer(this.scene);
    this.agentMeshes = this.createAgentRenderMeshes();
    const bootstrapWorld = new VoxelWorld("bootstrap");
    this.player = new PlayerController(this.camera, this.renderer.domElement, bootstrapWorld, options.onPointerLockChange);

    this.addGroundGrid();
    this.bindRuntimeEvents();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.options.onStats("WebGL context was lost. Refresh the page to recover.");
    });
  }

  generate(seed: string, generation: WorldGenerationConfig) {
    const world = new VoxelWorld(seed, { generation });
    this.world = world;
    this.pathfinder = new AgentPathfinder(world);
    this.currentSeed = seed;
    this.clearAgents();
    this.chunkRenderer.rebuild(world);
    this.dioramaLayer.rebuild(world);
    this.player.setWorld(world);
    this.setIntroCamera(world);
    this.chunkRenderer.setRenderDistance(this.renderDistanceChunks, this.camera.position.x, this.camera.position.z);
    this.debugStats = world.getStats();

    if (world.cityMap) {
      const semantic = this.getSemanticSummary();
      this.options.onStats(
        `${world.cityMap.widthBlocks}x${world.cityMap.depthBlocks} Genesis District, ${semantic.structureCount} semantic buildings, ${semantic.actionPointCount} action points.`
      );
    } else {
      const stats = world.getStats();
      this.options.onStats(`${stats.chunks} chunks loaded.`);
    }
    this.updateDebugState();
  }

  generateFlatWorld(name: string, options: Partial<FlatWorldOptions>) {
    this.generate(name, { kind: "flat", options: options as FlatWorldOptions });
  }

  setRenderDistance(chunks: number) {
    const parsed = Number.isFinite(chunks) ? chunks : MAX_RENDER_DISTANCE_CHUNKS;
    const next = Math.max(MIN_RENDER_DISTANCE_CHUNKS, Math.min(MAX_RENDER_DISTANCE_CHUNKS, Math.floor(parsed)));
    this.renderDistanceChunks = next;
    this.chunkRenderer.setRenderDistance(next, this.camera.position.x, this.camera.position.z);
    this.updateDebugState();
    return next;
  }

  spawnAgent() {
    if (!this.world) return null;
    const agent = this.agentSimulation.spawn(this.world.structures.all(), this.spawnPositionForNewAgent(), (from, to) => this.findAgentPath(from, to));
    this.selectedAgentId = agent.id;
    this.setCameraMode("spectate");
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.options.onStats(`${agent.name} spawned. ${summary.agents.length} agent(s) active.`);
    this.updateDebugState();
    return agent;
  }

  getAgentSummary() {
    return this.agentSimulation.summary();
  }

  getViewState(): AppViewState {
    return {
      selectedAgentId: this.selectedAgentId,
      cameraMode: this.cameraMode
    };
  }

  selectAgent(agentId: string) {
    const agent = this.agentSimulation.summary().agents.find((candidate) => candidate.id === agentId) ?? null;
    if (!agent) return null;
    this.selectedAgentId = agent.id;
    this.setCameraMode("spectate");
    this.options.onAgentStatus(this.agentSimulation.summary(), this.getViewState());
    this.updateDebugState();
    return agent;
  }

  selectNextAgent(direction: 1 | -1 = 1) {
    const agents = this.agentSimulation.summary().agents;
    if (agents.length === 0) return null;
    const currentIndex = Math.max(0, agents.findIndex((agent) => agent.id === this.selectedAgentId));
    const nextIndex = (currentIndex + direction + agents.length) % agents.length;
    const agent = agents[nextIndex]!;
    return this.selectAgent(agent.id);
  }

  forceHealthCrisis(agentId?: string) {
    if (!this.world) return false;
    const fallbackId = this.selectedAgentId ?? this.agentSimulation.summary().agents[0]?.id;
    const targetId = agentId ?? fallbackId;
    if (!targetId) return false;
    const agent = this.agentSimulation.forceHealthCrisis(targetId, this.world.structures.all());
    if (!agent) return false;
    this.selectedAgentId = agent.id;
    this.setCameraMode("spectate");
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.options.onStats(`${agent.name} was admitted to ${agent.medical.facilityName ?? "the clinic"}.`);
    this.updateDebugState();
    return true;
  }

  forceMinorIllnessForDebug(agentId?: string, severity = 58) {
    const agent = this.agentSimulation.forceMinorIllnessForDebug(agentId, severity);
    if (!agent) return false;
    this.selectedAgentId = agent.id;
    this.setCameraMode("spectate");
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${agent.name} is feeling ${agent.medical.minorIllness.label?.toLowerCase() ?? "under the weather"}.`);
    this.updateDebugState();
    return true;
  }

  forceObjectIssueForDebug(kind: "food" | "clinic" | "upkeep" = "food") {
    if (!this.world) return false;
    const state = this.agentSimulation.forceObjectIssueForDebug(this.world.structures.all(), kind);
    if (!state) return false;
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${state.lastIssue ?? "Object issue"} at ${state.label}.`);
    this.updateDebugState();
    return true;
  }

  focusStructureForDebug(structureId?: string) {
    if (!this.world) return false;
    const structure =
      (structureId ? this.world.structures.all().find((candidate) => candidate.id === structureId) : null) ??
      this.world.structures.all().find((candidate) => this.isStructureCutawayEligible(candidate));
    const door = structure?.actionPoints.find((point) => point.type === "door");
    if (!structure || !door) return false;

    const footprint = structure.footprint;
    const out =
      door.position.x <= footprint.x
        ? new THREE.Vector3(-1, 0, 0)
        : door.position.x >= footprint.x + footprint.width - 1
          ? new THREE.Vector3(1, 0, 0)
          : door.position.z >= footprint.z + footprint.depth - 1
            ? new THREE.Vector3(0, 0, 1)
            : new THREE.Vector3(0, 0, -1);
    const side = new THREE.Vector3(out.z, 0, -out.x);
    const target = new THREE.Vector3(door.position.x + 0.5, door.position.y + 1.12, door.position.z + 0.5);
    const position = target.clone().addScaledVector(out, 5.2).addScaledVector(side, 1.45);
    position.y += 2.35;

    this.setCameraMode("free");
    this.clearSpectatorCutaway();
    this.camera.position.copy(position);
    this.camera.lookAt(target);
    this.chunkRenderer.updateVisibilityAround(this.camera.position.x, this.camera.position.z);
    this.updateDebugState();
    return true;
  }

  advanceMinutesForDebug(minutes: number) {
    if (!this.world || !Number.isFinite(minutes) || minutes <= 0) return false;
    let remainingSeconds = minutes / SIM_MINUTES_PER_SECOND;
    while (remainingSeconds > 0) {
      const step = Math.min(1, remainingSeconds);
      this.agentSimulation.update(step, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
      remainingSeconds -= step;
    }

    const summary = this.agentSimulation.summary();
    this.applyWeatherEnvironment(summary.weather, 1);
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  setAgentFinanceForDebug(agentId: string | undefined, values: { money?: number; savings?: number; rentDue?: number; medicalDebt?: number; livingCostDue?: number }) {
    if (!this.world) return false;
    const agent = this.agentSimulation.setFinanceScenarioForDebug(agentId, values);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  setAgentHouseholdForDebug(
    agentId: string | undefined,
    values: {
      hunger?: number;
      energy?: number;
      health?: number;
      hygiene?: number;
      comfort?: number;
      stress?: number;
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
    if (!this.world) return false;
    const agent = this.agentSimulation.setHouseholdScenarioForDebug(agentId, values);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  setAgentOutfitForDebug(agentId: string | undefined, values: { style?: AgentOutfitStyle; cleanliness?: number; wear?: number; confidence?: number }) {
    if (!this.world) return false;
    const agent = this.agentSimulation.setOutfitScenarioForDebug(agentId, values);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  setAgentNutritionForDebug(
    agentId: string | undefined,
    values: Partial<Pick<AgentNutrition, "quality" | "hydration" | "variety" | "fullness" | "lastMealLabel">>
  ) {
    if (!this.world) return false;
    const agent = this.agentSimulation.setNutritionScenarioForDebug(agentId, values);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  setAgentLeisureForDebug(agentId: string | undefined, values: Partial<Pick<AgentLeisure, "hobby" | "fun" | "boredom" | "curiosity">>) {
    if (!this.world) return false;
    const agent = this.agentSimulation.setLeisureScenarioForDebug(agentId, values);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  setAgentSleepForDebug(
    agentId: string | undefined,
    values: Partial<Pick<AgentSleepState, "chronotype" | "sleepDebt" | "circadianFatigue" | "hoursSleptLastNight">>
  ) {
    if (!this.world) return false;
    const agent = this.agentSimulation.setSleepScenarioForDebug(agentId, values);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  setAgentAutonomyForDebug(agentId: string | undefined, values: Partial<Pick<AgentAutonomy, "dignity" | "control" | "overwhelm">>) {
    if (!this.world) return false;
    const agent = this.agentSimulation.setAutonomyScenarioForDebug(agentId, values);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  setAgentTimeForDebug(agentId: string | undefined, values: Partial<Pick<AgentTimeManagement, "punctuality" | "timeAwareness" | "rush">>) {
    if (!this.world) return false;
    const agent = this.agentSimulation.setTimeScenarioForDebug(agentId, values);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  setAgentRhythmForDebug(
    agentId: string | undefined,
    values: Partial<Pick<AgentRoutineRhythm, "work" | "care" | "home" | "social" | "finance" | "momentum" | "drift">>
  ) {
    if (!this.world) return false;
    const agent = this.agentSimulation.setRhythmScenarioForDebug(agentId, values);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  setAgentEmotionForDebug(
    agentId: string | undefined,
    values: Partial<Pick<AgentEmotion, "composure" | "loneliness" | "confidence" | "irritation" | "hope">>
  ) {
    if (!this.world) return false;
    const agent = this.agentSimulation.setEmotionScenarioForDebug(agentId, values);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  resolveCivicBillsForDebug(agentId?: string, strategy = "current") {
    if (!this.world) return false;
    const agent = this.agentSimulation.resolveCivicBillsForDebug(agentId, this.world.structures.all(), strategy);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.updateDebugState();
    return true;
  }

  resolveWorkShiftForDebug(agentId?: string, strategy = "work_shift") {
    if (!this.world) return false;
    const agent = this.agentSimulation.resolveWorkShiftForDebug(agentId, this.world.structures.all(), strategy);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${agent.name} resolved a work shift.`);
    this.updateDebugState();
    return true;
  }

  resolveFoodPurchaseForDebug(agentId?: string, strategy = "buy_groceries") {
    if (!this.world) return false;
    const agent = this.agentSimulation.resolveFoodPurchaseForDebug(agentId, this.world.structures.all(), strategy);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${agent.name} resolved a food purchase.`);
    this.updateDebugState();
    return true;
  }

  resolveHouseholdSupplyPurchaseForDebug(agentId?: string, strategy = "buy_home_supplies") {
    if (!this.world) return false;
    const agent = this.agentSimulation.resolveHouseholdSupplyPurchaseForDebug(agentId, this.world.structures.all(), strategy);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${agent.name} restocked household supplies.`);
    this.updateDebugState();
    return true;
  }

  resolveMailForDebug(agentId?: string) {
    if (!this.world) return false;
    const agent = this.agentSimulation.resolveMailForDebug(agentId, this.world.structures.all());
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${agent.name} checked personal mail.`);
    this.updateDebugState();
    return true;
  }

  resolveHomeCareForDebug(agentId?: string, strategy = "tidy_clutter") {
    if (!this.world) return false;
    const agent = this.agentSimulation.resolveHomeCareForDebug(agentId, this.world.structures.all(), strategy);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${agent.name} resolved home care.`);
    this.updateDebugState();
    return true;
  }

  resolveClinicCareForDebug(agentId?: string, strategy = "treat_symptoms") {
    if (!this.world) return false;
    const agent = this.agentSimulation.resolveClinicCareForDebug(agentId, this.world.structures.all(), strategy);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${agent.name} resolved clinic care.`);
    this.updateDebugState();
    return true;
  }

  resolveSleepForDebug(agentId?: string) {
    if (!this.world) return false;
    const agent = this.agentSimulation.resolveSleepForDebug(agentId, this.world.structures.all());
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${agent.name} slept and reset their rhythm.`);
    this.updateDebugState();
    return true;
  }

  resolveLeisureForDebug(agentId?: string, strategy = "hobby_break") {
    if (!this.world) return false;
    const agent = this.agentSimulation.resolveLeisureForDebug(agentId, this.world.structures.all(), strategy);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${agent.name} took a leisure break.`);
    this.updateDebugState();
    return true;
  }

  forceSupportDebtForDebug(agentId?: string, amount = 3) {
    if (!this.world) return false;
    const agent = this.agentSimulation.forceSupportDebtForDebug(agentId, amount);
    if (!agent) return false;
    this.agentSimulation.replanForDebug(agent.id, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${agent.name} has a support debt to repay.`);
    this.updateDebugState();
    return true;
  }

  forceSocialMomentForDebug(agentId?: string) {
    if (!this.world) return false;
    const agent = this.agentSimulation.forceSocialMomentForDebug(agentId);
    if (!agent) return false;
    this.selectedAgentId = agent.id;
    this.setCameraMode("spectate");
    const summary = this.agentSimulation.summary();
    this.syncAgentMeshes(summary);
    this.dioramaLayer.update(summary, this.clock.elapsedTime);
    this.options.onAgentStatus(summary, this.getViewState());
    this.updateWorldMarkers(summary);
    this.options.onStats(`${agent.name} had a social moment.`);
    this.updateDebugState();
    return true;
  }

  toggleFreeCamera() {
    this.setCameraMode(this.cameraMode === "free" ? "spectate" : "free");
    this.options.onAgentStatus(this.agentSimulation.summary(), this.getViewState());
    this.updateDebugState();
    return this.cameraMode;
  }

  start() {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.trackFrameRate(dt);
    if (this.cameraMode === "free") this.player.update(dt);
    if (this.world) {
      this.agentSimulation.update(dt, this.world.structures.all(), (from, to) => this.findAgentPath(from, to));
      const summary = this.agentSimulation.summary();
      this.applyWeatherEnvironment(summary.weather, dt);
      this.syncAgentMeshes(summary);
      this.dioramaLayer.update(summary, this.clock.elapsedTime);
      this.updateSpectatorCamera(dt);
      if (this.cameraMode === "free") this.clearSpectatorCutaway();
      this.chunkRenderer.updateVisibilityAround(this.camera.position.x, this.camera.position.z);
      this.updateWorldMarkers(summary);
    }

    this.debugRefreshElapsed += dt;
    if (this.debugRefreshElapsed >= DEBUG_REFRESH_SECONDS) {
      this.debugRefreshElapsed = 0;
      this.updateDebugState();
      this.options.onAgentStatus(this.agentSimulation.summary(), this.getViewState());
    }

    this.renderer.render(this.scene, this.camera);
  }

  private applyWeatherEnvironment(weather: WeatherState, dt: number) {
    const lerp = Math.max(0.04, Math.min(0.18, dt * 2.8));
    this.weatherSkyColor.set(weather.skyColor);
    this.weatherFogColor.set(weather.fogColor);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(this.weatherSkyColor, lerp);
    } else {
      this.scene.background = this.weatherSkyColor.clone();
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.lerp(this.weatherFogColor, lerp);
      this.scene.fog.density += (weather.fogDensity - this.scene.fog.density) * lerp;
    }
    if (this.ambientLight) this.ambientLight.intensity += (weather.ambientIntensity - this.ambientLight.intensity) * lerp;
    if (this.sunLight) this.sunLight.intensity += (weather.sunIntensity - this.sunLight.intensity) * lerp;
  }

  private getWeatherEnvironmentDebug() {
    return {
      background: this.scene.background instanceof THREE.Color ? `#${this.scene.background.getHexString()}` : null,
      fogColor: this.scene.fog instanceof THREE.FogExp2 ? `#${this.scene.fog.color.getHexString()}` : null,
      fogDensity: this.scene.fog instanceof THREE.FogExp2 ? Number(this.scene.fog.density.toFixed(4)) : null,
      ambientIntensity: this.ambientLight ? Number(this.ambientLight.intensity.toFixed(2)) : null,
      sunIntensity: this.sunLight ? Number(this.sunLight.intensity.toFixed(2)) : null
    };
  }

  private resize() {
    const { clientWidth, clientHeight } = this.renderer.domElement;
    const width = Math.max(clientWidth, 1);
    const height = Math.max(clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private addGroundGrid() {
    const grid = new THREE.GridHelper(160, 40, "#ffffff", "#ffffff");
    grid.material.opacity = 0.08;
    grid.material.transparent = true;
    grid.position.y = 0.02;
    this.scene.add(grid);
  }

  private bindRuntimeEvents() {
    this.renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
    this.renderer.domElement.addEventListener("mousedown", () => {
      if (this.cameraMode === "free" && document.pointerLockElement !== this.renderer.domElement) this.player.lock();
    });
    window.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === "KeyF") this.toggleFreeCamera();
      if (event.code === "KeyQ") this.selectNextAgent(-1);
      if (event.code === "KeyE") this.selectNextAgent(1);
    });
  }

  private clearAgents() {
    this.agentSimulation.reset();
    this.agentMeshes.body.count = 0;
    this.agentMeshes.head.count = 0;
    this.agentMeshes.hair.count = 0;
    this.agentMeshes.hat.count = 0;
    this.agentMeshes.face.count = 0;
    this.agentMeshes.rolePanel.count = 0;
    this.agentMeshes.roleAccent.count = 0;
    this.agentMeshes.leftArm.count = 0;
    this.agentMeshes.rightArm.count = 0;
    this.agentMeshes.leftLeg.count = 0;
    this.agentMeshes.rightLeg.count = 0;
    this.agentMeshes.badge.count = 0;
    this.agentMeshes.pack.count = 0;
    this.agentMeshes.marker.count = 0;
    this.agentMeshes.shadow.count = 0;
    this.agentMeshes.aspirationCrest.count = 0;
    this.agentMeshes.heldItem.count = 0;
    this.agentMeshes.heldAccent.count = 0;
    this.agentMeshes.statusPip.count = 0;
    this.agentMeshes.motiveBubble.count = 0;
    this.agentMeshes.motiveIcon.count = 0;
    this.agentMeshes.selectedRing.visible = false;
    this.selectedAgentId = null;
    this.dioramaLayer.update(this.agentSimulation.summary(), this.clock.elapsedTime);
    this.options.onWorldMarkers([]);
    this.options.onAgentStatus(this.agentSimulation.summary(), this.getViewState());
  }

  private createAgentRenderMeshes(): AgentRenderMeshes {
    const body = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.25, 0.36, 4, 8),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const head = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.42),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const hair = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.5, 0.16, 0.5),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const hat = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.42, 0.12, 0.42),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const face = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.23, 0.075, 0.026),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const rolePanel = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.32, 0.64, 0.035),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const roleAccent = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.04),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const leftArm = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 0.52, 0.14),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const rightArm = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 0.52, 0.14),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const leftLeg = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 0.58, 0.14),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const rightLeg = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 0.58, 0.14),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const badge = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.28, 0.12, 0.035),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const pack = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.34, 0.42, 0.16),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const marker = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.48, 0.08, 0.48),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const shadow = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.52, 18),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.28, depthWrite: false }),
      MAX_AGENT_INSTANCES
    );
    const aspirationCrest = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.12, 0),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const heldItem = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.22),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const heldAccent = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.18, 0.08, 0.18),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const statusPip = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.105, 8, 6),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const motiveBubble = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.18, 12, 8),
      new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.78 }),
      MAX_AGENT_INSTANCES
    );
    const motiveIcon = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.095, 0),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      MAX_AGENT_INSTANCES
    );
    const selectedRing = new THREE.Mesh(
      new THREE.RingGeometry(0.43, 0.6, 28),
      new THREE.MeshBasicMaterial({ color: "#f4c95d", transparent: true, opacity: 0.88, side: THREE.DoubleSide })
    );

    for (const mesh of [
      body,
      head,
      hair,
      hat,
      face,
      rolePanel,
      roleAccent,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      badge,
      pack,
      marker,
      shadow,
      aspirationCrest,
      heldItem,
      heldAccent,
      statusPip,
      motiveBubble,
      motiveIcon
    ]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    selectedRing.name = "selection-ring";
    selectedRing.rotation.x = -Math.PI / 2;
    selectedRing.visible = false;
    this.scene.add(selectedRing);

    return {
      body,
      head,
      hair,
      hat,
      face,
      rolePanel,
      roleAccent,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      badge,
      pack,
      marker,
      shadow,
      aspirationCrest,
      heldItem,
      heldAccent,
      statusPip,
      motiveBubble,
      motiveIcon,
      selectedRing
    };
  }

  private syncAgentMeshes(summary = this.agentSimulation.summary()) {
    const elapsed = this.clock.elapsedTime;
    const instanceCount = Math.min(summary.agents.length, MAX_AGENT_INSTANCES);
    let selectedAgent: SimAgent | null = null;
    for (let index = 0; index < instanceCount; index += 1) {
      const agent = summary.agents[index]!;
      if (agent.id === this.selectedAgentId) selectedAgent = agent;
      const groundedY = this.groundedAgentY(agent);
      const forward = this.agentFacingDirection(agent);
      const rotationY = Math.atan2(forward.x, forward.z);
      const sleeping = agent.currentAction === "sleeping";
      const hospitalized = agent.currentAction === "hospitalized";
      const resting = agent.currentAction === "resting";
      const dominantSkill = this.dominantSkillForAgent(agent);
      const condition = this.conditionVisualForAgent(agent);
      const bob = agent.currentAction === "walking" ? Math.sin(elapsed * condition.walkTempo + agent.id.length) * condition.bobAmount : 0;
      const posture = this.agentPosture(agent, dominantSkill.id, condition);
      const skillPresence = Math.min(0.16, (dominantSkill.level - 1) * 0.028 + Math.max(0, dominantSkill.aptitude - 52) * 0.0012);
      const heightScale = 0.94 + ((agent.dna.discipline + agent.dna.empathy) % 17) / 100 + posture.height + (dominantSkill.id === "social" ? skillPresence * 0.45 : 0);
      const widthScale = 0.92 + agent.dna.risk / 650 + posture.width + (dominantSkill.id === "labor" ? skillPresence : 0);
      const headScale = 0.92 + agent.dna.sociability / 720 + posture.head + (dominantSkill.id === "care" || dominantSkill.id === "social" ? skillPresence * 0.28 : 0);

      this.agentRotation.setFromAxisAngle(this.agentUpAxis, rotationY);
      this.agentSideAxis.set(forward.z, 0, -forward.x).normalize();
      this.agentPoseRotation.copy(this.agentRotation);
      this.agentPoseScale.set(widthScale, heightScale, widthScale);
      let bodyY = groundedY + 0.78 * heightScale + bob - condition.slump * 0.045;
      let headY = groundedY + 1.25 * heightScale + bob - condition.slump * 0.075;
      let headX = agent.position.x;
      let headZ = agent.position.z;
      let headRotation = this.agentRotation;

      if (sleeping || hospitalized) {
        this.agentTiltRotation.setFromAxisAngle(this.agentTiltAxis, Math.PI / 2);
        this.agentPoseRotation.multiply(this.agentTiltRotation);
        this.agentPoseScale.set(hospitalized ? 1.18 : 1.25, hospitalized ? 0.5 : 0.44, 0.82);
        bodyY = groundedY + (hospitalized ? 0.38 : 0.34);
        headY = groundedY + (hospitalized ? 0.58 : 0.52);
        headX += this.agentSideAxis.x * 0.5;
        headZ += this.agentSideAxis.z * 0.5;
        headRotation = this.agentPoseRotation;
      } else if (resting) {
        this.agentPoseScale.set(widthScale * 1.04, heightScale * 0.82, widthScale * 1.04);
        bodyY = groundedY + 0.68;
        headY = groundedY + 1.1;
      }

      this.writeAgentInstance(this.agentMeshes.body, index, agent.position.x, bodyY, agent.position.z, this.agentPoseRotation, this.agentPoseScale);
      this.agentPoseScale.set(headScale, headScale, headScale);
      this.writeAgentInstance(this.agentMeshes.head, index, headX, headY, headZ, headRotation, this.agentPoseScale);
      this.writeAgentHair(agent, index, headX, headY, headZ, forward, headRotation, headScale);
      this.writeAgentHat(agent, index, headX, headY, headZ, forward, headRotation, headScale, sleeping || hospitalized);
      this.writeAgentFace(agent, index, headX, headY, headZ, forward, headRotation, sleeping || hospitalized, condition);
      this.writeAgentArms(agent, index, groundedY, forward, elapsed, sleeping || hospitalized, condition);
      this.writeAgentLegs(agent, index, groundedY, forward, elapsed, sleeping || hospitalized, condition);
      this.writeAgentRoleUniform(agent, index, groundedY, forward, sleeping || hospitalized, condition);
      this.writeAgentBadge(agent, index, groundedY, forward, sleeping || hospitalized);
      this.writeAgentPack(agent, index, groundedY, forward, sleeping || hospitalized);
      const drivePulse = 1 + Math.sin(elapsed * (agent.activeDrive.pressure > 64 ? 5.2 : 2.6) + index) * (agent.activeDrive.pressure > 64 ? 0.08 : 0.025);
      const driveScale = (0.88 + agent.activeDrive.pressure / 390 + dominantSkill.level / 72) * drivePulse;
      this.agentPoseScale.set(driveScale, 0.82 + dominantSkill.level / 28, driveScale);
      this.writeAgentInstance(this.agentMeshes.marker, index, headX, headY + (0.28 + agent.activeDrive.pressure / 900) * headScale, headZ, this.agentRotation, this.agentPoseScale);
      this.writeAgentShadow(agent, index, groundedY, sleeping || hospitalized || resting, condition);
      this.writeAspirationCrest(agent, index, groundedY, forward, elapsed, sleeping || hospitalized);
      this.writeHeldItem(agent, index, groundedY, forward, elapsed, sleeping || hospitalized);
      this.writeStatusPip(agent, index, groundedY, forward, elapsed, condition);
      this.writeMotiveBubble(agent, index, groundedY, forward, elapsed, sleeping || hospitalized, condition);

      this.agentBodyColor.setHSL(agent.dna.appearanceHue / 360, hospitalized ? 0.26 : 0.58, hospitalized ? 0.68 : 0.52);
      if (!hospitalized) {
        this.agentBodyColor.lerp(this.agentBlendColor.set(DRIVE_COLORS[agent.activeDrive.id]), Math.min(0.22, agent.activeDrive.pressure / 620));
        if (dominantSkill.level >= 4) this.agentBodyColor.lerp(this.agentBlendColor.set(SKILL_COLORS[dominantSkill.id]), 0.12);
        if (condition.drag > 0.12) this.agentBodyColor.lerp(this.agentBlendColor.set(condition.tint), 0.08 + condition.drag * 0.24);
        else if (condition.steady > 0.18) this.agentBodyColor.lerp(this.agentBlendColor.set("#d5f3c6"), condition.steady * 0.1);
        const motive = this.leadMotiveForAgent(agent);
        if (motive?.status === "active") this.agentBodyColor.lerp(this.agentBlendColor.set(this.motiveColorForAgent(agent)), motive.kind === "fear" ? 0.14 : 0.07);
      }
      this.agentHairColor.setHSL(((agent.dna.appearanceHue + 165 + agent.dna.greed * 0.7) % 360) / 360, 0.34 + agent.dna.risk / 420, hospitalized ? 0.42 : 0.22 + agent.dna.empathy / 950);
      this.agentTrimColor.setHSL(hospitalized ? 0.54 : ((agent.dna.appearanceHue + 42) % 360) / 360, hospitalized ? 0.7 : 0.55, hospitalized ? 0.48 : 0.34);
      this.setJobColor(this.agentBadgeColor, agent, hospitalized);
      this.setRoleUniformColor(this.agentRoleColor, agent, hospitalized);
      this.setRoleAccentColor(this.agentRoleAccentColor, agent, hospitalized);
      this.setPackColor(this.agentPackColor, agent, hospitalized);
      this.setHatColor(this.agentHatColor, agent, hospitalized);
      this.setAspirationColor(this.agentCrestColor, agent, hospitalized);
      if (!hospitalized) {
        this.applyOutfitVisualToColor(this.agentBodyColor, agent, 0.45);
        this.applyOutfitVisualToColor(this.agentRoleColor, agent, 0.62);
        this.applyOutfitVisualToColor(this.agentRoleAccentColor, agent, 0.42);
        this.applyOutfitVisualToColor(this.agentTrimColor, agent, 0.5);
      }
      this.agentItemColor.set(this.itemColorForAgent(agent));
      this.agentItemAccentColor.set(this.itemAccentColorForAgent(agent));
      this.agentStatusColor.set(this.statusColorForAgent(agent));
      this.agentMotiveColor.set(this.motiveColorForAgent(agent));
      this.agentMotiveIconColor.set(this.motiveIconColorForAgent(agent));
      this.setMarkerColor(this.agentMarkerColor, agent, hospitalized);
      this.agentMeshes.body.setColorAt(index, this.agentBodyColor);
      this.agentMeshes.head.setColorAt(index, SKIN_COLOR);
      this.agentMeshes.hair.setColorAt(index, this.agentHairColor);
      this.agentMeshes.hat.setColorAt(index, this.agentHatColor);
      this.setFaceColor(this.agentFaceColor, agent, sleeping || hospitalized);
      this.agentMeshes.face.setColorAt(index, this.agentFaceColor);
      this.agentMeshes.rolePanel.setColorAt(index, this.agentRoleColor);
      this.agentMeshes.roleAccent.setColorAt(index, this.agentRoleAccentColor);
      this.agentMeshes.leftArm.setColorAt(index, this.agentBodyColor);
      this.agentMeshes.rightArm.setColorAt(index, this.agentBodyColor);
      this.agentMeshes.leftLeg.setColorAt(index, this.agentTrimColor);
      this.agentMeshes.rightLeg.setColorAt(index, this.agentTrimColor);
      this.agentMeshes.badge.setColorAt(index, this.agentBadgeColor);
      this.agentMeshes.pack.setColorAt(index, this.agentPackColor);
      this.agentMeshes.marker.setColorAt(index, this.agentMarkerColor);
      this.agentMeshes.shadow.setColorAt(index, this.agentShadowColor);
      this.agentMeshes.aspirationCrest.setColorAt(index, this.agentCrestColor);
      this.agentMeshes.heldItem.setColorAt(index, this.agentItemColor);
      this.agentMeshes.heldAccent.setColorAt(index, this.agentItemAccentColor);
      this.agentMeshes.statusPip.setColorAt(index, this.agentStatusColor);
      this.agentMeshes.motiveBubble.setColorAt(index, this.agentMotiveColor);
      this.agentMeshes.motiveIcon.setColorAt(index, this.agentMotiveIconColor);
    }

    this.agentMeshes.body.count = instanceCount;
    this.agentMeshes.head.count = instanceCount;
    this.agentMeshes.hair.count = instanceCount;
    this.agentMeshes.hat.count = instanceCount;
    this.agentMeshes.face.count = instanceCount;
    this.agentMeshes.rolePanel.count = instanceCount;
    this.agentMeshes.roleAccent.count = instanceCount;
    this.agentMeshes.leftArm.count = instanceCount;
    this.agentMeshes.rightArm.count = instanceCount;
    this.agentMeshes.leftLeg.count = instanceCount;
    this.agentMeshes.rightLeg.count = instanceCount;
    this.agentMeshes.badge.count = instanceCount;
    this.agentMeshes.pack.count = instanceCount;
    this.agentMeshes.marker.count = instanceCount;
    this.agentMeshes.shadow.count = instanceCount;
    this.agentMeshes.aspirationCrest.count = instanceCount;
    this.agentMeshes.heldItem.count = instanceCount;
    this.agentMeshes.heldAccent.count = instanceCount;
    this.agentMeshes.statusPip.count = instanceCount;
    this.agentMeshes.motiveBubble.count = instanceCount;
    this.agentMeshes.motiveIcon.count = instanceCount;
    for (const mesh of [
      this.agentMeshes.body,
      this.agentMeshes.head,
      this.agentMeshes.hair,
      this.agentMeshes.hat,
      this.agentMeshes.face,
      this.agentMeshes.rolePanel,
      this.agentMeshes.roleAccent,
      this.agentMeshes.leftArm,
      this.agentMeshes.rightArm,
      this.agentMeshes.leftLeg,
      this.agentMeshes.rightLeg,
      this.agentMeshes.badge,
      this.agentMeshes.pack,
      this.agentMeshes.marker,
      this.agentMeshes.shadow,
      this.agentMeshes.aspirationCrest,
      this.agentMeshes.heldItem,
      this.agentMeshes.heldAccent,
      this.agentMeshes.statusPip,
      this.agentMeshes.motiveBubble,
      this.agentMeshes.motiveIcon
    ]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    if (selectedAgent) {
      const groundedY = this.groundedAgentY(selectedAgent);
      this.agentMeshes.selectedRing.visible = true;
      this.agentMeshes.selectedRing.position.set(selectedAgent.position.x, groundedY + 0.04, selectedAgent.position.z);
      this.agentMeshes.selectedRing.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.045);
    } else {
      this.agentMeshes.selectedRing.visible = false;
    }
  }

  private writeAgentArms(
    agent: SimAgent,
    index: number,
    groundedY: number,
    forward: THREE.Vector3,
    elapsed: number,
    sleeping: boolean,
    condition: AgentConditionVisual
  ) {
    if (sleeping) {
      this.agentPoseScale.set(0.01, 0.01, 0.01);
      this.writeAgentInstance(this.agentMeshes.leftArm, index, agent.position.x, groundedY + 0.36, agent.position.z, this.agentRotation, this.agentPoseScale);
      this.writeAgentInstance(this.agentMeshes.rightArm, index, agent.position.x, groundedY + 0.36, agent.position.z, this.agentRotation, this.agentPoseScale);
      return;
    }

    const pulse = Math.sin(elapsed * 8 + agent.id.length) * 0.08;
    const purposefulWalk = agent.currentAction === "walking" && Boolean(agent.target?.intent);
    const hungerClutch = agent.hunger > 82 && agent.currentAction !== "eating";
    const walkSwing = agent.currentAction === "walking" ? Math.sin(elapsed * condition.walkTempo + agent.id.length) * (0.45 - condition.drag * 0.18 + condition.steady * 0.08) : 0;
    const front =
      hungerClutch
        ? 0.28
        : agent.currentAction === "working" || agent.currentAction === "shopping" || agent.currentAction === "eating" || agent.currentAction === "washing" || agent.currentAction === "cleaning"
        ? 0.34
        : agent.currentAction === "socializing"
          ? 0.16
          : purposefulWalk
            ? 0.2
            : 0.02;
    const sideReach = hungerClutch ? 0.24 : agent.currentAction === "socializing" ? 0.52 : purposefulWalk ? 0.3 : 0.36;
    const basePitch =
      hungerClutch
        ? -0.88
        : agent.currentAction === "working"
        ? -0.74
        : agent.currentAction === "eating" || agent.currentAction === "washing" || agent.currentAction === "cleaning"
          ? -0.96
          : agent.currentAction === "shopping" || agent.currentAction === "checking_mail" || agent.currentAction === "budgeting" || agent.currentAction === "paying_rent"
            ? -0.55
            : agent.currentAction === "socializing"
              ? -0.22
              : agent.currentAction === "resting"
                ? 0.28
                : purposefulWalk
                  ? -0.18
                  : 0;
    const height =
      agent.currentAction === "working"
        ? 0.72 + pulse
        : agent.currentAction === "eating" || agent.currentAction === "shopping" || agent.currentAction === "washing" || agent.currentAction === "cleaning" || purposefulWalk
          ? 0.82
          : agent.currentAction === "resting"
            ? 0.58
            : 0.78;
    const scaleY =
      agent.currentAction === "working" || agent.currentAction === "washing" || agent.currentAction === "cleaning"
        ? 0.86
        : agent.currentAction === "socializing"
          ? 0.74
        : agent.currentAction === "resting"
            ? 0.62
            : 1;
    const wornScale = Math.max(0.58, scaleY - condition.drag * 0.18 + condition.steady * 0.05);
    const wornHeight = height - condition.slump * 0.06;
    this.agentPoseScale.set(1, wornScale, 1);
    this.writeArm(this.agentMeshes.leftArm, index, agent, groundedY, forward, -sideReach, wornHeight, front, this.agentPoseScale, basePitch + walkSwing * 0.38);
    this.writeArm(
      this.agentMeshes.rightArm,
      index,
      agent,
      groundedY,
      forward,
      sideReach,
      wornHeight + (agent.currentAction === "working" ? -pulse : 0),
      front,
      this.agentPoseScale,
      basePitch - walkSwing * 0.38
    );
  }

  private writeAgentHair(agent: SimAgent, index: number, headX: number, headY: number, headZ: number, forward: THREE.Vector3, rotation: THREE.Quaternion, headScale: number) {
    const sidePush = ((agent.dna.appearanceHue % 7) - 3) * 0.012;
    const frontPush = agent.dna.risk > 62 ? 0.045 : agent.dna.discipline > 66 ? -0.015 : 0.01;
    const height = agent.dna.sociability > 68 ? 1.22 : agent.dna.discipline > 70 ? 0.82 : 1;
    this.agentPoseScale.set(0.88 + agent.dna.risk / 850, height, 0.9 + agent.dna.greed / 900);
    this.writeAgentInstance(
      this.agentMeshes.hair,
      index,
      headX + this.agentSideAxis.x * sidePush + forward.x * frontPush,
      headY + 0.25 * headScale,
      headZ + this.agentSideAxis.z * sidePush + forward.z * frontPush,
      rotation,
      this.agentPoseScale
    );
  }

  private writeAgentHat(
    agent: SimAgent,
    index: number,
    headX: number,
    headY: number,
    headZ: number,
    forward: THREE.Vector3,
    rotation: THREE.Quaternion,
    headScale: number,
    hidden: boolean
  ) {
    const visible = !hidden && (agent.job !== "clerk" || agent.aspiration.id !== "comfort");
    if (!visible) {
      this.agentPoseScale.set(0.01, 0.01, 0.01);
      this.writeAgentInstance(this.agentMeshes.hat, index, headX, headY, headZ, rotation, this.agentPoseScale);
      return;
    }

    const jobWidth =
      agent.job === "security_officer" ? 1.18 : agent.job === "builder" || agent.job === "materials_clerk" ? 1.28 : agent.job === "clinician" ? 0.82 : 0.96;
    const jobHeight = agent.job === "security_officer" ? 0.58 : agent.job === "clinician" ? 0.82 : agent.aspiration.id === "belonging" ? 0.38 : 0.5;
    const frontPush = agent.job === "security_officer" || agent.job === "builder" ? 0.075 : agent.aspiration.id === "belonging" ? -0.02 : 0.02;
    const sidePush = agent.aspiration.id === "building" ? 0.035 : agent.aspiration.id === "comfort" ? -0.025 : 0;
    this.agentPoseScale.set(jobWidth, jobHeight, jobWidth * (agent.job === "builder" ? 1.18 : 1));
    this.writeAgentInstance(
      this.agentMeshes.hat,
      index,
      headX + forward.x * frontPush + this.agentSideAxis.x * sidePush,
      headY + (0.34 + jobHeight * 0.035) * headScale,
      headZ + forward.z * frontPush + this.agentSideAxis.z * sidePush,
      rotation,
      this.agentPoseScale
    );
  }

  private writeAgentBadge(agent: SimAgent, index: number, groundedY: number, forward: THREE.Vector3, hidden: boolean) {
    if (hidden) {
      this.agentPoseScale.set(0.01, 0.01, 0.01);
      this.writeAgentInstance(this.agentMeshes.badge, index, agent.position.x, groundedY + 0.86, agent.position.z, this.agentRotation, this.agentPoseScale);
      return;
    }

    const pulse = agent.currentAction === "working" || agent.currentAction === "healing" ? 1 + Math.sin(this.clock.elapsedTime * 6 + index) * 0.06 : 1;
    const dominantSkill = this.dominantSkillForAgent(agent);
    const skillWidth = 1 + Math.min(0.38, (dominantSkill.level - 1) * 0.06 + Math.max(0, dominantSkill.aptitude - 60) * 0.004);
    const skillHeight = dominantSkill.id === "care" || dominantSkill.id === "social" ? 1.16 : dominantSkill.id === "civic" ? 0.92 : 1;
    const y = agent.currentAction === "resting" ? groundedY + 0.78 : groundedY + 0.96;
    this.agentPoseScale.set(pulse * skillWidth, pulse * skillHeight, 1);
    this.writeAgentInstance(
      this.agentMeshes.badge,
      index,
      agent.position.x + forward.x * 0.265,
      y,
      agent.position.z + forward.z * 0.265,
      this.agentRotation,
      this.agentPoseScale
    );
  }

  private writeAgentPack(agent: SimAgent, index: number, groundedY: number, forward: THREE.Vector3, hidden: boolean) {
    const roleCarriesGear = ["builder", "materials_clerk", "clinician", "security_officer"].includes(agent.job);
    const carriesItems = agent.inventory.length > 0;
    const dominantSkill = this.dominantSkillForAgent(agent);
    const active = !hidden && !["sleeping", "hospitalized", "resting"].includes(agent.currentAction) && (roleCarriesGear || carriesItems);
    if (!active) {
      this.agentPoseScale.set(0.01, 0.01, 0.01);
      this.writeAgentInstance(this.agentMeshes.pack, index, agent.position.x, groundedY + 0.82, agent.position.z, this.agentRotation, this.agentPoseScale);
      return;
    }

    const skillGear = dominantSkill.level >= 3 && ["labor", "care", "civic", "commerce"].includes(dominantSkill.id) ? 0.08 : 0;
    const bulk = 1 + Math.min(3, agent.inventory.length) * 0.12 + (agent.job === "builder" || agent.job === "materials_clerk" ? 0.1 : 0) + skillGear;
    const sideShift = agent.job === "security_officer" ? 0.18 : 0;
    this.agentPoseScale.set(0.86 * bulk, 0.9 + Math.min(2, agent.inventory.length) * 0.08, 1);
    this.writeAgentInstance(
      this.agentMeshes.pack,
      index,
      agent.position.x - forward.x * 0.29 + this.agentSideAxis.x * sideShift,
      groundedY + 0.83,
      agent.position.z - forward.z * 0.29 + this.agentSideAxis.z * sideShift,
      this.agentRotation,
      this.agentPoseScale
    );
  }

  private writeAgentFace(
    agent: SimAgent,
    index: number,
    headX: number,
    headY: number,
    headZ: number,
    forward: THREE.Vector3,
    rotation: THREE.Quaternion,
    hidden: boolean,
    condition: AgentConditionVisual
  ) {
    if (hidden) {
      this.agentPoseScale.set(0.01, 0.01, 0.01);
      this.writeAgentInstance(this.agentMeshes.face, index, headX, headY, headZ, rotation, this.agentPoseScale);
      return;
    }
    const sociableLift = agent.dna.sociability > 62 ? 0.035 : 0;
    const motive = this.leadMotiveForAgent(agent);
    const emotionallyFrayed = agent.emotion.irritation > 78 || agent.emotion.composure < 30 || agent.emotion.hope < 24;
    const emotionallyBright = agent.emotion.hope > 74 && agent.emotion.confidence > 62 && agent.emotion.irritation < 46;
    const strained =
      (motive?.status === "active" && motive.kind === "fear") ||
      emotionallyFrayed ||
      agent.stress > 68 ||
      agent.mood < 32 ||
      agent.hunger > 84 ||
      agent.energy < 22 ||
      condition.drag > 0.46;
    const bright =
      !strained &&
      (emotionallyBright || motive?.status === "fulfilled" || agent.currentAction === "socializing" || agent.mood > 68 || agent.routine.bondsToday > 0 || condition.steady > 0.45);
    const expressionWidth = strained ? 0.68 + Math.max(0, 0.2 - condition.drag * 0.08) : bright ? 1.24 + condition.steady * 0.08 : 1;
    const expressionHeight = strained ? 0.68 : bright ? 1.08 + condition.steady * 0.05 : 1;
    this.agentPoseScale.set((agent.dna.empathy > 68 ? 1.16 : 1) * expressionWidth, expressionHeight, 1);
    this.writeAgentInstance(
      this.agentMeshes.face,
      index,
      headX + forward.x * 0.218,
      headY + 0.035 + sociableLift + (strained ? -0.045 - condition.drag * 0.025 : bright ? 0.02 : 0),
      headZ + forward.z * 0.218,
      rotation,
      this.agentPoseScale
    );
  }

  private writeAgentLegs(agent: SimAgent, index: number, groundedY: number, forward: THREE.Vector3, elapsed: number, hidden: boolean, condition: AgentConditionVisual) {
    if (hidden) {
      this.agentPoseScale.set(0.01, 0.01, 0.01);
      this.writeAgentInstance(this.agentMeshes.leftLeg, index, agent.position.x, groundedY + 0.12, agent.position.z, this.agentRotation, this.agentPoseScale);
      this.writeAgentInstance(this.agentMeshes.rightLeg, index, agent.position.x, groundedY + 0.12, agent.position.z, this.agentRotation, this.agentPoseScale);
      return;
    }

    const strideAmount = Math.max(0.06, 0.16 - condition.drag * 0.05 + condition.steady * 0.03);
    const stride = agent.currentAction === "walking" ? Math.sin(elapsed * condition.walkTempo + agent.id.length) * strideAmount : 0;
    const stridePitch = agent.currentAction === "walking" ? Math.sin(elapsed * condition.walkTempo + agent.id.length) * (0.5 - condition.drag * 0.16 + condition.steady * 0.08) : 0;
    const crouch = (agent.currentAction === "resting" ? 0.08 : 0) + condition.slump * 0.055;
    const sideReach = 0.13;
    const sideX = forward.z;
    const sideZ = -forward.x;
    this.agentPoseScale.set(1, Math.max(0.72, (agent.currentAction === "resting" ? 0.72 : 1) - condition.drag * 0.1), 1);
    this.writeAgentInstance(
      this.agentMeshes.leftLeg,
      index,
      agent.position.x - sideX * sideReach + forward.x * stride,
      groundedY + 0.29 - crouch,
      agent.position.z - sideZ * sideReach + forward.z * stride,
      this.limbRotation(stridePitch),
      this.agentPoseScale
    );
    this.writeAgentInstance(
      this.agentMeshes.rightLeg,
      index,
      agent.position.x + sideX * sideReach - forward.x * stride,
      groundedY + 0.29 - crouch,
      agent.position.z + sideZ * sideReach - forward.z * stride,
      this.limbRotation(-stridePitch),
      this.agentPoseScale
    );
  }

  private writeAgentRoleUniform(agent: SimAgent, index: number, groundedY: number, forward: THREE.Vector3, hidden: boolean, condition: AgentConditionVisual) {
    const visual = this.roleUniformVisualForAgent(agent);
    const hiddenScale = 0.01;
    if (hidden || !visual.panel.visible) {
      this.agentPoseScale.setScalar(hiddenScale);
      this.writeAgentInstance(this.agentMeshes.rolePanel, index, agent.position.x, groundedY + 0.86, agent.position.z, this.agentRotation, this.agentPoseScale);
    } else {
      const sideX = forward.z;
      const sideZ = -forward.x;
      const activePulse = agent.currentAction === "working" ? 1 + Math.sin(this.clock.elapsedTime * 5.4 + index) * 0.035 : 1;
      this.agentPoseScale.set(visual.panel.scale[0] * activePulse, Math.max(0.58, visual.panel.scale[1] - condition.slump * 0.06), visual.panel.scale[2]);
      this.writeAgentInstance(
        this.agentMeshes.rolePanel,
        index,
        agent.position.x + forward.x * visual.panel.forwardOffset + sideX * visual.panel.sideOffset,
        groundedY + visual.panel.y - condition.slump * 0.04,
        agent.position.z + forward.z * visual.panel.forwardOffset + sideZ * visual.panel.sideOffset,
        this.agentRotation,
        this.agentPoseScale
      );
    }

    if (hidden || !visual.accent.visible) {
      this.agentPoseScale.setScalar(hiddenScale);
      this.writeAgentInstance(this.agentMeshes.roleAccent, index, agent.position.x, groundedY + 0.94, agent.position.z, this.agentRotation, this.agentPoseScale);
      return;
    }

    const sideX = forward.z;
    const sideZ = -forward.x;
    const pulse = agent.currentAction === "working" || agent.currentAction === "healing" ? 1 + Math.sin(this.clock.elapsedTime * 7.2 + index) * 0.045 : 1;
    this.agentPoseScale.set(visual.accent.scale[0] * pulse, visual.accent.scale[1] * pulse, visual.accent.scale[2]);
    this.writeAgentInstance(
      this.agentMeshes.roleAccent,
      index,
      agent.position.x + forward.x * visual.accent.forwardOffset + sideX * visual.accent.sideOffset,
      groundedY + visual.accent.y - condition.slump * 0.04,
      agent.position.z + forward.z * visual.accent.forwardOffset + sideZ * visual.accent.sideOffset,
      this.agentRotation,
      this.agentPoseScale
    );
  }

  private roleUniformVisualForAgent(agent: SimAgent): AgentRoleUniformVisual {
    switch (agent.job) {
      case "grocer":
        return {
          panel: { visible: true, scale: [1.05, 1.04, 1], y: 0.84, forwardOffset: 0.27, sideOffset: 0 },
          accent: { visible: true, scale: [0.5, 0.34, 1], y: 0.72, forwardOffset: 0.295, sideOffset: 0.11 }
        };
      case "clinician":
        return {
          panel: { visible: true, scale: [0.96, 1.32, 1], y: 0.82, forwardOffset: 0.272, sideOffset: 0 },
          accent: { visible: true, scale: [0.42, 0.42, 1], y: 1.02, forwardOffset: 0.3, sideOffset: -0.1 }
        };
      case "security_officer":
        return {
          panel: { visible: true, scale: [1.12, 0.92, 1], y: 0.91, forwardOffset: 0.274, sideOffset: 0 },
          accent: { visible: true, scale: [0.34, 0.34, 1], y: 1.04, forwardOffset: 0.303, sideOffset: 0.12 }
        };
      case "clerk":
        return {
          panel: { visible: true, scale: [0.72, 1.08, 1], y: 0.88, forwardOffset: 0.274, sideOffset: -0.05 },
          accent: { visible: true, scale: [0.72, 0.22, 1], y: 0.96, forwardOffset: 0.304, sideOffset: 0.08 }
        };
      case "builder":
        return {
          panel: { visible: true, scale: [1.18, 0.96, 1], y: 0.88, forwardOffset: 0.276, sideOffset: 0 },
          accent: { visible: true, scale: [0.96, 0.2, 1], y: 0.99, forwardOffset: 0.306, sideOffset: 0 }
        };
      case "materials_clerk":
        return {
          panel: { visible: true, scale: [1.02, 0.9, 1], y: 0.87, forwardOffset: 0.274, sideOffset: 0 },
          accent: { visible: true, scale: [0.62, 0.26, 1], y: 0.76, forwardOffset: 0.304, sideOffset: -0.1 }
        };
      default:
        return {
          panel: { visible: false, scale: [1, 1, 1], y: 0.86, forwardOffset: 0.27, sideOffset: 0 },
          accent: { visible: false, scale: [1, 1, 1], y: 0.94, forwardOffset: 0.3, sideOffset: 0 }
        };
    }
  }

  private writeAgentShadow(agent: SimAgent, index: number, groundedY: number, lowPose: boolean, condition: AgentConditionVisual) {
    const width = lowPose ? 0.9 : 0.68 + agent.dna.risk / 420 + condition.drag * 0.12;
    const depth = lowPose ? 0.58 : 0.46 + agent.dna.discipline / 760 + condition.drag * 0.08;
    this.agentPoseScale.set(width, depth, 1);
    this.writeAgentInstance(this.agentMeshes.shadow, index, agent.position.x, groundedY + 0.012, agent.position.z, this.agentGroundRotation, this.agentPoseScale);
  }

  private writeAspirationCrest(agent: SimAgent, index: number, groundedY: number, forward: THREE.Vector3, elapsed: number, hidden: boolean) {
    if (hidden) {
      this.agentPoseScale.set(0.01, 0.01, 0.01);
      this.writeAgentInstance(this.agentMeshes.aspirationCrest, index, agent.position.x, groundedY + 1.08, agent.position.z, this.agentRotation, this.agentPoseScale);
      return;
    }

    const pressurePulse = 1 + Math.sin(elapsed * (agent.aspiration.pressure > 60 ? 7 : 3) + index) * (agent.aspiration.pressure > 60 ? 0.12 : 0.04);
    const progressScale = 0.72 + Math.min(100, agent.aspiration.progress) / 220;
    const sideX = forward.z;
    const sideZ = -forward.x;
    this.agentPoseScale.setScalar(pressurePulse * progressScale);
    this.writeAgentInstance(
      this.agentMeshes.aspirationCrest,
      index,
      agent.position.x + sideX * 0.28 - forward.x * 0.1,
      groundedY + 1.23 + Math.sin(elapsed * 2.4 + index) * 0.025,
      agent.position.z + sideZ * 0.28 - forward.z * 0.1,
      this.agentRotation,
      this.agentPoseScale
    );
  }

  private writeHeldItem(agent: SimAgent, index: number, groundedY: number, forward: THREE.Vector3, elapsed: number, hidden: boolean) {
    const visual = this.heldItemVisualForAgent(agent);
    if (hidden || !visual.visible) {
      this.agentPoseScale.set(0.01, 0.01, 0.01);
      this.writeAgentInstance(this.agentMeshes.heldItem, index, agent.position.x, groundedY + 0.85, agent.position.z, this.agentRotation, this.agentPoseScale);
      this.writeAgentInstance(this.agentMeshes.heldAccent, index, agent.position.x, groundedY + 0.85, agent.position.z, this.agentRotation, this.agentPoseScale);
      return;
    }

    const pulse = 1 + Math.sin(elapsed * 7 + index) * visual.pulse;
    const sideX = forward.z;
    const sideZ = -forward.x;
    const y = groundedY + visual.height + Math.sin(elapsed * 8 + index) * visual.pulse * 0.45;
    this.agentPoseScale.set(visual.scale[0] * pulse, visual.scale[1] * pulse, visual.scale[2] * pulse);
    this.writeAgentInstance(
      this.agentMeshes.heldItem,
      index,
      agent.position.x + forward.x * visual.forwardOffset + sideX * visual.sideOffset,
      y,
      agent.position.z + forward.z * visual.forwardOffset + sideZ * visual.sideOffset,
      this.agentRotation,
      this.agentPoseScale
    );

    const accent = visual.accent;
    if (!accent) {
      this.agentPoseScale.setScalar(0.01);
      this.writeAgentInstance(this.agentMeshes.heldAccent, index, agent.position.x, groundedY + 0.85, agent.position.z, this.agentRotation, this.agentPoseScale);
      return;
    }

    const accentPulse = 1 + Math.sin(elapsed * 8.4 + index * 0.9) * (accent.pulse ?? visual.pulse * 0.5);
    this.agentPoseScale.set(accent.scale[0] * accentPulse, accent.scale[1] * accentPulse, accent.scale[2] * accentPulse);
    this.writeAgentInstance(
      this.agentMeshes.heldAccent,
      index,
      agent.position.x + forward.x * (visual.forwardOffset + (accent.forwardOffset ?? 0)) + sideX * (visual.sideOffset + (accent.sideOffset ?? 0)),
      y + (accent.heightOffset ?? 0),
      agent.position.z + forward.z * (visual.forwardOffset + (accent.forwardOffset ?? 0)) + sideZ * (visual.sideOffset + (accent.sideOffset ?? 0)),
      this.agentRotation,
      this.agentPoseScale
    );
  }

  private writeStatusPip(agent: SimAgent, index: number, groundedY: number, forward: THREE.Vector3, elapsed: number, condition: AgentConditionVisual) {
    const status = agent.statusEffects[0];
    const visible = Boolean(status && status.tone !== "neutral") || agent.activeDrive.pressure >= 62;
    const sideX = forward.z;
    const sideZ = -forward.x;
    const size = (status && status.tone !== "neutral" ? 1 : 0.72) + condition.drag * 0.32 + condition.steady * 0.12;
    this.agentPoseScale.setScalar(visible ? size + Math.sin(elapsed * (5 + condition.drag * 2) + index) * (0.08 + condition.drag * 0.04) : 0.01);
    this.writeAgentInstance(
      this.agentMeshes.statusPip,
      index,
      agent.position.x + sideX * 0.42,
      groundedY + 1.78 - condition.slump * 0.06 + Math.sin(elapsed * 3 + index) * 0.06,
      agent.position.z + sideZ * 0.42,
      this.agentRotation,
      this.agentPoseScale
    );
  }

  private writeMotiveBubble(agent: SimAgent, index: number, groundedY: number, forward: THREE.Vector3, elapsed: number, hidden: boolean, condition: AgentConditionVisual) {
    const motive = this.leadMotiveForAgent(agent);
    const visible = Boolean(motive && !hidden && (motive.status === "active" || motive.status === "fulfilled"));
    if (!visible || !motive) {
      this.agentPoseScale.setScalar(0.01);
      this.writeAgentInstance(this.agentMeshes.motiveBubble, index, agent.position.x, groundedY + 1.94, agent.position.z, this.agentRotation, this.agentPoseScale);
      this.writeAgentInstance(this.agentMeshes.motiveIcon, index, agent.position.x, groundedY + 1.94, agent.position.z, this.agentRotation, this.agentPoseScale);
      return;
    }

    const active = motive.status === "active";
    const fear = motive.kind === "fear";
    const intensity = clamp(motive.intensity / 100, 0.08, 1);
    const progress = clamp(motive.progress / 100, 0, 1);
    const pulseSpeed = active ? (fear ? 7.4 : 4.6) : 2.8;
    const pulse = 1 + Math.sin(elapsed * pulseSpeed + index * 0.7) * (active ? (fear ? 0.12 : 0.075) : 0.035);
    const sideX = forward.z;
    const sideZ = -forward.x;
    const bubbleSize = (fear ? 0.82 : 0.68) + intensity * (fear ? 0.28 : 0.2) - (active ? 0 : 0.18);
    const y = groundedY + 1.9 - condition.slump * 0.06 + Math.sin(elapsed * 2.6 + index) * 0.045;
    const side = fear ? -0.47 : -0.42;
    const front = fear ? -0.04 : -0.1;

    this.agentPoseScale.set(bubbleSize * pulse, bubbleSize * 0.78 * pulse, 0.34);
    this.writeAgentInstance(
      this.agentMeshes.motiveBubble,
      index,
      agent.position.x + sideX * side + forward.x * front,
      y,
      agent.position.z + sideZ * side + forward.z * front,
      this.agentRotation,
      this.agentPoseScale
    );

    const iconScale = (0.78 + intensity * 0.46 + progress * 0.2) * pulse;
    this.agentPoseScale.set(iconScale * (fear ? 0.78 : 1.05), iconScale * (fear ? 1.28 : 0.9), iconScale * 0.82);
    this.writeAgentInstance(
      this.agentMeshes.motiveIcon,
      index,
      agent.position.x + sideX * side + forward.x * (front + 0.01),
      y + 0.004,
      agent.position.z + sideZ * side + forward.z * (front + 0.01),
      this.agentRotation,
      this.agentPoseScale
    );
  }

  private dominantSkillForAgent(agent: SimAgent) {
    return (Object.values(agent.skills) as SimAgent["skills"][AgentSkillId][])
      .sort((a, b) => b.level - a.level || b.aptitude - a.aptitude || b.xp - a.xp)[0] ?? agent.skills.labor;
  }

  private conditionVisualForAgent(agent: SimAgent): AgentConditionVisual {
    const load = clamp(
      Math.max(0, agent.hunger - 70) * 0.9 +
        Math.max(0, 36 - agent.energy) * 1.08 +
        Math.max(0, 68 - agent.health) * 0.82 +
        Math.max(0, agent.stress - 58) * 0.55 +
        Math.max(0, 34 - agent.hygiene) * 0.34 +
        Math.max(0, 34 - agent.nutrition.hydration) * 0.42 +
        Math.max(0, 30 - agent.nutrition.quality) * 0.22 +
        Math.max(0, agent.leisure.boredom - 78) * 0.16 +
        Math.max(0, 24 - agent.leisure.fun) * 0.14 +
        Math.max(0, agent.sleep.sleepDebt - 62) * 0.3 +
        Math.max(0, agent.sleep.circadianFatigue - 66) * 0.26 +
        Math.max(0, agent.autonomy.overwhelm - 72) * 0.16 +
        Math.max(0, 28 - agent.autonomy.control) * 0.14 +
        Math.max(0, 24 - agent.autonomy.dignity) * 0.1 +
        Math.max(0, agent.time.rush - 72) * 0.16 +
        Math.max(0, 32 - agent.time.punctuality) * 0.09 +
        Math.max(0, agent.rhythm.drift - 70) * 0.12 +
        Math.max(0, 30 - Math.min(agent.rhythm.work, agent.rhythm.care, agent.rhythm.home, agent.rhythm.social, agent.rhythm.finance)) * 0.08 +
        Math.max(0, agent.emotion.irritation - 76) * 0.12 +
        Math.max(0, 28 - agent.emotion.composure) * 0.12 +
        Math.max(0, agent.emotion.loneliness - 86) * 0.08 +
        Math.max(0, 24 - agent.emotion.hope) * 0.1 +
        Math.max(0, agent.career.burnout - 60) * 0.46 +
        Math.min(14, (agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue) * 0.12) +
        (agent.medical.minorIllness.active ? agent.medical.minorIllness.severity * 0.38 : 0)
    );
    const recovery = clamp(
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
        Math.max(0, agent.time.punctuality - 64) * 0.025 +
        Math.max(0, 35 - agent.time.rush) * 0.035 +
        Math.max(0, agent.rhythm.momentum - 64) * 0.02 +
        Math.max(0, 42 - agent.rhythm.drift) * 0.02 +
        Math.max(0, agent.emotion.composure - 64) * 0.018 +
        Math.max(0, agent.emotion.hope - 64) * 0.016 +
        Math.max(0, agent.emotion.confidence - 68) * 0.012 +
        Math.max(0, 36 - agent.emotion.irritation) * 0.016 +
        (agent.routine.ateToday ? 3 : 0) +
        (agent.routine.recreationToday > 0 ? 3 : 0) +
        (agent.routine.sleptToday ? 4 : 0) +
        (agent.routine.autonomyMomentsToday > 0 ? 3 : 0) +
        (agent.time.keptWindowsToday > 0 ? 2 : 0),
      0,
      40
    );
    const statusIds = new Set(agent.statusEffects.map((status) => status.id));
    const drag = clamp(Math.max(load / 100, statusIds.has("condition-drag") ? 0.76 : statusIds.has("condition-load") ? 0.48 : 0), 0, 1);
    const steady = clamp(Math.max(recovery / 40, statusIds.has("steady-body") ? 0.5 : 0), 0, 1);
    const hungryTint =
      agent.nutrition.hydration < 28
        ? "#b88655"
        : agent.hunger > 84
          ? "#b07a4a"
          : agent.medical.minorIllness.active
            ? "#9bb7bf"
            : agent.health < 58
              ? "#8fd4df"
              : agent.emotion.irritation > 84 || agent.emotion.composure < 24
                ? "#bf6a62"
                : agent.emotion.loneliness > 84
                  ? "#6f8da4"
                  : agent.emotion.hope > 78 && agent.emotion.confidence > 64
                    ? "#e2c66f"
                    : agent.autonomy.overwhelm > 82 || agent.autonomy.control < 24
                      ? "#bb8a78"
                      : agent.time.rush > 82
                        ? "#c7a064"
                        : agent.rhythm.drift > 78
                          ? "#a08f79"
                          : agent.stress > 70
                            ? "#b86464"
                            : "#7d7f86";
    return {
      load: Math.round(load),
      recovery: Math.round(recovery),
      drag,
      steady,
      slump: clamp(drag - steady * 0.28, 0, 1),
      heightAdjust: -drag * 0.055 + steady * 0.018,
      widthAdjust: drag * 0.03 - steady * 0.006,
      headAdjust: -drag * 0.026 + steady * 0.008,
      walkTempo: 10 - drag * 3.2 + steady * 1.2,
      bobAmount: Math.max(0.012, 0.035 - drag * 0.021 + steady * 0.01),
      tint: hungryTint
    };
  }

  private agentPosture(agent: SimAgent, skillId: AgentSkillId, condition: AgentConditionVisual) {
    const driveLift = agent.activeDrive.id === "mastery" || agent.activeDrive.id === "autonomy" ? 0.025 : agent.activeDrive.id === "comfort" ? -0.02 : 0;
    const posture: Record<AgentSkillId, { height: number; width: number; head: number }> = {
      labor: { height: -0.012, width: 0.06, head: -0.01 },
      commerce: { height: 0.018, width: -0.004, head: 0 },
      care: { height: 0.006, width: 0.01, head: 0.024 },
      social: { height: 0.04, width: -0.018, head: 0.026 },
      homecraft: { height: -0.006, width: 0.02, head: 0.004 },
      civic: { height: 0.026, width: -0.006, head: -0.006 }
    };
    const base = posture[skillId] ?? posture.labor;
    return {
      height: base.height + driveLift + condition.heightAdjust,
      width: base.width + (agent.activeDrive.id === "security" ? 0.018 : 0) + condition.widthAdjust,
      head: base.head + condition.headAdjust
    };
  }

  private itemColorForAgent(agent: SimAgent) {
    return this.heldItemVisualForAgent(agent).color;
  }

  private itemAccentColorForAgent(agent: SimAgent) {
    return this.heldItemVisualForAgent(agent).accent?.color ?? "#ffffff";
  }

  private workHeldItemVisualForAgent(agent: SimAgent, action: SimAgent["currentAction"], repairCredit: boolean): HeldItemVisual {
    const pulse = action === "working" ? 0.09 : 0.025;
    const skill = this.dominantSkillForAgent(agent);
    const skillScale = 1 + Math.min(0.18, (skill.level - 1) * 0.035 + Math.max(0, skill.aptitude - 58) * 0.002);
    switch (agent.job) {
      case "builder":
        return {
          visible: true,
          color: repairCredit ? "#78d7ff" : SKILL_COLORS.labor,
          scale: [1.45 * skillScale, 0.22, 0.36],
          forwardOffset: 0.52,
          sideOffset: 0,
          height: 0.98,
          pulse,
          accent: {
            color: repairCredit ? "#f4c95d" : "#6b4c30",
            scale: [0.48 * skillScale, 0.34, 0.52],
            forwardOffset: 0.12,
            heightOffset: 0.03,
            pulse: pulse * 0.6
          }
        };
      case "materials_clerk":
        return {
          visible: true,
          color: "#b897ff",
          scale: [0.96 * skillScale, 0.72, 0.9],
          forwardOffset: 0.44,
          sideOffset: 0.04,
          height: 0.88,
          pulse: pulse * 0.72,
          accent: {
            color: "#f4c95d",
            scale: [0.82 * skillScale, 0.18, 0.82],
            heightOffset: 0.2,
            pulse: pulse * 0.4
          }
        };
      case "grocer":
        return {
          visible: true,
          color: SKILL_COLORS.commerce,
          scale: [1.02 * skillScale, 0.66, 0.84],
          forwardOffset: 0.44,
          sideOffset: 0.06,
          height: 0.88,
          pulse: pulse * 0.8,
          accent: {
            color: "#fff0a8",
            scale: [0.7 * skillScale, 0.22, 0.72],
            heightOffset: 0.2,
            pulse: pulse * 0.5
          }
        };
      case "clinician":
        return {
          visible: true,
          color: SKILL_COLORS.care,
          scale: [0.86 * skillScale, 0.66, 0.86],
          forwardOffset: 0.43,
          sideOffset: 0.08,
          height: 0.93,
          pulse: pulse * 0.82,
          accent: {
            color: "#f6fbff",
            scale: [0.86 * skillScale, 0.16, 0.24],
            forwardOffset: 0.012,
            heightOffset: 0.08,
            pulse: pulse * 0.45
          }
        };
      case "security_officer":
        return {
          visible: true,
          color: "#6d87d8",
          scale: [0.52 * skillScale, 0.78, 0.38],
          forwardOffset: 0.44,
          sideOffset: 0.1,
          height: 0.98,
          pulse,
          accent: {
            color: "#f4c95d",
            scale: [0.36 * skillScale, 0.16, 0.44],
            heightOffset: 0.18,
            pulse: pulse * 0.5
          }
        };
      case "clerk":
        return {
          visible: true,
          color: SKILL_COLORS.civic,
          scale: [1.18 * skillScale, 0.2, 0.78],
          forwardOffset: 0.49,
          sideOffset: 0.04,
          height: 0.94,
          pulse: pulse * 0.62,
          accent: {
            color: "#6d5638",
            scale: [0.86 * skillScale, 0.18, 0.2],
            heightOffset: 0.08,
            pulse: pulse * 0.35
          }
        };
      default:
        return {
          visible: true,
          color: repairCredit ? "#78d7ff" : "#ffdf79",
          scale: [1.3 * skillScale, 0.26, 0.4],
          forwardOffset: 0.5,
          sideOffset: 0,
          height: 0.98,
          pulse,
          accent: {
            color: "#6b4c30",
            scale: [0.42 * skillScale, 0.3, 0.42],
            forwardOffset: 0.1,
            heightOffset: 0.03,
            pulse: pulse * 0.45
          }
        };
    }
  }

  private heldItemVisualForAgent(agent: SimAgent): HeldItemVisual {
    const action = agent.currentAction;
    const intent = agent.target?.intent;
    const activeAction = ["eating", "washing", "cleaning", "working", "shopping", "healing", "checking_mail", "budgeting", "paying_rent", "building", "socializing"].includes(action);
    const purposefulWalk = action === "walking" && Boolean(intent);
    const visible = activeAction || purposefulWalk;

    if (!visible || action === "sleeping" || action === "hospitalized" || action === "resting") {
      return {
        visible: false,
        color: "#ffffff",
        scale: [1, 1, 1],
        forwardOffset: 0,
        sideOffset: 0,
        height: 0.9,
        pulse: 0
      };
    }

    if (intent?.kind === "civic") {
      const urgent = intent.strategy === "request_payment_plan" || intent.strategy.includes("partial") || intent.strategy.includes("earn_before");
      return {
        visible: true,
        color: intent.billType === "medical" ? "#7fcfd0" : urgent ? "#ffdf79" : "#f5c84b",
        scale: [1.25, 0.28, 0.78],
        forwardOffset: 0.48,
        sideOffset: 0.04,
        height: 0.92,
        pulse: action === "paying_rent" || action === "budgeting" ? 0.04 : 0.015,
        accent: {
          color: intent.strategy === "request_payment_plan" ? "#78d7ff" : intent.billType === "medical" ? "#f6fbff" : urgent ? "#ff6f68" : "#fff0a8",
          scale: intent.strategy === "request_payment_plan" ? [0.76, 0.16, 0.28] : [0.42, 0.16, 0.42],
          sideOffset: 0.006,
          heightOffset: 0.08,
          pulse: urgent ? 0.06 : 0.02
        }
      };
    }

    if (intent?.kind === "food") {
      const eating = action === "eating";
      return {
        visible: true,
        color: intent.strategy === "emergency_savings_purchase" ? "#f5c84b" : "#76b46d",
        scale: eating ? [0.74, 0.52, 0.74] : [0.88, 1.05, 0.72],
        forwardOffset: eating ? 0.43 : 0.38,
        sideOffset: 0.1,
        height: eating ? 0.9 : 0.78,
        pulse: action === "shopping" || eating ? 0.06 : 0.02,
        accent: {
          color: eating ? "#fff0a8" : intent.strategy.includes("bulk") ? "#f4c95d" : "#93e6a9",
          scale: eating ? [0.52, 0.18, 0.52] : [0.64, 0.28, 0.52],
          heightOffset: eating ? 0.06 : 0.36,
          sideOffset: eating ? 0 : -0.01,
          pulse: eating ? 0.05 : 0.035
        }
      };
    }

    if (intent?.kind === "work") {
      return this.workHeldItemVisualForAgent(agent, action, intent.strategy === "repair_credit");
    }

    if (intent?.kind === "health") {
      return {
        visible: true,
        color: "#7fcfd0",
        scale: [0.9, 0.66, 0.86],
        forwardOffset: 0.42,
        sideOffset: 0.08,
        height: 0.92,
        pulse: action === "healing" ? 0.06 : 0.02,
        accent: {
          color: intent.strategy === "urgent_care" ? "#ff6f68" : "#f6fbff",
          scale: [0.82, 0.18, 0.24],
          heightOffset: 0.09,
          pulse: action === "healing" ? 0.05 : 0.02
        }
      };
    }

    if (intent?.kind === "social") {
      return {
        visible: true,
        color: intent.strategy === "avoid" ? "#f4c95d" : "#dc6d6d",
        scale: [0.62, 0.62, 0.62],
        forwardOffset: 0.3,
        sideOffset: 0,
        height: 1.08,
        pulse: 0.09,
        accent: {
          color: intent.strategy === "avoid" ? "#6d5638" : "#fff0c4",
          scale: [0.36, 0.36, 0.36],
          forwardOffset: 0.01,
          heightOffset: 0.04,
          pulse: 0.08
        }
      };
    }

    if (intent?.kind === "build") {
      return {
        visible: true,
        color: "#d8b46a",
        scale: [1.25, 0.24, 0.44],
        forwardOffset: 0.5,
        sideOffset: 0.03,
        height: 0.96,
        pulse: action === "building" ? 0.07 : 0.02,
        accent: {
          color: "#78d7ff",
          scale: [0.82, 0.12, 0.2],
          forwardOffset: 0.06,
          heightOffset: 0.05,
          pulse: 0.03
        }
      };
    }

    if (intent?.kind === "home" && intent.strategy === "wash_hygiene") {
      return {
        visible: true,
        color: "#69a6c8",
        scale: [0.42, 0.82, 0.42],
        forwardOffset: 0.44,
        sideOffset: 0.08,
        height: 0.9,
        pulse: action === "washing" ? 0.06 : 0.02,
        accent: {
          color: "#f6fbff",
          scale: [0.48, 0.16, 0.48],
          heightOffset: 0.22,
          pulse: 0.03
        }
      };
    }

    if (intent?.kind === "home" && ["reset_home", "tidy_clutter", "deep_clean"].includes(intent.strategy)) {
      const deep = intent.strategy === "deep_clean";
      return {
        visible: true,
        color: deep ? "#8f7a5b" : "#b89464",
        scale: deep ? [0.36, 1.42, 0.36] : [0.28, 1.28, 0.28],
        forwardOffset: 0.48,
        sideOffset: 0.12,
        height: 0.9,
        pulse: action === "cleaning" ? (deep ? 0.1 : 0.08) : 0.02,
        accent: {
          color: deep ? "#f6fbff" : "#d8b46a",
          scale: deep ? [0.72, 0.18, 0.3] : [0.52, 0.16, 0.42],
          heightOffset: deep ? -0.22 : -0.34,
          pulse: 0.04
        }
      };
    }

    if (intent?.kind === "home" && intent.strategy === "do_laundry") {
      return {
        visible: true,
        color: "#c9a6ff",
        scale: [0.72, 0.88, 0.72],
        forwardOffset: 0.42,
        sideOffset: 0.1,
        height: 0.8,
        pulse: action === "washing" || action === "cleaning" ? 0.06 : 0.02,
        accent: {
          color: "#f6fbff",
          scale: [0.62, 0.22, 0.5],
          heightOffset: 0.26,
          pulse: 0.03
        }
      };
    }

    if (intent?.kind === "home" && intent.strategy === "sleep_prep") {
      return {
        visible: true,
        color: "#d8d2ea",
        scale: [0.9, 0.34, 0.72],
        forwardOffset: 0.42,
        sideOffset: 0.08,
        height: 0.86,
        pulse: action === "cleaning" ? 0.04 : 0.015,
        accent: {
          color: "#fff0c4",
          scale: [0.72, 0.12, 0.5],
          heightOffset: 0.1,
          pulse: 0.02
        }
      };
    }

    switch (action) {
      case "eating":
        return {
          visible: true,
          color: "#76b46d",
          scale: [0.74, 0.52, 0.74],
          forwardOffset: 0.43,
          sideOffset: 0.1,
          height: 0.9,
          pulse: 0.06,
          accent: { color: "#fff0a8", scale: [0.52, 0.18, 0.52], heightOffset: 0.06, pulse: 0.05 }
        };
      case "washing":
        return {
          visible: true,
          color: "#69a6c8",
          scale: [0.42, 0.82, 0.42],
          forwardOffset: 0.44,
          sideOffset: 0.08,
          height: 0.9,
          pulse: 0.06,
          accent: { color: "#f6fbff", scale: [0.48, 0.16, 0.48], heightOffset: 0.22, pulse: 0.03 }
        };
      case "cleaning":
        return {
          visible: true,
          color: "#b89464",
          scale: [0.28, 1.28, 0.28],
          forwardOffset: 0.48,
          sideOffset: 0.12,
          height: 0.9,
          pulse: 0.08,
          accent: { color: "#d8b46a", scale: [0.52, 0.16, 0.42], heightOffset: -0.34, pulse: 0.04 }
        };
      case "working":
        return this.workHeldItemVisualForAgent(agent, action, false);
      case "building":
        return {
          visible: true,
          color: SKILL_COLORS.labor,
          scale: [1.36, 0.22, 0.46],
          forwardOffset: 0.5,
          sideOffset: 0,
          height: 0.98,
          pulse: 0.08,
          accent: { color: "#6b4c30", scale: [0.42, 0.3, 0.42], forwardOffset: 0.1, heightOffset: 0.03, pulse: 0.04 }
        };
      case "shopping":
      case "budgeting":
      case "paying_rent":
        return {
          visible: true,
          color: "#f5c84b",
          scale: [1.05, 0.32, 0.78],
          forwardOffset: 0.48,
          sideOffset: 0.04,
          height: 0.92,
          pulse: 0.05,
          accent: { color: action === "shopping" ? "#93e6a9" : "#fff0a8", scale: [0.42, 0.16, 0.42], heightOffset: 0.08, pulse: 0.03 }
        };
      case "healing":
        return {
          visible: true,
          color: "#7fcfd0",
          scale: [0.9, 0.66, 0.86],
          forwardOffset: 0.42,
          sideOffset: 0.08,
          height: 0.92,
          pulse: 0.06,
          accent: { color: "#f6fbff", scale: [0.82, 0.18, 0.24], heightOffset: 0.09, pulse: 0.04 }
        };
      case "checking_mail":
        return {
          visible: true,
          color: "#fff0c4",
          scale: [1.2, 0.2, 0.78],
          forwardOffset: 0.48,
          sideOffset: 0.04,
          height: 0.92,
          pulse: 0.035,
          accent: { color: "#6d87d8", scale: [0.64, 0.12, 0.2], heightOffset: 0.05, pulse: 0.02 }
        };
      case "socializing":
        return {
          visible: true,
          color: "#dc6d6d",
          scale: [0.62, 0.62, 0.62],
          forwardOffset: 0.3,
          sideOffset: 0,
          height: 1.08,
          pulse: 0.09,
          accent: { color: "#fff0c4", scale: [0.36, 0.36, 0.36], heightOffset: 0.04, pulse: 0.08 }
        };
      default:
        return { visible: false, color: "#ffffff", scale: [1, 1, 1], forwardOffset: 0, sideOffset: 0, height: 0.9, pulse: 0 };
    }
  }

  private setJobColor(color: THREE.Color, agent: SimAgent, hospitalized: boolean) {
    if (hospitalized) {
      color.set("#d6eef4");
      return;
    }

    switch (agent.job) {
      case "grocer":
        color.set("#8ee47b");
        break;
      case "clinician":
        color.set("#74d4dc");
        break;
      case "security_officer":
        color.set("#6d87d8");
        break;
      case "clerk":
        color.set("#f6d36b");
        break;
      case "builder":
        color.set("#ffb15d");
        break;
      case "materials_clerk":
        color.set("#b897ff");
        break;
      default:
        color.setHSL(((agent.dna.appearanceHue + 96) % 360) / 360, 0.54, 0.58);
        break;
    }
  }

  private setRoleUniformColor(color: THREE.Color, agent: SimAgent, hospitalized: boolean) {
    if (hospitalized) {
      color.set("#dceff2");
      return;
    }

    switch (agent.job) {
      case "grocer":
        color.set("#315f3f");
        break;
      case "clinician":
        color.set("#e8f3f5");
        break;
      case "security_officer":
        color.set("#26385f");
        break;
      case "clerk":
        color.set("#6d5638");
        break;
      case "builder":
        color.set("#e08c2f");
        break;
      case "materials_clerk":
        color.set("#6b57a8");
        break;
      default:
        color.set("#5d5148");
        break;
    }

    if (agent.currentAction === "working" && agent.civic.serviceImpactToday > 0) color.lerp(this.agentBlendColor.set("#f4c95d"), 0.16);
    if (agent.moodlets[0]?.tone === "bad") color.lerp(this.agentBlendColor.set("#7c3434"), 0.18);
    else if (agent.moodlets[0]?.tone === "good") color.lerp(this.agentBlendColor.set("#93e6a9"), 0.1);
  }

  private applyOutfitVisualToColor(color: THREE.Color, agent: SimAgent, influence: number) {
    const dirt = clamp((52 - agent.outfit.cleanliness) / 52, 0, 1);
    const worn = clamp((agent.outfit.wear - 54) / 46, 0, 1);
    const tired = Math.max(dirt, worn * 0.82);
    if (dirt > 0.02) color.lerp(this.agentBlendColor.set("#6f5740"), dirt * 0.34 * influence);
    if (worn > 0.02) color.lerp(this.agentBlendColor.set("#77746b"), worn * 0.24 * influence);

    const styleAccent: Record<AgentOutfitStyle, string> = {
      workwear: "#e0a24e",
      casual: "#78d7ff",
      tidy: "#f6fbff",
      soft: "#d8d2ea",
      bright: "#ffcf66"
    };
    const polish = clamp((agent.outfit.confidence - 58) / 42, 0, 1) * clamp((agent.outfit.cleanliness - 58) / 34, 0, 1) * (1 - tired * 0.5);
    if (polish > 0.02) color.lerp(this.agentBlendColor.set(styleAccent[agent.outfit.style]), polish * 0.18 * influence);
  }

  private setRoleAccentColor(color: THREE.Color, agent: SimAgent, hospitalized: boolean) {
    if (hospitalized) {
      color.set("#8fd4df");
      return;
    }

    switch (agent.job) {
      case "grocer":
        color.set("#8ee47b");
        break;
      case "clinician":
        color.set("#56c9d7");
        break;
      case "security_officer":
        color.set("#f4c95d");
        break;
      case "clerk":
        color.set("#f6d36b");
        break;
      case "builder":
        color.set("#fff0a8");
        break;
      case "materials_clerk":
        color.set("#d2b4ff");
        break;
      default:
        color.set("#ffffff");
        break;
    }

    if (agent.activeDrive.tone === "bad") color.lerp(this.agentBlendColor.set("#ff6f68"), 0.2);
    else if (agent.activeDrive.tone === "warn") color.lerp(this.agentBlendColor.set("#f4c95d"), 0.12);
  }

  private setPackColor(color: THREE.Color, agent: SimAgent, hospitalized: boolean) {
    if (hospitalized) {
      color.set("#a9d7e2");
      return;
    }

    if (agent.budget.creditScore < 520 || agent.rentDue + agent.medicalDebt + agent.budget.livingCostDue > agent.money + agent.budget.savings) {
      color.set("#8a4b45");
      return;
    }

    if (agent.budget.savings >= agent.budget.savingsGoal && agent.budget.savingsGoal > 0) {
      color.set("#5f7f55");
      return;
    }

    if (agent.budget.savings < agent.budget.dailySpendLimit) {
      color.set("#8a7245");
      return;
    }

    switch (agent.job) {
      case "builder":
      case "materials_clerk":
        color.set("#7b6248");
        break;
      case "clinician":
        color.set("#f4f7fa");
        break;
      case "security_officer":
        color.set("#2e3e68");
        break;
      case "grocer":
        color.set("#50784e");
        break;
      default:
        color.set("#5d5148");
        break;
    }
  }

  private setHatColor(color: THREE.Color, agent: SimAgent, hospitalized: boolean) {
    if (hospitalized) {
      color.set("#f6fbff");
      return;
    }

    switch (agent.job) {
      case "security_officer":
        color.set("#24385f");
        break;
      case "builder":
      case "materials_clerk":
        color.set("#d99a3a");
        break;
      case "clinician":
        color.set("#eef8fb");
        break;
      case "grocer":
        color.set("#447044");
        break;
      case "clerk":
        color.set("#6b5638");
        break;
      default:
        color.setHSL(((agent.dna.appearanceHue + 210) % 360) / 360, 0.46, 0.35);
        break;
    }
  }

  private setAspirationColor(color: THREE.Color, agent: SimAgent, hospitalized: boolean) {
    if (hospitalized) {
      color.set("#8fd4df");
      return;
    }

    switch (agent.aspiration.id) {
      case "stability":
        color.set("#93e6a9");
        break;
      case "career":
        color.set("#f4c95d");
        break;
      case "belonging":
        color.set("#e986a1");
        break;
      case "wellness":
        color.set("#78d7ff");
        break;
      case "comfort":
        color.set("#c9a6ff");
        break;
      case "building":
        color.set("#ffb15d");
        break;
      default:
        color.set("#ffffff");
        break;
    }
    if (agent.aspiration.tone === "bad") color.lerp(this.agentBlendColor.set("#ff6f68"), 0.42);
    else if (agent.aspiration.tone === "warn") color.lerp(this.agentBlendColor.set("#f4c95d"), 0.28);
  }

  private setMarkerColor(color: THREE.Color, agent: SimAgent, hospitalized: boolean) {
    if (hospitalized) {
      color.set("#8fd4df");
      return;
    }

    color.set(DRIVE_COLORS[agent.activeDrive.id]);
    const dominantSkill = this.dominantSkillForAgent(agent);
    if (dominantSkill.level >= 3) color.lerp(this.agentBlendColor.set(SKILL_COLORS[dominantSkill.id]), 0.34);
    if (agent.activeDrive.tone === "bad") color.lerp(this.agentBlendColor.set("#ff6f68"), 0.28);
    else if (agent.activeDrive.tone === "warn") color.lerp(this.agentBlendColor.set("#f4c95d"), 0.18);
  }

  private setFaceColor(color: THREE.Color, agent: SimAgent, hidden: boolean) {
    if (hidden) {
      color.copy(FACE_COLOR);
      return;
    }
    const motive = this.leadMotiveForAgent(agent);
    if (motive?.status === "active" && motive.kind === "fear") {
      color.set(motive.tone === "bad" ? "#743038" : "#684b2c");
      return;
    }
    if (agent.medical.minorIllness.active) {
      color.set(agent.medical.minorIllness.severity >= 54 ? "#6d3b48" : "#4d4a5f");
      return;
    }
    const leadMoodlet = agent.moodlets[0];
    if (leadMoodlet?.tone === "bad") {
      color.set("#6d3038");
      return;
    }
    if (leadMoodlet?.tone === "warn") {
      color.set("#5f4930");
      return;
    }
    if (leadMoodlet?.tone === "good" && agent.mood > 52) {
      color.set("#254438");
      return;
    }
    if (agent.stress > 72 || agent.health < 54 || agent.hunger > 86) {
      color.set("#7a2f34");
      return;
    }
    if (agent.currentAction === "socializing" || agent.routine.bondsToday > 0 || agent.mood > 70) {
      color.set("#254438");
      return;
    }
    if (agent.currentAction === "working" && agent.routine.workedToday) {
      color.set("#41351f");
      return;
    }
    color.copy(FACE_COLOR);
  }

  private leadMotiveForAgent(agent: SimAgent): SimAgent["wants"][number] | undefined {
    return (
      agent.wants.find((want) => want.status === "active" && want.kind === "fear") ??
      agent.wants.find((want) => want.status === "active") ??
      agent.wants.find((want) => want.status === "fulfilled")
    );
  }

  private motiveColorForAgent(agent: SimAgent) {
    const motive = this.leadMotiveForAgent(agent);
    if (!motive) return "#ffffff";
    if (motive.status === "fulfilled") return "#93e6a9";
    if (motive.kind === "fear") return motive.tone === "bad" ? "#ff8a72" : "#f4c95d";
    if (motive.tone === "warn") return "#ffd36a";
    if (motive.tone === "good") return "#93e6a9";
    return "#78d7ff";
  }

  private motiveIconColorForAgent(agent: SimAgent) {
    const motive = this.leadMotiveForAgent(agent);
    if (!motive) return "#111817";
    if (motive.status === "fulfilled") return "#153b2c";
    return motive.kind === "fear" ? "#4a3025" : "#162f3a";
  }

  private motiveMarkerLabel(motive: SimAgent["wants"][number]) {
    if (motive.status === "fulfilled") return `${motive.kind === "fear" ? "Fear Eased" : "Want Met"}: ${motive.label}`;
    return `${motive.kind === "fear" ? "Fear" : "Want"}: ${motive.label}`;
  }

  private leadSocialMomentForAgent(agent: SimAgent): SimAgent["socialMoments"][number] | undefined {
    return agent.socialMoments[0];
  }

  private statusColorForAgent(agent: SimAgent) {
    const statusTone = agent.statusEffects[0]?.tone;
    const tone = statusTone && statusTone !== "neutral" ? statusTone : (agent.moodlets[0]?.tone ?? "neutral");
    switch (tone) {
      case "bad":
        return "#ff6f68";
      case "warn":
        return "#f4c95d";
      case "good":
        return "#93e6a9";
      default:
        return agent.activeDrive.pressure >= 62 ? DRIVE_COLORS[agent.activeDrive.id] : "#ffffff";
    }
  }

  private writeArm(
    mesh: THREE.InstancedMesh,
    index: number,
    agent: SimAgent,
    groundedY: number,
    forward: THREE.Vector3,
    sideOffset: number,
    height: number,
    frontOffset: number,
    scale: THREE.Vector3,
    pitch = 0
  ) {
    const sideX = forward.z;
    const sideZ = -forward.x;
    this.writeAgentInstance(
      mesh,
      index,
      agent.position.x + sideX * sideOffset + forward.x * frontOffset,
      groundedY + height,
      agent.position.z + sideZ * sideOffset + forward.z * frontOffset,
      this.limbRotation(pitch),
      scale
    );
  }

  private limbRotation(pitch: number) {
    if (Math.abs(pitch) < 0.001) return this.agentRotation;
    this.agentLimbRotation.setFromAxisAngle(this.agentSideAxis, pitch);
    this.agentPoseRotation.copy(this.agentRotation).premultiply(this.agentLimbRotation);
    return this.agentPoseRotation;
  }

  private writeAgentInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    rotation: THREE.Quaternion = this.agentRotation,
    scale: THREE.Vector3 = this.agentScale
  ) {
    this.agentPosition.set(x, y, z);
    this.agentMatrix.compose(this.agentPosition, rotation, scale);
    mesh.setMatrixAt(index, this.agentMatrix);
  }

  private updateWorldMarkers(summary = this.agentSimulation.summary()) {
    if (summary.agents.length === 0) {
      this.options.onWorldMarkers([]);
      return;
    }

    const markers: AgentWorldMarker[] = summary.agents.slice(0, MAX_AGENT_INSTANCES).map((agent) => {
      const selected = agent.id === this.selectedAgentId;
      const groundedY = this.groundedAgentY(agent);
      this.markerProjection.set(agent.position.x, groundedY + (selected ? 2.18 : 1.86), agent.position.z).project(this.camera);
      const inView =
        this.markerProjection.z > -1 &&
        this.markerProjection.z < 1 &&
        Math.abs(this.markerProjection.x) < 1.16 &&
        Math.abs(this.markerProjection.y) < 1.16;
      const leadingStatus = agent.statusEffects[0];
      const actionLabel = ACTION_MARKER_LABELS[agent.currentAction] ?? "Acting";
      const motive = this.leadMotiveForAgent(agent);
      const socialMoment = this.leadSocialMomentForAgent(agent);
      const motiveActive = motive?.status === "active";
      const motiveImportant = Boolean(motiveActive && (motive.kind === "fear" || motive.intensity >= 50));
      const socialImportant = Boolean(socialMoment && (selected || socialMoment.tone === "bad" || socialMoment.tone === "warn" || socialMoment.kind !== "housemate"));
      const intentLabel = motive
        ? this.motiveMarkerLabel(motive)
        : socialMoment
          ? `Social: ${socialMoment.label}`
          : (agent.target?.intent?.label ?? agent.lifePriority.label);
      const importantStatus = leadingStatus?.tone === "bad" || leadingStatus?.tone === "warn";
      const visibleAction = !["walking", "idle"].includes(agent.currentAction);
      const detail = selected
        ? (motive?.detail ?? socialMoment?.detail ?? agent.goal)
        : motiveImportant && motive
          ? motive.detail
          : socialImportant && socialMoment
            ? socialMoment.detail
            : (leadingStatus?.label ?? intentLabel);
      const tone = motiveActive && motive ? motive.tone : socialMoment ? socialMoment.tone : (leadingStatus?.tone ?? "neutral");
      return {
        id: agent.id,
        name: agent.name,
        variant: "agent",
        selected,
        visible: inView && (selected || importantStatus || visibleAction || motiveImportant || socialImportant),
        xPercent: (this.markerProjection.x * 0.5 + 0.5) * 100,
        yPercent: (-this.markerProjection.y * 0.5 + 0.5) * 100,
        actionLabel,
        intentLabel,
        detail,
        tone,
        progress: motiveActive && motive ? motive.progress / 100 : (agent.actionProgress ?? 0),
        motiveKind: motiveActive && motive ? motive.kind : "none",
        socialKind: !motive && socialMoment ? "moment" : "none"
      };
    });

    const latestEventTick = summary.events.reduce((latest, event) => Math.max(latest, event.timestamp), 0);
    const eventMarkers: AgentWorldMarker[] = summary.events
      .filter(
        (event) =>
          event.position &&
          event.agentId !== "city" &&
          event.kind !== "arrival" &&
          latestEventTick - event.timestamp <= EVENT_MARKER_LIFETIME_TICKS &&
          event.importance >= 5
      )
      .slice(0, MAX_EVENT_MARKERS)
      .map((event) => {
        const position = event.position!;
        const age = latestEventTick - event.timestamp;
        this.markerProjection.set(position.x, position.y + 0.24, position.z).project(this.camera);
        const inView =
          this.markerProjection.z > -1 &&
          this.markerProjection.z < 1 &&
          Math.abs(this.markerProjection.x) < 1.12 &&
          Math.abs(this.markerProjection.y) < 1.12;
        return {
          id: event.id,
          name: event.agentName,
          variant: "event",
          selected: false,
          visible: inView,
          xPercent: (this.markerProjection.x * 0.5 + 0.5) * 100,
          yPercent: (-this.markerProjection.y * 0.5 + 0.5) * 100,
          actionLabel: event.actionLabel ?? "Happened",
          intentLabel: event.kind === "conflict" ? "Tension changed" : event.kind === "money" ? "Money changed" : event.kind === "food" ? "Food changed" : "Story event",
          detail: event.locationLabel ?? event.agentName,
          tone: event.tone,
          progress: 1 - age / EVENT_MARKER_LIFETIME_TICKS,
          motiveKind: "none",
          socialKind: "none"
        };
      });

    markers.push(...eventMarkers);
    this.options.onWorldMarkers(markers);
  }

  private groundedAgentY(agent: SimAgent) {
    if (!this.world) return agent.position.y;
    const x = Math.floor(agent.position.x);
    const z = Math.floor(agent.position.z);
    const startY = Math.max(0, Math.floor(agent.position.y) - 1);
    for (let y = startY; y >= 0; y -= 1) {
      if (isSolidBlock(this.world.getBlock(x, y, z))) return y + 1.02;
    }
    return agent.position.y;
  }

  private spawnPositionInFrontOfCamera() {
    if (!this.world) return undefined;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
    const x = this.camera.position.x + forward.x * 4.5;
    const z = this.camera.position.z + forward.z * 4.5;
    const groundY = this.world.cityMap.surfaceY;
    return { x, y: groundY + 1.08, z };
  }

  private spawnPositionForNewAgent() {
    if (!this.world) return undefined;
    if (this.cameraMode === "free") return this.spawnPositionInFrontOfCamera();
    const summary = this.agentSimulation.summary();
    const angle = summary.agents.length * 1.9;
    const radius = 1.5 + (summary.agents.length % 4) * 0.65;
    const x = this.world.spawn.x + 0.5 + Math.cos(angle) * radius;
    const z = this.world.spawn.z + 0.5 + Math.sin(angle) * radius;
    return { x, y: this.world.cityMap.surfaceY + 1.08, z };
  }

  private setCameraMode(mode: CameraMode) {
    if (this.cameraMode === mode) return;
    this.cameraMode = mode;
    if (mode === "free") {
      this.player.setFlyMode(true);
      return;
    }
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.player.setFlyMode(false);
  }

  private setIntroCamera(world: VoxelWorld) {
    const surfaceY = world.cityMap?.surfaceY ?? 7;
    const target = new THREE.Vector3(world.spawn.x + 0.5, surfaceY + 0.6, world.spawn.z + 0.5);
    this.introLookAt.copy(target);
    this.camera.position.set(target.x + 12, target.y + 9, target.z + 15);
    this.camera.lookAt(target);
  }

  private updateSpectatorCamera(dt: number) {
    if (this.cameraMode !== "spectate" || !this.world) return;
    const selected = this.agentSimulation.summary().agents.find((agent) => agent.id === this.selectedAgentId);
    if (!selected) {
      this.selectedAgentId = null;
      this.clearSpectatorCutaway();
      this.updateIntroCamera(dt);
      return;
    }

    const agentY = this.groundedAgentY(selected);
    const agentPosition = new THREE.Vector3(selected.position.x, agentY + 0.76, selected.position.z);
    const forward = this.agentFacingDirection(selected);
    this.followForward.lerp(forward, 1 - Math.exp(-dt * 4.2)).normalize();
    this.updateSpectatorCutaway(selected, agentY);

    const desiredPosition = agentPosition.clone().addScaledVector(this.followForward, -6.2);
    desiredPosition.y += 3.4;
    this.resolveSpectatorCamera(agentPosition, desiredPosition, this.followForward);
    this.camera.position.lerp(desiredPosition, 1 - Math.exp(-dt * 4.8));
    this.followLookAt.lerp(agentPosition, 1 - Math.exp(-dt * 7));
    this.camera.lookAt(this.followLookAt);
  }

  private updateIntroCamera(dt: number) {
    if (!this.world) return;
    const surfaceY = this.world.cityMap?.surfaceY ?? 7;
    const target = new THREE.Vector3(this.world.spawn.x + 0.5, surfaceY + 0.5, this.world.spawn.z + 0.5);
    const time = this.clock.elapsedTime * 0.08;
    const desiredPosition = new THREE.Vector3(target.x + Math.cos(time) * 17, target.y + 10.5, target.z + Math.sin(time) * 17);
    this.camera.position.lerp(desiredPosition, 1 - Math.exp(-dt * 1.8));
    this.introLookAt.lerp(target, 1 - Math.exp(-dt * 3));
    this.camera.lookAt(this.introLookAt);
  }

  private agentFacingDirection(agent: SimAgent) {
    const next = agent.target?.waypoints[0] ?? agent.target;
    if (next) {
      const dx = next.x - agent.position.x;
      const dz = next.z - agent.position.z;
      if (Math.hypot(dx, dz) > 0.2) return new THREE.Vector3(dx, 0, dz).normalize();
    }
    return this.followForward.lengthSq() > 0.01 ? this.followForward.clone().normalize() : new THREE.Vector3(0, 0, 1);
  }

  private resolveSpectatorCamera(target: THREE.Vector3, desired: THREE.Vector3, forward: THREE.Vector3) {
    if (this.hasClearCameraLine(target, desired)) return;

    this.cameraSide.set(forward.z, 0, -forward.x);
    if (this.cameraSide.lengthSq() < 0.001) this.cameraSide.set(1, 0, 0);
    this.cameraSide.normalize();

    const candidates: Array<readonly [number, number, number]> = [
      [-4.9, 2.8, 3.7],
      [-4.9, -2.8, 3.7],
      [-3.2, 5.4, 4.4],
      [-3.2, -5.4, 4.4],
      [2.6, 4.2, 4.8],
      [2.6, -4.2, 4.8],
      [-1.2, 0, 6.4]
    ];
    for (const [forwardOffset, sideOffset, heightOffset] of candidates) {
      this.cameraProbe.copy(target).addScaledVector(forward, forwardOffset).addScaledVector(this.cameraSide, sideOffset);
      this.cameraProbe.y += heightOffset;
      if (this.hasClearCameraLine(target, this.cameraProbe)) {
        desired.copy(this.cameraProbe);
        return;
      }
    }

    if (this.cameraClearPoint.distanceTo(target) > 4.2) desired.copy(this.cameraClearPoint);
    else desired.copy(target).addScaledVector(forward, -2.8).setY(target.y + 5.8);
  }

  private hasClearCameraLine(target: THREE.Vector3, candidate: THREE.Vector3) {
    if (!this.world) return true;
    const distance = target.distanceTo(candidate);
    const steps = Math.max(4, Math.ceil(distance * 2.2));
    this.cameraClearPoint.copy(target);
    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      this.cameraProbe.lerpVectors(target, candidate, t);
      if (isSolidBlock(this.world.getBlock(this.cameraProbe.x, this.cameraProbe.y, this.cameraProbe.z)) && !this.chunkRenderer.isCutawayOpenBlock(this.cameraProbe.x, this.cameraProbe.y, this.cameraProbe.z)) {
        return false;
      }
      this.cameraClearPoint.copy(this.cameraProbe);
    }
    return true;
  }

  private updateSpectatorCutaway(agent: SimAgent, agentY: number) {
    if (!this.world) return;
    const structure = this.selectedStructureForCutaway(agent, agentY);
    this.chunkRenderer.setSpectatorCutaway(this.world, structure, agentY, this.camera.position.x, this.camera.position.z);
    this.activeCutawayStructureId = structure?.id ?? null;
  }

  private clearSpectatorCutaway() {
    if (!this.world || !this.activeCutawayStructureId) return;
    this.chunkRenderer.setSpectatorCutaway(this.world, null, 0, this.camera.position.x, this.camera.position.z);
    this.activeCutawayStructureId = null;
  }

  private selectedStructureForCutaway(agent: SimAgent, agentY: number): StructureMetadata | null {
    if (!this.world) return null;
    const targetStructure = this.world.structures.all().find((candidate) => candidate.id === agent.target?.structureId) ?? null;
    if (targetStructure && this.isStructureCutawayEligible(targetStructure) && this.isInsideStructureFootprint(agent, targetStructure, agentY, CUTAWAY_ENTER_MARGIN)) {
      return targetStructure;
    }

    const currentStructure = this.world.findStructureAt(agent.position.x, agentY, agent.position.z);
    if (currentStructure && this.isStructureCutawayEligible(currentStructure) && this.isInsideStructureFootprint(agent, currentStructure, agentY, CUTAWAY_ENTER_MARGIN)) {
      return currentStructure;
    }

    const activeStructure = this.activeCutawayStructureId
      ? (this.world.structures.all().find((candidate) => candidate.id === this.activeCutawayStructureId) ?? null)
      : null;
    if (activeStructure && this.isStructureCutawayEligible(activeStructure) && this.isInsideStructureFootprint(agent, activeStructure, agentY, CUTAWAY_EXIT_MARGIN)) {
      return activeStructure;
    }

    return null;
  }

  private isStructureCutawayEligible(structure: StructureMetadata) {
    return !["park", "empty_lot", "road"].includes(structure.type);
  }

  private isInsideStructureFootprint(agent: SimAgent, structure: StructureMetadata, agentY: number, margin: number) {
    const footprint = structure.footprint;
    return (
      agent.position.x >= footprint.x - margin &&
      agent.position.x <= footprint.x + footprint.width + margin &&
      agent.position.z >= footprint.z - margin &&
      agent.position.z <= footprint.z + footprint.depth + margin &&
      agentY >= footprint.minY &&
      agentY <= footprint.maxY + 1
    );
  }

  private findAgentPath(from: AgentNavPoint, to: AgentNavPoint) {
    return this.pathfinder?.findPath(from, to) ?? null;
  }

  private getSemanticSummary(): SemanticSummary {
    const structures = this.world?.structures.all() ?? [];
    const byType: Record<string, number> = {};
    const actionPointsByType: Record<string, number> = {};
    const serviceIds = new Set<string>();
    const jobIds = new Set<string>();
    let actionPointCount = 0;
    let jobs = 0;
    let services = 0;
    let inventoryItems = 0;
    let homes = 0;
    let buildableLots = 0;

    for (const structure of structures) {
      byType[structure.type] = (byType[structure.type] ?? 0) + 1;
      if (structure.type === "apartment" || structure.tags.includes("home")) homes += 1;
      if (structure.type === "empty_lot" || structure.tags.includes("buildable")) buildableLots += 1;
      for (const point of structure.actionPoints) {
        actionPointCount += 1;
        actionPointsByType[point.type] = (actionPointsByType[point.type] ?? 0) + 1;
      }
      for (const job of structure.jobs ?? []) {
        jobs += 1;
        jobIds.add(job.id);
      }
      for (const service of structure.services ?? []) {
        services += 1;
        serviceIds.add(service.id);
      }
      inventoryItems += structure.inventory?.length ?? 0;
    }

    return {
      structureCount: structures.length,
      actionPointCount,
      homes,
      jobs,
      services,
      inventoryItems,
      buildableLots,
      byType,
      actionPointsByType,
      serviceIds: [...serviceIds].sort(),
      jobIds: [...jobIds].sort()
    };
  }

  private getAgentRenderPartCounts() {
    return {
      body: this.agentMeshes.body.count,
      head: this.agentMeshes.head.count,
      hair: this.agentMeshes.hair.count,
      hat: this.agentMeshes.hat.count,
      face: this.agentMeshes.face.count,
      rolePanel: this.agentMeshes.rolePanel.count,
      roleAccent: this.agentMeshes.roleAccent.count,
      leftArm: this.agentMeshes.leftArm.count,
      rightArm: this.agentMeshes.rightArm.count,
      leftLeg: this.agentMeshes.leftLeg.count,
      rightLeg: this.agentMeshes.rightLeg.count,
      badge: this.agentMeshes.badge.count,
      pack: this.agentMeshes.pack.count,
      marker: this.agentMeshes.marker.count,
      shadow: this.agentMeshes.shadow.count,
      aspirationCrest: this.agentMeshes.aspirationCrest.count,
      heldItem: this.agentMeshes.heldItem.count,
      heldAccent: this.agentMeshes.heldAccent.count,
      statusPip: this.agentMeshes.statusPip.count,
      motiveBubble: this.agentMeshes.motiveBubble.count,
      motiveIcon: this.agentMeshes.motiveIcon.count
    };
  }

  private getAgentPropVisualDebug(summary = this.agentSimulation.summary()) {
    return summary.agents.slice(0, MAX_AGENT_INSTANCES).map((agent) => {
      const visual = this.heldItemVisualForAgent(agent);
      return {
        id: agent.id,
        name: agent.name,
        action: agent.currentAction,
        intentKind: agent.target?.intent?.kind ?? null,
        intentStrategy: agent.target?.intent?.strategy ?? null,
        itemVisible: visual.visible,
        accentVisible: Boolean(visual.accent),
        itemColor: visual.color,
        accentColor: visual.accent?.color ?? null
      };
    });
  }

  private updateDebugState() {
    if (!this.world) return;
    this.debugStats = this.debugStats ?? this.world.getStats();
    window.agencyWorldDebug = {
      seed: this.currentSeed,
      stats: this.debugStats,
      generation: this.world.generation,
      cityMap: this.world.cityMap,
      structures: this.world.structures.all(),
      semantic: this.getSemanticSummary(),
      diorama: this.dioramaLayer.debugStats(),
      agents: this.agentSimulation.summary(),
      player: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z
      },
      fps: this.measuredFps,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      flyMode: this.player.isFlyMode(),
      selectedAgentId: this.selectedAgentId,
      cameraMode: this.cameraMode,
      visibleChunks: this.chunkRenderer.getVisibleChunkCount(),
      cutawayStructure: this.chunkRenderer.getCutawayLabel(),
      weatherEnvironment: this.getWeatherEnvironmentDebug(),
      agentRenderParts: this.getAgentRenderPartCounts(),
      agentPropVisuals: this.getAgentPropVisualDebug()
    };
    window.agencyWorldDebugControls = {
      forceHealthCrisis: (agentId?: string) => this.forceHealthCrisis(agentId),
      forceMinorIllness: (agentId?: string, severity?: number) => this.forceMinorIllnessForDebug(agentId, severity),
      forceObjectIssue: (kind?: "food" | "clinic" | "upkeep") => this.forceObjectIssueForDebug(kind),
      setAgentFinance: (agentId, values) => this.setAgentFinanceForDebug(agentId, values),
      setAgentHousehold: (agentId, values) => this.setAgentHouseholdForDebug(agentId, values),
      setAgentOutfit: (agentId, values) => this.setAgentOutfitForDebug(agentId, values),
      setAgentNutrition: (agentId, values) => this.setAgentNutritionForDebug(agentId, values),
      setAgentLeisure: (agentId, values) => this.setAgentLeisureForDebug(agentId, values),
      setAgentSleep: (agentId, values) => this.setAgentSleepForDebug(agentId, values),
      setAgentAutonomy: (agentId, values) => this.setAgentAutonomyForDebug(agentId, values),
      setAgentTime: (agentId, values) => this.setAgentTimeForDebug(agentId, values),
      setAgentRhythm: (agentId, values) => this.setAgentRhythmForDebug(agentId, values),
      setAgentEmotion: (agentId, values) => this.setAgentEmotionForDebug(agentId, values),
      resolveCivicBills: (agentId?: string, strategy?: string) => this.resolveCivicBillsForDebug(agentId, strategy),
      resolveWorkShift: (agentId?: string, strategy?: string) => this.resolveWorkShiftForDebug(agentId, strategy),
      resolveFoodPurchase: (agentId?: string, strategy?: string) => this.resolveFoodPurchaseForDebug(agentId, strategy),
      resolveHouseholdSupplyPurchase: (agentId?: string, strategy?: string) => this.resolveHouseholdSupplyPurchaseForDebug(agentId, strategy),
      resolveMail: (agentId?: string) => this.resolveMailForDebug(agentId),
      resolveHomeCare: (agentId?: string, strategy?: string) => this.resolveHomeCareForDebug(agentId, strategy),
      resolveClinicCare: (agentId?: string, strategy?: string) => this.resolveClinicCareForDebug(agentId, strategy),
      resolveSleep: (agentId?: string) => this.resolveSleepForDebug(agentId),
      resolveLeisure: (agentId?: string, strategy?: string) => this.resolveLeisureForDebug(agentId, strategy),
      forceSupportDebt: (agentId?: string, amount?: number) => this.forceSupportDebtForDebug(agentId, amount),
      forceSocialMoment: (agentId?: string) => this.forceSocialMomentForDebug(agentId),
      focusStructure: (structureId?: string) => this.focusStructureForDebug(structureId),
      advanceMinutes: (minutes: number) => this.advanceMinutesForDebug(minutes)
    };
    const diorama = this.dioramaLayer.debugStats();
    const homeProps =
      diorama.householdGoods + diorama.householdSupplies + diorama.clutterParts + diorama.laundryParts + diorama.emptyMarkers + diorama.sleepOverlays + diorama.comfortGlows;
    this.options.onDiagnostics(
      `fps ${this.measuredFps.toFixed(0)} | chunks ${this.chunkRenderer.getVisibleChunkCount()}/${this.chunkRenderer.getRenderedChunkCount()} | home props ${homeProps} | ${this.cameraMode === "free" ? "free camera" : "spectating"}`
    );
  }

  private trackFrameRate(dt: number) {
    this.fpsElapsed += dt;
    this.fpsFrames += 1;
    if (this.fpsElapsed < FPS_SAMPLE_SECONDS) return;
    this.measuredFps = this.fpsFrames / this.fpsElapsed;
    this.fpsElapsed = 0;
    this.fpsFrames = 0;
  }
}
