import { stopSpeech } from '../audio/speech';
import { ResourcesPanel } from './Resources';
import { useCallback, useEffect, useRef, useState } from 'react';
import { audio } from '../audio/audioManager';
import { addressOf } from '../sim/city';
import { assistsOn, gameClock, recommendFor, type GameEngine } from '../sim/engine';
import { WEATHER_LABEL } from '../sim/events';
import { fmtMoneyShort } from './util';
import { updateAmbience, useApp } from '../store';
import { BottomPanel, type BottomTab } from './BottomPanel';
import { Badge, Btn, Icon, Modal, Toast, fmtTime, weatherIcon } from './common';
import { MapView, LAYERS, type LayerId } from './MapView';
import { RightPanel, StatusBadge } from './RightPanel';
import { Coach, coachHint } from './Coach';
import type { Preview } from './DispatchConsole';
import { PauseMenu } from './PauseMenu';
import { SERVICE_META, isAir } from '../sim/fleet';
import { computeScore } from '../sim/scoring';
import { contractProgress, MODIFIER_BY_ID } from '../sim/extras';
import { GRADE_COLOR } from './common';
import { RecordsDock, RecordsTerminal, threatKnown } from './Ops';
import { BoloDock, CctvViewer, DecisionCards, MultiBar, NewsTicker, StatusDock, useCctvSink } from './Field';
import { MapMenu, handleDrop, type MenuState } from './MapMenu';
import { Cinematics } from './Cinematic';

const CAT_ICON: Record<string, string> = { medical: 'cross', fire: 'flame', police: 'shield', unusual: 'help' };

function useSizes() {
  const read = () => { try { return JSON.parse(localStorage.getItem('signal911.layout') ?? '') as { l: number; r: number; b: number }; } catch { return { l: 290, r: 380, b: 270 }; } };
  const [s, setS] = useState(read);
  useEffect(() => { try { localStorage.setItem('signal911.layout', JSON.stringify(s)); } catch { /* ignore */ } }, [s]);
  return [s, setS] as const;
}

