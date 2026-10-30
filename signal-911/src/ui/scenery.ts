// Procedural city scenery for the map: lots and buildings with heights, yards, trees, parks,
// runways, container yards, rail tracks, a stadium, street lights and lit windows.
// Generated once from the (deterministic) city and rendered into cached canvases.
import { getCity, WORLD_H, WORLD_W, type City } from '../sim/city';
import { Rng, hashString } from '../sim/rng';
import type { Vec } from '../sim/types';

type Style = 'tower' | 'office' | 'house' | 'terrace' | 'warehouse' | 'campus' | 'hangar' | 'tank';
export interface Lot { pts: Vec[]; h: number; roof: string; edge: string; style: Style; cx: number; cy: number; r: number; district: string; seed: number }
export interface Tree { x: number; y: number; r: number; c: string }
interface Feature { kind: 'runway' | 'apron' | 'containers' | 'rail' | 'stadium' | 'yard' | 'grass' | 'plaza' | 'pier'; pts: Vec[]; color?: string; extra?: number }
export interface Scenery { lots: Lot[]; trees: Tree[]; features: Feature[]; lights: Vec[]; windows: Array<{ x: number; y: number; s: number }>; ground: Array<{ pts: Vec[]; color: string }> }

const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** point inside a quad [tl, tr, br, bl] from (u, v) in 0..1 */
const quadPt = (q: Vec[], u: number, v: number): Vec => lerp(lerp(q[0], q[1], u), lerp(q[3], q[2], u), v);
const subQuad = (q: Vec[], u0: number, v0: number, u1: number, v1: number): Vec[] => [quadPt(q, u0, v0), quadPt(q, u1, v0), quadPt(q, u1, v1), quadPt(q, u0, v1)];

