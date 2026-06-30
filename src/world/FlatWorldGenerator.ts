import { BlockId } from "./blocks";
import { CHUNK_SIZE, Chunk, WORLD_HEIGHT } from "./Chunk";
import { hashSeed, random01 } from "./random";
import type { CityMapMetadata, CityPlot, CityRoad, FlatWorldLayer, FlatWorldOptions } from "../shared/types";

type Band = { start: number; end: number };
type RoadBand = Band & { kind: "main" | "lane" };
type AxisPlan = { roads: RoadBand[]; districts: Band[] };
type DistrictAxisSplit = { plots: Band[]; lanes: Band[] };

const MIN_WORLD_SIZE = 64;
const MAX_WORLD_SIZE = 512;
const DEFAULT_MIN_PLOT_SIZE = 8;
const DEFAULT_MAX_PLOT_SIZE = 16;
const DEFAULT_ROAD_WIDTH = 5;
const DEFAULT_LANE_WIDTH = 3;

export const DEFAULT_FLAT_WORLD_OPTIONS: FlatWorldOptions = {
  widthBlocks: 192,
  depthBlocks: 192,
  roadWidth: DEFAULT_ROAD_WIDTH,
  laneWidth: DEFAULT_LANE_WIDTH,
  minPlotSize: DEFAULT_MIN_PLOT_SIZE,
  maxPlotSize: DEFAULT_MAX_PLOT_SIZE,
  layers: [
    { block: BlockId.Stone, depth: 4 },
    { block: BlockId.Dirt, depth: 2 },
    { block: BlockId.Grass, depth: 1 }
  ]
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finiteOr = (value: number | undefined, fallback: number) => (Number.isFinite(value) ? value! : fallback);
const snapToChunk = (value: number) => Math.max(CHUNK_SIZE, Math.round(value / CHUNK_SIZE) * CHUNK_SIZE);
const bandSize = (band: Band) => band.end - band.start;

export const normalizeFlatWorldOptions = (options: Partial<FlatWorldOptions> = {}): FlatWorldOptions => {
  const rawLayers = options.layers?.length ? options.layers : DEFAULT_FLAT_WORLD_OPTIONS.layers;
  const layers: FlatWorldLayer[] = [];
  let remainingDepth = WORLD_HEIGHT - 8;
  for (const layer of rawLayers) {
    const depth = clamp(Math.floor(finiteOr(layer.depth, 1)), 1, remainingDepth);
    layers.push({ block: layer.block, depth });
    remainingDepth -= depth;
    if (remainingDepth <= 0) break;
  }
  if (layers.length === 0) layers.push(...DEFAULT_FLAT_WORLD_OPTIONS.layers);

  const minPlotSize = clamp(Math.floor(finiteOr(options.minPlotSize, DEFAULT_MIN_PLOT_SIZE)), 4, 48);
  const maxPlotSize = clamp(Math.floor(finiteOr(options.maxPlotSize, DEFAULT_MAX_PLOT_SIZE)), minPlotSize, 80);
  return {
    widthBlocks: snapToChunk(clamp(Math.floor(finiteOr(options.widthBlocks, DEFAULT_FLAT_WORLD_OPTIONS.widthBlocks)), MIN_WORLD_SIZE, MAX_WORLD_SIZE)),
    depthBlocks: snapToChunk(clamp(Math.floor(finiteOr(options.depthBlocks, DEFAULT_FLAT_WORLD_OPTIONS.depthBlocks)), MIN_WORLD_SIZE, MAX_WORLD_SIZE)),
    roadWidth: clamp(Math.floor(finiteOr(options.roadWidth, DEFAULT_ROAD_WIDTH)), 3, 16),
    laneWidth: clamp(Math.floor(finiteOr(options.laneWidth, DEFAULT_LANE_WIDTH)), 1, 8),
    minPlotSize,
    maxPlotSize,
    layers
  };
};

export class FlatWorldGenerator {
  readonly numericSeed: number;
  readonly options: FlatWorldOptions;
  readonly surfaceY: number;
  readonly cityMap: CityMapMetadata;
  readonly spawn: { x: number; z: number };
  private readonly roadRects: CityRoad[];
  private readonly mainXRoadBands: Band[];
  private readonly mainZRoadBands: Band[];

  constructor(readonly seed: string, options: Partial<FlatWorldOptions> = {}) {
    this.numericSeed = hashSeed(seed);
    this.options = normalizeFlatWorldOptions(options);
    this.surfaceY = this.options.layers.reduce((total, layer) => total + layer.depth, 0) - 1;
    const map = this.buildCityMap();
    this.cityMap = map.cityMap;
    this.roadRects = map.cityMap.roads;
    this.mainXRoadBands = map.mainXRoadBands;
    this.mainZRoadBands = map.mainZRoadBands;
    this.spawn = this.findSpawnPoint();
  }

  heightAt() {
    return this.surfaceY;
  }

  generateChunk(cx: number, cz: number) {
    const chunk = new Chunk(cx, cz);
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        const x = cx * CHUNK_SIZE + lx;
        const z = cz * CHUNK_SIZE + lz;
        const road = this.isRoadAt(x, z);
        for (let y = 0; y <= this.surfaceY; y += 1) {
          chunk.setLocal(lx, y, lz, y === this.surfaceY && road ? BlockId.Road : this.blockForLayer(y));
        }
      }
    }
    return chunk;
  }

  private blockForLayer(y: number) {
    let cursor = 0;
    for (const layer of this.options.layers) {
      cursor += layer.depth;
      if (y < cursor) return layer.block;
    }
    return this.options.layers[this.options.layers.length - 1]?.block ?? BlockId.Grass;
  }

  private isRoadAt(x: number, z: number) {
    return this.roadRects.some((road) => x >= road.x && x < road.x + road.width && z >= road.z && z < road.z + road.depth);
  }

  private buildCityMap() {
    const halfX = Math.floor(this.options.widthBlocks / 2);
    const halfZ = Math.floor(this.options.depthBlocks / 2);
    const xAxis = this.partitionMainAxis(-halfX, halfX, 11);
    const zAxis = this.partitionMainAxis(-halfZ, halfZ, 37);
    const plots: CityPlot[] = [];
    const roads: CityRoad[] = [
      ...xAxis.roads.map((band, index) => ({
        id: `main-road-x-${index + 1}`,
        x: band.start,
        z: -halfZ,
        width: bandSize(band),
        depth: this.options.depthBlocks,
        axis: "z" as const,
        kind: "main" as const
      })),
      ...zAxis.roads.map((band, index) => ({
        id: `main-road-z-${index + 1}`,
        x: -halfX,
        z: band.start,
        width: this.options.widthBlocks,
        depth: bandSize(band),
        axis: "x" as const,
        kind: "main" as const
      }))
    ];

    for (const xBlock of xAxis.districts) {
      for (const zBlock of zAxis.districts) {
        this.addPlotsForDistrict(plots, roads, xBlock, zBlock);
      }
    }

    return {
      mainXRoadBands: xAxis.roads,
      mainZRoadBands: zAxis.roads,
      cityMap: {
        widthBlocks: this.options.widthBlocks,
        depthBlocks: this.options.depthBlocks,
        roadWidth: this.options.roadWidth,
        laneWidth: this.options.laneWidth,
        surfaceY: this.surfaceY,
        plots,
        roads
      }
    };
  }

  private partitionMainAxis(min: number, max: number, salt: number): AxisPlan {
    const roadWidth = this.options.roadWidth;
    const laneWidth = this.options.laneWidth;
    const minDistrict = Math.max(this.options.maxPlotSize! * 2 + laneWidth, 32);
    const maxDistrict = Math.max(minDistrict + 8, this.options.maxPlotSize! * 3 + laneWidth * 2);
    const roads: RoadBand[] = [{ start: min, end: min + roadWidth, kind: "main" }];
    const districts: Band[] = [];
    let cursor = min + roadWidth;
    const innerEnd = max - roadWidth;

    while (cursor < innerEnd) {
      const remaining = innerEnd - cursor;
      if (remaining < minDistrict) {
        const previous = districts[districts.length - 1];
        if (previous) previous.end = innerEnd;
        else districts.push({ start: cursor, end: innerEnd });
        break;
      }

      let districtLength = this.randomMultiple(cursor, salt, minDistrict, maxDistrict, 4);
      if (remaining <= maxDistrict + roadWidth + minDistrict) districtLength = remaining;
      else districtLength = Math.min(districtLength, remaining - roadWidth - minDistrict);
      districtLength = Math.max(minDistrict, districtLength);
      const blockEnd = Math.min(cursor + districtLength, innerEnd);
      if (blockEnd > cursor) districts.push({ start: cursor, end: blockEnd });
      cursor = blockEnd;

      if (cursor < innerEnd) {
        roads.push({ start: cursor, end: Math.min(cursor + roadWidth, innerEnd), kind: "main" });
        cursor += roadWidth;
      }
    }

    roads.push({ start: max - roadWidth, end: max, kind: "main" });
    return { roads, districts };
  }

  private addPlotsForDistrict(plots: CityPlot[], roads: CityRoad[], xDistrict: Band, zDistrict: Band) {
    const roll = random01(this.numericSeed, xDistrict.start, zDistrict.start, 860);
    const xDensity = roll < 0.22 ? "sparse" : roll < 0.44 ? "dense" : roll < 0.68 ? "normal" : "wide";
    const zDensity = roll < 0.22 ? "dense" : roll < 0.44 ? "sparse" : roll < 0.68 ? "normal" : "wide";
    const xSplit = this.splitDistrictAxis(xDistrict, xDistrict.start + zDistrict.start + 101, xDensity);
    const zSplit = this.splitDistrictAxis(zDistrict, xDistrict.start - zDistrict.start + 503, zDensity);
    const districtId = `${roads.length + 1}`;

    for (const lane of xSplit.lanes) {
      roads.push({
        id: `lane-x-${districtId}-${roads.length + 1}`,
        x: lane.start,
        z: zDistrict.start,
        width: bandSize(lane),
        depth: bandSize(zDistrict),
        axis: "z",
        kind: "lane"
      });
    }

    for (const lane of zSplit.lanes) {
      roads.push({
        id: `lane-z-${districtId}-${roads.length + 1}`,
        x: xDistrict.start,
        z: lane.start,
        width: bandSize(xDistrict),
        depth: bandSize(lane),
        axis: "x",
        kind: "lane"
      });
    }

    for (const xPlot of xSplit.plots) {
      for (const zPlot of zSplit.plots) {
        const plot: Omit<CityPlot, "id" | "area" | "price" | "zoning"> = {
          x: xPlot.start,
          z: zPlot.start,
          width: bandSize(xPlot),
          depth: bandSize(zPlot),
          roadEdges: this.roadEdgesForPlot(xDistrict, zDistrict, xPlot, zPlot, xSplit.lanes, zSplit.lanes)
        };
        const area = plot.width * plot.depth;
        const zoning = this.zoningForPlot(plot, area);
        plots.push({
          ...plot,
          id: `plot-${plots.length + 1}`,
          area,
          price: this.priceForPlot(plot, area, zoning),
          zoning
        });
      }
    }
  }

  private splitDistrictAxis(band: Band, salt: number, density: "sparse" | "normal" | "dense" | "wide"): DistrictAxisSplit {
    const min = this.options.minPlotSize!;
    const laneWidth = this.options.laneWidth;
    const maxMultiplier = density === "sparse" ? 1.8 : density === "wide" ? 1.45 : density === "normal" ? 1.2 : 1;
    const max = Math.max(min, Math.floor(this.options.maxPlotSize! * maxMultiplier));
    const plots: Band[] = [];
    const lanes: Band[] = [];
    let cursor = band.start;

    while (cursor < band.end) {
      const remaining = band.end - cursor;
      if (remaining <= max || remaining < min * 2 + laneWidth) {
        plots.push({ start: cursor, end: band.end });
        break;
      }

      const length = Math.min(this.randomMultiple(cursor, salt, min, max, 1), remaining - laneWidth - min);
      const plotEnd = Math.min(cursor + Math.max(min, length), band.end);
      plots.push({ start: cursor, end: plotEnd });
      cursor = plotEnd;

      if (band.end - cursor >= laneWidth + min) {
        lanes.push({ start: cursor, end: cursor + laneWidth });
        cursor += laneWidth;
      } else {
        plots[plots.length - 1]!.end = band.end;
        break;
      }
    }

    return { plots, lanes };
  }

  private roadEdgesForPlot(cityBlockX: Band, cityBlockZ: Band, plotX: Band, plotZ: Band, xLanes: Band[], zLanes: Band[]): CityPlot["roadEdges"] {
    const edges: CityPlot["roadEdges"] = [];
    if (plotZ.start === cityBlockZ.start || zLanes.some((lane) => lane.end === plotZ.start)) edges.push("north");
    if (plotX.end === cityBlockX.end || xLanes.some((lane) => lane.start === plotX.end)) edges.push("east");
    if (plotZ.end === cityBlockZ.end || zLanes.some((lane) => lane.start === plotZ.end)) edges.push("south");
    if (plotX.start === cityBlockX.start || xLanes.some((lane) => lane.end === plotX.start)) edges.push("west");
    return edges;
  }

  private zoningForPlot(plot: Omit<CityPlot, "id" | "area" | "price" | "zoning">, area: number): CityPlot["zoning"] {
    const roll = random01(this.numericSeed, plot.x, plot.z, 500);
    if (plot.roadEdges.length >= 2 && roll < 0.36) return "commercial";
    if (area >= 900 && roll < 0.58) return "mixed";
    if (roll > 0.94) return "civic";
    return "residential";
  }

  private priceForPlot(plot: Omit<CityPlot, "id" | "area" | "price" | "zoning">, area: number, zoning: CityPlot["zoning"]) {
    const distance = Math.hypot(plot.x + plot.width / 2, plot.z + plot.depth / 2);
    const centerPremium = Math.max(0, 1 - distance / Math.max(this.options.widthBlocks, this.options.depthBlocks));
    const zoningPremium = zoning === "commercial" ? 1.45 : zoning === "mixed" ? 1.25 : zoning === "civic" ? 1.1 : 1;
    const edgePremium = 1 + plot.roadEdges.length * 0.08;
    return Math.round((area * 4 + centerPremium * 900) * zoningPremium * edgePremium);
  }

  private randomMultiple(value: number, salt: number, min: number, max: number, step: number) {
    const steps = Math.max(1, Math.floor((max - min) / step));
    return min + Math.floor(random01(this.numericSeed, value, salt, salt + 100) * (steps + 1)) * step;
  }

  private findSpawnPoint() {
    const closestX = this.closestBandToOrigin(this.mainXRoadBands);
    const closestZ = this.closestBandToOrigin(this.mainZRoadBands);
    return {
      x: Math.floor((closestX.start + closestX.end) / 2),
      z: Math.floor((closestZ.start + closestZ.end) / 2)
    };
  }

  private closestBandToOrigin(bands: Band[]) {
    return bands.reduce((best, band) => {
      const bestCenter = Math.abs((best.start + best.end) / 2);
      const center = Math.abs((band.start + band.end) / 2);
      return center < bestCenter ? band : best;
    }, bands[0]!);
  }
}
