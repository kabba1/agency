import * as THREE from "three";
import type { ActionPoint, ActionPointType, CityMapMetadata, StructureMetadata } from "../shared/types";
import type { AgentSummary, SemanticObjectState, SimAgent } from "../agents/AgentSimulation";
import type { VoxelWorld } from "../world/VoxelWorld";

type DioramaTone = "home" | "food" | "work" | "health" | "civic" | "security" | "park" | "lot";
type IconKind = SimAgent["currentAction"] | "stock" | "mail" | "notice" | "busy" | "clean" | "supply";
type CardinalEdge = "north" | "east" | "south" | "west";

type SemanticPropRecord = {
  key: string;
  structureId: string;
  structureName: string;
  structureType: StructureMetadata["type"];
  actionPointId: string;
  actionType: ActionPointType;
  group: THREE.Group;
  goods: THREE.Object3D[];
  supply: THREE.Object3D[];
  householdGoods: THREE.Object3D[];
  householdSupplies: THREE.Object3D[];
  clutterParts: THREE.Object3D[];
  laundryParts: THREE.Object3D[];
  dirtyOverlay?: THREE.Mesh;
  wearOverlay?: THREE.Mesh;
  usedOverlay?: THREE.Mesh;
  mailFlag?: THREE.Mesh;
  emptyMarker?: THREE.Mesh;
  comfortGlow?: THREE.Mesh;
  sleepQualityOverlay?: THREE.Mesh;
  activeParts: THREE.Object3D[];
  busyRing?: THREE.Mesh;
  icon?: THREE.Sprite;
};

type HouseholdAggregate = {
  pantry: number;
  pantryCapacity: number;
  clutter: number;
  laundry: number;
  toiletries: number;
  cleaningSupplies: number;
  supplyCapacity: number;
  sleepQuality: number;
  homeComfort: number;
  choresDoneToday: number;
};

const PALETTE = {
  ink: "#28313a",
  shadow: "#40505a",
  cream: "#ead9b4",
  paper: "#fff0c4",
  road: "#58656b",
  curb: "#d9d0bb",
  sidewalk: "#cfc5ad",
  grass: "#8bbb74",
  hedge: "#5d9c64",
  soil: "#a67858",
  wood: "#a87945",
  darkWood: "#6c4d33",
  roof: "#b85d5a",
  home: "#df8e78",
  food: "#76b46d",
  work: "#d39a54",
  health: "#7fcfd0",
  civic: "#7e98b8",
  security: "#566982",
  lot: "#d8b46a",
  coin: "#f5c84b",
  red: "#dc6d6d",
  blue: "#69a6c8",
  green: "#72bd75",
  violet: "#9b88bd",
  glow: "#ffdf79",
  white: "#f6f1df"
} as const;

const TONE_COLORS: Record<DioramaTone, string> = {
  home: PALETTE.home,
  food: PALETTE.food,
  work: PALETTE.work,
  health: PALETTE.health,
  civic: PALETTE.civic,
  security: PALETTE.security,
  park: PALETTE.hedge,
  lot: PALETTE.lot
};

const iconForAction: Record<IconKind, string> = {
  idle: "?",
  walking: ">",
  sleeping: "Z",
  eating: "O",
  washing: "~",
  cleaning: "^",
  working: "*",
  calling_in_sick: "!",
  shopping: "$",
  socializing: "<3",
  healing: "+",
  resting: "...",
  checking_mail: "M",
  budgeting: "$",
  paying_rent: "$",
  hospitalized: "+",
  building: "#",
  stock: "[]",
  mail: "M",
  notice: "!",
  busy: "*",
  clean: "~",
  supply: "+"
};

