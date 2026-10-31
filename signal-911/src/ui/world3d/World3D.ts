// The cinematic 3D view of Ravenport (three.js). The camera is a tilted orthographic camera, so the
// ground plane maps to the screen with a plain affine transform: every 2D overlay (pins, routes,
// sectors, labels) and every click handler keeps working on top of real 3D geometry.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { getCity, WORLD_H, WORLD_W, type City } from '../../sim/city';
import { isAir } from '../../sim/fleet';
import type { GameEngine } from '../../sim/engine';
import type { GameState, Incident, Station, Unit } from '../../sim/types';
import { CAR_COLORS, getLanes, getScenery, hash, laneAt, quadPt, type Lot } from '../scenery';
import { buildCity, DECK, ROAD } from './build';
import { Geo, SURF, WIN, lin } from './geo';
import { civilianCarGeometry, civilianLampGeometry, lampMat, makeVehicle, type Vehicle3D } from './vehicles3d';
import { atStation, slotOf, stationLayout, VisualFleet, type StationLayout } from '../stationsLayout';

export interface Frame3D {
  engine: GameEngine; cx: number; cy: number; z: number; W: number; H: number; pitch: number; dpr: number;
  hour: number; night: number; dusk: number; tSec: number; now: number; active: Set<string>; motion: boolean;
  showTraffic: boolean; parkedAtBase: (st: GameState, u: Unit) => boolean;
}
export interface UnitPose { x: number; y: number; h: number; top: number; heading: number }

/** pitch of the camera (radians from straight down) for a zoom level */
export function pitchFor(z: number, fit: number): number {
  const t = Math.max(0, Math.min(1, (z - fit * 1.15) / (4.5 - fit * 1.15)));
  return (0.38 + 0.5 * t * t * (3 - 2 * t));
}

const U = {
  uNight: { value: 0 }, uTime: { value: 0 }, uSnow: { value: 0 }, uWet: { value: 0 },
  uLocked: { value: new Array(16).fill(0) as number[] },
};

const COMMON = /* glsl */`
uniform float uNight; uniform float uTime; uniform float uSnow; uniform float uWet; uniform float uLocked[16];
varying vec4 vWin; varying vec4 vExt; varying vec3 vWPos; varying vec3 vWNormal;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); float a = h21(i), b = h21(i + vec2(1.,0.)), c = h21(i + vec2(0.,1.)), d = h21(i + vec2(1.,1.)); vec2 u = f * f * (3. - 2. * f); return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); }
`;

function patchCity(mat: THREE.MeshStandardMaterial, water: boolean) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aWin; attribute vec4 aExt;
varying vec4 vWin; varying vec4 vExt; varying vec3 vWPos; varying vec3 vWNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWin = aWin; vExt = aExt;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${COMMON}`)
      .replace('void main() {', 'void main() { float gWin = 0.0; vec3 gEmit = vec3(0.0); float gRough = -1.0;')
      .replace('#include <color_fragment>', water ? `#include <color_fragment>
{
  vec2 q = vWPos.xz * 0.22 + vec2(uTime * 0.05, uTime * 0.03);
  float n = vnoise(q) * 0.6 + vnoise(q * 3.1 - uTime * 0.07) * 0.4;
  diffuseColor.rgb *= 0.86 + 0.24 * n;
  float spark = pow(max(0.0, vnoise(vWPos.xz * 1.7 + uTime * 0.6) * vnoise(vWPos.xz * 2.3 - uTime * 0.4) - 0.34), 2.0) * 6.0 * (1.0 - smoothstep(0.15, 0.6, fwidth(vWPos.x)));
  gEmit += vec3(0.9, 0.95, 1.0) * spark * (1.0 - uNight * 0.8) * 0.5;
  gEmit += vec3(1.0, 0.85, 0.6) * vExt.x * uNight * 0.6;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), uSnow * 0.15);
}` : `#include <color_fragment>
{
  float surf = vExt.z;
  vec3 col = diffuseColor.rgb;
  if (surf > 0.5 && surf < 1.5) { float g = vnoise(vWPos.xz * 2.6) * 0.5 + vnoise(vWPos.xz * 9.0) * 0.5; col *= 0.9 + 0.18 * g; }
  else if (surf > 1.5 && surf < 2.5) { float g = vnoise(vWPos.xz * 0.3) * 0.55 + vnoise(vWPos.xz * 2.4) * 0.45; col *= vec3(0.84 + 0.3 * g, 0.88 + 0.22 * g, 0.84 + 0.2 * g); }
  else if (surf > 2.5 && surf < 3.5) { vec2 t = fract(vWPos.xz * 1.1); float line = max(step(t.x, 0.05), step(t.y, 0.05)); col *= 1.0 - 0.07 * line + 0.06 * (vnoise(vWPos.xz * 1.7) - 0.5); }
  else if (surf > 3.5 && surf < 4.5) { float s = fract(vWin.x * 2.4); col *= 0.86 + 0.14 * smoothstep(0.0, 0.3, s); col *= 0.94 + 0.1 * vnoise(vWPos.xz * 0.9); }
  else if (surf > 4.5 && surf < 5.5) { col *= 0.9 + 0.14 * vnoise(vWPos.xz * 3.3); }
  float style = vWin.z;
  if (style > 0.5) {
    float bh = max(1.0, vExt.w);
    float fh = style > 2.5 && style < 3.5 ? 0.82 : 0.86;
    float sp = style < 1.5 ? 0.9 : style < 2.5 ? 0.62 : style < 3.5 ? 1.15 : style < 4.5 ? 2.6 : 1.2;
    vec2 cell = vec2(floor(vWin.x / sp), floor(vWin.y / fh));
    vec2 f = vec2(fract(vWin.x / sp), fract(vWin.y / fh));
    float aa = clamp(max(fwidth(vWin.x) / sp, fwidth(vWin.y) / fh) * 1.4, 0.0, 1.0);
    float rnd = h21(cell + vWin.w * 91.7);
    float isWin = 0.0; float cover = 0.3; vec3 awn = vec3(0.0); float isAwn = 0.0;
    if (style < 1.5) {
      isWin = step(0.18, f.x) * step(f.x, 0.82) * step(0.3, f.y) * step(f.y, 0.84);
      if (cell.y < 0.5 && bh > 2.6) { isWin = step(0.05, f.x) * step(f.x, 0.95) * step(0.06, f.y) * step(f.y, 0.74); isAwn = step(0.78, f.y) * step(f.y, 0.94); float k = h21(vec2(vWin.w * 13.0, floor(vWin.x / 6.0))); awn = k < 0.2 ? vec3(0.62, 0.12, 0.1) : k < 0.4 ? vec3(0.1, 0.26, 0.5) : k < 0.6 ? vec3(0.12, 0.4, 0.2) : k < 0.8 ? vec3(0.7, 0.4, 0.08) : vec3(0.3, 0.2, 0.45); }
    } else if (style < 2.5) { isWin = step(0.06, f.x) * step(0.08, f.y); cover = 0.8; }
    else if (style < 3.5) { isWin = step(0.3, f.x) * step(f.x, 0.7) * step(0.32, f.y) * step(f.y, 0.78); cover = 0.18; if (cell.y < 0.5 && mod(cell.x, 3.0) < 0.5 && f.y < 0.7 && f.x > 0.36 && f.x < 0.64) { isWin = 0.0; isAwn = 1.0; awn = vec3(0.32, 0.2, 0.14); } }
    else if (style < 4.5) { float door = step(0.22, f.x) * step(f.x, 0.78) * step(vWin.y, 0.62) * step(0.5, h21(vec2(cell.x, vWin.w))); isAwn = door; awn = vec3(0.42, 0.45, 0.48) * (0.9 + 0.1 * step(0.5, fract(vWin.y * 9.0))); isWin = step(0.1, f.x) * step(f.x, 0.9) * step(bh - 0.55, vWin.y) * step(vWin.y, bh - 0.2); cover = 0.08; }
    else { isWin = step(0.3, f.x) * step(f.x, 0.7) * step(0.2, f.y) * step(f.y, 0.85); cover = 0.15; }
    float hgt = clamp(vWin.y / bh, 0.0, 1.0);
    vec3 glass = style > 1.5 && style < 2.5 ? mix(vec3(0.16, 0.24, 0.33), vec3(0.52, 0.66, 0.8), hgt * 0.7 + rnd * 0.18) : mix(vec3(0.13, 0.17, 0.22), vec3(0.36, 0.45, 0.55), 0.35 + rnd * 0.4);
    glass *= 1.0 - uNight * 0.75;
    float lit = step(rnd, 0.32 + 0.22 * h21(vec2(vWin.w, cell.y)));
    vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(0.85, 0.9, 1.0), step(0.82, h21(cell.yx + vWin.w)));
    vec3 em = warm * lit * uNight * (style > 1.5 && style < 2.5 ? 0.55 : 0.85) * (0.7 + 0.5 * rnd);
    vec3 detailed = mix(col, glass, isWin); detailed = mix(detailed, awn, isAwn);
    vec3 avg = mix(col, glass, cover);
    col = mix(detailed, avg, aa);
    gEmit += mix(em * isWin, warm * uNight * 0.16 * cover, aa);
    gWin = isWin * (1.0 - aa);
    col *= mix(0.62, 1.0, smoothstep(0.0, 1.1, vWin.y));
  }
  float up = smoothstep(0.55, 0.9, vWNormal.y);
  col = mix(col, vec3(0.9, 0.93, 0.97), uSnow * up * (surf > 0.5 && surf < 1.5 ? 0.5 : 0.92));
  int di = int(vExt.y + 0.5);
  float lk = 0.0; for (int k = 0; k < 16; k++) { if (k == di) lk = uLocked[k]; }
  float grey = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, vec3(grey) * 0.62, lk * 0.8);
  gEmit *= 1.0 - lk * 0.85;
  diffuseColor.rgb = col;
  gEmit += vec3(1.0, 0.82, 0.55) * vExt.x * uNight * 1.6 + vec3(1.0, 0.82, 0.55) * vExt.x * 0.25;
  if (surf > 0.5 && surf < 3.5) gRough = mix(0.92, 0.32, uWet);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.16, gWin);
