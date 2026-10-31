import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { isAir, UNIT_TYPE_BY_ID } from '../src/sim/fleet';
import { SPECIALIST, type GameEngine } from '../src/sim/engine';
import { baseConfig, rollSurprises, ALL_DISTRICTS } from '../src/sim/scenarios';
import { careerConfig, computeResult, newProfile, setupFromProfile } from '../src/sim/profile';
import { GameEngine as Engine } from '../src/sim/engine';
import { applyFit, fitCost, kitsFor, slotsOf } from '../src/sim/garage';
import { TEMPLATE_BY_ID } from '../src/sim/content/templates';
import { adaptReqForRank } from '../src/sim/content/vocab';
import type { Incident, Unit } from '../src/sim/types';

const quiet = { script: [] as never[] };
const located = (e: GameEngine, tpl: string, district = 'downtown'): Incident => {
  const inc = e.spawnIncident(tpl, district, { accuracy: 'exact', noCall: true });
  return inc;
};
const nearest = (e: GameEngine, inc: Incident, pred: (u: Unit) => boolean, n = 1) => Object.values(e.state.units).filter((u) => pred(u) && !isAir(u) && u.status === 'AVAILABLE')
  .sort((a, b) => (e.estimate(a.id, inc.nodeId)?.eta ?? 1e9) - (e.estimate(b.id, inc.nodeId)?.eta ?? 1e9)).slice(0, n);

describe('remaster 9: the big days', () => {
  it('ordinary shifts can roll a surprise major incident or citywide event, deterministically', () => {
    let majors = 0, events = 0;
    for (let i = 0; i < 60; i++) {
      const cfg = baseConfig({ title: 't', briefing: 'b', mode: 'career', durationSec: 900, seed: 500 + i * 13 });
      const a = rollSurprises(cfg, 4, cfg.seed), b = rollSurprises(cfg, 4, cfg.seed);
      expect(a).toEqual(b);
      if (a.forced?.some((f) => TEMPLATE_BY_ID[f.template].major)) majors++;
      if (a.events.length) events++;
      expect(a.threatLevel).toBeDefined();
      for (const f of a.forced ?? []) expect(f.at).toBeLessThan(900 - 60);
    }
    // rare, but they happen
    expect(majors).toBeGreaterThan(10);
    expect(majors).toBeLessThan(50);
    expect(events).toBeGreaterThan(8);
  });

  it('surprises respect rank, the off switch and handcrafted modes', () => {
    for (let i = 0; i < 40; i++) {
      const cfg = baseConfig({ title: 't', briefing: 'b', mode: 'career', durationSec: 900, seed: 77 + i, districts: ['westres', 'oldtown', 'downtown', 'riverside'] });
      const r1 = rollSurprises(cfg, 1, cfg.seed);
      for (const f of r1.forced ?? []) expect(TEMPLATE_BY_ID[f.template].minRank).toBeLessThanOrEqual(1);
      for (const ev of r1.events) expect(['rush_hour', 'storm', 'heat_wave', 'festival']).toContain(ev.type);
      expect(rollSurprises({ ...cfg, surprises: false }, 5, cfg.seed)).toEqual({ ...cfg, surprises: false });
      expect(rollSurprises({ ...cfg, mode: 'scenario' }, 5, cfg.seed).forced).toBeUndefined();
    }
  });

  it('career shifts now carry surprises (and campaign chapters do not)', () => {
    let any = 0;
    for (let s = 1; s < 30; s++) {
      const p = newProfile('T', 9000 + s);
      p.rank = 4; p.counters.shift = s;
      const cfg = careerConfig(p);
      if (cfg.forced?.length || cfg.events.length) any++;
      expect(careerConfig(p, { chapterId: 'ch1' }).threatLevel).toBeUndefined();
    }
    expect(any).toBeGreaterThan(8);
  });

  it('a major incident makes the breaking news shortly after it comes in', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('active_shooter', 'downtown', { accuracy: 'exact' });
    expect(inc.breakAt).toBeDefined();
    run(e, 35);
    expect((e.state.news ?? []).some((n) => n.text.startsWith('BREAKING') && n.text.includes('active shooter'))).toBe(true);
    expect(inc.breakAt).toBeUndefined();
  });

  it('a riot event starts a riot; a protest event puts a march on the streets and closes roads', () => {
    const e = makeEngine({ ...quiet, districts: ['downtown', 'financial', 'oldtown', 'westres'], events: [{ type: 'riot', at: 5, duration: 200 }, { type: 'protest', at: 10, duration: 200 }] });
    const closed = e.state.closedEdges.length;
    run(e, 14);
    const tpls = Object.values(e.state.incidents).map((i) => i.templateId);
    expect(tpls).toContain('riot');
    expect(tpls).toContain('protest_march');
    expect(e.state.closedEdges.length).toBeGreaterThan(closed);
  });

  it('public order needs are adapted to what a rank can actually field', () => {
    expect(adaptReqForRank({ cap: 'public_order', n: 1 }, 1).cap).toBe('patrol');
    expect(adaptReqForRank({ cap: 'public_order', n: 1 }, 2).cap).toBe('crowd');
    expect(adaptReqForRank({ cap: 'public_order', n: 1 }, 3).cap).toBe('public_order');
    expect(adaptReqForRank({ cap: 'hazmat', n: 1 }, 2).cap).toBe('fire_suppression');
    // bombs always need bomb technicians: the bomb squad, mutual aid or the National Guard
    expect(adaptReqForRank({ cap: 'eod', n: 1 }, 1).cap).toBe('eod');
  });
});

