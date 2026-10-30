import { useEffect, useRef, useState } from 'react';
import { getCity, addressOf, WORLD_H, WORLD_W } from '../sim/city';
import { SERVICE_META } from '../sim/fleet';
import { WEATHER_LABEL, WEATHER_SPEED } from '../sim/events';
import type { GameEngine } from '../sim/engine';
import type { HeardLocation, Incident, Unit } from '../sim/types';
import { drawCity, drawNightLights, getScenery } from './scenery';

export type LayerId = 'normal' | 'traffic' | 'coverage' | 'police' | 'fire' | 'medical' | 'incidents' | 'weather';
export const LAYERS: Array<{ id: LayerId; label: string; key: string }> = [
  { id: 'normal', label: 'Normal map', key: 'normal' }, { id: 'traffic', label: 'Traffic', key: 'traffic' }, { id: 'coverage', label: 'Emergency coverage', key: 'coverage' },
  { id: 'police', label: 'Police coverage', key: 'police' }, { id: 'fire', label: 'Fire coverage', key: 'fire' }, { id: 'medical', label: 'Medical coverage', key: 'medical' },
  { id: 'incidents', label: 'Active incidents', key: 'incidents' }, { id: 'weather', label: 'Weather', key: 'weather' },
];
export type MapMode = 'select' | 'pickLocation' | 'reposition';

export interface MapProps {
  engine: GameEngine; layer: LayerId; mode: MapMode; selected: { kind: string | null; id: string | null };
  onSelect: (kind: 'incident' | 'unit' | 'station' | 'district' | null, id: string | null) => void;
  onPickNode?: (node: number) => void; onContext?: (node: number, hit: { kind: string; id: string } | null) => void;
  heard?: HeardLocation[]; onPickHeard?: (h: HeardLocation) => void; focus?: { x: number; y: number; zoom?: number; key: number } | null;
  showIncidents?: boolean; reduceMotion?: boolean; lockedLabel?: boolean; minimap?: boolean; ambient?: boolean;
  preview?: { unitId: string; path: number[] } | null;
}

