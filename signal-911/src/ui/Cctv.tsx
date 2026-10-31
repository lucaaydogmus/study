// The CCTV terminal: a second monitor on the dispatch desk. Pick a camera, wait for the stream, aim it,
// zoom, and work out what you are actually looking at — then report it against an incident.
import { useEffect, useMemo, useRef, useState } from 'react';
import { addressOf, getCity } from '../sim/city';
import { gameClock, type GameEngine } from '../sim/engine';
import { cameraList, cctvConnect, cctvDisconnect, cctvPan, cctvTag, cctvView, cctvZoom, type CctvView } from '../sim/cctv';
import { audio } from '../audio/audioManager';
import { useApp } from '../store';
import { Btn, Icon } from './common';
import { drawBuildings3D, drawCity, drawModels } from './scenery';
import { getWorld3D } from './world3d/World3D';

const FW = 480, FH = 270;
let lastDistrict: string | null = null;
type Box = { key: string; x: number; y: number; w: number; h: number; label: string; clear: boolean };

export function CctvConsole({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  const st = engine.state;
  const city = getCity();
  const cams = cameraList(city);
  const districts = city.districts.filter((d) => st.config.districts.includes(d.id));
  const [district, setDistrict] = useState(() => (lastDistrict && districts.some((d) => d.id === lastDistrict) ? lastDistrict : districts[0]?.id ?? ''));
  const [q, setQ] = useState('');
  const sel = st.selected.kind === 'incident' ? st.selected.id : st.activeCallId ? st.calls[st.activeCallId]?.incidentId ?? null : null;
  const [report, setReport] = useState<string>(sel ?? '');
  const [msg, setMsg] = useState<{ text: string; tone: 'info' | 'good' | 'warn' }>({ text: 'Pick a camera. Streams take a few seconds to come up, and some cameras are dead.', tone: 'info' });
  const [, tick] = useState(0);
  const ref = useRef<HTMLCanvasElement>(null);
  const boxes = useRef<Box[]>([]);
  const graphics = useApp((s) => s.settings.graphics ?? '3d');
  useEffect(() => { lastDistrict = district; }, [district]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return cams.filter((c) => c.district === district && (!s || `${c.id} ${c.street} ${c.cross}`.toLowerCase().includes(s)));
  }, [cams, district, q]);
  const link = st.cctv?.link ?? null;
  const tried = st.cctv?.tried ?? {};
  const open = Object.values(st.incidents).filter((i) => !i.hidden && !['RESOLVED', 'CLOSED'].includes(i.status) && !i.truth.outside).sort((a, b) => b.num - a.num);

  // the feed runs at a CCTV-like 8 frames a second
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    let raf = 0, last = 0, ui = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 125) return;
      last = now;
      boxes.current = drawFeed(ctx, engine, cctvView(engine), now, graphics === '3d');
      if (now - ui > 400) { ui = now; tick((x) => x + 1); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine, graphics]);

  const say = (r: { ok: boolean; reason?: string; text?: string }, good = false) => {
    if (!r.ok) { audio.error(); setMsg({ text: r.reason ?? 'Not possible', tone: 'warn' }); }
    else if (r.text) { audio.click(); setMsg({ text: r.text, tone: good ? 'good' : 'info' }); }
  };
  const connect = (id: string) => { audio.click(); cctvConnect(engine, id); setMsg({ text: `Requesting stream from ${id}…`, tone: 'info' }); tick((x) => x + 1); };
  const onFeedClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * FW, y = ((e.clientY - r.top) / r.height) * FH;
    const b = boxes.current.find((bb) => x >= bb.x - 4 && x <= bb.x + bb.w + 4 && y >= bb.y - 4 && y <= bb.y + bb.h + 4);
    if (!b) return;
    if (!report) { audio.error(); setMsg({ text: 'Choose which incident to report this against first.', tone: 'warn' }); return; }
    const res = cctvTag(engine, b.key, report);
    say(res, res.ok && /Confirmed|Got them/.test(res.text ?? ''));
    useApp.getState().bump();
  };
  const v = link ? cctvView(engine) : null;
  const cam = v?.cam ?? null;
  return (
    <div className="cctvc" role="dialog" aria-label="CCTV terminal" tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.stopPropagation(); e.preventDefault(); say(cctvPan(engine, e.key === 'ArrowLeft' ? -1 : 1)); } }}>
      <div className="cctvc-head"><Icon n="map" size={13} /><b>CITY CCTV</b><span className="muted small">Terminal 2 · {cams.length} cameras</span><span className="grow" /><button className="icon-btn" onClick={onClose} aria-label="Close CCTV terminal"><Icon n="x" size={14} /></button></div>
      <div className="cctvc-body">
        <div className="cctvc-list">
          <select value={district} onChange={(e) => setDistrict(e.target.value)} aria-label="District">{districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Street or camera…" aria-label="Search cameras" />
          <div className="cctvc-cams">
            {list.map((c) => (
              <button key={c.id} className={`cam ${link?.cam === c.id ? 'on' : ''} ${tried[c.id] === 'offline' ? 'dead' : ''}`} onClick={() => connect(c.id)}>
                <span className="mono">{c.id}</span><span className="cam-st">{c.street} / {c.cross}</span>
                <span className="cam-tags">{c.ptz && <i>PTZ</i>}{c.ir && <i>IR</i>}{tried[c.id] === 'offline' && <i className="bad">NO SIGNAL</i>}</span>
              </button>
            ))}
            {!list.length && <div className="muted small" style={{ padding: 8 }}>No cameras match.</div>}
          </div>
        </div>
        <div className="cctvc-feed">
          <canvas ref={ref} width={FW} height={FH} onClick={onFeedClick} />
          <div className="cctvc-ctl">
            <Btn size="sm" kind="ghost" icon="chevL" disabled={!cam?.ptz || v?.state !== 'live' && v?.state !== 'moving'} onClick={() => say(cctvPan(engine, -1))} title="Pan left (←)">Pan</Btn>
            <Btn size="sm" kind="ghost" disabled={!cam?.ptz || v?.state !== 'live' && v?.state !== 'moving'} onClick={() => say(cctvPan(engine, 1))} title="Pan right (→)">Pan ›</Btn>
            <div className="seg">{(cam?.ptz ? [1, 2, 4] : [1, 2]).map((z) => <button key={z} className={link?.zoom === z ? 'on' : ''} disabled={!cam} onClick={() => say(cctvZoom(engine, z))}>{z}×</button>)}</div>
            <span className="grow" />
            <label className="small muted" htmlFor="cctv-rep">Report to</label>
            <select id="cctv-rep" value={report} onChange={(e) => setReport(e.target.value)}>
              <option value="">— incident —</option>
              {open.map((i) => <option key={i.id} value={i.id}>#{i.num} {i.label}{i.reportedNode !== null ? ` · ${addressOf(city, i.reportedNode)}` : ' · location unknown'}</option>)}
            </select>
            {link && <Btn size="sm" kind="ghost" onClick={() => { cctvDisconnect(engine); tick((x) => x + 1); }}>Drop</Btn>}
          </div>
          <div className={`cctvc-msg ${msg.tone}`}>{msg.text}</div>
          <div className="muted small cctvc-hint">Click something in the picture to report it. Fixed cameras only look one way; domes (PTZ) pan and zoom. Cameras without IR are nearly blind after dark.</div>
        </div>
      </div>
    </div>
  );
}

const SIZE: Record<string, [number, number]> = { incident: [3.2, 3.2], unit: [1.6, 1.2], vehicle: [1.4, 1.0], suspect: [0.35, 0.95], street: [0.8, 0.9] };
/** paint one frame of the feed; returns the analytics boxes for clicks */
function drawFeed(ctx: CanvasRenderingContext2D, engine: GameEngine, v: CctvView | null, now: number, use3d: boolean): Box[] {
  const st = engine.state;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  const out: Box[] = [];
  if (!v) { testCard(ctx); return out; }
  if (v.state === 'connecting') {
    noise(ctx, 0.9, 18);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, FH / 2 - 30, FW, 60);
    ctx.font = '600 13px ui-monospace, monospace'; ctx.fillStyle = '#d8e0e8'; ctx.textAlign = 'center';
    ctx.fillText(`CONNECTING TO ${v.cam.id} …`, FW / 2, FH / 2 - 6);
    ctx.fillStyle = '#2b3440'; ctx.fillRect(FW / 2 - 90, FH / 2 + 6, 180, 6); ctx.fillStyle = '#7fb6e6'; ctx.fillRect(FW / 2 - 90, FH / 2 + 6, 180 * Math.max(0.05, Math.min(1, v.progress)), 6);
    return out;
  }
  if (v.state === 'nosignal') {
    ctx.fillStyle = '#0a0f2a'; ctx.fillRect(0, 0, FW, FH); noise(ctx, 0.35, 40);
    ctx.font = '700 22px ui-monospace, monospace'; ctx.fillStyle = '#e8ecf4'; ctx.textAlign = 'center'; ctx.fillText('NO SIGNAL', FW / 2, FH / 2);
    ctx.font = '500 11px ui-monospace, monospace'; ctx.fillText(`${v.cam.id} · CAMERA OFFLINE — TICKET RAISED WITH CITY IT`, FW / 2, FH / 2 + 22);
    overlay(ctx, v, st, now);
    return out;
  }
  const camH = 2.3, tilt = 0.16;
  let proj: ((x: number, y: number, z: number) => { x: number; y: number; ok: boolean }) | null = null;
  const w3 = use3d ? getWorld3D() : null;
  if (w3) proj = w3.renderCctv({ x: v.cam.x, y: v.cam.y, h: camH, heading: v.heading, fov: v.fov, far: Math.max(80, v.range * 1.25), tilt }, ctx, FW, FH);
  if (!proj) proj = draw2D(ctx, engine, v);
  // camera sensor: colour, gain, noise, weather and the dark
  const img = ctx.getImageData(0, 0, FW, FH), d = img.data;
  const ir = v.ir, dark = v.night && !v.ir;
  const gain = ir ? 2.6 : dark ? 1.7 : 0.92;
  const amp = ir ? 26 : dark ? 46 : v.weather === 'storm' ? 22 : 12;
  const fog = v.weather === 'fog' ? 0.5 : v.weather === 'snow' ? 0.25 : v.weather === 'rain' || v.weather === 'storm' ? 0.18 : 0;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    if (ir || dark) { r = g = b = l; } else { r = l + (r - l) * 0.55; g = l + (g - l) * 0.55 + 4; b = l + (b - l) * 0.55; }
    const n = (Math.random() - 0.5) * amp;
    r = r * gain + n; g = g * gain + n; b = b * gain + n;
    if (fog) { r += (150 - r) * fog; g += (155 - g) * fog; b += (160 - b) * fog; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
  if (v.state === 'moving') { ctx.filter = 'blur(3px)'; ctx.drawImage(ctx.canvas, 6, 0); ctx.filter = 'none'; }
  if (v.weather === 'rain' || v.weather === 'storm') { ctx.strokeStyle = 'rgba(220,230,240,0.18)'; ctx.lineWidth = 1; for (let k = 0; k < 40; k++) { const x = Math.random() * FW, y = Math.random() * FH; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 12); ctx.stroke(); } }
  // vignette and scanlines
  const vg = ctx.createRadialGradient(FW / 2, FH / 2, FH * 0.3, FW / 2, FH / 2, FW * 0.62); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, FW, FH);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < FH; y += 3) ctx.fillRect(0, y, FW, 1);
  // analytics boxes over moving objects and anything that stands out
  if (v.state === 'live') for (const det of v.detections) {
    const [sw, sh] = SIZE[det.kind] ?? [1, 1];
    const a = proj(det.x, det.y, 0), t = proj(det.x, det.y, sh);
    if (!a.ok) continue;
    const h = Math.max(6, Math.abs(a.y - t.y)), w = Math.max(6, h * (sw / sh));
    const clear = det.clarity >= 0.28;
    const b = { key: det.key, x: a.x - w / 2, y: a.y - h, w, h, label: clear ? det.label : '?', clear };
    if (b.x > FW || b.y > FH || b.x + b.w < 0 || b.y + b.h < 0) continue;
    out.push(b);
    ctx.strokeStyle = clear ? (det.kind === 'incident' || det.kind === 'suspect' || det.kind === 'vehicle' ? 'rgba(255,214,102,0.95)' : 'rgba(150,220,255,0.85)') : 'rgba(200,200,200,0.55)';
    ctx.lineWidth = 1.2; ctx.setLineDash(clear ? [] : [3, 3]); ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.setLineDash([]);
    ctx.font = '600 10px ui-monospace, monospace'; ctx.textAlign = 'left';
    const tw = ctx.measureText(b.label).width + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(b.x, b.y - 13, tw, 12);
    ctx.fillStyle = clear ? '#ffe6a0' : '#cfcfcf'; ctx.fillText(b.label, b.x + 3, b.y - 4);
  }
  if (v.state === 'moving') { ctx.font = '700 12px ui-monospace, monospace'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('◦ MOVING ◦', FW / 2, FH / 2); }
  overlay(ctx, v, st, now);
  return out;
}

