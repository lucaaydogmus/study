import { getCity } from './city';
import { findPath } from './pathfinding';
import { BASE_SPEED, CLASS_MULT } from './constants';
import { EQUIPMENT, MAX_UPGRADES, UPKEEP_PER_UPGRADE, allowedFor } from './equipment';
import { VEHICLES } from './units';
import type { DistrictId, Service, VehicleId } from './types';

/** A unit as stored in the save. The simulation builds its live units from these. */
export interface FleetUnit { id: string; vehicle: VehicleId; stationId: string; upgrades: string[]; condition: number }

export const STATION_CAPACITY = 4;
export const MAX_FLEET = 20;
export const MIN_FLEET = 8;
export const PRICE: Record<VehicleId, number> = { patrol: 6000, suv: 9000, engine: 18000, rescue: 14000, ambulance: 8000, advanced: 15000 };
/** Charged automatically every shift for each unit. */
export const UPKEEP: Record<VehicleId, number> = { patrol: 60, suv: 90, engine: 200, rescue: 150, ambulance: 90, advanced: 160 };

const START: [string, VehicleId][] = [
  ['cpd', 'patrol'], ['cpd', 'suv'], ['npd', 'patrol'], ['wps', 'patrol'],
  ['fs1', 'engine'], ['fs1', 'rescue'], ['fs2', 'engine'],
  ['gen', 'ambulance'], ['gen', 'advanced'], ['nem', 'ambulance'], ['rem', 'ambulance'],
];

export const callsign = (v: VehicleId, n: number) => `${VEHICLES[v].prefix}-${n}`;
const nextNumber = (fleet: FleetUnit[], v: VehicleId) =>
  fleet.filter((u) => u.vehicle === v).reduce((m, u) => Math.max(m, Number(u.id.split('-').pop()) || 0), 0) + 1;

export function defaultFleet(): FleetUnit[] {
  const fleet: FleetUnit[] = [];
  for (const [stationId, vehicle] of START) fleet.push({ id: callsign(vehicle, nextNumber(fleet, vehicle)), vehicle, stationId, upgrades: [], condition: 100 });
  return fleet;
}

export const upkeepOf = (u: Pick<FleetUnit, 'vehicle' | 'upgrades'>) => UPKEEP[u.vehicle] + UPKEEP_PER_UPGRADE * u.upgrades.length;
export const totalUpkeep = (fleet: FleetUnit[]) => fleet.reduce((a, u) => a + upkeepOf(u), 0);
export const serviceCost = (u: FleetUnit) => Math.round((UPKEEP[u.vehicle] * 1.5 * (100 - u.condition)) / 100);
export const sellValue = (u: FleetUnit) => Math.round((PRICE[u.vehicle] + u.upgrades.reduce((a, id) => a + EQUIPMENT[id].cost, 0)) * 0.5);

export type Result = { ok: true; fleet: FleetUnit[]; money: number } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const stationOf = (id: string) => getCity().stations.find((s) => s.id === id);
export const stationLoad = (fleet: FleetUnit[], stationId: string) => fleet.filter((u) => u.stationId === stationId).length;
export const stationsFor = (service: Service) => getCity().stations.filter((s) => s.service === service);

export function buyVehicle(fleet: FleetUnit[], money: number, vehicle: VehicleId, stationId: string): Result {
  const st = stationOf(stationId);
  if (!st || st.service !== VEHICLES[vehicle].service) return fail('That station cannot host this vehicle.');
  if (fleet.length >= MAX_FLEET) return fail(`Fleet limit reached (${MAX_FLEET}).`);
  if (stationLoad(fleet, stationId) >= STATION_CAPACITY) return fail(`${st.name} is full.`);
  if (money < PRICE[vehicle]) return fail('Not enough budget.');
  const unit: FleetUnit = { id: callsign(vehicle, nextNumber(fleet, vehicle)), vehicle, stationId, upgrades: [], condition: 100 };
  return { ok: true, fleet: [...fleet, unit], money: money - PRICE[vehicle] };
}

