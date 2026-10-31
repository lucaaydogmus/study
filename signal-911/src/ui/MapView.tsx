import { useEffect, useRef, useState } from 'react';
import { getCity, addressOf, WORLD_H, WORLD_W } from '../sim/city';
import { SERVICE_META, isAir } from '../sim/fleet';
import { AGENCY } from '../sim/engine';
import { cctvConnect } from '../sim/cctv';
import { barOffset, vehicleSprite } from './vehicles';
import { getWorld3D, pitchFor } from './world3d/World3D';
import { useApp } from '../store';
import { atStation, slotOf, stationLayout, VisualFleet, type Pose } from './stationsLayout';
import { audio, type SirenVoice } from '../audio/audioManager';
import { WEATHER_LABEL, WEATHER_SPEED } from '../sim/events';
import type { GameEngine } from '../sim/engine';
import type { GameState, HeardLocation, Incident, Unit } from '../sim/types';
import { BASE_TILT, drawBuildings3D, drawCity, drawModels, drawNightLights, drawParked, drawTraffic, getScenery } from './scenery';

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
  onPickNode?: (node: number) => void; onContext?: (node: number, hit: { kind: string; id: string } | null, at: { x: number; y: number }) => void;
  /** a unit (or a station's next free unit) was dragged onto an incident or a spot on the map */
  onDrop?: (src: { kind: 'unit' | 'station' | 'incident'; id: string }, target: { kind: string; id: string } | null, node: number) => void;
  heard?: HeardLocation[]; onPickHeard?: (h: HeardLocation) => void; focus?: { x: number; y: number; zoom?: number; key: number } | null;
  showIncidents?: boolean; reduceMotion?: boolean; lockedLabel?: boolean; minimap?: boolean; ambient?: boolean;
  /** draw the city with the cinematic 3D renderer (one map at a time) */ world3d?: boolean;
  preview?: { unitId: string; path: number[] } | null;
  /** play positional sirens and rotor noise for what is on screen */
  sounds?: boolean;
  /** camera easing per frame (lower = slower, cinematic) */
  camEase?: number;
  /** units picked with a Shift+drag box */
  multi?: string[]; onBoxSelect?: (ids: string[]) => void;
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
  ctx.fillStyle = '#7fbfe3'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(scale, 0, 0, scale, PAD * scale, PAD * scale);
  // buildings always stand up a little: the overview is rendered with the base camera tilt
  drawCity(ctx, scale >= 1.5 ? 1 : 0, null, active, scale, { skipRoofs: true, tilt: BASE_TILT });
  drawBuildings3D(ctx, null, BASE_TILT, 0, scale, scale >= 1.5);
  drawModels(ctx, null, BASE_TILT, 0, scale);
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
  drawNightLights(ctx, null, { tilt: BASE_TILT });
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
  const cam = useRef({ x: WORLD_W / 2, y: WORLD_H / 2, z: 0.5, tx: WORLD_W / 2, ty: WORLD_H / 2, tz: 0.5, fit: 0.5, init: false, W: 1, H: 1, gy: 1, sp: 0, maxZ: 7 });
  const gfx = useApp((s) => s.settings.graphics ?? '3d');
  const quality = useApp((s) => s.settings.quality ?? 'high');
  const drag = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean; grab?: { kind: 'unit' | 'station' | 'incident'; id: string } } | null>(null);
  const hover = useRef<{ kind: string; id: string; label: string } | null>(null);
  const box = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const mouse = useRef({ x: 0, y: 0, inside: false });
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const lastFocus = useRef(0);
  const offs = useRef(new Map<string, { dx: number; dy: number }>());
  const heading = useRef(new Map<string, { x: number; y: number; h: number }>());
  const smoke = useRef(new Map<string, Puff[]>());
  const stationPts = useRef(new Map<string, { x: number; y: number }>());
  const fleet2d = useRef(new VisualFleet());

  useEffect(() => {
    const canvas = ref.current!, el = wrap.current!;
    const city = getCity();
    getScenery();
    const w3 = P.current.world3d && gfx !== '2d' ? getWorld3D() : null;
    if (w3) {
      w3.quality = quality;
      Object.assign(w3.canvas.style, { position: 'absolute', left: '0', top: '0', zIndex: '0', pointerEvents: 'none' });
      Object.assign(canvas.style, { position: 'relative', zIndex: '1' });
      el.insertBefore(w3.canvas, el.firstChild); cam.current.maxZ = 30;
    } else cam.current.maxZ = 7;
    const pitchOf = (z: number) => (w3 ? pitchFor(z, cam.current.fit) : 0);
    if (w3) (window as unknown as { __sig911Cam?: unknown }).__sig911Cam = cam.current;
    let raf = 0, W = 0, H = 0, dpr = 1, lastT = performance.now(), lastMini = 0, lastSnd = 0, ambT = 0;
    // adaptive detail: drop street life and window lights if the close-up view cannot hold ~35 fps
    let frameEma = 16, lowDetail = false;
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

    const toWorld = (sx: number, sy: number) => ({ x: (sx - W / 2) / cam.current.z + cam.current.x, y: (sy - H / 2) / (cam.current.z * cam.current.gy) + cam.current.y });
    const toScreen = (x: number, y: number) => ({ x: (x - cam.current.x) * cam.current.z + W / 2, y: (y - cam.current.y) * cam.current.z * cam.current.gy + H / 2 });
    const pinPos = (inc: Incident) => { const n = city.nodes[inc.reportedNode!]; return toScreen(n.x, n.y); };

    const hit = (sx: number, sy: number): { kind: 'incident' | 'unit' | 'station' | 'heard' | 'hospital' | 'camera'; id: string; label: string } | null => {
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
        if (parkedAtBase(st, u) && !offs.current.has(u.id) && !(st.selected.kind === 'unit' && st.selected.id === u.id)) continue;
        const p = toScreen(u.x, u.y); const o = offs.current.get(u.id) ?? { dx: 0, dy: 0 };
        if (Math.hypot(p.x + o.dx - sx, p.y + o.dy - sy) < 12) return { kind: 'unit', id: u.id, label: `${u.callsign} · ${u.typeLabel} — ${u.status.replace(/_/g, ' ')}${u.note ? ` (${u.note})` : ''}` };
      }
      for (const s of Object.values(st.stations)) {
        const p = stationPts.current.get(s.id) ?? (() => { const n = city.nodes[s.nodeId]; return toScreen(n.x, n.y); })();
        const lay = stationLayout(city, s); const b = toScreen(lay.x, lay.y);
        if (Math.hypot(p.x - sx, p.y - sy) < 14 || Math.hypot(b.x - sx, b.y - sy) < Math.max(10, 9 * cam.current.z)) return { kind: 'station', id: s.id, label: `${s.name} — drag onto an incident to send its next crew` };
      }
      if (useApp.getState().cctvOpen && cam.current.z > 0.7) for (const c of P.current.engine.cameras()) {
        const p = toScreen(c.x, c.y);
        if (Math.hypot(p.x - sx, p.y - sy) < 9) return { kind: 'camera', id: c.id, label: `${c.id} · ${c.street} / ${c.cross}${c.ptz ? ' · PTZ' : ''} — click to connect` };
      }
      if (cam.current.z > 0.55) for (const l of city.landmarks) {
        if (l.kind !== 'hospital') continue;
        const n = city.nodes[l.nodeId]; const p = toScreen(n.x, n.y + 18);
        if (Math.hypot(p.x - sx, p.y - sy) < 11) return { kind: 'hospital', id: String(l.nodeId), label: `${l.name} — click for bed board` };
      }
      return null;
    };

    const inPoly = (pts: Array<{ x: number; y: number }>, x: number, y: number) => {
      let ins = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) ins = !ins; }
      return ins;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 2) return;
      e.preventDefault(); // no text selection when a drag sweeps over the overlays
      const r = canvas.getBoundingClientRect();
      const h = P.current.mode === 'select' ? hit(e.clientX - r.left, e.clientY - r.top) : null;
      // grabbing a unit or a station starts a drag-to-dispatch, grabbing a pin moves it, instead of a pan
      const grab = h && (h.kind === 'unit' || h.kind === 'station' || h.kind === 'incident') ? { kind: h.kind, id: h.id } : undefined;
      // Shift+drag on open map draws a selection box around several units
      if (e.shiftKey && !grab && P.current.onBoxSelect) { const x = e.clientX - r.left, y = e.clientY - r.top; box.current = { sx: x, sy: y, x, y }; drag.current = null; return; }
      drag.current = { sx: e.clientX, sy: e.clientY, cx: cam.current.tx, cy: cam.current.ty, moved: false, grab };
    };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top, inside };
      if (box.current) { box.current.x = mouse.current.x; box.current.y = mouse.current.y; return; }
      const d = drag.current;
      if (d) {
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > (d.grab ? 7 : 4)) d.moved = true;
        if (d.moved && !d.grab) { cam.current.tx = d.cx - dx / cam.current.z; cam.current.ty = d.cy - dy / (cam.current.z * cam.current.gy); cam.current.x = cam.current.tx; cam.current.y = cam.current.ty; }
      }
      if (!inside) return;
      const h = hit(mouse.current.x, mouse.current.y);
      const prev = hover.current;
      hover.current = h;
      canvas.style.cursor = d?.grab && d.moved ? 'grabbing' : P.current.mode === 'pickLocation' ? 'crosshair' : h && (h.kind === 'unit' || h.kind === 'station') ? 'grab' : h ? 'pointer' : d?.moved ? 'move' : '';
      if (d?.grab && d.moved) { setTip((t) => (t ? null : t)); return; }
      if (P.current.mode === 'pickLocation') { const w = toWorld(mouse.current.x, mouse.current.y); setTip({ x: mouse.current.x, y: mouse.current.y, text: `Set location: ${addressOf(city, city.nearestNode(w.x, w.y))}` }); }
      else if (h && (!prev || prev.id !== h.id)) setTip({ x: mouse.current.x, y: mouse.current.y, text: h.label });
      else if (h) setTip((t) => (t ? { ...t, x: mouse.current.x, y: mouse.current.y } : t));
      else setTip((t) => (t ? null : t));
    };
    const onUp = (e: PointerEvent) => {
      if (box.current) {
        const b = box.current; box.current = null;
        const x0 = Math.min(b.sx, b.x), x1 = Math.max(b.sx, b.x), y0 = Math.min(b.sy, b.y), y1 = Math.max(b.sy, b.y);
        if (x1 - x0 < 6 && y1 - y0 < 6) return;
        const st = P.current.engine.state;
        const ids = Object.values(st.units).filter((u) => {
          if (parkedAtBase(st, u)) return false;
          const p = toScreen(u.x, u.y); const o = offs.current.get(u.id) ?? { dx: 0, dy: 0 };
          return p.x + o.dx >= x0 && p.x + o.dx <= x1 && p.y + o.dy >= y0 && p.y + o.dy <= y1;
        }).map((u) => u.id);
        P.current.onBoxSelect?.(ids);
        return;
      }
      const d = drag.current; drag.current = null;
      if (!d || e.button === 2) return;
      const r = canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) return;
      const w = toWorld(sx, sy);
      if (d.grab && d.moved) {
        const t = hit(sx, sy);
        canvas.style.cursor = '';
        if (!(t && t.kind === d.grab.kind && t.id === d.grab.id)) P.current.onDrop?.(d.grab, t && t.kind !== 'heard' ? { kind: t.kind, id: t.id } : null, city.nearestNode(w.x, w.y));
        return;
      }
      if (d.moved) return;
      if (P.current.mode === 'pickLocation') { P.current.onPickNode?.(city.nearestNode(w.x, w.y)); return; }
      const h = hit(sx, sy);
      if (h) {
        if (h.kind === 'heard') { const hh = (P.current.heard ?? []).find((x) => x.id === h.id); if (hh) P.current.onPickHeard?.(hh); }
        else if (h.kind === 'hospital') P.current.onContext?.(Number(h.id), { kind: 'hospital', id: h.id }, { x: sx, y: sy });
        else if (h.kind === 'camera') { cctvConnect(P.current.engine, h.id); audio.click(); }
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
      P.current.onContext?.(city.nearestNode(w.x, w.y), h && h.kind !== 'heard' ? { kind: h.kind, id: h.id } : null, { x: sx, y: sy });
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = cam.current; const r = canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const gy0 = Math.cos(pitchOf(c.tz));
      const before = { x: (sx - W / 2) / c.tz + c.tx, y: (sy - H / 2) / (c.tz * gy0) + c.ty };
      c.tz = Math.max(c.fit * 0.95, Math.min(c.maxZ, c.tz * Math.exp(-e.deltaY * 0.0015)));
      const gy1 = Math.cos(pitchOf(c.tz));
      c.tx = before.x - (sx - W / 2) / c.tz; c.ty = before.y - (sy - H / 2) / (c.tz * gy1);
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
      frameEma += (dtMs - frameEma) * 0.05;
      if (!lowDetail && frameEma > 29 && !(window as unknown as { __sig911HQ?: boolean }).__sig911HQ) lowDetail = true; else if (lowDetail && frameEma < 19) lowDetail = false;
      const pr = P.current, eng = pr.engine, st = eng.state, c = cam.current;
      const motion = !pr.reduceMotion;
      if (pr.focus && pr.focus.key !== lastFocus.current) { lastFocus.current = pr.focus.key; c.tx = pr.focus.x; c.ty = pr.focus.y; if (pr.focus.zoom) c.tz = Math.max(c.fit, pr.focus.zoom); }
      const ease = motion ? (pr.camEase ?? 0.18) : 1;
      c.z += (c.tz - c.z) * ease; if (!drag.current?.moved) { c.x += (c.tx - c.x) * ease; c.y += (c.ty - c.y) * ease; }
      const ctx = canvas.getContext('2d')!;
      const active = new Set(st.config.districts);
      const activeKey = [...active].sort().join(',');
      const z = c.z, eff = z * dpr;
      const pitch = pitchOf(z); c.gy = Math.cos(pitch); c.sp = Math.sin(pitch);
      const gy = c.gy;
      const view = { x0: c.x - W / 2 / z, y0: c.y - H / 2 / (z * gy), x1: c.x + W / 2 / z, y1: c.y + H / 2 / (z * gy) };
      const hour = ((st.timeOfDay % 24) + 24) % 24;
      const night = hour >= 21 || hour < 5 ? 1 : hour >= 19 ? (hour - 19) / 2 : hour < 7 ? (7 - hour) / 2 : 0;
      // golden hour around sunrise and sunset
      const dusk = Math.max(0, 1 - Math.abs(hour - 19) / 1.6) + Math.max(0, 1 - Math.abs(hour - 6) / 1.4);
      const tSec = now / 1000;

      // ── world layer ──
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (w3) {
        ctx.clearRect(0, 0, W, H);
        w3.resize(W, H, dpr);
        w3.adapt(frameEma, now);
        w3.render({ engine: eng, cx: c.x, cy: c.y, z, W, H, pitch, dpr, hour, night, dusk, tSec: ambT, now, active, motion, showTraffic: pr.layer === 'normal' || pr.layer === 'traffic', parkedAtBase });
      } else { ctx.fillStyle = '#7fbfe3'; ctx.fillRect(0, 0, W, H); }
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.scale(z, z * gy); ctx.translate(-c.x, -c.y);
      // zooming in tilts the camera: buildings rise into 2.5D and the streets come alive
      const tilt = BASE_TILT + (1 - BASE_TILT) * Math.max(0, Math.min(1, (z - 1.7) / 1.6));
      const live3d = tilt > BASE_TILT + 0.001;
      const liveView = { x0: view.x0 - 10, y0: view.y0 - 10, x1: view.x1 + 10, y1: view.y1 + 60 };
      if (!st.paused && st.phase === 'running') ambT += (dtMs / 1000) * Math.max(1, st.speed);
      if (w3) { /* the 3D renderer draws the city */ }
      else if (!live3d && eff <= 1.15) ctx.drawImage(cityCanvas(1, active, activeKey), -PAD, -PAD, WORLD_W + PAD * 2, WORLD_H + PAD * 2);
      else if (!live3d && eff <= 2.6) ctx.drawImage(cityCanvas(2, active, activeKey), -PAD, -PAD, WORLD_W + PAD * 2, WORLD_H + PAD * 2);
      else drawCity(ctx, 2, liveView, active, z, { skipRoofs: true, tilt });
      if (!w3 && z > 2.1 && pr.layer === 'normal' && !lowDetail) drawParked(ctx, view, active);
      if (!w3 && z > 1.2 && motion && !lowDetail && (pr.layer === 'normal' || pr.layer === 'traffic')) drawTraffic(ctx, view, ambT, st.districtTraffic, night, z, active);
      // water glints
      if (motion && !w3) {
        ctx.strokeStyle = `rgba(255,255,255,${0.45 - 0.3 * night})`; ctx.lineWidth = 1.2; ctx.beginPath();
        const rl = city.riverline;
        for (let k = 0; k < 40; k++) {
          const i = (k * 7) % (rl.length - 1); const p = rl[i];
          const off = ((tSec * 9 + k * 37) % 50) - 25;
          ctx.moveTo(p.x + off, p.y + ((k % 3) - 1) * 6); ctx.lineTo(p.x + off + 6, p.y + ((k % 3) - 1) * 6);
        }
        for (let k = 0; k < 50; k++) { const x = (k * 97) % WORLD_W, y = city.coast[Math.floor((x / WORLD_W) * (city.coast.length - 1))].y + 20 + ((k * 13) % 60); const off = Math.sin(tSec * 0.8 + k) * 6; ctx.moveTo(x + off, y); ctx.lineTo(x + off + 8, y); }
        ctx.stroke();
      }
      // night: the colour drains out and the city darkens toward a deep blue
      const nightA = 0.72 * night;
      const vr = { x: view.x0 - 50, y: view.y0 - 50, w: view.x1 - view.x0 + 100, h: view.y1 - view.y0 + 140 };
      const darken = () => {
        if (night <= 0) return;
        ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = `rgba(128,128,128,${0.5 * night})`; ctx.fillRect(vr.x, vr.y, vr.w, vr.h);
        ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = `rgba(8,14,34,${nightA})`; ctx.fillRect(vr.x, vr.y, vr.w, vr.h);
      };
      // the live close-up darkens the ground first and draws night-graded buildings over it, so lit windows glow
      const liveCity = !w3 && (live3d || eff > 2.6);
      if (liveCity) {
        darken();
        // street lights pool on the ground, under the buildings that rise in front of them
        if (night > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85 * night; drawNightLights(ctx, view, { windows: false }); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
        drawBuildings3D(ctx, liveView, tilt, night, z, !lowDetail, nightA * 0.92); drawModels(ctx, liveView, tilt, night, z, nightA * 0.92);
      }
      // broad daylight falls from the north-west: a warm lift on one side of the city, a cool falloff on the other
      if (!w3 && night < 0.9 && pr.layer === 'normal') {
        const sun = ctx.createLinearGradient(0, 0, WORLD_W, WORLD_H);
        sun.addColorStop(0, `rgba(255,244,214,${0.1 * (1 - night)})`); sun.addColorStop(0.5, 'rgba(255,255,255,0)'); sun.addColorStop(1, `rgba(24,40,78,${0.1 * (1 - night)})`);
        ctx.fillStyle = sun; ctx.fillRect(vr.x, vr.y, vr.w, vr.h);
      }
      // locked districts are greyed out
      const lockedFill = liveCity ? `rgba(${Math.round(64 - 56 * nightA)},${Math.round(70 - 56 * nightA)},${Math.round(82 - 48 * nightA)},0.45)` : 'rgba(64,70,82,0.45)';
      if (!w3) for (const d of city.districts) {
        if (active.has(d.id)) continue;
        ctx.fillStyle = lockedFill; ctx.beginPath(); ctx.moveTo(d.poly[0].x, d.poly[0].y); for (const p of d.poly) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.fill();
      }
      // golden hour around sunrise and sunset
      if (!w3 && dusk > 0.01 && night < 0.95) {
        ctx.fillStyle = `rgba(255,150,70,${0.13 * dusk * (1 - night)})`; ctx.fillRect(vr.x, vr.y, vr.w, vr.h);
      }
      if (night > 0 && !w3) {
        if (!liveCity) darken();
        if (!liveCity) {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85 * night;
          ctx.drawImage(lightsCanvas(), -PAD, -PAD, WORLD_W + PAD * 2, WORLD_H + PAD * 2);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }
      }
      // cloud shadows drifting slowly over the city on a bright day
      if (!w3 && night < 0.6 && motion && !lowDetail && pr.layer === 'normal') {
        const a = 0.09 * (1 - night / 0.6);
        for (let k = 0; k < 5; k++) {
          const span = WORLD_W + 900, cx = ((k * 613 + tSec * (5 + k)) % span) - 450, cy = (k * 389) % WORLD_H + 80 * Math.sin(tSec / 40 + k);
          const r = 230 + (k * 97) % 160;
          if (cx + r < view.x0 || cx - r > view.x1 || cy + r < view.y0 || cy - r > view.y1) continue;
          const g = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
          g.addColorStop(0, `rgba(30,40,58,${a})`); g.addColorStop(1, 'rgba(30,40,58,0)');
          ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
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
      ctx.setLineDash([6 / z, 6 / z]); ctx.strokeStyle = night > 0.5 ? 'rgba(170,185,200,0.28)' : 'rgba(80,90,110,0.38)'; ctx.lineWidth = Math.max(1, 1.2 / z);
      for (const d of city.districts) { ctx.beginPath(); ctx.moveTo(d.poly[0].x, d.poly[0].y); for (const p of d.poly) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.stroke(); }
      ctx.setLineDash([]);
      // public alert zones
      for (const inc of Object.values(st.incidents)) {
        if (!inc.alert || inc.reportedNode === null || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
        const d = city.districtById[city.nodes[inc.reportedNode].district];
        if (!d) continue;
        const ev = inc.alert.kind === 'evacuate';
        const pulseA = motion ? 0.16 + 0.06 * Math.sin(now / 500) : 0.18;
        ctx.fillStyle = ev ? `rgba(214,60,60,${pulseA})` : `rgba(229,160,50,${pulseA})`;
        ctx.strokeStyle = ev ? 'rgba(200,40,40,0.9)' : 'rgba(210,140,30,0.95)'; ctx.lineWidth = Math.max(3, 3.5 / z); ctx.setLineDash([12 / z, 7 / z]);
        ctx.beginPath(); ctx.moveTo(d.poly[0].x, d.poly[0].y); for (const p of d.poly) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      }
      if (!w3 && z > 0.9) for (const s of Object.values(st.stations)) drawStation2D(ctx, stationLayout(city, s), s.service, night, z);
      if (st.selected.kind === 'district') { const d = city.districtById[st.selected.id!]; if (d) { ctx.strokeStyle = '#4A9CD6'; ctx.lineWidth = Math.max(2, 2 / z); ctx.beginPath(); ctx.moveTo(d.poly[0].x, d.poly[0].y); for (const p of d.poly) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.stroke(); } }
      ctx.restore();

      // ── screen-space overlays ──
      const S = (x: number, y: number) => ({ x: (x - c.x) * z + W / 2, y: (y - c.y) * z * gy + H / 2 });
      /** a point at height h above the ground, on screen */
      const S3 = (x: number, y: number, h: number) => ({ x: (x - c.x) * z + W / 2, y: ((y - c.y) * gy - h * c.sp) * z + H / 2 });
      if (layer === 'incidents') { ctx.fillStyle = 'rgba(8,12,18,0.5)'; ctx.fillRect(0, 0, W, H); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      // district labels
      if (z < 2.8 && pr.lockedLabel !== false) {
        for (const d of city.districts) {
          const p = S(d.center.x, d.center.y - 40);
          const locked = !active.has(d.id);
          ctx.font = `700 ${Math.max(10, Math.min(15, 10 + z * 3.5))}px Inter, system-ui, sans-serif`;
          const name = d.name.toUpperCase().split('').join(' ');
          const dark = night > 0.5;
          ctx.lineWidth = 3.5; ctx.strokeStyle = dark ? 'rgba(8,12,18,0.8)' : 'rgba(255,255,255,0.85)'; ctx.strokeText(name, p.x, p.y);
          ctx.fillStyle = locked ? (dark ? 'rgba(152,166,181,0.5)' : 'rgba(90,96,108,0.6)') : (dark ? 'rgba(214,224,234,0.9)' : 'rgba(34,42,56,0.88)'); ctx.fillText(name, p.x, p.y);
          if (locked) { ctx.font = '600 9px Inter, system-ui, sans-serif'; ctx.fillStyle = dark ? 'rgba(152,166,181,0.6)' : 'rgba(80,86,98,0.75)'; ctx.fillText(`🔒 RANK ${d.unlockRank}`, p.x, p.y + 14); }
        }
      }
      ctx.font = 'italic 600 10px Inter, system-ui, sans-serif'; ctx.fillStyle = night > 0.5 ? 'rgba(110,160,210,0.6)' : 'rgba(30,90,140,0.65)';
      const rv = S(260, city.riverline[5].y + 1); if (z > 0.6) ctx.fillText('R A V E N P O R T   R I V E R', rv.x, rv.y);
      const sea = S(1000, 1365); ctx.fillText('S O U T H E R N   B A Y', sea.x, sea.y);

      // street names along the roads when zoomed in
      if (z > 2.2 && layer !== 'incidents') {
        ctx.font = `600 ${Math.min(12, 8 + z)}px Inter, system-ui, sans-serif`;
        const dark = night > 0.5;
        for (const e of city.edges) {
          if (e.cls === 'local' ? (z < 3.1 || e.id % 3 !== 0) : e.id % 2 !== 0) continue;
          const a = city.nodes[e.a], b = city.nodes[e.b];
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (mx < view.x0 || mx > view.x1 || my < view.y0 || my > view.y1) continue;
          const len = Math.hypot(b.x - a.x, (b.y - a.y) * gy) * z;
          const tw = ctx.measureText(e.name).width;
          if (tw > len - 30) continue;
          let ang = Math.atan2((b.y - a.y) * gy, b.x - a.x); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
          const p = S(mx, my);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
          ctx.lineWidth = 3; ctx.strokeStyle = dark ? 'rgba(10,14,22,0.85)' : 'rgba(255,255,255,0.92)'; ctx.strokeText(e.name, 0, 0);
          ctx.fillStyle = dark ? 'rgba(200,210,222,0.9)' : 'rgba(70,74,84,0.95)'; ctx.fillText(e.name, 0, 0);
          ctx.restore();
        }
      }

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
      // stations: a sign over the building, with a dot per vehicle at quarters (green ready, amber busy, red out of service)
      const parkedBy = new Map<string, Unit[]>();
      for (const u of Object.values(st.units)) if (parkedAtBase(st, u) || atStation(city, st, u)) { const g = parkedBy.get(u.stationId); if (g) g.push(u); else parkedBy.set(u.stationId, [u]); }
      stationPts.current.clear();
      for (const s of Object.values(st.stations)) {
        const lay = stationLayout(city, s);
        const here = parkedBy.get(s.id) ?? [];
        const close = z > (w3 ? 3.2 : 1.6);
        const p = w3 ? S3(lay.at(0, 2).x, lay.at(0, 2).y, s.service === 'police' ? 9 : 8) : close ? S(lay.at(0, 2).x, lay.at(0, 2).y) : (() => { const n = city.nodes[s.nodeId]; return S(n.x, n.y); })();
        if (!w3 && close) p.y -= 18;
        stationPts.current.set(s.id, p);
        const m = SERVICE_META[s.service];
        const off = s.disabledShifts > 0;
        ctx.globalAlpha = off ? 0.45 : 1;
        if (close) {
          // a slim sign: service badge and name
          ctx.font = '700 10px Inter, system-ui, sans-serif';
          const tw = ctx.measureText(s.name).width + 26;
          ctx.fillStyle = 'rgba(10,14,20,0.86)'; roundRect(ctx, p.x - tw / 2, p.y - 9, tw, 18, 9); ctx.fill();
          ctx.strokeStyle = m.color; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(p.x - tw / 2 + 9, p.y, 6, 0, 7); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = '800 8px Inter, system-ui, sans-serif'; ctx.fillText(m.glyph, p.x - tw / 2 + 9, p.y + 0.5);
          ctx.fillStyle = '#e8edf2'; ctx.font = '700 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(s.name, p.x - tw / 2 + 19, p.y + 0.5); ctx.textAlign = 'center';
          if (here.length) { const w = here.length * 6; here.forEach((u, i) => { ctx.fillStyle = u.status === 'AVAILABLE' ? '#54B889' : u.status === 'OUT_OF_SERVICE' ? '#D65353' : '#E5AC4D'; ctx.beginPath(); ctx.arc(p.x - w / 2 + 3 + i * 6, p.y + 14, 2.2, 0, 7); ctx.fill(); }); }
          if (st.selected.kind === 'station' && st.selected.id === s.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; roundRect(ctx, p.x - tw / 2 - 4, p.y - 13, tw + 8, 26, 12); ctx.stroke(); }
        } else {
          if (here.length) {
            const show = here.slice(0, 8), w = show.length * 6;
            ctx.fillStyle = 'rgba(8,12,18,0.82)'; roundRect(ctx, p.x - w / 2 - 3, p.y + 12, w + 6, 8, 4); ctx.fill();
            show.forEach((u, i) => { ctx.fillStyle = u.status === 'AVAILABLE' ? '#54B889' : u.status === 'OUT_OF_SERVICE' ? '#D65353' : '#E5AC4D'; ctx.beginPath(); ctx.arc(p.x - w / 2 + 3 + i * 6, p.y + 16, 2.2, 0, 7); ctx.fill(); });
          }
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, p.x - 9, p.y - 7, 20, 20, 5); ctx.fill();
          ctx.fillStyle = '#121820'; ctx.strokeStyle = m.color; ctx.lineWidth = 2;
          roundRect(ctx, p.x - 10, p.y - 10, 20, 20, 5); ctx.fill(); ctx.stroke();
          ctx.fillStyle = m.color; ctx.font = '800 11px Inter, system-ui, sans-serif'; ctx.fillText(m.glyph, p.x, p.y + 0.5);
          if (st.selected.kind === 'station' && st.selected.id === s.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; roundRect(ctx, p.x - 14, p.y - 14, 28, 28, 7); ctx.stroke(); }
        }
        ctx.globalAlpha = 1;
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
        if (['EN_ROUTE', 'TRANSPORTING'].includes(u.status) || strong || (u.status === 'BUSY' && u.note?.startsWith('Spike strip'))) drawRoute(u, strong);
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

      // search grids: sectors shaded by likelihood, sweep progress around the rim
      for (const inc of Object.values(st.incidents)) {
        const SG = inc.search;
        if (!SG || SG.found || inc.hidden || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
        const rr = SG.r * z;
        for (const sec of SG.sectors) {
          const p = S(sec.x, sec.y);
          if (p.x < -rr || p.y < -rr || p.x > W + rr || p.y > H + rr) continue;
          const clear = sec.searched >= 1;
          ctx.fillStyle = clear ? 'rgba(120,130,140,0.22)' : `rgba(229,172,77,${0.05 + sec.p / 260})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 7); ctx.fill();
          ctx.strokeStyle = clear ? 'rgba(160,170,180,0.6)' : 'rgba(240,192,112,0.85)'; ctx.lineWidth = 1.4; ctx.setLineDash(clear ? [] : [5, 4]);
          ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 7); ctx.stroke(); ctx.setLineDash([]);
          if (sec.searched > 0 && !clear) { ctx.strokeStyle = '#54B889'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, rr, -Math.PI / 2, -Math.PI / 2 + sec.searched * Math.PI * 2); ctx.stroke(); }
          if (z > 0.6) {
            const t = clear ? `${sec.id} ✓ clear` : `${sec.id} · ${sec.p}%`;
            ctx.font = '800 10px Inter, system-ui, sans-serif';
            const tw = ctx.measureText(t).width + 10;
            ctx.fillStyle = clear ? 'rgba(40,46,54,0.85)' : 'rgba(40,30,8,0.88)'; roundRect(ctx, p.x - tw / 2, p.y - rr - 9, tw, 15, 4); ctx.fill();
            ctx.fillStyle = clear ? '#b8c2cc' : '#f0c070'; ctx.fillText(t, p.x, p.y - rr - 1);
          }
        }
        if (SG.exhausted && z > 0.6) { const p = S(SG.cx, SG.cy); ctx.font = '800 11px Inter, system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,0.85)'; ctx.strokeText('AREA SEARCHED — VERIFY LAST-SEEN POINT', p.x, p.y + rr * 2.2); ctx.fillStyle = '#ff9a9a'; ctx.fillText('AREA SEARCHED — VERIFY LAST-SEEN POINT', p.x, p.y + rr * 2.2); }
      }
      // alert banners over their district
      for (const inc of Object.values(st.incidents)) {
        if (!inc.alert || inc.reportedNode === null || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
        const d = city.districtById[city.nodes[inc.reportedNode].district];
        if (!d) continue;
        // pin the banner to the district's top edge so it never covers the incident itself
        const top = Math.min(...d.poly.map((q) => q.y));
        const p = S(d.center.x, top);
        p.y = Math.max(p.y + 16, 62);
        const t = inc.alert.kind === 'evacuate' ? '⚠ EVACUATION ORDER' : '⚠ SHELTER IN PLACE';
        ctx.font = '900 11px Inter, system-ui, sans-serif';
        const tw = ctx.measureText(t).width + 16;
        ctx.fillStyle = inc.alert.kind === 'evacuate' ? 'rgba(120,24,24,0.9)' : 'rgba(110,74,10,0.9)'; roundRect(ctx, p.x - tw / 2, p.y - 9, tw, 18, 4); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(t, p.x, p.y + 0.5);
      }

      // spike strips laid (or on their way) ahead of a pursuit
      for (const sg of st.stingers ?? []) {
        if (sg.result) continue;
        const n = city.nodes[sg.node]; const p = S(n.x, n.y);
        if (p.x < -30 || p.y < -30 || p.x > W + 30 || p.y > H + 30) continue;
        if (sg.laidAt === null) {
          ctx.strokeStyle = 'rgba(240,192,112,0.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        } else {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(0.6);
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-15, -2, 30, 6);
          ctx.fillStyle = '#f0c040'; ctx.fillRect(-15, -3, 30, 5);
          ctx.fillStyle = '#1a1d22'; for (let k = -13; k < 14; k += 4) { ctx.beginPath(); ctx.moveTo(k, -3); ctx.lineTo(k + 2, -7); ctx.lineTo(k + 4, -3); ctx.closePath(); ctx.fill(); }
          ctx.restore();
        }
        ctx.font = '800 9px Inter, system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,0.85)';
        const lbl = sg.laidAt === null ? 'SPIKES EN ROUTE' : 'SPIKES';
        ctx.strokeText(lbl, p.x, p.y - 16); ctx.fillStyle = '#f0c040'; ctx.fillText(lbl, p.x, p.y - 16);
      }

      // heard locations
      for (const h of pr.heard ?? []) {
        const n = city.nodes[h.nodeId]; const p = S(n.x, n.y);
        const col = h.reliability === 'sure' ? '#54B889' : h.reliability === 'contradicted' ? '#8a96a3' : '#E5AC4D';
        ctx.fillStyle = 'rgba(8,12,18,0.7)'; ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(h.reliability === 'sure' ? [] : [4, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.font = '800 11px Inter, system-ui, sans-serif'; ctx.fillText(h.reliability === 'contradicted' ? '×' : '?', p.x, p.y + 0.5);
      }

      // carrier location traces: the uncertainty circle tightens as the trace refines
      for (const call of Object.values(st.calls)) {
        const tr = call.trace;
        if (!tr || tr.stage < 0) continue;
        const live = call.state === 'active' || call.state === 'hold' || (sel.kind === 'incident' && sel.id === call.incidentId);
        const inc = st.incidents[call.incidentId];
        if (!live || !inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
        const p = S(tr.x, tr.y), r = Math.max(6, tr.radius * z);
        ctx.fillStyle = tr.done ? 'rgba(74,156,214,0.10)' : 'rgba(229,172,77,0.09)'; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
        ctx.strokeStyle = tr.done ? 'rgba(124,192,240,0.9)' : 'rgba(240,192,112,0.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 5]); ctx.lineDashOffset = motion ? -now / 50 : 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        if (!tr.done && motion) { const ping = (now % 1600) / 1600; ctx.strokeStyle = `rgba(240,192,112,${0.6 * (1 - ping)})`; ctx.beginPath(); ctx.arc(p.x, p.y, r * ping, 0, 7); ctx.stroke(); }
        ctx.font = '700 10px Inter, system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,0.85)';
        const lbl = `TRACE ±${Math.max(10, Math.round(tr.radius * 4 / 10) * 10)} m`;
        ctx.strokeText(lbl, p.x, p.y - r - 8); ctx.fillStyle = tr.done ? '#9fd3f5' : '#f0c070'; ctx.fillText(lbl, p.x, p.y - r - 8);
      }
      // city cameras: shown while the CCTV terminal is open (click one to pull its stream)
      if (useApp.getState().cctvOpen && layer === 'normal' && z > 0.7) {
        const link = st.cctv?.link ?? null, tried = st.cctv?.tried ?? {};
        for (const cam of eng.cameras()) {
          const p = S(cam.x, cam.y); if (p.x < -10 || p.y < -10 || p.x > W + 10 || p.y > H + 10) continue;
          const live = link?.cam === cam.id;
          if (live) {
            const hd = cam.heading + link!.pan, fov = cam.fov / link!.zoom, R = cam.range * (cam.ptz ? 1 + (link!.zoom - 1) * 0.55 : 1);
            ctx.fillStyle = 'rgba(127,182,230,0.13)'; ctx.strokeStyle = 'rgba(127,182,230,0.7)'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(p.x, p.y);
            for (let k = 0; k <= 12; k++) { const a = hd - fov / 2 + (fov * k) / 12; const q = S(cam.x + Math.cos(a) * R, cam.y + Math.sin(a) * R); ctx.lineTo(q.x, q.y); }
            ctx.closePath(); ctx.fill(); ctx.stroke();
          }
          ctx.fillStyle = tried[cam.id] === 'offline' ? 'rgba(220,90,90,0.9)' : live ? '#7fb6e6' : cam.ptz ? 'rgba(210,225,240,0.9)' : 'rgba(180,192,206,0.8)';
          ctx.strokeStyle = 'rgba(8,12,18,0.85)'; ctx.lineWidth = 2;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(cam.heading);
          ctx.beginPath(); ctx.rect(-4, -2.5, 6, 5); ctx.moveTo(2, -1.5); ctx.lineTo(6, -3.5); ctx.lineTo(6, 3.5); ctx.lineTo(2, 1.5); ctx.closePath(); ctx.stroke(); ctx.fill();
          ctx.restore();
          if (z > 2.2) { ctx.font = '600 9px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeText(cam.id, p.x, p.y + 13); ctx.fillText(cam.id, p.x, p.y + 13); }
        }
      }

      // pursuit suspects
      for (const inc of Object.values(st.incidents)) {
        const m = inc.mover;
        if (!m || !inc.pursuit || ['RESOLVED', 'CLOSED'].includes(inc.status) || inc.reportedNode === null) continue;
        if (!m.tracked && m.contact === 0 && !m.heliId) continue;
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
        if (!w3 && inc.category === 'fire' && !inc.duplicateOf && inc.requires.length) {
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
          const ag = inc.agency;
          if (ag && !ag.here || ag?.here && st.time - (ag.arriveAt ?? 0) < 20) {
            const def = AGENCY[ag!.kind];
            const asked = ag!.askedAt !== null && ag!.calledAt === null;
            const t2 = ag!.here ? `${def.short} ON SCENE` : ag!.calledAt !== null ? `${def.short} · ${Math.max(0, Math.ceil((ag!.arriveAt! - st.time) / 60 * 10) / 10)} min` : asked ? `${def.short} REQUESTED` : '';
            if (t2) {
              ctx.font = '800 9px Inter, system-ui, sans-serif';
              const w2 = ctx.measureText(t2).width + 10;
              const blink = asked && motion && Math.floor(now / 450) % 2 === 0;
              ctx.fillStyle = ag!.here ? 'rgba(20,60,40,0.92)' : asked ? (blink ? 'rgba(140,90,10,0.95)' : 'rgba(80,52,8,0.92)') : 'rgba(20,44,70,0.92)'; roundRect(ctx, p.x - w2 / 2, p.y + 25, w2, 13, 3); ctx.fill();
              ctx.fillStyle = ag!.here ? '#a7f0c8' : asked ? '#ffd98a' : '#9fd3f5'; ctx.fillText(t2, p.x, p.y + 32);
            }
          }
        }
      }

      // units (stacked parked units fan out so each stays clickable)
      const dimUnits = layer === 'incidents' ? 0.55 : 1;
      const groups = new Map<string, Unit[]>();
      const markers = w3 ? z < 3.2 : z < 1.15;
      if (!w3 || markers) for (const u of Object.values(st.units)) { if (u.speed > 0.05 || parkedAtBase(st, u)) continue; const k = `${Math.round(u.x / 6)},${Math.round(u.y / 6)}`; const g = groups.get(k); if (g) g.push(u); else groups.set(k, [u]); }
      offs.current.clear();
      // in 3D the vehicles park themselves neatly; labels follow the models
      if (w3 && !markers) for (const u of Object.values(st.units)) { const pose = w3.layout.get(u.id); if (!pose) continue; const a = S(u.x, u.y), b = S3(pose.x, pose.y, pose.top); offs.current.set(u.id, { dx: b.x - a.x, dy: b.y - a.y }); }
      const vs = Math.max(0.75, Math.min(1.8, 0.6 + z * 0.42));
      // crews sharing a scene line up nose-first under the pin in a tidy bay, with one caption for the group
      const bays: Array<{ x: number; y: number; w: number; h: number; units: Unit[] }> = [];
      if (!w3 || markers) for (const g of groups.values()) {
        if (g.length < 2) continue;
        g.sort((a, b) => a.id.localeCompare(b.id));
        const perRow = markers ? 4 : 5;
        const pitchX = markers ? 15 : Math.round(10 * vs + 6), pitchY = markers ? 15 : Math.round(28 * vs + 6);
        const dy0 = markers ? 28 : Math.round(30 + 14 * vs);
        g.forEach((u, i) => { const row = Math.floor(i / perRow), col = i % perRow, inRow = Math.min(perRow, g.length - row * perRow); offs.current.set(u.id, { dx: (col - (inRow - 1) / 2) * pitchX, dy: dy0 + row * pitchY }); });
        const rows = Math.ceil(g.length / perRow), cols = Math.min(perRow, g.length);
        const a = S(g[0].x, g[0].y);
        const bw = cols * pitchX + 8, bh = rows * pitchY + (markers ? 2 : 4);
        bays.push({ x: a.x - bw / 2, y: a.y + dy0 - pitchY / 2 - 2, w: bw, h: bh, units: g });
      }
      for (const b of bays) {
        if (b.x > W || b.y > H || b.x + b.w < 0 || b.y + b.h < 0) continue;
        ctx.fillStyle = 'rgba(12,17,23,0.55)'; roundRect(ctx, b.x, b.y, b.w, b.h, 6); ctx.fill();
        ctx.strokeStyle = 'rgba(232,237,242,0.22)'; ctx.lineWidth = 1; ctx.stroke();
      }
      for (const u of Object.values(st.units)) {
        // classic view: vehicles at quarters sit on the station forecourt and are seen pulling out and backing in
        if (!w3 && !isAir(u) && !u.temp && st.stations[u.stationId]) {
          const lay = stationLayout(city, st.stations[u.stationId]);
          const k = Math.min(lay.slots.length - 1, slotOf(st, u));
          const hd0 = heading.current.get(u.id)?.h ?? lay.heading;
          const vp = fleet2d.current.pose(u, { x: u.x, y: u.y, heading: hd0 }, { slot: lay.slots[k], exit: lay.exits[k] }, atStation(city, st, u), now);
          if ((vp.parked || vp.moving) && !markers) {
            const q = S(vp.pose.x, vp.pose.y), p0 = S(u.x, u.y);
            offs.current.set(u.id, { dx: q.x - p0.x, dy: q.y - p0.y });
            drawParkedSprite(ctx, u, q, vp.pose.heading, z, now, motion, night);
            if (sel.kind === 'unit' && sel.id === u.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(q.x, q.y, 12, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
            if (vp.moving) heading.current.set(u.id, { x: u.x, y: u.y, h: vp.pose.heading });
            continue;
          }
        }
        // parked vehicles show in their bays; only units out on the road get the full treatment
        if (parkedAtBase(st, u) && !(sel.kind === 'unit' && sel.id === u.id)) continue;
        const o0 = offs.current.get(u.id) ?? { dx: 0, dy: 0 };
        const p0 = S(u.x, u.y); const p = { x: p0.x + o0.dx, y: p0.y + o0.dy };
        if (p.x < -40 || p.y < -40 || p.x > W + 40 || p.y > H + 40) continue;
        const hd = heading.current.get(u.id) ?? { x: u.x, y: u.y, h: -Math.PI / 2 };
        if (Math.hypot(u.x - hd.x, u.y - hd.y) > 0.6) {
          const target = Math.atan2(u.y - hd.y, u.x - hd.x);
          let diff = target - hd.h; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
          hd.h += diff * Math.min(1, dtMs / 90); hd.x = u.x; hd.y = u.y;
        }
        const grouped = offs.current.has(u.id) && !(w3 && !markers);
        if (grouped && !markers) { let diff = -Math.PI / 2 - hd.h; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2; hd.h += diff * Math.min(1, dtMs / 220); }
        heading.current.set(u.id, hd);
        const responding = (['EN_ROUTE', 'DISPATCHED'].includes(u.status) && u.code !== 2) || u.status === 'TRANSPORTING' || (u.status === 'ON_SCENE' && !!u.assignedIncidentId);
        const moving = u.speed > 0.1 && ['EN_ROUTE', 'TRANSPORTING', 'RETURNING'].includes(u.status);
        const v = VEH[u.service];
        ctx.globalAlpha = (u.status === 'OUT_OF_SERVICE' ? 0.4 : 1) * dimUnits;
        if (markers && !isAir(u)) {
          // zoomed out: a clean marker per unit, with a heading notch and flashing ring when responding
          const col = SERVICE_META[u.service].color;
          const r = 6.5;
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(p.x + 1, p.y + 1.5, r + 1, 0, 7); ctx.fill();
          if (moving) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(hd.h) * (r + 5), p.y + Math.sin(hd.h) * (r + 5)); ctx.lineTo(p.x + Math.cos(hd.h + 2.4) * r, p.y + Math.sin(hd.h + 2.4) * r); ctx.lineTo(p.x + Math.cos(hd.h - 2.4) * r, p.y + Math.sin(hd.h - 2.4) * r); ctx.closePath(); ctx.fill(); }
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p.x, p.y, r + 1.2, 0, 7); ctx.fill();
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = '800 8px Inter, system-ui, sans-serif'; ctx.fillText(SERVICE_META[u.service].glyph, p.x, p.y + 0.5);
          if (responding && motion) { const ph = Math.floor(now / 200) % 2; ctx.strokeStyle = ph ? v.bar[0] : v.bar[1]; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r + 3.5, 0, 7); ctx.stroke(); }
          else if (eng.onPatrol(u)) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
        } else if (w3) {
          // the 3D model is the vehicle; the overlay only carries its badge and rings
        } else if (isAir(u)) {
          drawHeli(ctx, st, u, p, hd.h, vs, now, motion, night, S);
        } else {
          // a proper model of the vehicle, its light bar flashing when it runs hot
          const ph = responding && u.type !== 'foot' ? (motion ? 1 + (Math.floor(now / 140) % 2) : 1) : 0;
          const spr = vehicleSprite(u.type, u.service, ph, u.fit?.livery, u.fit?.chassis);
          const k = vs * 0.5, L = spr.len * k, Wd = spr.wid * k;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(hd.h);
          if (night > 0.3 && moving) {
            const hg = ctx.createLinearGradient(L / 2, 0, L / 2 + 34 * k, 0);
            hg.addColorStop(0, `rgba(255,244,210,${0.32 * night})`); hg.addColorStop(1, 'rgba(255,244,210,0)');
            ctx.fillStyle = hg; ctx.beginPath(); ctx.moveTo(L / 2 - 2 * k, -Wd * 0.3); ctx.lineTo(L / 2 + 34 * k, -13 * k); ctx.lineTo(L / 2 + 34 * k, 13 * k); ctx.lineTo(L / 2 - 2 * k, Wd * 0.3); ctx.closePath(); ctx.fill();
          }
          ctx.fillStyle = 'rgba(0,0,0,0.38)'; roundRect(ctx, -L / 2 + 2.2 * k, -Wd / 2 + 2.6 * k, L - 2 * k, Wd - 2 * k, 2.5 * k); ctx.fill();
          ctx.drawImage(spr.img, -L / 2, -Wd / 2, L, Wd);
          if (ph) {
            const bx = barOffset(u.type, u.service) * (L - 4 * k), rad = (7 + 6 * night) * vs;
            ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < 2; i++) {
              if ((ph === 1) !== (i === 0) && motion) continue;
              const by = (i === 0 ? -1 : 1) * Wd * 0.18, col = v.bar[i];
              const g = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
              g.addColorStop(0, `${col}aa`); g.addColorStop(0.35, `${col}44`); g.addColorStop(1, `${col}00`);
              ctx.fillStyle = g; ctx.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
            }
            ctx.globalCompositeOperation = 'source-over';
          }
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        if (u.temp) { ctx.strokeStyle = '#E5AC4D'; ctx.setLineDash([2, 2]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
        if (u.status === 'ON_SCENE' && !grouped) { ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, 12 * vs, 0, 7); ctx.stroke(); }
        if (u.checkDue != null) {
          const over = st.time >= u.checkDue, soon = !over && u.checkDue - st.time < 12;
          if (over || soon) {
            const ph = motion ? (Math.sin(now / 180) + 1) / 2 : 1;
            ctx.strokeStyle = over ? `rgba(240,170,60,${0.5 + 0.5 * ph})` : 'rgba(240,192,112,0.45)'; ctx.lineWidth = over ? 2.4 : 1.4;
            ctx.beginPath(); ctx.arc(p.x, p.y, (over ? 14 + ph * 3 : 13) * Math.min(1.2, vs), 0, 7); ctx.stroke();
            if (over) { ctx.font = '900 9px Inter, system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,0.9)'; ctx.strokeText('STATUS?', p.x, p.y - 20 * Math.min(1.2, vs)); ctx.fillStyle = '#f0b860'; ctx.fillText('STATUS?', p.x, p.y - 20 * Math.min(1.2, vs)); }
          }
        }
        if (pr.multi?.includes(u.id)) { ctx.strokeStyle = '#7cc0f0'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, 13 * Math.min(1.3, vs), 0, 7); ctx.stroke(); ctx.setLineDash([]); }
        const selected = sel.kind === 'unit' && sel.id === u.id;
        if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.setLineDash([4, 3]); ctx.lineDashOffset = motion ? now / 70 : 0; ctx.beginPath(); ctx.arc(p.x, p.y, 15 * vs, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
        if ((z > 1.1 && !grouped) || selected || hover.current?.id === u.id) {
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

      // one caption per bay instead of overlapping callsign badges
      if (z > 1.1) for (const b of bays) {
        const names = b.units.map((u) => u.callsign);
        const text = names.length > 3 ? `${names.slice(0, 3).join(' · ')} +${names.length - 3}` : names.join(' · ');
        ctx.font = '700 9px Inter, system-ui, sans-serif';
        const tw = ctx.measureText(text).width + 12, cx = b.x + b.w / 2, cy = b.y + b.h + 9;
        ctx.fillStyle = 'rgba(12,17,23,0.9)'; roundRect(ctx, cx - tw / 2, cy - 7, tw, 14, 3); ctx.fill();
        ctx.fillStyle = '#e8edf2'; ctx.fillText(text, cx, cy + 0.5);
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
          for (let k = 0; k < 4; k++) { const fx = ((k * 0.31 + (motion ? now / 90000 : 0)) % 1) * W, fy = H * (0.2 + k * 0.2); const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, W * 0.5); g.addColorStop(0, `rgba(180,195,210,${0.16 * I})`); g.addColorStop(1, 'rgba(180,195,210,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
        } else if (st.weather === 'heat') { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(229,150,60,${0.1 * I})`); g.addColorStop(1, 'rgba(229,150,60,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
        if (layer === 'weather') { ctx.fillStyle = 'rgba(232,237,242,0.92)'; ctx.font = '700 13px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`${WEATHER_LABEL[st.weather]} · intensity ${Math.round(st.weatherIntensity * 100)}% · road speed ×${WEATHER_SPEED[st.weather].toFixed(2)}`, 14, H - 48); ctx.textAlign = 'center'; }
      }
      // edge vignette
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${0.12 + 0.2 * night})`); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

      // drag-to-dispatch: a tether from the grabbed unit to the cursor, and the drop target lights up
      const dg = drag.current;
      if (dg?.grab && dg.moved && mouse.current.inside) {
        const pinInc = dg.grab.kind === 'incident' ? st.incidents[dg.grab.id] : null;
        if (pinInc && pinInc.reportedNode !== null) {
          const from = pinPos(pinInc), m = mouse.current, t = hover.current;
          const onOther = t?.kind === 'incident' && t.id !== pinInc.id ? st.incidents[t.id] : null;
          const w = toWorld(m.x, m.y), dest = city.nearestNode(w.x, w.y), dn = S(city.nodes[dest].x, city.nodes[dest].y);
          ctx.strokeStyle = sevColor(pinInc.severity); ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(onOther ? m.x : dn.x, onOther ? m.y : dn.y); ctx.stroke(); ctx.setLineDash([]);
          if (!onOther) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(dn.x, dn.y, 9 + pulse * 3, 0, 7); ctx.stroke(); }
          const text = onOther ? `Link as the same emergency as ${onOther.label}` : `Move pin to ${addressOf(city, dest)}`;
          ctx.font = '700 11px Inter, system-ui, sans-serif';
          const tw = ctx.measureText(text).width + 16;
          ctx.fillStyle = 'rgba(12,17,23,0.92)'; roundRect(ctx, m.x - tw / 2, m.y + 20, tw, 20, 5); ctx.fill();
          ctx.strokeStyle = 'rgba(232,237,242,0.25)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = '#e8edf2'; ctx.fillText(text, m.x, m.y + 30.5);
        }
        const src = dg.grab.kind === 'unit' ? st.units[dg.grab.id] : null;
        const stn = dg.grab.kind === 'station' ? st.stations[dg.grab.id] : null;
        const from = src ? (() => { const q = S(src.x, src.y); const o = offs.current.get(src.id) ?? { dx: 0, dy: 0 }; return { x: q.x + o.dx, y: q.y + o.dy }; })() : stn ? S(city.nodes[stn.nodeId].x, city.nodes[stn.nodeId].y) : null;
        const svc = src?.service ?? stn?.service ?? 'police';
        const col = SERVICE_META[svc].color;
        if (from) {
          const m = mouse.current;
          ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.setLineDash([8, 6]); ctx.lineDashOffset = motion ? -now / 30 : 0;
          ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(m.x, m.y); ctx.stroke(); ctx.setLineDash([]);
          const t = hover.current;
          const onInc = t?.kind === 'incident' ? st.incidents[t.id] : null;
          ctx.fillStyle = 'rgba(12,17,23,0.9)'; ctx.strokeStyle = onInc ? '#fff' : col; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(m.x, m.y, onInc ? 15 : 10, 0, 7); ctx.fill(); ctx.stroke();
          ctx.fillStyle = col; ctx.font = '800 10px Inter, system-ui, sans-serif'; ctx.fillText(SERVICE_META[svc].glyph, m.x, m.y + 0.5);
          const who = src ? src.callsign : stn ? `next free unit · ${stn.name}` : '';
          const canMove = src && ['AVAILABLE', 'RETURNING'].includes(src.status) && !isAir(src);
          const eta = onInc && onInc.reportedNode !== null && src ? eng.estimate(src.id, onInc.reportedNode)?.eta : undefined;
          const text = onInc ? `Dispatch ${who} → ${onInc.label}${eta !== undefined && isFinite(eta) ? ` · ${eta >= 60 ? `${Math.floor(eta / 60)}m ${String(Math.round(eta % 60)).padStart(2, '0')}s` : `${Math.round(eta)}s`}` : ''}` : t?.kind === 'hospital' && src?.status === 'TRANSPORTING' ? `Transport ${who} to this hospital` : canMove ? `Move ${who} here to cover` : `Drop on an incident to dispatch ${who}`;
          ctx.font = '700 11px Inter, system-ui, sans-serif';
          const tw = ctx.measureText(text).width + 16;
          ctx.fillStyle = 'rgba(12,17,23,0.92)'; roundRect(ctx, m.x - tw / 2, m.y + 20, tw, 20, 5); ctx.fill();
          ctx.strokeStyle = onInc ? sevColor(onInc.severity) : 'rgba(232,237,242,0.25)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = '#e8edf2'; ctx.fillText(text, m.x, m.y + 30.5);
        }
      }

      if (box.current) {
        const b = box.current;
        ctx.fillStyle = 'rgba(74,156,214,0.16)'; ctx.strokeStyle = 'rgba(124,192,240,0.95)'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]);
        ctx.fillRect(Math.min(b.sx, b.x), Math.min(b.sy, b.y), Math.abs(b.x - b.sx), Math.abs(b.y - b.sy));
        ctx.strokeRect(Math.min(b.sx, b.x), Math.min(b.sy, b.y), Math.abs(b.x - b.sx), Math.abs(b.y - b.sy)); ctx.setLineDash([]);
      }

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
        const x = W - (pr.minimap ? 212 : 20) - len, y = H - (pr.sounds ? 38 : 18);
        ctx.strokeStyle = 'rgba(232,237,242,0.75)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 5); ctx.stroke();
        ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(232,237,242,0.85)'; ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x + len / 2, y - 9);
      }

      // positional sirens and rotors for what is on (or just off) screen
      if (pr.sounds && now - lastSnd > 150 && Math.floor(now / 300) !== Math.floor(lastSnd / 300)) {
        // the world under the camera: traffic, water, birds or crickets, crowds and fires close by
        const close = Math.max(0, Math.min(1, (z - c.fit) / 5));
        const cn = city.nodes[city.nearestNode(c.x, c.y)];
        const dist = city.districtById[cn.district];
        const tags = dist?.tags ?? [];
        const rl = city.riverline; let dw = Infinity; for (const p of rl) dw = Math.min(dw, Math.hypot(p.x - c.x, p.y - c.y)); const coastY = city.coast[Math.floor((Math.max(0, Math.min(WORLD_W, c.x)) / WORLD_W) * (city.coast.length - 1))].y; dw = Math.min(dw, Math.abs(coastY - c.y));
        const near = (tpl: (i: Incident) => boolean) => Object.values(st.incidents).reduce((m, i) => (['RESOLVED', 'CLOSED'].includes(i.status) || !tpl(i) ? m : Math.max(m, 1 - Math.hypot(city.nodes[i.nodeId].x - c.x, city.nodes[i.nodeId].y - c.y) / 160)), 0);
        const green = tags.some((t) => ['residential', 'suburb', 'forest', 'campus', 'river'].includes(t)) ? 1 : 0.35;
        const running = st.phase === 'running' && !st.paused && !document.hidden;
        audio.setWorldMix(running ? {
          traffic: (st.districtTraffic[cn.district] ?? 0.3) * (0.35 + 0.65 * close), water: Math.max(0, 1 - dw / 140) * (0.3 + 0.7 * close), wind: (['snow', 'storm', 'fog'].includes(st.weather) ? 0.6 : 0.15) * (0.5 + 0.5 * close),
          crowd: Math.max(near((i) => ['riot', 'protest_march', 'crowd_crush', 'public_disturbance', 'looting', 'active_shooter'].includes(i.templateId)), st.events.some((e) => e.active && ['festival', 'protest', 'riot', 'marathon'].includes(e.type) && e.districts.includes(cn.district)) ? 0.5 : 0) * (0.3 + 0.7 * close),
          fire: near((i) => i.category === 'fire' && i.requires.length > 0) * close, rain: ['rain', 'storm'].includes(st.weather) ? st.weatherIntensity : 0,
          birds: (1 - night) * green * close * (st.weather === 'clear' || st.weather === 'heat' ? 1 : 0.3), crickets: night * green * close * (st.weather === 'clear' ? 1 : 0.2), storm: st.weather === 'storm' ? st.weatherIntensity : 0,
        } : { traffic: 0, water: 0, wind: 0, crowd: 0, fire: 0, rain: 0, birds: 0, crickets: 0, storm: 0 });
      }
      if (pr.sounds && now - lastSnd > 150) {
        lastSnd = now;
        const list: SirenVoice[] = [];
        if (st.phase === 'running' && !st.paused && !document.hidden) {
          // everything responding on screen is clearly audible; nearer the centre and closer in is louder
          const R = Math.hypot(W, H) / 2 / z;
          const zg = 0.6 + 0.4 * Math.max(0, Math.min(1, (z - 0.5) / 2));
          const sir: SirenVoice[] = [], rot: SirenVoice[] = [];
          for (const u of Object.values(st.units)) {
            const air = isAir(u);
            const loud = air ? ['EN_ROUTE', 'ON_SCENE', 'RETURNING'].includes(u.status) : ((u.status === 'EN_ROUTE' || u.status === 'DISPATCHED') && u.code !== 2) || u.status === 'TRANSPORTING';
            if (!loud || u.type === 'foot' || u.type === 'bicycle') continue;
            const d = Math.hypot(u.x - c.x, u.y - c.y) / R;
            if (d > 1.6) continue;
            const near = d <= 1 ? 0.5 + 0.5 * Math.pow(1 - d, 1.2) : 0.5 * (1.6 - d) / 0.6;
            const sp = S(u.x, u.y);
            (air ? rot : sir).push({ id: u.id, kind: air ? 'rotor' : u.service, pan: Math.max(-0.9, Math.min(0.9, (sp.x - W / 2) / (W / 2))), vol: near * zg, variant: u.id.charCodeAt(u.id.length - 1) });
          }
          sir.sort((a, b) => b.vol - a.vol); rot.sort((a, b) => b.vol - a.vol);
          list.push(...sir.slice(0, 3), ...rot.slice(0, 1));
          // the caller on the line can hear the sirens coming: so can you
          const call = st.activeCallId ? st.calls[st.activeCallId] : null;
          const inc = call ? st.incidents[call.incidentId] : null;
          if (call?.heardSirens && inc) {
            const near = inc.assignedUnits.map((id) => st.units[id]).find((u) => u && u.status === 'EN_ROUTE' && u.code !== 2 && !isAir(u));
            if (near) list.push({ id: 'phone', kind: near.service, pan: 0, vol: 0.45, variant: 1 });
          }
        }
        audio.updateSirens(list);
      }

      // minimap
      if (pr.minimap && mc && now - lastMini > 200) {
        lastMini = now;
        const m = mc.getContext('2d')!;
        const mw = mc.width, mh = mc.height;
        m.drawImage(cityCanvas(1, active, activeKey), 0, 0, mw, mh);
        if (night > 0) { m.fillStyle = `rgba(8,14,34,${0.62 * night})`; m.fillRect(0, 0, mw, mh); }
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
      if (w3 && w3.canvas.parentElement === el) el.removeChild(w3.canvas);
      if (P.current.sounds) { audio.updateSirens([]); audio.stopWorld(); }
      canvas.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('contextmenu', onCtx); canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('pointerleave', onLeave);
      mc?.removeEventListener('pointerdown', onMini);
    };
  }, [gfx, quality]);

  const zoomBy = (f: number) => { const c = cam.current; c.tz = Math.max(c.fit * 0.95, Math.min(c.maxZ, c.tz * f)); };
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

/** police helicopter: ground shadow (offset by altitude), spinning rotor, camera lock and night searchlight */
function drawHeli(ctx: CanvasRenderingContext2D, st: GameState, u: Unit, p: { x: number; y: number }, h: number, vs: number, now: number, motion: boolean, night: number, S: (x: number, y: number) => { x: number; y: number }) {
  const airborne = ['EN_ROUTE', 'ON_SCENE', 'RETURNING'].includes(u.status);
  const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
  const m = inc?.mover;
  const locked = !!m && m.heliId === u.id;
  const s = vs * 1.15;
  if (airborne) {
    // searchlight / camera footprint
    const target = locked ? S(m!.x, m!.y) : inc && inc.reportedNode !== null ? S(getCity().nodes[inc.reportedNode].x, getCity().nodes[inc.reportedNode].y) : null;
    if (target && u.status === 'ON_SCENE') {
      if (night > 0.25) {
        const g = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, 30 * s);
        g.addColorStop(0, `rgba(255,250,225,${0.38 * night})`); g.addColorStop(1, 'rgba(255,250,225,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(target.x, target.y, 30 * s, 0, 7); ctx.fill();
        ctx.fillStyle = `rgba(255,250,225,${0.08 * night})`; ctx.beginPath(); ctx.moveTo(p.x - 2, p.y); ctx.lineTo(target.x - 24 * s, target.y); ctx.lineTo(target.x + 24 * s, target.y); ctx.lineTo(p.x + 2, p.y); ctx.closePath(); ctx.fill();
      }
      if (locked) {
        ctx.strokeStyle = 'rgba(111,224,155,0.75)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(target.x, target.y); ctx.stroke(); ctx.setLineDash([]);
        const r = 11 + (motion ? Math.sin(now / 200) * 1.5 : 0);
        ctx.strokeStyle = '#6fe09b'; ctx.lineWidth = 1.6; ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(target.x + sx * r, target.y + sy * (r - 5)); ctx.lineTo(target.x + sx * r, target.y + sy * r); ctx.lineTo(target.x + sx * (r - 5), target.y + sy * r); }
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.beginPath(); ctx.ellipse(p.x + 11 * s, p.y + 17 * s, 8 * s, 3.4 * s, h, 0, 7); ctx.fill();
  }
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(h);
  // tail boom and fin
  ctx.fillStyle = '#16304f'; ctx.fillRect(-15 * s, -0.8 * s, 10 * s, 1.6 * s); ctx.fillRect(-16 * s, -3 * s, 2 * s, 6 * s);
  // skids
  ctx.strokeStyle = 'rgba(200,210,220,0.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-5 * s, -3.6 * s); ctx.lineTo(5 * s, -3.6 * s); ctx.moveTo(-5 * s, 3.6 * s); ctx.lineTo(5 * s, 3.6 * s); ctx.stroke();
  // body
  ctx.fillStyle = '#1d4a7a'; ctx.beginPath(); ctx.ellipse(0, 0, 7 * s, 3.4 * s, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#e8edf2'; ctx.fillRect(-4 * s, -0.6 * s, 6 * s, 1.2 * s);
  ctx.fillStyle = 'rgba(150,200,240,0.85)'; ctx.beginPath(); ctx.ellipse(4 * s, 0, 2.6 * s, 2.4 * s, 0, -1.2, 1.2); ctx.fill();
  // beacon
  if (airborne && (Math.floor(now / 500) % 2 === 0 || !motion)) { ctx.fillStyle = '#ff5050'; ctx.beginPath(); ctx.arc(-2 * s, 0, 1 * s, 0, 7); ctx.fill(); }
  // main rotor
  const a = airborne && motion ? now / 28 : 0.4;
  if (airborne) { ctx.fillStyle = 'rgba(210,220,230,0.1)'; ctx.beginPath(); ctx.arc(0, 0, 13 * s, 0, 7); ctx.fill(); }
  ctx.strokeStyle = airborne ? 'rgba(220,228,236,0.55)' : 'rgba(220,228,236,0.85)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); for (let k = 0; k < 2; k++) { const b = a + k * Math.PI / 2; ctx.moveTo(Math.cos(b) * 13 * s, Math.sin(b) * 13 * s); ctx.lineTo(-Math.cos(b) * 13 * s, -Math.sin(b) * 13 * s); } ctx.stroke();
  ctx.restore();
}

/** a vehicle sitting at its own station: drawn as a status dot under the station, not as a car */
export function parkedAtBase(st: GameState, u: Unit): boolean {
  if (u.route.length || u.speed > 0.05 || !['AVAILABLE', 'BUSY', 'OUT_OF_SERVICE'].includes(u.status)) return false;
  const stn = st.stations[u.stationId];
  const node = getCity().nodes[stn ? stn.nodeId : u.postNode];
  return Math.hypot(u.x - node.x, u.y - node.y) < 6;
}

function glyph(ctx: CanvasRenderingContext2D, cat: string, x: number, y: number, s: number) {
  ctx.beginPath();
  if (cat === 'medical') { ctx.fillRect(x - s * 0.32, y - s, s * 0.64, s * 2); ctx.fillRect(x - s, y - s * 0.32, s * 2, s * 0.64); }
  else if (cat === 'fire') { ctx.moveTo(x, y - s * 1.15); ctx.quadraticCurveTo(x + s * 1.25, y, x + s * 0.55, y + s); ctx.lineTo(x - s * 0.55, y + s); ctx.quadraticCurveTo(x - s * 1.25, y, x, y - s * 1.15); ctx.fill(); }
  else if (cat === 'police') { ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y + s * 0.2); ctx.lineTo(x, y + s * 1.1); ctx.lineTo(x - s, y + s * 0.2); ctx.closePath(); ctx.fill(); }
  else { ctx.font = '900 12px Inter, system-ui, sans-serif'; ctx.fillText('?', x, y + 0.5); }
}

/** classic 2D: a station seen from above — roof, service stripe, open bays and a forecourt */
function drawStation2D(ctx: CanvasRenderingContext2D, L: ReturnType<typeof stationLayout>, service: string, night: number, z: number) {
  const poly = (pts: Array<{ x: number; y: number }>) => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const p of pts) ctx.lineTo(p.x, p.y); ctx.closePath(); };
  const rect = (u0: number, v0: number, u1: number, v1: number) => [L.at(u0, v0), L.at(u1, v0), L.at(u1, v1), L.at(u0, v1)];
  const roof = service === 'fire' ? '#7a3e30' : service === 'police' ? '#8f969d' : '#dfe5ea';
  const stripe = service === 'fire' ? '#c43b3b' : service === 'police' ? '#1f4f9a' : '#2f9e4f';
  const dim = 1 - night * 0.55;
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgba(190,185,175,${dim})`; poly(rect(-10.5, -8.2, 10.5, -2.4)); ctx.fill();
  poly(rect(10.5, -8.2, 14.8, 6.6)); ctx.fill();
  ctx.fillStyle = 'rgba(30,36,44,0.35)'; poly(rect(-9.4, -1.6, 10.8, 7.4)); ctx.fill();
  ctx.fillStyle = roof; poly(rect(-10, -2.5, 10, 6.5)); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(0.2, 1 / z); ctx.stroke();
  ctx.fillStyle = stripe; poly(rect(-10, -2.5, 10, -1.6)); ctx.fill();
  if (service !== 'police') { ctx.fillStyle = '#1a1c20'; for (const u of [-7.5, -2.5, 2.5, 7.5]) { poly(rect(u - 1.8, -2.5, u + 1.8, -1.9)); ctx.fill(); } }
  if (service === 'fire') { ctx.fillStyle = '#9c4a38'; poly(rect(-9.3, 2.9, -5.9, 6.3)); ctx.fill(); }
  // the service emblem on the roof
  const c = L.at(0, 2.4);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(c.x, c.y, 2.4, 0, 7); ctx.fill();
  ctx.fillStyle = stripe; ctx.font = '900 3px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(service === 'fire' ? 'F' : service === 'police' ? 'P' : '+', c.x, c.y + 0.2);
  ctx.strokeStyle = service === 'fire' ? 'rgba(226,178,60,0.8)' : 'rgba(240,240,234,0.8)'; ctx.lineWidth = Math.max(0.15, 0.6 / z);
  ctx.beginPath(); for (const u of [-10, -5, 0, 5, 10]) { const a = L.at(u, -8), b = L.at(u, -3); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke();
}
/** classic 2D: a vehicle on the forecourt, at true-ish scale, lights going while the crew turns out */
function drawParkedSprite(ctx: CanvasRenderingContext2D, u: Unit, q: { x: number; y: number }, h: number, z: number, now: number, motion: boolean, night: number) {
  const turning = u.status === 'DISPATCHED' && u.code !== 2;
  const ph = turning ? (motion ? 1 + (Math.floor(now / 140) % 2) : 1) : 0;
  const spr = vehicleSprite(u.type, u.service, ph, u.fit?.livery, u.fit?.chassis);
  const k = Math.min(0.9, Math.max(0.16, z * 0.075));
  const L = spr.len * k, Wd = spr.wid * k;
  ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(h);
  ctx.globalAlpha = u.status === 'OUT_OF_SERVICE' ? 0.5 : 1;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-L / 2 + 1, -Wd / 2 + 1.4, L, Wd);
  ctx.drawImage(spr.img, -L / 2, -Wd / 2, L, Wd);
  if (ph) { ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 10 + 8 * night); const col = ph === 1 ? '#ff2e3b' : '#2f7bff'; g.addColorStop(0, `${col}99`); g.addColorStop(1, `${col}00`); ctx.fillStyle = g; ctx.fillRect(-20, -20, 40, 40); ctx.globalCompositeOperation = 'source-over'; }
  ctx.restore();
  ctx.globalAlpha = 1;
}