describe('remaster 9: federal team and National Guard EOD', () => {
  const device = (e: GameEngine) => {
    let inc!: Incident;
    for (let k = 0; k < 40; k++) { inc = located(e, 'suspicious_package'); if (inc.twist) break; inc.status = 'CLOSED'; }
    expect(inc.twist).toBeTruthy();
    return inc;
  };

  it('crews who find a device ask for EOD, and the Guard team mobilises, drives in and works the scene', () => {
    const e = makeEngine(quiet);
    const inc = device(e);
    for (const u of nearest(e, inc, (u) => u.service === 'police', 2)) e.dispatch(u.id, inc.id);
    run(e, 200, () => inc.specialistAsked?.eod !== undefined);
    expect(inc.specialistAsked?.eod).toBeDefined();
    expect(inc.requires.some((r) => r.cap === 'eod')).toBe(true);
    expect(e.state.radio.some((r) => /EOD/.test(r.text))).toBe(true);
    const budget = e.state.budget;
    const r = e.requestSpecialist(inc.id, 'eod');
    expect(r.ok).toBe(true);
    expect(e.state.budget).toBeLessThanOrEqual(budget - SPECIALIST.eod.cost);
    expect(e.requestSpecialist(inc.id, 'eod').ok).toBe(false);
    expect(e.requestSpecialist(inc.id, 'federal').ok).toBe(false);
    const u = e.state.units[inc.specialists!.eod!.unitId];
    expect(u.type).toBe('guard_eod');
    expect(u.capabilities).toContain('eod');
    expect(u.status).toBe('DISPATCHED');
    run(e, 420, () => u.status === 'ON_SCENE');
    expect(u.status).toBe('ON_SCENE');
    expect(e.state.radio.some((r) => r.text.includes('Robot is going down'))).toBe(true);
  });

  it('the federal team only answers the worst armed threats, and brings a negotiator', () => {
    const e = makeEngine(quiet);
    const minor = located(e, 'public_disturbance');
    expect(e.requestSpecialist(minor.id, 'federal').ok).toBe(false);
    const siege = located(e, 'hostage_barricade', 'westres');
    const r = e.requestSpecialist(siege.id, 'federal');
    expect(r.ok).toBe(true);
    const u = e.state.units[siege.specialists!.federal!.unitId];
    expect(u.capabilities).toEqual(expect.arrayContaining(['tactical', 'negotiator']));
    expect(UNIT_TYPE_BY_ID.federal_tactical.minRank).toBe(99);
    // mutual aid never lends out the outside-only teams
    const before = Object.keys(e.state.units).length;
    e.requestMutualAid(siege.id, 'tactical');
    const added = Object.values(e.state.units).slice(before)[0];
    expect(added.type).not.toBe('federal_tactical');
  });

  it('specialist units are better at their own jobs', () => {
    const e = makeEngine(quiet);
    const riot = located(e, 'riot');
    const pou = { type: 'public_order', fit: undefined } as unknown as Unit;
    const patrol = { type: 'patrol', fit: { chassis: 'sedan', kits: ['less_lethal'], livery: 'classic' } } as unknown as Unit;
    expect(e.sceneFit(riot, pou)).toBeCloseTo(1.45);
    expect(e.sceneFit(riot, patrol)).toBeCloseTo(1.2);
    expect(e.sceneFit(located(e, 'kitchen_fire'), pou)).toBe(1);
  });
});

