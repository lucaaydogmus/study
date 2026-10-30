import { createRng, type Rng } from './rng';
import {
  PERSONALITIES, questionsFor, scriptFor, type Answer, type Personality, type Question, type Twist,
} from './dialogueData';
import { addNote, correctLocation, log, say, setBelieved, traceLocation, type Incident, type Spec, type World } from './world';
import type { Capability } from './types';

export interface Asked { answered: boolean; confirmed: boolean; deflected: number }
export interface Session {
  personality: Personality; twist: Twist; spec: Spec; rng: Rng;
  patience: number; maxPatience: number; calmed: boolean; questions: number;
  asked: Record<string, Asked>; pending: { key: string; at: number } | null; discAfter: number | null;
}

const strip = (s: string) => s.replace(/^"|"$/g, '');
const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^I[ '’]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** Count-aware capability merge: every group an answer mentions is set to exactly that many. */
export function applyCaps(believed: Capability[], caps: Capability[] = [], settles: Capability[] = []): Capability[] {
  const groups = new Set<Capability>([...caps, ...settles]);
  const out = believed.filter((c) => !groups.has(c));
  for (const g of groups) for (let i = 0; i < caps.filter((c) => c === g).length; i++) out.push(g);
  return out;
}

const HEDGE = /^(I think|Maybe|I could be wrong|Sorry, I'm not sure)/;
function speak(s: Session, line: string, hedge = false): string {
  const P = PERSONALITIES[s.personality];
  const pre = s.rng.next() < 0.75 ? P.pre[Math.floor(s.rng.next() * P.pre.length)] : '';
  const body = pre && !/^I[ '’]/.test(line) ? lcFirst(line) : line;
  const out = pre + body;
  // A caller who is not sure hedges, unless their manner of speaking already does.
  if (hedge && !HEDGE.test(out)) return `${s.rng.next() < 0.5 ? 'I think ' : 'Maybe… '}${lcFirst(out)}`;
  return out;
}

export function openSession(w: World, inc: Incident, spec: Spec) {
  const P = PERSONALITIES[spec.personality];
  const s: Session = {
    personality: spec.personality, twist: spec.twist, spec, rng: createRng(w.config.seed * 31 + inc.id * 7919),
    patience: P.patience, maxPatience: P.patience, calmed: false, questions: 0, asked: {}, pending: null,
    discAfter: spec.twist === 'disconnect' ? spec.discAfter : null,
  };
  inc.session = s;
  w.activeCall = inc.id;
  say(w, inc, 'system', `Connected. The caller sounds ${P.label.toLowerCase()}.`);
  let text = speak(s, strip(spec.opening));
  if (s.rng.next() < P.volunteer) text += ` ${giveAddress(w, inc, s, true)}`;
  say(w, inc, 'caller', text);
  log(w, 'call', `Call answered: ${inc.title}.`);
}

function giveAddress(w: World, inc: Incident, s: Session, inOpening: boolean): string {
  const sp = s.spec;
  if (sp.twist === 'wrong_location' && sp.wrongNodeId !== null && sp.wrongAddress) {
    setBelieved(w, inc, sp.wrongNodeId, sp.wrongAddress);
    addNote(w, inc, `Address given: ${sp.wrongAddress} (caller not sure)`, 'unconfirmed');
    return inOpening ? `It's… I think it's ${sp.wrongAddress}.` : `I think it's ${sp.wrongAddress}… maybe.`;
  }
  const sure = s.rng.next() < PERSONALITIES[s.personality].reliability;
  setBelieved(w, inc, sp.nodeId, sp.address);
  inc.addrConfirmed = sure;
  addNote(w, inc, `Address given: ${sp.address}${sure ? '' : ' (caller not sure)'}`, sure ? 'confirmed' : 'unconfirmed');
  return sure ? `It's ${sp.address}.` : `I think it's ${sp.address}, but I'm not certain.`;
}

export type QState = 'ask' | 'again' | 'done';
export interface QView { q: Question; state: QState }

/** Questions the dispatcher can currently see, with their state. */
export function questionStates(inc: Incident): QView[] {
  const s = inc.session;
  if (!s) return [];
  const known = inc.believedNode !== null;
  return questionsFor(inc.templateId)
    .filter((q) => (q.key === 'ADDRESS' ? !known : q.key === 'CONFIRM' ? known : true))
    .map((q) => {
      const a = s.asked[q.key];
      const state: QState = a?.confirmed || (q.once && a?.answered) ? 'done' : a && (a.answered || a.deflected) ? 'again' : 'ask';
      return { q, state };
    });
}

export function ask(w: World, inc: Incident, key: string): boolean {
  const s = inc.session;
  if (!s || s.pending || inc.status === 'RESOLVED' || inc.status === 'FAILED') return false;
  const view = questionStates(inc).find((v) => v.q.key === key);
  if (!view || view.state === 'done') return false;
  say(w, inc, 'dispatcher', view.q.text);
  s.pending = { key, at: w.time + PERSONALITIES[s.personality].delay };
  return true;
}

/** Called every sim step: delivers the caller's reply when it is due. */
export function tickSession(w: World, inc: Incident) {
  const s = inc.session;
  if (!s || !s.pending || w.time < s.pending.at) return;
  const key = s.pending.key;
  s.pending = null;
  s.questions++;
  const P = PERSONALITIES[s.personality];

  if (s.discAfter !== null && s.questions >= s.discAfter) {
    say(w, inc, 'system', 'The line goes dead. The caller disconnected.');
    addNote(w, inc, 'Caller disconnected unexpectedly.', 'warning');
    w.stats.hungUp++;
    endCall(w, inc, 'system');
    return;
  }
  s.patience -= 1;
  const rec = (s.asked[key] ??= { answered: false, confirmed: false, deflected: 0 });

  if (key === 'CALM') {
    s.calmed = true; rec.answered = true; rec.confirmed = true;
    s.patience = Math.min(s.maxPatience, s.patience + 2);
    say(w, inc, 'caller', speak(s, P.calmed[0] ?? 'Okay.'));
  } else if (!s.calmed && rec.deflected === 0 && s.rng.next() < P.resist) {
    rec.deflected++;
    say(w, inc, 'caller', P.deflect[Math.floor(s.rng.next() * P.deflect.length)] ?? 'I can\'t say.');
  } else {
    answer(w, inc, s, key, rec);
  }

  if (s.patience <= 0 && inc.session) {
    say(w, inc, 'caller', P.hangup[0]);
    addNote(w, inc, 'Caller hung up.', 'warning');
    w.stats.hungUp++;
    endCall(w, inc, 'system');
  }
}

function answer(w: World, inc: Incident, s: Session, key: string, rec: Asked) {
  const P = PERSONALITIES[s.personality];
  const sp = s.spec;
  const sure = s.rng.next() < P.reliability;
  const kind = rec.answered || sure ? 'confirmed' : 'unconfirmed';
  const again = rec.answered;
  rec.answered = true;
  rec.confirmed = kind === 'confirmed';

  if (key === 'ADDRESS') { say(w, inc, 'caller', speak(s, giveAddress(w, inc, s, false))); rec.confirmed = !!inc.addrConfirmed; return; }
  if (key === 'CONFIRM') {
    if (inc.believedNode !== inc.nodeId) {
      correctLocation(w, inc, `Address corrected by caller: ${inc.trueAddress}`, 'confirmed');
      say(w, inc, 'caller', speak(s, `Wait, I'm looking at the street sign. It's actually ${inc.trueAddress}.`));
    } else {
      inc.addrConfirmed = true;
      addNote(w, inc, `Address confirmed: ${inc.trueAddress}`, 'confirmed');
      say(w, inc, 'caller', speak(s, `Yes, ${inc.trueAddress}. That's right.`));
    }
    rec.confirmed = true;
    return;
  }
  if (key === 'DANGER') {
    const sev = inc.severity;
    const line = sev >= 3 ? 'Not really. I\'m still close to it and it\'s frightening!' : sev === 2 ? 'I\'m a little way back. I think I\'m okay.' : 'Yes, I\'m fine. Don\'t worry about me.';
    say(w, inc, 'caller', speak(s, line, kind === 'unconfirmed'));
    addNote(w, inc, sev >= 3 ? 'Caller is close to the danger.' : 'Caller is at a safe distance.', kind);
    return;
  }
  let ans: Answer;
  if (key === 'DESCRIBE') {
    ans = scriptFor(sp.templateId, sp.perceivedVariationId).describe;
    rec.confirmed = true; // one-shot
    applyAnswer(w, inc, s, ans, sp.twist === 'milder' || sp.twist === 'worse' ? 'unconfirmed' : kind, false);
    return;
  }
  ans = scriptFor(sp.templateId, sp.variationId).answers[key] ?? { say: 'No, nothing like that.', note: '' };
  applyAnswer(w, inc, s, ans, kind, again);
}

function applyAnswer(w: World, inc: Incident, s: Session, ans: Answer, kind: 'confirmed' | 'unconfirmed', again: boolean) {
  say(w, inc, 'caller', speak(s, ans.say, kind === 'unconfirmed'));
  if (ans.note) addNote(w, inc, ans.note, kind);
  const before = inc.believed;
  const caps = applyCaps(before.caps, ans.caps, ans.settles);
  const removed = before.caps.length > caps.length;
  const sevChanged = ans.sev !== undefined && ans.sev !== before.severity;
  inc.believed = { caps, severity: ans.sev ?? before.severity };
  if ((s.twist === 'milder' || s.twist === 'worse') && (removed || (sevChanged && Math.abs((ans.sev ?? 0) - before.severity) >= 1)) && !again) {
    addNote(w, inc, 'This conflicts with the earlier report. Classification updated.', 'warning');
  }
}

export function endCall(w: World, inc: Incident, by: 'player' | 'system') {
  if (!inc.session) return;
  inc.session = null;
  if (w.activeCall === inc.id) w.activeCall = null;
  inc.callEndedAt = w.time;
  say(w, inc, 'system', by === 'player' ? 'Call ended by dispatcher.' : 'Call ended.');
  if (inc.believedNode === null) traceLocation(w, inc);
  else if (inc.believedNode !== inc.nodeId) inc.locFixAt = Math.min(inc.locFixAt ?? Infinity, w.time + 60);
}
