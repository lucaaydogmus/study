import { createRng } from './rng';
import type {
  Cell, CellKind, City, CNode, DistrictId, Edge, Landmark, RoadClass, Station, District,
} from './types';

export const WORLD_W = 1600;
export const WORLD_H = 1000;
/** The river is drawn as a gently curving band; bridges cross it. */
export const riverY = (x: number) => 708 + 10 * Math.sin(x / 140);
export const RIVER_HALF_WIDTH = 24;

interface Def {
  id: DistrictId; name: string; blurb: string; x: number; y: number; w: number; h: number;
  cols: number; rows: number; jitter: number; drop: number; base: RoadClass;
  artCols: number[]; artRows: number[]; traffic: number; tint: string;
  kind: (r: number, c: number, rnd: () => number) => CellKind;
  colNames: string[]; rowNames: string[];
}

const ave = (names: string[]) => names.map((n) => `${n} Ave`);
const st = (names: string[]) => names.map((n) => `${n} St`);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const nth = (count: number) => Array.from({ length: count }, (_, i) => ordinal(i + 1));

const DEFS: Def[] = [
  {
    id: 'westbrook', name: 'Westbrook Suburbs', blurb: 'Sparse suburban streets, parks, few stations.',
    x: 40, y: 40, w: 430, h: 640, cols: 5, rows: 8, jitter: 0.28, drop: 0.22, base: 'street',
    artCols: [2], artRows: [], traffic: 1.0, tint: '#15201f',
    kind: (_r, _c, rnd) => (rnd() < 0.28 ? 'park' : 'house'),
    colNames: ave(['Maple', 'Linden', 'Westbrook', 'Orchard', 'Hollis']),
    rowNames: st(['Quail', 'Larch', 'Meadow', 'Brook', 'Sparrow', 'Willow', 'Heron', 'Kestrel']),
  },
  {
    id: 'northside', name: 'Northside', blurb: 'Residential blocks, schools and local shopping.',
    x: 490, y: 40, w: 560, h: 310, cols: 8, rows: 5, jitter: 0.08, drop: 0.05, base: 'street',
    artCols: [3], artRows: [2], traffic: 1.1, tint: '#161f27',
    kind: (_r, _c, rnd) => (rnd() < 0.12 ? 'park' : 'house'),
    colNames: ave(['Ash', 'Beacon', 'Carver', 'Dale', 'Everett', 'Foster', 'Garnet', 'Hale']),
    rowNames: st(['Adams', 'Baker', 'Corbin', 'Dorset', 'Eaton']),
  },
  {
    id: 'downtown', name: 'Downtown', blurb: 'Dense grid, heavy traffic, frequent medical and traffic calls.',
    x: 490, y: 370, w: 560, h: 300, cols: 10, rows: 7, jitter: 0.03, drop: 0, base: 'street',
    artCols: [3, 6], artRows: [3], traffic: 1.5, tint: '#1a222c',
    kind: (_r, _c, rnd) => (rnd() < 0.06 ? 'park' : 'building'),
    colNames: ave(['Alder', 'Birch', 'Cedar', 'Dunmore', 'Elm', 'Fulton', 'Grant', 'Harlan', 'Ivy', 'Juniper']),
    rowNames: st(nth(7)),
  },
  {
    id: 'oldtown', name: 'Old Town', blurb: 'Narrow, winding streets and older buildings.',
    x: 1070, y: 40, w: 260, h: 630, cols: 6, rows: 12, jitter: 0.35, drop: 0.2, base: 'narrow',
    artCols: [], artRows: [5], traffic: 1.3, tint: '#201d1f',
    kind: () => 'building',
    colNames: ['Cooper Ln', 'Mason Ln', 'Tanner Ln', 'Chandler Ln', 'Cobbler Ln', 'Fuller Ln'],
    rowNames: ['Bell Row', 'Candle Row', 'Drover Row', 'Ember Row', 'Forge Row', 'Gilder Row', 'Hatter Row', 'Inkwell Row', 'Joiner Row', 'Kettle Row', 'Lantern Row', 'Mercer Row'],
  },
  {
    id: 'industrial', name: 'Industrial District', blurb: 'Warehouses, major roads, long distances.',
    x: 1350, y: 40, w: 210, h: 920, cols: 3, rows: 7, jitter: 0.06, drop: 0, base: 'arterial',
    artCols: [], artRows: [], traffic: 1.0, tint: '#1b1e22',
    kind: () => 'industrial',
    colNames: ['Foundry Rd', 'Eastgate Rd', 'Dockside Rd'],
    rowNames: ['Mill Way', 'Smelter Way', 'Freight Way', 'Cargo Way', 'Rail Way', 'Depot Way', 'Pier Way'],
  },
  {
    id: 'riverside', name: 'Riverside', blurb: 'Waterfront roads, bridges and parks.',
    x: 40, y: 750, w: 1290, h: 210, cols: 12, rows: 3, jitter: 0.05, drop: 0.1, base: 'street',
    artCols: [], artRows: [0], traffic: 1.15, tint: '#16222a',
    kind: (r, _c, rnd) => (r === 0 ? (rnd() < 0.5 ? 'park' : 'building') : 'building'),
    colNames: ave(['Pier', 'Quay', 'Regatta', 'Sable', 'Tidewater', 'Union', 'Vesper', 'Wharf', 'Yarrow', 'Zephyr', 'Anchor', 'Bascule']),
    rowNames: ['Waterfront Dr', 'Embankment St', 'Levee St'],
  },
];

