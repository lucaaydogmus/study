import { describe, expect, it } from 'vitest';
import { answerCall, createWorld, currentRisk, decide, decisionOptions, dispatch, optionBlocked, step, type Incident, type World } from './world';
import { endCall } from './calls';
import { isConnected } from './pathfinding';
import { DECISIONS } from './decisions';

const cfg = { seed: 4, shiftMinutes: 10, difficulty: 'normal', weather: 'clear' } as const;

/** An incident with known address, ready for units, in a chosen family. */
function incident(templateId: string, variationId: string, seed = 4): { w: World; inc: Incident } {
  const w = createWorld({ ...cfg, seed });
  while (!w.calls.length) step(w, 0.5);
  const call = w.calls[0];
  const n = w.city.nodes[call.spec.nodeId];
  call.spec = { ...call.spec, templateId, variationId, perceivedVariationId: variationId, district: n.district, twist: 'none', personality: 'calm', wrongNodeId: null, wrongAddress: null };
  const inc = answerCall(w, call.id)!;
  inc.believedNode = inc.nodeId; inc.address = inc.trueAddress; inc.x = n.x; inc.y = n.y; inc.addrConfirmed = true;
  endCall(w, inc, 'player');
  return { w, inc };
}
const run = (w: World, until: () => boolean, max = 1500) => { for (let i = 0; i < max && !until(); i++) step(w, 0.5); };
const free = (w: World, vehicle: string) => w.units.find((u) => u.vehicle === vehicle && u.status === 'AVAILABLE')!;

describe('on-scene decisions', () => {
  it('are offered only when the variation calls for one, and lapse into "continue"', () => {
    const none = incident('collision', 'minor');
    dispatch(none.w, none.inc.id, [free(none.w, 'patrol').id]);
    run(none.w, () => none.inc.truthKnown);
    expect(none.inc.truthKnown).toBe(true);
    expect(none.inc.decision).toBeNull(); // minor collision: nothing to decide
    expect(none.inc.decided).toBe(true);

    const { w, inc } = incident('fire', 'trapped');
    dispatch(w, inc.id, [free(w, 'engine').id, free(w, 'rescue').id, free(w, 'ambulance').id]);
    run(w, () => !!inc.decision);
    expect(inc.decision).not.toBeNull();
    const t = inc.decision!.expiresAt;
    run(w, () => w.time > t + 1);
    expect(inc.decision).toBeNull();
    expect(inc.notes.some((n) => /No decision made/.test(n.text))).toBe(true);
    expect(inc.mods).toHaveLength(0);
  });

  it('a requested unit starts helping only when it arrives, and it is not counted as unnecessary', () => {
    const { w, inc } = incident('fire', 'trapped');
    dispatch(w, inc.id, [free(w, 'engine').id, free(w, 'rescue').id, free(w, 'ambulance').id]);
    run(w, () => !!inc.decision);
    const before = w.stats.unnecessary;
    expect(decide(w, inc.id, 'perimeter').ok).toBe(true);
    const unit = w.units.find((u) => u.incidentId === inc.id && u.vehicle !== 'engine' && u.vehicle !== 'rescue' && u.vehicle !== 'ambulance')!;
    expect(unit.caps).toContain('LAW');
    expect(w.stats.unnecessary).toBe(before);
    const risk0 = currentRisk(w, inc);
    run(w, () => unit.status === 'ON SCENE');
    expect(currentRisk(w, inc)).toBeLessThan(risk0 + 1e-9);
    expect(currentRisk(w, inc)).toBeLessThan(inc.risk); // active once the unit is there
    expect(inc.decision).toBeNull();
    expect(decide(w, inc.id, 'continue').ok).toBe(false); // one decision only
  });

  it('options explain why they are unavailable; supervisors are limited', () => {
    const { w, inc } = incident('fire', 'trapped');
    dispatch(w, inc.id, [free(w, 'engine').id]);
    run(w, () => !!inc.decision);
    const rescueEq = decisionOptions(inc).find((o) => o.id === 'rescue_eq')!;
    expect(optionBlocked(w, inc, rescueEq)).toMatch(/RESCUE/); // no rescue truck on scene
    expect(decide(w, inc.id, 'rescue_eq').ok).toBe(false);
    w.stats.supervisorsLeft = 0;
    expect(decide(w, inc.id, 'supervisor').ok).toBe(false);
    w.stats.supervisorsLeft = 1;
    inc.pressure = 30;
    expect(decide(w, inc.id, 'supervisor').ok).toBe(true);
    expect(inc.pressure).toBeLessThan(30);
    expect(w.stats.supervisorsLeft).toBe(0);
  });

  it('speed measures finish the scene sooner', () => {
    const time = (opt?: string) => {
      const { w, inc } = incident('fire', 'smoke', 8);
      dispatch(w, inc.id, [free(w, 'engine').id, free(w, 'ambulance').id]);
      run(w, () => !!inc.decision || inc.status === 'RESOLVED');
      inc.risk = 0; // isolate the speed effect
      const start = w.time;
      if (inc.decision && opt) { decide(w, inc.id, opt); } else if (inc.decision) decide(w, inc.id, 'continue');
      run(w, () => inc.status === 'RESOLVED' || inc.status === 'FAILED');
      return { t: w.time - start, status: inc.status };
    };
    const plain = time(), supervised = time('supervisor');
    expect(plain.status).toBe('RESOLVED'); expect(supervised.status).toBe('RESOLVED');
    expect(supervised.t).toBeLessThan(plain.t);
  });
});

