// Procedurally generated (but fully deterministic) city: RAVENPORT.
// A warped lattice of road nodes is laid over twelve districts; highways, arterials and local
// streets are classed, a river splits north from south (crossed only by bridges) and the harbor
// sits on the southern coast.
import { Rng, hashString } from './rng';
import type { District, Landmark, RoadEdge, RoadNode, Vec } from './types';

export const WORLD_W = 2000;
export const WORLD_H = 1400;
const COLS = 41; // nodes along x (i = 0..40)
const ROWS = 25; // nodes along y (j = 0..24)
const LAND_H = 1300;

const XB = [0, 470, 990, 1490, 2000];
const YB = [0, 432, 864, LAND_H];

interface DDef { id: string; name: string; tags: string[]; ci: number; cj: number; rank: number; traffic: number; w: [number, number, number, number]; blurb: string }
// weights: medical, fire, police, unusual
const DISTRICT_DEFS: DDef[] = [
  { id: 'westres', name: 'West Residential', tags: ['residential'], ci: 0, cj: 0, rank: 1, traffic: 0.3, w: [1.2, 0.8, 1, 1.1], blurb: 'Family homes and quiet streets. Kitchen fires, falls and neighbourhood disputes.' },
  { id: 'university', name: 'University District', tags: ['campus', 'residential'], ci: 1, cj: 0, rank: 2, traffic: 0.4, w: [1, 0.8, 1.2, 1.4], blurb: 'Lecture halls, dorms and a stadium. Sports injuries, parties, strange calls.' },
  { id: 'northsub', name: 'North Suburbs', tags: ['suburb', 'residential'], ci: 2, cj: 0, rank: 4, traffic: 0.25, w: [1, 0.9, 0.9, 1], blurb: 'Spread-out cul-de-sacs. Long drives for every responder.' },
  { id: 'airport', name: 'Airport District', tags: ['airport', 'industrial'], ci: 3, cj: 0, rank: 4, traffic: 0.5, w: [0.9, 1.1, 1, 0.9], blurb: 'Terminals, cargo aprons and fast roads. Traffic spikes with every arrival bank.' },
  { id: 'oldtown', name: 'Old Town', tags: ['historic', 'dense'], ci: 0, cj: 1, rank: 1, traffic: 0.55, w: [1, 1.2, 1, 1.2], blurb: 'Narrow historic streets, old wiring and crowded market days.' },
  { id: 'downtown', name: 'Downtown', tags: ['commercial', 'dense'], ci: 1, cj: 1, rank: 1, traffic: 0.8, w: [1.1, 1, 1.2, 1.1], blurb: 'Heavy traffic and crowds. Everything happens here, slowly.' },
  { id: 'financial', name: 'Financial District', tags: ['commercial', 'highrise'], ci: 2, cj: 1, rank: 2, traffic: 0.7, w: [0.9, 1.1, 1, 0.9], blurb: 'Glass towers, elevators and alarm systems.' },
  { id: 'eastwood', name: 'Eastwood', tags: ['suburb', 'forest'], ci: 3, cj: 1, rank: 4, traffic: 0.2, w: [1, 1, 0.8, 1.1], blurb: 'Woodland trails and scattered homes. Remote calls, brush fires.' },
  { id: 'southside', name: 'Southside', tags: ['residential', 'rail'], ci: 0, cj: 2, rank: 3, traffic: 0.45, w: [1.1, 1, 1.3, 1], blurb: 'Rail yards, markets and tight-knit blocks.' },
  { id: 'riverside', name: 'Riverside', tags: ['river', 'residential'], ci: 1, cj: 2, rank: 1, traffic: 0.5, w: [1.1, 1, 1, 1.1], blurb: 'Riverfront paths and low-lying streets that flood first.' },
  { id: 'industrial', name: 'Industrial Zone', tags: ['industrial'], ci: 2, cj: 2, rank: 3, traffic: 0.55, w: [0.8, 1.6, 0.8, 0.8], blurb: 'Steelworks, warehouses and chemical depots.' },
  { id: 'harbor', name: 'Harbor District', tags: ['harbor', 'industrial'], ci: 3, cj: 2, rank: 5, traffic: 0.5, w: [1, 1.2, 1, 1.2], blurb: 'Piers, containers and water rescues.' },
];