interface LinkDef { a: DistrictId; b: DistrictId; k: number; cls: RoadClass; maxDist: number }
const LINKS: LinkDef[] = [
  { a: 'westbrook', b: 'northside', k: 2, cls: 'arterial', maxDist: 120 },
  { a: 'westbrook', b: 'downtown', k: 2, cls: 'arterial', maxDist: 120 },
  { a: 'northside', b: 'downtown', k: 3, cls: 'arterial', maxDist: 100 },
  { a: 'northside', b: 'oldtown', k: 2, cls: 'arterial', maxDist: 120 },
  { a: 'downtown', b: 'oldtown', k: 3, cls: 'arterial', maxDist: 120 },
  { a: 'oldtown', b: 'industrial', k: 3, cls: 'arterial', maxDist: 140 },
  { a: 'riverside', b: 'westbrook', k: 2, cls: 'bridge', maxDist: 170 },
  { a: 'riverside', b: 'downtown', k: 3, cls: 'bridge', maxDist: 170 },
  { a: 'riverside', b: 'oldtown', k: 2, cls: 'bridge', maxDist: 190 },
  { a: 'riverside', b: 'industrial', k: 2, cls: 'arterial', maxDist: 160 },
];

type StationDef = { id: string; name: string; service: Station['service']; d: DistrictId; fr: number; fc: number };
const STATIONS: StationDef[] = [
  { id: 'cpd', name: 'Central Precinct', service: 'police', d: 'downtown', fr: 0.5, fc: 0.55 },
  { id: 'npd', name: 'North Precinct', service: 'police', d: 'northside', fr: 0.5, fc: 0.85 },
  { id: 'wps', name: 'Westbrook Substation', service: 'police', d: 'westbrook', fr: 0.45, fc: 0.5 },
  { id: 'fs1', name: 'Fire Station 1', service: 'fire', d: 'downtown', fr: 0.15, fc: 0.15 },
  { id: 'fs2', name: 'Fire Station 2', service: 'fire', d: 'industrial', fr: 0.5, fc: 0.5 },
  { id: 'gen', name: 'General Hospital EMS', service: 'medical', d: 'downtown', fr: 0.9, fc: 0.8 },
  { id: 'nem', name: 'Northside EMS', service: 'medical', d: 'northside', fr: 0.25, fc: 0.2 },
  { id: 'rem', name: 'Riverside EMS', service: 'medical', d: 'riverside', fr: 0.5, fc: 0.7 },
];

