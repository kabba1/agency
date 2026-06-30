import { BLOCKS, BlockId } from "./blocks";

export type BlockHalf = "bottom" | "top";
export type StairShape = "straight" | "inner_left" | "inner_right" | "outer_left" | "outer_right";

export type BlockState = {
  rotation: number;
  half: BlockHalf;
  stairShape: StairShape;
};

export type ShapeBox = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): ShapeBox => ({
  minX,
  minY,
  minZ,
  maxX,
  maxY,
  maxZ
});

const FULL = [box(0, 0, 0, 1, 1, 1)];
const NONE: ShapeBox[] = [];

export const normalizeRotation = (rotation = 0) => ((Math.round(rotation) % 4) + 4) % 4;
export const normalizeBlockHalf = (half?: string): BlockHalf => (half === "top" ? "top" : "bottom");
export const normalizeStairShape = (shape?: string): StairShape =>
  shape === "inner_left" || shape === "inner_right" || shape === "outer_left" || shape === "outer_right" ? shape : "straight";
export const usesHalfBlockState = (block: BlockId) => BLOCKS[block].shape === "slab" || BLOCKS[block].shape === "stairs";
export const normalizeBlockState = (block: BlockId, state: Partial<BlockState> = {}): BlockState => ({
  rotation: BLOCKS[block].rotatable ? normalizeRotation(state.rotation) : 0,
  half: usesHalfBlockState(block) ? normalizeBlockHalf(state.half) : "bottom",
  stairShape: BLOCKS[block].shape === "stairs" ? normalizeStairShape(state.stairShape) : "straight"
});

const rotateBox = (source: ShapeBox, rotation: number): ShapeBox => {
  switch (normalizeRotation(rotation)) {
    case 1:
      return box(1 - source.maxZ, source.minY, source.minX, 1 - source.minZ, source.maxY, source.maxX);
    case 2:
      return box(1 - source.maxX, source.minY, 1 - source.maxZ, 1 - source.minX, source.maxY, 1 - source.minZ);
    case 3:
      return box(source.minZ, source.minY, 1 - source.maxX, source.maxZ, source.maxY, 1 - source.minX);
    default:
      return source;
  }
};

const rotateBoxes = (boxes: ShapeBox[], rotation: number) => boxes.map((source) => rotateBox(source, rotation));

const stairCornerBoxes = (shape: StairShape, minY: number, maxY: number) => {
  switch (shape) {
    case "outer_left":
      return [box(0, minY, 0.5, 0.5, maxY, 1)];
    case "outer_right":
      return [box(0.5, minY, 0.5, 1, maxY, 1)];
    case "inner_left":
      return [box(0, minY, 0.5, 1, maxY, 1), box(0, minY, 0, 0.5, maxY, 0.5)];
    case "inner_right":
      return [box(0, minY, 0.5, 1, maxY, 1), box(0.5, minY, 0, 1, maxY, 0.5)];
    default:
      return [box(0, minY, 0.5, 1, maxY, 1)];
  }
};

const stairBoxes = (state: BlockState) => {
  if (state.half === "top") {
    return [box(0, 0.5, 0, 1, 1, 1), ...stairCornerBoxes(state.stairShape, 0, 0.5)];
  }
  return [box(0, 0, 0, 1, 0.5, 1), ...stairCornerBoxes(state.stairShape, 0.5, 1)];
};

const doorBoxes = () => [box(0.42, 0, 0.04, 0.58, 1, 0.96), box(0.58, 0.46, 0.42, 0.66, 0.58, 0.58)];

const windowBoxes = () => [
  box(0.46, 0.08, 0.08, 0.54, 0.92, 0.92),
  box(0.4, 0, 0, 0.6, 0.12, 1),
  box(0.4, 0.88, 0, 0.6, 1, 1),
  box(0.4, 0, 0, 0.6, 1, 0.12),
  box(0.4, 0, 0.88, 0.6, 1, 1),
  box(0.39, 0.46, 0, 0.61, 0.54, 1)
];

