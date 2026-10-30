// Persistence layer: IndexedDB with an in-memory fallback. The KV interface is deliberately tiny
// so a backend database can be dropped in later (implement `KV` over fetch and pass it to SaveManager).
import { DEFAULT_SETTINGS, PROFILE_VERSION, type Profile, type Settings } from './sim/profile';
import type { GameState } from './sim/types';

export interface KV {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryKV implements KV {
  private m = new Map<string, string>();
  async get<T>(k: string) { const v = this.m.get(k); return v === undefined ? undefined : (JSON.parse(v) as T); }
  async set(k: string, v: unknown) { this.m.set(k, JSON.stringify(v)); }
  async del(k: string) { this.m.delete(k); }
  async keys() { return [...this.m.keys()]; }
}

export class IndexedDbKV implements KV {
  private dbp: Promise<IDBDatabase> | null = null;
  constructor(private name = 'signal911', private store = 'kv') {}
  private db(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(this.store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbp;
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(this.store, mode);
      const r = fn(t.objectStore(this.store));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => reject(r.error);
    });
  }
  get<T>(k: string) { return this.tx<T | undefined>('readonly', (s) => s.get(k)); }
  async set(k: string, v: unknown) { await this.tx('readwrite', (s) => s.put(JSON.parse(JSON.stringify(v)), k)); }
  async del(k: string) { await this.tx('readwrite', (s) => s.delete(k)); }
  async keys() { return (await this.tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).map(String); }
}

export function defaultKV(): KV {
  try { if (typeof indexedDB !== 'undefined') return new IndexedDbKV(); } catch { /* fall through */ }
  return new MemoryKV();
}

export interface SaveEnvelope { version: number; savedAt: number; slot: string; label: string; profile: Profile; settings: Settings }
export interface SaveMeta { slot: string; savedAt: number; label: string; rank: number; money: number; shifts: number; name: string }
export interface ShiftSnapshot { savedAt: number; slot: string; state: GameState }

/** Upgrade older save formats step by step. */
export function migrate(raw: SaveEnvelope): SaveEnvelope {
  const out: SaveEnvelope = JSON.parse(JSON.stringify(raw));
  let v = out.version ?? 1;
  const p = out.profile as Profile & Record<string, unknown>;
  if (v < 2) {
    p.flags = (p.flags as Profile['flags']) ?? { tutorialDone: false, difficulty: 'standard', duration: 15 * 60 };
    p.endless = (p.endless as Profile['endless']) ?? { bestWave: 0, bestScore: 0, current: { wave: 0, score: 0, active: false } };
    p.scenarios = (p.scenarios as Profile['scenarios']) ?? {};
    p.city = (p.city as Profile['city']) ?? { closedRoads: [], districtTraffic: {}, damagedStations: {}, log: [] };
    p.upgrades = p.upgrades ?? { ali: 1 };
    v = 2;
  }
  if (v < 3) {
    p.achievements = (p.achievements as Profile['achievements']) ?? {};
    p.daily = (p.daily as Profile['daily']) ?? {};
    const L = ((p.stats as unknown) as Record<string, number>) ?? {};
    for (const k of ['merges', 'pursuits', 'verifies', 'gradeA', 'calmed', 'bestStreak', 'contracts']) L[k] = L[k] ?? 0;
    p.stats = L as unknown as Profile['stats'];
    v = 3;
  }
  out.version = v;
  out.profile.version = PROFILE_VERSION;
  out.settings = { ...DEFAULT_SETTINGS, ...(out.settings ?? {}) };
  return out;
}

export class SaveManager {
  constructor(private kv: KV = defaultKV()) {}

  async save(slot: string, profile: Profile, settings: Settings, label?: string): Promise<void> {
    const env: SaveEnvelope = { version: PROFILE_VERSION, savedAt: Date.now(), slot, label: label ?? `${profile.name} — Rank ${profile.rank}`, profile, settings };
    await this.kv.set(`save:${slot}`, env);
  }
  async load(slot: string): Promise<SaveEnvelope | null> {
    const raw = await this.kv.get<SaveEnvelope>(`save:${slot}`);
    if (!raw || !raw.profile) return null;
    if (raw.version > PROFILE_VERSION) throw new Error('This save was created by a newer version of the game.');
    return migrate(raw);
  }
  async list(): Promise<SaveMeta[]> {
    const keys = (await this.kv.keys()).filter((k) => k.startsWith('save:'));
    const out: SaveMeta[] = [];
    for (const k of keys) {
      const env = await this.kv.get<SaveEnvelope>(k);
      if (env?.profile) out.push({ slot: env.slot, savedAt: env.savedAt, label: env.label, rank: env.profile.rank, money: env.profile.money, shifts: env.profile.stats?.shifts ?? 0, name: env.profile.name });
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }
  async remove(slot: string) { await this.kv.del(`save:${slot}`); }
  async resetAll() { for (const k of await this.kv.keys()) await this.kv.del(k); }

  async saveShift(slot: string, state: GameState) { await this.kv.set('shift', { savedAt: Date.now(), slot, state } as ShiftSnapshot); }
  async loadShift(): Promise<ShiftSnapshot | null> { return (await this.kv.get<ShiftSnapshot>('shift')) ?? null; }
  async clearShift() { await this.kv.del('shift'); }

  async saveSettings(s: Settings) { try { localStorage.setItem('signal911.settings', JSON.stringify(s)); } catch { /* ignore */ } await this.kv.set('settings', s).catch(() => undefined); }
  loadSettingsSync(): Settings {
    try { const raw = localStorage.getItem('signal911.settings'); if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch { /* ignore */ }
    return { ...DEFAULT_SETTINGS };
  }
}
