# SIGNAL 911 — Emergency Dispatch Simulator

An original, browser-based 911 dispatch strategy/simulation game set in the fictional city of **Ravenport**.
You take emergency calls, work out what is really going on from what callers tell you, place the incident on a
living city map, and send police, fire/rescue and medical units along a real road network — while the city
escalates around you.

> SIGNAL 911 is a work of fiction. Ravenport, its callers and every incident are invented. It is **not** connected
> to any real emergency service. Never use it to report a real emergency.

Callers are scripted, reactive characters by default — the game works offline with no key. Optionally, add an
**Anthropic API key** and callers improvise their lines with Claude (see *AI callers*). There is no microphone.

## Run it

```bash
cd signal-911
npm install
npm run dev        # http://127.0.0.1:5173
```

## AI callers (optional)

1. Get an API key from the Anthropic Console.
2. Start the game with `npm run dev`, open **Settings → AI callers**, paste the key and press **Save key**
   (or copy `.env.example` to `.env.local` and fill in `ANTHROPIC_API_KEY`).
3. Pick a model, set a daily spending cap, press **Test a caller line**, then start a shift.

How it stays safe and cheap:

- The key is stored in `.env.local` on your computer and used only by the small server built into `npm run dev` /
  `npm start` (`server/ai.ts`). It is never sent to the browser, and the endpoints only answer requests from this computer.
- Each caller line is one short request: a cached system prompt, a compact JSON description of the caller and the
  situation, low reasoning effort, and a short structured JSON reply. One extra request now and then generates a
  batch of persona profiles that add variety for free afterwards.
- Hard limits: a daily dollar cap (default $1), a per-shift line cap, and a rate limit. Usage and estimated cost are
  shown in Settings. When a limit is reached, the API fails, or the model declines, callers fall back to scripted
  lines instantly — the game never waits on the network.
- The default model is Claude Opus 5.5 (≈ $0.006 per line). Claude Haiku 5.5 is roughly 30× cheaper (≈ $0.0002 per
  line, about a cent per shift); switch in Settings.
- The engine stays in charge: it decides what each caller knows and which facts, locations and twists exist. Claude
  only phrases the lines and judges how your words land (calmer or more upset). Hidden information is never sent.
- Test the plumbing without a key or cost: `AI_MOCK=1 npm run dev`.

Other commands:

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm test           # 48 simulation, mechanics, AI-pipeline and persistence tests (vitest)
npm start          # production build served with the AI endpoints
npx vite-node scripts/balance.ts   # headless balance harness (bot vs. idle dispatcher)
npx vite-node scripts/smoke.ts     # plays the set-piece scenarios with a bot that uses air support and records
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
| `T` | Records terminal (officer ID / warrant / plate checks) | `R` | Relay the helicopter's position to ground units |
| `Esc` | Cancel / deselect / menu | `?` | Help |
| `Enter` | Dispatch the response plan for the selected incident | `F` | Fly the camera to the selection |
| `B` | Broadcast a BOLO for the selected incident | Wheel / drag | Zoom / pan |
| Right-click | Quick-order menu for incidents, units, stations, hospitals and streets | Drag a unit | Drop it on an incident to dispatch, or on a street to move it |
| Drag a station | Sends its next free unit to the incident you drop it on | Drag a pin | Move an incident, or drop it on another to link duplicates |
| `S` | Status check on the most overdue officer | Shift + drag | Box-select several units, then right-click an incident to send them all |

## What is in the game

### Remaster 6: searches, outside agencies, officer safety and public alerts

- **Missing-person searches**: missing people, lost children and lost walkers come with a search grid around the
  last-seen point: lettered sectors shaded by how likely the person is to be there (parks, woods and shopping areas
  score higher). Send crews sector by sector from the incident card, by right-clicking a sector, or by dragging a
  unit onto it. A helicopter's thermal camera sweeps every sector at once, best at night. If the whole grid comes up
  empty, the last-seen point was wrong: fix the location and the grid is redrawn.
- **Outside agencies**: crashes need tow trucks, downed lines the power company, gas leaks the gas company, loose
  animals animal control. Crews ask on the radio and the scene cannot clear until the agency arrives. Call it from
  the incident card or the right-click menu (calling ahead saves time). Leave them waiting and they phone it in
  themselves, late.
- **Officer status checks**: police on scene owe dispatch a check-in. When one is due the officer gets a pulsing
  *STATUS?* ring and a dock appears (`S` checks the most overdue). A check can catch trouble early, so backup goes in
  before anyone is hurt. Let it lapse on the wrong call and an officer can go down.
- **Public alerts**: for serious incidents, send an evacuation order or a shelter-in-place to every phone in the
  district. The right one halves casualties if things escalate. The wrong one puts people in harm's way, and a
  needless alert costs reputation. Either way, worried residents ring in asking if it is real.
