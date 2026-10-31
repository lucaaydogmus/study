// Vehicle catalogue, personnel generation, stations, upgrades and the starting fleet.
import { getCity } from './city';
import { Rng } from './rng';
import type { Capability, Personnel, Service, Station, Unit } from './types';

export interface UnitTypeDef {
  type: string; service: Service; label: string; short: string; spoken: string; caps: Capability[];
  cost: number; crew: number; minCrew: number; speed: number; equipment: string; minRank: number; blurb: string;
}

export const UNIT_TYPES: UnitTypeDef[] = [
  // Police
  { type: 'patrol', service: 'police', label: 'Patrol Car', short: 'PATROL', spoken: 'Unit', caps: ['patrol'], cost: 38000, crew: 2, minCrew: 1, speed: 1, equipment: 'Standard kit', minRank: 1, blurb: 'General response.' },
  { type: 'motorcycle', service: 'police', label: 'Motorcycle Unit', short: 'MOTO', spoken: 'Motor', caps: ['patrol', 'traffic'], cost: 29000, crew: 1, minCrew: 1, speed: 1.22, equipment: 'Lightweight kit', minRank: 1, blurb: 'Fast through traffic. Low capacity.' },
  { type: 'traffic', service: 'police', label: 'Traffic Unit', short: 'TRAFFIC', spoken: 'Traffic', caps: ['patrol', 'traffic'], cost: 46000, crew: 2, minCrew: 1, speed: 1.05, equipment: 'Flares, cones, reconstruction kit', minRank: 2, blurb: 'Collision specialist; clears roads.' },
  { type: 'van', service: 'police', label: 'Police Van', short: 'VAN', spoken: 'Van', caps: ['patrol', 'crowd', 'prisoner_transport'], cost: 54000, crew: 3, minCrew: 2, speed: 0.92, equipment: 'Crowd control gear', minRank: 2, blurb: 'Crowd management and transport.' },
  { type: 'police_supervisor', service: 'police', label: 'Supervisor Unit', short: 'SUPV', spoken: 'Supervisor', caps: ['patrol', 'police_supervisor'], cost: 62000, crew: 1, minCrew: 1, speed: 1.05, equipment: 'Command radio', minRank: 3, blurb: 'Takes command of complex scenes.' },
  { type: 'helicopter', service: 'police', label: 'Police Helicopter', short: 'AIR', spoken: 'Air', caps: ['air_support'], cost: 420000, crew: 2, minCrew: 2, speed: 1, equipment: 'FLIR camera, searchlight', minRank: 3, blurb: 'Eyes in the sky: tracks fleeing vehicles and searches from above. Limited fuel; grounded in storms.' },
  { type: 'foot', service: 'police', label: 'Foot Patrol', short: 'FOOT', spoken: 'Foot', caps: ['patrol'], cost: 12000, crew: 2, minCrew: 1, speed: 0.42, equipment: 'Radio, body armour', minRank: 1, blurb: 'Cheap officers walking a beat. Brilliant in dense streets and crowds — slow anywhere else.' },
  { type: 'bicycle', service: 'police', label: 'Bike Unit', short: 'BIKE', spoken: 'Bike', caps: ['patrol'], cost: 16000, crew: 1, minCrew: 1, speed: 0.74, equipment: 'Lightweight kit', minRank: 1, blurb: 'Filters through gridlock and crowds where cars are stuck.' },
  { type: 'public_order', service: 'police', label: 'Public Order Unit', short: 'POU', spoken: 'Public Order', caps: ['patrol', 'crowd', 'public_order'], cost: 88000, crew: 6, minCrew: 4, speed: 0.86, equipment: 'Shields, helmets, batons', minRank: 3, blurb: 'A van of officers in riot gear for protests, disorder and riots.' },
  { type: 'bomb_squad', service: 'police', label: 'Bomb Squad', short: 'EOD', spoken: 'Bomb Squad', caps: ['eod'], cost: 160000, crew: 3, minCrew: 2, speed: 0.9, equipment: 'Robot, bomb suit, X-ray', minRank: 5, blurb: 'Renders suspicious packages and devices safe.' },
  { type: 'tactical', service: 'police', label: 'Specialist Response', short: 'SRT', spoken: 'Tactical', caps: ['patrol', 'tactical'], cost: 145000, crew: 4, minCrew: 3, speed: 0.95, equipment: 'Tactical equipment', minRank: 5, blurb: 'Armed or high-risk incidents.' },
  // Fire
  { type: 'engine', service: 'fire', label: 'Fire Engine', short: 'ENGINE', spoken: 'Engine', caps: ['fire_suppression'], cost: 98000, crew: 4, minCrew: 3, speed: 0.88, equipment: 'Pump, 500 gal tank', minRank: 1, blurb: 'Fire suppression workhorse.' },
  { type: 'rescue', service: 'fire', label: 'Rescue Truck', short: 'RESCUE', spoken: 'Rescue', caps: ['rescue'], cost: 118000, crew: 4, minCrew: 3, speed: 0.9, equipment: 'Hydraulic tools', minRank: 1, blurb: 'Extrication, lift assists, entrapment.' },
  { type: 'ladder', service: 'fire', label: 'Ladder Truck', short: 'LADDER', spoken: 'Ladder', caps: ['fire_suppression', 'aerial', 'rescue'], cost: 165000, crew: 5, minCrew: 3, speed: 0.8, equipment: '100ft aerial', minRank: 3, blurb: 'High-rise and roof operations.' },
  { type: 'command', service: 'fire', label: 'Command Vehicle', short: 'COMMAND', spoken: 'Command', caps: ['command'], cost: 90000, crew: 2, minCrew: 1, speed: 1.05, equipment: 'Mobile command post', minRank: 4, blurb: 'Coordinates multi-unit operations.' },
  { type: 'water_rescue', service: 'fire', label: 'Water Rescue Unit', short: 'WATER', spoken: 'Water Rescue', caps: ['water_rescue', 'rescue'], cost: 112000, crew: 3, minCrew: 2, speed: 0.95, equipment: 'Boat, dive kit', minRank: 3, blurb: 'River and harbor rescues.' },
  { type: 'fd_ambulance', service: 'fire', label: 'Fire Rescue Ambulance', short: 'RA', spoken: 'Rescue Ambulance', caps: ['bls', 'transport'], cost: 60000, crew: 2, minCrew: 2, speed: 1, equipment: 'BLS, fire-based EMS', minRank: 2, blurb: 'Fire-department EMS: an ambulance that lives at the fire station.' },
  { type: 'paramedic_engine', service: 'fire', label: 'Paramedic Engine', short: 'PE', spoken: 'Paramedic Engine', caps: ['fire_suppression', 'als', 'bls'], cost: 128000, crew: 4, minCrew: 3, speed: 0.88, equipment: 'Pump plus ALS kit', minRank: 3, blurb: 'An engine with a paramedic on board — first on scene to fires and cardiac arrests.' },
  { type: 'hazmat', service: 'fire', label: 'Hazmat Unit', short: 'HAZMAT', spoken: 'Hazmat', caps: ['hazmat', 'rescue'], cost: 140000, crew: 4, minCrew: 3, speed: 0.85, equipment: 'Gas suits, detectors, decon', minRank: 4, blurb: 'Chemical spills, gas leaks and contaminated scenes.' },
  { type: 'heavy_rescue', service: 'fire', label: 'Heavy Rescue', short: 'HEAVY', spoken: 'Heavy Rescue', caps: ['rescue', 'heavy_rescue'], cost: 215000, crew: 5, minCrew: 4, speed: 0.78, equipment: 'Collapse & shoring gear', minRank: 5, blurb: 'Structural collapse and heavy extrication.' },
  // Medical
  { type: 'ambulance', service: 'medical', label: 'Basic Ambulance', short: 'MEDIC', spoken: 'Medic', caps: ['bls', 'transport'], cost: 56000, crew: 2, minCrew: 2, speed: 1, equipment: 'Standard BLS', minRank: 1, blurb: 'Basic life support and transport.' },
  { type: 'advanced_ambulance', service: 'medical', label: 'Advanced Ambulance', short: 'MEDIC', spoken: 'Medic', caps: ['als', 'bls', 'transport'], cost: 86000, crew: 2, minCrew: 2, speed: 1, equipment: 'Standard ALS', minRank: 1, blurb: 'Advanced life support and transport.' },
  { type: 'paramedic', service: 'medical', label: 'Paramedic Response Vehicle', short: 'PARA', spoken: 'Paramedic', caps: ['als', 'bls'], cost: 49000, crew: 1, minCrew: 1, speed: 1.2, equipment: 'ALS kit — no transport', minRank: 2, blurb: 'Fast paramedic, cannot transport.' },
  { type: 'med_supervisor', service: 'medical', label: 'Medical Supervisor', short: 'MSUP', spoken: 'Medical Supervisor', caps: ['als', 'bls', 'med_supervisor'], cost: 72000, crew: 1, minCrew: 1, speed: 1.1, equipment: 'Triage & command kit', minRank: 4, blurb: 'Mass-casualty triage lead.' },
  { type: 'critical_transport', service: 'medical', label: 'Specialist Transport', short: 'CCT', spoken: 'Critical Care', caps: ['als', 'bls', 'transport', 'critical_transport'], cost: 152000, crew: 3, minCrew: 2, speed: 0.98, equipment: 'Critical care suite', minRank: 5, blurb: 'Critical patients and long hauls.' },
];
/** brought in from outside for the worst days — never bought, only requested */
export const OUTSIDE_TYPES: UnitTypeDef[] = [
  { type: 'federal_tactical', service: 'police', label: 'Federal Tactical Team', short: 'FED', spoken: 'Federal', caps: ['patrol', 'tactical', 'negotiator'], cost: 0, crew: 8, minCrew: 0, speed: 1.02, equipment: 'Federal hostage-rescue team', minRank: 99, blurb: 'Federal agents for mass shootings, hostage sieges and kidnappings.' },
  { type: 'negotiator_team', service: 'police', label: 'Crisis Negotiation Team', short: 'CNT', spoken: 'Negotiator', caps: ['negotiator', 'police_supervisor'], cost: 0, crew: 3, minCrew: 0, speed: 1.05, equipment: 'Throw phone, comms van', minRank: 99, blurb: 'Specialist negotiators for sieges, hostage-takers and people in crisis.' },
  { type: 'k9_unit', service: 'police', label: 'K-9 Unit', short: 'K9', spoken: 'K-Nine', caps: ['patrol'], cost: 0, crew: 1, minCrew: 0, speed: 1.08, equipment: 'Tracking and detection dog', minRank: 99, blurb: 'A dog handler for searches, tracking suspects and sniffing out explosives.' },
  { type: 'regional_hazmat', service: 'fire', label: 'Regional Hazmat Team', short: 'RHT', spoken: 'Regional Hazmat', caps: ['hazmat', 'rescue'], cost: 0, crew: 6, minCrew: 0, speed: 0.9, equipment: 'Level A suits, decon tent, detection lab', minRank: 99, blurb: 'The county\'s chemical specialists.' },
  { type: 'usar', service: 'fire', label: 'Urban Search & Rescue', short: 'USAR', spoken: 'Task Force', caps: ['heavy_rescue', 'rescue'], cost: 0, crew: 8, minCrew: 0, speed: 0.85, equipment: 'Shoring, listening devices, search dogs', minRank: 99, blurb: 'A state task force for collapsed buildings and mass entrapments.' },
  { type: 'coast_guard', service: 'fire', label: 'Coast Guard Rescue', short: 'USCG', spoken: 'Coast Guard', caps: ['water_rescue', 'rescue'], cost: 0, crew: 4, minCrew: 0, speed: 1.0, equipment: 'Fast rescue boat on trailer, rescue swimmers', minRank: 99, blurb: 'Rescue swimmers and a fast boat for the river and the bay.' },
  { type: 'guard_eod', service: 'police', label: 'National Guard EOD', short: 'GUARD', spoken: 'Guard EOD', caps: ['eod'], cost: 0, crew: 4, minCrew: 0, speed: 0.92, equipment: 'Army bomb-disposal team', minRank: 99, blurb: 'Military explosive ordnance disposal for real devices.' },
];
UNIT_TYPES.push(...OUTSIDE_TYPES);
export const UNIT_TYPE_BY_ID: Record<string, UnitTypeDef> = Object.fromEntries(UNIT_TYPES.map((u) => [u.type, u]));

