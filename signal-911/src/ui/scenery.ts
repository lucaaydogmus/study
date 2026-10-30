// Procedural city scenery for the map: lots and buildings with heights, yards, trees, parks,
// runways, container yards, rail tracks, a stadium, street lights and lit windows.
// Generated once from the (deterministic) city and rendered into cached canvases.
import { getCity, WORLD_H, WORLD_W, type City } from '../sim/city';
import { Rng, hashString } from '../sim/rng';
import type { Vec } from '../sim/types';

type Style = 'tower' | 'office' | 'house' | 'terrace' | 'warehouse' | 'campus' | 'hangar' | 'tank';
export interface Lot { pts: Vec[]; h: number; roof: string; edge: string; style: Style; cx: number; cy: number; r: number; district: string; seed: number }
export interface Tree { x: number; y: number; r: number; c: string }
interface Feature { kind: 'runway' | 'apron' | 'containers' | 'rail' | 'stadium' | 'yard' | 'grass' | 'plaza' | 'pier' | 'parking' | 'pool'; pts: Vec[]; color?: string; extra?: number }
export type ModelKind = 'hospital' | 'cathedral' | 'clocktower' | 'cityhall' | 'terminal' | 'ctower' | 'plane' | 'crane' | 'ship' | 'train' | 'factory' | 'lighthouse' | 'gas' | 'bank' | 'mall' | 'school' | 'station' | 'supertall' | 'stadium' | 'market' | 'library';
export interface Model { kind: ModelKind; x: number; y: number; rot: number; s: number; seed: number; pts?: Vec[] }
export interface Scenery { lots: Lot[]; trees: Tree[]; features: Feature[]; lights: Vec[]; windows: Array<{ x: number; y: number; s: number; h: number; v: number }>; ground: Array<{ pts: Vec[]; color: string }>; models: Model[] }

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

