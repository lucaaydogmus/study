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
| `Tab` (in the call box) | Say the top suggested reply | `C` | Count compressions with a caller doing CPR |
| Listen (call controls) | Listen to the background for where the caller is | Calm / Jobs tabs | Keep the caller together and give them something useful to do |
| `Q` | Outside help on the radio's outside line (tow, utilities, specialists, federal team, Guard EOD, mutual aid) | Hold `V` | Push-to-talk to the caller or the selected crew |
| `N` | Jump to whatever needs you most (oldest ringing call, or the incident furthest behind) | Type your answer | Callers and crews ask in the chat or on the radio — answer in your own words |
| `K` | CCTV terminal: pick a camera, wait for the stream, pan with ← → | Click a camera on the map | Connect to it (while the CCTV terminal is open) |

## What is in the game

### Remaster 12: the radio desk, answering in your own words, and a cleaner dispatch flow

- **No more answer buttons.** When a caller asks you something ("should I go back in for the cat?") it is just a
  line in the chat; you answer by typing (or saying) what you would say. When a crew needs a decision (a meal
  break, a tactical call, a stressed crew asking to stand down, Harlow County asking for help) you get a radio
  notification with a pager tone. Open that channel and answer them in text. The game reads yes and no, "go" and
  "stay", and which option you mean. With AI callers on, Claude interprets answers the keywords cannot place
  and voices the caller's or crew's reaction. If it really is unclear, they ask you to say again.
- **Outside help is requested on the radio.** The Resources panel is gone. The radio has an outside line for
  county, utilities, state and federal agencies. Crews ask there for what they need (tow, gas company, K-9,
  negotiators, hazmat, USAR, Coast Guard, the federal team, Guard EOD, mutual aid). You request it by button or
  just by typing "get a tow down here". If you forget, they chase you at about 45, 95 and 150 seconds, and the
  third miss costs the scene. You can also tell them none is available.
- **The radio desk.**
  - Talkgroups: Ops 1 (police), Fire 2 (fire/EMS) and the outside line, plus a private channel per crew.
  - Emergency traffic only holds routine chatter. Release it, because crews pile up behind it.
  - Roll call has every unit report its position.
  - You can patch police and fire together on big incidents.
  - Transmissions that get stepped on or lost in a dead spot need a "say again".
  - When an officer hits the orange emergency button you have about 20 seconds to acknowledge it and get backup
    rolling.
- **Stations are buildings with upkeep.** Bay doors jam, the station alerting system fails so crews miss the
  tones (re-tone them), generators die in blackouts, fuel tanks run dry, stores run out, and police cells fill
  up. Repair from the station card, or fix everything between shifts in the hub.
- **Hospitals:** call the charge nurse to get an ambulance released from the ER door.
- **New calls and situations:**
  - Text-to-911 sessions from people who cannot talk.
  - Swatting hoaxes: ring the address before officers go in.
  - Car chases you may need to call off before someone gets hurt.
  - CAD outages, when the map only shows where units last reported.
  - Premise hazard flags on addresses, learned over your career.
  - A supervisor with timed directives, and an end-of-shift review of a few of your calls.
- **A cleaner dispatch flow.**
  - Every incident has a sticky header with a four-step tracker (Location, Type, Units, On scene) and one line
    saying what to do next, with a button for it.
  - The incident list shows each incident's next step, and `N` jumps to whatever needs you most.
  - Call controls sit in one strip above the conversation, and the call panel opens taller when a call is
    live.

### Remaster 11: one realistic mode, a camera network, and callers who are not simple

- **One mode: Realistic.** There is no difficulty picker any more. Every shift except the tutorial has fewer
  cooperative callers, more wrong addresses, shorter ring times, and no assists. That means no response plans,
  no auto-classification, no suggested replies and no one-click locations.
- **Faster escalation.** Once an incident has escalated, the next stage comes within about three minutes, and
  usually sooner. The first stage comes within about five minutes. Nothing left unattended sits for more than
  about thirteen minutes before it goes wrong. The old seven- and eight-minute waits between stages are gone.
