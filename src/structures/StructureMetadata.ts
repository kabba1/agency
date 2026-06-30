import type { StructureMetadata } from "../shared/types";

export class StructureRegistry {
  private readonly structures = new Map<string, StructureMetadata>();

  add(metadata: StructureMetadata) {
    this.structures.set(metadata.id, metadata);
  }

  all() {
    return [...this.structures.values()];
  }

  findByBlock(x: number, y: number, z: number) {
    return (
      this.all().find((structure) => {
        const footprint = structure.footprint;
        return (
          x >= footprint.x &&
          x < footprint.x + footprint.width &&
          z >= footprint.z &&
          z < footprint.z + footprint.depth &&
          y >= footprint.minY &&
          y <= footprint.maxY
        );
      }) ?? null
    );
  }
}