// ── cached city layers ───────────────────────────────────────────────────────
const PAD = 60;
const cacheStore = new Map<string, HTMLCanvasElement>();
function cityCanvas(scale: number, active: Set<string>, key: string): HTMLCanvasElement {
  const k = `${scale}|${key}`;
  const hit = cacheStore.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = Math.round((WORLD_W + PAD * 2) * scale); c.height = Math.round((WORLD_H + PAD * 2) * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0b2133'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(scale, 0, 0, scale, PAD * scale, PAD * scale);
  drawCity(ctx, scale >= 1.5 ? 1 : 0, null, active, scale);
  // keep memory bounded: drop other caches for other district sets
  for (const old of [...cacheStore.keys()]) if (!old.endsWith(`|${key}`)) cacheStore.delete(old);
  cacheStore.set(k, c);
  return c;
}
let nightCanvas: HTMLCanvasElement | null = null;
function lightsCanvas(): HTMLCanvasElement {
  if (nightCanvas) return nightCanvas;
  const c = document.createElement('canvas');
  c.width = WORLD_W + PAD * 2; c.height = WORLD_H + PAD * 2;
  const ctx = c.getContext('2d')!;
  ctx.translate(PAD, PAD);
  drawNightLights(ctx, null);
  nightCanvas = c;
  return c;
}

const VEH: Record<string, { body: string; trim: string; bar: [string, string] }> = {
  police: { body: '#1f3d66', trim: '#e8edf2', bar: ['#ff3b3b', '#3b8bff'] },
  fire: { body: '#b8373a', trim: '#f0c6c6', bar: ['#ff3b3b', '#ffffff'] },
  medical: { body: '#e9edf1', trim: '#54B889', bar: ['#ff3b3b', '#3b8bff'] },
};
const FX_COLOR = { good: '#6fd6a3', bad: '#ff8080', warn: '#f0c070', info: '#7cc0f0' };
function sevColor(sev: number) { return sev >= 4 ? '#D65353' : sev === 3 ? '#E5AC4D' : '#4A9CD6'; }
function covColor(t: number): string {
  if (!isFinite(t)) return 'rgba(214,83,83,0.42)';
  if (t < 45) return 'rgba(84,184,137,0.38)'; if (t < 85) return 'rgba(143,191,106,0.36)'; if (t < 125) return 'rgba(229,172,77,0.36)'; if (t < 175) return 'rgba(214,138,77,0.4)'; return 'rgba(214,83,83,0.42)';
}
interface Puff { x: number; y: number; r: number; a: number; vx: number; vy: number }

export function MapView(props: MapProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const P = useRef(props); P.current = props;
  const cam = useRef({ x: WORLD_W / 2, y: WORLD_H / 2, z: 0.5, tx: WORLD_W / 2, ty: WORLD_H / 2, tz: 0.5, fit: 0.5, init: false, W: 1, H: 1 });
  const drag = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null);
  const hover = useRef<{ kind: string; id: string; label: string } | null>(null);
  const mouse = useRef({ x: 0, y: 0, inside: false });
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const lastFocus = useRef(0);
  const offs = useRef(new Map<string, { dx: number; dy: number }>());
  const heading = useRef(new Map<string, { x: number; y: number; h: number }>());
  const smoke = useRef(new Map<string, Puff[]>());

  useEffect(() => {
    const canvas = ref.current!, el = wrap.current!;
    const city = getCity();
    getScenery();
    let raf = 0, W = 0, H = 0, dpr = 1, lastT = performance.now(), lastMini = 0;
    const particles = Array.from({ length: 180 }, () => ({ x: Math.random(), y: Math.random(), v: 0.4 + Math.random() * 0.8 }));
    const resize = () => {
      const r = el.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(10, r.width); H = Math.max(10, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      const c = cam.current;
      c.W = W; c.H = H;
      c.fit = Math.min(W / (WORLD_W + 40), H / (WORLD_H - 40));
      if (!c.init) { c.z = c.tz = c.fit; c.x = c.tx = WORLD_W / 2; c.y = c.ty = WORLD_H / 2 - 30; c.init = true; }
      c.tz = Math.max(c.tz, c.fit * 0.95);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);

    const toWorld = (sx: number, sy: number) => ({ x: (sx - W / 2) / cam.current.z + cam.current.x, y: (sy - H / 2) / cam.current.z + cam.current.y });
    const toScreen = (x: number, y: number) => ({ x: (x - cam.current.x) * cam.current.z + W / 2, y: (y - cam.current.y) * cam.current.z + H / 2 });
    const pinPos = (inc: Incident) => { const n = city.nodes[inc.reportedNode!]; return toScreen(n.x, n.y); };

    const hit = (sx: number, sy: number): { kind: 'incident' | 'unit' | 'station' | 'heard'; id: string; label: string } | null => {
      const st = P.current.engine.state;
      if (P.current.showIncidents !== false) for (const inc of Object.values(st.incidents)) {
        if (inc.reportedNode === null || inc.hidden || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
        const p = pinPos(inc);
        if (Math.hypot(p.x - sx, p.y - 18 - sy) < 15 || Math.hypot(p.x - sx, p.y - sy) < 9) return { kind: 'incident', id: inc.id, label: `${inc.label} — ${addressOf(city, inc.reportedNode)}` };
      }
      for (const h of P.current.heard ?? []) {
        const n = city.nodes[h.nodeId]; const p = toScreen(n.x, n.y);
        if (Math.hypot(p.x - sx, p.y - sy) < 13) return { kind: 'heard', id: h.id, label: h.label };
      }
      for (const u of Object.values(st.units)) {
        const p = toScreen(u.x, u.y); const o = offs.current.get(u.id) ?? { dx: 0, dy: 0 };
        if (Math.hypot(p.x + o.dx - sx, p.y + o.dy - sy) < 12) return { kind: 'unit', id: u.id, label: `${u.callsign} · ${u.typeLabel} — ${u.status.replace(/_/g, ' ')}${u.note ? ` (${u.note})` : ''}` };
      }
      for (const s of Object.values(st.stations)) {
        const n = city.nodes[s.nodeId]; const p = toScreen(n.x, n.y);
        if (Math.hypot(p.x - sx, p.y - sy) < 13) return { kind: 'station', id: s.id, label: s.name };
      }
      return null;
    };

    const inPoly = (pts: Array<{ x: number; y: number }>, x: number, y: number) => {
      let ins = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) ins = !ins; }
      return ins;
    };
    const onDown = (e: PointerEvent) => { if (e.button === 2) return; drag.current = { sx: e.clientX, sy: e.clientY, cx: cam.current.tx, cy: cam.current.ty, moved: false }; };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top, inside };
      const d = drag.current;
      if (d) {
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        if (d.moved) { cam.current.tx = d.cx - dx / cam.current.z; cam.current.ty = d.cy - dy / cam.current.z; cam.current.x = cam.current.tx; cam.current.y = cam.current.ty; }
      }
      if (!inside) return;
      const h = hit(mouse.current.x, mouse.current.y);
      const prev = hover.current;
      hover.current = h;
      if (P.current.mode === 'pickLocation') { const w = toWorld(mouse.current.x, mouse.current.y); setTip({ x: mouse.current.x, y: mouse.current.y, text: `Set location: ${addressOf(city, city.nearestNode(w.x, w.y))}` }); }
      else if (h && (!prev || prev.id !== h.id)) setTip({ x: mouse.current.x, y: mouse.current.y, text: h.label });
      else if (h) setTip((t) => (t ? { ...t, x: mouse.current.x, y: mouse.current.y } : t));
      else setTip((t) => (t ? null : t));
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current; drag.current = null;
      if (!d || d.moved || e.button === 2) return;
      const r = canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) return;
      const w = toWorld(sx, sy);
      if (P.current.mode === 'pickLocation') { P.current.onPickNode?.(city.nearestNode(w.x, w.y)); return; }
      const h = hit(sx, sy);
      if (h) {
        if (h.kind === 'heard') { const hh = (P.current.heard ?? []).find((x) => x.id === h.id); if (hh) P.current.onPickHeard?.(hh); }
        else P.current.onSelect(h.kind as 'incident' | 'unit' | 'station', h.id);
        return;
      }
      for (const d2 of city.districts) if (inPoly(d2.poly, w.x, w.y)) { P.current.onSelect('district', d2.id); return; }
      P.current.onSelect(null, null);
    };
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const w = toWorld(sx, sy); const h = hit(sx, sy);
      P.current.onContext?.(city.nearestNode(w.x, w.y), h && h.kind !== 'heard' ? { kind: h.kind, id: h.id } : null);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = cam.current; const r = canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const before = { x: (sx - W / 2) / c.tz + c.tx, y: (sy - H / 2) / c.tz + c.ty };
      c.tz = Math.max(c.fit * 0.95, Math.min(7, c.tz * Math.exp(-e.deltaY * 0.0015)));
      c.tx = before.x - (sx - W / 2) / c.tz; c.ty = before.y - (sy - H / 2) / c.tz;
    };
    const onLeave = () => { mouse.current.inside = false; hover.current = null; setTip(null); };
    canvas.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', onCtx); canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('pointerleave', onLeave);

    // minimap clicks
    const mc = mini.current;
    const onMini = (e: PointerEvent) => {
      if (!mc) return;
      const r = mc.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      cam.current.tx = fx * (WORLD_W + PAD * 2) - PAD; cam.current.ty = fy * (WORLD_H + PAD * 2) - PAD;
    };
    mc?.addEventListener('pointerdown', onMini);

    const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dtMs = Math.min(100, now - lastT); lastT = now;
      const pr = P.current, eng = pr.engine, st = eng.state, c = cam.current;
      const motion = !pr.reduceMotion;
      if (pr.focus && pr.focus.key !== lastFocus.current) { lastFocus.current = pr.focus.key; c.tx = pr.focus.x; c.ty = pr.focus.y; if (pr.focus.zoom) c.tz = Math.max(c.fit, pr.focus.zoom); }
      const ease = motion ? 0.18 : 1;
      c.z += (c.tz - c.z) * ease; if (!drag.current?.moved) { c.x += (c.tx - c.x) * ease; c.y += (c.ty - c.y) * ease; }
      const ctx = canvas.getContext('2d')!;
      const active = new Set(st.config.districts);
      const activeKey = [...active].sort().join(',');
      const z = c.z, eff = z * dpr;
      const view = { x0: c.x - W / 2 / z, y0: c.y - H / 2 / z, x1: c.x + W / 2 / z, y1: c.y + H / 2 / z };
      const hour = ((st.timeOfDay % 24) + 24) % 24;
      const night = hour >= 21 || hour < 5 ? 1 : hour >= 19 ? (hour - 19) / 2 : hour < 7 ? (7 - hour) / 2 : 0;
      const tSec = now / 1000;

      // ── world layer ──
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b2133'; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-c.x, -c.y);
      if (eff <= 1.15) ctx.drawImage(cityCanvas(1, active, activeKey), -PAD, -PAD, WORLD_W + PAD * 2, WORLD_H + PAD * 2);
      else if (eff <= 2.6) ctx.drawImage(cityCanvas(2, active, activeKey), -PAD, -PAD, WORLD_W + PAD * 2, WORLD_H + PAD * 2);
      else drawCity(ctx, 2, view, active, z);
      // water glints
      if (motion) {
        ctx.strokeStyle = 'rgba(170,215,240,0.16)'; ctx.lineWidth = 1.2; ctx.beginPath();
        const rl = city.riverline;
        for (let k = 0; k < 40; k++) {
          const i = (k * 7) % (rl.length - 1); const p = rl[i];
          const off = ((tSec * 9 + k * 37) % 50) - 25;
          ctx.moveTo(p.x + off, p.y + ((k % 3) - 1) * 6); ctx.lineTo(p.x + off + 6, p.y + ((k % 3) - 1) * 6);
        }
        for (let k = 0; k < 50; k++) { const x = (k * 97) % WORLD_W, y = city.coast[Math.floor((x / WORLD_W) * (city.coast.length - 1))].y + 20 + ((k * 13) % 60); const off = Math.sin(tSec * 0.8 + k) * 6; ctx.moveTo(x + off, y); ctx.lineTo(x + off + 8, y); }
        ctx.stroke();
      }
      // locked districts are greyed out
      for (const d of city.districts) {
        if (active.has(d.id)) continue;
        ctx.fillStyle = 'rgba(10,14,20,0.42)'; ctx.beginPath(); ctx.moveTo(d.poly[0].x, d.poly[0].y); for (const p of d.poly) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.fill();
      }
      // night: darken, then add lights
      if (night > 0) {
        ctx.fillStyle = `rgba(3,7,20,${0.42 * night})`; ctx.fillRect(-PAD, -PAD, WORLD_W + PAD * 2, WORLD_H + PAD * 2);
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85 * night;
        ctx.drawImage(lightsCanvas(), -PAD, -PAD, WORLD_W + PAD * 2, WORLD_H + PAD * 2);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      const layer = pr.layer;
      if (layer === 'traffic') {
        const cols = ['rgba(84,184,137,0.9)', 'rgba(229,172,77,0.9)', 'rgba(214,133,63,0.95)', 'rgba(214,83,83,0.95)'];
        const ps = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
        for (const e of city.edges) {
          const a = city.nodes[e.a], b = city.nodes[e.b];
          const tr = ((st.districtTraffic[a.district] ?? 0.3) + (st.districtTraffic[b.district] ?? 0.3)) / 2 * (e.cls === 'highway' ? 0.7 : e.cls === 'arterial' ? 1.05 : e.cls === 'local' ? 0.7 : 1.1);
          const bucket = tr < 0.28 ? 0 : tr < 0.5 ? 1 : tr < 0.72 ? 2 : 3;
          ps[bucket].moveTo(a.x, a.y); ps[bucket].lineTo(b.x, b.y);
        }
        ctx.lineCap = 'round';
        ps.forEach((p, i) => { ctx.strokeStyle = cols[i]; ctx.lineWidth = Math.max(2.4, 1.6 / z) + i * 0.6; ctx.stroke(p); });
        // animated flow chevrons on busy roads
        if (motion) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([2, 10]); ctx.lineDashOffset = -tSec * 14; ctx.stroke(ps[0]); ctx.lineDashOffset = -tSec * 6; ctx.stroke(ps[2]); ctx.setLineDash([]); }
      }
      if (layer === 'coverage' || layer === 'police' || layer === 'fire' || layer === 'medical') {
        const svcs = layer === 'coverage' ? (['police', 'fire', 'medical'] as const) : ([layer] as const);
        const ts = svcs.map((s) => eng.coverageTimes(s));
        ctx.save();
        ctx.beginPath(); for (const d of city.districts) if (active.has(d.id)) { ctx.moveTo(d.poly[0].x, d.poly[0].y); for (const p of d.poly) ctx.lineTo(p.x, p.y); ctx.closePath(); }
        ctx.clip();
        for (const n of city.nodes) {
          if (!active.has(n.district)) continue;
          let worst = 0; for (const t of ts) worst = Math.max(worst, t[n.id]);
          ctx.fillStyle = covColor(worst); ctx.fillRect(n.x - 26, n.y - 28, 52, 56);
        }
        ctx.restore();
      }
      // closed roads with barriers
      if (st.closedEdges.length) {
        ctx.strokeStyle = 'rgba(214,83,83,0.9)'; ctx.lineWidth = Math.max(3, 2 / z); ctx.setLineDash([5, 4]);
        ctx.beginPath(); for (const eid of st.closedEdges) { const e = city.edges[eid]; ctx.moveTo(city.nodes[e.a].x, city.nodes[e.a].y); ctx.lineTo(city.nodes[e.b].x, city.nodes[e.b].y); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      // district borders
      ctx.setLineDash([6 / z, 6 / z]); ctx.strokeStyle = 'rgba(170,185,200,0.22)'; ctx.lineWidth = Math.max(1, 1 / z);
      for (const d of city.districts) { ctx.beginPath(); ctx.moveTo(d.poly[0].x, d.poly[0].y); for (const p of d.poly) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.stroke(); }
      ctx.setLineDash([]);
      if (st.selected.kind === 'district') { const d = city.districtById[st.selected.id!]; if (d) { ctx.strokeStyle = '#4A9CD6'; ctx.lineWidth = Math.max(2, 2 / z); ctx.beginPath(); ctx.moveTo(d.poly[0].x, d.poly[0].y); for (const p of d.poly) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.stroke(); } }
      ctx.restore();

      // ── screen-space overlays ──
      const S = (x: number, y: number) => ({ x: (x - c.x) * z + W / 2, y: (y - c.y) * z + H / 2 });
      if (layer === 'incidents') { ctx.fillStyle = 'rgba(8,12,18,0.5)'; ctx.fillRect(0, 0, W, H); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      // district labels
      if (z < 2.8 && pr.lockedLabel !== false) {
        for (const d of city.districts) {
          const p = S(d.center.x, d.center.y - 40);
          const locked = !active.has(d.id);
          ctx.font = `700 ${Math.max(10, Math.min(15, 10 + z * 3.5))}px Inter, system-ui, sans-serif`;
          const name = d.name.toUpperCase().split('').join(' ');
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,0.75)'; ctx.strokeText(name, p.x, p.y);
          ctx.fillStyle = locked ? 'rgba(152,166,181,0.42)' : 'rgba(214,224,234,0.82)'; ctx.fillText(name, p.x, p.y);
          if (locked) { ctx.font = '600 9px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(152,166,181,0.55)'; ctx.fillText(`🔒 RANK ${d.unlockRank}`, p.x, p.y + 14); }
        }
      }
      ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(110,160,210,0.55)';
      const rv = S(260, city.riverline[5].y + 1); if (z > 0.6) ctx.fillText('R A V E N P O R T   R I V E R', rv.x, rv.y);
      const sea = S(1000, 1365); ctx.fillText('S O U T H E R N   B A Y', sea.x, sea.y);

      // landmarks
      if (z > 0.55) for (const l of city.landmarks) {
        const n = city.nodes[l.nodeId]; const p = S(n.x, n.y + 18);
        if (l.kind === 'hospital') {
          const closed = st.closedHospitals.includes(l.nodeId);
          ctx.fillStyle = closed ? '#5a636e' : '#e8edf2'; roundRect(ctx, p.x - 8, p.y - 8, 16, 16, 4); ctx.fill();
          ctx.fillStyle = closed ? '#2a2f35' : '#D65353'; ctx.fillRect(p.x - 1.8, p.y - 5.5, 3.6, 11); ctx.fillRect(p.x - 5.5, p.y - 1.8, 11, 3.6);
          if (closed) { ctx.strokeStyle = '#ff8080'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x - 9, p.y - 9); ctx.lineTo(p.x + 9, p.y + 9); ctx.stroke(); }
          if (z > 1.05) { ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,0.8)'; const t = l.name + (closed ? ' (diverting)' : ''); ctx.strokeText(t, p.x, p.y + 17); ctx.fillStyle = closed ? '#ff9a9a' : 'rgba(232,237,242,0.9)'; ctx.fillText(t, p.x, p.y + 17); }
        } else if (z > 1.4) {
          ctx.fillStyle = 'rgba(190,200,212,0.7)'; ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x + 4, p.y); ctx.lineTo(p.x, p.y + 4); ctx.lineTo(p.x - 4, p.y); ctx.closePath(); ctx.fill();
          if (z > 2) { ctx.font = '500 10px Inter, system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,0.8)'; ctx.strokeText(l.name, p.x, p.y + 12); ctx.fillStyle = 'rgba(200,210,222,0.9)'; ctx.fillText(l.name, p.x, p.y + 12); }
        }
      }
      // stations
      for (const s of Object.values(st.stations)) {
        const n = city.nodes[s.nodeId]; const p = S(n.x, n.y); const m = SERVICE_META[s.service];
        const off = s.disabledShifts > 0;
        ctx.globalAlpha = off ? 0.45 : 1;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, p.x - 9, p.y - 7, 20, 20, 5); ctx.fill();
        ctx.fillStyle = '#121820'; ctx.strokeStyle = m.color; ctx.lineWidth = 2;
        roundRect(ctx, p.x - 10, p.y - 10, 20, 20, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = m.color; ctx.font = '800 11px Inter, system-ui, sans-serif'; ctx.fillText(m.glyph, p.x, p.y + 0.5);
        if (z > 1.25) { ctx.font = '600 9px Inter, system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,0.8)'; ctx.strokeText(s.name, p.x, p.y - 17); ctx.fillStyle = 'rgba(214,224,234,0.85)'; ctx.fillText(s.name, p.x, p.y - 17); }
        ctx.globalAlpha = 1;
        if (st.selected.kind === 'station' && st.selected.id === s.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; roundRect(ctx, p.x - 14, p.y - 14, 28, 28, 7); ctx.stroke(); }
      }

      // routes
      const sel = st.selected;
      const drawRoute = (u: Unit, strong: boolean) => {
        if (!u.route.length) return;
        const col = SERVICE_META[u.service].color;
        ctx.beginPath(); const p0 = S(u.x, u.y); ctx.moveTo(p0.x, p0.y);
        for (const nId of u.route) { const nn = city.nodes[nId]; const pp = S(nn.x, nn.y); ctx.lineTo(pp.x, pp.y); }
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        if (strong) { ctx.strokeStyle = col; ctx.globalAlpha = 0.25; ctx.lineWidth = 7; ctx.stroke(); }
        ctx.globalAlpha = strong ? 0.95 : 0.35; ctx.strokeStyle = col; ctx.lineWidth = strong ? 2.4 : 1.4;
        ctx.setLineDash([7, 6]); ctx.lineDashOffset = motion ? -(now / 45) % 13 : 0; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      };
      for (const u of Object.values(st.units)) {
        const strong = (sel.kind === 'unit' && sel.id === u.id) || (sel.kind === 'incident' && u.assignedIncidentId === sel.id);
        if (['EN_ROUTE', 'TRANSPORTING'].includes(u.status) || strong) drawRoute(u, strong);
      }
      if (pr.preview && pr.preview.path.length) {
        const u = st.units[pr.preview.unitId];
        if (u) {
          ctx.beginPath(); const p0 = S(u.x, u.y); ctx.moveTo(p0.x, p0.y);
          for (const nId of pr.preview.path) { const nn = city.nodes[nId]; const pp = S(nn.x, nn.y); ctx.lineTo(pp.x, pp.y); }
          ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.2; ctx.setLineDash([5, 5]); ctx.lineDashOffset = motion ? -(now / 40) % 10 : 0; ctx.stroke(); ctx.setLineDash([]);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p0.x, p0.y, 16, 0, 7); ctx.stroke();
        }
      }
      if (sel.kind === 'unit' && sel.id) { const u = st.units[sel.id]; if (u && u.destNode !== null && u.destNode >= 0) { const dn = city.nodes[u.destNode]; const p = S(dn.x, dn.y); ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; } }

      // heard locations
      for (const h of pr.heard ?? []) {
        const n = city.nodes[h.nodeId]; const p = S(n.x, n.y);
        const col = h.reliability === 'sure' ? '#54B889' : h.reliability === 'contradicted' ? '#8a96a3' : '#E5AC4D';
        ctx.fillStyle = 'rgba(8,12,18,0.7)'; ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(h.reliability === 'sure' ? [] : [4, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.font = '800 11px Inter, system-ui, sans-serif'; ctx.fillText(h.reliability === 'contradicted' ? '×' : '?', p.x, p.y + 0.5);
      }

      // pursuit suspects
      for (const inc of Object.values(st.incidents)) {
        const m = inc.mover;
        if (!m || !inc.pursuit || ['RESOLVED', 'CLOSED'].includes(inc.status) || inc.reportedNode === null) continue;
        if (!m.tracked && m.contact === 0) continue;
        if (m.trail.length > 1) {
          ctx.lineWidth = 2.5; ctx.lineCap = 'round';
          for (let i = 1; i < m.trail.length; i++) { const a = S(m.trail[i - 1].x, m.trail[i - 1].y), b = S(m.trail[i].x, m.trail[i].y); ctx.strokeStyle = `rgba(240,160,70,${(i / m.trail.length) * 0.6})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
        const p = S(m.x, m.y);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(m.heading);
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, -7, -2.5, 15, 8, 2); ctx.fill();
        ctx.fillStyle = '#b8bcc4'; roundRect(ctx, -7.5, -4, 15, 8, 2.5); ctx.fill();
        ctx.fillStyle = '#2a3038'; ctx.fillRect(-1.5, -3, 5, 6);
        ctx.restore();
        const blink = motion ? (Math.floor(now / 260) % 2 === 0) : true;
        ctx.strokeStyle = blink ? '#f0a046' : 'rgba(240,160,70,0.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, 7); ctx.stroke();
        ctx.font = '800 9px Inter, system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,0.85)'; ctx.strokeText('SUSPECT', p.x, p.y - 20); ctx.fillStyle = '#f0b060'; ctx.fillText('SUSPECT', p.x, p.y - 20);
      }

      // incidents
      const pulse = motion ? (Math.sin(now / 320) + 1) / 2 : 0.5;
      if (pr.showIncidents !== false) for (const inc of Object.values(st.incidents)) {
        if (inc.reportedNode === null || inc.hidden || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
        const p = pinPos(inc);
        const col = sevColor(inc.severity);
        const big = layer === 'incidents' ? 1.25 : 1;
        // ground effects
        if (inc.category === 'fire' && !inc.duplicateOf && inc.requires.length) {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, (26 + inc.stage * 12) * Math.max(0.7, Math.min(1.6, z)));
          const fl = motion ? 0.55 + Math.sin(now / 90) * 0.12 + Math.sin(now / 37) * 0.08 : 0.6;
          g.addColorStop(0, `rgba(255,150,60,${fl})`); g.addColorStop(0.5, 'rgba(230,90,40,0.18)'); g.addColorStop(1, 'rgba(230,90,40,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, (26 + inc.stage * 12) * Math.max(0.7, Math.min(1.6, z)), 0, 7); ctx.fill();
          if (motion) {
            const puffs = smoke.current.get(inc.id) ?? [];
            if (puffs.length < 14 + inc.stage * 6 && Math.random() < dtMs / 120) { const n = city.nodes[inc.reportedNode]; puffs.push({ x: n.x + (Math.random() - 0.5) * 6, y: n.y, r: 3 + Math.random() * 2, a: 0.5, vx: 2.5 + Math.random() * 2, vy: -4 - Math.random() * 3 }); }
            for (const q of puffs) { q.x += q.vx * dtMs / 1000; q.y += q.vy * dtMs / 1000; q.r += 3 * dtMs / 1000; q.a -= 0.09 * dtMs / 1000; }
            const alive = puffs.filter((q) => q.a > 0);
            smoke.current.set(inc.id, alive);
            for (const q of alive) { const sp = S(q.x, q.y); ctx.fillStyle = `rgba(70,74,80,${q.a})`; ctx.beginPath(); ctx.arc(sp.x, sp.y, q.r * Math.max(0.6, Math.min(2, z)), 0, 7); ctx.fill(); }
          }
        } else if (inc.category === 'police' && inc.assignedUnits.length === 0) {
          ctx.strokeStyle = Math.floor(now / 400) % 2 ? 'rgba(80,140,255,0.5)' : 'rgba(255,80,80,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 16 + pulse * 6, 0, 7); ctx.stroke();
        }
        const unattended = inc.assignedUnits.length === 0;
        // base ring
        ctx.globalAlpha = 0.2 + 0.25 * pulse; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(p.x, p.y, 10 + pulse * 7, 5 + pulse * 3, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
        // pin
        const r = 11 * big, top = p.y - 20 * big;
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(p.x + 2, top + 3, r, 0, 7); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(p.x - r * 0.62, top + r * 0.75); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x + r * 0.62, top + r * 0.75); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#10151c'; ctx.strokeStyle = col; ctx.lineWidth = unattended ? 2.2 : 3;
        if (unattended && motion) ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.arc(p.x, top, r, 0, 7); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; glyph(ctx, inc.category, p.x, top, 5.2 * big);
        // severity pips
        for (let k = 0; k < inc.severity; k++) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x - (inc.severity - 1) * 2.6 + k * 5.2, top - r - 5, 1.7, 0, 7); ctx.fill(); }
        if (inc.status === 'ESCALATING' || inc.stage > 0) { ctx.fillStyle = '#ff6b6b'; ctx.font = '900 12px Inter, system-ui, sans-serif'; ctx.fillText('!', p.x + r + 4, top - r + 2); }
        if (inc.duplicateOf) { ctx.fillStyle = '#7cc0f0'; ctx.font = '800 9px Inter, system-ui, sans-serif'; ctx.fillText('DUP?', p.x + r + 12, top); }
        if (sel.kind === 'incident' && sel.id === inc.id) {
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.setLineDash([4, 4]); ctx.lineDashOffset = motion ? now / 60 : 0; ctx.beginPath(); ctx.arc(p.x, top, r + 6, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        }
        if (z > 0.85 || layer === 'incidents' || (sel.kind === 'incident' && sel.id === inc.id)) {
          ctx.font = '700 10px Inter, system-ui, sans-serif';
          const text = inc.label;
          const tw = ctx.measureText(text).width + 12;
          ctx.fillStyle = 'rgba(12,17,23,0.88)'; roundRect(ctx, p.x - tw / 2, p.y + 6, tw, 16, 4); ctx.fill();
          ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = '#e8edf2'; ctx.fillText(text, p.x, p.y + 14.5);
        }
      }

      // units (stacked parked units fan out so each stays clickable)
      const dimUnits = layer === 'incidents' ? 0.55 : 1;
      const groups = new Map<string, Unit[]>();
      for (const u of Object.values(st.units)) { const k = `${Math.round(u.x / 3)},${Math.round(u.y / 3)}`; const g = groups.get(k); if (g) g.push(u); else groups.set(k, [u]); }
      offs.current.clear();
      for (const g of groups.values()) g.forEach((u, i) => { if (g.length > 1) { const ang = (i / g.length) * Math.PI * 2 - Math.PI / 2; offs.current.set(u.id, { dx: Math.cos(ang) * 14, dy: Math.sin(ang) * 14 + 4 }); } });
      const vs = Math.max(0.75, Math.min(1.5, 0.6 + z * 0.45));
      for (const u of Object.values(st.units)) {
        const o0 = offs.current.get(u.id) ?? { dx: 0, dy: 0 };
        const p0 = S(u.x, u.y); const p = { x: p0.x + o0.dx, y: p0.y + o0.dy };
        if (p.x < -40 || p.y < -40 || p.x > W + 40 || p.y > H + 40) continue;
        const hd = heading.current.get(u.id) ?? { x: u.x, y: u.y, h: -Math.PI / 2 };
        if (Math.hypot(u.x - hd.x, u.y - hd.y) > 0.6) { hd.h = Math.atan2(u.y - hd.y, u.x - hd.x); hd.x = u.x; hd.y = u.y; }
        heading.current.set(u.id, hd);
        const responding = (['EN_ROUTE', 'DISPATCHED'].includes(u.status) && u.code !== 2) || u.status === 'TRANSPORTING' || (u.status === 'ON_SCENE' && !!u.assignedIncidentId);
        const moving = u.speed > 0.1 && ['EN_ROUTE', 'TRANSPORTING', 'RETURNING'].includes(u.status);
        const v = VEH[u.service];
        ctx.globalAlpha = (u.status === 'OUT_OF_SERVICE' ? 0.4 : 1) * dimUnits;
        // siren glow
        if (responding && motion) {
          const ph = Math.floor(now / 170) % 2;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 18 * vs);
          g.addColorStop(0, ph ? `${v.bar[0]}55` : `${v.bar[1]}55`); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 18 * vs, 0, 7); ctx.fill();
        }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(hd.h);
        const L = (u.type === 'ladder' || u.type === 'heavy_rescue' ? 19 : u.type === 'motorcycle' ? 9 : 15) * vs, Wd = (u.type === 'motorcycle' ? 4 : 7.5) * vs;
        if (night > 0.3 && moving) { ctx.fillStyle = `rgba(255,240,200,${0.14 * night})`; ctx.beginPath(); ctx.moveTo(L / 2, -Wd * 0.3); ctx.lineTo(L / 2 + 26 * vs, -10 * vs); ctx.lineTo(L / 2 + 26 * vs, 10 * vs); ctx.lineTo(L / 2, Wd * 0.3); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, -L / 2 + 1.5, -Wd / 2 + 2, L, Wd, 2 * vs); ctx.fill();
        ctx.fillStyle = v.body; roundRect(ctx, -L / 2, -Wd / 2, L, Wd, 2 * vs); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1; ctx.stroke();
        if (u.service === 'police') { ctx.fillStyle = v.trim; ctx.fillRect(-L * 0.12, -Wd / 2 + 1, L * 0.32, Wd - 2); }
        else if (u.service === 'fire') { ctx.fillStyle = '#d65a5a'; ctx.fillRect(L * 0.18, -Wd / 2 + 0.8, L * 0.28, Wd - 1.6); if (u.type === 'ladder') { ctx.strokeStyle = '#d8dde3'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-L / 2 + 2, -1.5); ctx.lineTo(L * 0.15, -1.5); ctx.moveTo(-L / 2 + 2, 1.5); ctx.lineTo(L * 0.15, 1.5); ctx.stroke(); } }
        else { ctx.fillStyle = v.trim; ctx.fillRect(-L / 2 + 1, -0.9 * vs, L - 2, 1.8 * vs); ctx.fillStyle = '#D65353'; ctx.fillRect(-L * 0.25, -Wd * 0.28, 1.6 * vs, Wd * 0.56); }
        // light bar
        const ph2 = motion ? Math.floor(now / 140) % 2 : 0;
        ctx.fillStyle = responding ? (ph2 ? v.bar[0] : v.bar[1]) : '#5a636e'; ctx.fillRect(L * 0.02, -Wd / 2 + 0.6, 2.4 * vs, Wd * 0.45);
        ctx.fillStyle = responding ? (ph2 ? v.bar[1] : v.bar[0]) : '#5a636e'; ctx.fillRect(L * 0.02, 0, 2.4 * vs, Wd * 0.45 - 0.6);
        ctx.restore();
        ctx.globalAlpha = 1;
        if (u.temp) { ctx.strokeStyle = '#E5AC4D'; ctx.setLineDash([2, 2]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
        if (u.status === 'ON_SCENE') { ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, 12 * vs, 0, 7); ctx.stroke(); }
        const selected = sel.kind === 'unit' && sel.id === u.id;
        if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.setLineDash([4, 3]); ctx.lineDashOffset = motion ? now / 70 : 0; ctx.beginPath(); ctx.arc(p.x, p.y, 15 * vs, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
        if (z > 1.1 || selected || hover.current?.id === u.id) {
          // service-coded badge: diamond (police), circle (fire), square (medical)
          const bx = p.x, by = p.y + 13 * vs + 5;
          ctx.font = '700 9px Inter, system-ui, sans-serif';
          const tw = ctx.measureText(u.callsign).width + 16;
          ctx.fillStyle = 'rgba(12,17,23,0.88)'; roundRect(ctx, bx - tw / 2, by - 7, tw, 14, 3); ctx.fill();
          ctx.fillStyle = SERVICE_META[u.service].color;
          const gx = bx - tw / 2 + 6;
          ctx.beginPath();
          if (u.service === 'police') { ctx.moveTo(gx, by - 3.5); ctx.lineTo(gx + 3.5, by); ctx.lineTo(gx, by + 3.5); ctx.lineTo(gx - 3.5, by); ctx.closePath(); }
          else if (u.service === 'fire') ctx.arc(gx, by, 3, 0, 7); else ctx.rect(gx - 3, by - 3, 6, 6);
          ctx.fill();
          ctx.fillStyle = '#e8edf2'; ctx.fillText(u.callsign, bx + 4, by + 0.5);
        }
      }

      // floating feedback
      for (const f of st.fx) {
        const age = st.time - f.t;
        if (age > 4 || age < 0) continue;
        const p = S(f.x, f.y);
        const y = p.y - 34 - age * 12;
        ctx.globalAlpha = Math.max(0, 1 - age / 4);
        ctx.font = '800 13px Inter, system-ui, sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(8,12,18,0.9)'; ctx.strokeText(f.text, p.x, y);
        ctx.fillStyle = FX_COLOR[f.kind]; ctx.fillText(f.text, p.x, y);
        ctx.globalAlpha = 1;
      }

      // weather
      if (st.weather !== 'clear' || layer === 'weather') {
        const I = Math.max(0.3, st.weatherIntensity) * (layer === 'weather' ? 1.4 : 1);
        if (st.weather === 'rain' || st.weather === 'storm') {
          ctx.strokeStyle = `rgba(160,200,235,${0.32 * I})`; ctx.lineWidth = 1; ctx.beginPath();
          const n = Math.floor(150 * Math.min(1.2, I));
          for (let i = 0; i < n; i++) { const q = particles[i]; const y = motion ? ((q.y + now / (800 / q.v)) % 1) * H : q.y * H, x = (q.x * W + y * 0.22) % W; ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 12); }
          ctx.stroke();
          ctx.fillStyle = `rgba(20,40,70,${0.12 * I})`; ctx.fillRect(0, 0, W, H);
          if (st.weather === 'storm' && motion && Math.sin(now / 1900) > 0.988) { ctx.fillStyle = 'rgba(220,235,255,0.28)'; ctx.fillRect(0, 0, W, H); }
        } else if (st.weather === 'snow') {
          ctx.fillStyle = `rgba(235,242,250,${0.75 * I})`;
          for (let i = 0; i < 130; i++) { const q = particles[i]; const y = motion ? ((q.y + now / (5200 / q.v)) % 1) * H : q.y * H, x = (q.x * W + (motion ? Math.sin(now / 900 + i) * 14 : 0) + W) % W; ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 7); ctx.fill(); }
          ctx.fillStyle = `rgba(220,232,245,${0.07 * I})`; ctx.fillRect(0, 0, W, H);
        } else if (st.weather === 'fog') {
          for (let k = 0; k < 4; k++) { const g = ctx.createRadialGradient(((k * 0.31 + (motion ? now / 90000 : 0)) % 1) * W, H * (0.2 + k * 0.2), 0, ((k * 0.31) % 1) * W, H * (0.2 + k * 0.2), W * 0.5); g.addColorStop(0, `rgba(180,195,210,${0.16 * I})`); g.addColorStop(1, 'rgba(180,195,210,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
        } else if (st.weather === 'heat') { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(229,150,60,${0.1 * I})`); g.addColorStop(1, 'rgba(229,150,60,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
        if (layer === 'weather') { ctx.fillStyle = 'rgba(232,237,242,0.92)'; ctx.font = '700 13px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`${WEATHER_LABEL[st.weather]} · intensity ${Math.round(st.weatherIntensity * 100)}% · road speed ×${WEATHER_SPEED[st.weather].toFixed(2)}`, 14, H - 48); ctx.textAlign = 'center'; }
      }
      // edge vignette
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

      // pick-location crosshair
      if (pr.mode === 'pickLocation' && mouse.current.inside) {
        const w = toWorld(mouse.current.x, mouse.current.y); const n = city.nodes[city.nearestNode(w.x, w.y)]; const p = S(n.x, n.y);
        ctx.strokeStyle = '#4A9CD6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 12 + pulse * 3, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x - 20, p.y); ctx.lineTo(p.x - 7, p.y); ctx.moveTo(p.x + 7, p.y); ctx.lineTo(p.x + 20, p.y); ctx.moveTo(p.x, p.y - 20); ctx.lineTo(p.x, p.y - 7); ctx.moveTo(p.x, p.y + 7); ctx.lineTo(p.x, p.y + 20); ctx.stroke();
      }
      // scale bar
      {
        const metersPer100px = (100 / z) * 4;
        const nice = [50, 100, 200, 250, 500, 1000, 2000].find((m) => m >= metersPer100px * 0.6) ?? 2000;
        const len = (nice / 4) * z;
        const x = W - (pr.minimap ? 212 : 20) - len, y = H - 18;
        ctx.strokeStyle = 'rgba(232,237,242,0.75)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 5); ctx.stroke();
        ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(232,237,242,0.85)'; ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x + len / 2, y - 9);
      }

      // minimap
      if (pr.minimap && mc && now - lastMini > 200) {
        lastMini = now;
        const m = mc.getContext('2d')!;
        const mw = mc.width, mh = mc.height;
        m.drawImage(cityCanvas(1, active, activeKey), 0, 0, mw, mh);
        const sx = mw / (WORLD_W + PAD * 2), sy = mh / (WORLD_H + PAD * 2);
        for (const inc of Object.values(st.incidents)) { if (inc.reportedNode === null || inc.hidden || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue; const n = city.nodes[inc.reportedNode]; m.fillStyle = sevColor(inc.severity); m.beginPath(); m.arc((n.x + PAD) * sx, (n.y + PAD) * sy, 3, 0, 7); m.fill(); }
        for (const u of Object.values(st.units)) { m.fillStyle = SERVICE_META[u.service].color; m.fillRect((u.x + PAD) * sx - 1, (u.y + PAD) * sy - 1, 2, 2); }
        m.strokeStyle = '#fff'; m.lineWidth = 1.2;
        m.strokeRect((view.x0 + PAD) * sx, (view.y0 + PAD) * sy, (view.x1 - view.x0) * sx, (view.y1 - view.y0) * sy);
      }
    };
    raf = requestAnimationFrame(draw);
    // warm the detailed cache shortly after mount so zooming in never hitches
    const warm = window.setTimeout(() => { const st = P.current.engine.state; const a = new Set(st.config.districts); cityCanvas(2, a, [...a].sort().join(',')); lightsCanvas(); }, 400);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); clearTimeout(warm);
      canvas.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('contextmenu', onCtx); canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('pointerleave', onLeave);
      mc?.removeEventListener('pointerdown', onMini);
    };
  }, []);

  const zoomBy = (f: number) => { const c = cam.current; c.tz = Math.max(c.fit * 0.95, Math.min(7, c.tz * f)); };
  const recenter = () => { const c = cam.current; c.tx = WORLD_W / 2; c.ty = WORLD_H / 2 - 30; c.tz = c.fit; };
  return (
    <div className="mapwrap" ref={wrap} style={{ cursor: props.mode === 'pickLocation' ? 'crosshair' : 'grab' }}>
      <canvas ref={ref} aria-label="Interactive city map of Ravenport" role="img" />
      {tip && <div className="maptip" style={{ left: Math.min(tip.x + 14, (wrap.current?.clientWidth ?? 600) - 240), top: tip.y + 14 }}>{tip.text}</div>}
      <div className="mapctl">
        <button onClick={() => zoomBy(1.4)} aria-label="Zoom in" title="Zoom in">+</button>
        <button onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out">−</button>
        <button onClick={recenter} aria-label="Fit city" title="Fit city">⌂</button>
        <div className="compass" aria-hidden="true">N</div>
      </div>
      {props.minimap && <canvas ref={mini} className="minimap" width={184} height={132} aria-label="Minimap — click to move the view" />}
    </div>
  );
}

function glyph(ctx: CanvasRenderingContext2D, cat: string, x: number, y: number, s: number) {
  ctx.beginPath();
  if (cat === 'medical') { ctx.fillRect(x - s * 0.32, y - s, s * 0.64, s * 2); ctx.fillRect(x - s, y - s * 0.32, s * 2, s * 0.64); }
  else if (cat === 'fire') { ctx.moveTo(x, y - s * 1.15); ctx.quadraticCurveTo(x + s * 1.25, y, x + s * 0.55, y + s); ctx.lineTo(x - s * 0.55, y + s); ctx.quadraticCurveTo(x - s * 1.25, y, x, y - s * 1.15); ctx.fill(); }
  else if (cat === 'police') { ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y + s * 0.2); ctx.lineTo(x, y + s * 1.1); ctx.lineTo(x - s, y + s * 0.2); ctx.closePath(); ctx.fill(); }
  else { ctx.font = '900 12px Inter, system-ui, sans-serif'; ctx.fillText('?', x, y + 0.5); }
}
