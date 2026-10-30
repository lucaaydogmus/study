import { describe, expect, it } from 'vitest';
import { CHALLENGE_LEVEL, LEVEL_XP, OBJECTIVES, defaultCareer, evaluateCareer, levelOf, nextLevelXp } from './career';
import { EVENTS } from './events';
import { SAVE_KEY, SAVE_VERSION, defaultSave, loadSave, migrate, sanitizeCareer, writeSave, type StorageLike } from './save';
import { buildSummary, createWorld, step, trafficAt, edgeSpeed, planRoute, type Config } from './world';
import { TEMPLATES } from './incidents';
import { playShift } from './testbot';

const cfg = (over: Partial<Config> = {}): Config => ({ seed: 21, shiftMinutes: 10, difficulty: 'normal', weather: 'clear', ...over });
const mem = (): StorageLike & { data: Record<string, string> } => { const data: Record<string, string> = {}; return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } }; };

describe('levels and career data', () => {
  it('maps xp to levels and the next threshold', () => {
    expect(levelOf(0)).toBe(1); expect(levelOf(LEVEL_XP[1])).toBe(2); expect(levelOf(10000)).toBe(LEVEL_XP.length);
    expect(nextLevelXp(0)).toBe(LEVEL_XP[1]); expect(nextLevelXp(10000)).toBeNull();
  });
  it('unlocks every event within a handful of shifts', () => {
    const maxLevel = Math.max(...EVENTS.map((e) => e.level));
    expect(LEVEL_XP[maxLevel - 1]).toBeLessThanOrEqual(1000);
    expect(EVENTS.find((e) => e.level === 1)).toBeDefined();
  });
  it('sanitises career data and migrates older saves to the current version', () => {
    expect(sanitizeCareer(null)).toEqual(defaultCareer());
    const c = sanitizeCareer({ active: ['nope', 'swift', 'swift'], completed: ['x', 'clean_shift'], events: { rush_hour: 2, bad: 5, heavy_rain: -1 }, challenges: { downtown: 1, mars: 3 }, bestGrade: 'Z' });
    expect(c.active).toHaveLength(3); expect(new Set(c.active).size).toBe(3); expect(c.active[0]).toBe('swift');
    expect(c.completed).toEqual(['clean_shift']);
    expect(c.events).toEqual({ rush_hour: 2 }); expect(c.challenges).toEqual({ downtown: 1 }); expect(c.bestGrade).toBe('-');
    const s = mem(); s.data[SAVE_KEY] = JSON.stringify({ version: 2, money: 9, xp: 400, reputation: 70, completedShifts: 3, settings: {}, fleet: defaultSave().fleet });
    const v = loadSave(s);
    expect(v.version).toBe(SAVE_VERSION); expect(v.xp).toBe(400); expect(v.career).toEqual(defaultCareer());
    const round = { ...defaultSave(), career: { ...defaultCareer(), events: { festival: 1 }, bestGrade: 'A' } };
    writeSave(round, s); expect(loadSave(s).career.events).toEqual({ festival: 1 });
    expect(migrate({ career: 12 }).career).toEqual(defaultCareer());
  });
});

