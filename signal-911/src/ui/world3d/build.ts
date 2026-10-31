// Builds the static 3D city from the simulation's city and the procedural scenery:
// terrain, water, streets with markings, bridges, every building and the landmark models.
import * as THREE from 'three';
import { WORLD_H, WORLD_W, type City } from '../../sim/city';
import type { Vec } from '../../sim/types';
import { centroid, lerp, quadPt, subQuad, type Lot, type Model, type Scenery } from '../scenery';
import { Geo, SURF, WIN, lin, mul, type C3 } from './geo';

/** road geometry, in world units (4 m each) */
export const ROAD = {
  local: { asphalt: 3.2, walk: 5.8 },
  arterial: { asphalt: 5.8, walk: 8.8 },
  highway: { asphalt: 9.2, walk: 11.6 },
  bridge: { asphalt: 5.6, walk: 7.4 },
} as const;
export const DECK = 0.55;

const hsh = (n: number) => { let x = n | 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
const pick = <T,>(arr: T[], r: number): T => arr[Math.floor(r * arr.length) % arr.length];

const C = {
  land: lin('#cfc8b6'), beach: lin('#e4d3a2'), quay: lin('#9a948a'), quayTop: lin('#b9b2a6'),
  walk: lin('#c9c4b9'), local: lin('#50555c'), arterial: lin('#474b52'), highway: lin('#3f4349'), bridge: lin('#5a5e64'),
  white: lin('#ecebe6', 1.1), yellow: lin('#e2b23c', 1.1), grass: lin('#7db05c'), forest: lin('#5f9a48'), plaza: lin('#d9d1c2'),
  apron: lin('#a9adb3'), parking: lin('#5d6269'), path: lin('#d6c6a0'), ballast: lin('#9a9387'), rail: lin('#56534e'),
  runway: lin('#4f5359'), pier: lin('#8f7a5e'), pool: lin('#3fb4e2'),
};
const ROOFS = ['#8f969d', '#a4a8ac', '#7b8187', '#b2aea6', '#6c7379', '#9b958b', '#8a8f86', '#c2c0ba'];
const WALLS = {
  office: ['#d1cabd', '#bbb6ac', '#d9d3c7', '#aeb0ae', '#c6b6a2', '#a3aab2', '#c9c1b2'],
  house: ['#ebe3d2', '#dbcdb7', '#cbbca4', '#f0e8d8', '#bca992', '#d8c5a8', '#b8735a', '#a8634c'],
  terrace: ['#a65f48', '#b8735a', '#94503e', '#c08a6c', '#d9cdb5', '#8f5a4a'],
  tower: ['#8aa0b6', '#7f96ad', '#93a8bc', '#8299ae', '#a0b1c2'],
  campus: ['#b5826a', '#a8775f', '#c08f74'],
};

export interface CityMeshes { ground: THREE.BufferGeometry; water: THREE.BufferGeometry; buildings: THREE.BufferGeometry; districtIndex: Record<string, number> }

export function buildCity(city: City, sc: Scenery, skipLot: (l: Lot) => boolean): CityMeshes {
  const districtIndex: Record<string, number> = {};
  city.districts.forEach((d, i) => { districtIndex[d.id] = i + 1; });
  const ground = new Geo(), water = new Geo(), bld = new Geo();
  const dIdx = (x: number, y: number) => districtIndex[city.nodes[city.nearestNode(x, y)].district] ?? 0;

  // ── terrain ──
  for (const d of city.districts) { ground.ext = [0, districtIndex[d.id], SURF.grass, 0]; ground.flat(d.poly, 0, C.land); }
  // the bay: beach, then open water out to the horizon
  ground.ext = [0, 0, SURF.paving, 0];
  const coast = city.coast;
  for (let k = 0; k < coast.length - 1; k++) ground.ribbon(coast[k].x, coast[k].y, coast[k + 1].x, coast[k + 1].y, 14, 0.03, C.beach);
  water.ext = [0, 0, SURF.water, 0];
  const seaCol = lin('#2a78a8');
  const ext = [{ x: -3000, y: coast[0].y }, ...coast, { x: WORLD_W + 3000, y: coast[coast.length - 1].y }];
  for (let k = 0; k < ext.length - 1; k++) {
    const a = ext[k], b = ext[k + 1];
    water.quad([a.x, -0.05, a.y + 3], [b.x, -0.05, b.y + 3], [b.x, -0.05, WORLD_H + 3000], [a.x, -0.05, WORLD_H + 3000], seaCol, [0, 1, 0]);
  }
  // open water and coastline beyond the map edges, so the camera never sees the void
  water.quad([-3000, -0.08, -3000], [WORLD_W + 3000, -0.08, -3000], [WORLD_W + 3000, -0.08, -60], [-3000, -0.08, -60], lin('#5d8a5a'), [0, 1, 0]);
  water.quad([-3000, -0.08, -60], [-40, -0.08, -60], [-40, -0.08, coast[0].y], [-3000, -0.08, coast[0].y], lin('#5d8a5a'), [0, 1, 0]);
  water.quad([WORLD_W + 40, -0.08, -60], [WORLD_W + 3000, -0.08, -60], [WORLD_W + 3000, -0.08, coast[coast.length - 1].y], [WORLD_W + 40, -0.08, coast[coast.length - 1].y], lin('#5d8a5a'), [0, 1, 0]);
  // the river runs between stone quays
  const rl = [{ x: -80, y: city.riverline[0].y }, ...city.riverline, { x: WORLD_W + 80, y: city.riverline[city.riverline.length - 1].y }];
  const riverCol = lin('#2f80ae');
  for (let k = 0; k < rl.length - 1; k++) {
    const a = rl[k], b = rl[k + 1];
    water.ribbon(a.x, a.y, b.x, b.y, 30, 0.04, riverCol);
    // round joints between segments
    if (k > 0) { const pts: Vec[] = []; for (let s = 0; s < 10; s++) pts.push({ x: a.x + Math.cos(s / 10 * Math.PI * 2) * 15, y: a.y + Math.sin(s / 10 * Math.PI * 2) * 15 }); water.flat(pts, 0.04, riverCol); }
    for (const side of [-1, 1]) {
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L * side, ny = dx / L * side;
      const o = 15.2;
      bld.ext = [0, dIdx(a.x, a.y), SURF.paving, 0];
      const p0 = { x: a.x + nx * o, y: a.y + ny * o }, p1 = { x: b.x + nx * o, y: b.y + ny * o };
      bld.quad([p0.x, 0.04, p0.y], [p1.x, 0.04, p1.y], [p1.x, 0.42, p1.y], [p0.x, 0.42, p0.y], [mul(C.quay, 0.7), mul(C.quay, 0.7), C.quay, C.quay], [-nx, 0, -ny]);
      bld.ribbon(p0.x + nx * 0.6, p0.y + ny * 0.6, p1.x + nx * 0.6, p1.y + ny * 0.6, 1.2, 0.42, C.quayTop);
    }
  }

  // ── block grounds and open spaces ──
  for (const g of sc.ground) {
    const c = centroid(g.pts);
    const green = /^#c[0-9a-f]e|^#cfe|^#c8d/.test(g.color);
    ground.ext = [0, dIdx(c.x, c.y), green ? SURF.grass : SURF.paving, 0];
    ground.flat(g.pts, 0.02, green ? lin('#a8c486') : lin(g.color, 0.92));
  }
  for (const f of sc.features) {
    const c = centroid(f.pts);
    const di = dIdx(c.x, c.y);
    switch (f.kind) {
      case 'grass': ground.ext = [0, di, SURF.grass, 0]; ground.flat(f.pts, 0.03, f.color && f.color.startsWith('#8f') ? C.forest : C.grass); break;
      case 'plaza': {
        ground.ext = [0, di, SURF.paving, 0]; ground.flat(f.pts, 0.03, C.plaza);
        bld.ext = [0, di, SURF.paving, 0]; bld.cyl(c.x, c.y, 5.6, 5.6, 0.03, 0.5, 18, lin('#c8c0b2'));
        water.ext = [0.15, 0, SURF.water, 0]; water.cyl(c.x, c.y, 5, 5, 0.3, 0.42, 18, lin('#3c9fd0'));
        bld.cyl(c.x, c.y, 0.5, 0.35, 0.4, 1.8, 8, lin('#d8d2c6'));
        break;
      }
      case 'apron': ground.ext = [0, di, SURF.asphalt, 0]; ground.flat(f.pts, 0.03, C.apron); break;
      case 'yard': ground.ext = [0, di, SURF.paving, 0]; ground.ribbon(f.pts[0].x, f.pts[0].y, f.pts[1].x, f.pts[1].y, 1.4, 0.035, C.path); break;
      case 'parking': {
        ground.ext = [0, di, SURF.asphalt, 0]; ground.flat(f.pts, 0.03, C.parking);
        ground.ext = [0, di, SURF.none, 0];
        for (let row = 0; row < 3; row++) for (let k = 0; k <= 8; k++) { const a = quadPt(f.pts, 0.06 + k * 0.11, 0.08 + row * 0.32), b = quadPt(f.pts, 0.06 + k * 0.11, 0.08 + row * 0.32 + 0.2); ground.ribbon(a.x, a.y, b.x, b.y, 0.12, 0.04, C.white); }
        break;
      }
      case 'pool': water.ext = [0.2, 0, SURF.water, 0]; water.flat(f.pts, 0.06, C.pool); bld.ext = [0, di, SURF.paving, 0]; bld.prism(subQuad(f.pts, -0.12, -0.25, 1.12, 1.25), 0.02, 0.07, lin('#e6e2da'), null); break;
      case 'pier': bld.ext = [0, 0, SURF.paving, 0]; bld.prism(f.pts, -0.4, 0.35, C.pier, lin('#a48c6a')); for (let k = 0; k < 6; k++) { const p = quadPt(f.pts, k % 2 ? 0.08 : 0.92, 0.1 + Math.floor(k / 2) * 0.4); bld.cyl(p.x, p.y, 0.25, 0.25, 0.35, 0.8, 6, lin('#6b5a44')); } break;
      case 'rail': {
        ground.ext = [0, di, SURF.gravel, 0]; ground.flat(f.pts, 0.03, C.ballast);
        const n = f.extra ?? 5;
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n, a = lerp(f.pts[0], f.pts[3], t), b = lerp(f.pts[1], f.pts[2], t);
          ground.ext = [0, di, SURF.none, 0];
          ground.ribbon(a.x, a.y, b.x, b.y, 1.3, 0.045, lin('#7d7466'));
          bld.ext = [0, di, SURF.none, 0];
          for (const s of [-0.38, 0.38]) bld.ribbon(a.x, a.y, b.x, b.y, 0.09, 0.12, C.rail, 0, 0, s);
        }
        break;
      }
      case 'runway': {
        ground.ext = [0, di, SURF.asphalt, 0]; ground.flat(f.pts, 0.06, C.runway);
        const a = lerp(f.pts[0], f.pts[3], 0.5), b = lerp(f.pts[1], f.pts[2], 0.5);
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        ground.ext = [0, di, SURF.none, 0];
        for (let d = 8; d < L - 8; d += 9) { const p = lerp(a, b, d / L), q = lerp(a, b, (d + 4.5) / L); ground.ribbon(p.x, p.y, q.x, q.y, 0.45, 0.08, C.white); }
        for (const t of [0.04, 0.96]) for (let k = -3; k <= 3; k++) { const p = lerp(lerp(f.pts[0], f.pts[1], t), lerp(f.pts[3], f.pts[2], t), 0.5 + k * 0.1); const q = { x: p.x + (b.x - a.x) / L * 4 * (t < 0.5 ? 1 : -1), y: p.y + (b.y - a.y) / L * 4 * (t < 0.5 ? 1 : -1) }; ground.ribbon(p.x, p.y, q.x, q.y, 0.7, 0.08, C.white); }
        // edge lights glow at night
        bld.ext = [1, di, SURF.none, 0];
        for (let d = 4; d < L; d += 8) for (const t of [0.04, 0.96]) { const p = lerp(lerp(f.pts[0], f.pts[3], t), lerp(f.pts[1], f.pts[2], t), d / L); bld.box(p.x, p.y, 0.3, 0.3, 0.06, 0.25, 0, lin('#ffd38a')); }
        break;
      }
      default: break;
    }
  }

  // ── streets ──
  const radius = new Array(city.nodes.length).fill(0), walkR = new Array(city.nodes.length).fill(0);
  for (const e of city.edges) {
    const w = ROAD[e.cls as keyof typeof ROAD] ?? ROAD.local;
    for (const n of [e.a, e.b]) { radius[n] = Math.max(radius[n], w.asphalt / 2); walkR[n] = Math.max(walkR[n], w.walk / 2); }
  }
  const disc = (g: Geo, x: number, z: number, r: number, y: number, col: C3) => { const pts: Vec[] = []; for (let s = 0; s < 12; s++) pts.push({ x: x + Math.cos(s / 12 * Math.PI * 2) * r, y: z + Math.sin(s / 12 * Math.PI * 2) * r }); g.flat(pts, y, col); };
  const isBridge = (n: number) => city.adj[n].some((eid) => city.edges[eid].cls === 'bridge');
  for (const e of city.edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const w = ROAD[e.cls as keyof typeof ROAD] ?? ROAD.local;
    const di = districtIndex[a.district] ?? 0;
    if (e.cls === 'bridge') {
      // a raised deck with railings and ramps at both ends
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      bld.ext = [0, di, SURF.asphalt, 0];
      const ramp = 5;
      const P = (t: number, o: number, y: number): [number, number, number] => [a.x + ux * t + nx * o, y, a.y + uy * t + ny * o];
      const hw = w.walk / 2, ha = w.asphalt / 2;
      bld.quad(P(0, -ha, 0.08), P(ramp, -ha, DECK), P(ramp, ha, DECK), P(0, ha, 0.08), C.bridge, [0, 1, 0]);
      bld.quad(P(ramp, -ha, DECK), P(L - ramp, -ha, DECK), P(L - ramp, ha, DECK), P(ramp, ha, DECK), C.bridge, [0, 1, 0]);
      bld.quad(P(L - ramp, -ha, DECK), P(L, -ha, 0.08), P(L, ha, 0.08), P(L - ramp, ha, DECK), C.bridge, [0, 1, 0]);
      bld.ext = [0, di, SURF.paving, 0];
      for (const s of [-1, 1]) {
        bld.quad(P(ramp, s * ha, DECK), P(L - ramp, s * ha, DECK), P(L - ramp, s * hw, DECK + 0.05), P(ramp, s * hw, DECK + 0.05), C.walk, [0, 1, 0]);
        bld.quad(P(ramp, s * hw, -0.3), P(L - ramp, s * hw, -0.3), P(L - ramp, s * hw, DECK + 0.05), P(ramp, s * hw, DECK + 0.05), lin('#8d877c'), [nx * s, 0, ny * s]);
        bld.quad(P(ramp, s * hw, DECK + 0.05), P(L - ramp, s * hw, DECK + 0.05), P(L - ramp, s * hw, DECK + 0.45), P(ramp, s * hw, DECK + 0.45), lin('#b7b2a8'), [nx * s, 0, ny * s]);
      }
      // piers in the water
      for (let t = ramp + 6; t < L - ramp - 3; t += 10) { const p = P(t, 0, 0); bld.box(p[0], p[2], 2.2, w.walk * 0.7, -0.3, DECK, Math.atan2(uy, ux), lin('#8d877c')); }
      bld.ext = [0, di, SURF.none, 0];
      for (let t = ramp + 1; t < L - ramp - 1.5; t += 4) { const p = P(t, 0, 0), q = P(t + 1.6, 0, 0); bld.ribbon(p[0], p[2], q[0], q[2], 0.12, DECK + 0.01, C.white); }
      continue;
    }
    ground.ext = [0, di, SURF.paving, 0];
    ground.ribbon(a.x, a.y, b.x, b.y, w.walk, 0.05, C.walk);
    ground.ext = [0, di, SURF.asphalt, 0];
    const asphalt = e.cls === 'highway' ? C.highway : e.cls === 'arterial' ? C.arterial : C.local;
    ground.ribbon(a.x, a.y, b.x, b.y, w.asphalt, 0.07, asphalt);
    // markings, kept clear of the junctions
    ground.ext = [0, di, SURF.none, 0];
    const t0 = radius[e.a] + 2, t1 = radius[e.b] + 2;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const dashes = (off: number, dash: number, gap: number, wid: number, col: C3) => {
      for (let d = t0; d < L - t1 - dash * 0.5; d += dash + gap) ground.ribbon(a.x, a.y, b.x, b.y, wid, 0.09, col, d, Math.max(0, L - d - dash), off);
    };
    if (e.cls === 'local') dashes(0, 1.4, 1.8, 0.11, C.white);
    else if (e.cls === 'arterial') {
      ground.ribbon(a.x, a.y, b.x, b.y, 0.1, 0.09, C.yellow, t0, t1, 0.14); ground.ribbon(a.x, a.y, b.x, b.y, 0.1, 0.09, C.yellow, t0, t1, -0.14);
      dashes(1.45, 1.6, 2.4, 0.1, C.white); dashes(-1.45, 1.6, 2.4, 0.1, C.white);
    } else if (e.cls === 'highway') {
      ground.ribbon(a.x, a.y, b.x, b.y, 0.12, 0.09, C.yellow, t0, t1, 0.16); ground.ribbon(a.x, a.y, b.x, b.y, 0.12, 0.09, C.yellow, t0, t1, -0.16);
      for (const o of [1.6, 3.0, -1.6, -3.0]) dashes(o, 2.2, 3.2, 0.11, C.white);
      for (const o of [4.25, -4.25]) ground.ribbon(a.x, a.y, b.x, b.y, 0.12, 0.09, C.white, t0, t1, o);
    }
  }
  for (const n of city.nodes) {
    if (!radius[n.id] || isBridge(n.id) && city.adj[n.id].length < 2) continue;
    const di = districtIndex[n.district] ?? 0;
    ground.ext = [0, di, SURF.paving, 0]; disc(ground, n.x, n.y, walkR[n.id], 0.055, C.walk);
    ground.ext = [0, di, SURF.asphalt, 0];
    const big = city.adj[n.id].some((eid) => city.edges[eid].cls !== 'local');
    disc(ground, n.x, n.y, radius[n.id] + (big ? 0.6 : 0.2), 0.075, big ? C.arterial : C.local);
    // zebra crossings where a busy road meets the junction
    if (city.adj[n.id].length >= 3 && big) {
      ground.ext = [0, di, SURF.none, 0];
      for (const eid of city.adj[n.id]) {
        const e = city.edges[eid];
        if (e.cls === 'highway' || e.cls === 'bridge') continue;
        const o = city.nodes[e.a === n.id ? e.b : e.a];
        const dx = o.x - n.x, dy = o.y - n.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
        const half = (ROAD[e.cls as keyof typeof ROAD] ?? ROAD.local).asphalt / 2 - 0.3;
        const cx = n.x + ux * (radius[n.id] + 1.4), cy = n.y + uy * (radius[n.id] + 1.4);
        for (let k = -half; k <= half; k += 0.62) { const px = cx - uy * k, py = cy + ux * k; ground.ribbon(px - ux * 0.75, py - uy * 0.75, px + ux * 0.75, py + uy * 0.75, 0.32, 0.095, C.white); }
      }
    }
  }

  // ── buildings ──
  for (const l of sc.lots) { if (!skipLot(l)) building(bld, l, districtIndex[l.district] ?? 0); }
  // ── landmarks and set dressing ──
  for (const m of sc.models) landmark(bld, water, m, dIdx(m.x, m.y));

  return { ground: ground.build(), water: water.build(), buildings: bld.build(), districtIndex };
}

