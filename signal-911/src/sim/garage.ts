// The garage: every vehicle can be fitted out before a shift. A chassis trades speed for space
// (equipment slots), kits add capabilities or make a crew better at particular jobs, and the
// livery is just for looks. Fits persist on career units and change the simulation for real.
import type { Capability, Category, Service, Unit } from './types';
import { UNIT_TYPE_BY_ID } from './fleet';

export interface Chassis {
  id: string; service: Service; label: string; desc: string;
  /** multiplier on the unit type's base speed */ speed: number;
  /** equipment slots */ slots: number;
  /** multiplier on crew effectiveness on scene */ eff?: number;
  /** keeps more speed in snow, rain and storms (0..1 of the weather penalty removed) */ grip?: number;
  cost: number; minRank: number;
}
export interface Kit {
  id: string; service: Service; label: string; desc: string; cost: number; minRank: number;
  /** capabilities the kit adds to the vehicle */ caps?: Capability[];
  /** faster work at these incident templates / categories */ scenes?: string[]; categories?: Category[]; sceneMult?: number;
  /** what the card says it does */ effect: string;
}

export const CHASSIS: Chassis[] = [
  { id: 'sedan', service: 'police', label: 'Patrol Sedan', desc: 'The all-rounder. Quick, cheap, room for the basics.', speed: 1, slots: 2, cost: 0, minRank: 1 },
  { id: 'interceptor', service: 'police', label: 'Pursuit Interceptor', desc: 'Tuned engine and brakes. Catches anything — but there is no room in the boot.', speed: 1.13, slots: 1, cost: 9000, minRank: 2 },
  { id: 'suv', service: 'police', label: 'Utility SUV', desc: 'Four-wheel drive and a big load bay. A little slower on the straights.', speed: 0.94, slots: 3, grip: 0.6, cost: 7000, minRank: 1 },
  { id: 'armoured', service: 'police', label: 'Armoured Truck', desc: 'Ballistic panels and a run-flat chassis. Slow, heavy, nearly unstoppable.', speed: 0.82, slots: 3, eff: 1.08, grip: 0.4, cost: 22000, minRank: 4 },
  { id: 'pumper', service: 'fire', label: 'Standard Pumper', desc: 'The city-spec appliance. Balanced in every way.', speed: 1, slots: 2, cost: 0, minRank: 1 },
  { id: 'rapid', service: 'fire', label: 'Rapid Intervention', desc: 'Short wheelbase and a smaller tank. First on scene, less to work with.', speed: 1.12, slots: 1, eff: 0.96, cost: 12000, minRank: 2 },
  { id: 'heavy', service: 'fire', label: 'Heavy Pumper', desc: 'Bigger tank, bigger pump, more lockers. Takes its time getting there.', speed: 0.9, slots: 3, eff: 1.08, cost: 16000, minRank: 3 },
  { id: 'van', service: 'medical', label: 'Type II Van', desc: 'The standard ambulance. Nimble in traffic.', speed: 1, slots: 2, cost: 0, minRank: 1 },
  { id: 'rapid_med', service: 'medical', label: 'Rapid Response', desc: 'Lighter and faster, with a cramped saloon.', speed: 1.1, slots: 1, cost: 8000, minRank: 1 },
  { id: 'box', service: 'medical', label: 'Type III Box', desc: 'A walk-in treatment room on wheels. More kit, slower to arrive.', speed: 0.94, slots: 3, eff: 1.06, cost: 9000, minRank: 2 },
  { id: 'offroad', service: 'medical', label: 'All-Terrain 4×4', desc: 'Lifted suspension and winter tyres. Laughs at snow and mud.', speed: 0.97, slots: 2, grip: 0.7, cost: 11000, minRank: 3 },
];

