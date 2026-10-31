import { useEffect, useState } from 'react';
import { aiApi, type AiStatus } from '../ai/aiClient';
import { audio } from '../audio/audioManager';
import { useApp } from '../store';
import { Btn, Confirm, DISCLAIMER, Icon } from './common';

function Slider({ label, k }: { label: string; k: 'master' | 'effects' | 'radio' | 'music' | 'ambience' | 'sirens' }) {
  const v = useApp((s) => s.settings[k]);
  const update = useApp((s) => s.updateSettings);
  return (
    <label className="slider"><span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={v} aria-label={`${label} volume`} onChange={(e) => update({ [k]: parseFloat(e.target.value) })} onPointerUp={() => { audio.unlock(); if (k === 'radio') audio.radioBlip(); else if (k === 'sirens') audio.siren(); else audio.dispatchConfirm(); }} />
      <span className="mono">{Math.round(v * 100)}</span>
    </label>
  );
}
function Toggle({ label, desc, k }: { label: string; desc?: string; k: 'hideIntense' | 'reduceMotion' | 'highContrast' | 'autoSave' | 'showHints' | 'muted' | 'heartbeat' | 'tts' }) {
  const v = useApp((s) => s.settings[k]);
  const update = useApp((s) => s.updateSettings);
  return (
    <label className="toggle"><input type="checkbox" checked={v} onChange={(e) => update({ [k]: e.target.checked })} /><span className="tg" /><span><b>{label}</b>{desc && <span className="muted small block">{desc}</span>}</span></label>
  );
}

