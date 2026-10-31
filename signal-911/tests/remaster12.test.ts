import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { isAir } from '../src/sim/fleet';
import { declineNeed, parseRequest, pendingNeeds, radioRequest } from '../src/sim/radioreq';
import { ackEmergency, emergencyActivation, rollCall, sayAgainRadio, setEmergencyTraffic } from '../src/sim/radioops';
import { expediteOffload, repairStation, systemsOf, turnoutDelay } from '../src/sim/buildings';
import { auditCalls, callPremises, cadDown, premiseFlags, terminatePursuit, textSpeak, viewState, warnPremise } from '../src/sim/ops';
import type { GameEngine } from '../src/sim/engine';
import type { Incident, Unit } from '../src/sim/types';

const quiet = { script: [] as never[] };
const live = (e: GameEngine) => { e.state.config.script = undefined; e.state.config.incidentRate = 0; e.state.nextSpawnAt = 1e9; return e; };
const nearest = (e: GameEngine, inc: Incident, pred: (u: Unit) => boolean, n = 1) => Object.values(e.state.units).filter((u) => pred(u) && !isAir(u) && u.status === 'AVAILABLE')
  .sort((a, b) => (e.estimate(a.id, inc.nodeId)?.eta ?? 1e9) - (e.estimate(b.id, inc.nodeId)?.eta ?? 1e9)).slice(0, n);

describe('remaster 12: asking for help on the radio', () => {
  it('understands requests in plain words', () => {
    expect(parseRequest('get a tow truck down here')).toBe('tow');
    expect(parseRequest('we need the K9 for this one')).toBe('k9');
    expect(parseRequest('call the gas company')).toBe('gas');
    expect(parseRequest('mutual aid ambulance from county please')).toBe('ma_ems');
    expect(parseRequest('request the bomb squad')).toBe('eod');
    expect(parseRequest('what is your eta')).toBeNull();
  });
  it('crews keep asking for what they need, and it costs them when nobody answers', () => {
    const e = live(makeEngine(quiet, { rank: 6 }));
    const inc = e.spawnIncident('missing_person', 'westres', { noCall: true });
    inc.reportedNode = inc.nodeId;
    (inc.resAsked ??= {}).k9 = e.state.time;
    const u = nearest(e, inc, (x) => x.service === 'police')[0];
    e.dispatch(u.id, inc.id); u.x = e.city.nodes[inc.nodeId].x; u.y = e.city.nodes[inc.nodeId].y; u.route = []; u.timer = 0.1;
    expect(pendingNeeds(e, inc.id).some((n) => n.resId === 'k9')).toBe(true);
    const threat0 = inc.threat;
    run(e, 160);
    expect(inc.needNag?.k9).toBe(3);
    expect((inc.consequences ?? []).some((c) => /K-9.*never came|never came/i.test(c))).toBe(true);
    expect(inc.threat).toBeGreaterThan(Math.min(threat0, 95) - 40);
    expect(radioRequest(e, inc.id, 'k9').ok).toBe(true);
    expect(pendingNeeds(e, inc.id).some((n) => n.resId === 'k9')).toBe(false);
    expect(e.state.radio.some((m) => m.chan === 'outside')).toBe(true);
  });
  it('a request can be turned down', () => {
    const e = live(makeEngine(quiet, { rank: 6 }));
    const inc = e.spawnIncident('hostage_barricade', 'downtown', { noCall: true });
    (inc.resAsked ??= {}).negotiator = e.state.time;
    expect(declineNeed(e, inc.id, 'negotiator').ok).toBe(true);
    expect(pendingNeeds(e, inc.id).some((n) => n.resId === 'negotiator')).toBe(false);
  });
});