export const SERVICE_META: Record<Service, { label: string; short: string; color: string; glyph: string }> = {
  police: { label: 'Police', short: 'PD', color: '#4A9CD6', glyph: 'P' },
  fire: { label: 'Fire & Rescue', short: 'FD', color: '#D65353', glyph: 'F' },
  medical: { label: 'Medical', short: 'EMS', color: '#54B889', glyph: 'M' },
};

const NUM_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
export const numWord = (n: number) => NUM_WORDS[n] ?? String(n);

// ── Upgrades ────────────────────────────────────────────────────────────────
export interface UpgradeDef { id: string; name: string; desc: string; effect: string; costs: number[]; minRank: number; group: string }
export const UPGRADES: UpgradeDef[] = [
  { id: 'console', name: 'Dispatch Console', desc: 'Faster CAD and mobilisation tooling.', effect: 'Crew mobilisation time −2.5 s per level', costs: [30000, 65000, 120000], minRank: 1, group: 'Communications' },
  { id: 'ali', name: 'Enhanced Caller Location', desc: 'Automatic caller location lookup (ALI).', effect: 'Level 1: district-level fix · 2: street-level · 3: precise on landlines & most mobiles', costs: [25000, 70000, 140000], minRank: 1, group: 'Communications' },
  { id: 'assistant', name: 'Dispatch Assistants', desc: 'A colleague can take over calls you transfer.', effect: 'Unlocks TRANSFER; higher levels transfer faster and more accurately', costs: [40000, 90000], minRank: 2, group: 'Communications' },
  { id: 'preempt', name: 'Signal Pre-emption', desc: 'Traffic lights yield to emergency vehicles.', effect: 'Emergency vehicles lose 30% less speed to congestion per level', costs: [45000, 95000, 160000], minRank: 2, group: 'Operations' },
  { id: 'garage', name: 'Garage Expansion', desc: 'More bays at every station.', effect: '+1 vehicle slot per station per level', costs: [35000, 80000], minRank: 1, group: 'Operations' },
  { id: 'medkit', name: 'Advanced Medical Equipment', desc: 'Better monitors, airway kits and analgesia.', effect: 'Medical units treat 12% faster per level and stabilise patients better', costs: [38000, 85000, 150000], minRank: 1, group: 'Equipment' },
  { id: 'firegear', name: 'Fire Suppression Upgrade', desc: 'Foam systems, thermal cameras, high-flow nozzles.', effect: 'Fire units suppress 12% faster per level', costs: [38000, 85000, 150000], minRank: 1, group: 'Equipment' },
  { id: 'policegear', name: 'Patrol Technology', desc: 'Body cameras, mobile terminals, de-escalation kits.', effect: 'Police units resolve incidents 12% faster per level', costs: [38000, 85000, 150000], minRank: 1, group: 'Equipment' },
  { id: 'academy', name: 'Training Academy', desc: 'Continuous training programme for all crews.', effect: 'Training and experience grow 40% faster per level; morale recovers faster', costs: [50000, 110000], minRank: 3, group: 'Personnel' },
  { id: 'barracks', name: 'Crew Quarters', desc: 'Rest rooms and better shift scheduling.', effect: 'Fatigue builds 20% slower and recovers faster per level', costs: [30000, 70000], minRank: 2, group: 'Personnel' },
];
export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

