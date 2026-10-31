// Shift-prep garage: pick a vehicle, swap its chassis, load its equipment slots and paint it.
// Every change is real: chassis change speed and kit space, kits add capabilities or make the
// crew better at certain jobs, and the map draws the vehicle the way you built it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CAP_LABEL } from '../sim/content/vocab';
import { SERVICE_META, UNIT_TYPE_BY_ID } from '../sim/fleet';
import { CHASSIS_BY_ID, KIT_BY_ID, applyFit, canFit, canRebody, chassisFor, defaultChassis, fitCost, fitStats, kitsFor, slotsOf } from '../sim/garage';
import { CHASSIS } from '../sim/garage';
import type { Profile } from '../sim/profile';
import type { Service, Unit, UnitFit } from '../sim/types';
import { useApp } from '../store';
import { Badge, Btn, Icon, SERVICE_ICON, fmtMoney } from './common';
import { LIVERIES, vehicleSprite } from './vehicles';

type Draft = { chassis: string; kits: string[]; livery: string; nickname: string };
const draftOf = (u: Unit): Draft => ({ chassis: u.fit?.chassis ?? defaultChassis(u.service).id, kits: [...(u.fit?.kits ?? [])], livery: u.fit?.livery ?? 'classic', nickname: u.fit?.nickname ?? '' });
const withDraft = (u: Unit, d: Draft): Unit => applyFit({ ...JSON.parse(JSON.stringify(u)), fit: { ...(u.fit ?? {}), chassis: d.chassis, kits: d.kits, livery: d.livery, nickname: d.nickname || undefined } as UnitFit });

