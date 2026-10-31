// The buildings behind the fleet. Every station has bay doors, a station alerting system, a backup
// generator, a fuel tank and a stores room, and they all wear out. A jammed door or a crew that never
// heard the tones costs seconds on every call; an empty fuel tank or stores room costs more. Police
// stations have cells that fill up. Hospitals hold ambulances at the door when they are full, and a
// call to the charge nurse can get a crew back on the road.
import type { GameEngine } from './engine';
import { addressOf } from './city';
import { isAir } from './fleet';
import type { GameState, Station, StationSystems, Unit } from './types';

export type SystemKey = 'doors' | 'alerting' | 'generator' | 'fuel' | 'supplies';
export const SYSTEMS: Array<{ id: SystemKey; label: string; fix: string; cost: number; time: number; hint: string }> = [
  { id: 'doors', label: 'Bay doors', fix: 'Repair the door motors', cost: 1200, time: 90, hint: 'Worn doors jam on turnout — crews lift them by hand.' },
  { id: 'alerting', label: 'Station alerting', fix: 'Service the tone system', cost: 900, time: 60, hint: 'A failing system means crews miss the tones — you have to re-tone them.' },
  { id: 'generator', label: 'Backup generator', fix: 'Service the generator', cost: 1500, time: 120, hint: 'In a blackout a dead generator leaves the station dark and slow.' },
  { id: 'fuel', label: 'Fuel tank', fix: 'Order a fuel delivery', cost: 600, time: 60, hint: 'An empty tank sends crews across town to the city yard to refuel.' },
  { id: 'supplies', label: 'Stores', fix: 'Restock supplies', cost: 900, time: 45, hint: 'Out of drugs, dressings or air cylinders, crews work slower.' },
];
const h01 = (a: number, b: number) => { let h = Math.imul(a + 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const sid = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

export function systemsOf(st: GameState, s: Station): StationSystems {
  if (!s.systems) {
    const k = sid(s.id);
    s.systems = { doors: 70 + h01(k, 1) * 30, alerting: 70 + h01(k, 2) * 30, generator: 65 + h01(k, 3) * 35, fuel: 60 + h01(k, 4) * 40, supplies: 65 + h01(k, 5) * 35, cells: s.service === 'police' ? 0 : undefined, repairs: [] };
  }
  return s.systems;
}
const stationOf = (st: GameState, u: Unit) => (u.temp || u.stationId === 'outside' ? null : st.stations[u.stationId] ?? null);
const atHome = (e: GameEngine, u: Unit) => { const s = stationOf(e.state, u); if (!s) return false; const n = e.city.nodes[s.nodeId]; return Math.hypot(u.x - n.x, u.y - n.y) < 8; };
const repairing = (sys: StationSystems, k: SystemKey, t: number) => sys.repairs.some((r) => r.sys === k && r.until > t);
const blackout = (st: GameState, district: string) => st.events.some((v) => v.active && v.type === 'blackout' && v.districts.includes(district));

/** extra seconds before a crew rolls out of its station, and what the radio hears about it */
export function turnoutDelay(e: GameEngine, u: Unit): number {
  const st = e.state, s = stationOf(st, u);
  if (!s || isAir(u) || !atHome(e, u) || st.config.mode === 'tutorial') return 0;
  const sys = systemsOf(st, s);
  let extra = 0;
  sys.doors = Math.max(0, sys.doors - 0.6);
  sys.alerting = Math.max(0, sys.alerting - 0.35);
  sys.fuel = Math.max(0, sys.fuel - 2.2);
  const roll = h01(u.deployments * 13 + sid(u.id), Math.floor(st.time));
  if (repairing(sys, 'doors', st.time)) extra += 8;
  else if (sys.doors < 35 && roll < 0.35) { extra += 18; e.radio(u.spoken, `Dispatch, ${u.spoken}. Bay door's jammed — we're winding it up by hand. Give us a moment.`, 'unit', u.id); st.stats.doorJams = (st.stats.doorJams ?? 0) + 1; }
  if (sys.alerting < 40 && !repairing(sys, 'alerting', st.time) && h01(u.deployments * 7 + sid(u.id), Math.floor(st.time) + 3) < 0.3) { extra += 22; u.missedTones = true; st.stats.missedTones = (st.stats.missedTones ?? 0) + 1; }
  if (blackout(st, s.district) && sys.generator < 50) extra += 14;
  return extra;
}
/** the crew never heard the dispatch: send the tones again */
export function reTone(e: GameEngine, unitId: string): { ok: boolean; reason?: string } {
  const u = e.state.units[unitId];
  if (!u || !u.missedTones) return { ok: false, reason: 'They have the call' };
  u.missedTones = false;
  if (u.status === 'DISPATCHED') u.timer = Math.min(u.timer, 5);
  e.radio('DISPATCH', `${u.spoken}, ${u.spoken} — repeat tones. You have a call.`, 'dispatch', u.id);
  e.radio(u.spoken, 'Sorry dispatch — tones didn\'t go off in here. Responding now.', 'unit', u.id);
  return { ok: true };
}
/** crews use up their stores at scenes */
export function useSupplies(e: GameEngine, u: Unit, amount: number) {
  const s = stationOf(e.state, u);
  if (s) { const sys = systemsOf(e.state, s); sys.supplies = Math.max(0, sys.supplies - amount); }
}
export function suppliesFactor(st: GameState, u: Unit): number {
  if (u.service === 'police') return 1;
  const s = stationOf(st, u);
  if (!s) return 1;
  return systemsOf(st, s).supplies < 20 ? 0.88 : 1;
}
/** back in quarters: no fuel at home means a trip to the city yard */
export function onReturn(e: GameEngine, u: Unit): boolean {
  const st = e.state, s = stationOf(st, u);
  if (!s || isAir(u) || st.config.mode === 'tutorial') return false;
  const sys = systemsOf(st, s);
  if (sys.fuel < 12 && !repairing(sys, 'fuel', st.time)) {
    u.status = 'OUT_OF_SERVICE'; u.note = 'Refuelling at the city yard'; u.timer = 45;
    e.radio(u.spoken, `Dispatch, ${u.spoken}. Station tank's dry — we're going to the city yard to fuel up.`, 'unit', u.id);
    return true;
  }
  return false;
}
/** cells at a police station fill up; full cells mean the long drive to county */
export function bookPrisoner(e: GameEngine, u: Unit): number {
  const st = e.state, s = stationOf(st, u);
  if (!s) return 30;
  const sys = systemsOf(st, s);
  sys.cells = (sys.cells ?? 0) + 1;
  if (sys.cells > 6) { e.radio(u.spoken, `Dispatch, ${u.spoken}. Cells are full at ${s.name} — we'll have to run this one out to county.`, 'unit', u.id); return 95; }
  return 30;
}

/** fix something at a station: a contractor comes out, it costs money and takes a little while */
export function repairStation(e: GameEngine, stationId: string, k: SystemKey | 'cells'): { ok: boolean; reason?: string } {
  const st = e.state, s = st.stations[stationId];
  if (!s) return { ok: false, reason: 'Unknown station' };
  const sys = systemsOf(st, s);
  if (k === 'cells') {
    if (!sys.cells) return { ok: false, reason: 'The cells are empty' };
    const cost = 150 * sys.cells; st.budget -= cost; st.stats.costs += cost;
    e.radio('DISPATCH', `County transport, Ravenport. ${sys.cells} prisoner${sys.cells > 1 ? 's' : ''} for pickup at ${s.name}.`, 'dispatch');
    sys.cells = 0;
    return { ok: true };
  }
  const def = SYSTEMS.find((x) => x.id === k)!;
  if (repairing(sys, k, st.time)) return { ok: false, reason: 'Already being fixed' };
  if (sys[k] > 92) return { ok: false, reason: `${def.label} are fine` };
  st.budget -= def.cost; st.stats.costs += def.cost;
  sys.repairs.push({ sys: k, until: st.time + def.time });
  st.stats.stationRepairs = (st.stats.stationRepairs ?? 0) + 1;
  e.notify(`${s.name}: ${def.fix.toLowerCase()} — about ${Math.round(def.time / 60) || 1} min (−$${def.cost})`, 'info');
  return { ok: true };
}

/** wear, faults, finished repairs, and things that happen at stations */
export function buildingsTick(e: GameEngine) {
  const st = e.state;
  if (st.config.mode === 'tutorial' || st.config.script) return;
  for (const s of Object.values(st.stations)) {
    const sys = systemsOf(st, s);
    for (const r of sys.repairs) if (r.until <= st.time && !r.done) { r.done = true; sys[r.sys] = 100; e.notify(`${s.name}: ${SYSTEMS.find((x) => x.id === r.sys)!.label.toLowerCase()} back to 100%`, 'good'); }
    sys.repairs = sys.repairs.filter((r) => !r.done || st.time - r.until < 5);
    sys.generator = Math.max(0, sys.generator - 0.004);
    if (sys.cells) { sys.cellsAt ??= st.time; if (st.time - sys.cellsAt > 420) { sys.cells = Math.max(0, sys.cells - 1); sys.cellsAt = st.time; } }
    // a blackout finds out whose generator works
    if (blackout(st, s.district) && sys.generator < 50 && !sys.darkWarned) { sys.darkWarned = true; e.radio(s.name, `Dispatch, ${s.name}. Power's out and the generator won't start. We're on flashlights here — turnouts will be slow.`, 'unit'); e.notify(`${s.name} is dark — service the generator`, 'warn'); }
  }
  // now and then something breaks at a station
  if (st.time < (st.nextStationFault ?? 200)) return;
  st.nextStationFault = st.time + 260 + h01(Math.floor(st.time), 9) * 260;
  const list = Object.values(st.stations);
  if (!list.length) return;
  const s = list[Math.floor(h01(Math.floor(st.time), 10) * list.length)];
  const sys = systemsOf(st, s);
  const k = Math.floor(h01(Math.floor(st.time), 11) * 5);
  const ev: Array<[SystemKey, number, string]> = [
    ['doors', 18, `${s.name}: a bay door motor has burnt out.`],
    ['alerting', 22, `${s.name}: the station alerting system failed its test — crews may not hear the tones.`],
    ['generator', 20, `${s.name}: the backup generator failed its weekly run.`],
    ['supplies', 15, `${s.name}: a pipe burst in the stores room — supplies ruined.`],
    ['fuel', 8, `${s.name}: the fuel tank sensor reads nearly empty — a leak or a missed delivery.`],
  ];
  const [key, val, text] = ev[k];
  if (key === 'supplies' && s.service === 'police') return;
  sys[key] = Math.min(sys[key], val);
  e.radio(s.name, text, 'chatter');
  e.notify(`${text} Fix it from the station card.`, 'warn');
}

/** call the charge nurse to get a crew out of the corridor */
export function expediteOffload(e: GameEngine, unitId: string): { ok: boolean; reason?: string } {
  const st = e.state, u = st.units[unitId];
  if (!u || u.note !== 'Held at the ER door') return { ok: false, reason: 'Not waiting to offload' };
  const hn = e.city.nearestNode(u.x, u.y);
  const h = st.hospitals?.[hn] ?? Object.values(st.hospitals ?? {}).sort((a, b) => Math.hypot(e.city.nodes[a.node].x - u.x, e.city.nodes[a.node].y - u.y) - Math.hypot(e.city.nodes[b.node].x - u.x, e.city.nodes[b.node].y - u.y))[0];
  if (!h) return { ok: false, reason: 'No hospital' };
  if (st.time - (h.lastNurse ?? -999) < 240) return { ok: false, reason: `The charge nurse at ${h.name} already found you a bed — try again in a few minutes` };
  h.lastNurse = st.time;
  u.timer = Math.min(u.timer, 6); u.note = undefined;
  e.radio(h.name, `${h.name} charge nurse: we'll take your patient on our trolley — ${u.spoken}, you're free.`, 'hospital', u.id);
  st.stats.offloadsExpedited = (st.stats.offloadsExpedited ?? 0) + 1;
  return { ok: true };
}
export const stationAddress = (e: GameEngine, s: Station) => addressOf(e.city, s.nodeId);