if (gRough >= 0.0) roughnessFactor = gRough;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += gEmit;`)
      .replace('#include <normal_fragment_maps>', water ? `#include <normal_fragment_maps>
{
  vec2 q = vWPos.xz * 0.5 + vec2(uTime * 0.25, uTime * 0.18);
  vec3 pert = vec3(vnoise(q) - 0.5, 0.0, vnoise(q * 1.7 + 3.1) - 0.5) * 0.55;
  normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);
}` : '#include <normal_fragment_maps>');
  };
  mat.customProgramCacheKey = () => (water ? 'city-water' : 'city-solid');
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.3 }, uHaze: { value: 0 }, uHazeCol: { value: new THREE.Color(0.75, 0.8, 0.86) }, uTint: { value: new THREE.Color(1, 1, 1) }, uSat: { value: 1.08 }, uContrast: { value: 1.06 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uHaze; uniform vec3 uHazeCol; uniform vec3 uTint; uniform float uSat; uniform float uContrast; varying vec2 vUv;
void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, uSat); c = (c - 0.5) * uContrast + 0.5; c *= uTint;
c = mix(c, uHazeCol, uHaze * (0.35 + 0.45 * (1.0 - vUv.y))); float v = smoothstep(0.9, 0.3, length((vUv - 0.5) * vec2(1.0, 0.85))); c *= mix(1.0 - uVig, 1.0, v); gl_FragColor = vec4(max(c, 0.0), 1.0); }`,
};

