// Top-down vehicle models, drawn once per type and light phase into offscreen sprites.
// Sprites face +x (east); the map rotates them to the vehicle's heading.

type Kind = 'car' | 'suv' | 'bike' | 'van' | 'engine' | 'ladder' | 'rescue' | 'boat' | 'ambulance' | 'foot' | 'bicycle';
interface Model { kind: Kind; len: number; wid: number; body: string; roof: string; accent: string; bar: [string, string]; livery?: 'police' | 'traffic' | 'supervisor' | 'fire' | 'medic' | 'tactical' | 'eod'; tag?: string }

/** body length and width are in sprite units (a patrol car is 30 × 14) */
const MODELS: Record<string, Model> = {
  patrol: { kind: 'car', len: 30, wid: 14, body: '#16233a', roof: '#f1f4f8', accent: '#f1f4f8', bar: ['#ff2e3b', '#2f7bff'], livery: 'police' },
  traffic: { kind: 'car', len: 31, wid: 14, body: '#f1f4f8', roof: '#f1f4f8', accent: '#1e5fd6', bar: ['#ff2e3b', '#2f7bff'], livery: 'traffic' },
  police_supervisor: { kind: 'suv', len: 32, wid: 15, body: '#16233a', roof: '#16233a', accent: '#f1f4f8', bar: ['#ff2e3b', '#2f7bff'], livery: 'supervisor' },
  motorcycle: { kind: 'bike', len: 20, wid: 7, body: '#f1f4f8', roof: '#16233a', accent: '#1e5fd6', bar: ['#ff2e3b', '#2f7bff'], livery: 'police' },
  van: { kind: 'van', len: 34, wid: 15, body: '#f1f4f8', roof: '#e6eaef', accent: '#1e5fd6', bar: ['#ff2e3b', '#2f7bff'], livery: 'police' },
  foot: { kind: 'foot', len: 9, wid: 10, body: '#16233a', roof: '#0d1420', accent: '#d8ff3a', bar: ['#ff2e3b', '#2f7bff'], livery: 'police' },
  bicycle: { kind: 'bicycle', len: 18, wid: 6, body: '#16233a', roof: '#f1f4f8', accent: '#d8ff3a', bar: ['#ff2e3b', '#2f7bff'], livery: 'police' },
  public_order: { kind: 'van', len: 37, wid: 16, body: '#1b2433', roof: '#273246', accent: '#ffd23a', bar: ['#ff2e3b', '#2f7bff'], livery: 'police', tag: 'PUBLIC ORDER' },
  bomb_squad: { kind: 'van', len: 38, wid: 16, body: '#2b3340', roof: '#353f4e', accent: '#ffd23a', bar: ['#ff2e3b', '#2f7bff'], livery: 'eod', tag: 'BOMB SQUAD' },
  federal_tactical: { kind: 'suv', len: 33, wid: 15, body: '#0f1115', roof: '#0f1115', accent: '#3a414b', bar: ['#ff2e3b', '#2f7bff'], livery: 'supervisor' },
  negotiator_team: { kind: 'suv', len: 32, wid: 15, body: '#2a3140', roof: '#2a3140', accent: '#d8dde2', bar: ['#ff2e3b', '#2f7bff'], livery: 'supervisor', tag: 'CNT' },
  k9_unit: { kind: 'suv', len: 32, wid: 15, body: '#f1f4f8', roof: '#16233a', accent: '#1e5fd6', bar: ['#ff2e3b', '#2f7bff'], livery: 'police', tag: 'K9' },
  regional_hazmat: { kind: 'rescue', len: 42, wid: 17, body: '#e2b23c', roof: '#e8eaec', accent: '#2a2f36', bar: ['#ff2e3b', '#ffb020'], livery: 'fire', tag: 'HAZMAT' },
  usar: { kind: 'rescue', len: 46, wid: 17, body: '#3c4a5a', roof: '#d9dcdf', accent: '#ff8a1e', bar: ['#ff2e3b', '#ffffff'], livery: 'fire', tag: 'USAR' },
  coast_guard: { kind: 'van', len: 36, wid: 16, body: '#f2f4f6', roof: '#f2f4f6', accent: '#e2581e', bar: ['#ff2e3b', '#2f7bff'], livery: 'police', tag: 'COAST GUARD' },
  guard_eod: { kind: 'van', len: 40, wid: 17, body: '#4b5a3a', roof: '#56664a', accent: '#2f3a24', bar: ['#ffb020', '#ffb020'], livery: 'eod', tag: 'EOD' },
  fd_ambulance: { kind: 'ambulance', len: 36, wid: 15, body: '#f5f6f2', roof: '#f5f6f2', accent: '#c3242b', bar: ['#ff2e3b', '#ffffff'], livery: 'medic' },
  paramedic_engine: { kind: 'engine', len: 42, wid: 16, body: '#c3242b', roof: '#e8eaec', accent: '#7ee2ad', bar: ['#ff2e3b', '#ffffff'], livery: 'fire' },
  hazmat: { kind: 'rescue', len: 42, wid: 17, body: '#c3242b', roof: '#e8eaec', accent: '#ffd23a', bar: ['#ff2e3b', '#ffffff'], livery: 'fire', tag: 'HAZMAT' },
  tactical: { kind: 'van', len: 36, wid: 16, body: '#20262e', roof: '#2b323b', accent: '#525c68', bar: ['#ff2e3b', '#2f7bff'], livery: 'tactical' },
  engine: { kind: 'engine', len: 42, wid: 16, body: '#c3242b', roof: '#e8eaec', accent: '#f4f4f4', bar: ['#ff2e3b', '#ffffff'], livery: 'fire' },
  ladder: { kind: 'ladder', len: 52, wid: 16, body: '#c3242b', roof: '#e8eaec', accent: '#f4f4f4', bar: ['#ff2e3b', '#ffffff'], livery: 'fire' },
  rescue: { kind: 'rescue', len: 38, wid: 16, body: '#c3242b', roof: '#e8eaec', accent: '#f4f4f4', bar: ['#ff2e3b', '#ffffff'], livery: 'fire' },
  heavy_rescue: { kind: 'rescue', len: 44, wid: 17, body: '#c3242b', roof: '#d9dcdf', accent: '#f4f4f4', bar: ['#ff2e3b', '#ffffff'], livery: 'fire' },
  command: { kind: 'suv', len: 32, wid: 15, body: '#c3242b', roof: '#c3242b', accent: '#f4f4f4', bar: ['#ff2e3b', '#ffffff'], livery: 'fire' },
  water_rescue: { kind: 'rescue', len: 38, wid: 16, body: '#c3242b', roof: '#e8eaec', accent: '#ffd23a', bar: ['#ff2e3b', '#ffffff'], livery: 'fire' },
  ambulance: { kind: 'ambulance', len: 36, wid: 15, body: '#f5f6f2', roof: '#f5f6f2', accent: '#e8c21b', bar: ['#ff2e3b', '#2f7bff'], livery: 'medic' },
  advanced_ambulance: { kind: 'ambulance', len: 38, wid: 15, body: '#f5f6f2', roof: '#f5f6f2', accent: '#2f9e4f', bar: ['#ff2e3b', '#2f7bff'], livery: 'medic' },
  critical_transport: { kind: 'ambulance', len: 40, wid: 16, body: '#f5f6f2', roof: '#f5f6f2', accent: '#c3242b', bar: ['#ff2e3b', '#2f7bff'], livery: 'medic' },
  paramedic: { kind: 'suv', len: 31, wid: 14, body: '#f5f6f2', roof: '#f5f6f2', accent: '#2f9e4f', bar: ['#ff2e3b', '#2f7bff'], livery: 'medic' },
  med_supervisor: { kind: 'suv', len: 31, wid: 14, body: '#f5f6f2', roof: '#f5f6f2', accent: '#e8c21b', bar: ['#ff2e3b', '#2f7bff'], livery: 'medic' },
};
const FALLBACK: Record<string, string> = { police: 'patrol', fire: 'engine', medical: 'ambulance' };
/** paint schemes chosen in the garage: they recolour the body and accents */
export const LIVERIES: Record<string, Array<{ id: string; label: string; body?: string; roof?: string; accent?: string }>> = {
  police: [{ id: 'classic', label: 'Classic black & white' }, { id: 'modern', label: 'Modern battenburg', body: '#f1f4f8', roof: '#f1f4f8', accent: '#1e5fd6' }, { id: 'slicktop', label: 'Slicktop (unmarked)', body: '#2a2f36', roof: '#2a2f36', accent: '#2a2f36' }, { id: 'hivis', label: 'High-vis', body: '#f1f4f8', roof: '#d8ff3a', accent: '#d8ff3a' }],
  fire: [{ id: 'classic', label: 'Fire-engine red' }, { id: 'redwhite', label: 'Red & white', roof: '#ffffff', accent: '#ffffff' }, { id: 'lime', label: 'Safety lime', body: '#c6d93a', roof: '#f4f4f4', accent: '#c3242b' }, { id: 'black', label: 'Midnight', body: '#1f2328', roof: '#c3242b', accent: '#c3242b' }],
  medical: [{ id: 'classic', label: 'White & yellow' }, { id: 'red', label: 'White & red', accent: '#c3242b' }, { id: 'green', label: 'White & green', accent: '#2f9e4f' }, { id: 'yellow', label: 'All yellow', body: '#f2d33a', roof: '#f2d33a', accent: '#1e5fd6' }],
};
export function modelFor(type: string, service: string): Model { return MODELS[type] ?? MODELS[FALLBACK[service] ?? 'patrol']; }

