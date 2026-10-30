// Records system for officer radio requests: person (ID / wants & warrants) and vehicle (plate) checks.
// The officer reads the details over the radio — last name spelled phonetically, first name, date of birth,
// sex, or the plate, state and vehicle. The dispatcher types the query into the terminal, finds the right
// record (names repeat and spellings are close; the date of birth decides), and relays the return.
import type { Rng } from './rng';
import type { CheckResult, OfficerRequest, PersonRecord, RecordHit, VehicleRecord } from './types';

const FIRST_M = ['Marcus', 'Tyler', 'Oscar', 'Victor', 'Corey', 'Shane', 'Darius', 'Ruben', 'Andre', 'Kyle', 'Brett', 'Wade', 'Dmitri', 'Luis', 'Troy', 'Caleb', 'Jamal', 'Owen'];
const FIRST_F = ['Dana', 'Priya', 'Lena', 'Jade', 'Nadia', 'Elena', 'Holly', 'Megan', 'Tessa', 'Imani', 'Sofia', 'Carmen', 'Abby', 'Grace', 'Mona', 'Rosa', 'Kelsey', 'Tara'];
const LAST = ['Ibarra', 'Kowalski', 'Haddad', 'Brennan', 'Okafor', 'Marlowe', 'Vance', 'Petrov', 'Sandoval', 'Whitaker', 'Duval', 'Larsen', 'Tran', 'Castillo', 'Fischer', 'Novak', 'Ashford', 'Quill', 'Moreno', 'Yilmaz', 'Hartley', 'Delacroix', 'Lindqvist', 'Mendez', 'Garrity'];
const STREETS = ['Linden Ave', 'Harbor Rd', 'Mercer St', 'Alder Way', 'Quarry Ln', 'Kestrel Dr', 'Old Mill Rd', 'Fenwick St', 'Bayview Ter', 'Rowan Ct', 'Capitol Blvd', 'Ingram Ave'];
const MAKES: Array<[string, string]> = [['Toyota', 'Corolla'], ['Ford', 'F-150'], ['Honda', 'Civic'], ['Volkswagen', 'Golf'], ['Mazda', '3'], ['Nissan', 'Altima'], ['Subaru', 'Outback'], ['BMW', '3 Series'], ['Ford', 'Transit'], ['Chevrolet', 'Malibu'], ['Kia', 'Sportage'], ['Dodge', 'Charger']];
const COLORS = ['grey', 'black', 'white', 'blue', 'red', 'silver', 'green', 'maroon', 'gold'];
const HAIR = ['BLK', 'BRO', 'BLN', 'RED', 'GRY', 'BAL'];
const EYES = ['BRO', 'BLU', 'GRN', 'HAZ'];
const MARKS = ['TAT L FOREARM (ROSE)', 'TAT R NECK (STAR)', 'SCAR L EYEBROW', 'TAT BOTH HANDS (LETTERS)', 'NONE', 'NONE', 'PIERCED NOSE', 'SCAR CHIN'];
const CRIMES = ['FAILURE TO APPEAR — THEFT', 'PROBATION VIOLATION', 'UNPAID FINES — DUI', 'BURGLARY 2ND DEGREE', 'POSSESSION W/ INTENT', 'FRAUD — 3 COUNTS', 'CRIMINAL TRESPASS'];
const VIOLENT = ['AGGRAVATED ASSAULT W/ WEAPON', 'ARMED ROBBERY', 'ASSAULT ON A PEACE OFFICER', 'FIREARM OFFENCE — PROHIBITED PERSON'];
const PRIORS = ['THEFT (MISD)', 'DISORDERLY CONDUCT', 'DUI', 'TRESPASS', 'POSSESSION', 'ASSAULT', 'VANDALISM', 'SHOPLIFTING', 'RESISTING ARREST'];
const PHONETIC: Record<string, string> = { A: 'Adam', B: 'Boy', C: 'Charles', D: 'David', E: 'Edward', F: 'Frank', G: 'George', H: 'Henry', I: 'Ida', J: 'John', K: 'King', L: 'Lincoln', M: 'Mary', N: 'Nora', O: 'Ocean', P: 'Paul', Q: 'Queen', R: 'Robert', S: 'Sam', T: 'Tom', U: 'Union', V: 'Victor', W: 'William', X: 'X-ray', Y: 'Young', Z: 'Zebra' };
const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];

