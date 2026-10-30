// Shared vocabulary: fact labels, incident classes (what the dispatcher believes), caller archetypes.
import type { Capability, Req, CallerProfile } from '../types';

export const FACT_LABELS: Record<string, string> = {
  injured: 'People injured', conscious: 'Conscious', breathing: 'Breathing', age: 'Patient age', people: 'People involved',
  fire: 'Flames visible', smoke: 'Smoke visible', hazard: 'Other hazard', weapon: 'Weapon', suspect: 'Suspect present',
  suspect_desc: 'Suspect description', vehicles: 'Vehicles involved', trapped: 'People trapped', safe: 'Caller safe',
  cause: 'What happened', district: 'District (caller)', animal: 'Animal involved', crowd: 'Crowd', water: 'Person in water',
  outside: 'Out of jurisdiction', false_alarm: 'Not an emergency',
};

export interface ClassDef { id: string; label: string; rec: Req[]; service: 'medical' | 'fire' | 'police' | 'none' }
export const CLASSES: ClassDef[] = [
  { id: 'medical_critical', label: 'Possible critical medical', service: 'medical', rec: [{ cap: 'als', n: 1 }, { cap: 'transport', n: 1 }] },
  { id: 'medical_general', label: 'Medical — non-critical', service: 'medical', rec: [{ cap: 'bls', n: 1 }, { cap: 'transport', n: 1 }] },
  { id: 'fire_structure', label: 'Possible structure fire', service: 'fire', rec: [{ cap: 'fire_suppression', n: 1 }] },
  { id: 'fire_other', label: 'Fire — vehicle / outdoor / electrical', service: 'fire', rec: [{ cap: 'fire_suppression', n: 1 }] },
  { id: 'hazmat', label: 'Gas leak / hazard', service: 'fire', rec: [{ cap: 'fire_suppression', n: 1 }, { cap: 'patrol', n: 1 }] },
  { id: 'rescue', label: 'Rescue / entrapment', service: 'fire', rec: [{ cap: 'rescue', n: 1 }] },
  { id: 'water', label: 'Water rescue', service: 'fire', rec: [{ cap: 'water_rescue', n: 1 }, { cap: 'bls', n: 1 }, { cap: 'transport', n: 1 }] },
  { id: 'collision', label: 'Traffic collision', service: 'police', rec: [{ cap: 'patrol', n: 1 }] },
  { id: 'crime_progress', label: 'Crime in progress', service: 'police', rec: [{ cap: 'patrol', n: 2 }] },
  { id: 'crime_report', label: 'Crime report', service: 'police', rec: [{ cap: 'patrol', n: 1 }] },
  { id: 'disturbance', label: 'Disturbance', service: 'police', rec: [{ cap: 'patrol', n: 1 }] },
  { id: 'welfare', label: 'Welfare check / suspicious', service: 'police', rec: [{ cap: 'patrol', n: 1 }] },
  { id: 'no_response', label: 'No emergency / information only', service: 'none', rec: [] },
  { id: 'unknown', label: 'Unclassified', service: 'none', rec: [] },
];
export const CLASS_BY_ID: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.id, c]));

export const CAP_LABEL: Record<Capability, string> = {
  patrol: 'Patrol', traffic: 'Traffic', crowd: 'Crowd control', tactical: 'Tactical', police_supervisor: 'Supervisor', prisoner_transport: 'Prisoner transport',
  fire_suppression: 'Fire suppression', aerial: 'Aerial', rescue: 'Rescue', heavy_rescue: 'Heavy rescue', water_rescue: 'Water rescue', command: 'Command',
  bls: 'Basic life support', als: 'Advanced life support', transport: 'Patient transport', critical_transport: 'Critical transport', med_supervisor: 'Medical supervisor',
};

/** Capabilities a fleet can plausibly contain at a given rank; used to adapt escalations so a shift never demands the impossible. */
export function adaptReqForRank(r: Req, rank: number): Req {
  const m = (cap: Capability, n = r.n): Req => ({ cap, n });
  switch (r.cap) {
    case 'aerial': return rank >= 3 ? r : m('fire_suppression');
    case 'command': return rank >= 4 ? r : m('fire_suppression');
    case 'heavy_rescue': return rank >= 5 ? r : m('rescue');
    case 'water_rescue': return rank >= 3 ? r : m('rescue');
    case 'tactical': return rank >= 5 ? r : m('patrol', r.n + 1);
    case 'police_supervisor': return rank >= 3 ? r : m('patrol');
    case 'critical_transport': return rank >= 5 ? r : m('als');
    case 'med_supervisor': return rank >= 4 ? r : m('als');
    case 'traffic': return rank >= 2 ? r : m('patrol');
    case 'crowd': return rank >= 2 ? r : m('patrol', r.n + 1);
    case 'prisoner_transport': return m('patrol');
    default: return r;
  }
}

