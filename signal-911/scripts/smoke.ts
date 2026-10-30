// Headless smoke run of the set-piece scenarios with a bot that also uses the new systems
// (air support relays, records requests, first-aid instructions). Run: npx vite-node scripts/smoke.ts
import { GameEngine, DT, recommendFor } from '../src/sim/engine';
import { temporarySetup } from '../src/sim/profile';
import { SCENARIOS, baseConfig } from '../src/sim/scenarios';
import { isAir } from '../src/sim/fleet';

function play(id: string, seed: number, smart: boolean) {
  const sc = SCENARIOS.find((s) => s.id === id)!;
  const cfg = baseConfig({ ...sc.config, mode: 'scenario', scenarioId: id, title: sc.title, briefing: '', difficulty: sc.difficulty, durationSec: sc.minutes * 60, seed });
  const e = GameEngine.fromConfig(cfg, temporarySetup({ rank: 7, fleet: sc.fleet, reduced: sc.reducedFleet }));
  let guard = 0;
  while (e.state.phase === 'running' && guard++ < 30000) {
    const st = e.state;
    for (const c of Object.values(st.calls)) {
      if (c.state === 'ringing' && !st.activeCallId && st.time - c.ringStart > 3) e.answerCall(c.id);
      else if (c.state === 'active') {
        const inc = st.incidents[c.incidentId];
        const since = st.time - (c.answeredAt ?? st.time);
        if (c.pending.length === 0 && c.transcript.length) {
          const order = ['address', 'landmark', 'injuries', 'breathing', 'conscious', 'fire', 'suspect', 'safe', 'promise'];
          const next = order.find((k) => !c.asked[k] && !(k === 'landmark' && inc.reportedNode !== null));
          if (next && since > 2) e.ask(c.id, { intent: next as never });
          else if (smart && !inc.aid) {
            const f = (k: string) => inc.facts.find((x) => x.key === k)?.value;
            if (f('breathing') === false) e.ask(c.id, { intent: 'inst_cpr' });
            else if (f('conscious') === false) e.ask(c.id, { intent: 'inst_recovery' });
            else if (typeof f('injured') === 'number' && inc.category !== 'fire') e.ask(c.id, { intent: 'inst_pressure' });
          }
        }
        const best = c.heard.filter((h) => h.reliability !== 'contradicted').sort((a, b) => (b.reliability === 'sure' ? 1 : 0) - (a.reliability === 'sure' ? 1 : 0))[0];
        if (best && (inc.reportedNode === null || (best.reliability === 'sure' && inc.reportedNode !== best.nodeId))) e.setIncidentLocation(inc.id, best.nodeId, 'candidate');
        if ((since > 40 && inc.reportedNode !== null) || since > 60) e.endCall(c.id);
      }
    }
    for (const inc of Object.values(st.incidents)) {
      if (inc.reportedNode === null || ['RESOLVED', 'CLOSED'].includes(inc.status) || inc.hidden || inc.templateId === 'traffic_stop') continue;
      const rec = recommendFor(inc, st.rank);
      for (const r of rec) {
        const have = inc.assignedUnits.filter((id) => st.units[id]?.capabilities.includes(r.cap)).length;
        for (let k = have; k < r.n; k++) {
          const u = Object.values(st.units).filter((x) => x.status === 'AVAILABLE' && !isAir(x) && x.capabilities.includes(r.cap) && !inc.assignedUnits.includes(x.id)).sort((a, b) => (e.estimate(a.id, inc.reportedNode!)?.eta ?? 1e9) - (e.estimate(b.id, inc.reportedNode!)?.eta ?? 1e9))[0];
          if (u) e.dispatch(u.id, inc.id);
        }
      }
      if (smart && inc.pursuit) {
        const heli = Object.values(st.units).find((u) => isAir(u) && u.status === 'AVAILABLE');
        if (heli && !inc.assignedUnits.some((id) => isAir(st.units[id]))) e.dispatch(heli.id, inc.id);
        if (inc.mover?.heliId && st.time - (inc.relayedAt ?? -99) > 12) e.relayAir(inc.id);
      }
    }
    if (smart) for (const r of st.requests) if (r.status === 'open' && st.time - r.at > 6 && st.time >= r.at) { e.runRequest(r.id); e.answerRequest(r.id, r.hits.find((h) => h.match)!.flag); }
    e.step(DT);
  }
  if (process.env.DETAIL === id) for (const i of Object.values(e.state.incidents)) if (i.casualties || i.outcome === 'failed') console.log('   ', i.templateId, i.outcome, 'cas', i.casualties, 'stage', i.stage, 'surv', i.survival?.toFixed(0), 'first', i.firstArrivalAt && Math.round(i.firstArrivalAt - i.createdAt), 'loc', i.reportedNode !== null, (i.consequences ?? []).join('; '));
  const s = e.state.stats, sc2 = e.state.scoreBreakdown!;
  const objs = e.state.config.objectives.map((o) => `${o.kind}:${o.value}/${o.target}${o.done ? '✓' : '✗'}`).join(' ');
  return `inc ${Object.keys(e.state.incidents).length} ok ${s.resolved} fail ${s.failed} cas ${s.casualties} pursuits ${s.pursuitsCaught} relays ${s.heliRelays} sight ${s.heliSightings} checks ${s.checksOk}/${s.checksBad}/${s.checksMissed} aid ${s.aidGood}/${s.aidBad} saves ${s.guidanceSaves} gdeaths ${s.guidanceDeaths} → ${sc2.total}${sc2.grade} | ${objs}`;
}
for (const id of ['the_heist', 'code_red', 'airport_alert', 'eye_in_the_sky']) {
  for (const smart of [true, false]) console.log(id.padEnd(15), smart ? 'SMART' : 'BASIC', play(id, 11, smart));
}