// night grading for the live close-up: building colours are mixed toward the night sky instead of
// darkening the finished frame, so lit windows drawn on top keep their glow and stay correctly hidden
let NIGHT_A = 0;
const ntMemo = new Map<string, string>();
const GLOW = new Set(['#ffd88a', '#fff2b0', '#ffd27a', '#ff4d4d', '#4dff7a', '#701c1c']);
function nt(c: string): string {
  if (NIGHT_A <= 0 || GLOW.has(c)) return c;
  const key = c + '|' + NIGHT_A;
  const hit = ntMemo.get(key);
  if (hit) return hit;
  let r = 0, g = 0, b = 0, a = 1;
  if (c[0] === '#') { const n = parseInt(c.length === 4 ? c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(1, 7), 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
  else { const m = c.match(/[\d.]+/g); if (!m || m.length < 3) return c; [r, g, b] = m.map(Number); if (m.length > 3) a = Number(m[3]); }
  // drain some colour like the eye does at night, then darken toward the sky
  const A = NIGHT_A, ds = Math.min(0.5, A * 0.75), grey = r * 0.3 + g * 0.59 + b * 0.11;
  r += (grey - r) * ds; g += (grey - g) * ds; b += (grey - b) * ds;
  const out = `rgba(${Math.round(r + (8 - r) * A)},${Math.round(g + (14 - g) * A)},${Math.round(b + (34 - b) * A)},${a})`;
  if (ntMemo.size > 6000) ntMemo.clear();
  ntMemo.set(key, out);
  return out;
}

const PALETTE: Record<string, string[]> = {
  commercial: ['#c4c8cf', '#b8bdc6', '#cfd2d7', '#adb4be', '#c9c3b9'],
  highrise: ['#9fb2c7', '#95a9c0', '#a9bccf', '#8ea4bd', '#b1c2d4'],
  residential: ['#c08a6c', '#9c948e', '#b5866a', '#8e949c', '#c79c80', '#a97a62'],
  historic: ['#b5735c', '#a9806c', '#9b6a58', '#c08d74', '#8f8682', '#ad6a55'],
  industrial: ['#b4b9bf', '#a9aeb5', '#bfc3c8', '#9fa5ad', '#c6c9cc'],
  campus: ['#c2a283', '#b8987a', '#cbab8c', '#ad8f72'],
  suburb: ['#a8806a', '#8e8a86', '#b28a70', '#7f8590', '#9c7562'],
};

let cached: Scenery | null = null;
export function getScenery(): Scenery {
  if (cached) return cached;
  cached = build(getCity());
  return cached;
}

const LM_MODEL: Record<string, ModelKind> = { hospital: 'hospital', church: 'cathedral', civic: 'cityhall', airport: 'terminal', cargo: 'plane', bank: 'bank', mall: 'mall', school: 'school', gas: 'gas', factory: 'factory', transit: 'station', tower: 'supertall', market: 'market', library: 'library', campus: 'school', terminal: 'crane', depot: 'factory', warehouse: 'factory', hotel: 'supertall', cinema: 'mall' };

function build(city: City): Scenery {
  const lots: Lot[] = [], trees: Tree[] = [], features: Feature[] = [], lights: Vec[] = [], windows: Scenery['windows'] = [], ground: Scenery['ground'] = [], models: Model[] = [];
  const stadiumNode = city.landmarks.find((l) => l.kind === 'stadium')?.nodeId;
  // landmark buildings take over the block beside their address
  const lmBlock = new Map<number, { kind: ModelKind; seed: number; name: string }>();
  for (const l of city.landmarks) {
    const n = city.nodes[l.nodeId];
    let kind: ModelKind | undefined = LM_MODEL[l.kind];
    if (l.kind === 'monument') kind = /Lighthouse/.test(l.name) ? 'lighthouse' : 'clocktower';
    if (!kind) continue;
    let best = -1, bd = Infinity;
    city.blocks.forEach((b, i) => { if (b.kind !== 'building' && kind !== 'hospital') return; const c = centroid(b.poly); const d = Math.hypot(c.x - (n.x + 22), c.y - (n.y + 22)); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && bd < 60 && !lmBlock.has(best)) lmBlock.set(best, { kind, seed: hashString(l.id), name: l.name });
  }
  const tree = (rng: Rng, x: number, y: number, r: number, forest = false) => trees.push({ x, y, r, c: rng.pick(forest ? ['#3f7d3a', '#468a40', '#376f33', '#4f9246'] : ['#5f9e4a', '#6aa852', '#558f42', '#74b05b']) });

  // blocks indexed by lattice coordinates (the block below/right of node i,j)
  for (let bi = 0; bi < city.blocks.length; bi++) {
    const b = city.blocks[bi];
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
      if (rng.chance(0.45)) lots.push(mkLot(subQuad(q, 0.15, 0.2, 0.85, 0.8), 5, '#aab2bb', 'hangar', b.district, seed));
      else if (rng.chance(0.75)) { const c = quadPt(q, 0.5, 0.5); models.push({ kind: 'plane', x: c.x, y: c.y, rot: rng.chance(0.5) ? 0 : Math.PI, s: rng.range(0.8, 1.15), seed }); }
      continue;
    }
    if (d.id === 'harbor' && nj >= 21) {
      features.push({ kind: 'apron', pts: subQuad(q, 0, 0, 1, 1) });
      if (rng.chance(0.35)) { const c = quadPt(q, 0.5, 0.92); models.push({ kind: 'crane', x: c.x, y: c.y, rot: 0, s: 1, seed }); }
      // container stacks
      const cols = 4, rows = 3;
      for (let a = 0; a < cols; a++) for (let c = 0; c < rows; c++) {
        if (rng.chance(0.15)) continue;
        const pts = subQuad(q, 0.08 + a * 0.22, 0.1 + c * 0.28, 0.08 + a * 0.22 + 0.19, 0.1 + c * 0.28 + 0.2);
        lots.push(mkLot(pts, 1.5 + rng.int(0, 2), rng.pick(['#c0563f', '#3f7fb0', '#4f9a5c', '#c4953a', '#7d63a8', '#b0703f']), 'warehouse', b.district, seed + a * 7 + c));
      }
      continue;
    }
    if (d.id === 'southside' && nj === 20) {
      features.push({ kind: 'rail', pts: subQuad(q, -0.02, 0.1, 1.02, 0.9), extra: 6 });
      if (rng.chance(0.4)) { const a = quadPt(q, 0.02, 0.1 + (rng.int(0, 5) + 0.5) / 6 * 0.8), bb = quadPt(q, 0.98, 0.1 + 0.5 * 0.8); models.push({ kind: 'train', x: a.x, y: a.y, rot: Math.atan2(bb.y - a.y, bb.x - a.x), s: Math.hypot(bb.x - a.x, bb.y - a.y), seed }); }
      continue;
    }
    if (stadiumNode !== undefined && n0 === stadiumNode) {
      const pts = subQuad(q, 0.04, 0.06, 0.96, 0.94);
      features.push({ kind: 'stadium', pts });
      const c = centroid(pts); models.push({ kind: 'stadium', x: c.x, y: c.y, rot: 0, s: 1, seed, pts });
      continue;
    }
    // landmark buildings
    const lm = lmBlock.get(bi);
    if (lm) {
      ground.push({ pts: q, color: '#d6d1c7' });
      const c = quadPt(q, 0.5, 0.5);
      models.push({ kind: lm.kind, x: c.x, y: c.y, rot: 0, s: 1, seed: lm.seed, pts: subQuad(q, 0.08, 0.08, 0.92, 0.92) });
      continue;
    }
    // surface car parks in busy districts
    if (['commercial', 'dense', 'industrial', 'highrise'].includes(tag) && b.kind === 'building' && rng.chance(0.07)) {
      features.push({ kind: 'parking', pts: subQuad(q, 0.04, 0.04, 0.96, 0.96), extra: seed });
      continue;
    }

    // ── parks and plazas ──
    if (b.kind === 'park') {
      features.push({ kind: 'grass', pts: q, color: d.tags.includes('forest') ? '#8fbf78' : '#a6d48f' });
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
    ground.push({ pts: q, color: tag === 'residential' || tag === 'suburb' || tag === 'forest' || tag === 'river' ? '#cfe0bd' : tag === 'campus' ? '#c8dcb8' : '#dad6cc' });
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
      if (style === 'house' && tag === 'suburb' && rng.chance(0.28)) { const pp = quadPt(q, (a + 0.5) / nx, (c + 0.97) / ny); features.push({ kind: 'pool', pts: [{ x: pp.x - 2.6, y: pp.y - 1.4 }, { x: pp.x + 2.6, y: pp.y - 1.4 }, { x: pp.x + 2.6, y: pp.y + 1.4 }, { x: pp.x - 2.6, y: pp.y + 1.4 }] }); }
      if (style === 'house' && rng.chance(0.7)) { const p = quadPt(q, (a + rng.range(0.1, 0.9)) / nx, (c + (rng.chance(0.5) ? 0.08 : 0.92)) / ny); tree(rng, p.x, p.y, rng.range(2.2, 3.6)); }
    }
    if (d.id === 'industrial' && rng.chance(0.2)) { const p = quadPt(q, 0.75, 0.75); lots.push({ ...mkLot([p, p, p, p], 6, '#c9cdd1', 'tank', b.district, seed + 99), cx: p.x, cy: p.y, r: 7 }); }
    if (tag === 'forest') for (let k = 0; k < 12; k++) { const p = quadPt(q, rng.range(0.05, 0.95), rng.range(0.05, 0.95)); tree(rng, p.x, p.y, rng.range(2.6, 4.6), true); }
  }

  // piers along the harbor coast
  const hd = city.districtById.harbor;
  for (let k = 0; k < 6; k++) {
    const x = hd.poly[3].x + 40 + k * ((hd.poly[2].x - hd.poly[3].x - 80) / 5);
    const y = city.coast[Math.min(city.coast.length - 1, Math.round((x / WORLD_W) * (city.coast.length - 1)))].y;
    features.push({ kind: 'pier', pts: [{ x: x - 7, y: y - 6 }, { x: x + 7, y: y - 6 }, { x: x + 7, y: y + 52 }, { x: x - 7, y: y + 52 }] });
    if (k % 2 === 0) models.push({ kind: 'ship', x: x + 19, y: y + 34, rot: Math.PI / 2, s: 1 + (k % 3) * 0.15, seed: 7000 + k });
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
      windows.push({ x: p.x, y: p.y, s: rng.range(0.8, 1.6), h: l.h, v: rng.range(0.25, 0.9) });
    }
  }
  return { lots, trees, features, lights, windows, ground, models };
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
  sea: '#7fbfe3', seaShore: '#a5d6f0', river: '#86c4e8', riverLight: '#b8e2f6', land: '#e6e1d6', block: '#dad6cc',
  casing: '#c4bdb0', local: '#ffffff', arterial: '#fff1bd', highway: '#ffcf73', bridge: '#f4f1ea',
  casingArt: '#dfc27f', casingHwy: '#d6a03f',
};

/**
 * Draws the static city. `lod` 0 = overview cache, 1 = mid cache, 2 = live close-up with extra detail.
 * The context must already be transformed into world coordinates.
 */
export function drawCity(ctx: CanvasRenderingContext2D, lod: number, view: View | null, activeDistricts: Set<string>, scale: number, opts: { skipRoofs?: boolean; tilt?: number } = {}) {
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
  sg.addColorStop(0, C.seaShore); sg.addColorStop(0.35, C.sea); sg.addColorStop(1, '#5ea4cf');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.moveTo(-80, city.coast[0].y); for (const p of city.coast) ctx.lineTo(p.x, p.y); ctx.lineTo(WORLD_W + 80, city.coast[city.coast.length - 1].y); ctx.lineTo(WORLD_W + 80, WORLD_H + 100); ctx.lineTo(-80, WORLD_H + 100); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-80, city.coast[0].y); for (const p of city.coast) ctx.lineTo(p.x, p.y); ctx.stroke();
  const rl = city.riverline;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#a3cfe6'; ctx.lineWidth = 34; ctx.beginPath(); ctx.moveTo(-60, rl[0].y); for (const p of rl) ctx.lineTo(p.x, p.y); ctx.lineTo(WORLD_W + 60, rl[rl.length - 1].y); ctx.stroke();
  ctx.strokeStyle = C.river; ctx.lineWidth = 26; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 8; ctx.stroke();

  // block ground (yards, paving)
  for (const g of sc.ground) { const c = g.pts[0]; if (!visible(view, c.x + 25, c.y + 25, 40)) continue; ctx.fillStyle = g.color; ctx.beginPath(); poly(ctx, g.pts); ctx.fill(); }
  // features underneath buildings
  for (const f of sc.features) {
    const c = f.pts[0];
    if (!visible(view, c.x, c.y, 120)) continue;
    switch (f.kind) {
      case 'grass': ctx.fillStyle = f.color ?? '#a6d48f'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill(); break;
      case 'plaza': ctx.fillStyle = '#e5ded2'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill(); { const m = centroid(f.pts); ctx.fillStyle = '#7fbfe3'; ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, 7); ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.stroke(); } break;
      case 'apron': ctx.fillStyle = '#c9cbcf'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill(); break;
      case 'yard': ctx.strokeStyle = '#d7c7a6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(f.pts[0].x, f.pts[0].y); ctx.lineTo(f.pts[1].x, f.pts[1].y); ctx.stroke(); break;
      case 'parking': {
        ctx.fillStyle = '#b6babf'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill();
        const rr = f.extra ?? 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.35; ctx.beginPath();
        for (let row = 0; row < 3; row++) for (let k = 0; k <= 8; k++) { const a = quadPt(f.pts, 0.06 + k * 0.11, 0.08 + row * 0.32), b = quadPt(f.pts, 0.06 + k * 0.11, 0.08 + row * 0.32 + 0.2); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        ctx.stroke();
        for (let row = 0; row < 3; row++) for (let k = 0; k < 8; k++) {
          const hsh = ((rr + row * 31 + k * 17) * 2654435761) >>> 0;
          if (hsh % 100 > 62) continue;
          const c = quadPt(f.pts, 0.115 + k * 0.11, 0.18 + row * 0.32);
          ctx.fillStyle = ['#c9ced6', '#8a929c', '#3d4450', '#e6e8eb', '#7a2f2f', '#2f4f7a', '#2f5a3f', '#1c2026'][hsh % 8]; ctx.fillRect(c.x - 1.6, c.y - 2.6, 3.2, 5.2);
        }
        break;
      }
      case 'pool': ctx.fillStyle = '#4fc0ec'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill(); ctx.strokeStyle = 'rgba(220,240,250,0.5)'; ctx.lineWidth = 0.4; ctx.stroke(); break;
      case 'pier': ctx.fillStyle = '#c2b6a2'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill(); ctx.strokeStyle = '#8f8577'; ctx.lineWidth = 1; ctx.stroke(); break;
      case 'rail': {
        ctx.fillStyle = '#c2bbaf'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill();
        const n = f.extra ?? 5;
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const a = lerp(f.pts[0], f.pts[3], t), b = lerp(f.pts[1], f.pts[2], t);
          ctx.strokeStyle = '#6f685e'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          if (lod >= 1) { ctx.strokeStyle = '#8d8478'; ctx.lineWidth = 3.2; ctx.setLineDash([0.8, 2.2]); ctx.stroke(); ctx.setLineDash([]); }
        }
        break;
      }
      case 'stadium': {
        const m = centroid(f.pts); const w = Math.hypot(f.pts[1].x - f.pts[0].x, f.pts[1].y - f.pts[0].y) / 2, h = Math.hypot(f.pts[3].x - f.pts[0].x, f.pts[3].y - f.pts[0].y) / 2;
        ctx.fillStyle = '#c7cbd1'; ctx.beginPath(); ctx.ellipse(m.x, m.y, w, h, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#5aa84f'; ctx.beginPath(); ctx.ellipse(m.x, m.y, w * 0.72, h * 0.62, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.8; ctx.strokeRect(m.x - w * 0.5, m.y - h * 0.4, w, h * 0.8); ctx.beginPath(); ctx.moveTo(m.x, m.y - h * 0.4); ctx.lineTo(m.x, m.y + h * 0.4); ctx.stroke();
        break;
      }
      default: break;
    }
  }
  // building shadows (sun from the north-west)
  ctx.fillStyle = 'rgba(70,58,44,0.22)';
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
    const lift = (opts.tilt ?? 0) * LIFT * 3.2;
    ctx.fillStyle = 'rgba(60,70,40,0.22)'; ctx.beginPath(); ctx.arc(t.x + t.r * 0.45, t.y + t.r * 0.55, t.r, 0, 7); ctx.fill();
    if (lift > 0.3) { ctx.fillStyle = '#7a5a3e'; ctx.fillRect(t.x - 0.4, t.y - lift, 0.8, lift); }
    ctx.fillStyle = t.c; ctx.beginPath(); ctx.arc(t.x + lift * LEAN, t.y - lift, t.r, 0, 7); ctx.fill();
    if (lod >= 1) { ctx.fillStyle = 'rgba(255,255,230,0.2)'; ctx.beginPath(); ctx.arc(t.x - t.r * 0.3 + lift * LEAN, t.y - t.r * 0.3 - lift, t.r * 0.5, 0, 7); ctx.fill(); }
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
  roadPath('local'); ctx.strokeStyle = C.casing; ctx.lineWidth = 5.4; ctx.stroke(); ctx.strokeStyle = C.local; ctx.lineWidth = 4; ctx.stroke();
  // runways sit over the local streets they replace
  for (const f of sc.features) {
    if (f.kind !== 'runway') continue;
    if (!visible(view, f.pts[0].x, f.pts[0].y, 100)) continue;
    ctx.fillStyle = '#868c93'; ctx.beginPath(); poly(ctx, f.pts); ctx.fill();
    const a = lerp(f.pts[0], f.pts[3], 0.5), b = lerp(f.pts[1], f.pts[2], 0.5);
    ctx.strokeStyle = 'rgba(232,237,242,0.55)'; ctx.lineWidth = 1.1; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(232,237,242,0.25)'; ctx.lineWidth = 0.7; ctx.beginPath(); poly(ctx, f.pts); ctx.stroke();
  }
  roadPath('arterial'); ctx.strokeStyle = C.casingArt; ctx.lineWidth = 8.6; ctx.stroke(); ctx.strokeStyle = C.arterial; ctx.lineWidth = 6.6; ctx.stroke();
  if (lod >= 1) { ctx.strokeStyle = 'rgba(205,170,90,0.55)'; ctx.lineWidth = Math.max(0.45, px(0.9)); ctx.setLineDash([4, 5]); ctx.stroke(); ctx.setLineDash([]); }
  roadPath('highway'); ctx.strokeStyle = C.casingHwy; ctx.lineWidth = 13; ctx.stroke(); ctx.strokeStyle = C.highway; ctx.lineWidth = 10.6; ctx.stroke();
  if (lod >= 1) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = Math.max(0.4, px(0.9)); ctx.setLineDash([5, 6]); ctx.stroke(); ctx.setLineDash([]); }
  roadPath('bridge'); ctx.strokeStyle = '#6f6a62'; ctx.lineWidth = 11.5; ctx.stroke(); ctx.strokeStyle = '#a9a39a'; ctx.lineWidth = 9.4; ctx.stroke(); ctx.strokeStyle = C.bridge; ctx.lineWidth = 7; ctx.stroke();
}