export interface City {
  nodes: RoadNode[]; edges: RoadEdge[]; adj: number[][]; districts: District[];
  districtById: Record<string, District>; landmarks: Landmark[];
  streetNames: { cols: string[]; rows: string[] };
  riverline: Vec[]; coast: Vec[]; parks: Vec[][]; blocks: Array<{ poly: Vec[]; district: string; kind: 'building' | 'park' | 'plaza' }>;
  hospitals: number[]; edgeBetween: Map<number, number>;
  nodeAt: (i: number, j: number) => number;
  nearestNode: (x: number, y: number) => number;
  nodesInDistrict: Record<string, number[]>;
  maxSpeedClassKmh: number;
  sites: Record<string, number>; // station sites key `${service}:${districtId}`
}

const NAME_A = ['Westbrook', 'Alder', 'Birch', 'Cedar', 'Dalton', 'Elm', 'Fenwick', 'Garnet', 'Hale', 'Ivory', 'Juniper', 'Kestrel', 'Larkspur', 'Mercer', 'Norwood', 'Oak', 'Pine', 'Quincy', 'Rowan', 'Sable', 'Thorne', 'Upland', 'Vesper', 'Willow', 'Yarrow', 'Ashby', 'Briar', 'Calloway', 'Dunmore', 'Everett', 'Foster', 'Granger', 'Holloway', 'Ingram', 'Jasper', 'Kingsley', 'Lowell', 'Maddox', 'Nolan', 'Orchard', 'Prescott', 'Radley', 'Sutton', 'Tennyson', 'Vale', 'Whitmore', 'Aspen', 'Bramley', 'Corbin', 'Delmar'];
const ARTERIAL_NAMES = ['Grand', 'Harbor', 'Meridian', 'Liberty', 'Ravenport', 'Victory', 'Capitol', 'Union', 'Lantern', 'Ironbridge'];

function bilerp(a: Vec, b: Vec, c: Vec, d: Vec, s: number, t: number): Vec {
  // a=top-left b=top-right c=bottom-left d=bottom-right
  const x1 = a.x + (b.x - a.x) * s, y1 = a.y + (b.y - a.y) * s;
  const x2 = c.x + (d.x - c.x) * s, y2 = c.y + (d.y - c.y) * s;
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
}

let cached: City | null = null;
export function getCity(): City {
  if (cached) return cached;
  cached = buildCity(20260911);
  return cached;
}