const LANDMARKS: { name: string; d: DistrictId; fr: number; fc: number }[] = [
  { name: 'City Hall', d: 'downtown', fr: 0.5, fc: 0.2 },
  { name: 'Harbor Bridge', d: 'riverside', fr: 0, fc: 0.45 },
  { name: 'Riverside Park', d: 'riverside', fr: 0.5, fc: 0.15 },
  { name: 'Northside High', d: 'northside', fr: 0.4, fc: 0.35 },
  { name: 'Northgate Mall', d: 'northside', fr: 0.8, fc: 0.6 },
  { name: 'Old Cathedral', d: 'oldtown', fr: 0.3, fc: 0.5 },
  { name: 'Clock Tower Market', d: 'oldtown', fr: 0.75, fc: 0.4 },
  { name: 'Eastgate Mill', d: 'industrial', fr: 0.2, fc: 0.5 },
  { name: 'Port Terminal', d: 'industrial', fr: 0.9, fc: 0.5 },
  { name: 'Westbrook Park', d: 'westbrook', fr: 0.3, fc: 0.5 },
  { name: 'Westbrook Elementary', d: 'westbrook', fr: 0.8, fc: 0.3 },
];

let cached: City | null = null;
export function getCity(): City {
  return (cached ??= buildCity());
}

