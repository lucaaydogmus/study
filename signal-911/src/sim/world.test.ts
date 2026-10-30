import { describe, expect, it } from 'vitest';
import { getCity } from './city';
import { findPath } from './pathfinding';
import { answerCall, buildSummary, createWorld, dispatch, edgeSpeed, matchSlots, planRoute, recall, decide, decisionOptions, optionBlocked, shownCaps, coverers, step, type Incident, type World } from './world';
import { ask, endCall, questionStates } from './calls';
import { isConnected } from './pathfinding';

const cfg = { seed: 5, shiftMinutes: 10, difficulty: 'normal', weather: 'clear' } as const;

function reach(city = getCity()) {
  const seen = new Set([0]); const q = [0];
  while (q.length) for (const { to } of city.adj[q.pop()!]) if (!seen.has(to)) { seen.add(to); q.push(to); }
  return seen.size;
}

describe('city', () => {
  it('has six districts, a connected road graph and valid stations', () => {
    const c = getCity();
    expect(c.districts).toHaveLength(6);
    expect(reach(c)).toBe(c.nodes.length);
    expect(c.edges.every((e) => e.len > 0)).toBe(true);
    for (const s of c.stations) expect(c.nodes[s.nodeId]).toBeDefined();
  });
  it('A* finds a route between every station and respects blocked roads', () => {
    const c = getCity(); const speed = () => 10;
    for (const a of c.stations) for (const b of c.stations) {
      const p = findPath(c, a.nodeId, b.nodeId, speed)!;
      expect(p).not.toBeNull();
      expect(p.nodes[0]).toBe(a.nodeId); expect(p.nodes[p.nodes.length - 1]).toBe(b.nodeId);
      p.nodes.slice(1).forEach((n, i) => expect(c.adj[p.nodes[i]].some((x) => x.to === n)).toBe(true));
    }
    const p = findPath(c, c.stations[0].nodeId, c.stations[4].nodeId, speed)!;
    const blocked = new Set([p.edges[0].id]);
    const q = findPath(c, c.stations[0].nodeId, c.stations[4].nodeId, speed, blocked);
    if (q) expect(q.edges.some((e) => blocked.has(e.id))).toBe(false);
  });
});

describe('capability matching', () => {
  it('needs distinct units for duplicate slots and honours capabilities', () => {
    const w = createWorld(cfg);
    const amb = w.units.filter((u) => u.vehicle === 'ambulance');
    expect(matchSlots(['MEDICAL', 'MEDICAL'], [amb[0]]).filter(Boolean)).toHaveLength(1);
    expect(matchSlots(['MEDICAL', 'MEDICAL'], amb.slice(0, 2)).every(Boolean)).toBe(true);
    expect(matchSlots(['ADV_MEDICAL'], amb).some(Boolean)).toBe(false);
    const suv = w.units.find((u) => u.vehicle === 'suv')!;
    const patrol = w.units.find((u) => u.vehicle === 'patrol')!;
    expect(matchSlots(['SECURITY', 'LAW'], [suv]).every(Boolean)).toBe(true);
    expect(matchSlots(['SECURITY'], [patrol])[0]).toBeNull();
  });
});

/** Run a short, sensible conversation: address first, then a few questions, then hang up. */
function converse(w: World, inc: Incident, max = 4) {
  for (let n = 0; n < max && inc.session; n++) {
    const q = questionStates(inc).find((v) => v.state !== 'done' && (inc.believedNode === null ? v.q.key === 'ADDRESS' : v.q.group === 'Situation'));
    if (!q) break;
    ask(w, inc, q.q.key);
    for (let i = 0; i < 40 && inc.session?.pending; i++) step(w, 0.5);
  }
  if (inc.session) endCall(w, inc, 'player');
}

/** Naive bot: for each open incident, send the fastest units that fill open slots. */
function bot(w: World) {
  for (const inc of w.incidents) {
    if (inc.decision) { const o = decisionOptions(inc).filter((x) => !optionBlocked(w, inc, x)); decide(w, inc.id, o[(inc.id * 7) % o.length].id); }
    if (inc.status === 'RESOLVED' || inc.status === 'FAILED' || inc.believedNode === null) continue;
    const caps = shownCaps(inc);
    const open = matchSlots(caps, coverers(w, inc)).map((u, i) => (u ? null : caps[i])).filter(Boolean);
    if (!open.length) continue;
    const cands = w.units
      .filter((u) => u.status === 'AVAILABLE' || u.status === 'RETURNING')
      .map((u) => ({ u, eta: planRoute(w, u, inc.believedNode!)?.eta ?? Infinity }))
      .filter((c) => c.u.caps.some((cap) => open.includes(cap)))
      .sort((a, b) => a.eta - b.eta);
    if (cands.length) dispatch(w, inc.id, [cands[0].u.id]);
  }
}

