// A tiny mesh builder for the procedural city: quads, triangles, boxes, prisms and cylinders with
// per-vertex colour plus two custom attributes the city shader reads:
//   aWin = (u along the wall, height above the ground, window style, seed)
//   aExt = (emissive at night, district index + 1, surface type, building height)
import * as THREE from 'three';

export type V3 = [number, number, number];
export type C3 = [number, number, number];
export const Z4: [number, number, number, number] = [0, 0, 0, 0];

const tmp = new THREE.Color();
const memo = new Map<string, C3>();
/** sRGB hex → linear working colour, optionally brightened/darkened */
export function lin(hex: string, f = 1): C3 {
  const key = hex + f;
  const hit = memo.get(key);
  if (hit) return hit;
  tmp.set(hex);
  const out: C3 = [tmp.r * f, tmp.g * f, tmp.b * f];
  memo.set(key, out);
  return out;
}
export const mul = (c: C3, f: number): C3 => [c[0] * f, c[1] * f, c[2] * f];

/** surface types understood by the city shader */
export const SURF = { none: 0, asphalt: 1, grass: 2, paving: 3, tiles: 4, gravel: 5, water: 6 } as const;
/** window styles understood by the city shader */
export const WIN = { none: 0, office: 1, curtain: 2, house: 3, shed: 4, stone: 5 } as const;

export class Geo {
  p: number[] = []; n: number[] = []; c: number[] = []; w: number[] = []; e: number[] = []; i: number[] = [];
  /** extra attributes applied to every vertex added from now on */
  ext: [number, number, number, number] = [0, 0, 0, 0];

