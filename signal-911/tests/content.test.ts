import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/sim/content/templates';
import { makeEngine, run } from './helpers';
import { getCity } from '../src/sim/city';
import { findRoute, makeClosedMask } from '../src/sim/routing';
import { QUICK_QUESTIONS, classifyIntent } from '../src/sim/dialogue';
import { DT } from '../src/sim/engine';

describe('content', () => {
  it('has at least twenty incident templates across all four categories', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(20);
    for (const c of ['medical', 'fire', 'police', 'unusual']) expect(TEMPLATES.some((t) => t.category === c)).toBe(true);
  });

  it('every template can be spawned, answered, questioned and simulated without errors', () => {
    for (const t of TEMPLATES) {
      const e = makeEngine({ script: [{ at: 1, template: t.id, district: 'downtown' }], durationSec: 400 });
      run(e, 3);
      const call = Object.values(e.state.calls)[0];
      expect(call, t.id).toBeTruthy();
      e.answerCall(call.id);
      run(e, 4);
      for (const q of QUICK_QUESTIONS) { e.ask(call.id, { intent: q.intent, text: q.text }); run(e, 1); }
      run(e, 20);
      const inc = Object.values(e.state.incidents)[0];
      expect(inc.facts.every((f) => typeof f.label === 'string'), t.id).toBe(true);
      expect(call.transcript.every((l) => !l.text.includes('{') && !l.text.includes('undefined')), `${t.id} left a template token or undefined in: ${call.transcript.map((l) => l.text).filter((x) => x.includes('{') || x.includes('undefined')).join(' | ')}`).toBe(true);
      e.endCall(call.id);
      run(e, 60);
    }
  });

  it('typed phrases map to sensible intents', () => {
    expect(classifyIntent("What's the address?")).toBe('address');
    expect(classifyIntent('Is he breathing?')).toBe('breathing');
    expect(classifyIntent('Help is on the way, stay calm')).toBe('promise');
    expect(classifyIntent('are there any weapons')).toBe('weapon');
    expect(classifyIntent('purple monkey dishwasher')).toBe('unknown');
  });
});

describe('routing', () => {
  const city = getCity();
  const tm = (closed: number[] = []) => ({ district: Object.fromEntries(city.districts.map((d) => [d.id, 0.3])), weatherMult: 1, closed: makeClosedMask(city, closed), preempt: 0, siren: true });
  it('finds routes between any two districts, crossing the river only at bridges', () => {
    const a = city.nodesInDistrict.westres[10], b = city.nodesInDistrict.harbor[20];
    const r = findRoute(city, a, b, tm(), 1)!;
    expect(r).toBeTruthy();
    expect(r.path[r.path.length - 1]).toBe(b);
    const crossings = r.path.filter((n, i) => { const prev = i === 0 ? a : r.path[i - 1]; const e = city.edges[city.edgeBetween.get(prev * 100000 + n)!]; return e.cls === 'bridge'; });
    expect(crossings.length).toBeGreaterThan(0);
  });
  it('avoids closed roads and takes longer when traffic is heavy', () => {
    const a = city.nodesInDistrict.downtown[5], b = city.nodesInDistrict.downtown[city.nodesInDistrict.downtown.length - 3];
    const base = findRoute(city, a, b, tm(), 1)!;
    const closed = city.edges.filter((e) => base.path.includes(e.a) && base.path.includes(e.b)).slice(0, 3).map((e) => e.id);
    const around = findRoute(city, a, b, tm(closed), 1)!;
    for (let i = 0; i < around.path.length; i++) { const prev = i === 0 ? a : around.path[i - 1]; expect(closed).not.toContain(city.edgeBetween.get(prev * 100000 + around.path[i])); }
    const jam = { ...tm(), district: Object.fromEntries(city.districts.map((d) => [d.id, 0.9])) };
    expect(findRoute(city, a, b, jam, 1)!.time).toBeGreaterThan(base.time);
  });
});

describe('weather & events', () => {
  it('a storm event closes roads and raises call volume modifiers', () => {
    const e = makeEngine({ script: undefined, incidentRate: 1, events: [{ type: 'storm', at: 10, duration: 100 }], durationSec: 200 });
    for (let i = 0; i < 40; i++) e.step(DT);
    expect(e.state.events.some((x) => x.type === 'storm' && x.active)).toBe(true);
    expect(e.state.weather).toBe('storm');
    expect(e.state.closedEdges.length).toBeGreaterThan(0);
  });
});
