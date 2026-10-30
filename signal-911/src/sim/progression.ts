// Career ranks, unlocks and XP curve.
export interface RankDef { rank: number; title: string; xp: number; unlocks: string[]; perk: string }
export const RANKS: RankDef[] = [
  { rank: 1, title: 'Trainee Dispatcher', xp: 0, unlocks: ['Downtown', 'Old Town', 'West Residential', 'Riverside'], perk: 'Core districts, basic fleet, guided incidents.' },
  { rank: 2, title: 'Junior Dispatcher', xp: 450, unlocks: ['Financial District', 'University District', 'Traffic units', 'Police vans', 'Paramedic response vehicles', 'Signal pre-emption'], perk: 'Larger incidents and dispatch assistants.' },
  { rank: 3, title: 'Emergency Dispatcher', xp: 1200, unlocks: ['Industrial Zone', 'Southside', 'Ladder trucks', 'Water rescue units', 'Supervisor units', 'Training academy'], perk: 'Industrial incidents, aerial fire response, robberies and pile-ups.' },
  { rank: 4, title: 'Senior Dispatcher', xp: 2400, unlocks: ['North Suburbs', 'Eastwood', 'Command vehicles', 'Medical supervisors'], perk: 'Remote districts and multi-agency incidents.' },
  { rank: 5, title: 'Shift Supervisor', xp: 4200, unlocks: ['Harbor District', 'Specialist Response', 'Heavy rescue', 'Specialist transport'], perk: 'Building collapses and tactical incidents.' },
  { rank: 6, title: 'Operations Coordinator', xp: 6800, unlocks: ['Airport District', 'Citywide events at full scale'], perk: 'The whole city is yours; events grow larger.' },
  { rank: 7, title: 'Dispatch Director', xp: 10000, unlocks: ['Everything'], perk: 'Director of Ravenport Emergency Dispatch.' },
];
export function rankForXp(xp: number): number {
  let r = 1;
  for (const d of RANKS) if (xp >= d.xp) r = d.rank;
  return r;
}
export function rankDef(rank: number): RankDef { return RANKS[Math.min(RANKS.length, Math.max(1, rank)) - 1]; }
export function nextRankXp(rank: number): number | null { return rank >= RANKS.length ? null : RANKS[rank].xp; }