// ── Personnel ───────────────────────────────────────────────────────────────
const FIRST = ['Alex', 'Jordan', 'Sam', 'Casey', 'Riley', 'Morgan', 'Taylor', 'Quinn', 'Avery', 'Reese', 'Dana', 'Kai', 'Noor', 'Mateo', 'Priya', 'Ivan', 'Lena', 'Omar', 'Tessa', 'Hugo', 'Maya', 'Felix', 'Nia', 'Diego', 'Ines', 'Theo', 'Zoe', 'Rami', 'Elena', 'Marcus', 'Yuki', 'Amara', 'Callum', 'Bianca', 'Dev', 'Ruth', 'Gideon', 'Sana', 'Jonas', 'Mira'];
const LAST = ['Okafor', 'Lindqvist', 'Moreno', 'Hartley', 'Nakamura', 'Duval', 'Petrov', 'Haddad', 'Brennan', 'Castillo', 'Ferreira', 'Kowalski', 'Adeyemi', 'Singh', 'Rossi', 'Whitaker', 'Larsen', 'Mbeki', 'Tran', 'Sandoval', 'Fischer', 'Okoye', 'Vance', 'Marlowe', 'Quill', 'Ashford', 'Delacroix', 'Ibarra', 'Novak', 'Yilmaz'];
const SPECIALTIES: Record<Service, string[]> = {
  police: ['Patrol', 'Traffic', 'Negotiation', 'Tactical'],
  fire: ['Suppression', 'Rescue', 'Driver/Operator', 'Hazmat'],
  medical: ['Paramedic', 'EMT', 'Trauma', 'Pediatrics'],
};