const shadeMemo = new Map<string, string>();
function shade(hex: string, f: number): string {
  const key = hex + f;
  const hit = shadeMemo.get(key);
  if (hit) return hit;
  const out = shadeRaw(hex, f);
  shadeMemo.set(key, out);
  return out;
}
function shadeRaw(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const PALETTE: Record<string, string[]> = {
  commercial: ['#2f3a48', '#34404f', '#2b3542', '#3a4554', '#303c4c'],
  highrise: ['#2d3a4c', '#33435a', '#2a3648', '#3a4a62', '#283445'],
  residential: ['#3d3733', '#423a33', '#38332f', '#45403a', '#3a3530'],
  historic: ['#4a3530', '#523a32', '#45322d', '#4d3934', '#563d34'],
  industrial: ['#383d42', '#3e444a', '#33383d', '#41474d', '#363b40'],
  campus: ['#3b3a46', '#403f4c', '#363541', '#44434f'],
  suburb: ['#3f3934', '#463e37', '#3b3631', '#4a423a'],
};

let cached: Scenery | null = null;
export function getScenery(): Scenery {
  if (cached) return cached;
  cached = build(getCity());
  return cached;
}

function build(city: City): Scenery {
  const lots: Lot[] = [], trees: Tree[] = [], features: Feature[] = [], lights: Vec[] = [], windows: Scenery['windows'] = [], ground: Scenery['ground'] = [];
  const stadiumNode = city.landmarks.find((l) => l.kind === 'stadium')?.nodeId;
  const tree = (rng: Rng, x: number, y: number, r: number, forest = false) => trees.push({ x, y, r, c: rng.pick(forest ? ['#1d3a26', '#21422b', '#193322', '#244a2f'] : ['#22432c', '#264a31', '#1f3d29', '#2b5236']) });

  // blocks indexed by lattice coordinates (the block below/right of node i,j)
  for (const b of city.blocks) {
    const q = b.poly;
    const d = city.districtById[b.district];
    const tag = d.tags.includes('highrise') ? 'highrise' : d.tags[0];
    const cx = (q[0].x + q[2].x) / 2, cy = (q[0].y + q[2].y) / 2;
    const seed = hashString(`b${Math.round(cx)},${Math.round(cy)}`);
    const rng = new Rng(seed);
    const n0 = city.nearestNode(q[0].x, q[0].y);
    const ni = city.nodes[n0].i, nj = city.nodes[n0].j;

    // ── special districts ──
    if (d.id === 'airport' && (nj === 3 || nj === 6) && ni >= 31 && ni <= 38) {
      features.push({ kind: 'runway', pts: subQuad(q, -0.02, 0.22, 1.02, 0.78), extra: ni });
      continue;
    }
    if (d.id === 'airport' && (nj === 2 || nj === 4 || nj === 5 || nj === 7) && ni >= 30 && ni <= 39) {
      features.push({ kind: 'apron', pts: subQuad(q, 0, 0, 1, 1) });
      if (rng.chance(0.45)) lots.push(mkLot(subQuad(q, 0.15, 0.2, 0.85, 0.8), 5, '#3d4550', 'hangar', b.district, seed));
      continue;
    }
    if (d.id === 'harbor' && nj >= 21) {
      features.push({ kind: 'apron', pts: subQuad(q, 0, 0, 1, 1) });
      // container stacks
      const cols = 4, rows = 3;
      for (let a = 0; a < cols; a++) for (let c = 0; c < rows; c++) {
        if (rng.chance(0.15)) continue;
        const pts = subQuad(q, 0.08 + a * 0.22, 0.1 + c * 0.28, 0.08 + a * 0.22 + 0.19, 0.1 + c * 0.28 + 0.2);
        lots.push(mkLot(pts, 1.5 + rng.int(0, 2), rng.pick(['#7a3b33', '#2f5a7a', '#3f6b45', '#8a6a2e', '#5d4a7a', '#7a5133']), 'warehouse', b.district, seed + a * 7 + c));
      }
      continue;
    }
    if (d.id === 'southside' && nj === 20) {
      features.push({ kind: 'rail', pts: subQuad(q, -0.02, 0.1, 1.02, 0.9), extra: 6 });
      continue;
    }
    if (stadiumNode !== undefined && n0 === stadiumNode) {
      features.push({ kind: 'stadium', pts: subQuad(q, 0.04, 0.06, 0.96, 0.94) });
      continue;
    }

    // ── parks and plazas ──
    if (b.kind === 'park') {
      features.push({ kind: 'grass', pts: q, color: d.tags.includes('forest') ? '#16301d' : '#183322' });
      const forest = d.tags.includes('forest');
      const count = forest ? 34 : 14;
      for (let k = 0; k < count; k++) {
        const p = quadPt(q, rng.range(0.08, 0.92), rng.range(0.08, 0.92));
        tree(rng, p.x, p.y, rng.range(forest ? 3 : 2.6, forest ? 5.5 : 5), forest);
      }
      if (!forest && rng.chance(0.6)) features.push({ kind: 'yard', pts: [quadPt(q, 0, rng.range(0.3, 0.7)), quadPt(q, 1, rng.range(0.3, 0.7))], color: 'path' });
      continue;
    }
    if (b.kind === 'plaza') {
      features.push({ kind: 'plaza', pts: q });
      for (let k = 0; k < 4; k++) { const p = quadPt(q, k < 2 ? 0.15 : 0.85, k % 2 ? 0.15 : 0.85); tree(rng, p.x, p.y, 3); }
      continue;
    }

    // ── built blocks ──
    const pal = PALETTE[tag] ?? PALETTE.commercial;
    ground.push({ pts: q, color: tag === 'residential' || tag === 'suburb' ? '#1a2a1f' : tag === 'campus' ? '#1b2b22' : '#1b232d' });
    let nx = 2, ny = 2, hmin = 4, hmax = 8, style: Style = 'office', inset = 0.06;
    switch (tag) {
      case 'highrise': nx = rng.int(1, 2); ny = rng.int(1, 2); hmin = 11; hmax = 24; style = 'tower'; inset = 0.1; break;
      case 'commercial': nx = 2; ny = rng.int(1, 2); hmin = 6; hmax = 14; style = rng.chance(0.3) ? 'tower' : 'office'; break;
      case 'dense': nx = 2; ny = 2; hmin = 5; hmax = 11; style = 'office'; break;
      case 'historic': nx = 3; ny = 3; hmin = 3; hmax = 6; style = 'terrace'; inset = 0.02; break;
      case 'residential': nx = 3; ny = 2; hmin = 2; hmax = 4; style = 'house'; inset = 0.14; break;
      case 'suburb': nx = 2; ny = 2; hmin = 2; hmax = 3.5; style = 'house'; inset = 0.2; break;
      case 'industrial': nx = rng.int(1, 2); ny = 1; hmin = 3; hmax = 6; style = 'warehouse'; inset = 0.08; break;
      case 'campus': nx = 2; ny = 1; hmin = 4; hmax = 7; style = 'campus'; inset = 0.12; break;
      case 'harbor': nx = 1; ny = 2; hmin = 3; hmax = 5; style = 'warehouse'; break;
      case 'river': nx = 3; ny = 2; hmin = 2.5; hmax = 5; style = 'house'; inset = 0.12; break;
      case 'forest': nx = 2; ny = 1; hmin = 2; hmax = 3; style = 'house'; inset = 0.26; break;
      case 'airport': nx = 1; ny = 1; hmin = 4; hmax = 7; style = 'hangar'; break;
      case 'rail': nx = 3; ny = 2; hmin = 3; hmax = 5; style = 'terrace'; inset = 0.05; break;
    }
    for (let a = 0; a < nx; a++) for (let c = 0; c < ny; c++) {
      if ((style === 'house' || style === 'campus') && rng.chance(0.12)) continue;
      const u0 = a / nx + inset * 0.5, u1 = (a + 1) / nx - inset * 0.5, v0 = c / ny + inset * 0.5, v1 = (c + 1) / ny - inset * 0.5;
      const jitter = style === 'house' ? 0.04 : 0.01;
      const pts = subQuad(q, u0 + rng.range(0, jitter), v0 + rng.range(0, jitter), u1 - rng.range(0, jitter), v1 - rng.range(0, jitter));
      const h = rng.range(hmin, hmax);
      lots.push(mkLot(pts, h, rng.pick(pal), style, b.district, seed + a * 31 + c * 7));
      if (style === 'house' && rng.chance(0.7)) { const p = quadPt(q, (a + rng.range(0.1, 0.9)) / nx, (c + (rng.chance(0.5) ? 0.08 : 0.92)) / ny); tree(rng, p.x, p.y, rng.range(2.2, 3.6)); }
    }
    if (d.id === 'industrial' && rng.chance(0.2)) { const p = quadPt(q, 0.75, 0.75); lots.push({ ...mkLot([p, p, p, p], 6, '#4a5056', 'tank', b.district, seed + 99), cx: p.x, cy: p.y, r: 7 }); }
    if (tag === 'forest') for (let k = 0; k < 12; k++) { const p = quadPt(q, rng.range(0.05, 0.95), rng.range(0.05, 0.95)); tree(rng, p.x, p.y, rng.range(2.6, 4.6), true); }
  }

  // piers along the harbor coast
  const hd = city.districtById.harbor;
  for (let k = 0; k < 6; k++) {
    const x = hd.poly[3].x + 40 + k * ((hd.poly[2].x - hd.poly[3].x - 80) / 5);
    const y = city.coast[Math.min(city.coast.length - 1, Math.round((x / WORLD_W) * (city.coast.length - 1)))].y;
    features.push({ kind: 'pier', pts: [{ x: x - 7, y: y - 6 }, { x: x + 7, y: y - 6 }, { x: x + 7, y: y + 52 }, { x: x - 7, y: y + 52 }] });
  }

  // street lights along arterials and highways
  for (const e of city.edges) {
    if (e.cls === 'local') continue;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const n = Math.max(1, Math.floor(e.len / 34));
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; lights.push({ x: a.x + (b.x - a.x) * t + (k % 2 ? 4 : -4), y: a.y + (b.y - a.y) * t + (k % 2 ? -4 : 4) }); }
  }
  // lit windows
  for (const l of lots) {
    if (l.style === 'tank') continue;
    const rng = new Rng(l.seed ^ 0x9e3779b9);
    const area = l.r * l.r;
    const count = Math.min(14, Math.round((area / 45) * (l.style === 'tower' ? 2.2 : l.style === 'warehouse' || l.style === 'hangar' ? 0.25 : 1)));
    for (let k = 0; k < count; k++) {
      if (!rng.chance(0.55)) continue;
      const p = quadPt(l.pts, rng.range(0.15, 0.85), rng.range(0.15, 0.85));
      windows.push({ x: p.x, y: p.y, s: rng.range(0.8, 1.6) });
    }
  }
  return { lots, trees, features, lights, windows, ground };
}

