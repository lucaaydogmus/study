import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { DT } from '../src/sim/engine';
import { contractProgress, rollExtras } from '../src/sim/extras';
import { evaluateAchievements } from '../src/sim/achievements';
import { newProfile } from '../src/sim/profile';
import { dailyConfig } from '../src/sim/scenarios';

const patrols = (e: ReturnType<typeof makeEngine>) => Object.values(e.state.units).filter((u) => u.capabilities.includes('patrol') && u.status === 'AVAILABLE');

describe('pursuits', () => {
  it('a fleeing vehicle moves along the roads and is stopped by two patrols', () => {
    const e = makeEngine({ script: [{ at: 1, template: 'pursuit', district: 'downtown', archetype: 'witness', accuracy: 'exact' }] });
    run(e, 3);
    const inc = Object.values(e.state.incidents)[0];
    const call = Object.values(e.state.calls)[0];
    expect(inc.pursuit).toBe(true);
    e.answerCall(call.id);
    run(e, 3);
    e.setIncidentLocation(inc.id, inc.nodeId, 'candidate');
    const start = { x: inc.mover!.x, y: inc.mover!.y };
    const ps = patrols(e).slice(0, 3);
    for (const u of ps) expect(e.dispatch(u.id, inc.id).ok).toBe(true);
    run(e, 30);
    expect(Math.hypot(inc.mover!.x - start.x, inc.mover!.y - start.y)).toBeGreaterThan(20);
    run(e, 500, () => inc.status === 'RESOLVED');
    expect(inc.status).toBe('RESOLVED');
    if (inc.outcome === 'success') expect(e.state.stats.pursuitsCaught).toBe(1);
    else expect(['failed', 'partial']).toContain(inc.outcome);
  });
});

describe('duplicate calls', () => {
  function setup() {
    const e = makeEngine({ script: [{ at: 1, template: 'apartment_fire', district: 'downtown', archetype: 'calm_serious', accuracy: 'exact' }] });
    run(e, 3);
    const src = Object.values(e.state.incidents)[0];
    e.answerCall(Object.values(e.state.calls)[0].id);
    run(e, 3);
    e.setIncidentLocation(src.id, src.nodeId, 'candidate');
    const dup = e.spawnIncident('apartment_fire', src.district, { duplicateOf: src, archetype: 'witness' });
    return { e, src, dup };
  }
  it('linking a duplicate merges it into the original and moves the call', () => {
    const { e, src, dup } = setup();
    const call = Object.values(e.state.calls).find((c) => c.incidentId === dup.id)!;
    e.answerCall(call.id);
    run(e, 3);
    e.setIncidentLocation(dup.id, src.nodeId, 'candidate');
    expect(e.duplicateCandidates(dup.id).some((c) => c.inc.id === src.id)).toBe(true);
    expect(e.linkIncident(dup.id, src.id).ok).toBe(true);
    expect(dup.outcome).toBe('merged');
    expect(call.incidentId).toBe(src.id);
    expect(e.state.stats.merges).toBe(1);
  });
  it('linking two unrelated incidents loses the linked emergency', () => {
    const e = makeEngine({ script: [
      { at: 1, template: 'kitchen_fire', district: 'downtown', accuracy: 'exact' },
      { at: 1, template: 'fall_elderly', district: 'downtown', accuracy: 'exact' },
    ] });
    run(e, 3);
    const [a, b] = Object.values(e.state.incidents);
    e.setIncidentLocation(a.id, a.nodeId, 'map'); e.setIncidentLocation(b.id, b.nodeId, 'map');
    e.linkIncident(b.id, a.id);
    expect(b.hidden).toBe(true);
    expect(e.state.stats.wrongLinks).toBe(1);
  });
  it('units sent to a duplicate join the original response on arrival', () => {
    const { e, src, dup } = setup();
    e.setIncidentLocation(dup.id, src.nodeId, 'map');
    const engine1 = Object.values(e.state.units).find((u) => u.service === 'fire' && u.status === 'AVAILABLE')!;
    expect(e.dispatch(engine1.id, dup.id).ok).toBe(true);
    run(e, 300, () => dup.status === 'RESOLVED');
    expect(dup.outcome).toBe('merged');
    expect(src.everAssigned).toContain(engine1.id);
  });
  it('closing the original folds remaining duplicates in', () => {
    const { e, src, dup } = setup();
    for (const u of Object.values(e.state.units).filter((x) => x.service === 'fire' || x.capabilities.includes('bls'))) e.dispatch(u.id, src.id);
    run(e, 900, () => src.status === 'RESOLVED');
    expect(src.status).toBe('RESOLVED');
    expect(dup.status).toBe('RESOLVED');
    expect(dup.outcome).toBe('merged');
  });
});

describe('shift modifiers, contracts and streaks', () => {
  it('short-staffed takes units out of service and diversion closes a hospital', () => {
    const e = makeEngine({ modifiers: ['short_staffed', 'diversion'], script: [] });
    expect(Object.values(e.state.units).filter((u) => u.status === 'OUT_OF_SERVICE' && u.note === 'Crew shortage').length).toBe(2);
    expect(e.state.closedHospitals.length).toBe(1);
  });
  it('contract progress and streak follow resolutions', () => {
    const e = makeEngine({ contracts: [{ id: 'fire', target: 1 }], script: [{ at: 1, template: 'kitchen_fire', district: 'downtown', accuracy: 'exact' }] });
    run(e, 3);
    const inc = Object.values(e.state.incidents)[0];
    const call = Object.values(e.state.calls)[0];
    e.answerCall(call.id);
    e.setIncidentLocation(inc.id, inc.nodeId, 'candidate');
    for (const u of Object.values(e.state.units).filter((x) => x.service === 'fire').slice(0, 2)) e.dispatch(u.id, inc.id);
    // location and dispatch done: hang up rather than leave the caller unanswered
    e.endCall(call.id);
    run(e, 600, () => inc.status === 'RESOLVED');
    expect(inc.outcome).toBe('success');
    expect(e.state.streak).toBe(1);
    expect(contractProgress(e.state, { id: 'fire', target: 1 }).done).toBe(true);
  });
  it('career extras are deterministic per seed', () => {
    expect(rollExtras(42, 3)).toEqual(rollExtras(42, 3));
    expect(rollExtras(42, 3).contracts.length).toBe(2);
  });
  it('daily challenge is identical for the same date', () => {
    const a = dailyConfig('2026-10-30'), b = dailyConfig('2026-10-30'), c = dailyConfig('2026-10-31');
    expect(a.config.seed).toBe(b.config.seed);
    expect(a.config.weather).toBe(b.config.weather);
    expect(a.config.seed).not.toBe(c.config.seed);
  });
});

describe('achievements', () => {
  it('unlocks once and records the time', () => {
    const e = makeEngine();
    run(e, 3);
    e.answerCall(Object.values(e.state.calls)[0].id);
    for (let i = 0; i < 4; i++) e.step(DT);
    const p = newProfile('A', 1);
    const got = evaluateAchievements({ profile: p, st: e.state });
    expect(got).toContain('first_call');
    expect(evaluateAchievements({ profile: p, st: e.state })).not.toContain('first_call');
  });
});
