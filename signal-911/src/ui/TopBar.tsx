import { Pause, Play, FastForward, Volume2, VolumeX, Radio, Wallet, Star, CloudRain, Sun, Flag } from 'lucide-react';
import { useGame } from '../store/game';
import { SPEEDS } from '../sim/clock';
import { fmt, money } from './common';

export function TopBar() {
  const phase = useGame((s) => s.phase);
  const paused = useGame((s) => s.clock.paused);
  const speed = useGame((s) => s.clock.speed);
  const save = useGame((s) => s.save);
  const saveOk = useGame((s) => s.saveOk);
  const weather = useGame((s) => s.config.weather);
  useGame((s) => s.rev);
  const w = useGame.getState().world;
  const g = useGame.getState();
  const { muted, volume } = save.settings;
  return (
    <header className="topbar">
      <div className="brand"><Radio size={16} /> SIGNAL 911</div>
      <div className="stat" title="City">Ravenport</div>
      <div className="stat" title="Current shift">Shift {save.completedShifts + 1}</div>
      <div className="stat mono" title="Shift time elapsed / remaining">
        {phase === 'shift' ? `${fmt(w.time)} · ${fmt(Math.max(0, w.length - w.time))} left` : phase === 'summary' ? 'Shift over' : `Briefing · ${w.config.shiftMinutes} min`}
      </div>
      <div className="stat" title="Department budget"><Wallet size={14} /> {money(save.money)}</div>
      <div className="stat" title="Reputation (0-100)"><Star size={14} /> {save.reputation}</div>
      <div className="stat" title="Weather: rain slows all vehicles by 15%">
        {weather === 'rain' ? <CloudRain size={14} /> : <Sun size={14} />} {weather === 'rain' ? 'Rain' : 'Clear'}
      </div>
      <div className="spacer" />
      {!saveOk && <div className="stat warn" title="Browser storage unavailable; progress will not persist">Save failed</div>}
      <div className="controls">
        {phase === 'shift' && (
          <>
            <button onClick={g.togglePause} title="Pause / resume (Space)">{paused ? <Play size={14} /> : <Pause size={14} />}</button>
            {SPEEDS.map((s, i) => (
              <button key={s} className={speed === s ? 'on' : ''} onClick={() => g.setSpeed(s)} title={`Speed ${s}× (key ${i + 1})`}>
                {s === 4 ? <><FastForward size={12} />4×</> : `${s}×`}
              </button>
            ))}
            <button onClick={() => { if (window.confirm('End the shift now?')) g.endShift(); }} title="End shift early"><Flag size={14} /></button>
          </>
        )}
        <button onClick={g.toggleMute} title="Mute (M) — sound effects arrive in a later stage">{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
        <input type="range" min={0} max={1} step={0.05} value={volume} aria-label="Volume" onChange={(e) => g.setVolume(Number(e.target.value))} />
      </div>
    </header>
  );
}
