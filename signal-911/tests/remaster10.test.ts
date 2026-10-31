import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { isAir } from '../src/sim/fleet';
import { RESOURCES } from '../src/sim/engine';
import { classifyCrew, talkToUnit } from '../src/sim/crew';
import { getCity } from '../src/sim/city';
import { getScenery } from '../src/ui/scenery';
import { buildCity } from '../src/ui/world3d/build';
import { makeVehicle } from '../src/ui/world3d/vehicles3d';
import type { GameEngine } from '../src/sim/engine';
import type { Incident, Unit } from '../src/sim/types';

const quiet = { script: [] as never[] };
const nearest = (e: GameEngine, inc: Incident, pred: (u: Unit) => boolean, n = 1) => Object.values(e.state.units).filter((u) => pred(u) && !isAir(u) && u.status === 'AVAILABLE')
  .sort((a, b) => (e.estimate(a.id, inc.nodeId)?.eta ?? 1e9) - (e.estimate(b.id, inc.nodeId)?.eta ?? 1e9)).slice(0, n);

describe('remaster 10: talking to crews', () => {
  it('understands what you say to a crew', () => {
    expect(classifyCrew('what is your ETA?')).toBe('eta');
    expect(classifyCrew('expedite, lights and sirens')).toBe('expedite');
    expect(classifyCrew('be careful, he has a knife')).toBe('caution');
    expect(classifyCrew('what have you got on scene?')).toBe('see');
    expect(classifyCrew('good work out there')).toBe('thanks');
    expect(classifyCrew('purple monkey dishwasher')).toBe('unknown');
  });
  it('crews answer from what they can see and act on instructions', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('apartment_fire', 'downtown', { noCall: true });
    const eng = nearest(e, inc, (u) => u.service === 'fire')[0];
    e.dispatch(eng.id, inc.id, { code: 2 });
    run(e, 3);
    const eta = talkToUnit(e, eng.id, { text: 'how long until you get there?' });
    expect(eta.ok).toBe(true);
    expect(eta.reply).toMatch(/out|rolling/);
    talkToUnit(e, eng.id, { intent: 'expedite' });
    expect(e.state.units[eng.id].code).toBe(3);
    talkToUnit(e, eng.id, { text: 'use caution, possible weapon' });
    expect(e.state.units[eng.id].staging).toBe(true);
    const crew = e.crewOf(eng);
    const before = crew[0].morale;
    talkToUnit(e, eng.id, { text: 'thanks, good job' });
    expect(crew[0].morale).toBeGreaterThanOrEqual(Math.min(100, before + 4) - 0.001);
    expect(e.state.radio.filter((m) => m.unitId === eng.id && m.kind === 'dispatch').length).toBeGreaterThanOrEqual(4);
    const odd = talkToUnit(e, eng.id, { text: 'purple monkey dishwasher' });
    expect(odd.reply).toMatch(/again|unreadable|repeat/i);
  });
});

describe('remaster 10: bad lines', () => {
  it('a breaking-up line loses the details until you ask the caller to say again', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('fall_elderly', 'westres', { accuracy: 'exact', archetype: 'worried_neighbor' });
    const call = e.state.calls[inc.callId!];
    call.badLine = true;
    e.answerCall(call.id);
    let garbled = false;
    for (let k = 0; k < 8 && !garbled; k++) { e.ask(call.id, { intent: (['cause', 'injuries', 'conscious', 'age', 'breathing', 'people', 'safe', 'emergency'] as const)[k] }); run(e, 6); garbled = call.transcript.some((l) => l.garbled); }
    expect(garbled).toBe(true);
    expect(call.lastGarbled).toBeTruthy();
    const lost = call.lastGarbled!.text;
    e.ask(call.id, { text: "Sorry, you're breaking up — say again?" });
    run(e, 4);
    expect(call.lastGarbled).toBeNull();
    expect(call.transcript.some((l) => !l.garbled && l.who === 'CALLER' && l.text.includes(lost.slice(0, 12)))).toBe(true);
  });
});

