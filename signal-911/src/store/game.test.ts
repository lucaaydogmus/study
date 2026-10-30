import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_KEY } from '../sim/save';

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });

async function fresh() {
  vi.resetModules();
  for (const k of Object.keys(store)) delete store[k];
  const { useGame } = await import('./game');
  return useGame;
}

describe('game store', () => {
  let useGame: Awaited<ReturnType<typeof fresh>>;
  beforeEach(async () => { useGame = await fresh(); });

  it('starts in the briefing; pause and speed only act during a shift', () => {
    const g = useGame.getState();
    expect(g.phase).toBe('preshift');
    g.tick(1);
    expect(useGame.getState().world.time).toBe(0);
    g.startShift();
    expect(useGame.getState().phase).toBe('shift');
    useGame.getState().tick(0.1);
    expect(useGame.getState().world.time).toBeCloseTo(0.1);
    useGame.getState().togglePause();
    useGame.getState().tick(0.2);
    expect(useGame.getState().world.time).toBeCloseTo(0.1); // paused
    useGame.getState().togglePause();
    useGame.getState().setSpeed(4);
    useGame.getState().tick(0.1);
    expect(useGame.getState().world.time).toBeCloseTo(0.5);
  });

  it('plays a call end to end through the store and finishes the shift with a persisted result', () => {
    const s = () => useGame.getState();
    s().setConfig({ shiftMinutes: 5 });
    s().startShift();
    let guard = 0;
    while (!s().world.calls.some((c) => c.status === 'ringing') && guard++ < 4000) s().tick(0.25);
    const call = s().world.calls.find((c) => c.status === 'ringing')!;
    s().answer(call.id);
    expect(s().sel.incidentId).not.toBeNull();
    const inc = s().world.incidents[0];
    for (let k = 0; k < 3 && inc.session && inc.believedNode === null; k++) {
      s().askQuestion('ADDRESS'); // a caller may deflect once, so ask again
      for (let i = 0; i < 40 && inc.session?.pending; i++) s().tick(0.5);
    }
    s().hangUp();
    expect(s().world.activeCall).toBeNull();
    expect(inc.believedNode).not.toBeNull(); // asked, or traced when the call ended
    s().selectIncident(inc.id);
    const unit = s().world.units.find((u) => u.status === 'AVAILABLE')!;
    s().togglePending(unit.id);
    s().confirmDispatch();
    expect(unit.status).toBe('EN ROUTE');
    const money = s().save.money;
    s().endShift();
    expect(s().phase).toBe('summary');
    expect(s().summary).not.toBeNull();
    expect(s().save.completedShifts).toBe(1);
    expect(s().save.money).not.toBe(money);
    const saved = JSON.parse(store[SAVE_KEY]);
    expect(saved.completedShifts).toBe(1);
    expect(saved.fleet.length).toBeGreaterThan(0);
    s().nextShift();
    expect(s().phase).toBe('preshift');
  });

  it('fleet changes are only possible between shifts and are saved', () => {
    const s = () => useGame.getState();
    s().buyVehicle('ambulance', 'nem');
    expect(s().save.fleet).toHaveLength(12);
    expect(JSON.parse(store[SAVE_KEY]).fleet).toHaveLength(12);
    s().startShift();
    s().buyVehicle('ambulance', 'nem');
    expect(s().save.fleet).toHaveLength(12); // ignored during a shift
    s().openDepot(true);
    expect(s().depotOpen).toBe(false);
  });

  it('refuses scenarios that are still locked and resets progress on request', () => {
    const s = () => useGame.getState();
    s().setScenario('event', 'industrial_fire');
    expect(s().config.event ?? null).toBeNull();
    expect(s().toast).toMatch(/locked/);
    s().setScenario('event', 'heavy_rain');
    expect(s().config.event).toBe('heavy_rain');
    s().buyVehicle('patrol', 'cpd');
    s().resetProgress();
    expect(s().save.fleet).toHaveLength(11);
    expect(s().config.event).toBeNull();
  });

  it('survives storage that throws', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } });
    vi.resetModules();
    const { useGame: g2 } = await import('./game');
    g2.getState().startShift();
    g2.getState().endShift();
    expect(g2.getState().phase).toBe('summary');
    expect(g2.getState().saveOk).toBe(false);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  });
});
