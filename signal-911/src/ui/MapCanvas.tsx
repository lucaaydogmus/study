import { useEffect, useRef, type ReactElement } from 'react';
import { Crosshair, Minus, Plus, Shield, Flame, HeartPulse, Gauge, Radar } from 'lucide-react';
import { useGame } from '../store/game';
import { RIVER_HALF_WIDTH, WORLD_H, WORLD_W, riverY } from '../sim/city';
import { BASE_SPEED, shownSeverity, trafficAt, type World } from '../sim/world';
import { VEHICLES, type Unit } from '../sim/units';
import type { CellKind, RoadClass, Service } from '../sim/types';

export const SERVICE_COLOR: Record<Service, string> = { police: '#5C91C9', fire: '#D76B54', medical: '#61B894' };
const SERVICE_LETTER: Record<Service, string> = { police: 'P', fire: 'F', medical: 'M' };
const SEV_COLOR = ['', '#5A9CCB', '#E8B65B', '#E45A5A', '#E45A5A'];
const CELL_FILL: Record<CellKind, string> = { building: '#202c38', house: '#1c2833', park: '#1a3028', industrial: '#252b32' };
const ROAD_W: Record<RoadClass, number> = { arterial: 8, street: 5, bridge: 8, narrow: 3.5 };
const MIN_K = 0.4, MAX_K = 5;

interface View { k: number; ox: number; oy: number }

