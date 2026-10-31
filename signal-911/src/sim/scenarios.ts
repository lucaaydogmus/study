// Handcrafted shifts: campaign chapters, scenario challenges and the interactive tutorial.
import type { CityEventType, Difficulty, Objective, Service, ShiftConfig, WeatherType } from './types';
import { Rng, hashString } from './rng';
import { CONTRACTS, MODIFIERS } from './extras';
import { TEMPLATES } from './content/templates';
import { DISTRICT_TAGS } from './city';

export const ALL_DISTRICTS = ['westres', 'university', 'northsub', 'airport', 'oldtown', 'downtown', 'financial', 'eastwood', 'southside', 'riverside', 'industrial', 'harbor'];

type Partial2 = Partial<ShiftConfig> & { title: string; briefing: string };
export function baseConfig(p: Partial2): ShiftConfig {
  return {
    mode: 'free', difficulty: 'standard', durationSec: 15 * 60, weather: 'clear', startHour: 8, incidentRate: 1, districts: ALL_DISTRICTS,
    events: [], objectives: [], seed: Math.floor(Math.random() * 2 ** 31), ...p,
  };
}
/** the game has one mode: realistic. Only the tutorial is gentler. */
export const REALISTIC: Difficulty = 'hard';
export function realistic(cfg: ShiftConfig): ShiftConfig { if (cfg.mode !== 'tutorial') cfg.difficulty = REALISTIC; return cfg; }
/** it is Halloween today: the evening shift gets trick-or-treaters, candles and costumes */
export const isHalloween = (d = new Date()) => d.getMonth() === 9 && d.getDate() === 31;
export function withHalloween(cfg: ShiftConfig): ShiftConfig {
  if (!isHalloween() || cfg.mode === 'tutorial' || cfg.events.some((e) => e.type === 'halloween')) return cfg;
  cfg.events = [...cfg.events, { type: 'halloween', at: 20, duration: Math.max(240, cfg.durationSec - 60) }];
  if (cfg.mode === 'career') cfg.startHour = 18.5;
  return cfg;
}
const obj = (id: string, text: string, kind: string, target: number, optional = false): Objective => ({ id, text, kind, target, optional });

export interface Chapter {
  id: string; title: string; subtitle: string; story: string; outro: string; minRank: number;
  config: (rank: number, districts: string[]) => Partial<ShiftConfig>;
  reward: { money: number; xp: number };
}