describe('scene risk and complications', () => {
  it('high risk eventually triggers a complication that adds a requirement; zero risk never does', () => {
    const hot = incident('disturbance', 'armed', 5);
    hot.inc.risk = 1;
    dispatch(hot.w, hot.inc.id, [free(hot.w, 'suv').id]);
    const need = hot.inc.required.length;
    run(hot.w, () => hot.inc.complications > 0 || hot.inc.status === 'RESOLVED', 3000);
    // 20 s window is short; run repeated trials via fresh seeds until one triggers
    let triggered = hot.inc.complications > 0;
    for (let seed = 6; seed < 40 && !triggered; seed++) {
      const t = incident('disturbance', 'armed', seed);
      t.inc.risk = 1; t.inc.required.push('LAW', 'LAW'); // keep the scene "uncovered but occupied" longer
      dispatch(t.w, t.inc.id, [free(t.w, 'suv').id]);
      run(t.w, () => t.inc.complications > 0 || t.inc.status === 'FAILED', 3000);
      triggered = t.inc.complications > 0;
      if (triggered) expect(t.inc.status === 'COMPLICATION' || t.w.stats.complications > 0).toBe(true);
    }
    expect(triggered).toBe(true);
    expect(need).toBeGreaterThan(0);

    const calm = incident('disturbance', 'noise', 5);
    calm.inc.risk = 0;
    dispatch(calm.w, calm.inc.id, [free(calm.w, 'patrol').id]);
    run(calm.w, () => calm.inc.status === 'RESOLVED');
    expect(calm.inc.complications).toBe(0);
  });
});

describe('road closures', () => {
  it('a serious collision closes a road, routing avoids it, the city stays connected, and a traffic unit reopens it', () => {
    let found: { w: World; inc: Incident } | null = null;
    for (let seed = 1; seed < 60 && !found; seed++) {
      const t = incident('collision', 'multi', seed);
      if (t.inc.blockEdge !== null) found = t;
    }
    expect(found).not.toBeNull();
    const { w, inc } = found!;
    const edge = inc.blockEdge!;
    expect(isConnected(w.city, new Set([edge]))).toBe(true);
    const amb = free(w, 'ambulance');
    dispatch(w, inc.id, [amb.id]);
    run(w, () => inc.truthKnown);
    expect(inc.blockActive).toBe(true);
    expect(w.blocked.has(edge)).toBe(true);
    expect(amb.legs.every((l) => l.edge?.id !== edge)).toBe(true);
    dispatch(w, inc.id, [free(w, 'patrol').id]);
    run(w, () => !inc.blockActive);
    expect(inc.blockActive).toBe(false);
    expect(w.blocked.has(edge)).toBe(false);
  });

  it('the diversion decision reopens the road without a traffic unit', () => {
    let found: { w: World; inc: Incident } | null = null;
    for (let seed = 1; seed < 60 && !found; seed++) {
      const t = incident('collision', 'multi', seed);
      if (t.inc.blockEdge !== null) found = t;
    }
    const { w, inc } = found!;
    dispatch(w, inc.id, [free(w, 'ambulance').id]);
    run(w, () => !!inc.decision);
    expect(inc.blockActive).toBe(true);
    expect(decide(w, inc.id, 'divert').ok).toBe(true);
    expect(inc.blockActive).toBe(false);
  });
});

describe('linked incidents', () => {
  it('a neglected fire spreads into a linked incident', () => {
    const { w, inc } = incident('fire', 'small');
    inc.failAfter = 1e6;
    run(w, () => inc.linkSpawned, 4000);
    expect(inc.linkSpawned).toBe(true);
    const child = w.incidents.find((i) => i.linkedTo === inc.id)!;
    expect(child).toBeDefined();
    expect(child.believedNode).not.toBeNull();
    expect(w.stats.linked).toBe(1);
    expect(inc.notes.some((n) => /Linked incident/.test(n.text))).toBe(true);
  });
});

describe('data', () => {
  it('every decision option is well-formed', () => {
    for (const [tpl, dp] of Object.entries(DECISIONS)) {
      expect(dp.options.length).toBeGreaterThan(0);
      for (const o of dp.options) {
        expect(o.id && o.label && o.detail, `${tpl}.${o.id}`).toBeTruthy();
        expect(o.speed === undefined || (o.speed > 0 && o.speed < 3)).toBe(true);
      }
    }
  });
});
