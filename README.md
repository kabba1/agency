# Agency

Agency is now a local spectator-first voxel life-sim prototype. The app opens directly into Genesis District, lets you spawn agents, and follows the selected agent in third person while their day unfolds.

The old sandbox-facing generator, inventory, hotbar, save/load, schematic import, and builder panels are no longer part of the app. The schematic importer, builder overlay, and box-building generator modules were removed. The flat-world and Genesis District generation code still exists underneath because the sim needs a city stage to spawn into.

## Run

```bash
npm install
npm run dev
```

`npm start` runs the same local server.

Open:

```text
http://127.0.0.1:5173/
```

Useful checks:

```bash
npm run typecheck
npm run build
npm run api:smoke
```

Launch harness:

```bash
npm run dev:api
npm run dev
```

The API runs at `http://127.0.0.1:8787` by default. The viewer still runs at `http://127.0.0.1:5173/`.

## Current App

- Loads a fixed local Genesis District on startup.
- Starts in spectator mode with a prompt to spawn the first agent.
- Follows the selected agent in third person after spawning.
- Uses an obstruction-aware follow camera and a selected-building cutaway so indoor agents remain watchable instead of disappearing behind roofs and walls.
- Shows a game-style selected-agent HUD with needs, credits, rent, daily routine progress, DNA stats, current goal, plan, recent memory, roster, and city feed.
- Lets you spawn more agents and switch the spectated agent from the roster or next/previous controls.
- Spawns local mock agents with deterministic wallet-like ids and DNA.
- Agents have appearance hue, risk, sociability, discipline, greed, empathy, and preferred job traits.
- Agents track hunger/food, energy, health, mood, social, comfort, stress/calm, hygiene, money, rent due, living costs, job, home, inventory, relationships, memories, current action, and target.
- Agents keep daily routine state for eating, washing up, working, socializing, paying rent, sleeping, meals, earnings, bonds, and conflicts.
- Agents now have a soft daily rhythm made of time-windowed commitments: morning wash, meal window, work block, civic or budget errands, home reset, social time, and sleep. These windows create planning pressure without forcing every choice.
- The world clock now exposes day number and phase: morning, workday, evening, and night.
- Agents maintain a small memory stream with observations, plans, events, reflections, importance scores, and tags.
- Agents score candidate actions from needs, day phase, traits, recent memories, routine progress, rent pressure, and semantic building metadata.
- Agents can sleep, eat stored food, wash up, reset home clutter/laundry, buy food, work shifts, socialize, rest, visit the clinic, pay/check rent, review budgets/savings, and inspect future plot opportunities.
- Home care now splits into distinct choices: quick wash for public readiness, laundry for clothes/home mood, tidy clutter, deep clean, and sleep prep for better rest.
- Food shopping now exposes distinct life choices: buy a quick meal, buy groceries, stock the pantry in bulk, use emergency savings for food, try and fail when unfunded, or work first to earn food money.
- Agents can become mildly ill from being run down, dirty, stressed, poorly rested, or stuck around crowded/dirty objects; rest, washing, and clinic care can clear symptoms before they become a bigger crisis.
- Clinic care now exposes separate semantic choices: cheap checkups, symptom treatment, urgent care, unpaid/deferred care, savings-funded care, and thin-care outcomes when supplies are exhausted.
- Treatment and hospital discharge can now create aftercare plans with doses, rest time, follow-up pressure, relapse risk, HUD status, wants/fears, and home self-care actions.
- Agents cannot die or reproduce. A severe health collapse sends an agent into a timed hospital recovery state at a clinic, then discharges them with a medical bill.
- Medical debt appears in the spectator HUD, adds stress, creates memories/events, and pulls agents toward town hall to pay what they can, including combining cash and savings when that clears the bill.
- Civic bills now expose multiple semantic money choices instead of one hard rail: clear a bill, combine cash and savings, make a protected partial payment, review/delay, or work first when total obligations exceed liquid credits.
- Recurring living costs now appear as a separate civic account for utilities and basics; they affect City Pulse housing pressure, mail notices, budget review, credit, stress, visible status, and town-hall payment choices.
- Overdue bills now age across days: payment plans can protect an agent from the next late fee, while ignored rent/living-cost debt can add fees, hurt civic credit, create memories, and show up in the finance HUD.
- Agents choose action points from scored world objects instead of always using the first matching object; distance, home fit, job fit, stable personal preference, and current object load all affect the target.
- Work destinations now match the agent's job where possible: grocers work at the grocery, clinicians at the clinic, security officers at Civic Security, clerks at town hall, and builders/materials clerks at Block Works.
- Work shifts now maintain same-building semantic objects, so a grocer can restock nearby shelves, clinicians can reset clinic supplies, clerks can cool civic/mail boards, security can calm busy desks, and builders can stage materials.
- Semantic objects now track unmet demand and service pressure: empty shelves and thin clinic supplies leave backlog behind, workers are pulled toward those needs, and the HUD/city pulse expose the pressure instead of hiding it in one-off events.
- The City Pulse now generates visible work orders from semantic object pressure, including category, severity, target object, and matching jobs, so agents and viewers can read what the district needs next.
- Agents now build public service standing when work genuinely resolves demand, stock shortages, pressure, or upkeep; useful service improves career satisfaction, public reputation, future work motivation, and can earn small service bonuses.
- Important public events now become short-lived town notices; agents can hear them through mail, civic admin, public rest, shops, clinics, social time, or town-facing work, turning service, conflict, shortages, and health events into memory, mood, and relationship texture.
- Agents now keep named relationship records with first impressions, attitude labels, encounter counts, short history, and friend/rival/familiar states.
- Agents now keep short-lived social moments from actual encounters: support, jokes, advice, apologies, conflicts, de-escalation, housemate rhythm, and public resets. These appear in the spectator HUD and can surface over agents as world labels.
- Social support now behaves like an ongoing obligation: agents can owe another agent for earlier help, see that pressure in wants/status/HUD, choose to repay from cash, reduce the relationship support balance through a normal social encounter, and feel overnight trust/tension consequences when the favor keeps hanging.
- Agents now keep place memories for specific structures, including visits, affinity, trust, frustration, last event, and tags; those memories bias future target choices toward familiar good places and away from frustrating ones.
- Agents now keep activity memories for action types like work, shopping, rest, clinic care, socializing, and budgeting; repeated good or bad outcomes create personal learned preferences that bias future choices.
- Agents now carry short-lived moodlets from real events like good sleep, empty shelves, rent relief, conflict, treatment, and work shifts; moodlets appear in the HUD and nudge near-term decisions.
- Agents now carry a live personal intention with urgency, confidence, reasons, and action biases, so choices are pulled by goals like clearing obligations, securing food, restoring home, connecting socially, or pursuing a long-term aspiration.
- Agents now carry short-term wants and fears generated from their actual situation, such as clearing a medical bill, avoiding a health crash, getting fed, earning credits, or building savings. These appear in the HUD, resolve when the world state changes, and add pressure to the same decision system a future LLM cognition layer can read or replace.
- Agent motives now have in-world presentation: active wants/fears tint character expression, add small motive bubbles above agents, and can replace generic world labels when a fear or desire is important enough for spectators to notice.
- Agents now use bounded-rational choice: urgent needs can lock them onto the obvious move, but otherwise discipline, risk, empathy, sociability, stress, memory, and route friction can make them choose between several plausible options.
- Agents keep a compact decision readout for the spectator HUD and future cognition adapters: selected action, intent, style, urgency, confidence, major factors, route reachability, and a diverse set of considered option families.
- Social encounters can build familiarity, create friends, share food or small credit support, make agents seek known friendly faces, or turn into non-graphic conflicts when stress/risk outweigh empathy and relationship history.
- Agents expose their current goal, plan, decision reason, and reflection in the HUD.
- Hunger, fatigue, poor health, stress, hygiene, burnout, and debt now combine into a condition load that can slow movement and task completion; fed, rested, calm agents get a small recovery buffer.
- Genesis District now has deterministic weather that changes with sim time; clear skies, clouds, rain, heat, and cold affect outdoor comfort, movement, illness pressure, action desirability, HUD context, sky color, fog, and lighting.
- Character models now reflect that condition load through posture, gait, arm position, face shape/color, body tint, shadow shape, and status-pip intensity so worn-down agents read differently from steady ones.
- Character models now include job-readable uniform layers: grocer aprons, clinician coats, security vests, civic sashes, builder safety panels, and materials smocks, while still being driven by simulation state and rendered through shared instanced meshes.
- The sim runs on a local world clock and timestamps events in sim time.
- Agents use voxel-aware A* routes to move toward building action points.
- Doors are passable for agents; walls and furniture block routes.
- Nearby agents observe one another and start lightweight relationship scores.
- Agent events appear in the HUD.
- The renderer batches the voxel city into larger 4x4 chunk render regions and renders agents through shared instanced meshes, keeping the spectator view lighter as more agents spawn.
- Debug state is exposed through `window.agencyWorldDebug`.
- Dev-only debug controls are exposed through `window.agencyWorldDebugControls`, including `setAgentFinance(agentId?, values)` and `resolveCivicBills(agentId?, strategy?)` for testing mixed cash/savings bill payments or `request_payment_plan`, `forceHealthCrisis(agentId?)` for testing the non-death hospital loop, `forceMinorIllness(agentId?, severity?)` and `resolveWorkShift(agentId?, strategy?)` for testing sick-day or push-through-work behavior, `resolveFoodPurchase(agentId?, strategy?)` for testing grocery decisions, `resolveHomeCare(agentId?, strategy?)` for testing apartment upkeep, `resolveClinicCare(agentId?, strategy?)` for testing checkup/treatment/urgent/unpaid/aftercare actions, `forceSupportDebt(agentId?, amount?)` for testing repayment pressure, and `forceSocialMoment(agentId?)` for testing relationship beats.