export class SemanticDioramaLayer {
  private readonly root = new THREE.Group();
  private readonly records = new Map<string, SemanticPropRecord>();
  private readonly materialCache = new Map<string, THREE.Material>();
  private readonly iconMaterials = new Map<IconKind, THREE.SpriteMaterial>();
  private readonly tempVector = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = "semantic-diorama-layer";
    scene.add(this.root);
  }

  rebuild(world: VoxelWorld) {
    this.clearObjects();
    this.records.clear();
    this.addStreetDressing(world.cityMap);
    for (const structure of world.structures.all()) {
      this.addStructureDressing(structure);
      for (const point of structure.actionPoints) this.addActionPointProp(structure, point);
    }
  }

  update(summary: AgentSummary, elapsed: number) {
    const states = new Map<string, SemanticObjectState>();
    for (const state of summary.objectStates) states.set(this.stateKey(state.structureId, state.actionPointId), state);

    for (const record of this.records.values()) {
      const state = states.get(record.key);
      const targetedAgents = summary.agents.filter((agent) => agent.target?.structureId === record.structureId && agent.target.actionPointId === record.actionPointId);
      const activeAgents = targetedAgents.filter((agent) => agent.currentAction !== "walking" && agent.currentAction !== "idle");
      this.updatePropState(record, state, targetedAgents, activeAgents, summary.agents, elapsed);
    }

    this.updateAgentIcons(summary.agents, elapsed);
  }

  debugStats() {
    let householdGoods = 0;
    let householdSupplies = 0;
    let clutterParts = 0;
    let laundryParts = 0;
    let emptyMarkers = 0;
    let sleepOverlays = 0;
    let comfortGlows = 0;
    for (const record of this.records.values()) {
      householdGoods += record.householdGoods.filter((part) => part.visible).length;
      householdSupplies += record.householdSupplies.filter((part) => part.visible).length;
      clutterParts += record.clutterParts.filter((part) => part.visible).length;
      laundryParts += record.laundryParts.filter((part) => part.visible).length;
      if (record.emptyMarker?.visible) emptyMarkers += 1;
      if (record.sleepQualityOverlay?.visible) sleepOverlays += 1;
      if (record.comfortGlow?.visible) comfortGlows += 1;
    }
    return {
      propCount: this.records.size,
      householdGoods,
      householdSupplies,
      clutterParts,
      laundryParts,
      emptyMarkers,
      sleepOverlays,
      comfortGlows
    };
  }

  dispose() {
    this.scene.remove(this.root);
    this.clearObjects();
    for (const material of this.materialCache.values()) material.dispose();
    for (const material of this.iconMaterials.values()) {
      material.map?.dispose();
      material.dispose();
    }
    this.materialCache.clear();
    this.iconMaterials.clear();
  }

  private addStreetDressing(cityMap: CityMapMetadata) {
    const surfaceY = cityMap.surfaceY + 1.04;
    const streetGroup = new THREE.Group();
    streetGroup.name = "district-streetscape";
    this.root.add(streetGroup);

    for (const road of cityMap.roads) {
      const main = road.kind === "main";
      const centerX = road.x + road.width / 2;
      const centerZ = road.z + road.depth / 2;
      const horizontal = road.width >= road.depth;
      const lineColor = main ? "#e7d37d" : "#a9b4b6";
      this.box(streetGroup, [horizontal ? road.width : 0.12, 0.025, horizontal ? 0.12 : road.depth], [centerX, surfaceY + 0.01, centerZ], lineColor, "street-centerline", 0.78);

      const curbThickness = main ? 0.22 : 0.14;
      if (horizontal) {
        this.box(streetGroup, [road.width, 0.12, curbThickness], [centerX, surfaceY + 0.035, road.z - curbThickness / 2], PALETTE.curb, "north-curb");
        this.box(streetGroup, [road.width, 0.12, curbThickness], [centerX, surfaceY + 0.035, road.z + road.depth + curbThickness / 2], PALETTE.curb, "south-curb");
      } else {
        this.box(streetGroup, [curbThickness, 0.12, road.depth], [road.x - curbThickness / 2, surfaceY + 0.035, centerZ], PALETTE.curb, "west-curb");
        this.box(streetGroup, [curbThickness, 0.12, road.depth], [road.x + road.width + curbThickness / 2, surfaceY + 0.035, centerZ], PALETTE.curb, "east-curb");
      }

      if (main) this.addStreetLamps(streetGroup, road, surfaceY, horizontal);
    }
  }

  private addStreetLamps(parent: THREE.Group, road: CityMapMetadata["roads"][number], surfaceY: number, horizontal: boolean) {
    const spacing = 14;
    const length = horizontal ? road.width : road.depth;
    const steps = Math.max(1, Math.floor(length / spacing));
    for (let index = 0; index <= steps; index += 1) {
      const along = (index / Math.max(1, steps)) * length;
      const x = horizontal ? road.x + along : road.x - 0.55;
      const z = horizontal ? road.z - 0.55 : road.z + along;
      this.lamp(parent, x, surfaceY, z);
      const x2 = horizontal ? road.x + along : road.x + road.width + 0.55;
      const z2 = horizontal ? road.z + road.depth + 0.55 : road.z + along;
      if (index % 2 === 0) this.lamp(parent, x2, surfaceY, z2);
    }
  }

  private addStructureDressing(structure: StructureMetadata) {
    const tone = this.toneForStructure(structure);
    const color = TONE_COLORS[tone];
    const footprint = structure.footprint;
    const maxY = footprint.maxY + 1.05;
    const centerX = footprint.x + footprint.width / 2;
    const centerZ = footprint.z + footprint.depth / 2;
    const group = new THREE.Group();
    group.name = `diorama-${structure.id}`;
    this.root.add(group);

    const door = structure.actionPoints.find((point) => point.type === "door");
    const facadeEdge = door ? this.edgeForPoint(structure, door) : "north";

    if (structure.type !== "park" && structure.type !== "empty_lot") {
      const groundTopY = footprint.minY + 1;
      this.box(group, [footprint.width + 0.72, 0.024, 0.28], [centerX, groundTopY + 0.012, footprint.z - 0.1], PALETTE.sidewalk, "grounded-base-north");
      this.box(group, [footprint.width + 0.72, 0.024, 0.28], [centerX, groundTopY + 0.012, footprint.z + footprint.depth + 0.1], PALETTE.sidewalk, "grounded-base-south");
      this.box(group, [0.28, 0.024, footprint.depth + 0.72], [footprint.x - 0.1, groundTopY + 0.012, centerZ], PALETTE.sidewalk, "grounded-base-west");
      this.box(group, [0.28, 0.024, footprint.depth + 0.72], [footprint.x + footprint.width + 0.1, groundTopY + 0.012, centerZ], PALETTE.sidewalk, "grounded-base-east");
      this.box(group, [footprint.width + 0.8, 0.2, 0.28], [centerX, maxY, footprint.z - 0.12], color, "roofline-north");
      this.box(group, [footprint.width + 0.8, 0.2, 0.28], [centerX, maxY, footprint.z + footprint.depth + 0.12], color, "roofline-south");
      this.box(group, [0.28, 0.2, footprint.depth + 0.8], [footprint.x - 0.12, maxY, centerZ], color, "roofline-west");
      this.box(group, [0.28, 0.2, footprint.depth + 0.8], [footprint.x + footprint.width + 0.12, maxY, centerZ], color, "roofline-east");
      this.addFacadeTrim(group, footprint, facadeEdge, footprint.minY + 1.95);
    }

    if (door) {
      this.addEntranceDressing(group, structure, door, color);
    }

    if (structure.type === "park") this.addParkStory(group, structure);
    if (structure.type === "empty_lot") this.addLotStory(group, structure);
  }

  private addEntranceDressing(parent: THREE.Group, structure: StructureMetadata, door: ActionPoint, color: string) {
    const edge = this.edgeForPoint(structure, door);
    const base = { x: door.position.x + 0.5, y: structure.footprint.minY + 1, z: door.position.z + 0.5 };
    const horizontal = edge === "north" || edge === "south";
    const out = this.outward(edge);
    const side = horizontal ? { x: 1, z: 0 } : { x: 0, z: 1 };
    const faceOffset = 0.49;
    const postSize: readonly [number, number, number] = horizontal ? [0.1, 1.88, 0.12] : [0.12, 1.88, 0.1];
    const capSize: readonly [number, number, number] = horizontal ? [1.16, 0.13, 0.12] : [0.12, 0.13, 1.16];

    this.box(parent, postSize, [base.x + side.x * -0.5 + out.x * faceOffset, base.y + 0.94, base.z + side.z * -0.5 + out.z * faceOffset], PALETTE.darkWood, "door-frame-left");
    this.box(parent, postSize, [base.x + side.x * 0.5 + out.x * faceOffset, base.y + 0.94, base.z + side.z * 0.5 + out.z * faceOffset], PALETTE.darkWood, "door-frame-right");
    this.box(parent, capSize, [base.x + out.x * faceOffset, base.y + 1.86, base.z + out.z * faceOffset], PALETTE.darkWood, "door-lintel");
    this.box(parent, [horizontal ? 0.76 : 0.045, 1.42, horizontal ? 0.045 : 0.76], [base.x + out.x * (faceOffset - 0.025), base.y + 0.71, base.z + out.z * (faceOffset - 0.025)], PALETTE.shadow, "entry-interior-shadow", 0.42);
    this.box(parent, [horizontal ? 0.32 : 0.05, 1.12, horizontal ? 0.05 : 0.32], [base.x + side.x * -0.2 + out.x * (faceOffset + 0.025), base.y + 0.56, base.z + side.z * -0.2 + out.z * (faceOffset + 0.025)], PALETTE.wood, "open-door-leaf", 0.9);
    this.box(parent, [horizontal ? 0.07 : 0.03, 0.07, horizontal ? 0.03 : 0.07], [base.x + side.x * -0.04 + out.x * (faceOffset + 0.06), base.y + 0.7, base.z + side.z * -0.04 + out.z * (faceOffset + 0.06)], PALETTE.glow, "door-handle");
    this.box(parent, [horizontal ? 1.54 : 0.46, 0.09, horizontal ? 0.46 : 1.54], [base.x + out.x * (faceOffset + 0.16), base.y + 2.12, base.z + out.z * (faceOffset + 0.16)], color, "entrance-awning");
    this.box(parent, [horizontal ? 0.86 : 0.1, 0.24, horizontal ? 0.1 : 0.86], [base.x + out.x * (faceOffset + 0.22), base.y + 1.98, base.z + out.z * (faceOffset + 0.22)], PALETTE.paper, "building-sign");
    this.box(parent, [horizontal ? 0.38 : 0.065, 0.065, horizontal ? 0.065 : 0.38], [base.x + out.x * (faceOffset + 0.29), base.y + 1.98, base.z + out.z * (faceOffset + 0.29)], color, "sign-mark");
    this.box(parent, [horizontal ? 1.12 : 0.46, 0.045, horizontal ? 0.46 : 1.12], [base.x + out.x * (faceOffset + 0.28), base.y + 0.022, base.z + out.z * (faceOffset + 0.28)], PALETTE.curb, "entry-threshold");
    this.box(parent, [horizontal ? 0.92 : 0.36, 0.018, horizontal ? 0.36 : 0.92], [base.x + out.x * (faceOffset + 0.58), base.y + 0.045, base.z + out.z * (faceOffset + 0.58)], PALETTE.cream, "welcome-mat");
    this.planter(parent, base.x + out.x * (faceOffset + 0.76) + (horizontal ? -0.78 : 0), base.y, base.z + out.z * (faceOffset + 0.76) + (horizontal ? 0 : -0.78));
    this.planter(parent, base.x + out.x * (faceOffset + 0.76) + (horizontal ? 0.78 : 0), base.y, base.z + out.z * (faceOffset + 0.76) + (horizontal ? 0 : 0.78));
  }

  private addFacadeTrim(parent: THREE.Group, footprint: StructureMetadata["footprint"], edge: CardinalEdge, y: number) {
    const centerX = footprint.x + footprint.width / 2;
    const centerZ = footprint.z + footprint.depth / 2;
    if (edge === "north" || edge === "south") {
      const z = edge === "north" ? footprint.z - 0.04 : footprint.z + footprint.depth + 0.04;
      this.box(parent, [footprint.width + 0.2, 0.1, 0.12], [centerX, y, z], PALETTE.ink, `front-trim-${edge}`, 0.72);
      return;
    }
    const x = edge === "west" ? footprint.x - 0.04 : footprint.x + footprint.width + 0.04;
    this.box(parent, [0.12, 0.1, footprint.depth + 0.2], [x, y, centerZ], PALETTE.ink, `front-trim-${edge}`, 0.72);
  }

  private addParkStory(parent: THREE.Group, structure: StructureMetadata) {
    const footprint = structure.footprint;
    const y = footprint.minY + 1.04;
    const centerX = footprint.x + footprint.width / 2;
    const centerZ = footprint.z + footprint.depth / 2;
    this.box(parent, [footprint.width - 3, 0.04, 0.9], [centerX, y, centerZ], PALETTE.sidewalk, "park-cross-path");
    this.box(parent, [0.9, 0.04, footprint.depth - 3], [centerX, y, centerZ], PALETTE.sidewalk, "park-long-path");
    this.box(parent, [2.4, 0.05, 2.4], [centerX, y + 0.02, centerZ], "#e4d8b5", "gathering-plaza");
    for (const dx of [-footprint.width / 2 + 2.2, footprint.width / 2 - 2.2]) {
      for (const dz of [-footprint.depth / 2 + 2.2, footprint.depth / 2 - 2.2]) {
        this.planter(parent, centerX + dx, y, centerZ + dz);
      }
    }
  }

  private addLotStory(parent: THREE.Group, structure: StructureMetadata) {
    const footprint = structure.footprint;
    const y = footprint.minY + 1.06;
    const centerX = footprint.x + footprint.width / 2;
    const centerZ = footprint.z + footprint.depth / 2;
    this.box(parent, [footprint.width - 2, 0.05, footprint.depth - 2], [centerX, y, centerZ], "#e2c779", "lot-foundation-pad", 0.72);
    this.box(parent, [2.2, 0.06, 1.5], [centerX - 1.2, y + 0.1, centerZ], PALETTE.paper, "blueprint-paper");
    this.box(parent, [1.4, 0.18, 0.42], [centerX + 1.6, y + 0.16, centerZ - 1.2], PALETTE.wood, "material-stack-a");
    this.box(parent, [0.42, 0.18, 1.4], [centerX + 1.6, y + 0.38, centerZ - 1.2], PALETTE.darkWood, "material-stack-b");
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) this.box(parent, [0.14, 0.82, 0.14], [centerX + sx * (footprint.width / 2 - 1.2), y + 0.36, centerZ + sz * (footprint.depth / 2 - 1.2)], PALETTE.ink, "survey-stake");
    }
  }

  private addActionPointProp(structure: StructureMetadata, point: ActionPoint) {
    const group = new THREE.Group();
    group.name = `prop-${point.id}`;
    group.position.set(point.position.x + 0.5, point.position.y, point.position.z + 0.5);
    this.root.add(group);

    const record: SemanticPropRecord = {
      key: this.stateKey(structure.id, point.id),
      structureId: structure.id,
      structureName: structure.name,
      structureType: structure.type,
      actionPointId: point.id,
      actionType: point.type,
      group,
      goods: [],
      supply: [],
      householdGoods: [],
      householdSupplies: [],
      clutterParts: [],
      laundryParts: [],
      activeParts: []
    };

    switch (point.type) {
      case "door":
        this.addDoorProp(group, record);
        break;
      case "home_anchor":
        this.addHomeAnchorProp(group, record);
        break;
      case "bed":
      case "clinic_bed":
        this.addBedProp(group, record, point.type === "clinic_bed");
        break;
      case "fridge":
        this.addFridgeProp(group, record);
        break;
      case "sink":
        this.addSinkProp(group, record);
        break;
      case "dining_spot":
        this.addDiningProp(group, record);
        break;
      case "seat":
      case "break_spot":
      case "meeting_spot":
        this.addSeatProp(group, record, point.type === "meeting_spot");
        break;
      case "mailbox":
        this.addMailboxProp(group, record);
        break;
      case "register":
      case "counter":
        this.addRegisterProp(group, record);
        break;
      case "shelf":
        this.addShelfProp(group, record);
        break;
      case "vending_machine":
        this.addVendingProp(group, record);
        break;
      case "job_station":
      case "workbench":
        this.addWorkbenchProp(group, record);
        break;
      case "locker":
        this.addLockerProp(group, record);
        break;
      case "medicine_cabinet":
        this.addMedicineProp(group, record);
        break;
      case "desk":
        this.addDeskProp(group, record);
        break;
      case "notice_board":
        this.addNoticeBoardProp(group, record);
        break;
      case "storage":
        this.addStorageProp(group, record);
        break;
      case "construction_anchor":
        this.addConstructionProp(group, record);
        break;
      case "water_source":
      case "crop_plot":
        this.addPlanterProp(group, record);
        break;
      default:
        this.addGenericProp(group, record);
        break;
    }

    record.busyRing = this.ring(group, 0.76, [0, 0.04, 0], PALETTE.glow, "busy-ring");
    record.busyRing.visible = false;
    record.icon = this.iconSprite(this.iconForPoint(point.type));
    record.icon.position.set(0, 1.9, 0);
    record.icon.visible = false;
    group.add(record.icon);
    this.records.set(record.key, record);
  }

  private addDoorProp(group: THREE.Group, record: SemanticPropRecord) {
    record.activeParts.push(this.box(group, [0.54, 0.035, 0.54], [0, 0.03, 0], PALETTE.glow, "door-use-glow"));
  }

  private addHomeAnchorProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [1.18, 0.04, 1.18], [0, 0.03, 0], "#d7a994", "home-rug");
    this.box(group, [0.28, 0.28, 0.28], [-0.42, 0.16, 0.42], PALETTE.soil, "home-pot");
    this.box(group, [0.45, 0.36, 0.45], [-0.42, 0.48, 0.42], PALETTE.hedge, "home-plant");
    record.comfortGlow = this.box(group, [1.34, 0.035, 1.34], [0, 0.065, 0], PALETTE.glow, "home-comfort-glow", 0.34);
    record.comfortGlow.visible = false;
    record.clutterParts.push(this.box(group, [0.32, 0.035, 0.22], [0.38, 0.09, -0.38], PALETTE.paper, "home-paper-stack"));
    record.clutterParts.push(this.box(group, [0.22, 0.12, 0.18], [0.16, 0.14, 0.44], PALETTE.wood, "home-cup"));
    record.clutterParts.push(this.box(group, [0.34, 0.08, 0.18], [-0.04, 0.12, -0.5], PALETTE.ink, "home-shoes"));
    record.laundryParts.push(this.box(group, [0.34, 0.16, 0.28], [0.48, 0.16, 0.1], PALETTE.blue, "home-laundry-blue"));
    record.laundryParts.push(this.box(group, [0.28, 0.14, 0.26], [0.34, 0.3, 0.22], "#d6dde0", "home-laundry-white"));
    record.laundryParts.push(this.box(group, [0.3, 0.13, 0.24], [0.58, 0.28, -0.06], PALETTE.red, "home-laundry-red"));
  }

  private addBedProp(group: THREE.Group, record: SemanticPropRecord, clinic: boolean) {
    const sheet = clinic ? PALETTE.white : "#de817f";
    this.box(group, [1.08, 0.18, 1.6], [0, 0.18, 0], PALETTE.darkWood, "bed-frame");
    this.box(group, [0.96, 0.22, 1.34], [0, 0.38, 0.08], sheet, "bed-sheet");
    this.box(group, [0.72, 0.18, 0.36], [0, 0.54, -0.5], clinic ? PALETTE.health : PALETTE.paper, "pillow");
    record.usedOverlay = this.box(group, [0.82, 0.08, 0.9], [0.08, 0.61, 0.25], clinic ? "#b7e8e7" : "#bd5d70", "rumpled-blanket");
    record.usedOverlay.visible = false;
    if (!clinic) {
      record.sleepQualityOverlay = this.box(group, [0.92, 0.045, 1.18], [0, 0.66, 0.08], PALETTE.shadow, "poor-sleep-shadow", 0.36);
      record.sleepQualityOverlay.visible = false;
    }
  }

  private addFridgeProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [0.72, 1.38, 0.62], [0, 0.72, 0], "#dfe9df", "fridge-body");
    this.box(group, [0.06, 0.82, 0.06], [0.35, 0.78, -0.32], PALETTE.ink, "fridge-handle");
    record.mailFlag = this.box(group, [0.24, 0.18, 0.03], [-0.18, 1.05, -0.34], PALETTE.paper, "fridge-note");
    for (let index = 0; index < 5; index += 1) {
      const x = -0.24 + index * 0.12;
      const y = 0.38 + (index % 3) * 0.16;
      const color = [PALETTE.food, PALETTE.coin, PALETTE.red, PALETTE.blue, PALETTE.green][index]!;
      record.householdGoods.push(this.box(group, [0.08, 0.08, 0.035], [x, y, -0.335], color, `fridge-pantry-marker-${index}`));
    }
    record.emptyMarker = this.box(group, [0.34, 0.08, 0.04], [0, 1.2, -0.34], PALETTE.red, "empty-fridge-marker");
    record.emptyMarker.visible = false;
  }

  private addSinkProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [0.9, 0.52, 0.74], [0, 0.32, 0], PALETTE.cream, "sink-counter");
    this.box(group, [0.54, 0.08, 0.42], [0, 0.62, 0], "#9dc8c6", "basin");
    this.box(group, [0.08, 0.38, 0.08], [0.25, 0.82, -0.08], PALETTE.ink, "faucet-neck");
    this.box(group, [0.28, 0.06, 0.08], [0.13, 0.98, -0.18], PALETTE.ink, "faucet-spout");
    record.householdSupplies.push(this.box(group, [0.1, 0.28, 0.1], [-0.34, 0.78, -0.18], PALETTE.blue, "toiletry-bottle-a"));
    record.householdSupplies.push(this.box(group, [0.09, 0.22, 0.09], [-0.2, 0.75, -0.2], PALETTE.health, "toiletry-bottle-b"));
    record.householdSupplies.push(this.box(group, [0.12, 0.18, 0.12], [-0.08, 0.73, -0.22], PALETTE.white, "toiletry-jar"));
    record.householdSupplies.push(this.box(group, [0.12, 0.24, 0.1], [0.34, 0.76, 0.08], PALETTE.green, "cleaner-bottle-a"));
    record.householdSupplies.push(this.box(group, [0.16, 0.1, 0.1], [0.22, 0.68, 0.2], PALETTE.coin, "cleaner-sponge"));
    record.dirtyOverlay = this.box(group, [0.48, 0.04, 0.34], [0, 0.69, 0.02], "#6e6a55", "sink-dirt", 0.8);
    record.activeParts.push(this.box(group, [0.08, 0.36, 0.08], [0.13, 0.78, -0.2], PALETTE.blue, "water-stream", 0.76));
    record.clutterParts.push(this.box(group, [0.22, 0.035, 0.16], [-0.28, 0.7, 0.12], PALETTE.paper, "sink-dish-a"));
    record.clutterParts.push(this.box(group, [0.18, 0.035, 0.18], [0.24, 0.72, 0.16], "#d9c7a0", "sink-dish-b"));
    record.laundryParts.push(this.box(group, [0.32, 0.18, 0.28], [-0.42, 0.16, -0.38], PALETTE.blue, "sink-towel-pile"));
  }

  private addDiningProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [1.1, 0.16, 0.8], [0, 0.55, 0], PALETTE.wood, "table-top");
    this.box(group, [0.12, 0.5, 0.12], [-0.42, 0.26, -0.28], PALETTE.darkWood, "table-leg-a");
    this.box(group, [0.12, 0.5, 0.12], [0.42, 0.26, 0.28], PALETTE.darkWood, "table-leg-b");
    record.goods.push(this.box(group, [0.22, 0.035, 0.22], [-0.22, 0.66, 0], PALETTE.white, "plate"));
    record.goods.push(this.box(group, [0.18, 0.08, 0.18], [0.18, 0.72, 0.04], PALETTE.food, "meal-bowl"));
    record.clutterParts.push(this.box(group, [0.3, 0.035, 0.22], [0.32, 0.68, -0.18], PALETTE.paper, "table-wrapper"));
    record.clutterParts.push(this.box(group, [0.16, 0.08, 0.16], [-0.42, 0.71, 0.16], PALETTE.coin, "table-cup"));
  }

  private addSeatProp(group: THREE.Group, record: SemanticPropRecord, meeting: boolean) {
    if (meeting) {
      this.box(group, [1.25, 0.04, 1.25], [0, 0.04, 0], "#dccb9c", "meeting-marker", 0.82);
      this.box(group, [0.16, 0.52, 0.16], [0, 0.28, 0], PALETTE.glow, "meeting-post");
      return;
    }
    this.box(group, [0.92, 0.18, 0.44], [0, 0.38, 0], PALETTE.wood, "seat");
    this.box(group, [0.92, 0.52, 0.12], [0, 0.68, 0.22], PALETTE.darkWood, "seat-back");
  }

  private addMailboxProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [0.12, 0.75, 0.12], [0, 0.38, 0], PALETTE.ink, "mail-post");
    this.box(group, [0.72, 0.34, 0.42], [0, 0.92, 0], PALETTE.civic, "mailbox");
    record.mailFlag = this.box(group, [0.08, 0.38, 0.26], [0.42, 1.04, 0], PALETTE.red, "mail-flag");
    record.goods.push(this.box(group, [0.42, 0.04, 0.24], [0, 1.14, -0.16], PALETTE.paper, "mail-envelope"));
  }

  private addRegisterProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [1.0, 0.5, 0.72], [0, 0.3, 0], PALETTE.wood, "checkout-counter");
    this.box(group, [0.38, 0.24, 0.3], [0.18, 0.7, -0.04], PALETTE.ink, "cash-register");
    this.box(group, [0.24, 0.08, 0.04], [0.18, 0.82, -0.22], PALETTE.glow, "register-screen");
    record.activeParts.push(this.box(group, [0.18, 0.035, 0.18], [-0.24, 0.64, -0.22], PALETTE.coin, "coin-a"));
    record.activeParts.push(this.box(group, [0.18, 0.035, 0.18], [-0.08, 0.68, -0.24], PALETTE.coin, "coin-b"));
  }

  private addShelfProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [0.95, 1.08, 0.24], [0, 0.62, 0], PALETTE.darkWood, "shelf-frame");
    for (let row = 0; row < 3; row += 1) {
      this.box(group, [0.92, 0.06, 0.28], [0, 0.32 + row * 0.32, -0.02], PALETTE.wood, `shelf-board-${row}`);
      for (let col = 0; col < 4; col += 1) {
        const color = [PALETTE.food, PALETTE.red, PALETTE.blue, PALETTE.coin][(row + col) % 4]!;
        record.goods.push(this.box(group, [0.14, 0.18, 0.16], [-0.33 + col * 0.22, 0.43 + row * 0.32, -0.13], color, `shelf-good-${row}-${col}`));
      }
    }
  }

  private addVendingProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [0.72, 1.34, 0.5], [0, 0.7, 0], "#6797b5", "vending-body");
    this.box(group, [0.34, 0.62, 0.04], [-0.11, 0.86, -0.27], "#bdddeb", "vending-window", 0.86);
    for (let i = 0; i < 4; i += 1) record.goods.push(this.box(group, [0.11, 0.11, 0.05], [0.28, 0.62 + i * 0.15, -0.29], PALETTE.glow, `vending-button-${i}`));
  }

  private addWorkbenchProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [1.1, 0.2, 0.82], [0, 0.58, 0], PALETTE.wood, "workbench-top");
    this.box(group, [0.18, 0.58, 0.18], [-0.42, 0.3, -0.28], PALETTE.darkWood, "workbench-leg-a");
    this.box(group, [0.18, 0.58, 0.18], [0.42, 0.3, 0.28], PALETTE.darkWood, "workbench-leg-b");
    record.activeParts.push(this.box(group, [0.32, 0.05, 0.08], [-0.22, 0.74, -0.08], PALETTE.ink, "tool-a"));
    record.activeParts.push(this.box(group, [0.08, 0.05, 0.34], [0.18, 0.75, 0.06], PALETTE.ink, "tool-b"));
    record.activeParts.push(this.box(group, [0.1, 0.1, 0.1], [0.36, 1.0, -0.2], PALETTE.glow, "work-spark"));
  }

  private addLockerProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [0.58, 1.32, 0.48], [0, 0.7, 0], "#7c8d98", "locker-body");
    this.box(group, [0.04, 1.14, 0.03], [0, 0.72, -0.26], PALETTE.ink, "locker-split");
    this.box(group, [0.08, 0.08, 0.04], [0.18, 0.86, -0.28], PALETTE.glow, "locker-handle");
  }

  private addMedicineProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [0.76, 1.05, 0.28], [0, 0.64, 0], PALETTE.white, "medicine-cabinet");
    this.box(group, [0.34, 0.34, 0.04], [0, 0.82, -0.16], PALETTE.health, "clinic-cross-panel");
    this.box(group, [0.08, 0.26, 0.05], [0, 0.82, -0.2], PALETTE.white, "clinic-cross-v");
    this.box(group, [0.24, 0.08, 0.05], [0, 0.82, -0.21], PALETTE.white, "clinic-cross-h");
    for (let i = 0; i < 6; i += 1) record.supply.push(this.box(group, [0.11, 0.24, 0.11], [-0.25 + i * 0.1, 0.28, -0.18], i % 2 === 0 ? PALETTE.health : PALETTE.blue, `medicine-${i}`));
  }

  private addDeskProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [1.0, 0.52, 0.68], [0, 0.32, 0], PALETTE.wood, "desk-body");
    this.box(group, [0.72, 0.04, 0.32], [0, 0.62, -0.12], PALETTE.paper, "desk-papers");
    this.box(group, [0.18, 0.22, 0.08], [0.34, 0.72, 0.08], PALETTE.ink, "desk-stamp");
  }

  private addNoticeBoardProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [1.12, 0.88, 0.12], [0, 0.88, 0], PALETTE.darkWood, "notice-board");
    const notes = [
      [-0.28, 0.98, -0.08, PALETTE.paper],
      [0.22, 0.92, -0.08, "#f4d88c"],
      [-0.06, 0.68, -0.08, "#d7ecf0"]
    ] as const;
    for (const [x, y, z, color] of notes) record.goods.push(this.box(group, [0.28, 0.22, 0.04], [x, y, z], color, "notice-paper"));
  }

  private addStorageProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [0.72, 0.48, 0.72], [-0.1, 0.28, 0.08], PALETTE.wood, "crate-a");
    this.box(group, [0.58, 0.42, 0.58], [0.24, 0.72, -0.18], PALETTE.darkWood, "crate-b");
  }

  private addConstructionProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [1.1, 0.05, 0.78], [0, 0.08, 0], PALETTE.paper, "blueprint");
    this.box(group, [0.8, 0.12, 0.2], [-0.1, 0.22, 0.34], PALETTE.wood, "board-stack-a");
    this.box(group, [0.2, 0.12, 0.8], [0.28, 0.38, 0.22], PALETTE.darkWood, "board-stack-b");
    record.activeParts.push(this.box(group, [0.14, 0.52, 0.14], [-0.5, 0.32, -0.34], PALETTE.glow, "survey-marker"));
  }

  private addPlanterProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [0.74, 0.28, 0.74], [0, 0.18, 0], PALETTE.soil, "planter-box");
    this.box(group, [0.58, 0.28, 0.58], [0, 0.46, 0], PALETTE.hedge, "planter-plant");
  }

  private addGenericProp(group: THREE.Group, record: SemanticPropRecord) {
    this.box(group, [0.72, 0.42, 0.72], [0, 0.26, 0], PALETTE.civic, "semantic-marker");
    this.box(group, [0.46, 0.08, 0.46], [0, 0.54, 0], PALETTE.paper, "semantic-topper");
    record.activeParts.push(this.box(group, [0.22, 0.12, 0.22], [0, 0.72, 0], PALETTE.glow, "semantic-active"));
  }

  private updatePropState(
    record: SemanticPropRecord,
    state: SemanticObjectState | undefined,
    targetedAgents: SimAgent[],
    activeAgents: SimAgent[],
    allAgents: SimAgent[],
    elapsed: number
  ) {
    const household = this.householdForRecord(record, allAgents);
    const capacity = state?.capacity ?? (record.goods.length || record.supply.length || 1);
    const stock = state?.stock ?? capacity;
    const stockRatio = capacity > 0 ? Math.max(0, Math.min(1, stock / capacity)) : 1;
    const visibleGoods = Math.ceil(record.goods.length * stockRatio);
    record.goods.forEach((object, index) => {
      object.visible = index < visibleGoods || !this.isStockSensitive(record.actionType);
    });
    const visibleSupply = Math.ceil(record.supply.length * stockRatio);
    record.supply.forEach((object, index) => {
      object.visible = index < visibleSupply;
    });

    const pantryRatio = household && household.pantryCapacity > 0 ? Math.max(0, Math.min(1, household.pantry / household.pantryCapacity)) : 1;
    const visiblePantryGoods = Math.ceil(record.householdGoods.length * pantryRatio);
    record.householdGoods.forEach((object, index) => {
      object.visible = !household || index < visiblePantryGoods;
    });
    if (record.emptyMarker) record.emptyMarker.visible = Boolean(household && household.pantry <= 0);

    const householdSupplyCapacity = household ? Math.max(1, household.supplyCapacity * 2) : 1;
    const householdSupplyRatio = household ? Math.max(0, Math.min(1, (household.toiletries + household.cleaningSupplies) / householdSupplyCapacity)) : 1;
    const visibleHouseholdSupplies = Math.ceil(record.householdSupplies.length * householdSupplyRatio);
    record.householdSupplies.forEach((object, index) => {
      object.visible = !household || index < visibleHouseholdSupplies;
    });

    const clutterRatio = household ? Math.max(0, Math.min(1, (household.clutter - 34) / 56)) : 0;
    const visibleClutter = Math.ceil(record.clutterParts.length * clutterRatio);
    record.clutterParts.forEach((object, index) => {
      object.visible = Boolean(household && index < visibleClutter);
    });

    const laundryRatio = household ? Math.max(0, Math.min(1, (household.laundry - 32) / 58)) : 0;
    const visibleLaundry = Math.ceil(record.laundryParts.length * laundryRatio);
    record.laundryParts.forEach((object, index) => {
      object.visible = Boolean(household && index < visibleLaundry);
    });

    if (record.comfortGlow) {
      record.comfortGlow.visible = Boolean(household && (household.homeComfort >= 66 || household.choresDoneToday > 0));
      const scale = 0.82 + Math.max(0, household?.homeComfort ?? 0) / 120 + Math.sin(elapsed * 3) * 0.035;
      record.comfortGlow.scale.set(scale, 1, scale);
    }

    if (record.sleepQualityOverlay) {
      record.sleepQualityOverlay.visible = Boolean(household && household.sleepQuality < 52);
      const pressure = household ? Math.max(0, 52 - household.sleepQuality) / 52 : 0;
      record.sleepQualityOverlay.scale.set(1 + pressure * 0.16, 1, 1 + pressure * 0.22);
    }

    const cleanliness = state?.cleanliness ?? 86;
    if (record.dirtyOverlay) {
      const householdDirt = household ? Math.max(0, household.clutter - 58) * 0.7 + Math.max(0, household.laundry - 74) * 0.35 : 0;
      const dirtPressure = Math.max(0, 72 - cleanliness) + householdDirt;
      record.dirtyOverlay.visible = dirtPressure > 0;
      record.dirtyOverlay.scale.setScalar(1 + Math.min(0.55, dirtPressure / 120));
    }
    if (record.wearOverlay) record.wearOverlay.visible = (state?.wear ?? 0) > 24;
    if (record.usedOverlay) {
      const tiredHome = Boolean(household && record.actionType === "bed" && household.sleepQuality < 62);
      record.usedOverlay.visible = ((state?.lastAction === "sleeping" || state?.lastAction === "healing" || (state?.usesToday ?? 0) > 0) && record.actionType.includes("bed")) || tiredHome;
      if (tiredHome) record.usedOverlay.scale.set(1 + Math.max(0, 62 - (household?.sleepQuality ?? 62)) / 180, 1, 1.04);
      else record.usedOverlay.scale.set(1, 1, 1);
    }
    if (record.mailFlag) record.mailFlag.visible = record.actionType === "mailbox" ? targetedAgents.some((agent) => agent.rentDue > 0 || agent.medicalDebt > 0) || state?.lastAction === "checking_mail" : true;

    const active = activeAgents.length > 0;
    record.activeParts.forEach((object, index) => {
      object.visible = active;
      object.position.y += Math.sin(elapsed * 7 + index) * 0.0015;
    });
    if (record.busyRing) {
      const crowdPressure = state?.crowdPressure ?? 0;
      record.busyRing.visible = targetedAgents.length > 0 || crowdPressure > 12;
      const scale = 1 + Math.sin(elapsed * 5) * 0.08 + Math.min(0.32, targetedAgents.length * 0.05) + Math.min(0.42, crowdPressure / 180);
      record.busyRing.scale.set(scale, scale, scale);
    }
    if (record.icon) {
      record.icon.visible = active;
      record.icon.position.y = 1.76 + Math.sin(elapsed * 4) * 0.08;
      record.icon.material = this.iconMaterial(this.iconForActionPoint(record.actionType, activeAgents[0]?.currentAction));
    }
  }

  private householdForRecord(record: SemanticPropRecord, agents: SimAgent[]): HouseholdAggregate | null {
    if (record.structureType !== "apartment" && record.structureType !== "house") return null;
    const residents = agents.filter((agent) => agent.home === record.structureName || agent.target?.structureId === record.structureId);
    if (residents.length === 0) return null;

    const sum = residents.reduce(
      (total, agent) => {
        total.pantry += agent.household.pantry;
        total.pantryCapacity += agent.household.pantryCapacity;
        total.toiletries += agent.household.toiletries;
        total.cleaningSupplies += agent.household.cleaningSupplies;
        total.supplyCapacity += agent.household.supplyCapacity;
        total.clutter += agent.household.clutter;
        total.laundry += agent.household.laundry;
        total.sleepQuality += agent.household.sleepQuality;
        total.homeComfort += agent.household.homeComfort;
        total.choresDoneToday += agent.household.choresDoneToday;
        return total;
      },
      {
        pantry: 0,
        pantryCapacity: 0,
        toiletries: 0,
        cleaningSupplies: 0,
        supplyCapacity: 0,
        clutter: 0,
        laundry: 0,
        sleepQuality: 0,
        homeComfort: 0,
        choresDoneToday: 0
      }
    );
    const count = residents.length;
    return {
      pantry: sum.pantry,
      pantryCapacity: Math.max(1, sum.pantryCapacity),
      toiletries: sum.toiletries,
      cleaningSupplies: sum.cleaningSupplies,
      supplyCapacity: Math.max(1, sum.supplyCapacity),
      clutter: sum.clutter / count,
      laundry: sum.laundry / count,
      sleepQuality: sum.sleepQuality / count,
      homeComfort: sum.homeComfort / count,
      choresDoneToday: sum.choresDoneToday
    };
  }

  private updateAgentIcons(agents: SimAgent[], elapsed: number) {
    const existingAgentSprites = new Set<string>();
    for (const agent of agents) {
      const id = `agent-icon:${agent.id}`;
      existingAgentSprites.add(id);
      let sprite = this.root.getObjectByName(id) as THREE.Sprite | undefined;
      if (!sprite) {
        sprite = this.iconSprite(agent.currentAction);
        sprite.name = id;
        this.root.add(sprite);
      }
      sprite.material = this.iconMaterial(agent.currentAction);
      sprite.visible = agent.currentAction !== "walking" && agent.currentAction !== "idle";
      sprite.position.set(agent.position.x, agent.position.y + 2.05 + Math.sin(elapsed * 4 + agent.id.length) * 0.1, agent.position.z);
      sprite.scale.setScalar(agent.currentAction === "socializing" ? 0.9 : 0.72);
    }

    for (const child of [...this.root.children]) {
      if (child.name.startsWith("agent-icon:") && !existingAgentSprites.has(child.name)) this.root.remove(child);
    }
  }

  private iconForPoint(type: ActionPointType): IconKind {
    switch (type) {
      case "shelf":
      case "fridge":
      case "vending_machine":
        return "stock";
      case "mailbox":
        return "mail";
      case "notice_board":
        return "notice";
      case "sink":
        return "clean";
      case "medicine_cabinet":
      case "clinic_bed":
        return "supply";
      case "register":
      case "counter":
        return "shopping";
      case "job_station":
      case "workbench":
        return "working";
      default:
        return "busy";
    }
  }

  private iconForActionPoint(type: ActionPointType, action?: SimAgent["currentAction"]): IconKind {
    if (action && action !== "walking" && action !== "idle") return action;
    return this.iconForPoint(type);
  }

  private isStockSensitive(type: ActionPointType) {
    return type === "shelf" || type === "fridge" || type === "vending_machine" || type === "medicine_cabinet" || type === "storage";
  }

  private stateKey(structureId: string, actionPointId: string) {
    return `${structureId}:${actionPointId}`;
  }

  private toneForStructure(structure: StructureMetadata): DioramaTone {
    switch (structure.type) {
      case "apartment":
      case "house":
        return "home";
      case "grocery":
      case "shop":
        return "food";
      case "workplace":
      case "workshop":
        return "work";
      case "clinic":
        return "health";
      case "police_station":
      case "guard_post":
        return "security";
      case "park":
        return "park";
      case "empty_lot":
        return "lot";
      default:
        return "civic";
    }
  }

  private edgeForPoint(structure: StructureMetadata, point: ActionPoint): CardinalEdge {
    const { footprint } = structure;
    if (point.position.x <= footprint.x) return "west";
    if (point.position.x >= footprint.x + footprint.width - 1) return "east";
    if (point.position.z >= footprint.z + footprint.depth - 1) return "south";
    return "north";
  }

  private outward(edge: CardinalEdge) {
    switch (edge) {
      case "south":
        return { x: 0, z: 1 };
      case "east":
        return { x: 1, z: 0 };
      case "west":
        return { x: -1, z: 0 };
      default:
        return { x: 0, z: -1 };
    }
  }

  private planter(parent: THREE.Group, x: number, y: number, z: number) {
    this.box(parent, [0.52, 0.22, 0.52], [x, y + 0.12, z], PALETTE.soil, "planter-pot");
    this.box(parent, [0.44, 0.38, 0.44], [x, y + 0.42, z], PALETTE.hedge, "planter-green");
  }

  private lamp(parent: THREE.Group, x: number, y: number, z: number) {
    this.box(parent, [0.12, 1.4, 0.12], [x, y + 0.7, z], PALETTE.ink, "streetlamp-post");
    this.box(parent, [0.42, 0.24, 0.42], [x, y + 1.46, z], PALETTE.glow, "streetlamp-light", 0.9);
    this.box(parent, [0.58, 0.08, 0.58], [x, y + 1.62, z], PALETTE.ink, "streetlamp-cap");
  }

  private ring(parent: THREE.Group, radius: number, position: readonly [number, number, number], color: string, name: string) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.72, radius, 32),
      this.material(color, 0.48, true)
    );
    mesh.name = name;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(position[0], position[1], position[2]);
    parent.add(mesh);
    return mesh;
  }

  private box(parent: THREE.Group, size: readonly [number, number, number], position: readonly [number, number, number], color: string, name: string, opacity = 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), this.material(color, opacity, opacity < 1));
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private iconSprite(kind: IconKind) {
    const sprite = new THREE.Sprite(this.iconMaterial(kind));
    sprite.scale.setScalar(0.72);
    return sprite;
  }

  private iconMaterial(kind: IconKind) {
    const existing = this.iconMaterials.get(kind);
    if (existing) return existing;
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create diorama icon.");
    ctx.clearRect(0, 0, 96, 96);
    ctx.fillStyle = "rgba(255, 246, 210, 0.92)";
    ctx.beginPath();
    ctx.arc(48, 48, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(40, 49, 58, 0.74)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = this.iconColor(kind);
    ctx.font = kind === "socializing" ? "bold 30px Arial" : "bold 42px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(iconForAction[kind], 48, 50);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    this.iconMaterials.set(kind, material);
    return material;
  }

  private iconColor(kind: IconKind) {
    switch (kind) {
      case "shopping":
      case "budgeting":
      case "paying_rent":
        return PALETTE.coin;
      case "eating":
      case "stock":
        return PALETTE.food;
      case "working":
      case "building":
        return PALETTE.work;
      case "washing":
      case "clean":
        return PALETTE.blue;
      case "healing":
      case "hospitalized":
      case "supply":
        return PALETTE.health;
      case "socializing":
        return PALETTE.red;
      case "checking_mail":
      case "mail":
      case "notice":
        return PALETTE.civic;
      default:
        return PALETTE.ink;
    }
  }

  private material(color: string, opacity = 1, transparent = false) {
    const key = `${color}:${opacity}:${transparent}`;
    const existing = this.materialCache.get(key);
    if (existing) return existing;
    const material = new THREE.MeshLambertMaterial({
      color,
      transparent: transparent || opacity < 1,
      opacity,
      depthWrite: opacity >= 0.72
    });
    this.materialCache.set(key, material);
    return material;
  }

  private clearObjects() {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      child.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
        if (object instanceof THREE.Sprite) {
          // Icon materials are cached and disposed with the layer.
          return;
        }
      });
    }
    this.tempVector.set(0, 0, 0);
  }
}
