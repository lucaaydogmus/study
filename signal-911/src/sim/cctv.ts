// City CCTV network. Cameras are fixed on poles and point one way; some can pan and zoom, some see in
// the dark, some are simply broken today. Nothing is automatic: you pick a camera, wait for the stream,
// point it, zoom, work out what you are looking at — and only then report it against an incident.
import type { GameEngine } from './engine';
import type { City } from './city';
import { addressOf } from './city';
import { TEMPLATE_BY_ID } from './content/templates';
import type { Incident, Unit } from './types';
import { isAir } from './fleet';

export interface Camera {
  id: string; node: number; x: number; y: number;
  /** direction the camera faces at rest (radians, map space) */
  heading: number;
  /** horizontal field of view at zoom 1 */
  fov: number;
  /** how far it can make things out in daylight (world units) */
  range: number;
  /** pan/tilt/zoom dome: can be turned and has optical zoom */
  ptz: boolean;
  /** infrared: still useful after dark */
  ir: boolean;
  street: string; cross: string; district: string;
}
export interface CctvLink { cam: string; readyAt: number; pan: number; zoom: number; moveUntil: number; tagUntil: number }
export interface Detection {
  key: string; kind: 'incident' | 'unit' | 'suspect' | 'vehicle' | 'street';
  x: number; y: number; label: string; clarity: number;
}
export interface CctvView {
  cam: Camera; state: 'connecting' | 'nosignal' | 'moving' | 'live';
  progress: number; heading: number; fov: number; range: number; zoom: number;
  night: boolean; ir: boolean; weather: string; detections: Detection[];
}

