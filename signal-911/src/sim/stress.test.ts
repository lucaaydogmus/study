import { describe, expect, it } from 'vitest';
import { EVENTS } from './events';
import { buildSummary, createWorld, step, type Config } from './world';
import { checkInvariants, playShift } from './testbot';
import { evaluateCareer, defaultCareer } from './career';
import { defaultFleet, buyVehicle } from './fleet';

const base: Config = { seed: 1, shiftMinutes: 10, difficulty: 'normal', weather: 'clear' };

describe('stress: whole shifts, many configurations', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) for (const weather of ['clear', 'rain'] as const) {
    it(`${difficulty} / ${weather}: three seeds finish with consistent state`, () => {
      for (const seed of [2, 3, 4]) {
        const w = createWorld({ ...base, seed, difficulty, weather });
        playShift(w, 1, true);
        expect(w.over).toBe(true);
        const s = buildSummary(w);
        expect(s.resolved + s.failed + s.unresolved).toBe(w.incidents.length);
        expect(s.answered + s.missed).toBe(w.calls.length);
        expect(Number.isFinite(s.net)).toBe(true);
        expect(w.activeCall === null || w.incidents.find((i) => i.id === w.activeCall)?.session).toBeTruthy();
      }
    }, 120000);
  }

  for (const ev of EVENTS) {
    it(`${ev.name}: invariants hold throughout`, () => {
      const w = createWorld({ ...base, seed: 7, event: ev.id });
      playShift(w, 1, true);
      expect(w.over).toBe(true);
      const out = evaluateCareer(defaultCareer(), w, buildSummary(w), 0);
      expect(out.career.active).toHaveLength(3);
    }, 120000);
  }

  it('a maximum-size fleet with equipment plays a whole shift', () => {
    let fleet = defaultFleet();
    const buy = [['ambulance', 'nem'], ['ambulance', 'rem'], ['engine', 'fs2'], ['engine', 'fs1'], ['rescue', 'fs2'], ['patrol', 'wps'], ['patrol', 'npd'], ['suv', 'cpd'], ['advanced', 'gen']] as const;
    for (const [v, st] of buy) { const r = buyVehicle(fleet, 1e9, v, st); if (r.ok) fleet = r.fleet; }
    fleet = fleet.map((u, i) => ({ ...u, upgrades: i % 2 ? ['comms'] : [], condition: 30 + (i * 7) % 70 }));
    const w = createWorld({ ...base, seed: 11, difficulty: 'hard' }, fleet);
    playShift(w, 1, true);
    expect(w.over).toBe(true);
    expect(w.units.length).toBe(fleet.length);
  }, 120000);

  it('time never passes while paused and large frame gaps are subdivided safely', () => {
    const w = createWorld({ ...base, seed: 5 });
    step(w, 0);
    expect(w.time).toBe(0);
    step(w, 30); // a long stall (e.g. a throttled tab) is simulated in small steps
    expect(w.time).toBeCloseTo(30);
    checkInvariants(w);
  });
});
