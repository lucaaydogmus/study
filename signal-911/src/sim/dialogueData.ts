import type { Capability } from './types';

export type Personality = 'calm' | 'panicked' | 'confused' | 'angry' | 'uncooperative' | 'uncertain' | 'distracted';
export type Twist = 'none' | 'wrong_location' | 'milder' | 'worse' | 'disconnect';

export interface Question { key: string; text: string; group: 'Location' | 'Situation' | 'Safety' | 'Caller'; once?: boolean }
/** What a caller says, what the dispatcher writes down, and how the classification changes. */
export interface Answer {
  say: string; note: string;
  /** Capabilities this answer establishes (each group is set to exactly this many). */
  caps?: Capability[];
  /** Capability groups this answer settles even when it names none (i.e. removes them). */
  settles?: Capability[];
  sev?: number;
}
export interface VarScript { hint: Capability[]; describe: Answer; answers: Record<string, Answer> }

export interface PersonalityDef {
  label: string; patience: number; delay: number; resist: number; reliability: number; volunteer: number;
  pre: string[]; deflect: string[]; calmed: string[]; hangup: string[]; weight: number;
}

export const PERSONALITIES: Record<Personality, PersonalityDef> = {
  calm: { label: 'Calm', patience: 7, delay: 3, resist: 0, reliability: 1, volunteer: 0.5, weight: 3,
    pre: [''], deflect: [], calmed: ['Thank you. I\'m okay, ask me anything.'], hangup: ['I\'ll have to go and check on them. Please hurry.'] },
  panicked: { label: 'Panicked', patience: 5, delay: 2, resist: 0.45, reliability: 0.7, volunteer: 0, weight: 2,
    pre: ['Please hurry! ', 'Oh god, ', 'Hurry, please! '], deflect: ['I can\'t think, just send someone!', 'I don\'t know, please just hurry!'],
    calmed: ['Okay… okay. I\'m breathing. Ask me.'], hangup: ['I can\'t do this, I have to go to them!'] },
  confused: { label: 'Confused', patience: 6, delay: 5, resist: 0.3, reliability: 0.5, volunteer: 0, weight: 1.5,
    pre: ['Um… ', 'Sorry, I\'m not sure — ', 'Uh, '], deflect: ['What? I… I don\'t understand the question.', 'Sorry, could you say that again?'],
    calmed: ['Oh. Right. Sorry. Go ahead.'], hangup: ['I don\'t know what else to say, sorry!'] },
  angry: { label: 'Angry', patience: 4, delay: 3, resist: 0.45, reliability: 0.9, volunteer: 0, weight: 1.2,
    pre: ['Look, ', 'Finally! ', 'Listen, '], deflect: ['Why are you asking me that? Just send someone!', 'I\'ve said enough, send somebody!'],
    calmed: ['…Fine. I\'m listening.'], hangup: ['This is taking too long! Forget it!'] },
  uncooperative: { label: 'Uncooperative', patience: 5, delay: 4, resist: 0.7, reliability: 0.9, volunteer: 0, weight: 1.2,
    pre: ['Fine. ', 'Whatever, ', 'If you must know, '], deflect: ['I don\'t want to give you details.', 'Why do you need to know that?'],
    calmed: ['Okay, okay. What do you want to know?'], hangup: ['I\'m done with this call.'] },
  uncertain: { label: 'Uncertain', patience: 6, delay: 4, resist: 0.15, reliability: 0.5, volunteer: 0, weight: 1.3,
    pre: ['Maybe… ', 'I could be wrong, but ', 'I think '], deflect: ['Hmm, I\'d rather not guess.'],
    calmed: ['Thanks. I\'ll try to be useful.'], hangup: ['I… I should go, sorry.'] },
  distracted: { label: 'Distracted', patience: 5, delay: 6, resist: 0.35, reliability: 0.7, volunteer: 0, weight: 1.2,
    pre: ['Sorry — hold on — ', 'Hang on, ', 'One sec… '], deflect: ['Sorry, what was that? I wasn\'t listening.'],
    calmed: ['Okay, I\'m paying attention now.'], hangup: ['Sorry, I really have to go!'] },
};

export const GENERIC_QUESTIONS: Question[] = [
  { key: 'ADDRESS', text: 'What is the address of the emergency?', group: 'Location' },
  { key: 'CONFIRM', text: 'Can you confirm the address or a nearby landmark?', group: 'Location' },
  { key: 'DESCRIBE', text: 'Can you describe what is happening?', group: 'Situation', once: true },
  { key: 'DANGER', text: 'Are you in a safe place right now?', group: 'Safety' },
  { key: 'CALM', text: 'Stay with me. Help is being arranged. Try to stay calm.', group: 'Caller', once: true },
];

