import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { advance, initialClock, formatClock } from './clock';
import { defaultSave, loadSave, writeSave, migrate, SAVE_KEY, type StorageLike } from './save';

const memStore = (): StorageLike & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};

describe('rng', () => {
  it('is reproducible per seed and stays in range', () => {
    const a = createRng(42), b = createRng(42);
    for (let i = 0; i < 100; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });
  it('int is inclusive', () => {
    const r = createRng(7);
    for (let i = 0; i < 200; i++) { const v = r.int(3, 5); expect(v >= 3 && v <= 5).toBe(true); }
  });
});

describe('clock', () => {
  it('does not advance while paused', () => {
    expect(advance(initialClock(), 1).dt).toBe(0);
  });
  it('scales by speed and caps large steps', () => {
    const c = { ...initialClock(), paused: false, speed: 4 as const };
    expect(advance(c, 0.1).dt).toBeCloseTo(0.4);
    expect(advance(c, 60).dt).toBeCloseTo(1);
  });
  it('formats mm:ss', () => expect(formatClock(125)).toBe('02:05'));
});

describe('save', () => {
  it('round-trips', () => {
    const s = memStore(); const d = { ...defaultSave(), money: 123 };
    expect(writeSave(d, s)).toBe(true);
    expect(loadSave(s).money).toBe(123);
  });
  it('survives corrupt data, missing and throwing storage', () => {
    const s = memStore(); s.data[SAVE_KEY] = '{not json';
    expect(loadSave(s)).toEqual(defaultSave());
    expect(loadSave(null)).toEqual(defaultSave());
    const bad: StorageLike = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadSave(bad)).toEqual(defaultSave());
    expect(writeSave(defaultSave(), bad)).toBe(false);
  });
  it('migrate fills missing fields and clamps volume', () => {
    expect(migrate({ money: 5, settings: { volume: 9 } }).settings.volume).toBe(1);
    expect(migrate({ money: 5 }).xp).toBe(0);
  });
});
