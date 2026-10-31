// 3D vehicle models for every unit type, built from simple solids at real-world proportions
// (one world unit is 4 m). Light bars are separate meshes so they can flash.
import * as THREE from 'three';
import { LIVERIES, modelFor } from '../vehicles';
import { Geo, lin, mul, type C3 } from './geo';

export interface Vehicle3D {
  group: THREE.Group;
  /** light-bar halves that alternate */ barA: THREE.Mesh[]; barB: THREE.Mesh[];
  /** head and tail lights */ lamps: THREE.Mesh[];
  rotor?: THREE.Object3D; tailRotor?: THREE.Object3D;
  len: number; wid: number; height: number; air: boolean; colA: THREE.Color; colB: THREE.Color;
}

const SHAPE: Record<string, { kind?: string; len?: number; wid?: number }> = {
  interceptor: { len: 31, wid: 14 }, suv: { kind: 'suv', len: 32, wid: 15 }, armoured: { kind: 'van', len: 35, wid: 16 },
  rapid: { len: 35, wid: 15 }, heavy: { len: 46, wid: 17 }, rapid_med: { kind: 'suv', len: 31, wid: 14 }, box: { len: 40, wid: 16 }, offroad: { kind: 'suv', len: 34, wid: 15 },
};
const LEN = 0.05, WID = 0.046;

const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.28 });
const wheelGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.11, 10).rotateX(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 });
const lampGeo = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** an emissive lamp material; `on` ones are bright enough to bloom */
export function lampMat(hex: string, on: boolean): THREE.MeshStandardMaterial {
  const key = hex + on;
  let m = matCache.get(key);
  if (!m) {
    const c = new THREE.Color(hex);
    m = new THREE.MeshStandardMaterial({ color: on ? c : c.clone().multiplyScalar(0.35), emissive: c, emissiveIntensity: on ? 3 : 0.06, roughness: 0.3 });
    matCache.set(key, m);
  }
  return m;
}
const cache = new Map<string, { geo: THREE.BufferGeometry; spec: Spec }>();
interface Spec { len: number; wid: number; h: number; bars: Array<{ x: number; y: number; z: number; w: number; d: number; side: 0 | 1 }>; wheels: Array<[number, number]>; heads: Array<[number, number, number]>; tails: Array<[number, number, number]>; air?: boolean }

export function makeVehicle(type: string, service: string, livery?: string, chassis?: string): Vehicle3D {
  const base = modelFor(type, service);
  const sh = chassis ? SHAPE[chassis] : undefined;
  const m = { ...base, ...(sh ?? {}) } as typeof base;
  const lv = livery && livery !== 'classic' ? LIVERIES[service]?.find((x) => x.id === livery) : undefined;
  const body = lv?.body ?? m.body, roof = lv?.roof ?? m.roof, accent = lv?.accent ?? m.accent;
  const key = `${type}|${service}|${lv?.id ?? ''}|${chassis ?? ''}`;
  let hit = cache.get(key);
  if (!hit) { hit = buildBody(type === 'helicopter' ? 'heli' : m.kind, m.len * LEN, m.wid * WID, lin(body), lin(roof), lin(accent), m.livery, type); cache.set(key, hit); }
  const { geo, spec } = hit;
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geo, bodyMat); mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  for (const [x, z] of spec.wheels) { const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(x, 0.14, z); w.castShadow = true; group.add(w); }
  const barA: THREE.Mesh[] = [], barB: THREE.Mesh[] = [], lamps: THREE.Mesh[] = [];
  const colA = new THREE.Color(m.bar[0]), colB = new THREE.Color(m.bar[1]);
  for (const b of spec.bars) {
    const lm = new THREE.Mesh(lampGeo, lampMat(b.side ? m.bar[1] : m.bar[0], false));
    lm.scale.set(b.w, 0.07, b.d); lm.position.set(b.x, b.y, b.z);
    (b.side ? barB : barA).push(lm); group.add(lm);
  }
  for (const [x, y, z] of spec.heads) { const l = new THREE.Mesh(lampGeo, lampMat('#fff4dc', false)); l.scale.set(0.03, 0.06, 0.12); l.position.set(x, y, z); l.userData.head = true; lamps.push(l); group.add(l); }
  for (const [x, y, z] of spec.tails) { const l = new THREE.Mesh(lampGeo, lampMat('#ff2a2a', false)); l.scale.set(0.03, 0.06, 0.12); l.position.set(x, y, z); lamps.push(l); group.add(l); }
  const v: Vehicle3D = { group, barA, barB, lamps, len: spec.len, wid: spec.wid, height: spec.h, air: !!spec.air, colA, colB };
  if (spec.air) {
    const rotor = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.02, 0.09), new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.6 }));
    rotor.add(blade); const b2 = blade.clone(); b2.rotation.y = Math.PI / 2; rotor.add(b2);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a1d22, transparent: true, opacity: 0.18, depthWrite: false }));
    rotor.add(disc); rotor.position.set(0.05, 0.62, 0); group.add(rotor); v.rotor = rotor;
    const tr = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.04), blade.material); tr.position.set(-1.2, 0.42, 0.06); tr.rotation.x = Math.PI / 2; group.add(tr); v.tailRotor = tr;
  }
  return v;
}

