// Averages a competent bot over many career seeds: npx vite-node scripts/balance-avg.ts
import { TEMPLATE_BY_ID } from '../src/sim/content/templates';
import { GameEngine, DT, recommendFor } from '../src/sim/engine';
import { careerConfig, newProfile, setupFromProfile, computeResult } from '../src/sim/profile';
import { rankForXp } from '../src/sim/progression';

function play(rank: number, seed: number) {
  const p = newProfile('Bot', seed);
  p.xp = [0, 0, 450, 1200, 2400, 4200, 6800, 10000][rank]; p.rank = rankForXp(p.xp);
  p.flags.duration = 15 * 60;
  if (process.env.DIFF) p.flags.difficulty = process.env.DIFF as never;
  const e = GameEngine.fromConfig(careerConfig(p, { seed }), setupFromProfile(p));
  const st = e.state;
  let guard = 0;
  while (st.phase === 'running' && guard++ < 20000) {
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
          else if (!inc.aid && inc.facts.some((f) => f.key === 'breathing' && f.value === false)) e.ask(c.id, { intent: 'inst_cpr' as never });
          if (!c.trace && since > 6 && inc.reportedNode === null) e.startTrace(c.id);
        }
        const best = c.heard.filter((h) => h.reliability !== 'contradicted').sort((a, b) => (b.reliability === 'sure' ? 1 : 0) - (a.reliability === 'sure' ? 1 : 0))[0];
        if (best && (inc.reportedNode === null || (best.reliability === 'sure' && inc.reportedNode !== best.nodeId))) e.setIncidentLocation(inc.id, best.nodeId, 'candidate');
        if ((since > 28 && inc.reportedNode !== null) || since > 45) e.endCall(c.id);
      }
    }
    for (const inc of Object.values(st.incidents)) {
      if (inc.reportedNode === null || ['RESOLVED', 'CLOSED'].includes(inc.status) || inc.hidden || inc.templateId === 'traffic_stop') continue;
      for (const r of recommendFor(inc, st.rank)) {
        const have = inc.assignedUnits.filter((id) => st.units[id]?.capabilities.includes(r.cap)).length;
        for (let k = have; k < r.n; k++) {
          const u = Object.values(st.units).filter((x) => x.status === 'AVAILABLE' && x.type !== 'helicopter' && x.capabilities.includes(r.cap) && !inc.assignedUnits.includes(x.id)).sort((a, b) => (e.estimate(a.id, inc.reportedNode!)?.eta ?? 1e9) - (e.estimate(b.id, inc.reportedNode!)?.eta ?? 1e9))[0];
          if (u) e.dispatch(u.id, inc.id);
        }
      }
    }
    // the newer duties a competent dispatcher keeps up with: agencies, status checks, search sectors
    for (const inc of Object.values(st.incidents)) {
      if (['RESOLVED', 'CLOSED'].includes(inc.status) || inc.hidden) continue;
      if (inc.agency && inc.agency.askedAt !== null && inc.agency.calledAt === null && st.time - inc.agency.askedAt > 8) e.callAgency(inc.id);
      for (const k of Object.keys(inc.specialistAsked ?? {}) as Array<'federal' | 'eod'>) if (!inc.specialists?.[k]) e.requestSpecialist(inc.id, k);
      for (const k of Object.keys(inc.resAsked ?? {})) if (!inc.resources?.[k]) e.requestResource(inc.id, k);
      if (inc.search && !inc.search.found && Math.floor(st.time) % 6 === 0) {
        const open = inc.search.sectors.map((x, i) => ({ x, i })).filter((o) => o.x.searched < 1 && !inc.assignedUnits.some((id) => st.units[id]?.searchSector === o.i)).sort((a, b) => b.x.p - a.x.p);
        if (open.length) e.assignSearch(inc.id, open[0].i);
      }
    }
    for (const u of e.overdueChecks()) if (st.time - u.checkDue! > 6) e.statusCheck(u.id);
    // non-emergency callers get sent to the non-emergency line once it is clear what they want
    for (const c of Object.values(st.calls)) if (c.state === 'active' && st.time - (c.answeredAt ?? st.time) > 8 && TEMPLATE_BY_ID[st.incidents[c.incidentId].templateId]?.nonEmergency) e.redirectCall(c.id);
    // crews asking for information get the caller's answer when there is one
    for (const q of st.unitQueries ?? []) if (q.status === 'open' && st.time - q.at > 5) e.answerUnitQuery(q.id, e.queryOptions(q.id).known ? 'relay' : 'standby');
    // callers asking what to do get a sensible answer most of the time
    for (const c of Object.values(st.calls)) if (c.question && c.state === 'active' && st.time - c.question.at > 4) e.answerCaller(c.id, c.question.options[e.rng.chance(0.85) ? 0 : 1].id);
    for (const r of st.requests ?? []) if (r.status === 'open' && st.time >= r.at + 8) { e.runRequest(r.id); e.answerRequest(r.id, e.rng.chance(0.85) ? r.truth : 'clear', r.db.findIndex((h) => h.match)); }
    e.step(DT);
  }
  const majors = Object.values(st.incidents).filter((i) => TEMPLATE_BY_ID[i.templateId]?.major).map((i) => i.templateId);
  if (process.env.VERBOSE) console.log(`  seed ${seed}: threat ${st.config.threatLevel} events [${st.config.events.map((x) => x.type).join(',')}] majors [${majors.join(',')}] spec ${st.stats.specialistCalls ?? 0} res ${st.stats.resourceCalls ?? 0} costs ${Math.round(st.stats.costs)} cas ${st.stats.casualties} say ${st.stats.sayAgains ?? 0} score ${st.scoreBreakdown!.total}`);
  if (process.env.CAS) { const m: Record<string, number> = {}; for (const i of Object.values(st.incidents)) if (i.casualties) m[i.templateId] = (m[i.templateId] ?? 0) + i.casualties; const fails: Record<string, number> = {}; for (const i of Object.values(st.incidents)) if (i.outcome === 'failed') fails[i.templateId] = (fails[i.templateId] ?? 0) + 1; console.log('  cas', JSON.stringify(m), 'fails', JSON.stringify(fails), 'mci', st.stats.mciPlans ?? 0, 'walkins', st.stats.walkIns ?? 0, 'hosp', st.stats.hospitalCalls ?? 0, 'arrests', st.stats.arrests ?? 0); }
  return { score: st.scoreBreakdown!.total, cas: st.stats.casualties, money: computeResult(st).money, calls: st.stats.callsReceived };
}
for (const rank of (process.env.RANKS ?? '1,3,5').split(',').map(Number)) {
  const rows = Array.from({ length: Number(process.env.N ?? 10) }, (_, i) => play(rank, 1000 + i * 37));
  const avg = (k: 'score' | 'cas' | 'money' | 'calls') => Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length * 10) / 10;
  console.log(`rank ${rank}: score ${avg('score')} cas ${avg('cas')} money ${avg('money')} calls ${avg('calls')}`);
}
