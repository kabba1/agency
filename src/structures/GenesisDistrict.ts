import { BlockId } from "../world/blocks";
import type { BlockState } from "../world/BlockShapes";
import type { CityPlot, StructureHours, StructureMetadata, StructureType, Vec3i } from "../shared/types";
import type { VoxelWorld } from "../world/VoxelWorld";

type Bounds = { x: number; z: number; width: number; depth: number; minY: number; maxY: number };
type RoadEdge = CityPlot["roadEdges"][number];
type ClaimedPlot = { plot: CityPlot; x: number; z: number; width: number; depth: number; edge: RoadEdge };

type BuildingSpec = {
  id: string;
  type: StructureType;
  name: string;
  preferredZoning?: CityPlot["zoning"];
  width: number;
  depth: number;
  height: number;
  wall: BlockId;
  roof: BlockId;
  floor: BlockId;
  tags: string[];
  extras?: Partial<StructureMetadata>;
};

const CITY_OWNER = "agency-city";
const FLOOR_OFFSET = 0;
const WALL_OFFSET = 1;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const centerDistance = (plot: CityPlot) => Math.hypot(plot.x + plot.width / 2, plot.z + plot.depth / 2);
const hour = (hours: number, minutes = 0) => hours * 60 + minutes;

const defaultHoursForStructure = (type: StructureType): StructureHours[] | undefined => {
  switch (type) {
    case "grocery":
    case "shop":
      return [{ label: "Open daily 06:00-22:00", opensAt: hour(6), closesAt: hour(22) }];
    case "workplace":
    case "workshop":
      return [{ label: "Work shifts 08:00-18:00", opensAt: hour(8), closesAt: hour(18) }];
    case "clinic":
      return [{ label: "Clinic counter 07:00-21:00", opensAt: hour(7), closesAt: hour(21) }];
    case "town_hall":
      return [{ label: "Civic desk 08:00-18:00", opensAt: hour(8), closesAt: hour(18) }];
    case "park":
      return [{ label: "Park hours 05:00-23:00", opensAt: hour(5), closesAt: hour(23) }];
    case "empty_lot":
      return [{ label: "Construction visits 06:00-21:00", opensAt: hour(6), closesAt: hour(21) }];
    default:
      return undefined;
  }
};

