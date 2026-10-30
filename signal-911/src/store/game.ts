import { create } from 'zustand';
import { advance, initialClock, SPEEDS, type ClockState, type Speed } from '../sim/clock';
import { loadSave, writeSave, type SaveData } from '../sim/save';
import {
  answerCall, buildSummary, createWorld, decide, dispatch, fleetAfterShift, recall, step, type Config, type Summary, type World,
} from '../sim/world';
import { ask, endCall } from '../sim/calls';
import * as fleetOps from '../sim/fleet';
import type { Result } from '../sim/fleet';
import { CHALLENGE_LEVEL, evaluateCareer, levelOf, type CareerOutcome } from '../sim/career';
import { EVENTS } from '../sim/events';
import type { EventId } from '../sim/events';
import { configureAudio, sfx, unlockAudio } from '../audio';
import type { DistrictId, Difficulty, VehicleId, Weather } from '../sim/types';

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
  outcome: CareerOutcome | null;
  careerOpen: boolean;
  focus: { x: number; y: number; nonce: number } | null;
  toast: string | null;
  depotOpen: boolean;

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
  askQuestion(key: string): void;
  decide(optionId: string): void;
  openDepot(open: boolean): void;
  openCareer(open: boolean): void;
  setScenario(kind: 'standard' | 'event' | 'challenge', id?: string): void;
  buyVehicle(vehicle: VehicleId, stationId: string): void;
  sellUnit(id: string): void;
  moveUnitTo(id: string, stationId: string): void;
  installUpgrade(id: string, upgrade: string): void;
  removeUpgrade(id: string, upgrade: string): void;
  serviceUnits(ids: string[]): void;
  hangUp(): void;
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
let lastSeq = 0;
let lastRing = -10;
configureAudio(save0.settings.volume, save0.settings.muted);
const LOG_SOUND = { dispatch: sfx.dispatch, arrive: sfx.arrive, warn: sfx.warn, good: sfx.good, bad: sfx.bad } as const;

