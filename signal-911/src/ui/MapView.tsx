import { useEffect, useRef, useState } from 'react';
import { getCity, addressOf, WORLD_H, WORLD_W } from '../sim/city';
import { SERVICE_META } from '../sim/fleet';
import { WEATHER_LABEL } from '../sim/events';
import type { GameEngine } from '../sim/engine';
import type { HeardLocation, Incident, Unit } from '../sim/types';

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
  showIncidents?: boolean; reduceMotion?: boolean; lockedLabel?: boolean;
}

const COL = { sea: '#0f2233', river: '#17375a', land: '#141c25', road: '#364860', arterial: '#4a5f7a', highway: '#7d98b8', casing: '#0a0e13', building: '#1e2936', park: '#17331f', plaza: '#26323f', text: '#98A6B5' };
const TINT: Record<string, string> = { commercial: '#4A9CD6', dense: '#4A9CD6', industrial: '#E5AC4D', residential: '#98A6B5', forest: '#54B889', harbor: '#3ec1c9', airport: '#9a8cd6', campus: '#c58bd6', suburb: '#7fa889', historic: '#d69a53', highrise: '#4A9CD6', river: '#4A9CD6', rail: '#98A6B5' };

interface Geo {
  local: Path2D; arterial: Path2D; highway: Path2D; bridge: Path2D; parks: Path2D; plazas: Path2D; blocks: Record<string, Path2D>; districts: Array<{ id: string; path: Path2D; tint: string }>; river: Path2D; sea: Path2D;
}
let geoCache: Geo | null = null;
function buildGeo(): Geo {
  if (geoCache) return geoCache;
  const city = getCity();
  const g: Geo = { local: new Path2D(), arterial: new Path2D(), highway: new Path2D(), bridge: new Path2D(), parks: new Path2D(), plazas: new Path2D(), blocks: {}, districts: [], river: new Path2D(), sea: new Path2D() };
  for (const e of city.edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const p = e.cls === 'local' ? g.local : e.cls === 'arterial' ? g.arterial : e.cls === 'highway' ? g.highway : g.bridge;
    p.moveTo(a.x, a.y); p.lineTo(b.x, b.y);
  }
  const poly = (p: Path2D, pts: Array<{ x: number; y: number }>) => { p.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y); p.closePath(); };
  for (const b of city.blocks) {
    if (b.kind === 'park') poly(g.parks, b.poly);
    else if (b.kind === 'plaza') poly(g.plazas, b.poly);
    else { (g.blocks[b.district] ??= new Path2D()); poly(g.blocks[b.district], b.poly); }
  }
  for (const d of city.districts) {
    const p = new Path2D(); poly(p, d.poly);
    g.districts.push({ id: d.id, path: p, tint: TINT[d.tags[0]] ?? '#98A6B5' });
  }
  const r = city.riverline;
  g.river.moveTo(-40, r[0].y);
  for (let i = 0; i < r.length; i++) g.river.lineTo(r[i].x, r[i].y);
  g.river.lineTo(WORLD_W + 40, r[r.length - 1].y);
  const c = city.coast;
  g.sea.moveTo(-60, c[0].y); for (const p of c) g.sea.lineTo(p.x, p.y); g.sea.lineTo(WORLD_W + 60, c[c.length - 1].y);
  g.sea.lineTo(WORLD_W + 60, WORLD_H + 80); g.sea.lineTo(-60, WORLD_H + 80); g.sea.closePath();
  geoCache = g;
  return g;
}

function sevColor(sev: number) { return sev >= 4 ? '#D65353' : sev === 3 ? '#E5AC4D' : '#4A9CD6'; }
function covColor(t: number): string {
  if (!isFinite(t)) return 'rgba(214,83,83,0.38)';
  if (t < 45) return 'rgba(84,184,137,0.38)'; if (t < 85) return 'rgba(143,191,106,0.36)'; if (t < 125) return 'rgba(229,172,77,0.36)'; if (t < 175) return 'rgba(214,138,77,0.38)'; return 'rgba(214,83,83,0.4)';
}

