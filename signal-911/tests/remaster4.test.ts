import { describe, it, expect } from 'vitest';
import { cameraOffline, cctvConnect, cctvTag, cctvView } from '../src/sim/cctv';
import { makeEngine, run } from './helpers';
import { STORYLINES, baseConfig, rollStoryline } from '../src/sim/scenarios';
import { makeVoice, speak } from '../src/sim/voices';
import { makeRequest, searchRecords, normDob } from '../src/sim/records';
import { Rng } from '../src/sim/rng';
import { isAir } from '../src/sim/fleet';
import type { GameEngine } from '../src/sim/engine';
import type { Incident } from '../src/sim/types';

const quiet = { script: [] as never[] };
const answer = (e: GameEngine, inc: Incident) => { e.answerCall(inc.callId!); run(e, 3); };
const locate = (e: GameEngine, inc: Incident) => e.setIncidentLocation(inc.id, inc.nodeId, 'candidate');

describe('remaster 4', () => {
  it('callers have their own voices and never garble facts', () => {
    const rng = new Rng(4);
    const elderly = makeVoice(rng, 'confused_elderly'), pro = makeVoice(rng, 'professional');
    expect(elderly.tangents.length).toBeGreaterThan(0);
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('fall_elderly', 'westres', { archetype: 'drunk_caller', accuracy: 'exact' });
    const call = e.state.calls[inc.callId!];
    for (let i = 0; i < 40; i++) {
      const out = speak('212 Bramley Avenue. That is where I am.', call, rng, (s) => s);
      expect(out).toContain('212 Bramley Avenue');
    }
    void pro;
  });

  it('the records database needs the right spelling and date of birth', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 30; i++) {
      const r = makeRequest(rng, `q${i}`, 'u1', null, 'person', 0);
      const g = r.given as { last: string; first: string; dob: string; sex: string };
      const hits = searchRecords(r, { last: g.last, first: g.first, dob: g.dob });
      expect(hits.some((h) => r.db[h].match)).toBe(true);
      expect(searchRecords(r, { last: 'Zzzzzz', first: g.first })).toEqual([]);
    }
    expect(normDob('9/3/88')).toBe('09/03/1988');
    expect(normDob('1960-09-23')).toBe('09/23/1960');
    const plate = makeRequest(rng, 'p', 'u1', null, 'plate', 0);
    const pg = plate.given as { plate: string };
    expect(searchRecords(plate, { plate: pg.plate.toLowerCase() }).some((h) => plate.db[h].match)).toBe(true);
  });

  it('police cars patrol their beat and respond from the road', () => {
    const e = makeEngine({ script: undefined, incidentRate: 0.0001, mode: 'free' }, { rank: 3 });
    run(e, 40);
    const moving = Object.values(e.state.units).filter((u) => e.onPatrol(u) && u.route.length);
    expect(moving.length).toBeGreaterThan(0);
    const fire = Object.values(e.state.units).filter((u) => u.service === 'fire');
    expect(fire.every((u) => !u.route.length || u.status !== 'AVAILABLE')).toBe(true);
  });

  it('staged medics hold short of an armed scene until police arrive', () => {
    const e = makeEngine(quiet, { rank: 3 });
    const inc = e.spawnIncident('domestic_disturbance', 'westres', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    const medic = Object.values(e.state.units).find((u) => u.service === 'medical' && u.status === 'AVAILABLE')!;
    e.dispatch(medic.id, inc.id);
    expect(e.setStaging(medic.id, true)).toBe(true);
    run(e, 300, () => medic.stagedAt != null);
    expect(medic.stagedAt).not.toBeNull();
    expect(medic.status).toBe('EN_ROUTE');
    const cop = Object.values(e.state.units).find((u) => u.capabilities.includes('patrol') && !isAir(u) && u.status === 'AVAILABLE')!;
    e.dispatch(cop.id, inc.id);
    run(e, 400, () => medic.status === 'ON_SCENE');
    expect(medic.status).toBe('ON_SCENE');
    expect(cop.status).toBe('ON_SCENE');
  });

  it('a trace narrows to a circle around the caller while they stay on the line', () => {
    const e = makeEngine(quiet, { rank: 7 });
    e.state.upgrades.ali = 2;
    const inc = e.spawnIncident('silent_call', 'westres', {});
    const call = e.state.calls[inc.callId!];
    call.profile.callerIdType = 'mobile';
    answer(e, inc);
    expect(e.startTrace(call.id).ok).toBe(true);
    run(e, 45, () => !!call.trace?.done);
    expect(call.trace!.done).toBe(true);
    const n = e.city.nodes[inc.nodeId];
    expect(Math.hypot(call.trace!.x - n.x, call.trace!.y - n.y)).toBeLessThanOrEqual(call.trace!.radius);
    expect(call.heard.some((h) => h.label.startsWith('Trace'))).toBe(true);
  });

  it('silent callers only answer once the tap protocol is set up', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('silent_call', 'westres', {});
    answer(e, inc);
    e.ask(inc.callId!, { text: 'Is anyone injured?' });
    run(e, 6);
    expect(inc.facts.some((f) => f.key === 'injured')).toBe(false);
    e.ask(inc.callId!, { text: "If you can't talk, tap the phone twice for yes" });
    run(e, 5);
    e.ask(inc.callId!, { intent: 'injuries' });
    run(e, 6);
    expect(inc.facts.some((f) => f.key === 'injured')).toBe(true);
  });

  it('foreign-language callers need an interpreter', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('fall_elderly', 'westres', { archetype: 'witness', accuracy: 'exact' });
    const call = e.state.calls[inc.callId!];
    call.profile.language = 'Spanish';
    answer(e, inc);
    e.ask(call.id, { intent: 'address' });
    run(e, 6);
    expect(call.heard.length).toBe(0);
    expect(e.requestInterpreter(call.id).ok).toBe(true);
    run(e, 25, () => call.interpreter === 'on');
    expect(call.interpreter).toBe('on');
    e.ask(call.id, { intent: 'address' });
    run(e, 8);
    expect(call.heard.length).toBeGreaterThan(0);
  });

  it('dropped callers can be called back', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('fall_elderly', 'westres', { archetype: 'witness', accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    e.endCall(inc.callId!);
    run(e, 10);
    expect(e.redial(inc.id).ok).toBe(true);
    expect(e.state.activeCallId).not.toBeNull();
    expect(e.state.calls[e.state.activeCallId!].outbound).toBe(true);
  });

  it('city cameras have to be picked, connected, aimed and read before they tell you anything', () => {
    const e = makeEngine(quiet, { rank: 7 });
    const cams = e.cameras();
    const cam = cams.find((c) => !cameraOffline(e, c))!;
    const n = e.city.nodes.filter((m) => { const d = Math.hypot(m.x - cam.x, m.y - cam.y); const a = Math.atan2(m.y - cam.y, m.x - cam.x) - cam.heading; return d > 25 && d < cam.range * 0.5 && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < cam.fov / 3; })[0];
    if (!n) return;
    e.state.timeOfDay = 12; e.state.weather = 'clear';
    const inc = e.spawnIncident('vehicle_fire', n.district, { nodeId: n.id, accuracy: 'exact' });
    answer(e, inc);
    expect(cctvConnect(e, cam.id).ok).toBe(true);
    expect(cctvView(e)!.state).toBe('connecting');
    run(e, 10);
    const v = cctvView(e)!;
    expect(v.state).toBe('live');
    const det = v.detections.find((d) => d.key === `i:${inc.id}`)!;
    expect(det).toBeTruthy();
    const r = cctvTag(e, det.key, inc.id);
    expect(r.ok).toBe(true);
    expect(inc.facts.some((f) => f.source === 'scene')).toBe(true);
    expect(cctvTag(e, det.key, inc.id).ok).toBe(false);
  });

  it('crews ask for tactical decisions and the answer changes the outcome', () => {
    const outcome = (choice: 'stay' | 'go') => {
      const e = makeEngine(quiet, { rank: 7 });
      const inc = e.spawnIncident('cardiac_arrest', 'westres', { accuracy: 'exact', archetype: 'witness' });
      answer(e, inc); locate(e, inc);
      e.ask(inc.callId!, { intent: 'breathing' });
      e.ask(inc.callId!, { intent: 'inst_cpr' });
      const medic = Object.values(e.state.units).filter((u) => u.capabilities.includes('als') && u.status === 'AVAILABLE').sort((a, b) => (e.estimate(a.id, inc.nodeId)?.eta ?? 1e9) - (e.estimate(b.id, inc.nodeId)?.eta ?? 1e9))[0];
      e.dispatch(medic.id, inc.id);
      run(e, 400, () => !!e.state.decisions?.length);
      const d = e.state.decisions![0];
      expect(d.kind).toBe('medical');
      const before = inc.survival ?? 100;
      e.decide(d.id, choice);
      return (inc.survival ?? 100) - before;
    };
    expect(outcome('stay')).toBeGreaterThan(outcome('go'));
  });

  it('uncontained structure fires can spread next door', () => {
    let spread = 0;
    for (let seed = 1; seed <= 12 && !spread; seed++) {
      const e = makeEngine({ ...quiet, seed }, { rank: 7 });
      const inc = e.spawnIncident('apartment_fire', 'westres', { accuracy: 'exact' });
      answer(e, inc); locate(e, inc);
      for (let k = 0; k < 3 && !inc.spread; k++) { inc.threat = 100; run(e, 1); }
      if (inc.spread) spread++;
    }
    expect(spread).toBeGreaterThan(0);
  });

  it('storylines are scheduled into ordinary shifts', () => {
    let got = 0;
    for (let seed = 1; seed < 40; seed++) {
      const cfg = rollStoryline(baseConfig({ mode: 'career', title: 't', briefing: '', durationSec: 900, seed, districts: ['downtown', 'oldtown', 'westres', 'riverside', 'financial'] }), 3, seed);
      if (!cfg.storyline) continue;
      got++;
      expect(STORYLINES.some((s) => s.id === cfg.storyline!.id)).toBe(true);
      expect(cfg.forced!.some((f) => f.first)).toBe(true);
      expect(cfg.forced!.every((f) => f.at < 900)).toBe(true);
    }
    expect(got).toBeGreaterThan(5);
    const e = makeEngine({ script: undefined, incidentRate: 0.0001, forced: [{ at: 10, template: 'bank_robbery', district: 'downtown', story: 'heist', first: true }], storyline: { id: 'heist', title: 'The Heist', headline: 'Armed crew storms the bank', at: 10 } }, { rank: 7 });
    run(e, 14);
    expect((e.state.news ?? []).some((n) => n.text.startsWith('BREAKING'))).toBe(true);
  });

  it('transporting ambulances can be sent to a trauma centre', () => {
    const e = makeEngine(quiet, { rank: 7 });
    const inc = e.spawnIncident('collision_injury', 'westres', { accuracy: 'exact' });
    answer(e, inc); locate(e, inc);
    for (const r of inc.requires) {
      const u = Object.values(e.state.units).find((x) => x.capabilities.includes(r.cap) && x.status === 'AVAILABLE' && !inc.assignedUnits.includes(x.id));
      if (u) e.dispatch(u.id, inc.id);
    }
    run(e, 600, () => Object.values(e.state.units).some((u) => u.status === 'TRANSPORTING'));
    const amb = Object.values(e.state.units).find((u) => u.status === 'TRANSPORTING');
    if (!amb) return;
    const other = e.city.hospitals.find((h) => h !== amb.destNode)!;
    expect(e.setHospital(amb.id, other).ok).toBe(true);
    expect(amb.destNode).toBe(other);
  });
});

