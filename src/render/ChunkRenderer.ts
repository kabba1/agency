import * as THREE from "three";
import { BLOCKS, BlockId, isRenderableBlock } from "../world/blocks";
import { getBlockBoxes, isFullCubeBlock, type ShapeBox } from "../world/BlockShapes";
import { CHUNK_SIZE, Chunk, worldToChunk, worldToLocal, WORLD_HEIGHT } from "../world/Chunk";
import { VoxelWorld } from "../world/VoxelWorld";
import { isInsideWorldBounds } from "../world/WorldBounds";
import type { StructureMetadata } from "../shared/types";
import { blockFaceTiles, createTextureAtlas, type AtlasTile, type TextureAtlas } from "./TextureAtlas";

type RenderBucket = "opaque" | "water" | "transparent";

type Face = {
  normal: readonly [number, number, number];
  corners: readonly (readonly [number, number, number])[];
  tileIndex: number;
};

type BoxFace = {
  normal: readonly [number, number, number];
  corners: (box: ShapeBox) => readonly (readonly [number, number, number])[];
  tileIndex: number;
};

type MeshData = {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
};

type RenderRegion = {
  minCx: number;
  maxCx: number;
  minCz: number;
  maxCz: number;
  chunkCount: number;
};

type CutawayState = {
  key: string;
  structureId: string;
  structureName: string;
  footprint: StructureMetadata["footprint"];
  focusY: number;
  openX: -1 | 0 | 1;
  openZ: -1 | 0 | 1;
};

const REGION_SIZE_CHUNKS = 2;

const FACES: readonly Face[] = [
  {
    normal: [1, 0, 0],
    corners: [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
      [1, 0, 0]
    ],
    tileIndex: 0
  },
  {
    normal: [-1, 0, 0],
    corners: [
      [0, 1, 0],
      [0, 0, 0],
      [0, 1, 1],
      [0, 0, 1]
    ],
    tileIndex: 1
  },
  {
    normal: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [0, 1, 0],
      [1, 1, 0]
    ],
    tileIndex: 2
  },
  {
    normal: [0, -1, 0],
    corners: [
      [1, 0, 1],
      [0, 0, 1],
      [1, 0, 0],
      [0, 0, 0]
    ],
    tileIndex: 3
  },
  {
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1]
    ],
    tileIndex: 4
  },
  {
    normal: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 0]
    ],
    tileIndex: 5
  }
] as const;

const BOX_FACES: readonly BoxFace[] = [
  {
    normal: [1, 0, 0],
    corners: (box) => [
      [box.maxX, box.maxY, box.maxZ],
      [box.maxX, box.minY, box.maxZ],
      [box.maxX, box.maxY, box.minZ],
      [box.maxX, box.minY, box.minZ]
    ],
    tileIndex: 0
  },
  {
    normal: [-1, 0, 0],
    corners: (box) => [
      [box.minX, box.maxY, box.minZ],
      [box.minX, box.minY, box.minZ],
      [box.minX, box.maxY, box.maxZ],
      [box.minX, box.minY, box.maxZ]
    ],
    tileIndex: 1
  },
  {
    normal: [0, 1, 0],
    corners: (box) => [
      [box.minX, box.maxY, box.maxZ],
      [box.maxX, box.maxY, box.maxZ],
      [box.minX, box.maxY, box.minZ],
      [box.maxX, box.maxY, box.minZ]
    ],
    tileIndex: 2
  },
  {
    normal: [0, -1, 0],
    corners: (box) => [
      [box.maxX, box.minY, box.maxZ],
      [box.minX, box.minY, box.maxZ],
      [box.maxX, box.minY, box.minZ],
      [box.minX, box.minY, box.minZ]
    ],
    tileIndex: 3
  },
  {
    normal: [0, 0, 1],
    corners: (box) => [
      [box.minX, box.minY, box.maxZ],
      [box.maxX, box.minY, box.maxZ],
      [box.minX, box.maxY, box.maxZ],
      [box.maxX, box.maxY, box.maxZ]
    ],
    tileIndex: 4
  },
  {
    normal: [0, 0, -1],
    corners: (box) => [
      [box.maxX, box.minY, box.minZ],
      [box.minX, box.minY, box.minZ],
      [box.maxX, box.maxY, box.minZ],
      [box.minX, box.maxY, box.minZ]
    ],
    tileIndex: 5
  }
] as const;

