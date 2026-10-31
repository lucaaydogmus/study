// Headless balance harness: plays shifts with a scripted "competent dispatcher" and a "do nothing" baseline.
// Run with: npx vite-node scripts/balance.ts
import { TEMPLATE_BY_ID } from '../src/sim/content/templates';
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
          if (c.lastGarbled && c.pending.length === 0) e.sayAgain(c.id);
        if (c.pending.length === 0 && c.transcript.length) {
            const order = ['address', 'landmark', 'injuries', 'fire', 'trapped', 'suspect', 'conscious', 'breathing', 'safe', 'promise'];
            const next = order.find((k) => !c.asked[k] && !(k === 'landmark' && inc.reportedNode !== null));
            if (next && since > 2) e.ask(c.id, { intent: next as never });
            else if (!inc.aid && inc.facts.some((f) => f.key === 'breathing' && f.value === false)) e.ask(c.id, { intent: 'inst_cpr' });
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
    // the newer duties a competent dispatcher keeps up with: agencies, status checks, search sectors
    if (competent) for (const inc of Object.values(st.incidents)) {
      if (['RESOLVED', 'CLOSED'].includes(inc.status) || inc.hidden) continue;
      if (inc.agency && inc.agency.askedAt !== null && inc.agency.calledAt === null && st.time - inc.agency.askedAt > 8) e.callAgency(inc.id);
      for (const k of Object.keys(inc.specialistAsked ?? {}) as Array<'federal' | 'eod'>) if (!inc.specialists?.[k]) e.requestSpecialist(inc.id, k);
      for (const k of Object.keys(inc.resAsked ?? {})) if (!inc.resources?.[k]) e.requestResource(inc.id, k);
      if (inc.search && !inc.search.found && Math.floor(st.time) % 6 === 0) {
        const open = inc.search.sectors.map((x, i) => ({ x, i })).filter((o) => o.x.searched < 1 && !inc.assignedUnits.some((id) => st.units[id]?.searchSector === o.i)).sort((a, b) => b.x.p - a.x.p);
        if (open.length) e.assignSearch(inc.id, open[0].i);
      }
    }
    if (competent) for (const u of e.overdueChecks()) if (st.time - u.checkDue! > 6) e.statusCheck(u.id);
    // non-emergency callers get sent to the non-emergency line once it is clear what they want
    if (competent) for (const c of Object.values(st.calls)) if (c.state === 'active' && st.time - (c.answeredAt ?? st.time) > 8 && TEMPLATE_BY_ID[st.incidents[c.incidentId].templateId]?.nonEmergency) e.redirectCall(c.id);
    // crews asking for information get the caller's answer when there is one
    if (competent) for (const q of st.unitQueries ?? []) if (q.status === 'open' && st.time - q.at > 5) e.answerUnitQuery(q.id, e.queryOptions(q.id).known ? 'relay' : 'standby');
    // callers asking what to do get a sensible answer most of the time
    if (competent) for (const c of Object.values(st.calls)) if (c.question && c.state === 'active' && st.time - c.question.at > 4) e.answerCaller(c.id, c.question.options[e.rng.chance(0.85) ? 0 : 1].id);
    // officers' records requests: run and answer (a competent dispatcher gets most of them right)
    if (competent) for (const r of st.requests) if (r.status === 'open' && st.time >= r.at + 8) { e.runRequest(r.id); e.answerRequest(r.id, e.rng.chance(0.85) ? r.truth : 'clear'); }
    e.step(DT);
  }
  if (process.env.DETAIL) for (const i of Object.values(e.state.incidents)) if (i.casualties || i.outcome === 'failed') console.log('   ', rank, seed, i.templateId, i.outcome, 'cas', i.casualties, 'stage', i.stage, 'surv', i.survival?.toFixed(0), 'aid', i.aid?.kind, 'first', i.firstArrivalAt && Math.round(i.firstArrivalAt - i.createdAt), (i.consequences ?? []).join('; '), i.lostReason ?? '');
  const s = e.state.stats, sc = e.state.scoreBreakdown!;
  return { calls: s.callsReceived, ans: s.callsAnswered, resolved: s.resolved, failed: s.failed, cas: s.casualties, rt: Math.round(averageOf(s.responseTimes)), wrong: s.wrongLocations, unn: s.unnecessary, score: sc.total, grade: sc.grade, money: computeResult(e.state).money };
}
for (const [rank, diff] of [[1, 'standard'], [3, 'standard'], [5, 'hard'], [6, 'expert']] as const) {
  for (const competent of [true, false]) {
    const rows = [1, 2, 3].map((i) => play(rank, diff, 100 * i + rank, competent));
    console.log(`rank ${rank} ${diff} ${competent ? 'BOT ' : 'IDLE'} `, rows.map((r) => `calls ${r.calls}/${r.ans} ok ${r.resolved} fail ${r.failed} cas ${r.cas} rt ${r.rt}s wrong ${r.wrong} unn ${r.unn} → ${r.score}${r.grade} $${r.money}`).join(' | '));
  }
}

// economy check: net funds of a competent 15-minute shift at rank 1
import { computeResult } from '../src/sim/profile';
{
  const p = newProfile('Eco', 7);
  const e = GameEngine.fromConfig(careerConfig(p, { seed: 7 }), setupFromProfile(p));
  while (e.state.phase === 'running') e.step(DT);
  console.log('idle shift net funds:', computeResult(e.state).money);
}