export function makePersonnel(rng: Rng, service: Service, id: string, quality = 1, unitId: string | null = null): Personnel {
  const base = 38 + quality * 10;
  const r = () => Math.round(Math.max(15, Math.min(98, base + rng.range(-14, 22))));
  const exp = Math.round(Math.max(5, Math.min(98, base - 8 + rng.range(-12, 24))));
  const p: Personnel = {
    id, name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, service,
    experience: exp, training: r(), medical: r(), fire: r(), driving: r(), policing: r(),
    fatigue: rng.range(0, 12), morale: Math.round(rng.range(62, 88)), reliability: Math.round(rng.range(55, 95)),
    salary: 0, unitId, specialty: rng.pick(SPECIALTIES[service]),
  };
  // service-specific boost
  if (service === 'medical') p.medical = Math.min(98, p.medical + 14); else p.medical = Math.round(p.medical * 0.6 + 12);
  if (service === 'fire') p.fire = Math.min(98, p.fire + 14); else p.fire = Math.round(p.fire * 0.5 + 10);
  if (service === 'police') p.policing = Math.min(98, p.policing + 14); else p.policing = Math.round(p.policing * 0.5 + 12);
  p.salary = personnelSalary(p);
  return p;
}
export function primarySkill(p: Personnel): number {
  return p.service === 'medical' ? p.medical : p.service === 'fire' ? p.fire : p.policing;
}
export function personnelSalary(p: Personnel): number {
  return Math.round((520 + primarySkill(p) * 6 + p.experience * 3 + p.training * 2) / 10) * 10;
}
export function hireCost(p: Personnel): number {
  return Math.round((p.salary * 3 + primarySkill(p) * 40) / 100) * 100;
}