export function MapCanvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ k: 1, ox: 0, oy: 0 });
  const target = useRef<View>({ k: 1, ox: 0, oy: 0 });
  const size = useRef({ w: 800, h: 600, fit: 0.5 });
  const hover = useRef<{ x: number; y: number } | null>(null);
  const filters = useGame((s) => s.filters);
  const toggleFilter = useGame((s) => s.toggleFilter);

  const fit = () => {
    const { w, h } = size.current;
    const k = Math.min(w / WORLD_W, h / WORLD_H) * 0.96;
    size.current.fit = k;
    const v = { k, ox: (w - WORLD_W * k) / 2, oy: (h - WORLD_H * k) / 2 };
    target.current = { ...v };
    return v;
  };
  const zoomBy = (f: number, mx = size.current.w / 2, my = size.current.h / 2) => {
    const t = target.current;
    const nk = Math.max(MIN_K, Math.min(MAX_K, t.k * f));
    t.ox = mx - ((mx - t.ox) / t.k) * nk;
    t.oy = my - ((my - t.oy) / t.k) * nk;
    t.k = nk;
  };

  useEffect(() => {
    const cv = canvas.current!, box = wrap.current!;
    const ctx = cv.getContext('2d')!;
    let dpr = 1;
    const resize = () => {
      const r = box.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      const first = size.current.w === 800 && view.current.k === 1;
      size.current.w = Math.max(100, r.width); size.current.h = Math.max(100, r.height);
      cv.width = size.current.w * dpr; cv.height = size.current.h * dpr;
      if (first) view.current = fit(); else size.current.fit = Math.min(size.current.w / WORLD_W, size.current.h / WORLD_H) * 0.96;
    };
    const ro = new ResizeObserver(resize); ro.observe(box); resize();

    // --- input -----------------------------------------------------------
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const pos = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => { cv.setPointerCapture(e.pointerId); const p = pos(e); drag = { x: p.x, y: p.y, moved: false }; };
    const move = (e: PointerEvent) => {
      const p = pos(e); hover.current = p;
      if (!drag) return;
      const dx = p.x - drag.x, dy = p.y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; drag.x = p.x; drag.y = p.y;
      for (const v of [view.current, target.current]) { v.ox += dx; v.oy += dy; }
    };
    const up = (e: PointerEvent) => {
      const d = drag; drag = null;
      if (d && !d.moved) click(pos(e));
    };
    const leave = () => { hover.current = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const p = pos(e); zoomBy(Math.exp(-e.deltaY * 0.0016), p.x, p.y); };
    const tw = (p: { x: number; y: number }) => ({ x: (p.x - view.current.ox) / view.current.k, y: (p.y - view.current.oy) / view.current.k });
    const sx = (x: number) => x * view.current.k + view.current.ox;
    const sy = (y: number) => y * view.current.k + view.current.oy;

    const unitOffsets = (w: World) => {
      const groups = new Map<string, Unit[]>();
      for (const u of w.units) if (!u.legs.length) {
        const key = `${Math.round(u.x)},${Math.round(u.y)}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(u);
      }
      const off = new Map<string, { dx: number; dy: number }>();
      for (const g of groups.values()) g.forEach((u, i) => off.set(u.id, { dx: (i - (g.length - 1) / 2) * 13, dy: 15 }));
      return off;
    };
    const visible = (f: ReturnType<typeof useGame.getState>['filters'], s: Service) => f[s];

    function click(p: { x: number; y: number }) {
      const st = useGame.getState();
      const w = st.world;
      const off = unitOffsets(w);
      let best: { kind: 'unit' | 'incident' | 'station'; id: string; d: number } | null = null;
      const consider = (kind: 'unit' | 'incident' | 'station', id: string, x: number, y: number, r: number) => {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= r && (!best || d < best.d)) best = { kind, id, d };
      };
      for (const u of w.units) if (visible(st.filters, u.service)) {
        const o = off.get(u.id) ?? { dx: 0, dy: 0 };
        consider('unit', u.id, sx(u.x) + o.dx, sy(u.y) + o.dy, 11);
      }
      for (const i of w.incidents) if (i.status !== 'RESOLVED' && i.status !== 'FAILED' && i.believedNode !== null) consider('incident', String(i.id), sx(i.x), sy(i.y), 16);
      for (const s of w.city.stations) if (visible(st.filters, s.service)) { const n = w.city.nodes[s.nodeId]; consider('station', s.id, sx(n.x), sy(n.y), 12); }
      const b = best as { kind: string; id: string } | null;
      if (b?.kind === 'unit') st.selectUnit(b.id);
      else if (b?.kind === 'incident') st.selectIncident(Number(b.id));
      else if (b?.kind === 'station') st.selectStation(b.id);
      else {
        const q = tw(p);
        const d = w.city.districts.find((d) => q.x >= d.x && q.x <= d.x + d.w && q.y >= d.y && q.y <= d.y + d.h);
        if (d) st.selectDistrict(d.id); else st.clearSelection();
      }
    }
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up); cv.addEventListener('pointerleave', leave);
    cv.addEventListener('wheel', wheel, { passive: false });

    // --- drawing ---------------------------------------------------------
    let lastFocus = 0;
    let raf = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const st = useGame.getState();
      const w = st.world, city = w.city;
      const V = view.current, T = target.current, W = size.current.w, H = size.current.h;
      if (st.focus && st.focus.nonce !== lastFocus) {
        lastFocus = st.focus.nonce;
        T.k = Math.max(T.k, size.current.fit * 1.7);
        T.ox = W / 2 - st.focus.x * T.k; T.oy = H / 2 - st.focus.y * T.k;
      }
      V.k += (T.k - V.k) * 0.22; V.ox += (T.ox - V.ox) * 0.22; V.oy += (T.oy - V.oy) * 0.22;
      const k = V.k;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0d1319'; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(V.ox, V.oy); ctx.scale(k, k);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';

      // districts + river
      for (const d of city.districts) { ctx.fillStyle = d.tint; ctx.fillRect(d.x - 8, d.y - 8, d.w + 16, d.h + 16); }
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += 20) ctx.lineTo(x, riverY(x));
      ctx.strokeStyle = '#163044'; ctx.lineWidth = RIVER_HALF_WIDTH * 2; ctx.stroke();
      ctx.strokeStyle = '#1d3d57'; ctx.lineWidth = RIVER_HALF_WIDTH * 2 - 6; ctx.stroke();
      for (const c of city.cells) {
        ctx.beginPath();
        for (let i = 0; i < 8; i += 2) ctx.lineTo(c.pts[i], c.pts[i + 1]);
        ctx.closePath(); ctx.fillStyle = CELL_FILL[c.kind]; ctx.fill();
      }
      // roads: casing, then surface
      const classes: RoadClass[] = ['narrow', 'street', 'arterial', 'bridge'];
      for (const pass of [0, 1]) for (const cls of classes) {
        ctx.beginPath();
        for (const e of city.edges) if (e.cls === cls) { const a = city.nodes[e.a], b = city.nodes[e.b]; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        ctx.lineWidth = ROAD_W[cls] + (pass === 0 ? 2.4 : 0);
        ctx.strokeStyle = pass === 0 ? '#090d11' : cls === 'arterial' || cls === 'bridge' ? '#46586b' : cls === 'street' ? '#35444f' : '#2e3a45';
        ctx.stroke();
      }
      if (st.filters.traffic) {
        for (const e of city.edges) {
          const t = trafficAt(w, e.district);
          ctx.strokeStyle = t < 1.15 ? '#61B894' : t < 1.4 ? '#E8B65B' : '#E45A5A';
          ctx.globalAlpha = 0.75; ctx.lineWidth = ROAD_W[e.cls] * 0.6;
          ctx.beginPath(); ctx.moveTo(city.nodes[e.a].x, city.nodes[e.a].y); ctx.lineTo(city.nodes[e.b].x, city.nodes[e.b].y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // closed roads
      for (const id of w.blocked) {
        const e = city.edges[id], a = city.nodes[e.a], b = city.nodes[e.b];
        ctx.strokeStyle = '#E45A5A'; ctx.lineWidth = ROAD_W[e.cls] * 0.7; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r = 6;
        ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(mx - r, my - r); ctx.lineTo(mx + r, my + r); ctx.moveTo(mx + r, my - r); ctx.lineTo(mx - r, my + r); ctx.stroke();
      }
      // selected district outline
      const selD = city.districts.find((d) => d.id === st.sel.districtId);
      if (selD) { ctx.strokeStyle = '#5A9CCB'; ctx.lineWidth = 2 / k; ctx.setLineDash([8 / k, 6 / k]); ctx.strokeRect(selD.x - 8, selD.y - 8, selD.w + 16, selD.h + 16); ctx.setLineDash([]); }

      // coverage overlay: 25 s straight-line reach of every free unit
      if (st.filters.coverage) {
        for (const u of w.units) {
          if ((u.status !== 'AVAILABLE' && u.status !== 'RETURNING') || !st.filters[u.service]) continue;
          const r = 25 * BASE_SPEED * VEHICLES[u.vehicle].speed * 0.7;
          ctx.beginPath(); ctx.arc(u.x, u.y, r, 0, Math.PI * 2);
          ctx.fillStyle = SERVICE_COLOR[u.service] + '14'; ctx.fill();
          ctx.strokeStyle = SERVICE_COLOR[u.service] + '55'; ctx.lineWidth = 1 / k; ctx.stroke();
        }
      }
      ctx.restore();

      // everything below is in screen space so markers keep a constant size
      const S = (x: number) => x * k + V.ox, SY = (y: number) => y * k + V.oy;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // district names
      ctx.font = '600 13px system-ui'; ctx.fillStyle = 'rgba(150,166,181,0.5)';
      for (const d of city.districts) ctx.fillText(d.name.replace(' Suburbs', '').replace(' District', '').toUpperCase(), S(d.x + d.w / 2), SY(d.y + 14));
      // landmarks
      if (k > 0.55) {
        ctx.font = '11px system-ui';
        for (const l of city.landmarks) {
          const n = city.nodes[l.nodeId], x = S(n.x), y = SY(n.y);
          ctx.fillStyle = '#E7EDF4'; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-3, -3, 6, 6); ctx.restore();
          if (k > 0.9) { ctx.fillStyle = 'rgba(231,237,244,0.75)'; ctx.fillText(l.name, x, y - 11); }
        }
      }
      // routes
      const selInc = st.sel.incidentId, selUnit = st.sel.unitId;
      for (const u of w.units) {
        if (!u.legs.length || !st.filters[u.service]) continue;
        const hot = u.id === selUnit || (selInc !== null && u.incidentId === selInc);
        ctx.beginPath(); ctx.moveTo(S(u.x), SY(u.y));
        for (const l of u.legs) ctx.lineTo(S(city.nodes[l.to].x), SY(city.nodes[l.to].y));
        ctx.strokeStyle = SERVICE_COLOR[u.service]; ctx.globalAlpha = hot ? 0.95 : 0.3;
        ctx.lineWidth = hot ? 3 : 1.5; ctx.setLineDash(u.status === 'RETURNING' ? [4, 5] : []); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      // stations
      for (const s of city.stations) {
        if (!st.filters[s.service]) continue;
        const n = city.nodes[s.nodeId], x = S(n.x), y = SY(n.y);
        ctx.fillStyle = '#111820'; ctx.strokeStyle = SERVICE_COLOR[s.service]; ctx.lineWidth = s.id === st.sel.stationId ? 3 : 2;
        ctx.beginPath(); ctx.roundRect(x - 8, y - 8, 16, 16, 3); ctx.fill(); ctx.stroke();
        ctx.fillStyle = SERVICE_COLOR[s.service]; ctx.font = '700 10px system-ui'; ctx.fillText('+', x, y + 0.5);
      }
      // incidents
      const pulse = 0.5 + 0.5 * Math.sin(now / 250);
      for (const i of w.incidents) {
        if (i.status === 'RESOLVED' || i.status === 'FAILED' || i.believedNode === null) continue;
        const sev = shownSeverity(i);
        const x = S(i.x), y = SY(i.y), col = SEV_COLOR[sev];
        const r = 11 + (sev >= 4 ? pulse * 3 : 0);
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.fillStyle = col + '22'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#111820'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.setLineDash(i.addrConfirmed ? [] : [4, 3]); ctx.stroke(); ctx.setLineDash([]);
        // danger meter: how close the incident is to failing
        const frac = Math.min(1, i.pressure / i.failAfter);
        if (frac > 0.02) { ctx.beginPath(); ctx.arc(x, y, r + 4, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.strokeStyle = '#E45A5A'; ctx.lineWidth = 2; ctx.stroke(); }
        if (i.status === 'STABILIZING') { ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.strokeStyle = '#61B894'; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.fillStyle = '#E7EDF4'; ctx.font = '700 11px system-ui'; ctx.fillText(String(i.id), x, y + 0.5);
        if (i.decision) { ctx.beginPath(); ctx.arc(x + 11, y - 11, 6, 0, Math.PI * 2); ctx.fillStyle = pulse > 0.5 ? '#E8B65B' : '#b98d3e'; ctx.fill(); ctx.fillStyle = '#111820'; ctx.font = '700 9px system-ui'; ctx.fillText('!', x + 11, y - 10.5); }
        if (i.id === selInc) { ctx.beginPath(); ctx.arc(x, y, r + 9, 0, Math.PI * 2); ctx.strokeStyle = '#E7EDF4'; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
      // units
      const off = unitOffsets(w);
      const pend = new Set(st.sel.pending);
      for (const u of w.units) {
        if (!st.filters[u.service]) continue;
        const o = off.get(u.id) ?? { dx: 0, dy: 0 };
        const x = S(u.x) + o.dx, y = SY(u.y) + o.dy;
        const dim = u.status === 'RETURNING' || u.status === 'BUSY';
        ctx.globalAlpha = dim ? 0.65 : 1;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = SERVICE_COLOR[u.service]; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#0b1218'; ctx.stroke();
        ctx.fillStyle = '#0b1218'; ctx.font = '700 9px system-ui'; ctx.fillText(SERVICE_LETTER[u.service], x, y + 0.5);
        ctx.globalAlpha = 1;
        if (u.status === 'ON SCENE') { ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.strokeStyle = '#E8B65B'; ctx.lineWidth = 2; ctx.stroke(); }
        if (u.status === 'EN ROUTE') { ctx.beginPath(); ctx.arc(x, y, 9 + pulse * 2, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(231,237,244,0.7)'; ctx.lineWidth = 1.2; ctx.stroke(); }
        if (pend.has(u.id)) { ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.strokeStyle = '#5A9CCB'; ctx.setLineDash([3, 3]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
        if (u.id === selUnit) { ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.strokeStyle = '#E7EDF4'; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
      // hover tooltip
      const hp = hover.current;
      if (hp) {
        let label: string | null = null, lx = 0, ly = 0;
        for (const u of w.units) {
          if (!st.filters[u.service]) continue;
          const o = off.get(u.id) ?? { dx: 0, dy: 0 };
          const x = S(u.x) + o.dx, y = SY(u.y) + o.dy;
          if (Math.hypot(hp.x - x, hp.y - y) < 11) { label = `${u.callsign} · ${u.status}${u.eta ? ` · ETA ${Math.round(u.eta)}s` : ''}`; lx = x; ly = y; }
        }
        for (const i of w.incidents) {
          if (i.status === 'RESOLVED' || i.status === 'FAILED' || i.believedNode === null) continue;
          if (Math.hypot(hp.x - S(i.x), hp.y - SY(i.y)) < 16) { label = `#${i.id} ${i.title} · ${i.status}`; lx = S(i.x); ly = SY(i.y); }
        }
        for (const s of city.stations) {
          const n = city.nodes[s.nodeId];
          if (st.filters[s.service] && Math.hypot(hp.x - S(n.x), hp.y - SY(n.y)) < 12) { label = s.name; lx = S(n.x); ly = SY(n.y); }
        }
        if (label) {
          ctx.font = '12px system-ui';
          const tw2 = ctx.measureText(label).width + 12;
          const bx = Math.min(W - tw2 - 4, Math.max(4, lx - tw2 / 2)), by = Math.max(4, ly - 34);
          ctx.fillStyle = '#253240'; ctx.strokeStyle = '#3a4c5f'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(bx, by, tw2, 22, 3); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#E7EDF4'; ctx.textAlign = 'left'; ctx.fillText(label, bx + 6, by + 11.5); ctx.textAlign = 'center';
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up); cv.removeEventListener('pointerleave', leave);
      cv.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const svc = (s: Service, icon: ReactElement, title: string) => (
    <button className={filters[s] ? 'on' : ''} style={filters[s] ? { borderColor: SERVICE_COLOR[s], color: SERVICE_COLOR[s] } : undefined}
      onClick={() => toggleFilter(s)} title={title}>{icon}</button>
  );
  return (
    <div className="mapwrap" ref={wrap}>
      <canvas ref={canvas} style={{ width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' }} />
      <div className="maptools">
        {svc('police', <Shield size={14} />, 'Show/hide police')}
        {svc('fire', <Flame size={14} />, 'Show/hide fire')}
        {svc('medical', <HeartPulse size={14} />, 'Show/hide medical')}
        <span className="sep" />
        <button className={filters.coverage ? 'on' : ''} onClick={() => toggleFilter('coverage')} title="Coverage overlay: 25 s reach of free units"><Radar size={14} /></button>
        <button className={filters.traffic ? 'on' : ''} onClick={() => toggleFilter('traffic')} title="Traffic overlay"><Gauge size={14} /></button>
      </div>
      <div className="maptools zoom">
        <button onClick={() => zoomBy(1.4)} title="Zoom in"><Plus size={14} /></button>
        <button onClick={() => zoomBy(1 / 1.4)} title="Zoom out"><Minus size={14} /></button>
        <button onClick={() => { fit(); }} title="Fit city"><Crosshair size={14} /></button>
      </div>
      <div className="maplegend">Drag to pan · Wheel to zoom · Click to select</div>
    </div>
  );
}