export function buildCity(): City {
  const rng = createRng(911);
  const nodes: CNode[] = [];
  const edges: Edge[] = [];
  const grids = {} as Record<DistrictId, CNode[][]>;
  const cells: Cell[] = [];
  const exists = new Set<string>();

  const addEdge = (a: number, b: number, cls: RoadClass, district: DistrictId) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a === b || exists.has(key)) return null;
    exists.add(key);
    const len = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
    const e: Edge = { id: edges.length, a, b, len, cls, district };
    edges.push(e);
    return e;
  };

  for (const d of DEFS) {
    const pad = 22;
    const cw = (d.w - pad * 2) / (d.cols - 1);
    const ch = (d.h - pad * 2) / (d.rows - 1);
    const grid: CNode[][] = [];
    for (let r = 0; r < d.rows; r++) {
      const row: CNode[] = [];
      for (let c = 0; c < d.cols; c++) {
        const edge = r === 0 || c === 0 || r === d.rows - 1 || c === d.cols - 1;
        const j = edge ? d.jitter * 0.4 : d.jitter;
        const n: CNode = {
          id: nodes.length,
          x: d.x + pad + c * cw + (rng.next() - 0.5) * 2 * j * cw,
          y: d.y + pad + r * ch + (rng.next() - 0.5) * 2 * j * ch,
          district: d.id,
          name: `${d.colNames[c]} & ${d.rowNames[r]}`,
          street: d.rowNames[r],
        };
        nodes.push(n);
        row.push(n);
      }
      grid.push(row);
    }
    grids[d.id] = grid;

    const local: Edge[] = [];
    for (let r = 0; r < d.rows; r++) {
      for (let c = 0; c < d.cols; c++) {
        if (c + 1 < d.cols) {
          const e = addEdge(grid[r][c].id, grid[r][c + 1].id, d.artRows.includes(r) ? 'arterial' : d.base, d.id);
          if (e) local.push(e);
        }
        if (r + 1 < d.rows) {
          const e = addEdge(grid[r][c].id, grid[r + 1][c].id, d.artCols.includes(c) ? 'arterial' : d.base, d.id);
          if (e) local.push(e);
        }
        if (r + 1 < d.rows && c + 1 < d.cols) {
          cells.push({
            pts: [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]].flatMap((n) => [n.x, n.y]),
            kind: d.kind(r, c, rng.next),
            district: d.id,
          });
        }
      }
    }
    // Drop some local streets to give the district its character, but never strand a node.
    if (d.drop > 0) {
      const deg = new Map<number, number>();
      for (const e of local) {
        deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
        deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
      }
      for (const e of local) {
        if (e.cls === 'arterial' || rng.next() > d.drop) continue;
        if ((deg.get(e.a) ?? 0) <= 2 || (deg.get(e.b) ?? 0) <= 2) continue;
        deg.set(e.a, deg.get(e.a)! - 1);
        deg.set(e.b, deg.get(e.b)! - 1);
        exists.delete(e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`);
        e.len = -1; // tombstone
      }
    }
  }
  // Remove tombstoned edges and re-index.
  const live = edges.filter((e) => e.len >= 0);
  live.forEach((e, i) => (e.id = i));
  edges.length = 0;
  edges.push(...live);

  // Inter-district links (arterials and river bridges).
  for (const L of LINKS) {
    const A = grids[L.a].flat();
    const B = grids[L.b].flat();
    const cand: { a: CNode; b: CNode; d: number }[] = [];
    for (const a of A) for (const b of B) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d <= L.maxDist) cand.push({ a, b, d });
    }
    cand.sort((p, q) => p.d - q.d);
    const chosen: { a: CNode; b: CNode }[] = [];
    for (const c of cand) {
      if (chosen.length >= L.k) break;
      const mx = (c.a.x + c.b.x) / 2, my = (c.a.y + c.b.y) / 2;
      const clash = chosen.some(
        (o) => o.a === c.a || o.b === c.b || Math.hypot((o.a.x + o.b.x) / 2 - mx, (o.a.y + o.b.y) / 2 - my) < 110,
      );
      if (!clash) chosen.push(c);
    }
    for (const c of chosen) addEdge(c.a.id, c.b.id, L.cls, L.cls === 'bridge' ? 'riverside' : c.a.district);
  }

  // Safety net: stitch any disconnected pieces together.
  const parent = nodes.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const e of edges) parent[find(e.a)] = find(e.b);
  for (;;) {
    const roots = new Set(nodes.map((n) => find(n.id)));
    if (roots.size <= 1) break;
    const main = find(0);
    let best: { a: number; b: number; d: number } | null = null;
    for (const a of nodes) {
      if (find(a.id) !== main) continue;
      for (const b of nodes) {
        if (find(b.id) === main) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (!best || d < best.d) best = { a: a.id, b: b.id, d };
      }
    }
    if (!best) break;
    addEdge(best.a, best.b, 'street', nodes[best.a].district);
    parent[find(best.a)] = find(best.b);
  }

  const adj: City['adj'] = nodes.map(() => []);
  for (const e of edges) {
    adj[e.a].push({ to: e.b, edge: e });
    adj[e.b].push({ to: e.a, edge: e });
  }

  const pick = (d: DistrictId, fr: number, fc: number) => {
    const g = grids[d];
    return g[Math.round(fr * (g.length - 1))][Math.round(fc * (g[0].length - 1))];
  };
  const stations: Station[] = STATIONS.map((s) => ({
    id: s.id, name: s.name, service: s.service, district: s.d, nodeId: pick(s.d, s.fr, s.fc).id,
  }));
  const landmarks: Landmark[] = LANDMARKS.map((l) => ({ name: l.name, district: l.d, nodeId: pick(l.d, l.fr, l.fc).id }));
  const districts: District[] = DEFS.map((d) => ({
    id: d.id, name: d.name, x: d.x, y: d.y, w: d.w, h: d.h, traffic: d.traffic, tint: d.tint, blurb: d.blurb,
  }));
  const nodesByDistrict = {} as Record<DistrictId, number[]>;
  for (const d of DEFS) nodesByDistrict[d.id] = grids[d.id].flat().map((n) => n.id);

  return { nodes, edges, adj, districts, cells, landmarks, stations, nodesByDistrict };
}
