import type { WorldBoundsConfig } from "../shared/types";
import { CHUNK_SIZE } from "./Chunk";

export const WORLD_BOUNDS: WorldBoundsConfig = {
  initialRadiusChunks: 3,
  maxRadiusChunks: 8,
  expansionLevel: 0,
  expansionMode: "locked"
};

export const worldLimitBlocks = (config = WORLD_BOUNDS) => config.initialRadiusChunks * CHUNK_SIZE;

export const worldHalfExtents = (config = WORLD_BOUNDS) => {
  const fallback = worldLimitBlocks(config);
  return {
    x: Math.max(CHUNK_SIZE, Math.floor((config.widthBlocks ?? fallback * 2) / 2)),
    z: Math.max(CHUNK_SIZE, Math.floor((config.depthBlocks ?? fallback * 2) / 2))
  };
};

export const isInsideWorldBounds = (x: number, z: number, config = WORLD_BOUNDS) => {
  const half = worldHalfExtents(config);
  return x >= -half.x && x < half.x && z >= -half.z && z < half.z;
};

export const distanceToWorldEdge = (x: number, z: number, config = WORLD_BOUNDS) => {
  const half = worldHalfExtents(config);
  return Math.min(x + half.x, half.x - 1 - x, z + half.z, half.z - 1 - z);
};
