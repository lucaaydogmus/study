// Scripted-but-reactive caller dialogue.
// The incident (truth) lives in the simulation; the caller only reveals what their character can
// plausibly know, shaped by an emotional model. No generative model is involved: every line is
// assembled from template banks, so the game is fully deterministic and works offline.
import { addressOf, nearestLandmark, type City } from './city';
import type { Rng } from './rng';
import { ARCHETYPES, FIRST_NAMES, LAST_NAMES } from './content/vocab';
import type { Template } from './content/templates';
import type { Call, CallerProfile, FactVal, HeardLocation, Incident, PendingLine } from './types';

export type Intent =
  | 'emergency' | 'address' | 'landmark' | 'district' | 'name' | 'callback' | 'injuries' | 'breathing' | 'conscious'
  | 'age' | 'people' | 'fire' | 'hazard' | 'weapon' | 'suspect' | 'vehicles' | 'trapped' | 'safe' | 'cause'
  | 'calm' | 'promise' | 'stay' | 'move' | 'repeat' | 'thanks' | 'unknown'
  | 'inst_cpr' | 'inst_recovery' | 'inst_pressure' | 'inst_still' | 'inst_lock';

export interface QuickQ { group: 'Opening' | 'Location' | 'Situation' | 'Guidance' | 'Instructions'; intent: Intent; label: string; text: string }
export const QUICK_QUESTIONS: QuickQ[] = [
  { group: 'Opening', intent: 'emergency', label: 'Emergency?', text: '911, what is your emergency? Tell me what is happening, please.' },
  { group: 'Opening', intent: 'cause', label: 'What happened?', text: 'Can you tell me exactly what happened, please?' },
  { group: 'Location', intent: 'address', label: 'Address?', text: 'What is the address of the emergency, please?' },
  { group: 'Location', intent: 'landmark', label: 'Cross street / landmark?', text: 'Can you tell me the nearest cross street or a landmark, please?' },
  { group: 'Location', intent: 'district', label: 'Which area?', text: 'What neighbourhood or area are you in, please?' },
  { group: 'Location', intent: 'name', label: 'Your name?', text: 'May I have your name, please?' },
  { group: 'Location', intent: 'callback', label: 'Callback number?', text: 'What number are you calling from, please?' },
  { group: 'Situation', intent: 'injuries', label: 'Anyone injured?', text: 'Is anyone injured, please?' },
  { group: 'Situation', intent: 'conscious', label: 'Conscious?', text: 'Is the person awake and responding, please?' },
  { group: 'Situation', intent: 'breathing', label: 'Breathing?', text: 'Are they breathing, please?' },
  { group: 'Situation', intent: 'age', label: 'Age?', text: 'How old is the person, please?' },
  { group: 'Situation', intent: 'people', label: 'How many people?', text: 'How many people are involved, please?' },
  { group: 'Situation', intent: 'fire', label: 'Fire / smoke?', text: 'Do you see any fire or smoke, please?' },
  { group: 'Situation', intent: 'hazard', label: 'Other dangers?', text: 'Are there any other dangers, like gas or chemicals, please?' },
  { group: 'Situation', intent: 'weapon', label: 'Weapons?', text: 'Are there any weapons involved, please?' },
  { group: 'Situation', intent: 'suspect', label: 'Describe suspect', text: 'Can you describe the person involved, please?' },
  { group: 'Situation', intent: 'vehicles', label: 'Vehicles?', text: 'How many vehicles are involved, please?' },
  { group: 'Situation', intent: 'trapped', label: 'Anyone trapped?', text: 'Is anyone trapped or unable to get out, please?' },
  { group: 'Situation', intent: 'safe', label: 'Are you safe?', text: 'Are you safe right now, please?' },
  { group: 'Guidance', intent: 'calm', label: 'Stay calm', text: "I'm here with you. Take a breath and stay calm." },
  { group: 'Guidance', intent: 'stay', label: 'Stay on the line', text: 'Please stay on the line with me.' },
  { group: 'Guidance', intent: 'move', label: 'Move to safety', text: 'If you can, move to a safe place away from the danger.' },
  { group: 'Guidance', intent: 'promise', label: 'Help is on the way', text: 'Help is on the way.' },
  { group: 'Guidance', intent: 'repeat', label: 'Say again?', text: 'Can you repeat that for me?' },
  { group: 'Instructions', intent: 'inst_cpr', label: 'Start CPR', text: "Listen carefully. Kneel beside them, put your hands in the centre of the chest and push hard and fast — about twice a second. Don't stop." },
  { group: 'Instructions', intent: 'inst_recovery', label: 'Recovery position', text: 'Gently roll them onto their side, tilt the head back a little, and keep checking they are breathing.' },
  { group: 'Instructions', intent: 'inst_pressure', label: 'Pressure on wound', text: 'Take a clean cloth or towel and press firmly on the wound. Keep the pressure on — do not lift it to look.' },
  { group: 'Instructions', intent: 'inst_still', label: "Don't move them", text: "Don't move them unless they're in danger. Keep them still and warm until help arrives." },
  { group: 'Instructions', intent: 'move', label: 'Get out / evacuate', text: 'Get everyone out now. Close the doors behind you, stay low under the smoke, and do not use the lift.' },
  { group: 'Instructions', intent: 'inst_lock', label: 'Lock & hide', text: 'Lock yourself in a room, stay quiet, and keep away from the door. Stay on the line with me.' },
];