function building(g: Geo, l0: Lot, di: number) {
  let l = l0;
  const r = (k: number) => hsh(l.seed * 31 + k);
  const seed = (l.seed % 997) / 997;
  const p = l.pts;
  const roof = lin(l.roof);
  switch (l.style) {
    case 'tank': {
      g.ext = [0, di, SURF.none, l.h];
      g.cyl(l.cx, l.cy, l.r, l.r, 0, l.h, 16, lin('#c9cdd1'), lin('#d7dade'));
      g.cyl(l.cx, l.cy, l.r * 0.5, 0.01, l.h, l.h + 0.6, 12, lin('#bfc4c9'));
      return;
    }
    case 'house': case 'terrace': {
      const wall = lin(pick(l.style === 'house' ? WALLS.house : WALLS.terrace, r(1)));
      const h = l.style === 'house' ? Math.min(l.h, 2.6) : Math.min(l.h, 3.4);
      g.ext = [0, di, SURF.none, h];
      g.prism(p, 0, h, wall, null, { style: WIN.house, seed });
      const short = Math.min(Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y), Math.hypot(p[3].x - p[0].x, p[3].y - p[0].y));
      g.gable(p, h, Math.min(2.2, short * 0.32), roof, wall);
      if (r(2) < 0.55) { const c = quadPt(p, 0.3 + r(3) * 0.4, 0.35); g.ext = [0, di, SURF.none, 0]; g.box(c.x, c.y, 0.5, 0.5, h, h + Math.min(2.2, short * 0.32) + 0.6, 0, lin('#8a6a5a')); }
      return;
    }
    case 'warehouse': case 'hangar': {
      const wall = lin(l.style === 'hangar' ? '#b3bac2' : pick(['#a9afb6', '#b8b2a6', '#9fa7ae', '#c2bcb0'], r(1)));
      g.ext = [0, di, SURF.none, l.h];
      g.prism(p, 0, l.h, wall, null, { style: WIN.shed, seed });
      g.ext = [0, di, SURF.tiles, l.h];
      if (l.style === 'hangar') g.gable(p, l.h, 1.6, lin('#9aa3ab'), wall);
      else { g.flat(p, l.h, roof); g.ext = [0, di, SURF.none, 0]; for (let k = 0; k < 3; k++) { const a = quadPt(p, 0.2 + k * 0.3, 0.15), b = quadPt(p, 0.2 + k * 0.3, 0.85); g.ribbon(a.x, a.y, b.x, b.y, 0.8, l.h + 0.02, lin('#bcd3e2', 0.9)); } }
      return;
    }
    case 'campus': {
      const wall = lin(pick(WALLS.campus, r(1)));
      g.ext = [0, di, SURF.none, l.h];
      g.prism(p, 0, l.h, wall, lin('#9a8f80'), { style: WIN.office, seed });
      g.ext = [0, di, SURF.grass, 0]; g.flat(subQuad(p, 0.12, 0.12, 0.88, 0.88), l.h + 0.04, lin('#7aa860'));
      return;
    }
    case 'tower': {
      const wall = lin(pick(WALLS.tower, r(1)));
      l = { ...l, h: l.h * 1.4 };
      const tiered = l.h > 16;
      const h1 = tiered ? l.h * 0.62 : l.h;
      g.ext = [0, di, SURF.none, l.h];
      g.prism(p, 0, h1, wall, null, { style: WIN.curtain, seed });
      g.ext = [0, di, SURF.gravel, 0]; g.flat(p, h1, lin(pick(ROOFS, r(7))));
      let top = p, th = h1;
      if (tiered) {
        top = subQuad(p, 0.16, 0.16, 0.84, 0.84);
        g.ext = [0, di, SURF.none, l.h];
        g.prism(top, h1, l.h, mul(wall, 1.04), null, { style: WIN.curtain, seed: (seed + 0.37) % 1 });
        g.ext = [0, di, SURF.gravel, 0]; g.flat(top, l.h, lin('#8e959c'));
        th = l.h;
      }
      parapet(g, top, th, mul(wall, 0.9), di);
      const c = centroid(top);
      g.ext = [0, di, SURF.none, 0];
      if (l.h > 18 && r(4) < 0.4) { g.cyl(c.x, c.y, 2.6, 2.6, th, th + 0.12, 16, lin('#30373f')); g.cyl(c.x, c.y, 2.0, 2.0, th + 0.12, th + 0.14, 16, lin('#e8e8e0')); }
      else { g.box(c.x, c.y, 3.2, 2.6, th, th + 1.6, 0, lin('#a3aab2'), lin('#b6bcc3')); g.cyl(c.x + 1, c.y, 0.1, 0.05, th + 1.6, th + 5, 4, lin('#c9ced4')); g.ext = [1.2, di, SURF.none, 0]; g.box(c.x + 1, c.y, 0.25, 0.25, th + 5, th + 5.3, 0, lin('#ff3a3a')); }
      return;
    }
    default: {
      const wall = lin(pick(WALLS.office, r(1)));
      l = { ...l, h: l.h * 1.3 };
      g.ext = [0, di, SURF.none, l.h];
      g.prism(p, 0, l.h, wall, null, { style: WIN.office, seed });
      g.ext = [0, di, SURF.gravel, 0]; g.flat(p, l.h, lin(pick(ROOFS, r(7))));
      // rooftop solar arrays on some
      if (r(8) < 0.3) { g.ext = [0, di, SURF.none, 0]; for (let k = 0; k < 3; k++) { const a = quadPt(p, 0.18, 0.2 + k * 0.22), b = quadPt(p, 0.82, 0.2 + k * 0.22); g.ribbon(a.x, a.y, b.x, b.y, 1.1, l.h + 0.3, lin('#1f2f4a')); } }
      else if (r(8) < 0.42) { g.ext = [0, di, SURF.grass, 0]; g.flat(subQuad(p, 0.14, 0.14, 0.86, 0.86), l.h + 0.05, lin('#6f9e55')); }
      parapet(g, p, l.h, mul(wall, 0.92), di);
      g.ext = [0, di, SURF.none, 0];
      const n = 1 + Math.floor(r(5) * 3);
      for (let k = 0; k < n; k++) { const c = quadPt(p, 0.25 + r(10 + k) * 0.5, 0.25 + r(20 + k) * 0.5); g.box(c.x, c.y, 1.2, 0.9, l.h, l.h + 0.6, 0, lin('#a7adb3'), lin('#c1c6cb')); }
      if (l.h > 7 && r(6) < 0.3) { const c = quadPt(p, 0.7, 0.3); g.cyl(c.x, c.y, 0.7, 0.7, l.h + 0.3, l.h + 2, 10, lin('#7c6a58')); g.cyl(c.x, c.y, 0.75, 0.01, l.h + 2, l.h + 2.6, 10, lin('#6a5a4a')); for (const [du, dv] of [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]]) g.box(c.x + du, c.y + dv, 0.1, 0.1, l.h, l.h + 0.3, 0, lin('#55504a')); }
    }
  }
}

