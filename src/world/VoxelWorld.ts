import { BlockId, isKnownBlockId, isSolidBlock } from "./blocks";
import {
  getBlockBoxes,
  normalizeBlockState,
  normalizeRotation,
  type BlockHalf,
  type BlockState,
  type ShapeBox,
  type StairShape
} from "./BlockShapes";
import { CHUNK_SIZE, chunkKey, Chunk, worldToChunk, worldToLocal } from "./Chunk";
import { FlatWorldGenerator, normalizeFlatWorldOptions } from "./FlatWorldGenerator";
import { WORLD_BOUNDS, isInsideWorldBounds, worldHalfExtents } from "./WorldBounds";
import { EditPatch } from "./SaveLoad";
import { StructureRegistry } from "../structures/StructureMetadata";
import { generateGenesisDistrict } from "../structures/GenesisDistrict";
import type { CityMapMetadata, EditPatchEntry, StructureMetadata, WorldBoundsConfig, WorldGenerationConfig } from "../shared/types";

export type WorldStats = {
  seed: string;
  chunks: number;
  blocks: number;
  solidSurfaceBlocks: number;
  spawnHeight: number;
};

type SetBlockOptions = {
  savePatch?: boolean;
};

type VoxelWorldOptions = {
  loadSavedEdits?: boolean;
  generation?: WorldGenerationConfig;
};

export class VoxelWorld {
  readonly generator: FlatWorldGenerator;
  readonly generation: WorldGenerationConfig;
  readonly chunks = new Map<string, Chunk>();
  readonly blockStates = new Map<string, BlockState>();
  readonly structures = new StructureRegistry();
  readonly bounds: WorldBoundsConfig;
  readonly patch: EditPatch;
  readonly spawn = { x: 0, y: 24, z: 0 };
  readonly cityMap: CityMapMetadata;

  constructor(readonly seed: string, options: VoxelWorldOptions = {}) {
    const flatOptions = normalizeFlatWorldOptions(options.generation?.options);
    this.generation = { kind: "flat", options: flatOptions };
    this.generator = new FlatWorldGenerator(seed, flatOptions);
    this.cityMap = this.generator.cityMap;
    this.spawn.x = this.generator.spawn.x;
    this.spawn.z = this.generator.spawn.z;
    this.bounds = {
      ...WORLD_BOUNDS,
      widthBlocks: flatOptions.widthBlocks,
      depthBlocks: flatOptions.depthBlocks,
      initialRadiusChunks: Math.ceil(Math.max(flatOptions.widthBlocks, flatOptions.depthBlocks) / CHUNK_SIZE / 2)
    };
    this.patch = EditPatch.load(this.patchKey());
    this.generateInitialChunks();
    generateGenesisDistrict(this);
    if (options.loadSavedEdits ?? true) this.applySavedPatch();
    this.spawn.y = this.generator.heightAt() + 3;
  }

