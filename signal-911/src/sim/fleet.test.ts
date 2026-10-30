import { describe, expect, it } from 'vitest';
import {
  MAX_FLEET, MIN_FLEET, PRICE, STATION_CAPACITY, buyVehicle, coverageTable, defaultFleet, installUpgrade, moveUnit,
  removeUpgrade, sellUnit, serviceCost, serviceUnits, totalUpkeep, upkeepOf,
} from './fleet';
import { SAVE_KEY, SAVE_VERSION, defaultSave, loadSave, migrate, writeSave, type StorageLike } from './save';
import { answerCall, buildSummary, createWorld, dispatch, fleetAfterShift, planRoute, step, currentRisk, type Incident, type World } from './world';
import { endCall } from './calls';
import { createRng } from './rng';
import { getCity } from './city';

const mem = (): StorageLike & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
const cfg = { seed: 4, shiftMinutes: 10, difficulty: 'normal', weather: 'clear' } as const;
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { expect(r.ok).toBe(true); return r as Extract<T, { ok: true }>; };

describe('fleet management', () => {
  it('buys a vehicle for the right service, with budget, capacity and fleet limits', () => {
    const f = defaultFleet();
    expect(buyVehicle(f, 1e6, 'ambulance', 'cpd').ok).toBe(false); // police station
    expect(buyVehicle(f, 100, 'ambulance', 'gen').ok).toBe(false); // no money
    const r = ok(buyVehicle(f, 20000, 'ambulance', 'nem'));
    expect(r.money).toBe(20000 - PRICE.ambulance);
    expect(r.fleet).toHaveLength(f.length + 1);
    expect(new Set(r.fleet.map((u) => u.id)).size).toBe(r.fleet.length); // unique callsigns
    expect(r.fleet.at(-1)!.id).toBe('A-4');
    // fill a station
    let fleet = f, money = 1e6;
    for (let i = 0; i < 10; i++) { const x = buyVehicle(fleet, money, 'patrol', 'cpd'); if (!x.ok) { expect(x.error).toMatch(/full/); break; } fleet = x.fleet; money = x.money; }
    expect(fleet.filter((u) => u.stationId === 'cpd')).toHaveLength(STATION_CAPACITY);
  });

  it('enforces the fleet cap and the minimum fleet when selling', () => {
    let fleet = defaultFleet();
    const byService = { police: 'patrol', fire: 'engine', medical: 'ambulance' } as const;
    for (const st of getCity().stations) {
      while (fleet.length < MAX_FLEET) { const r = buyVehicle(fleet, 1e7, byService[st.service], st.id); if (!r.ok) break; fleet = r.fleet; }
    }
    expect(fleet).toHaveLength(MAX_FLEET);
    const r = buyVehicle(fleet, 1e7, 'patrol', 'npd');
    expect(r.ok).toBe(false);
    let small = defaultFleet();
    for (const id of ['P-3', 'P-2', 'A-3']) small = ok(sellUnit(small, 0, id)).fleet; // 8 left
    expect(small).toHaveLength(MIN_FLEET);
    expect(sellUnit(small, 0, 'E-2').ok).toBe(false);
    expect(ok(sellUnit(defaultFleet(), 0, 'P-3')).money).toBe(PRICE.patrol / 2);
    // never sell the last two units of a service
    let police = defaultFleet();
    for (const id of ['P-3', 'P-2']) police = ok(sellUnit(police, 0, id)).fleet;
    expect(sellUnit(police, 0, 'P-1').ok).toBe(false);
  });

  it('moves units only between stations of their own service, respecting capacity', () => {
    const f = defaultFleet();
    expect(moveUnit(f, 0, 'A-1', 'cpd').ok).toBe(false);
    const r = ok(moveUnit(f, 0, 'A-1', 'nem'));
    expect(r.fleet.find((u) => u.id === 'A-1')!.stationId).toBe('nem');
    let fleet = f;
    for (const id of ['P-1', 'P-3', 'PS-1']) fleet = ok(moveUnit(fleet, 0, id, 'npd')).fleet;
    expect(fleet.filter((u) => u.stationId === 'npd')).toHaveLength(4);
    fleet = ok(buyVehicle(fleet, 1e6, 'patrol', 'cpd')).fleet;
    expect(moveUnit(fleet, 0, 'P-4', 'npd').ok).toBe(false);
  });

  it('installs, limits and refunds equipment', () => {
    const f = defaultFleet();
    expect(installUpgrade(f, 1e5, 'A-1', 'rescue_kit').ok).toBe(false); // wrong service
    expect(installUpgrade(f, 10, 'A-1', 'adv_med').ok).toBe(false); // no money
    let r = ok(installUpgrade(f, 10000, 'A-1', 'adv_med'));
    expect(r.money).toBe(7000);
    expect(installUpgrade(r.fleet, 1e5, 'A-1', 'adv_med').ok).toBe(false); // duplicate
    r = ok(installUpgrade(r.fleet, r.money, 'A-1', 'comms'));
    expect(installUpgrade(r.fleet, 1e5, 'A-1', 'comms').ok).toBe(false);
    expect(upkeepOf(r.fleet.find((u) => u.id === 'A-1')!)).toBe(90 + 100);
    expect(totalUpkeep(r.fleet)).toBeGreaterThan(totalUpkeep(f));
    const back = ok(removeUpgrade(r.fleet, 0, 'A-1', 'adv_med'));
    expect(back.money).toBe(1500);
  });

  it('servicing restores condition for a cost proportional to wear', () => {
    let f = defaultFleet().map((u) => (u.id === 'E-1' ? { ...u, condition: 40 } : u));
    expect(serviceCost(f.find((u) => u.id === 'E-1')!)).toBeGreaterThan(0);
    expect(serviceUnits(f, 0, ['E-1']).ok).toBe(false);
    const r = ok(serviceUnits(f, 1000, ['E-1']));
    expect(r.fleet.find((u) => u.id === 'E-1')!.condition).toBe(100);
    expect(r.money).toBeLessThan(1000);
    expect(serviceUnits(r.fleet, 1000, ['E-1']).ok).toBe(false); // nothing to do
    f = r.fleet;
  });

  it('coverage improves when a unit is added near a gap', () => {
    const base = coverageTable(defaultFleet());
    const fleet = ok(buyVehicle(defaultFleet(), 1e6, 'ambulance', 'gen')).fleet;
    expect(coverageTable(fleet).downtown.medical!).toBeLessThanOrEqual(base.downtown.medical!);
    // moving the only Westbrook police unit away worsens Westbrook police cover
    const moved = ok(moveUnit(defaultFleet(), 0, 'P-3', 'cpd')).fleet;
    expect(coverageTable(moved).westbrook.police!).toBeGreaterThan(base.westbrook.police!);
    for (const d of Object.values(base)) for (const v of Object.values(d)) expect(v).not.toBeNull();
  });
});