function parapet(g: Geo, p: Vec[], h: number, col: ReturnType<typeof lin>, di: number) {
  g.ext = [0, di, SURF.none, 0];
  const n = p.length, cx = p.reduce((s, q) => s + q.x, 0) / n, cz = p.reduce((s, q) => s + q.y, 0) / n;
  for (let k = 0; k < n; k++) {
    const a = p[k], b = p[(k + 1) % n];
    const ia = { x: a.x + (cx - a.x) * 0.06, y: a.y + (cz - a.y) * 0.06 }, ib = { x: b.x + (cx - b.x) * 0.06, y: b.y + (cz - b.y) * 0.06 };
    g.quad([a.x, h + 0.35, a.y], [b.x, h + 0.35, b.y], [ib.x, h + 0.35, ib.y], [ia.x, h + 0.35, ia.y], mul(col, 1.08), [0, 1, 0]);
    g.quad([a.x, h, a.y], [b.x, h, b.y], [b.x, h + 0.35, b.y], [a.x, h + 0.35, a.y], col, [(a.x + b.x) / 2 - cx, 0, (a.y + b.y) / 2 - cz]);
    g.quad([ia.x, h, ia.y], [ib.x, h, ib.y], [ib.x, h + 0.35, ib.y], [ia.x, h + 0.35, ia.y], mul(col, 0.8), [cx - (a.x + b.x) / 2, 0, cz - (a.y + b.y) / 2]);
  }
}

