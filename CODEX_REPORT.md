# CODEX Report

## Current Direction

The project has shifted from chasing a full Minecraft clone or builder sandbox toward a voxel-city agent simulation. The app now opens as Agency, loads Genesis District automatically, and exposes one primary action: spawn an agent. The old builder/generator UI is no longer part of the visible product surface.

## Reference-Informed Engine Choices

Reviewed open-source voxel/Minecraft-like projects for patterns, not copied code:

- `noa`: browser voxel engine architecture and separation of engine modules.
- `voxel-engine / voxel.js`: JavaScript voxel toolkit conventions.
- `prismarine-viewer`: browser voxel viewing/rendering reference.
- `binary-greedy-meshing`: chunk meshing performance direction.

Applied lessons:

- Keep simulation/world data separate from Three.js objects.
- Use chunk-local rebuilds instead of whole-world remeshing.
- Use voxel-grid raycasting instead of expensive scene mesh raycasting.
- Prefer visible-face mesh generation as the current baseline.
- Treat semantic structures, action points, and event logs as the core simulation interface.

Updated agent reference direction:

- `google-deepmind/concordia`: useful as a model for the later agent cognition/social simulation layer, especially componentized agents, memories, and game-master style orchestration. It should sit behind an optional adapter because the local MVP must keep working without LLM/API keys.

## Implemented In This Pass

- Added a configurable flat plot-world generator with width, depth, road width, and layer stack controls.
- Made the app open into a flat plot world by default while keeping the terrain generator as a fallback button.
- Generated orthogonal road networks with 5-block main roads and 3-block internal plot roads.
- Grouped varied rectangular/square plots inside larger district blocks.
- Added plot metadata for id, position, dimensions, area, price, zoning, and road-edge access.
- Exposed city metadata through debug state as `window.agencyWorldDebug.cityMap`.
- Added a generated Genesis District with semantic apartments, grocery, workplace, clinic, police station, town hall, park, and a buildable lot.
- Added semantic building metadata for action points, jobs, services, inventory, rent, rules, and ownership placeholders.
- Exposed semantic city summary data through debug state as `window.agencyWorldDebug.semantic`.
- Added semantic structure details to the block inspector when aiming at generated buildings.
- Replaced the visible sandbox UI with a compact Agency HUD.
- Removed visible seed/world-generator, inventory, hotbar, save/load, schematic import, and builder panels from the main app.
- Disabled click-to-break/place editing in the main app.
- Added a `Spawn Agent` button.
- Added local mock agents with wallet-like ids, deterministic DNA, needs, money, job, home, inventory, relationships, memories, current action, and target state.
- Added a first rule-based agent action loop using semantic building action points.
- Added simple rendered agent bodies synced from simulation state.
- Added a HUD agent list and recent event feed.
- Moved flat-world spawn to the nearest generated road intersection.
- Preserved flat-world generator settings in world export/import and named local saves.
- Added `.schem` and `.schematic` import that converts Minecraft schematic files into the existing pasteable blueprint format.
- Added best-effort Minecraft block mapping into the engine's original block vocabulary.
- Added simple box-building generation for reliable cube-shaped starter buildings.
- Removed flat-world horizon LOD after visual flicker/z-fighting; distant viewing now uses all visible real chunk meshes.
- Disabled generated starter settlement by default.
- Expanded block catalog to 26 placeable blocks.
- Added block categories and descriptions.
- Added procedural textures for the expanded block catalog.
- Added searchable creative palette.
- Expanded hotbar to 9 slots.
- Added block inspector with coordinates, category, solidity, transparency, and description.
- Added fly/noclip builder mode.
- Added sprint/faster fly movement.
- Added block pick with `Q`.
- Added undo/redo for individual block edits.
- Added named local world saves.
- Added JSON export/import hooks.
- Added live debug fields for fly mode, undo count, redo count, FPS, draw calls, and triangles.
- Fixed stale generated-town docs and changed docs to engine-first framing.

## Partial Shape And Rotation Pass

- Added rotation-aware block states to edit patches, saves, exports, and imports.
- Added a shared block-shape helper used by both rendering and player collision.
- Added Stone Slab, Wood Slab, Stone Stairs, and Wood Stairs blocks.
- Changed doors, windows, fences, signs, storage, workbench, bed, counter, and light blocks from full cubes to simple partial placeholder shapes.
- Added `R` key and Rotate button placement controls.
- Updated block inspector and diagnostics to show shape and rotation details.
- Updated undo so undoing a placed block back to air clears the patch entry instead of leaving a stale edit.

## Builder Tool Pass

- Added a compact Builder HUD panel.
- Added region point selection with Set A and Set B using the currently targeted block.
- Added region Fill using the selected palette/hotbar block and current rotation.
- Added region Replace using the targeted block type as the source and the selected palette/hotbar block as the destination.
- Added region Copy and Paste with an in-memory clipboard.
- Added blueprint JSON export/import for copied regions.
- Added paste rotation based on the current placement rotation.
- Added grouped edit actions so fill, replace, and paste undo/redo as one builder action.
- Added deferred patch saving for batch edits so localStorage is written once per region action instead of once per block.
- Added chunk-key rebuilds for batch edits so region tools rebuild touched chunks once instead of repeatedly remeshing the same chunks.

