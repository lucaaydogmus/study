import { eventById, EVENTS } from './events';
import type { DistrictId } from './types';
import type { Summary, World } from './world';

export interface Career {
  active: string[];
  completed: string[];
  /** Times each event was finished successfully. */
  events: Record<string, number>;
  /** Times each district challenge was finished successfully. */
  challenges: Record<string, number>;
  bestGrade: string;
}

export const defaultCareer = (): Career => ({ active: ['dt_response', 'rain_shift', 'clean_shift'], completed: [], events: {}, challenges: {}, bestGrade: '-' });

export const LEVEL_XP = [0, 120, 300, 550, 850, 1200, 1650];
export const levelOf = (xp: number) => LEVEL_XP.reduce((lv, t, i) => (xp >= t ? i + 1 : lv), 1);
export const nextLevelXp = (xp: number) => LEVEL_XP[levelOf(xp)] ?? null;
export const CHALLENGE_LEVEL = 2;

export interface Objective {
  id: string; title: string; hint: string; reward: { money: number; xp: number };
  /** Progress 0-1 for a finished shift; 1 completes the objective. */
  check(w: World, s: Summary): number;
}

const avgIn = (w: World, d: DistrictId) => {
  const r = w.stats.districtResp[d] ?? [];
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
};
const GRADE_RANK = ['F', 'D', 'C', 'B', 'A', 'S'];
const atLeast = (g: string, min: string) => GRADE_RANK.indexOf(g) >= GRADE_RANK.indexOf(min);

export const OBJECTIVES: Objective[] = [
  { id: 'dt_response', title: 'Downtown response', hint: 'Attend at least 3 Downtown incidents with an average response of 45 s or better.', reward: { money: 2000, xp: 60 },
    check: (w) => { const r = w.stats.districtResp.downtown ?? []; const a = avgIn(w, 'downtown'); return r.length < 3 || a === null ? Math.min(1, r.length / 3) * 0.5 : a <= 45 ? 1 : 0.5; } },
  { id: 'north_response', title: 'Improve Northside response', hint: 'Attend at least 3 Northside incidents with an average response of 40 s or better.', reward: { money: 2000, xp: 60 },
    check: (w) => { const r = w.stats.districtResp.northside ?? []; const a = avgIn(w, 'northside'); return r.length < 3 || a === null ? Math.min(1, r.length / 3) * 0.5 : a <= 40 ? 1 : 0.5; } },
  { id: 'rain_shift', title: 'Weather the storm', hint: 'Finish a shift in rain or heavy rain with grade C or better.', reward: { money: 2500, xp: 70 },
    check: (w, s) => (w.weather !== 'clear' ? (atLeast(s.grade, 'C') ? 1 : 0.5) : 0) },
  { id: 'major_traffic', title: 'Clear a major disruption', hint: 'Resolve a serious collision that closed a road.', reward: { money: 2500, xp: 70 },
    check: (w) => Math.min(1, w.stats.majorTraffic) },
  { id: 'related', title: 'Coordinate related emergencies', hint: 'Resolve 3 incidents that were linked to each other in one shift.', reward: { money: 3000, xp: 80 },
    check: (w) => Math.min(1, w.stats.linkedResolved / 3) },
  { id: 'clean_shift', title: 'A clean shift', hint: 'Resolve at least 6 incidents with no failures.', reward: { money: 2500, xp: 70 },
    check: (_w, s) => (s.failed === 0 ? Math.min(1, s.resolved / 6) : Math.min(0.5, s.resolved / 12)) },
  { id: 'decider', title: 'Decisive coordinator', hint: 'Make 3 on-scene decisions in one shift.', reward: { money: 1500, xp: 50 },
    check: (w) => Math.min(1, w.stats.decisions / 3) },
  { id: 'swift', title: 'Swift response', hint: 'Get a first responder on scene within 45 s at least 5 times in one shift.', reward: { money: 2000, xp: 60 },
    check: (w) => Math.min(1, w.stats.fastResponses / 5) },
  { id: 'accurate', title: 'Precise dispatcher', hint: 'Dispatch accuracy of 85% or better with at least 8 dispatches.', reward: { money: 2000, xp: 60 },
    check: (w, s) => (w.stats.dispatched < 8 ? w.stats.dispatched / 16 : s.accuracy >= 0.85 ? 1 : 0.5) },
  { id: 'steady_line', title: 'Steady line', hint: 'Answer at least 8 calls without losing a caller or missing a call.', reward: { money: 1500, xp: 50 },
    check: (_w, s) => (s.hungUp || s.missed ? 0 : Math.min(1, s.answered / 8)) },
];
export const objectiveById = (id: string) => OBJECTIVES.find((o) => o.id === id);