const h01 = (a: number, b: number) => {
  let h = Math.imul(a + 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};
const angDiff = (a: number, b: number) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

let cache: { city: City; list: Camera[] } | null = null;
/** every camera in the city: at landmarks and on the main roads, each aimed down one street */
export function cameraList(city: City): Camera[] {
  if (cache?.city === city) return cache.list;
  const out: Camera[] = [];
  const seen = new Set<number>();
  const add = (n: number) => {
    if (seen.has(n)) return; seen.add(n);
    const m = city.nodes[n];
    const k = out.length;
    const nb = city.adj[n].map((e) => { const ed = city.edges[e]; return ed.a === n ? ed.b : ed.a; });
    const aim = nb.length ? city.nodes[nb[Math.floor(h01(n, 1) * nb.length)]] : null;
    const heading = aim ? Math.atan2(aim.y - m.y, aim.x - m.x) + (h01(n, 2) - 0.5) * 0.3 : h01(n, 3) * Math.PI * 2;
    const ptz = h01(n, 4) < 0.38;
    out.push({
      id: `CAM-${String(k + 1).padStart(3, '0')}`, node: n, x: m.x + (h01(n, 5) - 0.5) * 6, y: m.y + (h01(n, 6) - 0.5) * 6,
      heading, fov: ptz ? 0.95 : 0.85 + h01(n, 7) * 0.4, range: ptz ? 135 + h01(n, 8) * 40 : 95 + h01(n, 8) * 45,
      ptz, ir: h01(n, 9) < (ptz ? 0.55 : 0.3), street: m.addrStreet, cross: m.crossStreet, district: m.district,
    });
  };
  for (const l of city.landmarks) add(l.nodeId);
  for (const m of city.nodes) if (m.i % 4 === 0 && m.j % 3 === 0 && city.adj[m.id].some((e) => city.edges[e].cls !== 'local')) add(m.id);
  for (const m of city.nodes) if ((m.i + 2) % 5 === 0 && (m.j + 1) % 4 === 0 && city.adj[m.id].some((e) => city.edges[e].cls === 'arterial')) add(m.id);
  cache = { city, list: out };
  return out;
}
export const cameraById = (city: City, id: string) => cameraList(city).find((c) => c.id === id) ?? null;

/** a camera that is broken today (vandalised, no power, maintenance) — you only find out when you try it */
export function cameraOffline(e: GameEngine, cam: Camera): boolean {
  const st = e.state;
  const idx = parseInt(cam.id.slice(4), 10);
  const storm = st.weather === 'storm' ? 0.1 : 0;
  const dark = (st.events ?? []).some((v) => v.active && v.type === 'blackout' && (!v.districts || v.districts.includes(cam.district))) ? 0.6 : 0;
  return h01(idx, st.seed % 100000) < 0.14 + storm + dark;
}

const isNight = (hour: number) => { const h = ((hour % 24) + 24) % 24; return h >= 20.5 || h < 5.5; };
const WEATHER_RANGE: Record<string, number> = { fog: 0.45, rain: 0.8, storm: 0.6, snow: 0.7, heat: 0.95 };
/** what the dispatcher can see happening outdoors at an incident */
function visibleScene(inc: Incident): string | null {
  if (inc.truth.outside || inc.hidden || ['RESOLVED', 'CLOSED'].includes(inc.status)) return null;
  const tpl = TEMPLATE_BY_ID[inc.templateId];
  if (inc.mover) return null; // handled as a moving target
  if (inc.category === 'fire') return inc.threat > 20 || inc.stage > 0 ? 'Smoke rising from a building' : 'Light haze over the rooftops';
  if (tpl?.ambience === 'traffic') return inc.templateId.includes('fire') ? 'Vehicle burning' : 'Vehicles stopped at odd angles';
  if (tpl?.ambience === 'crowd') return inc.category === 'police' ? 'Crowd, people pushing and shouting' : 'People gathered around someone';
  if (tpl?.ambience === 'wind' || tpl?.ambience === 'outdoor') return 'Something is wrong in the street';
  return null;
}

export function cctvLink(e: GameEngine): CctvLink | null { return e.state.cctv?.link ?? null; }

/** start pulling a camera's stream: it takes a few seconds, more in bad weather */
export function cctvConnect(e: GameEngine, camId: string): { ok: boolean; reason?: string } {
  const st = e.state;
  const cam = cameraById(e.city, camId);
  if (!cam) return { ok: false, reason: 'Unknown camera' };
  st.cctv ??= { link: null, tried: {}, tags: 0, wrong: 0 };
  if (st.cctv.link?.cam === camId) return { ok: true };
  const idx = parseInt(cam.id.slice(4), 10);
  const wait = 3.5 + h01(idx, Math.floor(st.time)) * 4.5 + (st.weather === 'storm' ? 3 : 0);
  st.cctv.link = { cam: camId, readyAt: st.time + wait, pan: 0, zoom: 1, moveUntil: 0, tagUntil: 0 };
  return { ok: true };
}
export function cctvDisconnect(e: GameEngine) { if (e.state.cctv) e.state.cctv.link = null; }

/** turn a dome camera; the picture smears while it moves */
export function cctvPan(e: GameEngine, dir: number): { ok: boolean; reason?: string } {
  const l = cctvLink(e);
  if (!l) return { ok: false, reason: 'No camera connected' };
  const cam = cameraById(e.city, l.cam)!;
  if (!cam.ptz) return { ok: false, reason: `${cam.id} is a fixed camera — it only looks one way` };
  if (e.state.time < l.readyAt) return { ok: false, reason: 'Still connecting' };
  l.pan += Math.sign(dir) * 0.32;
  l.moveUntil = e.state.time + 1.2;
  return { ok: true };
}
export function cctvZoom(e: GameEngine, z: number): { ok: boolean; reason?: string } {
  const l = cctvLink(e);
  if (!l) return { ok: false, reason: 'No camera connected' };
  const cam = cameraById(e.city, l.cam)!;
  l.zoom = Math.max(1, Math.min(cam.ptz ? 4 : 2, z));
  l.moveUntil = e.state.time + (cam.ptz ? 1 : 0.3);
  return { ok: true };
}

/** the live picture: what is in frame and how clearly */
export function cctvView(e: GameEngine): CctvView | null {
  const st = e.state;
  const l = cctvLink(e);
  if (!l) return null;
  const cam = cameraById(e.city, l.cam);
  if (!cam) return null;
  const night = isNight(st.timeOfDay);
  const heading = cam.heading + l.pan;
  // optical zoom narrows the view and reaches further; digital zoom only crops
  const fov = cam.fov / l.zoom;
  const reach = cam.range * (WEATHER_RANGE[st.weather] ?? 1) * (night ? (cam.ir ? 0.8 : 0.42) : 1) * (cam.ptz ? 1 + (l.zoom - 1) * 0.55 : 1);
  const base = { cam, heading, fov, range: reach, zoom: l.zoom, night, ir: cam.ir && night, weather: st.weather, detections: [] as Detection[] };
  if (st.time < l.readyAt) return { ...base, state: 'connecting', progress: 1 - (l.readyAt - st.time) / 8 };
  if (cameraOffline(e, cam)) { st.cctv!.tried[cam.id] = 'offline'; return { ...base, state: 'nosignal', progress: 1 }; }
  st.cctv!.tried[cam.id] = 'ok';
  if (st.time < l.moveUntil) return { ...base, state: 'moving', progress: 1 };
  const dets: Detection[] = [];
  const consider = (key: string, kind: Detection['kind'], x: number, y: number, label: string, glow = false) => {
    const d = Math.hypot(x - cam.x, y - cam.y);
    const lim = glow ? Math.max(reach, cam.range * 0.9) : reach;
    if (d > lim || d < 2) return;
    if (Math.abs(angDiff(Math.atan2(y - cam.y, x - cam.x), heading)) > fov / 2) return;
    const clarity = Math.max(0, Math.min(1, (1 - d / lim) * (cam.ptz ? 1 : 0.85) * (l.zoom > 1 && cam.ptz ? 1.25 : 1) + (glow ? 0.25 : 0)));
    dets.push({ key, kind, x, y, label, clarity });
  };
  for (const inc of Object.values(st.incidents)) {
    if (inc.mover && !['RESOLVED', 'CLOSED'].includes(inc.status) && st.time >= inc.mover.startAt) {
      consider(`m:${inc.id}`, inc.mover.foot ? 'suspect' : 'vehicle', inc.mover.x, inc.mover.y, inc.mover.foot ? 'Person running' : inc.mover.caller ? 'Car driving erratically' : 'Car at high speed');
      continue;
    }
    const what = visibleScene(inc);
    if (!what) continue;
    const n = e.city.nodes[inc.nodeId];
    consider(`i:${inc.id}`, 'incident', n.x + (h01(inc.num, 11) - 0.5) * 14, n.y + (h01(inc.num, 12) - 0.5) * 14, what, inc.category === 'fire');
  }
  for (const u of Object.values(st.units)) {
    if (isAir(u) || u.status === 'AVAILABLE' && u.speed < 0.05) continue;
    consider(`u:${u.id}`, 'unit', u.x, u.y, u.service === 'police' ? 'Police vehicle' : u.service === 'fire' ? 'Fire appliance' : 'Ambulance');
  }
  // ordinary street life: most of what a camera sees is nothing at all
  const bucket = Math.floor(st.time / 25);
  const idx = parseInt(cam.id.slice(4), 10);
  const STREET = night ? ['People outside a bar', 'Car parked with lights on', 'Someone walking alone', 'Taxi waiting'] : ['Group of pedestrians', 'Delivery van double-parked', 'Car pulled over', 'Cyclist', 'Someone walking a dog', 'Kids on scooters'];
  const n = Math.floor(h01(idx, bucket) * 3);
  for (let k = 0; k < n; k++) {
    const a = heading + (h01(idx * 7 + k, bucket) - 0.5) * fov * 0.9, r = reach * (0.25 + h01(idx * 13 + k, bucket) * 0.65);
    consider(`s:${idx}:${bucket}:${k}`, 'street', cam.x + Math.cos(a) * r, cam.y + Math.sin(a) * r, STREET[Math.floor(h01(idx + k, bucket + 3) * STREET.length)]);
  }
  for (const d of dets) if (d.clarity < 0.28 && d.kind !== 'incident') d.label = 'Indistinct movement';
  return { ...base, state: 'live', progress: 1, detections: dets.sort((a, b) => b.clarity - a.clarity) };
}

/** report something seen on camera against an incident */
export function cctvTag(e: GameEngine, key: string, incId: string): { ok: boolean; reason?: string; text?: string } {
  const st = e.state;
  const v = cctvView(e);
  if (!v || v.state !== 'live') return { ok: false, reason: 'No live picture' };
  const l = st.cctv!.link!;
  if (st.time < l.tagUntil) return { ok: false, reason: 'Still reviewing the last clip' };
  l.tagUntil = st.time + 3;
  const d = v.detections.find((x) => x.key === key);
  if (!d) return { ok: false, reason: 'It is out of frame now' };
  const inc = st.incidents[incId];
  if (!inc) return { ok: false, reason: 'Pick an incident to report this against' };
  if (d.clarity < 0.28) return { ok: false, reason: 'Too far away to make out — zoom in or find a closer camera' };
  const where = addressOf(e.city, e.city.nearestNode(d.x, d.y));
  const [kind, ref] = key.split(':');
  if (kind === 's') { e.log('info', `CCTV ${v.cam.id}: nothing relevant (${d.label.toLowerCase()})`, { incidentId: incId }); return { ok: true, text: `Nothing there — ${d.label.toLowerCase()}. Ordinary street activity.` }; }
  if (kind === 'u') { const u = st.units[ref] as Unit | undefined; return { ok: true, text: u ? `That is one of ours — ${u.callsign}.` : 'One of ours.' }; }
  const target = st.incidents[ref];
  if (!target) return { ok: false, reason: 'Gone' };
  st.cctv!.tags++; st.stats.cctvTags = (st.stats.cctvTags ?? 0) + 1;
  if (target.id !== inc.id) {
    // you matched the wrong scene: the incident now points somewhere it is not
    st.cctv!.wrong++; st.stats.wrongLinks++;
    if (target.category !== inc.category) return { ok: true, text: `That does not match the call — it looks like a ${target.category === 'fire' ? 'fire' : target.category === 'medical' ? 'medical emergency' : target.category === 'police' ? 'police matter' : 'different incident'}.` };
    e.noteHeard(inc, e.city.nearestNode(d.x, d.y), `${v.cam.id}: possible match near ${where}`, 'unsure');
    e.log('info', `CCTV ${v.cam.id} tagged near ${where}`, { incidentId: inc.id });
    return { ok: true, text: `Logged as a possible match near ${where}.` };
  }
  if (kind === 'm') {
    const m = target.mover!;
    m.lastSighting = st.time; m.camTag = { cam: v.cam.id, at: st.time };
    target.reportedNode = target.nodeId;
    if (target.locatedAt === null) target.locatedAt = st.time;
    e.radio('DISPATCH', `All units, ${m.foot ? 'suspect on foot' : 'suspect vehicle'} on city camera ${v.cam.id}, ${where}. ${m.foot ? 'Heading' : 'Travelling'} ${dirWord(m.heading)}.`, 'dispatch', undefined, target.id);
    e.log('info', `CCTV ${v.cam.id}: ${m.foot ? 'suspect' : 'vehicle'} spotted at ${where}`, { incidentId: target.id });
    return { ok: true, text: `Got them — ${where}, ${dirWord(m.heading)}. Keep the camera on them and the position stays live.` };
  }
  const tpl = e.instanceTemplate(target);
  for (const k of ['fire', 'smoke', 'vehicles', 'people', 'trapped'].filter((x) => x in target.truth)) if (target.facts.every((f) => f.key !== k || f.confidence === 'contradicted')) e.addFact(target, k, target.truth[k], 'confirmed', 'scene');
  if (tpl.ambience === 'traffic' || tpl.ambience === 'crowd') for (const k of ['injured', 'suspect'].filter((x) => x in target.truth)) e.addFact(target, k, target.truth[k], 'confirmed', 'scene');
  e.noteHeard(target, target.nodeId, `${v.cam.id}: incident visible at ${addressOf(e.city, target.nodeId)}`, 'sure');
  if (target.reportedNode === null) e.setIncidentLocation(target.id, target.nodeId, 'candidate');
  e.log('info', `CCTV ${v.cam.id} confirmed ${target.label} at ${addressOf(e.city, target.nodeId)}`, { incidentId: target.id });
  const off = target.reportedNode !== null && target.reportedNode !== target.nodeId && Math.hypot(e.city.nodes[target.reportedNode].x - e.city.nodes[target.nodeId].x, e.city.nodes[target.reportedNode].y - e.city.nodes[target.nodeId].y) > 90;
  return { ok: true, text: off ? `Confirmed — but it is at ${addressOf(e.city, target.nodeId)}, not where you have it.` : `Confirmed on camera at ${addressOf(e.city, target.nodeId)}.` };
}

/** a tagged moving target stays tracked while it is still in the live picture */
export function cctvTracking(e: GameEngine, inc: Incident): boolean {
  const m = inc.mover;
  if (!m?.camTag || !e.state.cctv?.link || e.state.cctv.link.cam !== m.camTag.cam) return false;
  const v = cctvView(e);
  return !!v && v.state === 'live' && v.detections.some((d) => d.key === `m:${inc.id}` && d.clarity >= 0.2);
}

const dirWord = (h: number) => ['eastbound', 'southbound', 'westbound', 'northbound'][((Math.round(h / (Math.PI / 2)) % 4) + 4) % 4];