- **Box-select**: Shift+drag a box around several units, then right-click an incident to send them all, right-click
  a street to move them, or recall them all at once.
- New achievements: *Found Safe*, *Code Four?*, *Clear the Area* and *Logistics*.

### Remaster 5: map, sirens and hands-on dispatching

- **Sirens you can hear**: rebuilt siren synthesis (two detuned horns through a soft-clip driver) at a proper
  level, with distance falloff from the camera. Settings → *Sirens & rotors* plays a test burst; click the page once
  so the browser allows audio.
- **New map look**: a bright daylight palette with warm-toned houses and slate roofs, cooler towers and coloured road
  casings; golden hour at dawn and dusk; at night the colour drains out, buildings darken and their windows glow.
  Street names appear along the roads when you zoom in.
- **Tidy vehicles**: zoomed out, every unit is a clean marker with a heading notch, a flashing ring when it runs
  lights and sirens, and a dashed ring on patrol. Crews sharing a scene park nose-first in a neat bay under the pin
  with one caption, instead of overlapping badges.
- **Right-click anything**: incidents (send the response plan or the nearest police/fire/EMS unit with ETAs, request
  air support, brief crews, check CCTV, broadcast a BOLO), units (divert, Code 2/3, staging, sitrep, traffic stop,
  patrol, move to cover, recall), stations (their vehicles and status), hospitals (live bed board, specialties,
  diversion, inbound ambulances) and streets (move the nearest free unit there to cover, set an incident's location,
  lay spikes during a pursuit).
- **Drag to dispatch**: drag a unit onto an incident to send it (with the ETA shown while you drag), drag a whole
  station to send the next free unit that fits the call, drag an ambulance onto a hospital to change its destination,
  drag an incident pin to correct its location, or drop it on another incident to link duplicates.
- **BOLOs**: once the caller has described the suspect, broadcast a be-on-the-lookout to every patrol. Patrolling cars
  may spot them later: a vehicle starts a new pursuit, a person on foot becomes a stop with a records check. Vague
  descriptions bring wrong stops; suspects caught on scene are not out there to find.
- **Spike strips**: during a pursuit, right-click a street ahead of the suspect to send the nearest police car to lay
  stop sticks. If the car drives over them its tyres are shredded and the chase is nearly over; the spike car joins in.
- **Code 7 meal breaks**: tired crews radio in for a meal break. Approve it (out of service for a while, back fresh),
  put them off (they keep tiring) or deny it (morale drops).
- New achievements: *Be On the Look-Out*, *Stop Sticks* and *Fed and Rested*.

### Remaster 4: a living city

- **New look**: a cinematic home screen (a night flyover of the live city, radio feed and daily challenge) and a
  reworked HUD-style interface throughout.
- **Real buildings**: the whole map is now 3D — tiered towers with helipads and plant rooms, gabled houses with
  chimneys and pools, warehouses, car parks — plus landmark models: hospitals with rooftop helipads, the cathedral,
  the clock tower, City Hall's dome, the airport terminal and control tower with parked airliners, harbour cranes and
  container ships, freight trains, factories, the lighthouse and the stadium bowl. Parked vehicles appear as status
  dots under their station; only units out on the road are drawn as vehicles.
- **Callers with their own voices**: every caller gets a speech profile (verbal tics, how they address you,
  formality, slang, a catchphrase, personal tangents), and each caller type has its own lines for the quiet moments.
  AI callers receive the same profile.
- **Storylines during ordinary shifts**: the set pieces — bank heists, active shooters, emergency landings,
  derailments, chemical spills, stadium crushes, joyriders, Amber alerts — can break out mid-shift, with a BREAKING
  banner and a city news ticker that reports how you handled them.
- **Police on patrol**: patrol cars cruise their beat instead of waiting at the station, respond from the road, pull
  cars over on their own, run rolling plate checks (stolen cars run), and come across incidents themselves (on-view).
  You can order a stop yourself.
- **Records terminal, for real**: officers read out the surname (spelled phonetically), first name, date of birth and
  sex, or the plate and vehicle. You type the query; the database returns full records — address, physical
  description, licence status, warrants, criminal history, caution flags — including namesakes and near-miss
  spellings. Pick the right record and relay the return; the officer catches a wrong date of birth.
- **Unit commands**: upgrade/downgrade Code 2/3, stage EMS until police secure an armed scene (crews walking into an
  unsecured scene can be attacked), brief responding crews with what the caller said, divert units, request a sitrep.
- **While units are en route**: crews ask how to get in — flat number, gate code, which door. Get it from the caller
  and brief them, or they lose time at the door.