describe('remaster 12: the radio desk', () => {
  it('a blocked transmission comes back when you ask for a repeat', () => {
    const e = live(makeEngine(quiet));
    const u = Object.values(e.state.units).find((x) => x.service === 'fire')!;
    e.radio(u.spoken, `Dispatch, ${u.spoken}. On scene, nothing showing.`, 'unit', u.id);
    const m = e.state.radio[e.state.radio.length - 1];
    m.broken = true; m.brokenWhy = 'stepped';
    expect(sayAgainRadio(e, m.id).ok).toBe(true);
    run(e, 3);
    expect(e.state.radio.some((x) => x.unitId === u.id && /repeating/.test(x.text))).toBe(true);
  });
  it('emergency traffic only holds the chatter; roll call gets every unit to report', () => {
    const e = live(makeEngine(quiet));
    expect(setEmergencyTraffic(e, 'police', true).ok).toBe(true);
    const n = e.state.radio.length;
    const cop = Object.values(e.state.units).find((u) => u.service === 'police')!;
    e.radio('Some officer', 'Grabbing a coffee.', 'chatter', cop.id);
    expect(e.state.radio.length).toBe(n);
    expect(setEmergencyTraffic(e, 'police', false).ok).toBe(true);
    expect(rollCall(e, 'fire').ok).toBe(true);
    run(e, 30);
    const fire = Object.values(e.state.units).filter((u) => u.service !== 'police' && !isAir(u));
    expect(fire.every((u) => e.state.radio.some((m) => m.unitId === u.id))).toBe(true);
  });
  it('an emergency activation: answer it and send backup and the officer is fine; ignore it and they are not', () => {
    const outcome = (act: boolean) => {
      const e = live(makeEngine(quiet, { rank: 5 }));
      const inc = e.spawnIncident('domestic_disturbance', 'westres', { noCall: true });
      inc.reportedNode = inc.nodeId;
      const [a, b] = nearest(e, inc, (x) => x.service === 'police', 2);
      e.dispatch(a.id, inc.id); a.status = 'ON_SCENE';
      emergencyActivation(e, a, inc.id);
      if (act) { ackEmergency(e, e.state.radioCtl!.emergencies[0].id); e.dispatch(b.id, inc.id); }
      run(e, 25);
      return a.status;
    };
    expect(outcome(true)).not.toBe('OUT_OF_SERVICE');
    expect(outcome(false)).toBe('OUT_OF_SERVICE');
  });
});

describe('remaster 12: stations and hospitals', () => {
  it('worn bay doors jam, and a repair puts them right', () => {
    const e = live(makeEngine(quiet));
    const u = Object.values(e.state.units).find((x) => x.service === 'fire' && !isAir(x) && !x.temp)!;
    const s = e.state.stations[u.stationId];
    const sys = systemsOf(e.state, s);
    sys.doors = 10; sys.alerting = 100;
    let worst = 0;
    for (let k = 0; k < 12; k++) { u.deployments = k; e.state.time += 1; worst = Math.max(worst, turnoutDelay(e, u)); }
    expect(worst).toBeGreaterThanOrEqual(18);
    expect(repairStation(e, s.id, 'doors').ok).toBe(true);
    run(e, 100);
    expect(sys.doors).toBe(100);
  });
  it('a dry fuel tank sends a returning crew to the city yard', () => {
    const e = live(makeEngine(quiet));
    const inc = e.spawnIncident('kitchen_fire', 'downtown', { noCall: true });
    const u = nearest(e, inc, (x) => x.service === 'fire')[0];
    systemsOf(e.state, e.state.stations[u.stationId]).fuel = 0;
    e.dispatch(u.id, inc.id);
    run(e, 30);
    e.recall?.(u.id);
    if (u.status !== 'RETURNING') { u.status = 'RETURNING'; u.assignedIncidentId = undefined; e.routeUnit(u, u.postNode, false); }
    run(e, 300, () => u.note === 'Refuelling at the city yard');
    expect(u.note).toBe('Refuelling at the city yard');
  });
  it('the charge nurse can get a ramped ambulance back on the road', () => {
    const e = live(makeEngine(quiet));
    run(e, 2);
    const u = Object.values(e.state.units).find((x) => x.service === 'medical')!;
    const h = Object.values(e.state.hospitals!)[0];
    u.x = e.city.nodes[h.node].x; u.y = e.city.nodes[h.node].y; u.status = 'BUSY'; u.timer = 50; u.note = 'Held at the ER door';
    expect(expediteOffload(e, u.id).ok).toBe(true);
    expect(u.timer).toBeLessThanOrEqual(6);
  });
});