export const CHAPTERS: Chapter[] = [
  { id: 'ch1', title: 'Opening the Dispatch Centre', subtitle: 'Chapter 1', minRank: 1, reward: { money: 15000, xp: 120 },
    story: 'Ravenport Emergency Dispatch has just opened its new centre. The mayor is watching. Your first mission is simple: keep the phones answered and get help moving.',
    outro: 'The city noticed. The centre is open and the mayor is already asking for more.',
    config: () => ({ durationSec: 10 * 60, incidentRate: 0.75, startHour: 9, weather: 'clear', objectives: [obj('a', 'Resolve 5 incidents', 'resolved', 5), obj('b', 'Answer every call', 'no_missed', 0), obj('c', 'Average response under 150 s', 'avg_response', 150)] }) },
  { id: 'ch2', title: 'Rising Traffic', subtitle: 'Chapter 2', minRank: 1, reward: { money: 20000, xp: 160 },
    story: 'A new ring road has opened and collisions are spiking. Traffic is dense downtown, and every ambulance is fighting congestion.',
    outro: 'The ring road has been re-signed thanks to your reports. Fewer crashes — for now.',
    config: () => ({ durationSec: 12 * 60, incidentRate: 0.95, startHour: 16.5, weather: 'rain', events: [{ type: 'rush_hour', at: 60, duration: 600 }], objectives: [obj('a', 'Resolve 7 incidents', 'resolved', 7), obj('b', 'No casualties', 'no_deaths', 0), obj('c', 'Avoid wrong-location dispatches', 'no_wrong_location', 0, true)] }) },
  { id: 'ch3', title: 'Festival of Lanterns', subtitle: 'Chapter 3', minRank: 2, reward: { money: 25000, xp: 220 },
    story: 'Tens of thousands attend the annual Festival of Lanterns in Downtown and Old Town. Crowds, heat and lost children are on the menu.',
    outro: 'The lanterns lit up the river. Nobody was left behind.',
    config: () => ({ durationSec: 13 * 60, incidentRate: 1, startHour: 18, weather: 'heat', events: [{ type: 'festival', at: 45, duration: 660 }], objectives: [obj('a', 'Resolve 8 incidents', 'resolved', 8), obj('b', 'Average response under 140 s', 'avg_response', 140), obj('c', 'Handle all four incident categories', 'categories', 4, true)] }) },
  { id: 'ch4', title: 'Winter Storm', subtitle: 'Chapter 4', minRank: 2, reward: { money: 30000, xp: 280 },
    story: 'A freak winter storm has blanketed Ravenport. Roads are closing, falls and collisions are climbing.',
    outro: 'Snow ploughs finally reached the arterials. You kept the city moving.',
    config: () => ({ durationSec: 14 * 60, incidentRate: 1.05, startHour: 5.5, weather: 'snow', events: [{ type: 'winter_storm', at: 40, duration: 700 }], objectives: [obj('a', 'Resolve 8 incidents', 'resolved', 8), obj('b', 'No casualties', 'no_deaths', 0), obj('c', 'Shift score of 65+', 'grade', 65)] }) },
  { id: 'ch5', title: 'The Blackout', subtitle: 'Chapter 5', minRank: 3, reward: { money: 35000, xp: 340 },
    story: 'A substation failure has plunged half of Ravenport into darkness. Lifts have stopped, signals are dead and the phones will not stop ringing.',
    outro: 'The grid is back. The city will remember who kept the lights on at the centre.',
    config: () => ({ durationSec: 14 * 60, incidentRate: 1.1, startHour: 20, weather: 'clear', events: [{ type: 'blackout', at: 60, duration: 600 }], objectives: [obj('a', 'Resolve 9 incidents', 'resolved', 9), obj('b', 'Answer at least 12 calls', 'answered', 12), obj('c', 'Average response under 150 s', 'avg_response', 150)] }) },
  { id: 'ch6', title: 'River Rising', subtitle: 'Chapter 6', minRank: 3, reward: { money: 40000, xp: 400 },
    story: 'Days of rain have pushed the Ravenport River over its banks. A bridge is closing and Riverside is flooding.',
    outro: 'Water levels fell at dawn. Dozens of residents owe you more than they know.',
    config: () => ({ durationSec: 15 * 60, incidentRate: 1.1, startHour: 3, weather: 'rain', events: [{ type: 'flood', at: 45, duration: 750 }], objectives: [obj('a', 'Resolve 9 incidents', 'resolved', 9), obj('b', 'No casualties', 'no_deaths', 0), obj('c', 'Keep service coverage above 45%', 'coverage', 45, true)] }) },
  { id: 'ch7', title: 'Industrial Fire', subtitle: 'Chapter 7', minRank: 4, reward: { money: 50000, xp: 480 },
    story: 'A chemical depot in the Industrial Zone is burning. Every engine in the city will be needed — but the rest of Ravenport does not stop.',
    outro: 'The depot was saved from detonation. The city council has approved a new station.',
    config: () => ({ durationSec: 15 * 60, incidentRate: 1.15, startHour: 14, weather: 'heat', events: [{ type: 'industrial_fire', at: 30, duration: 780, districts: ['industrial', 'harbor'] }], objectives: [obj('a', 'Resolve 9 incidents', 'resolved', 9), obj('b', 'No casualties', 'no_deaths', 0), obj('c', 'Shift score of 70+', 'grade', 70)] }) },
  { id: 'ch8', title: "The Director's Test", subtitle: 'Chapter 8', minRank: 5, reward: { money: 80000, xp: 700 },
    story: 'A thunderstorm at rush hour with the festival still on. The board wants to see whether you can run the whole city.',
    outro: 'The board voted unanimously. Ravenport has its Dispatch Director.',
    config: () => ({ durationSec: 18 * 60, incidentRate: 1.25, startHour: 16.5, weather: 'storm', events: [{ type: 'storm', at: 30, duration: 840 }, { type: 'rush_hour', at: 60, duration: 780 }, { type: 'festival', at: 200, duration: 600 }], objectives: [obj('a', 'Resolve 14 incidents', 'resolved', 14), obj('b', 'No casualties', 'no_deaths', 0), obj('c', 'Shift score of 70+', 'grade', 70)] }) },
];

