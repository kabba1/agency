export const enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Water = 5,
  Wood = 6,
  Leaves = 7,
  Planks = 8,
  Glass = 9,
  Brick = 10,
  Road = 11,
  Roof = 12,
  Light = 13,
  Door = 14,
  Window = 15,
  Fence = 16,
  Storage = 17,
  Bed = 18,
  Counter = 19,
  Workbench = 20,
  Sign = 21,
  Floor = 22,
  StoneSlab = 23,
  WoodSlab = 24,
  StoneStairs = 25,
  WoodStairs = 26
}

export type BlockCategory = "terrain" | "structure" | "utility" | "furniture";
export type BlockShape =
  | "cube"
  | "slab"
  | "stairs"
  | "door"
  | "pane"
  | "fence"
  | "storage"
  | "bed"
  | "counter"
  | "workbench"
  | "sign"
  | "light";

export type BlockDefinition = {
  id: BlockId;
  name: string;
  color: string;
  solid: boolean;
  transparent: boolean;
  editable: boolean;
  category: BlockCategory;
  description: string;
  shape: BlockShape;
  rotatable: boolean;
};

export const BLOCKS: Record<BlockId, BlockDefinition> = {
  [BlockId.Air]: {
    id: BlockId.Air,
    name: "Air",
    color: "#000000",
    solid: false,
    transparent: true,
    editable: true,
    category: "terrain",
    description: "Empty space.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Grass]: {
    id: BlockId.Grass,
    name: "Grass",
    color: "#86bf6e",
    solid: true,
    transparent: false,
    editable: true,
    category: "terrain",
    description: "Natural surface block.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Dirt]: {
    id: BlockId.Dirt,
    name: "Dirt",
    color: "#9b7052",
    solid: true,
    transparent: false,
    editable: true,
    category: "terrain",
    description: "Earth fill and terrain shaping.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Stone]: {
    id: BlockId.Stone,
    name: "Stone",
    color: "#8c9797",
    solid: true,
    transparent: false,
    editable: true,
    category: "terrain",
    description: "Rock, foundations, and retaining walls.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Sand]: {
    id: BlockId.Sand,
    name: "Sand",
    color: "#e1c878",
    solid: true,
    transparent: false,
    editable: true,
    category: "terrain",
    description: "Paths, beaches, and soft ground.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Water]: {
    id: BlockId.Water,
    name: "Water",
    color: "#8ac7e5",
    solid: false,
    transparent: true,
    editable: true,
    category: "terrain",
    description: "Non-solid water volume.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Wood]: {
    id: BlockId.Wood,
    name: "Wood",
    color: "#a87945",
    solid: true,
    transparent: false,
    editable: true,
    category: "structure",
    description: "Logs, posts, and beams.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Leaves]: {
    id: BlockId.Leaves,
    name: "Leaves",
    color: "#68a85d",
    solid: true,
    transparent: true,
    editable: true,
    category: "terrain",
    description: "Tree canopy and greenery.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Planks]: {
    id: BlockId.Planks,
    name: "Planks",
    color: "#bd8b54",
    solid: true,
    transparent: false,
    editable: true,
    category: "structure",
    description: "Wood wall and floor material.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Glass]: {
    id: BlockId.Glass,
    name: "Glass",
    color: "#a7d7df",
    solid: true,
    transparent: true,
    editable: true,
    category: "structure",
    description: "Transparent building block.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Brick]: {
    id: BlockId.Brick,
    name: "Brick",
    color: "#d58f77",
    solid: true,
    transparent: false,
    editable: true,
    category: "structure",
    description: "Town walls, chimneys, and masonry.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Road]: {
    id: BlockId.Road,
    name: "Road",
    color: "#58656b",
    solid: true,
    transparent: false,
    editable: true,
    category: "structure",
    description: "Street and paved path surface.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Roof]: {
    id: BlockId.Roof,
    name: "Roof",
    color: "#b85d5a",
    solid: true,
    transparent: false,
    editable: true,
    category: "structure",
    description: "Roofing material.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.Light]: {
    id: BlockId.Light,
    name: "Light",
    color: "#ffdf79",
    solid: true,
    transparent: true,
    editable: true,
    category: "utility",
    description: "Lamp placeholder for future lighting.",
    shape: "light",
    rotatable: false
  },
  [BlockId.Door]: {
    id: BlockId.Door,
    name: "Door",
    color: "#9b6840",
    solid: true,
    transparent: false,
    editable: true,
    category: "utility",
    description: "Thin door panel.",
    shape: "door",
    rotatable: true
  },
  [BlockId.Window]: {
    id: BlockId.Window,
    name: "Window",
    color: "#a7d7df",
    solid: true,
    transparent: true,
    editable: true,
    category: "utility",
    description: "Thin glass window pane.",
    shape: "pane",
    rotatable: true
  },
  [BlockId.Fence]: {
    id: BlockId.Fence,
    name: "Fence",
    color: "#9b7144",
    solid: true,
    transparent: true,
    editable: true,
    category: "utility",
    description: "Fence post and rails.",
    shape: "fence",
    rotatable: true
  },
  [BlockId.Storage]: {
    id: BlockId.Storage,
    name: "Storage",
    color: "#a87945",
    solid: true,
    transparent: false,
    editable: true,
    category: "utility",
    description: "Crate/chest storage block.",
    shape: "storage",
    rotatable: true
  },
  [BlockId.Bed]: {
    id: BlockId.Bed,
    name: "Bed",
    color: "#de817f",
    solid: true,
    transparent: false,
    editable: true,
    category: "furniture",
    description: "Low bed block.",
    shape: "bed",
    rotatable: true
  },
  [BlockId.Counter]: {
    id: BlockId.Counter,
    name: "Counter",
    color: "#b98b58",
    solid: true,
    transparent: false,
    editable: true,
    category: "furniture",
    description: "Waist-high shop counter.",
    shape: "counter",
    rotatable: true
  },
  [BlockId.Workbench]: {
    id: BlockId.Workbench,
    name: "Workbench",
    color: "#9f7648",
    solid: true,
    transparent: false,
    editable: true,
    category: "utility",
    description: "Workbench block.",
    shape: "workbench",
    rotatable: true
  },
  [BlockId.Sign]: {
    id: BlockId.Sign,
    name: "Sign",
    color: "#d9b56c",
    solid: true,
    transparent: false,
    editable: true,
    category: "utility",
    description: "Thin sign board.",
    shape: "sign",
    rotatable: true
  },
  [BlockId.Floor]: {
    id: BlockId.Floor,
    name: "Floor",
    color: "#d0bb8f",
    solid: true,
    transparent: false,
    editable: true,
    category: "structure",
    description: "Interior flooring.",
    shape: "cube",
    rotatable: false
  },
  [BlockId.StoneSlab]: {
    id: BlockId.StoneSlab,
    name: "Stone Slab",
    color: "#8c9797",
    solid: true,
    transparent: false,
    editable: true,
    category: "structure",
    description: "Half-height stone building piece.",
    shape: "slab",
    rotatable: false
  },
  [BlockId.WoodSlab]: {
    id: BlockId.WoodSlab,
    name: "Wood Slab",
    color: "#bd8b54",
    solid: true,
    transparent: false,
    editable: true,
    category: "structure",
    description: "Half-height wood building piece.",
    shape: "slab",
    rotatable: false
  },
  [BlockId.StoneStairs]: {
    id: BlockId.StoneStairs,
    name: "Stone Stairs",
    color: "#8c9797",
    solid: true,
    transparent: false,
    editable: true,
    category: "structure",
    description: "Two-step stone stair block.",
    shape: "stairs",
    rotatable: true
  },
  [BlockId.WoodStairs]: {
    id: BlockId.WoodStairs,
    name: "Wood Stairs",
    color: "#bd8b54",
    solid: true,
    transparent: false,
    editable: true,
    category: "structure",
    description: "Two-step wood stair block.",
    shape: "stairs",
    rotatable: true
  }
};

export const BLOCK_IDS = Object.keys(BLOCKS)
  .map(Number)
  .filter((id) => id !== BlockId.Air) as BlockId[];

export const isKnownBlockId = (id: number): id is BlockId => Number.isInteger(id) && id in BLOCKS;
export const isSolidBlock = (id: BlockId) => BLOCKS[id].solid;
export const isRenderableBlock = (id: BlockId) => id !== BlockId.Air;
export const isRotatableBlock = (id: BlockId) => BLOCKS[id].rotatable;
