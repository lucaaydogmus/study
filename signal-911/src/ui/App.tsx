import { useEffect } from 'react';
import { Pause, Play, FastForward, Volume2, VolumeX, Radio, Wallet, Star, CloudRain } from 'lucide-react';
import { useGame } from '../store/game';
import { formatClock, SPEEDS } from '../sim/clock';

export function App() {
  const { clock, save, saveOk, togglePause, setSpeed, cycleSpeed, setVolume, toggleMute } =
    useGame();

  // Single animation-frame loop drives the simulation clock.
  useEffect(() => {
    let last = performance.now();
    let raf = requestAnimationFrame(function frame(now) {
      useGame.getState().tick((now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keyboard shortcuts: Space pause, 1/2/3 speed, + cycle, M mute.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      else if (e.key === '1') setSpeed(1);
      else if (e.key === '2') setSpeed(2);
      else if (e.key === '3') setSpeed(4);
      else if (e.key === '+') cycleSpeed();
      else if (e.key.toLowerCase() === 'm') toggleMute();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause, setSpeed, cycleSpeed, toggleMute]);

  const { muted, volume } = save.settings;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Radio size={16} /> SIGNAL 911</div>
        <div className="stat" title="City">Ravenport</div>
        <div className="stat" title="Shift">Shift {save.completedShifts + 1}</div>
        <div className="stat mono" title="Shift time">{formatClock(clock.gameSeconds)}</div>
        <div className="stat" title="Budget"><Wallet size={14} /> ${save.money.toLocaleString()}</div>
        <div className="stat" title="Reputation"><Star size={14} /> {save.reputation}</div>
        <div className="stat" title="Weather"><CloudRain size={14} /> Clear</div>
        <div className="spacer" />
        {!saveOk && <div className="stat warn" title="Browser storage unavailable">Save failed</div>}
        <div className="controls">
          <button onClick={togglePause} title="Pause / resume (Space)">
            {clock.paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          {SPEEDS.map((s, i) => (
            <button key={s} className={clock.speed === s ? 'on' : ''} onClick={() => setSpeed(s)}
              title={`Speed ${s}× (${i + 1})`}>
              {s === 1 ? '1×' : s === 2 ? '2×' : <><FastForward size={12} />4×</>}
            </button>
          ))}
          <button onClick={toggleMute} title="Mute (M)">
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input type="range" min={0} max={1} step={0.05} value={volume} aria-label="Volume"
            onChange={(e) => setVolume(Number(e.target.value))} />
        </div>
      </header>

      <aside className="panel left"><h2>Calls &amp; Incidents</h2><p className="muted">Stage 1</p></aside>
      <main className="map"><div className="placeholder">City map — Stage 1</div></main>
      <aside className="panel right"><h2>Incident &amp; Dispatch</h2><p className="muted">Stage 1</p></aside>
      <footer className="panel bottom"><h2>Units · Radio log</h2><p className="muted">Stage 1</p></footer>
    </div>
  );
}