function radialTexture(stops: Array<[number, string]>, size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const FIRE_TPL = new Set(['kitchen_fire', 'apartment_fire', 'electrical_fire', 'warehouse_smoke', 'house_explosion', 'brush_fire', 'industrial_accident', 'tanker_fire', 'train_derailment', 'vehicle_fire', 'boat_fire', 'aircraft_emergency', 'riot', 'looting']);
const CRASH_TPL = new Set(['collision_minor', 'collision_injury', 'collision_trapped', 'collision_multi']);

export class World3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 8000);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private hemi = new THREE.HemisphereLight(0xcfe3f7, 0x8d8070, 1.1);
  private fireLights: THREE.PointLight[] = [];
  private cityMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  private waterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.05 });
  private buildingsMesh: THREE.Mesh | null = null;
  private stationMesh: THREE.Mesh | null = null;
  private stationKey = '';
  private city: City;
  private units = new Map<string, { v: Vehicle3D; key: string; hd: number; lx: number; ly: number }>();
  private traffic!: THREE.InstancedMesh; private trafficLamps!: THREE.InstancedMesh; private trafficLampMat!: THREE.MeshBasicMaterial;
  private glows!: THREE.InstancedMesh; private glowMat!: THREE.MeshBasicMaterial;
  private spills!: THREE.InstancedMesh;
  private lampHeads!: THREE.InstancedMesh; private lampHeadMat!: THREE.MeshStandardMaterial;
  private fires: Array<{ flames: THREE.Sprite[]; smoke: THREE.Sprite[] }> = [];
  private crashes: THREE.Group[] = [];
  private shadowR = 0;
  private fleet = new VisualFleet();
  private W = 1; private H = 1; private dpr = 1;
  layout = new Map<string, UnitPose>();
  quality: 'high' | 'medium' | 'low' = 'high';
  /** dynamic resolution: drops when frames run long, recovers when there is headroom */
  private scale = 1; private lastAdapt = 0;
  adapt(frameMs: number, now: number) {
    if (now - this.lastAdapt < 1200) return;
    let next = this.scale;
    if (frameMs > 34) next = Math.max(0.55, this.scale - 0.1);
    else if (frameMs < 20 && this.scale < 1) next = Math.min(1, this.scale + 0.05);
    if (next === this.scale) return;
    this.lastAdapt = now; this.scale = next;
    const pr = (this.quality === 'low' ? Math.min(1, this.dpr) : Math.min(1.5, this.dpr)) * this.scale;
    this.renderer.setPixelRatio(pr); this.renderer.setSize(this.W, this.H, false);
    this.composer.setPixelRatio(pr); this.composer.setSize(this.W, this.H);
  }
  ok = true;

  constructor() {
    this.city = getCity();
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world3d';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x6f9fbf);
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xff8a3a, 0, 38, 1.6); this.fireLights.push(l); this.scene.add(l); }

    patchCity(this.cityMat, false);
    patchCity(this.waterMat, true);
    this.buildStatic();
  }

  // ── static world ─────────────────────────────────────────────────────────
  private buildStatic() {
    const sc = getScenery();
    const city = this.city;
    const meshes = buildCity(city, sc, () => false);
    const ground = new THREE.Mesh(meshes.ground, this.cityMat); ground.receiveShadow = true; ground.matrixAutoUpdate = false;
    const water = new THREE.Mesh(meshes.water, this.waterMat); water.receiveShadow = true; water.matrixAutoUpdate = false;
    this.buildingsMesh = new THREE.Mesh(meshes.buildings, this.cityMat); this.buildingsMesh.castShadow = true; this.buildingsMesh.receiveShadow = true; this.buildingsMesh.matrixAutoUpdate = false;
    this.scene.add(ground, water, this.buildingsMesh);

    // trees: broadleaf and conifers, plus street trees along the quiet residential streets
    const trees: Array<{ x: number; y: number; r: number; c: string; con: boolean }> = sc.trees.map((t) => ({ x: t.x, y: t.y, r: Math.max(0.9, Math.min(2.4, t.r * 0.46)), c: t.c, con: /^#(3f7d3a|468a40|376f33)/.test(t.c) && hash(Math.round(t.x * 7 + t.y)) < 0.7 }));
    for (const e of city.edges) {
      if (e.cls !== 'local') continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const tags = city.districtById[a.district]?.tags ?? [];
      if (!tags.some((t) => ['residential', 'suburb', 'campus', 'historic', 'river'].includes(t))) continue;
      const L = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      for (let d = 7; d < L - 7; d += 8.5) for (const s of [-1, 1]) {
        if (hash(e.id * 97 + Math.round(d) * 3 + s) < 0.3) continue;
        const o = ROAD.local.walk / 2 - 0.55;
        trees.push({ x: a.x + ux * d - uy * o * s, y: a.y + uy * d + ux * o * s, r: 0.85 + hash(e.id + d) * 0.45, c: ['#5f9e4a', '#6aa852', '#558f42', '#74b05b'][Math.floor(hash(e.id * 3 + d) * 4)], con: false });
      }
    }
    const broad = trees.filter((t) => !t.con), con = trees.filter((t) => t.con);
    const canopy = new THREE.IcosahedronGeometry(1, 1); canopy.scale(1, 0.85, 1);
    const cone = new THREE.ConeGeometry(0.85, 2.4, 7);
    const trunkG = new THREE.CylinderGeometry(0.09, 0.13, 1, 6); trunkG.translate(0, 0.5, 0);
    const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f37, roughness: 1 });
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, list: typeof trees, place: (t: (typeof trees)[0], m: THREE.Matrix4) => void, colored = true) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      const m = new THREE.Matrix4(), col = new THREE.Color();
      list.forEach((t, i) => { place(t, m); im.setMatrixAt(i, m); if (colored) { col.set(t.c); col.multiplyScalar(0.85 + hash(i * 13) * 0.3); im.setColorAt(i, col); } });
      im.count = list.length; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      this.scene.add(im);
    };
    const q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    mk(canopy, leafMat, broad, (t, m) => { m.compose(pv.set(t.x, t.r * 1.15 + 0.35, t.y), q.identity(), sv.set(t.r, t.r, t.r)); });
    mk(cone, leafMat, con, (t, m) => { m.compose(pv.set(t.x, t.r * 1.25 + 0.3, t.y), q.identity(), sv.set(t.r * 0.9, t.r * 0.95, t.r * 0.9)); });
    mk(trunkG, trunkMat, trees, (t, m) => { m.compose(pv.set(t.x, 0, t.y), q.identity(), sv.set(1, t.r * 0.9 + 0.35, 1)); }, false);

    // street lights along the main roads: poles, lamp heads that glow, and pools of light at night
    const poleG = new Geo();
    poleG.cyl(0, 0, 0.06, 0.05, 0, 2.3, 6, lin('#5c6168'));
    poleG.box(0.35, 0, 0.75, 0.06, 2.24, 2.3, 0, lin('#5c6168'));
    const poles = new THREE.InstancedMesh(poleG.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }), sc.lights.length);
    this.lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xfff1cc, emissive: 0xffd89a, emissiveIntensity: 0 });
    this.lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.08, 0.18), this.lampHeadMat, sc.lights.length);
    this.glowMat = new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(255,214,150,1)'], [0.35, 'rgba(255,196,120,0.45)'], [1, 'rgba(255,190,110,0)']]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.glows = new THREE.InstancedMesh(plane, this.glowMat, sc.lights.length + 800);
    this.glows.frustumCulled = false; this.glows.renderOrder = 2;
    {
      const m = new THREE.Matrix4(), col = new THREE.Color(1, 1, 1);
      sc.lights.forEach((l, i) => {
        // point the arm at the road: find the nearest road centre
        const n = city.nodes[city.nearestNode(l.x, l.y)];
        const ang = Math.atan2(n.y - l.y, n.x - l.x);
        const ax = Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang)) ? (Math.cos(ang) > 0 ? 0 : Math.PI) : (Math.sin(ang) > 0 ? -Math.PI / 2 : Math.PI / 2);
        m.compose(pv.set(l.x, 0, l.y), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ax), sv.set(1, 1, 1)); poles.setMatrixAt(i, m);
        const hx = l.x + Math.cos(-ax) * 0.7, hz = l.y + Math.sin(-ax) * 0.7;
        m.compose(pv.set(hx, 2.22, hz), q, sv.set(1, 1, 1)); this.lampHeads.setMatrixAt(i, m);
        m.compose(pv.set(hx, 0.12, hz), q.identity(), sv.set(7.5, 1, 7.5)); this.glows.setMatrixAt(i, m); this.glows.setColorAt(i, col);
      });
    }
    poles.castShadow = true; poles.frustumCulled = false; this.lampHeads.frustumCulled = false;
    this.scene.add(poles, this.lampHeads, this.glows);

    // civilian traffic and parked cars
    const carG = civilianCarGeometry();
    const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 });
    this.traffic = new THREE.InstancedMesh(carG, carMat, 900); this.traffic.castShadow = true; this.traffic.frustumCulled = false; this.traffic.count = 0;
    this.trafficLampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.trafficLamps = new THREE.InstancedMesh(civilianLampGeometry(), this.trafficLampMat, 900); this.trafficLamps.frustumCulled = false; this.trafficLamps.count = 0;
    this.traffic.setColorAt(0, new THREE.Color(1, 1, 1));
    this.scene.add(this.traffic, this.trafficLamps);
    const parked: Array<{ x: number; y: number; h: number; c: string }> = [];
    for (const e of city.edges) {
      if (e.cls !== 'local') continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const h = Math.atan2(b.y - a.y, b.x - a.x);
      const n = Math.floor(hash(e.id * 7) * 5);
      for (let k = 0; k < n; k++) {
        const t = 0.2 + hash(e.id * 13 + k) * 0.6, side = hash(e.id * 29 + k) < 0.5 ? 1 : -1, off = ROAD.local.asphalt / 2 - 0.42;
        parked.push({ x: a.x + (b.x - a.x) * t - Math.sin(h) * off * side, y: a.y + (b.y - a.y) * t + Math.cos(h) * off * side, h, c: CAR_COLORS[Math.floor(hash(e.id * 31 + k) * CAR_COLORS.length)] });
      }
    }
    for (const f of sc.features) {
      if (f.kind !== 'parking') continue;
      const rr = f.extra ?? 1;
      for (let row = 0; row < 3; row++) for (let k = 0; k < 8; k++) {
        const hv = ((rr + row * 31 + k * 17) * 2654435761) >>> 0;
        if (hv % 100 > 62) continue;
        const c = quadPt(f.pts, 0.115 + k * 0.11, 0.18 + row * 0.32);
        const ax = quadPt(f.pts, 0.115 + k * 0.11, 0.08 + row * 0.32);
        parked.push({ x: c.x, y: c.y, h: Math.atan2(c.y - ax.y, c.x - ax.x), c: CAR_COLORS[hv % CAR_COLORS.length] });
      }
    }
    const pk = new THREE.InstancedMesh(carG, carMat, parked.length);
    { const m = new THREE.Matrix4(), col = new THREE.Color(); parked.forEach((p, i) => { m.compose(pv.set(p.x, 0, p.y), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.h), sv.set(1, 1, 1)); pk.setMatrixAt(i, m); pk.setColorAt(i, col.set(p.c)); }); }
    pk.castShadow = true; pk.receiveShadow = true; pk.frustumCulled = false;
    this.scene.add(pk);

    // emergency-light spill and headlight pools
    this.spills = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 240);
    this.spills.frustumCulled = false; this.spills.count = 0; this.spills.renderOrder = 3;
    this.spills.setColorAt(0, new THREE.Color(1, 1, 1));
    this.scene.add(this.spills);

    // fire and smoke sprites (pooled)
    const flameTex = radialTexture([[0, 'rgba(255,250,210,1)'], [0.3, 'rgba(255,170,60,0.9)'], [0.7, 'rgba(220,70,20,0.35)'], [1, 'rgba(200,40,10,0)']], 64);
    const smokeTex = radialTexture([[0, 'rgba(90,90,92,0.85)'], [0.5, 'rgba(80,80,84,0.45)'], [1, 'rgba(70,70,74,0)']], 64);
    for (let i = 0; i < 6; i++) {
      const flames: THREE.Sprite[] = [], smoke: THREE.Sprite[] = [];
      for (let k = 0; k < 12; k++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })); s.visible = false; flames.push(s); this.scene.add(s); }
      for (let k = 0; k < 18; k++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, depthWrite: false, transparent: true })); s.visible = false; smoke.push(s); this.scene.add(s); }
      this.fires.push({ flames, smoke });
    }
    // crash scenes: two wrecked cars each
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      for (let k = 0; k < 2; k++) { const car = new THREE.Mesh(carG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3, color: new THREE.Color(CAR_COLORS[(i * 3 + k * 5) % CAR_COLORS.length]) })); car.castShadow = true; car.position.set(k ? 1.0 : -0.4, 0, k ? 0.35 : -0.1); car.rotation.y = k ? 0.9 : -0.35; g.add(car); }
      g.visible = false; this.crashes.push(g); this.scene.add(g);
    }
  }

  /** stations as buildings with apparatus bays; the lots they stand on are cleared */
  private syncStations(st: GameState) {
    const stations = Object.values(st.stations);
    const key = stations.map((s) => `${s.id}@${s.nodeId}`).sort().join('|');
    if (key === this.stationKey) return;
    this.stationKey = key;
    const city = this.city;
    const g = new Geo();
    const lays: StationLayout[] = [];
    for (const st0 of stations) { const lay = stationLayout(city, st0); lays.push(lay); stationModel(g, st0, lay); }
    if (this.stationMesh) { this.scene.remove(this.stationMesh); this.stationMesh.geometry.dispose(); }
    this.stationMesh = new THREE.Mesh(g.build(), this.cityMat); this.stationMesh.castShadow = true; this.stationMesh.receiveShadow = true;
    this.scene.add(this.stationMesh);
    // rebuild the buildings without the lots under the stations
    const sc = getScenery();
    const skip = (l: Lot) => lays.some((lay) => {
      const dx = l.cx - lay.x, dy = l.cy - lay.y, c = Math.cos(lay.rot), sn = Math.sin(lay.rot);
      const u = dx * c + dy * sn, v = -dx * sn + dy * c, m = l.r * 0.7;
      return u > -11 - m && u < 15 - m * 0 + m && v > -8 - m && v < 7 + m;
    });
    const meshes = buildCity(city, sc, skip);
    meshes.ground.dispose(); meshes.water.dispose();
    if (this.buildingsMesh) { this.buildingsMesh.geometry.dispose(); this.buildingsMesh.geometry = meshes.buildings; }
  }

  // ── per frame ────────────────────────────────────────────────────────────
  resize(W: number, H: number, dpr: number) {
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    this.W = W; this.H = H; this.dpr = dpr;
    const pr = (this.quality === 'low' ? Math.min(1, dpr) : Math.min(1.5, dpr)) * this.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(W, H, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(W, H);
    this.bloom.resolution.set(W / 2, H / 2);
    this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px';
  }

  render(f: Frame3D) {
    const st = f.engine.state;
    const city = this.city;
    this.syncStations(st);
    const cosP = Math.cos(f.pitch), sinP = Math.sin(f.pitch);
    // camera
    const cam = this.camera;
    const D = 3000;
    cam.position.set(f.cx, D * cosP, f.cy + D * sinP);
    cam.up.set(0, sinP, -cosP);
    cam.lookAt(f.cx, 0, f.cy);
    cam.left = -f.W / 2 / f.z; cam.right = f.W / 2 / f.z; cam.top = f.H / 2 / f.z; cam.bottom = -f.H / 2 / f.z;
    cam.near = 10; cam.far = D * 2;
    cam.updateProjectionMatrix();

    // light
    const hour = f.hour, night = f.night;
    U.uNight.value = night; U.uTime.value = f.tSec;
    const wet = ['rain', 'storm'].includes(st.weather) ? st.weatherIntensity : 0;
    U.uWet.value = wet; U.uSnow.value = st.weather === 'snow' ? Math.min(1, st.weatherIntensity * 1.1) : Math.max(0, U.uSnow.value - 0.002);
    const th = Math.PI * Math.max(0, Math.min(1, (hour - 6) / 12));
    const day = 1 - night;
    const sunDir = new THREE.Vector3(Math.cos(th) * 0.95, 0.28 + Math.sin(th) * 0.8, 0.42).normalize();
    const moonDir = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();
    const dir = sunDir.clone().multiplyScalar(day).add(moonDir.clone().multiplyScalar(night)).normalize();
    const overcast = st.weather === 'storm' ? 0.35 : st.weather === 'rain' ? 0.5 : st.weather === 'fog' ? 0.55 : st.weather === 'snow' ? 0.7 : 1;
    const low = Math.max(0, 1 - Math.sin(th) * 2.2) * day;
    const sunCol = new THREE.Color(0xfff2dc).lerp(new THREE.Color(0xffa860), Math.min(1, low * 0.9 + f.dusk * 0.4)).lerp(new THREE.Color(0x8fa8e0), night);
    this.sun.color.copy(sunCol);
    this.sun.intensity = (2.7 * day * overcast + 0.22 * night) * (1 - 0.35 * low);
    this.hemi.color.set(0xcfe3f7).lerp(new THREE.Color(0x28365a), night).lerp(new THREE.Color(0x9aa4b0), (1 - overcast) * 0.6);
    this.hemi.groundColor.set(0x8d8070).lerp(new THREE.Color(0x0b0e16), night);
    this.hemi.intensity = 1.05 * day * (0.75 + 0.25 * overcast) + 0.34 * night;
    this.renderer.toneMappingExposure = 1.0;
    this.scene.background = new THREE.Color(0x6f9fbf).lerp(new THREE.Color(0x0a1424), night);
    // shadows follow the view
    const viewW = f.W / f.z, viewH = f.H / (f.z * Math.max(0.3, cosP));
    const R = Math.min(1300, Math.hypot(viewW, viewH) * 0.55 + 30);
    if (Math.abs(R - this.shadowR) > this.shadowR * 0.08) {
      this.shadowR = R;
      const sc = this.sun.shadow.camera;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 10; sc.far = 4000; sc.updateProjectionMatrix();
      const size = this.quality === 'high' ? 4096 : this.quality === 'medium' ? 2048 : 1024;
      if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null as never; }
    }
    // snap the shadow camera to texels so shadows do not shimmer while panning
    const texel = (2 * this.shadowR) / this.sun.shadow.mapSize.x;
    const tx = Math.round(f.cx / texel) * texel, tz = Math.round(f.cy / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + dir.x * 1500, dir.y * 1500, tz + dir.z * 1500);
    this.sun.castShadow = this.quality !== 'low' && this.scale > 0.7;

    // locked districts are greyed out
    city.districts.forEach((d, i) => { U.uLocked.value[i + 1] = f.active.has(d.id) ? 0 : 1; });

    // street lights
    this.lampHeadMat.emissiveIntensity = night * 3;
    this.glowMat.opacity = night * 0.6;
    const sc = getScenery();
    let gi = sc.lights.length;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const vx0 = f.cx - viewW / 2 - 20, vx1 = f.cx + viewW / 2 + 20, vy0 = f.cy - viewH / 2 - 30, vy1 = f.cy + viewH / 2 + 30;
    const inView = (x: number, y: number) => x > vx0 && x < vx1 && y > vy0 && y < vy1;

    // civilian traffic, in proper lanes
    let ti = 0;
    if (f.showTraffic && f.z > 1.4) {
      const lanes = getLanes();
      const LANE: Record<string, number[]> = { local: [0.8], arterial: [0.75, 2.15], highway: [0.95, 2.3, 3.65], bridge: [0.75, 2.0] };
      for (let li = 0; li < lanes.length && ti < 880; li++) {
        const l = lanes[li];
        if (!f.active.has(l.district)) continue;
        const density = (st.districtTraffic[l.district] ?? 0.3) * (night > 0.5 ? 0.45 : 1);
        const n = Math.round(l.len / 60 * density * 2.2);
        for (let k = 0; k < n && ti < 880; k++) {
          const seed = li * 131 + k * 17;
          const dirS = hash(seed) < 0.5 ? 1 : -1;
          const speed = 6 + hash(seed + 1) * 5;
          let d = (hash(seed + 2) * l.len + f.tSec * speed) % l.len;
          if (dirS < 0) d = l.len - d;
          const p = laneAt(l, d);
          if (!inView(p.x, p.y)) continue;
          const cls = l.cls[p.seg] ?? 'local';
          const lanesFor = LANE[cls] ?? LANE.local;
          const off = lanesFor[Math.floor(hash(seed + 5) * lanesFor.length)];
          const h = p.h + (dirS < 0 ? Math.PI : 0);
          const x = p.x - Math.sin(h) * off, y = p.y + Math.cos(h) * off;
          const yy = cls === 'bridge' ? deckHeight(city, l, p) : 0;
          m.compose(pv.set(x, yy, y), q.setFromAxisAngle(yAxis, -h), sv.set(1, 1, 1));
          this.traffic.setMatrixAt(ti, m); this.trafficLamps.setMatrixAt(ti, m);
          this.traffic.setColorAt(ti, col.set(CAR_COLORS[Math.floor(hash(seed + 3) * CAR_COLORS.length)]));
          if (night > 0.3 && gi < this.glows.count + 800 - 1 && gi < sc.lights.length + 790) { m.compose(pv.set(x + Math.cos(h) * 2.4, 0.13, y + Math.sin(h) * 2.4), q.setFromAxisAngle(yAxis, -h), sv.set(3.6, 1, 1.6)); this.glows.setMatrixAt(gi, m); this.glows.setColorAt(gi, col.setRGB(0.55, 0.5, 0.42)); gi++; }
          ti++;
        }
      }
    }
    this.traffic.count = ti; this.trafficLamps.count = ti;
    this.traffic.instanceMatrix.needsUpdate = true; this.trafficLamps.instanceMatrix.needsUpdate = true;
    if (this.traffic.instanceColor) this.traffic.instanceColor.needsUpdate = true;
    this.trafficLampMat.color.setScalar(0.25 + night * 1.6);

    // emergency units
    this.layout = computeLayout(st, city, this.units, this.fleet, f.now);
    const seen = new Set<string>();
    let si = 0;
    const phaseBase = Math.floor(f.now / 140);
    for (const u of Object.values(st.units)) {
      const pose = this.layout.get(u.id);
      if (!pose) continue;
      seen.add(u.id);
      const key = `${u.type}|${u.fit?.livery ?? ''}|${u.fit?.chassis ?? ''}`;
      let rec = this.units.get(u.id);
      if (!rec || rec.key !== key) { if (rec) this.scene.remove(rec.v.group); const v = makeVehicle(u.type, u.service, u.fit?.livery, u.fit?.chassis); this.scene.add(v.group); rec = { v, key, hd: pose.heading, lx: pose.x, ly: pose.y }; this.units.set(u.id, rec); }
      const v = rec.v;
      v.group.visible = true;
      v.group.position.set(pose.x, pose.h, pose.y);
      v.group.rotation.set(0, -pose.heading, 0);
      if (v.air) { v.group.rotation.z = u.speed > 0.05 ? -0.12 : 0; if (v.rotor) v.rotor.rotation.y += 0.9; if (v.tailRotor) v.tailRotor.rotation.z += 1.2; }
      const responding = (['EN_ROUTE', 'DISPATCHED'].includes(u.status) && u.code !== 2) || u.status === 'TRANSPORTING' || (u.status === 'ON_SCENE' && !!u.assignedIncidentId);
      const ph = responding && u.type !== 'foot' && u.type !== 'bicycle' ? (f.motion ? (phaseBase + (u.id.charCodeAt(u.id.length - 1) % 2)) % 2 : 0) : -1;
      for (const b of v.barA) b.material = lampMat(`#${v.colA.getHexString()}`, ph === 0);
      for (const b of v.barB) b.material = lampMat(`#${v.colB.getHexString()}`, ph === 1);
      const lightsOn = night > 0.3 || responding;
      for (const l of v.lamps) l.material = lampMat(l.userData.head ? '#fff4dc' : '#ff2a2a', lightsOn);
      if (ph >= 0 && si < 238 && inView(pose.x, pose.y)) {
        const c = ph === 0 ? v.colA : v.colB;
        const k = 0.35 + 1.4 * night;
        m.compose(pv.set(pose.x, 0.14 + (v.air ? 0 : 0), pose.y), q.identity(), sv.set(v.air ? 6 : 7, 1, v.air ? 6 : 7));
        this.spills.setMatrixAt(si, m); this.spills.setColorAt(si, col.copy(c).multiplyScalar(k)); si++;
      }
      if (v.air && night > 0.3 && si < 238) { m.compose(pv.set(pose.x, 0.14, pose.y), q.identity(), sv.set(9, 1, 9)); this.spills.setMatrixAt(si, m); this.spills.setColorAt(si, col.setRGB(0.9, 0.95, 1).multiplyScalar(night * 0.9)); si++; }
      if (lightsOn && night > 0.3 && !v.air && u.speed > 0.05 && gi < sc.lights.length + 790) { m.compose(pv.set(pose.x + Math.cos(pose.heading) * 2.6, 0.13, pose.y + Math.sin(pose.heading) * 2.6), q.setFromAxisAngle(yAxis, -pose.heading), sv.set(4.2, 1, 1.9)); this.glows.setMatrixAt(gi, m); this.glows.setColorAt(gi, col.setRGB(0.7, 0.65, 0.55)); gi++; }
    }
    for (const [id, rec] of this.units) if (!seen.has(id)) { if (st.units[id]) rec.v.group.visible = false; else { this.scene.remove(rec.v.group); this.units.delete(id); this.fleet.forget(id); } }
    this.spills.count = si; this.spills.instanceMatrix.needsUpdate = true; if (this.spills.instanceColor) this.spills.instanceColor.needsUpdate = true;
    this.glows.count = gi; this.glows.instanceMatrix.needsUpdate = true; if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;

    // incidents: fires with flames and smoke, crashes with wrecked cars
    this.renderIncidents(st, f, night);

    // grade
    const g = this.grade.uniforms;
    g.uVig.value = 0.26 + 0.18 * night;
    g.uHaze.value = st.weather === 'fog' ? 0.32 * st.weatherIntensity : st.weather === 'storm' || st.weather === 'rain' ? 0.1 * st.weatherIntensity : 0.03;
    (g.uHazeCol.value as THREE.Color).setRGB(0.75, 0.8, 0.86).lerp(new THREE.Color(0.08, 0.1, 0.16), night);
    (g.uTint.value as THREE.Color).setRGB(1, 1, 1).lerp(new THREE.Color(1.06, 0.98, 0.9), f.dusk * day).lerp(new THREE.Color(0.9, 0.96, 1.08), night * 0.6).lerp(new THREE.Color(1.05, 1.0, 0.92), st.weather === 'heat' ? 0.8 : 0);
    g.uSat.value = 1.1 - 0.25 * (1 - overcast);
    this.bloom.strength = 0.22 + 0.4 * night;
    this.bloom.threshold = 0.92;
    this.bloom.radius = 0.35;
    this.composer.render();
  }

  private renderIncidents(st: GameState, f: Frame3D, night: number) {
    const city = this.city;
    const live = Object.values(st.incidents).filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status) && !i.duplicateOf && !i.hidden);
    const fires = live.filter((i) => FIRE_TPL.has(i.templateId) && i.requires.length && (i.category === 'fire' || i.templateId === 'riot' || i.templateId === 'looting')).slice(0, 6);
    const sc = getScenery();
    const t = f.tSec;
    let li = 0;
    this.fires.forEach((slot, fi) => {
      const inc = fires[fi];
      const show = !!inc;
      if (!show) { for (const s of slot.flames) s.visible = false; for (const s of slot.smoke) s.visible = false; return; }
      const site = fireSite(city, sc, inc!);
      const seenFlames = inc!.sceneSeen || inc!.reportedNode === inc!.nodeId;
      const size = 1 + inc!.stage * 0.6 + (inc!.severity >= 4 ? 0.5 : 0);
      slot.flames.forEach((s, k) => {
        s.visible = seenFlames;
        if (!seenFlames) return;
        const ph = (t * (1.6 + (k % 3) * 0.3) + k * 0.37) % 1;
        const ang = k * 2.4;
        s.position.set(site.x + Math.cos(ang) * site.r * 0.5 * (1 - ph), site.y + ph * 3.2 * size, site.z + Math.sin(ang) * site.r * 0.5 * (1 - ph));
        const sz = (1.6 + 1.4 * Math.sin(ph * Math.PI)) * size * (0.8 + 0.4 * hash(k + fi * 13));
        s.scale.set(sz, sz * 1.3, 1);
        s.material.opacity = (1 - ph) * 0.95;
      });
      slot.smoke.forEach((s, k) => {
        s.visible = true;
        const ph = (t * 0.09 + k / slot.smoke.length) % 1;
        const drift = ph * 26 * size;
        s.position.set(site.x + drift * 0.8 + Math.sin(k * 1.7 + t * 0.3) * 1.5, site.y + 1.5 + ph * 22 * size, site.z - drift * 0.35);
        const sz = (3 + ph * 14) * size * 0.8;
        s.scale.set(sz, sz, 1);
        s.material.opacity = Math.min(1, ph * 6) * (1 - ph) * (0.7 - 0.3 * night);
        s.material.color.setRGB(0.55 - 0.3 * night, 0.55 - 0.3 * night, 0.58 - 0.3 * night);
      });
      if (seenFlames && li < this.fireLights.length) {
        const L = this.fireLights[li++];
        L.position.set(site.x, site.y + 2.5, site.z);
        L.intensity = (night * 30 + 4) * size * (0.8 + 0.25 * Math.sin(t * 13 + fi) + 0.15 * Math.sin(t * 31));
      }
    });
    for (; li < this.fireLights.length; li++) this.fireLights[li].intensity = 0;
    const crashes = live.filter((i) => CRASH_TPL.has(i.templateId) && (i.sceneSeen || i.reportedNode === i.nodeId)).slice(0, 4);
    this.crashes.forEach((g, k) => {
      const inc = crashes[k];
      g.visible = !!inc;
      if (!inc) return;
      const n = city.nodes[inc.nodeId];
      g.position.set(n.x + 3.5, 0, n.y - 1.2);
      g.rotation.y = hash(inc.num) * Math.PI;
    });
  }

  // ── CCTV: the same city, seen from a camera on a pole ─────────────────────
  private camRT: THREE.WebGLRenderTarget | null = null;
  private camBuf: Uint8Array | null = null;
  private pcam = new THREE.PerspectiveCamera(40, 16 / 9, 0.3, 600);
  /**
   * Render the live city from a street camera into a 2D canvas. Returns a projector from map space
   * (x, y, height) to feed pixels, for drawing analytics boxes over what the camera sees.
   */
  renderCctv(o: { x: number; y: number; h: number; heading: number; fov: number; far: number; tilt: number }, ctx: CanvasRenderingContext2D, w: number, h: number): ((x: number, y: number, z: number) => { x: number; y: number; ok: boolean }) | null {
    if (!this.ok) return null;
    if (!this.camRT || this.camRT.width !== w || this.camRT.height !== h) {
      this.camRT?.dispose();
      this.camRT = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace, depthBuffer: true });
      this.camBuf = new Uint8Array(w * h * 4);
    }
    const c = this.pcam;
    c.aspect = w / h;
    c.fov = (2 * Math.atan(Math.tan(o.fov / 2) / c.aspect) * 180) / Math.PI;
    c.near = 0.3; c.far = o.far;
    c.position.set(o.x, o.h, o.y);
    c.up.set(0, 1, 0);
    c.lookAt(o.x + Math.cos(o.heading) * 20, o.h - 20 * Math.tan(o.tilt), o.y + Math.sin(o.heading) * 20);
    c.updateProjectionMatrix();
    // reuse the main view's shadow map rather than re-rendering it for a second camera
    const au = this.renderer.shadowMap.autoUpdate;
    this.renderer.shadowMap.autoUpdate = false;
    try {
      this.renderer.setRenderTarget(this.camRT);
      this.renderer.clear();
      this.renderer.render(this.scene, c);
    } finally {
      this.renderer.setRenderTarget(null);
      this.renderer.shadowMap.autoUpdate = au;
    }
    const buf = this.camBuf!;
    this.renderer.readRenderTargetPixels(this.camRT, 0, 0, w, h, buf);
    const img = ctx.createImageData(w, h);
    for (let row = 0; row < h; row++) img.data.set(buf.subarray((h - 1 - row) * w * 4, (h - row) * w * 4), row * w * 4);
    ctx.putImageData(img, 0, 0);
    const v = new THREE.Vector3();
    return (x, y, z) => { v.set(x, z, y).project(c); return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, ok: v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.2 }; };
  }
  dispose() { this.renderer.dispose(); this.camRT?.dispose(); }
}

