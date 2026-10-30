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
