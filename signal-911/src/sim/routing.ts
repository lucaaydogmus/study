// Graph routing (A*) and multi-source Dijkstra over the Ravenport road network.
// Edge traversal time depends on road class, traffic, weather, closures and the vehicle.
import type { City } from './city';
import type { RoadEdge } from './types';

/** Global game-time compression: 1 world unit ≈ 4 m, vehicles are sped up so trips take tens of seconds. */
export const TIME_COMPRESS = 2.4;
export const METERS_PER_UNIT = 4;

const BASE_KMH: Record<RoadEdge['cls'], number> = { highway: 95, arterial: 58, local: 40, bridge: 48 };
const TRAFFIC_SENS: Record<RoadEdge['cls'], number> = { highway: 0.55, arterial: 0.8, local: 0.45, bridge: 0.9 };

export interface TrafficModel {
  district: Record<string, number>;
  weatherMult: number;
  closed: Uint8Array;
  /** 0..1, fraction of congestion ignored thanks to signal pre-emption upgrades */
  preempt: number;
  /** emergency vehicles with sirens ignore part of the congestion */
  siren: boolean;
}

export function makeClosedMask(city: City, closedEdges: number[]): Uint8Array {
  const m = new Uint8Array(city.edges.length);
  for (const e of closedEdges) m[e] = 1;
  return m;
}

/** world units per second for a vehicle on this edge */
export function edgeSpeed(city: City, e: RoadEdge, tm: TrafficModel, vehicleFactor: number): number {
  if (tm.closed[e.id]) return 0;
  const da = tm.district[city.nodes[e.a].district] ?? 0.3, db = tm.district[city.nodes[e.b].district] ?? 0.3;
  const tr = (da + db) / 2;
  const relief = (tm.siren ? 0.45 : 0) + tm.preempt * 0.3;
  const slow = tr * TRAFFIC_SENS[e.cls] * (1 - Math.min(0.85, relief));
  const free = Math.max(0.22, 1 - slow);
  const kmh = BASE_KMH[e.cls] * free * tm.weatherMult * vehicleFactor;
  return (kmh / 3.6 / METERS_PER_UNIT) * TIME_COMPRESS;
}

export interface RouteResult { path: number[]; time: number; dist: number }

class MinHeap {
  keys: number[] = []; vals: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, v: number) {
    const ks = this.keys, vs = this.vals; let i = ks.length; ks.push(k); vs.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (ks[p] <= k) break; ks[i] = ks[p]; vs[i] = vs[p]; i = p; }
    ks[i] = k; vs[i] = v;
  }
  pop(): number {
    const ks = this.keys, vs = this.vals; const top = vs[0]; const lk = ks.pop()!; const lv = vs.pop()!;
    const n = ks.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && ks[c + 1] < ks[c]) c++;
        if (ks[c] >= lk) break;
        ks[i] = ks[c]; vs[i] = vs[c]; i = c;
      }
      ks[i] = lk; vs[i] = lv;
    }
    return top;
  }
}

export function findRoute(city: City, from: number, to: number, tm: TrafficModel, vehicleFactor = 1): RouteResult | null {
  if (from === to) return { path: [], time: 0, dist: 0 };
  const N = city.nodes.length;
  const g = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const closedSet = new Uint8Array(N);
  const maxSpeed = (BASE_KMH.highway / 3.6 / METERS_PER_UNIT) * TIME_COMPRESS * Math.max(1, vehicleFactor) * 1.05;
  const target = city.nodes[to];
  const h = (n: number) => Math.hypot(city.nodes[n].x - target.x, city.nodes[n].y - target.y) / maxSpeed;
  const heap = new MinHeap();
  g[from] = 0; heap.push(h(from), from);
  while (heap.size) {
    const cur = heap.pop();
    if (closedSet[cur]) continue;
    closedSet[cur] = 1;
    if (cur === to) break;
    for (const eid of city.adj[cur]) {
      const e = city.edges[eid];
      const o = e.a === cur ? e.b : e.a;
      if (closedSet[o]) continue;
      const sp = edgeSpeed(city, e, tm, vehicleFactor);
      if (sp <= 0) continue;
      const ng = g[cur] + e.len / sp;
      if (ng < g[o]) { g[o] = ng; prev[o] = cur; heap.push(ng + h(o), o); }
    }
  }
  if (!isFinite(g[to])) return null;
  const path: number[] = [];
  let n = to, dist = 0;
  while (n !== from) {
    path.push(n);
    const p = prev[n];
    const eid = city.edgeBetween.get(p * 100000 + n)!;
    dist += city.edges[eid].len;
    n = p;
  }
  path.reverse();
  return { path, time: g[to], dist };
}

/** Travel time (seconds) from the nearest of the sources to every node. */
export function multiSourceTimes(city: City, sources: Array<{ node: number; offset: number }>, tm: TrafficModel, vehicleFactor = 1): Float32Array {
  const N = city.nodes.length;
  const t = new Float32Array(N).fill(Infinity);
  const heap = new MinHeap();
  for (const s of sources) { if (s.offset < t[s.node]) { t[s.node] = s.offset; heap.push(s.offset, s.node); } }
  const done = new Uint8Array(N);
  while (heap.size) {
    const cur = heap.pop();
    if (done[cur]) continue;
    done[cur] = 1;
    for (const eid of city.adj[cur]) {
      const e = city.edges[eid];
      const o = e.a === cur ? e.b : e.a;
      if (done[o]) continue;
      const sp = edgeSpeed(city, e, tm, vehicleFactor);
      if (sp <= 0) continue;
      const nt = t[cur] + e.len / sp;
      if (nt < t[o]) { t[o] = nt; heap.push(nt, o); }
    }
  }
  return t;
}

export function routeTime(city: City, startNode: number, path: number[], tm: TrafficModel, vehicleFactor: number, fromX?: number, fromY?: number): number {
  let total = 0;
  let px = fromX ?? city.nodes[startNode].x, py = fromY ?? city.nodes[startNode].y;
  let prev = startNode;
  for (const n of path) {
    const nd = city.nodes[n];
    const eid = city.edgeBetween.get(prev * 100000 + n);
    if (eid === undefined) { prev = n; continue; }
    const e = city.edges[eid];
    const sp = edgeSpeed(city, e, tm, vehicleFactor) || 0.001;
    total += Math.hypot(nd.x - px, nd.y - py) / sp;
    px = nd.x; py = nd.y; prev = n;
  }
  return total;
}