const bucketForBlock = (block: BlockId): RenderBucket => {
  if (block === BlockId.Water) return "water";
  if (BLOCKS[block].transparent) return "transparent";
  return "opaque";
};

export class ChunkRenderer {
  private readonly group = new THREE.Group();
  private readonly atlas: TextureAtlas;
  private readonly materials = new Map<RenderBucket, THREE.MeshBasicMaterial>();
  private readonly regionMeshes = new Map<string, THREE.Mesh[]>();
  private readonly regionBounds = new Map<string, RenderRegion>();
  private smoothLighting = true;
  private renderDistanceChunks = 3;
  private focusChunkX = 0;
  private focusChunkZ = 0;
  private renderedChunkCount = 0;
  private cutaway: CutawayState | null = null;

  constructor(private readonly scene: THREE.Scene) {
    this.atlas = createTextureAtlas();
    this.group.name = "chunk-voxel-meshes";
    scene.add(this.group);
  }

  get objectGroup() {
    return this.group;
  }

  dispose() {
    this.scene.remove(this.group);
    this.clearMeshes();
    for (const material of this.materials.values()) material.dispose();
    this.atlas.texture.dispose();
    this.materials.clear();
  }

  rebuild(world: VoxelWorld) {
    this.clearMeshes();
    this.renderedChunkCount = world.chunks.size;
    const regions = new Set<string>();
    for (const chunk of world.chunks.values()) {
      regions.add(this.regionKeyForChunk(chunk.cx, chunk.cz));
    }
    for (const key of regions) {
      const [rx, rz] = this.parseRegionKey(key);
      this.rebuildRegion(world, rx, rz);
    }
    this.updateAllChunkVisibility();
  }

  rebuildAround(world: VoxelWorld, x: number, z: number) {
    const cx = worldToChunk(x);
    const cz = worldToChunk(z);
    const regions = new Set<string>([this.regionKeyForChunk(cx, cz)]);

    const lx = worldToLocal(Math.floor(x));
    const lz = worldToLocal(Math.floor(z));
    if (lx === 0) regions.add(this.regionKeyForChunk(cx - 1, cz));
    if (lx === CHUNK_SIZE - 1) regions.add(this.regionKeyForChunk(cx + 1, cz));
    if (lz === 0) regions.add(this.regionKeyForChunk(cx, cz - 1));
    if (lz === CHUNK_SIZE - 1) regions.add(this.regionKeyForChunk(cx, cz + 1));
    for (const key of regions) {
      const [rx, rz] = this.parseRegionKey(key);
      this.rebuildRegion(world, rx, rz);
    }
  }

  rebuildChunkKeys(world: VoxelWorld, keys: Iterable<string>) {
    const regions = new Set<string>();
    for (const key of keys) {
      const parts = key.split(",");
      const cx = Number(parts[0]);
      const cz = Number(parts[1]);
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      regions.add(this.regionKeyForChunk(cx, cz));
    }
    for (const key of regions) {
      const [rx, rz] = this.parseRegionKey(key);
      this.rebuildRegion(world, rx, rz);
    }
  }

  setSpectatorCutaway(world: VoxelWorld, structure: StructureMetadata | null, focusY: number, cameraX: number, cameraZ: number) {
    const previous = this.cutaway;
    const next = structure ? this.createCutawayState(structure, focusY, cameraX, cameraZ, previous) : null;
    if ((this.cutaway?.key ?? "none") === (next?.key ?? "none")) return;
    this.cutaway = next;
    this.rebuildCutawayRegions(world, previous, next);
  }

  getCutawayLabel() {
    return this.cutaway?.structureName ?? null;
  }