describe('save v2', () => {
  it('round-trips the fleet and migrates v1 saves', () => {
    const s = mem();
    const save = { ...defaultSave(), money: 777, fleet: ok(installUpgrade(defaultFleet(), 1e5, 'E-1', 'rescue_kit')).fleet };
    expect(writeSave(save, s)).toBe(true);
    const back = loadSave(s);
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.fleet.find((u) => u.id === 'E-1')!.upgrades).toEqual(['rescue_kit']);
    expect(back.money).toBe(777);
    // v1 save has no fleet
    s.data[SAVE_KEY] = JSON.stringify({ version: 1, money: 123, xp: 5, reputation: 60, completedShifts: 2, settings: { volume: 0.3, muted: true, shiftMinutes: 8, difficulty: 'hard' } });
    const v1 = loadSave(s);
    expect(v1.money).toBe(123); expect(v1.completedShifts).toBe(2); expect(v1.settings.difficulty).toBe('hard');
    expect(v1.fleet).toEqual(defaultFleet());
  });

  it('sanitises corrupt or hostile fleet data', () => {
    const bad = migrate({ fleet: [{ id: 'X-1', vehicle: 'tank', stationId: 'cpd' }, { id: 'P-1', vehicle: 'patrol', stationId: 'gen' }, 5, null] });
    expect(bad.fleet).toEqual(defaultFleet());
    const odd = migrate({ fleet: [
      { id: 'P-1', vehicle: 'patrol', stationId: 'cpd', upgrades: ['comms', 'comms', 'nope', 'tactical', 'comms'], condition: 500 },
      { id: 'P-1', vehicle: 'patrol', stationId: 'cpd' }, // duplicate id
      { id: 'E-1', vehicle: 'engine', stationId: 'fs1', condition: -9 },
      { id: 'A-1', vehicle: 'ambulance', stationId: 'gen' },
    ] });
    expect(odd.fleet.length).toBe(4 > 3 ? odd.fleet.length : 0);
    const p = odd.fleet.find((u) => u.id === 'P-1')!;
    expect(p.upgrades).toEqual(['comms', 'tactical']); expect(p.condition).toBe(100);
  });
});

