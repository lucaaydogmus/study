/** Versioned local save. Every storage access is guarded; failures never throw. */
export const SAVE_KEY = 'signal911.save';
export const SAVE_VERSION = 1;

import type { Difficulty } from './types';

export interface Settings {
  difficulty: Difficulty;
  volume: number;
  muted: boolean;
  shiftMinutes: number;
}

export interface SaveData {
  version: number;
  money: number;
  xp: number;
  reputation: number;
  completedShifts: number;
  settings: Settings;
}

export const defaultSave = (): SaveData => ({
  version: SAVE_VERSION,
  money: 50000,
  xp: 0,
  reputation: 50,
  completedShifts: 0,
  settings: { difficulty: 'normal', volume: 0.6, muted: false, shiftMinutes: 10 },
});

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const browserStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Fill missing fields from defaults; upgrade older versions here as the format grows. */
export function migrate(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  return {
    version: SAVE_VERSION,
    money: num(r.money, d.money),
    xp: num(r.xp, d.xp),
    reputation: num(r.reputation, d.reputation),
    completedShifts: num(r.completedShifts, d.completedShifts),
    settings: {
      difficulty: r.settings?.difficulty === 'easy' || r.settings?.difficulty === 'hard' ? r.settings.difficulty : 'normal',
      volume: Math.min(1, Math.max(0, num(r.settings?.volume, d.settings.volume))),
      muted: typeof r.settings?.muted === 'boolean' ? r.settings.muted : d.settings.muted,
      shiftMinutes: num(r.settings?.shiftMinutes, d.settings.shiftMinutes),
    },
  };
}

export function loadSave(storage: StorageLike | null = browserStorage()): SaveData {
  if (!storage) return defaultSave();
  try {
    const text = storage.getItem(SAVE_KEY);
    return text ? migrate(JSON.parse(text)) : defaultSave();
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
