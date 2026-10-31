// The fireground, the sky and the people: incident command at big fires, storm cells that cross the city
// and flood streets as they go, and crews who carry the bad calls with them.
import type { GameEngine } from './engine';
import { addressOf } from './city';
import { isAir } from './fleet';
import type { Incident, Personnel, Unit } from './types';

const hash = (a: number, b: number) => { let h = Math.imul(a + 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 13; return (h >>> 0) / 4294967296; };

// ── Scene command ───────────────────────────────────────────────────────────
export type Sector = 'attack' | 'vent' | 'search' | 'water' | 'exposure';
export const SECTORS: Array<{ id: Sector; label: string; hint: string }> = [
  { id: 'attack', label: 'Fire attack', hint: 'Hose lines on the fire. An engine.' },
  { id: 'vent', label: 'Ventilation', hint: 'Open the roof and windows so crews can see and breathe. A ladder truck.' },
  { id: 'search', label: 'Search & rescue', hint: 'Primary search for anyone inside. Rescue or ladder crews.' },
  { id: 'water', label: 'Water supply', hint: 'Hydrant to pump. Without it the attack runs dry. An engine.' },
  { id: 'exposure', label: 'Exposures', hint: 'Keep the fire from the buildings next door.' },
];
const FIT: Record<Sector, Record<string, number>> = {
  attack: { engine: 1, paramedic_engine: 0.95, ladder: 0.6, rescue: 0.35, heavy_rescue: 0.35 },
  vent: { ladder: 1, rescue: 0.8, heavy_rescue: 0.85, engine: 0.65, paramedic_engine: 0.6 },
  search: { rescue: 1, heavy_rescue: 1, usar: 1, ladder: 0.9, engine: 0.75, paramedic_engine: 0.75 },
  water: { engine: 1, paramedic_engine: 0.9, ladder: 0.3 },
  exposure: { engine: 0.95, ladder: 0.85, paramedic_engine: 0.85, rescue: 0.5 },
};
export const sectorFit = (s: Sector, u: Unit) => FIT[s][u.type] ?? 0.3;
const COMMAND_FIRES = new Set(['apartment_fire', 'warehouse_smoke', 'electrical_fire', 'house_explosion', 'building_collapse', 'industrial_accident', 'kitchen_fire']);
const fireCrews = (e: GameEngine, inc: Incident) => e.onScene(inc).filter((u) => u.service === 'fire' && !isAir(u));

/** big working fires need someone in command and crews given jobs, or everyone freelances */
export function commandTick(e: GameEngine, inc: Incident) {
  if (inc.command || !COMMAND_FIRES.has(inc.templateId) || e.state.config.mode === 'tutorial') return;
  const big = inc.severity >= 4 || (inc.severity >= 3 && inc.templateId !== 'kitchen_fire');
  const crews = fireCrews(e, inc);
  if (!big || crews.length < 2) return;
  // the first-in engine has already stretched a line: that much is done for you
  const first = crews.find((x) => sectorFit('attack', x) >= 0.9);
  inc.command = { ic: null, sectors: first ? { attack: first.id } : {}, at: e.state.time };
  const u = crews[0];
  e.radio(u.spoken, `Dispatch, ${u.spoken}. Working fire, ${addressOf(e.city, inc.nodeId)}. Multiple companies on scene — we need command established and crews assigned.`, 'alert', u.id, inc.id);
  e.notify(`Scene command needed at ${inc.label}: name an incident commander and give crews their jobs`, 'warn', inc.id);
}
/** how well the fireground is organised: multiplies how fast crews make progress */
export function commandFactor(e: GameEngine, inc: Incident): { f: number; notes: string[] } {
  const c = inc.command;
  if (!c) return { f: 1, notes: [] };
  const here = fireCrews(e, inc);
  const byId = new Map(here.map((u) => [u.id, u]));
  const notes: string[] = [];
  let f = 1;
  const inSector = new Set(Object.values(c.sectors).filter(Boolean) as string[]);
  if (!c.ic) { f *= 0.8; notes.push('No incident commander — crews are freelancing'); }
  else if (inSector.has(c.ic)) { f *= 0.9; notes.push('The incident commander is also working a sector'); }
  else if (!byId.has(c.ic) && !e.state.units[c.ic]) { f *= 0.85; notes.push('The incident commander has left'); }
  const at = (s: Sector) => { const id = c.sectors[s]; const u = id ? byId.get(id) : undefined; return u ? sectorFit(s, u) : 0; };
  const atk = at('attack');
  if (!atk) { f *= 0.6; notes.push('Nobody on fire attack'); } else { f *= 0.75 + 0.25 * atk; if (atk < 0.8) notes.push('The attack crew is the wrong company for it'); }
  const vent = at('vent');
  f *= vent ? 0.93 + 0.07 * vent : 0.9; if (!vent) notes.push('No ventilation — crews are working blind in the smoke');
  if (here.length >= 3) { const w = at('water'); f *= w ? 0.95 + 0.05 * w : 0.9; if (!w) notes.push('No water supply — the attack will run dry'); }
  if (inc.truth.trapped && !at('search')) { f *= 0.9; notes.push('Nobody is searching — people may still be inside'); }
  if ((inc.spread || inc.stage > 0) && !at('exposure')) { f *= 0.94; notes.push('Nobody protecting the exposures'); }
  return { f: Math.max(0.4, Math.min(1.08, f * 1.06)), notes };
}
export function setCommander(e: GameEngine, incId: string, unitId: string | null): { ok: boolean; reason?: string } {
  const inc = e.state.incidents[incId];
  if (!inc?.command) return { ok: false, reason: 'No command structure at this incident' };
  const u = unitId ? e.state.units[unitId] : null;
  if (unitId && (!u || u.service !== 'fire')) return { ok: false, reason: 'Command goes to a fire officer on scene' };
  inc.command.ic = unitId;
  if (u) { e.radio('DISPATCH', `${u.spoken}, you have command of ${inc.label.toLowerCase()} at ${addressOf(e.city, inc.nodeId)}.`, 'dispatch', u.id, inc.id); e.radio(u.spoken, `${u.spoken} copies, ${u.spoken} is ${inc.label.split(' ')[0]} Command.`, 'unit', u.id, inc.id); }
  return { ok: true };
}
export function assignSector(e: GameEngine, incId: string, sector: Sector, unitId: string | null): { ok: boolean; reason?: string } {
  const inc = e.state.incidents[incId];
  if (!inc?.command) return { ok: false, reason: 'No command structure at this incident' };
  const u = unitId ? e.state.units[unitId] : null;
  if (unitId && (!u || u.service !== 'fire')) return { ok: false, reason: 'Only fire companies work sectors' };
  for (const s of Object.keys(inc.command.sectors) as Sector[]) if (inc.command.sectors[s] === unitId) delete inc.command.sectors[s];
  if (unitId) inc.command.sectors[sector] = unitId; else delete inc.command.sectors[sector];
  if (u) e.radio('DISPATCH', `${u.spoken}, from command: you're ${SECTORS.find((x) => x.id === sector)!.label.toLowerCase()}.`, 'dispatch', u.id, inc.id);
  return { ok: true };
}

// ── Storm cells ─────────────────────────────────────────────────────────────
export interface StormCell { id: number; x: number; y: number; vx: number; vy: number; r: number; until: number; power: number; flooded: number[]; warned: string[]; spawned?: number }
/** heavy weather comes in cells that drift across the map, flooding low streets under them */
export function stormTick(e: GameEngine) {
  const st = e.state, city = e.city;
  const cells = (st.storms ??= []);
  const stormy = st.weather === 'storm' || (st.weather === 'rain' && st.weatherIntensity > 0.6) || st.events.some((v) => v.active && (v.type === 'storm' || v.type === 'flood'));
  if (stormy && cells.length < (st.weather === 'storm' ? 2 : 1) && st.config.mode !== 'tutorial' && hash(Math.floor(st.time / 15), 77) < 0.25) {
    // cells form upwind (west / south-west) and track across the city
    const W = Math.max(...city.nodes.map((n) => n.x)), H = Math.max(...city.nodes.map((n) => n.y));
    const k = hash(Math.floor(st.time), 78);
    const ang = -0.35 + k * 0.7;
    const speed = 0.9 + hash(Math.floor(st.time), 79) * 0.8;
    cells.push({ id: Math.floor(st.time), x: -60, y: H * (0.15 + 0.7 * hash(Math.floor(st.time), 80)), vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: 110 + k * 70, until: st.time + (W + 200) / speed, power: 0.6 + hash(Math.floor(st.time), 81) * 0.4, flooded: [], warned: [] });
    e.radio('DISPATCH', 'All units, weather service reports a severe storm cell moving in from the west. Expect flash flooding under it.', 'alert');
  }
  let changed = false;
  for (const c of cells) {
    c.x += c.vx; c.y += c.vy;
    // warn districts ahead of the cell
    for (const d of city.districts) {
      if (!st.config.districts.includes(d.id) || c.warned.includes(d.id)) continue;
      const cx = d.poly.reduce((a, p) => a + p.x, 0) / d.poly.length, cy = d.poly.reduce((a, p) => a + p.y, 0) / d.poly.length;
      const ahead = Math.hypot(c.x + c.vx * 90 - cx, c.y + c.vy * 90 - cy);
      if (ahead < c.r + 60) { c.warned.push(d.id); e.notify(`Storm cell reaching ${d.name} in about ${Math.max(1, Math.round(Math.hypot(cx - c.x, cy - c.y) / Math.hypot(c.vx, c.vy) / 60))} min — flooding likely`, 'warn'); }
    }
    // low streets flood under the heaviest rain and drain once it has passed
    const now = new Set<number>();
    for (const ed of city.edges) {
      if (ed.cls === 'highway' || ed.cls === 'bridge') continue;
      const a = city.nodes[ed.a], b = city.nodes[ed.b];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (Math.hypot(mx - c.x, my - c.y) < c.r * 0.55 && hash(ed.id, c.id) < 0.16 * c.power) now.add(ed.id);
    }
    const before = new Set(c.flooded);
    if (now.size !== before.size || [...now].some((x) => !before.has(x))) { c.flooded = [...now]; changed = true; }
    // the odd flooded basement or stranded car under the cell
    if ((c.spawned ?? 0) < 2 && hash(Math.floor(st.time / 6), c.id) < 0.012 * c.power && st.time < st.config.durationSec - 60) {
      const n = city.nearestNode(c.x, c.y);
      const dist = city.nodes[n].district;
      if (st.config.districts.includes(dist) && Math.hypot(city.nodes[n].x - c.x, city.nodes[n].y - c.y) < c.r * 0.6 && (c.spawned = (c.spawned ?? 0) + 1)) e.spawnIncident(hash(st.time, 3) < 0.5 ? 'flooded_basement' : 'power_line_down', dist, { nodeId: n });
    }
  }
  const gone = cells.filter((c) => st.time >= c.until || c.x > 2600 || c.y < -400 || c.y > 2600);
  if (gone.length) { st.storms = cells.filter((c) => !gone.includes(c)); changed = true; }
  if (changed) e.setFloodEdges([...new Set((st.storms ?? []).flatMap((c) => c.flooded))]);
}

// ── Crew stress ─────────────────────────────────────────────────────────────
/** a bad call stays with the people who were there */
export function addStress(e: GameEngine, inc: Incident, amount: number) {
  const child = inc.truth.age !== undefined && Number(inc.truth.age) < 14;
  for (const u of e.onScene(inc)) {
    if (isAir(u)) continue;
    for (const p of e.crewOf(u)) p.stress = Math.min(100, (p.stress ?? 0) + amount * (child ? 1.5 : 1) * (p.experience > 75 ? 0.75 : 1));
  }
}
export const crewStress = (e: GameEngine, u: Unit) => { const c = e.crewOf(u); return c.length ? c.reduce((a, p) => a + (p.stress ?? 0), 0) / c.length : 0; };
/** stress fades slowly; crews who are carrying too much ask to step away, and make mistakes if they cannot */
export function stressTick(e: GameEngine) {
  const st = e.state;
  if (st.config.mode === 'tutorial' || st.config.script) return;
  for (const p of Object.values(st.personnel)) if (p.stress) p.stress = Math.max(0, p.stress - (p.unitId && st.units[p.unitId]?.status === 'OUT_OF_SERVICE' ? 0.25 : 0.015));
  // mistakes: a crew running on empty misses the call or takes a wrong turn
  for (const u of Object.values(st.units)) {
    if (isAir(u) || u.temp) continue;
    const s = crewStress(e, u);
    if (s < 78) continue;
    if (u.status === 'DISPATCHED' && !u.slipped && hash(u.id.length * 31 + Math.floor(st.time), 5) < 0.02) {
      u.slipped = true; u.timer = (u.timer ?? 0) + 12;
      e.radio(u.spoken, 'Sorry, dispatch — say again the address? Missed that.', 'unit', u.id);
    }
  }
  if ((st.decisions ?? []).some((d) => !d.chosen) || st.time < (st.nextStressAt ?? 240)) return;
  const worst = Object.values(st.units).filter((u) => u.status === 'AVAILABLE' && !isAir(u) && !u.temp && crewStress(e, u) >= 62).sort((a, b) => crewStress(e, b) - crewStress(e, a))[0];
  if (!worst) { st.nextStressAt = st.time + 45; return; }
  st.nextStressAt = st.time + 300;
  const spare = spareFor(e, worst);
  (st.decisions ??= []).push({
    id: `d${st.decisions.length + 1}-s${Math.floor(st.time)}`, incId: '', unitId: worst.id, at: st.time, expiresAt: st.time + 30, kind: 'stress',
    prompt: `${worst.spoken}: that last one was rough. Can we take twenty minutes out of service to get our heads straight?`,
    options: [
      { id: 'rest', label: 'Take them out of service', hint: 'Gone for a few minutes; they come back steadier' },
      ...(spare.length ? [{ id: 'rotate', label: `Rotate the crew (${spare.length} fresh from the roster)`, hint: 'Send them home and bring in off-duty staff — costs overtime' }] : []),
      { id: 'deny', label: 'Keep them in service', hint: 'Available — but they are making mistakes' },
    ],
    defaultId: 'deny',
  });
  e.radio(worst.spoken, `Dispatch, ${worst.spoken}. That last call took it out of us. Requesting some time out of service.`, 'unit', worst.id);
}
function spareFor(e: GameEngine, u: Unit): Personnel[] {
  return Object.values(e.state.personnel).filter((p) => !p.unitId && p.service === u.service && (p.stress ?? 0) < 40 && p.fatigue < 50).slice(0, e.crewOf(u).length);
}
export function decideStress(e: GameEngine, d: import('./types').Decision, optionId: string): { ok: boolean; outcome?: string } {
  const st = e.state, u = st.units[d.unitId];
  if (!u) { d.outcome = 'Unit no longer on shift.'; return { ok: true, outcome: d.outcome }; }
  const crew = e.crewOf(u);
  if (optionId === 'rest') {
    if (u.status !== 'AVAILABLE') { d.outcome = `${u.callsign} caught another call first.`; return { ok: true, outcome: d.outcome }; }
    u.status = 'OUT_OF_SERVICE'; u.note = 'Stood down'; u.timer = 140; u.route = []; u.speed = 0;
    for (const p of crew) { p.stress = Math.max(0, (p.stress ?? 0) - 35); p.morale = Math.min(100, p.morale + 8); }
    e.radio('DISPATCH', `${u.spoken}, you're out of service. Take the time you need.`, 'dispatch', u.id);
    d.outcome = `${u.callsign} is out of service for a few minutes.`;
  } else if (optionId === 'rotate') {
    const fresh = spareFor(e, u);
    if (!fresh.length) { d.outcome = 'Nobody available to rotate in.'; return { ok: true, outcome: d.outcome }; }
    const out = crew.slice(0, fresh.length);
    for (const p of out) { p.unitId = null; p.stress = Math.max(0, (p.stress ?? 0) - 20); }
    for (const p of fresh) p.unitId = u.id;
    u.personnelIds = [...u.personnelIds.filter((id) => !out.some((p) => p.id === id)), ...fresh.map((p) => p.id)];
    const cost = 450 * fresh.length; st.budget -= cost; st.stats.costs += cost;
    e.radio('DISPATCH', `${u.spoken}, a relief crew is on the way to you. Hand over and go home.`, 'dispatch', u.id);
    d.outcome = `${u.callsign} has a fresh crew (${fresh.map((p) => p.name.split(' ').slice(-1)[0]).join(', ')}). Overtime $${cost}.`;
  } else {
    for (const p of crew) { p.morale = Math.max(0, p.morale - 10); p.stress = Math.min(100, (p.stress ?? 0) + 6); }
    e.radio('DISPATCH', `${u.spoken}, negative, we need you in service.`, 'dispatch', u.id);
    d.outcome = `${u.callsign} stays in service — and it shows.`;
  }
  st.stats.stressCalls = (st.stats.stressCalls ?? 0) + 1;
  return { ok: true, outcome: d.outcome };
}
/** stress and mistakes cost effectiveness on scene */
export const stressFactor = (crew: Personnel[]) => { if (!crew.length) return 1; const s = crew.reduce((a, p) => a + (p.stress ?? 0), 0) / crew.length; return s > 60 ? Math.max(0.78, 1 - (s - 60) / 180) : 1; };