export const CHECK_LABEL: Record<CheckResult, string> = {
  clear: 'Clear — no wants', warrant: 'Active warrant', caution: 'CAUTION — armed / violent', suspended: 'Licence suspended', missing: 'Reported missing',
  stolen: 'Reported STOLEN', expired: 'Expired / uninsured',
};
export const PERSON_ANSWERS: CheckResult[] = ['clear', 'warrant', 'caution', 'suspended', 'missing'];
export const PLATE_ANSWERS: CheckResult[] = ['clear', 'stolen', 'expired', 'warrant'];
/** the answers that put an officer at risk if they are missed */
export const DANGEROUS: CheckResult[] = ['caution', 'stolen', 'warrant'];

const pad = (n: number) => String(n).padStart(2, '0');
const dobOf = (rng: Rng) => `${pad(rng.int(1, 12))}/${pad(rng.int(1, 28))}/${rng.int(1958, 2005)}`;
const plateOf = (rng: Rng) => `${rng.int(1, 9)}${'ABCDEFGHJKLMNPRSTUVWXYZ'[rng.int(0, 22)]}${'ABCDEFGHJKLMNPRSTUVWXYZ'[rng.int(0, 22)]}${rng.int(100, 999)}`;
export const spellPhonetic = (word: string) => word.toUpperCase().split('').map((c) => PHONETIC[c] ?? (/\d/.test(c) ? DIGIT[+c] : c)).join(', ');
const sayDob = (dob: string) => { const [m, d, y] = dob.split('/'); return `${m.split('').map((c) => DIGIT[+c]).join('-')}, ${d.split('').map((c) => DIGIT[+c]).join('-')}, ${y}`; };

function person(rng: Rng, last: string, first: string, sex: 'M' | 'F', dob: string, flag: CheckResult): PersonRecord {
  const warrants: PersonRecord['warrants'] = [];
  if (flag === 'warrant') warrants.push({ num: String(rng.int(10000, 99999)), charge: rng.pick(CRIMES), level: rng.chance(0.5) ? 'FELONY' : 'MISD' });
  if (flag === 'caution') warrants.push({ num: String(rng.int(10000, 99999)), charge: rng.pick(VIOLENT), level: 'FELONY' });
  const priorN = flag === 'clear' ? (rng.chance(0.6) ? 0 : 1) : flag === 'caution' ? rng.int(2, 4) : rng.int(0, 2);
  const priors = Array.from({ length: priorN }, () => ({ year: rng.int(2006, 2025), charge: flag === 'caution' && rng.chance(0.5) ? rng.pick(['ASSAULT', 'ASSAULT W/ WEAPON', 'ROBBERY']) : rng.pick(PRIORS) })).sort((a, b) => b.year - a.year);
  const ft = rng.int(sex === 'M' ? 5 : 4, sex === 'M' ? 6 : 5), inch = rng.int(ft === 4 ? 10 : 0, 11);
  return {
    last, first, middle: rng.pick(['A', 'J', 'M', 'R', 'L', 'T', 'E']), dob, sex, height: `${ft}'${pad(inch)}"`, weight: rng.int(sex === 'M' ? 140 : 105, sex === 'M' ? 260 : 210),
    hair: rng.pick(HAIR), eyes: rng.pick(EYES), address: `${rng.int(10, 2400)} ${rng.pick(STREETS).toUpperCase()}, RAVENPORT`,
    oln: `R${rng.int(1000000, 9999999)}`, olnStatus: flag === 'suspended' ? 'SUSPENDED' : rng.chance(0.06) ? 'EXPIRED' : 'VALID',
    warrants, priors, caution: flag === 'caution' ? rng.pick(['KNOWN TO CARRY WEAPONS', 'VIOLENT TOWARD POLICE', 'ARMED AND DANGEROUS']) : null,
    marks: rng.pick(MARKS), missing: flag === 'missing',
  };
}
function vehicle(rng: Rng, plate: string, make: [string, string], color: string, owner: string, flag: CheckResult): VehicleRecord {
  return {
    plate, state: 'RV', year: rng.int(2006, 2025), make: make[0], model: make[1], color, owner, ownerAddress: `${rng.int(10, 2400)} ${rng.pick(STREETS).toUpperCase()}, RAVENPORT`,
    reg: flag === 'expired' ? 'EXPIRED' : 'VALID', insured: flag !== 'expired',
    stolen: flag === 'stolen' ? { date: `${pad(rng.int(1, 12))}/${pad(rng.int(1, 28))}`, caseNo: String(rng.int(100000, 999999)) } : null,
    ownerWarrant: flag === 'warrant',
  };
}