export function drawNightLights(ctx: CanvasRenderingContext2D, view: View | null, opts: { windows?: boolean; tilt?: number } = {}) {
  const sc = getScenery();
  ctx.fillStyle = 'rgba(255,214,140,0.9)';
  const k = LIFT * (opts.tilt ?? 0);
  // in the tilted view the lit windows sit on the walls, part way up the building
  if (opts.windows !== false) for (const w of sc.windows) { const lift = w.h * k * w.v; const x = w.x + lift * LEAN, y = w.y - lift; if (!visible(view, x, y, 2)) continue; ctx.fillRect(x - w.s / 2, y - w.s / 2, w.s, w.s); }
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

/** the camera tilt of the cached overview: buildings always stand up a little */
export const BASE_TILT = 0.35;

type Pt = { x: number; y: number };
/** an extruded box from height hb to ht above a footprint; walls facing the viewer, then the roof */
function prism(ctx: CanvasRenderingContext2D, p: Pt[], hb: number, ht: number, k: number, roof: string, wallSouth: string, wallSide: string): Pt[] {
  const lb = { x: hb * k * LEAN, y: -hb * k }, lt = { x: ht * k * LEAN, y: -ht * k };
  const b = p.map((q) => ({ x: q.x + lb.x, y: q.y + lb.y })), r = p.map((q) => ({ x: q.x + lt.x, y: q.y + lt.y }));
  const ox = lt.x - lb.x, oy = lt.y - lb.y;
  for (let i = 0; i < p.length; i++) {
    const a = b[i], c = b[(i + 1) % p.length];
    const nx = c.y - a.y, ny = -(c.x - a.x);
    if (-nx * ox - ny * oy <= 0) continue;
    ctx.fillStyle = nt(ny > Math.abs(nx) ? wallSouth : wallSide);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.lineTo(r[(i + 1) % p.length].x, r[(i + 1) % p.length].y); ctx.lineTo(r[i].x, r[i].y); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = nt(roof); ctx.beginPath(); poly(ctx, r); ctx.fill();
  return r;
}
/** a cylinder (tanks, chimneys, towers) */
function cylinder(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, hb: number, ht: number, k: number, top: string, side: string) {
  const bx = x + hb * k * LEAN, by = y - hb * k, tx = x + ht * k * LEAN, ty = y - ht * k;
  ctx.fillStyle = nt(side);
  ctx.beginPath(); ctx.moveTo(bx - rad, by); ctx.lineTo(tx - rad, ty); ctx.lineTo(tx + rad, ty); ctx.lineTo(bx + rad, by); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(bx, by, rad, rad * 0.55, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = nt(top); ctx.beginPath(); ctx.ellipse(tx, ty, rad, rad * 0.55, 0, 0, 7); ctx.fill();
}
const rect = (cx: number, cy: number, w: number, h: number): Pt[] => [{ x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 }];

/**
 * Extruded buildings. Roofs are lifted "up" the screen by height × tilt so the south and east walls
 * show; drawn back to front so nearer blocks overlap farther ones. Used for the cached overview
 * (BASE_TILT) and the live close-up (tilt grows with zoom).
 */
export function drawBuildings3D(ctx: CanvasRenderingContext2D, view: View | null, tilt: number, night: number, scale: number, detail = true, grade = 0) {
  const sc = getScenery();
  NIGHT_A = Math.round(grade * 50) / 50;
  sortedLots ??= [...sc.lots].sort((a, b) => a.cy - b.cy);
  const k = LIFT * tilt;
  const px = (n: number) => n / scale;
  const lit = night > 0.25;
  for (const l of sortedLots) {
    const rise = l.h * k;
    if (!visible(view, l.cx, l.cy - rise, l.r + rise + 4)) continue;
    if (l.style === 'tank') { cylinder(ctx, l.cx, l.cy, l.r, 0, l.h, k, l.roof, shade(l.roof, 0.62)); ctx.strokeStyle = nt(l.edge); ctx.lineWidth = px(0.8); ctx.beginPath(); ctx.ellipse(l.cx + rise * LEAN, l.cy - rise, l.r * 0.6, l.r * 0.33, 0, 0, 7); ctx.stroke(); continue; }
    const p = l.pts;
    const tiered = l.style === 'tower' && l.h > 13;
    const wallS = l.style === 'tower' ? shade(l.roof, 0.8) : shade(l.roof, 0.74), wallE = l.style === 'tower' ? shade(l.roof, 0.92) : shade(l.roof, 0.87);
    let r = prism(ctx, p, 0, tiered ? l.h * 0.62 : l.h, k, l.roof, wallS, wallE);
    // windows on the walls facing the viewer
    if (detail && rise * scale > 9 && l.style !== 'warehouse' && l.style !== 'hangar') windowsOn(ctx, p, tiered ? l.h * 0.62 : l.h, k, l, lit, night);
    if (tiered) {
      const upper = subQuad(p, 0.17, 0.17, 0.83, 0.83);
      ctx.fillStyle = nt(shade(l.roof, 1.12)); ctx.beginPath(); poly(ctx, r); ctx.fill();
      r = prism(ctx, upper, l.h * 0.62, l.h, k, l.roof, shade(l.roof, 0.78), shade(l.roof, 0.95));
      if (detail && rise * scale > 9) windowsOn(ctx, upper, l.h, k, l, lit, night, l.h * 0.62);
    }
    ctx.strokeStyle = nt(l.edge); ctx.lineWidth = Math.max(0.5, px(0.9));
    ctx.beginPath(); ctx.moveTo(r[3].x, r[3].y); ctx.lineTo(r[0].x, r[0].y); ctx.lineTo(r[1].x, r[1].y); ctx.stroke();
    if (!detail) continue;
    roofDetail(ctx, l, r, k, px, lit);
  }
  NIGHT_A = 0;
}

function windowsOn(ctx: CanvasRenderingContext2D, p: Pt[], h: number, k: number, l: Lot, lit: boolean, night: number, hb = 0) {
  const ox = h * k * LEAN, oy = -h * k, bx = hb * k * LEAN, by = -hb * k;
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4];
    const nx = b.y - a.y, ny = -(b.x - a.x);
    if (-nx * (ox - bx) - ny * (oy - by) <= 0) continue;
    const floors = Math.max(1, Math.floor((h - hb) / 2.4));
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const q = (u: number, v: number) => ({ x: a.x + (b.x - a.x) * u + bx + (ox - bx) * v, y: a.y + (b.y - a.y) * u + by + (oy - by) * v });
    const path = new Path2D();
    const quad = (u0: number, u1: number, v0: number, v1: number) => { const w0 = q(u0, v0), w1 = q(u1, v0), w2 = q(u1, v1), w3 = q(u0, v1); path.moveTo(w0.x, w0.y); path.lineTo(w1.x, w1.y); path.lineTo(w2.x, w2.y); path.lineTo(w3.x, w3.y); path.closePath(); };
    if (!lit) {
      for (let f = 0; f < floors; f++) quad(0.06, 0.94, (f + 0.3) / floors, (f + 0.72) / floors);
      ctx.fillStyle = nt(l.style === 'tower' ? 'rgba(52,92,135,0.42)' : 'rgba(60,80,105,0.24)'); ctx.fill(path);
    } else {
      const cols = Math.max(1, Math.floor(len / (l.style === 'tower' ? 3.2 : 4.5)));
      for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) if ((((l.seed + i * 977 + f * 131 + c * 71) * 2654435761) >>> 0) % 100 < 42) quad((c + 0.25) / cols, (c + 0.75) / cols, (f + 0.3) / floors, (f + 0.75) / floors);
      ctx.fillStyle = `rgba(255,212,140,${0.55 + 0.4 * night})`; ctx.fill(path);
    }
  }
}