## Visual Builder Feedback Pass

- Added `BuilderOverlays` as a separate Three.js view layer for builder guides.
- Added a yellow region outline for the active A/B selection.
- Added a cyan paste bounding outline at the current targeted face.
- Added translucent instanced preview blocks for copied non-air blueprint blocks.
- Added overlay caching so previews update only when region, clipboard, anchor, or rotation changes.
- Added debug fields for region volume and paste anchor.

## Brush And Paste Warning Pass

- Added brush size controls for 1x1, 3x3, and 5x5 face-aligned click edits.
- Added `B` keyboard cycling for brush sizes.
- Routed left-click break and right-click place through grouped edit actions so brush edits undo/redo as one action.
- Added player-intersection guarding for brush placement.
- Added paste overwrite counting to debug state and Builder panel status.
- Added warm warning tint for paste previews when the current paste would overwrite existing blocks.

## Paste Collision Mode Pass

- Added Builder panel paste mode controls.
- Added Replace mode for full blueprint stamping, including copied air cells.
- Added Merge mode for stamping only non-air blueprint cells.
- Added Empty mode for placing non-air blueprint cells only into empty target cells.
- Added paste write, overwrite, and blocked counts to debug state and Builder panel status.
- Reused the paste warning tint for overwrite or blocked-cell previews.
- Added an inline favicon so browser smoke tests do not report a missing icon request.

## Inventory And Settings Pass

- Moved the creative block palette into an on-demand Inventory panel opened with `E`.
- Added category tabs for All, Terrain, Build, Utility, and Furniture.
- Added Inventory and Settings buttons to the main seed panel.
- Added Settings panel opened with `O`.
- Added render scale selection wired into the Three.js renderer pixel ratio.
- Added HUD panel toggles for World, Block inspector, and Builder panels.
- Added pointer unlock behavior when opening inventory/settings.
- Added `Escape` handling to close open panels.

## Assignable Hotbar Pass

- Replaced the fixed first-nine-block hotbar with assignable hotbar slots.
- Added a builder-focused default hotbar: Grass, Dirt, Stone, Wood, Planks, Glass, Brick, Road, and Light.
- Made inventory palette clicks assign the clicked block into the active hotbar slot.
- Made number keys select hotbar slots through the app/UI boundary instead of hard-coded block IDs.
- Made `Q` pick the targeted block into the active hotbar slot.
- Persisted hotbar assignments in `localStorage`.
- Added hotbar slot state to debug output.

## Render Distance And Sensitivity Pass

- Added view distance settings for Near, Balanced, and Full chunk visibility.
- Kept world generation and saves unchanged while culling chunk meshes outside the selected view range.
- Added visible chunk counts to debug state and diagnostics.
- Added mouse look sensitivity setting wired into pointer-lock controls.
- Added a live sensitivity percentage readout in Settings.

## Face-Aware Partial Placement Pass

- Added top/bottom half state for slabs and stairs.
- Updated slab and stair render/collision boxes so top-half and bottom-half pieces match physically.
- Added raycast hit-point and local-hit metadata.
- Added face-aware placement: top faces place bottom pieces, undersides place top pieces, and side faces use high/low aim.
- Persisted half state through edit patches, world import/export, blueprint copy/import, undo/redo, and reload.
- Updated the block inspector to show top/bottom half details.

## Stair Corner Variant Pass

- Added straight, inner-left, inner-right, outer-left, and outer-right stair shape variants.
- Auto-resolved stair shape from neighboring same-half stairs so corners emerge from placement rather than extra controls.
- Kept stair shape derived from neighborhood instead of storing it in save data.
- Updated stair render/collision boxes so straight, inner, outer, bottom-half, and top-half stairs stay physically consistent.
- Updated the block inspector to show resolved non-straight stair shape details.

## Detailed Silhouette Pass

- Replaced single-box utility/furniture placeholders with multi-box silhouettes.
- Added chest/lid/latch shape detail for Storage.
- Added legs, frame, mattress, and pillow shape detail for Bed.
- Added body, countertop, and back-riser shape detail for Counter.
- Added legs, shelf, tabletop, and tool-rail shape detail for Workbench.
- Added post/board detail for Sign and base/post/lantern detail for Light.
- Added richer Door, Window, and Fence box silhouettes.
- Kept silhouettes in the shared block-shape helper so rendering and collision stay matched.
- Fixed cube face culling beside partial blocks so slabs, counters, beds, workbenches, and similar shapes do not hide the supporting block surface behind their empty space.

## Lighting And Ambient Occlusion Pass

- Added vertex color output to chunk mesh data.
- Added directional face shading for voxel faces.
- Added corner ambient occlusion for full-cube visible faces using nearby solid neighbors.
- Kept lighting baked into chunk meshes so runtime rendering remains cheap and world state stays separate from Three.js objects.
- Added Smooth lighting setting that rebuilds chunks when toggled.
- Added smooth lighting to debug state.

## Recent Performance Work