/** printable terminal lines for a record */
export function recordLines(h: RecordHit): string[] {
  if (h.person) {
    const p = h.person;
    const l = [
      `NAM/${p.last.toUpperCase()}, ${p.first.toUpperCase()} ${p.middle}   SEX/${p.sex}   DOB/${p.dob}`,
      `HGT/${p.height}  WGT/${p.weight}  HAI/${p.hair}  EYE/${p.eyes}`,
      `ADR/${p.address}`,
      `OLN/${p.oln}   STATUS/${p.olnStatus}${p.olnStatus === 'SUSPENDED' ? ' — UNPAID FINES / DUI' : ''}`,
      `SMT/${p.marks}`,
    ];
    if (p.warrants.length) for (const w of p.warrants) l.push(`*** WANTED *** WARRANT #${w.num} — ${w.level} — ${w.charge}`);
    else l.push('WANTS/WARRANTS: NONE ON FILE');
    if (p.caution) l.push(`!!! CAUTION: ${p.caution} — APPROACH WITH BACKUP !!!`);
    if (p.missing) l.push(`*** MISSING PERSON *** ENDANGERED — CONTACT RPD MISSING PERSONS`);
    l.push(`CRIMINAL HISTORY: ${p.priors.length ? p.priors.map((x) => `${x.year} ${x.charge}`).join(' · ') : 'NONE'}`);
    return l;
  }
  const v = h.vehicle!;
  const l = [
    `LIC/${v.plate}   ST/${v.state}   VYR/${v.year}   VMA/${v.make.toUpperCase()}   VMO/${v.model.toUpperCase()}   VCO/${v.color.toUpperCase()}`,
    `REG OWNER/${v.owner.toUpperCase()}`,
    `ADR/${v.ownerAddress}`,
    `REG/${v.reg}   INS/${v.insured ? 'ON FILE' : 'NONE ON FILE'}`,
  ];
  if (v.stolen) l.push(`*** STOLEN VEHICLE *** REPORTED ${v.stolen.date} — CASE #${v.stolen.caseNo}`, 'TREAT OCCUPANTS AS POSSIBLY ARMED');
  else l.push('NO STOLEN ENTRY');
  if (v.ownerWarrant) l.push(`REG OWNER HAS ACTIVE WARRANT — ${CRIMES[v.year % CRIMES.length]}`);
  return l;
}

/** a near-miss spelling, for decoy records */
function misspell(rng: Rng, s: string): string {
  const i = rng.int(1, s.length - 2);
  const vowels = 'aeiou';
  const c = s[i];
  const r = vowels.includes(c) ? vowels.replace(c, '')[rng.int(0, 3)] : c === 'n' ? 'm' : c === 'l' ? 'll' : c + c;
  return s.slice(0, i) + r + s.slice(i + 1);
}