// ── Stations & starting fleet ───────────────────────────────────────────────
export function stationName(service: Service, districtName: string): string {
  const prefix = service === 'police' ? 'Precinct' : service === 'fire' ? 'Fire Station' : 'Medic Base';
  return service === 'police' ? `${districtName} ${prefix}` : service === 'fire' ? `${prefix} — ${districtName}` : `${prefix} — ${districtName}`;
}

export function makeStation(service: Service, districtId: string, capacity = 4): Station {
  const city = getCity();
  const d = city.districtById[districtId];
  return { id: `${service}-${districtId}`, name: stationName(service, d.name), service, nodeId: city.sites[`${service}:${districtId}`], district: districtId, capacity, disabledShifts: 0 };
}

export const BUILD_STATION_COST: Record<Service, number> = { police: 70000, fire: 120000, medical: 80000 };

const CALL_COUNTER_KEY = 'unit-counter';
export function nextCallsign(existing: Unit[], def: UnitTypeDef): { callsign: string; spoken: string } {
  // numbering per service: PATROL-11.. ENGINE-01.. MEDIC-04..
  const sameKind = existing.filter((u) => u.service === def.service && u.typeLabel.length > 0 && UNIT_TYPE_BY_ID[u.type].short === def.short);
  const base = def.service === 'police' && def.type !== 'helicopter' ? 10 : 0;
  let n = base + 1;
  const used = new Set(sameKind.map((u) => u.callsign));
  while (used.has(`${def.short}-${String(n).padStart(2, '0')}`)) n++;
  const callsign = `${def.short}-${String(n).padStart(2, '0')}`;
  const spokenNum = def.service === 'police' ? n : n;
  return { callsign, spoken: `${def.spoken} ${numWord(spokenNum)}` };
}
void CALL_COUNTER_KEY;

