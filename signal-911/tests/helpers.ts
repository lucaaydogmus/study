import { GameEngine, DT } from '../src/sim/engine';
import { baseConfig } from '../src/sim/scenarios';
import { temporarySetup } from '../src/sim/profile';
import type { ShiftConfig } from '../src/sim/types';

export function makeEngine(over: Partial<ShiftConfig> = {}, setupOpts: Parameters<typeof temporarySetup>[0] = {}) {
  const cfg = baseConfig({
    title: 'Test', briefing: 'test', mode: 'free', difficulty: 'standard', durationSec: 600, incidentRate: 0, districts: ['downtown', 'oldtown', 'westres', 'riverside'], seed: 1234,
    script: [{ at: 1, template: 'kitchen_fire', district: 'downtown', archetype: 'worried_neighbor', accuracy: 'exact' }], ...over,
  });
  const e = GameEngine.fromConfig(cfg, temporarySetup({ rank: 3, ...setupOpts }));
  return e;
}
export function run(e: GameEngine, seconds: number, until?: () => boolean) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { e.step(DT); if (until && until()) return; }
}
export function firstIncident(e: GameEngine) { return Object.values(e.state.incidents)[0]; }
export function firstCall(e: GameEngine) { return Object.values(e.state.calls)[0]; }