const RULES: Array<[RegExp, Intent]> = [
  [/\bcpr\b|compression|push (hard|on (the|his|her|their) chest)|pump (the|his|her) chest|chest compress/, 'inst_cpr'],
  [/recovery position|on (to )?(his|her|their) side|roll (him|her|them) (over|on)/, 'inst_recovery'],
  [/pressure|press (firmly|hard|down)? ?on (the )?(wound|cut|bleed)|stop the bleed|towel on|cloth on/, 'inst_pressure'],
  [/don'?t move (him|her|them)|keep (him|her|them) still|do not move (him|her|them)/, 'inst_still'],
  [/lock (yourself|the door)|hide|lock (him|her) out|barricade/, 'inst_lock'],
  [/(help|units?|ambulance|police|officers?|fire (truck|engine|department)|crew|paramedics?).*(on (the|its|their) way|coming|dispatched|sending|en route)|(we('| a)re|i('| a)m|i'll be) sending|on the way|help is coming/, 'promise'],
  [/stay on the line|don'?t hang up|stay with me|stay (there|put|where you are|on the phone)/, 'stay'],
  [/get out|leave (the|your)|evacuat|move (away|to|out)|go outside|back away|stay away|safe place|(get|go|move) to (a )?safe/, 'move'],
  [/calm|breathe|relax|take a (deep )?breath|i'?m here|it'?s (ok|okay|alright)|you('?re| are) doing (really |so )?(great|well|good)|i understand|i hear you|listen to me|keep listening|slow down|you'?re not alone|we'?ve got this/, 'calm'],
  [/repeat|say that again|pardon|come again|didn'?t (catch|hear)/, 'repeat'],
  [/address|where (are|is|exactly)|what street|which street|street name|your location|where do you live/, 'address'],
  [/landmark|cross ?street|intersection|nearby|near (what|by|which)|what can you see|corner|close to|next to (what|which)|what'?s around/, 'landmark'],
  [/district|neighbou?rhood|part of (town|the city)|what (city|town|area)|which area|what area/, 'district'],
  [/your name|who am i (speaking|talking)|who is this|may i have your name|what'?s your name|can i get your name/, 'name'],
  [/phone number|call ?back|number (i can|you'?re)|contact number|calling from/, 'callback'],
  [/breath/, 'breathing'],
  [/conscious|awake|respond|responsive|wake|talking|alert|moving/, 'conscious'],
  [/how old|\bage\b|years old/, 'age'],
  [/injur|hurt|bleed|wound|pain|casualt/, 'injuries'],
  [/how many (people|persons|individuals)|anyone else|who else|people (are )?(inside|involved|there|home)|anybody (inside|else|home)|who'?s (inside|there|home)/, 'people'],
  [/fire|flame|smoke|burn/, 'fire'],
  [/\bgas\b|chemical|danger|hazard|electri|fuel|spill|leak|explosi/, 'hazard'],
  [/weapon|\bgun|knife|armed|firearm/, 'weapon'],
  [/suspect|describe|look like|looks like|still (there|inside|around)|intruder|wearing|which way|who (is|was) it|appearance|what does/, 'suspect'],
  [/vehicle|\bcars?\b|trucks?|how many cars|motorcycle|bus\b/, 'vehicles'],
  [/trapped|stuck|pinned|can'?t get out|cannot get out|locked in/, 'trapped'],
  [/are you (safe|ok|okay|alright|in danger)|in danger|safe right now|you safe/, 'safe'],
  [/what happened|what'?s (going on|happening|wrong)|what is (going on|happening|the emergency)|tell me|emergency|how did|what exactly|explain/, 'cause'],
  [/thank|^ok(ay)?[.! ]*$|^alright|^right[.! ]*$|^yes[.! ]*$|^no[.! ]*$|^hello|^hi[.! ]*$/, 'thanks'],
];
export function classifyIntent(text: string): Intent {
  const t = text.toLowerCase().trim();
  if (!t) return 'unknown';
  for (const [re, intent] of RULES) if (re.test(t)) return intent;
  return 'unknown';
}
export const POLITE = /please|thank|sir|ma'?am|appreciate|i understand|i'?m here|sorry|take your time|it'?s okay|we'?ll get you help|you'?re doing (great|well)/i;
export const RUDE = /shut up|stupid|idiot|hurry up|just answer|whatever|waste of|useless|moron|dumb|calm down!/i;

// Which fact keys a topic can reveal
export const TOPIC_FACTS: Partial<Record<Intent, string[]>> = {
  injuries: ['injured'], breathing: ['breathing'], conscious: ['conscious'], age: ['age'], people: ['people'], fire: ['fire', 'smoke'],
  hazard: ['hazard'], weapon: ['weapon'], suspect: ['suspect', 'suspect_desc'], vehicles: ['vehicles'], trapped: ['trapped'], safe: ['safe'], cause: ['cause'],
};

// ── Variables ───────────────────────────────────────────────────────────────
export function makeVars(rng: Rng, tpl: Template, archetype: string): Record<string, string> {
  const male = rng.chance(0.5);
  const arch = ARCHETYPES[archetype];
  const self = !!arch.self && (tpl.selfOk || archetype === 'injured_self') && tpl.patient !== 'child' && tpl.patient !== 'none' ? 1 : 0;
  const selfPatient = tpl.patient && tpl.patient !== 'none' && arch.self && tpl.selfOk ? 1 : 0;
  let age = 35;
  switch (tpl.patient) {
    case 'child': age = rng.int(3, 9); break;
    case 'elder': age = rng.int(70, 92); break;
    case 'adult': age = rng.int(24, 62); break;
    case 'any': age = rng.chance(0.2) ? rng.int(8, 17) : rng.int(20, 70); break;
    default: age = rng.int(20, 60);
  }
  const he = male ? 'he' : 'she', him = male ? 'him' : 'her', his = male ? 'his' : 'her';
  const kid = tpl.patient === 'child' ? (male ? 'son' : 'daughter') : age < 18 ? (male ? 'son' : 'daughter') : (male ? 'husband' : 'wife');
  let who = 'a person';
  switch (archetype) {
    case 'panicked_parent': who = tpl.patient === 'child' ? `my ${kid}` : tpl.patient === 'elder' ? (male ? 'my dad' : 'my mum') : `my ${kid}`; break;
    case 'worried_neighbor': who = tpl.patient === 'elder' ? (male ? 'the old man next door' : 'the lady next door') : 'my neighbour'; break;
    case 'witness': who = tpl.patient === 'child' ? (male ? 'a little boy' : 'a little girl') : male ? 'a man' : 'a woman'; break;
    case 'professional': who = male ? 'one of our staff' : 'one of our staff'; break;
    case 'confused_elderly': who = selfPatient ? 'I' : male ? 'my husband' : 'my wife'; break;
    default: who = male ? 'a man' : 'a woman';
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const name = rng.pick(FIRST_NAMES);
  return {
    he, him, his, He: cap(he), Him: cap(him), His: cap(his), kid: kid === 'husband' || kid === 'wife' ? (male ? 'husband' : 'wife') : kid, who, Who: cap(who),
    age: String(age), self: String(selfPatient || self ? 1 : 0), pname: name,
  };
}

export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export function makeCallerProfile(rng: Rng, tpl: Template, archetypeId: string, city: City, nodeId: number, forcedAccuracy?: CallerProfile['locationAccuracy'], vars?: Record<string, string>): CallerProfile {
  const a = ARCHETYPES[archetypeId];
  const biasW = tpl.accuracyBias ?? {};
  const acc = forcedAccuracy ?? (rng.weighted(Object.keys(a.accuracy) as CallerProfile['locationAccuracy'][], (k) => (a.accuracy[k] + (biasW[k] ?? 0)) ) as CallerProfile['locationAccuracy']);
  const idType = rng.weighted(Object.keys(a.idType) as CallerProfile['callerIdType'][], (k) => a.idType[k]) as CallerProfile['callerIdType'];
  const first = rng.pick(FIRST_NAMES), last = rng.pick(LAST_NAMES);
  const panic = Math.round(rng.range(a.panic[0], a.panic[1]));
  const coop = Math.round(rng.range(a.coop[0], a.coop[1]));
  void city; void nodeId; void vars;
  const stateLabel = panic > 70 ? 'Panicked' : panic > 45 ? 'Frightened' : a.frustration[0] > 30 ? 'Irritated' : a.id === 'prankster' ? 'Flippant' : panic < 15 ? 'Eerily calm' : 'Anxious';
  return {
    id: `caller-${Math.floor(rng.next() * 1e9)}`, name: `${first} ${last}`, age: rng.int(a.age[0], a.age[1]), archetype: a.id, personality: a.personality,
    emotionalState: stateLabel, panicLevel: panic, cooperationLevel: coop, speakingStyle: a.style,
    knownFacts: [...tpl.reported], unknownFacts: [...(tpl.blind ?? [])], relationshipToIncident: a.label, scenarioId: tpl.id,
    locationAccuracy: acc, callerIdType: idType, ambience: tpl.ambience, phone: `555-${String(rng.int(100, 999))}-${String(rng.int(1000, 9999))}`,
  };
}

// ── Variation helpers ───────────────────────────────────────────────────────
function pickVariant(call: Call, key: string, options: string[], rng: Rng): string {
  if (options.length === 1) return options[0];
  const used = call.usedLines[key] ?? 0;
  const free = options.map((_, i) => i).filter((i) => !(used & (1 << (i % 30))));
  const idx = free.length ? rng.pick(free) : rng.int(0, options.length - 1);
  call.usedLines[key] = free.length ? used | (1 << (idx % 30)) : 1 << (idx % 30);
  return options[idx];
}

const lcFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const HEDGES = ['I think ', "I'm not sure, but ", 'It looks like ', 'Maybe — ', 'I believe '];
const PANIC_PRE = ['Please — ', 'Oh god — ', 'Hurry, please! ', "I don't — I don't know — ", 'Oh my god, ', 'Please, please — '];
const ANGRY_PRE = ['Look, ', 'I already told you — ', 'Come on! ', 'Are you even listening? ', 'Seriously? '];
const ELDER_PRE = ['Oh, ', 'Let me think... ', 'Well, dear, ', 'Oh dear. ', 'Now, '];
const ELDER_POST = [' Is that what you wanted?', ' I hope that helps.', ' Sorry, dear.'];
const PRANK_POST = [' heh.', ' (laughing)', ' ...obviously.', ' lol'];
const CHILD_POST = [' ...I think.', ' *sniff*', ' I want my mummy.'];

/** apply the caller's emotional colouring to a base sentence */
export function flavor(text: string, call: Call, rng: Rng, opts: { unsure?: boolean; neutral?: boolean } = {}): string {
  let t = text;
  const m = call.mood, a = call.profile.archetype;
  if (opts.unsure) t = rng.pick(HEDGES) + lcFirst(t);
  if (opts.neutral) return t;
  if (m.panic > 68 && a !== 'calm_serious' && a !== 'professional' && rng.chance(0.55)) {
    t = rng.pick(PANIC_PRE) + lcFirst(t);
    if (rng.chance(0.25)) t = t.replace(/^(\w)/, '$1-$1');
  } else if (m.frustration > 52 && rng.chance(0.55)) t = rng.pick(ANGRY_PRE) + lcFirst(t);
  else if (a === 'confused_elderly' && rng.chance(0.45)) t = rng.pick(ELDER_PRE) + lcFirst(t) + (rng.chance(0.3) ? rng.pick(ELDER_POST) : '');
  else if (a === 'prankster' && m.cooperation < 40 && rng.chance(0.5)) t += rng.pick(PRANK_POST);
  else if (a === 'child_caller' && rng.chance(0.35)) t += rng.pick(CHILD_POST);
  else if (a === 'drunk_caller' && rng.chance(0.5)) t = t.replace(/s\b/g, 'sh').replace(/\.$/, '... hic.');
  else if (a === 'terse') t = t.replace(/\.$/, '').slice(0, 90);
  return t;
}

// ── Generic value phrasing ──────────────────────────────────────────────────
const DONT_KNOW = ["I don't know — I can't tell from here.", "I couldn't say, sorry. I didn't see.", "I... I'm not sure. I really don't know.", "No idea, sorry. I can't see that."];

function isSelf(vars: Record<string, string>) { return vars.self === '1'; }

function phrase(topic: Intent, truth: Record<string, FactVal>, vars: Record<string, string>): string[] {
  const t = truth;
  const n = (k: string) => (typeof t[k] === 'number' ? (t[k] as number) : 0);
  const self = isSelf(vars);
  switch (topic) {
    case 'injuries': {
      const v = n('injured');
      if (v <= 0) return ["No, nobody's hurt.", "Nobody's injured as far as I can see.", "No one's hurt, no."];
      if (self) return ["Yes, I'm hurt.", "I'm in a lot of pain, yes."];
      if (v === 1) return ['Yes — one person is hurt.', '{He}\'s hurt, yes.', 'One person is injured.'];
      return [`${v} people are hurt.`, `At least ${v} are injured.`, `There are ${v} people hurt.`];
    }
    case 'breathing': {
      const v = t.breathing;
      if (self) return v === 'labored' ? ["It's hard... to breathe. I'm wheezing.", 'I can... but it hurts. It\'s so tight.'] : v === false ? ['I can\'t... no.'] : ["Yes, I'm breathing — I'm talking to you, aren't I?"];
      if (v === 'labored') return ["{He}'s breathing, but it's really laboured and noisy.", '{He}\'s gasping and wheezing — {he} can barely get air.'];
      if (v === false) return ["I... no. I don't think {he}'s breathing!", "{He} isn't breathing! Please!"];
      return ["Yes, {he}'s breathing.", "Yeah, {he}'s breathing okay.", "{He}'s breathing normally, I think."];
    }
    case 'conscious': {
      const v = t.conscious;
      if (self) return v === 'drifting' ? ["I'm... here. Things are going a bit fuzzy."] : v === false ? ["I... can't..."] : ["Yes, I'm awake. I'm talking to you."];
      if (v === false) return ["No, {he} won't wake up. I shook {him}.", "{He}'s not responding at all.", "No — {he}'s out cold."];
      if (v === 'drifting') return ["Sort of — {he}'s awake, then {he} fades out and doesn't make sense.", "Kind of. {He} opens {his} eyes but {he}'s very confused."];
      return ["Yes, {he}'s awake and talking to me.", "Yeah, {he}'s conscious, {he} answers me.", "{He}'s awake. In pain, but awake."];
    }
    case 'age': return self ? ["I'm {age}."] : ["{He}'s about {age}.", "{He} is {age}.", "I think {he}'s {age}."];
    case 'people': {
      const v = n('people');
      if (v <= 0) return ['Nobody else, I think.', 'No one, as far as I know.'];
      if (v === 1) return ['Just one person.', "It's just one person that I can see."];
      return [`About ${v} people, I think.`, `There are ${v} of them.`, `I can count ${v} people.`];
    }
    case 'fire': {
      const f = t.fire === true, s = t.smoke === true;
      if (f && s) return ["Yes — flames and a lot of smoke.", "There's fire, and smoke pouring out."];
      if (f) return ["Flames, yes. I can see them.", "Yes, there's fire."];
      if (s) return ["There's smoke, but I can't see any flames.", "I can see smoke, no actual flames that I can tell."];
      return ["No fire or smoke, nothing like that.", "No, no fire."];
    }
    case 'hazard': {
      const v = t.hazard;
      if (typeof v === 'string') return [`There's ${v}.`, `I noticed ${v}.`, `Yes, there's ${v} — be careful.`];
      return ["Nothing else dangerous that I can see.", "No, nothing else."];
    }
    case 'weapon': {
      const v = t.weapon;
      if (typeof v === 'string') return [`I think I saw a ${v}.`, `There's a ${v}. I saw it.`];
      if (v === true) return ["Yes, there's a weapon."];
      return ["I didn't see any weapon.", "No weapons that I've seen.", "I don't think so, no."];
    }
    case 'suspect': {
      if (t.suspect === true) return [`It's ${t.suspect_desc ?? 'someone I don\'t know'}.`, `I can see ${t.suspect_desc ?? 'someone'}.`];
      return ["There's no one here now.", "Nobody's around that I can see."];
    }
    case 'vehicles': {
      const v = n('vehicles');
      return v <= 0 ? ['No vehicles involved.', "It's not a car thing."] : v === 1 ? ['One vehicle.', 'Just the one car.'] : [`${v} vehicles.`, `I can see ${v} vehicles.`, `${v} of them, all smashed up.`];
    }
    case 'trapped': {
      const v = n('trapped');
      return v <= 0 ? ["No, nobody's trapped, I think.", "Not that I know of."] : v === 1 ? ["Yes — one person is stuck and can't get out.", 'One person is trapped.'] : [`${v} people are trapped!`, `There are ${v} stuck inside.`];
    }
    case 'safe': return t.safe === false ? ["Not really — I'm still close to it.", "I... I'm not far from the danger. I'm trying to stay put."] : ["Yes, I'm safe, just very worried.", "I'm okay — I'm somewhere safe now."];
    default: return [];
  }
}

function heardFrom(call: Call, nodeId: number, label: string, source: HeardLocation['source'], reliability: HeardLocation['reliability']): Omit<HeardLocation, 'id' | 'at'> {
  void call;
  return { nodeId, label, source, reliability };
}

export interface DialogueEnv { rng: Rng; city: City; inc: Incident; call: Call; tpl: Template; now: number }
export type AidKind = 'cpr' | 'recovery' | 'pressure' | 'still' | 'lock' | 'evacuate';
export interface Reply { lines: PendingLine[]; mood: { panic?: number; base?: number; cooperation?: number; frustration?: number; trust?: number }; promise?: boolean; safety?: boolean; refused?: boolean; misunderstood?: boolean; hangup?: boolean; aid?: { kind: AidKind; fit: 'good' | 'bad' | 'neutral' } }

export function openingLines(env: DialogueEnv): PendingLine[] {
  const { inc, call, tpl, rng } = env;
  const v = inc.vars;
  const pool = v.self === '1' && tpl.selfOpen && tpl.selfOpen.length ? tpl.selfOpen : tpl.open;
  const base = fill(pickVariant(call, 'open', pool, rng), v);
  const facts: Record<string, FactVal> = {};
  for (const k of tpl.reported) if (k in inc.truth && !inc.knows.includes('~') ) facts[k] = inc.truth[k];
  if (call.isCallback) return [];
  const text = tpl.id === 'accidental_call' ? base : flavor(base, call, rng);
  return [{ at: 0, text, facts, unsure: tpl.unsure?.filter((k) => k in facts) }];
}

function refuses(call: Call, rng: Rng, intent: Intent): boolean {
  if (['calm', 'promise', 'stay', 'move', 'thanks', 'repeat', 'unknown'].includes(intent)) return false;
  // callers always give the dispatcher a chance: no refusals until a couple of questions in
  const total = Object.values(call.asked).reduce((a, b) => a + b, 0);
  if (total < 2) return false;
  const c = call.mood.cooperation;
  let p = c < 22 ? 0.55 : c < 34 ? 0.3 : c < 45 ? 0.1 : 0;
  if (intent === 'address' || intent === 'emergency') p *= 0.5;
  return rng.chance(p);
}
const REFUSALS = ["I'm not answering that right now!", "Why do you keep asking me things? Just send someone!", "I don't have time for twenty questions!", "No. Just... no. Send someone.", "I'm not telling you that!"];
const MISUNDERSTAND = ["Sorry? What was that, dear? The line's gone fuzzy.", "I didn't quite catch that. Could you say it again?", "Hm? I'm sorry, I'm a bit hard of hearing today.", "What was the question? I'm sorry.", "Pardon? I didn't understand."];
const UNKNOWN_Q = ["Sorry... I don't understand what you mean.", "What? I don't — could you ask that another way?", "I'm not sure what you're asking me.", "I don't know what you want me to say."];

export function replyTo(env: DialogueEnv, intent: Intent, rawText: string): Reply {
  const { rng, city, inc, call, tpl } = env;
  const v = inc.vars;
  const arch = ARCHETYPES[call.profile.archetype];
  const mood: Reply['mood'] = {};
  const r: Reply = { lines: [], mood };
  const polite = POLITE.test(rawText), rude = RUDE.test(rawText);
  if (polite) { mood.cooperation = (mood.cooperation ?? 0) + 3; mood.frustration = (mood.frustration ?? 0) - 2; }
  if (rude) { mood.cooperation = (mood.cooperation ?? 0) - 10; mood.frustration = (mood.frustration ?? 0) + 12; mood.panic = (mood.panic ?? 0) + 4; }
  const asked = call.asked[intent] ?? 0;
  const line = (text: string, extra: Partial<PendingLine> = {}, o: { neutral?: boolean; unsure?: boolean } = {}) => r.lines.push({ at: 0, text: flavor(fill(text, v), call, rng, o), ...extra });

  // Soft intents (guidance)
  if (intent === 'calm') {
    const hi = call.mood.panic > 60;
    line(pickVariant(call, 'calm', hi ? ["Okay... okay. I'm trying. I'm trying to breathe.", 'Yes. Yes, okay. Okay. Just... please stay here.', 'I— okay. Okay. I can do this.'] : ['Okay, thank you.', "Alright. I appreciate that.", 'Okay. That helps, thank you.'], rng), {}, { neutral: true });
    mood.base = -9; mood.panic = -(hi ? 11 : 5); mood.cooperation = 5; mood.trust = 3;
    return r;
  }
  if (intent === 'promise') {
    line(pickVariant(call, 'promise', ['Thank God. Please hurry.', "Okay. Okay, thank you. We'll be here.", "Oh, thank you. I'll watch for them.", "Right. Right, we'll wait. Please be quick."], rng), {}, { neutral: true });
    mood.base = -14; mood.panic = -12; mood.cooperation = 7; mood.trust = 4;
    r.promise = true; return r;
  }
  if (intent === 'stay') {
    line(pickVariant(call, 'stay', ["Okay, I'm not going anywhere.", "I'll stay on the line. Please don't go.", 'Yes. Yes, I will.'], rng), {}, { neutral: true });
    mood.panic = -4; mood.cooperation = 5; mood.trust = 3; return r;
  }
  if (intent.startsWith('inst_') || (intent === 'move' && aidVerdict(tpl, inc, 'evacuate').fit !== 'neutral')) {
    const kind = (intent === 'move' ? 'evacuate' : intent.slice(5)) as AidKind;
    const v = aidVerdict(tpl, inc, kind);
    r.aid = { kind, fit: v.fit };
    if (kind === 'evacuate' || kind === 'lock') r.safety = v.fit === 'good';
    line(v.text, v.fit === 'good' && kind === 'evacuate' ? { facts: { safe: true } } : {}, { neutral: true });
    if (v.fit === 'good') { mood.panic = -6; mood.base = -5; mood.cooperation = 5; mood.trust = 4; }
    else if (v.fit === 'bad') { mood.panic = 8; mood.trust = -6; mood.frustration = 4; }
    return r;
  }
  if (intent === 'move') {
    r.safety = true;
    const cat = tpl.category;
    let text: string;
    if (cat === 'medical' || tpl.id === 'collision_injury') text = "I'm not leaving {him} — we're somewhere safe, I just need help to get here.";
    else if (cat === 'fire' || tpl.id === 'gas_leak') text = pickVariant(call, 'move_fire', ["Okay, I'm getting out now. Okay — I'm outside.", "Yes, going outside right now. I'm out, I'm in the street.", "Okay. Okay. I'm moving away from the building."], rng);
    else text = pickVariant(call, 'move_pol', ["Okay, I'll stay back and keep away from it.", "Right. I'm going inside and locking the door.", "Alright, I'll keep my distance."], rng);
    line(text, cat === 'medical' ? {} : { facts: { safe: true } }, { neutral: true });
    mood.panic = -4; mood.cooperation = 4; mood.trust = 2; return r;
  }
  if (intent === 'thanks') {
    line(pickVariant(call, 'hello', ["Yes? Hello? Can you hear me?", 'Yes — I need help. Please.', 'I— yes, hello? Are you sending someone?'], rng));
    return r;
  }
  if (intent === 'repeat') {
    const cause = tpl.cause.length ? pickVariant(call, 'cause', tpl.cause, rng) : 'I need help.';
    line(`Sure, sorry. ${cause}`, { facts: {} }, { neutral: true });
    return r;
  }
  if (intent === 'unknown') {
    line(pickVariant(call, 'unk', UNKNOWN_Q, rng));
    mood.frustration = (mood.frustration ?? 0) + 6; mood.cooperation = (mood.cooperation ?? 0) - 2;
    return r;
  }

  // Misunderstanding (hard of hearing, children, drunk)
  if (rng.chance(arch.misunderstand) && call.misunderstood < 3 && intent !== 'emergency') {
    call.misunderstood++;
    r.misunderstood = true;
    line(pickVariant(call, 'misu', MISUNDERSTAND, rng), {}, { neutral: true });
    mood.frustration = (mood.frustration ?? 0) + 2;
    return r;
  }
  // Refusal
  if (refuses(call, rng, intent)) {
    r.refused = true;
    line(pickVariant(call, 'refuse', REFUSALS, rng), {}, { neutral: true });
    mood.frustration = (mood.frustration ?? 0) + 7;
    // prank/hostile callers may hang up
    if (call.mood.frustration + (mood.frustration ?? 0) > 85 && ['prankster', 'drunk_caller', 'angry_motorist'].includes(arch.id) && rng.chance(0.4)) { r.hangup = true; r.lines.push({ at: 0, text: '*click* — the caller hung up.', hangup: true }); }
    return r;
  }
  if (asked > 0) { mood.frustration = (mood.frustration ?? 0) + (asked >= 2 ? 6 : 3); mood.cooperation = (mood.cooperation ?? 0) - (asked >= 2 ? 4 : 1); }

  // Twist revealed by the right question
  if (tpl.twist && !inc.twistRevealed && tpl.twist.topics.includes(intent) && call.mood.cooperation + (mood.cooperation ?? 0) >= (tpl.twist.minCooperation ?? 0)) {
    const tw = tpl.twist;
    line(pickVariant(call, 'twist', tw.say, rng), { facts: tw.facts, twist: true }, { neutral: true });
    mood.panic = (mood.panic ?? 0) + (tw.requires && tw.requires.length ? 6 : -6);
    return r;
  }

  // Location topics
  if (intent === 'address' || intent === 'emergency') {
    if (intent === 'emergency' && asked === 0 && call.spokeFirst) {
      // fall through to cause + location prompt
      const c = pickVariant(call, 'cause', tpl.cause, rng);
      line(c, { facts: tpl.cause.length && 'cause' in inc.truth ? { cause: inc.truth.cause } : {} });
      r.lines.push(...addressLines(env, asked, v).map((l) => ({ ...l, at: 0 })));
      return r;
    }
    r.lines.push(...addressLines(env, asked, v));
    return r;
  }
  if (intent === 'landmark') { r.lines.push(...landmarkLines(env, asked)); return r; }
  if (intent === 'district') {
    const d = env.city.districtById[inc.district];
    const wrongD = env.city.districtById[call.locPlan.wrongDistrict];
    const lies = call.profile.locationAccuracy === 'wrong' && wrongD;
    const dd = lies ? wrongD : d;
    const node = env.city.nodes[env.city.nearestNode(dd.center.x, dd.center.y)];
    if (call.profile.locationAccuracy === 'unknown' && asked === 0) line("I don't know! It's all strange here, I don't recognise anything.", {}, { neutral: true });
    else line(pickVariant(call, 'dist', [`I think this is ${dd.name}.`, `It's ${dd.name}, I'm pretty sure.`, `We're in ${dd.name}.`], rng), { heard: [heardFrom(call, node.id, `Somewhere in ${dd.name}`, 'district', 'unsure')], facts: { district: dd.name } }, { unsure: lies ? false : false });
    return r;
  }
  if (intent === 'name') {
    line(pickVariant(call, 'name', [`It's ${call.profile.name}.`, `${call.profile.name}.`, `My name's ${call.profile.name}.`], rng), {}, { neutral: false });
    return r;
  }
  if (intent === 'callback') {
    line(pickVariant(call, 'cb', [`${call.profile.phone}.`, `It's ${call.profile.phone}, I think.`], rng), {}, {});
    return r;
  }

  // Fact topics
  const keys = TOPIC_FACTS[intent] ?? [];
  const blind = new Set([...(tpl.blind ?? [])]);
  const known = keys.filter((k) => k in inc.truth && !blind.has(k));
  if (intent === 'cause') {
    const c = pickVariant(call, 'cause', tpl.cause, rng);
    line(c, { facts: 'cause' in inc.truth ? { cause: fill(String(inc.truth.cause), v) } : {} });
    return r;
  }
  if (!known.length) {
    // not known to this caller
    let text = pickVariant(call, 'dk_' + intent, DONT_KNOW, rng);
    if (intent === 'weapon' || intent === 'suspect') text = pickVariant(call, 'dk2', ["I didn't see anyone like that.", "No, I haven't seen that.", "Not that I know of."], rng);
    line(text, {}, {});
    return r;
  }
  // repeated numeric answers from unreliable callers may change
  const facts: Record<string, FactVal> = {};
  let truthView = { ...inc.truth };
  let contradicted = false;
  if (asked > 0 && rng.chance(arch.contradict)) {
    for (const k of known) {
      const val = truthView[k];
      if (typeof val === 'number') { truthView = { ...truthView, [k]: Math.max(0, val + (rng.chance(0.5) ? 1 : -1)) }; contradicted = true; }
    }
  }
  const unsure: string[] = [];
  for (const k of known) {
    facts[k] = truthView[k];
    if (tpl.unsure?.includes(k) || contradicted || (call.mood.panic > 75 && typeof truthView[k] === 'number' && rng.chance(0.5))) unsure.push(k);
  }
  const options = custom(tpl, intent, v) ?? phrase(intent, truthView, v);
  const text = pickVariant(call, 'f_' + intent, options.map((o) => fill(o, v)), rng);
  // Remove invisible desc facts if suspect absent
  if (intent === 'suspect' && truthView.suspect !== true) delete facts.suspect_desc;
  line(text, { facts, unsure }, { unsure: unsure.length > 0 && !contradicted && !/\b(think|maybe|sure)\b/i.test(text) });
  return r;
}

function custom(tpl: Template, intent: Intent, v: Record<string, string>): string[] | null {
  const s = tpl.say?.[intent];
  void v;
  return s && s.length ? s : null;
}

function plan(env: DialogueEnv) { return env.call.locPlan; }

function addressLines(env: DialogueEnv, asked: number, v: Record<string, string>): PendingLine[] {
  const { call, inc, city, rng } = env;
  const acc = call.profile.locationAccuracy;
  const trueNode = inc.nodeId;
  const trueAddr = addressOf(city, trueNode);
  const L = (text: string, heard?: Omit<HeardLocation, 'id' | 'at'>, neutral = false): PendingLine => ({ at: 0, text: flavor(fill(text, v), call, rng, { neutral }), heard: heard ? [heard] : undefined });
  const p = plan(env);
  const lm = p.landmark ? city.landmarks.find((l) => l.id === p.landmark) : null;
  if (acc === 'exact') {
    const heard = heardFrom(call, trueNode, trueAddr, 'address', 'sure');
    if (asked === 0) return [L(pickVariant(call, 'addr', [`It's ${trueAddr}.`, `${trueAddr}. That's where I am.`, `We're at ${trueAddr}.`], rng), heard)];
    return [L(pickVariant(call, 'addr2', [`I said — ${trueAddr}.`, `${trueAddr}. Yes, that's right.`], rng), heard)];
  }
  if (acc === 'street') {
    const street = city.nodes[trueNode].addrStreet;
    const a = city.nodes[p.approx];
    if (asked === 0) return [L(pickVariant(call, 'addr', [`I'm on ${street}, but I can't see a house number.`, `It's ${street} — I don't know the number, sorry.`], rng), heardFrom(call, p.approx, `${a.addrNumber} ${a.addrStreet} (approx.)`, 'address', 'unsure'))];
    return [L(`Still just the street — ${street}. I really can't see a number.`, heardFrom(call, p.approx, `${a.addrNumber} ${a.addrStreet} (approx.)`, 'address', 'unsure'))];
  }
  if (acc === 'landmark') {
    if (lm) {
      const ln = city.nodes[lm.nodeId];
      if (asked === 0) return [L(pickVariant(call, 'addr', [`I don't know the street name. I'm near ${lm.name}.`, `I'm not sure of the address — it's close to ${lm.name}.`], rng), heardFrom(call, lm.nodeId, `Near ${lm.name} (${ln.addrNumber} ${ln.addrStreet})`, 'landmark', 'unsure'))];
    }
    return [L("I don't know the address. I'm sorry — I'm not from around here.", undefined)];
  }
  if (acc === 'wrong') {
    const w = city.nodes[p.wrong];
    const a = `${w.addrNumber} ${w.addrStreet}`;
    return [L(pickVariant(call, 'addr', [`It's ${a}. Yes, ${a}.`, `I think it's ${a}.`, `${a} — that's where we are.`], rng), heardFrom(call, p.wrong, a, 'address', 'unsure'))];
  }
  // unknown
  if (asked === 0) return [L(pickVariant(call, 'addr', ["I don't know where I am! I don't know the address!", "I don't know. I don't know the address, I'm sorry."], rng))];
  return [L("I still don't know! Please — can you find me from the phone?")];
}

function landmarkLines(env: DialogueEnv, asked: number): PendingLine[] {
  const { call, inc, city, rng } = env;
  const v = inc.vars;
  const acc = call.profile.locationAccuracy;
  const n = city.nodes[inc.nodeId];
  const trueAddr = addressOf(city, inc.nodeId);
  const p = call.locPlan;
  const lm = p.landmark ? city.landmarks.find((l) => l.id === p.landmark) : null;
  const L = (text: string, heard?: Array<Omit<HeardLocation, 'id' | 'at'>>): PendingLine => ({ at: 0, text: flavor(fill(text, v), call, rng), heard });
  const cross = heardFrom(call, inc.nodeId, `${trueAddr} at ${n.crossStreet}`, 'cross', 'sure');
  if (acc === 'exact' || acc === 'street') {
    const heard: Array<Omit<HeardLocation, 'id' | 'at'>> = [cross];
    const lmText = lm ? ` ${lm.name} is nearby.` : '';
    return [L(pickVariant(call, 'lm', [`It's right where ${n.addrStreet} meets ${n.crossStreet}.${lmText}`, `The corner of ${n.addrStreet} and ${n.crossStreet}.${lmText}`], rng), heard)];
  }
  if (acc === 'landmark') {
    if (asked === 0 && lm) return [L(`${lm.name}. I can see it from here, really close.`, [heardFrom(call, lm.nodeId, `Near ${lm.name}`, 'landmark', 'unsure')])];
    return [L(`Oh — there's a street sign... ${n.crossStreet}. And the other says ${n.addrStreet}.`, [cross])];
  }
  if (acc === 'wrong') {
    return [L(`Hold on — I'm looking at a sign. It says ${n.addrStreet} and ${n.crossStreet}. So it's actually around ${trueAddr}. Sorry, I got confused earlier!`, [heardFrom(call, inc.nodeId, `${trueAddr} (corrected by caller)`, 'cross', 'sure')])];
  }
  // unknown
  if (asked === 0) return [L(pickVariant(call, 'lm', ["There's a big sign... red and white. A car wash? I don't know the name.", 'There are shops and lots of traffic. I don\'t know the names.'], rng))];
  if (asked === 1 && lm) return [L(`Oh — I can see ${lm.name}!`, [heardFrom(call, lm.nodeId, `Near ${lm.name}`, 'landmark', 'unsure')])];
  return [L(`There's a street sign: ${n.addrStreet} and ${n.crossStreet}.`, [cross])];
}

// ── Plans & ALI ─────────────────────────────────────────────────────────────
export function makeLocPlan(rng: Rng, city: City, nodeId: number): Call['locPlan'] {
  const n = city.nodes[nodeId];
  // approximate node: same street some steps away
  let approx = nodeId;
  for (let tries = 0; tries < 6; tries++) {
    const step = rng.int(2, 4) * (rng.chance(0.5) ? 1 : -1);
    const horizontal = n.addrStreet === city.streetNames.rows[n.j];
    const ni = horizontal ? n.i + step : n.i, nj = horizontal ? n.j : n.j + step;
    if (ni >= 0 && nj >= 0 && ni < 41 && nj < 25 && !(nj >= 16 && n.j < 17 && nj > 16) ) { approx = city.nodeAt(ni, nj); if (approx !== nodeId) break; }
  }
  // wrong node: elsewhere in the same or neighbouring district at least 260 units away
  const same = city.nodesInDistrict[n.district].filter((id) => Math.hypot(city.nodes[id].x - n.x, city.nodes[id].y - n.y) > 260);
  const wrong = same.length ? rng.pick(same) : nodeId;
  const lm = nearestLandmark(city, nodeId, 280);
  const others = city.districts.filter((d) => d.id !== n.district);
  let near = others[0];
  let bd = Infinity;
  for (const d of others) { const dd = Math.hypot(d.center.x - n.x, d.center.y - n.y); if (dd < bd) { bd = dd; near = d; } }
  return { wrong, approx, landmark: lm ? lm.id : null, wrongDistrict: near.id };
}

/** Automatic caller location lookup. Returns null when not installed. */
export function aliLookup(env: DialogueEnv, level: number): { heard: Omit<HeardLocation, 'id' | 'at'>; message: string } | null {
  if (level <= 0) return null;
  const { call, inc, city, rng } = env;
  const type = call.profile.callerIdType;
  const n = city.nodes[inc.nodeId];
  if (level === 1) {
    const d = city.districtById[n.district];
    const nn = city.nodes[city.nearestNode(d.center.x, d.center.y)];
    return { heard: { nodeId: nn.id, label: `ALI: ${d.name} (district-level fix)`, source: 'ali', reliability: 'unsure' }, message: `Location lookup: district-level fix — ${d.name}.` };
  }
  // error radius in lattice steps
  const err = level === 2 ? (type === 'landline' ? 0 : type === 'voip' ? 3 : 2) : (type === 'landline' || type === 'mobile' ? 0 : type === 'voip' ? 2 : 1);
  if (err === 0) return { heard: { nodeId: inc.nodeId, label: `ALI: ${addressOf(city, inc.nodeId)}`, source: 'ali', reliability: 'sure' }, message: `Location lookup: ${addressOf(city, inc.nodeId)} (${type === 'landline' ? 'registered landline' : 'strong fix'}).` };
  const i = Math.max(0, Math.min(40, n.i + rng.int(-err, err))), j = Math.max(0, Math.min(24, n.j + rng.int(-err, err)));
  let id = city.nodeAt(i, j);
  if ((j >= 17) !== (n.j >= 17)) id = inc.nodeId;
  return { heard: { nodeId: id, label: `ALI: ~${addressOf(city, id)} (±${err * 55} m)`, source: 'ali', reliability: 'unsure' }, message: `Location lookup: approximate fix near ${addressOf(city, id)} (±${err * 55} m, ${type}).` };
}

export function verifyReply(env: DialogueEnv, candidate: number): { text: string; ok: boolean | null } {
  const { city, inc, call, rng } = env;
  const v = inc.vars;
  const a = city.nodes[candidate], t = city.nodes[inc.nodeId];
  const d = Math.hypot(a.x - t.x, a.y - t.y);
  if (call.profile.locationAccuracy === 'unknown' && d > 0) return { text: flavor("I... I don't know. I can't tell you if that's right, I'm sorry!", call, rng), ok: null };
  if (d <= 75) return { text: flavor(fill(pickVariant(call, 'ver_ok', ['Yes! Yes, that sounds right.', "That's right, that's where we are.", 'Yes — you got it.'], rng), v), call, rng), ok: true };
  if (d <= 190) return { text: flavor("That's close but... not quite. It's a little further along, I think.", call, rng), ok: false };
  return { text: flavor(fill(pickVariant(call, 'ver_no', ["No, that's not right. That's nowhere near us.", "No, that's wrong — we're not there at all.", 'No no no — not there!'], rng), v), call, rng), ok: false };
}

// ── Spontaneous lines ───────────────────────────────────────────────────────
export type SpontKind = 'escalated' | 'arrived' | 'dispatched' | 'waiting' | 'nothing_found' | 'resolved' | 'broken_promise' | 'hold' | 'callback';
export function spontaneous(env: DialogueEnv, kind: SpontKind, extra = ''): string {
  const { tpl, rng, call, inc } = env;
  const v = inc.vars;
  const cat = tpl.category;
  const pick = (a: string[]) => fill(pickVariant(call, 'sp_' + kind, a, rng), v);
  switch (kind) {
    case 'escalated': {
      const esc = tpl.escalate?.[Math.max(0, inc.stage - 1)];
      if (esc?.say?.length) return flavor(pick(esc.say), call, rng);
      return flavor(pick(cat === 'fire' ? ["It's getting worse! It's spreading!", "It's bigger now — much bigger!"] : cat === 'medical' ? ["{He}'s getting worse! Please hurry!", "Something's changed — {he} looks worse!"] : ["It's getting worse out here!", "Things just got a lot worse!"]), call, rng);
    }
    case 'arrived': return flavor(pick(["I can see them! They're here — thank you!", "They've arrived! I can see the lights!", "They're here. Thank God they're here."]), call, rng, { neutral: true });
    case 'dispatched': return flavor(pick(['Thank you. I can hear sirens, I think.', 'Okay, I hear them! They\'re coming, aren\'t they?', "That's good. Please tell them to be quick."]), call, rng, { neutral: true });
    case 'waiting': return flavor(pick(['Hello? Are you still there? How long will they be?', "Where are they? It feels like forever!", "Is anyone coming? You said help was coming!", 'Still nobody here. Please, how long?']), call, rng);
    case 'nothing_found': return flavor(pick(["The officers are here but they're in the wrong place — this isn't where we are!", 'They\'re looking at the wrong building! We\'re not here!', "I can see someone driving past slowly. They don't know where we are!"]), call, rng);
    case 'resolved': return flavor(pick(['Thank you so much. Thank you.', "They've sorted it out. I can't thank you enough.", 'It\'s over, I think. Thank you for staying with me.']), call, rng, { neutral: true });
    case 'broken_promise': return flavor(pick(['You said help was coming — where are they?!', 'It has been so long! You promised someone was coming!', "You told me they were on their way. Nobody's here!"]), call, rng);
    case 'hold': return flavor(pick(['Hello?? Are you still there?', "Please don't leave me on hold!", 'Hello? Hello?']), call, rng);
    case 'callback': return extra;
  }
}

// ── Pre-arrival instructions ─────────────────────────────────────────────────
// Game simplification of widely published bystander guidance; not training material.
const BLEEDING = new Set(['collision_injury', 'collision_trapped', 'collision_multi', 'workplace_injury', 'industrial_accident', 'building_collapse', 'boat_fire', 'robbery', 'domestic_disturbance', 'fireworks']);
const KEEP_STILL = new Set(['fall_elderly', 'collision_injury', 'collision_trapped', 'collision_multi', 'sports_injury', 'workplace_injury', 'remote_medical', 'building_collapse']);
const HIDE = new Set(['burglary_progress', 'domestic_disturbance', 'robbery', 'refuses_explain', 'strange_noise', 'fireworks', 'suspicious_activity']);
const GET_OUT = new Set(['kitchen_fire', 'apartment_fire', 'gas_leak', 'carbon_monoxide', 'electrical_fire', 'smell_burning', 'warehouse_smoke', 'building_collapse', 'power_line_down']);

export function aidVerdict(tpl: Template, inc: Incident, kind: AidKind): { fit: 'good' | 'bad' | 'neutral'; text: string } {
  const t = inc.truth, v = inc.vars;
  const say = (x: string) => fill(x, v);
  const hasPatient = typeof t.injured === 'number' ? t.injured > 0 : t.conscious !== undefined;
  const injured = typeof t.injured === 'number' && t.injured > 0;
  const fireLike = GET_OUT.has(tpl.id) || tpl.category === 'fire' && tpl.id !== 'animal_rescue' && tpl.id !== 'elevator_rescue' && tpl.id !== 'flooded_basement';
  switch (kind) {
    case 'cpr':
      if (t.breathing === false) return { fit: 'good', text: say("Okay — okay, I'm pushing. One, two, three, four... it's so hard. Please keep talking to me, don't go.") };
      if (t.conscious === false || t.conscious === 'drifting') return { fit: 'bad', text: say("But {he}'s breathing! {He}'s making noises — are you sure I should push on {his} chest?") };
      if (hasPatient && t.conscious !== undefined) return { fit: 'bad', text: say("CPR?! {He}'s awake, {he}'s talking to me! Why would I do that?") };
      return { fit: 'neutral', text: "On who? Nobody here needs that." };
    case 'recovery':
      if (t.breathing === false) return { fit: 'bad', text: say("I've rolled {him} over but {he}'s not breathing! {He}'s not breathing at all!") };
      if (t.conscious === false || t.conscious === 'drifting') return { fit: 'good', text: say("Okay, I've got {him} on {his} side. {He}'s breathing — kind of snoring.") };
      return { fit: 'neutral', text: say("{He}'s awake though. Should I still?") };
    case 'pressure':
      if (injured && BLEEDING.has(tpl.id)) return { fit: 'good', text: say("I'm pressing a towel on it. There's so much blood... okay, okay, I think it's slowing down.") };
      return { fit: 'neutral', text: "There isn't really any bleeding that I can see." };
    case 'still':
      if (KEEP_STILL.has(tpl.id) && injured) return { fit: 'good', text: say("Okay, I won't move {him}. I've put a coat over {him} to keep {him} warm.") };
      if (fireLike) return { fit: 'bad', text: "Stay here?! It's filling up with smoke — we have to get out!" };
      return { fit: 'neutral', text: "Okay... nobody's moving. Is that what you want?" };
    case 'lock':
      if (HIDE.has(tpl.id) && t.suspect !== false) return { fit: 'good', text: "Okay. I'm in the bathroom, the door's locked. I'm being really quiet." };
      if (fireLike) return { fit: 'bad', text: `Lock myself in? There's ${typeof t.hazard === 'string' ? t.hazard : 'fire'} — shouldn't I get out instead?!` };
      return { fit: 'neutral', text: "Lock myself in? Why — is there someone coming?" };
    case 'evacuate':
      if (fireLike) return { fit: 'good', text: "Okay, everyone out — I'm shutting the door behind us. We're outside now, we're on the pavement." };
      if (tpl.category === 'medical' && hasPatient) return { fit: 'neutral', text: say("I'm not leaving {him} — we're safe here, I just need help to come.") };
      return { fit: 'neutral', text: "Get out of where? We're not in any danger here." };
  }
}

// ── Knowledge sheet for the AI dialogue layer ────────────────────────────────
/** What this caller can truthfully say, topic by topic — only facts their character could know. */
export function describeKnowledge(inc: Incident, tpl: Template, call: Call, city: City): { knows: Record<string, string>; doesNotKnow: string[]; location: string } {
  const blind = new Set(tpl.blind ?? []);
  const knows: Record<string, string> = {};
  const doesNotKnow: string[] = [];
  for (const [topic, keys] of Object.entries(TOPIC_FACTS)) {
    if (!keys || topic === 'cause') continue;
    const k = keys.filter((x) => x in inc.truth && !blind.has(x));
    if (!k.length) { doesNotKnow.push(topic); continue; }
    const opts = phrase(topic as Intent, inc.truth, inc.vars);
    if (opts.length) knows[topic] = fill(opts[0], inc.vars) + (tpl.unsure?.some((u) => k.includes(u)) ? ' (not certain)' : '');
  }
  if ('cause' in inc.truth) knows.cause = fill(String(inc.truth.cause), inc.vars);
  const n = city.nodes[inc.nodeId];
  const p = call.locPlan;
  const lm = p.landmark ? city.landmarks.find((l) => l.id === p.landmark) : null;
  const w = city.nodes[p.wrong];
  const location = {
    exact: `You know the exact address: ${n.addrNumber} ${n.addrStreet}, near ${n.crossStreet}.`,
    street: `You only know the street (${n.addrStreet}); you cannot see a house number. The cross street is ${n.crossStreet}.`,
    landmark: lm ? `You don't know the street name, but you can see ${lm.name}.` : `You don't know the address.`,
    wrong: `You believe the address is ${w.addrNumber} ${w.addrStreet}, but you are mistaken; a nearby sign actually reads ${n.addrStreet} and ${n.crossStreet}.`,
    unknown: `You do not know where you are${lm ? `; if pressed you might notice ${lm.name}` : ''}.`,
  }[call.profile.locationAccuracy];
  return { knows, doesNotKnow, location };
}
