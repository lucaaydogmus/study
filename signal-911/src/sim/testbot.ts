/** A simple automatic dispatcher used by tests to play whole shifts headlessly. */
import { ask, endCall, questionStates } from './calls';
import { answerCall, coverers, decide, decisionOptions, dispatch, matchSlots, optionBlocked, planRoute, shownCaps, step, type Incident, type World } from './world';

export function converse(w: World, inc: Incident, max = 3) {
  for (let n = 0; n < max && inc.session; n++) {
    const q = questionStates(inc).find((v) => v.state !== 'done' && (inc.believedNode === null ? v.q.key === 'ADDRESS' : v.q.group === 'Situation'));
    if (!q) break;
    ask(w, inc, q.q.key);
    for (let i = 0; i < 40 && inc.session?.pending; i++) step(w, 0.5);
  }
  if (inc.session) endCall(w, inc, 'player');
}

export function dispatcher(w: World) {
  for (const inc of w.incidents) {
    if (inc.status === 'RESOLVED' || inc.status === 'FAILED') continue;
    if (inc.decision) { const o = decisionOptions(inc).filter((x) => !optionBlocked(w, inc, x)); decide(w, inc.id, o[(inc.id * 7) % o.length].id); }
    if (inc.believedNode === null) continue;
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

export function playShift(w: World, dt = 0.5, check = false) {
  let guard = 0;
  while (!w.over && guard++ < 40000) {
    for (const c of w.calls) if (c.status === 'ringing' && w.time - c.ringAt > 2 && w.activeCall === null) { const inc = answerCall(w, c.id); if (inc) converse(w, inc); }
    dispatcher(w);
    step(w, dt);
    if (check && guard % 8 === 0) checkInvariants(w);
  }
}

import { expect } from 'vitest';
import { isConnected } from './pathfinding';

/** Consistency rules that must hold at every moment of every shift. */
export function checkInvariants(w: World) {
  for (const u of w.units) {
    if (u.status === 'AVAILABLE') { expect(u.incidentId, `${u.id} available but assigned`).toBeNull(); expect(u.legs).toHaveLength(0); }
    if (u.status === 'EN ROUTE') expect(u.legs.length + (u.incidentId === null ? 1 : 0)).toBeGreaterThan(0);
    if (u.status === 'EN ROUTE' || u.status === 'ON SCENE') {
      const inc = w.incidents.find((i) => i.id === u.incidentId);
      expect(inc, `${u.id} points at a missing incident`).toBeDefined();
      expect(inc!.assigned).toContain(u.id);
      expect(inc!.status === 'RESOLVED' || inc!.status === 'FAILED', `${u.id} still on a closed incident`).toBe(false);
    }
    if (u.status === 'OUT OF SERVICE') expect(u.incidentId).toBeNull();
    expect(Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.eta)).toBe(true);
    expect(u.condition).toBeGreaterThanOrEqual(0); expect(u.condition).toBeLessThanOrEqual(100);
  }
  for (const i of w.incidents) {
    for (const id of i.assigned) expect(w.units.find((u) => u.id === id)!.incidentId).toBe(i.id);
    expect(i.pressure).toBeGreaterThanOrEqual(0);
    expect(i.workProgress).toBeGreaterThanOrEqual(0);
    if (i.status === 'RESOLVED' || i.status === 'FAILED') { expect(i.assigned).toHaveLength(0); expect(i.session).toBeNull(); expect(i.blockActive).toBe(false); }
  }
  if (w.activeCall !== null) expect(w.incidents.find((i) => i.id === w.activeCall)?.session).toBeTruthy();
  expect(isConnected(w.city, w.blocked)).toBe(true);
  for (const id of w.blocked) expect(w.incidents.some((i) => i.blockEdge === id && i.blockActive)).toBe(true);
}
