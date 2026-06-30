import * as THREE from "three";
import { BlockId } from "../world/blocks";

export type AtlasTile =
  | "grassTop"
  | "grassSide"
  | "dirt"
  | "stone"
  | "sand"
  | "water"
  | "wood"
  | "leaves"
  | "planks"
  | "glass"
  | "brick"
  | "road"
  | "roof"
  | "light"
  | "door"
  | "window"
  | "fence"
  | "storage"
  | "bed"
  | "counter"
  | "workbench"
  | "sign"
  | "floor";

export type TextureAtlas = {
  texture: THREE.CanvasTexture;
  tileUv: Record<AtlasTile, { u0: number; v0: number; u1: number; v1: number }>;
};

const TILE_SIZE = 32;
const COLUMNS = 8;
const ROWS = 3;

const tileOrder: AtlasTile[] = [
  "grassTop",
  "grassSide",
  "dirt",
  "stone",
  "sand",
  "water",
  "wood",
  "leaves",
  "planks",
  "glass",
  "brick",
  "road",
  "roof",
  "light",
  "door",
  "window",
  "fence",
  "storage",
  "bed",
  "counter",
  "workbench",
  "sign",
  "floor"
];

const fill = (ctx: CanvasRenderingContext2D, ox: number, oy: number, color: string) => {
  ctx.fillStyle = color;
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);
};

const edge = (ctx: CanvasRenderingContext2D, ox: number, oy: number, light = "rgba(255,255,255,0.18)", dark = "rgba(30,34,38,0.18)") => {
  ctx.fillStyle = light;
  ctx.fillRect(ox, oy, TILE_SIZE, 3);
  ctx.fillRect(ox, oy, 3, TILE_SIZE);
  ctx.fillStyle = dark;
  ctx.fillRect(ox, oy + TILE_SIZE - 3, TILE_SIZE, 3);
  ctx.fillRect(ox + TILE_SIZE - 3, oy, 3, TILE_SIZE);
};

const stripe = (ctx: CanvasRenderingContext2D, ox: number, oy: number, vertical: boolean, offset: number, color: string, width = 2) => {
  ctx.fillStyle = color;
  if (vertical) ctx.fillRect(ox + offset, oy, width, TILE_SIZE);
  else ctx.fillRect(ox, oy + offset, TILE_SIZE, width);
};

const drawFlat = (ctx: CanvasRenderingContext2D, ox: number, oy: number, base: string) => {
  fill(ctx, ox, oy, base);
  edge(ctx, ox, oy);
};

const drawGrassTop = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#86bf6e");
  ctx.fillStyle = "rgba(255, 246, 196, 0.12)";
  ctx.beginPath();
  ctx.arc(ox + 10, oy + 11, 8, 0, Math.PI * 2);
  ctx.arc(ox + 24, oy + 22, 7, 0, Math.PI * 2);
  ctx.fill();
  edge(ctx, ox, oy, "rgba(255,255,255,0.12)", "rgba(45,83,47,0.16)");
};

const drawGrassSide = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#a57754");
  ctx.fillStyle = "#7fb966";
  ctx.fillRect(ox, oy, TILE_SIZE, 9);
  ctx.fillStyle = "rgba(69, 70, 49, 0.12)";
  ctx.fillRect(ox, oy + 13, TILE_SIZE, 3);
  edge(ctx, ox, oy);
};

const drawStone = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#8c9797");
  stripe(ctx, ox, oy, false, 10, "rgba(64,72,74,0.18)");
  stripe(ctx, ox, oy, false, 21, "rgba(64,72,74,0.14)");
  stripe(ctx, ox, oy, true, 15, "rgba(255,255,255,0.11)");
  edge(ctx, ox, oy);
};

const drawWater = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#8ac7e5");
  stripe(ctx, ox, oy, false, 8, "rgba(255,255,255,0.28)", 3);
  stripe(ctx, ox, oy, false, 20, "rgba(78,145,178,0.22)", 3);
};

const drawWood = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#a87945");
  stripe(ctx, ox, oy, true, 8, "rgba(94,62,35,0.22)");
  stripe(ctx, ox, oy, true, 20, "rgba(255,218,145,0.13)");
  edge(ctx, ox, oy);
};

