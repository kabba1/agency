import { BlockId, isKnownBlockId } from "./blocks";
import { normalizeBlockHalf, normalizeBlockState, normalizeRotation, type BlockState } from "./BlockShapes";
import type { EditPatchEntry } from "../shared/types";

const storageKey = (seed: string) => `agency-world:edits:${seed}`;
const coordKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

export class EditPatch {
  private readonly entries = new Map<string, EditPatchEntry>();

  constructor(readonly seed: string) {}

  get size() {
    return this.entries.size;
  }

  get(x: number, y: number, z: number) {
    return this.entries.get(coordKey(x, y, z)) ?? null;
  }

  set(x: number, y: number, z: number, block: BlockId, state: Partial<BlockState> = {}) {
    const entry: EditPatchEntry = { x, y, z, block };
    const normalized = normalizeBlockState(block, state);
    if (normalized.rotation !== 0) entry.rotation = normalized.rotation;
    if (normalized.half !== "bottom") entry.half = normalized.half;
    this.entries.set(coordKey(x, y, z), entry);
  }

  delete(x: number, y: number, z: number) {
    return this.entries.delete(coordKey(x, y, z));
  }

  values() {
    return [...this.entries.values()];
  }

  save() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(storageKey(this.seed), JSON.stringify(this.values()));
  }

  clear() {
    this.entries.clear();
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(storageKey(this.seed));
  }

  static load(seed: string) {
    const patch = new EditPatch(seed);
    if (typeof localStorage === "undefined") return patch;

    try {
      const raw = localStorage.getItem(storageKey(seed));
      const parsed = raw ? (JSON.parse(raw) as EditPatchEntry[]) : [];
      for (const entry of parsed) {
        if (
          Number.isFinite(entry.x) &&
          Number.isFinite(entry.y) &&
          Number.isFinite(entry.z) &&
          Number.isFinite(entry.block) &&
          isKnownBlockId(entry.block)
        ) {
          patch.set(entry.x, entry.y, entry.z, entry.block, { rotation: normalizeRotation(entry.rotation), half: normalizeBlockHalf(entry.half) });
        }
      }
    } catch {
      localStorage.removeItem(storageKey(seed));
    }

    return patch;
  }
}