describe('remaster 12: more of the job', () => {
  it('text-to-911 reads like texting, and there is nothing to listen to', () => {
    expect(textSpeak("(whispering) Please, he's in the house right now. I can't talk.")).toBe('pls, hes in teh house rn. i cant talk');
    const e = live(makeEngine(quiet));
    const inc = e.spawnIncident('domestic_disturbance', 'westres', { accuracy: 'exact' });
    const call = e.state.calls[inc.callId!];
    call.text = true;
    e.answerCall(call.id); run(e, 6);
    const line = call.transcript.find((l) => l.who === 'CALLER')!;
    expect(line.text).toBe(line.text.toLowerCase());
    expect(e.listen(call.id).ok).toBe(false);
  });
  it('ringing the address catches a swatting hoax; going in without checking costs dearly', () => {
    const e = live(makeEngine(quiet, { rank: 6 }));
    const inc = e.spawnIncident('swatting_hoax', 'westres', { accuracy: 'exact' });
    expect(inc.hoax).toBe(true);
    expect(callPremises(e, inc.id).ok).toBe(false);
    e.setIncidentLocation(inc.id, inc.nodeId);
    const r = callPremises(e, inc.id);
    expect(r.text).toMatch(/hoax/);
    expect(inc.verified).toBe(true);
    const e2 = live(makeEngine(quiet, { rank: 6 }));
    const inc2 = e2.spawnIncident('swatting_hoax', 'westres', { accuracy: 'exact' });
    e2.setIncidentLocation(inc2.id, inc2.nodeId);
    for (const u of nearest(e2, inc2, (x) => x.service === 'police', 2)) e2.dispatch(u.id, inc2.id);
    run(e2, 300, () => !!inc2.hoaxDone);
    expect((inc2.consequences ?? []).some((c) => /swatting/.test(c))).toBe(true);
  });
  it('a pursuit called off without the helicopter ends with nobody hurt and nobody caught', () => {
    const e = live(makeEngine(quiet, { rank: 6 }));
    const inc = e.spawnIncident('pursuit', 'downtown', { noCall: true });
    inc.reportedNode = inc.nodeId;
    const r = terminatePursuit(e, inc.id);
    expect(r.ok).toBe(true);
    expect(['CLOSED', 'RESOLVED']).toContain(inc.status);
    expect(inc.outcome).toBe('lost');
  });
  it('when CAD goes down the map only knows what units last reported', () => {
    const e = live(makeEngine(quiet));
    const u = Object.values(e.state.units).find((x) => x.service === 'police' && !isAir(x))!;
    e.state.cad = { downUntil: e.state.time + 100, snap: { [u.id]: { x: 1, y: 2, status: 'AVAILABLE', t: 0 } } };
    expect(cadDown(e.state)).toBe(true);
    expect(viewState(e.state).units[u.id].x).toBe(1);
    e.radio(u.spoken, 'Dispatch, available.', 'unit', u.id);
    expect(viewState(e.state).units[u.id].x).toBe(u.x);
  });
  it('dangerous addresses are flagged, and crews can be warned', () => {
    const e = live(makeEngine(quiet));
    const node = e.city.nodes.find((n) => premiseFlags(e, n.id).length && e.city.adj[n.id].length)!;
    const inc = e.spawnIncident('domestic_disturbance', node.district, { nodeId: node.id, noCall: true });
    e.setIncidentLocation(inc.id, node.id);
    expect(warnPremise(e, inc.id).ok).toBe(true);
    expect(inc.premiseWarned).toBe(true);
  });
  it('the supervisor grades a few calls against the protocol', () => {
    const e = live(makeEngine(quiet));
    const inc = e.spawnIncident('fall_elderly', 'westres', { accuracy: 'exact', archetype: 'injured_self' });
    e.answerCall(inc.callId!); run(e, 4);
    e.ask(inc.callId!, { intent: 'breathing' }); run(e, 6);
    e.setIncidentLocation(inc.id, inc.nodeId);
    const a = auditCalls(e.state);
    expect(a.length).toBe(1);
    expect(a[0].items.some((i) => /breathing/.test(i.text) && i.ok)).toBe(true);
  });
});