- **The CCTV terminal (`K`).** The city has about 90 cameras on poles. Fixed cameras look one way; dome cameras
  (PTZ) pan and zoom. Some see in the dark (IR), others are nearly blind at night. Some are simply broken today,
  and you only find out by trying them. Nothing is automatic:
  1. Pick a camera by district and street, or click one on the map.
  2. Wait a few seconds for the stream to connect.
  3. Aim and zoom the camera.
  4. Work out what you are looking at and click it to report it against an incident.

  In 3D mode the feed is rendered live from the camera's position in the city, with sensor noise, IR, fog and
  rain on the lens. The analytics only box moving people and vehicles. Smoke, wrecks and crowds you have to spot
  yourself. Report the wrong scene and the incident points somewhere it isn't.
- **Regular callers.** Doris, Mr Kroll, Tee, Rosa and Gerald ring about nothing most of the time. The CAD shows
  their file, and it grows across your career. Now and then it is real. Send a regular to the non-emergency line
  on the day it is real and it goes on the record.
- **Third-party callers.** A child calling about a parent, or a neighbour at a locked door, cannot tell you if
  the patient is breathing. Get them closer: a spare key, a look through the window, or "take the phone to
  Mummy". Sometimes the parent is awake and takes over the call.
- **Callers on the move.** A caller driving a sick passenger to hospital keeps moving. They report landmarks a
  few seconds late ("we just went past Linden Park"). Tell them to pull over, or have the ambulance flag them
  down.
- **Thieves on foot.** Bag-snatch chases on foot. A runner is hard to see from a patrol car and easy to lose.
  Sightings from passers-by come in late and rough, and a city camera that keeps him in frame keeps his
  position live.
- **Scene command.** Big structure fires with several companies on scene need an incident commander and
  companies assigned to sectors: fire attack, ventilation, search, water supply and exposures. Leave sectors
  empty or give a job to the wrong company and the whole fireground slows down.
- **Storm cells.** In bad weather, storm cells form upwind and drift across the radar. Districts get a warning
  before a cell arrives. Streets under a cell flood (routes adapt) and drain once it has passed.
- **Crew stress.** Bad calls stay with the crews who were there, and the stress carries over between shifts.
  Stressed crews work slower and fumble dispatches, and they ask to stand down. You can give them time out of
  service, rotate in off-duty staff (overtime), or keep them working and live with the mistakes.
- **Relayed calls.** A car's crash detection rings in through an operator with the exact location and nothing
  else. An alarm company relays a fire alarm with no keyholder; usually it is dust in a detector, sometimes it
  is not.
- **Halloween night.** Shifts played on 31 October run on Halloween night: trick-or-treaters in dark costumes,
  candles in paper decorations, a "man with a rifle" who turns out to be in costume, and eggings. You can also
  pick it in free play.

### Remaster 10: a cinematic 3D city, crews you can talk to, and a city that works

**A real 3D city**
- The map is now rendered in 3D with three.js: every street with pavements, lane markings and zebra crossings,
  raised bridges with railings and piers, river quays, the bay and a beach, and every building with walls, roofs,
  parapets, rooftop plant, solar arrays, roof gardens and chimneys. Landmarks (hospitals, City Hall's dome, the
  cathedral, the clock tower, terminal, stadium with floodlights, cranes, ships, trains) are proper models, and every
  station is a building with apparatus bays.
- A city shader draws window grids, glass curtain walls, shopfronts with awnings and doors, roller doors on
  warehouses, and lit windows after dark; asphalt, grass and paving are textured; snow settles on roofs and roads
  shine in the rain.
- Sun and moon lighting with soft shadows that track the time of day, bloom, ACES tone mapping and colour grading.
- **Every vehicle is a 3D model at true scale** (one world unit is 4 m): patrol cars, SUVs, vans, motorcycles,
  bikes, officers on foot, engines with lockers, ladders with the aerial on top, rescue trucks, ambulances, the
  helicopter with spinning rotors, and every specialist truck. Light bars flash and throw coloured light on the road.
  Moving vehicles keep to their lane; crews at a scene park neatly along the kerb, nose to the junction.
- Civilian traffic drives in proper lanes (two per side on main roads, three on the expressway), cars park along
  the kerb and in car parks, street lights glow at night, fires burn with flames and rising smoke (and light up the
  street), and crashes leave wrecked cars in the road.