/** a vehicle sitting in the bay, lights going */
export function VehiclePreview({ type, service, livery, chassis, lights = true, size = 260, still = false }: { type: string; service: string; livery?: string; chassis?: string; lights?: boolean; size?: number; still?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr; cv.height = size * 0.62 * dpr;
    const c = cv.getContext('2d')!;
    let raf = 0, t0 = performance.now();
    const draw = (now: number) => {
      const W = cv.width, H = cv.height;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, W, H);
      // bay floor: concrete with painted bay lines
      const g = c.createRadialGradient(W / 2, H * 0.55, 10, W / 2, H * 0.55, W * 0.7);
      g.addColorStop(0, '#2b333d'); g.addColorStop(1, '#12171d');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(255,210,58,.35)'; c.lineWidth = 2 * dpr; c.setLineDash([10 * dpr, 8 * dpr]);
      c.beginPath(); c.moveTo(W * 0.08, H * 0.18); c.lineTo(W * 0.92, H * 0.18); c.moveTo(W * 0.08, H * 0.86); c.lineTo(W * 0.92, H * 0.86); c.stroke(); c.setLineDash([]);
      const t = (now - t0) / 1000;
      const phase = !lights ? 0 : Math.floor(t * 4) % 2 === 0 ? 1 : 2;
      const sp = vehicleSprite(type, service, phase, livery, chassis);
      const scale = Math.min((W * 0.8) / sp.img.width, (H * 0.62) / sp.img.height) * 1.0;
      const w = sp.img.width * scale, h = sp.img.height * scale;
      const bob = still ? 0 : Math.sin(t * 1.3) * 1.2 * dpr;
      // soft shadow
      c.save(); c.translate(W / 2, H * 0.53 + 6 * dpr); c.scale(1, 0.5);
      const sh = c.createRadialGradient(0, 0, 4, 0, 0, w * 0.55); sh.addColorStop(0, 'rgba(0,0,0,.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = sh; c.beginPath(); c.arc(0, 0, w * 0.55, 0, Math.PI * 2); c.fill(); c.restore();
      // emergency light wash on the floor
      if (phase) {
        const col = phase === 1 ? 'rgba(255,46,59,.20)' : service === 'fire' ? 'rgba(255,255,255,.14)' : 'rgba(47,123,255,.22)';
        const lw = c.createRadialGradient(W / 2, H / 2, 6, W / 2, H / 2, W * 0.5); lw.addColorStop(0, col); lw.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = lw; c.fillRect(0, 0, W, H);
      }
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.drawImage(sp.img, W / 2 - w / 2, H / 2 - h / 2 + bob, w, h);
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [type, service, livery, chassis, lights, size, still]);
  return <canvas ref={ref} className="veh-preview" style={{ width: size, height: size * 0.62 }} />;
}

function Meter({ label, value, was, unit }: { label: string; value: number; was?: number; unit?: string }) {
  const d = was === undefined ? 0 : value - was;
  return (
    <div className="g-meter">
      <span>{label}</span>
      <div className="g-bar"><i style={{ width: `${value}%` }} />{was !== undefined && d !== 0 && <b className={d > 0 ? 'up' : 'down'} style={{ left: `${Math.min(value, was)}%`, width: `${Math.abs(d)}%` }} />}</div>
      <span className={`mono small ${d > 0 ? 'good' : d < 0 ? 'bad' : ''}`}>{unit ?? `${value}`}{d ? ` ${d > 0 ? '▲' : '▼'}` : ''}</span>
    </div>
  );
}

export function Garage({ p }: { p: Profile }) {
  const mutate = useApp((s) => s.mutateProfile);
  const toast = useApp((s) => s.showToast);
  const [svc, setSvc] = useState<Service | 'all'>('all');
  const fleet = p.units.filter((u) => UNIT_TYPE_BY_ID[u.type] && u.type !== 'helicopter');
  const [sel, setSel] = useState<string>(fleet[0]?.id ?? '');
  const u = p.units.find((x) => x.id === sel) ?? fleet[0];
  const [draft, setDraft] = useState<Draft | null>(u ? draftOf(u) : null);
  useEffect(() => { if (u) setDraft(draftOf(u)); }, [u?.id, p.updatedAt]);
  const preview = useMemo(() => (u && draft ? withDraft(u, draft) : null), [u, draft]);
  if (!u || !draft || !preview) return <div className="page muted">No vehicles in the fleet.</div>;
  const def = UNIT_TYPE_BY_ID[u.type];
  const now = fitStats(u), next = fitStats(preview);
  const cost = fitCost(u, draft);
  const dirty = JSON.stringify(draftOf(u)) !== JSON.stringify(draft);
  const slots = slotsOf(preview);
  const chs = chassisFor(u);
  const kits = kitsFor(u);
  const crew = u.personnelIds.map((id) => p.personnel.find((x) => x.id === id)).filter(Boolean);
  const newCaps = preview.capabilities.filter((c) => !u.capabilities.includes(c));
  const setKit = (id: string) => setDraft((d) => {
    if (!d) return d;
    if (d.kits.includes(id)) return { ...d, kits: d.kits.filter((k) => k !== id) };
    if (d.kits.length >= slots) { toast(`No room — this ${CHASSIS_BY_ID[d.chassis]?.label.toLowerCase() ?? 'vehicle'} has ${slots} equipment slot${slots === 1 ? '' : 's'}`, 'warn'); return d; }
    return { ...d, kits: [...d.kits, id] };
  });
  const apply = () => {
    if (cost > p.money) { toast('Not enough money for this fit-out', 'warn'); return; }
    mutate((pp) => {
      const uu = pp.units.find((x) => x.id === u.id);
      if (!uu) return;
      uu.fit = { chassis: draft.chassis, kits: draft.kits.slice(0, slotsOf({ ...uu, fit: { ...draft } as UnitFit })), livery: draft.livery, ...(draft.nickname.trim() ? { nickname: draft.nickname.trim().slice(0, 24) } : {}) };
      applyFit(uu);
      pp.money -= cost;
    });
    toast(cost ? `${u.callsign} fitted out (−${fmtMoney(cost)})` : `${u.callsign} updated`, 'good');
  };
  const list = fleet.filter((x) => svc === 'all' || x.service === svc);
  return (
    <div className="garage">
      <div className="g-roster">
        <div className="seg">{(['all', 'police', 'fire', 'medical'] as const).map((s) => <button key={s} className={svc === s ? 'on' : ''} onClick={() => setSvc(s)}>{s === 'all' ? 'All' : SERVICE_META[s].short}</button>)}</div>
        <div className="g-list">
          {list.map((x) => (
            <button key={x.id} className={`g-item ${x.id === u.id ? 'on' : ''}`} onClick={() => setSel(x.id)} style={{ ['--svc' as string]: SERVICE_META[x.service].color }}>
              <VehiclePreview type={x.type} service={x.service} livery={x.fit?.livery} chassis={x.fit?.chassis} lights={false} size={84} still />
              <div className="g-item-txt">
                <b>{x.callsign}{x.fit?.nickname ? <span className="muted"> “{x.fit.nickname}”</span> : null}</b>
                <span className="small muted">{x.fit && canRebody(x) && x.fit.chassis !== defaultChassis(x.service).id ? CHASSIS_BY_ID[x.fit.chassis]?.label : x.typeLabel}</span>
                <span className="g-dots">{Array.from({ length: slotsOf(x) }, (_, i) => <i key={i} className={x.fit?.kits[i] ? 'full' : ''} title={x.fit?.kits[i] ? KIT_BY_ID[x.fit.kits[i]]?.label : 'empty slot'} />)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="g-bay">
        <div className="g-head">
          <div>
            <div className="g-kicker" style={{ color: SERVICE_META[u.service].color }}><Icon n={SERVICE_ICON[u.service]} size={12} /> {SERVICE_META[u.service].label} · {def.label}</div>
            <h2>{u.callsign}{draft.nickname ? <span className="g-nick"> “{draft.nickname}”</span> : null}</h2>
          </div>
          <div className="g-money"><span className="small muted">Budget</span><b className="mono">{fmtMoney(p.money)}</b></div>
        </div>
        <div className="g-stage">
          <VehiclePreview type={u.type} service={u.service} livery={draft.livery} chassis={canRebody(u) ? draft.chassis : undefined} size={340} />
          <div className="g-stats">
            <Meter label="Speed" value={next.speed} was={now.speed} unit={`${Math.round(preview.speedModifier * 100)}%`} />
            <Meter label="Space" value={next.space} was={now.space} unit={`${slots} slot${slots === 1 ? '' : 's'}`} />
            <Meter label="Capability" value={next.capability} was={now.capability} unit={`${preview.capabilities.length}`} />
            <Meter label="Condition" value={Math.round(u.condition ?? 100)} unit={`${Math.round(u.condition ?? 100)}%`} />
            {(u.condition ?? 100) < 95 && <div className="small"><Btn size="sm" icon="wrench" disabled={p.money < Math.round((100 - (u.condition ?? 100)) * 60)} onClick={() => mutate((pp) => { const uu = pp.units.find((x) => x.id === u.id); if (!uu) return; pp.money -= Math.round((100 - (uu.condition ?? 100)) * 60); uu.condition = 100; })}>Full service · {fmtMoney(Math.round((100 - (u.condition ?? 100)) * 60))}</Btn> <span className="muted">Worn vehicles are slower and break down more often.</span></div>}
            {(preview.fit?.grip ?? 0) > 0 && <div className="small good"><Icon n="snow" size={11} /> Keeps {Math.round((preview.fit?.grip ?? 0) * 100)}% of its speed in bad weather</div>}
            {(preview.fit?.eff ?? 1) !== 1 && <div className={`small ${(preview.fit?.eff ?? 1) > 1 ? 'good' : 'bad'}`}>Crew effectiveness {(preview.fit?.eff ?? 1) > 1 ? '+' : ''}{Math.round(((preview.fit?.eff ?? 1) - 1) * 100)}% on scene</div>}
            <div className="chips">{preview.capabilities.map((c) => <Badge key={c} tone={newCaps.includes(c) ? 'green' : undefined}>{CAP_LABEL[c]}</Badge>)}</div>
            <div className="small muted">Crew: {crew.length ? crew.map((c) => c!.name.split(' ').slice(-1)[0]).join(', ') : 'none assigned'} · {def.crew} seats</div>
          </div>
        </div>

        {canRebody(u) ? (
          <section>
            <h4>Chassis</h4>
            <div className="g-cards">
              {CHASSIS.filter((c) => c.service === u.service).map((c) => {
                const locked = c.minRank > p.rank;
                const owned = (u.fit?.chassis ?? defaultChassis(u.service).id) === c.id;
                return (
                  <button key={c.id} disabled={locked} className={`g-card ${draft.chassis === c.id ? 'on' : ''} ${locked ? 'locked' : ''}`} onClick={() => setDraft({ ...draft, chassis: c.id, kits: draft.kits.slice(0, c.slots) })}>
                    <VehiclePreview type={u.type} service={u.service} livery={draft.livery} chassis={c.id} lights={false} size={110} still />
                    <b>{c.label}</b>
                    <span className="small muted">{c.desc}</span>
                    <span className="g-tags"><em className={c.speed > 1 ? 'good' : c.speed < 1 ? 'bad' : ''}>Speed {c.speed >= 1 ? '+' : ''}{Math.round((c.speed - 1) * 100)}%</em><em>{c.slots} slot{c.slots === 1 ? '' : 's'}</em>{c.grip ? <em className="good">All-weather</em> : null}</span>
                    <span className="g-price">{locked ? <><Icon n="lock" size={11} /> Rank {c.minRank}</> : owned ? 'Fitted' : c.cost ? fmtMoney(c.cost) : 'Free'}</span>
                  </button>
                );
              })}
            </div>
            {chs.length === 0 && <div className="small muted">This vehicle has a fixed body.</div>}
          </section>
        ) : <div className="note-line"><Icon n="info" size={12} /> {def.label}s have a purpose-built body — only equipment and paint can change.</div>}

        {canFit(u) && (
          <section>
            <h4>Equipment <span className="muted small">{draft.kits.length}/{slots} slots</span></h4>
            <div className="g-slots">{Array.from({ length: slots }, (_, i) => { const k = KIT_BY_ID[draft.kits[i]]; return <div key={i} className={`g-slot ${k ? 'full' : ''}`}>{k ? <><b>{k.label}</b><button onClick={() => setKit(k.id)} aria-label="Remove">×</button></> : <span className="muted small">Empty slot</span>}</div>; })}</div>
            <div className="g-kits">
              {kits.map((k) => {
                const locked = k.minRank > p.rank;
                const on = draft.kits.includes(k.id);
                const owned = u.fit?.kits.includes(k.id);
                return (
                  <button key={k.id} disabled={locked} className={`g-kit ${on ? 'on' : ''} ${locked ? 'locked' : ''}`} onClick={() => setKit(k.id)}>
                    <div className="g-kit-top"><b>{k.label}</b><span className="g-price">{locked ? <><Icon n="lock" size={11} /> Rank {k.minRank}</> : owned ? 'Owned' : fmtMoney(k.cost)}</span></div>
                    <span className="small muted">{k.desc}</span>
                    <span className="small g-effect">{k.effect}</span>
                  </button>
                );
              })}
              {kits.length === 0 && <div className="small muted">No add-on kits for this vehicle.</div>}
            </div>
          </section>
        )}

        <section>
          <h4>Livery</h4>
          <div className="g-liveries">
            {(LIVERIES[u.service] ?? []).map((l) => (
              <button key={l.id} className={`g-livery ${draft.livery === l.id ? 'on' : ''}`} onClick={() => setDraft({ ...draft, livery: l.id })}>
                <VehiclePreview type={u.type} service={u.service} livery={l.id} chassis={canRebody(u) ? draft.chassis : undefined} lights={false} size={92} still />
                <span className="small">{l.label}</span>
              </button>
            ))}
          </div>
          <div className="field g-name"><label>Nickname</label><input value={draft.nickname} maxLength={24} placeholder="e.g. Old Faithful" onChange={(e) => setDraft({ ...draft, nickname: e.target.value })} /></div>
        </section>

        <div className="g-foot">
          <div className="grow small muted">{dirty ? (cost ? `Fit-out cost ${fmtMoney(cost)} — paid now, kept for every shift.` : 'No charge — removing kit and repainting are free.') : 'Changes apply to every shift until you change them again.'}</div>
          <Btn disabled={!dirty} onClick={() => setDraft(draftOf(u))}>Reset</Btn>
          <Btn kind="primary" icon="wrench" disabled={!dirty || cost > p.money} onClick={apply}>{cost ? `Fit out · ${fmtMoney(cost)}` : 'Save'}</Btn>
        </div>
      </div>
    </div>
  );
}
