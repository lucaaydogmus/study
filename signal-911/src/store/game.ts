import { create } from 'zustand';
import { advance, initialClock, SPEEDS, type ClockState, type Speed } from '../sim/clock';
import { loadSave, writeSave, type SaveData } from '../sim/save';
import {
  answerCall, buildSummary, createWorld, dispatch, recall, step, type Config, type Summary, type World,
} from '../sim/world';
import type { DistrictId, Difficulty, Weather } from '../sim/types';

export type Phase = 'preshift' | 'shift' | 'summary';
export interface Selection { incidentId: number | null; unitId: string | null; stationId: string | null; districtId: DistrictId | null; pending: string[] }
export interface Filters { police: boolean; fire: boolean; medical: boolean; coverage: boolean; traffic: boolean }

interface GameState {
  phase: Phase;
  config: Config;
  world: World; // mutable simulation; `rev` signals that it changed
  rev: number;
  clock: ClockState;
  save: SaveData;
  saveOk: boolean;
  sel: Selection;
  filters: Filters;
  summary: Summary | null;
  focus: { x: number; y: number; nonce: number } | null;
  toast: string | null;

  tick(realDt: number): void;
  togglePause(): void;
  setSpeed(s: Speed): void;
  cycleSpeed(): void;
  setVolume(v: number): void;
  toggleMute(): void;
  setConfig(p: Partial<Pick<Config, 'shiftMinutes' | 'difficulty' | 'weather'>>): void;
  rerollSeed(): void;
  startShift(): void;
  endShift(): void;
  nextShift(): void;
  answer(callId: number): void;
  selectIncident(id: number | null): void;
  selectUnit(id: string | null): void;
  selectStation(id: string | null): void;
  selectDistrict(id: DistrictId | null): void;
  clearSelection(): void;
  togglePending(unitId: string): void;
  confirmDispatch(): void;
  recallUnit(id: string): void;
  toggleFilter(k: keyof Filters): void;
  focusOn(x: number, y: number): void;
}

const emptySel = (): Selection => ({ incidentId: null, unitId: null, stationId: null, districtId: null, pending: [] });
const newSeed = () => Math.floor(Math.random() * 1e9);

const save0 = loadSave();
const config0: Config = {
  seed: newSeed(), shiftMinutes: save0.settings.shiftMinutes, difficulty: save0.settings.difficulty, weather: 'clear',
};

let acc = 0;

