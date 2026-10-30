// Caller voices: every caller gets a speech profile (verbal tic, how they address the dispatcher,
// formality, slang, a catchphrase, personal tangents) and every line they say is passed through it.
// Archetype line banks replace the generic replies for the soft moments of a call, so a confused
// pensioner, a furious driver and a security guard no longer sound alike.
import type { Rng } from './rng';
import type { Call, CallerVoice } from './types';

interface VoiceDef {
  tics: string[]; address: Array<string | null>; catches: string[]; tangents: string[];
  formal: number; slang: number; caps: number; stutter: number; trail: number; short: number;
}
const V = (d: Partial<VoiceDef>): VoiceDef => ({ tics: [], address: [null], catches: [], tangents: [], formal: 0, slang: 0, caps: 0, stutter: 0, trail: 0, short: 0, ...d });

const VOICES: Record<string, VoiceDef> = {
  panicked_parent: V({ tics: ['oh god', 'please'], address: [null, null, 'please'], catches: ['Oh my god', 'Oh please, no', 'Jesus Christ'], tangents: ['{He} was fine at breakfast.', 'I only turned my back for a second.', "I keep thinking this is my fault."], stutter: 0.6, caps: 0.45, trail: 0.2 }),
  confused_elderly: V({ tics: ['you see', 'now', 'let me think'], address: ['dear', 'love', 'young man', 'sweetheart', null], catches: ['Oh, goodness me', 'Heavens above', 'Oh my word'], tangents: ['My Harold always used to handle this sort of thing.', "I've lived on this street for forty-one years, you know.", "I think I've left the kettle on.", 'My daughter keeps telling me to get one of those alarm buttons.'], formal: 0.55, trail: 0.7 }),
  angry_motorist: V({ tics: ['look', 'honestly'], address: ['mate', 'pal', 'buddy', null], catches: ['Unbelievable', 'For crying out loud', 'Are you kidding me', 'Oh, brilliant'], tangents: ["I'm going to be late for work because of this.", 'Nobody in this city can drive.', "And I've only just had the car serviced."], caps: 0.7, slang: 0.5, short: 0.35 }),
  calm_serious: V({ address: [null, null, 'dispatch'], tangents: ["I've already moved everyone back.", "I'll stay on the line as long as you need."], formal: 0.75, short: 0.5 }),
  prankster: V({ tics: ['like', 'literally', 'bro'], address: ['dude', 'bro', 'man', null], catches: ['No way', 'Bruh', 'This is mad'], tangents: ["My mate's filming this, by the way.", 'Is this being recorded? Sick.', "Okay, okay, I'm being serious now."], slang: 0.95, caps: 0.2 }),
  witness: V({ tics: ['like', 'I mean', 'right'], address: [null, null, 'sir', 'ma’am'], catches: ['Oh my god', 'Holy—'], tangents: ['I was literally just walking the dog.', "I'm on my way home from the gym.", "I've never called 911 before."], slang: 0.35, trail: 0.15 }),
  injured_self: V({ tics: ['ugh'], address: [null], catches: ['Oh, that hurts'], tangents: ["I should've just stayed home today.", "Sorry, I'm... I'm not making much sense."], trail: 0.65, short: 0.55, stutter: 0.2 }),
  child_caller: V({ tics: ['um', 'um, um'], address: ['mister', 'miss', null, null], catches: ['I’m scared'], tangents: ['Mummy said only call this number if it’s really, really bad.', 'My teacher said you help people.', 'Our cat is hiding under the bed.'], short: 0.7, trail: 0.3 }),
  professional: V({ address: [null, 'dispatch', 'control'], tangents: ["I'll log this on our incident report as well.", "Per our procedure I've cleared the area.", 'I can meet your crews at the main entrance.'], formal: 0.85, short: 0.45 }),
  worried_neighbor: V({ tics: ['honestly', 'I mean', 'you know'], address: ['love', 'dear', null, null], catches: ['Oh, I knew something wasn’t right', 'Oh, the poor thing'], tangents: ["I wouldn't normally bother you lot.", 'I always keep an eye on the place.', "I hope I'm not overreacting.", 'Their car has been in the drive all day.'], trail: 0.35 }),
  drunk_caller: V({ tics: ['mate', 'yeah?', 'right'], address: ['mate', 'my friend', 'boss', 'chief'], catches: ['Oh, here we go', 'Whoa whoa whoa'], tangents: ["I've only had a couple, honest.", "Lovely night for it, isn't it?", "You've got a nice voice, you know that?"], slang: 0.8, trail: 0.4 }),
  shopkeeper: V({ tics: ['honestly', 'look'], address: [null, 'look'], catches: ['Every single week', 'Not again'], tangents: ["That's the third time this month.", "I've got customers waiting here.", "I've been running this shop for twenty years."], short: 0.3 }),
  terse: V({ address: [null], tangents: [], short: 1, trail: 0.4 }),
};