describe('remaster 9: the garage', () => {
  const unit = (type: string): Unit => {
    const p = newProfile('G', 4242);
    return JSON.parse(JSON.stringify(p.units.find((u) => u.type === type)!));
  };

  it('a chassis trades speed for space, kits add capabilities, and it is idempotent', () => {
    const u = unit('patrol');
    u.fit = { chassis: 'suv', kits: ['aed', 'riot_gear', 'k9', 'rifle'], livery: 'modern' };
    applyFit(u); applyFit(u);
    expect(u.speedModifier).toBeCloseTo(UNIT_TYPE_BY_ID.patrol.speed * 0.94);
    expect(slotsOf(u)).toBe(3);
    expect(u.fit.kits).toEqual(['aed', 'riot_gear', 'k9']);
    expect(u.capabilities).toEqual(expect.arrayContaining(['patrol', 'first_aid', 'crowd']));
    u.fit = { chassis: 'interceptor', kits: ['aed', 'riot_gear'], livery: 'classic' };
    applyFit(u);
    expect(u.speedModifier).toBeGreaterThan(UNIT_TYPE_BY_ID.patrol.speed);
    expect(u.fit.kits).toEqual(['aed']);
    expect(u.capabilities).not.toContain('crowd');
  });

  it('only sensible kits are offered, and only new things cost money', () => {
    const amb = unit('ambulance');
    expect(kitsFor(amb).map((k) => k.id)).toContain('als_kit');
    const adv = unit('advanced_ambulance');
    expect(kitsFor(adv).map((k) => k.id)).not.toContain('als_kit');
    expect(kitsFor(unit('engine')).every((k) => k.service === 'fire')).toBe(true);
    const u = unit('patrol');
    expect(fitCost(u, { chassis: 'suv', kits: ['aed'] })).toBe(7000 + 2500);
    u.fit = { chassis: 'suv', kits: ['aed'], livery: 'classic' };
    expect(fitCost(u, { chassis: 'suv', kits: [] })).toBe(0);
  });

  it('a fitted vehicle keeps its fit in the shift and the kit really works', () => {
    const p = newProfile('G', 31337);
    const amb = p.units.find((u) => u.type === 'ambulance')!;
    amb.fit = { chassis: 'van', kits: ['als_kit'], livery: 'green' };
    const e = Engine.fromConfig(careerConfig(p), setupFromProfile(p));
    const live = e.state.units[amb.id];
    expect(live.capabilities).toContain('als');
    expect(live.fit?.livery).toBe('green');
    // all-terrain grip keeps speed in snow
    const box = p.units.find((u) => u.type === 'advanced_ambulance')!;
    box.fit = { chassis: 'offroad', kits: [], livery: 'classic' };
    const e2 = Engine.fromConfig({ ...careerConfig(p), weather: 'snow' }, setupFromProfile(p));
    const plain = Object.values(e2.state.units).find((u) => u.type === 'advanced_ambulance' && u.id !== box.id)!;
    expect(e2.unitSpeedFactor(e2.state.units[box.id]) / e2.state.units[box.id].speedModifier).toBeGreaterThan(e2.unitSpeedFactor(plain) / plain.speedModifier);
  });

  it('handling a major incident well pays a hazard grant', () => {
    const e = makeEngine({ ...quiet, mode: 'career' });
    const inc = located(e, 'bank_robbery', 'downtown');
    e['resolveIncident'](inc, 'success');
    const res = computeResult(e.state);
    expect(res.moneyBreakdown.some(([k, v]) => k.startsWith('Major incident') && v > 0)).toBe(true);
    void ALL_DISTRICTS;
  });
});