/** a local frame on a landmark's block: u across, v down, in world units from the centre */
function frame(m: Model) {
  if (m.pts) {
    const p = m.pts, o = centroid(p);
    const w = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y), d = Math.hypot(p[3].x - p[0].x, p[3].y - p[0].y);
    const rot = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    const c = Math.cos(rot), s = Math.sin(rot);
    return { o, w, d, rot, at: (u: number, v: number) => ({ x: o.x + u * c - v * s, y: o.y + u * s + v * c }) };
  }
  const c = Math.cos(m.rot), s = Math.sin(m.rot);
  return { o: { x: m.x, y: m.y }, w: 30, d: 30, rot: m.rot, at: (u: number, v: number) => ({ x: m.x + u * c - v * s, y: m.y + u * s + v * c }) };
}

function landmark(g: Geo, water: Geo, m: Model, di: number) {
  const F = frame(m);
  const B = (u: number, v: number, w: number, d: number, y0: number, y1: number, wall: string, top: string, style = 0, rot = 0) => { const c = F.at(u, v); g.box(c.x, c.y, w, d, y0, y1, F.rot + rot, lin(wall), lin(top), style ? { style, seed: (m.seed % 991) / 991 } : undefined); };
  const Cy = (u: number, v: number, r0: number, r1: number, y0: number, y1: number, col: string, seg = 14, top?: string) => { const c = F.at(u, v); g.cyl(c.x, c.y, r0, r1, y0, y1, seg, lin(col), top ? lin(top) : lin(col)); };
  const glow = (on: number) => { g.ext = [on, di, SURF.none, 0]; };
  g.ext = [0, di, SURF.none, 12];
  switch (m.kind) {
    case 'hospital': {
      B(0, 0, 34, 12, 0, 9, '#e6ebf0', '#cfd6dd', WIN.office);
      B(0, 0, 12, 32, 0, 12, '#eef2f6', '#d8dee5', WIN.office);
      g.ext = [0, di, SURF.none, 0];
      B(0, -2, 2.2, 8, 12, 12.08, '#d63a3a', '#d63a3a'); B(0, -2, 8, 2.2, 12, 12.08, '#d63a3a', '#d63a3a');
      Cy(12, 0, 4, 4, 9, 9.1, '#2d343c'); Cy(12, 0, 3.3, 3.3, 9.1, 9.12, '#f0f0e8'); Cy(12, 0, 2.9, 2.9, 9.12, 9.14, '#2d343c');
      B(12, 0, 0.5, 2.6, 9.14, 9.16, '#f0f0e8', '#f0f0e8'); B(12.9, 0, 0.5, 2.6, 9.14, 9.16, '#f0f0e8', '#f0f0e8'); B(12.45, 0, 1.3, 0.45, 9.14, 9.16, '#f0f0e8', '#f0f0e8');
      // emergency entrance canopy
      B(0, 17.5, 10, 4, 3, 3.4, '#c43b3b', '#d84a4a'); for (const u of [-4.5, 4.5]) B(u, 19, 0.4, 0.4, 0, 3, '#d8dde2', '#d8dde2');
      glow(1); B(0, 16.2, 6, 0.3, 3.5, 4.3, '#ff4a4a', '#ff4a4a');
      break;
    }
    case 'cathedral': {
      B(0, 2, 32, 10, 0, 8, '#b8a48e', '#7d665b', WIN.stone);
      g.gable(boxPts(F, 0, 2, 32, 10), 8, 4, lin('#6f5b52'), lin('#b8a48e'));
      B(4, 2, 9, 22, 0, 8, '#b8a48e', '#7d665b', WIN.stone);
      g.gable(boxPts(F, 4, 2, 9, 22), 8, 3, lin('#6f5b52'), lin('#b8a48e'));
      B(-13, 2, 7, 7, 0, 22, '#b3a08a', '#8c7468', WIN.stone);
      Cy(-13, 2, 3.6, 0.01, 22, 32, '#5f5048', 4);
      glow(0.8); B(-13, -1.6, 2, 0.2, 14, 16, '#ffd88a', '#ffd88a');
      break;
    }
    case 'clocktower': {
      B(0, 0, 9, 9, 0, 26, '#b39478', '#9a7a62', WIN.stone);
      g.ext = [0, di, SURF.none, 0];
      Cy(0, 0, 6.4, 0.01, 26, 33, '#4a3a30', 4);
      glow(0.6); B(0, 4.6, 4, 0.3, 19, 23, '#efe4c8', '#efe4c8');
      g.ext = [0, di, SURF.none, 0]; B(0, 4.8, 0.3, 0.1, 21, 22.6, '#2a2018', '#2a2018');
      break;
    }
    case 'cityhall': {
      B(0, 0, 34, 20, 0, 9, '#e6dfcf', '#cfc6b4', WIN.stone);
      B(0, 0, 14, 14, 9, 13, '#ece6d8', '#d6cebd');
      Cy(0, 0, 7, 7, 13, 14, '#ece6d8'); for (let k = 0; k < 6; k++) Cy(0, 0, 6.6 * Math.cos(k / 6 * Math.PI / 2), 6.6 * Math.cos((k + 1) / 6 * Math.PI / 2) + 0.01, 14 + 6.6 * Math.sin(k / 6 * Math.PI / 2), 14 + 6.6 * Math.sin((k + 1) / 6 * Math.PI / 2), '#8fb3a8', 16);
      for (let k = 0; k < 8; k++) Cy(-10.5 + k * 3, 10.8, 0.6, 0.6, 0, 7, '#f2ede2', 8);
      B(0, 11.2, 26, 3, 7, 8.4, '#e6dfcf', '#d6cebd');
      Cy(0, 0, 0.1, 0.1, 20.6, 24, '#d0d4d8', 4); glow(0); B(0.9, 0, 1.8, 0.1, 23, 24, '#3a6fd0', '#3a6fd0');
      break;
    }
    case 'terminal': {
      B(0, 0, 36, 14, 0, 6, '#c9d6e2', '#d7dee5', WIN.curtain);
      B(0, 0, 38, 16, 6, 7, '#e3e7eb', '#eef1f4');
      for (const u of [-14, 0, 14]) B(u, 12, 3, 10, 2, 4, '#c3ccd5', '#d0d7de', WIN.curtain);
      break;
    }
    case 'ctower': { Cy(0, 0, 2.2, 1.8, 0, 22, '#d7dbe0', 12); Cy(0, 0, 3.6, 3.6, 22, 25, '#4f6d88', 12, '#4f6d88'); Cy(0, 0, 4, 4, 25, 25.6, '#e1e5ea', 12); glow(1.2); Cy(0, 0, 0.3, 0.3, 25.6, 27, '#ff3a3a', 6); break; }
    case 'plane': {
      const s = m.s;
      B(0, 0, 18 * s, 2.4 * s, 1.2, 3.4 * s, '#f2f4f6', '#ffffff');
      B(-1, 0, 4.5 * s, 22 * s, 1.8, 2.2, '#e4e8ec', '#eef1f4');
      B(-8 * s, 0, 2.5 * s, 8 * s, 2.6, 2.9, '#e4e8ec', '#eef1f4');
      B(-8.2 * s, 0, 3 * s, 0.4, 3, 6.4 * s, '#2f5f9e', '#2f5f9e');
      for (const v of [-4.5, 4.5]) Cy(0.5, v * s, 0.7 * s, 0.7 * s, 0.9, 2.1, '#c9ced4', 10);
      break;
    }
    case 'crane': {
      for (const [u, v] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) B(u, v, 0.8, 0.8, 0, 16, '#d8a830', '#d8a830');
      B(0, 0, 7.2, 7.2, 14, 16, '#d8a830', '#e2b43c');
      B(0, -9, 3, 26, 16, 17.6, '#d8a830', '#e2b43c');
      B(0, 2, 3.4, 4, 17.6, 20, '#c43b3b', '#d84a4a', WIN.office);
      glow(1.2); B(0, -21, 0.4, 0.4, 17.6, 18, '#ff3a3a', '#ff3a3a');
      break;
    }
    case 'ship': {
      const s = m.s;
      B(0, 0, 9 * s, 34 * s, -0.4, 2.6, '#2b3a4a', '#7d4a3a');
      B(0, 12 * s, 7 * s, 6 * s, 2.6, 7, '#eef1f4', '#dfe4e9', WIN.office);
      for (let k = 0; k < 4; k++) B(0, -10 * s + k * 5.2 * s, 7.6 * s, 4.6 * s, 2.6, 4.8, pick(['#c0563f', '#3f7fb0', '#4f9a5c', '#c4953a'], hsh(m.seed + k)), pick(['#c0563f', '#3f7fb0', '#4f9a5c', '#c4953a'], hsh(m.seed + k)));
      Cy(0, 13.5 * s, 0.9, 0.9, 7, 9.5, '#c43b3b', 10);
      break;
    }
    case 'train': {
      const n = Math.max(2, Math.floor(m.s / 13));
      for (let k = 0; k < n; k++) { const c = F.at(6.5 + k * 13, 0); g.box(c.x, c.y, 12, 3, 0.3, 3.4, m.rot, lin(k === 0 ? '#c43b3b' : '#4a5664'), lin(k === 0 ? '#d84a4a' : '#5b6876'), { style: WIN.office, seed: 0.3 }); }
      break;
    }
    case 'factory': {
      B(-2, 0, 28, 20, 0, 8, '#a9a39a', '#8c8f93', WIN.shed);
      g.gable(boxPts(F, -2, 0, 28, 20), 8, 2.4, lin('#7f868c'), lin('#a9a39a'));
      for (const u of [10, 14]) Cy(u, -6, 1.4, 1.1, 0, 22, '#9c8f84', 12);
      B(12, 7, 8, 6, 0, 5, '#b5ada0', '#999da1', WIN.office);
      break;
    }
    case 'lighthouse': {
      for (let k = 0; k < 6; k++) Cy(0, 0, 2.6 - k * 0.22, 2.6 - (k + 1) * 0.22, k * 3.4, (k + 1) * 3.4, k % 2 ? '#c43b3b' : '#f2f2ee', 14);
      glow(2); Cy(0, 0, 1.2, 1.2, 20.4, 22, '#fff2b0', 10);
      g.ext = [0, di, SURF.none, 0]; Cy(0, 0, 1.6, 0.01, 22, 23.6, '#2d343c', 10);
      break;
    }
    case 'gas': {
      B(0, 4, 18, 10, 3.6, 4.2, '#e8ecef', '#d63a3a');
      for (const [u, v] of [[-7, 0], [7, 0], [-7, 8], [7, 8]]) B(u, v, 0.5, 0.5, 0, 3.6, '#d8dde2', '#d8dde2');
      for (const u of [-4, 0, 4]) B(u, 4, 1, 2, 0, 1.4, '#3a6fd0', '#e8ecef');
      B(0, -9, 12, 6, 0, 3, '#e9e4d8', '#c9ccd0', WIN.office);
      glow(0.5); B(0, 4, 17.6, 9.6, 3.55, 3.6, '#fff6d8', '#fff6d8');
      break;
    }
    case 'bank': {
      B(0, 0, 26, 20, 0, 10, '#e2dccf', '#cbc4b6', WIN.stone);
      for (let k = 0; k < 6; k++) Cy(-10 + k * 4, 10.8, 0.7, 0.7, 0, 8.6, '#f2ede2', 8);
      B(0, 11, 24, 2.4, 8.6, 9.6, '#e2dccf', '#d6cfc2');
      g.gable(boxPts(F, 0, 11, 24, 2.4), 9.6, 2, lin('#d6cfc2'), lin('#e2dccf'));
      break;
    }
    case 'mall': {
      B(0, -2, 34, 26, 0, 7, '#d8d2c6', '#b5b9bd', WIN.office);
      B(0, 11.6, 12, 3, 0, 8.5, '#9fc0d8', '#cfd8e0', WIN.curtain);
      for (const u of [-10, 10]) { B(u, -2, 6, 6, 7, 7.8, '#bcd3e2', '#bcd3e2'); }
      glow(0.9); B(0, 13.2, 9, 0.2, 7, 8, '#ff6aa0', '#ff6aa0');
      break;
    }
    case 'school': {
      B(-6, -6, 22, 10, 0, 6, '#b5826a', '#9a8f80', WIN.office);
      B(8, 2, 8, 22, 0, 6, '#b5826a', '#9a8f80', WIN.office);
      g.ext = [0, di, SURF.grass, 0]; { const p = boxPts(F, -6, 8, 20, 12); g.flat(p, 0.04, lin('#6fb04e')); }
      break;
    }
    case 'station': {
      B(0, 0, 36, 14, 0, 6, '#c9b9a1', '#a9a094', WIN.stone);
      for (let k = 0; k < 6; k++) { const a = Math.PI * k / 6, b = Math.PI * (k + 1) / 6; const y0 = 6 + Math.sin(a) * 5, y1 = 6 + Math.sin(b) * 5; const v0 = -Math.cos(a) * 7, v1 = -Math.cos(b) * 7; const p0 = F.at(-18, v0), p1 = F.at(18, v0), p2 = F.at(18, v1), p3 = F.at(-18, v1); g.quad([p0.x, y0, p0.y], [p1.x, y0, p1.y], [p2.x, y1, p2.y], [p3.x, y1, p3.y], lin('#9fbfd4'), [0, 1, (v0 + v1) / 2 > 0 ? 1 : -1]); }
      B(0, 0, 3, 3, 6, 15, '#c9b9a1', '#8c7468', WIN.stone);
      glow(0.7); B(0, 1.6, 2, 0.2, 12, 14, '#efe4c8', '#efe4c8');
      break;
    }
    case 'supertall': {
      B(0, 0, 18, 18, 0, 34, '#7f99b4', '#8e959c', WIN.curtain);
      B(0, 0, 13, 13, 34, 52, '#8aa3bc', '#8e959c', WIN.curtain);
      B(0, 0, 8, 8, 52, 62, '#94acc4', '#8e959c', WIN.curtain);
      Cy(0, 0, 0.5, 0.05, 62, 76, '#d0d6dc', 6);
      glow(1.5); B(0, 0, 0.6, 0.6, 76, 76.6, '#ff3a3a', '#ff3a3a');
      break;
    }
    case 'stadium': {
      const pts = m.pts ?? [];
      if (pts.length) {
        const w = F.w / 2, d = F.d / 2;
        const ring = (r0: number, r1: number, y0: number, y1: number, col: string) => {
          for (let k = 0; k < 28; k++) {
            const a0 = k / 28 * Math.PI * 2, a1 = (k + 1) / 28 * Math.PI * 2;
            const P = (a: number, r: number) => F.at(Math.cos(a) * w * r, Math.sin(a) * d * r);
            const i0 = P(a0, r0), i1 = P(a1, r0), o0 = P(a0, r1), o1 = P(a1, r1);
            g.quad([i0.x, y0, i0.y], [i1.x, y0, i1.y], [o1.x, y1, o1.y], [o0.x, y1, o0.y], lin(col), [0, 1, 0]);
            g.quad([o0.x, 0, o0.y], [o1.x, 0, o1.y], [o1.x, y1, o1.y], [o0.x, y1, o0.y], lin('#bfc4ca'), [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]);
          }
        };
        g.ext = [0, di, SURF.grass, 0];
        const pitch: Vec[] = []; for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; pitch.push(F.at(Math.cos(a) * w * 0.66, Math.sin(a) * d * 0.6)); }
        g.flat(pitch, 0.06, lin('#4f9a43'));
        g.ext = [0, di, SURF.none, 0];
        ring(0.68, 1, 0.5, 6, '#9aa1a9');
        for (const [u, v] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]) { const c = F.at(u * w, v * d); g.cyl(c.x, c.y, 0.4, 0.4, 0, 14, 6, lin('#c9ced4')); glow(1.8); g.box(c.x, c.y, 3, 1, 14, 15, F.rot, lin('#fff6d8')); g.ext = [0, di, SURF.none, 0]; }
      }
      break;
    }
    case 'market': {
      for (let k = 0; k < 12; k++) { const u = -14 + (k % 4) * 9.3, v = -10 + Math.floor(k / 4) * 9.5; B(u, v, 6, 5, 0, 2.2, '#cfc6b4', '#cfc6b4'); const cols = ['#c3423a', '#2f6f9e', '#3a8a5a', '#d08a2c', '#6a4a8a', '#e0c040']; g.gable(boxPts(F, u, v, 6.6, 5.6), 2.2, 1.1, lin(pick(cols, hsh(m.seed + k))), lin('#e8e2d4')); }
      break;
    }
    case 'library': {
      B(0, 0, 28, 18, 0, 9, '#d9cfbd', '#b7ad9d', WIN.stone);
      for (let k = 0; k < 5; k++) Cy(-8 + k * 4, 9.8, 0.6, 0.6, 0, 7.6, '#efe9dc', 8);
      g.gable(boxPts(F, 0, 10, 20, 2.4), 7.6, 2.2, lin('#cfc5b4'), lin('#d9cfbd'));
      B(0, 0, 10, 8, 9, 13, '#d9cfbd', '#8fb3a8');
      break;
    }
    default: break;
  }
  void water;
}

function boxPts(F: ReturnType<typeof frame>, u: number, v: number, w: number, d: number): Vec[] {
  return [F.at(u - w / 2, v - d / 2), F.at(u + w / 2, v - d / 2), F.at(u + w / 2, v + d / 2), F.at(u - w / 2, v + d / 2)];
}
