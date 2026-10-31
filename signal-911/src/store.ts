// Application store: screens, the active profile, the live engine, and glue to audio & persistence.
import { create } from 'zustand';
import { audio } from './audio/audioManager';
import { SaveManager } from './persistence';
import { GameEngine, type EngineEvent } from './sim/engine';
import {
  applyShift, careerConfig, computeResult, newProfile, setupFromProfile, temporarySetup, DEFAULT_SETTINGS, type Profile, type Settings, type ShiftResult,
} from './sim/profile';
import { CHAPTERS, SCENARIOS, TUTORIAL_CONFIG, baseConfig, ALL_DISTRICTS, dailyConfig, rollStoryline, rollSurprises } from './sim/scenarios';
import { evaluateAchievements, ACHIEVEMENT_BY_ID } from './sim/achievements';
import { rollExtras } from './sim/extras';
import { AiManager, aiApi } from './ai/aiClient';
import type { GameState, ShiftConfig } from './sim/types';

export type Screen = 'menu' | 'briefing' | 'newCareer' | 'load' | 'modes' | 'hub' | 'game' | 'report' | 'settings' | 'freeplay' | 'scenarios' | 'campaign' | 'endless';
export type HubTab = 'overview' | 'prep' | 'fleet' | 'crew' | 'shop' | 'upgrades' | 'career' | 'achievements' | 'stats';
export type SessionKind = 'career' | 'chapter' | 'free' | 'scenario' | 'endless' | 'tutorial' | 'daily';

export interface Session { kind: SessionKind; config: ShiftConfig; setupOpts?: Parameters<typeof temporarySetup>[0]; chapterId?: string; scenarioId?: string }

export const saves = new SaveManager();

interface AppStore {
  screen: Screen; back: Screen[]; hubTab: HubTab;
  profile: Profile | null; slot: string; settings: Settings; saveList: Awaited<ReturnType<SaveManager['list']>>; hasShiftSnapshot: boolean;
  brief: (s: Session) => void;
  pending: Session | null; setPending: (s: Session | null) => void; beginPending: () => void;
  engine: GameEngine | null; session: Session | null; rev: number; result: ShiftResult | null; endState: GameState | null; endlessOver: boolean;
  toast: { text: string; level: 'info' | 'good' | 'warn' | 'bad'; id: number } | null; paused: boolean; pauseMenu: boolean; showHelp: boolean;
  go: (s: Screen, tab?: HubTab) => void; goBack: () => void; setTab: (t: HubTab) => void;
  refresh: () => void; bump: () => void; showToast: (text: string, level?: 'info' | 'good' | 'warn' | 'bad') => void;
  init: () => Promise<void>;
  newCareer: (name: string, difficulty: ShiftConfig['difficulty']) => Promise<void>;
  loadSlot: (slot: string) => Promise<boolean>; saveSlot: (slot: string) => Promise<void>; autosave: () => Promise<void>; refreshSaves: () => Promise<void>;
  resetAll: () => Promise<void>; updateSettings: (p: Partial<Settings>) => void;
  mutateProfile: (fn: (p: Profile) => unknown) => void;
  startSession: (s: Session) => void; resumeShift: () => Promise<void>; abandon: () => void; finishShift: () => void;
  startCareerShift: () => void; startChapter: (id: string) => void; startScenario: (id: string) => void; startFree: (cfg: ShiftConfig, opts: Session['setupOpts']) => void;
  startTutorial: () => void; startEndless: (reset?: boolean) => void; setPauseMenu: (b: boolean) => void; startDaily: () => void;
  newAchievements: string[]; checkLiveAchievements: () => void; aiActive: boolean;
}

let toastId = 0;
let unsub: (() => void) | null = null;
let snapshotTimer: number | null = null;
let aiMgr: AiManager | null = null;
function stopAi() { aiMgr?.stop(); aiMgr = null; useApp.setState({ aiActive: false }); }
function startAi(engine: GameEngine) {
  stopAi();
  const s = useApp.getState().settings;
  if (!s.aiCallers) return;
  void aiApi.status().then((st) => {
    if (!st.configured || useApp.getState().engine !== engine) return;
    aiMgr = new AiManager(engine, s.aiMaxLines, (msg) => useApp.getState().showToast(msg, 'warn'));
    aiMgr.start();
    useApp.setState({ aiActive: true });
  }).catch(() => undefined);
}