/** build a new officer request with its hidden truth and the small records database the terminal searches */
export function makeRequest(rng: Rng, id: string, unitId: string, incidentId: string | null, kind: 'person' | 'plate', at: number, risky = false): OfficerRequest {
  if (kind === 'person') {
    const truth: CheckResult = rng.weighted<[CheckResult, number]>([['clear', 52], ['warrant', 20], ['caution', risky ? 16 : 8], ['suspended', 12], ['missing', 4]], (x) => x[1])![0];
    const sex: 'M' | 'F' = rng.chance(0.65) ? 'M' : 'F';
    const first = rng.pick(sex === 'M' ? FIRST_M : FIRST_F), last = rng.pick(LAST);
    const dob = dobOf(rng);
    const db: RecordHit[] = [{ person: person(rng, last, first, sex, dob, truth), flag: truth, match: true }];
    // a namesake with a different date of birth
    if (rng.chance(0.45)) {
      let other = dobOf(rng); while (other === dob) other = dobOf(rng);
      const f: CheckResult = truth === 'clear' ? rng.pick<CheckResult>(['warrant', 'caution', 'clear']) : rng.pick<CheckResult>(['clear', 'clear', 'suspended']);
      db.push({ person: person(rng, last, first, sex, other, f), flag: f, match: false });
    }
    // a relative at the same address, and a near-miss spelling
    if (rng.chance(0.4)) { const f = rng.pick<CheckResult>(['clear', 'warrant', 'clear']); const rel = person(rng, last, rng.pick(sex === 'M' ? FIRST_M : FIRST_F), sex, dobOf(rng), f); rel.address = db[0].person!.address; db.push({ person: rel, flag: f, match: false }); }
    if (rng.chance(0.4)) { const f = rng.pick<CheckResult>(['caution', 'warrant', 'clear']); db.push({ person: person(rng, misspell(rng, last), first, sex, dobOf(rng), f), flag: f, match: false }); }
    return { id, unitId, incidentId, kind, at, status: 'open', subject: `${first} ${last}`, detail: `DOB ${dob}`, given: { last, first, dob, sex }, truth, db: rng.shuffle(db), ran: false, reminded: 0, searches: 0, mistakes: 0 };
  }
  const truth: CheckResult = rng.weighted<[CheckResult, number]>([['clear', 58], ['stolen', risky ? 22 : 13], ['expired', 18], ['warrant', 11]], (x) => x[1])![0];
  const plate = plateOf(rng);
  const make = rng.pick(MAKES), color = rng.pick(COLORS);
  const owner = `${rng.pick(rng.chance(0.6) ? FIRST_M : FIRST_F)} ${rng.pick(LAST)}`;
  const db: RecordHit[] = [{ vehicle: vehicle(rng, plate, make, color, owner, truth), flag: truth, match: true }];
  // one character off: the classic misread plate
  if (rng.chance(0.5)) { const i = rng.int(1, 5); const alt = plate.slice(0, i) + (/\d/.test(plate[i]) ? String((+plate[i] + 1) % 10) : 'ABCDEFGHJKLMNPRSTUVWXYZ'[rng.int(0, 22)]) + plate.slice(i + 1); const f = rng.pick<CheckResult>(['clear', 'stolen', 'expired']); db.push({ vehicle: vehicle(rng, alt, rng.pick(MAKES), rng.pick(COLORS), `${rng.pick(FIRST_F)} ${rng.pick(LAST)}`, f), flag: f, match: false }); }
  const vdesc = `${color} ${make[0]} ${make[1]}`;
  return { id, unitId, incidentId, kind, at, status: 'open', subject: plate, detail: vdesc, given: { plate, state: 'RV', vehicle: vdesc }, truth, db, ran: false, reminded: 0, searches: 0, mistakes: 0 };
}

// ── searching ───────────────────────────────────────────────────────────────
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** accepts 9/23/1960, 09-23-60, 1960-09-23 */
export function normDob(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return `${pad(+m[2])}/${pad(+m[3])}/${m[1]}`;
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (!m) return 'INVALID';
  const y = m[3].length === 2 ? (+m[3] > 30 ? 1900 + +m[3] : 2000 + +m[3]) : +m[3];
  return `${pad(+m[1])}/${pad(+m[2])}/${y}`;
}
export interface RecordQuery { last?: string; first?: string; dob?: string; sex?: string; plate?: string }

/** what the database returns for the dispatcher's query: indexes into the request's db */
export function searchRecords(r: OfficerRequest, q: RecordQuery): number[] {
  const out: number[] = [];
  if (r.kind === 'plate') {
    const p = norm(q.plate ?? '');
    if (p.length < 3) return out;
    r.db.forEach((h, i) => { if (h.vehicle && norm(h.vehicle.plate) === p) out.push(i); });
    return out;
  }
  const last = norm(q.last ?? ''), first = norm(q.first ?? '');
  if (last.length < 2) return out;
  const dob = normDob(q.dob ?? '');
  const sex = (q.sex ?? '').toUpperCase().charAt(0);
  r.db.forEach((h, i) => {
    const p = h.person;
    if (!p) return;
    // soundex-style tolerance: a one-letter slip on the surname still returns the record
    if (lev(norm(p.last), last) > 1) return;
    if (first && !(norm(p.first) === first || (first.length === 1 && norm(p.first).startsWith(first)) || lev(norm(p.first), first) <= 1)) return;
    if (dob && dob !== 'INVALID' && p.dob !== dob) return;
    if (sex && (sex === 'M' || sex === 'F') && p.sex !== sex) return;
    out.push(i);
  });
  return out;
}