/** roll a speech profile for a new caller */
export function makeVoice(rng: Rng, archetype: string): CallerVoice {
  const d = VOICES[archetype] ?? V({});
  const roll = (p: number) => rng.chance(p);
  const formal = roll(d.formal);
  return {
    tic: d.tics.length && roll(0.75) ? rng.pick(d.tics) : null,
    address: rng.pick(d.address),
    catchphrase: d.catches.length && roll(0.8) ? rng.pick(d.catches) : null,
    tangents: rng.shuffle(d.tangents).slice(0, 2),
    formal, slang: !formal && roll(d.slang), caps: roll(d.caps), stutter: roll(d.stutter), trail: roll(d.trail), short: roll(d.short),
  };
}

/** how the voice is described to the AI dialogue model */
export function describeVoice(v: CallerVoice | undefined): string {
  if (!v) return '';
  const parts: string[] = [];
  if (v.formal) parts.push('speaks formally, full sentences, no contractions');
  if (v.slang) parts.push('casual slang (yeah, gonna, kinda)');
  if (v.short) parts.push('very short replies');
  if (v.trail) parts.push('trails off mid-sentence...');
  if (v.stutter) parts.push('stammers when scared');
  if (v.caps) parts.push('raises their voice on key words');
  if (v.tic) parts.push(`verbal tic: "${v.tic}"`);
  if (v.address) parts.push(`calls the dispatcher "${v.address}"`);
  if (v.catchphrase) parts.push(`catchphrase (rarely): "${v.catchphrase}"`);
  return parts.join('; ');
}