function deckHeight(city: City, l: ReturnType<typeof getLanes>[0], p: { x: number; y: number; seg: number }): number {
  const a = l.pts[p.seg], b = l.pts[p.seg + 1] ?? a;
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, d = Math.hypot(p.x - a.x, p.y - a.y);
  const ramp = 5;
  void city;
  return d < ramp ? DECK * d / ramp : d > L - ramp ? DECK * (L - d) / ramp : DECK;
}

function fireSite(city: City, sc: ReturnType<typeof getScenery>, inc: Incident): { x: number; y: number; z: number; r: number } {
  const n = city.nodes[inc.nodeId];
  if (['vehicle_fire', 'tanker_fire', 'riot', 'looting', 'brush_fire', 'aircraft_emergency'].includes(inc.templateId)) return { x: n.x + 2.5, y: 0.3, z: n.y + 2.5, r: 2 };
  let best: Lot | null = null, bd = 30;
  for (const l of sc.lots) { const d = Math.hypot(l.cx - (n.x + 8), l.cy - (n.y + 8)); if (d < bd) { bd = d; best = l; } }
  if (!best) return { x: n.x + 6, y: 0.3, z: n.y + 6, r: 3 };
  return { x: best.cx, y: best.style === 'house' || best.style === 'terrace' ? Math.min(best.h, 3.4) + 1 : best.h * (best.style === 'tower' ? 1.4 : best.style === 'office' ? 1.3 : 1), z: best.cy, r: Math.min(5, best.r * 0.6) };
}