export interface ScenarioDef {
  id: string; title: string; tagline: string; description: string; difficulty: Difficulty; minutes: number; accent: string;
  config: Partial<ShiftConfig>; reducedFleet?: boolean;
  /** extra stations ([service, district]) and vehicles ([type, station id]) for this set piece */
  fleet?: { stations?: Array<[Service, string]>; units?: Array<[string, string]> };
  /** marks the new set-piece scenarios in the menu */ special?: boolean;
}
export const SCENARIOS: ScenarioDef[] = [
  { id: 'night_shift', title: 'The Night Shift', tagline: 'Few units. Long drives. Quiet city — until it isn’t.', description: 'Half your crews are off sick. It is 2 AM, fog is rolling in, and the calls start slow before piling up.', difficulty: 'hard', minutes: 12, accent: '#4A9CD6',
    config: { startHour: 1.5, weather: 'fog', incidentRate: 1.15, reducedFleet: true, objectives: [obj('a', 'Resolve 7 incidents', 'resolved', 7), obj('b', 'No casualties', 'no_deaths', 0)] } },
  { id: 'storm_warning', title: 'Storm Warning', tagline: 'Lightning, floods and a dozen simultaneous emergencies.', description: 'A severe thunderstorm hits Ravenport. Fires, collisions and flooded basements arrive from every direction.', difficulty: 'standard', minutes: 13, accent: '#E5AC4D',
    config: { startHour: 17, weather: 'storm', incidentRate: 1.2, events: [{ type: 'storm', at: 20, duration: 760 }], objectives: [obj('a', 'Resolve 9 incidents', 'resolved', 9), obj('b', 'Average response under 150 s', 'avg_response', 150)] } },
  { id: 'city_festival', title: 'City Festival', tagline: 'Crowds, heat and a river of people.', description: 'The Lantern Festival fills Downtown and Old Town. Heat exhaustion, fights and lost children — with gridlocked streets.', difficulty: 'standard', minutes: 12, accent: '#54B889',
    config: { startHour: 18, weather: 'heat', incidentRate: 1.1, events: [{ type: 'festival', at: 20, duration: 660 }], objectives: [obj('a', 'Resolve 8 incidents', 'resolved', 8), obj('b', 'Shift score of 65+', 'grade', 65)] } },
  { id: 'power_failure', title: 'Power Failure', tagline: 'Lights out across the city.', description: 'A grid failure blacks out most districts. Lifts stall, signals die and electrical fires erupt.', difficulty: 'hard', minutes: 12, accent: '#D65353',
    config: { startHour: 21, weather: 'clear', incidentRate: 1.15, events: [{ type: 'blackout', at: 20, duration: 640 }], objectives: [obj('a', 'Resolve 8 incidents', 'resolved', 8), obj('b', 'Answer every call', 'no_missed', 0)] } },
  { id: 'the_heist', title: 'The Heist', special: true, tagline: 'Armed robbers, a getaway van and a city to box in.', description: 'A crew has been hitting banks across Ravenport. Today they go for the Savings Bank in the Financial District. Get tactical units there fast — and when they run, put the helicopter on the van and talk your patrols onto it.', difficulty: 'hard', minutes: 12, accent: '#4A9CD6',
    config: { startHour: 14, weather: 'clear', incidentRate: 0.85, districts: ['financial', 'downtown', 'oldtown', 'riverside', 'westres', 'university'], forced: [{ at: 35, template: 'bank_robbery', district: 'financial' }, { at: 230, template: 'carjacking', district: 'downtown' }, { at: 400, template: 'kidnapping', district: 'westres' }, { at: 520, template: 'hostage_barricade', district: 'riverside' }],
      objectives: [obj('a', 'Catch 2 fleeing suspects', 'pursuits', 2), obj('b', 'Relay air support to ground units 3 times', 'relays', 3, true), obj('c', 'No casualties', 'no_deaths', 0)] },
    fleet: { units: [['tactical', 'police-downtown'], ['police_supervisor', 'police-westres'], ['patrol', 'police-westres']] } },
  { id: 'code_red', title: 'Code Red', special: true, tagline: 'Shots fired. A bomb threat. Phones exploding.', description: 'Something is very wrong in Ravenport today. A shooting at a shopping centre, a threat against the central station and casualties everywhere. Coach callers to hide, stop bleeding and keep people alive until your crews reach them.', difficulty: 'hard', minutes: 13, accent: '#D65353',
    config: { startHour: 12.5, weather: 'clear', incidentRate: 0.65, districts: ['westres', 'downtown', 'oldtown', 'riverside', 'financial', 'university'], forced: [{ at: 45, template: 'active_shooter', district: 'westres' }, { at: 300, template: 'bomb_threat', district: 'downtown' }, { at: 470, template: 'house_explosion', district: 'oldtown' }, { at: 600, template: 'crowd_crush', district: 'university' }],
      objectives: [obj('a', 'Resolve 7 incidents', 'resolved', 7), obj('b', 'Give 3 correct life-saving instructions', 'aid_good', 3), obj('c', 'No casualties', 'no_deaths', 0, true)] },
    fleet: { units: [['tactical', 'police-downtown'], ['med_supervisor', 'medical-downtown'], ['advanced_ambulance', 'medical-westres'], ['advanced_ambulance', 'medical-downtown'], ['command', 'fire-downtown'], ['patrol', 'police-westres']] } },
  { id: 'airport_alert', title: 'Airport Alert', special: true, tagline: 'An airliner on fire, three minutes out.', description: 'Ravenport International is having the worst day of its life. Stage your fire and medical units on the runway before every emergency landing — the aircraft will not wait for you.', difficulty: 'standard', minutes: 12, accent: '#9a8cd6',
    config: { startHour: 7.5, weather: 'fog', incidentRate: 0.75, districts: ['airport', 'northsub', 'financial', 'eastwood', 'downtown'], forced: [{ at: 30, template: 'aircraft_emergency', district: 'airport' }, { at: 210, template: 'unruly_passenger', district: 'airport' }, { at: 300, template: 'bomb_threat', district: 'airport' }, { at: 410, template: 'airport_medical', district: 'airport' }, { at: 520, template: 'aircraft_emergency', district: 'airport' }],
      objectives: [obj('a', 'Have crews in position for every landing', 'deadlines', 2), obj('b', 'Resolve 7 incidents', 'resolved', 7), obj('c', 'No casualties', 'no_deaths', 0, true)] },
    fleet: { stations: [['fire', 'airport'], ['medical', 'airport'], ['police', 'airport']], units: [['engine', 'fire-airport'], ['engine', 'fire-airport'], ['ladder', 'fire-airport'], ['advanced_ambulance', 'medical-airport'], ['ambulance', 'medical-airport'], ['patrol', 'police-airport'], ['tactical', 'police-airport']] } },
  { id: 'eye_in_the_sky', title: 'Eye in the Sky', special: true, tagline: 'Night. Fleeing cars. One helicopter.', description: 'Car thieves are running riot after dark. Ground units keep losing them in traffic — get Air One overhead, listen to the observer and talk your patrols onto the intercept.', difficulty: 'standard', minutes: 11, accent: '#E5AC4D',
    config: { startHour: 22, weather: 'clear', incidentRate: 0.7, districts: ['downtown', 'oldtown', 'westres', 'riverside', 'financial', 'southside'], forced: [{ at: 30, template: 'pursuit', district: 'downtown' }, { at: 170, template: 'carjacking', district: 'oldtown' }, { at: 320, template: 'pursuit', district: 'riverside' }, { at: 430, template: 'kidnapping', district: 'westres' }, { at: 540, template: 'street_racing', district: 'southside' }],
      objectives: [obj('a', 'Catch 3 fleeing suspects', 'pursuits', 3), obj('b', 'Relay air support 4 times', 'relays', 4), obj('c', 'Answer 3 officer records requests correctly', 'checks', 3, true)] },
    fleet: { units: [['patrol', 'police-westres'], ['motorcycle', 'police-westres'], ['traffic', 'police-downtown']] } },
  { id: 'rush_hour', title: 'Rush Hour', tagline: 'Every route is a crawl.', description: 'Peak traffic and rain. Collisions climb as ambulances crawl. Positioning units well before the call is your edge.', difficulty: 'standard', minutes: 10, accent: '#98A6B5',
    config: { startHour: 17, weather: 'rain', incidentRate: 1.1, events: [{ type: 'rush_hour', at: 10, duration: 560 }], objectives: [obj('a', 'Resolve 8 incidents', 'resolved', 8), obj('b', 'Average response under 160 s', 'avg_response', 160)] } },
];