- Replaced scene mesh raycasting with direct voxel DDA raycasting.
- Replaced whole-world remesh-on-edit with chunk-local remeshing.
- Fixed finite-world generation so out-of-bounds chunks are not generated.
- Replaced whole-cube rendering with visible-face meshes.
- Fixed visible-face UV orientation for grass-side textures.
- Lowered device pixel ratio cap and removed preserved drawing buffers.
- Switched voxel terrain materials to cheaper unlit textured materials.

## Flat Plot World And Schematic Import Pass

- Added `FlatWorldGenerator` alongside the existing terrain generator.
- Added rectangular world bounds support for width/depth city worlds.
- Added deterministic road-band and lot subdivision generation.
- Kept city plot metadata separate from visible voxel blocks.
- Added a flat-world UI for dimensions, road width, and layer text like `Stone:4,Dirt:2,Grass:1`.
- Added `.schem` parsing for Sponge palette/block-data schematics.
- Added fallback classic `.schematic` parsing for common legacy block ids.
- Reused the existing Builder clipboard/paste system for imported buildings.
- Added `SimpleBuildingBlueprints` for hollow box buildings with floor, walls, windows, roof, and a door opening.
- Added Builder controls for building width, depth, height, wall material, roof material, and Box Build generation.
- Limited Box Build wall/roof options to full cube materials and made generated buildings sparse non-air blueprints that default to Merge paste mode.
- Removed the flat-world horizon LOD group to avoid depth fighting and flicker during movement.
- Raised camera far range and added an All view-distance setting for real generated chunks.

## Genesis District Semantic City Pass

- Added `GenesisDistrict` generation for flat worlds with city metadata.
- Claimed central plots for starter buildings instead of relying on random generated structures.
- Added apartments with door, home anchor, bed, and fridge action points.
- Added grocery services for buying/selling food, inventory items, and a grocer job.
- Added workplace services for earning wages and buying materials, plus builder/materials-clerk jobs.
- Added clinic services for healing/rest and clinician job metadata.
- Added police/security services for reporting and deescalating conflicts.
- Added town hall services for buying plots, viewing rules, and posting notices.
- Added a park social action point and a buildable lot construction anchor.
- Kept these structures as generated baseline world data so user edits and saved patches can still override blocks later.

## Agent Spawn Simplification Pass

- Rebuilt `index.html` around the Agency sim surface instead of the sandbox builder surface.
- Replaced `src/main.ts` with a slim boot path that loads the fixed Genesis District and wires only HUD/status/spawn behavior.
- Replaced the old broad sandbox CSS with a low-chrome Agency HUD.
- Deleted the previous schematic importer, builder overlay, and simple box-building generator modules.
- Deleted the old procedural terrain generator, starter-settlement generator, and block interaction controller modules.
- Replaced the previous broad sandbox `AgencyWorldApp` with a slimmer sim viewer runtime.
- Added `AgentSimulation` as a simulation-owned state module separate from Three.js meshes.
- Spawned agents from the button with local wallet-like ids and deterministic DNA.
- Let agents choose destinations from semantic action points such as park meeting spots, grocery register, job station, bed, clinic bed, and construction anchor.
- Added simple event and memory updates when agents work, shop, sleep, heal, socialize, or inspect the buildable lot.
- Added simple Three.js agent bodies whose colors come from DNA and whose transforms follow simulation state.
- Grounded rendered agents against the voxel surface beneath them so they read as walking on the city floor.
- Kept hidden flat-world/Genesis generation code because the sim still needs a default city stage.

## Agent Pathfinding Pass

- Added `AgentPathfinder` for voxel-aware A* routing over the flat city grid.
- Agents now receive waypoint routes instead of moving directly to target action points.
- Door blocks are treated as passable agent space.
- Walls, furniture, counters, beds, workbenches, fences, and other solid non-door blocks block agent routes.
- Route selection prefers roads and interior floors over grass/soft surfaces.
- Target action points on solid objects resolve to nearby walkable cells.
- Failed routes no longer fall back to wall-cutting direct movement.

## Research-Informed Agent Mind Pass

- Reworked `AgentSimulation` around a local no-key cognition loop inspired by the provided papers and Concordia.
- Added a world clock with sim-time event stamps.
- Expanded memories into typed entries: observations, events, plans, and reflections.
- Added memory importance scores and tags so later decisions can use recent relevant context.
- Added per-agent goals, plans, decision reasons, and reflections.
- Replaced simple priority action choice with scored candidate actions based on needs, DNA traits, memories, and semantic building targets.
- Kept action outcomes source-of-truth in local sim state: food costs money, work earns money and drains energy, sleep restores energy, clinic restores health, social actions update relationships.
- Added nearby-agent observations and lightweight relationship changes.
- Exposed richer agent cognition state in the HUD and `window.agencyWorldDebug`.
- Kept the system deterministic and local so it still works without wallet, backend, or AI API keys.

## Verification

- `npm run typecheck`
- `npm run build`
- Agent spawn browser verification:
  - Confirmed the app title is `Agency`.
  - Confirmed `Spawn Agent` creates one agent and updates the button to `Spawn Another`.
  - Confirmed generated agent state includes local wallet id, DNA, needs, job, home, target, and current action.
  - Confirmed the first agent moves toward a semantic destination.
  - Confirmed old builder/generator UI elements are absent from the DOM.
  - Confirmed Genesis District semantic debug data still reports 8 structures and 24 action points.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/agency-spawn-agent-smoke.png`.
- Agent pathfinding browser verification:
  - Confirmed spawned agent target includes a multi-waypoint route.
  - Confirmed route waypoints are adjacent grid steps.
  - Confirmed route segments are axis-aligned, avoiding compressed diagonal wall cuts.
  - Confirmed the agent moves along the route.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/agency-agent-pathfinding-smoke.png`.
