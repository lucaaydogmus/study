import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { isAir } from '../src/sim/fleet';
import type { GameEngine } from '../src/sim/engine';
import type { Incident } from '../src/sim/types';

const quiet = { script: [] as never[] };
const answer = (e: GameEngine, inc: Incident) => { e.answerCall(inc.callId!); run(e, 3); };
const locate = (e: GameEngine, inc: Incident) => e.setIncidentLocation(inc.id, inc.nodeId, 'candidate');
/** force every random roll to succeed for a moment */
function lucky(e: GameEngine, seconds: number) { const orig = e.rng.chance; e.rng.chance = () => true; run(e, seconds); e.rng.chance = orig; }

describe('remaster 5', () => {
  it('a BOLO needs a description, and a patrol that spots a suspect on foot calls in a records check', () => {
    const e = makeEngine(quiet, { rank: 7 });
    const inc = e.spawnIncident('robbery', 'downtown', { accuracy: 'exact' });
    answer(e, inc);
    inc.facts = inc.facts.filter((f) => f.key !== 'suspect_desc');
    expect(e.boloInfo(inc.id).ok).toBe(false);
    e.addFact(inc, 'suspect_desc', String(inc.truth.suspect_desc), 'confirmed', 'caller');
    const info = e.boloInfo(inc.id);
    expect(info.ok).toBe(true);
    expect(info.text).toContain(String(inc.truth.suspect_desc));
    const orig = e.rng.chance; e.rng.chance = () => true;
    expect(e.broadcastBolo(inc.id).ok).toBe(true);
    expect(e.broadcastBolo(inc.id).ok).toBe(false);
    run(e, 1.5); e.rng.chance = orig;
    const b = e.state.bolos![0];
    expect(b.status).toBe('found');
    expect(b.vehicle).toBe(false);
    expect(e.state.stats.boloHits).toBe(1);
    expect(e.state.units[b.foundBy!].status).toBe('BUSY');
    run(e, 5);
    expect(e.state.requests.some((r) => r.incidentId === inc.id && r.unitId === b.foundBy)).toBe(true);
  });

  it('a patrol that spots a BOLO vehicle starts a linked pursuit and gives chase', () => {
    const e = makeEngine(quiet, { rank: 7 });
    const inc = e.spawnIncident('pursuit', 'downtown', { accuracy: 'exact' });
    answer(e, inc);
    e.addFact(inc, 'suspect_desc', String(inc.truth.suspect_desc), 'confirmed', 'caller');
    const orig = e.rng.chance; e.rng.chance = () => true;
    e.broadcastBolo(inc.id);
    run(e, 1.5); e.rng.chance = orig;
    const b = e.state.bolos![0];
    expect(b.vehicle).toBe(true);
    const child = Object.values(e.state.incidents).find((i) => i.parentId === inc.id && i.pursuit);
    expect(child).toBeDefined();
    expect(child!.assignedUnits).toContain(b.foundBy);
  });

  it('spike strips laid in the suspect’s path disable the car and the spike crew joins the chase', () => {
    const e = makeEngine(quiet, { rank: 7 });
    const inc = e.spawnIncident('pursuit', 'downtown', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    const m = inc.mover!;
    m.startAt = e.state.time + 1000; // hold the suspect while the strip goes down
    const edge = e.city.adj[m.prev].map((id) => e.city.edges[id]).find((ed) => ed.cls !== 'highway')!;
    const node = edge.a === m.prev ? edge.b : edge.a;
    expect(e.activePursuit()?.id).toBe(inc.id);
    const cand = e.stingerUnits(node)[0];
    expect(cand).toBeDefined();
    expect(e.deployStinger(cand.unit.id, node).ok).toBe(true);
    expect(e.deployStinger(cand.unit.id, node).ok).toBe(false);
    const u = cand.unit;
    expect(u.status).toBe('BUSY');
    // fast-forward the drive
    const n = e.city.nodes[node]; u.x = n.x; u.y = n.y; u.prevNode = node; u.route = [];
    run(e, 1);
    const sg = e.state.stingers![0];
    expect(sg.laidAt).not.toBeNull();
    const speed = m.speed;
    m.next = node; m.startAt = e.state.time;
    const orig = e.rng.chance; e.rng.chance = () => true;
    run(e, 60, () => !!sg.result); e.rng.chance = orig;
    expect(sg.result).toBe('hit');
    expect(e.state.stats.stingerHits).toBe(1);
    expect(m.speed).toBeLessThan(speed);
    expect(u.assignedIncidentId).toBe(inc.id);
  });

  it('spikes are pulled when the pursuit ends', () => {
    const e = makeEngine(quiet, { rank: 7 });
    const inc = e.spawnIncident('pursuit', 'downtown', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    const node = e.city.adj[inc.mover!.prev].map((id) => e.city.edges[id])[0].b;
    const cand = e.stingerUnits(node)[0];
    e.deployStinger(cand.unit.id, node);
    inc.status = 'RESOLVED';
    run(e, 2);
    expect(e.state.stingers![0].result).toBe('cancelled');
    expect(cand.unit.status).toBe('RETURNING');
  });

  it('tired crews ask for a meal break; approving takes them out of service and they come back rested', () => {
    const e = makeEngine({ script: undefined, incidentRate: 0.0001 }, { rank: 5 });
    const u = Object.values(e.state.units).find((x) => x.service === 'medical' && x.status === 'AVAILABLE' && !isAir(x))!;
    for (const p of e.crewOf(u)) p.fatigue = 80;
    e.state.nextBreakAt = 0;
    run(e, 2);
    const d = e.state.decisions!.find((x) => x.kind === 'break')!;
    expect(d).toBeDefined();
    expect(d.unitId).toBe(u.id);
    expect(e.decide(d.id, 'approve').ok).toBe(true);
    expect(u.status).toBe('OUT_OF_SERVICE');
    expect(u.note).toBe('Meal break');
    expect(Math.max(...e.crewOf(u).map((p) => p.fatigue))).toBeLessThan(45);
    expect(e.state.stats.breaksGiven).toBe(1);
    run(e, 160);
    expect(u.status).toBe('AVAILABLE');
  });

  it('denying a break costs morale, and an unanswered request is deferred', () => {
    const e = makeEngine({ script: undefined, incidentRate: 0.0001 }, { rank: 5 });
    const u = Object.values(e.state.units).find((x) => x.service === 'fire' && x.status === 'AVAILABLE')!;
    for (const p of e.crewOf(u)) p.fatigue = 80;
    e.state.nextBreakAt = 0;
    run(e, 2);
    const d = e.state.decisions!.find((x) => x.kind === 'break')!;
    const morale = e.crewOf(u)[0].morale;
    e.decide(d.id, 'deny');
    expect(e.crewOf(u)[0].morale).toBeLessThan(morale);
    expect(u.status).toBe('AVAILABLE');
    // next request, left to expire
    e.state.nextBreakAt = 0;
    run(e, 2);
    const d2 = e.state.decisions!.filter((x) => x.kind === 'break').pop()!;
    expect(d2.id).not.toBe(d.id);
    run(e, 42); // answered on the radio now, so the window is longer
    expect(d2.chosen).toBe('later');
    expect(d2.auto).toBe(true);
  });
});