// ── Live storylines: the scenario set pieces, happening during ordinary shifts ──
export interface Storyline { id: string; title: string; headline: string; minRank: number; needs: string[]; night?: boolean; steps: Array<{ dt: number; template: string; district?: string }> }
export const STORYLINES: Storyline[] = [
  { id: 'heist', title: 'The Heist', headline: 'Armed crew storms Ravenport Savings Bank', minRank: 2, needs: ['financial', 'downtown'], steps: [{ dt: 0, template: 'bank_robbery' }, { dt: 210, template: 'carjacking' }] },
  { id: 'code_red', title: 'Code Red', headline: 'Shots fired inside a shopping centre', minRank: 3, needs: ['westres', 'northsub', 'downtown', 'university'], steps: [{ dt: 0, template: 'active_shooter' }, { dt: 270, template: 'bomb_threat', district: 'downtown' }] },
  { id: 'airport', title: 'Airport Alert', headline: 'Airliner declares an emergency over Ravenport', minRank: 4, needs: ['airport'], steps: [{ dt: 0, template: 'aircraft_emergency' }, { dt: 170, template: 'unruly_passenger' }, { dt: 300, template: 'airport_medical' }] },
  { id: 'joyriders', title: 'Joyriders', headline: 'Stolen cars racing through the city', minRank: 1, needs: [], night: true, steps: [{ dt: 0, template: 'pursuit' }, { dt: 160, template: 'carjacking' }, { dt: 320, template: 'street_racing' }] },
  { id: 'chemical', title: 'Chemical Spill', headline: 'Tanker overturns and ignites on the expressway', minRank: 3, needs: ['industrial', 'harbor', 'airport'], steps: [{ dt: 0, template: 'tanker_fire' }, { dt: 150, template: 'gas_leak' }, { dt: 290, template: 'industrial_accident' }] },
  { id: 'derail', title: 'Derailment', headline: 'Freight train derails at Rail Yard 4', minRank: 4, needs: ['southside'], steps: [{ dt: 0, template: 'train_derailment' }, { dt: 220, template: 'gas_leak' }] },
  { id: 'match_night', title: 'Match Night', headline: 'Crush at Corvid Stadium after the final whistle', minRank: 3, needs: ['university'], steps: [{ dt: 0, template: 'crowd_crush' }, { dt: 140, template: 'public_disturbance' }, { dt: 260, template: 'fireworks' }] },
  { id: 'blaze', title: 'The Big Blaze', headline: 'Explosion rocks a residential street', minRank: 1, needs: ['westres', 'oldtown', 'riverside', 'northsub', 'southside'], steps: [{ dt: 0, template: 'house_explosion' }, { dt: 190, template: 'apartment_fire' }] },
  { id: 'amber', title: 'Amber Alert', headline: 'Child snatched from a playground', minRank: 2, needs: [], steps: [{ dt: 0, template: 'kidnapping' }, { dt: 240, template: 'missing_person' }] },
  { id: 'open_line', title: 'Open Line', headline: 'Silent 911 calls under investigation', minRank: 1, needs: ['westres', 'riverside', 'northsub', 'oldtown'], steps: [{ dt: 0, template: 'silent_call' }, { dt: 230, template: 'domestic_disturbance' }] },
];