export function buildCity(seed: number): City {
  const rng = new Rng(seed);
  // warped corner grid
  const P: Vec[][] = [];
  for (let i = 0; i <= 4; i++) {
    P[i] = [];
    for (let j = 0; j <= 3; j++) {
      const inner = i > 0 && i < 4 && j > 0 && j < 3;
      P[i][j] = { x: XB[i] + (inner ? rng.range(-34, 34) : (i > 0 && i < 4 ? rng.range(-12, 12) : 0)), y: YB[j] + (inner ? rng.range(-26, 26) : (j > 0 && j < 3 ? rng.range(-12, 12) : 0)) };
    }
  }
  const mapUV = (i: number, j: number): Vec => {
    const u = (i / (COLS - 1)) * 4, v = (j / (ROWS - 1)) * 3;
    const ci = Math.min(3, Math.floor(u)), cj = Math.min(2, Math.floor(v));
    return bilerp(P[ci][cj], P[ci + 1][cj], P[ci][cj + 1], P[ci + 1][cj + 1], u - ci, v - cj);
  };
  const cellOf = (i: number, j: number) => ({ ci: Math.min(3, Math.floor(((i + 0.0001) / (COLS - 1)) * 4)), cj: Math.min(2, Math.floor(((j + 0.0001) / (ROWS - 1)) * 3)) });

  // street names
  const used = new Set<string>();
  const nameFor = (suffix: string, arterial: boolean, highway: boolean, idx: number): string => {
    if (highway) return 'Ravenport Expressway';
    for (let tries = 0; tries < 200; tries++) {
      const base = arterial ? rng.pick(ARTERIAL_NAMES) : rng.pick(NAME_A);
      const nm = `${base} ${suffix}`;
      if (!used.has(nm)) { used.add(nm); return nm; }
    }
    return `${idx}th ${suffix}`;
  };
  const colNames: string[] = [], rowNames: string[] = [];
  for (let i = 0; i < COLS; i++) colNames.push(nameFor(i % 5 === 0 ? 'Boulevard' : 'Street', i % 5 === 0, i === 20, i));
  for (let j = 0; j < ROWS; j++) rowNames.push(nameFor(j % 4 === 0 ? 'Parkway' : 'Avenue', j % 4 === 0, false, j));

  // nodes
  const nodes: RoadNode[] = [];
  const idx = (i: number, j: number) => j * COLS + i;
  const districtByCell: Record<string, string> = {};
  for (const d of DISTRICT_DEFS) districtByCell[`${d.ci},${d.cj}`] = d.id;
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const p = mapUV(i, j);
      const { ci, cj } = cellOf(i, j);
      const useRow = (i * 7 + j * 3) % 2 === 0;
      const h = hashString(`${i},${j}`);
      const num = useRow ? 100 + i * 21 + (h % 9) * 2 + (j % 2) : 100 + j * 31 + (h % 9) * 2 + (i % 2);
      nodes.push({
        id: idx(i, j), x: p.x, y: p.y, i, j, district: districtByCell[`${ci},${cj}`],
        addrStreet: useRow ? rowNames[j] : colNames[i], addrNumber: num, crossStreet: useRow ? colNames[i] : rowNames[j],
      });
    }
  }
  // edges
  const edges: RoadEdge[] = [];
  const riverCrossRow = 16; // between row 16 and 17 lies the river
  const bridgeCols = new Set([5, 15, 20, 25, 35]);
  const mk = (a: number, b: number, cls: RoadClass2, name: string) => {
    const na = nodes[a], nb = nodes[b];
    edges.push({ id: edges.length, a, b, len: Math.hypot(na.x - nb.x, na.y - nb.y), cls, name });
  };
  type RoadClass2 = RoadEdge['cls'];
  const candidates: Array<{ a: number; b: number; cls: RoadClass2; name: string; removable: boolean }> = [];
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      if (i + 1 < COLS) {
        const arterial = j % 4 === 0;
        candidates.push({ a: idx(i, j), b: idx(i + 1, j), cls: arterial ? 'arterial' : 'local', name: rowNames[j], removable: !arterial });
      }
      if (j + 1 < ROWS) {
        const crossing = j === riverCrossRow;
        if (crossing && !bridgeCols.has(i)) continue;
        const hw = i === 20, art = i % 5 === 0;
        candidates.push({ a: idx(i, j), b: idx(i, j + 1), cls: crossing ? 'bridge' : hw ? 'highway' : art ? 'arterial' : 'local', name: colNames[i], removable: !hw && !art && !crossing });
      }
    }
  }
  // highway ring: the west-east expressway on row 8 and 20 upgraded to highway
  for (const c of candidates) {
    const na = nodes[c.a], nb = nodes[c.b];
    if (na.j === nb.j && (na.j === 8 || na.j === 20) && c.cls === 'arterial') { c.cls = 'highway'; c.name = 'Ravenport Expressway'; }
  }
  // random removals keeping degree >= 2
  const deg = new Array(nodes.length).fill(0);
  for (const c of candidates) { deg[c.a]++; deg[c.b]++; }
  for (const c of candidates) {
    if (c.removable && deg[c.a] > 2 && deg[c.b] > 2 && rng.chance(0.11)) { deg[c.a]--; deg[c.b]--; continue; }
    mk(c.a, c.b, c.cls, c.name);
  }
  const adj: number[][] = nodes.map(() => []);
  const edgeBetween = new Map<number, number>();
  for (const e of edges) { adj[e.a].push(e.id); adj[e.b].push(e.id); edgeBetween.set(e.a * 100000 + e.b, e.id); edgeBetween.set(e.b * 100000 + e.a, e.id); }

  // connectivity safeguard
  const seen = new Uint8Array(nodes.length);
  const stack = [0]; seen[0] = 1;
  while (stack.length) { const n = stack.pop()!; for (const eid of adj[n]) { const e = edges[eid]; const o = e.a === n ? e.b : e.a; if (!seen[o]) { seen[o] = 1; stack.push(o); } } }
  for (let n = 0; n < nodes.length; n++) {
    if (seen[n]) continue;
    // connect isolated nodes to a seen neighbour on the lattice
    const nd = nodes[n];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = nd.i + di, nj = nd.j + dj;
      if (ni < 0 || nj < 0 || ni >= COLS || nj >= ROWS) continue;
      const m = idx(ni, nj);
      if (seen[m] && !(Math.min(nj, nd.j) === riverCrossRow && dj !== 0)) { mk(n, m, 'local', nd.addrStreet); const eid = edges.length - 1; adj[n].push(eid); adj[m].push(eid); edgeBetween.set(n * 100000 + m, eid); edgeBetween.set(m * 100000 + n, eid); seen[n] = 1; break; }
    }
  }

  // districts
  const districts: District[] = DISTRICT_DEFS.map((d) => {
    const poly = [P[d.ci][d.cj], P[d.ci + 1][d.cj], P[d.ci + 1][d.cj + 1], P[d.ci][d.cj + 1]];
    const center = { x: poly.reduce((s, p) => s + p.x, 0) / 4, y: poly.reduce((s, p) => s + p.y, 0) / 4 };
    return { id: d.id, name: d.name, tags: d.tags, poly, center, unlockRank: d.rank, baseTraffic: d.traffic, weights: { medical: d.w[0], fire: d.w[1], police: d.w[2], unusual: d.w[3] }, blurb: d.blurb };
  });
  const districtById: Record<string, District> = {};
  for (const d of districts) districtById[d.id] = d;
  const nodesInDistrict: Record<string, number[]> = {};
  for (const d of districts) nodesInDistrict[d.id] = [];
  for (const n of nodes) nodesInDistrict[n.district].push(n.id);

  const nodeAt = (i: number, j: number) => idx(i, j);
  // spatial grid for nearestNode
  const nearestNode = (x: number, y: number): number => {
    let best = 0, bd = Infinity;
    // coarse guess via lattice inverse is not exact because of warping; scan with early-out by rows
    for (let n = 0; n < nodes.length; n++) {
      const dx = nodes[n].x - x, dy = nodes[n].y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };

  // river & coast lines
  const riverline: Vec[] = [];
  for (let i = 0; i < COLS; i += 1) {
    const a = nodes[idx(i, riverCrossRow)], b = nodes[idx(i, riverCrossRow + 1)];
    riverline.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + Math.sin(i * 0.55) * 5 });
  }
  const coast: Vec[] = [];
  for (let i = 0; i < COLS; i++) { const n = nodes[idx(i, ROWS - 1)]; coast.push({ x: n.x, y: n.y + 26 + Math.sin(i * 0.8) * 6 + (i > 28 ? 10 : 0) }); }

  // blocks (cells between lattice nodes) for building fill / parks
  const blocks: City['blocks'] = [];
  const parks: Vec[][] = [];
  for (let j = 0; j < ROWS - 1; j++) {
    if (j === riverCrossRow) continue;
    for (let i = 0; i < COLS - 1; i++) {
      const a = nodes[idx(i, j)], b = nodes[idx(i + 1, j)], c = nodes[idx(i + 1, j + 1)], d = nodes[idx(i, j + 1)];
      const inset = 4;
      const cx = (a.x + b.x + c.x + d.x) / 4, cy = (a.y + b.y + c.y + d.y) / 4;
      const shrink = (p: Vec) => ({ x: p.x + (cx - p.x) * (inset / Math.max(10, Math.hypot(cx - p.x, cy - p.y))), y: p.y + (cy - p.y) * (inset / Math.max(10, Math.hypot(cx - p.x, cy - p.y))) });
      const poly = [shrink(a), shrink(b), shrink(c), shrink(d)];
      const h = hashString(`blk${i},${j}`) % 100;
      const dist = a.district;
      const tags = districtById[dist].tags;
      let kind: 'building' | 'park' | 'plaza' = 'building';
      const parkChance = tags.includes('forest') ? 45 : tags.includes('suburb') ? 12 : tags.includes('residential') ? 9 : tags.includes('campus') ? 14 : tags.includes('river') ? 10 : tags.includes('industrial') ? 2 : 4;
      if (h < parkChance) kind = 'park'; else if (h > 96) kind = 'plaza';
      blocks.push({ poly, district: dist, kind });
      if (kind === 'park') parks.push(poly);
    }
  }

  // landmarks
  const landmarks: Landmark[] = [];
  const lmDefs: Record<string, Array<[string, string]>> = {
    downtown: [['Ravenport General Hospital', 'hospital'], ['City Hall', 'civic'], ['Grand Central Station', 'transit'], ['Lumen Plaza', 'plaza']],
    financial: [['Meridian Tower', 'tower'], ['Exchange Square', 'plaza'], ['Ravenport Savings Bank', 'bank']],
    oldtown: [['Cathedral of St. Aldric', 'church'], ['Lantern Market', 'market'], ['Old Clock Tower', 'monument']],
    riverside: [['St. Maren Hospital', 'hospital'], ['Ironbridge Park', 'park'], ['Riverside Cinema', 'cinema']],
    industrial: [['Dray Steelworks', 'factory'], ['Eastgate Warehouses', 'warehouse'], ['Pellham Chemical Depot', 'depot']],
    harbor: [['Harbor Pier 9', 'pier'], ['Cargo Terminal', 'terminal'], ['Harbor Clinic', 'hospital'], ['Lighthouse Point', 'monument']],
    university: [['Ravenport University', 'campus'], ['Hale Library', 'library'], ['University Hospital', 'hospital'], ['Corvid Stadium', 'stadium']],
    northsub: [['Birchwood Mall', 'mall'], ['Maple Elementary School', 'school'], ['Fairview Park', 'park']],
    westres: [['Westfield Plaza', 'mall'], ['Linden Park', 'park'], ['Saint Brigid School', 'school']],
    airport: [['Ravenport International Terminal', 'airport'], ['Airport Cargo Apron', 'cargo'], ['Skyline Hotel', 'hotel']],
    eastwood: [['Eastwood Trailhead', 'trail'], ['Old Mill Pond', 'pond'], ['Pinecrest Gas & Go', 'gas']],
    southside: [['Southside Market', 'market'], ['Rail Yard 4', 'rail'], ['Community Pool', 'pool']],
  };
  const takenNodes = new Set<number>();
  for (const d of districts) {
    const list = nodesInDistrict[d.id].filter((n) => nodes[n].i % 5 !== 0 || rng.chance(0.3));
    const defs = lmDefs[d.id] || [];
    defs.forEach(([name, kind], k) => {
      // spread landmarks around the centre
      const ang = (k / defs.length) * Math.PI * 2 + rng.range(0, 1);
      const tx = d.center.x + Math.cos(ang) * 90, ty = d.center.y + Math.sin(ang) * 60;
      let best = list[0], bd = Infinity;
      for (const n of list) { if (takenNodes.has(n)) continue; const dd = (nodes[n].x - tx) ** 2 + (nodes[n].y - ty) ** 2; if (dd < bd) { bd = dd; best = n; } }
      takenNodes.add(best);
      landmarks.push({ id: `${d.id}-${k}`, name, kind, nodeId: best, district: d.id });
    });
  }
  const hospitals = landmarks.filter((l) => l.kind === 'hospital').map((l) => l.nodeId);

  // station sites: one per service per district (offset nodes near centre)
  const sites: Record<string, number> = {};
  for (const d of districts) {
    (['police', 'fire', 'medical'] as const).forEach((s, k) => {
      const tx = d.center.x + (k - 1) * 38, ty = d.center.y + (k === 1 ? 30 : -22);
      let best = nodesInDistrict[d.id][0], bd = Infinity;
      for (const n of nodesInDistrict[d.id]) { if (takenNodes.has(n)) continue; const dd = (nodes[n].x - tx) ** 2 + (nodes[n].y - ty) ** 2; if (dd < bd) { bd = dd; best = n; } }
      takenNodes.add(best);
      sites[`${s}:${d.id}`] = best;
    });
  }

  return { nodes, edges, adj, districts, districtById, landmarks, streetNames: { cols: colNames, rows: rowNames }, riverline, coast, parks, blocks, hospitals, edgeBetween, nodeAt, nearestNode, nodesInDistrict, maxSpeedClassKmh: 90, sites };
}

