import { BlockId } from "./blocks";

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 48;
export const SEA_LEVEL = 16;

export class Chunk {
  readonly blocks = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);

  constructor(
    readonly cx: number,
    readonly cz: number
  ) {}

  private index(x: number, y: number, z: number) {
    return y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x;
  }

  inBounds(x: number, y: number, z: number) {
    return x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y >= 0 && y < WORLD_HEIGHT;
  }

  getLocal(x: number, y: number, z: number): BlockId {
    if (!this.inBounds(x, y, z)) return BlockId.Air;
    return this.blocks[this.index(x, y, z)] as BlockId;
  }

  setLocal(x: number, y: number, z: number, block: BlockId) {
    if (!this.inBounds(x, y, z)) return;
    this.blocks[this.index(x, y, z)] = block;
  }
}

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;
export const worldToChunk = (value: number) => Math.floor(value / CHUNK_SIZE);
export const worldToLocal = (value: number) => ((value % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