function mkLot(pts: Vec[], h: number, roof: string, style: Style, district: string, seed: number): Lot {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const r = Math.max(4, Math.hypot(pts[2].x - pts[0].x, pts[2].y - pts[0].y) / 2);
  return { pts, h, roof, edge: shade(roof, 1.35), style, cx, cy, r, district, seed };
}

// ── Rendering ────────────────────────────────────────────────────────────────
export interface View { x0: number; y0: number; x1: number; y1: number }
const visible = (v: View | null, x: number, y: number, r: number) => !v || (x + r >= v.x0 && x - r <= v.x1 && y + r >= v.y0 && y - r <= v.y1);
const poly = (ctx: CanvasRenderingContext2D, pts: Vec[]) => { ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); };

export const MAP_COLORS = {
  sea: '#0b2133', seaShore: '#123047', river: '#123553', riverLight: '#1a4468', land: '#151d26', block: '#1b232d',
  casing: '#0a0e13', local: '#2e3a4a', arterial: '#3d4b5f', highway: '#53647c', bridge: '#5d6f88',
};

/**
 * Draws the static city. `lod` 0 = overview cache, 1 = mid cache, 2 = live close-up with extra detail.
 * The context must already be transformed into world coordinates.
 */
export function drawCity(ctx: CanvasRenderingContext2D, lod: number, view: View | null, activeDistricts: Set<string>, scale: number, opts: { skipRoofs?: boolean } = {}) {
  const city = getCity();
  const sc = getScenery();
  const C = MAP_COLORS;
  const px = (n: number) => n / scale; // n screen pixels in world units

  // land
  ctx.fillStyle = C.land;
  ctx.beginPath(); for (const d of city.districts) poly(ctx, d.poly); ctx.fill();
  // district tints
  for (const d of city.districts) {
    ctx.globalAlpha = activeDistricts.has(d.id) ? 0.06 : 0.0;
    if (ctx.globalAlpha > 0) { ctx.fillStyle = tintFor(d.tags[0]); ctx.beginPath(); poly(ctx, d.poly); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  // water
  const sg = ctx.createLinearGradient(0, city.coast[0].y, 0, WORLD_H + 80);
  sg.addColorStop(0, C.seaShore); sg.addColorStop(0.35, C.sea); sg.addColorStop(1, '#081826');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.moveTo(-80, city.coast[0].y); for (const p of city.coast) ctx.lineTo(p.x, p.y); ctx.lineTo(WORLD_W + 80, city.coast[city.coast.length - 1].y); ctx.lineTo(WORLD_W + 80, WORLD_H + 100); ctx.lineTo(-80, WORLD_H + 100); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(150,200,230,0.18)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-80, city.coast[0].y); for (const p of city.coast) ctx.lineTo(p.x, p.y); ctx.stroke();
  const rl = city.riverline;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0d2a42'; ctx.lineWidth = 32; ctx.beginPath(); ctx.moveTo(-60, rl[0].y); for (const p of rl) ctx.lineTo(p.x, p.y); ctx.lineTo(WORLD_W + 60, rl[rl.length - 1].y); ctx.stroke();
  ctx.strokeStyle = C.river; ctx.lineWidth = 26; ctx.stroke();
  ctx.strokeStyle = 'rgba(120,180,220,0.10)'; ctx.lineWidth = 10; ctx.stroke();

  // block ground (yards, paving)
  for (const g of sc.ground) { const c = g.pts[0]; if (!visible(view, c.x + 25, c.y + 25, 40)) continue; ctx.fillStyle = g.color; ctx.beginPath(); poly(ctx, g.pts); ctx.fill(); }
  // features underneath buildings
  for (const f of sc.features) {
    const c = f.pts[0];
    if (!visible(view, c.x, c.y, 120)) continue;
    switch (f.kind) {
      case 'grass': ctx.fillStyle = f.color ?? '#183322'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill(); break;
      case 'plaza': ctx.fillStyle = '#2a333e'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill(); { const m = centroid(f.pts); ctx.fillStyle = '#1d4766'; ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, 7); ctx.fill(); ctx.strokeStyle = '#3d5a73'; ctx.lineWidth = 1.2; ctx.stroke(); } break;
      case 'apron': ctx.fillStyle = '#242c35'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill(); break;
      case 'yard': ctx.strokeStyle = '#2b3a2e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(f.pts[0].x, f.pts[0].y); ctx.lineTo(f.pts[1].x, f.pts[1].y); ctx.stroke(); break;
      case 'pier': ctx.fillStyle = '#3a3f45'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill(); ctx.strokeStyle = '#1a1f24'; ctx.lineWidth = 1; ctx.stroke(); break;
      case 'rail': {
        ctx.fillStyle = '#20262c'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill();
        const n = f.extra ?? 5;
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const a = lerp(f.pts[0], f.pts[3], t), b = lerp(f.pts[1], f.pts[2], t);
          ctx.strokeStyle = '#4b4f55'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          if (lod >= 1) { ctx.strokeStyle = '#2f3338'; ctx.lineWidth = 3.2; ctx.setLineDash([0.8, 2.2]); ctx.stroke(); ctx.setLineDash([]); }
        }
        break;
      }
      case 'stadium': {
        const m = centroid(f.pts); const w = Math.hypot(f.pts[1].x - f.pts[0].x, f.pts[1].y - f.pts[0].y) / 2, h = Math.hypot(f.pts[3].x - f.pts[0].x, f.pts[3].y - f.pts[0].y) / 2;
        ctx.fillStyle = '#3a404a'; ctx.beginPath(); ctx.ellipse(m.x, m.y, w, h, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#245236'; ctx.beginPath(); ctx.ellipse(m.x, m.y, w * 0.72, h * 0.62, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.8; ctx.strokeRect(m.x - w * 0.5, m.y - h * 0.4, w, h * 0.8); ctx.beginPath(); ctx.moveTo(m.x, m.y - h * 0.4); ctx.lineTo(m.x, m.y + h * 0.4); ctx.stroke();
        break;
      }
      default: break;
    }
  }
  // building shadows (sun from the north-west)
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  for (const l of sc.lots) {
    if (!visible(view, l.cx, l.cy, l.r + l.h)) continue;
    const dx = l.h * 0.55, dy = l.h * 0.75;
    if (l.style === 'tank') { ctx.moveTo(l.cx + dx + l.r, l.cy + dy); ctx.arc(l.cx + dx, l.cy + dy, l.r, 0, 7); continue; }
    const p = l.pts;
    // extruded hull of roof + offset roof
    ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[1].x + dx, p[1].y + dy); ctx.lineTo(p[2].x + dx, p[2].y + dy); ctx.lineTo(p[3].x + dx, p[3].y + dy); ctx.lineTo(p[3].x, p[3].y); ctx.closePath();
  }
  ctx.fill();
  // roofs (in the tilted close-up view buildings are extruded after the roads instead)
  if (!opts.skipRoofs) for (const l of sc.lots) {
    if (!visible(view, l.cx, l.cy, l.r + 4)) continue;
    if (l.style === 'tank') {
      ctx.fillStyle = l.roof; ctx.beginPath(); ctx.arc(l.cx, l.cy, l.r, 0, 7); ctx.fill();
      ctx.strokeStyle = l.edge; ctx.lineWidth = 1; ctx.stroke(); ctx.beginPath(); ctx.arc(l.cx, l.cy, l.r * 0.5, 0, 7); ctx.stroke();
      continue;
    }
    const p = l.pts;
    ctx.fillStyle = l.roof; ctx.beginPath(); poly(ctx, p); ctx.fill();
    // lit edges (north & west faces catch the light)
    ctx.strokeStyle = l.edge; ctx.lineWidth = Math.max(0.6, px(0.8));
    ctx.beginPath(); ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.stroke();
    if (lod >= 1 || l.style === 'tower') {
      if (l.style === 'tower' || l.style === 'office') {
        const inner = subQuad(p, 0.28, 0.28, 0.72, 0.72);
        ctx.fillStyle = shade(l.roof, 1.18); ctx.beginPath(); poly(ctx, inner); ctx.fill();
        if (lod >= 2) { const s = subQuad(p, 0.12, 0.62, 0.24, 0.8); ctx.fillStyle = shade(l.roof, 0.75); ctx.beginPath(); poly(ctx, s); ctx.fill(); }
      } else if (l.style === 'house' || l.style === 'terrace') {
        ctx.strokeStyle = shade(l.roof, 0.7); ctx.lineWidth = Math.max(0.5, px(0.7));
        const a = lerp(p[0], p[3], 0.5), b = lerp(p[1], p[2], 0.5); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else if (l.style === 'warehouse' || l.style === 'hangar') {
        ctx.strokeStyle = shade(l.roof, 0.82); ctx.lineWidth = Math.max(0.4, px(0.6));
        ctx.beginPath(); for (let k = 1; k < 5; k++) { const a = lerp(p[0], p[1], k / 5), b = lerp(p[3], p[2], k / 5); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke();
      } else if (l.style === 'campus') {
        const inner = subQuad(p, 0.2, 0.2, 0.8, 0.8); ctx.fillStyle = shade(l.roof, 0.85); ctx.beginPath(); poly(ctx, inner); ctx.fill();
      }
    }
  }
  // trees (shadow, canopy, highlight)
  for (const t of sc.trees) {
    if (!visible(view, t.x, t.y, t.r)) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(t.x + t.r * 0.45, t.y + t.r * 0.55, t.r, 0, 7); ctx.fill();
    ctx.fillStyle = t.c; ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, 7); ctx.fill();
    if (lod >= 1) { ctx.fillStyle = 'rgba(140,200,140,0.12)'; ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.5, 0, 7); ctx.fill(); }
  }

  // roads
  const roadPath = (cls: string) => {
    ctx.beginPath();
    for (const e of city.edges) {
      if (e.cls !== cls) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      if (view && (Math.max(a.x, b.x) < view.x0 - 20 || Math.min(a.x, b.x) > view.x1 + 20 || Math.max(a.y, b.y) < view.y0 - 20 || Math.min(a.y, b.y) > view.y1 + 20)) continue;
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  roadPath('local'); ctx.strokeStyle = C.casing; ctx.lineWidth = 5.2; ctx.stroke(); ctx.strokeStyle = C.local; ctx.lineWidth = 3.8; ctx.stroke();
  if (lod >= 2) { ctx.strokeStyle = 'rgba(160,175,190,0.12)'; ctx.lineWidth = 4.6; ctx.setLineDash([1, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = C.local; ctx.lineWidth = 3.4; ctx.stroke(); }
  // runways sit over the local streets they replace
  for (const f of sc.features) {
    if (f.kind !== 'runway') continue;
    if (!visible(view, f.pts[0].x, f.pts[0].y, 100)) continue;
    ctx.fillStyle = '#2b3138'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill();
    const a = lerp(f.pts[0], f.pts[3], 0.5), b = lerp(f.pts[1], f.pts[2], 0.5);
    ctx.strokeStyle = 'rgba(232,237,242,0.55)'; ctx.lineWidth = 1.1; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(232,237,242,0.25)'; ctx.lineWidth = 0.7; ctx.beginPath(); poly(ctx, f.pts); ctx.stroke();
  }
  roadPath('arterial'); ctx.strokeStyle = C.casing; ctx.lineWidth = 8.5; ctx.stroke(); ctx.strokeStyle = C.arterial; ctx.lineWidth = 6.4; ctx.stroke();
  if (lod >= 1) { ctx.strokeStyle = 'rgba(225,232,240,0.32)'; ctx.lineWidth = Math.max(0.45, px(0.9)); ctx.setLineDash([4, 5]); ctx.stroke(); ctx.setLineDash([]); }
  roadPath('highway'); ctx.strokeStyle = C.casing; ctx.lineWidth = 13; ctx.stroke(); ctx.strokeStyle = C.highway; ctx.lineWidth = 10.5; ctx.stroke();
  if (lod >= 1) { ctx.strokeStyle = 'rgba(229,172,77,0.55)'; ctx.lineWidth = Math.max(0.4, px(0.9)); ctx.stroke(); ctx.strokeStyle = 'rgba(225,232,240,0.25)'; ctx.lineWidth = 6.5; ctx.setLineDash([5, 7]); ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = C.highway; ctx.lineWidth = 5.2; ctx.stroke(); ctx.strokeStyle = 'rgba(229,172,77,0.55)'; ctx.lineWidth = Math.max(0.4, px(0.9)); ctx.stroke(); }
  roadPath('bridge'); ctx.strokeStyle = '#06090c'; ctx.lineWidth = 11; ctx.stroke(); ctx.strokeStyle = '#8a9bb0'; ctx.lineWidth = 9; ctx.stroke(); ctx.strokeStyle = C.bridge; ctx.lineWidth = 7; ctx.stroke();
}

export function drawNightLights(ctx: CanvasRenderingContext2D, view: View | null, opts: { windows?: boolean } = {}) {
  const sc = getScenery();
  ctx.fillStyle = 'rgba(255,214,140,0.9)';
  if (opts.windows !== false) for (const w of sc.windows) { if (!visible(view, w.x, w.y, 2)) continue; ctx.fillRect(w.x - w.s / 2, w.y - w.s / 2, w.s, w.s); }
  for (const l of sc.lights) {
    if (!visible(view, l.x, l.y, 9)) continue;
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, 9);
    g.addColorStop(0, 'rgba(255,200,120,0.55)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g; ctx.fillRect(l.x - 9, l.y - 9, 18, 18);
  }
}

function centroid(p: Vec[]): Vec { return { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length }; }
function tintFor(tag: string): string {
  return ({ commercial: '#4A9CD6', dense: '#4A9CD6', industrial: '#E5AC4D', residential: '#c9b79c', forest: '#54B889', harbor: '#3ec1c9', airport: '#9a8cd6', campus: '#c58bd6', suburb: '#7fa889', historic: '#d69a53', highrise: '#4A9CD6', river: '#4A9CD6', rail: '#98A6B5' } as Record<string, string>)[tag] ?? '#98A6B5';
}

// ── 2.5D close-up ────────────────────────────────────────────────────────────
/** how far roofs rise on screen per unit of building height at full tilt */
export const LIFT = 1.25;
const LEAN = 0.22;
let sortedLots: Lot[] | null = null;

/**
 * Extruded buildings for the zoomed-in view. Roofs are lifted "up" the screen by height × tilt so
 * the south and east walls become visible; drawn back to front so nearer blocks overlap farther ones.
 */
export function drawBuildings3D(ctx: CanvasRenderingContext2D, view: View, tilt: number, night: number, scale: number, detail = true) {
  const sc = getScenery();
  sortedLots ??= [...sc.lots].sort((a, b) => a.cy - b.cy);
  const k = LIFT * tilt;
  const px = (n: number) => n / scale;
  const lit = night > 0.25;
  for (const l of sortedLots) {
    const rise = l.h * k;
    if (!visible(view, l.cx, l.cy - rise, l.r + rise + 4)) continue;
    const ox = rise * LEAN, oy = -rise;
    if (l.style === 'tank') {
      ctx.fillStyle = shade(l.roof, 0.62);
      ctx.beginPath(); ctx.ellipse(l.cx + ox / 2, l.cy + oy / 2, l.r, Math.abs(oy) / 2 + l.r * 0.4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = l.roof; ctx.beginPath(); ctx.arc(l.cx + ox, l.cy + oy, l.r, 0, 7); ctx.fill();
      ctx.strokeStyle = l.edge; ctx.lineWidth = px(1); ctx.stroke();
      continue;
    }
    const p = l.pts;
    const r = p.map((q) => ({ x: q.x + ox, y: q.y + oy }));
    // walls facing the viewer
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4];
      const nx = b.y - a.y, ny = -(b.x - a.x);
      const facing = -nx * ox - ny * oy;
      if (facing <= 0) continue;
      const south = ny > Math.abs(nx);
      ctx.fillStyle = shade(l.roof, south ? 0.52 : 0.68);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(r[(i + 1) % 4].x, r[(i + 1) % 4].y); ctx.lineTo(r[i].x, r[i].y); ctx.closePath(); ctx.fill();
      // floors and windows: daytime glass bands, lit windows at night (batched per building)
      const floors = Math.max(1, Math.floor(l.h / (l.style === 'warehouse' || l.style === 'hangar' ? 4 : 2.4)));
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (detail && rise * scale > 10 && l.style !== 'warehouse' && l.style !== 'hangar') {
        const q = (u: number, v: number) => ({ x: a.x + (b.x - a.x) * u + ox * v, y: a.y + (b.y - a.y) * u + oy * v });
        const quad = (path: Path2D, u0: number, u1: number, v0: number, v1: number) => { const w0 = q(u0, v0), w1 = q(u1, v0), w2 = q(u1, v1), w3 = q(u0, v1); path.moveTo(w0.x, w0.y); path.lineTo(w1.x, w1.y); path.lineTo(w2.x, w2.y); path.lineTo(w3.x, w3.y); path.closePath(); };
        if (!lit) {
          const glass = new Path2D();
          for (let f = 0; f < floors; f++) quad(glass, 0.06, 0.94, (f + 0.3) / floors, (f + 0.72) / floors);
          ctx.fillStyle = l.style === 'tower' ? 'rgba(150,190,220,0.26)' : 'rgba(140,175,205,0.16)'; ctx.fill(glass);
        } else {
          const cols = Math.max(1, Math.floor(len / (l.style === 'tower' ? 3.2 : 4.5)));
          const on = new Path2D();
          const rng = l.seed + i * 977;
          for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) if ((((rng + f * 131 + c * 71) * 2654435761) >>> 0) % 100 < 42) quad(on, (c + 0.25) / cols, (c + 0.75) / cols, (f + 0.3) / floors, (f + 0.75) / floors);
          ctx.fillStyle = `rgba(255,212,140,${0.55 + 0.4 * night})`; ctx.fill(on);
        }
      } else if (l.style === 'warehouse' || l.style === 'hangar') {
        // big roller doors
        const q = (u: number, v: number) => ({ x: a.x + (b.x - a.x) * u + ox * v, y: a.y + (b.y - a.y) * u + oy * v });
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        const cols = Math.max(1, Math.min(3, Math.floor(len / 12)));
        for (let c = 0; c < cols; c++) { const u0 = (c + 0.2) / cols, u1 = u0 + 0.5 / cols; const w0 = q(u0, 0), w1 = q(u1, 0), w2 = q(u1, 0.55), w3 = q(u0, 0.55); ctx.beginPath(); ctx.moveTo(w0.x, w0.y); ctx.lineTo(w1.x, w1.y); ctx.lineTo(w2.x, w2.y); ctx.lineTo(w3.x, w3.y); ctx.closePath(); ctx.fill(); }
      }
    }
    // roof
    ctx.fillStyle = l.roof; ctx.beginPath(); poly(ctx, r); ctx.fill();
    ctx.strokeStyle = l.edge; ctx.lineWidth = Math.max(0.5, px(0.9));
    ctx.beginPath(); ctx.moveTo(r[3].x, r[3].y); ctx.lineTo(r[0].x, r[0].y); ctx.lineTo(r[1].x, r[1].y); ctx.stroke();
    if (l.style === 'tower' || l.style === 'office') {
      const inner = subQuad(r, 0.3, 0.3, 0.7, 0.7); ctx.fillStyle = shade(l.roof, 1.16); ctx.beginPath(); poly(ctx, inner); ctx.fill();
      if (l.style === 'tower' && lit) { const m = centroid(r); ctx.fillStyle = (Math.floor(performance.now() / 900 + l.seed) % 2) ? 'rgba(255,70,70,0.95)' : 'rgba(120,20,20,0.6)'; ctx.beginPath(); ctx.arc(m.x, m.y, Math.max(0.6, px(1.6)), 0, 7); ctx.fill(); }
    } else if (l.style === 'house' || l.style === 'terrace') {
      ctx.strokeStyle = shade(l.roof, 0.7); ctx.lineWidth = Math.max(0.5, px(0.8));
      const a = lerp(r[0], r[3], 0.5), b = lerp(r[1], r[2], 0.5); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    } else if (l.style === 'warehouse' || l.style === 'hangar') {
      ctx.strokeStyle = shade(l.roof, 0.82); ctx.lineWidth = Math.max(0.4, px(0.6));
      ctx.beginPath(); for (let k2 = 1; k2 < 5; k2++) { const a = lerp(r[0], r[1], k2 / 5), b = lerp(r[3], r[2], k2 / 5); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke();
    }
  }
}

// ── street life: parked cars and ambient traffic ─────────────────────────────
const CAR_COLORS = ['#c9ced6', '#8a929c', '#3d4450', '#e6e8eb', '#7a2f2f', '#2f4f7a', '#2f5a3f', '#8a6a2e', '#1c2026', '#5d4a7a'];
interface Lane { pts: Vec[]; cum: number[]; len: number; district: string }
let lanes: Lane[] | null = null;
function getLanes(): Lane[] {
  if (lanes) return lanes;
  const city = getCity();
  const out: Lane[] = [];
  const COLS = Math.max(...city.nodes.map((n) => n.i)) + 1, ROWS = Math.max(...city.nodes.map((n) => n.j)) + 1;
  const push = (ids: number[]) => {
    if (ids.length < 4) return;
    const pts = ids.map((n) => ({ x: city.nodes[n].x, y: city.nodes[n].y }));
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    out.push({ pts, cum, len: cum[cum.length - 1], district: city.nodes[ids[Math.floor(ids.length / 2)]].district });
  };
  // continuous runs along lattice rows and columns
  for (let j = 0; j < ROWS; j++) { let run: number[] = []; for (let i = 0; i < COLS; i++) { const n = city.nodeAt(i, j); if (run.length && !city.edgeBetween.has(run[run.length - 1] * 100000 + n)) { push(run); run = []; } run.push(n); } push(run); }
  for (let i = 0; i < COLS; i++) { let run: number[] = []; for (let j = 0; j < ROWS; j++) { const n = city.nodeAt(i, j); if (run.length && !city.edgeBetween.has(run[run.length - 1] * 100000 + n)) { push(run); run = []; } run.push(n); } push(run); }
  lanes = out;
  return out;
}
function laneAt(l: Lane, d: number): { x: number; y: number; h: number } {
  let i = 1; while (i < l.cum.length - 1 && l.cum[i] < d) i++;
  const a = l.pts[i - 1], b = l.pts[i];
  const t = (d - l.cum[i - 1]) / Math.max(1e-6, l.cum[i] - l.cum[i - 1]);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: Math.atan2(b.y - a.y, b.x - a.x) };
}
const hash = (n: number) => { let x = n | 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

/** cosmetic civilian traffic: deterministic in time, denser where the simulation says traffic is heavy */
export function drawTraffic(ctx: CanvasRenderingContext2D, view: View, tSec: number, traffic: Record<string, number>, night: number, scale: number, active: Set<string>) {
  const ls = getLanes();
  const s = Math.max(0.9, Math.min(1.25, 0.55 + 0.25 * scale));
  for (let li = 0; li < ls.length; li++) {
    const l = ls[li];
    if (!active.has(l.district)) continue;
    const density = (traffic[l.district] ?? 0.3) * (night > 0.5 ? 0.45 : 1);
    const n = Math.round(l.len / 60 * density * 1.6);
    for (let k = 0; k < n; k++) {
      const seed = li * 131 + k * 17;
      const dir = hash(seed) < 0.5 ? 1 : -1;
      const speed = 7 + hash(seed + 1) * 6;
      let d = (hash(seed + 2) * l.len + tSec * speed) % l.len;
      if (dir < 0) d = l.len - d;
      const p = laneAt(l, d);
      if (p.x < view.x0 - 10 || p.x > view.x1 + 10 || p.y < view.y0 - 10 || p.y > view.y1 + 10) continue;
      const h = p.h + (dir < 0 ? Math.PI : 0);
      const off = 1.6;
      const x = p.x + Math.cos(h + Math.PI / 2) * off, y = p.y + Math.sin(h + Math.PI / 2) * off;
      ctx.save(); ctx.translate(x, y); ctx.rotate(h);
      if (night > 0.3) { ctx.fillStyle = `rgba(255,236,190,${0.16 * night})`; ctx.beginPath(); ctx.moveTo(2.4 * s, -0.8); ctx.lineTo(13 * s, -3.5 * s); ctx.lineTo(13 * s, 3.5 * s); ctx.lineTo(2.4 * s, 0.8); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(-2.2 * s + 0.4, -1.1 * s + 0.6, 4.4 * s, 2.2 * s);
      ctx.fillStyle = CAR_COLORS[Math.floor(hash(seed + 3) * CAR_COLORS.length)]; ctx.fillRect(-2.2 * s, -1.1 * s, 4.4 * s, 2.2 * s);
      ctx.fillStyle = 'rgba(20,30,40,0.7)'; ctx.fillRect(0.3 * s, -0.85 * s, 1 * s, 1.7 * s);
      if (night > 0.3) { ctx.fillStyle = 'rgba(255,60,60,0.9)'; ctx.fillRect(-2.3 * s, -1 * s, 0.4, 0.6); ctx.fillRect(-2.3 * s, 0.4 * s, 0.4, 0.6); }
      ctx.restore();
    }
  }
}

/** parked cars along local streets (static) */
export function drawParked(ctx: CanvasRenderingContext2D, view: View, active: Set<string>) {
  const city = getCity();
  for (const e of city.edges) {
    if (e.cls !== 'local') continue;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    if (!active.has(a.district)) continue;
    if (Math.max(a.x, b.x) < view.x0 || Math.min(a.x, b.x) > view.x1 || Math.max(a.y, b.y) < view.y0 || Math.min(a.y, b.y) > view.y1) continue;
    const h = Math.atan2(b.y - a.y, b.x - a.x);
    const n = Math.floor(hash(e.id * 7) * 4);
    for (let k = 0; k < n; k++) {
      const t = 0.18 + hash(e.id * 13 + k) * 0.64;
      const side = hash(e.id * 29 + k) < 0.5 ? 1 : -1;
      const x = a.x + (b.x - a.x) * t + Math.cos(h + Math.PI / 2) * 3.4 * side, y = a.y + (b.y - a.y) * t + Math.sin(h + Math.PI / 2) * 3.4 * side;
      ctx.save(); ctx.translate(x, y); ctx.rotate(h);
      ctx.fillStyle = CAR_COLORS[Math.floor(hash(e.id * 31 + k) * CAR_COLORS.length)]; ctx.fillRect(-2, -0.95, 4, 1.9);
      ctx.fillStyle = 'rgba(20,30,40,0.6)'; ctx.fillRect(-0.6, -0.75, 1.1, 1.5);
      ctx.restore();
    }
  }
}
