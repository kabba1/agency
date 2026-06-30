import { BlockId, isSolidBlock } from "./blocks";
import { worldHalfExtents } from "./WorldBounds";
import type { VoxelWorld } from "./VoxelWorld";

export type AgentNavPoint = { x: number; y: number; z: number };

type WalkCell = {
  x: number;
  z: number;
  groundY: number;
  standY: number;
  cost: number;
};

type SearchNode = WalkCell & {
  key: string;
  g: number;
  f: number;
  parent: string | null;
};

class MinHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly score: (item: T) => number) {}

  get size() {
    return this.items.length;
  }

  push(item: T) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last) return first ?? null;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return first;
  }

  private bubbleUp(index: number) {
    const item = this.items[index]!;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.items[parentIndex]!;
      if (this.score(item) >= this.score(parent)) break;
      this.items[parentIndex] = item;
      this.items[index] = parent;
      index = parentIndex;
    }
  }

  private sinkDown(index: number) {
    const length = this.items.length;
    const item = this.items[index]!;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let swapIndex = -1;

      if (leftIndex < length) {
        const left = this.items[leftIndex]!;
        if (this.score(left) < this.score(item)) swapIndex = leftIndex;
      }

      if (rightIndex < length) {
        const right = this.items[rightIndex]!;
        const swapTarget = swapIndex === -1 ? item : this.items[swapIndex]!;
        if (this.score(right) < this.score(swapTarget)) swapIndex = rightIndex;
      }

      if (swapIndex === -1) break;
      this.items[index] = this.items[swapIndex]!;
      this.items[swapIndex] = item;
      index = swapIndex;
    }
  }
}

const keyFor = (x: number, z: number) => `${x},${z}`;
const heuristic = (a: WalkCell, b: WalkCell) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

const allowsAgentSpace = (block: BlockId) => block === BlockId.Air || block === BlockId.Door;

export class AgentPathfinder {
  private readonly walkableCache = new Map<string, WalkCell | null>();
  private readonly half;
  private readonly surfaceY;

  constructor(private readonly world: VoxelWorld) {
    this.half = worldHalfExtents(world.bounds);
    this.surfaceY = world.cityMap.surfaceY;
  }

  findPath(from: AgentNavPoint, to: AgentNavPoint): AgentNavPoint[] | null {
    const start = this.nearestWalkable(Math.floor(from.x), Math.floor(from.z), 5);
    const goal = this.nearestWalkable(Math.floor(to.x), Math.floor(to.z), 6);
    if (!start || !goal) return null;
    if (start.x === goal.x && start.z === goal.z) return [this.toNavPoint(start)];

    const open = new MinHeap<SearchNode>((node) => node.f);
    const nodes = new Map<string, SearchNode>();
    const closed = new Set<string>();
    const startNode: SearchNode = {
      ...start,
      key: keyFor(start.x, start.z),
      g: 0,
      f: heuristic(start, goal),
      parent: null
    };
    nodes.set(startNode.key, startNode);
    open.push(startNode);

    let iterations = 0;
    while (open.size > 0 && iterations < 50000) {
      iterations += 1;
      const current = open.pop();
      if (!current) break;
      if (closed.has(current.key)) continue;
      if (current.x === goal.x && current.z === goal.z) return this.reconstructPath(current, nodes);
      closed.add(current.key);

      for (const neighbor of this.neighbors(current)) {
        const neighborKey = keyFor(neighbor.x, neighbor.z);
        if (closed.has(neighborKey)) continue;
        const stepCost = neighbor.cost + Math.abs(neighbor.groundY - current.groundY) * 0.65;
        const nextG = current.g + stepCost;
        const previous = nodes.get(neighborKey);
        if (previous && nextG >= previous.g) continue;
        const node: SearchNode = {
          ...neighbor,
          key: neighborKey,
          g: nextG,
          f: nextG + heuristic(neighbor, goal),
          parent: current.key
        };
        nodes.set(neighborKey, node);
        open.push(node);
      }
    }

    return null;
  }

  private reconstructPath(goal: SearchNode, nodes: Map<string, SearchNode>) {
    const cells: WalkCell[] = [];
    let cursor: SearchNode | undefined = goal;
    while (cursor) {
      cells.push(cursor);
      cursor = cursor.parent ? nodes.get(cursor.parent) : undefined;
    }
    cells.reverse();
    return this.compress(cells);
  }

  private compress(cells: WalkCell[]) {
    return cells.map((cell) => this.toNavPoint(cell));
  }

  private neighbors(cell: WalkCell) {
    const results: WalkCell[] = [];
    const candidates = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ] as const;

    for (const [dx, dz] of candidates) {
      const next = this.walkableAt(cell.x + dx, cell.z + dz);
      if (!next) continue;
      if (Math.abs(next.groundY - cell.groundY) > 1) continue;
      results.push(next);
    }

    return results;
  }

  private nearestWalkable(x: number, z: number, radius: number) {
    let best: WalkCell | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const distance = Math.abs(dx) + Math.abs(dz);
        if (distance > radius) continue;
        const cell = this.walkableAt(x + dx, z + dz);
        if (!cell) continue;
        const score = distance * 10 + cell.cost;
        if (score >= bestScore) continue;
        best = cell;
        bestScore = score;
      }
    }

    return best;
  }

  private walkableAt(x: number, z: number): WalkCell | null {
    const key = keyFor(x, z);
    if (this.walkableCache.has(key)) return this.walkableCache.get(key) ?? null;
    if (x < -this.half.x || x >= this.half.x || z < -this.half.z || z >= this.half.z) {
      this.walkableCache.set(key, null);
      return null;
    }

    const cell = this.walkableAtGround(x, z, this.surfaceY + 1) ?? this.walkableAtGround(x, z, this.surfaceY);
    this.walkableCache.set(key, cell);
    return cell;
  }

  private walkableAtGround(x: number, z: number, groundY: number): WalkCell | null {
    const groundBlock = this.world.getBlock(x, groundY, z);
    if (!isSolidBlock(groundBlock)) return null;
    if (!allowsAgentSpace(this.world.getBlock(x, groundY + 1, z))) return null;
    if (!allowsAgentSpace(this.world.getBlock(x, groundY + 2, z))) return null;
    return {
      x,
      z,
      groundY,
      standY: groundY + 1.02,
      cost: this.costFor(groundBlock, this.world.getBlock(x, groundY + 1, z))
    };
  }

  private costFor(groundBlock: BlockId, spaceBlock: BlockId) {
    const doorCost = spaceBlock === BlockId.Door ? 0.15 : 0;
    switch (groundBlock) {
      case BlockId.Road:
        return 1 + doorCost;
      case BlockId.Floor:
        return 1.25 + doorCost;
      case BlockId.Sand:
        return 2.2 + doorCost;
      case BlockId.Grass:
        return 3.4 + doorCost;
      default:
        return 2.8 + doorCost;
    }
  }

  private toNavPoint(cell: WalkCell): AgentNavPoint {
    return {
      x: cell.x + 0.5,
      y: cell.standY,
      z: cell.z + 0.5
    };
  }
}