## Research Direction

The local no-key MVP borrows the architecture shape from the provided agent research without depending on live LLM calls:

- Smallville / Generative Agents: observation, planning, memory retrieval/reflection, and believable daily behavior.
- Project Sid / many-agent simulations: keep the world as source of truth so hallucinated actions do not poison future state.
- SIMA-style embodied agents: agents should act through grounded routes and world actions, not just abstract text.
- Concordia: a future optional cognition adapter can sit behind the local rule-based brain, using componentized memory and a game-master/world-resolver pattern.

## Genesis District

The default city stage is now a larger semantic starter city with 42 structures and 225 action points. It is still generated locally, but every placed building represents a real sim location instead of decorative filler.

- 8 apartment buildings with home anchors, beds, fridges, sinks, dining spots, seats, mailboxes, rent rules, and roof/entry details.
- 5 groceries/markets with registers, shelves, snack machines, stock, and grocer jobs.
- 5 workplaces with job stations, workbenches, storage, lockers, break spots, snack machines, and builder/materials jobs.
- 3 clinics with desks, clinic beds, medicine cabinets, supplies, waiting seats, and clinician jobs.
- 4 civic offices/town halls with clerk desks, notice boards, mailboxes, plot/rent services, and city rules.
- 2 security buildings with report desks, storage, waiting seats, and security jobs.
- 6 parks/plazas with benches, meeting spots, paths, water features, and social/rest services.
- 9 future buildable lots with construction anchors, material caches, ownership rules, and build services.