export const TEMPLATE_QUESTIONS: Record<string, Question[]> = {
  collision: [
    { key: 'INJURIES', text: 'Is anyone injured?', group: 'Situation' },
    { key: 'VEHICLES', text: 'How many vehicles are involved?', group: 'Situation' },
    { key: 'BLOCKING', text: 'Is the road blocked?', group: 'Situation' },
  ],
  fire: [
    { key: 'INSIDE', text: 'Is anyone still inside the building?', group: 'Situation' },
    { key: 'SPREAD', text: 'Is the fire spreading?', group: 'Situation' },
    { key: 'HURT', text: 'Is anyone hurt or struggling to breathe?', group: 'Situation' },
  ],
  medical: [
    { key: 'AWAKE', text: 'Is the patient awake and responding?', group: 'Situation' },
    { key: 'BREATHING', text: 'Are they breathing normally?', group: 'Situation' },
    { key: 'SYMPTOMS', text: 'What symptoms do they have?', group: 'Situation' },
  ],
  disturbance: [
    { key: 'WEAPON', text: 'Does anyone have a weapon?', group: 'Situation' },
    { key: 'INJURED', text: 'Is anyone hurt?', group: 'Situation' },
    { key: 'STILL', text: 'Is the person still there?', group: 'Situation' },
  ],
  water: [
    { key: 'VISIBLE', text: 'Can you still see them in the water?', group: 'Situation' },
    { key: 'CONSCIOUS', text: 'Are they conscious and calling out?', group: 'Situation' },
  ],
  industrial: [
    { key: 'TRAPPED', text: 'Is anyone trapped or pinned?', group: 'Situation' },
    { key: 'HAZARD', text: 'Is there smoke, fumes or a leak?', group: 'Situation' },
    { key: 'HURT', text: 'Is anyone hurt?', group: 'Situation' },
  ],
};

const A = (say: string, note: string, caps?: Capability[], settles?: Capability[], sev?: number): Answer => ({ say, note, caps, settles, sev });
const info = (say: string, note: string, sev?: number) => A(say, note, undefined, undefined, sev);