function invariants(w: World) {
  for (const u of w.units) {
    if (u.status === 'AVAILABLE') { expect(u.incidentId).toBeNull(); expect(u.legs).toHaveLength(0); }
    if (u.status === 'EN ROUTE' || u.status === 'ON SCENE') {
      const inc = w.incidents.find((i) => i.id === u.incidentId)!;
      expect(inc).toBeDefined(); expect(inc.assigned).toContain(u.id);
    }
    expect(Number.isFinite(u.x) && Number.isFinite(u.y)).toBe(true);
  }
  expect(isConnected(w.city, w.blocked)).toBe(true);
  for (const id of w.blocked) expect(w.incidents.some((i) => i.blockEdge === id && i.blockActive)).toBe(true);
  for (const i of w.incidents) for (const id of i.assigned) {
    expect(w.units.find((u) => u.id === id)!.incidentId).toBe(i.id);
  }
}

describe('full shift', () => {
  it('runs to completion with consistent unit/incident state', () => {
    const w = createWorld(cfg);
    let steps = 0;
    while (!w.over && steps++ < 20000) {
      for (const c of w.calls) if (c.status === 'ringing' && w.time - c.ringAt > 3) { const inc = answerCall(w, c.id); if (inc) converse(w, inc); }
      bot(w);
      step(w, 0.25);
      if (steps % 20 === 0) invariants(w);
    }
    expect(w.over).toBe(true);
    const s = buildSummary(w);
    expect(s.answered + s.missed).toBe(w.calls.length);
    expect(s.resolved).toBeGreaterThan(3);
    expect(s.resolved + s.failed + s.unresolved).toBe(w.incidents.length);
    expect(['S', 'A', 'B', 'C', 'D', 'F']).toContain(s.grade);
  }, 30000);
  it('is deterministic for a seed', () => {
    const run = () => { const w = createWorld(cfg); for (let i = 0; i < 1200; i++) step(w, 0.5); return w.calls.map((c) => `${c.spec.templateId}${c.spec.nodeId}`).join(); };
    expect(run()).toBe(run());
  });
  it('does not repeat the same template back to back often', () => {
    const w = createWorld({ ...cfg, seed: 9 });
    for (let i = 0; i < 2400; i++) step(w, 0.5);
    const ids = w.calls.map((c) => c.spec.templateId);
    let repeats = 0; for (let i = 1; i < ids.length; i++) if (ids[i] === ids[i - 1]) repeats++;
    expect(repeats).toBeLessThanOrEqual(Math.ceil(ids.length * 0.2));
  });
  it('lets a call be missed without breaking the shift, and ignores pause semantics (no time passes at dt=0)', () => {
    const w = createWorld(cfg);
    step(w, 0); expect(w.time).toBe(0);
    for (let i = 0; i < 200; i++) step(w, 0.5);
    expect(w.stats.missed).toBeGreaterThan(0);
    expect(w.incidents.length).toBeGreaterThan(0);
  });
  it('dispatch, recall and routing keep availability consistent', () => {
    const w = createWorld(cfg);
    while (!w.calls.length) step(w, 0.5);
    const inc = answerCall(w, w.calls[0].id)!;
    converse(w, inc, 1);
    expect(inc.believedNode).not.toBeNull();
    const amb = w.units.find((u) => u.vehicle === 'ambulance')!;
    expect(dispatch(w, inc.id, [amb.id]).sent).toBe(1);
    expect(amb.status).toBe('EN ROUTE');
    expect(dispatch(w, inc.id, [amb.id]).sent).toBe(0); // cannot double-dispatch
    for (let i = 0; i < 20; i++) step(w, 0.5);
    recall(w, amb.id);
    expect(inc.assigned).not.toContain(amb.id);
    for (let i = 0; i < 400 && amb.status !== 'AVAILABLE'; i++) step(w, 0.5);
    expect(amb.status).toBe('AVAILABLE');
    expect(edgeSpeed(w, amb, null)).toBeGreaterThan(0);
  });
});