export const KITS: Kit[] = [
  // police
  { id: 'aed', service: 'police', label: 'AED & trauma bag', desc: 'Officers can start CPR, shock and pack wounds before the ambulance.', effect: 'Adds first aid · patients survive longer', cost: 2500, minRank: 1, caps: ['first_aid'] },
  { id: 'less_lethal', service: 'police', label: 'Less-lethal kit', desc: 'Tasers and bean-bag rounds: end a fight without anyone getting shot.', effect: '+20% at disturbances, fights and disorder', cost: 3000, minRank: 1, sceneMult: 1.2, scenes: ['public_disturbance', 'domestic_disturbance', 'public_intoxication', 'riot', 'protest_march', 'looting', 'unruly_passenger', 'assault_mob', 'hostage_barricade'] },
  { id: 'riot_gear', service: 'police', label: 'Riot shields & helmets', desc: 'Lets a regular crew hold a line at a protest.', effect: 'Adds crowd control', cost: 6000, minRank: 2, caps: ['crowd'] },
  { id: 'k9', service: 'police', label: 'K-9 partner', desc: 'A tracking and detection dog in the back seat.', effect: '+30% at searches, burglaries and suspicious packages', cost: 9000, minRank: 2, sceneMult: 1.3, scenes: ['burglary_progress', 'missing_person', 'lost_child', 'lost_hiker', 'suspicious_activity', 'suspicious_package', 'bomb_threat', 'kidnapping', 'trespassing'] },
  { id: 'rifle', service: 'police', label: 'Patrol rifle', desc: 'A long gun locked in the rack, for when it all goes wrong.', effect: '+20% at armed incidents', cost: 4000, minRank: 3, sceneMult: 1.2, scenes: ['active_shooter', 'bank_robbery', 'hostage_barricade', 'vehicle_ramming', 'robbery', 'carjacking', 'getaway'] },
  { id: 'spikes', service: 'police', label: 'Stinger spike strip', desc: 'Stop a fleeing car without a chase.', effect: '+20% at pursuits and dangerous driving', cost: 1500, minRank: 1, sceneMult: 1.2, scenes: ['pursuit', 'getaway', 'stolen_vehicle', 'street_racing', 'dangerous_driving', 'carjacking'] },
  // fire
  { id: 'thermal', service: 'fire', label: 'Thermal imaging camera', desc: 'See through smoke to find the seat of the fire and anyone inside.', effect: '+15% at every fire', cost: 4000, minRank: 1, sceneMult: 1.15, categories: ['fire'] },
  { id: 'extrication', service: 'fire', label: 'Hydraulic rescue tools', desc: 'Spreaders and cutters: any engine can cut someone out of a car.', effect: 'Adds rescue', cost: 8000, minRank: 2, caps: ['rescue'] },
  { id: 'foam', service: 'fire', label: 'Foam system', desc: 'Class B foam for fuel, chemical and aircraft fires.', effect: '+30% at fuel, vehicle and chemical fires', cost: 5000, minRank: 2, sceneMult: 1.3, scenes: ['vehicle_fire', 'tanker_fire', 'aircraft_emergency', 'boat_fire', 'hazmat_spill', 'warehouse_smoke', 'train_derailment'] },
  { id: 'ems_kit', service: 'fire', label: 'EMS first-response kit', desc: 'Defibrillator, oxygen and a trauma bag on every engine.', effect: 'Adds first aid · +10% on medical calls', cost: 3000, minRank: 1, caps: ['first_aid'], sceneMult: 1.1, categories: ['medical'] },
  { id: 'swiftwater', service: 'fire', label: 'Swiftwater kit', desc: 'Dry suits, throw bags and an inflatable sled.', effect: 'Adds water rescue', cost: 9000, minRank: 3, caps: ['water_rescue'] },
  // medical
  { id: 'lucas', service: 'medical', label: 'Mechanical CPR device', desc: 'Perfect compressions, even in a moving ambulance.', effect: '+30% at cardiac arrests and drownings', cost: 7000, minRank: 1, sceneMult: 1.3, scenes: ['cardiac_arrest', 'drowning_pool', 'runner_collapse', 'collapse_child'] },
  { id: 'als_kit', service: 'medical', label: 'ALS upgrade', desc: 'Cardiac monitor, airway kit and drugs: a basic crew works as paramedics.', effect: 'Adds advanced life support', cost: 12000, minRank: 2, caps: ['als'] },
  { id: 'trauma', service: 'medical', label: 'Trauma & tourniquet pack', desc: 'Stops bleeding fast at shootings, stabbings and crashes.', effect: '+20% at trauma calls', cost: 3000, minRank: 1, sceneMult: 1.2, scenes: ['gunshot_victim', 'assault_mob', 'collision_injury', 'collision_trapped', 'collision_multi', 'vehicle_ramming', 'active_shooter', 'industrial_accident', 'workplace_injury', 'house_explosion'] },
  { id: 'bariatric', service: 'medical', label: 'Powered stretcher', desc: 'Lifts anyone, anywhere — no more waiting for a lifting crew.', effect: '+20% at falls and collapses', cost: 4000, minRank: 1, sceneMult: 1.2, scenes: ['fall_elderly', 'sudden_illness', 'breathing_trouble', 'heat_exhaustion'] },
  { id: 'peds', service: 'medical', label: 'Paediatric kit', desc: 'Child-sized everything, and a colour-coded dosing tape.', effect: '+25% with child patients', cost: 2500, minRank: 1, sceneMult: 1.25, scenes: ['collapse_child', 'drowning_pool', 'allergic_reaction', 'lost_child'] },
];