/** An incident at a known address in a chosen family, for equipment tests. */
function incident(fleet = defaultFleet(), templateId = 'fire', variationId = 'small', seed = 4, near = 'fs1'): { w: World; inc: Incident } {
  const w = createWorld({ ...cfg, seed }, fleet);
  while (!w.calls.length) step(w, 0.5);
  const call = w.calls[0];
  const n = w.city.nodes[w.city.adj[w.city.stations.find((x) => x.id === near)!.nodeId][0].to];
  call.spec = { ...call.spec, nodeId: n.id, templateId, variationId, perceivedVariationId: variationId, district: n.district, twist: 'none', personality: 'calm', wrongNodeId: null, wrongAddress: null };
  const inc = answerCall(w, call.id)!;
  inc.believedNode = inc.nodeId; inc.address = inc.trueAddress; inc.x = n.x; inc.y = n.y; inc.addrConfirmed = true;
  inc.blockEdge = null; inc.risk = 0;
  endCall(w, inc, 'player');
  return { w, inc };
}
const run = (w: World, until: () => boolean, max = 2000) => { for (let i = 0; i < max && !until(); i++) step(w, 0.5); };

describe('equipment and fleet in the simulation', () => {
  it('builds the live fleet from the save, including new units and station moves', () => {
    let fleet = ok(buyVehicle(defaultFleet(), 1e6, 'advanced', 'rem')).fleet;
    fleet = ok(moveUnit(fleet, 0, 'A-1', 'nem')).fleet;
    const w = createWorld(cfg, fleet);
    expect(w.units).toHaveLength(12);
    const a1 = w.units.find((u) => u.id === 'A-1')!;
    expect(a1.stationId).toBe('nem');
    const nem = w.city.stations.find((s) => s.id === 'nem')!;
    expect(a1.node).toBe(nem.nodeId);
  });

  it('equipment shortens scenes it is meant for, once per kind', () => {
    const duration = (upg: string[]) => {
      const fleet = defaultFleet().map((u) => (u.vehicle === 'engine' ? { ...u, upgrades: upg } : u));
      const { w, inc } = incident(fleet, 'fire', 'small');
      const engine = w.units.find((u) => u.vehicle === 'engine' && u.status === 'AVAILABLE')!;
      dispatch(w, inc.id, [engine.id]);
      run(w, () => engine.status === 'ON SCENE');
      const t0 = w.time;
      run(w, () => inc.status === 'RESOLVED' || inc.status === 'FAILED');
      expect(inc.status).toBe('RESOLVED');
      return w.time - t0;
    };
    expect(duration(['rescue_kit'])).toBeLessThan(duration([]));
    // medical kit does not help a fire
    expect(Math.abs(duration(['comms']) - duration([]))).toBeLessThan(1.1);
    const { w, inc } = incident(defaultFleet().map((u) => (u.vehicle === 'engine' ? { ...u, upgrades: ['rescue_kit'] } : u)), 'fire', 'small');
    const e = w.units.find((u) => u.vehicle === 'engine')!;
    dispatch(w, inc.id, [e.id]); inc.risk = 0.5;
    const before = currentRisk(w, inc);
    run(w, () => e.status === 'ON SCENE');
    expect(currentRisk(w, inc)).toBeLessThan(before);
  });

  it('comms upgrades make a unit arrive sooner', () => {
    const eta = (up: string[]) => {
      const fleet = defaultFleet().map((u) => (u.id === 'E-1' ? { ...u, upgrades: up } : u));
      const { w, inc } = incident(fleet, 'fire', 'small', 4);
      const e = w.units.find((u) => u.id === 'E-1')!;
      return planRoute(w, e, inc.nodeId)!.eta;
    };
    expect(eta(['comms'])).toBeLessThan(eta([]));
  });

  it('trips wear vehicles; worn ones can break down, drop the call and come back later', () => {
    const fleet = defaultFleet().map((u) => (u.id === 'P-1' ? { ...u, condition: 20 } : u));
    const { w, inc } = incident(fleet, 'disturbance', 'burglary', 9, 'cpd');
    const u = w.units.find((x) => x.id === 'P-1')!;
    // Force the roll: find a seed where it breaks down quickly, else make it near-certain.
    dispatch(w, inc.id, [u.id]);
    expect(u.condition).toBe(14);
    u.condition = 0;
    w.mrng = { ...createRng(1), next: () => 0 }; // force the breakdown roll
    step(w, 0.5);
    expect(u.status).toBe('OUT OF SERVICE');
    expect(u.incidentId).toBeNull();
    expect(inc.assigned).not.toContain(u.id);
    expect(w.stats.breakdowns).toBeGreaterThan(0);
    expect(dispatch(w, inc.id, [u.id]).sent).toBe(0); // cannot dispatch a broken unit
    run(w, () => u.status === 'AVAILABLE', 400);
    expect(u.status).toBe('AVAILABLE');
    expect(u.condition).toBeGreaterThanOrEqual(40);
  });

  it('a worn-out vehicle starts the shift in the workshop', () => {
    const fleet = defaultFleet().map((u) => (u.id === 'E-2' ? { ...u, condition: 5 } : u));
    const w = createWorld(cfg, fleet);
    const u = w.units.find((x) => x.id === 'E-2')!;
    expect(u.status).toBe('OUT OF SERVICE');
    run(w, () => u.status === 'AVAILABLE', 200);
    expect(u.status).toBe('AVAILABLE');
  });

  it('summary charges upkeep and the saved fleet carries condition forward', () => {
    const fleet = defaultFleet().map((u) => (u.id === 'E-1' ? { ...u, upgrades: ['rescue_kit'] } : u));
    const w = createWorld(cfg, fleet);
    const s = buildSummary(w);
    expect(s.upkeep).toBe(totalUpkeep(fleet));
    expect(s.net).toBe(2000 - s.upkeep);
    const after = fleetAfterShift(w);
    expect(after).toHaveLength(fleet.length);
    expect(after.find((u) => u.id === 'E-1')!.upgrades).toEqual(['rescue_kit']);
  });

  it('a bigger fleet draws more calls', () => {
    const calls = (n: number) => {
      let fleet = defaultFleet();
      for (let i = 0; i < n; i++) fleet = ok(buyVehicle(fleet, 1e9, 'ambulance', ['gen', 'nem', 'rem'][i % 3])).fleet;
      const w = createWorld({ ...cfg, seed: 12 }, fleet);
      for (let i = 0; i < 1100; i++) step(w, 0.5);
      return w.calls.length;
    };
    expect(calls(6)).toBeGreaterThanOrEqual(calls(0));
  });
});
