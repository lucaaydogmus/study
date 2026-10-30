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

export function playShift(w: World, dt = 0.5) {
  let guard = 0;
  while (!w.over && guard++ < 40000) {
    for (const c of w.calls) if (c.status === 'ringing' && w.time - c.ringAt > 2 && w.activeCall === null) { const inc = answerCall(w, c.id); if (inc) converse(w, inc); }
    dispatcher(w);
    step(w, dt);
  }
}