function roofDetail(ctx: CanvasRenderingContext2D, l: Lot, r: Pt[], k: number, px: (n: number) => number, lit: boolean) {
  const hsh = (n: number) => (((l.seed + n * 7919) * 2654435761) >>> 0) % 1000;
  if (l.style === 'tower') {
    const m = centroid(r);
    if (l.h > 18 && hsh(1) < 350) {
      // rooftop helipad
      ctx.fillStyle = nt('#2a323c'); ctx.beginPath(); ctx.arc(m.x, m.y, Math.min(5, l.r * 0.35), 0, 7); ctx.fill();
      ctx.strokeStyle = nt('rgba(230,236,242,0.8)'); ctx.lineWidth = px(0.9); ctx.stroke();
      ctx.fillStyle = nt('rgba(230,236,242,0.85)'); const hs = Math.min(2.4, l.r * 0.16); ctx.fillRect(m.x - hs, m.y - hs, hs * 0.35, hs * 2); ctx.fillRect(m.x + hs * 0.65, m.y - hs, hs * 0.35, hs * 2); ctx.fillRect(m.x - hs, m.y - hs * 0.18, hs * 2, hs * 0.36);
    } else {
      // plant room and antenna
      const inner = subQuad(r, 0.3, 0.3, 0.7, 0.7);
      prism(ctx, inner, 0, 1.4, k, shade(l.roof, 1.2), shade(l.roof, 0.6), shade(l.roof, 0.8));
      if (hsh(2) < 500) { ctx.strokeStyle = nt('rgba(200,210,220,0.8)'); ctx.lineWidth = px(0.8); ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + 6 * k * LEAN, m.y - 6 * k); ctx.stroke(); }
    }
    if (lit) { ctx.fillStyle = (Math.floor(performance.now() / 900 + l.seed) % 2) ? 'rgba(255,70,70,0.95)' : 'rgba(120,20,20,0.6)'; ctx.beginPath(); ctx.arc(m.x, m.y - 0.5, Math.max(0.6, px(1.6)), 0, 7); ctx.fill(); }
  } else if (l.style === 'office') {
    // HVAC boxes
    for (let i = 0; i < 2 + (hsh(3) % 3); i++) { const c = quadPt(r, 0.2 + ((hsh(10 + i) % 600) / 1000), 0.2 + ((hsh(20 + i) % 600) / 1000)); prism(ctx, rect(c.x, c.y, 2.4, 1.8), 0, 0.9, k, '#9aa3ad', '#7e8792', '#8c95a0'); }
  } else if (l.style === 'house' || l.style === 'terrace') {
    // gabled roof: two planes either side of the ridge
    const a = lerp(r[0], r[3], 0.5), b = lerp(r[1], r[2], 0.5);
    const lift = { x: 1.6 * k * LEAN, y: -1.6 * k };
    const ra = { x: a.x + lift.x, y: a.y + lift.y }, rb = { x: b.x + lift.x, y: b.y + lift.y };
    ctx.fillStyle = nt(shade(l.roof, 1.18)); ctx.beginPath(); ctx.moveTo(r[0].x, r[0].y); ctx.lineTo(r[1].x, r[1].y); ctx.lineTo(rb.x, rb.y); ctx.lineTo(ra.x, ra.y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = nt(shade(l.roof, 0.86)); ctx.beginPath(); ctx.moveTo(ra.x, ra.y); ctx.lineTo(rb.x, rb.y); ctx.lineTo(r[2].x, r[2].y); ctx.lineTo(r[3].x, r[3].y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = nt(shade(l.roof, 0.6)); ctx.lineWidth = Math.max(0.4, px(0.7)); ctx.beginPath(); ctx.moveTo(ra.x, ra.y); ctx.lineTo(rb.x, rb.y); ctx.stroke();
    if (hsh(4) < 450) { const c = lerp(ra, rb, 0.75); prism(ctx, rect(c.x, c.y - 0.8, 1.2, 1.2), 0, 1.4, k, '#8a6a5a', '#6f5548', '#7c6052'); }
  } else if (l.style === 'warehouse' || l.style === 'hangar') {
    ctx.strokeStyle = nt(shade(l.roof, 0.78)); ctx.lineWidth = Math.max(0.4, px(0.7));
    ctx.beginPath(); for (let i = 1; i < 6; i++) { const a = lerp(r[0], r[1], i / 6), b = lerp(r[3], r[2], i / 6); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke();
    if (l.style === 'warehouse') { ctx.fillStyle = nt('rgba(160,200,230,0.18)'); for (let i = 0; i < 3; i++) { const c = quadPt(r, 0.25 + i * 0.25, 0.5); ctx.fillRect(c.x - 1, c.y - 2.5, 2, 5); } }
  } else if (l.style === 'campus') {
    const inner = subQuad(r, 0.22, 0.22, 0.78, 0.78); ctx.fillStyle = nt('#9cc884'); ctx.beginPath(); poly(ctx, inner); ctx.fill();
  }
}

/** landmark buildings and set dressing: hospitals, cathedral, terminal, planes, cranes, ships, trains... */
export function drawModels(ctx: CanvasRenderingContext2D, view: View | null, tilt: number, night: number, scale: number, grade = 0) {
  const sc = getScenery();
  NIGHT_A = Math.round(grade * 50) / 50;
  sortedModels ??= [...sc.models].sort((a, b) => a.y - b.y);
  const k = LIFT * tilt;
  const px = (n: number) => n / scale;
  const lit = night > 0.25;
  const now = performance.now();
  for (const m of sortedModels) {
    if (!visible(view, m.x, m.y - 30 * k, 70)) continue;
    const { x, y } = m;
    const box = (cx: number, cy: number, w: number, d: number, h0: number, h1: number, roof: string, wall: string) => prism(ctx, rect(cx, cy, w, d), h0, h1, k, roof, shade(wall, 0.8), wall);
    const shadow = (w: number, d: number, h: number) => { ctx.fillStyle = nt('rgba(70,58,44,0.22)'); ctx.beginPath(); poly(ctx, rect(x + h * 0.3, y + h * 0.4, w, d)); ctx.fill(); };
    switch (m.kind) {
      case 'hospital': {
        shadow(30, 30, 10);
        box(x, y, 34, 12, 0, 9, '#dfe4ea', '#b9c2cc');
        const top = box(x, y, 12, 32, 0, 11, '#e8edf2', '#c3ccd6');
        const c = centroid(top);
        ctx.fillStyle = nt('#d64545'); ctx.fillRect(c.x - 1.5, c.y - 5, 3, 10); ctx.fillRect(c.x - 5, c.y - 1.5, 10, 3);
        const hp = { x: x + 12 + 9 * k * LEAN, y: y - 9 * k };
        ctx.fillStyle = nt('#2b333d'); ctx.beginPath(); ctx.arc(hp.x, hp.y, 4, 0, 7); ctx.fill(); ctx.strokeStyle = nt(lit ? '#ffd27a' : '#e8edf2'); ctx.lineWidth = px(0.8); ctx.stroke();
        ctx.fillStyle = nt('#e8edf2'); ctx.font = `800 ${5}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', hp.x, hp.y + 0.3);
        break;
      }
      case 'cathedral': {
        shadow(30, 14, 12);
        box(x, y + 2, 32, 10, 0, 8, '#8c7468', '#a8907f');
        box(x + 4, y + 2, 9, 22, 0, 8, '#8c7468', '#a8907f');
        const t = box(x - 13, y + 2, 7, 7, 0, 22, '#7d665b', '#a8907f');
        const c = centroid(t); ctx.fillStyle = nt('#7a6a5f'); ctx.beginPath(); ctx.moveTo(c.x - 3.5, c.y + 1.5); ctx.lineTo(c.x + 3.5, c.y + 1.5); ctx.lineTo(c.x + 2 * k * LEAN * 4, c.y - 10 * k); ctx.closePath(); ctx.fill();
        if (lit) { ctx.fillStyle = 'rgba(255,200,120,0.6)'; ctx.beginPath(); ctx.arc(x, y + 7, 2, 0, 7); ctx.fill(); }
        break;
      }
      case 'clocktower': {
        shadow(10, 10, 26);
        const t = box(x, y, 9, 9, 0, 26, '#9a7a62', '#b39478');
        const c = centroid(t);
        ctx.fillStyle = nt('#e8dcc0'); ctx.beginPath(); ctx.arc(x + 20 * k * LEAN, y + 4.5 - 20 * k, 2.6, 0, 7); ctx.fill();
        ctx.strokeStyle = nt('#3a2e24'); ctx.lineWidth = px(0.6); ctx.beginPath(); ctx.moveTo(x + 20 * k * LEAN, y + 4.5 - 20 * k); ctx.lineTo(x + 20 * k * LEAN, y + 3 - 20 * k); ctx.stroke();
        ctx.fillStyle = nt('#4a3a30'); ctx.beginPath(); ctx.moveTo(t[0].x, t[0].y); ctx.lineTo(t[1].x, t[1].y); ctx.lineTo(c.x + 6 * k * LEAN, c.y - 6 * k); ctx.closePath(); ctx.fill();
        break;
      }
      case 'cityhall': {
        shadow(34, 20, 10);
        const t = box(x, y, 36, 20, 0, 9, '#c9c4b8', '#b1aa9c');
        const c = centroid(t);
        ctx.fillStyle = nt('#d8b25a'); ctx.beginPath(); ctx.ellipse(c.x, c.y, 7, 4.5, 0, 0, Math.PI); ctx.ellipse(c.x, c.y, 7, 7 * k + 2, 0, Math.PI, Math.PI * 2); ctx.fill();
        ctx.fillStyle = nt('rgba(255,255,255,0.35)'); for (let i = -3; i <= 3; i++) ctx.fillRect(x + i * 4.5, y + 10 - 0.5, 1, -7 * k);
        break;
      }
      case 'terminal': {
        shadow(70, 20, 7);
        box(x, y, 74, 18, 0, 7, '#6f8aa3', '#4b6a86');
        ctx.strokeStyle = nt('rgba(220,235,245,0.35)'); ctx.lineWidth = px(0.6); ctx.beginPath(); for (let i = -6; i <= 6; i++) { const xx = x + i * 5.5 + 7 * k * LEAN; ctx.moveTo(xx, y - 9 - 7 * k); ctx.lineTo(xx, y + 9 - 7 * k); } ctx.stroke();
        for (let i = -2; i <= 2; i++) { ctx.strokeStyle = nt('#9aa6b2'); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x + i * 14, y + 9); ctx.lineTo(x + i * 14, y + 17); ctx.stroke(); }
        cylinder(ctx, x + 44, y - 4, 2.2, 0, 26, k, '#9aa6b2', '#6b7885');
        cylinder(ctx, x + 44, y - 4, 4.2, 24, 28, k, lit ? '#ffd88a' : '#7fb0d0', '#4f6f8c');
        break;
      }
      case 'plane': planeSprite(ctx, x, y, m.rot, m.s, k, lit, now); break;
      case 'crane': {
        const leg = (dx: number) => { ctx.strokeStyle = nt('#c96a2c'); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.lineTo(x + dx + 22 * k * LEAN, y - 22 * k); ctx.stroke(); };
        ctx.fillStyle = nt('rgba(0,0,0,0.25)'); ctx.fillRect(x - 6 + 6, y + 4, 14, 26);
        leg(-6); leg(6);
        ctx.strokeStyle = nt('#e07b38'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 8 + 22 * k * LEAN, y - 22 * k - 6); ctx.lineTo(x + 8 + 22 * k * LEAN, y - 22 * k + 30); ctx.stroke();
        ctx.fillStyle = nt('#3d4450'); ctx.fillRect(x - 4 + 22 * k * LEAN, y - 22 * k - 4, 8, 5);
        break;
      }
      case 'ship': {
        ctx.save(); ctx.translate(x, y); ctx.rotate(m.rot); ctx.scale(m.s, m.s);
        ctx.fillStyle = nt('rgba(0,0,0,0.3)'); ctx.beginPath(); ctx.moveTo(-30, 4); ctx.lineTo(24, 4); ctx.lineTo(32, 9); ctx.lineTo(24, 14); ctx.lineTo(-30, 14); ctx.closePath(); ctx.fill();
        ctx.fillStyle = nt(m.seed % 2 ? '#6a2b2b' : '#24425f'); ctx.beginPath(); ctx.moveTo(-30, -5); ctx.lineTo(24, -5); ctx.lineTo(32, 0); ctx.lineTo(24, 5); ctx.lineTo(-30, 5); ctx.closePath(); ctx.fill();
        const cols = ['#7a3b33', '#2f5a7a', '#3f6b45', '#8a6a2e', '#5d4a7a'];
        for (let i = 0; i < 7; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = nt(cols[(i + j + m.seed) % cols.length]); ctx.fillRect(-18 + i * 5.5, -4 + j * 4, 5, 3.6); }
        ctx.fillStyle = nt('#e8edf2'); ctx.fillRect(-28, -4, 7, 8); ctx.fillStyle = nt('#2a3038'); ctx.fillRect(-27, -3, 5, 2);
        if (lit) { ctx.fillStyle = 'rgba(255,220,140,0.9)'; ctx.fillRect(-27, -1, 1, 1); ctx.fillRect(-24, -1, 1, 1); }
        ctx.restore();
        break;
      }
      case 'train': {
        ctx.save(); ctx.translate(x, y); ctx.rotate(m.rot);
        const n = Math.max(3, Math.floor(m.s / 7));
        for (let i = 0; i < n; i++) { const loco = i === 0; ctx.fillStyle = nt('rgba(0,0,0,0.3)'); ctx.fillRect(i * 7 + 1, -1, 6, 4.6); ctx.fillStyle = nt(loco ? '#d6a032' : ['#5a3a2a', '#3d4a5a', '#4a5a3a'][(i + m.seed) % 3]); ctx.fillRect(i * 7, -2.3, 6.2, 4.6); if (loco) { ctx.fillStyle = nt('#2a3038'); ctx.fillRect(4.6, -1.6, 1.2, 3.2); } }
        ctx.restore();
        break;
      }
      case 'factory': {
        shadow(30, 20, 9);
        box(x - 2, y + 2, 30, 18, 0, 8, '#4a5056', '#565e66');
        cylinder(ctx, x + 9, y - 5, 2.2, 0, 24, k, '#2a2e33', '#5a6066');
        cylinder(ctx, x + 15, y - 3, 2, 0, 20, k, '#2a2e33', '#5a6066');
        if (lit) { ctx.fillStyle = 'rgba(255,60,60,0.9)'; ctx.beginPath(); ctx.arc(x + 9 + 24 * k * LEAN, y - 5 - 24 * k, 0.9, 0, 7); ctx.fill(); }
        break;
      }
      case 'lighthouse': {
        cylinder(ctx, x, y, 3, 0, 20, k, '#e8edf2', '#d6dde4');
        for (let i = 0; i < 3; i++) { ctx.fillStyle = nt('#c63a3a'); const yy = y - (4 + i * 6) * k; ctx.fillRect(x - 3 + (4 + i * 6) * k * LEAN, yy - 1.5 * k, 6, 1.6 * k + 0.5); }
        const lx = x + 21 * k * LEAN, ly = y - 21 * k;
        ctx.fillStyle = nt(lit ? '#fff2b0' : '#9fb8c8'); ctx.beginPath(); ctx.arc(lx, ly, 2, 0, 7); ctx.fill();
        if (lit) { const a = now / 1400; ctx.fillStyle = 'rgba(255,240,180,0.12)'; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, 90, a, a + 0.25); ctx.closePath(); ctx.fill(); }
        break;
      }
      case 'gas': {
        shadow(20, 12, 4);
        box(x - 8, y + 4, 10, 8, 0, 4, '#5a6470', '#6b7684');
        const c = box(x + 6, y, 18, 12, 4, 5, '#c63a3a', '#9a2e2e');
        if (lit) { ctx.fillStyle = 'rgba(255,250,220,0.35)'; ctx.beginPath(); poly(ctx, rect(x + 6, y, 16, 10)); ctx.fill(); }
        void c;
        break;
      }
      case 'bank': {
        shadow(28, 18, 10);
        const t = box(x, y, 30, 18, 0, 10, '#d8d4ca', '#c3bdb0');
        ctx.fillStyle = nt('rgba(120,110,95,0.6)'); for (let i = -3; i <= 3; i++) ctx.fillRect(x + i * 4 - 0.5, y + 9, 1, -9 * k);
        ctx.fillStyle = nt('#b8b0a0'); ctx.beginPath(); ctx.moveTo(t[3].x, t[3].y); ctx.lineTo(t[2].x, t[2].y); ctx.lineTo((t[2].x + t[3].x) / 2, t[3].y - 4 * k); ctx.closePath(); ctx.fill();
        break;
      }
      case 'mall': case 'market': {
        shadow(40, 26, 6);
        const t = box(x, y, 40, 26, 0, 6, m.kind === 'market' ? '#6b4a3a' : '#59636f', m.kind === 'market' ? '#7d5a46' : '#6c7784');
        ctx.fillStyle = nt('rgba(170,210,235,0.35)'); for (let i = 0; i < 4; i++) { const c = quadPt(t, 0.2 + i * 0.2, 0.5); ctx.fillRect(c.x - 2, c.y - 6, 4, 12); }
        break;
      }
      case 'school': case 'library': {
        shadow(30, 20, 6);
        box(x - 6, y, 26, 10, 0, 6, '#7a5a48', '#8a6a55');
        box(x + 10, y + 4, 10, 18, 0, 6, '#7a5a48', '#8a6a55');
        ctx.fillStyle = nt('#2d5a3a'); ctx.fillRect(x - 18, y + 8, 14, 9);
        break;
      }
      case 'station': {
        shadow(46, 18, 7);
        const t = box(x, y, 48, 18, 0, 7, '#5c6a78', '#6e7d8c');
        ctx.strokeStyle = nt('rgba(200,220,235,0.4)'); ctx.lineWidth = px(0.7); ctx.beginPath(); for (let i = 1; i < 10; i++) { const a = lerp(t[0], t[1], i / 10), b = lerp(t[3], t[2], i / 10); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke();
        break;
      }
      case 'supertall': {
        shadow(16, 16, 40);
        box(x, y, 18, 18, 0, 24, '#2d3e55', '#3a5070');
        box(x, y, 13, 13, 24, 36, '#34485f', '#456183');
        const t = box(x, y, 8, 8, 36, 44, '#3a5068', '#4d6a8a');
        const c = centroid(t);
        ctx.strokeStyle = nt('#c8d4de'); ctx.lineWidth = px(1); ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + 10 * k * LEAN, c.y - 10 * k); ctx.stroke();
        if (lit) { ctx.fillStyle = (Math.floor(now / 700) % 2) ? '#ff4d4d' : '#701c1c'; ctx.beginPath(); ctx.arc(c.x + 10 * k * LEAN, c.y - 10 * k, 1.2, 0, 7); ctx.fill(); }
        break;
      }
      case 'stadium': {
        if (!m.pts) break;
        const w = Math.hypot(m.pts[1].x - m.pts[0].x, m.pts[1].y - m.pts[0].y) / 2, h = Math.hypot(m.pts[3].x - m.pts[0].x, m.pts[3].y - m.pts[0].y) / 2;
        const lift = 7 * k;
        ctx.fillStyle = nt('#4b525c'); ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI); ctx.lineTo(x - w + lift * LEAN, y - lift); ctx.ellipse(x + lift * LEAN, y - lift, w, h, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
        ctx.fillStyle = nt('#6a3a3a'); ctx.beginPath(); ctx.ellipse(x + lift * LEAN, y - lift, w, h, 0, 0, 7); ctx.fill();
        ctx.fillStyle = nt('#2f7a46'); ctx.beginPath(); ctx.ellipse(x + lift * LEAN * 0.4, y - lift * 0.4, w * 0.66, h * 0.56, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = nt('rgba(255,255,255,0.4)'); ctx.lineWidth = px(0.7); ctx.strokeRect(x + lift * LEAN * 0.4 - w * 0.45, y - lift * 0.4 - h * 0.35, w * 0.9, h * 0.7);
        if (lit) for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.fillStyle = 'rgba(255,255,230,0.9)'; ctx.beginPath(); ctx.arc(x + dx * w * 0.95 + 14 * k * LEAN, y + dy * h * 0.95 - 14 * k, 1.6, 0, 7); ctx.fill(); }
        break;
      }
      case 'ctower': break;
    }
  }
  NIGHT_A = 0;
}
let sortedModels: Model[] | null = null;

function planeSprite(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, s: number, k: number, lit: boolean, now: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  const draw = (fill: string, dx: number, dy: number) => {
    ctx.fillStyle = nt(fill);
    ctx.beginPath(); ctx.ellipse(dx, dy, 14, 2.3, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(dx - 2, dy); ctx.lineTo(dx + 3, dy - 12); ctx.lineTo(dx + 6, dy - 12); ctx.lineTo(dx + 4, dy); ctx.lineTo(dx + 6, dy + 12); ctx.lineTo(dx + 3, dy + 12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(dx - 12, dy); ctx.lineTo(dx - 10, dy - 5); ctx.lineTo(dx - 8.5, dy - 5); ctx.lineTo(dx - 9, dy); ctx.lineTo(dx - 8.5, dy + 5); ctx.lineTo(dx - 10, dy + 5); ctx.closePath(); ctx.fill();
  };
  draw('rgba(0,0,0,0.3)', 2, 3);
  draw('#e8edf2', 0, -0.5 * k);
  ctx.fillStyle = nt('#2f5a8a'); ctx.fillRect(-10, -0.8 - 0.5 * k, 20, 1.2);
  if (lit && Math.floor(now / 600) % 2) { ctx.fillStyle = nt('#ff4d4d'); ctx.beginPath(); ctx.arc(4.5, -12, 0.8, 0, 7); ctx.fill(); ctx.fillStyle = nt('#4dff7a'); ctx.beginPath(); ctx.arc(4.5, 12, 0.8, 0, 7); ctx.fill(); }
  ctx.restore();
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
