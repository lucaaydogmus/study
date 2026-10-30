# SIGNAL 911 — Emergency Dispatch Simulator

An original, browser-based 911 dispatch strategy/simulation game set in the fictional city of **Ravenport**.
You take emergency calls, work out what is really going on from what callers tell you, place the incident on a
living city map, and send police, fire/rescue and medical units along a real road network — while the city
escalates around you.

> SIGNAL 911 is a work of fiction. Ravenport, its callers and every incident are invented. It is **not** connected
> to any real emergency service. Never use it to report a real emergency.

**No AI services, no microphone, no API key.** Callers are scripted, reactive characters driven by a deterministic
dialogue engine (see *How callers work*). The game runs entirely in the browser and works offline.

## Run it

```bash
cd signal-911
npm install
npm run dev        # http://localhost:5173
```

Other commands:

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm test           # 39 simulation/persistence/mechanics tests (vitest)
npx vite-node scripts/balance.ts   # headless balance harness (bot vs. idle dispatcher)
```

Requires Node 18+. Best on a desktop browser at 1440×900 or larger (usable down to ~1100 px wide).

## Playing

1. **Answer** a ringing call (left sidebar, or press `A`). Listen — the transcript is at the bottom.
2. **Ask questions** with the quick-question chips or type your own (“Is anyone trapped?”). Callers only know what
   their character could know; some are panicked, confused, angry, calm-but-serious, or joking.
3. **Set the location** in the right-hand panel from what you heard (“Use”), by searching an address, or by clicking the map.
   Callers can be wrong. Use *Read back to caller* or *Locate caller (ALI)* if you are unsure.
4. **Dispatch** units. The dispatch list is sorted by ETA from the real road network; ★ marks units matching the
   suggested response. Units follow visible routes that are affected by traffic, weather and closures.
5. **Watch** the incident. Units report on scene, may request more help, and incidents escalate if the response is
   late or insufficient. Close the shift with a graded report.

### Keyboard & mouse

| Key | Action | Key | Action |
|---|---|---|---|
| `Space` | Pause | `A` | Answer next ringing call |
| `1` `2` `3` | Game speed | `H` / `E` | Hold-resume / end call |
| `M` | Cycle map layer | `D` | Open the active call’s incident |
| `Esc` | Cancel / deselect / menu | `?` | Help |
| Right-click | With a unit selected: dispatch to incident or reposition | Wheel / drag | Zoom / pan |

## What is in the game

### Remaster highlights

- **Living map**: procedurally detailed city — buildings with heights and shadows, terracotta Old Town, glass towers,
  warehouses and chemical tanks, container yards, piers, airport runways, rail yard, stadium, parks and forests,
  animated water. At night the windows and street lights come on. Vehicles are oriented sprites with flashing light
  bars and headlights; fires glow and smoke; floating score popups; minimap and scale bar.
- **Pursuits**: fleeing vehicles drive the road network in real time. Keep the caller on the line (or get crews in
  sight) to track them; two units in contact box the car in.
- **Duplicate callers**: big incidents bring several callers from different viewpoints. Spot them and *link* them to
  the existing incident — or waste units; linking unrelated emergencies loses the call.
- **Shift conditions & bonus contracts**: every career shift can roll a condition (Quiet Night, Holiday Weekend,
  Short-Staffed, Hospital Diversion, Media Spotlight, Roadworks, Overtime…) and two optional contracts for cash and XP.
- **Streaks**: consecutive successful incidents raise bonuses up to ×1.5. A live shift rating sits in the top bar.
- **34 achievements**, a **Daily Challenge** that is identical for everyone on a given date, and 5 new incident types
  (power line down, carbon monoxide, boat fire, loose horse, “gunshots” that may be fireworks).

- **Ravenport**: 12 districts, ~1,000 road nodes (highways, arterials, local streets, bridges over a river, a harbor),
  hospitals, landmarks, addresses with cross streets. Map layers: normal, traffic, emergency/police/fire/medical coverage,
  active incidents, weather.
- **Simulation**: deterministic fixed-step engine (`src/sim/engine.ts`), A* routing, multi-source Dijkstra for coverage,
  incident state machine (REPORTED → … → RESOLVED), threat/escalation model, unit status machine, fatigue, weather,
  time-of-day traffic, citywide events (storm, blackout, flood, festival, rush hour, industrial fire, winter storm, heat wave),
  persistent city consequences (road closures, damaged stations, lingering congestion).
- **Content**: 55 incident templates (medical, fire & rescue, police, unusual) with procedural variation in location,
  caller, patient, severity, accuracy of information, escalation and twists (e.g. a “burglar” that is a raccoon,
  a joke call that turns out to be real, a faint burning smell that is a wall fire, out-of-area callers who must be transferred).
- **Fleet**: 17 vehicle types across three services, 12 starting vehicles, personnel with skills/fatigue/morale, recruitment,
  training, purchasing, station building, 10 upgrades with real effects.
- **Modes**: Career (7 ranks, 8-chapter campaign, persistent economy), Free play (units, budget, frequency, weather,
  districts, events), Endless, 5 handcrafted Scenarios, interactive Tutorial.
- **Persistence**: IndexedDB (in-memory fallback), autosave, 3 manual slots, import/export, save versioning with migrations,
  mid-shift checkpoints you can resume after a reload.
- **Audio**: all synthesised with Web Audio — phone rings, pick-up/hang-up, radio squelch, dispatch tones, ambience that
  matches the call (rain, traffic, crowd, wind), optional generative music, per-bus volume controls.
- **Accessibility**: keyboard shortcuts, labelled controls, shape/label-coded status (never colour alone), reduce-motion,
  high-contrast, and an option to remove the most distressing scenarios.

## How callers work (no AI)

- **Three separate layers**: the *incident* (what is really happening, owned by the simulation), what the *caller knows*
  (a per-template list; e.g. a witness cannot know a patient’s breathing), and what the *dispatcher has discovered*
  (the Information list, marked confirmed / unconfirmed / contradicted).
- A **dialogue engine** (`src/sim/dialogue.ts`) maps your words (quick chips or free text, via keyword intent matching) to
  answers assembled from template banks, coloured by an **emotional model** (stress, cooperation, frustration, trust) that
  moves gradually: politeness and reassurance calm callers, repeated or rude questions frustrate them, holds raise stress,
  escalations and arrivals trigger spontaneous lines, and broken promises (“help is on the way”) are remembered.
- Callers can misunderstand, contradict themselves, refuse questions when uncooperative, hang up, or call back (about the
  same incident) when ignored, cut off, sent to the wrong address, or when things get worse.
- Only the simulation changes game state. Dialogue output is a list of lines carrying facts; the engine validates and applies them.
- Medical content is deliberately high-level: the game models urgency and dispatch decisions and never gives medical instructions.

## Project layout

```
src/sim/           engine, city generator, routing, dialogue, scoring, profile/economy, fleet, scenarios, content/
src/ui/            React screens: map (canvas), call console, panels, hub, report, settings
src/audio/         procedural audio manager
src/persistence.ts IndexedDB / memory key-value store + SaveManager (versioned, migrations)
src/store.ts       zustand app store (screens, profile, live engine)
tests/             vitest suites (engine loop, dispatch, escalation, saves, city)
scripts/balance.ts headless balance harness
```

## Notes

- The simulation lives entirely outside React: the UI reads `engine.state` and calls engine actions; rendering never
  drives simulation timing. Everything in `GameState` is plain JSON so shifts can be snapshotted and restored.
- The OpenAI Realtime voice/microphone integration originally specced for this project was removed at the owner’s request;
  there is no backend, API key, or `.env` file to configure.