// ── Caller archetypes ───────────────────────────────────────────────────────
export interface Archetype {
  id: string; label: string; personality: string; style: string; age: [number, number];
  panic: [number, number]; coop: [number, number]; frustration: [number, number];
  accuracy: Record<CallerProfile['locationAccuracy'], number>;
  idType: Record<CallerProfile['callerIdType'], number>;
  misunderstand: number; contradict: number; slow: number; self?: boolean;
}

export const ARCHETYPES: Record<string, Archetype> = {
  panicked_parent: { id: 'panicked_parent', label: 'Panicked parent', personality: 'Loving and terrified; talks over their own sentences', style: 'Fast, shaky, fragmented', age: [26, 46], panic: [72, 90], coop: [62, 80], frustration: [0, 8], accuracy: { exact: 5, street: 3, landmark: 1, wrong: 1, unknown: 0 }, idType: { mobile: 6, landline: 4, voip: 0, payphone: 0 }, misunderstand: 0.04, contradict: 0.1, slow: 0 },
  confused_elderly: { id: 'confused_elderly', label: 'Confused elderly caller', personality: 'Polite, easily flustered, loses the thread', style: 'Slow, wandering, apologetic', age: [68, 91], panic: [34, 56], coop: [70, 90], frustration: [0, 6], accuracy: { exact: 2, street: 3, landmark: 2, wrong: 3, unknown: 3 }, idType: { mobile: 1, landline: 8, voip: 0, payphone: 0 }, misunderstand: 0.2, contradict: 0.3, slow: 1, self: true },
  angry_motorist: { id: 'angry_motorist', label: 'Angry motorist', personality: 'Irritated, impatient, resents questions', style: 'Clipped, loud, sarcastic', age: [24, 62], panic: [22, 40], coop: [26, 42], frustration: [38, 58], accuracy: { exact: 3, street: 4, landmark: 3, wrong: 0, unknown: 0 }, idType: { mobile: 9, landline: 0, voip: 1, payphone: 0 }, misunderstand: 0, contradict: 0.05, slow: 0 },
  calm_serious: { id: 'calm_serious', label: 'Calm but serious', personality: 'Unnervingly composed; understates danger', style: 'Level, measured, minimal', age: [30, 58], panic: [4, 14], coop: [82, 95], frustration: [0, 4], accuracy: { exact: 8, street: 2, landmark: 1, wrong: 0, unknown: 0 }, idType: { mobile: 7, landline: 3, voip: 0, payphone: 0 }, misunderstand: 0, contradict: 0, slow: 0 },
  prankster: { id: 'prankster', label: 'Possible prankster', personality: 'Teenager testing limits; cracks jokes, folds under pressure', style: 'Giggly, flippant, evasive', age: [14, 22], panic: [0, 10], coop: [15, 30], frustration: [10, 24], accuracy: { exact: 3, street: 4, landmark: 3, wrong: 1, unknown: 0 }, idType: { mobile: 8, landline: 0, voip: 2, payphone: 0 }, misunderstand: 0.02, contradict: 0.2, slow: 0 },
  witness: { id: 'witness', label: 'Concerned witness', personality: 'Helpful bystander, rattled but trying', style: 'Quick, descriptive, uncertain details', age: [22, 64], panic: [30, 52], coop: [64, 86], frustration: [0, 10], accuracy: { exact: 4, street: 5, landmark: 3, wrong: 1, unknown: 0 }, idType: { mobile: 9, landline: 1, voip: 0, payphone: 0 }, misunderstand: 0.03, contradict: 0.1, slow: 0 },
  injured_self: { id: 'injured_self', label: 'Caller is the patient', personality: 'In pain and frightened; short of breath', style: 'Breathy, halting', age: [25, 80], panic: [48, 68], coop: [55, 75], frustration: [0, 8], accuracy: { exact: 5, street: 3, landmark: 2, wrong: 1, unknown: 1 }, idType: { mobile: 6, landline: 4, voip: 0, payphone: 0 }, misunderstand: 0.05, contradict: 0.1, slow: 1, self: true },
  child_caller: { id: 'child_caller', label: 'Young child', personality: 'Scared, literal, wants a grown-up', style: 'Small, quiet, simple words', age: [6, 11], panic: [48, 64], coop: [60, 78], frustration: [0, 6], accuracy: { exact: 0, street: 1, landmark: 2, wrong: 0, unknown: 5 }, idType: { mobile: 4, landline: 6, voip: 0, payphone: 0 }, misunderstand: 0.15, contradict: 0.2, slow: 1 },
  professional: { id: 'professional', label: 'Professional (security / staff)', personality: 'Trained to report clearly; precise', style: 'Concise and factual', age: [28, 60], panic: [6, 20], coop: [84, 96], frustration: [0, 4], accuracy: { exact: 9, street: 1, landmark: 1, wrong: 0, unknown: 0 }, idType: { mobile: 5, landline: 5, voip: 0, payphone: 0 }, misunderstand: 0, contradict: 0, slow: 0 },
  worried_neighbor: { id: 'worried_neighbor', label: 'Worried neighbour', personality: 'Kindly, nosy, afraid of overreacting', style: 'Chatty, hedging', age: [30, 74], panic: [26, 46], coop: [66, 84], frustration: [0, 8], accuracy: { exact: 5, street: 4, landmark: 2, wrong: 1, unknown: 0 }, idType: { mobile: 5, landline: 5, voip: 0, payphone: 0 }, misunderstand: 0.05, contradict: 0.1, slow: 0 },
  drunk_caller: { id: 'drunk_caller', label: 'Intoxicated caller', personality: 'Rambling, over-friendly, then irritable', style: 'Slurred, repetitive', age: [22, 55], panic: [14, 30], coop: [28, 46], frustration: [18, 34], accuracy: { exact: 1, street: 4, landmark: 3, wrong: 3, unknown: 1 }, idType: { mobile: 9, landline: 0, voip: 0, payphone: 1 }, misunderstand: 0.15, contradict: 0.35, slow: 0 },
  shopkeeper: { id: 'shopkeeper', label: 'Shop owner', personality: 'Practical and annoyed; knows the address by heart', style: 'Direct, a bit weary', age: [30, 66], panic: [18, 38], coop: [64, 82], frustration: [4, 16], accuracy: { exact: 9, street: 1, landmark: 0, wrong: 0, unknown: 0 }, idType: { mobile: 3, landline: 7, voip: 0, payphone: 0 }, misunderstand: 0.02, contradict: 0.05, slow: 0 },
  terse: { id: 'terse', label: 'Guarded caller', personality: 'Refuses to explain, fears being overheard', style: 'Whispery, one-word replies', age: [24, 55], panic: [40, 58], coop: [16, 28], frustration: [14, 26], accuracy: { exact: 3, street: 3, landmark: 2, wrong: 0, unknown: 3 }, idType: { mobile: 8, landline: 2, voip: 0, payphone: 0 }, misunderstand: 0.03, contradict: 0.1, slow: 0 },
};

export const FIRST_NAMES = ['Maria', 'James', 'Priya', 'Tom', 'Aisha', 'Daniel', 'Grace', 'Luis', 'Hannah', 'Kofi', 'Elena', 'Marcus', 'Sofia', 'Ravi', 'Claire', 'Andre', 'Nadia', 'Ben', 'Mei', 'Oscar', 'Lucy', 'Hassan', 'Ruth', 'Victor', 'Imani', 'Paul', 'Tess', 'Jun', 'Rosa', 'Eli', 'Dorothy', 'Walter', 'Margaret', 'Harold', 'Edith', 'Frank', 'Mabel'];
export const LAST_NAMES = ['Alvarez', 'Bennett', 'Chen', 'Dubois', 'Edwards', 'Fox', 'Gupta', 'Hughes', 'Ito', 'Jensen', 'Khan', 'Lopez', 'Murphy', 'Nguyen', 'Ortiz', 'Patel', 'Quinn', 'Reyes', 'Silva', 'Turner', 'Underhill', 'Voss', 'Walsh', 'Young', 'Zimmer', 'Bauer', 'Costa', 'Doyle'];