/** a station as a real building: brick firehouse with open bays and a hose tower, police station
 *  with a glass entrance and comms mast, EMS base with a canopied forecourt; vehicles park out front */
function stationModel(g: Geo, s: Station, L: StationLayout) {
  const at = L.at;
  const B = (u: number, v: number, w: number, d: number, y0: number, y1: number, wall: string, top: string, style = 0, seed = 0.42) => { const q = at(u, v); g.box(q.x, q.y, w, d, y0, y1, L.rot, lin(wall), lin(top), style ? { style, seed } : undefined); };
  const front = (u: number, w: number, y0: number, y1: number, col: string, glow = 0) => {
    // a panel on the front wall (v = −2.5), facing the road
    const a = at(u - w / 2, -2.53), b = at(u + w / 2, -2.53);
    g.ext = [glow, 0, SURF.none, 0];
    const out = at(0, -10); const ctr = at(0, -2.53);
    g.quad([a.x, y0, a.y], [b.x, y0, b.y], [b.x, y1, b.y], [a.x, y1, a.y], lin(col), [out.x - ctr.x, 0, out.y - ctr.y]);
    g.ext = [0, 0, SURF.none, 0];
  };
  // forecourt, kerb line and the side lot
  g.ext = [0, 0, SURF.paving, 0];
  g.flat([at(-10.5, -8.2), at(10.5, -8.2), at(10.5, -2.4), at(-10.5, -2.4)], 0.045, lin('#c7c2b8'));
  g.flat([at(10.5, -8.2), at(14.8, -8.2), at(14.8, 6.6), at(10.5, 6.6)], 0.045, lin('#b9b5ab'));
  g.ext = [0, 0, SURF.none, 0];
  for (const u of [-10, -5, 0, 5, 10]) { const a2 = at(u, -8), b2 = at(u, -3); g.ribbon(a2.x, a2.y, b2.x, b2.y, 0.12, 0.06, lin(s.service === 'fire' ? '#e2b23c' : '#f0f0ea')); }
  for (const v of [-2.4, 1.4, 5.2]) { const a2 = at(10.8, v), b2 = at(14.6, v); g.ribbon(a2.x, a2.y, b2.x, b2.y, 0.12, 0.06, lin('#f0f0ea')); }
  if (s.service === 'fire') {
    g.ext = [0, 0, SURF.none, 5.2];
    B(0, 2, 20, 9, 0, 5.2, '#a8503c', '#6e3a2e', WIN.house, 0.3);
    g.ext = [0, 0, SURF.gravel, 0]; { const q = [at(-10, -2.5), at(10, -2.5), at(10, 6.5), at(-10, 6.5)]; g.flat(q, 5.22, lin('#5b4a42')); }
    // four tall bay openings, doors rolled up, with white frames
    for (const u of [-7.5, -2.5, 2.5, 7.5]) { front(u, 4.2, 0, 3.9, '#f2efe8'); front(u, 3.6, 0.02, 3.5, '#1a1c20'); front(u, 3.6, 3.2, 3.5, '#9aa0a6'); }
    front(0, 14, 4.2, 4.9, '#efe6cf', 1);
    // hose-drying tower and flag
    g.ext = [0, 0, SURF.none, 12];
    B(-7.6, 4.6, 3.4, 3.4, 0, 12, '#9c4a38', '#5b4a42', WIN.stone, 0.6);
    g.ext = [0, 0, SURF.none, 0];
    { const q = at(-9.8, -7.6); g.cyl(q.x, q.y, 0.07, 0.06, 0, 9, 6, lin('#d0d4d8')); }
    B(-9.2, -7.6, 1.4, 0.05, 8, 8.8, '#c43b3b', '#c43b3b');
  } else if (s.service === 'police') {
    g.ext = [0, 0, SURF.none, 6.2];
    B(0, 2, 20, 9, 0, 6.2, '#d8dce1', '#9ea4ab', WIN.office, 0.55);
    g.ext = [0, 0, SURF.gravel, 0]; { const q = [at(-10, -2.5), at(10, -2.5), at(10, 6.5), at(-10, 6.5)]; g.flat(q, 6.22, lin('#8f969d')); }
    front(0, 20.05, 4.3, 4.9, '#1f4f9a');
    front(-6, 5, 0, 3.4, '#4d6c8a');
    B(-6, -3.6, 6.4, 2.4, 3.4, 3.7, '#c9cdd2', '#e0e3e7');
    front(-6, 4.6, 3.6, 4.15, '#5aa0ff', 1.2);
    { const q = at(7, 4.5); g.cyl(q.x, q.y, 0.14, 0.06, 6.2, 16, 4, lin('#c9ced4')); }
    g.ext = [1.4, 0, SURF.none, 0]; B(7, 4.5, 0.35, 0.35, 16, 16.35, '#ff3a3a', '#ff3a3a');
    g.ext = [0, 0, SURF.none, 0];
    { const q = at(-9.5, -7.5); g.cyl(q.x, q.y, 0.06, 0.05, 0, 3.2, 6, lin('#d0d4d8')); }
    g.ext = [1, 0, SURF.none, 0]; B(-9.5, -7.5, 1.4, 0.18, 2.4, 3.1, '#2f6fd0', '#2f6fd0');
  } else {
    g.ext = [0, 0, SURF.none, 4.4];
    B(0, 2, 20, 9, 0, 4.4, '#eef1f4', '#cfd6dd', WIN.office, 0.7);
    g.ext = [0, 0, SURF.gravel, 0]; { const q = [at(-10, -2.5), at(10, -2.5), at(10, 6.5), at(-10, 6.5)]; g.flat(q, 4.42, lin('#b8bfc6')); }
    for (const u of [-7.5, -2.5, 2.5, 7.5]) { front(u, 3.8, 0, 3.2, '#e8ecef'); front(u, 3.3, 0.02, 2.9, '#23272c'); }
    front(0, 20.05, 3.3, 3.75, '#2f9e4f');
    // canopy over the bay doors, and the star of life on the roof
    B(0, -3.4, 20, 1.8, 3.4, 3.65, '#e6ebef', '#f4f6f8');
    B(0, 2, 2.6, 7, 4.42, 4.48, '#2f6fd0', '#2f6fd0'); B(0, 2, 7, 2.6, 4.42, 4.48, '#2f6fd0', '#2f6fd0');
    g.ext = [1, 0, SURF.none, 0]; front(0, 6, 3.75, 4.2, '#9ef0c0', 1);
  }
  g.ext = [0, 0, SURF.none, 0];
}

