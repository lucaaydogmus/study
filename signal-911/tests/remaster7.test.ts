import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { isAir } from '../src/sim/fleet';
import type { GameEngine } from '../src/sim/engine';
import type { Call, Incident } from '../src/sim/types';

const quiet = { script: [] as never[] };
const start = (e: GameEngine, tpl: string, district = 'westres', archetype?: string): { inc: Incident; call: Call } => {
  const inc = e.spawnIncident(tpl, district, { accuracy: 'exact', archetype });
  e.answerCall(inc.callId!);
  e.setIncidentLocation(inc.id, inc.nodeId, 'candidate');
  return { inc, call: e.state.calls[inc.callId!] };
};
const waitQuestion = (e: GameEngine, call: Call, secs = 120) => run(e, secs, () => !!call.question);

describe('remaster 7: interactive calls', () => {
  it('a fire caller asks whether to go back in; telling them to stay out is safe', () => {
    const e = makeEngine(quiet);
    const { inc, call } = start(e, 'kitchen_fire');
    waitQuestion(e, call);
    expect(call.question?.kind).toBe('goback');
    const line = call.transcript[call.question!.lineIdx];
    expect(line.who).toBe('CALLER');
    expect(e.answerCaller(call.id, 'stay').ok).toBe(true);
    expect(call.question).toBeNull();
    expect(call.transcript.some((l) => l.who === 'DISPATCHER' && /Do not go back inside/.test(l.text))).toBe(true);
    expect(inc.aid?.kind).toBe('evacuate');
    expect(e.state.stats.harmfulAdvice).toBe(0);
    expect(e.answerCaller(call.id, 'stay').ok).toBe(false);
  });

  it('telling the caller to go back in gets them hurt', () => {
    const e = makeEngine(quiet);
    const { inc, call } = start(e, 'kitchen_fire');
    waitQuestion(e, call);
    e.answerCaller(call.id, 'go');
    expect(e.state.stats.harmfulAdvice).toBe(1);
    expect(inc.requires.some((r) => r.cap === 'rescue')).toBe(true);
    expect(inc.consequences?.some((c) => /back into the fire/.test(c))).toBe(true);
  });

  it('an unanswered question is decided by the caller, and calm callers stay safe', () => {
    const e = makeEngine(quiet);
    const { call } = start(e, 'kitchen_fire');
    call.profile.cooperationLevel = 90;
    run(e, 9);
    call.mood.panic = 5; call.mood.base = 5;
    waitQuestion(e, call);
    expect(call.question).toBeTruthy();
    run(e, 30);
    expect(call.question).toBeNull();
    expect(e.state.stats.harmfulAdvice).toBe(0);
  });

  it('"any second now" backfires when help is minutes away', () => {
    const e = makeEngine(quiet);
    const { inc, call } = start(e, 'fall_elderly');
    call.questionsAsked = ['water', 'lift', 'snore', 'vomit', 'seizure', 'waking', 'bleed'];
    // the furthest ambulance, so help is genuinely a while away
    const amb = Object.values(e.state.units).filter((u) => u.capabilities.includes('transport') && !isAir(u)).sort((a, b) => (e.estimate(b.id, inc.nodeId)?.eta ?? 0) - (e.estimate(a.id, inc.nodeId)?.eta ?? 0))[0];
    e.dispatch(amb.id, inc.id);
    waitQuestion(e, call);
    expect(call.question?.kind).toBe('eta');
    const trust = call.mood.trust;
    e.answerCaller(call.id, 'soon');
    expect(call.overpromiseAt).not.toBeNull();
    run(e, 42);
    expect(e.onScene(inc).length).toBe(0);
    expect(call.mood.trust).toBeLessThan(trust);
    expect(call.transcript.some((l) => l.who === 'CALLER' && /any second|ages|close/.test(l.text))).toBe(true);
  });

  it('once the crew is there, the caller can be let go to meet them', () => {
    const e = makeEngine(quiet);
    const { inc, call } = start(e, 'collision_minor', 'downtown');
    const cop = Object.values(e.state.units).find((u) => u.capabilities.includes('patrol') && !isAir(u))!;
    e.dispatch(cop.id, inc.id);
    run(e, 300, () => cop.status === 'ON_SCENE');
    call.questionsAsked = ['eta'];
    waitQuestion(e, call);
    expect(call.question?.kind).toBe('hangup');
    e.answerCaller(call.id, 'go');
    run(e, 8);
    expect(call.state).toBe('ended');
    expect(call.endReason).toBe('handover');
    expect(e.state.stats.handoffs).toBe(1);
  });

  it('counting compressions on the beat slows the patient’s decline', () => {
    const survival = (paced: boolean) => {
      const e = makeEngine(quiet);
      const { inc, call } = start(e, 'cardiac_arrest', 'westres', 'witness');
      run(e, 3);
      e.ask(call.id, { intent: 'breathing' });
      e.ask(call.id, { intent: 'inst_cpr' });
      run(e, 4);
      expect(inc.aid?.kind).toBe('cpr');
      call.questionsAsked = ['water', 'lift', 'eta', 'hangup', 'donthang', 'reassure'];
      for (let t = 0; t < 80; t += 2) {
        if (paced) expect(e.cprPace(call.id, 110).tempo).toBe('good');
        run(e, 2);
      }
      return inc.survival ?? 0;
    };
    const paced = survival(true), unpaced = survival(false);
    expect(paced).toBeGreaterThan(unpaced + 3);
  });

  it('pace feedback tells the dispatcher when the count is off', () => {
    const e = makeEngine(quiet);
    const { call } = start(e, 'cardiac_arrest', 'westres', 'witness');
    expect(e.cprPace(call.id, 110).ok).toBe(false);
    run(e, 3);
    e.ask(call.id, { intent: 'breathing' });
    e.ask(call.id, { intent: 'inst_cpr' });
    run(e, 4);
    expect(e.cprPace(call.id, 70).tempo).toBe('slow');
    expect(e.cprPace(call.id, 150).tempo).toBe('fast');
    expect(e.cprPace(call.id, 112).tempo).toBe('good');
  });
});