export const useApp = create<AppStore>((set, get) => ({
  screen: 'menu', back: [], hubTab: 'overview', profile: null, slot: 'auto', settings: DEFAULT_SETTINGS, saveList: [], hasShiftSnapshot: false,
  brief: (s) => { set({ pending: s }); get().go('briefing'); },
  pending: null, setPending: (s) => set({ pending: s }), beginPending: () => { const s = get().pending; if (s) get().startSession(s); },
  newAchievements: [], aiActive: false,
  checkLiveAchievements: () => {
    const { profile, engine, session } = get();
    if (!profile || !engine || !session) return;
    const got = evaluateAchievements({ profile, st: engine.state, kind: session.kind, scenarioId: session.scenarioId, lifetimeIncludesShift: false });
    if (got.length) { for (const id of got) { get().showToast(`Achievement unlocked — ${ACHIEVEMENT_BY_ID[id].name}`, 'good'); } audio.good(); set({ newAchievements: [...get().newAchievements, ...got] }); void get().autosave(); }
  },
  engine: null, session: null, rev: 0, result: null, endState: null, endlessOver: false, toast: null, paused: false, pauseMenu: false, showHelp: false,

  go: (s, tab) => { audio.click(); set((st) => ({ screen: s, back: s === st.screen ? st.back : [...st.back, st.screen].slice(-8), hubTab: tab ?? st.hubTab })); },
  goBack: () => { audio.click(); set((st) => { const b = [...st.back]; const prev = b.pop() ?? 'menu'; return { screen: prev, back: b }; }); },
  setTab: (t) => set({ hubTab: t }),
  bump: () => set((s) => ({ rev: s.rev + 1 })),
  refresh: () => set((s) => ({ rev: s.rev + 1 })),
  showToast: (text, level = 'info') => set({ toast: { text, level, id: ++toastId } }),
  setPauseMenu: (b) => { const e = get().engine; if (e) e.state.paused = b ? true : false; set({ pauseMenu: b }); },

  init: async () => {
    const settings = saves.loadSettingsSync();
    audio.configure(settings);
    set({ settings });
    await get().refreshSaves();
    const snap = await saves.loadShift().catch(() => null);
    set({ hasShiftSnapshot: !!snap && snap.state.phase === 'running' });
  },

  refreshSaves: async () => { try { set({ saveList: await saves.list() }); } catch { set({ saveList: [] }); } },

  newCareer: async (name, difficulty) => {
    const p = newProfile(name || 'Dispatcher');
    p.flags.difficulty = difficulty;
    set({ profile: p, slot: 'auto', hubTab: 'overview' });
    await get().autosave();
    await saves.clearShift();
    set({ hasShiftSnapshot: false });
    get().go('hub', 'overview');
  },

  loadSlot: async (slot) => {
    try {
      const env = await saves.load(slot);
      if (!env) { get().showToast('That slot is empty', 'warn'); return false; }
      const settings = { ...get().settings };
      set({ profile: env.profile, slot, settings });
      get().showToast(`Loaded “${env.label}”`, 'good');
      get().go('hub', 'overview');
      return true;
    } catch (e) { get().showToast(String((e as Error).message ?? e), 'bad'); return false; }
  },

  saveSlot: async (slot) => {
    const p = get().profile;
    if (!p) return;
    try { await saves.save(slot, p, get().settings); await get().refreshSaves(); get().showToast(slot === 'auto' ? 'Autosaved' : `Saved to ${slot.replace('slot', 'slot ')}`, 'good'); }
    catch { get().showToast('Saving failed — browser storage unavailable', 'bad'); }
  },

  autosave: async () => {
    const { profile, settings } = get();
    if (!profile || !settings.autoSave) return;
    try { await saves.save('auto', profile, settings); await get().refreshSaves(); } catch { /* storage blocked */ }
  },

  resetAll: async () => {
    await saves.resetAll();
    set({ profile: null, saveList: [], hasShiftSnapshot: false, screen: 'menu', back: [] });
  },

  updateSettings: (p) => {
    const settings = { ...get().settings, ...p };
    set({ settings });
    audio.configure(settings);
    void saves.saveSettings(settings);
  },

  mutateProfile: (fn) => {
    const p = get().profile;
    if (!p) return;
    fn(p);
    p.updatedAt = Date.now();
    set({ profile: { ...p }, rev: get().rev + 1 });
    void get().autosave();
  },

  startSession: (s) => {
    audio.unlock();
    audio.stopAllRings();
    unsub?.();
    let profile = get().profile;
    if (!profile) { profile = newProfile('Guest'); set({ profile, slot: 'auto' }); }
    const settings = get().settings;
    const config = { ...s.config, hideIntense: settings.hideIntense };
    let engine: GameEngine;
    if (s.kind === 'career' || s.kind === 'chapter') engine = GameEngine.fromConfig(config, setupFromProfile(profile));
    else engine = GameEngine.fromConfig(config, temporarySetup({ ...s.setupOpts, rank: config.mode === 'tutorial' ? 1 : s.setupOpts?.rank ?? 7 }));
    engine.setSpeed(settings.defaultSpeed);
    unsub = engine.on((e: EngineEvent) => handleEngineEvent(e, engine));
    startAi(engine);
    audio.startOffice();
    set({ engine, session: { ...s, config }, screen: 'game', result: null, endState: null, pauseMenu: false, rev: get().rev + 1, newAchievements: [] });
    if (snapshotTimer) clearInterval(snapshotTimer);
    if (s.kind === 'career' || s.kind === 'chapter') snapshotTimer = window.setInterval(() => {
      const st = get();
      if (st.engine && st.engine.state.phase === 'running' && st.screen === 'game') void saves.saveShift(st.slot, st.engine.serialize()).catch(() => undefined);
    }, 15000);
  },

  resumeShift: async () => {
    const snap = await saves.loadShift();
    if (!snap) return;
    if (!get().profile) { const env = await saves.load(snap.slot); if (env) set({ profile: env.profile, slot: snap.slot }); }
    const engine = new GameEngine(snap.state);
    engine.state.paused = true;
    unsub?.();
    unsub = engine.on((e) => handleEngineEvent(e, engine));
    startAi(engine);
    audio.unlock(); audio.startOffice();
    const kind: SessionKind = snap.state.config.chapterId ? 'chapter' : 'career';
    set({ engine, session: { kind, config: snap.state.config, chapterId: snap.state.config.chapterId }, screen: 'game', pauseMenu: true, result: null, endState: null });
  },

  abandon: () => {
    unsub?.(); unsub = null; stopAi();
    audio.stopAllRings(); audio.setCallAmbience(null);
    if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
    void saves.clearShift();
    set({ engine: null, session: null, screen: get().profile ? 'modes' : 'menu', pauseMenu: false, hasShiftSnapshot: false });
  },

  finishShift: () => {
    const { engine, session, profile } = get();
    if (!engine || !session) return;
    const st = engine.state;
    if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
    stopAi();
    void saves.clearShift();
    audio.stopAllRings(); audio.setCallAmbience(null);
    let result: ShiftResult;
    let endlessOver = false;
    if (profile && (session.kind === 'career' || session.kind === 'chapter')) {
      result = applyShift(profile, st);
      set({ profile: { ...profile } });
      void get().autosave();
    } else {
      result = computeResult(st);
      if (profile && session.kind === 'scenario' && session.scenarioId) {
        const rec = profile.scenarios[session.scenarioId] ?? { best: '-', bestScore: 0, plays: 0 };
        rec.plays++; if (result.score.total > rec.bestScore) { rec.bestScore = result.score.total; rec.best = result.score.grade; }
        profile.scenarios[session.scenarioId] = rec;
        set({ profile: { ...profile } }); void get().autosave();
      }
      if (profile && session.kind === 'endless') {
        const cur = profile.endless.current;
        cur.wave++; cur.score += result.score.total;
        endlessOver = result.score.grade === 'D' || result.score.grade === 'F' || st.stats.casualties >= 3;
        if (endlessOver) {
          if (cur.score > profile.endless.bestScore) profile.endless.bestScore = cur.score;
          if (cur.wave > profile.endless.bestWave) profile.endless.bestWave = cur.wave;
          cur.active = false;
        } else cur.active = true;
        set({ profile: { ...profile } }); void get().autosave();
      }
      if (profile && session.kind === 'tutorial') { profile.flags.tutorialDone = true; set({ profile: { ...profile } }); void get().autosave(); }
      if (profile && session.kind === 'daily' && st.config.daily) {
        const prev = profile.daily[st.config.daily];
        if (!prev || result.score.total > prev.score) profile.daily[st.config.daily] = { score: result.score.total, grade: result.score.grade };
        set({ profile: { ...profile } }); void get().autosave();
      }
    }
    if (profile) {
      const got = evaluateAchievements({ profile, st, result, kind: session.kind, scenarioId: session.scenarioId, lifetimeIncludesShift: session.kind === 'career' || session.kind === 'chapter' });
      if (got.length) { set({ newAchievements: [...get().newAchievements, ...got], profile: { ...profile } }); void get().autosave(); }
    }
    set({ result, endState: st, endlessOver, screen: 'report' });
  },

  startCareerShift: () => {
    const p = get().profile;
    if (!p) return;
    const cfg = careerConfig(p);
    get().startSession({ kind: 'career', config: cfg });
  },
  startChapter: (id) => {
    const p = get().profile;
    const ch = CHAPTERS.find((c) => c.id === id);
    if (!p || !ch) return;
    const districts = ALL_DISTRICTS.filter((d) => p.rank >= (d === 'airport' ? 6 : 1) || true);
    const cfg = careerConfig(p, { ...ch.config(p.rank, districts), modifiers: [], mode: 'career', chapterId: id, title: `${ch.subtitle}: ${ch.title}`, briefing: ch.story });
    cfg.districts = careerConfig(p).districts;
    get().startSession({ kind: 'chapter', config: cfg, chapterId: id });
  },
  startScenario: (id) => {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc) return;
    const cfg = baseConfig({ ...sc.config, mode: 'scenario', scenarioId: id, title: sc.title, briefing: sc.description, difficulty: sc.difficulty, durationSec: sc.minutes * 60 });
    get().brief({ kind: 'scenario', config: cfg, scenarioId: id, setupOpts: { reduced: sc.reducedFleet, rank: 7, fleet: sc.fleet } });
  },
  startFree: (cfg, opts) => get().brief({ kind: 'free', config: rollSurprises(rollStoryline(cfg, opts?.rank ?? 7, cfg.seed, cfg.surprises === false ? 0 : 0.75), opts?.rank ?? 7, cfg.seed), setupOpts: opts }),
  startDaily: () => { const d = dailyConfig(); get().brief({ kind: 'daily', config: d.config, setupOpts: { units: d.units, rank: 7 } }); },
  startTutorial: () => get().brief({ kind: 'tutorial', config: TUTORIAL_CONFIG(), setupOpts: { units: 8, rank: 1 } }),
  startEndless: (reset) => {
    const p = get().profile ?? newProfile('Guest');
    if (!get().profile) set({ profile: p });
    if (reset || !p.endless.current.active) p.endless.current = { wave: 0, score: 0, active: true };
    const wave = p.endless.current.wave;
    const diff = wave < 2 ? 'standard' : wave < 5 ? 'hard' : 'expert';
    const cfg0 = baseConfig({ mode: 'endless', title: `Endless — Shift ${wave + 1}`, briefing: `Survive. Each shift is busier than the last. Score so far: ${p.endless.current.score}.`, difficulty: diff, durationSec: 8 * 60, incidentRate: 1 + wave * 0.12, endlessWave: wave, weather: (['clear', 'rain', 'fog', 'storm', 'heat', 'snow'] as const)[wave % 6], startHour: (6 + wave * 4) % 24, seed: 9000 + wave * 131 + (Date.now() % 997), events: wave >= 2 ? [{ type: wave % 2 ? 'storm' : 'rush_hour', at: 80, duration: 300 }] : [] });
    const cfg = rollSurprises(rollStoryline(cfg0, 7, cfg0.seed, wave >= 1 ? 0.8 : 0.5), 4 + Math.min(3, wave), cfg0.seed);
    const ex = rollExtras(cfg.seed, 5); cfg.modifiers = wave >= 1 ? ex.modifiers : []; cfg.contracts = ex.contracts;
    set({ endlessOver: false });
    get().brief({ kind: 'endless', config: cfg, setupOpts: { units: Math.min(18, 12 + Math.floor(wave / 2)), rank: 7 } });
  },
}));

