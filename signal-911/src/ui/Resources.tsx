// The resources panel: one phone book for everything outside your own fleet — tow trucks and
// utilities, K-9 and negotiators, regional hazmat and USAR, the federal team and Guard EOD, and
// mutual aid. Pick the incident, see what helps (and what the crews asked for), and call it in.
import { useMemo, useState } from 'react';
import { RESOURCES, RESOURCE_GROUPS, type GameEngine } from '../sim/engine';
import { audio } from '../audio/audioManager';
import { useApp } from '../store';
import { Badge, Btn, Icon, fmtTime } from './common';

export function ResourcesPanel({ engine, incId, onClose }: { engine: GameEngine; incId: string | null; onClose: () => void }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const toast = useApp((s) => s.showToast);
  const open = Object.values(st.incidents).filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status) && !i.hidden && !i.duplicateOf && i.requires.length > 0);
  const [sel, setSel] = useState<string | null>(incId ?? (st.selected.kind === 'incident' ? st.selected.id : null) ?? open[0]?.id ?? null);
  const [group, setGroup] = useState<string>('Recommended');
  const [q, setQ] = useState('');
  const inc = sel ? st.incidents[sel] : undefined;
  const infos = useMemo(() => Object.fromEntries(RESOURCES.map((r) => [r.id, sel ? engine.resourceInfo(sel, r.id) : null])), [sel, st.time, st.budget]);
  const list = RESOURCES.filter((r) => {
    if (q.trim()) return (r.name + r.desc + r.short).toLowerCase().includes(q.trim().toLowerCase());
    if (group === 'Recommended') { const i = infos[r.id]; return !!i && (i.recommended || i.status !== 'none'); }
    return r.group === group;
  });
  const call = (id: string) => {
    if (!sel) return;
    const r = engine.requestResource(sel, id);
    if (r.ok) { audio.dispatchConfirm(); toast(`${RESOURCES.find((x) => x.id === id)?.name} requested${r.eta ? ` · ETA ${fmtTime(r.eta)}` : ''}`, 'good'); }
    else { audio.error(); toast(r.reason ?? 'Not available', 'warn'); }
    bump();
  };
  const asked = RESOURCES.filter((r) => infos[r.id]?.asked).length;
  return (
    <div className="respanel-wrap" onClick={onClose}>
      <div className="respanel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Request resources">
        <div className="rp-head">
          <Icon n="phone" size={16} />
          <div className="grow"><b>RESOURCES</b> <span className="muted small">· everything outside your own fleet</span></div>
          <span className="small muted">Budget <b className="mono">${Math.round(st.budget).toLocaleString()}</b></span>
          <button className="rp-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="rp-inc">
          <label className="small muted">For incident</label>
          <select value={sel ?? ''} onChange={(e) => setSel(e.target.value || null)}>
            {!open.length && <option value="">No open incidents</option>}
            {open.map((i) => <option key={i.id} value={i.id}>INC-{String(i.num).padStart(4, '0')} · {i.label}{i.reportedNode === null ? ' (no location)' : ''}</option>)}
          </select>
          {inc && <span className="small muted">{inc.assignedUnits.length} unit{inc.assignedUnits.length === 1 ? '' : 's'} assigned · severity {inc.severity}</span>}
          <input className="rp-search" placeholder="Search: tow, K-9, EOD, coast guard…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="rp-body">
          <div className="rp-groups">
            {['Recommended', ...RESOURCE_GROUPS].map((g) => (
              <button key={g} className={group === g && !q ? 'on' : ''} onClick={() => { setGroup(g); setQ(''); }}>
                {g}{g === 'Recommended' && asked ? <span className="pill">{asked}</span> : null}
              </button>
            ))}
          </div>
          <div className="rp-grid">
            {list.map((r) => {
              const i = infos[r.id];
              const status = i?.status ?? 'none';
              return (
                <div key={r.id} className={`rp-card ${i?.recommended ? 'rec' : ''} ${i?.asked ? 'asked' : ''} ${status !== 'none' ? 'live' : ''} ${i && !i.ok && status === 'none' ? 'na' : ''}`}>
                  <div className="rp-top"><span className="rp-ico"><Icon n={r.icon} size={15} /></span><b>{r.name}</b>{i?.asked && <Badge tone="amber">CREW ASKED</Badge>}{i?.recommended && !i.asked && <Badge tone="blue">SUGGESTED</Badge>}</div>
                  <div className="small muted">{r.desc}</div>
                  <div className="rp-meta">
                    <span className="mono small">{r.cost ? `$${r.cost.toLocaleString()}` : 'no charge'}</span>
                    <span className="mono small muted">ETA {fmtTime(r.eta[0])}–{fmtTime(r.eta[1])}{r.kind === 'unit' ? ' + drive' : ''}</span>
                  </div>
                  {status !== 'none'
                    ? <div className={`rp-status ${status}`}>{status === 'here' ? 'On scene' : status === 'requested' ? `Mobilising · ${fmtTime(i?.eta ?? 0)}` : `En route · ${fmtTime(Math.max(0, i?.eta ?? 0))}`}</div>
                    : <Btn size="sm" kind={i?.recommended ? 'primary' : 'default'} disabled={!i?.ok} title={i?.reason} onClick={() => call(r.id)}>{i?.ok ? 'Request' : i?.reason ?? 'Unavailable'}</Btn>}
                </div>
              );
            })}
            {!list.length && <p className="muted pad">{group === 'Recommended' ? 'Nothing outside your fleet is needed here right now. Browse the groups on the left to call anything in.' : 'No matches.'}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