const SCALE = 5;
const cache = new Map<string, HTMLCanvasElement>();

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function shadeHex(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** light bar: two halves; phase 0 = off, 1 = first colour lit, 2 = second colour lit */
function lightBar(c: CanvasRenderingContext2D, x: number, w: number, wid: number, m: Model, phase: number) {
  const h = wid * 0.7, y = -h / 2;
  c.fillStyle = '#1c1f24'; rr(c, x - 0.3, y - 0.3, w + 0.6, h + 0.6, 0.8); c.fill();
  const on = (i: number) => (phase === 0 ? false : phase === 1 ? i === 0 : i === 1);
  for (let i = 0; i < 2; i++) {
    const col = m.bar[i];
    c.fillStyle = on(i) ? col : shadeHex(col.length === 7 ? col : '#888888', 0.35);
    rr(c, x, i === 0 ? y : 0.15, w, h / 2 - 0.15, 0.6); c.fill();
    if (on(i)) { c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillRect(x + w * 0.3, i === 0 ? y + h * 0.12 : h * 0.12, w * 0.4, h * 0.14); }
  }
}
function wheels(c: CanvasRenderingContext2D, len: number, wid: number, axles: number[]) {
  c.fillStyle = '#0d0f12';
  for (const ax of axles) { const x = -len / 2 + len * ax; c.fillRect(x - 2.2, -wid / 2 - 0.9, 4.4, 1.8); c.fillRect(x - 2.2, wid / 2 - 0.9, 4.4, 1.8); }
}
function glass(c: CanvasRenderingContext2D, pts: number[][]) {
  const g = c.createLinearGradient(pts[0][0], pts[0][1], pts[2][0], pts[2][1]);
  g.addColorStop(0, '#2a3a4c'); g.addColorStop(0.5, '#3f5a74'); g.addColorStop(1, '#1b2632');
  c.fillStyle = g; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) c.lineTo(p[0], p[1]); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 0.3; c.stroke();
}