describe('hospital coordination, access and radio life', () => {
  it('medics ask where to take a specialist patient and the board shows capacity', () => {
    const e = makeEngine(quiet, { rank: 7 });
    run(e, 2);
    expect(Object.keys(e.state.hospitals ?? {}).length).toBe(e.city.hospitals.length);
    const inc = e.spawnIncident('collision_injury', 'westres', { accuracy: 'exact' });
    expect(e.patientNeed(inc)).toBe('trauma');
    answer(e, inc); locate(e, inc);
    for (const r of inc.requires) for (let k = 0; k < r.n; k++) {
      const u = Object.values(e.state.units).filter((x) => x.capabilities.includes(r.cap) && x.status === 'AVAILABLE' && !inc.assignedUnits.includes(x.id) && !isAir(x)).sort((a, b) => (e.estimate(a.id, inc.nodeId)?.eta ?? 1e9) - (e.estimate(b.id, inc.nodeId)?.eta ?? 1e9))[0];
      if (u) e.dispatch(u.id, inc.id);
    }
    run(e, 700, () => !!e.state.decisions?.some((d) => d.kind === 'hospital'));
    const d = e.state.decisions?.find((x) => x.kind === 'hospital');
    if (!d) return; // the patient may not have needed transport in this roll
    const trauma = Object.values(e.state.hospitals!).find((h) => h.has.includes('trauma'))!;
    expect(e.decide(d.id, String(trauma.node)).ok).toBe(true);
    expect(trauma.prealerts).toContain(inc.id);
  });

  it('a hospital without the right department makes the outcome worse', () => {
    const e = makeEngine(quiet, { rank: 7 });
    run(e, 2);
    const clinic = Object.values(e.state.hospitals!).find((h) => !h.has.length);
    if (!clinic) return;
    const inc = e.spawnIncident('cardiac_arrest', 'westres', { accuracy: 'exact' });
    expect(e.hospitalSuits(clinic, e.patientNeed(inc), inc.severity)).toBe(false);
    const cardiac = Object.values(e.state.hospitals!).find((h) => h.has.includes('cardiac'))!;
    cardiac.er = 0;
    expect(e.hospitalSuits(cardiac, 'cardiac', 5)).toBe(true);
    cardiac.down.cardiac = e.state.time + 100;
    expect(e.hospitalSuits(cardiac, 'cardiac', 5)).toBe(false);
  });

  it('access details asked for on the way in are found on the call', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('fall_elderly', 'westres', { accuracy: 'exact', archetype: 'witness' });
    answer(e, inc);
    e.ask(inc.callId!, { text: 'How will the crews get in? Is there a door code?' });
    run(e, 6);
    expect(inc.facts.some((f) => f.key === 'access')).toBe(true);
  });

  it('the radio comes alive with unit-to-unit chatter', () => {
    const e = makeEngine({ script: undefined, incidentRate: 0.0001, mode: 'free' }, { rank: 3 });
    run(e, 600);
    expect(e.state.radio.some((m) => m.kind === 'chatter')).toBe(true);
  });

  it('a patrol car can be ordered to make a stop', () => {
    const e = makeEngine({ script: undefined, incidentRate: 0.0001, mode: 'free' }, { rank: 3 });
    run(e, 20);
    const car = Object.values(e.state.units).find((u) => e.onPatrol(u))!;
    expect(e.orderStop(car.id).ok).toBe(true);
    expect(Object.values(e.state.incidents).some((i) => i.templateId === 'traffic_stop')).toBe(true);
  });
});
