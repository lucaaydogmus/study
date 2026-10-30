import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { buildAiContext } from '../src/sim/aiContext';
import type { GameEngine } from '../src/sim/engine';

function answered(template: string, archetype = 'witness') {
  const e = makeEngine({ script: [{ at: 1, template, district: 'downtown', archetype, accuracy: 'exact' }] });
  run(e, 3);
  const call = Object.values(e.state.calls)[0];
  const inc = Object.values(e.state.incidents)[0];
  e.answerCall(call.id);
  run(e, 4);
  return { e, call, inc };
}

describe('pre-arrival instructions', () => {
  it('CPR on a cardiac arrest slows deterioration; without it the patient worsens faster', () => {
    const a = answered('cardiac_arrest'), b = answered('cardiac_arrest');
    a.e.ask(a.call.id, { intent: 'inst_cpr' });
    run(a.e, 5); run(b.e, 5);
    expect(a.inc.aid?.fit).toBe('good');
    expect(a.e.state.stats.aidGood).toBe(1);
    const t0a = a.inc.threat, t0b = b.inc.threat;
    run(a.e, 40); run(b.e, 40);
    expect(a.inc.threat - t0a).toBeLessThan((b.inc.threat - t0b) * 0.6);
  });
  it('the wrong instruction is noticed and makes things worse', () => {
    const { e, call, inc } = answered('fall_elderly', 'worried_neighbor');
    e.ask(call.id, { intent: 'inst_cpr' });
    run(e, 6);
    expect(inc.aid?.fit).toBe('bad');
    expect(e.aidFactor(inc)).toBeGreaterThan(1);
    expect(call.transcript.some((l) => /awake|talking/i.test(l.text))).toBe(true);
  });
  it('a background clue is heard when the call connects', () => {
    const { call } = answered('kitchen_fire');
    expect(call.transcript.some((l) => l.who === 'SYSTEM' && /alarm|crackling/i.test(l.text))).toBe(true);
  });
});

describe('response codes', () => {
  it('Code 2 is slower than Code 3', () => {
    const eta = (code: 2 | 3) => {
      const { e, inc } = answered('collision_minor', 'angry_motorist');
      e.setIncidentLocation(inc.id, inc.nodeId, 'candidate');
      const u = Object.values(e.state.units).filter((x) => x.capabilities.includes('patrol') && x.status === 'AVAILABLE')[0];
      e.dispatch(u.id, inc.id, { code });
      run(e, 15, () => u.status === 'EN_ROUTE');
      run(e, 2);
      return u.eta ?? 0;
    };
    expect(eta(2)).toBeGreaterThan(eta(3));
  });
  it('the response planner covers the suggested capabilities with free units', () => {
    const { e, inc } = answered('collision_injury', 'witness');
    e.setIncidentLocation(inc.id, inc.nodeId, 'candidate');
    const plan = e.buildPlan(inc.id, [{ cap: 'patrol', n: 1 }, { cap: 'bls', n: 1 }, { cap: 'transport', n: 1 }]);
    const caps = new Set(plan.units.flatMap((x) => x.unit.capabilities));
    expect(caps.has('patrol') && caps.has('bls') && caps.has('transport')).toBe(true);
    expect(plan.units.length).toBeLessThanOrEqual(3);
  });
});

describe('AI voicing hooks', () => {
  function aiEngine(template = 'kitchen_fire') {
    const r = answered(template);
    r.e.state.flags.ai = true;
    const reqs: Array<{ lineIds: number[]; intent: string }> = [];
    r.e.on((ev) => { if (ev.type === 'ai_request') reqs.push({ lineIds: ev.lineIds, intent: ev.intent }); });
    return { ...r, reqs };
  }
  it('holds the reply until the AI line arrives, then applies only engine-approved facts', () => {
    const { e, call, inc, reqs } = aiEngine();
    const before = call.transcript.length;
    e.ask(call.id, { intent: 'trapped' });
    run(e, 10);
    expect(call.transcript.length).toBe(before + 1); // only the dispatcher's line so far
    expect(reqs.length).toBe(1);
    expect(e.voiceLines(call.id, reqs[0].lineIds, 'Nobody is stuck, we all got out.', { calm: 2, coop: 1 })).toBe(true);
    run(e, 2);
    expect(call.transcript.at(-1)?.text).toBe('Nobody is stuck, we all got out.');
    expect(inc.facts.some((f) => f.key === 'trapped')).toBe(true);
  });
  it('falls back to the scripted line when released, and ignores unknown reveal keys', () => {
    const { e, call, inc, reqs } = aiEngine();
    e.ask(call.id, { text: 'blue banana question' });
    e.releaseLines(call.id, reqs[0].lineIds);
    run(e, 3);
    expect(call.transcript.at(-1)?.who).toBe('CALLER');
    e.ask(call.id, { text: 'zzz' });
    const ok = e.voiceLines(call.id, reqs[1].lineIds, 'Hmm.', { reveal: ['launch_codes', 'injuries'] });
    expect(ok).toBe(true);
    run(e, 2);
    expect(inc.facts.some((f) => f.key === 'injured')).toBe(true);
    expect(inc.facts.some((f) => f.key === 'launch_codes')).toBe(false);
  });
  it('the AI context never contains hidden twists', () => {
    const { e, call } = aiEngine('animal_burglar');
    e.ask(call.id, { intent: 'address' });
    const req = (e as GameEngine).state.calls[call.id].pending.find((l) => l.hold)!;
    const ctx = buildAiContext(e, call.id, [req.id!], 'address', 'Where are you?');
    expect(JSON.stringify(ctx).toLowerCase()).not.toContain('raccoon');
    expect(ctx.mustSay.length).toBe(1);
  });
});

describe('local AI server', () => {
  it('works in mock mode without a key and never echoes the key', async () => {
    process.env.AI_MOCK = '1';
    const ai = await import('../server/ai');
    const s = ai.status();
    expect(s.configured).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/sk-ant/);
    const r = await ai.generateLine({ mustSay: ['There is smoke.'] });
    expect(r.reply).toContain('There is smoke.');
  });
});