const randomFor = (seed: string, id: string, salt: number) => {
  let hash = 2166136261;
  const text = `${seed}:${id}:${salt}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967295;
};

const set = (world: VoxelWorld, x: number, y: number, z: number, block: BlockId, state: Partial<BlockState> = {}) => {
  world.setGeneratedBlock(x, y, z, block, state);
};

const fill = (
  world: VoxelWorld,
  x0: number,
  y0: number,
  z0: number,
  width: number,
  height: number,
  depth: number,
  block: BlockId,
  state: Partial<BlockState> = {}
) => {
  for (let x = x0; x < x0 + width; x += 1) {
    for (let y = y0; y < y0 + height; y += 1) {
      for (let z = z0; z < z0 + depth; z += 1) {
        set(world, x, y, z, block, state);
      }
    }
  }
};

const clear = (world: VoxelWorld, x0: number, y0: number, z0: number, width: number, height: number, depth: number) =>
  fill(world, x0, y0, z0, width, height, depth, BlockId.Air);

const claimPlot = (plots: CityPlot[], used: Set<string>, spec: Pick<BuildingSpec, "width" | "depth" | "preferredZoning">): CityPlot => {
  const preferred = plots
    .filter((plot) => !used.has(plot.id) && plot.width >= Math.min(spec.width, 8) && plot.depth >= Math.min(spec.depth, 8))
    .sort((a, b) => {
      const zoningScore = Number(b.zoning === spec.preferredZoning) - Number(a.zoning === spec.preferredZoning);
      if (zoningScore !== 0) return zoningScore;
      return centerDistance(a) - centerDistance(b);
    });
  const plot = preferred[0] ?? plots.find((candidate) => !used.has(candidate.id)) ?? plots[0]!;
  used.add(plot.id);
  return plot;
};

const layoutOnPlot = (plot: CityPlot, desiredWidth: number, desiredDepth: number): ClaimedPlot => {
  const edge = plot.roadEdges[0] ?? "north";
  const width = clamp(Math.min(desiredWidth, plot.width - 2), 5, Math.max(5, plot.width));
  const depth = clamp(Math.min(desiredDepth, plot.depth - 2), 5, Math.max(5, plot.depth));
  const x = Math.floor(plot.x + (plot.width - width) / 2);
  const z = Math.floor(plot.z + (plot.depth - depth) / 2);
  return { plot, x, z, width, depth, edge };
};

const localPoint = (layout: ClaimedPlot, lx: number, lz: number, y: number): Vec3i => ({
  x: layout.x + clamp(lx, 0, layout.width - 1),
  y,
  z: layout.z + clamp(lz, 0, layout.depth - 1)
});

const doorPoint = (layout: ClaimedPlot, y: number): Vec3i => {
  if (layout.edge === "south") return { x: layout.x + Math.floor(layout.width / 2), y, z: layout.z + layout.depth - 1 };
  if (layout.edge === "east") return { x: layout.x + layout.width - 1, y, z: layout.z + Math.floor(layout.depth / 2) };
  if (layout.edge === "west") return { x: layout.x, y, z: layout.z + Math.floor(layout.depth / 2) };
  return { x: layout.x + Math.floor(layout.width / 2), y, z: layout.z };
};

const edgeVector = (edge: RoadEdge) => {
  switch (edge) {
    case "south":
      return { x: 0, z: 1 };
    case "east":
      return { x: 1, z: 0 };
    case "west":
      return { x: -1, z: 0 };
    default:
      return { x: 0, z: -1 };
  }
};

const insidePlot = (layout: ClaimedPlot, x: number, z: number) =>
  x >= layout.plot.x && x < layout.plot.x + layout.plot.width && z >= layout.plot.z && z < layout.plot.z + layout.plot.depth;

const insideLayout = (layout: ClaimedPlot, x: number, z: number) =>
  x >= layout.x && x < layout.x + layout.width && z >= layout.z && z < layout.z + layout.depth;

const addGroundApron = (world: VoxelWorld, layout: ClaimedPlot, floorY: number, block: BlockId) => {
  for (let x = layout.x - 1; x <= layout.x + layout.width; x += 1) {
    for (let z = layout.z - 1; z <= layout.z + layout.depth; z += 1) {
      if (insideLayout(layout, x, z) || !insidePlot(layout, x, z)) continue;
      set(world, x, floorY, z, block);
    }
  }
};

const addEntryWalkway = (world: VoxelWorld, layout: ClaimedPlot, door: Vec3i, floorY: number, block: BlockId) => {
  const out = edgeVector(layout.edge);
  const side = layout.edge === "north" || layout.edge === "south" ? { x: 1, z: 0 } : { x: 0, z: 1 };
  for (let step = 0; step <= 3; step += 1) {
    for (let offset = -1; offset <= 1; offset += 1) {
      const x = door.x + out.x * step + side.x * offset;
      const z = door.z + out.z * step + side.z * offset;
      if (!insidePlot(layout, x, z)) continue;
      set(world, x, floorY, z, block);
    }
  }
};

const clearDoor = (world: VoxelWorld, point: Vec3i) => {
  set(world, point.x, point.y, point.z, BlockId.Air);
  set(world, point.x, point.y + 1, point.z, BlockId.Air);
};

const register = (
  world: VoxelWorld,
  seed: string,
  spec: BuildingSpec,
  layout: ClaimedPlot,
  floorY: number,
  maxY: number,
  actionPoints: StructureMetadata["actionPoints"]
) => {
  world.structures.add({
    id: spec.id,
    type: spec.type,
    name: spec.name,
    seed,
    origin: { x: layout.x, y: floorY, z: layout.z },
    footprint: { x: layout.x, z: layout.z, width: layout.width, depth: layout.depth, minY: floorY, maxY },
    entrancePoints: actionPoints.filter((point) => point.type === "door").map((point) => point.position),
    actionPoints,
    ownerId: CITY_OWNER,
    publicAccess: true,
    tags: ["genesis", ...spec.tags, `plot:${layout.plot.id}`],
    ...spec.extras,
    hours: spec.extras?.hours ?? defaultHoursForStructure(spec.type)
  });
};

const buildShell = (world: VoxelWorld, layout: ClaimedPlot, surfaceY: number, spec: BuildingSpec) => {
  const floorY = surfaceY + FLOOR_OFFSET;
  const wallY = surfaceY + WALL_OFFSET;
  const roofY = wallY + spec.height;
  const door = doorPoint(layout, wallY);

  clear(world, layout.x - 1, wallY, layout.z - 1, layout.width + 2, spec.height + 2, layout.depth + 2);
  addGroundApron(world, layout, floorY, BlockId.Floor);
  fill(world, layout.x, floorY, layout.z, layout.width, 1, layout.depth, spec.floor);
  addEntryWalkway(world, layout, door, floorY, BlockId.Floor);
  fill(world, layout.x, roofY, layout.z, layout.width, 1, layout.depth, spec.roof);

  for (let y = wallY; y < roofY; y += 1) {
    for (let x = layout.x; x < layout.x + layout.width; x += 1) {
      const trim = y === wallY || y === roofY - 1;
      const windowCell = !trim && (x - layout.x) % 3 === 1;
      if (windowCell) {
        set(world, x, y, layout.z, BlockId.Window, { rotation: 1 });
        set(world, x, y, layout.z + layout.depth - 1, BlockId.Window, { rotation: 1 });
      } else {
        set(world, x, y, layout.z, spec.wall);
        set(world, x, y, layout.z + layout.depth - 1, spec.wall);
      }
    }
    for (let z = layout.z; z < layout.z + layout.depth; z += 1) {
      const trim = y === wallY || y === roofY - 1;
      const windowCell = !trim && (z - layout.z) % 3 === 1;
      if (windowCell) {
        set(world, layout.x, y, z, BlockId.Window);
        set(world, layout.x + layout.width - 1, y, z, BlockId.Window);
      } else {
        set(world, layout.x, y, z, spec.wall);
        set(world, layout.x + layout.width - 1, y, z, spec.wall);
      }
    }
  }

  clearDoor(world, door);
  return { floorY, wallY, roofY, door };
};

const addApartment = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number) => {
  const spec: BuildingSpec = {
    id: "genesis-apartments",
    type: "apartment",
    name: "Genesis Apartments",
    width: 12,
    depth: 10,
    height: 4,
    wall: BlockId.Planks,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "residential",
    tags: ["home", "housing", "sleep"],
    extras: {
      services: [
        { id: "sleep", label: "Sleep" },
        { id: "rent_home", label: "Rent starter room" },
        { id: "wash_up", label: "Wash up" },
        { id: "eat_at_home", label: "Eat at home" },
        { id: "check_mail", label: "Check mail" },
        { id: "store_items", label: "Store items" }
      ],
      inventorySlots: [{ id: "shared-fridge", label: "Shared fridge", capacity: 30 }],
      rent: { pricePerDay: 6, currency: "credits", ownerId: CITY_OWNER },
      rules: [{ id: "quiet-hours", label: "Quiet hours after midnight", value: true }]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const bed = localPoint(layout, 1, layout.depth - 2, built.wallY);
  const fridge = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  const sink = localPoint(layout, layout.width - 2, 1, built.wallY);
  const table = localPoint(layout, Math.floor(layout.width / 2) - 1, Math.floor(layout.depth / 2), built.wallY);
  const seat = localPoint(layout, Math.floor(layout.width / 2) + 1, Math.floor(layout.depth / 2), built.wallY);
  const home = localPoint(layout, Math.floor(layout.width / 2), Math.floor(layout.depth / 2), built.wallY);
  const mailbox = localPoint(layout, Math.floor(layout.width / 2) - 1, 1, built.wallY);
  set(world, bed.x, bed.y, bed.z, BlockId.Bed);
  set(world, fridge.x, fridge.y, fridge.z, BlockId.Storage);
  set(world, sink.x, sink.y, sink.z, BlockId.Counter);
  set(world, table.x, table.y, table.z, BlockId.Counter);
  set(world, seat.x, seat.y, seat.z, BlockId.WoodSlab);
  set(world, mailbox.x, mailbox.y, mailbox.z, BlockId.Sign);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: "Apartment entry" },
    { id: `${spec.id}:home`, type: "home_anchor", position: home, label: "Starter home anchor" },
    { id: `${spec.id}:bed`, type: "bed", position: bed, label: "Shared bed" },
    { id: `${spec.id}:fridge`, type: "fridge", position: fridge, label: "Shared fridge" },
    { id: `${spec.id}:sink`, type: "sink", position: sink, label: "Apartment sink" },
    { id: `${spec.id}:table`, type: "dining_spot", position: table, label: "Shared kitchen table" },
    { id: `${spec.id}:seat`, type: "seat", position: seat, label: "Kitchen chair" },
    { id: `${spec.id}:mailbox`, type: "mailbox", position: mailbox, label: "Apartment mailbox" }
  ]);
};

const addGrocery = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number) => {
  const spec: BuildingSpec = {
    id: "genesis-grocery",
    type: "grocery",
    name: "Genesis Grocery",
    width: 10,
    depth: 8,
    height: 4,
    wall: BlockId.Brick,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "commercial",
    tags: ["commerce", "food", "shop"],
    extras: {
      jobs: [{ id: "grocer", title: "Grocer" }],
      services: [
        { id: "buy_food", label: "Buy food" },
        { id: "sell_food", label: "Sell food" },
        { id: "grab_snack", label: "Grab snack" }
      ],
      inventorySlots: [{ id: "grocery-shelves", label: "Grocery shelves", capacity: 80 }],
      inventory: [
        { id: "meal", label: "Simple meal", quantity: 40, price: 4 },
        { id: "groceries", label: "Groceries", quantity: 25, price: 10 }
      ],
      rules: [{ id: "public-store", label: "Open to all agents", value: true }]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const registerPoint = localPoint(layout, Math.floor(layout.width / 2), layout.depth - 2, built.wallY);
  const shelfA = localPoint(layout, 1, layout.depth - 2, built.wallY);
  const shelfB = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  const vending = localPoint(layout, layout.width - 2, 1, built.wallY);
  set(world, registerPoint.x, registerPoint.y, registerPoint.z, BlockId.Counter);
  set(world, shelfA.x, shelfA.y, shelfA.z, BlockId.Storage);
  set(world, shelfB.x, shelfB.y, shelfB.z, BlockId.Storage);
  set(world, vending.x, vending.y, vending.z, BlockId.Light);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: "Grocery entry" },
    { id: `${spec.id}:register`, type: "register", position: registerPoint, label: "Checkout register" },
    { id: `${spec.id}:shelf-a`, type: "shelf", position: shelfA, label: "Food shelf" },
    { id: `${spec.id}:shelf-b`, type: "shelf", position: shelfB, label: "Dry goods shelf" },
    { id: `${spec.id}:vending`, type: "vending_machine", position: vending, label: "Snack machine" }
  ]);
};

const addWorkplace = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number) => {
  const spec: BuildingSpec = {
    id: "genesis-workshop",
    type: "workplace",
    name: "Block Works",
    width: 11,
    depth: 8,
    height: 4,
    wall: BlockId.Stone,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "mixed",
    tags: ["job", "work", "materials"],
    extras: {
      jobs: [
        { id: "builder", title: "Builder" },
        { id: "materials_clerk", title: "Materials Clerk" }
      ],
      services: [
        { id: "earn_wage", label: "Work shift" },
        { id: "buy_materials", label: "Buy materials" },
        { id: "take_break", label: "Take break" },
        { id: "use_locker", label: "Use locker" }
      ],
      inventorySlots: [{ id: "material-rack", label: "Material rack", capacity: 120 }],
      inventory: [
        { id: "wood", label: "Wood bundle", quantity: 50, price: 3 },
        { id: "stone", label: "Stone bundle", quantity: 50, price: 3 }
      ]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const station = localPoint(layout, Math.floor(layout.width / 2), Math.floor(layout.depth / 2), built.wallY);
  const storage = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  const locker = localPoint(layout, 1, layout.depth - 2, built.wallY);
  const breakSpot = localPoint(layout, 1, 1, built.wallY);
  const vending = localPoint(layout, layout.width - 2, 1, built.wallY);
  set(world, station.x, station.y, station.z, BlockId.Workbench);
  set(world, storage.x, storage.y, storage.z, BlockId.Storage);
  set(world, locker.x, locker.y, locker.z, BlockId.Storage);
  set(world, breakSpot.x, breakSpot.y, breakSpot.z, BlockId.WoodSlab);
  set(world, vending.x, vending.y, vending.z, BlockId.Light);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: "Workshop entry" },
    { id: `${spec.id}:clock-in`, type: "job_station", position: station, label: "Clock-in workbench" },
    { id: `${spec.id}:storage`, type: "storage", position: storage, label: "Material storage" },
    { id: `${spec.id}:locker`, type: "locker", position: locker, label: "Worker locker" },
    { id: `${spec.id}:break`, type: "break_spot", position: breakSpot, label: "Break chair" },
    { id: `${spec.id}:vending`, type: "vending_machine", position: vending, label: "Workshop snack machine" }
  ]);
};

const addClinic = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number) => {
  const spec: BuildingSpec = {
    id: "genesis-clinic",
    type: "clinic",
    name: "Patch Clinic",
    width: 9,
    depth: 8,
    height: 4,
    wall: BlockId.Glass,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "civic",
    tags: ["health", "heal", "civic"],
    extras: {
      jobs: [{ id: "clinician", title: "Clinician" }],
      services: [
        { id: "heal", label: "Treat injury" },
        { id: "rest", label: "Rest and recover" },
        { id: "get_medicine", label: "Get medicine" }
      ],
      inventory: [{ id: "medicine", label: "Medicine", quantity: 20, price: 12 }]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const desk = localPoint(layout, Math.floor(layout.width / 2), 1, built.wallY);
  const bed = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  const medicine = localPoint(layout, 1, layout.depth - 2, built.wallY);
  const waitingSeat = localPoint(layout, 1, 1, built.wallY);
  set(world, desk.x, desk.y, desk.z, BlockId.Counter);
  set(world, bed.x, bed.y, bed.z, BlockId.Bed);
  set(world, medicine.x, medicine.y, medicine.z, BlockId.Storage);
  set(world, waitingSeat.x, waitingSeat.y, waitingSeat.z, BlockId.WoodSlab);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: "Clinic entry" },
    { id: `${spec.id}:desk`, type: "desk", position: desk, label: "Clinic desk" },
    { id: `${spec.id}:bed`, type: "clinic_bed", position: bed, label: "Treatment bed" },
    { id: `${spec.id}:medicine`, type: "medicine_cabinet", position: medicine, label: "Medicine cabinet" },
    { id: `${spec.id}:waiting-seat`, type: "seat", position: waitingSeat, label: "Clinic waiting chair" }
  ]);
};

const addSecurity = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number) => {
  const spec: BuildingSpec = {
    id: "genesis-security",
    type: "police_station",
    name: "Civic Security",
    width: 9,
    depth: 7,
    height: 4,
    wall: BlockId.Stone,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "civic",
    tags: ["safety", "conflict", "civic"],
    extras: {
      jobs: [{ id: "security_officer", title: "Security Officer" }],
      services: [
        { id: "report_conflict", label: "Report conflict" },
        { id: "deescalate", label: "De-escalate dispute" }
      ],
      rules: [{ id: "non_graphic_conflict", label: "Conflicts resolve as events, not visible violence", value: true }]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const desk = localPoint(layout, Math.floor(layout.width / 2), Math.floor(layout.depth / 2), built.wallY);
  const storage = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  set(world, desk.x, desk.y, desk.z, BlockId.Counter);
  set(world, storage.x, storage.y, storage.z, BlockId.Storage);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: "Security entry" },
    { id: `${spec.id}:desk`, type: "desk", position: desk, label: "Report desk" },
    { id: `${spec.id}:storage`, type: "storage", position: storage, label: "Evidence storage" }
  ]);
};

const addTownHall = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number) => {
  const spec: BuildingSpec = {
    id: "genesis-town-hall",
    type: "town_hall",
    name: "Genesis Town Hall",
    width: 11,
    depth: 9,
    height: 5,
    wall: BlockId.Brick,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "civic",
    tags: ["civic", "rules", "plots"],
    extras: {
      jobs: [{ id: "clerk", title: "Town Clerk" }],
      services: [
        { id: "buy_plot", label: "Buy plot" },
        { id: "view_rules", label: "View civic rules" },
        { id: "post_notice", label: "Post notice" },
        { id: "pay_rent", label: "Pay rent" },
        { id: "check_mail", label: "Check civic mail" }
      ],
      rules: [
        { id: "starter-tax", label: "Starter city sales tax percent", value: 4 },
        { id: "plots-require-payment", label: "Agents must buy plots before building", value: true }
      ]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const desk = localPoint(layout, Math.floor(layout.width / 2), 1, built.wallY);
  const notice = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  const mailbox = localPoint(layout, 1, layout.depth - 2, built.wallY);
  const waitingSeat = localPoint(layout, 1, 1, built.wallY);
  set(world, desk.x, desk.y, desk.z, BlockId.Counter);
  set(world, notice.x, notice.y, notice.z, BlockId.Sign);
  set(world, mailbox.x, mailbox.y, mailbox.z, BlockId.Sign);
  set(world, waitingSeat.x, waitingSeat.y, waitingSeat.z, BlockId.WoodSlab);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: "Town hall entry" },
    { id: `${spec.id}:desk`, type: "desk", position: desk, label: "Clerk desk" },
    { id: `${spec.id}:notice`, type: "notice_board", position: notice, label: "Notice board" },
    { id: `${spec.id}:mailbox`, type: "mailbox", position: mailbox, label: "Civic mailbox" },
    { id: `${spec.id}:waiting-seat`, type: "seat", position: waitingSeat, label: "Town hall waiting chair" }
  ]);
};

const addPark = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number) => {
  const floorY = surfaceY + FLOOR_OFFSET;
  clear(world, layout.x, floorY, layout.z, layout.width, 4, layout.depth);
  fill(world, layout.x, floorY, layout.z, layout.width, 1, layout.depth, BlockId.Grass);
  for (let x = layout.x; x < layout.x + layout.width; x += 1) {
    set(world, x, floorY, layout.z, BlockId.Fence);
    set(world, x, floorY, layout.z + layout.depth - 1, BlockId.Fence);
  }
  for (let z = layout.z; z < layout.z + layout.depth; z += 1) {
    set(world, layout.x, floorY, z, BlockId.Fence);
    set(world, layout.x + layout.width - 1, floorY, z, BlockId.Fence);
  }
  const meet = localPoint(layout, Math.floor(layout.width / 2), Math.floor(layout.depth / 2), floorY + 1);
  const benchA = localPoint(layout, 2, Math.floor(layout.depth / 2), floorY + 1);
  const benchB = localPoint(layout, layout.width - 3, Math.floor(layout.depth / 2), floorY + 1);
  set(world, benchA.x, benchA.y, benchA.z, BlockId.WoodSlab);
  set(world, benchB.x, benchB.y, benchB.z, BlockId.WoodSlab);
  world.structures.add({
    id: "genesis-park",
    type: "park",
    name: "Commons Park",
    seed,
    origin: { x: layout.x, y: floorY, z: layout.z },
    footprint: { x: layout.x, z: layout.z, width: layout.width, depth: layout.depth, minY: floorY, maxY: floorY + 3 },
    entrancePoints: [meet],
    actionPoints: [
      { id: "genesis-park:meet", type: "meeting_spot", position: meet, label: "Park gathering spot" },
      { id: "genesis-park:bench-a", type: "meeting_spot", position: benchA, label: "West bench" },
      { id: "genesis-park:bench-b", type: "meeting_spot", position: benchB, label: "East bench" },
      { id: "genesis-park:seat-a", type: "seat", position: benchA, label: "West park bench seat" },
      { id: "genesis-park:seat-b", type: "seat", position: benchB, label: "East park bench seat" }
    ],
    ownerId: CITY_OWNER,
    publicAccess: true,
    services: [{ id: "socialize", label: "Socialize" }],
    hours: defaultHoursForStructure("park"),
    tags: ["genesis", "park", "social", `plot:${layout.plot.id}`]
  });
};

const addBuildableLot = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number) => {
  const floorY = surfaceY + FLOOR_OFFSET;
  clear(world, layout.x, floorY, layout.z, layout.width, 4, layout.depth);
  fill(world, layout.x, floorY, layout.z, layout.width, 1, layout.depth, BlockId.Sand);
  const anchor = localPoint(layout, Math.floor(layout.width / 2), Math.floor(layout.depth / 2), floorY + 1);
  set(world, anchor.x, anchor.y, anchor.z, BlockId.Sign);
  world.structures.add({
    id: "genesis-buildable-lot",
    type: "empty_lot",
    name: "Starter Buildable Lot",
    seed,
    origin: { x: layout.x, y: floorY, z: layout.z },
    footprint: { x: layout.x, z: layout.z, width: layout.width, depth: layout.depth, minY: floorY, maxY: floorY + 3 },
    entrancePoints: [anchor],
    actionPoints: [{ id: "genesis-buildable-lot:anchor", type: "construction_anchor", position: anchor, label: "Construction anchor" }],
    ownerId: CITY_OWNER,
    publicAccess: true,
    services: [{ id: "build_structure", label: "Build structure" }],
    rules: [
      { id: "requires_plot_purchase", label: "Agent must own this plot before building", value: true },
      { id: "requires_materials", label: "Agent must bring materials before construction", value: true }
    ],
    rent: { pricePerDay: 0, currency: "credits", ownerId: CITY_OWNER },
    hours: defaultHoursForStructure("empty_lot"),
    tags: ["genesis", "buildable", "construction", `plot:${layout.plot.id}`]
  });
};

const addRoofGarden = (world: VoxelWorld, layout: ClaimedPlot, roofY: number, seed: string, salt = 41) => {
  if (layout.width < 7 || layout.depth < 7 || randomFor(seed, layout.plot.id, salt) < 0.48) return;
  const x0 = layout.x + 2;
  const z0 = layout.z + 2;
  const width = Math.max(2, layout.width - 4);
  const depth = Math.max(2, layout.depth - 4);
  fill(world, x0, roofY + 1, z0, width, 1, depth, BlockId.Grass);
  for (let x = x0; x < x0 + width; x += 1) {
    if ((x + z0) % 3 === 0) set(world, x, roofY + 2, z0, BlockId.Leaves);
    if ((x + z0 + depth) % 4 === 0) set(world, x, roofY + 2, z0 + depth - 1, BlockId.Leaves);
  }
};

const addStreetFacingSign = (world: VoxelWorld, layout: ClaimedPlot, wallY: number, colorBlock: BlockId) => {
  const door = doorPoint(layout, wallY);
  const signY = wallY + 3;
  if (layout.edge === "south" || layout.edge === "north") {
    set(world, door.x, signY, door.z, BlockId.Sign, { rotation: 1 });
    set(world, clamp(door.x + 1, layout.x, layout.x + layout.width - 1), signY, door.z, colorBlock, { half: "top" });
  } else {
    set(world, door.x, signY, door.z, BlockId.Sign);
    set(world, door.x, signY, clamp(door.z + 1, layout.z, layout.z + layout.depth - 1), colorBlock, { half: "top" });
  }
};

const addExpandedApartment = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number, index: number) => {
  const spec: BuildingSpec = {
    id: `expanded-apartments-${index}`,
    type: "apartment",
    name: `Block ${index} Apartments`,
    width: layout.width,
    depth: layout.depth,
    height: 4 + Math.floor(randomFor(seed, layout.plot.id, 101) * 5),
    wall: index % 3 === 0 ? BlockId.Brick : BlockId.Planks,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "residential",
    tags: ["home", "housing", "sleep", "expanded-city"],
    extras: {
      services: [
        { id: "sleep", label: "Sleep" },
        { id: "rent_home", label: "Rent apartment" },
        { id: "wash_up", label: "Wash up" },
        { id: "eat_at_home", label: "Eat at home" },
        { id: "check_mail", label: "Check mail" }
      ],
      inventorySlots: [{ id: `${index}-resident-fridge`, label: "Resident fridge", capacity: 24 }],
      rent: { pricePerDay: 5 + (index % 4), currency: "credits", ownerId: CITY_OWNER },
      rules: [{ id: "shared-building", label: "Shared residential building", value: true }]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const bedA = localPoint(layout, 1, layout.depth - 2, built.wallY);
  const bedB = localPoint(layout, Math.max(1, Math.floor(layout.width / 2) - 1), layout.depth - 2, built.wallY);
  const fridge = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  const sink = localPoint(layout, layout.width - 2, 1, built.wallY);
  const table = localPoint(layout, Math.floor(layout.width / 2), Math.floor(layout.depth / 2), built.wallY);
  const seat = localPoint(layout, Math.floor(layout.width / 2) + 1, Math.floor(layout.depth / 2), built.wallY);
  const home = localPoint(layout, Math.floor(layout.width / 2), Math.floor(layout.depth / 2), built.wallY);
  const mailbox = localPoint(layout, Math.max(1, Math.floor(layout.width / 2) - 2), 1, built.wallY);
  set(world, bedA.x, bedA.y, bedA.z, BlockId.Bed);
  if (layout.width >= 9) set(world, bedB.x, bedB.y, bedB.z, BlockId.Bed);
  set(world, fridge.x, fridge.y, fridge.z, BlockId.Storage);
  set(world, sink.x, sink.y, sink.z, BlockId.Counter);
  set(world, table.x, table.y, table.z, BlockId.Counter);
  set(world, seat.x, seat.y, seat.z, BlockId.WoodSlab);
  set(world, mailbox.x, mailbox.y, mailbox.z, BlockId.Sign);
  addRoofGarden(world, layout, built.roofY, seed, 100 + index);
  addBalconies(world, layout, built.wallY, built.roofY, BlockId.WoodSlab);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: `${spec.name} entry` },
    { id: `${spec.id}:home`, type: "home_anchor", position: home, label: `${spec.name} home anchor` },
    { id: `${spec.id}:bed-a`, type: "bed", position: bedA, label: `${spec.name} bed` },
    { id: `${spec.id}:bed-b`, type: "bed", position: bedB, label: `${spec.name} second bed` },
    { id: `${spec.id}:fridge`, type: "fridge", position: fridge, label: `${spec.name} fridge` },
    { id: `${spec.id}:sink`, type: "sink", position: sink, label: `${spec.name} sink` },
    { id: `${spec.id}:table`, type: "dining_spot", position: table, label: `${spec.name} kitchen table` },
    { id: `${spec.id}:seat`, type: "seat", position: seat, label: `${spec.name} chair` },
    { id: `${spec.id}:mailbox`, type: "mailbox", position: mailbox, label: `${spec.name} mailbox` }
  ]);
};

const addBalconies = (world: VoxelWorld, layout: ClaimedPlot, wallY: number, roofY: number, block: BlockId, interval = 3) => {
  if (layout.width < 8 || layout.depth < 8 || roofY - wallY < 5) return;
  const northSouth = layout.edge === "north" || layout.edge === "south";
  for (let y = wallY + 2; y < roofY - 1; y += interval) {
    if (northSouth) {
      const z = layout.edge === "south" ? layout.z + layout.depth : layout.z - 1;
      for (let x = layout.x + 2; x < layout.x + layout.width - 2; x += 4) {
        set(world, x, y, z, block, { half: "bottom" });
        set(world, x + 1, y, z, block, { half: "bottom" });
        set(world, x, y + 1, z, BlockId.Fence);
        set(world, x + 1, y + 1, z, BlockId.Fence);
      }
      continue;
    }
    const x = layout.edge === "east" ? layout.x + layout.width : layout.x - 1;
    for (let z = layout.z + 2; z < layout.z + layout.depth - 2; z += 4) {
      set(world, x, y, z, block, { half: "bottom" });
      set(world, x, y, z + 1, block, { half: "bottom" });
      set(world, x, y + 1, z, BlockId.Fence);
      set(world, x, y + 1, z + 1, BlockId.Fence);
    }
  }
};

const addExpandedMarket = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number, index: number) => {
  const names = ["Canopy Market", "Sunline Foods", "Corner Pantry", "Fresh Loop Market"];
  const spec: BuildingSpec = {
    id: `expanded-market-${index}`,
    type: "grocery",
    name: names[(index - 1) % names.length]!,
    width: layout.width,
    depth: layout.depth,
    height: 4 + Math.floor(randomFor(seed, layout.plot.id, 201) * 3),
    wall: index % 2 === 0 ? BlockId.Brick : BlockId.Planks,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "commercial",
    tags: ["commerce", "food", "shop", "expanded-city"],
    extras: {
      jobs: [{ id: "grocer", title: "Grocer" }],
      services: [
        { id: "buy_food", label: "Buy food" },
        { id: "grab_snack", label: "Grab snack" },
        { id: "restock_shelves", label: "Restock shelves" }
      ],
      inventorySlots: [{ id: `${index}-market-shelves`, label: "Market shelves", capacity: 96 }],
      inventory: [
        { id: "meal", label: "Packed meal", quantity: 45 + index * 4, price: 4 },
        { id: "groceries", label: "Groceries", quantity: 28 + index * 3, price: 10 },
        { id: "snack", label: "Snack", quantity: 35, price: 2 }
      ],
      rules: [{ id: "public-market", label: "Public food service", value: true }]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const registerPoint = localPoint(layout, Math.floor(layout.width / 2), layout.depth - 2, built.wallY);
  const shelfA = localPoint(layout, 1, layout.depth - 2, built.wallY);
  const shelfB = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  const shelfC = localPoint(layout, Math.floor(layout.width / 2), 1, built.wallY);
  const vending = localPoint(layout, layout.width - 2, 1, built.wallY);
  set(world, registerPoint.x, registerPoint.y, registerPoint.z, BlockId.Counter);
  set(world, shelfA.x, shelfA.y, shelfA.z, BlockId.Storage);
  set(world, shelfB.x, shelfB.y, shelfB.z, BlockId.Storage);
  set(world, shelfC.x, shelfC.y, shelfC.z, BlockId.Storage);
  set(world, vending.x, vending.y, vending.z, BlockId.Light);
  addRoofGarden(world, layout, built.roofY, seed, 220 + index);
  addStreetFacingSign(world, layout, built.wallY, BlockId.Light);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: `${spec.name} entry` },
    { id: `${spec.id}:register`, type: "register", position: registerPoint, label: `${spec.name} checkout` },
    { id: `${spec.id}:shelf-a`, type: "shelf", position: shelfA, label: `${spec.name} produce shelf` },
    { id: `${spec.id}:shelf-b`, type: "shelf", position: shelfB, label: `${spec.name} dry goods shelf` },
    { id: `${spec.id}:shelf-c`, type: "shelf", position: shelfC, label: `${spec.name} front display` },
    { id: `${spec.id}:vending`, type: "vending_machine", position: vending, label: `${spec.name} snack machine` }
  ]);
};

const addExpandedWorkplace = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number, index: number) => {
  const names = ["Maker Yard", "Signal Works", "Northline Depot", "Civic Fabrication"];
  const spec: BuildingSpec = {
    id: `expanded-workplace-${index}`,
    type: "workplace",
    name: names[(index - 1) % names.length]!,
    width: layout.width,
    depth: layout.depth,
    height: 5 + Math.floor(randomFor(seed, layout.plot.id, 301) * 5),
    wall: index % 2 === 0 ? BlockId.Stone : BlockId.Brick,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "mixed",
    tags: ["job", "work", "materials", "expanded-city"],
    extras: {
      jobs: [
        { id: "builder", title: "Builder" },
        { id: "materials_clerk", title: "Materials Clerk" }
      ],
      services: [
        { id: "earn_wage", label: "Work shift" },
        { id: "buy_materials", label: "Buy materials" },
        { id: "take_break", label: "Take break" },
        { id: "use_locker", label: "Use locker" }
      ],
      inventorySlots: [{ id: `${index}-material-rack`, label: "Material rack", capacity: 140 }],
      inventory: [
        { id: "wood", label: "Wood bundle", quantity: 65, price: 3 },
        { id: "stone", label: "Stone bundle", quantity: 65, price: 3 },
        { id: "fixtures", label: "Fixture kit", quantity: 18, price: 12 }
      ]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const stationA = localPoint(layout, Math.floor(layout.width / 2), Math.floor(layout.depth / 2), built.wallY);
  const stationB = localPoint(layout, Math.max(1, Math.floor(layout.width / 2) - 2), Math.floor(layout.depth / 2), built.wallY);
  const storage = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  const locker = localPoint(layout, 1, layout.depth - 2, built.wallY);
  const breakSpot = localPoint(layout, 1, 1, built.wallY);
  const vending = localPoint(layout, layout.width - 2, 1, built.wallY);
  set(world, stationA.x, stationA.y, stationA.z, BlockId.Workbench);
  set(world, stationB.x, stationB.y, stationB.z, BlockId.Workbench);
  set(world, storage.x, storage.y, storage.z, BlockId.Storage);
  set(world, locker.x, locker.y, locker.z, BlockId.Storage);
  set(world, breakSpot.x, breakSpot.y, breakSpot.z, BlockId.WoodSlab);
  set(world, vending.x, vending.y, vending.z, BlockId.Light);
  addStreetFacingSign(world, layout, built.wallY, BlockId.Workbench);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: `${spec.name} entry` },
    { id: `${spec.id}:station-a`, type: "job_station", position: stationA, label: `${spec.name} main station` },
    { id: `${spec.id}:station-b`, type: "workbench", position: stationB, label: `${spec.name} build bench` },
    { id: `${spec.id}:storage`, type: "storage", position: storage, label: `${spec.name} material storage` },
    { id: `${spec.id}:locker`, type: "locker", position: locker, label: `${spec.name} worker locker` },
    { id: `${spec.id}:break`, type: "break_spot", position: breakSpot, label: `${spec.name} break stool` },
    { id: `${spec.id}:vending`, type: "vending_machine", position: vending, label: `${spec.name} snack machine` }
  ]);
};

const addExpandedClinic = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number, index: number) => {
  const spec: BuildingSpec = {
    id: `expanded-clinic-${index}`,
    type: "clinic",
    name: index === 1 ? "Harborlight Clinic" : "South Commons Clinic",
    width: layout.width,
    depth: layout.depth,
    height: 4 + Math.floor(randomFor(seed, layout.plot.id, 401) * 3),
    wall: BlockId.Glass,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "civic",
    tags: ["health", "heal", "civic", "expanded-city"],
    extras: {
      jobs: [{ id: "clinician", title: "Clinician" }],
      services: [
        { id: "heal", label: "Treat injury" },
        { id: "rest", label: "Rest and recover" },
        { id: "get_medicine", label: "Get medicine" }
      ],
      inventorySlots: [{ id: `${index}-clinic-supplies`, label: "Clinic supplies", capacity: 32 }],
      inventory: [{ id: "medicine", label: "Medicine", quantity: 30, price: 12 }]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const desk = localPoint(layout, Math.floor(layout.width / 2), 1, built.wallY);
  const bedA = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  const bedB = localPoint(layout, Math.max(1, layout.width - 4), layout.depth - 2, built.wallY);
  const medicine = localPoint(layout, 1, layout.depth - 2, built.wallY);
  const waitingSeat = localPoint(layout, 1, 1, built.wallY);
  set(world, desk.x, desk.y, desk.z, BlockId.Counter);
  set(world, bedA.x, bedA.y, bedA.z, BlockId.Bed);
  if (bedB.x !== bedA.x || bedB.z !== bedA.z) set(world, bedB.x, bedB.y, bedB.z, BlockId.Bed);
  set(world, medicine.x, medicine.y, medicine.z, BlockId.Storage);
  set(world, waitingSeat.x, waitingSeat.y, waitingSeat.z, BlockId.WoodSlab);
  addStreetFacingSign(world, layout, built.wallY, BlockId.Glass);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: `${spec.name} entry` },
    { id: `${spec.id}:desk`, type: "desk", position: desk, label: `${spec.name} check-in desk` },
    { id: `${spec.id}:bed-a`, type: "clinic_bed", position: bedA, label: `${spec.name} treatment bed` },
    { id: `${spec.id}:bed-b`, type: "clinic_bed", position: bedB, label: `${spec.name} recovery bed` },
    { id: `${spec.id}:medicine`, type: "medicine_cabinet", position: medicine, label: `${spec.name} medicine cabinet` },
    { id: `${spec.id}:waiting-seat`, type: "seat", position: waitingSeat, label: `${spec.name} waiting chair` }
  ]);
};

const addExpandedCivic = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number, index: number) => {
  const names = ["Plot Office", "Civic Records", "Notice Exchange"];
  const spec: BuildingSpec = {
    id: `expanded-civic-${index}`,
    type: "town_hall",
    name: names[(index - 1) % names.length]!,
    width: layout.width,
    depth: layout.depth,
    height: 5 + Math.floor(randomFor(seed, layout.plot.id, 501) * 4),
    wall: BlockId.Brick,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "civic",
    tags: ["civic", "plots", "mail", "expanded-city"],
    extras: {
      jobs: [{ id: "clerk", title: "Town Clerk" }],
      services: [
        { id: "buy_plot", label: "Buy plot" },
        { id: "view_rules", label: "View civic rules" },
        { id: "post_notice", label: "Post notice" },
        { id: "pay_rent", label: "Pay rent" },
        { id: "check_mail", label: "Check mail" }
      ],
      rules: [
        { id: `${index}-plot-registry`, label: "Plots require registered ownership", value: true },
        { id: `${index}-city-growth`, label: "Expansion lots unlock as the city grows", value: true }
      ]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const desk = localPoint(layout, Math.floor(layout.width / 2), 1, built.wallY);
  const notice = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  const mailbox = localPoint(layout, 1, layout.depth - 2, built.wallY);
  const waitingSeat = localPoint(layout, 1, 1, built.wallY);
  set(world, desk.x, desk.y, desk.z, BlockId.Counter);
  set(world, notice.x, notice.y, notice.z, BlockId.Sign);
  set(world, mailbox.x, mailbox.y, mailbox.z, BlockId.Sign);
  set(world, waitingSeat.x, waitingSeat.y, waitingSeat.z, BlockId.WoodSlab);
  addRoofGarden(world, layout, built.roofY, seed, 520 + index);
  addStreetFacingSign(world, layout, built.wallY, BlockId.Sign);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: `${spec.name} entry` },
    { id: `${spec.id}:desk`, type: "desk", position: desk, label: `${spec.name} clerk desk` },
    { id: `${spec.id}:notice`, type: "notice_board", position: notice, label: `${spec.name} notice board` },
    { id: `${spec.id}:mailbox`, type: "mailbox", position: mailbox, label: `${spec.name} mail counter` },
    { id: `${spec.id}:waiting-seat`, type: "seat", position: waitingSeat, label: `${spec.name} waiting chair` }
  ]);
};

const addExpandedSecurity = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number, index: number) => {
  const spec: BuildingSpec = {
    id: `expanded-security-${index}`,
    type: "police_station",
    name: index === 1 ? "Harbor Watch" : "District Watch",
    width: layout.width,
    depth: layout.depth,
    height: 5,
    wall: BlockId.Stone,
    roof: BlockId.Roof,
    floor: BlockId.Floor,
    preferredZoning: "civic",
    tags: ["safety", "conflict", "civic", "expanded-city"],
    extras: {
      jobs: [{ id: "security_officer", title: "Security Officer" }],
      services: [
        { id: "report_conflict", label: "Report conflict" },
        { id: "deescalate", label: "De-escalate dispute" },
        { id: "lost_found", label: "Lost and found" }
      ],
      rules: [{ id: "visible-safety", label: "Conflict is resolved through events and reports", value: true }]
    }
  };
  const built = buildShell(world, layout, surfaceY, spec);
  const desk = localPoint(layout, Math.floor(layout.width / 2), Math.floor(layout.depth / 2), built.wallY);
  const storage = localPoint(layout, layout.width - 2, layout.depth - 2, built.wallY);
  const seat = localPoint(layout, 1, 1, built.wallY);
  set(world, desk.x, desk.y, desk.z, BlockId.Counter);
  set(world, storage.x, storage.y, storage.z, BlockId.Storage);
  set(world, seat.x, seat.y, seat.z, BlockId.WoodSlab);
  addStreetFacingSign(world, layout, built.wallY, BlockId.Light);
  register(world, seed, spec, layout, built.floorY, built.roofY, [
    { id: `${spec.id}:door`, type: "door", position: built.door, label: `${spec.name} entry` },
    { id: `${spec.id}:desk`, type: "desk", position: desk, label: `${spec.name} report desk` },
    { id: `${spec.id}:storage`, type: "storage", position: storage, label: `${spec.name} evidence storage` },
    { id: `${spec.id}:seat`, type: "seat", position: seat, label: `${spec.name} waiting bench` }
  ]);
};

const addExpandedPark = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number, index: number) => {
  const floorY = surfaceY + FLOOR_OFFSET;
  const names = ["Founders Green", "Market Steps", "Lantern Court", "Pocket Commons", "West Garden"];
  clear(world, layout.x, floorY, layout.z, layout.width, 4, layout.depth);
  fill(world, layout.x, floorY, layout.z, layout.width, 1, layout.depth, BlockId.Grass);
  const centerX = Math.floor(layout.width / 2);
  const centerZ = Math.floor(layout.depth / 2);
  for (let x = layout.x + 1; x < layout.x + layout.width - 1; x += 1) set(world, x, floorY, layout.z + centerZ, BlockId.Sand);
  for (let z = layout.z + 1; z < layout.z + layout.depth - 1; z += 1) set(world, layout.x + centerX, floorY, z, BlockId.Sand);
  for (let x = layout.x; x < layout.x + layout.width; x += 1) {
    set(world, x, floorY + 1, layout.z, BlockId.Fence);
    set(world, x, floorY + 1, layout.z + layout.depth - 1, BlockId.Fence);
  }
  for (let z = layout.z; z < layout.z + layout.depth; z += 1) {
    set(world, layout.x, floorY + 1, z, BlockId.Fence);
    set(world, layout.x + layout.width - 1, floorY + 1, z, BlockId.Fence);
  }
  const meet = localPoint(layout, centerX, centerZ, floorY + 1);
  const benchA = localPoint(layout, 2, centerZ, floorY + 1);
  const benchB = localPoint(layout, layout.width - 3, centerZ, floorY + 1);
  const benchC = localPoint(layout, centerX, 2, floorY + 1);
  const fountain = localPoint(layout, centerX, Math.min(layout.depth - 2, centerZ + 2), floorY + 1);
  set(world, benchA.x, benchA.y, benchA.z, BlockId.WoodSlab);
  set(world, benchB.x, benchB.y, benchB.z, BlockId.WoodSlab);
  set(world, benchC.x, benchC.y, benchC.z, BlockId.WoodSlab);
  set(world, fountain.x, fountain.y, fountain.z, BlockId.Water);
  world.structures.add({
    id: `expanded-park-${index}`,
    type: "park",
    name: names[(index - 1) % names.length]!,
    seed,
    origin: { x: layout.x, y: floorY, z: layout.z },
    footprint: { x: layout.x, z: layout.z, width: layout.width, depth: layout.depth, minY: floorY, maxY: floorY + 3 },
    entrancePoints: [meet],
    actionPoints: [
      { id: `expanded-park-${index}:meet`, type: "meeting_spot", position: meet, label: "Gathering circle" },
      { id: `expanded-park-${index}:bench-a`, type: "seat", position: benchA, label: "West bench" },
      { id: `expanded-park-${index}:bench-b`, type: "seat", position: benchB, label: "East bench" },
      { id: `expanded-park-${index}:bench-c`, type: "seat", position: benchC, label: "North bench" },
      { id: `expanded-park-${index}:water`, type: "water_source", position: fountain, label: "Small fountain" }
    ],
    ownerId: CITY_OWNER,
    publicAccess: true,
    services: [
      { id: "socialize", label: "Socialize" },
      { id: "rest", label: "Rest outside" }
    ],
    hours: defaultHoursForStructure("park"),
    tags: ["genesis", "park", "social", "expanded-city", `plot:${layout.plot.id}`]
  });
};

const addExpandedBuildableLot = (world: VoxelWorld, seed: string, layout: ClaimedPlot, surfaceY: number, index: number) => {
  const floorY = surfaceY + FLOOR_OFFSET;
  clear(world, layout.x, floorY, layout.z, layout.width, 4, layout.depth);
  fill(world, layout.x, floorY, layout.z, layout.width, 1, layout.depth, BlockId.Sand);
  const anchor = localPoint(layout, Math.floor(layout.width / 2), Math.floor(layout.depth / 2), floorY + 1);
  const materials = localPoint(layout, Math.max(1, Math.floor(layout.width / 2) - 2), Math.floor(layout.depth / 2), floorY + 1);
  set(world, anchor.x, anchor.y, anchor.z, BlockId.Sign);
  set(world, materials.x, materials.y, materials.z, BlockId.Storage);
  world.structures.add({
    id: `expanded-buildable-lot-${index}`,
    type: "empty_lot",
    name: `Future Lot ${index}`,
    seed,
    origin: { x: layout.x, y: floorY, z: layout.z },
    footprint: { x: layout.x, z: layout.z, width: layout.width, depth: layout.depth, minY: floorY, maxY: floorY + 3 },
    entrancePoints: [anchor],
    actionPoints: [
      { id: `expanded-buildable-lot-${index}:anchor`, type: "construction_anchor", position: anchor, label: "Construction anchor" },
      { id: `expanded-buildable-lot-${index}:materials`, type: "storage", position: materials, label: "Starter material cache" }
    ],
    ownerId: CITY_OWNER,
    publicAccess: true,
    services: [
      { id: "buy_plot", label: "Buy plot" },
      { id: "build_structure", label: "Build structure" },
      { id: "store_materials", label: "Store materials" }
    ],
    rules: [
      { id: "requires_plot_purchase", label: "Agent must own this plot before building", value: true },
      { id: "requires_materials", label: "Agent must bring materials before construction", value: true }
    ],
    rent: { pricePerDay: 0, currency: "credits", ownerId: CITY_OWNER },
    hours: defaultHoursForStructure("empty_lot"),
    tags: ["genesis", "buildable", "construction", "expanded-city", `plot:${layout.plot.id}`]
  });
};

const addCuratedCityExpansion = (world: VoxelWorld, seed: string, plots: CityPlot[], used: Set<string>, surfaceY: number) => {
  const claim = (width: number, depth: number, preferredZoning: CityPlot["zoning"]) => {
    if (used.size >= plots.length) return null;
    return layoutOnPlot(claimPlot(plots, used, { width, depth, preferredZoning }), width, depth);
  };

  const addIfClaimed = (layout: ClaimedPlot | null, build: (layout: ClaimedPlot) => void) => {
    if (layout) build(layout);
  };

  const apartmentSizes = [
    [12, 10],
    [10, 12],
    [14, 12],
    [9, 11],
    [13, 10],
    [11, 9],
    [15, 12]
  ] as const;
  apartmentSizes.forEach(([width, depth], index) => {
    addIfClaimed(claim(width, depth, "residential"), (layout) => addExpandedApartment(world, seed, layout, surfaceY, index + 1));
  });

  const marketSizes = [
    [11, 9],
    [10, 10],
    [13, 9],
    [9, 8]
  ] as const;
  marketSizes.forEach(([width, depth], index) => addIfClaimed(claim(width, depth, "commercial"), (layout) => addExpandedMarket(world, seed, layout, surfaceY, index + 1)));

  const workplaceSizes = [
    [12, 10],
    [13, 11],
    [10, 10],
    [14, 10]
  ] as const;
  workplaceSizes.forEach(([width, depth], index) => addIfClaimed(claim(width, depth, "mixed"), (layout) => addExpandedWorkplace(world, seed, layout, surfaceY, index + 1)));

  for (let index = 1; index <= 2; index += 1) addIfClaimed(claim(10 + index, 9, "civic"), (layout) => addExpandedClinic(world, seed, layout, surfaceY, index));
  for (let index = 1; index <= 3; index += 1) addIfClaimed(claim(10 + (index % 2), 9 + (index % 2), "civic"), (layout) => addExpandedCivic(world, seed, layout, surfaceY, index));
  addIfClaimed(claim(10, 8, "civic"), (layout) => addExpandedSecurity(world, seed, layout, surfaceY, 1));

  const parkSizes = [
    [14, 12],
    [12, 10],
    [10, 10],
    [16, 12],
    [9, 9]
  ] as const;
  parkSizes.forEach(([width, depth], index) => addIfClaimed(claim(width, depth, index % 2 === 0 ? "residential" : "mixed"), (layout) => addExpandedPark(world, seed, layout, surfaceY, index + 1)));

  const futureLotSizes = [
    [10, 10],
    [12, 9],
    [9, 9],
    [11, 8],
    [14, 10],
    [8, 8],
    [13, 11],
    [10, 8]
  ] as const;
  futureLotSizes.forEach(([width, depth], index) => addIfClaimed(claim(width, depth, "mixed"), (layout) => addExpandedBuildableLot(world, seed, layout, surfaceY, index + 1)));
};

export const generateGenesisDistrict = (world: VoxelWorld) => {
  if (world.generation.kind !== "flat" || !world.cityMap) return;
  const seed = world.seed;
  const surfaceY = world.cityMap.surfaceY;
  const plots = [...world.cityMap.plots].sort((a, b) => centerDistance(a) - centerDistance(b));
  if (plots.length === 0) return;

  const used = new Set<string>();
  const claim = (spec: Pick<BuildingSpec, "width" | "depth" | "preferredZoning">) => layoutOnPlot(claimPlot(plots, used, spec), spec.width, spec.depth);

  addTownHall(world, seed, claim({ width: 11, depth: 9, preferredZoning: "civic" }), surfaceY);
  addApartment(world, seed, claim({ width: 12, depth: 10, preferredZoning: "residential" }), surfaceY);
  addGrocery(world, seed, claim({ width: 10, depth: 8, preferredZoning: "commercial" }), surfaceY);
  addWorkplace(world, seed, claim({ width: 11, depth: 8, preferredZoning: "mixed" }), surfaceY);
  addClinic(world, seed, claim({ width: 9, depth: 8, preferredZoning: "civic" }), surfaceY);
  addSecurity(world, seed, claim({ width: 9, depth: 7, preferredZoning: "civic" }), surfaceY);
  addPark(world, seed, claim({ width: 14, depth: 12, preferredZoning: "residential" }), surfaceY);
  addBuildableLot(world, seed, claim({ width: 10, depth: 10, preferredZoning: "mixed" }), surfaceY);
  addCuratedCityExpansion(world, seed, plots, used, surfaceY);
};