const fenceBoxes = () => [
  box(0.34, 0, 0.34, 0.66, 1, 0.66),
  box(0.42, 0.34, 0, 0.58, 0.52, 1),
  box(0.42, 0.68, 0, 0.58, 0.86, 1),
  box(0, 0.34, 0.42, 1, 0.52, 0.58),
  box(0, 0.68, 0.42, 1, 0.86, 0.58)
];

const storageBoxes = () => [
  box(0.08, 0, 0.1, 0.92, 0.58, 0.9),
  box(0.04, 0.58, 0.06, 0.96, 0.78, 0.94),
  box(0.4, 0.32, 0.02, 0.6, 0.52, 0.12)
];

const bedBoxes = () => [
  box(0.08, 0, 0.1, 0.22, 0.18, 0.24),
  box(0.78, 0, 0.1, 0.92, 0.18, 0.24),
  box(0.08, 0, 0.76, 0.22, 0.18, 0.9),
  box(0.78, 0, 0.76, 0.92, 0.18, 0.9),
  box(0.04, 0.18, 0.06, 0.96, 0.3, 0.94),
  box(0.08, 0.3, 0.1, 0.92, 0.46, 0.9),
  box(0.16, 0.46, 0.64, 0.84, 0.6, 0.88)
];

const counterBoxes = () => [
  box(0.08, 0, 0.12, 0.92, 0.62, 0.9),
  box(0, 0.62, 0, 1, 0.78, 1),
  box(0.04, 0.78, 0.78, 0.96, 0.96, 0.96)
];

const workbenchBoxes = () => [
  box(0.08, 0, 0.08, 0.24, 0.62, 0.24),
  box(0.76, 0, 0.08, 0.92, 0.62, 0.24),
  box(0.08, 0, 0.76, 0.24, 0.62, 0.92),
  box(0.76, 0, 0.76, 0.92, 0.62, 0.92),
  box(0.16, 0.28, 0.16, 0.84, 0.42, 0.84),
  box(0.04, 0.62, 0.04, 0.96, 0.82, 0.96),
  box(0.16, 0.82, 0.76, 0.84, 1, 0.9)
];

const signBoxes = () => [box(0.46, 0, 0.46, 0.54, 0.58, 0.54), box(0.14, 0.48, 0.38, 0.86, 0.86, 0.62)];

const lightBoxes = () => [
  box(0.36, 0, 0.36, 0.64, 0.16, 0.64),
  box(0.46, 0.16, 0.46, 0.54, 0.7, 0.54),
  box(0.28, 0.66, 0.28, 0.72, 1, 0.72)
];

export const getBlockBoxes = (block: BlockId, state: Partial<BlockState> = {}): ShapeBox[] => {
  if (block === BlockId.Air || block === BlockId.Water) return NONE;
  const normalized = normalizeBlockState(block, state);
  const rotation = normalized.rotation;

  switch (BLOCKS[block].shape) {
    case "slab":
      return normalized.half === "top" ? [box(0, 0.5, 0, 1, 1, 1)] : [box(0, 0, 0, 1, 0.5, 1)];
    case "stairs":
      return rotateBoxes(stairBoxes(normalized), rotation);
    case "door":
      return rotateBoxes(doorBoxes(), rotation);
    case "pane":
      return rotateBoxes(windowBoxes(), rotation);
    case "fence":
      return rotateBoxes(fenceBoxes(), rotation);
    case "storage":
      return rotateBoxes(storageBoxes(), rotation);
    case "bed":
      return rotateBoxes(bedBoxes(), rotation);
    case "counter":
      return rotateBoxes(counterBoxes(), rotation);
    case "workbench":
      return rotateBoxes(workbenchBoxes(), rotation);
    case "sign":
      return rotateBoxes(signBoxes(), rotation);
    case "light":
      return lightBoxes();
    default:
      return FULL;
  }
};

export const isFullCubeBlock = (block: BlockId) => {
  if (block === BlockId.Air || block === BlockId.Water) return false;
  return BLOCKS[block].shape === "cube";
};