export const SCRIPTS: Record<string, VarScript> = {
  'collision.minor': {
    hint: ['TRAFFIC'], describe: info('Just a bump between two cars. Nobody seems badly off.', 'Described as a minor collision.', 1),
    answers: {
      INJURIES: A('No, everybody is walking around. Just shaken.', 'No injuries reported.', [], ['MEDICAL'], 1),
      VEHICLES: info('Two cars.', '2 vehicles involved.'),
      BLOCKING: A('Yes, one lane is completely stuck.', 'A lane is blocked.', ['TRAFFIC']),
    },
  },
  'collision.injured': {
    hint: ['MEDICAL'], describe: info('One car hit a lamp post. The passenger looks hurt.', 'Single vehicle; a passenger looks hurt.', 2),
    answers: {
      INJURIES: A('Yes, the passenger can\'t move their neck.', 'One injured (neck pain), medical needed.', ['MEDICAL'], undefined, 2),
      VEHICLES: info('Just the one car.', '1 vehicle involved.'),
      BLOCKING: A('The car is half on the road, yes.', 'Road partly blocked.', ['TRAFFIC']),
    },
  },
  'collision.multi': {
    hint: ['MEDICAL'], describe: info('It\'s a big crash. Several cars and people on the ground.', 'Several vehicles, multiple casualties likely.', 3),
    answers: {
      INJURIES: A('Several people! I count three on the ground.', 'At least 3 injured: multiple ambulances needed.', ['MEDICAL', 'MEDICAL'], undefined, 3),
      VEHICLES: info('Four cars, maybe five.', '4–5 vehicles involved.'),
      BLOCKING: A('The whole junction is blocked.', 'Junction fully blocked.', ['TRAFFIC']),
    },
  },
  'fire.small': {
    hint: ['FIRE'], describe: info('Flames from a kitchen window. It hasn\'t gone further yet.', 'Contained fire in one room.', 2),
    answers: {
      INSIDE: A('No, everyone got out.', 'Everyone has evacuated.', [], ['RESCUE'], 2),
      SPREAD: info('Not yet. It\'s still in the kitchen.', 'Not spreading yet.'),
      HURT: A('No, nobody is hurt.', 'No injuries reported.', [], ['MEDICAL']),
    },
  },
  'fire.smoke': {
    hint: ['FIRE'], describe: info('Thick smoke in the stairwell. People are coming out coughing.', 'Smoke in stairwell, people coughing.', 2),
    answers: {
      INSIDE: A('No, we\'re all outside.', 'Everyone has evacuated.', [], ['RESCUE'], 2),
      SPREAD: info('The smoke is going up the stairs.', 'Smoke spreading upward.'),
      HURT: A('A man is coughing badly, he\'s sitting on the curb.', 'One person with smoke inhalation.', ['MEDICAL']),
    },
  },
  'fire.trapped': {
    hint: ['FIRE'], describe: info('The apartment block is on fire and people are at the windows.', 'Apartment block fire; people at windows.', 3),
    answers: {
      INSIDE: A('Yes! Two people on the third floor!', 'Residents trapped on 3rd floor: rescue needed.', ['RESCUE'], undefined, 3),
      SPREAD: info('It\'s reaching the stairs!', 'Fire reaching the stairwell.'),
      HURT: A('One of them is coughing badly on the phone with me.', 'Trapped resident with smoke inhalation.', ['MEDICAL']),
    },
  },
  'medical.unclear': {
    hint: ['MEDICAL'], describe: info('They feel dizzy and keep sitting down.', 'Patient dizzy, severity unclear.', 1),
    answers: {
      AWAKE: info('Yes, they\'re talking to me.', 'Patient awake and responsive.'),
      BREATHING: info('Yes, normally.', 'Breathing normally.'),
      SYMPTOMS: A('Dizzy and pale, but sitting up.', 'Dizzy and pale. Basic medical.', ['MEDICAL'], ['ADV_MEDICAL'], 1),
    },
  },
  'medical.chest': {
    hint: ['MEDICAL'], describe: info('He says his chest is tight.', 'Patient reports chest tightness.', 2),
    answers: {
      AWAKE: info('Yes, but he looks grey.', 'Awake but grey.'),
      BREATHING: info('A bit fast. Short of breath.', 'Short of breath.'),
      SYMPTOMS: A('Chest pain into the arm, sweating.', 'Chest pain radiating to the arm: advanced medical.', ['ADV_MEDICAL'], ['MEDICAL', 'ADV_MEDICAL'], 2),
    },
  },
  'medical.cardiac': {
    hint: ['MEDICAL'], describe: info('She dropped and isn\'t answering me.', 'Patient collapsed, unresponsive.', 3),
    answers: {
      AWAKE: A('No! She isn\'t answering!', 'Patient unresponsive: advanced medical.', ['ADV_MEDICAL'], undefined, 3),
      BREATHING: A('I don\'t think so, she\'s gasping.', 'Abnormal breathing.', ['MEDICAL']),
      SYMPTOMS: info('No warning. She just dropped.', 'Sudden collapse.'),
    },
  },
  'disturbance.noise': {
    hint: ['LAW'], describe: info('Loud music and shouting from the flat next door.', 'Noise complaint.', 1),
    answers: {
      WEAPON: A('A weapon? No, just loud music.', 'No weapons reported.', [], ['SECURITY'], 1),
      INJURED: A('No one is hurt.', 'No injuries.', [], ['MEDICAL']),
      STILL: info('Yes, the party is still going.', 'Still ongoing.'),
    },
  },
  'disturbance.burglary': {
    hint: ['LAW'], describe: info('Someone climbing in through a window.', 'Possible break-in.', 2),
    answers: {
      WEAPON: A('I didn\'t see one.', 'No weapon seen.', [], ['SECURITY'], 2),
      INJURED: A('No, nobody is hurt.', 'No injuries.', [], ['MEDICAL']),
      STILL: info('I think they went round the back.', 'Suspect may be at the rear.'),
    },
  },
  'disturbance.armed': {
    hint: ['LAW'], describe: info('A man outside the bar is waving something. People are running.', 'Man waving an object outside a bar.', 3),
    answers: {
      WEAPON: A('Yes, a gun!', 'Firearm reported: armed response needed.', ['SECURITY'], undefined, 3),
      INJURED: A('Not that I can see.', 'No injuries seen.', [], ['MEDICAL']),
      STILL: info('He\'s still outside the bar!', 'Suspect still on scene.'),
    },
  },
  'water.swimmer': {
    hint: ['RESCUE'], describe: info('Someone is struggling in the current by the pier.', 'Person struggling in river.', 2),
    answers: {
      VISIBLE: info('Yes, about twenty meters out, holding a buoy.', 'Swimmer visible, ~20 m from the pier.', 2),
      CONSCIOUS: A('Shouting, but he\'s swallowing water. He\'ll need a medic.', 'Conscious, medical attention likely needed.', ['MEDICAL']),
    },
  },
  'industrial.crush': {
    hint: ['RESCUE'], describe: info('A pallet stack came down on one of our guys.', 'Worker pinned under pallets.', 3),
    answers: {
      TRAPPED: A('Yes, his leg is under the pallets!', 'Worker pinned: rescue needed.', ['RESCUE'], undefined, 3),
      HAZARD: A('No smoke, nothing leaking.', 'No fire or fumes.', [], ['FIRE']),
      HURT: A('He\'s conscious, in a lot of pain.', 'Injured, conscious.', ['MEDICAL']),
    },
  },
  'industrial.spill': {
    hint: ['FIRE'], describe: info('A drum split open in warehouse 4. People feel dizzy.', 'Leak in warehouse 4, people dizzy.', 2),
    answers: {
      TRAPPED: A('No, everyone is out.', 'Nobody trapped.', [], ['RESCUE']),
      HAZARD: A('A sharp smell and some smoke.', 'Fumes and smoke: firefighting needed.', ['FIRE'], undefined, 2),
      HURT: A('Two people dizzy and coughing.', 'Two people unwell.', ['MEDICAL']),
    },
  },
};

export const scriptFor = (templateId: string, variationId: string): VarScript => SCRIPTS[`${templateId}.${variationId}`];
export const questionsFor = (templateId: string): Question[] => [...GENERIC_QUESTIONS, ...(TEMPLATE_QUESTIONS[templateId] ?? [])];
