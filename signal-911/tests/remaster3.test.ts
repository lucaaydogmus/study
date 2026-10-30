import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { TEMPLATE_BY_ID } from '../src/sim/content/templates';
import { classifyIntent } from '../src/sim/dialogue';
import { isAir } from '../src/sim/fleet';
import type { GameEngine } from '../src/sim/engine';
import type { Incident } from '../src/sim/types';

const quiet = { script: [] as never[] };
const answer = (e: GameEngine, inc: Incident) => { e.answerCall(inc.callId!); run(e, 3); };
const locate = (e: GameEngine, inc: Incident) => e.setIncidentLocation(inc.id, inc.nodeId, 'candidate');

describe('remaster 3', () => {
  it('callers only hear sirens once a lights-and-sirens unit is actually close', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('fall_elderly', 'westres', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    const call = e.state.calls[inc.callId!];
    const amb = Object.values(e.state.units).filter((u) => u.capabilities.includes('transport') && u.status === 'AVAILABLE')
      .sort((a, b) => (e.estimate(b.id, inc.nodeId)?.eta ?? 0) - (e.estimate(a.id, inc.nodeId)?.eta ?? 0))[0];
    expect(e.dispatch(amb.id, inc.id, { code: 3 }).ok).toBe(true);
    run(e, 4);
    // right after dispatch nobody claims to hear anything
    expect(call.transcript.filter((l) => l.who === 'CALLER').some((l) => /hear/i.test(l.text))).toBe(false);
    const n = e.city.nodes[inc.nodeId];
    run(e, 400, () => !!call.heardSirens);
    expect(call.heardSirens).toBe(true);
    expect(Math.hypot(amb.x - n.x, amb.y - n.y)).toBeLessThan(260);
  });

  it('never picks spawn-only templates or runways outside the airport', () => {
    const e = makeEngine({ ...quiet, districts: ['downtown', 'westres', 'oldtown', 'riverside', 'financial'] }, { rank: 7 });
    for (let i = 0; i < 600; i++) {
      const pick = e.pickIncident()!;
      expect(pick.tpl.spawnOnly).toBeFalsy();
      expect(pick.tpl.nodeHint === 'runway').toBe(false);
    }
  });

  it('a bank robbery that escalates spawns a getaway pursuit reported over the radio', () => {
    const e = makeEngine({ ...quiet, districts: ['financial', 'downtown'] }, { rank: 7 });
    const bank = e.spawnIncident('bank_robbery', 'financial', { accuracy: 'exact' });
    answer(e, bank); locate(e, bank);
    // a crew on scene at the bank
    const cop = Object.values(e.state.units).find((u) => u.capabilities.includes('patrol') && !isAir(u))!;
    e.dispatch(cop.id, bank.id);
    run(e, 300, () => cop.status === 'ON_SCENE');
    bank.threat = 100;
    run(e, 1);
    const van = Object.values(e.state.incidents).find((i) => i.templateId === 'getaway');
    expect(van).toBeDefined();
    expect(van!.callId).toBeNull();
    expect(van!.parentId).toBe(bank.id);
    expect(van!.reportedNode).not.toBeNull();
    expect(van!.pursuit && van!.mover).toBeTruthy();
    // the crew at the bank can break off straight into the chase
    expect(e.canDispatch(cop, van!).ok).toBe(true);
  });

  it('an aircraft emergency rewards crews staged before touchdown and punishes late ones', () => {
    for (const staged of [true, false]) {
      const e = makeEngine({ ...quiet, districts: ['airport', 'financial', 'northsub'] }, { rank: 7, fleet: { stations: [['fire', 'airport'], ['medical', 'airport']], units: [['engine', 'fire-airport'], ['engine', 'fire-airport'], ['engine', 'fire-airport'], ['advanced_ambulance', 'medical-airport']] } });
      const inc = e.spawnIncident('aircraft_emergency', 'airport', { accuracy: 'exact' });
      expect(inc.deadlineAt).toBeGreaterThan(e.state.time);
      answer(e, inc); locate(e, inc);
      if (staged) {
        for (const r of inc.requires) {
          const units = Object.values(e.state.units).filter((u) => u.capabilities.includes(r.cap) && u.status === 'AVAILABLE' && !inc.assignedUnits.includes(u.id))
            .sort((a, b) => (e.estimate(a.id, inc.nodeId)?.eta ?? 1e9) - (e.estimate(b.id, inc.nodeId)?.eta ?? 1e9));
          for (const u of units.slice(0, r.n)) e.dispatch(u.id, inc.id);
        }
      }
      run(e, 230, () => inc.deadlineMet != null);
      expect(inc.deadlineMet).toBe(staged);
      if (!staged) expect(inc.stage).toBeGreaterThan(0);
    }
  });

  it('the helicopter finds a fleeing car and its position can be relayed to ground units', () => {
    const e = makeEngine({ ...quiet, districts: ['downtown', 'oldtown', 'riverside', 'westres'] }, { rank: 7 });
    const inc = e.spawnIncident('pursuit', 'downtown', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    const heli = Object.values(e.state.units).find(isAir)!;
    expect(heli).toBeDefined();
    expect(e.dispatch(heli.id, inc.id).ok).toBe(true);
    run(e, 200, () => !!inc.mover?.heliId);
    expect(inc.mover!.heliId).toBe(heli.id);
    const before = inc.reportedNode;
    run(e, 12);
    expect(e.relayAir(inc.id).ok).toBe(true);
    expect(e.state.stats.heliRelays).toBe(1);
    expect(inc.reportedNode).not.toBeNull();
    void before;
    expect(heli.fuel!).toBeLessThan(100);
  });

  it('aircraft are grounded in storms and never count as ground coverage', () => {
    const e = makeEngine({ ...quiet, weather: 'storm' }, { rank: 7 });
    const heli = Object.values(e.state.units).find(isAir)!;
    const inc = e.spawnIncident('pursuit', 'downtown', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    e.state.weather = 'storm';
    expect(e.canDispatch(heli, inc).ok).toBe(false);
    expect(e.coverageImpact(heli.id)).toBeNull();
  });

  it('officers wait for the records return, and a correct return is rewarded', () => {
    const e = makeEngine(quiet, { rank: 7 });
    const inc = e.spawnIncident('public_disturbance', 'downtown', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    const cop = Object.values(e.state.units).find((u) => u.capabilities.includes('patrol') && !isAir(u))!;
    const r = (e as unknown as { officerRequest: (...a: unknown[]) => import('../src/sim/types').OfficerRequest }).officerRequest(cop, inc, 'person', false);
    expect(r.hits.some((h) => h.match)).toBe(true);
    expect(e.runRequest(r.id)!.ran).toBe(true);
    const res = e.answerRequest(r.id, r.truth);
    expect(res.correct).toBe(true);
    expect(e.state.stats.checksOk).toBe(1);
    expect(e.answerRequest(r.id, r.truth).ok).toBe(false);
  });

  it('telling an officer an armed subject is clear can get them hurt', () => {
    const e = makeEngine(quiet, { rank: 7 });
    const inc = e.spawnIncident('public_disturbance', 'downtown', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    const cop = Object.values(e.state.units).find((u) => u.capabilities.includes('patrol') && !isAir(u))!;
    e.dispatch(cop.id, inc.id);
    const r = (e as unknown as { officerRequest: (...a: unknown[]) => import('../src/sim/types').OfficerRequest }).officerRequest(cop, inc, 'person', true);
    r.truth = 'caution';
    e.rng.chance = () => true;
    e.answerRequest(r.id, 'clear');
    expect(e.state.stats.checksBad).toBe(1);
    expect(Object.values(e.state.incidents).some((i) => i.templateId === 'officer_down')).toBe(true);
    expect(cop.status).toBe('OUT_OF_SERVICE');
  });

  it('coached CPR keeps a cardiac arrest patient alive far longer than no instructions', () => {
    const surv = (cpr: boolean) => {
      const e = makeEngine(quiet);
      const inc = e.spawnIncident('cardiac_arrest', 'westres', { accuracy: 'exact', archetype: 'witness' });
      answer(e, inc);
      e.ask(inc.callId!, { intent: 'breathing' });
      if (cpr) e.ask(inc.callId!, { intent: 'inst_cpr' });
      run(e, 90);
      return inc.survival ?? 100;
    };
    const withCpr = surv(true), without = surv(false);
    expect(withCpr).toBeGreaterThan(without + 25);
  });

  it('harmful advice is recognised, negations are not, and the consequences are recorded', () => {
    expect(classifyIntent('give him some water')).toBe('inst_water');
    expect(classifyIntent("don't give him any water")).not.toBe('inst_water');
    expect(classifyIntent('go back inside and grab your cat')).toBe('inst_goback');
    expect(classifyIntent('sit him up for me')).toBe('inst_lift');
    expect(classifyIntent('go downstairs and confront him')).toBe('inst_confront');
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('kitchen_fire', 'westres', { accuracy: 'exact' });
    answer(e, inc);
    e.ask(inc.callId!, { text: 'Go back inside and try to put it out with a bucket' });
    expect(inc.consequences?.length).toBeGreaterThan(0);
    expect(e.state.stats.harmfulAdvice).toBe(1);
    expect(inc.requires.some((r) => r.cap === 'rescue')).toBe(true);
  });

  it('scenario set pieces spawn on schedule', () => {
    const e = makeEngine({ script: undefined, incidentRate: 0.0001, forced: [{ at: 20, template: 'bank_robbery', district: 'downtown' }] }, { rank: 7 });
    run(e, 25);
    expect(Object.values(e.state.incidents).some((i) => i.templateId === 'bank_robbery')).toBe(true);
    expect(TEMPLATE_BY_ID.getaway.spawnOnly).toBe(true);
  });
});