const drawLeaves = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#68a85d");
  ctx.fillStyle = "rgba(52, 115, 58, 0.26)";
  ctx.beginPath();
  ctx.arc(ox + 8, oy + 8, 7, 0, Math.PI * 2);
  ctx.arc(ox + 22, oy + 16, 9, 0, Math.PI * 2);
  ctx.arc(ox + 13, oy + 25, 7, 0, Math.PI * 2);
  ctx.fill();
  edge(ctx, ox, oy, "rgba(255,255,255,0.1)", "rgba(37,80,41,0.16)");
};

const drawPlanks = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#bd8b54");
  stripe(ctx, ox, oy, false, 10, "rgba(85,52,29,0.2)");
  stripe(ctx, ox, oy, false, 21, "rgba(85,52,29,0.18)");
  stripe(ctx, ox, oy, true, 16, "rgba(255,225,158,0.14)");
  edge(ctx, ox, oy);
};

const drawGlass = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#a7d7df");
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.fillRect(ox + 5, oy + 5, 5, 18);
  ctx.fillRect(ox + 12, oy + 5, 2, 10);
  edge(ctx, ox, oy, "rgba(255,255,255,0.34)", "rgba(36,91,108,0.22)");
};

const drawBrick = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#d58f77");
  stripe(ctx, ox, oy, false, 10, "rgba(99,54,48,0.2)");
  stripe(ctx, ox, oy, false, 21, "rgba(99,54,48,0.2)");
  stripe(ctx, ox, oy, true, 8, "rgba(99,54,48,0.14)");
  stripe(ctx, ox, oy, true, 23, "rgba(255,237,197,0.1)");
  edge(ctx, ox, oy);
};

const drawRoad = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#58656b");
  stripe(ctx, ox, oy, false, 6, "rgba(255,255,255,0.08)");
  stripe(ctx, ox, oy, false, 22, "rgba(31,39,43,0.14)");
  edge(ctx, ox, oy, "rgba(255,255,255,0.07)", "rgba(25,31,35,0.18)");
};

const drawRoof = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#b85d5a");
  stripe(ctx, ox, oy, false, 8, "rgba(86,37,39,0.2)");
  stripe(ctx, ox, oy, false, 18, "rgba(255,218,181,0.12)");
  edge(ctx, ox, oy);
};

const drawDoor = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  fill(ctx, ox, oy, "#9b6840");
  stripe(ctx, ox, oy, true, 15, "rgba(58,35,23,0.24)");
  ctx.fillStyle = "#f2c75a";
  ctx.fillRect(ox + 22, oy + 16, 4, 4);
  edge(ctx, ox, oy);
};

const drawWindow = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
  drawGlass(ctx, ox, oy);
  stripe(ctx, ox, oy, true, 15, "rgba(43,74,84,0.34)", 3);
  stripe(ctx, ox, oy, false, 15, "rgba(43,74,84,0.34)", 3);
};

const drawFurniture = (ctx: CanvasRenderingContext2D, ox: number, oy: number, base: string, accent: string) => {
  fill(ctx, ox, oy, base);
  ctx.fillStyle = accent;
  ctx.fillRect(ox + 5, oy + 5, TILE_SIZE - 10, 7);
  ctx.fillRect(ox + 7, oy + 20, TILE_SIZE - 14, 4);
  edge(ctx, ox, oy);
};

