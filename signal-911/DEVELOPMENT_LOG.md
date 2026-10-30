# Development Log
## Stage 0 — Foundation (done)
Vite/React/TS/Zustand/Lucide/Vitest scaffold; seeded RNG, game clock, versioned guarded save; layout shell and theme.

## Stage 1 — Core gameplay (done)
- **City** (`sim/city.ts`): generated once from fixed seed 911. Six districts with distinct layouts (dense Downtown grid, jittered/pruned Old Town + Westbrook, big-block Industrial, waterfront Riverside), river with bridges, 11 landmarks, 8 stations, ~660 nodes. Connectivity is guaranteed (test + stitching fallback).
- **Routing** (`sim/pathfinding.ts`): A* with binary heap; edge speed = road class × vehicle × weather ÷ traffic (traffic varies by district and over time). Supports blocked edges (unused until Stage 3).
- **Units** (`sim/units.ts`): 6 vehicle types with capabilities, crew, equipment, dispatch cost; 11-unit starting fleet. Statuses AVAILABLE / EN ROUTE / ON SCENE / BUSY / RETURNING (OUT OF SERVICE reserved for Stage 4).
- **Incidents** (`sim/incidents.ts`): 6 data-driven templates with variations, required capability slots, escalation (adds a requirement), fail text, rewards, anti-repeat on template + opening.
- **World** (`sim/world.ts`): pacing director (calm → build → breather → harder → final severe call, difficulty and load aware), calls (ring 20 s, answer or missed → passerby report), dispatch/recall, slot matching, "danger" pressure → escalation/failure, work progress → resolve, unnecessary-deployment tracking, shift summary + grade.
- **UI**: canvas map (pan, wheel/button zoom, fit, hover tooltips, click select for units/incidents/stations/districts, routes, service filters, coverage + traffic overlays); briefing panel (length, difficulty, weather, seed); call + incident queue; dispatch panel with ETA-sorted responders, confirm bar, recall; roster with search/sort; radio log + history; summary modal; shortcuts (Space, 1/2/3, A, Enter, Esc, M).
- **Tests**: 17 Vitest tests (graph connectivity, A* validity, slot matching, full-shift bot run with state invariants, determinism, anti-repeat, dispatch/recall).
- Verified in Chromium at 1440×900 and 1920×1080: full shift, dispatch, save reload, no console errors.

Known/deferred: calls are a one-click stub (dialogue = Stage 2); sound not implemented (volume/mute stored only); no unit repositioning (Stage 4); on-scene decisions and road closures (Stage 3).

## Stage 2 — Emergency conversations (done)
- **Dialogue** (`sim/dialogueData.ts`, `sim/calls.ts`): data-driven. 5 generic questions (address, confirm address, describe, safety, calm the caller) + 2–3 domain questions per incident family; 16 variation scripts give each answer text, a note, a capability effect and a severity. Answers are applied with a count-aware merge, so a reply can add *or remove* a requirement.
- **Personalities** (7): calm, panicked, confused, angry, uncooperative, uncertain, distracted. They change reply delay, patience (number of questions before hang-up), chance to deflect a question once (never twice, never after reassurance), reliability (unsure answers are *unconfirmed*; asking again confirms), and whether the address is volunteered.
- **Twists**: wrong address, serious-looks-mild, mild-looks-serious, unexpected disconnect. All end in a recoverable state: a wrong address sends units to the wrong place until the caller confirms, calls back (20 s after a unit finds nothing, 60 s after the call ends), or is corrected on the line.
- **Uncertainty model**: incidents keep the truth (`required`, `severity`, `nodeId`) separate from what the dispatcher believes (`believed`, `believedNode`). The UI shows only the believed values until first responders reach the real scene (on-scene assessment, may add requirements).
- **Notes**: confirmed / unconfirmed / warning / info, stored on the incident with the full transcript, so they outlive the call.
- **Calls are real time**: replies arrive after a sim-clock delay; one active call at a time; ringing calls can still be missed. Calls end by player (E), hang-up, or disconnect; a call can always be ended.
- **Sound** (`audio.ts`, Web Audio, no assets): ring, answer, end, select, dispatch, arrival, warning, resolve, fail. Volume + mute now work.
- **UI**: phone panel (transcript, patience meter, grouped questions with answered/ask-again state), notes list, "Reported/Verified" badge, dashed marker for unverified address, location-unknown banner, call transcript in incident panel.
- **Tests**: 27 total. New: script data consistency for every perceived/truth pair, wrong-address flow end to end, confirm/correct, conflict & downgrade, disconnect trace, hang-up, "every call can always be completed" across 7 personalities × 5 twists, single active call.

Known/deferred: only one call at a time (no hold); no on-scene decisions or road closures (Stage 3); caller answers are English-only strings in `dialogueData.ts`.

## Stage 3 — Dynamic incidents and tactical decisions (done)
- **On-scene decisions** (`sim/decisions.ts`, `decide()` in `sim/world.ts`): data-driven decision point per incident family, offered once when responders reach the real scene, with a per-variation chance (minor incidents resolve on their own). 2–3 family-specific options + *Escalate to supervisor* (limited to 2 per shift, $200) + *Continue*. Ignoring it for 40 s lapses into Continue, so there is no forced busywork.
- Option effects are plain sim values: work-rate multiplier, change to scene **risk**, **cost**, `needs` (a capability already on scene) or `fetch` (sends the nearest free unit; the effect starts only once that unit arrives, and the unit is not counted as an unnecessary deployment). The UI states why an option is unavailable.
- **Risk-driven complications**: each variation has a base risk; while responders are on scene a complication can occur (max 2), adding a requirement and raising severity. Decisions lower risk. Neglect escalation (time with needed capabilities missing) is unchanged. Rewards are reduced 15% per complication.
- **Road closures**: serious collisions can close the adjoining road once reported (BLOCKING answer or on-scene assessment). A* routes around it and moving units are re-planned; closures never disconnect the city (checked); a traffic unit on scene, the diversion decision, or the incident ending reopens the road. Drawn on the map as a red dashed segment with ✕.
- **Linked incidents**: a fire left unattended spreads into a linked fire next door; an industrial accident can ignite the neighbouring unit. Linked chips and links appear in the queue and incident panel.
- **New variations**: *Difficult access* fire (Old Town only, needs two engines) and *Several unwell* medical call (two ambulances), with full dialogue scripts.
- **UI**: decision card, scene-risk indicator and active-measure list, decision/road-closed/linked chips in the queue, "!" badge on map markers, summary rows (decisions, complications, linked incidents). Fixed a Stage 1 CSS rule that squashed multi-line buttons.
- **Tests**: 36 total (new `decisions.test.ts`: offering/lapsing, fetch timing and the unnecessary-deployment exemption, unavailable options and supervisor limit, speed effect, risk/complication, road closure routing + connectivity + reopening, diversion decision, linked fire; full-shift bot now makes decisions and checks closure/connectivity invariants).

Known/deferred: closure is activated when reported, not when the crash happens; decisions are single-step (one per incident); no OUT OF SERVICE or repositioning (Stage 4).