function drawModel(c: CanvasRenderingContext2D, m: Model, phase: number) {
  const L = m.len, W = m.wid, hl = L / 2, hw = W / 2;
  switch (m.kind) {
    case 'foot': {
      // two officers walking a beat side by side
      for (const oy of [-2.4, 2.4]) {
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(-0.6, oy + 0.6, 2.4, 2.1, 0, 0, 7); c.fill();
        c.fillStyle = m.body; c.beginPath(); c.ellipse(-0.4, oy, 2.1, 2.6, 0, 0, 7); c.fill();
        c.fillStyle = m.accent; c.fillRect(-1.6, oy - 2.5, 1.2, 5);
        c.fillStyle = '#d9b38c'; c.beginPath(); c.arc(0.6, oy, 1.25, 0, 7); c.fill();
        c.fillStyle = m.roof; c.beginPath(); c.arc(0.4, oy, 1.3, Math.PI * 0.6, Math.PI * 1.4); c.fill();
      }
      return;
    }
    case 'bicycle': {
      c.strokeStyle = '#0d0f12'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(-hl, 0); c.lineTo(-hl + 4.5, 0); c.moveTo(hl - 4.5, 0); c.lineTo(hl, 0); c.stroke();
      c.strokeStyle = '#8a929c'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(-hl + 3, 0); c.lineTo(hl - 3, 0); c.moveTo(hl - 3.5, -2.4); c.lineTo(hl - 3.5, 2.4); c.stroke();
      c.fillStyle = m.accent; c.beginPath(); c.ellipse(-1, 0, 3.2, 2.6, 0, 0, 7); c.fill();
      c.fillStyle = m.roof; c.beginPath(); c.arc(1.2, 0, 1.6, 0, 7); c.fill(); c.strokeStyle = '#1b2632'; c.lineWidth = 0.4; c.stroke();
      c.fillStyle = phase === 1 ? m.bar[0] : '#5a2228'; c.fillRect(-hl + 1, -0.6, 1, 1.2);
      c.fillStyle = phase === 2 ? m.bar[1] : '#22305a'; c.fillRect(hl - 1.6, -0.6, 1, 1.2);
      return;
    }
    case 'bike': {
      c.fillStyle = '#0d0f12'; c.fillRect(-hl, -0.9, 4, 1.8); c.fillRect(hl - 4, -0.9, 4, 1.8);
      c.fillStyle = m.body; rr(c, -hl + 3, -2.2, L - 6, 4.4, 1.8); c.fill();
      c.fillStyle = m.accent; c.fillRect(-2, -2.2, 5, 4.4);
      c.fillStyle = '#e9edf1'; c.beginPath(); c.arc(-1.5, 0, 2.6, 0, 7); c.fill(); c.strokeStyle = '#1b2632'; c.lineWidth = 0.5; c.stroke();
      c.fillStyle = '#1b2632'; c.fillRect(-0.6, -2.6, 1.2, 5.2);
      c.fillStyle = phase === 1 ? m.bar[0] : '#5a2228'; c.fillRect(hl - 6, -3.3, 2, 1.2);
      c.fillStyle = phase === 2 ? m.bar[1] : '#22305a'; c.fillRect(hl - 6, 2.1, 2, 1.2);
      return;
    }
    case 'car': case 'suv': {
      wheels(c, L, W, [0.2, 0.78]);
      // body with subtle shading toward the edges
      const g = c.createLinearGradient(0, -hw, 0, hw);
      g.addColorStop(0, shadeHex(m.body, 0.82)); g.addColorStop(0.5, shadeHex(m.body, 1.08)); g.addColorStop(1, shadeHex(m.body, 0.82));
      c.fillStyle = g; rr(c, -hl, -hw, L, W, m.kind === 'suv' ? 2.2 : 3.2); c.fill();
      if (m.livery === 'police') { c.fillStyle = m.accent; c.fillRect(-L * 0.12, -hw, L * 0.3, 1.4); c.fillRect(-L * 0.12, hw - 1.4, L * 0.3, 1.4); }
      if (m.livery === 'traffic') { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#1e5fd6' : '#ffd23a'; c.fillRect(-hl + 3 + i * 3.2, -hw, 3.2, 1.3); c.fillRect(-hl + 3 + i * 3.2, hw - 1.3, 3.2, 1.3); } }
      if (m.livery === 'medic') { c.fillStyle = m.accent; c.fillRect(-hl + 2, -hw, L - 4, 1.4); c.fillRect(-hl + 2, hw - 1.4, L - 4, 1.4); }
      if (m.livery === 'fire' || m.livery === 'supervisor') { c.fillStyle = m.accent; c.fillRect(-hl + 4, -0.6, L - 8, 1.2); }
      // windscreen, roof, rear window
      glass(c, [[L * 0.12, -hw + 1.6], [L * 0.26, -hw + 2.4], [L * 0.26, hw - 2.4], [L * 0.12, hw - 1.6]]);
      c.fillStyle = m.roof; rr(c, -L * 0.22, -hw + 1.8, L * 0.34, W - 3.6, 1.6); c.fill();
      glass(c, [[-L * 0.3, -hw + 2], [-L * 0.22, -hw + 2.6], [-L * 0.22, hw - 2.6], [-L * 0.3, hw - 2]]);
      // hood crease and mirrors
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(L * 0.3, -hw * 0.5); c.lineTo(hl - 1.5, -hw * 0.4); c.moveTo(L * 0.3, hw * 0.5); c.lineTo(hl - 1.5, hw * 0.4); c.stroke();
      c.fillStyle = shadeHex(m.body, 0.7); c.fillRect(L * 0.14, -hw - 1.2, 1.6, 1.4); c.fillRect(L * 0.14, hw - 0.2, 1.6, 1.4);
      // head and tail lights
      c.fillStyle = '#fff6d8'; c.fillRect(hl - 1.2, -hw + 1.2, 1.2, 2.4); c.fillRect(hl - 1.2, hw - 3.6, 1.2, 2.4);
      c.fillStyle = '#b3141c'; c.fillRect(-hl, -hw + 1.2, 1, 2.4); c.fillRect(-hl, hw - 3.6, 1, 2.4);
      if (m.livery === 'police' || m.livery === 'traffic') { c.fillStyle = '#9aa3ad'; c.fillRect(hl - 0.4, -hw + 2.5, 1.4, W - 5); }
      lightBar(c, -L * 0.07, L * 0.11, W, m, phase);
      return;
    }
    case 'van': {
      wheels(c, L, W, [0.18, 0.8]);
      c.fillStyle = shadeHex(m.body, 0.95); rr(c, -hl, -hw, L, W, 2.4); c.fill();
      glass(c, [[L * 0.2, -hw + 1.4], [L * 0.33, -hw + 2.2], [L * 0.33, hw - 2.2], [L * 0.2, hw - 1.4]]);
      c.fillStyle = m.roof; rr(c, -hl + 1.5, -hw + 1.2, L * 0.68, W - 2.4, 1.2); c.fill();
      if (m.livery === 'police') { for (let i = 0; i < 10; i++) { c.fillStyle = i % 2 ? '#1e5fd6' : '#ffd23a'; c.fillRect(-hl + 2 + i * 3, -hw, 3, 1.3); c.fillRect(-hl + 2 + i * 3, hw - 1.3, 3, 1.3); } }
      if (m.livery === 'eod') { for (let i = 0; i < 12; i++) { c.fillStyle = i % 2 ? m.accent : '#1c1f24'; c.fillRect(-hl + 2 + i * 2.6, -hw, 2.6, 1.3); c.fillRect(-hl + 2 + i * 2.6, hw - 1.3, 2.6, 1.3); } }
      if (m.tag) { c.fillStyle = 'rgba(255,255,255,0.85)'; c.font = 'bold 2.6px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(m.tag, -L * 0.12, 0); }
      if (m.livery === 'tactical') { c.fillStyle = '#3a434e'; rr(c, -L * 0.25, -W * 0.22, L * 0.25, W * 0.44, 1); c.fill(); c.fillStyle = '#d8dde3'; c.font = 'bold 3px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('SWAT', -L * 0.06, 0); }
      c.fillStyle = '#fff6d8'; c.fillRect(hl - 1.2, -hw + 1, 1.2, 2.4); c.fillRect(hl - 1.2, hw - 3.4, 1.2, 2.4);
      lightBar(c, L * 0.08, L * 0.09, W, m, phase);
      return;
    }
    case 'ambulance': {
      wheels(c, L, W, [0.2, 0.82]);
      // box body and cab
      c.fillStyle = shadeHex(m.body, 0.96); rr(c, -hl, -hw, L * 0.74, W, 1.6); c.fill();
      c.fillStyle = m.body; rr(c, L * 0.2, -hw + 0.8, L * 0.3, W - 1.6, 2.6); c.fill();
      glass(c, [[L * 0.3, -hw + 1.8], [L * 0.42, -hw + 2.6], [L * 0.42, hw - 2.6], [L * 0.3, hw - 1.8]]);
      // chequered side bands
      for (let i = 0; i < 9; i++) { c.fillStyle = i % 2 ? m.accent : '#1e5fd6'; c.fillRect(-hl + 1 + i * (L * 0.72 / 9), -hw, L * 0.72 / 9, 1.5); c.fillRect(-hl + 1 + i * (L * 0.72 / 9), hw - 1.5, L * 0.72 / 9, 1.5); }
      // roof: AC unit and star of life
      c.fillStyle = '#c9ced4'; rr(c, -hl + 3, -W * 0.22, L * 0.16, W * 0.44, 0.8); c.fill();
      c.fillStyle = '#1e5fd6'; c.beginPath(); c.arc(-L * 0.08, 0, W * 0.24, 0, 7); c.fill();
      c.strokeStyle = '#ffffff'; c.lineWidth = 0.9;
      for (let k = 0; k < 3; k++) { const a = (k * Math.PI) / 3; c.beginPath(); c.moveTo(-L * 0.08 + Math.cos(a) * W * 0.17, Math.sin(a) * W * 0.17); c.lineTo(-L * 0.08 - Math.cos(a) * W * 0.17, -Math.sin(a) * W * 0.17); c.stroke(); }
      // corner beacons and cab bar
      const on = (i: number) => phase !== 0 && ((phase === 1) === (i % 2 === 0));
      [[-hl + 1.2, -hw + 1.2], [-hl + 1.2, hw - 1.2], [L * 0.2, -hw + 1.2], [L * 0.2, hw - 1.2]].forEach(([x, y], i) => { c.fillStyle = on(i) ? (i < 2 ? m.bar[0] : m.bar[1]) : '#7a3a3a'; c.beginPath(); c.arc(x, y, 1.1, 0, 7); c.fill(); });
      lightBar(c, L * 0.22, L * 0.07, W, m, phase);
      c.fillStyle = '#fff6d8'; c.fillRect(hl - 1, -hw + 1.4, 1, 2.2); c.fillRect(hl - 1, hw - 3.6, 1, 2.2);
      return;
    }
    case 'engine': case 'ladder': case 'rescue': {
      wheels(c, L, W, m.kind === 'ladder' ? [0.14, 0.3, 0.82] : [0.18, 0.8]);
      const g = c.createLinearGradient(0, -hw, 0, hw);
      g.addColorStop(0, shadeHex(m.body, 0.78)); g.addColorStop(0.5, shadeHex(m.body, 1.06)); g.addColorStop(1, shadeHex(m.body, 0.78));
      c.fillStyle = g; rr(c, -hl, -hw, L, W, 1.8); c.fill();
      // cab: white roof, windscreen
      const cab = L * 0.22;
      c.fillStyle = m.roof; rr(c, hl - cab, -hw + 1, cab - 3, W - 2, 1.4); c.fill();
      glass(c, [[hl - 3.2, -hw + 1.4], [hl - 1.2, -hw + 2.2], [hl - 1.2, hw - 2.2], [hl - 3.2, hw - 1.4]]);
      // reflective band
      c.fillStyle = m.accent; c.fillRect(-hl + 1, -hw, L - cab - 1, 1.1); c.fillRect(-hl + 1, hw - 1.1, L - cab - 1, 1.1);
      if (m.kind === 'ladder') {
        // aerial ladder running the length of the truck
        c.fillStyle = '#9aa3ad'; c.fillRect(-hl + 2, -2.4, L * 0.86, 4.8);
        c.strokeStyle = '#d5dade'; c.lineWidth = 0.5; c.beginPath();
        for (let x = -hl + 3; x < -hl + 2 + L * 0.86; x += 2.2) { c.moveTo(x, -2.2); c.lineTo(x, 2.2); }
        c.moveTo(-hl + 2, -2.2); c.lineTo(-hl + 2 + L * 0.86, -2.2); c.moveTo(-hl + 2, 2.2); c.lineTo(-hl + 2 + L * 0.86, 2.2); c.stroke();
        c.fillStyle = '#5c646d'; c.beginPath(); c.arc(-hl + 6, 0, 3.4, 0, 7); c.fill();
      } else {
        // hose bed and equipment compartments
        c.fillStyle = shadeHex(m.body, 0.72); rr(c, -hl + 2, -hw + 2.4, L * 0.32, W - 4.8, 1); c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 0.35; c.beginPath(); for (let k = 1; k < 5; k++) { const y = -hw + 2.4 + (W - 4.8) * (k / 5); c.moveTo(-hl + 2.5, y); c.lineTo(-hl + 1.5 + L * 0.32, y); } c.stroke();
        c.fillStyle = '#c9ced4'; c.fillRect(-L * 0.12, -hw + 2.2, L * 0.22, W - 4.4);
        c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 0.3; c.strokeRect(-L * 0.12, -hw + 2.2, L * 0.22, W - 4.4);
        if (m.kind === 'rescue') { c.fillStyle = m.accent; c.fillRect(-hl + 2, -0.5, L - cab - 4, 1); }
        if (m.tag) { c.fillStyle = m.accent; c.save(); c.translate(-L * 0.28, 0); c.rotate(Math.PI / 4); c.fillRect(-2.2, -2.2, 4.4, 4.4); c.restore(); }
      }
      lightBar(c, hl - cab + 0.5, 2.4, W, m, phase);
      [[-hl + 1, -hw + 1], [-hl + 1, hw - 1]].forEach(([x, y], i) => { c.fillStyle = phase && (phase === 1) === (i === 0) ? m.bar[0] : '#6a2525'; c.beginPath(); c.arc(x, y, 1, 0, 7); c.fill(); });
      c.fillStyle = '#fff6d8'; c.fillRect(hl - 0.8, -hw + 1.4, 0.8, 2); c.fillRect(hl - 0.8, hw - 3.4, 0.8, 2);
      return;
    }
    default: return;
  }
}

/** a cached sprite for a unit type in a light phase (0 off, 1 / 2 alternating) */
/** garage chassis reshape the base vehicle: bigger trucks, smaller rapid-response cars */
const CHASSIS_SHAPE: Record<string, Partial<Model>> = {
  interceptor: { len: 31, wid: 14 }, suv: { kind: 'suv', len: 32, wid: 15 }, armoured: { kind: 'van', len: 35, wid: 16, body: '#262d38', roof: '#323b48' },
  rapid: { len: 35, wid: 15 }, heavy: { len: 46, wid: 17 },
  rapid_med: { kind: 'suv', len: 31, wid: 14 }, box: { len: 40, wid: 16 }, offroad: { kind: 'suv', len: 34, wid: 15 },
};
export function vehicleSprite(type: string, service: string, phase: number, livery?: string, chassis?: string): { img: HTMLCanvasElement; len: number; wid: number } {
  const shape = chassis ? CHASSIS_SHAPE[chassis] : undefined;
  const base0 = modelFor(type, service);
  const base = shape ? { ...base0, ...shape } : base0;
  const lv = livery && livery !== 'classic' ? LIVERIES[service]?.find((x) => x.id === livery) : undefined;
  const m: Model = lv ? { ...base, body: lv.body ?? base.body, roof: lv.roof ?? base.roof, accent: lv.accent ?? base.accent } : base;
  const key = `${type}|${service}|${phase}|${lv?.id ?? ''}|${shape ? chassis : ''}`;
  let img = cache.get(key);
  if (!img) {
    img = document.createElement('canvas');
    img.width = Math.ceil((m.len + 4) * SCALE); img.height = Math.ceil((m.wid + 4) * SCALE);
    const c = img.getContext('2d')!;
    c.setTransform(SCALE, 0, 0, SCALE, img.width / 2, img.height / 2);
    drawModel(c, m, phase);
    cache.set(key, img);
  }
  return { img, len: m.len + 4, wid: m.wid + 4 };
}
/** where the light bar sits along the body (−0.5 rear … 0.5 front), for the glow */
export function barOffset(type: string, service: string): number {
  const m = modelFor(type, service);
  return m.kind === 'engine' || m.kind === 'ladder' || m.kind === 'rescue' ? 0.36 : m.kind === 'ambulance' ? 0.24 : m.kind === 'van' ? 0.12 : -0.03;
}
