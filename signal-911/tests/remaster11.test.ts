import { describe, it, expect } from 'vitest';
import { makeEngine, run } from './helpers';
import { REGULARS, spawnRegular } from '../src/sim/callers';
import { cameraOffline, cctvConnect, cctvView } from '../src/sim/cctv';
import { careerConfig, newProfile, applyShift } from '../src/sim/profile';
import { GameEngine, STAGE_FLOOR } from '../src/sim/engine';
import { TEMPLATES } from '../src/sim/content/templates';
import { isAir } from '../src/sim/fleet';
import type { Incident, Unit } from '../src/sim/types';

const quiet = { script: [] as never[] };
const nearest = (e: GameEngine, inc: Incident, pred: (u: Unit) => boolean, n = 1) => Object.values(e.state.units).filter((u) => pred(u) && !isAir(u) && u.status === 'AVAILABLE')
  .sort((a, b) => (e.estimate(a.id, inc.nodeId)?.eta ?? 1e9) - (e.estimate(b.id, inc.nodeId)?.eta ?? 1e9)).slice(0, n);

describe('remaster 11: one realistic mode', () => {
  it('every career shift runs on the realistic setting', () => {
    const p = newProfile('T', 5);
    expect(p.flags.difficulty).toBe('hard');
    expect(careerConfig(p).difficulty).toBe('hard');
  });
  it('escalating incidents reach their next stage within about three minutes', () => {
    for (const t of TEMPLATES.filter((x) => x.escalate?.length)) {
      const g = t.threat[1] * 0.55 * 1.05;
      expect(Math.max(STAGE_FLOOR * 0.9, g)).toBeGreaterThan(48 / 200);
    }
  });
});

describe('remaster 11: regular callers', () => {
  it('the CAD recognises a regular, and their file grows across shifts', () => {
    const p = newProfile('T', 9);
    const cfg = careerConfig(p, { incidentRate: 0, script: [] as never[] });
    const e = makeEngine({ ...cfg, script: [] as never[], regulars: { doris: { calls: 3, real: 0, lastShift: 2, log: ['shift 2: sent to the non-emergency line'] } } });
    const inc = spawnRegular(e, REGULARS[0], false);
    e.answerCall(inc.callId!);
    run(e, 3);
    const call = e.state.calls[inc.callId!];
    expect(call.transcript.some((l) => l.who === 'SYSTEM' && /number on file — Doris Pemberton/.test(l.text))).toBe(true);
    expect(call.transcript.some((l) => l.who === 'CALLER' && /Doris|dear|Tuesday/.test(l.text))).toBe(true);
    const r = e.redirectCall(call.id);
    expect(r.good).toBe(true);
    applyShift(p, e.state);
    expect(p.regulars?.doris.calls).toBe(1);
    expect(p.regulars?.doris.log[0]).toMatch(/non-emergency/);
  });
  it('brushing off a regular on the day it is real has consequences', () => {
    const e = makeEngine(quiet);
    const inc = spawnRegular(e, REGULARS.find((r) => r.id === 'kroll')!, true);
    expect(inc.templateId).toBe('burglary_progress');
    e.answerCall(inc.callId!);
    run(e, 4);
    e.redirectCall(inc.callId!);
    expect((inc.consequences ?? []).some((c) => /this time it was real/.test(c))).toBe(true);
  });
});

describe('remaster 11: third-party callers', () => {
  it('a neighbour at a locked door cannot say if the patient is breathing until they get in', () => {
    let e!: GameEngine, inc!: Incident;
    for (let k = 0; k < 40; k++) { e = makeEngine({ ...quiet, seed: 100 + k }); inc = e.spawnIncident('fall_elderly', 'westres', { archetype: 'worried_neighbor', accuracy: 'exact' }); if (inc.thirdParty) break; }
    expect(inc.thirdParty?.kind).toBe('door');
    const call = e.state.calls[inc.callId!];
    e.answerCall(call.id); run(e, 4);
    e.ask(call.id, { intent: 'breathing' }); run(e, 4);
    expect(call.transcript.filter((l) => l.who === 'CALLER').pop()!.text).toMatch(/door|outside|tell from out here/i);
    expect(e.getCloser(call.id).ok).toBe(true);
    run(e, 12);
    expect(inc.thirdParty!.tried).toBe(1);
  });
  it('a child can take the phone to a parent who is awake', () => {
    let e!: GameEngine, inc!: Incident;
    for (let k = 0; k < 40; k++) { e = makeEngine({ ...quiet, seed: 300 + k }); inc = e.spawnIncident('fall_elderly', 'westres', { archetype: 'child_caller', accuracy: 'exact' }); if (inc.thirdParty) break; }
    expect(inc.thirdParty?.kind).toBe('child');
    const call = e.state.calls[inc.callId!];
    e.answerCall(call.id); run(e, 4);
    expect(e.getCloser(call.id).ok).toBe(true);
    run(e, 12);
    expect(inc.thirdParty!.near).toBe(true);
    expect(call.profile.archetype).toBe('injured_self');
  });
});