Buildings sit directly on the terrain surface, while interiors keep semantic furniture/object targets one block above the floor so routing and visuals stay aligned.

## Controls

- `Spawn Agent` starts the sim and follows the new agent.
- `Dev Wallet` creates a local signed-nonce wallet session against the Agency API.
- `Mock Buy` sends a mock backend purchase event; a qualifying first purchase creates a wallet-linked agent.
- `Prev` / `Next` or `Q` / `E` switches the spectated agent.
- `F` or `Free Cam` toggles the development free camera.
- In free camera, click the world to mouse-look, `WASD` moves, `Space` rises, `Shift` lowers, and `Esc` releases mouse lock.

Block editing is disabled in the main app.

## Project Layout

- `apps/api/` is the launch API scaffold: health checks, wallet nonce sessions, admin mock purchases, pause controls, snapshot export, and WebSocket broadcast.
- `packages/shared/` stores launch-facing purchase, snapshot, wallet, event, and public/private agent contracts.
- `packages/chain/` stores `MockPurchaseIngestor` and the deliberately paused `SolanaPurchaseIngestor` placeholder.
- `packages/ai/` stores the local-only brain adapter contract and LLM budget simulator.
- `packages/sim/` stores schema-versioned launch snapshot export/import helpers.
- `src/main.ts` wires the slim Agency HUD and boots Genesis District.
- `src/agents/AgentSimulation.ts` is the simulation coordinator: it owns the agent list, world clock, movement loop, and event feed.
- `src/agents/SpawnSystem.ts` owns deterministic local and seed-based agent genesis.
- `src/agents/AgentDecisionSystem.ts` scores semantic destinations and chooses the next target.
- `src/agents/ActionResolver.ts` applies action consequences like work, food, rent, clinic visits, rest, and social outcomes.
- `src/agents/MemorySystem.ts`, `RelationshipSystem.ts`, and `ObjectStateSystem.ts` own memories/reflections, social history/evening plans/conflicts, and persistent semantic object state.
- `src/render/AgencyWorldApp.ts` owns Three.js rendering, the player camera, world loading, debug state, and agent mesh syncing.
- `src/structures/GenesisDistrict.ts` generates the current semantic starter city.
- `src/structures/StructureMetadata.ts` stores semantic building metadata.
- `src/world/` contains voxel storage, block definitions, chunks, and the hidden flat-world generator used by Genesis District.

## Not In This Pass

- Production wallet adapter UI.
- Real token purchase ingestion.
- Production database hosting/backups.
- AI/LLM decision loops.
- Creator marketplace.
- City editor UI.
- Multiplayer.

The repo now has a local backend/API harness and local persistence for mock purchase-to-agent testing. Real launch still requires the production chain ingestor, production wallet adapter, production database, legal/copy review, and launch rehearsal in `docs/launch/`.

## Next Work

- Add more visible room-level object consequences so semantic targets are not only useful in data, but also readable in the scene and feed.
- Improve the indoor cutaway with smoother fades and room-level authoring once buildings become hand-built.
- Add longer-term relationship history, reputation, and recurring preferences.
- Add mock purchase spawning so a purchase event creates one wallet-linked agent.
- Improve paths from grid-safe routing to smoother road/sidewalk movement.
- Add an optional Concordia-style cognition adapter for richer generative agents while keeping the current local fallback.
- Add private-vs-public agent detail visibility once wallet login returns.