  private v(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: C3, w: readonly number[]) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(c[0], c[1], c[2]);
    this.w.push(w[0], w[1], w[2], w[3]); this.e.push(this.ext[0], this.ext[1], this.ext[2], this.ext[3]);
    return this.p.length / 3 - 1;
  }

  /** a planar quad; `out` is the side it should face (winding is fixed up to match) */
  quad(a: V3, b: V3, c: V3, d: V3, col: C3 | [C3, C3, C3, C3], out: V3, win?: [readonly number[], readonly number[], readonly number[], readonly number[]]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    const cols = (Array.isArray(col[0]) ? col : [col, col, col, col]) as [C3, C3, C3, C3];
    const ws = win ?? [Z4, Z4, Z4, Z4];
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) {
      nx = -nx; ny = -ny; nz = -nz;
      const i0 = this.v(...a, nx, ny, nz, cols[0], ws[0]), i3 = this.v(...d, nx, ny, nz, cols[3], ws[3]), i2 = this.v(...c, nx, ny, nz, cols[2], ws[2]), i1 = this.v(...b, nx, ny, nz, cols[1], ws[1]);
      this.i.push(i0, i3, i2, i0, i2, i1);
    } else {
      const i0 = this.v(...a, nx, ny, nz, cols[0], ws[0]), i1 = this.v(...b, nx, ny, nz, cols[1], ws[1]), i2 = this.v(...c, nx, ny, nz, cols[2], ws[2]), i3 = this.v(...d, nx, ny, nz, cols[3], ws[3]);
      this.i.push(i0, i1, i2, i0, i2, i3);
    }
  }
  tri(a: V3, b: V3, c: V3, col: C3, out: V3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    let B = b, C = c;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { nx = -nx; ny = -ny; nz = -nz; B = c; C = b; }
    const i0 = this.v(...a, nx, ny, nz, col, Z4), i1 = this.v(...B, nx, ny, nz, col, Z4), i2 = this.v(...C, nx, ny, nz, col, Z4);
    this.i.push(i0, i1, i2);
  }
  /** a flat convex polygon in the ground plane at height y (map coords x, z) */
  flat(pts: Array<{ x: number; y: number }>, y: number, col: C3) {
    if (pts.length < 3) return;
    for (let k = 1; k < pts.length - 1; k++) this.tri([pts[0].x, y, pts[0].y], [pts[k].x, y, pts[k].y], [pts[k + 1].x, y, pts[k + 1].y], col, [0, 1, 0]);
  }
  /** a ribbon of width w along a→b in the ground plane, trimmed by t0/t1 world units at each end */
  ribbon(ax: number, az: number, bx: number, bz: number, w: number, y: number, col: C3, t0 = 0, t1 = 0, offset = 0) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    const sx = ax + ux * t0 + nx * offset, sz = az + uz * t0 + nz * offset, ex = bx - ux * t1 + nx * offset, ez = bz - uz * t1 + nz * offset;
    if ((L - t0 - t1) <= 0.01) return;
    const h = w / 2;
    this.quad([sx + nx * h, y, sz + nz * h], [ex + nx * h, y, ez + nz * h], [ex - nx * h, y, ez - nz * h], [sx - nx * h, y, sz - nz * h], col, [0, 1, 0]);
  }
  /** an oriented box: centre (x, z), size along its own axes, from y0 to y1, rotated by `rot` about Y */
  box(x: number, z: number, w: number, d: number, y0: number, y1: number, rot: number, wall: C3, top: C3 = wall, win?: { style: number; seed: number }, bottomShade = 0.78) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (u: number, v: number): [number, number] => [x + u * c - v * s, z + u * s + v * c];
    const pts = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
    this.prism(pts.map(([px, pz]) => ({ x: px, y: pz })), y0, y1, wall, top, win, bottomShade);
  }
  /** walls + flat top over a convex footprint (map coords); window coords run along each wall */
  prism(pts: Array<{ x: number; y: number }>, y0: number, y1: number, wall: C3, top: C3 | null, win?: { style: number; seed: number }, bottomShade = 0.78) {
    const n = pts.length;
    const cx = pts.reduce((s, p) => s + p.x, 0) / n, cz = pts.reduce((s, p) => s + p.y, 0) / n;
    const lo = mul(wall, bottomShade);
    const H = y1 - y0;
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n];
      const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ww = (u: number, h: number) => (win ? [u, h, win.style, win.seed] : Z4) as readonly number[];
      this.quad([a.x, y0, a.y], [b.x, y0, b.y], [b.x, y1, b.y], [a.x, y1, a.y], [lo, lo, wall, wall], [mx - cx, 0, mz - cz], [ww(0, y0), ww(len, y0), ww(len, y0 + H), ww(0, y0 + H)]);
    }
    if (top) this.flat(pts, y1, top);
  }
  /** an upright cylinder (or cone/frustum when r1 differs) */
  cyl(x: number, z: number, r0: number, r1: number, y0: number, y1: number, seg: number, col: C3, top: C3 | null = col) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const p = (a: number, r: number, y: number): V3 => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
      const am = (a0 + a1) / 2;
      if (r1 > 0.001) this.quad(p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y1), p(a0, r1, y1), [mul(col, 0.8), mul(col, 0.8), col, col], [Math.cos(am), 0.2, Math.sin(am)]);
      else this.tri(p(a0, r0, y0), p(a1, r0, y0), [x, y1, z], col, [Math.cos(am), 0.4, Math.sin(am)]);
      if (top && r1 > 0.001) this.tri([x, y1, z], p(a0, r1, y1), p(a1, r1, y1), top, [0, 1, 0]);
    }
  }
  /** a pitched roof over a rectangle-ish footprint (pts in order), ridge along the longer side */
  gable(pts: Array<{ x: number; y: number }>, y0: number, rise: number, roof: C3, gableWall: C3) {
    let [a, b, c, d] = pts;
    if (Math.hypot(b.x - a.x, b.y - a.y) < Math.hypot(d.x - a.x, d.y - a.y)) [a, b, c, d] = [b, c, d, a];
    const m1 = { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 }, m2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    const y1 = y0 + rise;
    const cx = (a.x + c.x) / 2, cz = (a.y + c.y) / 2;
    const side1 = { x: (a.x + b.x) / 2 - cx, y: (a.y + b.y) / 2 - cz }, side2 = { x: (c.x + d.x) / 2 - cx, y: (c.y + d.y) / 2 - cz };
    const r1 = mul(roof, 1.06), r2 = mul(roof, 0.86);
    this.ext[2] = SURF.tiles;
    this.quad([a.x, y0, a.y], [b.x, y0, b.y], [m2.x, y1, m2.y], [m1.x, y1, m1.y], r1, [side1.x, rise * 1.5, side1.y], [[0, 0, 0, 0], [0, 0, 0, 0], [Math.hypot(m2.x - b.x, m2.y - b.y), 0, 0, 0], [Math.hypot(m1.x - a.x, m1.y - a.y), 0, 0, 0]]);
    this.quad([d.x, y0, d.y], [c.x, y0, c.y], [m2.x, y1, m2.y], [m1.x, y1, m1.y], r2, [side2.x, rise * 1.5, side2.y], [[0, 0, 0, 0], [0, 0, 0, 0], [Math.hypot(m2.x - c.x, m2.y - c.y), 0, 0, 0], [Math.hypot(m1.x - d.x, m1.y - d.y), 0, 0, 0]]);
    this.ext[2] = SURF.none;
    this.tri([a.x, y0, a.y], [d.x, y0, d.y], [m1.x, y1, m1.y], gableWall, [m1.x - m2.x, 0, m1.y - m2.y]);
    this.tri([b.x, y0, b.y], [c.x, y0, c.y], [m2.x, y1, m2.y], gableWall, [m2.x - m1.x, 0, m2.y - m1.y]);
  }

  get empty() { return this.i.length === 0; }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aWin', new THREE.Float32BufferAttribute(this.w, 4));
    g.setAttribute('aExt', new THREE.Float32BufferAttribute(this.e, 4));
    g.setIndex(this.i.length > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