- Research-informed agent brain browser verification:
  - Spawned three agents.
  - Confirmed HUD/debug world time advances.
  - Confirmed every agent exposes a goal, plan, utility-style decision reason, reflection, memories, and route.
  - Confirmed nearby agents generate social observations and relationship entries.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/agency-research-brain-smoke.png`.
- Genesis District semantic browser verification:
  - Confirmed the default flat world reports 8 semantic buildings and 24 action points.
  - Confirmed required building types exist: apartment, grocery, workplace, clinic, police station, town hall, park, and empty lot.
  - Confirmed required services exist: sleep, buy food, earn wage, heal, report conflict, buy plot, socialize, and build structure.
  - Confirmed required jobs exist: grocer, builder, clinician, security officer, and clerk.
  - Confirmed required action point types exist: home anchor, register, job station, clinic bed, notice board, construction anchor, and meeting spot.
  - Confirmed every generated semantic structure has at least one action point.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/genesis-district-semantic-smoke.png`.
- Flat plot-world browser verification:
  - Confirmed the app opens into a `192x192` flat plot world by default.
  - Confirmed generated city metadata reports 25 plots and 6 roads.
  - Confirmed regenerating a `128x160` plot world updates generator settings, plot count, road count, and chunk count.
  - Confirmed spawn lands on a visible road after the road-intersection spawn fix.
  - Confirmed no browser console errors or page errors.
- Synthetic schematic verification:
  - Built a minimal Sponge-style NBT schematic in-browser.
  - Confirmed `parseMinecraftSchematic` converts it into a versioned 1x1x1 blueprint with a Stone block.
- Box building and all-chunk visibility verification:
  - Generated a `10x8x6` Brick/Roof box building clipboard.
  - Confirmed generated clipboard size reports `10x6x8` with 286 non-air cells.
  - Confirmed Box Build material choices exclude slabs, stairs, roads, grass, water, leaves, and utility/furniture pieces.
  - Confirmed paste mode switches to Merge for generated buildings.
  - Confirmed All view distance reports 144/144 visible chunks on the default world with no LOD debug state.
  - Confirmed no browser console errors or page errors.
- Revised town layout verification:
  - Confirmed default main road width is 5 blocks.
  - Confirmed internal plot road width is 3 blocks.
  - Confirmed generated road metadata distinguishes `main` and `lane` roads.
  - Confirmed the default 192x192 world generates 117 plots, 8 main roads, and 45 internal plot roads.
- Browser smoke test with Playwright against local Vite server:
  - Generated seed `engine-alpha-smoke`.
  - Confirmed zero generated structures.
  - Confirmed 9 hotbar slots.
  - Confirmed 22 palette blocks in the original engine-alpha pass.
  - Confirmed palette search finds Glass.
  - Confirmed palette selection updates selected block.
  - Confirmed fly mode toggles.
  - Confirmed block placement creates a patch and undo history entry.
  - Confirmed undo/redo stack state changes.
  - Confirmed named local save writes to `localStorage`.
  - Confirmed no browser console errors or page errors.
- Screenshot: `qa/engine-alpha-smoke.png`
- Browser rotation/shape smoke test with Playwright:
  - Selected and rotated Stone Stairs.
  - Confirmed patch persistence for block `25` with rotation `1`.
  - Confirmed slab, stair, and door collision boxes use partial shapes.
  - Confirmed undoing a placement clears the saved patch entry.
  - Confirmed no browser console errors or page errors.
- Screenshot: `qa/partial-shapes-rotation-smoke.png`
- Builder tool verification:
  - Confirmed Builder HUD controls render.
  - Confirmed one-block region Fill creates a patch.
  - Confirmed Copy and Paste create an in-memory blueprint and paste it into the world.
  - Confirmed grouped undo/redo for Paste changes patch size from 2 to 1 and back to 2.
  - Confirmed blueprint JSON export creates a versioned 1x1x1 blueprint.
  - Confirmed blueprint JSON import restores clipboard state.
  - Confirmed no browser console errors or page errors.
- Screenshots:
  - `qa/builder-tools-smoke.png`
  - `qa/builder-tools-functional-smoke.png`
- Visual builder feedback verification:
  - Confirmed visual region outline is active after Set A and Set B.
  - Confirmed paste preview appears after Copy while aiming at a block face.
  - Confirmed debug state reports region volume and paste anchor.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/builder-overlays-smoke.png`.
- Brush and paste warning verification:
  - Confirmed brush buttons render and `B` cycles brush size.
  - Confirmed brush-size debug state updates.
  - Confirmed click edit with brush size 3 creates grouped edits.
  - Confirmed paste overwrite count appears when pasting into occupied blocks.
  - Confirmed warning-tinted paste preview renders in browser.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/brush-overwrite-smoke.png`.