export const useGame = create<GameState>((set, get) => {
  const bump = () => set({ rev: get().rev + 1 });
  /** Apply a fleet change (pre-shift only): validate, save, and rebuild the preview world. */
  const fleetAction = (op: (fleet: SaveData['fleet'], money: number) => Result) => {
    const st = get();
    if (st.phase !== 'preshift') return;
    const r = op(st.save.fleet, st.save.money);
    if (!r.ok) { set({ toast: r.error }); setTimeout(() => get().toast === r.error && set({ toast: null }), 2500); return; }
    const save = { ...st.save, fleet: r.fleet, money: r.money };
    set({ save, saveOk: writeSave(save), world: createWorld(st.config, r.fleet), sel: emptySel(), rev: st.rev + 1 });
  };
  const persistSettings = (patch: Partial<SaveData['settings']>) => {
    const save = { ...get().save, settings: { ...get().save.settings, ...patch } };
    configureAudio(save.settings.volume, save.settings.muted);
    set({ save, saveOk: writeSave(save) });
  };

  return {
    phase: 'preshift',
    config: config0,
    world: createWorld(config0, save0.fleet),
    rev: 0,
    clock: initialClock(),
    save: save0,
    saveOk: true,
    sel: emptySel(),
    filters: { police: true, fire: true, medical: true, coverage: false, traffic: false },
    summary: null,
    outcome: null,
    careerOpen: false,
    focus: null,
    toast: null,
    depotOpen: false,

    tick: (realDt) => {
      const st = get();
      if (st.phase !== 'shift') return;
      const { clock, dt } = advance(st.clock, realDt);
      if (dt === 0) return;
      step(st.world, dt);
      // Sound: ring while calls wait; one cue per kind of new log entry.
      const w = st.world;
      if (w.calls.some((c) => c.status === 'ringing') && w.time - lastRing >= 2.4) { lastRing = w.time; sfx.ring(); }
      if (w.logSeq !== lastSeq) {
        const fresh = w.log.slice(-Math.min(w.log.length, w.logSeq - lastSeq));
        lastSeq = w.logSeq;
        for (const k of new Set(fresh.map((l) => l.kind))) if (k in LOG_SOUND) LOG_SOUND[k as keyof typeof LOG_SOUND]();
      }
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
      set({ config, world: createWorld(config, get().save.fleet), sel: emptySel(), rev: get().rev + 1 });
    },
    rerollSeed: () => {
      const config = { ...get().config, seed: newSeed() };
      set({ config, world: createWorld(config, get().save.fleet), rev: get().rev + 1 });
    },
    startShift: () => {
      const config = get().config;
      acc = 0; lastSeq = 0; lastRing = -10;
      unlockAudio();
      set({
        phase: 'shift', world: createWorld(config, get().save.fleet), sel: emptySel(), summary: null,
        clock: { ...initialClock(), paused: false, speed: 1 }, rev: get().rev + 1,
      });
    },
    endShift: () => {
      const st = get();
      if (st.phase !== 'shift') return;
      const summary = buildSummary(st.world);
      const s = st.save;
      const outcome = evaluateCareer(s.career, st.world, summary, s.xp);
      const save: SaveData = {
        ...s,
        money: s.money + summary.net + outcome.money,
        xp: s.xp + outcome.xp,
        reputation: Math.max(0, Math.min(100, s.reputation + summary.reputation)),
        completedShifts: s.completedShifts + 1,
        fleet: fleetAfterShift(st.world),
        career: outcome.career,
      };
      set({ phase: 'summary', summary, outcome, save, saveOk: writeSave(save), clock: { ...st.clock, paused: true }, sel: emptySel() });
    },
    nextShift: () => {
      const config: Config = { ...get().config, seed: newSeed() };
      set({ phase: 'preshift', config, world: createWorld(config, get().save.fleet), summary: null, outcome: null, sel: emptySel(), clock: initialClock(), rev: get().rev + 1 });
    },

    answer: (callId) => {
      const st = get();
      if (st.phase !== 'shift' || st.clock.paused) return;
      const inc = answerCall(st.world, callId);
      if (!inc) { set({ toast: 'Finish the current call first.' }); setTimeout(() => get().toast && set({ toast: null }), 2500); return; }
      sfx.answer();
      lastSeq = st.world.logSeq;
      set({ sel: { ...emptySel(), incidentId: inc.id } });
      bump();
    },
    askQuestion: (key) => {
      const st = get();
      const inc = st.world.incidents.find((i) => i.id === st.world.activeCall);
      if (st.phase !== 'shift' || st.clock.paused || !inc) return;
      if (ask(st.world, inc, key)) { sfx.select(); bump(); }
    },
    decide: (optionId) => {
      const st = get();
      if (st.phase !== 'shift' || st.sel.incidentId === null) return;
      const r = decide(st.world, st.sel.incidentId, optionId);
      if (r.ok) sfx.dispatch(); else { set({ toast: r.error ?? 'Not available.' }); setTimeout(() => set({ toast: null }), 2500); }
      bump();
    },
    openCareer: (open) => set({ careerOpen: open && get().phase === 'preshift' }),
    setScenario: (kind, id) => {
      const cur = get().config;
      const level = levelOf(get().save.xp);
      const ev = id ? EVENTS.find((e) => e.id === id) : undefined;
      if ((kind === 'event' && (!ev || ev.level > level)) || (kind === 'challenge' && level < CHALLENGE_LEVEL)) {
        set({ toast: 'That scenario is still locked.' }); setTimeout(() => set({ toast: null }), 2500); return;
      }
      const config: Config = { ...cur, event: kind === 'event' ? (id as EventId) : null, challenge: kind === 'challenge' ? (id as DistrictId) : null };
      if (kind === 'event' && config.event) config.weather = 'clear'; // the event decides its own weather
      set({ config, world: createWorld(config, get().save.fleet), sel: emptySel(), rev: get().rev + 1 });
    },
    openDepot: (open) => set({ depotOpen: open && get().phase === 'preshift' }),
    buyVehicle: (v, st) => fleetAction((f, m) => fleetOps.buyVehicle(f, m, v, st)),
    sellUnit: (id) => fleetAction((f, m) => fleetOps.sellUnit(f, m, id)),
    moveUnitTo: (id, st) => fleetAction((f, m) => fleetOps.moveUnit(f, m, id, st)),
    installUpgrade: (id, up) => fleetAction((f, m) => fleetOps.installUpgrade(f, m, id, up)),
    removeUpgrade: (id, up) => fleetAction((f, m) => fleetOps.removeUpgrade(f, m, id, up)),
    serviceUnits: (ids) => fleetAction((f, m) => fleetOps.serviceUnits(f, m, ids)),
    hangUp: () => {
      const st = get();
      const inc = st.world.incidents.find((i) => i.id === st.world.activeCall);
      if (!inc) return;
      endCall(st.world, inc, 'player');
      sfx.end();
      bump();
      if (inc.believedNode !== null) set({ focus: { x: inc.x, y: inc.y, nonce: Date.now() } });
    },
    selectIncident: (id) => {
      const inc = id === null ? null : get().world.incidents.find((i) => i.id === id);
      set({ sel: { ...emptySel(), incidentId: id } });
      if (inc && inc.believedNode !== null) set({ focus: { x: inc.x, y: inc.y, nonce: Date.now() } });
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