export function addressOf(city: City, nodeId: number): string {
  const n = city.nodes[nodeId];
  return `${n.addrNumber} ${n.addrStreet}`;
}
export function fullAddress(city: City, nodeId: number): string {
  const n = city.nodes[nodeId];
  return `${n.addrNumber} ${n.addrStreet}, ${city.districtById[n.district].name}`;
}
export function nearestLandmark(city: City, nodeId: number, maxDist = 260): Landmark | null {
  const n = city.nodes[nodeId];
  let best: Landmark | null = null, bd = maxDist * maxDist;
  for (const l of city.landmarks) {
    const m = city.nodes[l.nodeId];
    const d = (m.x - n.x) ** 2 + (m.y - n.y) ** 2;
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}
export function searchAddresses(city: City, q: string, limit = 8): number[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const m = s.match(/^(\d+)\s*(.*)$/);
  const num = m ? parseInt(m[1], 10) : null;
  const text = (m ? m[2] : s).trim();
  const res: Array<{ id: number; score: number }> = [];
  for (const n of city.nodes) {
    const street = n.addrStreet.toLowerCase();
    if (text && !street.includes(text) && !n.crossStreet.toLowerCase().includes(text)) {
      // landmark text match handled below
      continue;
    }
    let score = street.includes(text) ? 0 : 50;
    if (num !== null) score += Math.abs(n.addrNumber - num);
    res.push({ id: n.id, score });
  }
  const lm = city.landmarks.filter((l) => l.name.toLowerCase().includes(s));
  const out: number[] = lm.map((l) => l.nodeId);
  res.sort((a, b) => a.score - b.score);
  for (const r of res) { if (out.length >= limit) break; if (!out.includes(r.id)) out.push(r.id); }
  return out.slice(0, limit);
}