/** what the officer says on the radio, the way they would really read it out */
export function requestText(r: OfficerRequest, spoken: string, rng: Rng, again = false): string {
  if (r.given && 'last' in r.given) {
    const g = r.given;
    const body = `last name ${g.last} — ${spellPhonetic(g.last)}. First name ${g.first}. Date of birth ${sayDob(g.dob)}. ${g.sex === 'M' ? 'Male' : 'Female'}.`;
    if (again) return `${spoken}, again: ${body}`;
    return rng.pick([
      `Dispatch, ${spoken}. Can you run one for wants and warrants? ${body}`,
      `Dispatch, ${spoken}, requesting a 10-29 on one subject: ${body}`,
      `${spoken} to dispatch — ID check please, subject's being evasive. ${body}`,
    ]);
  }
  const g = r.given as { plate: string; state: string; vehicle: string };
  const body = `plate ${spellPhonetic(g.plate)}, Ravenport plate, on a ${g.vehicle}.`;
  if (again) return `${spoken}, again: ${body}`;
  return rng.pick([
    `Dispatch, ${spoken}. Run a plate for me: ${body}`,
    `${spoken}, traffic stop. 10-28 on ${body}`,
    `Dispatch, ${spoken}. Occupied times two, can you check ${body}`,
  ]);
}

/** the return the dispatcher radios, built from the record they chose */
export function returnText(spoken: string, answer: CheckResult, h: RecordHit | null): string {
  if (!h) return `${spoken}, no record on file for that query.`;
  if (h.person) {
    const p = h.person;
    const bits = [`${spoken}, your subject ${p.first} ${p.last}, ${p.dob}, ${p.sex === 'M' ? 'male' : 'female'}, ${p.height}, ${p.weight} pounds`];
    if (answer === 'caution') bits.push(`CAUTION — ${p.caution ?? 'armed and dangerous'}, active felony warrant${p.warrants[0] ? ` for ${p.warrants[0].charge.toLowerCase()}` : ''}`);
    else if (answer === 'warrant') bits.push(`comes back with an active ${p.warrants[0]?.level === 'FELONY' ? 'felony' : 'misdemeanour'} warrant${p.warrants[0] ? ` for ${p.warrants[0].charge.toLowerCase()}` : ''}`);
    else if (answer === 'missing') bits.push('is entered as an endangered missing person');
    else if (answer === 'suspended') bits.push('licence is suspended, no wants');
    else bits.push(`licence ${p.olnStatus.toLowerCase()}, no wants or warrants`);
    if (p.priors.length) bits.push(`priors for ${p.priors.slice(0, 2).map((x) => x.charge.toLowerCase()).join(' and ')}`);
    if (p.marks !== 'NONE') bits.push(`identifying mark ${p.marks.toLowerCase()}`);
    return bits.join('; ') + '.';
  }
  const v = h.vehicle!;
  const base = `${spoken}, ${v.plate} comes back to a ${v.year} ${v.color} ${v.make} ${v.model}, registered to ${v.owner}`;
  if (answer === 'stolen') return `${base}. Vehicle is reported STOLEN, case ${v.stolen?.caseNo ?? 'on file'} — use caution.`;
  if (answer === 'expired') return `${base}. Registration expired, no insurance on file.`;
  if (answer === 'warrant') return `${base}. Registered owner has an active warrant.`;
  return `${base}. Valid, no stolen entry.`;
}

/** how the officer acknowledges the return the dispatcher gave */
export function replyText(answer: CheckResult, spoken: string): string {
  switch (answer) {
    case 'clear': return `Copy, clear. ${spoken} will advise and release.`;
    case 'warrant': return `Copy the warrant. ${spoken} — taking one into custody.`;
    case 'caution': return `Copy, armed and dangerous. ${spoken} holding back — requesting a second unit before we approach.`;
    case 'suspended': return `Copy, suspended licence. ${spoken} issuing a citation, vehicle will be towed.`;
    case 'missing': return `Copy, missing person. ${spoken} will keep them here and arrange a welfare handover.`;
    case 'stolen': return `Copy, stolen. ${spoken} — felony stop, occupants out one at a time.`;
    case 'expired': return `Copy, expired. ${spoken} issuing a ticket.`;
  }
}