  isCutawayOpenBlock(x: number, y: number, z: number) {
    return this.shouldSkipCutawayBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  setSmoothLighting(enabled: boolean, world?: VoxelWorld | null) {
    if (this.smoothLighting === enabled) return;
    this.smoothLighting = enabled;
    if (world) this.rebuild(world);
  }

  setRenderDistance(chunks: number, focusX?: number, focusZ?: number) {
    this.renderDistanceChunks = Math.max(1, Math.floor(chunks));
    if (Number.isFinite(focusX) && Number.isFinite(focusZ)) {
      this.focusChunkX = worldToChunk(focusX!);
      this.focusChunkZ = worldToChunk(focusZ!);
    }
    this.updateAllChunkVisibility();
  }

  updateVisibilityAround(x: number, z: number) {
    const cx = worldToChunk(x);
    const cz = worldToChunk(z);
    if (cx === this.focusChunkX && cz === this.focusChunkZ) return;
    this.focusChunkX = cx;
    this.focusChunkZ = cz;
    this.updateAllChunkVisibility();
  }

  getRenderDistance() {
    return this.renderDistanceChunks;
  }

  getRenderedChunkCount() {
    return this.renderedChunkCount;
  }

  getVisibleChunkCount() {
    let count = 0;
    for (const [key, meshes] of this.regionMeshes.entries()) {
      if (meshes.some((mesh) => mesh.visible)) count += this.regionBounds.get(key)?.chunkCount ?? 0;
    }
    return count;
  }

  private rebuildRegion(world: VoxelWorld, rx: number, rz: number) {
    const key = this.regionKey(rx, rz);
    this.removeRegionMeshes(key);
    const meshes = new Map<RenderBucket, MeshData>();
    let chunkCount = 0;
    let minCx = Infinity;
    let maxCx = -Infinity;
    let minCz = Infinity;
    let maxCz = -Infinity;
    const startCx = rx * REGION_SIZE_CHUNKS;
    const startCz = rz * REGION_SIZE_CHUNKS;

    for (let cx = startCx; cx < startCx + REGION_SIZE_CHUNKS; cx += 1) {
      for (let cz = startCz; cz < startCz + REGION_SIZE_CHUNKS; cz += 1) {
        const chunk = world.getChunk(cx, cz);
        if (!chunk) continue;
        chunkCount += 1;
        minCx = Math.min(minCx, cx);
        maxCx = Math.max(maxCx, cx);
        minCz = Math.min(minCz, cz);
        maxCz = Math.max(maxCz, cz);
        this.collectVisibleFaces(world, chunk, meshes);
      }
    }

    if (chunkCount === 0) return;
    this.regionBounds.set(key, { minCx, maxCx, minCz, maxCz, chunkCount });

    const chunkMeshes: THREE.Mesh[] = [];
    for (const [bucket, data] of meshes.entries()) {
      if (data.indices.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(data.normals, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(data.uvs, 2));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(data.colors, 3));
      geometry.setIndex(data.indices);
      geometry.computeBoundingSphere();

      const mesh = new THREE.Mesh(geometry, this.getMaterial(bucket));
      mesh.name = `chunk-${key}-${bucket}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      chunkMeshes.push(mesh);
      this.group.add(mesh);
    }

    if (chunkMeshes.length > 0) this.regionMeshes.set(key, chunkMeshes);
    this.setRegionVisibility(key, chunkMeshes);
  }

  private clearMeshes() {
    for (const key of [...this.regionMeshes.keys()]) {
      this.removeRegionMeshes(key);
    }
    this.regionBounds.clear();
    this.renderedChunkCount = 0;
  }

  private removeRegionMeshes(key: string) {
    const meshes = this.regionMeshes.get(key);
    if (!meshes) return;
    for (const mesh of meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.regionMeshes.delete(key);
    this.regionBounds.delete(key);
  }

  private updateAllChunkVisibility() {
    for (const [key, meshes] of this.regionMeshes.entries()) {
      this.setRegionVisibility(key, meshes);
    }
  }

  private setRegionVisibility(key: string, meshes: THREE.Mesh[]) {
    const bounds = this.regionBounds.get(key);
    const visible = bounds ? this.regionDistance(bounds) <= this.renderDistanceChunks : false;
    for (const mesh of meshes) mesh.visible = visible;
  }

  private regionDistance(region: RenderRegion) {
    const dx = this.focusChunkX < region.minCx ? region.minCx - this.focusChunkX : this.focusChunkX > region.maxCx ? this.focusChunkX - region.maxCx : 0;
    const dz = this.focusChunkZ < region.minCz ? region.minCz - this.focusChunkZ : this.focusChunkZ > region.maxCz ? this.focusChunkZ - region.maxCz : 0;
    return Math.max(dx, dz);
  }

  private regionKeyForChunk(cx: number, cz: number) {
    return this.regionKey(Math.floor(cx / REGION_SIZE_CHUNKS), Math.floor(cz / REGION_SIZE_CHUNKS));
  }

  private regionKey(rx: number, rz: number) {
    return `${rx},${rz}`;
  }

  private parseRegionKey(key: string): readonly [number, number] {
    const parts = key.split(",");
    return [Number(parts[0]), Number(parts[1])] as const;
  }

  private collectVisibleFaces(world: VoxelWorld, chunk: Chunk, meshes: Map<RenderBucket, MeshData>) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          const block = chunk.getLocal(lx, y, lz);
          if (!isRenderableBlock(block)) continue;

          const wx = chunk.cx * CHUNK_SIZE + lx;
          const wz = chunk.cz * CHUNK_SIZE + lz;
          if (!isInsideWorldBounds(wx, wz, world.bounds)) continue;
          if (this.shouldSkipCutawayBlock(wx, y, wz)) continue;

          const bucket = bucketForBlock(block);
          const data = meshes.get(bucket) ?? this.createMeshData();
          const tiles = blockFaceTiles(block);
          if (isFullCubeBlock(block)) {
            for (const face of FACES) {
              const nx = wx + face.normal[0];
              const ny = y + face.normal[1];
              const nz = wz + face.normal[2];
              const neighbor = world.getBlock(nx, ny, nz);
              if (!this.shouldRenderFace(world, block, neighbor, nx, ny, nz, face.normal)) continue;
              this.addFace(data, world, wx, y, wz, block, face.normal, face.corners, tiles[face.tileIndex]!, true);
            }
          } else {
            for (const box of getBlockBoxes(block, world.getBlockState(wx, y, wz))) {
              for (const face of BOX_FACES) {
                this.addFace(data, world, wx, y, wz, block, face.normal, face.corners(box), tiles[face.tileIndex]!, false);
              }
            }
          }
          meshes.set(bucket, data);
        }
      }
    }
  }

  private shouldRenderFace(
    world: VoxelWorld,
    block: BlockId,
    neighbor: BlockId,
    neighborX: number,
    neighborY: number,
    neighborZ: number,
    normal: readonly [number, number, number]
  ) {
    if (neighbor === BlockId.Air) return true;
    if (this.shouldSkipCutawayBlock(neighborX, neighborY, neighborZ)) return true;
    if (block !== BlockId.Water && neighbor === BlockId.Water) return true;
    return !this.neighborCoversSharedFace(neighbor, world.getBlockState(neighborX, neighborY, neighborZ), normal);
  }

  private rebuildCutawayRegions(world: VoxelWorld, previous: CutawayState | null, next: CutawayState | null) {
    const regions = new Set<string>();
    if (previous) this.collectFootprintRegionKeys(previous.footprint, regions);
    if (next) this.collectFootprintRegionKeys(next.footprint, regions);
    if (regions.size === 0) return;

    for (const key of regions) {
      const [rx, rz] = this.parseRegionKey(key);
      this.rebuildRegion(world, rx, rz);
    }
  }

  private collectFootprintRegionKeys(footprint: StructureMetadata["footprint"], regions: Set<string>) {
    const minCx = worldToChunk(footprint.x - 1);
    const maxCx = worldToChunk(footprint.x + footprint.width);
    const minCz = worldToChunk(footprint.z - 1);
    const maxCz = worldToChunk(footprint.z + footprint.depth);
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cz = minCz; cz <= maxCz; cz += 1) {
        regions.add(this.regionKeyForChunk(cx, cz));
      }
    }
  }

  private createCutawayState(
    structure: StructureMetadata,
    focusY: number,
    cameraX: number,
    cameraZ: number,
    previous: CutawayState | null
  ): CutawayState {
    const footprint = structure.footprint;
    const centerX = footprint.x + footprint.width / 2;
    const centerZ = footprint.z + footprint.depth / 2;
    const dx = cameraX - centerX;
    const dz = cameraZ - centerZ;
    let openX: -1 | 0 | 1 = Math.abs(dx) >= Math.abs(dz) ? (dx < 0 ? -1 : 1) : 0;
    let openZ: -1 | 0 | 1 = Math.abs(dz) > Math.abs(dx) ? (dz < 0 ? -1 : 1) : 0;
    if (previous?.structureId === structure.id) {
      openX = previous.openX;
      openZ = previous.openZ;
    }
    const focusBand =
      previous?.structureId === structure.id
        ? previous.focusY
        : Math.max(footprint.minY + 1, Math.min(footprint.maxY, Math.floor(focusY)));
    const key = `${structure.id}:${focusBand}:${openX}:${openZ}`;
    return {
      key,
      structureId: structure.id,
      structureName: structure.name,
      footprint,
      focusY: focusBand,
      openX,
      openZ
    };
  }

  private shouldSkipCutawayBlock(x: number, y: number, z: number) {
    if (!this.cutaway) return false;
    const { footprint, focusY, openX, openZ } = this.cutaway;
    if (x < footprint.x || x >= footprint.x + footprint.width || z < footprint.z || z >= footprint.z + footprint.depth) return false;
    if (y < footprint.minY + 1 || y > footprint.maxY) return false;

    const aboveFocus = y >= Math.min(footprint.maxY, focusY + 2);
    const openWest = openX < 0 && x <= footprint.x;
    const openEast = openX > 0 && x >= footprint.x + footprint.width - 1;
    const openNorth = openZ < 0 && z <= footprint.z;
    const openSouth = openZ > 0 && z >= footprint.z + footprint.depth - 1;
    const cameraFacingWall = openWest || openEast || openNorth || openSouth;
    return aboveFocus || cameraFacingWall;
  }

  private neighborCoversSharedFace(neighbor: BlockId, state: ReturnType<VoxelWorld["getBlockState"]>, normal: readonly [number, number, number]) {
    const boxes = getBlockBoxes(neighbor, state);
    return boxes.some((box) => {
      if (normal[0] > 0) return box.minX <= 0 && this.coversRange(box.minY, box.maxY) && this.coversRange(box.minZ, box.maxZ);
      if (normal[0] < 0) return box.maxX >= 1 && this.coversRange(box.minY, box.maxY) && this.coversRange(box.minZ, box.maxZ);
      if (normal[1] > 0) return box.minY <= 0 && this.coversRange(box.minX, box.maxX) && this.coversRange(box.minZ, box.maxZ);
      if (normal[1] < 0) return box.maxY >= 1 && this.coversRange(box.minX, box.maxX) && this.coversRange(box.minZ, box.maxZ);
      if (normal[2] > 0) return box.minZ <= 0 && this.coversRange(box.minX, box.maxX) && this.coversRange(box.minY, box.maxY);
      return box.maxZ >= 1 && this.coversRange(box.minX, box.maxX) && this.coversRange(box.minY, box.maxY);
    });
  }

  private coversRange(min: number, max: number) {
    return min <= 0 && max >= 1;
  }

  private createMeshData(): MeshData {
    return { positions: [], normals: [], uvs: [], colors: [], indices: [] };
  }

  private addFace(
    data: MeshData,
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
    block: BlockId,
    normal: readonly [number, number, number],
    corners: readonly (readonly [number, number, number])[],
    tileName: AtlasTile,
    useAmbientOcclusion: boolean
  ) {
    const vertexIndex = data.positions.length / 3;
    const tile = this.atlas.tileUv[tileName];
    const baseShade = this.baseShadeForFace(normal, block);

    for (const corner of corners) {
      data.positions.push(x + corner[0], y + corner[1], z + corner[2]);
      data.normals.push(normal[0], normal[1], normal[2]);
      const [u, v] = this.uvForCorner(normal, corner, tile);
      data.uvs.push(u, v);
      const shade = this.smoothLighting && useAmbientOcclusion ? baseShade * this.ambientOcclusion(world, x, y, z, normal, corner) : baseShade;
      data.colors.push(shade, shade, shade);
    }
    data.indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex + 2, vertexIndex + 1, vertexIndex + 3);
  }

  private baseShadeForFace(normal: readonly [number, number, number], block: BlockId) {
    if (!this.smoothLighting) return 1;
    if (block === BlockId.Water) return 0.92;
    if (normal[1] > 0) return 1;
    if (normal[1] < 0) return 0.48;
    if (normal[0] > 0) return 0.82;
    if (normal[0] < 0) return 0.68;
    if (normal[2] > 0) return 0.76;
    return 0.62;
  }

  private ambientOcclusion(
    world: VoxelWorld,
    x: number,
    y: number,
    z: number,
    normal: readonly [number, number, number],
    corner: readonly [number, number, number]
  ) {
    if (!this.smoothLighting) return 1;
    const face = this.faceAxes(normal, corner);
    const ao =
      this.occludes(world, x, y, z, face.sideA) +
      this.occludes(world, x, y, z, face.sideB) +
      this.occludes(world, x, y, z, face.corner);
    return [1, 0.82, 0.66, 0.52][ao] ?? 1;
  }

  private faceAxes(normal: readonly [number, number, number], corner: readonly [number, number, number]) {
    if (normal[1] !== 0) {
      const sx = corner[0] === 0 ? -1 : 1;
      const sz = corner[2] === 0 ? -1 : 1;
      return { sideA: [sx, 0, 0] as const, sideB: [0, 0, sz] as const, corner: [sx, 0, sz] as const };
    }
    if (normal[0] !== 0) {
      const sy = corner[1] === 0 ? -1 : 1;
      const sz = corner[2] === 0 ? -1 : 1;
      return { sideA: [0, sy, 0] as const, sideB: [0, 0, sz] as const, corner: [0, sy, sz] as const };
    }
    const sx = corner[0] === 0 ? -1 : 1;
    const sy = corner[1] === 0 ? -1 : 1;
    return { sideA: [sx, 0, 0] as const, sideB: [0, sy, 0] as const, corner: [sx, sy, 0] as const };
  }

  private occludes(world: VoxelWorld, x: number, y: number, z: number, offset: readonly [number, number, number]) {
    const block = world.getBlock(x + offset[0], y + offset[1], z + offset[2]);
    return block !== BlockId.Air && block !== BlockId.Water ? 1 : 0;
  }

  private uvForCorner(
    normal: readonly [number, number, number],
    corner: readonly [number, number, number],
    tile: TextureAtlas["tileUv"][AtlasTile]
  ): readonly [number, number] {
    const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
    if (normal[1] !== 0) {
      return [lerp(tile.u0, tile.u1, corner[0]), lerp(tile.v0, tile.v1, corner[2])];
    }

    const horizontal = normal[0] !== 0 ? corner[2] : corner[0];
    return [lerp(tile.u0, tile.u1, horizontal), lerp(tile.v0, tile.v1, corner[1])];
  }

  private getMaterial(bucket: RenderBucket) {
    const existing = this.materials.get(bucket);
    if (existing) return existing;

    const material = new THREE.MeshBasicMaterial({
      map: this.atlas.texture,
      color: bucket === "water" ? "#b9ddff" : "#ffffff",
      vertexColors: true,
      transparent: bucket !== "opaque",
      opacity: bucket === "water" ? 0.66 : bucket === "transparent" ? 0.9 : 1,
      depthWrite: bucket !== "water"
    });
    this.materials.set(bucket, material);
    return material;
  }
}
