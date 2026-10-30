// Handcrafted shifts: campaign chapters, scenario challenges and the interactive tutorial.
import type { CityEventType, Difficulty, Objective, ShiftConfig, WeatherType } from './types';
import { Rng, hashString } from './rng';
import { CONTRACTS, MODIFIERS } from './extras';

export const ALL_DISTRICTS = ['westres', 'university', 'northsub', 'airport', 'oldtown', 'downtown', 'financial', 'eastwood', 'southside', 'riverside', 'industrial', 'harbor'];

type Partial2 = Partial<ShiftConfig> & { title: string; briefing: string };
export function baseConfig(p: Partial2): ShiftConfig {
  return {
    mode: 'free', difficulty: 'standard', durationSec: 15 * 60, weather: 'clear', startHour: 8, incidentRate: 1, districts: ALL_DISTRICTS,
    events: [], objectives: [], seed: Math.floor(Math.random() * 2 ** 31), ...p,
  };
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
  { id: 'rush_hour', title: 'Rush Hour', tagline: 'Every route is a crawl.', description: 'Peak traffic and rain. Collisions climb as ambulances crawl. Positioning units well before the call is your edge.', difficulty: 'standard', minutes: 10, accent: '#98A6B5',
    config: { startHour: 17, weather: 'rain', incidentRate: 1.1, events: [{ type: 'rush_hour', at: 10, duration: 560 }], objectives: [obj('a', 'Resolve 8 incidents', 'resolved', 8), obj('b', 'Average response under 160 s', 'avg_response', 160)] } },
];

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
  const eventPool: CityEventType[] = ['storm', 'blackout', 'festival', 'rush_hour', 'flood', 'heat_wave', 'winter_storm', 'industrial_fire'];
  const ev = rng.pick(eventPool);
  const difficulty = rng.pick<Difficulty>(['standard', 'standard', 'hard']);
  const modifier = rng.pick(MODIFIERS.filter((m) => m.id !== 'quiet')).id;
  const contracts = rng.shuffle(CONTRACTS).slice(0, 3).map((c) => ({ id: c.id, target: c.target(5) }));
  const units = 11 + rng.int(0, 4);
  const config = baseConfig({
    mode: 'scenario', daily: key, title: `Daily Challenge — ${key}`, difficulty, durationSec: 12 * 60, weather, startHour: rng.pick([2, 7, 12, 17, 21]),
    incidentRate: 1 + rng.range(0, 0.2), seed, modifiers: [modifier], contracts,
    events: [{ type: ev, at: 60 + rng.int(0, 120), duration: 420 }],
    briefing: 'Everyone gets the same shift today. Same calls, same city, same conditions — how well can you run it?',
    objectives: [obj('a', 'Resolve 8 incidents', 'resolved', 8), obj('b', 'No casualties', 'no_deaths', 0, true)],
  });
  return { config, units };
}