export interface CareerOutcome {
  career: Career; xp: number; money: number; level: number; levelUp: boolean;
  completed: Objective[]; progress: { id: string; value: number }[];
  scenario: { name: string; passed: boolean; first: boolean } | null;
  unlocked: string[];
}

/** Evaluate a finished shift against active objectives and the chosen scenario, and move the career forward. */
export function evaluateCareer(career: Career, w: World, s: Summary, xpBefore: number): CareerOutcome {
  const next: Career = { ...career, active: [...career.active], completed: [...career.completed], events: { ...career.events }, challenges: { ...career.challenges } };
  let xp = s.xp, money = 0;
  const progress = career.active.map((id) => ({ id, value: objectiveById(id)?.check(w, s) ?? 0 }));
  const completed: Objective[] = [];
  for (const p of progress) {
    const o = objectiveById(p.id);
    if (!o || p.value < 1) continue;
    completed.push(o); xp += o.reward.xp; money += o.reward.money;
    next.completed.push(o.id);
    next.active = next.active.filter((a) => a !== o.id);
  }
  // Refill to 3 objectives, preferring ones not yet completed, then re-using old ones.
  const refill = [...OBJECTIVES.filter((o) => !next.completed.includes(o.id)), ...OBJECTIVES.filter((o) => next.completed.includes(o.id))];
  for (const o of refill) { if (next.active.length >= 3) break; if (!next.active.includes(o.id)) next.active.push(o.id); }

  let scenario: CareerOutcome['scenario'] = null;
  const ev = eventById(w.config.event);
  const passGrade = atLeast(s.grade, 'C');
  if (ev) {
    const passed = passGrade && s.resolved >= ev.goal.resolved && s.failed <= ev.goal.maxFailed;
    const first = passed && !next.events[ev.id];
    if (passed) { next.events[ev.id] = (next.events[ev.id] ?? 0) + 1; xp += first ? ev.reward.xp : Math.round(ev.reward.xp / 3); money += first ? ev.reward.money : Math.round(ev.reward.money / 3); }
    scenario = { name: ev.name, passed, first };
  } else if (w.config.challenge) {
    const d = w.config.challenge;
    const resolved = w.stats.districtResolved[d] ?? 0;
    const passed = resolved >= 5 && s.failed <= 1;
    const first = passed && !next.challenges[d];
    if (passed) { next.challenges[d] = (next.challenges[d] ?? 0) + 1; xp += first ? 80 : 25; money += first ? 3000 : 800; }
    scenario = { name: `${w.city.districts.find((x) => x.id === d)!.name} challenge`, passed, first };
  }
  if (GRADE_RANK.indexOf(s.grade) > GRADE_RANK.indexOf(next.bestGrade)) next.bestGrade = s.grade;
  const before = levelOf(xpBefore), after = levelOf(xpBefore + xp);
  const levelUp = after > before;
  if (levelUp) money += 2000 * (after - before);
  const unlocked = EVENTS.filter((e) => e.level > before && e.level <= after).map((e) => e.name);
  if (after >= CHALLENGE_LEVEL && before < CHALLENGE_LEVEL) unlocked.push('District challenges');
  return { career: next, xp, money, level: after, levelUp, completed, progress, scenario, unlocked };
}
