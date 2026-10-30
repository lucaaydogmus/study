import { describe, it, expect } from 'vitest';
import { MemoryKV, SaveManager, migrate } from '../src/persistence';
import { newProfile, DEFAULT_SETTINGS, buyUnit, buyUpgrade, applyShift, PROFILE_VERSION } from '../src/sim/profile';
import { makeEngine, run } from './helpers';
import { rankForXp } from '../src/sim/progression';

describe('save system (10)', () => {
  it('round-trips a profile with progression intact', async () => {
    const sm = new SaveManager(new MemoryKV());
    const p = newProfile('Test', 5);
    p.money = 123456; p.xp = 1300; p.rank = rankForXp(p.xp); p.reputation = 71;
    expect(buyUpgrade(p, 'console').ok).toBe(true);
    expect(buyUnit(p, 'patrol', 'police-downtown').ok).toBe(true);
    await sm.save('slot1', p, DEFAULT_SETTINGS);
    const loaded = await sm.load('slot1');
    expect(loaded).not.toBeNull();
    expect(loaded!.profile.money).toBe(p.money);
    expect(loaded!.profile.rank).toBe(3);
    expect(loaded!.profile.upgrades.console).toBe(1);
    expect(loaded!.profile.units.length).toBe(p.units.length);
    expect((await sm.list()).length).toBe(1);
    await sm.remove('slot1');
    expect(await sm.load('slot1')).toBeNull();
  });

  it('migrates version-1 saves', () => {
    const p = newProfile('Old', 9) as unknown as Record<string, unknown>;
    delete p.flags; delete p.endless; delete p.scenarios;
    // careers from before the remaster have no helicopter: migration grants one
    p.units = (p.units as Array<{ type: string }>).filter((u) => u.type !== 'helicopter');
    const env = migrate({ version: 1, savedAt: 0, slot: 'auto', label: 'x', profile: p as never, settings: {} as never });
    expect(env.version).toBe(PROFILE_VERSION);
    expect(env.profile.units.filter((u) => u.type === 'helicopter').length).toBe(1);
    expect(env.profile.achievements).toEqual({});
    expect(env.profile.flags.difficulty).toBe('standard');
    expect(env.profile.version).toBe(PROFILE_VERSION);
    expect(env.settings.master).toBe(DEFAULT_SETTINGS.master);
  });

  it('applying a shift keeps progress and rolls rewards in', () => {
    const e = makeEngine({ durationSec: 120, script: undefined, incidentRate: 1 });
    run(e, 130);
    e.endShift();
    const p = newProfile('P', 1);
    const before = p.xp;
    const res = applyShift(p, e.state);
    expect(p.xp).toBeGreaterThan(before);
    expect(p.history.length).toBe(1);
    expect(['S', 'A', 'B', 'C', 'D', 'F']).toContain(res.score.grade);
    expect(p.stats.shifts).toBe(1);
  });
});