export function GameScreen() {
  const engine = useApp((s) => s.engine)!;
  const session = useApp((s) => s.session)!;
  const settings = useApp((s) => s.settings);
  const pauseMenu = useApp((s) => s.pauseMenu);
  useApp((s) => s.rev);
  const resPanel = useApp((s) => s.resPanel);
  const bump = useApp((s) => s.bump);
  const [sizes, setSizes] = useSizes();
  const [layer, setLayer] = useState<LayerId>('normal');
  const [target, setTarget] = useState<{ kind: 'loc' | 'repos'; id: string } | null>(null);
  const [tab, setTab] = useState<BottomTab>('call');
  const [layerMenu, setLayerMenu] = useState(false);
  const [focus, setFocus] = useState<{ x: number; y: number; zoom?: number; key: number } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [preview, setPreview] = useState<Preview>(null);
  const [collapsed, setCollapsed] = useState({ l: false, r: false, b: false });
  const [terminal, setTerminal] = useState(false);
  const [cctv, setCctv] = useState<Parameters<typeof CctvViewer>[0]['view'] | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const closeMenu = useCallback(() => setMenu(null), []);
  useCctvSink(setCctv);
  const st = engine.state;
  const focusKey = useRef(0);
  const doFocus = useCallback((x: number, y: number, zoom?: number) => setFocus({ x, y, zoom, key: ++focusKey.current }), []);

  // ── simulation loop (decoupled from React rendering) ──
  useEffect(() => {
    let raf = 0, last = performance.now(), lastBump = 0, wasCalls = '', lastAch = 0, lastBeat = 0, wasPaused = false;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000; last = now;
      if (document.hidden) { engine.state.paused = engine.state.paused || false; }
      engine.update(dt);
      const ringing = Object.values(engine.state.calls).some((c) => c.state === 'ringing');
      audio.setRinging(ringing && engine.state.phase === 'running' && !engine.state.paused);
      if (useApp.getState().settings.heartbeat && engine.state.phase === 'running' && !engine.state.paused) { const s = dispatcherStress(engine); if (s >= 62 && now - lastBeat > 60000 / (68 + s * 0.9)) { lastBeat = now; audio.heartbeat(); } }
      if (now - lastAch > 3000) { lastAch = now; useApp.getState().checkLiveAchievements(); }
      if (now - lastBump > 120) { lastBump = now; useApp.getState().bump(); const aid = engine.state.activeCallId; const key = `${aid ?? ''}:${aid ? engine.state.calls[aid]?.state ?? '' : ''}`; if (key !== wasCalls) { wasCalls = key; updateAmbience(engine); } }
      // pausing (or leaving the tab) silences whoever was talking
      const paused = engine.state.paused || engine.state.phase !== 'running'; if (paused && !wasPaused) stopSpeech(); wasPaused = paused;
    };
    raf = requestAnimationFrame(loop);
    const onVis = () => { if (document.hidden && settings.autoSave) { engine.state.paused = true; bump(); } };
    document.addEventListener('visibilitychange', onVis);
    audio.startOfficeLife();
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); audio.setRinging(false); audio.stopOfficeLife(); stopSpeech(); };
  }, [engine]);

  // answering a call brings the console forward
  const activeId = st.activeCallId;
  useEffect(() => { if (activeId) { setTab('call'); setSizes((s) => (s.b < 250 ? { ...s, b: 280 } : s)); setCollapsed((c) => ({ ...c, b: false })); } }, [activeId]);

  // ── keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const eng = engine, s = eng.state;
      if (e.key === ' ') { e.preventDefault(); if (!pauseMenu) { eng.togglePause(); bump(); } }
      else if (e.key === '1') { eng.setSpeed(1); bump(); } else if (e.key === '2') { eng.setSpeed(2); bump(); } else if (e.key === '3') { eng.setSpeed(3); bump(); }
      else if (e.key === 'a' || e.key === 'A') { const c = Object.values(s.calls).filter((x) => x.state === 'ringing').sort((x, y) => x.ringStart - y.ringStart)[0]; if (c) { eng.answerCall(c.id); bump(); } }
      else if (e.key === 'h' || e.key === 'H') { if (s.activeCallId) { eng.holdCall(s.activeCallId); } else { const c = Object.values(s.calls).find((x) => x.state === 'hold'); if (c) eng.answerCall(c.id); } bump(); }
      else if (e.key === 'e' || e.key === 'E') { if (s.activeCallId) { eng.endCall(s.activeCallId); bump(); } }
      else if (e.key === 'm' || e.key === 'M') { const i = LAYERS.findIndex((l) => l.id === layer); setLayer(LAYERS[(i + 1) % LAYERS.length].id); }
      else if (e.key === 'd' || e.key === 'D') { const c = s.activeCallId ? s.calls[s.activeCallId] : null; if (c) { eng.select('incident', c.incidentId); bump(); } }
      else if (e.key === 'Escape') { if (menu) setMenu(null); else if (multi.length) setMulti([]); else if (target) setTarget(null); else if (s.selected.kind) { eng.select(null, null); bump(); } else useApp.getState().setPauseMenu(true); }
      else if (e.key === '?' ) setShowHelp(true);
      else if (e.key === 't' || e.key === 'T') setTerminal((v) => !v);
      else if (e.key === 's' || e.key === 'S') { const due = eng.overdueChecks(); if (due.length) { eng.statusCheck(due[0].id); audio.radioBlip(); bump(); } }
      else if (e.key === 'f' || e.key === 'F') {
        const sel = s.selected;
        const at = sel.kind === 'unit' && sel.id && s.units[sel.id] ? { x: s.units[sel.id].x, y: s.units[sel.id].y } : sel.kind === 'incident' && sel.id && s.incidents[sel.id]?.reportedNode != null ? eng.city.nodes[s.incidents[sel.id].reportedNode!] : sel.kind === 'station' && sel.id && s.stations[sel.id] ? eng.city.nodes[s.stations[sel.id].nodeId] : null;
        if (at) doFocus(at.x, at.y, 2.6);
      }
      else if (e.key === 'q' || e.key === 'Q') { const id = s.selected.kind === 'incident' ? s.selected.id : s.activeCallId ? s.calls[s.activeCallId]?.incidentId ?? null : null; const ap = useApp.getState(); if (ap.resPanel) ap.closeResources(); else ap.openResources(id); }
      else if (e.key === 'b' || e.key === 'B') {
        const id = s.selected.kind === 'incident' ? s.selected.id : s.activeCallId ? s.calls[s.activeCallId]?.incidentId : null;
        if (id) { const r = eng.broadcastBolo(id); if (r.ok) { audio.dispatchConfirm(); useApp.getState().showToast('BOLO broadcast to all units', 'info'); } else { audio.error(); useApp.getState().showToast(r.reason ?? '', 'warn'); } bump(); }
      }
      else if (e.key === 'Enter' && el?.tagName !== 'BUTTON' && assistsOn(s)) {
        const inc = s.selected.kind === 'incident' && s.selected.id ? s.incidents[s.selected.id] : null;
        if (inc && inc.reportedNode !== null && !['RESOLVED', 'CLOSED'].includes(inc.status)) {
          const plan = eng.buildPlan(inc.id, recommendFor(inc, s.rank));
          let ok = 0; for (const x of plan.units) if (eng.dispatch(x.unit.id, inc.id, { code: inc.severity >= 3 ? 3 : 2 }).ok) ok++;
          if (ok) { audio.dispatchConfirm(); useApp.getState().showToast(`Response plan dispatched · ${ok} unit${ok > 1 ? 's' : ''}`, 'info'); } else useApp.getState().showToast(plan.uncovered.length ? 'No free units for the response plan' : 'Response already covered', 'warn');
          bump();
        }
      }
      else if (e.key === 'r' || e.key === 'R') {
        const sel = s.selected.kind === 'incident' && s.selected.id ? s.incidents[s.selected.id] : null;
        const target = sel?.mover?.heliId ? sel : Object.values(s.incidents).find((i) => i.mover?.heliId && !['RESOLVED', 'CLOSED'].includes(i.status));
        if (target) { const r = eng.relayAir(target.id); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); else audio.dispatchConfirm(); bump(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, layer, target, pauseMenu, menu, multi]);

  const heardForMap = (() => {
    if (st.selected.kind !== 'incident' || !st.selected.id) return undefined;
    const inc = st.incidents[st.selected.id];
    if (!inc || inc.reportedNode !== null && !target) return undefined;
    const call = Object.values(st.calls).filter((c) => c.incidentId === inc.id).sort((a, b) => b.ringStart - a.ringStart)[0];
    return call && (call.state === 'active' || call.state === 'hold') && assistsOn(st) ? call.heard : undefined;
  })();

  const onPickNode = (node: number) => {
    if (!target) return;
    if (target.kind === 'loc') { engine.setIncidentLocation(target.id, node, 'map'); audio.dispatchConfirm(); }
    else { if (engine.reposition(target.id, node)) audio.dispatchConfirm(); }
    setTarget(null); bump();
  };
  const onContext = (node: number, hit: { kind: string; id: string } | null, at: { x: number; y: number }) => {
    const s = engine.state;
    // quick orders: with a unit selected, right-click an incident to send it or a street to move it there
    // a box of units: send them all to the incident, or move them all to the street
    if (multi.length && (hit?.kind === 'incident' || !hit)) {
      const ids = multi.filter((id) => s.units[id]);
      for (const id of ids) handleDrop(engine, { kind: 'unit', id }, hit, node);
      setMulti([]); bump(); return;
    }
    const u = s.selected.kind === 'unit' && s.selected.id ? s.units[s.selected.id] : null;
    if (u && (hit?.kind === 'incident' || (!hit && ['AVAILABLE', 'RETURNING'].includes(u.status) && !isAir(u)))) { handleDrop(engine, { kind: 'unit', id: u.id }, hit, node); return; }
    setMenu({ x: at.x, y: at.y, node, hit, key: performance.now() });
  };

  const style = { ['--left' as string]: collapsed.l ? '34px' : `${sizes.l}px`, ['--right' as string]: collapsed.r ? '34px' : `${sizes.r}px`, ['--bottom' as string]: collapsed.b ? '34px' : `${sizes.b}px` } as React.CSSProperties;
  const startDrag = (which: 'l' | 'r' | 'b') => (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, init = sizes[which];
    const move = (ev: PointerEvent) => {
      const v = which === 'l' ? init + (ev.clientX - sx) : which === 'r' ? init - (ev.clientX - sx) : init - (ev.clientY - sy);
      const [mn, mx] = which === 'b' ? [150, 560] : which === 'l' ? [220, 460] : [300, 600];
      setSizes((s) => ({ ...s, [which]: Math.max(mn, Math.min(mx, v)) }));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const openDispatch = () => { const c = st.activeCallId ? st.calls[st.activeCallId] : null; if (c) { engine.select('incident', c.incidentId); setCollapsed((x) => ({ ...x, r: false })); bump(); } };

  return (
    <div className={`game ${settings.reduceMotion ? 'reduce' : ''} ${settings.highContrast ? 'hc' : ''}`} style={style}>
      <TopBar engine={engine} title={session.config.title} onMenu={() => useApp.getState().setPauseMenu(true)} onHelp={() => setShowHelp(true)} />
      <EventBanner engine={engine} />
      <div className="gmain">
        <aside className={`left ${collapsed.l ? 'collapsed' : ''}`}>
          <button className="collapse-btn" onClick={() => setCollapsed((c) => ({ ...c, l: !c.l }))} aria-label="Toggle call queue"><Icon n={collapsed.l ? 'chevR' : 'chevL'} size={12} /></button>
          {!collapsed.l && <LeftSidebar engine={engine} doFocus={doFocus} />}
        </aside>
        {!collapsed.l && <div className="vresizer" onPointerDown={startDrag('l')} role="separator" aria-orientation="vertical" aria-label="Resize call queue" />}
        <div className="center">
          <MapView world3d engine={engine} layer={layer} mode={target ? 'pickLocation' : 'select'} selected={st.selected}
            onSelect={(k, id) => { engine.select(k, id); setMulti([]); setCollapsed((c) => ({ ...c, r: false })); bump(); }}
            multi={multi} onBoxSelect={(ids) => { setMulti(ids); if (ids.length) { audio.click(); useApp.getState().showToast(`${ids.length} unit${ids.length > 1 ? 's' : ''} selected — right-click an incident to send them`, 'info'); } }}
            onPickNode={onPickNode} onContext={onContext} onDrop={(src, t, node) => handleDrop(engine, src, t, node)} heard={heardForMap}
            onPickHeard={(h) => { const s = engine.state; if (s.selected.kind === 'incident' && s.selected.id) { engine.setIncidentLocation(s.selected.id, h.nodeId, 'candidate'); audio.dispatchConfirm(); bump(); } }}
            focus={focus} reduceMotion={settings.reduceMotion} minimap preview={preview} sounds />
          <div className="maptools">
            <div className="layerbtn">
              <Btn size="sm" icon="layers" onClick={() => setLayerMenu(!layerMenu)}>{LAYERS.find((l) => l.id === layer)!.label}</Btn>
              {layerMenu && <div className="dropmenu" role="menu">{LAYERS.map((l) => <button key={l.id} role="menuitemradio" aria-checked={layer === l.id} className={layer === l.id ? 'on' : ''} onClick={() => { setLayer(l.id); setLayerMenu(false); audio.click(); }}>{layer === l.id && <Icon n="check" size={12} />}{l.label}</button>)}</div>}
            </div>
            {target && <div className="banner"><Icon n="pin" size={14} /> {target.kind === 'loc' ? 'Click the map to set the incident location' : 'Click the map to reposition the unit'} <button className="linkish" onClick={() => setTarget(null)}>Cancel (Esc)</button></div>}
          </div>
          <IncomingBanner engine={engine} />
          <div className="dockrow"><RecordsDock engine={engine} onOpen={() => setTerminal(true)} /><StatusDock engine={engine} /></div>
          <MultiBar engine={engine} ids={multi} onClear={() => setMulti([])} />
          <BoloDock engine={engine} />
          <DecisionCards engine={engine} />
          <Cinematics engine={engine} />
          {resPanel && <ResourcesPanel engine={engine} incId={resPanel.incId} onClose={() => useApp.getState().closeResources()} />}
          <NewsTicker engine={engine} />
          {menu && <MapMenu engine={engine} menu={menu} onClose={closeMenu} focus={doFocus} startReposition={(id) => setTarget({ kind: 'repos', id })} openTab={(t) => { setTab(t as BottomTab); setCollapsed((c) => ({ ...c, b: false })); }} />}
          {cctv && <CctvViewer engine={engine} view={cctv} onClose={() => setCctv(null)} />}
          {terminal && <RecordsTerminal engine={engine} onClose={() => setTerminal(false)} />}
          <GoalsCard engine={engine} />
          <Legend layer={layer} />
          {session.kind === 'tutorial' && <Coach engine={engine} onSkip={() => { useApp.getState().abandon(); }} />}
          <Toast />
        </div>
        {!collapsed.r && <div className="vresizer" onPointerDown={startDrag('r')} role="separator" aria-orientation="vertical" aria-label="Resize detail panel" />}
        <aside className={`right ${collapsed.r ? 'collapsed' : ''}`}>
          <button className="collapse-btn" onClick={() => setCollapsed((c) => ({ ...c, r: !c.r }))} aria-label="Toggle detail panel"><Icon n={collapsed.r ? 'chevL' : 'chevR'} size={12} /></button>
          {!collapsed.r && <RightPanel engine={engine} setPreview={setPreview} pickLocation={(id) => setTarget(id ? { kind: 'loc', id } : null)} pickingFor={target?.kind === 'loc' ? target.id : null} repositioning={target?.kind === 'repos' ? target.id : null} startReposition={(id) => setTarget(id ? { kind: 'repos', id } : null)} focus={doFocus} openCall={() => setTab('call')} setBottom={(t) => setTab(t as BottomTab)} />}
        </aside>
      </div>
      {!collapsed.b && <div className="hresizer" onPointerDown={startDrag('b')} role="separator" aria-orientation="horizontal" aria-label="Resize bottom panel" />}
      <div className={`bottomwrap ${collapsed.b ? 'collapsed' : ''}`}>
        <button className="collapse-btn b" onClick={() => setCollapsed((c) => ({ ...c, b: !c.b }))} aria-label="Toggle bottom panel"><Icon n={collapsed.b ? 'chevU' : 'chevD'} size={12} /></button>
        {!collapsed.b && <BottomPanel engine={engine} tab={tab} setTab={setTab} openDispatch={openDispatch} tutorialHint={session.kind === 'tutorial' ? coachHint(engine) : undefined} />}
      </div>
      {pauseMenu && <PauseMenu />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function TopBar({ engine, title, onMenu, onHelp }: { engine: GameEngine; title: string; onMenu: () => void; onHelp: () => void }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const remaining = Math.max(0, st.config.durationSec - st.time);
  const set = (n: number) => { engine.setSpeed(n); bump(); audio.click(); };
  const speed = st.paused ? 0 : st.speed;
  return (
    <header className="topbar">
      <div className="brand"><span className="logo">◉</span><b>SIGNAL 911</b><span className="muted">·</span><span className="city">RAVENPORT</span></div>
      <div className="shiftinfo"><span className="muted">SHIFT</span> <b>{title}</b></div>
      <div className="stat mono" title="In-game clock"><Icon n="clock" size={13} /> {gameClock(st).slice(0, 5)} <span className="muted small">{fmtTime(remaining)} left</span></div>
      <div className="stat" title="Budget"><Icon n="coins" size={13} /> <span className="mono">{fmtMoneyShort(st.budget)}</span></div>
      <div className="stat" title="Reputation"><Icon n="star" size={13} /> <span className="mono">{Math.round(st.reputation)}</span></div>
      <div className="stat" title="Weather"><Icon n={weatherIcon(st.weather)} size={13} /> {WEATHER_LABEL[st.weather]}</div>
      <StressMeter engine={engine} />
      <LiveRating engine={engine} />
      <div className="grow" />
      <div className="speed" role="group" aria-label="Time controls">
        <button className={speed === 0 ? 'on' : ''} onClick={() => set(0)} aria-label="Pause (Space)" title="Pause (Space)"><Icon n="pause" size={14} /></button>
        <button className={speed === 1 ? 'on' : ''} onClick={() => set(1)} aria-label="Normal speed (1)" title="1× speed"><Icon n="play" size={14} /></button>
        <button className={speed === 2 ? 'on' : ''} onClick={() => set(2)} aria-label="2× speed (2)" title="2× speed"><Icon n="ff" size={14} /></button>
        <button className={speed === 3 ? 'on' : ''} onClick={() => set(3)} aria-label="3× speed (3)" title="3× speed"><Icon n="fff" size={14} /></button>
      </div>
      {st.paused && <Badge tone="amber">PAUSED</Badge>}
      <button className="icon-btn" onClick={onHelp} aria-label="Help and shortcuts" title="Shortcuts (?)"><Icon n="help" size={16} /></button>
      <button className="icon-btn" onClick={onMenu} aria-label="Menu" title="Menu (Esc)"><Icon n="gear" size={16} stroke={false} /></button>
    </header>
  );
}

function EventBanner({ engine }: { engine: GameEngine }) {
  const ev = engine.state.events.filter((e) => e.active || (e.announced && e.start > engine.state.time));
  if (!ev.length) return null;
  return <div className="eventbar">{ev.map((e) => (<span key={e.id} className={e.active ? 'act' : 'adv'}><Icon n="alert" size={13} /> {e.active ? 'IN EFFECT' : 'ADVISORY'}: <b>{e.name}</b> — {e.description}</span>))}</div>;
}

function LeftSidebar({ engine, doFocus }: { engine: GameEngine; doFocus: (x: number, y: number, z?: number) => void }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const calls = Object.values(st.calls);
  const ringing = calls.filter((c) => c.state === 'ringing').sort((a, b) => a.ringStart - b.ringStart);
  const holding = calls.filter((c) => c.state === 'hold' || c.state === 'active');
  const open = Object.values(st.incidents).filter((i) => !i.hidden && !['RESOLVED', 'CLOSED'].includes(i.status) && !(i.truth.outside && i.status === 'CLOSED')).sort((a, b) => (b.assignedUnits.length === 0 ? 1 : 0) - (a.assignedUnits.length === 0 ? 1 : 0) || b.severity - a.severity || a.createdAt - b.createdAt);
  const recent = Object.values(st.incidents).filter((i) => ['RESOLVED', 'CLOSED'].includes(i.status)).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)).slice(0, 4);
  return (
    <div className="left-in">
      <div className="lsec">
        <h3>INCOMING CALLS {ringing.length > 0 && <span className="tabbadge hot">{ringing.length}</span>}</h3>
        {!ringing.length && !holding.length && <div className="empty small muted">No calls waiting</div>}
        {ringing.map((c) => {
          const left = Math.max(0, c.ringTimeout - (st.time - c.ringStart));
          return (
            <div className="callcard ringing" key={c.id}>
              <div className="cc-top"><Icon n="phone" size={15} /><b>{c.callerId}</b>{c.isCallback && <Badge tone="amber">CALLBACK</Badge>}</div>
              <div className="cc-bar"><i style={{ width: `${(left / c.ringTimeout) * 100}%` }} /></div>
              <div className="cc-bot"><span className="mono small">{Math.ceil(left)}s</span><Btn kind="success" size="sm" icon="phone" onClick={() => { engine.answerCall(c.id); bump(); }}>ANSWER</Btn></div>
            </div>
          );
        })}
        {holding.map((c) => (
          <div className={`callcard ${c.state}`} key={c.id}>
            <div className="cc-top"><Icon n={c.state === 'active' ? 'phone' : 'hold'} size={14} /><b>{c.profile.name}</b><Badge tone={c.state === 'active' ? 'green' : 'amber'}>{c.state === 'active' ? 'ACTIVE' : 'ON HOLD'}</Badge></div>
            <div className="cc-bot"><span className="mono small">{fmtTime(st.time - (c.answeredAt ?? st.time))}</span>
              {c.state === 'hold' ? <Btn size="sm" icon="phone" onClick={() => { engine.answerCall(c.id); bump(); }}>Resume</Btn> : <Btn size="sm" kind="danger" icon="phoneoff" onClick={() => { engine.endCall(c.id); bump(); }}>End</Btn>}</div>
          </div>
        ))}
      </div>
      <div className="lsec grow">
        <h3>INCIDENTS <span className="muted">({open.length})</span></h3>
        {!open.length && <div className="empty small muted">No active incidents</div>}
        {open.map((i) => {
          const loc = i.reportedNode !== null ? addressOf(engine.city, i.reportedNode) : null;
          return (
            <button key={i.id} className={`inc ${st.selected.id === i.id ? 'sel' : ''} sev${i.severity}`} onClick={() => { engine.select('incident', i.id); if (i.reportedNode !== null) { const n = engine.city.nodes[i.reportedNode]; doFocus(n.x, n.y, 1.6); } bump(); }}>
              <span className="inc-ic"><Icon n={CAT_ICON[i.category]} size={14} /></span>
              <span className="inc-main"><b>{i.label}</b><span className="small muted">{loc ?? 'Location unknown'}</span></span>
              <span className="inc-side">{i.deadlineAt != null && i.deadlineMet == null ? <Badge tone="red">⏱ {fmtTime(i.deadlineAt - st.time)}</Badge> : i.lifeThreat && i.careAt == null && i.survival !== undefined && i.survival < 70 && threatKnown(i) ? <Badge tone={i.survival < 35 ? 'red' : 'amber'}>♥ {Math.round(i.survival)}%</Badge> : <StatusBadge s={i.status} />}<span className="small mono muted">{i.assignedUnits.length ? `${i.assignedUnits.length} unit${i.assignedUnits.length > 1 ? 's' : ''}` : 'no units'} · {fmtTime(st.time - i.createdAt)}</span></span>
            </button>
          );
        })}
        {recent.length > 0 && <h3 className="sub">RECENTLY CLOSED</h3>}
        {recent.map((i) => (<button key={i.id} className="inc done" onClick={() => { engine.select('incident', i.id); bump(); }}><span className="inc-ic"><Icon n={i.outcome === 'failed' ? 'x' : 'check'} size={13} /></span><span className="inc-main"><b>{i.label}</b><span className="small muted">{(i.outcome ?? '').replace('_', ' ')}</span></span></button>))}
      </div>
      <div className="lsec notif">
        <h3>DISPATCH NOTIFICATIONS</h3>
        <div className="nlist">{st.notifications.slice(-7).reverse().map((n) => (<div key={n.id} className={`nrow ${n.level}`} onClick={() => { if (n.incidentId && st.incidents[n.incidentId]) { engine.select('incident', n.incidentId); bump(); } }}><span className="mono tt">{gameClock(st, n.t).slice(0, 5)}</span>{n.text}</div>))}</div>
      </div>
    </div>
  );
}

function Legend({ layer }: { layer: LayerId }) {
  if (layer === 'normal' || layer === 'incidents') {
    return (
      <div className="legend"><span><i className="lg police" /> Police</span><span><i className="lg fire" /> Fire</span><span><i className="lg med" /> Medical</span><span className="sep" /><span>◆ police · ● fire · ■ medical</span></div>
    );
  }
  if (layer === 'weather') return null;
  const items = layer === 'traffic' ? [['#54B889', 'Free flow'], ['#E5AC4D', 'Busy'], ['#D6853f', 'Slow'], ['#D65353', 'Gridlock']] : [['#54B889', '< 45 s'], ['#8fbf6a', '< 85 s'], ['#E5AC4D', '< 125 s'], ['#D68a4d', '< 175 s'], ['#D65353', 'Uncovered']];
  return <div className="legend"><b>{layer === 'traffic' ? 'TRAFFIC' : 'RESPONSE TIME'}</b>{items.map(([c, l]) => <span key={l}><i className="lg" style={{ background: c }} /> {l}</span>)}</div>;
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [['Space', 'Pause / resume'], ['1 / 2 / 3', 'Set game speed'], ['A', 'Answer the next ringing call'], ['H', 'Hold / resume a call'], ['E', 'End the active call'], ['D', 'Open the active call’s incident'], ['T', 'Records terminal (officer ID / warrant / plate checks)'], ['R', 'Relay the helicopter’s position to ground units'], ['M', 'Cycle map layers'], ['Esc', 'Cancel / deselect / menu'], ['Enter', 'Dispatch the response plan for the selected incident'], ['F', 'Fly the camera to the selection'], ['B', 'Broadcast a BOLO for the selected incident'], ['Drag a pin', 'Move an incident, or drop it on another to link duplicates'], ['S', 'Status check on the most overdue officer'], ['Shift + drag', 'Box-select several units, then right-click an incident'], ['Right-click', 'Quick-order menu (incidents, units, stations, hospitals, streets)'], ['Drag unit → incident', 'Dispatch it (drag a station to send its next free unit)'], ['Scroll / drag', 'Zoom / pan the map'], ['?', 'This help']];
  return (
    <Modal title="Controls & shortcuts" onClose={onClose}>
      <table className="tbl"><tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
      <p className="muted small">SIGNAL 911 is a work of fiction. Callers are scripted characters; nothing here connects to a real emergency service.</p>
      <div className="row end"><Btn kind="primary" onClick={onClose}>Close</Btn></div>
    </Modal>
  );
}
void SERVICE_META;

function LiveRating({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const sc = computeScore(st);
  const mult = 1 + Math.min(0.5, 0.05 * Math.max(0, st.streak - 1));
  return (
    <>
      {st.stats.resolved + st.stats.failed + st.stats.callsMissed > 0
        ? <div className="rating" title="Live shift rating — updates as you work" style={{ borderColor: GRADE_COLOR[sc.grade], color: GRADE_COLOR[sc.grade] }}><b>{sc.grade}</b><span className="mono">{sc.total}</span></div>
        : <div className="rating" title="Your live rating appears once the first incident is handled" style={{ borderColor: 'var(--line2)', color: 'var(--text2)' }}><b>–</b><span className="mono">rating</span></div>}
      <div className={`streak ${st.streak >= 3 ? 'hot' : ''}`} title="Streak: consecutive incidents handled without a failure. Raises incident bonuses."><Icon n="bolt" size={12} /> <b className="mono">{st.streak}</b>{st.streak >= 2 && <span className="mono small">×{mult.toFixed(2)}</span>}</div>
    </>
  );
}

function IncomingBanner({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const ringing = Object.values(st.calls).filter((c) => c.state === 'ringing').sort((a, b) => a.ringStart - b.ringStart);
  if (!ringing.length || st.activeCallId) return null;
  const c = ringing[0];
  const left = Math.max(0, c.ringTimeout - (st.time - c.ringStart));
  return (
    <div className="incoming" role="alert">
      <span className="ring-ic"><Icon n="phone" size={18} /></span>
      <div className="grow"><div className="inc-title">{c.isCallback ? 'CALLBACK' : 'INCOMING 911 CALL'}{ringing.length > 1 ? ` · ${ringing.length} waiting` : ''}</div><div className="mono small">{c.callerId}</div></div>
      <div className="inc-timer"><i style={{ width: `${(left / c.ringTimeout) * 100}%` }} /></div>
      <Btn kind="success" icon="phone" onClick={() => { engine.answerCall(c.id); bump(); }}>Answer <kbd>A</kbd></Btn>
    </div>
  );
}

function GoalsCard({ engine }: { engine: GameEngine }) {
  const st = engine.state;
  const [open, setOpen] = useState(true);
  const contracts = st.config.contracts ?? [];
  const mods = (st.config.modifiers ?? []).map((m) => MODIFIER_BY_ID[m]).filter(Boolean);
  const objs = st.config.objectives;
  if (!contracts.length && !mods.length && !objs.length) return null;
  return (
    <div className={`goals ${open ? '' : 'closed'}`}>
      <button className="goals-head" onClick={() => setOpen(!open)} aria-expanded={open}><Icon n="trophy" size={13} /> <b>Shift goals</b><span className="grow" /><Icon n={open ? 'chevU' : 'chevD'} size={12} /></button>
      {open && (
        <div className="goals-body">
          {mods.map((m) => <div key={m.id} className={`mod ${m.tone}`} title={m.desc}><Icon n="alert" size={11} /> {m.name}</div>)}
          {objs.map((o) => <div key={o.id} className="goal"><Icon n="chevR" size={10} /> <span className="grow">{o.text}{o.optional ? ' (opt.)' : ''}</span></div>)}
          {contracts.map((c) => {
            const p = contractProgress(st, c);
            return <div key={c.id} className={`goal ${p.done ? 'ok' : p.failed ? 'no' : ''}`}><Icon n={p.done ? 'check' : p.failed ? 'x' : 'coins'} size={11} /> <span className="grow">{p.text}</span><span className="mono small">{p.done ? '✓' : p.failed ? '✗' : `${p.value}/${c.target}`}</span></div>;
          })}
        </div>
      )}
    </div>
  );
}

/** how stressful the dispatcher's situation is right now (0-100) */
export function dispatcherStress(engine: GameEngine): number {
  const st = engine.state;
  const calls = Object.values(st.calls);
  const ringing = calls.filter((c) => c.state === 'ringing').length, hold = calls.filter((c) => c.state === 'hold').length;
  const open = Object.values(st.incidents).filter((i) => !i.hidden && !['RESOLVED', 'CLOSED'].includes(i.status));
  const esc = open.filter((i) => i.status === 'ESCALATING' || i.stage > 0).length;
  const crit = open.filter((i) => i.severity >= 4 && i.assignedUnits.length === 0).length;
  const active = st.activeCallId ? st.calls[st.activeCallId] : null;
  const callerPanic = active ? active.mood.panic / 100 : 0;
  return Math.max(0, Math.min(100, st.dispatcherLoad * 35 + ringing * 12 + hold * 7 + esc * 12 + crit * 10 + callerPanic * 15));
}
function StressMeter({ engine }: { engine: GameEngine }) {
  const s = dispatcherStress(engine);
  const bpm = Math.round(68 + s * 0.9);
  const tone = s >= 70 ? 'r' : s >= 45 ? 'a' : 'g';
  return (
    <div className={`stress ${tone}`} title={`Your stress: ${Math.round(s)}% — calls waiting, escalations and frightened callers push it up`}>
      <span className="heart" style={{ animationDuration: `${60 / bpm}s` }}><Icon n="heart" size={13} /></span>
      <b className="mono">{bpm}</b><span className="small">bpm</span>
    </div>
  );
}