- Every station is a real building: a red-brick firehouse with open bays and a hose tower, a police station with a
  glass entrance and comms mast, an EMS base with a canopied forecourt. Vehicles at quarters sit on the
  forecourt in their own bays (click them there). When you send one, its lights come on while the crew turns out,
  then you watch it pull out of its bay onto the road; it reverses back in when it returns. (The classic 2D view
  shows the same, from above.)
- Zoom from the whole city right down to street level (the camera tilts as you zoom). The 2D overlay (pins,
  routes, labels, sectors) sits exactly on top, so everything stays clickable.
- Settings → Graphics: *Cinematic 3D* or *Classic 2D*, and High / Medium / Low quality.

**Talk to your crews**
- The Radio tab is now a radio console: a channel per unit. Talk to a crew with quick chips (Status, ETA,
  What do you see?, Need anything?, Expedite, Code 2, Use caution, Caller update, Suspect info, Patient condition,
  Stage, Return, Good work), type anything, or hold **V** and speak.
- Crews answer from what they can actually see: progress on scene, the patient's condition, what they still need.
  Expedite and Code 2 change how they drive, "use caution" makes fire and EMS stage until police clear the scene,
  thanking them lifts morale, and they ask you follow-up questions back.
- Each crew has a personality from who is riding: veterans keep it short, rookies ask a lot, some are easy-going,
  some go by the book with 10-codes.
- Fire and EMS on a busy road ask for police traffic control; crews chat between themselves, from quarters, and
  across services.

**Calls**
- **Real voices**: callers and crews speak their lines aloud with your browser's voices: a different voice, pitch
  and pace for each caller, faster and higher when they panic.
- **Push-to-talk**: hold V (or the mic button) and talk to the caller or a crew; your words appear and are sent.
- **Protocol card** on every call: case entry, then the key questions for that kind of emergency, ticking off as
  you ask.
- **Bad mobile lines**: words drop out and whatever they said is lost until you ask them to say it again.

**The resources panel (Q)**
- One panel for everything outside your fleet: tow trucks, power and gas companies, animal control, public works,
  the transit authority, the Red Cross, the medical examiner, a K-9 unit, crisis negotiators, the regional hazmat
  team, an urban search and rescue task force, the Coast Guard, the federal tactical team, National Guard EOD and
  mutual aid by capability. It shows what helps this incident, what the crews asked for, prices and ETAs, and what
  is already on the way.
- Specialist teams drive in from the city limits with their own models and work their own scenes much faster.
  City services clear blocked roads, stop the trains and shelter families who lost their homes.

**Stations and hospitals**
- Vehicles wear down with hard driving. Worn ones are slower and break down more. Send them to the workshop
  mid-shift (right-click a unit) or service the fleet between shifts; wear carries over in the career.
- Arrests mean a trip to the nearest police station for booking (a prisoner van saves your patrol cars the trip).
- People walk into fire and EMS stations needing help, and the crew on duty takes it.
- Hospitals call 911 themselves: urgent transfers for specialist care, blood and organ runs that need a police
  escort, violent patients in the ER.
- Ask a hospital on diversion to take one more patient from the bed board.
- Mass-casualty incidents ask you how patients are distributed (spread out, trauma centre or nearest), with real
  effects on ER load.

**More to happen, more to hear**
- New calls: a child in a hot car, a road collapse with a car in a sinkhole, a drone over the runway, an overdose, an
  armed robbery at a petrol station, a scaffolding collapse, road rage, pupils sick from fumes at a school.
- Sound that follows the camera: traffic, water, birds by day and crickets at night, crowds, crackling fires, rain
  and thunder. Plus station alert tones when a crew turns out, fire engine air horns, hospital pagers and the
  custody door at booking.

### Remaster 9: big days, specialists and the garage

**Anything can happen**
- **Major incidents happen on ordinary shifts**: career, free play and endless can now throw a bank robbery, active
  shooter, bomb threat, armed siege, kidnapping, crowd crush, derailment, tanker fire, riot or vehicle attack at you
  out of nowhere. They are rare (roughly one shift in three, more at higher ranks and difficulties), always within
  what your rank has unlocked, and they make the breaking news a few seconds after the first call.
- **Surprise city events**: rush hour, storms, heat waves, festivals, and four new ones: a **mass protest** (closed
  roads, a march that can turn ugly), **civil unrest** (a riot breaks out, with looting, burning cars and group assaults),
  the **city marathon** (closed course, collapsing runners) and a **transit strike** (everyone drives).
