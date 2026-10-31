// Builds the compact, fact-checked context sent to the AI dialogue model for one caller line.
// Only information the caller's character could know goes in; hidden twists never do.
import { ARCHETYPES } from './content/vocab';
import { describeKnowledge, fill } from './dialogue';
import { describeVoice } from './voices';
import type { GameEngine } from './engine';

const REVEALABLE = ['injuries', 'breathing', 'conscious', 'age', 'people', 'fire', 'hazard', 'weapon', 'suspect', 'vehicles', 'trapped', 'safe', 'cause', 'address', 'landmark'];

export function buildAiContext(engine: GameEngine, callId: string, lineIds: number[], intent: string, playerText: string) {
  const st = engine.state;
  const call = st.calls[callId];
  const inc = st.incidents[call.incidentId];
  const tpl = engine.instanceTemplate(inc);
  const arch = ARCHETYPES[call.profile.archetype];
  const sheet = describeKnowledge(inc, tpl, call, engine.city);
  const held = call.pending.filter((l) => l.id !== undefined && lineIds.includes(l.id));
  const assigned = inc.assignedUnits.map((id) => st.units[id]).filter(Boolean);
  const events: string[] = [];
  if (call.isCallback) events.push('this is a callback — the caller already phoned earlier');
  if (assigned.some((u) => u.status === 'ON_SCENE')) events.push('responders have arrived and the caller can see them');
  else if (assigned.length && call.heardSirens) events.push('responders are on the way and the caller can now hear sirens getting close');
  else if (assigned.length) events.push('responders have been sent but are still some distance away — the caller cannot hear or see them yet');
  if (inc.deadlineAt != null && inc.deadlineMet == null) events.push(`the critical moment happens in about ${Math.max(0, Math.round(inc.deadlineAt - st.time))} seconds`);
  if (call.promises.length) events.push('the dispatcher promised that help is coming');
  if (inc.stage > 0) events.push('the situation has got worse since the call began');
  if (inc.aid) events.push(`the caller is doing what the dispatcher instructed: ${inc.aid.kind}`);
  // who this caller really is: keep the AI consistent with the game's mechanics
  const tp = inc.thirdParty;
  if (tp && !tp.near) events.push(tp.kind === 'child' ? `the caller is a young child calling about ${tp.rel}, who is lying on the floor; the child is not next to them and cannot say if they are breathing` : `the caller is a neighbour outside a locked door and cannot see the patient at all${tp.window ? ' (they saw them through a window lying still)' : ''}`);
  if (tp?.near) events.push(tp.handedAt !== undefined ? 'the parent has taken the phone from the child and is talking now' : 'the caller is now right beside the patient');
  if (call.text) events.push('this is a TEXT-TO-911 conversation: the caller cannot speak (hiding or deaf) and is typing short text messages — no spoken sounds, keep it to a terse text');
  if (inc.regular) events.push(inc.regular.real ? 'this caller rings 911 a lot about nothing and knows it — but THIS time it is real and they are desperate to be believed' : 'this caller rings 911 a lot about things that are not emergencies; they are chatty and a little sheepish');
  if (inc.mover?.caller && !inc.mover.stopped) events.push('the caller is driving with a sick passenger and keeps moving; they only know where they are from signs and landmarks they pass');
  if (inc.mover?.caller && inc.mover.stopped) events.push('the caller has pulled over and stopped the car');
  if (inc.hoax) events.push('the caller is a calm, cold-sounding person who claims a hostage situation; they stay evasive, will not give a callback number or their name, and never add details beyond mustSay');
  if (call.relay) events.push(call.relay === 'acn' ? 'the caller is a professional operator at a car crash-notification service relaying automatic data; they are not at the scene and only know the vehicle data' : 'the caller is a professional operator at an alarm monitoring company; they are not on site and only know the panel signal');
  if (call.question) events.push(`the caller just asked the dispatcher: "${call.question.text}" and is waiting for an answer`);
  const freeForm = intent === 'unknown';
  const p = call.profile;
  return {
    caller: {
      name: p.name, age: p.age, type: arch?.label ?? p.archetype, personality: p.personality, speakingStyle: p.speakingStyle,
      relationshipToEmergency: inc.vars.self === '1' ? 'the caller is the patient' : `talking about ${fill('{who}', inc.vars)} (${inc.vars.he}/${inc.vars.him})`,
      persona: p.persona ?? null,
      voice: describeVoice(p.voice),
    },
    mood: { stress: Math.round(call.mood.panic), cooperation: Math.round(call.mood.cooperation), frustration: Math.round(call.mood.frustration), trust: Math.round(call.mood.trust), state: p.emotionalState },
    situation: { whatTheyReported: call.transcript.find((l) => l.who === 'CALLER')?.text ?? tpl.open[0], theirAccount: tpl.cause.map((c) => fill(c, inc.vars)), location: sheet.location },
    knows: sheet.knows,
    doesNotKnow: sheet.doesNotKnow,
    events,
    history: call.transcript.filter((l) => l.who !== 'SYSTEM').slice(-10).map((l) => `${l.who === 'CALLER' ? 'Caller' : 'Dispatcher'}: ${l.text}`),
    dispatcher: playerText,
    intent: intent === 'opening' ? 'call just connected — the caller speaks first' : intent,
    // free-form questions get no forced line: the model answers from the knowledge sheet
    mustSay: freeForm ? [] : held.map((l) => l.text),
    freeForm,
    revealable: freeForm ? REVEALABLE.filter((t) => t in sheet.knows || t === 'address' || t === 'landmark') : [],
  };
}
