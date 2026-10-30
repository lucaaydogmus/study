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