function GraphicsSettings() {
  const st = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const g = st.graphics ?? '3d', q = st.quality ?? 'high';
  return (
    <>
      <div className="field"><label>City view</label><div className="seg">
        <button className={g === '3d' ? 'on' : ''} onClick={() => update({ graphics: '3d' })}>Cinematic 3D</button>
        <button className={g === '2d' ? 'on' : ''} onClick={() => update({ graphics: '2d' })}>Classic 2D</button></div></div>
      {g === '3d' && <div className="field"><label>3D quality</label><div className="seg">
        {(['high', 'medium', 'low'] as const).map((x) => <button key={x} className={q === x ? 'on' : ''} onClick={() => update({ quality: x })}>{x === 'high' ? 'High (4K shadows, MSAA)' : x === 'medium' ? 'Medium' : 'Low (no shadows)'}</button>)}</div></div>}
      <p className="muted small">The 3D city is rendered with real lighting, sun shadows, bloom and colour grading, with every vehicle modelled at true scale. Use Classic 2D or Low on older laptops.</p>
    </>
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
        <Slider label="Master" k="master" /><Slider label="Effects" k="effects" /><Slider label="Radio" k="radio" /><Slider label="Sirens & rotors" k="sirens" /><Slider label="Ambience" k="ambience" /><Slider label="Music" k="music" />
        <Toggle label="Spoken voices" desc="Callers and crews speak their lines aloud with your browser's voices (different voice, pitch and pace per caller)." k="tts" />
        <p className="muted small">All other audio is synthesised in your browser. Push-to-talk (hold V or the mic button) uses your browser's speech recognition to turn what you say into text; nothing is recorded or stored by the game.</p>
      </div>
      <div className="setcol">
        <h3>Gameplay</h3>
        <label className="slider"><span>Default speed</span>
          <select value={speed} aria-label="Default game speed" onChange={(e) => update({ defaultSpeed: parseInt(e.target.value, 10) })}><option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option></select><span /></label>
        <Toggle label="Heartbeat under pressure" desc="A heartbeat sound when your stress meter runs high." k="heartbeat" />
        <Toggle label="Autosave" desc="Save the career automatically after shifts and purchases." k="autoSave" />
        <h3>Graphics</h3>
        <GraphicsSettings />
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
        <div className="card"><AiSettings /></div>
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

const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

export function AiSettings() {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const [st, setSt] = useState<AiStatus | null>(null);
  const [err, setErr] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState('');
  const run = async (fn: () => Promise<AiStatus>) => { setBusy(true); setErr(''); try { const r = await fn(); setSt(r); if (r.sample) setSample(r.sample); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  useEffect(() => { void run(aiApi.status); }, []);
  const perShift = (st?.estimatePerLine ?? 0) * 60;
  return (
    <div className="aiset">
      <h3><Icon n="phone" size={14} /> AI callers (Claude)</h3>
      <p className="muted small">With an Anthropic API key, callers improvise their lines in character: they react to exactly what you type, get calmer when you are clear and kind, and more upset when you are not. The game still decides every fact they know, so they can’t invent addresses or outcomes. If anything fails, the scripted callers take over instantly.</p>
      {!st && !err && <p className="muted small">Checking the local AI server…</p>}
      {err && <div className="note-line warn"><Icon n="alert" size={12} /> {err}</div>}
      {st && (
        <>
          <div className="kv"><span>Status</span><b className={st.configured ? 'green' : 'amber'}>{st.mock ? 'Mock mode (no API calls)' : st.configured ? 'Key saved on this computer' : 'No API key yet'}</b></div>
          <label className="toggle"><input type="checkbox" checked={settings.aiCallers} onChange={(e) => update({ aiCallers: e.target.checked })} /><span className="tg" /><span><b>Use AI-voiced callers</b><span className="muted small block">Takes effect from the next shift.</span></span></label>
          <div className="field"><label htmlFor="aikey">Anthropic API key</label>
            <div className="row gap"><input id="aikey" type="password" autoComplete="off" placeholder={st.configured ? '•••••••• (saved) — paste a new key to replace' : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1 }} />
              <Btn kind="primary" disabled={busy || !key.trim()} onClick={() => run(() => aiApi.saveKey(key.trim())).then(() => setKey(''))}>Save key</Btn>
              {st.configured && !st.mock && <Btn kind="ghost" disabled={busy} onClick={() => run(() => aiApi.saveKey(''))}>Remove</Btn>}</div>
            <small className="muted">Stored in <code>.env.local</code> in the game folder and used only by the local server — it is never sent to the browser.</small></div>
          <div className="field"><label>Model</label>
            <div className="aimodels">{st.models.map((m) => (
              <button key={m.id} className={`aimodel ${st.model === m.id ? 'on' : ''}`} disabled={busy} onClick={() => run(() => aiApi.setConfig({ model: m.id }))}>
                <b>{m.label}</b><span className="small">≈ {usd(m.perLine)} per line · ≈ {usd(m.perLine * 60)} per shift</span><span className="small muted">${m.input} / ${m.output} per million tokens</span>
              </button>))}</div></div>
          <div className="field"><label htmlFor="aibudget">Daily spending cap (USD)</label>
            <div className="row gap"><input id="aibudget" type="number" min={0} max={100} step={0.25} defaultValue={st.budgetUsd} onBlur={(e) => run(() => aiApi.setConfig({ budgetUsd: parseFloat(e.target.value) || 0 }))} style={{ width: 110 }} />
              <span className="muted small">When reached, callers switch to scripted lines until tomorrow.</span></div></div>
          <label className="slider"><span>Max AI lines per shift</span><input type="range" min={20} max={400} step={10} value={settings.aiMaxLines} onChange={(e) => update({ aiMaxLines: +e.target.value })} /><span className="mono">{settings.aiMaxLines}</span></label>
          <div className="kv"><span>Today</span><b className="mono">{st.usage.requests} requests · {usd(st.usage.cost)} of {usd(st.budgetUsd)}{st.usage.errors ? ` · ${st.usage.errors} errors` : ''}</b></div>
          <div className="kv"><span>Estimated shift cost</span><b className="mono">≈ {usd(perShift)} (about 60 caller lines)</b></div>
          <div className="row gap"><Btn icon="radio" disabled={busy || !st.configured} onClick={() => run(aiApi.test)}>{busy ? 'Working…' : 'Test a caller line'}</Btn>{sample && <span className="small">“{sample}”</span>}</div>
        </>
      )}
    </div>
  );
}