/** roll a storyline for an ordinary shift and turn it into scheduled spawns */
export function rollStoryline(cfg: ShiftConfig, rank: number, seed: number, chance?: number): ShiftConfig {
  const rng = new Rng(seed ^ 0x5f3759df);
  if (cfg.durationSec < 7 * 60 || cfg.mode === 'tutorial' || cfg.script) return cfg;
  const p = chance ?? (rank <= 1 ? 0.25 : rank <= 3 ? 0.45 : 0.6);
  if (!rng.chance(p)) return cfg;
  const night = cfg.startHour >= 20 || cfg.startHour < 5;
  const pool = STORYLINES.filter((s) => s.minRank <= Math.max(1, rank) && (!s.needs.length || s.needs.some((d) => cfg.districts.includes(d))) && (!s.night || night || rng.chance(0.3)));
  const story = rng.pick(pool);
  if (!story) return cfg;
  const home = story.needs.filter((d) => cfg.districts.includes(d));
  const district = home.length ? rng.pick(home) : rng.pick(cfg.districts);
  const at = Math.round(cfg.durationSec * rng.range(0.22, 0.5));
  const forced = [...(cfg.forced ?? []), ...story.steps.map((st, i) => ({ at: at + st.dt, template: st.template, district: st.district && cfg.districts.includes(st.district) ? st.district : district, story: story.id, first: i === 0 }))]
    .filter((f) => f.at < cfg.durationSec - 60).sort((a, b) => a.at - b.at);
  return { ...cfg, forced, storyline: { id: story.id, title: story.title, headline: story.headline, at } };
}

