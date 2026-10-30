/** Deterministic game clock. Real time in, game seconds out. */
export type Speed = 1 | 2 | 4;
export const SPEEDS: readonly Speed[] = [1, 2, 4];

export interface ClockState {
  gameSeconds: number;
  paused: boolean;
  speed: Speed;
}

export const initialClock = (): ClockState => ({ gameSeconds: 0, paused: true, speed: 1 });

/** Advance by realDt seconds; returns the game seconds elapsed (0 when paused). */
export function advance(clock: ClockState, realDt: number): { clock: ClockState; dt: number } {
  if (clock.paused || realDt <= 0) return { clock, dt: 0 };
  // Cap a single step so a backgrounded tab cannot skip the simulation ahead.
  const dt = Math.min(realDt, 0.25) * clock.speed;
  return { clock: { ...clock, gameSeconds: clock.gameSeconds + dt }, dt };
}

export function formatClock(gameSeconds: number): string {
  const m = Math.floor(gameSeconds / 60);
  const s = Math.floor(gameSeconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