describe('remaster 11: callers on the move', () => {
  it('a driving caller keeps moving until told to pull over', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('driving_patient', 'westres', { accuracy: 'exact' });
    expect(inc.mover?.caller).toBe(true);
    const start = inc.nodeId;
    e.answerCall(inc.callId!);
    run(e, 30);
    expect(inc.nodeId).not.toBe(start);
    const call = e.state.calls[inc.callId!];
    expect(call.heard.some((h) => /Passing|moving/.test(h.label))).toBe(true);
    expect(e.pullOver(call.id).ok).toBe(true);
    const at = inc.nodeId;
    run(e, 10);
    expect(inc.mover!.stopped).toBe(true);
    expect(inc.nodeId).toBe(at);
    expect(call.heard.some((h) => /Stopped/.test(h.label) && h.reliability === 'sure')).toBe(true);
  });
  it('a thief on foot is hard to see and slower than a car', () => {
    const e = makeEngine(quiet);
    const inc = e.spawnIncident('foot_suspect', 'downtown', { accuracy: 'exact', noCall: true });
    expect(inc.mover?.foot).toBe(true);
    const x0 = inc.mover!.x, y0 = inc.mover!.y;
    run(e, 30);
    expect(Math.hypot(inc.mover!.x - x0, inc.mover!.y - y0)).toBeGreaterThan(5);
    const car = e.spawnIncident('pursuit', 'downtown', { accuracy: 'exact', noCall: true });
    expect(inc.mover!.speed).toBeLessThan(car.mover!.speed / 2);
    // a patrol car driving past at 30 units does not notice him
    const u = nearest(e, inc, (x) => x.service === 'police')[0];
    e.dispatch(u.id, inc.id);
    u.x = inc.mover!.x + 30; u.y = inc.mover!.y; u.status = 'EN_ROUTE';
    run(e, 0.5);
    expect(u.note).not.toBe('In pursuit');
  });
});

describe('remaster 11: cctv network', () => {
  it('some cameras are dead today, and you only find out by trying them', () => {
    const e = makeEngine(quiet);
    const dead = e.cameras().find((c) => cameraOffline(e, c))!;
    expect(dead).toBeTruthy();
    cctvConnect(e, dead.id);
    expect(cctvView(e)!.state).toBe('connecting');
    run(e, 12);
    expect(cctvView(e)!.state).toBe('nosignal');
    expect(e.state.cctv!.tried[dead.id]).toBe('offline');
  });
});