/** neat positions for every vehicle on the map: in their lane when moving, parked tidily around a scene */
function computeLayout(st: GameState, city: City, prev: Map<string, { hd: number; lx: number; ly: number }>, fleet: VisualFleet, now: number): Map<string, UnitPose> {
  const out = new Map<string, UnitPose>();
  const groups = new Map<number, Unit[]>();
  const road = new Map<string, UnitPose>();
  for (const u of Object.values(st.units)) {
    const rec = prev.get(u.id);
    let hd = rec?.hd ?? -Math.PI / 2;
    if (rec && Math.hypot(u.x - rec.lx, u.y - rec.ly) > 0.05) {
      const target = Math.atan2(u.y - rec.ly, u.x - rec.lx);
      let diff = target - hd; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
      hd += diff * 0.25;
    }
    if (rec) { rec.hd = hd; rec.lx = u.x; rec.ly = u.y; }
    if (isAir(u)) { road.set(u.id, { x: u.x, y: u.y, h: 9, top: 9.8, heading: hd }); continue; }
    if (atStation(city, st, u)) continue;
    if (u.speed > 0.05) {
      const next = u.route[0] ?? u.prevNode;
      const eid = city.edgeBetween.get(u.prevNode * 100000 + next);
      const cls = eid !== undefined ? city.edges[eid].cls : 'local';
      const off = cls === 'arterial' ? 1.5 : cls === 'highway' ? 2.3 : cls === 'bridge' ? 1.4 : 0.8;
      const yy = cls === 'bridge' ? DECK : 0;
      road.set(u.id, { x: u.x - Math.sin(hd) * off, y: u.y + Math.cos(hd) * off, h: yy, top: yy + 1.2, heading: hd });
      continue;
    }
    const n = city.nearestNode(u.x, u.y);
    const node = city.nodes[n];
    if (Math.hypot(node.x - u.x, node.y - u.y) < 2) { const g = groups.get(n); if (g) g.push(u); else groups.set(n, [u]); }
    else road.set(u.id, { x: u.x, y: u.y, h: 0, top: 1.2, heading: hd });
  }
  for (const [n, list] of groups) {
    const node = city.nodes[n];
    list.sort((a, b) => a.id.localeCompare(b.id));
    const dirs = city.adj[n].map((eid) => { const e = city.edges[eid]; const o = city.nodes[e.a === n ? e.b : e.a]; const d = Math.hypot(o.x - node.x, o.y - node.y) || 1; return { ux: (o.x - node.x) / d, uy: (o.y - node.y) / d, cls: e.cls, len: d }; }).filter((d) => d.cls !== 'highway' && d.cls !== 'bridge');
    if (!dirs.length) { list.forEach((u, i) => road.set(u.id, { x: node.x + i * 1.8, y: node.y, h: 0, top: 1.2, heading: 0 })); continue; }
    const used = dirs.map(() => 0);
    list.forEach((u, i) => {
      const k = i % dirs.length, d = dirs[k];
      const w = ROAD[d.cls as keyof typeof ROAD] ?? ROAD.local;
      const L = u.service === 'fire' ? 2.9 : 1.9;
      const dist = w.asphalt / 2 + 2.2 + used[k] + L / 2;
      used[k] += L + 0.5;
      const heading = Math.atan2(-d.uy, -d.ux);
      const lat = w.asphalt / 2 - 0.55;
      road.set(u.id, { x: node.x + d.ux * dist - Math.sin(heading) * lat, y: node.y + d.uy * dist + Math.cos(heading) * lat, h: 0, top: 1.2, heading });
    });
  }
  // every vehicle of ours gets a pose: in its bay at quarters, on the road otherwise, and animated in between
  for (const u of Object.values(st.units)) {
    if (isAir(u)) { const r = road.get(u.id); if (r) out.set(u.id, r); continue; }
    const stn = st.stations[u.stationId];
    const lay = stn && !u.temp ? stationLayout(city, stn) : null;
    const k = lay ? Math.min(lay.slots.length - 1, slotOf(st, u)) : 0;
    const parked = atStation(city, st, u);
    const node = stn ? city.nodes[stn.nodeId] : null;
    const r = road.get(u.id) ?? { x: node?.x ?? u.x, y: node?.y ?? u.y, h: 0, top: 1.2, heading: lay?.heading ?? 0 };
    const v = fleet.pose(u, { x: r.x, y: r.y, heading: r.heading }, lay ? { slot: lay.slots[k], exit: lay.exits[k] } : null, parked, now);
    out.set(u.id, { x: v.pose.x, y: v.pose.y, h: v.parked || v.moving ? 0.05 : r.h, top: (v.parked || v.moving ? 0.05 : r.h) + 1.2, heading: v.pose.heading });
  }
  return out;
}

let world: World3D | null | undefined;
/** the one 3D world (WebGL contexts are precious); null when WebGL is unavailable */
export function getWorld3D(): World3D | null {
  if (world !== undefined) return world;
  try {
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2')) { world = null; return null; }
    world = new World3D();
  } catch (e) {
    console.warn('3D view unavailable', e);
    world = null;
  }
  return world;
}
export const WORLD_BOUNDS = { w: WORLD_W, h: WORLD_H };