export const isAir = (u: Pick<Unit, 'type'>) => u.type === 'helicopter';
/** world units per second in straight-line flight */
export const AIR_SPEED = 30;

/** give an existing career its city helicopter (added in the remaster) */
export function grantHelicopter(rng: Rng, stations: Station[], units: Unit[], personnel: Personnel[], nextUnit: number, nextPerson: number): { unit: Unit; crew: Personnel[] } | null {
  if (units.some(isAir)) return null;
  const st = stations.find((s) => s.service === 'police' && s.id === 'police-downtown') ?? stations.find((s) => s.service === 'police');
  if (!st) return null;
  const def = UNIT_TYPE_BY_ID.helicopter;
  const unit = makeUnit(def, st, units, nextUnit);
  const crew: Personnel[] = [];
  for (let k = 0; k < def.crew; k++) { const p = makePersonnel(rng, 'police', `p${nextPerson + k}`, 1.2, unit.id); crew.push(p); unit.personnelIds.push(p.id); }
  void personnel;
  return { unit, crew };
}

export function makeUnit(def: UnitTypeDef, station: Station, existing: Unit[], idNum: number): Unit {
  const city = getCity();
  const node = city.nodes[station.nodeId];
  const { callsign, spoken } = nextCallsign(existing, def);
  return {
    id: `u${idNum}`, callsign, spoken, service: def.service, type: def.type, typeLabel: def.label, status: 'AVAILABLE',
    x: node.x, y: node.y, prevNode: station.nodeId, stationId: station.id, postNode: station.nodeId,
    route: [], destNode: null, eta: null, speed: 0, capabilities: [...def.caps], personnelIds: [], crewSeats: def.crew, minCrew: def.minCrew,
    speedModifier: def.speed, equipment: def.equipment, timer: 0, value: def.cost, patients: 0, lastRadio: -999, deployments: 0,
    ...(def.type === 'helicopter' ? { fuel: 100 } : {}),
  };
}

export interface StartingFleet { stations: Station[]; units: Unit[]; personnel: Personnel[] }

export function buildStartingFleet(rng: Rng, opts: { reduced?: boolean; quality?: number } = {}): StartingFleet {
  const stations = [
    makeStation('police', 'downtown'), makeStation('police', 'westres'),
    makeStation('fire', 'downtown'), makeStation('fire', 'riverside'),
    makeStation('medical', 'downtown'), makeStation('medical', 'westres'),
  ];
  const plan: Array<[string, string]> = [
    ['patrol', 'police-downtown'], ['patrol', 'police-downtown'], ['patrol', 'police-westres'], ['motorcycle', 'police-downtown'],
    ['engine', 'fire-downtown'], ['rescue', 'fire-downtown'], ['engine', 'fire-riverside'], ['engine', 'fire-riverside'],
    ['advanced_ambulance', 'medical-downtown'], ['ambulance', 'medical-downtown'], ['ambulance', 'medical-westres'], ['advanced_ambulance', 'medical-westres'],
    ['helicopter', 'police-downtown'],
  ];
  const useStations = Object.fromEntries(stations.map((s) => [s.id, s]));
  const units: Unit[] = [];
  const personnel: Personnel[] = [];
  let pid = 1;
  plan.forEach(([type, sid], i) => {
    const def = UNIT_TYPE_BY_ID[type];
    const u = makeUnit(def, useStations[sid], units, i + 1);
    for (let k = 0; k < def.crew; k++) {
      const p = makePersonnel(rng, def.service, `p${pid++}`, opts.quality ?? 1, u.id);
      personnel.push(p); u.personnelIds.push(p.id);
    }
    units.push(u);
  });
  return { stations, units, personnel };
}
