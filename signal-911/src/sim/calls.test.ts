import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './incidents';
import { PERSONALITIES, questionsFor, scriptFor, type Personality } from './dialogueData';
import { answerCall, createWorld, dispatch, shownSeverity, step, type Call, type Incident, type World } from './world';
import { ask, endCall, questionStates, applyCaps } from './calls';

const cfg = { seed: 3, shiftMinutes: 10, difficulty: 'normal', weather: 'clear' } as const;
const sorted = (a: string[]) => [...a].sort().join();

/** Build a call/incident with a chosen scenario so each path can be tested directly. */
function scenario(over: Partial<Call['spec']>, seed = 3): { w: World; inc: Incident } {
  const w = createWorld({ ...cfg, seed });
  while (!w.calls.length) step(w, 0.5);
  const call = w.calls[0];
  const tpl = TEMPLATES.find((t) => t.id === (over.templateId ?? call.spec.templateId))!;
  const v = tpl.variations.find((x) => x.id === (over.variationId ?? tpl.variations[0].id))!;
  const n = w.city.nodes[call.spec.nodeId];
  call.spec = {
    ...call.spec, templateId: tpl.id, variationId: v.id, perceivedVariationId: v.id, district: n.district, twist: 'none',
    personality: 'calm', wrongNodeId: null, wrongAddress: null, ...over,
  };
  const inc = answerCall(w, call.id)!;
  return { w, inc };
}
function say(w: World, inc: Incident, key: string) {
  expect(ask(w, inc, key)).toBe(true);
  for (let i = 0; i < 60 && inc.session?.pending; i++) step(w, 0.5);
}

describe('dialogue data', () => {
  it('every variation has a script, and asking all questions reveals the truth', () => {
    for (const t of TEMPLATES) for (const v of t.variations) for (const p of t.variations) {
      const script = scriptFor(t.id, p.id);
      expect(script, `${t.id}.${p.id}`).toBeDefined();
      // start from perceived (p) hints, then settle with the truth (v) answers
      let caps = [...scriptFor(t.id, p.id).hint];
      let sev = p.severity;
      const truth = scriptFor(t.id, v.id);
      for (const q of questionsFor(t.id)) {
        const a = truth.answers[q.key];
        if (!a) continue;
        caps = applyCaps(caps, a.caps, a.settles);
        if (a.sev !== undefined) sev = a.sev;
      }
      expect(sorted(caps), `${t.id}: perceived ${p.id}, truth ${v.id}`).toBe(sorted(v.caps));
      expect(sev, `${t.id}: severity perceived ${p.id}, truth ${v.id}`).toBe(v.severity);
    }
  });
});