describe('remaster 10: the resources panel', () => {
  it('knows what helps where, and calls it in', () => {
    const e = makeEngine(quiet);
    const lost = e.spawnIncident('missing_person', 'westres', { noCall: true });
    const kitchen = e.spawnIncident('kitchen_fire', 'westres', { noCall: true });
    expect(e.resourceInfo(lost.id, 'k9').ok).toBe(true);
    expect(e.resourceInfo(kitchen.id, 'k9').ok).toBe(false);
    expect(e.resourceInfo(kitchen.id, 'federal').ok).toBe(false);
    expect(RESOURCES.length).toBeGreaterThan(15);
    const budget = e.state.budget;
    const r = e.requestResource(lost.id, 'k9');
    expect(r.ok).toBe(true);
    expect(e.state.budget).toBeLessThan(budget);
    const k9 = e.state.units[lost.resources!.k9.unitId!];
    expect(k9.type).toBe('k9_unit');
    expect(e.resourceInfo(lost.id, 'k9').status).not.toBe('none');
    expect(e.requestResource(lost.id, 'k9').ok).toBe(false);
  });
  it('public works reopens a blocked road when it arrives', () => {
    const e = makeEngine(quiet);
    let inc!: Incident;
    for (let k = 0; k < 30; k++) { inc = e.spawnIncident('collision_multi', 'downtown', { noCall: true }); if (inc.blockedEdge !== null) break; }
    if (inc.blockedEdge === null) return;
    expect(e.requestResource(inc.id, 'publicworks').ok).toBe(true);
    run(e, 240, () => !!inc.resources?.publicworks.here);
    expect(inc.resources!.publicworks.here).toBe(true);
    expect(inc.blockedEdge).toBeNull();
  });
});

describe('remaster 10: stations and hospitals', () => {
  it('vehicles wear down on the road and come back like new from the workshop', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('kitchen_fire', 'riverside', { noCall: true });
    const u = Object.values(e.state.units).filter((x) => x.service === 'fire' && x.status === 'AVAILABLE').sort((a, b) => (e.estimate(b.id, inc.nodeId)?.eta ?? 0) - (e.estimate(a.id, inc.nodeId)?.eta ?? 0))[0];
    e.dispatch(u.id, inc.id);
    run(e, 120, () => u.status === 'ON_SCENE');
    expect(u.condition ?? 100).toBeLessThan(100);
    u.condition = 40; u.status = 'AVAILABLE'; u.assignedIncidentId = undefined;
    expect(e.serviceUnit(u.id).ok).toBe(true);
    run(e, 400, () => u.condition === 100);
    expect(u.condition).toBe(100);
    expect(e.state.stats.services).toBe(1);
  });
  it('an arrest means a trip to the police station for booking', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('shoplifting', 'downtown', { noCall: true });
    inc.truth.suspect = true;
    for (const u of nearest(e, inc, (x) => x.service === 'police', 2)) e.dispatch(u.id, inc.id);
    run(e, 400, () => (e.state.stats.arrests ?? 0) > 0);
    expect(e.state.stats.arrests).toBe(1);
    expect(Object.values(e.state.units).some((u) => u.note === 'Booking prisoner')).toBe(true);
  });
  it('hospitals on diversion can be asked to take one more, and big incidents ask where patients go', () => {
    const e = makeEngine(quiet);
    run(e, 3);
    const h = Object.values(e.state.hospitals ?? {})[0];
    h.er = h.erCap - 1;
    const r = e.askHospitalToAccept(h.node);
    expect(r.ok).toBe(true);
    expect(e.askHospitalToAccept(h.node).ok).toBe(false);
    const inc = e.spawnIncident('vehicle_ramming', 'downtown', { noCall: true });
    for (const u of nearest(e, inc, (x) => x.service === 'medical', 2)) e.dispatch(u.id, inc.id);
    run(e, 300, () => !!inc.mciAsked);
    expect((e.state.decisions ?? []).some((d) => d.kind === 'mci' && d.incId === inc.id)).toBe(true);
  });
});

describe('remaster 10: the 3D city', () => {
  it('builds the whole city as real geometry, and every unit has a model', () => {
    const m = buildCity(getCity(), getScenery(), () => false);
    expect(m.ground.getAttribute('position').count).toBeGreaterThan(10000);
    expect(m.buildings.getAttribute('position').count).toBeGreaterThan(20000);
    expect(m.buildings.getAttribute('aWin').itemSize).toBe(4);
    for (const t of ['patrol', 'engine', 'ladder', 'ambulance', 'motorcycle', 'foot', 'bicycle', 'helicopter', 'federal_tactical', 'usar']) {
      const v = makeVehicle(t, t === 'engine' || t === 'ladder' || t === 'usar' ? 'fire' : t === 'ambulance' ? 'medical' : 'police');
      expect(v.group.children.length).toBeGreaterThan(0);
      expect(v.len).toBeGreaterThan(0.2);
      expect(v.len).toBeLessThan(4);
    }
  });
});