/** big events can happen on any ordinary shift: a major incident out of nowhere, a protest, a storm, a riot */
export const SURPRISE_EVENTS: Array<{ type: CityEventType; minRank: number; w: number; needs?: string[] }> = [
  { type: 'rush_hour', minRank: 1, w: 2.4 }, { type: 'storm', minRank: 1, w: 1.8 }, { type: 'heat_wave', minRank: 1, w: 1.3 }, { type: 'festival', minRank: 1, w: 1.2, needs: ['downtown', 'oldtown'] },
  { type: 'protest', minRank: 2, w: 2.2, needs: ['downtown', 'financial', 'oldtown', 'university'] }, { type: 'transit_strike', minRank: 2, w: 1.3 }, { type: 'marathon', minRank: 2, w: 1.1, needs: ['riverside', 'downtown', 'oldtown', 'westres'] },
  { type: 'blackout', minRank: 2, w: 1.1 }, { type: 'winter_storm', minRank: 2, w: 0.9 }, { type: 'flood', minRank: 3, w: 0.9, needs: ['riverside', 'southside', 'harbor'] },
  { type: 'riot', minRank: 3, w: 0.8, needs: ['downtown', 'financial', 'oldtown', 'university'] }, { type: 'industrial_fire', minRank: 4, w: 0.7, needs: ['industrial'] },
];
export function rollSurprises(cfg: ShiftConfig, rank: number, seed: number): ShiftConfig {
  if (cfg.surprises === false || cfg.mode === 'tutorial' || cfg.mode === 'scenario' || cfg.script || cfg.durationSec < 6 * 60) return cfg;
  const rng = new Rng(seed ^ 0x2545f491);
  const out: ShiftConfig = { ...cfg, forced: [...(cfg.forced ?? [])], events: [...cfg.events] };
  const boost = cfg.difficulty === 'hard' ? 0.08 : cfg.difficulty === 'expert' ? 0.14 : cfg.difficulty === 'casual' ? -0.1 : 0;
  const r = Math.max(1, rank);
  // 1. a major incident out of the blue
  let major = false;
  const pMajor = Math.max(0.15, Math.min(0.7, 0.3 + r * 0.05 + boost)) * (cfg.storyline ? 0.5 : 1);
  if (rng.chance(pMajor)) {
    const opts: Array<{ t: string; d: string; w: number }> = [];
    for (const t of TEMPLATES) {
      if (!t.major || t.spawnOnly || t.minRank > r) continue;
      for (const d of cfg.districts) { let w = t.w[d] ?? 0; for (const tag of DISTRICT_TAGS[d] ?? []) w += t.w[tag] ?? 0; if (w > 0) opts.push({ t: t.id, d, w }); }
    }
    const pick = rng.weighted(opts, (o) => o.w);
    if (pick) {
      const near = (at: number) => out.forced!.some((f) => Math.abs(f.at - at) < 150);
      let at = Math.round(cfg.durationSec * rng.range(0.25, 0.8));
      for (let k = 0; k < 4 && near(at); k++) at = Math.round(cfg.durationSec * rng.range(0.25, 0.8));
      if (!near(at) && at < cfg.durationSec - 90) { out.forced!.push({ at, template: pick.t, district: pick.d }); major = true; }
    }
  }
  // 2. a citywide event, if the shift does not already have one
  if (!out.events.length && rng.chance(Math.min(0.55, 0.26 + r * 0.03 + boost * 0.5))) {
    const pool = SURPRISE_EVENTS.filter((e) => e.minRank <= r && (!e.needs || e.needs.some((d) => cfg.districts.includes(d))));
    const ev = rng.weighted(pool, (e) => e.w);
    if (ev) {
      const at = Math.round(cfg.durationSec * rng.range(0.12, 0.42));
      const duration = Math.max(150, Math.round(Math.min(cfg.durationSec - at - 40, cfg.durationSec * rng.range(0.35, 0.6))));
      out.events.push({ type: ev.type, at, duration });
      // a protest that boils over
      if (ev.type === 'protest' && r >= 3 && rng.chance(0.35) && at + duration * 0.6 < cfg.durationSec - 120) out.events.push({ type: 'riot', at: Math.round(at + duration * 0.6), duration: Math.round(Math.min(cfg.durationSec - at - duration * 0.6 - 40, 300)) });
    }
  }
  out.forced!.sort((a, b) => a.at - b.at);
  if (!out.forced!.length) delete out.forced;
  // 3. the intelligence picture at the briefing (deliberately vague)
  const score = (major ? 2 : 0) + (cfg.storyline ? 2 : 0) + (out.events.length ? 1 : 0) + rng.int(0, 1);
  out.threatLevel = score >= 4 ? 'severe' : score >= 3 ? 'elevated' : score >= 1 ? 'guarded' : 'low';
  return out;
}