export function sellUnit(fleet: FleetUnit[], money: number, id: string): Result {
  const u = fleet.find((x) => x.id === id);
  if (!u) return fail('Unknown unit.');
  if (fleet.length <= MIN_FLEET) return fail(`You must keep at least ${MIN_FLEET} units.`);
  if (fleet.filter((x) => VEHICLES[x.vehicle].service === VEHICLES[u.vehicle].service).length <= 2) return fail('Keep at least 2 units per service.');
  return { ok: true, fleet: fleet.filter((x) => x.id !== id), money: money + sellValue(u) };
}

export function moveUnit(fleet: FleetUnit[], money: number, id: string, stationId: string): Result {
  const u = fleet.find((x) => x.id === id);
  const st = stationOf(stationId);
  if (!u || !st) return fail('Unknown unit or station.');
  if (st.service !== VEHICLES[u.vehicle].service) return fail('Wrong service for that station.');
  if (u.stationId === stationId) return { ok: true, fleet, money };
  if (stationLoad(fleet, stationId) >= STATION_CAPACITY) return fail(`${st.name} is full.`);
  return { ok: true, fleet: fleet.map((x) => (x.id === id ? { ...x, stationId } : x)), money };
}

export function installUpgrade(fleet: FleetUnit[], money: number, id: string, upgrade: string): Result {
  const u = fleet.find((x) => x.id === id);
  const e = EQUIPMENT[upgrade];
  if (!u || !e) return fail('Unknown unit or equipment.');
  if (!allowedFor(upgrade, VEHICLES[u.vehicle].service)) return fail('That equipment does not fit this vehicle.');
  if (u.upgrades.includes(upgrade)) return fail('Already installed.');
  if (u.upgrades.length >= MAX_UPGRADES) return fail(`A vehicle holds at most ${MAX_UPGRADES} upgrades.`);
  if (money < e.cost) return fail('Not enough budget.');
  return { ok: true, fleet: fleet.map((x) => (x.id === id ? { ...x, upgrades: [...x.upgrades, upgrade] } : x)), money: money - e.cost };
}

export function removeUpgrade(fleet: FleetUnit[], money: number, id: string, upgrade: string): Result {
  const u = fleet.find((x) => x.id === id);
  if (!u || !u.upgrades.includes(upgrade)) return fail('Not installed.');
  return { ok: true, fleet: fleet.map((x) => (x.id === id ? { ...x, upgrades: x.upgrades.filter((g) => g !== upgrade) } : x)), money: money + Math.round(EQUIPMENT[upgrade].cost * 0.5) };
}

export function serviceUnits(fleet: FleetUnit[], money: number, ids: string[]): Result {
  const targets = fleet.filter((u) => ids.includes(u.id) && u.condition < 100);
  const cost = targets.reduce((a, u) => a + serviceCost(u), 0);
  if (!targets.length) return fail('Nothing to service.');
  if (money < cost) return fail('Not enough budget.');
  return { ok: true, fleet: fleet.map((u) => (ids.includes(u.id) ? { ...u, condition: 100 } : u)), money: money - cost };
}

/* --------------------------------------------------------------- coverage */

export type Coverage = Record<DistrictId, Record<Service, number | null>>;

/** Average clear-weather drive time (s) from the nearest staffed station of each service to sample junctions in each district. */
export function coverageTable(fleet: FleetUnit[]): Coverage {
  const city = getCity();
  const out = {} as Coverage;
  const speed = (e: { cls: keyof typeof CLASS_MULT }) => BASE_SPEED * CLASS_MULT[e.cls];
  const staffed = (s: Service) => city.stations.filter((st) => st.service === s && fleet.some((u) => u.stationId === st.id));
  for (const d of city.districts) {
    const ids = city.nodesByDistrict[d.id];
    const samples = ids.filter((_, i) => i % Math.max(1, Math.floor(ids.length / 8)) === 0).slice(0, 8);
    out[d.id] = { police: null, fire: null, medical: null };
    for (const svc of ['police', 'fire', 'medical'] as Service[]) {
      const stations = staffed(svc);
      if (!stations.length) continue;
      let total = 0;
      for (const n of samples) {
        total += Math.min(...stations.map((s) => findPath(city, s.nodeId, n, speed)?.time ?? Infinity));
      }
      out[d.id][svc] = total / samples.length;
    }
  }
  return out;
}
