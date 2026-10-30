import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { isAir } from '../src/sim/fleet';
import type { GameEngine } from '../src/sim/engine';
import type { Incident, Unit } from '../src/sim/types';

const quiet = { script: [] as never[] };
const answer = (e: GameEngine, inc: Incident) => { e.answerCall(inc.callId!); run(e, 3); };
const locate = (e: GameEngine, inc: Incident) => e.setIncidentLocation(inc.id, inc.nodeId, 'candidate');
const cops = (e: GameEngine) => Object.values(e.state.units).filter((u) => u.capabilities.includes('patrol') && !isAir(u));
const done = (i: Incident) => ['RESOLVED', 'CLOSED'].includes(i.status);

describe('remaster 6', () => {
  it('a tow truck called ahead of time is there when the crew finishes', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('collision_minor', 'downtown', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    const budget = e.state.budget;
    const r = e.callAgency(inc.id);
    expect(r.ok).toBe(true);
    expect(e.state.budget).toBeLessThan(budget);
    expect(e.callAgency(inc.id).ok).toBe(false);
    e.dispatch(cops(e)[0].id, inc.id);
    run(e, 400, () => done(inc));
    expect(done(inc)).toBe(true);
    expect(inc.agency!.here).toBe(true);
    expect(inc.agency!.late).toBeFalsy();
    expect(e.state.stats.agencyCalls).toBe(1);
  });

  it('a scene waits for the agency the crew asked for, and if nobody calls it the crew does — late', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('collision_minor', 'downtown', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    inc.agency = { kind: 'tow', askedAt: e.state.time, calledAt: null, arriveAt: null, here: false, nagged: 0 };
    e.dispatch(cops(e)[0].id, inc.id);
    run(e, 110);
    expect(done(inc)).toBe(false);
    run(e, 400, () => done(inc));
    expect(inc.agency!.late).toBe(true);
    expect(e.state.stats.agencyLate).toBe(1);
    expect(inc.consequences?.some((c) => /tow truck/.test(c))).toBe(true);
    expect(done(inc)).toBe(true);
  });

  const onScene = (e: GameEngine, tpl: string): { inc: Incident; u: Unit } => {
    const inc = e.spawnIncident(tpl, 'downtown', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    const u = cops(e)[0];
    e.dispatch(u.id, inc.id);
    run(e, 300, () => u.status === 'ON_SCENE');
    return { inc, u };
  };

  it('police on scene owe dispatch a status check, and a check catches trouble before it happens', () => {
    const e = makeEngine(quiet, { rank: 5 });
    const { inc, u } = onScene(e, 'public_disturbance');
    expect(u.checkDue).toBeGreaterThan(e.state.time);
    u.trouble = e.state.time + 20;
    const r = e.statusCheck(u.id);
    expect(r.trouble).toBe(true);
    expect(u.trouble).toBeNull();
    expect(inc.requires.find((x) => x.cap === 'patrol')!.n).toBeGreaterThanOrEqual(2);
    expect(e.state.stats.statusSaves).toBe(1);
    // a routine check just resets the timer
    const due = u.checkDue!;
    run(e, 2);
    expect(e.statusCheck(u.id).trouble).toBeFalsy();
    expect(u.checkDue!).toBeGreaterThan(due);
  });

  it('an overdue status check can get an officer hurt', () => {
    const e = makeEngine(quiet, { rank: 5 });
    const { inc, u } = onScene(e, 'public_disturbance');
    u.checkDue = e.state.time - 30; u.trouble = e.state.time;
    const orig = e.rng.chance; e.rng.chance = () => true;
    run(e, 1.5); e.rng.chance = orig;
    expect(u.status).toBe('OUT_OF_SERVICE');
    expect(Object.values(e.state.incidents).some((i) => i.templateId === 'officer_down' && i.parentId === inc.id)).toBe(true);
    expect(e.overdueChecks().some((x) => x.id === u.id)).toBe(false);
  });

  it('an officer whose check is not yet due calls for backup on their own', () => {
    const e = makeEngine(quiet, { rank: 5 });
    const { inc, u } = onScene(e, 'public_disturbance');
    u.checkDue = e.state.time + 60; u.trouble = e.state.time;
    run(e, 1.5);
    expect(u.status).toBe('ON_SCENE');
    expect(inc.requires.find((x) => x.cap === 'patrol')!.n).toBeGreaterThanOrEqual(2);
  });

  it('the right public alert halves casualties, the wrong one adds to them, and phones light up', () => {
    const hurtWith = (kind: 'evacuate' | 'shelter' | null) => {
      const e = makeEngine(quiet, { rank: 7 });
      const inc = e.spawnIncident('gas_leak', 'downtown', { accuracy: 'exact' });
      answer(e, inc); locate(e, inc);
      if (kind) expect(e.issueAlert(inc.id, kind).ok).toBe(true);
      const before = inc.casualties;
      inc.threat = 100;
      run(e, 1);
      return { e, inc, hurt: inc.casualties - before };
    };
    const none = hurtWith(null), right = hurtWith('evacuate'), wrong = hurtWith('shelter');
    expect(right.hurt).toBeLessThan(none.hurt);
    expect(wrong.hurt).toBeGreaterThan(none.hurt);
    expect(right.inc.alert!.right).toBe(true);
    expect(right.e.state.stats.alertsRight).toBe(1);
    expect(right.e.issueAlert(right.inc.id, 'evacuate').ok).toBe(false);
    run(right.e, 60);
    expect(Object.values(right.e.state.incidents).filter((i) => i.templateId === 'alert_query').length).toBeGreaterThanOrEqual(2);
  });

  it('a needless alert costs reputation', () => {
    const e = makeEngine(quiet, { rank: 7 });
    const inc = e.spawnIncident('robbery', 'downtown', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    const rep = e.state.reputation;
    expect(e.issueAlert(inc.id, 'evacuate').ok).toBe(true);
    expect(e.state.reputation).toBeLessThan(rep);
    expect(inc.alert!.needed).toBe(false);
  });

  it('a missing-person search sweeps sectors until the person is found', () => {
    const e = makeEngine(quiet, { rank: 5 });
    const inc = e.spawnIncident('missing_person', 'westres', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    const S = inc.search!;
    expect(S).toBeTruthy();
    expect(S.sectors.length).toBeGreaterThanOrEqual(4);
    expect(Math.abs(S.sectors.reduce((a, x) => a + x.p, 0) - 100)).toBeLessThanOrEqual(3);
    expect(S.target).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < S.sectors.length; i++) e.assignSearch(inc.id, i);
    expect(inc.assignedUnits.length).toBeGreaterThan(0);
    run(e, 900, () => S.found);
    expect(S.found).toBe(true);
    expect(inc.reportedNode).toBe(S.sectors[S.target].node);
    expect(e.state.stats.searchFinds).toBe(1);
    run(e, 600, () => done(inc));
    expect(inc.status).toBe('RESOLVED');
  });

  it('a search drawn around the wrong place comes up empty until the location is fixed', () => {
    const e = makeEngine(quiet, { rank: 5 });
    const inc = e.spawnIncident('missing_person', 'westres', { accuracy: 'exact' });
    answer(e, inc);
    const truth = e.city.nodes[inc.nodeId];
    const far = e.city.nodes.filter((n) => Math.hypot(n.x - truth.x, n.y - truth.y) > 400 && ['westres', 'downtown'].includes(n.district))[0];
    e.setIncidentLocation(inc.id, far.id, 'map');
    expect(inc.search!.target).toBe(-1);
    for (const sec of inc.search!.sectors) sec.searched = 0.999;
    for (let i = 0; i < inc.search!.sectors.length; i++) e.assignSearch(inc.id, i);
    run(e, 400, () => !!inc.search!.exhausted);
    expect(inc.search!.exhausted).toBe(true);
    expect(inc.search!.found).toBe(false);
    e.setIncidentLocation(inc.id, inc.search!.origin, 'map');
    expect(inc.search!.target).toBeGreaterThanOrEqual(0);
    expect(inc.search!.sectors.every((x) => x.searched === 0)).toBe(true);
  });
});