describe('conversation flow', () => {
  it('location stays unknown until asked; dispatch is refused until then', () => {
    const { w, inc } = scenario({ personality: 'uncooperative' });
    inc.believedNode = null; inc.address = 'Unknown';
    const r = dispatch(w, inc.id, [w.units[0].id]);
    expect(r.sent).toBe(0); expect(r.error).toMatch(/Location unknown/);
  });

  it('asking the address gives notes and a classification; a calm caller is reliable', () => {
    const { w, inc } = scenario({ templateId: 'collision', variationId: 'injured' });
    if (inc.believedNode === null) say(w, inc, 'ADDRESS');
    expect(inc.believedNode).toBe(inc.nodeId);
    say(w, inc, 'INJURIES');
    expect(inc.believed.caps).toContain('MEDICAL');
    expect(inc.notes.some((n) => n.kind === 'confirmed' && /injured/i.test(n.text))).toBe(true);
    expect(inc.transcript.length).toBeGreaterThan(3);
  });

  it('a wrong address misleads units until corrected, and the incident can still be resolved', () => {
    const { w, inc } = scenario({ templateId: 'disturbance', variationId: 'burglary', twist: 'wrong_location' });
    const spec = inc.session!.spec;
    spec.wrongNodeId = w.city.nodesByDistrict[inc.district].find((id) => id !== inc.nodeId && Math.hypot(w.city.nodes[id].x - w.city.nodes[inc.nodeId].x, w.city.nodes[id].y - w.city.nodes[inc.nodeId].y) > 110)!;
    spec.wrongAddress = '999 Nowhere St';
    inc.believedNode = null;
    say(w, inc, 'ADDRESS');
    expect(inc.believedNode).toBe(spec.wrongNodeId);
    expect(inc.notes.at(-1)!.kind).toBe('unconfirmed');
    endCall(w, inc, 'player');
    const amb = w.units.find((u) => u.vehicle === 'patrol')!;
    expect(dispatch(w, inc.id, [amb.id]).sent).toBe(1);
    for (let i = 0; i < 600 && amb.status !== 'ON SCENE'; i++) step(w, 0.5);
    expect(amb.wrongSite).toBe(true);
    expect(inc.status).not.toBe('STABILIZING'); // a unit at the wrong address does not work the scene
    for (let i = 0; i < 100 && inc.believedNode !== inc.nodeId; i++) step(w, 0.5);
    expect(inc.believedNode).toBe(inc.nodeId);
    // The delay may escalate the incident; respond to what it now needs.
    for (let i = 0; i < 1200 && inc.status !== 'RESOLVED' && inc.status !== 'FAILED'; i++) {
      step(w, 0.5);
      if (inc.required.includes('MEDICAL') && !w.units.some((u) => u.vehicle === 'ambulance' && u.incidentId === inc.id)) {
        dispatch(w, inc.id, [w.units.find((u) => u.vehicle === 'ambulance' && u.status === 'AVAILABLE')!.id]);
      }
    }
    expect(inc.status).toBe('RESOLVED');
  });

  it('confirming the address corrects a wrong one immediately', () => {
    const { w, inc } = scenario({ templateId: 'fire', variationId: 'small', twist: 'wrong_location', personality: 'calm' });
    inc.session!.spec.wrongNodeId = w.city.nodesByDistrict[inc.district].find((id) => id !== inc.nodeId)!;
    inc.session!.spec.wrongAddress = '1 Wrong Way';
    inc.believedNode = null;
    say(w, inc, 'ADDRESS');
    say(w, inc, 'CONFIRM');
    expect(inc.believedNode).toBe(inc.nodeId);
    expect(inc.addrConfirmed).toBe(true);
  });

  it('a harmless-looking call that is serious conflicts with the first impression once asked', () => {
    const { w, inc } = scenario({ templateId: 'collision', variationId: 'injured', perceivedVariationId: 'minor', twist: 'worse' });
    expect(inc.believed.caps).toEqual(['TRAFFIC']);
    if (inc.believedNode === null) say(w, inc, 'ADDRESS');
    say(w, inc, 'INJURIES');
    expect(inc.believed.caps).toContain('MEDICAL');
    expect(inc.notes.some((n) => n.kind === 'warning' && /conflicts/i.test(n.text))).toBe(true);
  });

  it('a serious-looking call that is mild can be downgraded', () => {
    const { w, inc } = scenario({ templateId: 'collision', variationId: 'minor', perceivedVariationId: 'multi', twist: 'milder' });
    expect(shownSeverity(inc)).toBe(3);
    if (inc.believedNode === null) say(w, inc, 'ADDRESS');
    say(w, inc, 'INJURIES');
    expect(inc.believed.caps).not.toContain('MEDICAL');
    expect(shownSeverity(inc)).toBe(1);
  });

  it('a disconnect ends the call but leaves a usable approximate location and a call-back fix', () => {
    const { w, inc } = scenario({ templateId: 'fire', variationId: 'small', twist: 'disconnect', discAfter: 2 });
    inc.believedNode = null; inc.address = 'Unknown';
    say(w, inc, 'DESCRIBE');
    say(w, inc, 'DANGER');
    expect(inc.session).toBeNull();
    expect(w.activeCall).toBeNull();
    expect(inc.notes.some((n) => /disconnected/i.test(n.text))).toBe(true);
    expect(inc.believedNode).not.toBeNull();
    for (let i = 0; i < 200 && inc.believedNode !== inc.nodeId; i++) step(w, 0.5);
    expect(inc.believedNode).toBe(inc.nodeId);
  });

  it('a caller eventually hangs up when pushed, and an uncooperative caller answers on the second ask', () => {
    const { w, inc } = scenario({ templateId: 'fire', variationId: 'small', personality: 'angry' });
    for (let i = 0; i < 8 && inc.session; i++) {
      const next = questionStates(inc).find((v) => v.state !== 'done');
      if (!next) break;
      ask(w, inc, next.q.key);
      for (let k = 0; k < 40 && inc.session?.pending; k++) step(w, 0.5);
    }
    expect(inc.session).toBeNull();
    expect(inc.notes.some((n) => /hung up|disconnected/i.test(n.text))).toBe(true);

    const u = scenario({ templateId: 'fire', variationId: 'small', personality: 'uncooperative' }, 11);
    for (let i = 0; i < 3 && u.inc.session; i++) {
      if (u.inc.believedNode !== null) break;
      say(u.w, u.inc, 'ADDRESS');
    }
    expect(u.inc.believedNode).not.toBeNull(); // never stuck: at most one deflection per question
  });

  it('every call can always be completed, whatever the personality, twist or player choices', () => {
    const personalities = Object.keys(PERSONALITIES) as Personality[];
    let n = 0;
    for (const personality of personalities) for (const twist of ['none', 'wrong_location', 'milder', 'worse', 'disconnect'] as const) {
      const variationId = twist === 'milder' ? 'minor' : 'injured';
      const perceivedVariationId = twist === 'milder' ? 'multi' : twist === 'worse' ? 'minor' : variationId;
      const { w, inc } = scenario({ templateId: 'collision', variationId, perceivedVariationId, twist, personality, discAfter: 3 }, 20 + n++);
      if (twist === 'wrong_location') { inc.session!.spec.wrongNodeId = w.city.nodesByDistrict[inc.district].find((id) => id !== inc.nodeId)!; inc.session!.spec.wrongAddress = '5 Bad Rd'; }
      for (let i = 0; i < 12 && inc.session; i++) {
        const choices = questionStates(inc).filter((v) => v.state !== 'done');
        if (!choices.length) break;
        const pick = choices[(i * 7 + n) % choices.length];
        ask(w, inc, pick.q.key);
        for (let k = 0; k < 40 && inc.session?.pending; k++) step(w, 0.5);
      }
      if (inc.session) endCall(w, inc, 'player');
      expect(w.activeCall).toBeNull();
      expect(inc.believedNode, `${personality}/${twist}`).not.toBeNull();
      for (let i = 0; i < 400 && inc.believedNode !== inc.nodeId; i++) step(w, 0.5);
      expect(inc.believedNode, `${personality}/${twist} location is eventually correct`).toBe(inc.nodeId);
    }
  });

  it('only one call can be active at a time', () => {
    const w = createWorld(cfg);
    while (!w.calls.length) step(w, 1);
    w.calls.push({ ...w.calls[0], id: 99, status: 'ringing' });
    const first = answerCall(w, w.calls[0].id);
    expect(first).not.toBeNull();
    expect(answerCall(w, w.calls[1].id)).toBeNull();
    endCall(w, first!, 'player');
    expect(answerCall(w, w.calls[1].id)).not.toBeNull();
  });
});
