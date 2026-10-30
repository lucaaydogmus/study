import { create } from 'zustand';
import { advance, initialClock, SPEEDS, type ClockState, type Speed } from '../sim/clock';
import { loadSave, writeSave, type SaveData } from '../sim/save';

interface GameState {
  clock: ClockState;
  save: SaveData;
  saveOk: boolean;
  tick(realDt: number): void;
  togglePause(): void;
  setSpeed(s: Speed): void;
  cycleSpeed(): void;
  setVolume(v: number): void;
  toggleMute(): void;
}

export const useGame = create<GameState>((set, get) => ({
  clock: initialClock(),
  save: loadSave(),
  saveOk: true,
  tick: (realDt) => set((st) => ({ clock: advance(st.clock, realDt).clock })),
  togglePause: () => set((st) => ({ clock: { ...st.clock, paused: !st.clock.paused } })),
  setSpeed: (speed) => set((st) => ({ clock: { ...st.clock, speed } })),
  cycleSpeed: () => {
    const cur = get().clock.speed;
    get().setSpeed(SPEEDS[(SPEEDS.indexOf(cur) + 1) % SPEEDS.length]);
  },
  setVolume: (volume) => persist(set, get, { volume }),
  toggleMute: () => persist(set, get, { muted: !get().save.settings.muted }),
}));

function persist(
  set: (p: Partial<GameState>) => void,
  get: () => GameState,
  patch: Partial<SaveData['settings']>,
) {
  const save = { ...get().save, settings: { ...get().save.settings, ...patch } };
  set({ save, saveOk: writeSave(save) });
}
