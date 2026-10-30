import type { City, Edge } from './types';

export interface Path { nodes: number[]; edges: Edge[]; time: number }

/** Upper bound on any vehicle speed (world units / second); keeps the heuristic admissible. */
const V_MAX = 40;

class Heap {
  private f: number[] = [];
  private n: number[] = [];
  get size() { return this.n.length; }
  push(f: number, n: number) {
    let i = this.n.length;
    this.f.push(f); this.n.push(n);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= this.f[i]) break;
      this.swap(i, p); i = p;
    }
  }
  pop(): number {
    const top = this.n[0];
    const lf = this.f.pop()!, ln = this.n.pop()!;
    if (this.n.length) {
      this.f[0] = lf; this.n[0] = ln;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.n.length && this.f[l] < this.f[m]) m = l;
        if (r < this.n.length && this.f[r] < this.f[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.f[a], this.f[b]] = [this.f[b], this.f[a]];
    [this.n[a], this.n[b]] = [this.n[b], this.n[a]];
  }
}

/** A* over the road graph. `speedOf` returns units/second for an edge; blocked edges are skipped. */
export function findPath(
  city: City, from: number, to: number, speedOf: (e: Edge) => number, blocked?: ReadonlySet<number>,
): Path | null {
  if (from === to) return { nodes: [from], edges: [], time: 0 };
  const N = city.nodes.length;
  const g = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const prevEdge: (Edge | null)[] = new Array(N).fill(null);
  const closed = new Uint8Array(N);
  const goal = city.nodes[to];
  const h = (n: number) => Math.hypot(city.nodes[n].x - goal.x, city.nodes[n].y - goal.y) / V_MAX;
  const open = new Heap();
  g[from] = 0;
  open.push(h(from), from);
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === to) break;
    for (const { to: nb, edge } of city.adj[cur]) {
      if (closed[nb] || blocked?.has(edge.id)) continue;
      const v = speedOf(edge);
      if (v <= 0) continue;
      const ng = g[cur] + edge.len / v;
      if (ng < g[nb]) {
        g[nb] = ng; prev[nb] = cur; prevEdge[nb] = edge;
        open.push(ng + h(nb), nb);
      }
    }
  }
  if (!isFinite(g[to])) return null;
  const nodes: number[] = [];
  const edges: Edge[] = [];
  for (let n = to; n !== -1; n = prev[n]) {
    nodes.push(n);
    if (prevEdge[n]) edges.push(prevEdge[n]!);
  }
  nodes.reverse(); edges.reverse();
  return { nodes, edges, time: g[to] };
}