export function MapView(props: MapProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const P = useRef(props); P.current = props;
  const cam = useRef({ x: WORLD_W / 2, y: WORLD_H / 2, z: 0.5, tx: WORLD_W / 2, ty: WORLD_H / 2, tz: 0.5, fit: 0.5, init: false });
  const drag = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean; id: number } | null>(null);
  const hover = useRef<{ kind: string; id: string; label: string } | null>(null);
  const mouse = useRef({ x: 0, y: 0, inside: false });
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const particles = useRef<Array<{ x: number; y: number; v: number; s: number }>>([]);
  const lastFocus = useRef(0);
  const covRef = useRef<{ key: string; img: Array<[number, number, string]> }>({ key: '', img: [] });
  const offs = useRef<Map<string, { dx: number; dy: number }>>(new Map());
  const trafRef = useRef<{ key: number; paths: Path2D[] }>({ key: -1, paths: [] });

  useEffect(() => {
    const canvas = ref.current!, el = wrap.current!;
    const city = getCity();
    const geo = buildGeo();
    let raf = 0, W = 0, H = 0, dpr = 1;
    const resize = () => {
      const r = el.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(10, r.width); H = Math.max(10, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      const fit = Math.min(W / (WORLD_W + 40), H / (WORLD_H - 40));
      const c = cam.current;
      c.fit = fit;
      if (!c.init) { c.z = c.tz = fit; c.x = c.tx = WORLD_W / 2; c.y = c.ty = WORLD_H / 2 - 30; c.init = true; }
      c.tz = Math.max(c.tz, fit * 0.95);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);
    for (let i = 0; i < 160; i++) particles.current.push({ x: Math.random(), y: Math.random(), v: 0.4 + Math.random() * 0.8, s: Math.random() });

    const toWorld = (sx: number, sy: number) => ({ x: (sx - W / 2) / cam.current.z + cam.current.x, y: (sy - H / 2) / cam.current.z + cam.current.y });
    const toScreen = (x: number, y: number) => ({ x: (x - cam.current.x) * cam.current.z + W / 2, y: (y - cam.current.y) * cam.current.z + H / 2 });

    const hit = (sx: number, sy: number): { kind: 'incident' | 'unit' | 'station' | 'heard'; id: string; label: string } | null => {
      const eng = P.current.engine, st = eng.state;
      // incidents first
      if (P.current.showIncidents !== false) for (const inc of Object.values(st.incidents)) {
        const n = incidentNode(inc); if (n === null || inc.hidden || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
        const p = toScreen(city.nodes[n].x, city.nodes[n].y);
        if (Math.hypot(p.x - sx, p.y - sy) < 16) return { kind: 'incident', id: inc.id, label: `${inc.label} — ${addressOf(city, n)}` };
      }
      for (const h of P.current.heard ?? []) {
        const p = toScreen(city.nodes[h.nodeId].x, city.nodes[h.nodeId].y);
        if (Math.hypot(p.x - sx, p.y - sy) < 13) return { kind: 'heard', id: h.id, label: h.label };
      }
      for (const u of Object.values(st.units)) {
        const p = toScreen(u.x, u.y); const o = offs.current.get(u.id) ?? { dx: 0, dy: 0 };
        if (Math.hypot(p.x + o.dx - sx, p.y + o.dy - sy) < 13) return { kind: 'unit', id: u.id, label: `${u.callsign} — ${u.status.replace('_', ' ')}` };
      }
      for (const s of Object.values(st.stations)) {
        const n = city.nodes[s.nodeId]; const p = toScreen(n.x, n.y);
        if (Math.hypot(p.x - sx, p.y - sy) < 11) return { kind: 'station', id: s.id, label: s.name };
      }
      return null;
    };
    const incidentNode = (inc: Incident): number | null => inc.reportedNode;

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      drag.current = { sx: e.clientX, sy: e.clientY, cx: cam.current.tx, cy: cam.current.ty, moved: false, id: e.pointerId };
    };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top, inside: true };
      const d = drag.current;
      if (d) {
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        if (d.moved) { cam.current.tx = d.cx - dx / cam.current.z; cam.current.ty = d.cy - dy / cam.current.z; cam.current.x = cam.current.tx; cam.current.y = cam.current.ty; }
      }
      const h = hit(mouse.current.x, mouse.current.y);
      const prev = hover.current;
      hover.current = h;
      if (P.current.mode === 'pickLocation') {
        const w = toWorld(mouse.current.x, mouse.current.y); const n = city.nearestNode(w.x, w.y);
        setTip({ x: mouse.current.x, y: mouse.current.y, text: `Set location: ${addressOf(city, n)}` });
      } else if (h && (!prev || prev.id !== h.id)) setTip({ x: mouse.current.x, y: mouse.current.y, text: h.label });
      else if (h) setTip((t) => (t ? { ...t, x: mouse.current.x, y: mouse.current.y } : t));
      else if (!h) setTip((t) => (t ? null : t));
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current; drag.current = null;
      if (!d || d.moved || e.button === 2) return;
      const r = canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const w = toWorld(sx, sy);
      if (P.current.mode === 'pickLocation') { P.current.onPickNode?.(city.nearestNode(w.x, w.y)); return; }
      const h = hit(sx, sy);
      if (h) {
        if (h.kind === 'heard') { const hh = (P.current.heard ?? []).find((x) => x.id === h.id); if (hh) P.current.onPickHeard?.(hh); }
        else P.current.onSelect(h.kind as 'incident' | 'unit' | 'station', h.id);
        return;
      }
      // district under cursor
      const ctx = canvas.getContext('2d')!;
      for (const d2 of geo.districts) if (ctx.isPointInPath(d2.path, w.x, w.y)) { P.current.onSelect('district', d2.id); return; }
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
      c.tz = Math.max(c.fit * 0.95, Math.min(6, c.tz * Math.exp(-e.deltaY * 0.0015)));
      c.tx = before.x - (sx - W / 2) / c.tz; c.ty = before.y - (sy - H / 2) / c.tz;
    };
    const onLeave = () => { mouse.current.inside = false; hover.current = null; setTip(null); };
    canvas.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', onCtx); canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('pointerleave', onLeave);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const pr = P.current, eng = pr.engine, st = eng.state, c = cam.current;
      // camera smoothing + focus
      if (pr.focus && pr.focus.key !== lastFocus.current) { lastFocus.current = pr.focus.key; c.tx = pr.focus.x; c.ty = pr.focus.y; if (pr.focus.zoom) c.tz = Math.max(c.fit, pr.focus.zoom); }
      c.z += (c.tz - c.z) * 0.2; if (!drag.current?.moved) { c.x += (c.tx - c.x) * 0.2; c.y += (c.ty - c.y) * 0.2; }
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COL.sea; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.scale(c.z, c.z); ctx.translate(-c.x, -c.y);
      const z = c.z, lw = (w: number) => Math.max(w, 0.9 / z);
      const layer = pr.layer;
      // land
      ctx.fillStyle = COL.land;
      for (const d of geo.districts) ctx.fill(d.path);
      // district tints
      const active = new Set(st.config.districts);
      for (const d of geo.districts) { ctx.globalAlpha = active.has(d.id) ? 0.16 : 0.03; ctx.fillStyle = d.tint; ctx.fill(d.path); }
      ctx.globalAlpha = 1;
      // water
      ctx.strokeStyle = COL.river; ctx.lineWidth = 26; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(geo.river);
      ctx.fillStyle = COL.sea; ctx.fill(geo.sea);
      ctx.strokeStyle = '#1a3a57'; ctx.lineWidth = lw(1.2); ctx.stroke(geo.sea);
      // blocks
      for (const d of city.districts) { const p = geo.blocks[d.id]; if (!p) continue; ctx.fillStyle = active.has(d.id) ? COL.building : '#141a21'; ctx.fill(p); }
      ctx.fillStyle = active.has('x') ? COL.park : COL.park; ctx.fill(geo.parks);
      ctx.fillStyle = COL.plaza; ctx.fill(geo.plazas);
      // roads
      ctx.lineCap = 'round';
      ctx.strokeStyle = COL.road; ctx.lineWidth = lw(3.6); ctx.stroke(geo.local);
      ctx.strokeStyle = COL.casing; ctx.lineWidth = lw(8.5); ctx.stroke(geo.arterial); ctx.lineWidth = lw(13); ctx.stroke(geo.highway); ctx.lineWidth = lw(10); ctx.stroke(geo.bridge);
      ctx.strokeStyle = COL.arterial; ctx.lineWidth = lw(6); ctx.stroke(geo.arterial);
      ctx.strokeStyle = COL.highway; ctx.lineWidth = lw(9.5); ctx.stroke(geo.highway);
      ctx.strokeStyle = '#6a86a6'; ctx.lineWidth = lw(7); ctx.stroke(geo.bridge);
      // district borders
      ctx.setLineDash([6 / z, 6 / z]); ctx.strokeStyle = 'rgba(152,166,181,0.28)'; ctx.lineWidth = lw(1.1);
      for (const d of geo.districts) ctx.stroke(d.path);
      ctx.setLineDash([]);
      // selected district outline
      if (st.selected.kind === 'district') { const d = geo.districts.find((x) => x.id === st.selected.id); if (d) { ctx.strokeStyle = '#4A9CD6'; ctx.lineWidth = lw(2.2); ctx.stroke(d.path); } }

      // layers
      if (layer === 'traffic') {
        const key = Math.floor(st.time / 3);
        if (trafRef.current.key !== key) {
          const ps = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
          for (const e of city.edges) {
            const a = city.nodes[e.a], b = city.nodes[e.b];
            const tr = ((st.districtTraffic[a.district] ?? 0.3) + (st.districtTraffic[b.district] ?? 0.3)) / 2 * (e.cls === 'highway' ? 0.7 : e.cls === 'arterial' ? 1.05 : e.cls === 'local' ? 0.7 : 1.1);
            const bucket = tr < 0.28 ? 0 : tr < 0.5 ? 1 : tr < 0.72 ? 2 : 3;
            ps[bucket].moveTo(a.x, a.y); ps[bucket].lineTo(b.x, b.y);
          }
          trafRef.current = { key, paths: ps };
        }
        const cols = ['#54B889', '#E5AC4D', '#D6853f', '#D65353'];
        trafRef.current.paths.forEach((p, i) => { ctx.strokeStyle = cols[i]; ctx.globalAlpha = 0.85; ctx.lineWidth = lw(i === 0 ? 3 : 4.2); ctx.stroke(p); });
        ctx.globalAlpha = 1;
      }
      if (layer === 'coverage' || layer === 'police' || layer === 'fire' || layer === 'medical') {
        const key = `${layer}:${Math.floor(st.time / 3)}`;
        if (covRef.current.key !== key) {
          const img: Array<[number, number, string]> = [];
          const svcs = layer === 'coverage' ? (['police', 'fire', 'medical'] as const) : ([layer] as const);
          const ts = svcs.map((s) => eng.coverageTimes(s));
          for (const n of city.nodes) {
            if (!active.has(n.district)) continue;
            let worst = 0; for (const t of ts) worst = Math.max(worst, t[n.id]);
            img.push([n.x, n.y, covColor(worst)]);
          }
          covRef.current = { key, img };
        }
        ctx.save(); const clip = new Path2D(); for (const d of geo.districts) if (active.has(d.id)) clip.addPath(d.path); ctx.clip(clip);
        for (const [x, y, col] of covRef.current.img) { ctx.fillStyle = col; ctx.fillRect(x - 25, y - 25, 50, 50); }
        ctx.restore();
      }
      // closed roads
      if (st.closedEdges.length) {
        ctx.strokeStyle = '#D65353'; ctx.lineWidth = lw(3.4); ctx.setLineDash([4 / z, 4 / z]);
        ctx.beginPath(); for (const eid of st.closedEdges) { const e = city.edges[eid]; ctx.moveTo(city.nodes[e.a].x, city.nodes[e.a].y); ctx.lineTo(city.nodes[e.b].x, city.nodes[e.b].y); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();

      // ── screen-space overlays ──
      const S = (x: number, y: number) => ({ x: (x - c.x) * c.z + W / 2, y: (y - c.y) * c.z + H / 2 });
      // night & layer dimming
      const hour = ((st.timeOfDay % 24) + 24) % 24;
      const night = hour >= 21 || hour < 5 ? 0.2 : hour >= 19 || hour < 6.5 ? 0.1 : 0;
      if (night) { ctx.fillStyle = `rgba(5,10,30,${night})`; ctx.fillRect(0, 0, W, H); }
      if (layer === 'incidents') { ctx.fillStyle = 'rgba(8,12,18,0.45)'; ctx.fillRect(0, 0, W, H); }

      // district labels
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (c.z < 2.6 && pr.lockedLabel !== false) {
        for (const d of city.districts) {
          const p = S(d.center.x, d.center.y - 40);
          const locked = !active.has(d.id);
          ctx.font = `600 ${Math.max(10, Math.min(15, 11 + c.z * 3))}px Inter, system-ui, sans-serif`;
          ctx.fillStyle = locked ? 'rgba(152,166,181,0.38)' : 'rgba(200,212,224,0.72)';
          const name = d.name.toUpperCase().split('').join(c.z > 0.7 ? ' ' : '');
          ctx.fillText(name, p.x, p.y);
          if (locked) { ctx.font = '500 10px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(152,166,181,0.5)'; ctx.fillText(`LOCKED · RANK ${d.unlockRank}`, p.x, p.y + 14); }
        }
      }
      ctx.font = '600 10px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(80,130,180,0.55)';
      const rv = S(260, city.riverline[5].y + 30); ctx.fillText('RAVENPORT RIVER', rv.x, rv.y);
      const sea = S(1000, 1355); ctx.fillText('SOUTHERN BAY', sea.x, sea.y);

      // landmarks
      if (c.z > 0.62) for (const l of city.landmarks) {
        const n = city.nodes[l.nodeId]; const p = S(n.x, n.y);
        if (l.kind === 'hospital') {
          ctx.fillStyle = '#e8edf2'; roundRect(ctx, p.x - 7, p.y - 7, 14, 14, 3); ctx.fill();
          ctx.fillStyle = '#D65353'; ctx.fillRect(p.x - 1.6, p.y - 5, 3.2, 10); ctx.fillRect(p.x - 5, p.y - 1.6, 10, 3.2);
          if (c.z > 1.1) { ctx.fillStyle = 'rgba(232,237,242,0.85)'; ctx.font = '500 10px Inter, system-ui, sans-serif'; ctx.fillText(l.name, p.x, p.y + 17); }
        } else if (c.z > 1.5) {
          ctx.fillStyle = 'rgba(152,166,181,0.6)'; ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x + 4, p.y); ctx.lineTo(p.x, p.y + 4); ctx.lineTo(p.x - 4, p.y); ctx.closePath(); ctx.fill();
          if (c.z > 2.2) { ctx.fillStyle = 'rgba(152,166,181,0.8)'; ctx.font = '500 10px Inter, system-ui, sans-serif'; ctx.fillText(l.name, p.x, p.y + 12); }
        }
      }
      // stations
      for (const s of Object.values(st.stations)) {
        const n = city.nodes[s.nodeId]; const p = S(n.x, n.y); const m = SERVICE_META[s.service];
        const off = s.disabledShifts > 0;
        ctx.globalAlpha = off ? 0.45 : 1;
        ctx.fillStyle = '#0c1117'; ctx.strokeStyle = m.color; ctx.lineWidth = 2;
        roundRect(ctx, p.x - 8, p.y - 8, 16, 16, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = m.color; ctx.font = '700 10px Inter, system-ui, sans-serif'; ctx.fillText(m.glyph, p.x, p.y + 0.5);
        if (c.z > 1.3) { ctx.fillStyle = 'rgba(200,212,224,0.8)'; ctx.font = '500 9px Inter, system-ui, sans-serif'; ctx.fillText(s.name, p.x, p.y + 17); }
        ctx.globalAlpha = 1;
        if (st.selected.kind === 'station' && st.selected.id === s.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; roundRect(ctx, p.x - 11, p.y - 11, 22, 22, 6); ctx.stroke(); }
      }

      // routes
      const sel = st.selected;
      const drawRoute = (u: Unit, alpha: number, widthPx: number) => {
        if (!u.route.length) return;
        const col = SERVICE_META[u.service].color;
        ctx.strokeStyle = col; ctx.globalAlpha = alpha; ctx.lineWidth = widthPx; ctx.setLineDash([7, 5]); ctx.lineDashOffset = -(now / 60) % 12;
        ctx.beginPath(); const p0 = S(u.x, u.y); ctx.moveTo(p0.x, p0.y);
        for (const nId of u.route) { const nn = city.nodes[nId]; const pp = S(nn.x, nn.y); ctx.lineTo(pp.x, pp.y); }
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      };
      for (const u of Object.values(st.units)) {
        if (['EN_ROUTE', 'TRANSPORTING'].includes(u.status)) drawRoute(u, 0.28, 1.5);
        if (sel.kind === 'unit' && sel.id === u.id) drawRoute(u, 0.95, 2.4);
        if (sel.kind === 'incident' && u.assignedIncidentId === sel.id) drawRoute(u, 0.9, 2.2);
      }
      // destination ring for selected unit
      if (sel.kind === 'unit' && sel.id) { const u = st.units[sel.id]; if (u && u.destNode !== null) { const dn = city.nodes[u.destNode]; const p = S(dn.x, dn.y); ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; } }

      // heard locations
      for (const h of pr.heard ?? []) {
        const n = city.nodes[h.nodeId]; const p = S(n.x, n.y);
        const col = h.reliability === 'sure' ? '#54B889' : h.reliability === 'contradicted' ? '#8a96a3' : '#E5AC4D';
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(h.reliability === 'sure' ? [] : [4, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.font = '700 11px Inter, system-ui, sans-serif'; ctx.fillText(h.reliability === 'contradicted' ? '×' : '?', p.x, p.y + 0.5);
      }

      // incidents
      const pulse = pr.reduceMotion ? 0.5 : (Math.sin(now / 320) + 1) / 2;
      if (pr.showIncidents !== false) for (const inc of Object.values(st.incidents)) {
        if (inc.reportedNode === null || inc.hidden || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
        const n = city.nodes[inc.reportedNode]; const p = S(n.x, n.y);
        const col = sevColor(inc.severity);
        const big = layer === 'incidents' ? 1.35 : 1;
        const r = 11 * big;
        const unattended = inc.assignedUnits.length === 0;
        ctx.globalAlpha = 0.25 + 0.25 * pulse;
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r + 5 + pulse * 6, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#0c1117'; ctx.strokeStyle = col; ctx.lineWidth = unattended ? 2 : 3.2;
        if (unattended) ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        // category glyph (shape-coded)
        ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2;
        glyph(ctx, inc.category, p.x, p.y, 5.2 * big);
        // severity pips
        ctx.fillStyle = '#e8edf2'; ctx.font = '700 9px Inter, system-ui, sans-serif'; ctx.fillText(String(inc.severity), p.x + r + 3, p.y - r + 1);
        if (inc.status === 'ESCALATING') { ctx.fillStyle = '#D65353'; ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillText('!', p.x, p.y - r - 8); }
        if (sel.kind === 'incident' && sel.id === inc.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, 7); ctx.stroke(); }
        if (c.z > 0.9 || layer === 'incidents') { ctx.fillStyle = 'rgba(232,237,242,0.92)'; ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.fillText(inc.label, p.x, p.y + r + 11); }
      }

      // units (stacked units fan out so each stays clickable)
      const dimUnits = layer === 'incidents' ? 0.5 : 1;
      const groups = new Map<string, Unit[]>();
      for (const u of Object.values(st.units)) { const k = `${Math.round(u.x / 3)},${Math.round(u.y / 3)}`; const g = groups.get(k); if (g) g.push(u); else groups.set(k, [u]); }
      offs.current.clear();
      for (const g of groups.values()) g.forEach((u, i) => { if (g.length > 1) { const ang = (i / g.length) * Math.PI * 2 - Math.PI / 2; offs.current.set(u.id, { dx: Math.cos(ang) * 13, dy: Math.sin(ang) * 13 + 4 }); } });
      for (const u of Object.values(st.units)) {
        const o0 = offs.current.get(u.id) ?? { dx: 0, dy: 0 };
        const p0 = S(u.x, u.y); const p = { x: p0.x + o0.dx, y: p0.y + o0.dy }; const m = SERVICE_META[u.service];
        const moving = ['EN_ROUTE', 'TRANSPORTING', 'RETURNING', 'DISPATCHED'].includes(u.status);
        ctx.globalAlpha = (u.status === 'OUT_OF_SERVICE' ? 0.4 : 1) * dimUnits;
        ctx.fillStyle = m.color; ctx.strokeStyle = '#0c1117'; ctx.lineWidth = 2;
        const s = 9;
        ctx.beginPath();
        if (u.service === 'police') { ctx.moveTo(p.x, p.y - s - 1); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s + 1); ctx.lineTo(p.x - s, p.y); ctx.closePath(); }
        else if (u.service === 'fire') ctx.arc(p.x, p.y, s, 0, 7);
        else roundRect(ctx, p.x - s + 1, p.y - s + 1, 2 * s - 2, 2 * s - 2, 3);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#0c1117'; ctx.font = '800 9px Inter, system-ui, sans-serif'; ctx.fillText(m.glyph, p.x, p.y + 0.5);
        // status marker
        if (u.status === 'ON_SCENE') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, s + 3, 0, 7); ctx.stroke(); }
        else if (u.status === 'TRANSPORTING') { ctx.fillStyle = '#fff'; ctx.fillRect(p.x + 5, p.y - 11, 6, 6); }
        else if (moving && u.status !== 'RETURNING' && !pr.reduceMotion && Math.floor(now / 250) % 2) { ctx.fillStyle = u.service === 'fire' ? '#ff8f8f' : '#8fd0ff'; ctx.beginPath(); ctx.arc(p.x, p.y - s - 4, 2.4, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1;
        if (sel.kind === 'unit' && sel.id === u.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(p.x, p.y, s + 6, 0, 7); ctx.stroke(); }
        if (c.z > 1.15 || (sel.kind === 'unit' && sel.id === u.id) || hover.current?.id === u.id) { ctx.fillStyle = 'rgba(232,237,242,0.9)'; ctx.font = '600 9px Inter, system-ui, sans-serif'; ctx.fillText(u.callsign, p.x, p.y + s + 9); }
      }

      // weather overlay
      if (st.weather !== 'clear' || layer === 'weather') {
        const I = Math.max(0.3, st.weatherIntensity) * (layer === 'weather' ? 1.4 : 1);
        if (st.weather === 'rain' || st.weather === 'storm') {
          ctx.strokeStyle = `rgba(150,190,230,${0.35 * I})`; ctx.lineWidth = 1; ctx.beginPath();
          const n = Math.floor(120 * Math.min(1.2, I));
          for (let i = 0; i < n; i++) { const q = particles.current[i]; const y = ((q.y + now / (900 / q.v)) % 1) * H, x = (q.x * W + y * 0.2) % W; ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 11); }
          ctx.stroke();
          ctx.fillStyle = `rgba(20,40,70,${0.14 * I})`; ctx.fillRect(0, 0, W, H);
          if (st.weather === 'storm' && Math.sin(now / 1900) > 0.985) { ctx.fillStyle = 'rgba(220,235,255,0.25)'; ctx.fillRect(0, 0, W, H); }
        } else if (st.weather === 'snow') {
          ctx.fillStyle = `rgba(235,242,250,${0.7 * I})`;
          for (let i = 0; i < 110; i++) { const q = particles.current[i]; const y = ((q.y + now / (5200 / q.v)) % 1) * H, x = (q.x * W + Math.sin(now / 900 + i) * 14 + W) % W; ctx.fillRect(x, y, 2, 2); }
          ctx.fillStyle = `rgba(220,232,245,${0.08 * I})`; ctx.fillRect(0, 0, W, H);
        } else if (st.weather === 'fog') { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(170,185,200,${0.22 * I})`); g.addColorStop(1, `rgba(170,185,200,${0.12 * I})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
        else if (st.weather === 'heat') { ctx.fillStyle = `rgba(229,150,60,${0.07 * I})`; ctx.fillRect(0, 0, W, H); }
        if (layer === 'weather') { ctx.fillStyle = 'rgba(232,237,242,0.9)'; ctx.font = '700 13px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`${WEATHER_LABEL[st.weather]} · intensity ${Math.round(st.weatherIntensity * 100)}% · road speed ×${(st.weather === 'clear' ? 1 : st.weather === 'rain' ? 0.88 : st.weather === 'snow' ? 0.7 : st.weather === 'fog' ? 0.82 : st.weather === 'storm' ? 0.74 : 0.98).toFixed(2)}`, 14, H - 14); ctx.textAlign = 'center'; }
      }
      // pickLocation crosshair
      if (pr.mode === 'pickLocation' && mouse.current.inside) {
        const w = toWorld(mouse.current.x, mouse.current.y); const n = city.nodes[city.nearestNode(w.x, w.y)]; const p = S(n.x, n.y);
        ctx.strokeStyle = '#4A9CD6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 12 + pulse * 3, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x - 18, p.y); ctx.lineTo(p.x - 6, p.y); ctx.moveTo(p.x + 6, p.y); ctx.lineTo(p.x + 18, p.y); ctx.moveTo(p.x, p.y - 18); ctx.lineTo(p.x, p.y - 6); ctx.moveTo(p.x, p.y + 6); ctx.lineTo(p.x, p.y + 18); ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('contextmenu', onCtx); canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  const zoomBy = (f: number) => { const c = cam.current; c.tz = Math.max(c.fit * 0.95, Math.min(6, c.tz * f)); };
  const recenter = () => { const c = cam.current; c.tx = WORLD_W / 2; c.ty = WORLD_H / 2 - 30; c.tz = c.fit; };
  return (
    <div className="mapwrap" ref={wrap} style={{ cursor: props.mode === 'pickLocation' ? 'crosshair' : 'grab' }}>
      <canvas ref={ref} aria-label="Interactive city map of Ravenport" role="img" />
      {tip && <div className="maptip" style={{ left: Math.min(tip.x + 14, (wrap.current?.clientWidth ?? 600) - 220), top: tip.y + 14 }}>{tip.text}</div>}
      <div className="mapctl">
        <button onClick={() => zoomBy(1.4)} aria-label="Zoom in" title="Zoom in">+</button>
        <button onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out">−</button>
        <button onClick={recenter} aria-label="Recenter map" title="Fit city">⌂</button>
      </div>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function glyph(ctx: CanvasRenderingContext2D, cat: string, x: number, y: number, s: number) {
  ctx.beginPath();
  if (cat === 'medical') { ctx.fillRect(x - s * 0.3, y - s, s * 0.6, s * 2); ctx.fillRect(x - s, y - s * 0.3, s * 2, s * 0.6); }
  else if (cat === 'fire') { ctx.moveTo(x, y - s * 1.1); ctx.quadraticCurveTo(x + s * 1.2, y, x + s * 0.5, y + s); ctx.lineTo(x - s * 0.5, y + s); ctx.quadraticCurveTo(x - s * 1.2, y, x, y - s * 1.1); ctx.fill(); }
  else if (cat === 'police') { ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y + s * 0.2); ctx.lineTo(x, y + s * 1.1); ctx.lineTo(x - s, y + s * 0.2); ctx.closePath(); ctx.fill(); }
  else { ctx.font = '800 12px Inter, system-ui, sans-serif'; ctx.fillText('?', x, y + 0.5); }
}
