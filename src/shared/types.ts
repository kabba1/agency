import type { BlockId } from "../world/blocks";
import type { BlockHalf } from "../world/BlockShapes";

export type Vec3i = { x: number; y: number; z: number };

export type StructureType =
  | "apartment"
  | "grocery"
  | "workplace"
  | "house"
  | "shop"
  | "farm"
  | "storage"
  | "well"
  | "road"
  | "empty_lot"
  | "clinic"
  | "workshop"
  | "guard_post"
  | "police_station"
  | "town_hall"
  | "park";

export type ActionPointType =
  | "door"
  | "home_anchor"
  | "bed"
  | "fridge"
  | "sink"
  | "dining_spot"
  | "seat"
  | "mailbox"
  | "counter"
  | "register"
  | "shelf"
  | "vending_machine"
  | "job_station"
  | "break_spot"
  | "locker"
  | "clinic_bed"
  | "medicine_cabinet"
  | "desk"
  | "notice_board"
  | "workbench"
  | "storage"
  | "water_source"
  | "crop_plot"
  | "meeting_spot"
  | "construction_anchor";

export type ActionPoint = {
  id: string;
  type: ActionPointType;
  position: Vec3i;
  label: string;
};

export type StructureHours = {
  label: string;
  opensAt: number;
  closesAt: number;
  actionTypes?: ActionPointType[];
};

export type StructureRule = {
  id: string;
  label: string;
  value?: string | number | boolean;
};

export type StructureInventoryItem = {
  id: string;
  label: string;
  quantity: number;
  price?: number;
};

export type StructureMetadata = {
  id: string;
  type: StructureType;
  name: string;
  seed: string;
  origin: Vec3i;
  footprint: { x: number; z: number; width: number; depth: number; minY: number; maxY: number };
  entrancePoints: Vec3i[];
  actionPoints: ActionPoint[];
  ownerId?: string;
  publicAccess: boolean;
  jobs?: Array<{ id: string; title: string }>;
  services?: Array<{ id: string; label: string }>;
  inventorySlots?: Array<{ id: string; label: string; capacity: number }>;
  inventory?: StructureInventoryItem[];
  rules?: StructureRule[];
  hours?: StructureHours[];
  rent?: { pricePerDay: number; currency: string; ownerId?: string };
  tags: string[];
};

export type WorldBoundsConfig = {
  initialRadiusChunks: number;
  maxRadiusChunks: number;
  expansionLevel: number;
  expansionMode: "locked" | "admin" | "milestone";
  widthBlocks?: number;
  depthBlocks?: number;
};

export type FlatWorldLayer = {
  block: BlockId;
  depth: number;
};

export type FlatWorldOptions = {
  widthBlocks: number;
  depthBlocks: number;
  roadWidth: number;
  laneWidth: number;
  layers: FlatWorldLayer[];
  minPlotSize?: number;
  maxPlotSize?: number;
};

export type WorldGenerationConfig = {
  kind: "flat";
  options: FlatWorldOptions;
};

export type CityPlot = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  area: number;
  price: number;
  roadEdges: Array<"north" | "east" | "south" | "west">;
  zoning: "residential" | "commercial" | "civic" | "mixed";
};

export type CityRoad = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  axis: "x" | "z";
  kind: "main" | "lane";
};

export type CityMapMetadata = {
  widthBlocks: number;
  depthBlocks: number;
  roadWidth: number;
  laneWidth: number;
  surfaceY: number;
  plots: CityPlot[];
  roads: CityRoad[];
};

export type EditPatchEntry = {
  x: number;
  y: number;
  z: number;
  block: BlockId;
  rotation?: number;
  half?: BlockHalf;
};
