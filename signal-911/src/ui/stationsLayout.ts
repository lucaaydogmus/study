// Where each station stands, where its vehicles park, and how they visibly pull out of (and back
// into) their bays. Shared by the 3D city and the classic 2D map.
import type { City } from '../sim/city';
import type { GameState, Station, Unit } from '../sim/types';

export interface Pose { x: number; y: number; heading: number }
export interface StationLayout {
  x: number; y: number; rot: number; w: number; d: number;
  /** a point on the building in local coordinates (u across the front, v back from the road) */
  at: (u: number, v: number) => { x: number; y: number };
  /** parking slots on the forecourt, nose to the road */
  slots: Pose[];
  /** where each slot meets the road */
  exits: Array<{ x: number; y: number }>;
  heading: number;
}

/** building width/depth in world units (4 m each) */
export const STATION_W = 20, STATION_D = 9;

const cache = new Map<string, StationLayout>();
export function stationLayout(city: City, s: Station): StationLayout {
  const key = `${s.id}@${s.nodeId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = city.nodes[s.nodeId];
  const inside = (px: number, py: number) => city.blocks.some((b) => b.kind === 'building' && pointInPoly(px, py, b.poly));
  // prefer the block north of the junction, so the forecourt and bays face the road to the south (and the camera)
  let x = n.x + 15.5, y = n.y - 13.2, rot = Math.PI;
  for (const [sx, sy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
    const cx = n.x + sx * 15.5, cy = n.y + sy * 13.2;
    if (inside(cx, cy) && inside(cx - 9, cy) && inside(cx + 9, cy)) { x = cx; y = cy; rot = sy > 0 ? 0 : Math.PI; break; }
  }
  const c = Math.cos(rot), sn = Math.sin(rot);
  const at = (u: number, v: number) => ({ x: x + u * c - v * sn, y: y + u * sn + v * c });
  // forward = towards the road (−v)
  const heading = Math.atan2(-c, sn);
  const slots: Pose[] = [], exits: Array<{ x: number; y: number }> = [];
  const front = [-7.5, -2.5, 2.5, 7.5];
  for (const u of front) { const p = at(u, -4.9); slots.push({ ...p, heading }); exits.push(at(u, -8.6)); }
  for (const v of [-4.2, -0.4, 3.4]) { const p = at(12.6, v); slots.push({ ...p, heading }); exits.push(at(12.6, -8.6)); }
  const lay: StationLayout = { x, y, rot, w: STATION_W, d: STATION_D, at, slots, exits, heading };
  cache.set(key, lay);
  return lay;
}
function pointInPoly(x: number, y: number, q: Array<{ x: number; y: number }>): boolean {
  let ins = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const xi = q[i].x, yi = q[i].y, xj = q[j].x, yj = q[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

/** which slot a unit parks in at its own station (stable: by id order) */
export function slotOf(st: GameState, u: Unit): number {
  const mates = Object.values(st.units).filter((x) => x.stationId === u.stationId && !x.temp && x.type !== 'helicopter').map((x) => x.id).sort();
  return Math.max(0, mates.indexOf(u.id));
}
/** a unit sitting at its own station: parked, or turning out with the crew climbing aboard */
export function atStation(city: City, st: GameState, u: Unit): boolean {
  if (u.temp || u.type === 'helicopter' || u.speed > 0.05) return false;
  if (!['AVAILABLE', 'BUSY', 'OUT_OF_SERVICE', 'DISPATCHED'].includes(u.status)) return false;
  const s = st.stations[u.stationId];
  if (!s) return false;
  const n = city.nodes[s.nodeId];
  return Math.hypot(u.x - n.x, u.y - n.y) < 6;
}

type Anim = { path: Pose[]; t0: number; dur: number; out: boolean };
const ease = (t: number) => t * t * (3 - 2 * t);
/**
 * Visual poses for every unit, so vehicles are seen pulling out of their bay onto the road when they
 * are sent, and reversing back in when they return — instead of popping in and out of existence.
 */
export class VisualFleet {
  private mem = new Map<string, { bay: boolean; last: Pose; anim: Anim | null }>();
  pose(u: Unit, road: Pose, bay: { slot: Pose; exit: { x: number; y: number } } | null, parked: boolean, now: number): { pose: Pose; parked: boolean; moving: boolean } {
    let m = this.mem.get(u.id);
    if (!m) { m = { bay: parked && !!bay, last: parked && bay ? bay.slot : road, anim: null }; this.mem.set(u.id, m); }
    const wantBay = parked && !!bay;
    if (bay && wantBay !== m.bay) {
      // leaving: bay → kerb → wherever the engine has the unit now; arriving: road → kerb → bay
      const kerb = { x: bay.exit.x, y: bay.exit.y, heading: bay.slot.heading };
      m.anim = wantBay
        ? { path: [m.last, kerb, bay.slot], t0: now, dur: 2600, out: false }
        : { path: [bay.slot, kerb, road], t0: now, dur: 2400, out: true };
      m.bay = wantBay;
    }
    let pose = wantBay && bay ? bay.slot : road;
    let moving = false;
    if (m.anim) {
      const t = (now - m.anim.t0) / m.anim.dur;
      if (t >= 1) m.anim = null;
      else {
        const path = m.anim.path.slice();
        if (m.anim.out) path[path.length - 1] = road;
        pose = alongPath(path, ease(Math.max(0, t)), !m.anim.out);
        moving = true;
      }
    }
    m.last = pose;
    return { pose, parked: wantBay && !moving, moving };
  }
  forget(id: string) { this.mem.delete(id); }
}
function alongPath(path: Pose[], t: number, reverseIn: boolean): Pose {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) { const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y); seg.push(d); total += d; }
  if (total < 0.01) return path[path.length - 1];
  let d = t * total;
  for (let i = 1; i < path.length; i++) {
    if (d <= seg[i - 1] || i === path.length - 1) {
      const k = seg[i - 1] ? Math.min(1, d / seg[i - 1]) : 1;
      const a = path[i - 1], b = path[i];
      const dir = Math.atan2(b.y - a.y, b.x - a.x);
      // reversing into the bay on the last leg keeps the nose pointing at the road
      const heading = reverseIn && i === path.length - 1 ? b.heading : seg[i - 1] > 0.3 ? dir : b.heading;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, heading };
    }
    d -= seg[i - 1];
  }
  return path[path.length - 1];
}