- Paste collision mode verification:
  - Confirmed Replace, Merge, and Empty mode controls render in the Builder panel.
  - Confirmed selecting Merge and Empty updates button selected state, Builder status, and debug state.
  - Confirmed copied clipboard state reports paste write counts in debug state and Builder status.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/paste-modes-smoke.png`.
- Inventory/settings verification:
  - Confirmed Inventory opens with `E` and shows categorized block tabs.
  - Confirmed category filtering still selects blocks.
  - Confirmed Settings opens with `O`.
  - Confirmed render scale updates debug state through the renderer setting path.
  - Confirmed HUD panel toggles hide/show panels.
  - Confirmed no browser console errors or page errors.
  - Screenshots:
    - `qa/inventory-settings-clean-hud.png`
    - `qa/inventory-settings-smoke.png`
- Assignable hotbar verification:
  - Confirmed 9 hotbar slots render with builder-focused default assignments.
  - Confirmed inventory click assigns Brick to active slot 1 and updates palette selection.
  - Confirmed selecting slot 2 and clicking Glass assigns Glass to that slot.
  - Confirmed hotbar assignments persist after reload.
  - Confirmed `Q` pick-block replaces the active hotbar slot with the targeted block.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/assignable-hotbar-smoke.png`.
- Render distance/sensitivity verification:
  - Confirmed Settings opens with `O`.
  - Confirmed Near view distance reports 9 visible chunks.
  - Confirmed Full view distance reports 36 visible chunks.
  - Confirmed look sensitivity slider updates debug state and the visible percent readout.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/settings-render-distance-sensitivity.png`.
- Face-aware partial placement verification:
  - Confirmed top face placement resolves to bottom half.
  - Confirmed underside placement resolves to top half.
  - Confirmed side-face high/low aim resolves to top/bottom half.
  - Confirmed top and bottom slab/stair boxes differ as expected.
  - Confirmed saved patch entries persist `half: "top"` and reload restores top-half state.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/face-aware-partials-smoke.png`.
- Stair corner variant verification:
  - Confirmed neighboring bottom-half stairs resolve outer-left and inner-right corner states.
  - Confirmed neighboring top-half stairs resolve top-half outer corner state.
  - Confirmed straight, inner, and outer stair boxes differ as expected.
  - Confirmed reload derives the same stair corner states from saved neighboring stairs.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/stair-corners-smoke.png`.
- Detailed silhouette verification:
  - Confirmed Storage, Bed, Counter, Workbench, Sign, Light, Door, Window, and Fence now use multi-box shapes.
  - Confirmed rotated silhouette boxes stay within block bounds and are non-degenerate.
  - Confirmed a seeded row of detailed utility/furniture blocks persists and reloads.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/detailed-silhouettes-smoke.png`.
- Partial block occlusion verification:
  - Loaded a flat world with Counter, Stone Slab, Wood Slab, Workbench, and Bed edits sitting on road/grass.
  - Confirmed the road/grass surface remains visible around partial-block empty space instead of showing sky blue.
  - Confirmed no browser console errors or page errors.
  - Screenshot: `qa/partial-block-occlusion-fix.png`.
- Lighting/AO verification:
  - Confirmed Smooth lighting setting is present.
  - Confirmed debug state tracks smooth lighting.
  - Confirmed toggling smooth lighting rebuilds chunks without console/page errors.
  - Confirmed draw calls and triangle counts remain stable across the toggle.
  - Screenshots:
    - `qa/lighting-ao-on.png`
    - `qa/lighting-ao-off.png`

## Agency Life Sim v0 Progress Pass

Current direction:

- Agency is now being shaped as a local, spectator-first voxel life simulator rather than a Minecraft-like builder sandbox.
- The app opens into Genesis District, prompts for agent spawn, follows the selected agent in third person, and keeps free camera as a development toggle.
- The main product surface is the selected agent's life HUD: needs, money, rent, routine progress, current goal, route/action, day plan, reflection, recent memory, roster, and city feed.

Life-sim systems added:

- Added day number and day phase: morning, workday, evening, and night.
- Expanded agent state with social, hygiene, comfort, stress/calm, rent due, day plan, and daily routine flags.
- Added local actions for eating stored food, washing up at home, paying/checking rent, resting, working, shopping, socializing, healing, sleeping, and inspecting opportunities.
- Made action selection schedule-aware, with different priorities across morning, workday, evening, and night.
- Added routine consequences for meals, earnings, rent pressure, work completion, social bonds, non-graphic conflicts, stress, comfort, and memories.
- Added typed/tinted city events so the feed reads more like life moments.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Browser smoke spawned 8 agents, advanced to Day 1 / Workday, switched spectated agents, and confirmed:
  - no page or console errors;
  - 8 active agents;
  - multiple goals/actions active, including food, work, and socializing;
  - completed food routines, completed wash-up routine, completed work shift;
  - per-agent memory streams and relationship entries;
  - typed event feed with food, work, social, home, and arrival events.
- Screenshot: `qa/agency-life-sim-v0-workday.png`.

## Relationship And Social Identity Pass

Implemented:

- Added first-class relationship records alongside the numeric relationship map.
- Each relationship now tracks the other agent's name, score, attitude, encounter count, last event, and a short history.
- Added deterministic first impressions from agent DNA/personality compatibility so some agents naturally click and some start uneasy.
- Tuned attitudes into stranger, familiar, friend, and rival bands.
- Socializing now prefers known friendly agents and avoids rivals unless stress/risk pushes the encounter into conflict.
- Added selected-agent relationship cards to the HUD.
- Made local mock names unique for the first batch of agents so relationship stories are easier to read.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Browser smoke spawned 8 agents and advanced to Day 1 / Workday with no console/page errors.
- Confirmed 8 unique agent names.
- Confirmed relationship records were generated for all agents.
- Confirmed live state included familiar, friend, and rival relationship attitudes.
- Confirmed the selected-agent HUD shows named relationship cards.
- Screenshot: `qa/agency-relationship-social-focus.png`.

## Semantic Objects And Personal Targeting Pass

Implemented:

- Added richer everyday semantic action points across Genesis District: apartment sink/table/chair/mailbox, grocery/workplace snack machines, worker locker, break chair, clinic medicine cabinet/waiting chair, town hall mailbox/waiting chair, and park bench seats.
- Added daily mail checking as a local routine with memories and city-feed events.
- Routed eating, washing, shopping, healing, resting, rent, and mail decisions toward the new object types.
- Added action point ids and structure ids to agent targets so target load can be understood by the sim and debug state.
- Changed target selection from "first matching object" to scored target choice using distance, stable personal preference, home fit, job fit, and whether another agent is already using the same object.
- Changed work routing so jobs point to believable workplaces: grocers to Genesis Grocery, clinicians to Patch Clinic, security officers to Civic Security, clerks to Genesis Town Hall, and builders/materials clerks to Block Works.

Verification:

- `npm run typecheck` passed.
- Browser smoke confirmed no page or console errors, 10 active agents, 38 action points, and the new semantic object counts in debug state.
- Browser smoke confirmed job-specific work targets in live state, including grocers working at Genesis Grocery, a security officer heading to Civic Security, and a builder heading to Block Works.
- Browser smoke confirmed agents spread across 9 distinct target ids with no target load above 2 in the sample.
- Screenshots:
  - `qa/agency-semantic-objects-smoke.png`
  - `qa/agency-job-targets-smoke.png`

## Spectator Render Performance And Camera Pass

Implemented:

- Replaced per-chunk render meshes with 4x4 chunk render regions, preserving all generated chunk visibility while reducing draw-call overhead.
- Replaced per-agent body/head/marker meshes with shared instanced meshes, so spawning more agents does not add several draw calls per agent.
- Kept the selected-agent ring as a single movable highlight mesh.
- Added an obstruction-aware spectator camera fallback that tries clearer side and overhead positions when the selected agent is near walls or doorways.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Browser smoke spawned 10 agents with no page or console errors.
- Confirmed all 144 generated chunks remained visible.
- Confirmed the 10-agent smoke rendered at 16-19 draw calls after batching, down from the earlier 90+ draw-call range in comparable 10-agent smokes.
- Screenshot: `qa/agency-render-camera-optimized-smoke.png`.

## Indoor Spectator Cutaway Pass

Implemented:

- Added a selected-building cutaway state to the chunk renderer.
- When the followed agent is inside a semantic building, the renderer opens that building by omitting roof/upper-shell blocks and the camera-facing wall slice for that structure only.
- Camera obstruction checks now treat those cutaway blocks as clear, so the spectator camera can settle into a readable view of indoor actions.
- Exposed the active cutaway building through `window.agencyWorldDebug.cutawayStructure`.

Verification:

- `npm run typecheck` passed.
- Browser smoke spawned 10 agents, waited for the selected agent to enter Genesis Grocery, and confirmed:
  - no page or console errors;
  - 10 active agents;
  - all 144 generated chunks visible;
  - draw calls stayed low at 19;
  - `cutawayStructure` was `Genesis Grocery`;
  - the selected-agent HUD continued to show action, target, needs, relationships, memories, and feed.
- Screenshot: `qa/agency-indoor-cutaway-smoke.png`.

## Cutaway Doorway Performance Pass

Implemented:

- Replaced whole-world remeshing when the dollhouse cutaway changes with targeted rebuilds for only the old/new building footprint render regions.
- Added doorway hysteresis so the selected building cutaway does not rapidly turn on/off while the followed agent crosses a door threshold.
- Preserved the active cutaway wall side while spectating the same building so small camera moves do not cause extra mesh rebuilds.
- Reduced render-region size from 4x4 chunks to 2x2 chunks so unavoidable cutaway refreshes touch fewer blocks.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Browser smoke spawned 10 agents, followed the selected agent into Genesis Grocery, and confirmed:
  - no page or console errors;
  - 10 active agents;
  - all 144 generated chunks visible;
  - draw calls stayed low at 23-25 while the cutaway was active;
  - `cutawayStructure` was `Genesis Grocery`;
  - frame timing held at normal cadence during the sampled cutaway/doorway run, with 0 frames over 50ms in the sample.
- Screenshot: `qa/agency-cutaway-doorway-optimized-smoke.png`.

## Life Story HUD Pass

Implemented:

- Added derived status effects for selected agents, including money pressure, rent, hunger, energy, health, stress, hygiene, social loneliness, calm/fed states, completed shifts, bonds, conflicts, and active social focus.
- Added action progress to agent summaries so the HUD can show route/action progress while agents walk or dwell at an object.
- Added city-level phase story events for morning, workday, evening, and night so the feed explains why agent priorities are shifting.
- Added daily recap memories and start-of-day feed entries that summarize work, meals, social bonds, conflicts, clinic visits, and rent handling before a new routine begins.
- Added compact status chips, action progress, and a recent personal memory trail to the selected-agent HUD.
- Cleaned up route and memory labels so the selected-agent panel reads like a life-sim UI instead of debug output.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Browser smoke spawned 8 agents and waited until Workday, confirming:
  - no page or console errors;
  - Workday phase reached at 10:04;
  - the selected agent exposed action progress, status effects, and recent memories;
  - the selected HUD rendered status chips, the action progress bar, and 4 recent story rows;
  - the city feed included the Workday phase story event;
  - all 144 generated chunks remained visible.
- Screenshot: `qa/agency-life-story-hud-workday.png`.

## World Agent Marker Pass

Implemented:

- Added a lightweight DOM marker layer projected from the 3D camera so agent story labels can follow visible agents in the world.
- Added selected-agent world markers with name, current action, goal/detail, and action progress.
- Added quieter non-selected markers that only appear when another agent has a notable action or warning status, preventing normal walking crowds from cluttering the playfield.
- Kept the marker layer pointer-free and under the main HUD panels so it does not interfere with camera use or UI controls.
- Reused marker DOM nodes across frames instead of rebuilding the whole overlay every tick.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Browser smoke spawned 8 agents and waited until Workday, confirming:
  - no page or console errors;
  - 8 marker nodes exist for 8 agents;
  - the selected agent has one visible world marker with action, goal, and progress;
  - normal walking non-selected agents stay hidden to protect the playfield;
  - the marker layer has `pointer-events: none` and sits below the main HUD panels;
  - FPS stayed near 60 with all 144 generated chunks visible.
- Screenshot: `qa/agency-world-agent-markers-workday.png`.

## Agent Life Profile Pass

Implemented:

- Added deterministic life profiles derived from each agent's DNA: Ambitious Earner, Plot Dreamer, Social Connector, Caregiver, Reliable Citizen, Quiet Homebody, and Balanced Local.
- Added profile motives, habits, worries, and action biases so profiles affect decisions instead of only changing flavor text.
- Folded profile motives into day plans, reflections, and daily recaps so agents can explain their recurring patterns.
- Added selected-agent profile details to the spectator HUD.
- Added each agent's profile to the active roster so switching between agents has clearer personality context.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Longer browser smoke spawned 10 agents and sampled them at Day 1 / 13:21 / Workday, confirming:
  - no page or console errors;
  - 6 distinct life profiles across 10 agents;
  - 6 distinct active goals: eat, buy food, work, inspect future opportunities, find company, and calm down;
  - 6 distinct current actions: walking, shopping, building, socializing, working, and resting;
  - varied money, work, meal, social, bond, relationship, and reflection outcomes;
  - selected-agent HUD and roster both displayed profile information;
  - FPS stayed near 60 with all 144 generated chunks visible.
- Screenshot: `qa/agency-life-profiles-midday.png`.

## Selected Agent Day Arc Pass

Implemented:

- Added a compact `Today So Far` section to the selected-agent HUD.
- Surfaced daily consequences directly in the spectator panel: work/earnings, meals/hunger, social bonds/conflicts, errands, inventory, relationships, and rent state.
- Added tone coloring to day-arc cards so positive, warning, and bad outcomes are scannable without reading every stat.
- Kept the day arc inside the existing selected-agent panel so the playfield remains protected.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Longer browser smoke spawned 10 agents and sampled them at Day 1 / 13:17 / Workday, confirming:
  - no page or console errors;
  - selected-agent day arc rendered in the HUD;
  - selected agent showed Work, Food, Social, and Errands cards plus inventory, relationship, and rent footers;
  - the run still produced 6 distinct active goals across 10 agents;
  - varied work, meal, bond, errand, inventory, relationship, and money outcomes were visible in debug state;
  - FPS stayed near 60 with all 144 generated chunks visible.
- Screenshot: `qa/agency-day-arc-midday.png`.

## Roster Outcome Badges Pass

Implemented:

- Added compact Work, Food, and Social outcome badges to every active agent row.
- Made the roster show each agent's daily consequences while switching: earnings or open work, meals or hunger pressure, and bonds, conflicts, or quiet social state.
- Expanded roster rows just enough for scanability while keeping the selected-agent HUD and playfield readable.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Browser smoke spawned 10 agents, confirmed 10 roster rows and 30 outcome badges, clicked from one roster agent to another, and confirmed the spectated agent changed with no browser errors.
- Screenshots: `qa/agency-roster-outcomes-midday.png` and `qa/agency-roster-outcomes-smoke.png`.

## Public Reputation Pass

Implemented:

