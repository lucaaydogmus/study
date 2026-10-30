# SIGNAL 911

A single-player emergency dispatch strategy game set in the fictional city of **Ravenport**. Answer calls, work out what is really happening, dispatch police, fire and medical units over a road network, make on-scene decisions, and grow your department between shifts.

Runs entirely in the browser. No backend, no accounts, no API keys, no network needed to play. Progress is saved in `localStorage`.

## Run it

```bash
npm install
npm run dev        # development server
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm test           # 86 simulation, save and store tests
```

## How to play

1. **Briefing**: pick shift length, difficulty and weather, or choose a special event / district challenge under *Career & scenarios*. Use the *Depot* to move, equip, service, buy and sell units, and check district coverage.
2. **Shift**: answer calls (`A`), ask questions, read the notes (confirmed / unconfirmed / warnings), dispatch units that fill what the incident needs (`Enter`), react to on-scene decisions, and keep everything covered. `Space` pauses, `1 2 3` set speed, `E` ends a call, `?` opens help.
3. **Summary**: grade, money, XP, reputation and objectives. Spend it on the fleet and go again.

## Project layout

```
src/sim/       pure simulation (no UI imports), seeded and deterministic
  city.ts          Ravenport: 6 districts, ~660-junction road graph, stations, landmarks
  pathfinding.ts   A* over the road graph, closures, connectivity checks
  world.ts         shift state, director/pacing, dispatch, escalation, decisions, summary
  calls.ts, dialogueData.ts   branching call engine and scripts
  incidents.ts, decisions.ts, events.ts   data-driven incident families, decisions, special events
  fleet.ts, equipment.ts      fleet management rules, upgrades, coverage
  career.ts, save.ts          objectives/levels and the versioned save
src/store/     Zustand store (actions, persistence)
src/ui/        React UI (canvas map, panels, depot, career, help)
```

Design notes live in `PROJECT_SPEC.md`; the build history, known limits and test notes are in `DEVELOPMENT_LOG.md`.
