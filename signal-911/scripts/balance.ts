// Headless balance harness: plays shifts with a scripted "competent dispatcher" and a "do nothing" baseline.
// Run with: npx vite-node scripts/balance.ts
import { GameEngine, DT, recommendFor } from '../src/sim/engine';
import { careerConfig, newProfile, setupFromProfile } from '../src/sim/profile';
import { rankForXp } from '../src/sim/progression';
import { averageOf } from '../src/sim/scoring';

function play(rank: number, diff: 'casual' | 'standard' | 'hard' | 'expert', seed: number, competent: boolean, minutes = 15) {
  const p = newProfile('Bot', seed);
  p.xp = [0, 0, 450, 1200, 2400, 4200, 6800, 10000][rank]; p.rank = rankForXp(p.xp);
  p.flags.difficulty = diff; p.flags.duration = minutes * 60;
  const e = GameEngine.fromConfig(careerConfig(p, { seed }), setupFromProfile(p));
  let guard = 0;
  while (e.state.phase === 'running' && guard++ < 20000) {
    const st = e.state;
    if (competent) {
      for (const c of Object.values(st.calls)) {
        if (c.state === 'ringing' && !st.activeCallId && st.time - c.ringStart > 3) e.answerCall(c.id);
        else if (c.state === 'active') {
          const inc = st.incidents[c.incidentId];
          const since = st.time - (c.answeredAt ?? st.time);
          if (c.pending.length === 0 && c.transcript.length) {
            const order = ['address', 'landmark', 'injuries', 'fire', 'trapped', 'suspect', 'conscious', 'safe', 'promise'];
            const next = order.find((k) => !c.asked[k] && !(k === 'landmark' && inc.reportedNode !== null));
            if (next && since > 2) e.ask(c.id, { intent: next as never });
          }
          const best = c.heard.filter((h) => h.reliability !== 'contradicted').sort((a, b) => (b.reliability === 'sure' ? 1 : 0) - (a.reliability === 'sure' ? 1 : 0))[0];
          if (best && (inc.reportedNode === null || (best.reliability === 'sure' && inc.reportedNode !== best.nodeId))) e.setIncidentLocation(inc.id, best.nodeId, 'candidate');
          if ((since > 28 && inc.reportedNode !== null) || since > 45) e.endCall(c.id);
        }
      }
      for (const inc of Object.values(st.incidents)) {
        if (inc.reportedNode === null || ['RESOLVED', 'CLOSED'].includes(inc.status) || inc.hidden) continue;
        const rec = recommendFor(inc, st.rank);
        for (const r of rec) {
          const have = inc.assignedUnits.filter((id) => st.units[id].capabilities.includes(r.cap)).length;
          for (let k = have; k < r.n; k++) {
            const u = Object.values(st.units).filter((x) => x.status === 'AVAILABLE' && x.capabilities.includes(r.cap) && !inc.assignedUnits.includes(x.id)).sort((a, b) => (e.estimate(a.id, inc.reportedNode!)?.eta ?? 1e9) - (e.estimate(b.id, inc.reportedNode!)?.eta ?? 1e9))[0];
            if (u) e.dispatch(u.id, inc.id);
          }
        }
      }
    }
    e.step(DT);
  }
  const s = e.state.stats, sc = e.state.scoreBreakdown!;
  return { calls: s.callsReceived, ans: s.callsAnswered, resolved: s.resolved, failed: s.failed, cas: s.casualties, rt: Math.round(averageOf(s.responseTimes)), wrong: s.wrongLocations, unn: s.unnecessary, score: sc.total, grade: sc.grade };
}
for (const [rank, diff] of [[1, 'standard'], [3, 'standard'], [5, 'hard'], [6, 'expert']] as const) {
  for (const competent of [true, false]) {
    const rows = [1, 2, 3].map((i) => play(rank, diff, 100 * i + rank, competent));
    console.log(`rank ${rank} ${diff} ${competent ? 'BOT ' : 'IDLE'} `, rows.map((r) => `calls ${r.calls}/${r.ans} ok ${r.resolved} fail ${r.failed} cas ${r.cas} rt ${r.rt}s wrong ${r.wrong} unn ${r.unn} → ${r.score}${r.grade}`).join(' | '));
  }
}