function buildBody(kind: string, L: number, W: number, body: C3, roof: C3, accent: C3, livery: string | undefined, type: string): { geo: THREE.BufferGeometry; spec: Spec } {
  const g = new Geo();
  const glass = lin('#1d2733'), dark = lin('#22262b'), chrome = lin('#c9ced4');
  const hl = L / 2, hw = W / 2;
  const spec: Spec = { len: L, wid: W, h: 0.7, bars: [], wheels: [], heads: [], tails: [] };
  const stripe = (x0: number, x1: number, y0: number, y1: number, col: C3) => { for (const s of [-1, 1]) g.quad([x0, y0, s * (hw + 0.004)], [x1, y0, s * (hw + 0.004)], [x1, y1, s * (hw + 0.004)], [x0, y1, s * (hw + 0.004)], col, [0, 0, s]); };
  const lightbar = (x: number, y: number, w: number) => { g.box(x, 0, 0.12, w + 0.04, y, y + 0.03, 0, dark); spec.bars.push({ x, y: y + 0.065, z: -w / 4, w: 0.11, d: w / 2 - 0.01, side: 0 }, { x, y: y + 0.065, z: w / 4, w: 0.11, d: w / 2 - 0.01, side: 1 }); };
  switch (kind) {
    case 'car': case 'suv': {
      const suv = kind === 'suv';
      const top = suv ? 0.5 : 0.4;
      g.box(0, 0, L, W, 0.13, top, 0, body, body, undefined, 0.7);
      // bonnet and boot slope slightly lower than the cabin line
      const cl = suv ? L * 0.62 : L * 0.5, cx = suv ? -L * 0.06 : -L * 0.04, ch = suv ? 0.28 : 0.24;
      g.box(cx, 0, cl, W * 0.9, top, top + ch, 0, glass, roof);
      g.box(cx, 0, cl * 0.82, W * 0.86, top + ch - 0.005, top + ch + 0.012, 0, roof, roof);
      if (livery === 'police' || livery === 'traffic') stripe(-hl * 0.55, hl * 0.62, 0.2, 0.33, accent);
      if (livery === 'traffic') stripe(-hl * 0.95, hl * 0.95, 0.15, 0.2, lin('#ffd23a'));
      lightbar(cx, top + ch + 0.012, W * 0.8);
      spec.wheels.push([L * 0.32, hw - 0.03], [L * 0.32, -hw + 0.03], [-L * 0.32, hw - 0.03], [-L * 0.32, -hw + 0.03]);
      spec.heads.push([hl, top - 0.06, hw * 0.65], [hl, top - 0.06, -hw * 0.65]); spec.tails.push([-hl, top - 0.06, hw * 0.7], [-hl, top - 0.06, -hw * 0.7]);
      spec.h = top + ch + 0.08;
      break;
    }
    case 'van': {
      g.box(0, 0, L, W, 0.13, 0.86, 0, body, roof, undefined, 0.72);
      g.box(hl - 0.2, 0, 0.32, W * 0.94, 0.5, 0.8, 0, glass, glass);
      stripe(-hl * 0.9, hl * 0.6, 0.38, 0.48, accent);
      if (livery === 'eod') stripe(-hl * 0.9, hl * 0.6, 0.55, 0.6, lin('#ffd23a'));
      lightbar(hl - 0.28, 0.86, W * 0.8);
      spec.wheels.push([L * 0.32, hw - 0.03], [L * 0.32, -hw + 0.03], [-L * 0.32, hw - 0.03], [-L * 0.32, -hw + 0.03]);
      spec.heads.push([hl, 0.38, hw * 0.65], [hl, 0.38, -hw * 0.65]); spec.tails.push([-hl, 0.4, hw * 0.7], [-hl, 0.4, -hw * 0.7]);
      spec.h = 0.95;
      break;
    }
    case 'engine': case 'ladder': case 'rescue': {
      const cabL = Math.min(0.55, L * 0.22);
      g.box(hl - cabL / 2, 0, cabL, W, 0.16, 0.92, 0, body, body, undefined, 0.72);
      g.box(hl - cabL * 0.35, 0, cabL * 0.55, W * 0.96, 0.6, 0.88, 0, glass, body);
      const bodyH = kind === 'rescue' ? 1.0 : 0.88;
      g.box(-cabL / 2, 0, L - cabL, W, 0.16, bodyH, 0, body, kind === 'rescue' ? roof : lin('#9aa1a8'), undefined, 0.72);
      // roller-shutter lockers along both sides
      for (let k = 0; k < 4; k++) { const x0 = -hl + 0.08 + k * (L - cabL - 0.16) / 4, x1 = x0 + (L - cabL - 0.16) / 4 - 0.04; stripe(x0, x1, 0.3, bodyH - 0.1, mul(body, 0.82)); }
      stripe(-hl, hl, 0.22, 0.27, accent);
      if (kind === 'ladder') {
        g.cyl(-hl + 0.45, 0, 0.26, 0.26, 0.88, 1.02, 10, chrome);
        for (const s of [-0.16, 0.16]) g.box(0.05, s, L * 0.92, 0.05, 1.02, 1.1, 0, chrome);
        for (let k = 0; k < 14; k++) g.box(-L * 0.42 + k * L * 0.065, 0, 0.03, 0.34, 1.04, 1.07, 0, chrome);
      } else if (kind === 'engine') { g.box(-cabL / 2 - 0.1, 0, L * 0.5, W * 0.6, bodyH, bodyH + 0.08, 0, lin('#6e7378')); }
      lightbar(hl - cabL * 0.4, 0.92, W * 0.86);
      spec.bars.push({ x: -hl + 0.06, y: bodyH + 0.04, z: -hw + 0.08, w: 0.08, d: 0.08, side: 0 }, { x: -hl + 0.06, y: bodyH + 0.04, z: hw - 0.08, w: 0.08, d: 0.08, side: 1 });
      spec.wheels.push([hl - cabL * 0.6, hw - 0.04], [hl - cabL * 0.6, -hw + 0.04], [-L * 0.2, hw - 0.04], [-L * 0.2, -hw + 0.04], [-L * 0.36, hw - 0.04], [-L * 0.36, -hw + 0.04]);
      spec.heads.push([hl, 0.4, hw * 0.7], [hl, 0.4, -hw * 0.7]); spec.tails.push([-hl, 0.4, hw * 0.75], [-hl, 0.4, -hw * 0.75]);
      spec.h = kind === 'ladder' ? 1.15 : 1.02;
      break;
    }
    case 'ambulance': {
      const cabL = L * 0.26;
      g.box(hl - cabL / 2, 0, cabL, W * 0.94, 0.14, 0.72, 0, body, body, undefined, 0.75);
      g.box(hl - cabL * 0.35, 0, cabL * 0.5, W * 0.9, 0.46, 0.7, 0, glass, body);
      g.box(-cabL / 2, 0, L - cabL, W, 0.14, 0.98, 0, body, roof, undefined, 0.75);
      stripe(-hl, hl - cabL, 0.42, 0.56, accent);
      stripe(-hl, hl - cabL, 0.3, 0.34, lin('#2f7bff'));
      g.box(-cabL / 2, 0, 0.5, 0.5, 0.98, 1.0, 0, lin('#2f7bff'), lin('#2f7bff'));
      spec.bars.push({ x: hl - cabL - 0.04, y: 1.0, z: -hw + 0.06, w: 0.08, d: 0.1, side: 0 }, { x: hl - cabL - 0.04, y: 1.0, z: hw - 0.06, w: 0.08, d: 0.1, side: 1 }, { x: -hl + 0.04, y: 1.0, z: -hw + 0.06, w: 0.08, d: 0.1, side: 1 }, { x: -hl + 0.04, y: 1.0, z: hw - 0.06, w: 0.08, d: 0.1, side: 0 });
      lightbar(hl - cabL * 0.45, 0.72, W * 0.7);
      spec.wheels.push([hl - cabL * 0.5, hw - 0.03], [hl - cabL * 0.5, -hw + 0.03], [-L * 0.3, hw - 0.03], [-L * 0.3, -hw + 0.03]);
      spec.heads.push([hl, 0.36, hw * 0.65], [hl, 0.36, -hw * 0.65]); spec.tails.push([-hl, 0.4, hw * 0.75], [-hl, 0.4, -hw * 0.75]);
      spec.h = 1.05;
      break;
    }
    case 'bike': {
      g.box(0, 0, L * 0.9, W * 0.5, 0.14, 0.32, 0, body);
      g.box(-L * 0.08, 0, L * 0.34, W * 0.7, 0.32, 0.62, 0, lin('#1e2a3a'));
      g.box(-L * 0.08, 0, L * 0.18, W * 0.6, 0.62, 0.74, 0, lin('#f1f4f8'));
      stripe(-L * 0.4, L * 0.4, 0.2, 0.26, accent);
      spec.bars.push({ x: L * 0.3, y: 0.42, z: -0.05, w: 0.05, d: 0.05, side: 0 }, { x: L * 0.3, y: 0.42, z: 0.05, w: 0.05, d: 0.05, side: 1 });
      spec.wheels.push([L * 0.38, 0], [-L * 0.38, 0]);
      spec.heads.push([hl, 0.34, 0]); spec.tails.push([-hl, 0.32, 0]);
      spec.h = 0.78;
      break;
    }
    case 'bicycle': {
      g.box(0, 0, L * 0.85, 0.04, 0.12, 0.3, 0, lin('#2a2f36'));
      g.box(-L * 0.05, 0, L * 0.3, 0.16, 0.3, 0.6, 0, lin('#d8ff3a'));
      g.box(-L * 0.05, 0, L * 0.18, 0.14, 0.6, 0.7, 0, lin('#1e2a3a'));
      spec.wheels.push([L * 0.36, 0], [-L * 0.36, 0]);
      spec.h = 0.72;
      break;
    }
    case 'foot': {
      for (const z of [-0.14, 0.14]) {
        g.cyl(0, z, 0.08, 0.08, 0, 0.26, 8, lin('#1e2a3a'));
        g.cyl(0, z, 0.1, 0.09, 0.26, 0.48, 8, lin('#d8ff3a'));
        g.cyl(0, z, 0.06, 0.06, 0.48, 0.58, 8, lin('#e0b89a'));
        g.cyl(0, z, 0.07, 0.07, 0.58, 0.62, 8, lin('#16233a'));
      }
      spec.h = 0.62;
      break;
    }
    case 'heli': {
      const y0 = 0;
      g.box(0.15, 0, 1.0, 0.42, y0 + 0.08, y0 + 0.5, 0, body, roof, undefined, 0.8);
      g.box(0.5, 0, 0.34, 0.38, y0 + 0.16, y0 + 0.46, 0, glass, glass);
      g.box(-0.85, 0, 1.0, 0.1, y0 + 0.3, y0 + 0.4, 0, body);
      g.box(-1.3, 0, 0.22, 0.05, y0 + 0.3, y0 + 0.66, 0, accent);
      for (const s of [-0.2, 0.2]) g.box(0.15, s, 1.1, 0.04, y0, y0 + 0.04, 0, dark);
      g.cyl(0.05, 0, 0.06, 0.06, y0 + 0.5, y0 + 0.62, 6, dark);
      spec.bars.push({ x: -0.2, y: 0.09, z: 0, w: 0.08, d: 0.08, side: 0 }, { x: -1.36, y: 0.66, z: 0, w: 0.06, d: 0.06, side: 1 });
      spec.air = true; spec.h = 0.7;
      break;
    }
    default: {
      g.box(0, 0, L, W, 0.13, 0.8, 0, body, roof);
      spec.wheels.push([L * 0.32, hw - 0.03], [L * 0.32, -hw + 0.03], [-L * 0.32, hw - 0.03], [-L * 0.32, -hw + 0.03]);
      spec.h = 0.85;
    }
  }
  return { geo: g.build(), spec };
}