  private generateInitialChunks() {
    const half = worldHalfExtents(this.bounds);
    const minCx = worldToChunk(-half.x);
    const maxCx = worldToChunk(half.x - 1);
    const minCz = worldToChunk(-half.z);
    const maxCz = worldToChunk(half.z - 1);
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cz = minCz; cz <= maxCz; cz += 1) {
        const chunk = this.generator.generateChunk(cx, cz);
        this.chunks.set(chunkKey(cx, cz), chunk);
      }
    }
  }

  getChunk(cx: number, cz: number) {
    return this.chunks.get(chunkKey(cx, cz)) ?? null;
  }

  getBlock(x: number, y: number, z: number): BlockId {
    const blockX = Math.floor(x);
    const blockY = Math.floor(y);
    const blockZ = Math.floor(z);
    if (!isInsideWorldBounds(blockX, blockZ, this.bounds)) return BlockId.Air;
    const chunk = this.getChunk(worldToChunk(blockX), worldToChunk(blockZ));
    if (!chunk) return BlockId.Air;
    return chunk.getLocal(worldToLocal(blockX), blockY, worldToLocal(blockZ));
  }

  setBlock(x: number, y: number, z: number, block: BlockId, state: Partial<BlockState> = {}, options: SetBlockOptions = {}) {
    return this.setBlockInternal(x, y, z, block, true, state, options.savePatch ?? true);
  }

  setGeneratedBlock(x: number, y: number, z: number, block: BlockId, state: Partial<BlockState> = {}) {
    return this.setBlockInternal(x, y, z, block, false, state);
  }

  clearEditAndSetBlock(x: number, y: number, z: number, block: BlockId, state: Partial<BlockState> = {}, options: SetBlockOptions = {}) {
    const changed = this.setBlockInternal(x, y, z, block, false, state, options.savePatch ?? true);
    if (changed) {
      this.patch.delete(Math.floor(x), Math.floor(y), Math.floor(z));
      if (options.savePatch ?? true) this.patch.save();
    }
    return changed;
  }

  savePatch() {
    this.patch.save();
  }

  private setBlockInternal(x: number, y: number, z: number, block: BlockId, trackPatch: boolean, state: Partial<BlockState> = {}, savePatch = true) {
    const blockX = Math.floor(x);
    const blockY = Math.floor(y);
    const blockZ = Math.floor(z);
    if (!isInsideWorldBounds(blockX, blockZ, this.bounds)) return false;
    const chunk = this.getChunk(worldToChunk(blockX), worldToChunk(blockZ));
    if (!chunk) return false;
    if (blockY < 0 || blockY >= chunk.blocks.length / (CHUNK_SIZE * CHUNK_SIZE)) return false;
    chunk.setLocal(worldToLocal(blockX), blockY, worldToLocal(blockZ), block);
    const key = this.coordKey(blockX, blockY, blockZ);
    const normalizedState = normalizeBlockState(block, state);
    if (block === BlockId.Air || (normalizedState.rotation === 0 && normalizedState.half === "bottom")) {
      this.blockStates.delete(key);
    } else {
      this.blockStates.set(key, normalizedState);
    }
    if (trackPatch) {
      this.patch.set(blockX, blockY, blockZ, block, normalizedState);
      if (savePatch) this.patch.save();
    }
    return true;
  }

  isSolidAt(x: number, y: number, z: number) {
    return isSolidBlock(this.getBlock(x, y, z));
  }

  getBlockState(x: number, y: number, z: number): BlockState {
    const blockX = Math.floor(x);
    const blockY = Math.floor(y);
    const blockZ = Math.floor(z);
    const block = this.getBlock(blockX, blockY, blockZ);
    const state = this.getStoredBlockState(blockX, blockY, blockZ, block);
    if (block !== BlockId.StoneStairs && block !== BlockId.WoodStairs) return state;
    return { ...state, stairShape: this.resolveStairShape(blockX, blockY, blockZ, state) };
  }

  getCollisionBoxesAt(x: number, y: number, z: number): ShapeBox[] {
    const blockX = Math.floor(x);
    const blockY = Math.floor(y);
    const blockZ = Math.floor(z);
    const block = this.getBlock(blockX, blockY, blockZ);
    if (!isSolidBlock(block)) return [];
    return getBlockBoxes(block, this.getBlockState(blockX, blockY, blockZ));
  }

  findStructureAt(x: number, y: number, z: number): StructureMetadata | null {
    return this.structures.findByBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  resetEdits() {
    this.patch.clear();
    this.blockStates.clear();
  }

  replaceEdits(entries: EditPatchEntry[]) {
    this.patch.clear();
    for (const entry of entries) {
      if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y) || !Number.isFinite(entry.z) || !isKnownBlockId(entry.block)) continue;
      this.setBlockInternal(entry.x, entry.y, entry.z, entry.block, true, { rotation: entry.rotation, half: entry.half });
    }
  }

  private applySavedPatch() {
    for (const entry of this.patch.values()) {
      this.setBlockInternal(entry.x, entry.y, entry.z, entry.block, false, { rotation: entry.rotation, half: entry.half });
    }
  }

  private getStoredBlockState(x: number, y: number, z: number, block = this.getBlock(x, y, z)) {
    return normalizeBlockState(block, this.blockStates.get(this.coordKey(Math.floor(x), Math.floor(y), Math.floor(z))));
  }

  private resolveStairShape(x: number, y: number, z: number, state: BlockState): StairShape {
    const back = this.stairBackDirection(state.rotation);
    const front = { x: -back.x, z: -back.z };
    const frontStair = this.neighborStairState(x + front.x, y, z + front.z, state.half);
    const frontTurn = frontStair ? this.perpendicularTurn(state.rotation, frontStair.rotation) : 0;
    if (frontTurn === 1) return "outer_left";
    if (frontTurn === -1) return "outer_right";

    const backStair = this.neighborStairState(x + back.x, y, z + back.z, state.half);
    const backTurn = backStair ? this.perpendicularTurn(state.rotation, backStair.rotation) : 0;
    if (backTurn === 1) return "inner_left";
    if (backTurn === -1) return "inner_right";

    return "straight";
  }

  private neighborStairState(x: number, y: number, z: number, half: BlockHalf) {
    const block = this.getBlock(x, y, z);
    if (block !== BlockId.StoneStairs && block !== BlockId.WoodStairs) return null;
    const state = this.getStoredBlockState(x, y, z, block);
    return state.half === half ? state : null;
  }

  private perpendicularTurn(rotation: number, neighborRotation: number) {
    const turn = normalizeRotation(neighborRotation - rotation);
    if (turn === 1) return 1;
    if (turn === 3) return -1;
    return 0;
  }

  private stairBackDirection(rotation: number) {
    switch (normalizeRotation(rotation)) {
      case 1:
        return { x: -1, z: 0 };
      case 2:
        return { x: 0, z: -1 };
      case 3:
        return { x: 1, z: 0 };
      default:
        return { x: 0, z: 1 };
    }
  }

  private coordKey(x: number, y: number, z: number) {
    return `${x},${y},${z}`;
  }

  getStats(): WorldStats {
    let blocks = 0;
    let solidSurfaceBlocks = 0;
    for (const chunk of this.chunks.values()) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
          for (let y = 0; y < chunk.blocks.length / (CHUNK_SIZE * CHUNK_SIZE); y += 1) {
            const block = chunk.getLocal(lx, y, lz);
            if (block === BlockId.Air) continue;
            blocks += 1;
            if (chunk.getLocal(lx, y + 1, lz) === BlockId.Air) solidSurfaceBlocks += 1;
          }
        }
      }
    }

    return {
      seed: this.seed,
      chunks: this.chunks.size,
      blocks,
      solidSurfaceBlocks,
      spawnHeight: this.spawn.y
    };
  }

  private patchKey() {
    const { widthBlocks, depthBlocks, roadWidth, laneWidth, layers } = this.generation.options;
    const layerKey = layers.map((layer) => `${layer.block}x${layer.depth}`).join("-");
    return `${this.seed}:flat:${widthBlocks}x${depthBlocks}:r${roadWidth}:l${laneWidth ?? 3}:${layerKey}`;
  }
}