describe('scenarios and events', () => {
  it('heavy rain slows vehicles; rush hour and outages raise traffic', () => {
    const base = createWorld(cfg()), storm = createWorld(cfg({ event: 'heavy_rain' })), rush = createWorld(cfg({ event: 'rush_hour' })), out = createWorld(cfg({ event: 'power_outage' }));
    expect(storm.weather).toBe('storm');
    const u = base.units[0], us = storm.units[0];
    expect(edgeSpeed(storm, us, null)).toBeLessThan(edgeSpeed(base, u, null));
    expect(trafficAt(rush, 'downtown')).toBeGreaterThan(trafficAt(base, 'downtown'));
    expect(trafficAt(out, 'oldtown')).toBeGreaterThan(trafficAt(base, 'oldtown'));
    const dest = base.city.stations[4].nodeId;
    expect(planRoute(storm, us, dest)!.eta).toBeGreaterThan(planRoute(base, u, dest)!.eta);
  });

  it('power outage fires two waves of linked calls at once', () => {
    const w = createWorld(cfg({ event: 'power_outage' }));
    while (w.time < w.length * 0.2 + 1) step(w, 0.5);
    const wave = w.calls.filter((c) => c.spec.cluster === 'outage-1');
    expect(wave).toHaveLength(3);
    expect(new Set(wave.map((c) => c.ringAt)).size).toBe(1); // simultaneous
    expect(wave.map((c) => c.spec.templateId).sort()).toEqual(['collision', 'fire', 'medical']);
    while (w.time < w.length * 0.56) step(w, 0.5);
    expect(w.calls.filter((c) => c.spec.cluster === 'outage-2')).toHaveLength(3);
  });

  it('linked cluster incidents reference the first one', () => {
    const w = createWorld(cfg({ event: 'power_outage' }));
    playShift(w);
    const cluster = w.incidents.filter((i) => i.notes.some((n) => /same power outage event/.test(n.text)));
    expect(cluster.length).toBeGreaterThan(0);
    for (const i of cluster) expect(i.linkedTo).not.toBeNull();
  });

  it('the industrial fire is a long major incident that only the event creates', () => {
    const w = createWorld(cfg({ event: 'industrial_fire' }));
    while (w.time < w.length * 0.13) step(w, 0.5);
    const call = w.calls.find((c) => c.spec.variationId === 'inferno')!;
    expect(call.spec.district).toBe('industrial');
    const tpl = TEMPLATES.find((t) => t.id === 'fire')!;
    const inf = tpl.variations.find((v) => v.id === 'inferno')!;
    expect(inf.caps).toHaveLength(5); expect(inf.severity).toBe(4);
    // not part of ordinary shifts
    let ordinary = 0;
    for (let seed = 1; seed <= 6; seed++) { const n = createWorld(cfg({ seed })); for (let i = 0; i < 1100; i++) step(n, 0.5); ordinary += n.calls.filter((c) => c.spec.variationId === 'inferno').length; }
    expect(ordinary).toBe(0);
  });

  it('district-restricted variations obey their district', () => {
    let access = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const w = createWorld(cfg({ seed, difficulty: 'hard' })); for (let i = 0; i < 1200; i++) step(w, 0.5);
      for (const c of w.calls) if (c.spec.variationId === 'access' || c.spec.perceivedVariationId === 'access') { access++; expect(c.spec.district).toBe('oldtown'); }
    }
    expect(access).toBeGreaterThanOrEqual(0);
  });

  it('a district challenge concentrates calls in that district', () => {
    const share = (challenge: Config['challenge']) => {
      let hit = 0, all = 0;
      for (let seed = 1; seed <= 6; seed++) { const w = createWorld(cfg({ seed, challenge })); for (let i = 0; i < 1200; i++) step(w, 0.5); hit += w.calls.filter((c) => c.spec.district === 'northside').length; all += w.calls.length; }
      return hit / all;
    };
    expect(share('northside')).toBeGreaterThan(share(null) + 0.2);
  });

  for (const ev of EVENTS) {
    it(`a full ${ev.name} shift completes and is evaluated`, () => {
      const w = createWorld(cfg({ event: ev.id, seed: 33 }));
      playShift(w);
      expect(w.over).toBe(true);
      const s = buildSummary(w);
      expect(s.resolved + s.failed + s.unresolved).toBe(w.incidents.length);
      const out = evaluateCareer(defaultCareer(), w, s, 0);
      expect(out.career.active).toHaveLength(3);
      expect(out.scenario?.name).toBe(ev.name);
      expect(out.xp).toBeGreaterThan(0);
    }, 60000);
  }
});

describe('objectives and rewards', () => {
  const finished = (over: Partial<Config> = {}) => { const w = createWorld(cfg(over)); playShift(w); return { w, s: buildSummary(w) }; };

  it('completes objectives, refills to three and applies level-ups and unlocks', () => {
    const { w, s } = finished({ weather: 'rain', seed: 5 });
    w.stats.districtResp.downtown = [20, 30, 40];
    w.stats.decisions = 5; w.stats.fastResponses = 9; w.stats.linkedResolved = 4; w.stats.majorTraffic = 1;
    const out = evaluateCareer({ ...defaultCareer(), active: ['dt_response', 'decider', 'swift'] }, w, s, 100);
    expect(out.completed.map((o) => o.id).sort()).toEqual(['decider', 'dt_response', 'swift']);
    expect(out.career.active).toHaveLength(3);
    expect(out.career.completed).toEqual(expect.arrayContaining(['decider', 'swift']));
    expect(out.money).toBeGreaterThanOrEqual(2000 + 1500 + 2000);
    expect(out.levelUp).toBe(true); // 100 xp + rewards crosses the first threshold
    expect(out.unlocked).toContain('District challenges');
    expect(out.career.active.every((id) => !out.career.completed.includes(id)) || out.career.completed.length === OBJECTIVES.length).toBe(true);
  });

  it('an event gives its big bonus once and a smaller one on repeats', () => {
    const w = createWorld(cfg({ event: 'heavy_rain', seed: 8 }));
    const ev = EVENTS.find((e) => e.id === 'heavy_rain')!;
    const s = { ...buildSummary(w), resolved: 9, failed: 0, grade: 'B' } as ReturnType<typeof buildSummary>;
    const first = evaluateCareer(defaultCareer(), w, s, 0);
    expect(first.scenario).toMatchObject({ passed: true, first: true });
    expect(first.money).toBeGreaterThanOrEqual(ev.reward.money);
    const again = evaluateCareer(first.career, w, s, 0);
    expect(again.scenario).toMatchObject({ passed: true, first: false });
    expect(again.money).toBeLessThan(first.money);
    const bad = evaluateCareer(defaultCareer(), w, { ...s, grade: 'F' }, 0);
    expect(bad.scenario!.passed).toBe(false);
    expect(bad.career.events.heavy_rain).toBeUndefined();
  });

  it('a district challenge is passed with 5 resolutions and at most one failure', () => {
    const w = createWorld(cfg({ challenge: 'riverside' }));
    w.stats.districtResolved.riverside = 5;
    const s = { ...buildSummary(w), failed: 1 };
    const out = evaluateCareer(defaultCareer(), w, s, 0);
    expect(out.scenario).toMatchObject({ passed: true, first: true });
    expect(out.career.challenges.riverside).toBe(1);
    expect(CHALLENGE_LEVEL).toBeLessThanOrEqual(2);
  });
});