import { assignSector, commandFactor, setCommander, stormTick, crewStress } from '../src/sim/field';
describe('remaster 11: the fireground, the weather and the crews', () => {
  it('a big fire needs a commander and companies in the right sectors', () => {
    const e = makeEngine(quiet, { rank: 6 });
    const inc = e.spawnIncident('apartment_fire', 'downtown', { noCall: true, severity: 4 });
    const fire = Object.values(e.state.units).filter((u) => u.service === 'fire' && !isAir(u) && u.status === 'AVAILABLE')
      .sort((a, b) => (e.estimate(a.id, inc.nodeId)?.eta ?? 1e9) - (e.estimate(b.id, inc.nodeId)?.eta ?? 1e9)).slice(0, 3);
    for (const u of fire) e.dispatch(u.id, inc.id);
    run(e, 300, () => !!inc.command);
    expect(inc.command).toBeTruthy();
    const loose = commandFactor(e, inc).f;
    const here = e.onScene(inc).filter((u) => u.service === 'fire');
    const engine = here.find((u) => u.type === 'engine') ?? here[0];
    const other = here.find((u) => u !== engine) ?? here[0];
    expect(setCommander(e, inc.id, other.id).ok).toBe(true);
    expect(assignSector(e, inc.id, 'attack', engine.id).ok).toBe(true);
    expect(commandFactor(e, inc).f).toBeGreaterThan(loose);
    expect(commandFactor(e, inc).notes.some((n) => /ventilation/i.test(n))).toBe(true);
  });
  it('storm cells drift across the map and flood the streets under them', () => {
    const e = makeEngine({ ...quiet, weather: 'storm' });
    e.state.weather = 'storm';
    for (let k = 0; k < 400 && !(e.state.storms ?? []).some((c) => c.flooded.length); k++) { e.state.time += 1; stormTick(e); }
    const cell = e.state.storms![0];
    expect(cell).toBeTruthy();
    const x0 = cell.x;
    stormTick(e);
    expect(cell.x).toBeGreaterThan(x0);
    expect((e.state.floodEdges ?? []).every((id) => e.state.closedEdges.includes(id))).toBe(true);
  });
  it('a crew that has seen too much asks to stand down, and can be rotated out', () => {
    const e = makeEngine(quiet);
    const u = Object.values(e.state.units).find((x) => x.service === 'medical' && !isAir(x))!;
    for (const p of e.crewOf(u)) p.stress = 85;
    expect(e.unitEffectiveness(u)).toBeLessThan((() => { const s = e.crewOf(u).map((p) => p.stress); for (const p of e.crewOf(u)) p.stress = 0; const v = e.unitEffectiveness(u); e.crewOf(u).forEach((p, i) => { p.stress = s[i]; }); return v; })());
    // a spare medic on the roster
    const spare = { ...e.crewOf(u)[0], id: 'spare1', name: 'Sam Spare', unitId: null, stress: 0, fatigue: 0 };
    e.state.personnel[spare.id] = spare;
    e.state.time = 400; e.state.config.script = undefined; e.state.config.incidentRate = 0; e.state.nextSpawnAt = 1e9;
    run(e, 60, () => (e.state.decisions ?? []).some((d) => d.kind === 'stress'));
    const d = e.state.decisions!.find((x) => x.kind === 'stress')!;
    expect(d).toBeTruthy();
    const stressed = e.state.units[d.unitId];
    const before = crewStress(e, stressed);
    if (d.options.some((o) => o.id === 'rotate')) {
      expect(e.decide(d.id, 'rotate').ok).toBe(true);
      expect(crewStress(e, stressed)).toBeLessThan(before);
    } else {
      expect(e.decide(d.id, 'rest').ok).toBe(true);
      expect(stressed.status).toBe('OUT_OF_SERVICE');
    }
  });
});

import { relaysTick } from '../src/sim/callers';
import { EVENT_DEFS } from '../src/sim/events';
describe('remaster 11: relayed calls and Halloween', () => {
  it('a car rings in its own crash: exact location, no detail', () => {
    const e = makeEngine({ ...quiet, seed: 77, durationSec: 4000 });
    e.state.config.script = undefined; e.state.config.incidentRate = 0;
    for (let t = 120; t < 3800 && !(e.state.relayLog ?? []).length; t += 1) { e.state.time = t; relaysTick(e); }
    expect((e.state.relayLog ?? []).length).toBe(1);
    const call = Object.values(e.state.calls).find((c) => c.relay)!;
    e.answerCall(call.id); run(e, 4);
    expect(call.transcript.some((l) => l.who === 'CALLER' && /Velora|Sentinel/.test(l.text))).toBe(true);
    e.ask(call.id, { intent: 'breathing' }); run(e, 4);
    expect(call.transcript.filter((l) => l.who === 'CALLER').pop()!.text).toMatch(/vehicle|panel|car|keyholder|cabin/i);
  });
  it('Halloween night brings its own calls', () => {
    expect(EVENT_DEFS.halloween.name).toMatch(/Halloween/);
    const e = makeEngine({ ...quiet, incidentRate: 1, events: [{ type: 'halloween', at: 1, duration: 600 }] });
    e.state.config.script = undefined;
    run(e, 3);
    const seen = new Set<string>();
    for (let k = 0; k < 400; k++) { const c = e.pickIncident(); if (c) seen.add(c.tpl.id); }
    expect(['trick_or_treat_struck', 'costume_weapon', 'candle_fire', 'egging_prank'].some((id) => seen.has(id))).toBe(true);
    const plain = makeEngine({ ...quiet, incidentRate: 1 });
    for (let k = 0; k < 400; k++) { const c = plain.pickIncident(); expect(c?.tpl.event).toBeUndefined(); }
  });
});