export const TUTORIAL_CONFIG = (): ShiftConfig => baseConfig({
  mode: 'tutorial', title: 'Tutorial — Your First Shift', briefing: 'Learn the dispatcher’s loop: answer, gather, locate, dispatch, monitor.',
  durationSec: 10 * 60, difficulty: 'casual', incidentRate: 0, districts: ['downtown', 'oldtown', 'westres', 'riverside'], weather: 'clear', startHour: 10,
  seed: 4242, ignoreGovernor: true,
  script: [
    { at: 6, template: 'kitchen_fire', district: 'westres', archetype: 'worried_neighbor', accuracy: 'exact' },
    { at: 165, template: 'fall_elderly', district: 'oldtown', archetype: 'worried_neighbor', accuracy: 'exact' },
    { at: 172, template: 'collision_minor', district: 'downtown', archetype: 'angry_motorist', accuracy: 'exact' },
  ],
  objectives: [obj('a', 'Resolve all three incidents', 'resolved', 3)],
});

// ── Daily challenge: the same shift for everyone on a given date ─────────────
export function todayKey(d = new Date()): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function dailyConfig(key = todayKey()): { config: ShiftConfig; units: number } {
  const seed = hashString(`signal911-daily-${key}`);
  const rng = new Rng(seed);
  const weather = rng.pick<WeatherType>(['clear', 'clear', 'rain', 'fog', 'storm', 'snow', 'heat']);
  const eventPool: CityEventType[] = ['storm', 'blackout', 'festival', 'rush_hour', 'flood', 'heat_wave', 'winter_storm', 'industrial_fire', 'protest', 'marathon', 'transit_strike'];
  const ev = rng.pick(eventPool);
  const difficulty: Difficulty = REALISTIC;
  const modifier = rng.pick(MODIFIERS.filter((m) => m.id !== 'quiet')).id;
  const contracts = rng.shuffle(CONTRACTS).slice(0, 3).map((c) => ({ id: c.id, target: c.target(5) }));
  const units = 11 + rng.int(0, 4);
  const config0 = baseConfig({
    mode: 'scenario', daily: key, title: `Daily Challenge — ${key}`, difficulty, durationSec: 12 * 60, weather, startHour: rng.pick([2, 7, 12, 17, 21]),
    incidentRate: 1 + rng.range(0, 0.2), seed, modifiers: [modifier], contracts,
    events: [{ type: ev, at: 60 + rng.int(0, 120), duration: 420 }],
    briefing: 'Everyone gets the same shift today. Same calls, same city, same conditions — how well can you run it?',
    objectives: [obj('a', 'Resolve 8 incidents', 'resolved', 8), obj('b', 'No casualties', 'no_deaths', 0, true)],
  });
  const config = rollStoryline(config0, 7, seed, 0.85);
  return { config, units };
}