export const createTextureAtlas = (): TextureAtlas => {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE * COLUMNS;
  canvas.height = TILE_SIZE * ROWS;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create texture atlas canvas.");

  ctx.imageSmoothingEnabled = true;
  const tileUv = {} as TextureAtlas["tileUv"];

  tileOrder.forEach((tile, index) => {
    const col = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const ox = col * TILE_SIZE;
    const oy = row * TILE_SIZE;

    switch (tile) {
      case "grassTop":
        drawGrassTop(ctx, ox, oy);
        break;
      case "grassSide":
        drawGrassSide(ctx, ox, oy);
        break;
      case "dirt":
        drawFlat(ctx, ox, oy, "#9b7052");
        break;
      case "stone":
        drawStone(ctx, ox, oy);
        break;
      case "sand":
        drawFlat(ctx, ox, oy, "#e1c878");
        break;
      case "water":
        drawWater(ctx, ox, oy);
        break;
      case "wood":
        drawWood(ctx, ox, oy);
        break;
      case "leaves":
        drawLeaves(ctx, ox, oy);
        break;
      case "planks":
        drawPlanks(ctx, ox, oy);
        break;
      case "glass":
        drawGlass(ctx, ox, oy);
        break;
      case "brick":
        drawBrick(ctx, ox, oy);
        break;
      case "road":
        drawRoad(ctx, ox, oy);
        break;
      case "roof":
        drawRoof(ctx, ox, oy);
        break;
      case "light":
        drawFlat(ctx, ox, oy, "#ffdf79");
        break;
      case "door":
        drawDoor(ctx, ox, oy);
        break;
      case "window":
        drawWindow(ctx, ox, oy);
        break;
      case "fence":
        drawFurniture(ctx, ox, oy, "#9b7144", "rgba(62,38,22,0.22)");
        break;
      case "storage":
        drawFurniture(ctx, ox, oy, "#a87945", "rgba(74,46,26,0.25)");
        break;
      case "bed":
        drawFurniture(ctx, ox, oy, "#de817f", "#fff0c4");
        break;
      case "counter":
        drawFurniture(ctx, ox, oy, "#b98b58", "#f1d092");
        break;
      case "workbench":
        drawFurniture(ctx, ox, oy, "#9f7648", "#28313a");
        break;
      case "sign":
        drawFurniture(ctx, ox, oy, "#d9b56c", "rgba(63,48,30,0.32)");
        break;
      case "floor":
        drawFlat(ctx, ox, oy, "#d0bb8f");
        break;
    }

    const pad = 0.001;
    tileUv[tile] = {
      u0: col / COLUMNS + pad,
      v0: 1 - (row + 1) / ROWS + pad,
      u1: (col + 1) / COLUMNS - pad,
      v1: 1 - row / ROWS - pad
    };
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;

  return { texture, tileUv };
};

export const blockFaceTiles = (block: BlockId): AtlasTile[] => {
  switch (block) {
    case BlockId.Grass:
      return ["grassSide", "grassSide", "grassTop", "dirt", "grassSide", "grassSide"];
    case BlockId.Dirt:
      return ["dirt", "dirt", "dirt", "dirt", "dirt", "dirt"];
    case BlockId.Stone:
      return ["stone", "stone", "stone", "stone", "stone", "stone"];
    case BlockId.Sand:
      return ["sand", "sand", "sand", "sand", "sand", "sand"];
    case BlockId.Water:
      return ["water", "water", "water", "water", "water", "water"];
    case BlockId.Wood:
      return ["wood", "wood", "wood", "wood", "wood", "wood"];
    case BlockId.Leaves:
      return ["leaves", "leaves", "leaves", "leaves", "leaves", "leaves"];
    case BlockId.Planks:
      return ["planks", "planks", "planks", "planks", "planks", "planks"];
    case BlockId.Glass:
      return ["glass", "glass", "glass", "glass", "glass", "glass"];
    case BlockId.Brick:
      return ["brick", "brick", "brick", "brick", "brick", "brick"];
    case BlockId.Road:
      return ["road", "road", "road", "road", "road", "road"];
    case BlockId.Roof:
      return ["roof", "roof", "roof", "roof", "roof", "roof"];
    case BlockId.Light:
      return ["light", "light", "light", "light", "light", "light"];
    case BlockId.Door:
      return ["door", "door", "door", "door", "door", "door"];
    case BlockId.Window:
      return ["window", "window", "window", "window", "window", "window"];
    case BlockId.Fence:
      return ["fence", "fence", "fence", "fence", "fence", "fence"];
    case BlockId.Storage:
      return ["storage", "storage", "storage", "storage", "storage", "storage"];
    case BlockId.Bed:
      return ["bed", "bed", "bed", "bed", "bed", "bed"];
    case BlockId.Counter:
      return ["counter", "counter", "counter", "counter", "counter", "counter"];
    case BlockId.Workbench:
      return ["workbench", "workbench", "workbench", "workbench", "workbench", "workbench"];
    case BlockId.Sign:
      return ["sign", "sign", "sign", "sign", "sign", "sign"];
    case BlockId.Floor:
      return ["floor", "floor", "floor", "floor", "floor", "floor"];
    case BlockId.StoneSlab:
      return ["stone", "stone", "stone", "stone", "stone", "stone"];
    case BlockId.WoodSlab:
      return ["planks", "planks", "planks", "planks", "planks", "planks"];
    case BlockId.StoneStairs:
      return ["stone", "stone", "stone", "stone", "stone", "stone"];
    case BlockId.WoodStairs:
      return ["planks", "planks", "planks", "planks", "planks", "planks"];
    default:
      return ["dirt", "dirt", "dirt", "dirt", "dirt", "dirt"];
  }
};
