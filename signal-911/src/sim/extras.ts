// Career shift modifiers and bonus contracts: these make every shift feel different.
import { Rng } from './rng';
import type { GameState, ShiftConfig } from './types';

export interface ModifierDef {
  id: string; name: string; desc: string; tone: 'good' | 'bad' | 'mixed'; minRank: number;
  rate?: number; pay?: number; bonus?: number; rep?: number; salary?: number; eff?: number; oos?: number; closeHospital?: boolean; roadworks?: number; fresh?: boolean; dupes?: number;
}
export const MODIFIERS: ModifierDef[] = [
  { id: 'quiet', name: 'Quiet Night', desc: 'Fewer calls than usual. The contract pays a little less.', tone: 'good', minRank: 1, rate: 0.75, pay: 0.9 },
  { id: 'holiday', name: 'Holiday Weekend', desc: '25% more calls, 30% better contract pay.', tone: 'mixed', minRank: 1, rate: 1.25, pay: 1.3 },
  { id: 'short_staffed', name: 'Short-Staffed', desc: 'Two crews call in sick — two units are unavailable for the first four minutes.', tone: 'bad', minRank: 1, oos: 2 },
  { id: 'diversion', name: 'Hospital Diversion', desc: 'One hospital is not accepting patients. Ambulances must travel further.', tone: 'bad', minRank: 2, closeHospital: true },
  { id: 'spotlight', name: 'Media Spotlight', desc: 'A news crew is shadowing the centre. Reputation gains and losses are doubled.', tone: 'mixed', minRank: 1, rep: 2 },
  { id: 'trial', name: 'Equipment Trial', desc: 'New kit on loan: every crew is 12% more effective.', tone: 'good', minRank: 1, eff: 1.12 },
  { id: 'overtime', name: 'Overtime Shift', desc: 'Salaries ×1.3, incident bonuses ×1.5.', tone: 'mixed', minRank: 2, salary: 1.3, bonus: 1.5 },
  { id: 'roadworks', name: 'Roadworks Season', desc: 'Five streets are closed for repairs. Routes will be longer.', tone: 'bad', minRank: 1, roadworks: 5 },
  { id: 'fresh', name: 'Fresh Crews', desc: 'Everyone starts rested with high morale.', tone: 'good', minRank: 1, fresh: true },
  { id: 'busy_lines', name: 'Busy Lines', desc: 'Big incidents draw many more callers — watch for duplicate calls.', tone: 'mixed', minRank: 1, dupes: 1.8 },
];
export const MODIFIER_BY_ID = Object.fromEntries(MODIFIERS.map((m) => [m.id, m])) as Record<string, ModifierDef>;
type NumKey = 'rate' | 'pay' | 'bonus' | 'rep' | 'salary' | 'eff' | 'dupes';
export function modProduct(cfg: ShiftConfig, key: NumKey): number {
  let v = 1;
  for (const id of cfg.modifiers ?? []) { const m = MODIFIER_BY_ID[id]; if (m && typeof m[key] === 'number') v *= m[key] as number; }
  return v;
}

export interface ContractDef { id: string; label: (t: number) => string; reward: number; xp: number; minRank: number; target: (rank: number) => number; lowerIsBetter?: boolean }
export const CONTRACTS: ContractDef[] = [
  { id: 'medical', label: (t) => `Resolve ${t} medical incidents`, reward: 6000, xp: 40, minRank: 1, target: (r) => (r >= 4 ? 4 : 3) },
  { id: 'fire', label: (t) => `Resolve ${t} fire & rescue incidents`, reward: 6000, xp: 40, minRank: 1, target: () => 2 },
  { id: 'police', label: (t) => `Resolve ${t} police incidents`, reward: 5000, xp: 35, minRank: 1, target: (r) => (r >= 4 ? 4 : 3) },
  { id: 'no_waste', label: () => 'No unnecessary deployments (min. 5 dispatches)', reward: 5000, xp: 40, minRank: 1, target: () => 0, lowerIsBetter: true },
  { id: 'fast', label: (t) => `Average response under ${t} s`, reward: 8000, xp: 50, minRank: 1, target: () => 105, lowerIsBetter: true },
  { id: 'verify', label: (t) => `Confirm ${t} locations by read-back`, reward: 4000, xp: 30, minRank: 1, target: () => 3 },
  { id: 'merge', label: () => 'Link a duplicate call to its incident', reward: 5000, xp: 40, minRank: 1, target: () => 1 },
  { id: 'pursuit', label: () => 'Stop a fleeing vehicle', reward: 7000, xp: 50, minRank: 1, target: () => 1 },
  { id: 'all_calls', label: () => 'Answer every call', reward: 5000, xp: 35, minRank: 1, target: () => 0, lowerIsBetter: true },
  { id: 'streak', label: (t) => `Reach a streak of ${t} handled incidents`, reward: 6000, xp: 45, minRank: 1, target: (r) => (r >= 3 ? 7 : 5) },
  { id: 'false_alarm', label: () => 'Close a false alarm without sending anyone', reward: 4000, xp: 35, minRank: 1, target: () => 1 },
  { id: 'calm', label: (t) => `Calm ${t} panicking caller${t > 1 ? 's' : ''}`, reward: 4000, xp: 30, minRank: 1, target: () => 2 },
];
export const CONTRACT_BY_ID = Object.fromEntries(CONTRACTS.map((c) => [c.id, c])) as Record<string, ContractDef>;

export function rollExtras(seed: number, rank: number): { modifiers: string[]; contracts: Array<{ id: string; target: number }> } {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const modifiers: string[] = [];
  if (rng.chance(0.7)) { const m = rng.pick(MODIFIERS.filter((x) => x.minRank <= rank)); modifiers.push(m.id); }
  const pool = rng.shuffle(CONTRACTS.filter((c) => c.minRank <= rank));
  const contracts = pool.slice(0, 2).map((c) => ({ id: c.id, target: c.target(rank) }));
  return { modifiers, contracts };
}

export function contractProgress(st: GameState, c: { id: string; target: number }): { value: number; done: boolean; failed: boolean; text: string } {
  const s = st.stats;
  const def = CONTRACT_BY_ID[c.id];
  const ok = (cat: string) => s.byCategory[cat]?.ok ?? 0;
  let value = 0, done = false, failed = false;
  switch (c.id) {
    case 'medical': value = ok('medical'); done = value >= c.target; break;
    case 'fire': value = ok('fire'); done = value >= c.target; break;
    case 'police': value = ok('police'); done = value >= c.target; break;
    case 'no_waste': value = s.unnecessary; failed = value > 0; done = !failed && s.dispatches >= 5; break;
    case 'fast': { const n = s.responseTimes.length; value = n ? Math.round(s.responseTimes.reduce((a, b) => a + b, 0) / n) : 0; done = n >= 3 && value <= c.target; failed = n >= 3 && value > c.target; break; }
    case 'verify': value = s.verifiedOk; done = value >= c.target; break;
    case 'merge': value = s.merges; done = value >= c.target; break;
    case 'pursuit': value = s.pursuitsCaught; done = value >= c.target; break;
    case 'all_calls': value = s.callsMissed; failed = value > 0; done = !failed && s.callsAnswered >= 4; break;
    case 'streak': value = s.bestStreak; done = value >= c.target; break;
    case 'false_alarm': value = s.cleanFalseAlarms; done = value >= c.target; break;
    case 'calm': value = s.calmedCallers; done = value >= c.target; break;
  }
  return { value, done, failed, text: def ? def.label(c.target) : c.id };
}