- **Hospital coordination**: hospitals have trauma, cardiac, stroke, paediatric and burns capability, live ER load and
  departments that go down mid-shift. Medics ask where to take specialist patients; your bed board only shows what you
  knew at the last refresh. Pre-alert the hospital for a faster handover and better outcome; the wrong destination
  means a secondary transfer.
- **Dispatcher tools**: wireless call trace with an uncertainty circle that tightens while the caller stays on the
  line (VoIP addresses can be wrong), silent callers who answer by tapping, Language Line interpreters, calling back
  dropped callers, and city CCTV cameras with a live feed.
- **Tactical decisions**: crews ask you to choose — interior attack or defensive, negotiate or breach, go in now or
  wait for tactical, treat on scene or load and go, evacuate or search. Fires that get away spread next door.
- **A living radio**: units coordinate with each other, hospitals announce diversions, patrols chat between calls.

### Remaster 3: air support, major incidents and consequences

- **2.5D city when you zoom in**: the camera tilts and buildings rise with lit windows at night, rooftop beacons,
  parked cars and civilian traffic that follows the simulated congestion. Slower machines automatically drop the extra
  detail to keep the frame rate up.
- **Sirens you can hear**: every responding vehicle on screen has its own positional siren (police wail / yelp, fire
  wail, ambulance hi-lo), panned left and right and louder as you zoom in, plus helicopter rotor noise. When the caller
  says they can hear sirens, you hear them down the line too. Volume: *Settings → Sirens & rotors*.
- **Air One**: a police helicopter with fuel, refuelling and storm grounding. Its camera picks up fleeing vehicles from
  far away and the observer gives running commentary — but ground units only know what you **relay** to them (`R`),
  which sends them to an intercept point ahead of the suspect. Without air cover, lone patrol cars can lose a suspect in traffic.
- **Major incidents**: bank robberies (and the getaway van that breaks out of them), active shooters with victims
  fleeing the building, bomb threats, carjackings and child abductions, tanker fires on the expressway, train
  derailments, house explosions, crowd crushes, a barricaded gunman, street racing, people stuck on a fairground ride,
  a child pulled from a pool, lost hikers — and at the airport: emergency landings with a **touchdown countdown**
  (crews must be staged on the runway before the aircraft lands), collapsed passengers and violent passengers.
- **Officer radio requests**: crews on traffic stops and at scenes radio for **ID / warrant checks** and **plate
  checks**. Run them on the RCIS records terminal (`T`), read the return carefully (names repeat — the date of birth
  decides) and radio it back. Tell an officer an armed subject is clear and they can get hurt; flag an innocent person
  and there is a complaint. Officers wait for your return before clearing the scene.
- **Your guidance has consequences**: patients who are not breathing, unconscious or bleeding badly have a **survival
  clock** that runs until crews take over. CPR, the recovery position or pressure on the wound slow it down; nothing
  lets it run; harmful advice speeds it up. Typed advice is understood too: telling a caller to give an unconscious
  patient water, to sit up someone with a spinal injury, to go back into a fire or to confront an intruder hurts people,
  and the report lists every consequence. Good coaching is credited when the patient survives.
- **New scenarios**: *The Heist*, *Code Red*, *Airport Alert* and *Eye in the Sky*. The Airport District now unlocks at rank 4.
- Callers no longer say they can hear the ambulance the moment you dispatch it: the siren line only comes once a unit
  running lights and sirens is actually close.

### Realism update

- **Phone instructions**: coach callers through CPR, the recovery position, pressure on a wound, keeping a casualty
  still, evacuating, or locking themselves in. The right instruction slows the deterioration (CPR only while you
  keep coaching); the wrong one makes it worse — ask the right questions first. A new cardiac-arrest call puts it to the test.
- **Dispatch console**: an automatic response plan you can send in one click, multi-select, ETA bars, matching
  capabilities highlighted, crew fatigue, route preview on the map when you hover a unit, and a warning when a unit
  would leave a district without cover.
- **Code 2 / Code 3**: lights and sirens are faster but units can crash en route (more likely in bad weather); Code 2 is
  slower and safe.
- **Vehicle breakdowns**, **background sounds** on every call ("[a smoke alarm shrieking]"), and a **stress meter**
  with an optional heartbeat when the pressure builds.

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
scripts/smoke.ts   headless run of the set-piece scenarios
```

## Notes

- The simulation lives entirely outside React: the UI reads `engine.state` and calls engine actions; rendering never
  drives simulation timing. Everything in `GameState` is plain JSON so shifts can be snapshotted and restored.
- The OpenAI Realtime voice/microphone integration originally specced for this project was removed at the owner’s request;
  there is no backend, API key, or `.env` file to configure.
