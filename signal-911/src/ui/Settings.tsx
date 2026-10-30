import { useState } from 'react';
import { audio } from '../audio/audioManager';
import { useApp } from '../store';
import { Btn, Confirm, DISCLAIMER, Icon } from './common';

function Slider({ label, k }: { label: string; k: 'master' | 'effects' | 'radio' | 'music' | 'ambience' }) {
  const v = useApp((s) => s.settings[k]);
  const update = useApp((s) => s.updateSettings);
  return (
    <label className="slider"><span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={v} aria-label={`${label} volume`} onChange={(e) => update({ [k]: parseFloat(e.target.value) })} onPointerUp={() => { audio.unlock(); if (k === 'radio') audio.radioBlip(); else audio.dispatchConfirm(); }} />
      <span className="mono">{Math.round(v * 100)}</span>
    </label>
  );
}
function Toggle({ label, desc, k }: { label: string; desc?: string; k: 'hideIntense' | 'reduceMotion' | 'highContrast' | 'autoSave' | 'showHints' | 'muted' }) {
  const v = useApp((s) => s.settings[k]);
  const update = useApp((s) => s.updateSettings);
  return (
    <label className="toggle"><input type="checkbox" checked={v} onChange={(e) => update({ [k]: e.target.checked })} /><span className="tg" /><span><b>{label}</b>{desc && <span className="muted small block">{desc}</span>}</span></label>
  );
}

export function SettingsPanel({ compact }: { compact?: boolean }) {
  const speed = useApp((s) => s.settings.defaultSpeed);
  const update = useApp((s) => s.updateSettings);
  return (
    <div className={`settings ${compact ? 'compact' : ''}`}>
      <div className="setcol">
        <h3>Audio</h3>
        <Toggle label="Mute everything" k="muted" />
        <Slider label="Master" k="master" /><Slider label="Effects" k="effects" /><Slider label="Radio" k="radio" /><Slider label="Ambience" k="ambience" /><Slider label="Music" k="music" />
        <p className="muted small">All audio is synthesised in your browser — phone rings, radio squelch, dispatch tones and call-context ambience. Callers are text-based; there is no microphone and nothing is recorded.</p>
      </div>
      <div className="setcol">
        <h3>Gameplay</h3>
        <label className="slider"><span>Default speed</span>
          <select value={speed} aria-label="Default game speed" onChange={(e) => update({ defaultSpeed: parseInt(e.target.value, 10) })}><option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option></select><span /></label>
        <Toggle label="Autosave" desc="Save the career automatically after shifts and purchases." k="autoSave" />
        <h3>Comfort & accessibility</h3>
        <Toggle label="Reduce distressing scenarios" desc="Removes the most intense calls (collapsed children, domestic violence, armed robbery, mass-casualty crashes)." k="hideIntense" />
        <Toggle label="Reduce motion" desc="Stops pulsing markers and flashing lights." k="reduceMotion" />
        <Toggle label="High contrast" desc="Brighter text and borders." k="highContrast" />
        <p className="muted small">Status is never shown by colour alone: shapes, icons and labels are used throughout.</p>
      </div>
    </div>
  );
}

export function SettingsScreen() {
  const goBack = useApp((s) => s.goBack);
  const reset = useApp((s) => s.resetAll);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="screen">
      <header className="screen-head"><Btn kind="ghost" icon="chevL" onClick={goBack}>Back</Btn><h1>Settings</h1></header>
      <div className="screen-body narrow">
        <div className="card"><SettingsPanel /></div>
        <div className="card">
          <h3>Data</h3>
          <p className="muted">Progress is stored in this browser (IndexedDB). Resetting removes every save, scenario record and setting.</p>
          <Btn kind="danger" icon="trash" onClick={() => setConfirm(true)}>Reset all progress…</Btn>
        </div>
        <div className="card"><h3><Icon n="info" size={14} /> About</h3><p className="muted">{DISCLAIMER}</p></div>
      </div>
      {confirm && <Confirm title="Reset all progress?" text="This permanently deletes all saves and records in this browser. This cannot be undone." confirm="Delete everything" danger onYes={async () => { setConfirm(false); await reset(); }} onNo={() => setConfirm(false)} />}
    </div>
  );
}