function handleEngineEvent(e: EngineEvent, engine: GameEngine) {
  const st = useApp.getState();
  switch (e.type) {
    case 'ring': break;
    case 'answer': audio.pickup(); updateAmbience(engine); break;
    case 'hangup': audio.hangup(); updateAmbience(engine); break;
    case 'radio': audio.radioBlip(); break;
    case 'dispatch': audio.dispatchConfirm(); break;
    case 'arrive': audio.notify(); break;
    case 'alert': if (e.text === 'MAYDAY') audio.mayday(); else if (e.text === 'BOLO' || e.text === 'BOLO hit — pursuit') audio.attention(); else if (e.text === 'breaking') audio.stinger(); else audio.alert(); break;
    case 'caller_line': {
      const call = engine.state.calls[e.callId];
      const line = call?.transcript[call.transcript.length - 1];
      if (call && line?.who === 'CALLER' && engine.state.activeCallId === call.id && !/^\(/.test(line.text)) audio.voice(line.text, callerPitch(call), call.mood.panic > 65);
      break;
    }
    case 'resolved': audio.good(); break;
    case 'failed': audio.alert(); break;
    case 'notify': break;
    case 'ended': st.finishShift(); break;
    default: break;
  }
}
/** a voice pitch for the caller: children high, older callers a little lower, men lower than women */
export function callerPitch(call: import('./sim/types').Call): number {
  if (call.profile.archetype === 'child_caller') return 300;
  let h = 0; for (const ch of call.profile.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 2 ? 128 : 205) * (call.profile.age > 65 ? 0.92 : 1) * (0.94 + (h % 7) / 50);
}
export function updateAmbience(engine: GameEngine) {
  const id = engine.state.activeCallId;
  const call = id ? engine.state.calls[id] : null;
  audio.setCallAmbience(call && call.state === 'active' ? (engine.state.weather === 'rain' || engine.state.weather === 'storm' ? 'rain' : call.profile.ambience) : null);
}
