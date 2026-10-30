// Long-term goals. Checked live during a shift (cheap conditions) and again on the shift report.
import type { Profile, ShiftResult } from './profile';
import { CHAPTERS } from './scenarios';
import type { GameState } from './types';

export interface AchCtx { profile: Profile; st?: GameState; result?: ShiftResult | null; kind?: string; scenarioId?: string; lifetimeIncludesShift?: boolean }
export interface AchievementDef { id: string; name: string; desc: string; icon: string; tier: 'bronze' | 'silver' | 'gold'; check: (c: AchCtx) => boolean }

const tot = (c: AchCtx, life: keyof Profile['stats'], shift: keyof GameState['stats']) => {
  const L = (c.profile.stats[life] as number) ?? 0;
  const S = c.st && !c.lifetimeIncludesShift ? ((c.st.stats[shift] as number) ?? 0) : 0;
  return L + S;
};
const incidents = (c: AchCtx) => (c.st ? Object.values(c.st.incidents) : []);

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'tutorial', name: 'Headset On', desc: 'Complete the tutorial.', icon: 'book', tier: 'bronze', check: (c) => c.profile.flags.tutorialDone },
  { id: 'first_call', name: '911, What’s Your Emergency?', desc: 'Answer your first call.', icon: 'phone', tier: 'bronze', check: (c) => tot(c, 'answered', 'callsAnswered') >= 1 },
  { id: 'first_save', name: 'First Response', desc: 'Resolve your first incident.', icon: 'check', tier: 'bronze', check: (c) => tot(c, 'resolved', 'resolved') >= 1 },
  { id: 'centurion', name: 'Centurion', desc: 'Resolve 100 incidents.', icon: 'trophy', tier: 'gold', check: (c) => tot(c, 'resolved', 'resolved') >= 100 },
  { id: 'lifesaver', name: 'Lifesaver', desc: 'Help 25 people in danger.', icon: 'cross', tier: 'silver', check: (c) => tot(c, 'livesHelped', 'livesHelped') >= 25 },
  { id: 'perfect', name: 'Flawless', desc: 'Earn an S grade.', icon: 'star', tier: 'gold', check: (c) => c.result?.score.grade === 'S' },
  { id: 'straight_a', name: 'Straight A’s', desc: 'Earn A or better on five shifts.', icon: 'star', tier: 'silver', check: (c) => (c.profile.stats.gradeA ?? 0) + (!c.lifetimeIncludesShift && c.result && ['A', 'S'].includes(c.result.score.grade) ? 1 : 0) >= 5 },
  { id: 'raccoon', name: 'Raccoon Whisperer', desc: 'Expose a “burglar” as a raccoon without sending anyone.', icon: 'help', tier: 'bronze', check: (c) => incidents(c).some((i) => i.templateId === 'animal_burglar' && i.twistRevealed && i.everAssigned.length === 0 && i.outcome === 'false_alarm') },
  { id: 'prank_buster', name: 'Not Funny', desc: 'Realise a joke call was real — and save the day.', icon: 'alert', tier: 'silver', check: (c) => incidents(c).some((i) => i.templateId === 'prank_or_real' && i.requires.length > 0 && i.outcome === 'success') },
  { id: 'clean_close', name: 'Nothing to See Here', desc: 'Close a false alarm without sending a unit.', icon: 'check', tier: 'bronze', check: (c) => (c.st?.stats.cleanFalseAlarms ?? 0) >= 1 },
  { id: 'read_back', name: 'Read-Back Pro', desc: 'Confirm 25 locations by reading them back.', icon: 'pin', tier: 'silver', check: (c) => tot(c, 'verifies', 'verifiedOk') >= 25 },
  { id: 'first_pursuit', name: 'Hot Pursuit', desc: 'Stop a fleeing vehicle.', icon: 'car', tier: 'bronze', check: (c) => tot(c, 'pursuits', 'pursuitsCaught') >= 1 },
  { id: 'pursuit_ace', name: 'Pursuit Ace', desc: 'Stop 10 fleeing vehicles.', icon: 'car', tier: 'gold', check: (c) => tot(c, 'pursuits', 'pursuitsCaught') >= 10 },
  { id: 'first_merge', name: 'Heard That One', desc: 'Link a duplicate call to its incident.', icon: 'layers', tier: 'bronze', check: (c) => tot(c, 'merges', 'merges') >= 1 },
  { id: 'detective', name: 'Duplicate Detective', desc: 'Link 15 duplicate calls.', icon: 'layers', tier: 'silver', check: (c) => tot(c, 'merges', 'merges') >= 15 },
  { id: 'streak5', name: 'In the Zone', desc: 'Handle 5 incidents in a row without a failure.', icon: 'bolt', tier: 'bronze', check: (c) => Math.max(c.profile.stats.bestStreak ?? 0, c.st?.stats.bestStreak ?? 0) >= 5 },
  { id: 'streak12', name: 'Unbreakable', desc: 'Reach a streak of 12.', icon: 'bolt', tier: 'gold', check: (c) => Math.max(c.profile.stats.bestStreak ?? 0, c.st?.stats.bestStreak ?? 0) >= 12 },
  { id: 'calm_voice', name: 'Calm Voice', desc: 'Talk a panicking caller down.', icon: 'phone', tier: 'bronze', check: (c) => tot(c, 'calmed', 'calmedCallers') >= 1 },
  { id: 'counsellor', name: 'The Counsellor', desc: 'Calm 20 panicking callers.', icon: 'phone', tier: 'silver', check: (c) => tot(c, 'calmed', 'calmedCallers') >= 20 },
  { id: 'transfer_pro', name: 'Wrong Number, Right Answer', desc: 'Transfer an out-of-area caller to the right agency.', icon: 'transfer', tier: 'bronze', check: (c) => (c.st?.stats.transfersOk ?? 0) >= 1 },
  { id: 'mutual', name: 'Call in the Cavalry', desc: 'Request mutual aid.', icon: 'radio', tier: 'bronze', check: (c) => (c.st?.stats.mutualAid ?? 0) >= 1 },
  { id: 'no_waste', name: 'Surgical', desc: 'Finish a shift with 8+ dispatches and no unnecessary deployments.', icon: 'check', tier: 'silver', check: (c) => !!c.result && !!c.st && c.st.stats.dispatches >= 8 && c.st.stats.unnecessary === 0 },
  { id: 'zero_cas', name: 'Nobody Left Behind', desc: 'Resolve 10+ incidents in a shift with no casualties.', icon: 'cross', tier: 'silver', check: (c) => !!c.result && !!c.st && c.st.stats.resolved >= 10 && c.st.stats.casualties === 0 },
  { id: 'night_owl', name: 'Night Owl', desc: 'Complete a shift that starts between 22:00 and 04:00.', icon: 'moon', tier: 'bronze', check: (c) => !!c.result && !!c.st && (c.st.config.startHour >= 22 || c.st.config.startHour < 4) },
  { id: 'iron', name: 'Iron Dispatcher', desc: 'Complete a 30-minute shift.', icon: 'clock', tier: 'silver', check: (c) => !!c.result && !!c.st && c.st.config.durationSec >= 1800 && c.st.time >= 1790 },
  { id: 'storm_chaser', name: 'Storm Chaser', desc: 'Score B or better in Storm Warning.', icon: 'bolt', tier: 'silver', check: (c) => c.scenarioId === 'storm_warning' && !!c.result && ['S', 'A', 'B'].includes(c.result.score.grade) },
  { id: 'contractor', name: 'Contractor', desc: 'Complete 10 shift contracts.', icon: 'coins', tier: 'silver', check: (c) => tot(c, 'contracts', 'contractBonus') >= 10 },
  { id: 'fleet20', name: 'Fleet Commander', desc: 'Own 20 vehicles.', icon: 'car', tier: 'silver', check: (c) => c.profile.units.length >= 20 },
  { id: 'coordinator', name: 'Operations Coordinator', desc: 'Reach rank 6.', icon: 'trophy', tier: 'silver', check: (c) => c.profile.rank >= 6 },
  { id: 'director', name: 'Dispatch Director', desc: 'Reach the top rank.', icon: 'trophy', tier: 'gold', check: (c) => c.profile.rank >= 7 },
  { id: 'campaign', name: 'The Whole Story', desc: 'Complete the campaign.', icon: 'book', tier: 'gold', check: (c) => CHAPTERS.every((ch) => c.profile.campaign.completed.includes(ch.id)) },
  { id: 'endless5', name: 'Endurance', desc: 'Survive 5 shifts in one Endless run.', icon: 'bolt', tier: 'silver', check: (c) => Math.max(c.profile.endless.bestWave, c.profile.endless.current.wave) >= 5 },
  { id: 'daily', name: 'Daily Habit', desc: 'Complete a Daily Challenge.', icon: 'clock', tier: 'bronze', check: (c) => Object.keys(c.profile.daily ?? {}).length >= 1 },
  { id: 'daily7', name: 'Regular', desc: 'Complete 7 different Daily Challenges.', icon: 'clock', tier: 'gold', check: (c) => Object.keys(c.profile.daily ?? {}).length >= 7 },
];
export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a])) as Record<string, AchievementDef>;

/** returns ids newly unlocked (and records them on the profile) */
export function evaluateAchievements(ctx: AchCtx): string[] {
  const got = (ctx.profile.achievements ??= {});
  const out: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (got[a.id]) continue;
    let ok = false;
    try { ok = a.check(ctx); } catch { ok = false; }
    if (ok) { got[a.id] = Date.now(); out.push(a.id); }
  }
  return out;
}