export const CHASSIS_BY_ID: Record<string, Chassis> = Object.fromEntries(CHASSIS.map((c) => [c.id, c]));
export const KIT_BY_ID: Record<string, Kit> = Object.fromEntries(KITS.map((k) => [k.id, k]));

/** vehicles that cannot change chassis: helicopters, people on foot, bicycles, motorbikes and the big specialist trucks */
const FIXED = new Set(['helicopter', 'foot', 'bicycle', 'motorcycle', 'ladder', 'heavy_rescue', 'command', 'bomb_squad', 'hazmat', 'water_rescue', 'critical_transport', 'federal_tactical', 'guard_eod']);
export const canRebody = (u: Pick<Unit, 'type'>): boolean => !FIXED.has(u.type);
export const canFit = (u: Pick<Unit, 'type'>): boolean => !['helicopter', 'federal_tactical', 'guard_eod'].includes(u.type);

export function defaultChassis(service: Service): Chassis { return CHASSIS.find((c) => c.service === service && c.cost === 0)!; }
export function chassisFor(u: Pick<Unit, 'service' | 'type'>, rank = 99): Chassis[] {
  if (!canRebody(u)) return [];
  return CHASSIS.filter((c) => c.service === u.service && c.minRank <= rank);
}
export function kitsFor(u: Pick<Unit, 'service' | 'type'>, rank = 99): Kit[] {
  if (!canFit(u)) return [];
  const caps = UNIT_TYPE_BY_ID[u.type]?.caps ?? [];
  // no point fitting a kit that adds something the vehicle already does
  return KITS.filter((k) => k.service === u.service && k.minRank <= rank && !(k.caps && k.caps.every((c) => caps.includes(c))));
}
export function slotsOf(u: Pick<Unit, 'service' | 'type' | 'fit'>): number {
  if (!canFit(u)) return 0;
  if (!canRebody(u)) return u.type === 'foot' || u.type === 'bicycle' || u.type === 'motorcycle' ? 1 : 2;
  return (CHASSIS_BY_ID[u.fit?.chassis ?? ''] ?? defaultChassis(u.service)).slots;
}

/** derive speed, capabilities and effectiveness from the unit type plus its fit (idempotent) */
export function applyFit(u: Unit): Unit {
  const def = UNIT_TYPE_BY_ID[u.type];
  if (!def || !u.fit) return u;
  const ch = canRebody(u) ? CHASSIS_BY_ID[u.fit.chassis] ?? defaultChassis(u.service) : null;
  const kits = u.fit.kits.map((k) => KIT_BY_ID[k]).filter((k): k is Kit => !!k && k.service === u.service).slice(0, slotsOf(u));
  u.fit.kits = kits.map((k) => k.id);
  u.speedModifier = def.speed * (ch?.speed ?? 1);
  const caps = new Set<Capability>(def.caps);
  for (const k of kits) for (const c of k.caps ?? []) caps.add(c);
  u.capabilities = [...caps];
  u.fit.eff = ch?.eff ?? 1;
  u.fit.grip = ch?.grip ?? 0;
  const bits = [ch && ch.cost > 0 ? ch.label : null, ...kits.map((k) => k.label)].filter(Boolean);
  u.equipment = bits.length ? `${def.equipment} · ${bits.join(', ')}` : def.equipment;
  return u;
}

/** what a change would cost: chassis swaps and new kits are paid for, removing kit is free */
export function fitCost(u: Unit, next: { chassis?: string; kits?: string[] }): number {
  let c = 0;
  const cur = u.fit ?? { chassis: defaultChassis(u.service).id, kits: [], livery: 'classic' };
  if (next.chassis && next.chassis !== cur.chassis) c += CHASSIS_BY_ID[next.chassis]?.cost ?? 0;
  for (const k of next.kits ?? []) if (!cur.kits.includes(k)) c += KIT_BY_ID[k]?.cost ?? 0;
  return c;
}

/** headline stats for the garage card, 0..100 bars */
export function fitStats(u: Unit): { speed: number; space: number; capability: number } {
  const def = UNIT_TYPE_BY_ID[u.type];
  const sp = (u.speedModifier ?? def?.speed ?? 1);
  return {
    speed: Math.round(Math.max(5, Math.min(100, (sp - 0.35) / 0.95 * 100))),
    space: Math.round(Math.min(100, slotsOf(u) / 3 * 100)),
    capability: Math.round(Math.min(100, (u.capabilities.length / 4) * 70 + (u.fit?.kits.length ?? 0) * 10)),
  };
}
