/** Versioned local save. Every storage access is guarded; failures never throw. */
export const SAVE_KEY = 'signal911.save';
export const SAVE_VERSION = 3;

import type { Difficulty } from './types';
import { defaultFleet, STATION_CAPACITY, type FleetUnit } from './fleet';
import { EQUIPMENT, MAX_UPGRADES } from './equipment';
import { VEHICLES } from './units';
import { getCity } from './city';
import { OBJECTIVES, defaultCareer, type Career } from './career';
import { EVENTS } from './events';

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
  fleet: FleetUnit[];
  career: Career;
}

export const defaultSave = (): SaveData => ({
  version: SAVE_VERSION,
  money: 50000,
  xp: 0,
  reputation: 50,
  completedShifts: 0,
  settings: { difficulty: 'normal', volume: 0.6, muted: false, shiftMinutes: 10 },
  fleet: defaultFleet(),
  career: defaultCareer(),
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

/** Drop anything that is not a valid unit; fall back to the starting fleet if nothing usable remains. */
export function sanitizeFleet(raw: unknown): FleetUnit[] {
  if (!Array.isArray(raw)) return defaultFleet();
  const stations = getCity().stations;
  const seen = new Set<string>();
  const load: Record<string, number> = {};
  const out: FleetUnit[] = [];
  for (const r of raw as Partial<FleetUnit>[]) {
    const v = r && r.vehicle ? VEHICLES[r.vehicle] : undefined;
    const st = stations.find((s) => s.id === r?.stationId);
    if (!v || !st || st.service !== v.service || typeof r.id !== 'string' || seen.has(r.id)) continue;
    if ((load[st.id] ?? 0) >= STATION_CAPACITY) continue;
    seen.add(r.id); load[st.id] = (load[st.id] ?? 0) + 1;
    const cond = typeof r.condition === 'number' && Number.isFinite(r.condition) ? Math.min(100, Math.max(0, r.condition)) : 100;
    const ups = Array.isArray(r.upgrades) ? r.upgrades.filter((g, i, a) => EQUIPMENT[g] && a.indexOf(g) === i).slice(0, MAX_UPGRADES) : [];
    out.push({ id: r.id, vehicle: r.vehicle!, stationId: st.id, upgrades: ups, condition: cond });
  }
  return out.length >= 3 ? out : defaultFleet();
}

export function sanitizeCareer(raw: unknown): Career {
  const d = defaultCareer();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Career>;
  const ids = new Set(OBJECTIVES.map((o) => o.id));
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ids.has(x)) : []);
  const counts = (v: unknown, valid: Set<string>) => {
    const out: Record<string, number> = {};
    if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (valid.has(k) && typeof n === 'number' && n > 0 && Number.isFinite(n)) out[k] = Math.floor(n);
    return out;
  };
  let active = [...new Set(list(r.active))].slice(0, 3);
  for (const o of OBJECTIVES) { if (active.length >= 3) break; if (!active.includes(o.id)) active.push(o.id); }
  active = active.slice(0, 3);
  return {
    active, completed: list(r.completed),
    events: counts(r.events, new Set(EVENTS.map((e) => e.id))),
    challenges: counts(r.challenges, new Set(getCity().districts.map((x) => x.id))),
    bestGrade: typeof r.bestGrade === 'string' && ['S', 'A', 'B', 'C', 'D', 'F', '-'].includes(r.bestGrade) ? r.bestGrade : '-',
  };
}

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
    fleet: sanitizeFleet(r.fleet),
    career: sanitizeCareer(r.career),
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
