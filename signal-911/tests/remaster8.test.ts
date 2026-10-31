import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { isAir } from '../src/sim/fleet';
import { assistsOn, type GameEngine } from '../src/sim/engine';
import type { Call, Incident } from '../src/sim/types';

const quiet = { script: [] as never[] };
const start = (e: GameEngine, tpl: string, district = 'westres', archetype?: string): { inc: Incident; call: Call } => {
  const inc = e.spawnIncident(tpl, district, { accuracy: 'exact', archetype });
  e.answerCall(inc.callId!);
  e.setIncidentLocation(inc.id, inc.nodeId, 'candidate');
  return { inc, call: e.state.calls[inc.callId!] };
};
/** the slowest suitable unit, so help is a good while away */
const farthest = (e: GameEngine, inc: Incident, cap: string) => Object.values(e.state.units).filter((u) => u.capabilities.includes(cap as never) && !isAir(u) && u.status === 'AVAILABLE')
  .sort((a, b) => (e.estimate(b.id, inc.nodeId)?.eta ?? 0) - (e.estimate(a.id, inc.nodeId)?.eta ?? 0))[0];
const noQuestions = (call: Call) => { call.questionCount = 99; };

describe('remaster 8: keeping the caller together', () => {
  it('silence while help is on the way drains composure; talking them through it keeps them steady', () => {
    const panicAfter = (talk: boolean) => {
      const e = makeEngine(quiet);
      const { inc, call } = start(e, 'fall_elderly', 'westres', 'worried_neighbor');
      noQuestions(call);
      e.dispatch(farthest(e, inc, 'transport').id, inc.id);
      run(e, 4);
      for (let i = 0; i < 6; i++) {
        if (talk) e.calmCaller(call.id, (['reassure', 'ground', 'update'] as const)[i % 3]);
        run(e, 10);
      }
      return { panic: call.mood.panic, lines: call.transcript.filter((l) => l.who === 'CALLER').length };
    };
    const silent = panicAfter(false), talked = panicAfter(true);
    expect(silent.panic).toBeGreaterThan(talked.panic + 10);
  });

  it('the right technique depends on who is on the line, and repeating it wears thin', () => {
    const e = makeEngine(quiet);
    const { call } = start(e, 'fall_elderly', 'westres', 'worried_neighbor');
    run(e, 3);
    call.mood.panic = 88; call.mood.frustration = 10;
    expect(e.callerState(call)).toBe('panicked');
    const firm = e.calmCaller(call.id, 'firm');
    expect(firm.eff!).toBeGreaterThan(0.5);
    expect(firm.d!).toBeGreaterThan(5);
    run(e, 6);
    call.mood.panic = 88;
    const again = e.calmCaller(call.id, 'firm');
    expect(again.eff!).toBeLessThan(firm.eff!);
    // an angry caller does not want to be told to calm down
    call.mood.panic = 35; call.mood.frustration = 75;
    expect(e.callerState(call)).toBe('angry');
    run(e, 6);
    expect(e.calmCaller(call.id, 'acknowledge').eff!).toBeGreaterThan(0.5);
    run(e, 6);
    const before = call.mood.panic;
    expect(e.calmCaller(call.id, 'firm').eff!).toBeLessThan(0);
    expect(call.mood.panic).toBeGreaterThan(before);
  });

  it('a caller left at breaking point falls apart', () => {
    const e = makeEngine(quiet);
    const { inc, call } = start(e, 'fall_elderly', 'westres', 'panicked_parent');
    noQuestions(call);
    e.dispatch(farthest(e, inc, 'transport').id, inc.id);
    call.mood.panic = 99; call.mood.base = 100;
    run(e, 16);
    expect(call.brokeDown).toBe(true);
    expect(e.state.stats.callerBreakdowns).toBe(1);
  });

  it('jobs keep the caller busy and help the crews', () => {
    const e = makeEngine(quiet);
    const { inc, call } = start(e, 'fall_elderly', 'westres', 'worried_neighbor');
    run(e, 3);
    const ids = e.callTasks(call.id).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['pets', 'light', 'unlock']));
    expect(e.assignTask(call.id, 'pets').ok).toBe(true);
    expect(e.assignTask(call.id, 'light').ok).toBe(false);
    run(e, 12);
    expect(inc.petsSecured).toBe(true);
    expect(e.callTasks(call.id).find((t) => t.id === 'pets')?.status).toBe('done');
    expect(e.assignTask(call.id, 'light').ok).toBe(true);
    run(e, 9);
    expect(inc.guided).toBe(true);
    expect(e.state.stats.tasksDone).toBe(2);
  });

  it('opening the door to an intruder is a dangerous job; describing him is a useful one', () => {
    const e = makeEngine(quiet, { rank: 5 });
    const { inc, call } = start(e, 'burglary_progress', 'westres');
    run(e, 3);
    inc.facts = inc.facts.filter((f) => f.key !== 'suspect_desc');
    expect(e.assignTask(call.id, 'describe').ok).toBe(true);
    run(e, 12);
    expect(inc.facts.some((f) => f.key === 'suspect_desc')).toBe(true);
    expect(e.boloInfo(inc.id).ok).toBe(true);
    expect(e.assignTask(call.id, 'unlock').ok).toBe(true);
    run(e, 12);
    expect(e.state.stats.harmfulAdvice).toBe(1);
  });

  it('callers do not know they have been dispatched until the dispatcher tells them', () => {
    const e = makeEngine(quiet);
    const { inc, call } = start(e, 'kitchen_fire', 'downtown');
    noQuestions(call);
    run(e, 6);
    const before = call.transcript.length;
    for (const u of Object.values(e.state.units).filter((x) => x.service === 'fire').slice(0, 2)) e.dispatch(u.id, inc.id);
    run(e, 5);
    expect(call.transcript.slice(before).some((l) => l.who === 'CALLER' && /thank god|thank you|watch for them|how long will they be/i.test(l.text))).toBe(false);
  });

  it('non-emergency calls can be sent to the non-emergency line; real emergencies cannot', () => {
    const e = makeEngine(quiet);
    const a = start(e, 'noise_complaint', 'westres');
    run(e, 3);
    expect(e.redirectCall(a.call.id).good).toBe(true);
    expect(['RESOLVED', 'CLOSED']).toContain(a.inc.status);
    expect(a.call.state).toBe('ended');
    expect(e.state.stats.redirectsOk).toBe(1);
    const b = start(e, 'kitchen_fire', 'downtown');
    run(e, 3);
    expect(e.redirectCall(b.call.id).good).toBe(false);
    expect(b.inc.hidden).toBe(true);
    expect(b.inc.callbackAt).not.toBeNull();
    expect(e.state.stats.redirectsBad).toBe(1);
  });

  it('a firefighter MAYDAY needs a rescue team, and a PAR check can catch trouble first', () => {
    const e = makeEngine(quiet, { rank: 7 });
    const { inc } = start(e, 'apartment_fire', 'downtown');
    const eng = Object.values(e.state.units).find((u) => u.service === 'fire' && !isAir(u))!;
    e.dispatch(eng.id, inc.id);
    run(e, 300, () => eng.status === 'ON_SCENE');
    expect(eng.checkDue).toBeGreaterThan(e.state.time);
    eng.trouble = e.state.time + 15;
    const par = e.statusCheck(eng.id);
    expect(par.trouble).toBe(true);
    expect(inc.requires.find((r) => r.cap === 'fire_suppression')!.n).toBeGreaterThanOrEqual(2);
    // and when nobody checks: a MAYDAY
    eng.checkDue = e.state.time - 5; eng.trouble = e.state.time;
    run(e, 1.5);
    const d = e.state.decisions!.find((x) => x.kind === 'mayday')!;
    expect(d).toBeDefined();
    expect(inc.maydayLate).toBe(true);
    const orig = e.rng.chance; e.rng.chance = () => true;
    expect(e.decide(d.id, 'rit').ok).toBe(true);
    e.rng.chance = orig;
    expect(e.state.stats.maydaySaved).toBe(1);
  });

  it('a patient who signs a refusal may collapse later', () => {
    const e = makeEngine(quiet);
    const { inc } = start(e, 'fall_elderly', 'westres');
    const amb = Object.values(e.state.units).find((u) => u.capabilities.includes('transport'))!;
    e.dispatch(amb.id, inc.id);
    run(e, 300, () => amb.status === 'ON_SCENE');
    inc.decided = true;
    (e.state.decisions ??= []).push({ id: 'dr', incId: inc.id, unitId: amb.id, at: e.state.time, expiresAt: e.state.time + 25, kind: 'refusal', prompt: 'refusing', options: [{ id: 'persuade', label: 'p', hint: '' }, { id: 'sign', label: 's', hint: '' }, { id: 'police', label: 'o', hint: '' }], defaultId: 'persuade' });
    const orig = e.rng.chance; e.rng.chance = () => true;
    e.decide('dr', 'sign');
    e.rng.chance = orig;
    expect(inc.needsTransport).toBe(false);
    run(e, 150);
    expect(Object.values(e.state.incidents).some((i) => i.label === 'Collapsed after refusing care')).toBe(true);
  });

  it('hard mode switches the assists off', () => {
    expect(assistsOn(makeEngine({ ...quiet, difficulty: 'standard' }).state)).toBe(true);
    expect(assistsOn(makeEngine({ ...quiet, difficulty: 'hard' }).state)).toBe(false);
    expect(assistsOn(makeEngine({ ...quiet, difficulty: 'expert' }).state)).toBe(false);
  });

  it('crews ask for information on the way in; relaying the truth helps, a wrong "no weapons" puts officers at risk', () => {
    const e = makeEngine({ script: undefined, incidentRate: 0.0001 }, { rank: 5 });
    const { inc } = start(e, 'robbery', 'downtown');
    const cop = farthest(e, inc, 'patrol');
    e.dispatch(cop.id, inc.id);
    // the crew always has a question in these tests
    const h = (e as unknown as { hrand: (a: number, b: number) => number });
    const orig = h.hrand; h.hrand = () => 0;
    run(e, 120, () => (e.state.unitQueries ?? []).some((q) => q.incId === inc.id));
    h.hrand = orig;
    const q = e.state.unitQueries!.find((x) => x.incId === inc.id)!;
    expect(q).toBeDefined();
    expect(q.status).toBe('open');
    if (q.key === 'weapon') {
      expect(e.answerUnitQuery(q.id, 'deny').correct).toBe(false);
      expect(inc.weaponMissed).toBe(true);
    } else {
      expect(e.answerUnitQuery(q.id, 'standby').ok).toBe(true);
      expect(q.status).toBe('standby');
      e.addFact(inc, q.key, inc.truth[q.key] as never, 'confirmed', 'caller');
      expect(e.answerUnitQuery(q.id, 'relay').correct).toBe(true);
    }
    expect(e.answerUnitQuery(q.id, 'relay').ok).toBe(false);
  });

  it('an unanswered crew question expires and they go in blind', () => {
    const e = makeEngine({ script: undefined, incidentRate: 0.0001 }, { rank: 5 });
    const { inc } = start(e, 'kitchen_fire', 'downtown');
    const eng = farthest(e, inc, 'fire_suppression');
    e.dispatch(eng.id, inc.id);
    // the crew always has a question in these tests
    const h = (e as unknown as { hrand: (a: number, b: number) => number });
    const orig = h.hrand; h.hrand = () => 0;
    run(e, 120, () => (e.state.unitQueries ?? []).some((q) => q.incId === inc.id));
    h.hrand = orig;
    const q = e.state.unitQueries!.find((x) => x.incId === inc.id)!;
    run(e, 44); // answers are typed on the radio now, so crews wait a little longer
    expect(q.status).toBe('expired');
    expect(e.state.stats.unitQueriesMissed).toBe(1);
  });

  it('listening to the line picks up where the caller really is', () => {
    const e = makeEngine(quiet, { rank: 7 });
    const { call } = start(e, 'kitchen_fire', 'downtown');
    run(e, 2);
    const env = e.soundscape(call.id);
    expect(env.length).toBeGreaterThan(0);
    const r = e.listen(call.id);
    expect(r.ok).toBe(true);
    expect(r.kinds!.length).toBeGreaterThan(0);
    expect(call.transcript.some((l) => l.who === 'SYSTEM' && l.text.startsWith('You listen closely'))).toBe(true);
    expect(e.listen(call.id).ok).toBe(false);
    expect(call.heardSounds!.length).toBeGreaterThan(0);
  });

  it('the escalation forecast says what happens next and stops rising once crews have it', () => {
    const e = makeEngine(quiet);
    const { inc } = start(e, 'kitchen_fire', 'downtown');
    const f = e.escalationForecast(inc.id);
    expect(f.next).toBeTruthy();
    expect(f.rising).toBe(true);
    expect(f.eta).toBeGreaterThan(0);
    for (const u of Object.values(e.state.units).filter((x) => x.service === 'fire').slice(0, 2)) e.dispatch(u.id, inc.id);
    run(e, 400, () => e.onScene(inc).length >= 2);
    expect(e.escalationForecast(inc.id).rising).toBe(false);
  });
});