- **Threat level at the briefing**: low, guarded, elevated or severe. It hints at what the analysts expect without
  spoiling it. Scheduled events (marches, the marathon, strikes) and weather forecasts are listed with their start time.
- **New calls**: riots, protest marches, looting, a man beaten by a group, suspicious packages (sometimes a real device
  with wires and a phone taped inside), chemical spills, vehicles driven into crowds, and runners collapsing.
- Free play has a **Surprises on/off** switch and all the new events.

**Call in the big guns**
- **Federal tactical team**: for active shooters, sieges, kidnappings, bank robberies, vehicle attacks and riots. Slow to
  mobilise and they drive in from the city limits, but they are decisive on arrival and bring a crisis negotiator
  (talks almost never break down when they are on scene).
- **National Guard EOD**: bomb technicians with a robot for bomb threats and real devices. A suspected device now needs
  bomb disposal, from your own bomb squad, mutual aid or the Guard.
- Crews on scene **ask you** for them over the radio. The request button pulses on the incident card and is in the
  right-click menu too.
- New field decisions: hold, push or pull back from a riot line; talk to march organisers or clear the road; wait for
  EOD or let an officer look at the device.
- Handling a major incident well earns a **hazard grant** and extra XP.

**New units (unlocked by rank)**
- Police: **foot patrol** and **bike units** (cheap, slow, great in crowds and disturbances), **public order unit**
  (riot police) and the **bomb squad**.
- Fire: **fire rescue ambulance**, **paramedic engine** (fights fire and gives advanced life support) and **hazmat**.
- Specialists work their own scenes much faster: public order at riots, hazmat at spills, bomb techs at devices.

**The garage (shift preparation)**
- Every vehicle can be fitted out before a shift. Pick a **chassis**: an interceptor is faster but has one equipment
  slot, an SUV is slower with three slots and all-weather grip, an armoured truck is slow and nearly unstoppable. Fire
  and medical have their own (rapid intervention, heavy pumper, box ambulance, all-terrain 4×4).
- Load **equipment slots** with kits that really change the sim: AED (officers give first aid), less-lethal, riot
  shields (a patrol car can hold a protest line), K-9, patrol rifle, spike strip, thermal camera, hydraulic rescue
  tools, foam, swiftwater kit, mechanical CPR, an ALS upgrade (a basic ambulance becomes a paramedic unit), trauma
  packs, powered stretchers and a paediatric kit.
- Pick a **livery** and give the vehicle a **nickname**. The vehicle on the map is drawn the way you built it, lights
  flashing in the showroom bay. Kits and chassis are rank-locked and cost money; removing kit and repainting are free.
- The prep screen also has **deployment presets** (all at stations, or spread across your districts).

**A city worth looking at**
- Close-up buildings now have real facades: window grids with reflections, glass curtain walls with mullions on the
  towers, shopfronts with coloured awnings, front doors and framed windows on houses, roller doors on warehouses, and
  shading where walls meet the street. Flat roofs have parapets.
- Street lights pool on the ground under the buildings at night, the river has stone embankments and a deep channel,
  there is a beach along the bay, the side streets recede in the overview so the main roads read first, and the whole
  city is lit by a warm north-west sun.

### Remaster 8: keep them together, use your crews, hear the city

**The call**
- **A new call screen**: chat bubbles, the caller's avatar and a live **composure** meter showing how well they are
  holding together. It drains while they wait in silence ("silent 27s — they're waiting on you"), and a caller left at
  breaking point falls apart and may hang up.
- **Calming techniques** that depend on who is on the line: *reassure* (frightened callers), *be firm & simple*
  (cuts through panic, but angers angry callers and scares children), *acknowledge* (defuses anger), *ground them*
  (steadies the shaken, and their description of the surroundings can give away where they are), *give an update*
  (exactly who is coming and how long). Saying the same thing again wears thin.
- **Breathe with me**: a guided breathing exercise. Hold the button while the circle grows and release while it shrinks.
- **Give them a job**: turn the outside light on, unlock the door, send someone to wave the crew in, shut the dog
  away, gather medications, keep the patient warm, count breaths, count heads, move everyone back, describe the
  suspect, lock yourself in. Jobs calm the caller and really help: crews find the place, get in, treat faster, and you
  get the description for a BOLO. Some jobs are dangerous in the wrong call; never send a caller to open the door to an
  intruder.
