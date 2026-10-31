import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { isAir } from '../src/sim/fleet';
import { colleagueOf, colleagueTick, landingZones, shelterDownwind, takeOver, trustAfter, trustOf, windTick, writeHandover, prepostMet } from '../src/sim/more';
import { replyOnRadio } from '../src/sim/replies';
import { newProfile, careerConfig, applyShift } from '../src/sim/profile';
import type { GameEngine } from '../src/sim/engine';
import type { Incident } from '../src/sim/types';

const quiet = { script: [] as never[] };
const live = (e: GameEngine) => { e.state.config.script = undefined; e.state.config.incidentRate = 0; e.state.nextSpawnAt = 1e9; return e; };

describe('remaster 13: the colleague at desk 2', () => {
  it('picks up overflow calls, works them, and can hand one back', () => {
    const e = live(makeEngine(quiet, { rank: 4 }));
    const a = e.spawnIncident('kitchen_fire', 'downtown', { accuracy: 'exact' });
    const b = e.spawnIncident('fall_elderly', 'westres', { accuracy: 'exact' });
    run(e, 9);
    colleagueTick(e);
    const c = colleagueOf(e.state);
    expect(c.callId).toBeTruthy();
    const call = e.state.calls[c.callId!];
    expect(call.colleague?.name).toBe(c.name);
    // hand-back
    expect(takeOver(e, call.id).ok).toBe(true);
    expect(e.state.activeCallId).toBe(call.id);
    // a second one is worked to the end by the colleague
    const d = e.spawnIncident('collision_injury', 'riverside', { accuracy: 'exact' });
    run(e, 9); colleagueTick(e);
    const id2 = colleagueOf(e.state).callId!;
    const inc2 = e.state.incidents[e.state.calls[id2].incidentId];
    e.state.time = colleagueOf(e.state).doneAt + 1; colleagueTick(e);
    expect(inc2.reportedNode).not.toBeNull();
    expect(inc2.assignedUnits.length).toBeGreaterThan(0);
    void a; void b; void d;
  });
});

describe('remaster 13: the air ambulance needs somewhere to land', () => {
  it('asks for a landing zone on the radio and comes when you answer', () => {
    const e = live(makeEngine(quiet, { rank: 6 }));
    const inc = e.spawnIncident('collision_trapped', 'downtown', { noCall: true });
    e.setIncidentLocation(inc.id, inc.nodeId);
    const cop = Object.values(e.state.units).find((u) => u.service === 'police' && !isAir(u))!;
    e.dispatch(cop.id, inc.id);
    expect(e.requestResource(inc.id, 'air_ambulance').ok).toBe(true);
    const d = e.state.decisions!.find((x) => x.kind === 'lz')!;
    expect(d).toBeTruthy();
    const zones = landingZones(e, inc);
    expect(replyOnRadio(e, 'land it on the road at the scene', { unitId: d.unitId || undefined, channel: 'all' }).handled).toBe(true);
    expect(d.chosen).toBe('lzroad');
    expect(Number.isFinite(inc.resources!.air_ambulance.arriveAt)).toBe(true);
    expect(zones.length).toBeGreaterThanOrEqual(1);
  });
});

describe('remaster 13: wind, trust, handover and events', () => {
  it('a chemical plume drifts with the wind, and the district downwind can be told to shelter', () => {
    const e = live(makeEngine(quiet, { rank: 6 }));
    const inc = e.spawnIncident('hazmat_spill', 'industrial', { noCall: true });
    windTick(e);
    expect(inc.plume).toBeTruthy();
    if (inc.plume!.district !== inc.district) { expect(shelterDownwind(e, inc.id).ok).toBe(true); expect(inc.plumeAlerted).toBe(inc.plume!.district); }
  });
  it('districts remember slow responses and failures', () => {
    const e = live(makeEngine(quiet));
    const inc = e.spawnIncident('kitchen_fire', 'westres', { noCall: true }) as Incident;
    const before = trustOf(e.state, 'westres');
    trustAfter(e.state, inc, 'failed');
    expect(trustOf(e.state, 'westres')).toBeLessThan(before);
  });
  it('the next shift inherits what was left: notes and callers who ring back', () => {
    const p = newProfile('T', 4);
    const e = live(makeEngine({ ...quiet, mode: 'career' }, { rank: 3 }));
    e.spawnIncident('fall_elderly', 'westres', { noCall: true });
    const h = writeHandover(e.state, 3);
    expect(h.notes.length).toBe(1);
    expect(h.carry.length).toBe(1);
    applyShift(p, e.state);
    expect(careerConfig(p).handover?.carry.length).toBe(1);
  });
  it('pre-posting for a planned event is checked when it starts', () => {
    const e = live(makeEngine(quiet));
    const amb = Object.values(e.state.units).find((u) => u.capabilities.includes('transport'))!;
    const cop = Object.values(e.state.units).find((u) => u.capabilities.includes('patrol') && !isAir(u))!;
    const district = e.city.nodes[amb.postNode].district;
    const ok = prepostMet(e, district);
    expect(typeof ok).toBe('boolean');
    cop.postNode = amb.postNode; cop.prevNode = amb.postNode;
    expect(prepostMet(e, district)).toBe(true);
  });
});

describe('remaster 13: the motorway and the tower', () => {
  it('a wrong-way driver stays on the motorway and gets more dangerous every second', () => {
    const e = live(makeEngine(quiet, { rank: 6 }));
    const inc = e.spawnIncident('wrong_way_driver', 'airport', { noCall: true });
    expect(inc.mover?.wrongWay).toBe(true);
    run(e, 20);
    expect(inc.mover!.risk ?? 0).toBeGreaterThan(10);
  });
  it('high-rise callers ask stairs-or-stay, and the right answer depends on their floor', () => {
    const e = live(makeEngine(quiet, { rank: 6 }));
    const inc = e.spawnIncident('highrise_fire', 'financial', { accuracy: 'exact', archetype: 'calm_serious' });
    expect(Number(inc.vars.fireFloor)).toBeGreaterThan(0);
    const call = e.state.calls[inc.callId!];
    e.answerCall(call.id);
    run(e, 40, () => !!call.question);
    expect(call.question?.kind).toBe('highrise');
    const above = Number(inc.vars.myFloor) > Number(inc.vars.fireFloor);
    e.ask(call.id, { text: above ? 'Stay in the flat, seal the door with wet towels' : 'Take the stairs down now, stay low' });
    expect(e.state.stats.highriseRight).toBe(1);
  });
});