function overlay(ctx: CanvasRenderingContext2D, v: CctvView, st: GameEngine['state'], now: number) {
  ctx.font = '600 11px ui-monospace, monospace'; ctx.fillStyle = 'rgba(235,240,245,0.92)'; ctx.textAlign = 'left';
  ctx.fillText(`${v.cam.id}  ${v.cam.street.toUpperCase()} / ${v.cam.cross.toUpperCase()}`, 10, 18);
  ctx.textAlign = 'right'; ctx.fillText(gameClock(st), FW - 10, 18);
  const compass = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][((Math.round(v.heading / (Math.PI / 4)) % 8) + 8) % 8];
  ctx.textAlign = 'left'; ctx.fillText(`${v.cam.ptz ? 'PTZ' : 'FIXED'} · ${compass} · ${v.zoom}×${v.ir ? ' · IR' : ''}`, 10, FH - 10);
  if (Math.floor(now / 600) % 2) { ctx.fillStyle = '#ff4040'; ctx.beginPath(); ctx.arc(FW - 48, FH - 14, 4.5, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(235,240,245,0.9)'; ctx.textAlign = 'right'; ctx.fillText('REC', FW - 12, FH - 10);
}
function noise(ctx: CanvasRenderingContext2D, alpha: number, base: number) {
  const img = ctx.createImageData(FW, FH), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = base + Math.random() * 120; d[i] = d[i + 1] = d[i + 2] = n; d[i + 3] = 255 * alpha; }
  ctx.putImageData(img, 0, 0);
}
function testCard(ctx: CanvasRenderingContext2D) {
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  bars.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect((i * FW) / 7, 0, FW / 7 + 1, FH * 0.7); });
  ctx.fillStyle = '#111'; ctx.fillRect(0, FH * 0.7, FW, FH * 0.3);
  ctx.font = '600 12px ui-monospace, monospace'; ctx.fillStyle = '#e8ecf4'; ctx.textAlign = 'center';
  ctx.fillText('NO CAMERA SELECTED — CHOOSE ONE FROM THE LIST OR THE MAP', FW / 2, FH * 0.85);
}
/** classic-map fallback: a top-down view turned so the camera looks up the screen */
function draw2D(ctx: CanvasRenderingContext2D, engine: GameEngine, v: CctvView) {
  const st = engine.state;
  const z = 2.6 * v.zoom;
  const rot = -v.heading - Math.PI / 2;
  const cx = v.cam.x + Math.cos(v.heading) * v.range * 0.45, cy = v.cam.y + Math.sin(v.heading) * v.range * 0.45;
  ctx.fillStyle = '#10161c'; ctx.fillRect(0, 0, FW, FH);
  ctx.save();
  ctx.translate(FW / 2, FH / 2); ctx.scale(z, z); ctx.rotate(rot); ctx.translate(-cx, -cy);
  const R = Math.max(FW, FH) / z;
  const vv = { x0: cx - R, y0: cy - R, x1: cx + R, y1: cy + R };
  drawCity(ctx, 2, vv, new Set(st.config.districts), z, { skipRoofs: true, tilt: 0.9 });
  drawBuildings3D(ctx, vv, 0.9, 0, z, false);
  drawModels(ctx, vv, 0.9, 0, z);
  ctx.restore();
  // outside the lens cone is dark
  ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.75)';
  const ox = FW / 2 - Math.cos(-Math.PI / 2) * 0, oy = FH / 2 + v.range * 0.45 * z;
  ctx.beginPath(); ctx.rect(0, 0, FW, FH);
  ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(-Math.PI / 2 - v.fov / 2) * 2000, oy + Math.sin(-Math.PI / 2 - v.fov / 2) * 2000); ctx.lineTo(ox + Math.cos(-Math.PI / 2 + v.fov / 2) * 2000, oy + Math.sin(-Math.PI / 2 + v.fov / 2) * 2000); ctx.closePath();
  ctx.fill('evenodd'); ctx.restore();
  const c = Math.cos(rot), s = Math.sin(rot);
  return (x: number, y: number, h: number) => { const dx = x - cx, dy = y - cy; return { x: FW / 2 + (dx * c - dy * s) * z, y: FH / 2 + (dx * s + dy * c) * z - h * z * 0.9, ok: true }; };
}