- Added persistent public reputation to each agent: reliability, warmth, ambition, and trouble.
- Reputation changes from real simulated consequences: working, eating, washing, paying rent, missing work, bonding, conflict, clinic visits, resting, and inspecting future plots.
- Reputation now lightly affects first impressions, social approach choices, and conflict pressure.
- Added a compact `Town Read` section to the selected-agent HUD and a short reputation label in each active-agent roster row.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Browser smoke spawned 10 agents, advanced to Day 1 / 11:30 / Workday, confirmed:
  - 10 active roster rows;
  - one selected-agent reputation card with four reputation meters;
  - all 10 agents had reputation values change after actions resolved;
  - selected roster text included a reputation read such as `Warm + Driven`, `Reliable`, or `New in town`;
  - no page or console errors;
  - FPS stayed near 60 with all 144 generated chunks visible.
- Screenshot: `qa/agency-reputation-midday.png`.

## Semantic Action Pulse Pass

Implemented:

- Added semantic object position data to agent events so local sim outcomes know where they happened.
- Added short-lived in-world activity pulses for recent non-arrival agent events.
- Pulses use the event's semantic action point label, such as `Genesis Grocery: Snack machine`, so spectators can see which object was used.
- Reused the existing DOM world-marker overlay, keeping the renderer as a presentation layer over sim-owned event data.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Browser smoke spawned 10 agents and waited for real semantic action events, confirming:
  - 10 active roster rows;
  - positioned non-arrival action events;
  - visible in-world event pulses for grocery interactions;
  - action pulse labels included agent name, action label, and semantic object label;
  - no page or console errors;
  - FPS stayed near 60 with all 144 generated chunks visible.
- Screenshot: `qa/agency-semantic-action-pulses.png`.

## Evening Social Plans Pass

Implemented:

- Added per-agent evening social plans as saveable sim state.
- Agents now form after-work intentions from relationships, stress, mood, sociability, and reputation: catch up with someone familiar, seek a friend, avoid a rival, meet someone, or decompress quietly.
- Evening plans bias destination choice and social focus instead of only appearing as text.
- Social outcomes now resolve the evening plan as bonded, quiet, conflict, or skipped, with memories and city-feed entries.
- Added an `Evening Plan` HUD card and status chip for the selected agent once the evening plan exists.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Accelerated browser smoke spawned 10 agents and advanced to Day 1 / 17:26 / Evening, confirming:
  - all 10 agents formed evening plans;
  - plan intents included seeking familiar agents and avoiding rivals;
  - social focus followed evening targets;
  - at least 2 plans resolved into bonded outcomes during the smoke;
  - evening-plan memories and city-feed events were created;
  - the selected-agent HUD rendered the `Evening Plan` card.
- Normal-clock render sanity spawned 10 agents with no browser errors, near 60 FPS, and all 144 chunks visible.
- Screenshot: `qa/agency-evening-social-plans.png`.

## Persistent Object State Pass

Implemented:

- Added saveable semantic object state keyed by `structureId:actionPointId`.
- Objects now track daily use count, total use count, last user/time/action, stock/capacity where relevant, cleanliness, wear, and heat.
- Agents initialize object state when targeting semantic objects and update it when sleeping, eating, washing, working, shopping, socializing, resting, healing, checking mail, paying rent, or inspecting plots.
- Grocery and clinic objects now have stock pressure; stock can drop, low stock affects tone/cost, and empty stock can disappoint agents.
- Target scoring now lightly avoids overheated, dirty, worn, or empty objects.
- Added a compact `Current Object` card to the selected-agent HUD showing stock, uses today, cleanliness, heat, and last user.

Verification:

- `npm run typecheck` passed.
- `npm run build` passed. Vite still reports the existing large chunk warning.
- Accelerated browser smoke spawned 10 agents and waited for grocery interactions, confirming:
  - object states were created;
  - used objects tracked `usesToday`, `totalUses`, last user/time/action, cleanliness, wear, and heat;
  - grocery stock changed on register, snack machine, and food shelf interactions;
  - the selected-agent HUD rendered the `Current Object` card;
  - no page or console errors.
- Normal-clock render sanity spawned 10 agents with object state active, no browser errors, near 60 FPS, and all 144 chunks visible.
- Screenshot: `qa/agency-object-state-ledger.png`.

## Known Gaps

- Low-level voxel edit/storage internals still exist because the world needs mutable block data later, but the main app no longer exposes builder/importer tooling.
- Agent behavior is still rule-based and local-only; mock purchase ingestion, wallet visibility, persistence, and optional AI decisions are not wired yet.
- The city is still a generated starter district, not a hand-built production town.
- Agent pathing is voxel-aware, but movement needs smoother sidewalk/door behavior and better crowd handling.
- Indoor spectating now has a functional selected-building cutaway, but it still needs smoother fade transitions and hand-authored room support later.
- Social simulation now has first impressions, familiarity, friends, rivals, bonds, conflicts, public reputation, and evening social plans, but still needs deeper long-term reputation consequences.
- Buildings now expose useful semantic objects, short-lived in-world action pulses, and persistent object state, but those interactions still need more room-level consequences.

## Next Recommended Engine Milestone

Add smoother crowd/path behavior and more room-level consequences so spectators can see more believable daily life before wallet, token, or LLM systems are added.