export const useGame = create<GameState>((set, get) => {
  const bump = () => set({ rev: get().rev + 1 });
  const persistSettings = (patch: Partial<SaveData['settings']>) => {
    const save = { ...get().save, settings: { ...get().save.settings, ...patch } };
    set({ save, saveOk: writeSave(save) });
  };

  return {
    phase: 'preshift',
    config: config0,
    world: createWorld(config0),
    rev: 0,
    clock: initialClock(),
    save: save0,
    saveOk: true,
    sel: emptySel(),
    filters: { police: true, fire: true, medical: true, coverage: false, traffic: false },
    summary: null,
    focus: null,
    toast: null,

    tick: (realDt) => {
      const st = get();
      if (st.phase !== 'shift') return;
      const { clock, dt } = advance(st.clock, realDt);
      if (dt === 0) return;
      step(st.world, dt);
      acc += realDt;
      set({ clock });
      if (acc >= 0.1) { acc = 0; bump(); }
      if (st.world.over) get().endShift();
    },
    togglePause: () => {
      if (get().phase !== 'shift') return;
      set((s) => ({ clock: { ...s.clock, paused: !s.clock.paused } }));
    },
    setSpeed: (speed) => set((s) => ({ clock: { ...s.clock, speed } })),
    cycleSpeed: () => get().setSpeed(SPEEDS[(SPEEDS.indexOf(get().clock.speed) + 1) % SPEEDS.length]),
    setVolume: (volume) => persistSettings({ volume }),
    toggleMute: () => persistSettings({ muted: !get().save.settings.muted }),

    setConfig: (p) => {
      const config = { ...get().config, ...p };
      if (p.shiftMinutes !== undefined || p.difficulty !== undefined) {
        persistSettings({ shiftMinutes: config.shiftMinutes, difficulty: config.difficulty as Difficulty });
      }
      set({ config, world: createWorld(config), sel: emptySel(), rev: get().rev + 1 });
    },
    rerollSeed: () => {
      const config = { ...get().config, seed: newSeed() };
      set({ config, world: createWorld(config), rev: get().rev + 1 });
    },
    startShift: () => {
      const config = get().config;
      acc = 0;
      set({
        phase: 'shift', world: createWorld(config), sel: emptySel(), summary: null,
        clock: { ...initialClock(), paused: false, speed: 1 }, rev: get().rev + 1,
      });
    },
    endShift: () => {
      const st = get();
      if (st.phase !== 'shift') return;
      const summary = buildSummary(st.world);
      const s = st.save;
      const save: SaveData = {
        ...s,
        money: s.money + summary.net,
        xp: s.xp + summary.xp,
        reputation: Math.max(0, Math.min(100, s.reputation + summary.reputation)),
        completedShifts: s.completedShifts + 1,
      };
      set({ phase: 'summary', summary, save, saveOk: writeSave(save), clock: { ...st.clock, paused: true }, sel: emptySel() });
    },
    nextShift: () => {
      const config = { ...get().config, seed: newSeed() };
      set({ phase: 'preshift', config, world: createWorld(config), summary: null, sel: emptySel(), clock: initialClock(), rev: get().rev + 1 });
    },

    answer: (callId) => {
      const st = get();
      if (st.phase !== 'shift' || st.clock.paused) return;
      const inc = answerCall(st.world, callId);
      if (inc) set({ sel: { ...emptySel(), incidentId: inc.id }, focus: { x: inc.x, y: inc.y, nonce: Date.now() } });
      bump();
    },
    selectIncident: (id) => {
      const inc = id === null ? null : get().world.incidents.find((i) => i.id === id);
      set({ sel: { ...emptySel(), incidentId: id } });
      if (inc) set({ focus: { x: inc.x, y: inc.y, nonce: Date.now() } });
    },
    selectUnit: (id) => {
      const st = get();
      const u = id ? st.world.units.find((x) => x.id === id) : null;
      // With an incident open, clicking a free unit adds/removes it from the pending dispatch.
      if (u && st.sel.incidentId !== null && (u.status === 'AVAILABLE' || u.status === 'RETURNING') && st.phase === 'shift') {
        get().togglePending(u.id);
        set({ sel: { ...get().sel, unitId: u.id } });
        return;
      }
      set({ sel: { ...st.sel, unitId: id, stationId: null, districtId: null } });
    },
    selectStation: (id) => set({ sel: { ...emptySel(), stationId: id } }),
    selectDistrict: (id) => set({ sel: { ...emptySel(), districtId: id } }),
    clearSelection: () => set({ sel: emptySel() }),
    togglePending: (unitId) => {
      const p = get().sel.pending;
      set({ sel: { ...get().sel, pending: p.includes(unitId) ? p.filter((x) => x !== unitId) : [...p, unitId] } });
    },
    confirmDispatch: () => {
      const st = get();
      if (st.phase !== 'shift' || st.sel.incidentId === null || !st.sel.pending.length) return;
      dispatch(st.world, st.sel.incidentId, st.sel.pending);
      set({ sel: { ...st.sel, pending: [] } });
      bump();
    },
    recallUnit: (id) => { recall(get().world, id); bump(); },
    toggleFilter: (k) => set((s) => ({ filters: { ...s.filters, [k]: !s.filters[k] } })),
    focusOn: (x, y) => set({ focus: { x, y, nonce: Date.now() } }),
  };
});

export type { Weather };