// ── text transforms ─────────────────────────────────────────────────────────
const CONTRACT: Array<[RegExp, string]> = [[/\bI'm\b/g, 'I am'], [/\bdon't\b/g, 'do not'], [/\bDon't\b/g, 'Do not'], [/\bcan't\b/g, 'cannot'], [/\bwon't\b/g, 'will not'], [/\bit's\b/g, 'it is'], [/\bIt's\b/g, 'It is'], [/\bthat's\b/g, 'that is'], [/\bThat's\b/g, 'That is'], [/\bisn't\b/g, 'is not'], [/\bdoesn't\b/g, 'does not'], [/\bI've\b/g, 'I have'], [/\bthere's\b/g, 'there is'], [/\bThere's\b/g, 'There is'], [/\bwe're\b/g, 'we are'], [/\bWe're\b/g, 'We are'], [/\bthey're\b/g, 'they are'], [/\bThey're\b/g, 'They are']];
const SLANG: Array<[RegExp, string]> = [[/\bYes\b/g, 'Yeah'], [/\byes\b/g, 'yeah'], [/\bgoing to\b/g, 'gonna'], [/\bwant to\b/g, 'wanna'], [/\bkind of\b/g, 'kinda'], [/\bsort of\b/g, 'sorta'], [/\bdon't know\b/g, 'dunno'], [/\bbecause\b/g, "'cause"], [/\bOkay\b/g, 'Alright']];
const LOUD = /\b(not|now|please|hurry|breathing|blood|fire|gun|knife|help|everywhere|dying|dead|hurt|nobody|never|still|right now|out)\b/i;

const firstSentence = (t: string) => { const m = /^(.+?[.!?])(\s|$)/.exec(t); return m && m[1].length >= 12 ? m[1] : t; };

/** pass one caller line through the caller's voice. Facts, numbers and addresses are never altered. */
export function speak(text: string, call: Call, rng: Rng, fillVars: (s: string) => string): string {
  const v = call.profile.voice;
  if (!v || !text || /^[([]/.test(text.trim())) return text;
  let t = text;
  const m = call.mood;
  if (v.formal) for (const [re, s] of CONTRACT) t = t.replace(re, s);
  else if (v.slang) for (const [re, s] of SLANG) t = t.replace(re, s);
  if (v.short && t.length > 80) t = firstSentence(t);
  if (v.tic && rng.chance(0.28)) {
    const comma = t.indexOf(', ');
    const lc = /^I\b/.test(t) ? t : `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
    t = comma > 4 && comma < 60 && rng.chance(0.5) ? `${t.slice(0, comma)}, ${v.tic},${t.slice(comma + 1)}` : `${v.tic.charAt(0).toUpperCase()}${v.tic.slice(1)}, ${lc}`;
  }
  if (v.address && !/[*)]$|\.\.\.$/.test(t) && rng.chance(0.2)) t = /[.!?]$/.test(t) ? `${t.slice(0, -1)}, ${v.address}${t.slice(-1)}` : `${t}, ${v.address}.`;
  if ((v.caps && (m.panic > 45 || m.frustration > 35)) || m.panic > 82 || m.frustration > 70) {
    if (rng.chance(0.4)) t = t.replace(LOUD, (w) => w.toUpperCase());
  }
  if (v.stutter && m.panic > 50 && rng.chance(0.35)) t = t.replace(/^([A-Za-z]{1,3})\b/, (w) => `${w}— ${w}`);
  if (v.trail && rng.chance(0.3)) t = t.replace(/[.!]$/, '...');
  // a personal tangent once or twice a call, when they are calm enough to ramble
  const told = call.usedLines.__tangent ?? 0;
  if (v.tangents.length > told && m.panic < 72 && rng.chance(0.14)) { t += ' ' + fillVars(v.tangents[told]); call.usedLines.__tangent = told + 1; }
  const caught = call.usedLines.__catch ?? 0;
  if (v.catchphrase && caught < 2 && (m.panic > 55 || m.frustration > 45) && rng.chance(0.13)) { t = `${v.catchphrase}! ${t}`; call.usedLines.__catch = caught + 1; }
  return t;
}

// ── archetype line banks for the soft moments of a call ─────────────────────
export type SoftKind = 'calm' | 'calm_hi' | 'promise' | 'stay' | 'dispatched' | 'sirens' | 'arrived' | 'resolved' | 'waiting' | 'broken_promise' | 'hold' | 'hello' | 'unknown' | 'misunderstand';
const BANK: Record<string, Partial<Record<SoftKind, string[]>>> = {
  panicked_parent: {
    calm_hi: ["I can't— okay. Okay. I'm breathing. Just don't hang up on me.", "I'm trying, I'm trying, I just— {he}'s my baby!"],
    promise: ['Please make them hurry. Please.', "How long? Minutes? I can't do minutes!"],
    dispatched: ["Okay. Okay. Tell them the door's open.", 'Please tell them to drive fast.'],
    arrived: ["They're here! They're running in — oh thank God!", "I can see them! Over here! OVER HERE!"],
    resolved: ["Thank you. I don't— I can't even— thank you.", "{He}'s okay? Oh my god. Thank you."],
    waiting: ["Where ARE they? It's been forever!", "Why is nobody here yet?!"],
    hold: ["Don't put me on hold! Not now!", 'Hello?! HELLO?!'],
  },
  confused_elderly: {
    calm: ['Thank you, dear. You have a lovely calm voice.', "Alright. I'll sit down a moment."],
    promise: ["Oh, that's kind of them. Should I put the kettle on?", 'Right you are. I shall wait by the door.'],
    stay: ["I'm not going anywhere, dear. These knees won't let me.", "Yes, yes. I'm still here."],
    dispatched: ["Oh, how kind. I'll leave the porch light on for them.", "Do they know which house? It's the one with the blue door."],
    sirens: ['Oh — is that them? That noise? I can hear a siren, dear.', "There's a siren coming. Is that ours?"],
    arrived: ['There they are, bless them. Such young men.', "They're here, dear. They're coming up the path."],
    resolved: ["Thank you so much, dear. I'll tell my daughter how kind you were.", 'Bless you. Bless you all.'],
    waiting: ["It's been ever so long. Have they got lost?", "I don't want to be a nuisance, but nobody's come."],
    hold: ['Hello? Dear? Have you gone?', "Is anyone there? I can't hear anything."],
    hello: ['Hello? Is this the emergency line? I hope I dialled right.'],
    misunderstand: ["Sorry, dear? You'll have to speak up, my hearing aid is playing up.", 'Pardon? I didn’t quite catch that, love.'],
  },
  angry_motorist: {
    calm: ["Yeah, yeah. I'm calm. I'm perfectly calm.", "Fine. Fine. What else do you need?"],
    calm_hi: ["Don't tell me to calm down! Just get someone here!"],
    promise: ['They better be quick.', 'About time.'],
    stay: ["Fine. Not like I'm going anywhere, my car's wrecked.", "I'm not hanging up. Obviously."],
    dispatched: ["Right. And how long's that going to take?", 'Good. Tell them to bring a tow truck while they are at it.'],
    arrived: ["Finally. They're here.", 'Took their time.'],
    resolved: ["Right. Well. Thanks, I suppose.", 'Cheers. Sorted.'],
    waiting: ["This is ridiculous. Where are they?", "I could have walked to the station by now!"],
    broken_promise: ["You said they were coming! Ten minutes ago!", 'Are you actually sending anyone or not?!'],
    hold: ["Oh, you're kidding me — HOLD?!"],
  },
  calm_serious: {
    calm: ["I'm fine. Go ahead.", 'Understood.'],
    promise: ['Understood. I will wait.', 'Thank you.'],
    stay: ['I will stay on the line.'],
    dispatched: ['Understood. I will flag them down.', 'Good. I will keep people clear.'],
    sirens: ['I can hear them approaching.', 'Sirens. They are close.'],
    arrived: ['Your units are here.', 'They have arrived. Thank you.'],
    resolved: ['Thank you for your help.'],
    waiting: ['They are not here yet. Is there a delay?'],
  },
  prankster: {
    calm: ["Chill, chill. I'm calm. Mostly.", 'Bro, I am so calm right now.'],
    promise: ["Wait, they're actually coming? Like, for real?", "Okay that's kinda sick actually."],
    stay: ["Yeah I'm not going anywhere, this is wild.", 'Sure, sure.'],
    dispatched: ["No way. Okay. Okay, this is serious now, isn't it.", "Oh man. Okay."],
    arrived: ["They're here — okay, okay, I'm not laughing anymore.", 'Cops are here. Bro.'],
    resolved: ['Okay. Yeah. Thanks. Sorry about earlier.'],
    hold: ['Hold music? Lame.'],
  },
  witness: {
    promise: ['Okay. I can wave them down if you want.', 'Thank you. I’ll keep watching.'],
    dispatched: ["Okay, I'll stand on the corner so they see me.", "I'll flag them down."],
    arrived: ["They're here — I'm waving at them!", 'Okay, I see them now, they just pulled up.'],
    resolved: ['Okay. Wow. Thanks.', 'Thanks for staying on the line.'],
  },
  injured_self: {
    calm: ["Okay... okay. Breathing.", "I'll try."],
    promise: ['Thank... you.', "Okay. Please... hurry."],
    stay: ["Not... going anywhere."],
    arrived: ['I can hear them... at the door.', "They're... here."],
    resolved: ['Thank you... so much.'],
    waiting: ['Are they... nearly here?'],
  },
  child_caller: {
    calm: ['Okay. I can be brave.', 'Okay... I stopped crying.'],
    promise: ['Are they coming really fast?', 'Okay. Will they have the lights on?'],
    stay: ["I'm not going to hang up. Promise.", 'Okay. I’m holding the phone really tight.'],
    dispatched: ['Mummy said the ambulance has a siren.', "Okay. I'll wait by the window."],
    sirens: ["I can hear the nee-naw! Is that them?", "There's a siren! It's getting louder!"],
    arrived: ["They're here! There's lots of people!", 'The people are here. Can I hang up now?'],
    resolved: ['Thank you. You were really nice.'],
    hold: ['Hello? Hello? Did you go away?'],
    misunderstand: ["Um... what does that mean?", "I don't know that word.", 'What? Say it again, please.'],
  },
  professional: {
    calm: ['Understood.', 'Copy that.'],
    promise: ['Copy. We will meet your units at the entrance.', 'Understood. ETA noted.'],
    stay: ["I'll remain on the line."],
    dispatched: ['Copy. I have staff at the gate to guide them in.', 'Understood. Access is clear.'],
    sirens: ['Units approaching, I can hear them.', 'I have visual on lights to the north.'],
    arrived: ['Your units are on site. Handing over.', 'Crews have arrived; I am escorting them in.'],
    resolved: ['Thank you, dispatch.', 'Appreciated. Closing out on our end.'],
    waiting: ['Can you confirm an ETA?', 'No units on site yet. Please advise.'],
    hold: ['Standing by.'],
  },
  worried_neighbor: {
    promise: ["Oh, thank you. I'll pop out and meet them.", "Right. I'll put the outside light on."],
    stay: ["Of course, love. I'm right here."],
    dispatched: ["Oh, good. I'll wait at the gate so they know which house.", 'Thank you. I do hope it’s nothing serious.'],
    arrived: ["Oh, they're here. I'll show them in.", "They've arrived, love. Thank you so much."],
    resolved: ["Thank you. I'll sleep better tonight.", "You've been ever so kind."],
    waiting: ["Sorry to fuss, but it's been a while, hasn't it?"],
  },
  drunk_caller: {
    calm: ["I AM calm. I'm the calmest guy here, mate.", 'Calm. Yep. Calm calm calm.'],
    promise: ['Legend. You are a legend.', 'Nice one, chief.'],
    stay: ["Not going anywhere. Can't really walk, to be honest."],
    dispatched: ["Brilliant. I'll get the kettle— no, wait.", 'Sweet. Sweet sweet sweet.'],
    arrived: ["They're here! Lads! The lads are here!", 'Oh, flashing lights. Pretty.'],
    resolved: ["You're a star, you know that?"],
    hold: ['Helloooo?'],
    misunderstand: ["Wha'? Say that again, mate, it's loud in here.", 'Sorry, what? Lost you there.'],
  },
  shopkeeper: {
    promise: ['Good. Tell them to come round the front.', "Fine. I'll keep the door open."],
    dispatched: ["Right. I'll be at the counter.", "Okay. I'm closing up until they get here."],
    arrived: ['Police are here. Finally.', "They're here, I'll let them in."],
    resolved: ['Thanks. Back to work, then.', 'Appreciated.'],
    waiting: ["How long is this going to take? I've got a shop to run."],
  },
  terse: {
    calm: ['...Okay.', 'Fine.'],
    promise: ['Hurry.', '...Thanks.'],
    stay: ['Yeah.'],
    dispatched: ['Okay.', 'Quietly. Please.'],
    arrived: ["They're here.", '...They came.'],
    resolved: ['Thank you.'],
  },
};

/** an archetype's own line for a soft moment, if it has one (and usually prefer it) */
export function bankLine(archetype: string, kind: SoftKind, rng: Rng): string | null {
  const opts = BANK[archetype]?.[kind];
  if (!opts?.length || !rng.chance(0.75)) return null;
  return rng.pick(opts);
}
