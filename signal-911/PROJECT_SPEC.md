# SIGNAL 911 — Project Spec (condensed)
Single-player browser emergency dispatch game set in fictional Ravenport. React + TS + Vite + Zustand, plain CSS, Lucide, Canvas/SVG map, localStorage saves, Web Audio, Vitest. No backend, no paid APIs, fully local deterministic simulation (seeded RNG).

**Loop:** pre-shift (map, units, equipment, difficulty) → active shift (calls, branching dialogue, dispatch, A* routes, on-scene decisions) → post-shift (stats, grade, upgrades). Shift ~8–12 min, configurable.
**City:** 6 districts — Downtown, Riverside, Northside, Old Town, Industrial, Westbrook; hand-built road graph.
**Services:** Police (patrol, SUV), Fire (engine, rescue), Medical (ambulance, advanced). Incidents need *capabilities*, not colours. Statuses: AVAILABLE, EN ROUTE, ON SCENE, BUSY, RETURNING, OUT OF SERVICE.
**Calls:** branching dialogue; confirmed vs unconfirmed vs hidden facts; notes panel; caller personalities; wrong locations, disconnects.
**Incidents:** data-driven families + variations; states REPORTED→…→RESOLVED/FAILED; escalation from sim variables; anti-repeat safeguards; pacing director.
**Palette:** bg #111820, panel #1B2530, elevated #253240, text #E7EDF4, muted #96A6B5, accent #5A9CCB, police #5C91C9, fire #D76B54, medical #61B894, urgent #E8B65B, critical #E45A5A.
**Excluded:** AI voices, multiplayer, real maps, 3D, backend, leaderboards, accounts.
**Stages (each needs explicit approval):** 0 Foundation · 1 Core gameplay · 2 Conversations · 3 Dynamic incidents & on-scene decisions · 4 Management & upgrades · 5 Career & scenarios · 6 Polish & testing.
