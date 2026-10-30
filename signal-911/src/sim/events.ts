import type { DistrictId, Weather } from './types';

export type EventId = 'rush_hour' | 'heavy_rain' | 'festival' | 'power_outage' | 'industrial_fire';
export interface ScriptedSpec { templateId: string; variationId: string; district: DistrictId }
/** A burst of calls at a point in the shift (0-1). Calls in one cluster are linked emergencies. */
export interface Scripted { at: number; text: string; cluster?: string; specs: ScriptedSpec[] }

export interface EventDef {
  id: EventId; name: string; blurb: string; level: number;
  weather?: Weather;
  /** Multiplier on road traffic everywhere. */
  traffic?: number;
  /** Multiplier on the time between calls (below 1 = busier). */
  interval?: number;
  templateMult?: Record<string, number>;
  districtMult?: Partial<Record<DistrictId, number>>;
  scripted?: Scripted[];
  /** Pass mark for the first-time bonus. */
  goal: { resolved: number; maxFailed: number; text: string };
  reward: { money: number; xp: number };
}

export const EVENTS: EventDef[] = [
  {
    id: 'heavy_rain', name: 'Heavy rain', level: 1, weather: 'storm', traffic: 1.1, interval: 0.9,
    blurb: 'Storm conditions slow every vehicle by 25%. More collisions and water rescues; fewer fires.',
    templateMult: { collision: 1.8, water: 2.5, fire: 0.6 },
    goal: { resolved: 6, maxFailed: 2, text: 'Resolve 6 incidents with at most 2 failures.' }, reward: { money: 3000, xp: 80 },
  },
  {
    id: 'rush_hour', name: 'Rush hour', level: 2, traffic: 1.35, interval: 0.85,
    blurb: 'Gridlock everywhere. Collisions and medical calls surge in Downtown and Northside.',
    templateMult: { collision: 2, medical: 1.4 }, districtMult: { downtown: 1.8, northside: 1.4 },
    goal: { resolved: 8, maxFailed: 2, text: 'Resolve 8 incidents with at most 2 failures.' }, reward: { money: 3500, xp: 100 },
  },
  {
    id: 'festival', name: 'City festival', level: 3, interval: 0.8, traffic: 1.15,
    blurb: 'Crowds fill Downtown and Riverside: disturbances, medical calls and water rescues rise together.',
    templateMult: { disturbance: 2.2, medical: 1.8, water: 2 }, districtMult: { downtown: 1.8, riverside: 2.4 },
    goal: { resolved: 9, maxFailed: 2, text: 'Resolve 9 incidents with at most 2 failures.' }, reward: { money: 4000, xp: 120 },
  },
  {
    id: 'power_outage', name: 'Power outage', level: 4, traffic: 1.25, interval: 1.1,
    blurb: 'Signals go dark. Two waves of linked emergencies hit across the city. Triage matters.',
    scripted: [
      { at: 0.2, cluster: 'outage-1', text: 'Power failure: several emergencies reported at once.', specs: [
        { templateId: 'collision', variationId: 'injured', district: 'downtown' },
        { templateId: 'medical', variationId: 'chest', district: 'northside' },
        { templateId: 'fire', variationId: 'small', district: 'oldtown' },
      ] },
      { at: 0.55, cluster: 'outage-2', text: 'Second wave: the outage spreads.', specs: [
        { templateId: 'collision', variationId: 'multi', district: 'downtown' },
        { templateId: 'medical', variationId: 'multi', district: 'riverside' },
        { templateId: 'disturbance', variationId: 'burglary', district: 'industrial' },
      ] },
    ],
    goal: { resolved: 7, maxFailed: 3, text: 'Resolve 7 incidents with at most 3 failures.' }, reward: { money: 4500, xp: 140 },
  },
  {
    id: 'industrial_fire', name: 'Industrial fire', level: 5, interval: 1.3,
    blurb: 'A major warehouse fire needs three engines, rescue and medics for a long time, while the city keeps calling.',
    scripted: [{ at: 0.12, cluster: 'inferno', text: 'MAJOR INCIDENT: warehouse fire at the Industrial District.', specs: [
      { templateId: 'fire', variationId: 'inferno', district: 'industrial' },
    ] }],
    goal: { resolved: 6, maxFailed: 2, text: 'Resolve the major fire and 5 other incidents, at most 2 failures.' }, reward: { money: 6000, xp: 180 },
  },
];

export const eventById = (id: string | null | undefined) => EVENTS.find((e) => e.id === id) ?? null;