- **Developments while help is on the way**, each needing your answer: blood soaking through the dressing, snoring
  breathing, vomiting, a seizure, a patient trying to get up, smoke under the door, a neighbour with a garden hose,
  someone trying the door handle, fuel leaking under a crashed car.
- **Callers don't know you dispatched**: they only learn help is coming when you tell them.
- **Listen**: listen hard to the background. Level-crossing bells, gulls and ship horns, jets, school bells, church
  bells, crowds, machinery and dogs are all worked out from where the caller really is, and they are played through
  the phone line. Faint background sounds come through on their own during every call too.
- **Non-emergency calls and reporters**: noise complaints, lost pets, power cuts and reporters fishing for details.
  Send them to the non-emergency line or press office; send a real emergency there and they call back worse.

**Your crews**
- **Crews ask you for information on the way in**: "Any weapons?", "Anyone still inside?", "How old is the patient?",
  "Any hazards?". Relay what the caller told you, say *stand by* and find out, or tell them there is nothing. Right
  answers make them faster and safer; a wrong "no weapons" puts officers at risk.
- **Firefighter PAR checks and MAYDAYs**: crews inside burning buildings owe you accountability checks. A timely check
  catches a missing firefighter early; a lapsed one can end in a MAYDAY, where you send a rapid intervention team, pull
  everyone out, or wait.
- **Patients who refuse care**: persuade them, let them sign, or send an officer. Signed refusals sometimes collapse
  later.
- **A loose dog at the door** holds crews up unless the caller shut it away.

**Look, sound and feel**
- **Vehicle models**: every unit type has its own top-down model (patrol cars, traffic cars, vans, SWAT, motorcycles,
  engines, ladders with their aerial, rescue trucks, ambulances with star of life and beacons, supervisors), with
  flashing light bars that glow brighter at night and headlights after dark.
- **A new city look**: asphalt streets with pavements, double yellow centre lines, lane markings and zebra crossings,
  shading where buildings meet the ground, drifting cloud shadows, and a proper dome on City Hall.
- **Cinematic beats**: letterboxed title cards for major incidents, MAYDAYs and pursuits, a live picture-in-picture
  camera on the scene, and the screen jolts when a fire escalates.
- **A living soundscape**: callers "speak" in their own voice pitch, the dispatch room never goes quiet (keyboards,
  colleagues on other calls, distant phones), and there are all-units attention tones, a MAYDAY alarm and a
  major-incident stinger.
- **Escalation forecast** on every incident: whether it is getting worse, when the next stage hits, and what happens.
- **Realistic mode** (formerly hard/expert) switches the assists off: no response plans, auto-classification, suggested replies, clickable
  addresses or one-click locations. You classify, pick units and type addresses yourself.

### Remaster 7: calls that talk back

- **Callers ask you things**: "Should I go back in for the dog?", "Can I give him water?", "I can hear them
  downstairs — should I go and look?", "How long until they get here?", "They're here — can I hang up?" The question
  appears in the chat with answer buttons and a countdown. Good answers keep people safe and calm. Harmful ones have
  the same consequences as typed advice, and promising "any second now" when help is minutes away comes back to bite
  you. Stay silent and the caller decides for themselves, sometimes badly.
- **Speech that plays out**: caller lines appear word by word, with a speaking indicator and an avatar whose ring
  shows how they are coping.
- **Clickable details**: addresses and landmarks the caller mentions are links that set the incident location. Danger
  words (weapons, bleeding, not breathing, fire, trapped) and numbers (people, cars, ages) are highlighted.
- **Suggested replies**: up to four chips under the chat suggest what to ask or say next, based on what the caller just
  said and what you still don't know. `Tab` in the empty message box says the top one.
- **CPR count-along**: when a caller is doing CPR, count the compressions with them. Tap the beat (`C`) at 100–120 a
  minute and the patient holds on noticeably longer; the caller tells you when you're too slow or too fast.

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
src/sim/           engine, city generator, routing, dialogue, scoring, profile/economy, fleet, garage, scenarios, content/
src/ui/            React screens: map (canvas overlay), call console, radio console, resources panel, panels, hub, report, settings
src/ui/world3d/    the three.js city: geometry builder, city shader, lighting and post-processing, vehicle models
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