/** a generic civilian car body, white paint so instance colour sets the paint */
export function civilianCarGeometry(): THREE.BufferGeometry {
  const g = new Geo();
  const L = 1.32, W = 0.6, hl = L / 2;
  const white = lin('#ffffff'), glass = lin('#2a333d', 0.35), tyre = lin('#151719', 0.1);
  g.box(0, 0, L, W, 0.12, 0.36, 0, white, white, undefined, 0.75);
  g.box(-0.05, 0, L * 0.5, W * 0.9, 0.36, 0.56, 0, glass, white);
  for (const [x, z] of [[hl * 0.64, W / 2 - 0.02], [hl * 0.64, -W / 2 + 0.02], [-hl * 0.64, W / 2 - 0.02], [-hl * 0.64, -W / 2 + 0.02]]) g.box(x, z, 0.26, 0.08, 0.02, 0.22, 0, tyre);
  return g.build();
}
/** head and tail lights for the civilian car instances (unlit material, brightened at night) */
export function civilianLampGeometry(): THREE.BufferGeometry {
  const g = new Geo();
  const L = 1.32, W = 0.6, hl = L / 2;
  for (const s of [-1, 1]) { g.box(hl + 0.01, s * W * 0.32, 0.03, 0.12, 0.24, 0.3, 0, lin('#fff1cc', 2)); g.box(-hl - 0.01, s * W * 0.34, 0.03, 0.12, 0.24, 0.3, 0, lin('#ff3030', 1.4)); }
  return g.build();
}
