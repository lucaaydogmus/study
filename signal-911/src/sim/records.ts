// Records system for officer radio requests: person (ID / warrant) and vehicle (plate) checks.
// Officers give a name + date of birth or a plate; the dispatcher runs it, reads the return and
// relays the right answer. Names are sometimes shared by several people — the date of birth decides.
import type { Rng } from './rng';
import type { CheckResult, OfficerRequest, RecordHit } from './types';

const FIRST = ['Marcus', 'Dana', 'Tyler', 'Priya', 'Oscar', 'Lena', 'Victor', 'Jade', 'Corey', 'Nadia', 'Shane', 'Elena', 'Darius', 'Holly', 'Ruben', 'Megan', 'Andre', 'Tessa', 'Kyle', 'Imani', 'Brett', 'Sofia', 'Wade', 'Carmen', 'Dmitri', 'Abby', 'Luis', 'Grace', 'Troy', 'Mona'];
const LAST = ['Ibarra', 'Kowalski', 'Haddad', 'Brennan', 'Okafor', 'Marlowe', 'Vance', 'Petrov', 'Sandoval', 'Whitaker', 'Duval', 'Larsen', 'Tran', 'Castillo', 'Fischer', 'Novak', 'Ashford', 'Quill', 'Moreno', 'Yilmaz', 'Hartley', 'Delacroix'];
const STREETS = ['Linden Ave', 'Harbor Rd', 'Mercer St', 'Alder Way', 'Quarry Ln', 'Kestrel Dr', 'Old Mill Rd', 'Fenwick St', 'Bayview Ter', 'Rowan Ct'];
const MAKES = ['grey Toyota Corolla', 'black Ford F-150', 'white Honda Civic', 'blue VW Golf', 'red Mazda 3', 'silver Nissan Altima', 'green Subaru Outback', 'black BMW 3-series', 'white Ford Transit van', 'maroon Chevy Malibu'];
const CRIMES = ['FAILURE TO APPEAR — THEFT', 'PROBATION VIOLATION', 'UNPAID FINES — DUI', 'BURGLARY 2ND DEGREE', 'POSSESSION W/ INTENT', 'FRAUD — 3 COUNTS'];
const VIOLENT = ['AGGRAVATED ASSAULT W/ WEAPON', 'ARMED ROBBERY', 'ASSAULT ON AN OFFICER', 'FIREARM OFFENCE — PROHIBITED PERSON'];

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
const plateOf = (rng: Rng) => `${rng.int(1, 9)}${'ABCDEFGHJKLMNPRSTUVWXYZ'[rng.int(0, 22)]}${'ABCDEFGHJKLMNPRSTUVWXYZ'[rng.int(0, 22)]}-${rng.int(100, 999)}`;

function personLines(rng: Rng, name: string, dob: string, flag: CheckResult): string[] {
  const [first, last] = name.split(' ');
  const l = [
    `NAM/${last.toUpperCase()}, ${first.toUpperCase()}   SEX/${rng.chance(0.5) ? 'M' : 'F'}   DOB/${dob}`,
    `ADR/${rng.int(10, 2400)} ${rng.pick(STREETS).toUpperCase()}, RAVENPORT`,
    `OLN/R${rng.int(1000000, 9999999)}   STATUS/${flag === 'suspended' ? 'SUSPENDED — UNPAID FINES / DUI' : 'VALID'}`,
  ];
  if (flag === 'warrant') l.push(`*** WANTED *** WARRANT #${rng.int(10000, 99999)} — ${rng.pick(CRIMES)}`, 'EXTRADITION: IN-STATE   CONFIRM WITH ORIGINATING AGENCY');
  else if (flag === 'caution') l.push(`*** WANTED *** WARRANT #${rng.int(10000, 99999)} — ${rng.pick(VIOLENT)}`, '!!! CAUTION: KNOWN TO CARRY WEAPONS — APPROACH WITH BACKUP !!!');
  else if (flag === 'missing') l.push(`*** MISSING PERSON *** ENTERED ${rng.int(2, 19)} DAYS AGO — ENDANGERED`, 'CONTACT RAVENPORT PD MISSING PERSONS UNIT');
  else l.push('WANTS/WARRANTS: NONE ON FILE');
  l.push(`PRIOR: ${flag === 'clear' && rng.chance(0.55) ? 'NONE' : `${rng.int(2008, 2024)} ${rng.pick(['THEFT (MISD)', 'DISORDERLY CONDUCT', 'DUI', 'TRESPASS', 'POSSESSION'])}`}`);
  return l;
}

function plateLines(rng: Rng, plate: string, make: string, owner: string, flag: CheckResult): string[] {
  const l = [
    `LIC/${plate}   STATE/RV   VEH/${make.toUpperCase()}`,
    `REG OWNER/${owner.toUpperCase()}`,
    `REG/${flag === 'expired' ? `EXPIRED ${pad(rng.int(1, 12))}/${rng.int(2021, 2025)} — NO INSURANCE ON FILE` : 'VALID'}`,
  ];
  if (flag === 'stolen') l.push(`*** STOLEN VEHICLE *** REPORTED ${rng.int(1, 9)} DAYS AGO — CASE #${rng.int(100000, 999999)}`, 'TREAT OCCUPANTS AS POSSIBLY ARMED');
  else if (flag === 'warrant') l.push(`REG OWNER HAS ACTIVE WARRANT #${rng.int(10000, 99999)} — ${rng.pick(CRIMES)}`);
  else l.push('NO STOLEN / NO WANTS');
  return l;
}

/** build a new officer request with its hidden truth and the records the terminal will return */
export function makeRequest(rng: Rng, id: string, unitId: string, incidentId: string | null, kind: 'person' | 'plate', at: number, risky = false): OfficerRequest {
  if (kind === 'person') {
    const truth: CheckResult = rng.weighted<[CheckResult, number]>([['clear', 52], ['warrant', 20], ['caution', risky ? 16 : 8], ['suspended', 12], ['missing', 4]], (x) => x[1])![0];
    const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    const dob = dobOf(rng);
    const hits: RecordHit[] = [{ name, dob, flag: truth, match: true, lines: personLines(rng, name, dob, truth) }];
    // a namesake with a different date of birth: read carefully
    if (rng.chance(0.4)) {
      let other = dobOf(rng);
      while (other === dob) other = dobOf(rng);
      const f: CheckResult = truth === 'clear' ? rng.pick<CheckResult>(['warrant', 'caution', 'clear']) : rng.pick<CheckResult>(['clear', 'clear', 'suspended']);
      hits.push({ name, dob: other, flag: f, match: false, lines: personLines(rng, name, other, f) });
    }
    return { id, unitId, incidentId, kind, at, status: 'open', subject: name, detail: `DOB ${dob}`, truth, hits: rng.shuffle(hits), ran: false, reminded: 0 };
  }
  const truth: CheckResult = rng.weighted<[CheckResult, number]>([['clear', 58], ['stolen', risky ? 22 : 13], ['expired', 18], ['warrant', 11]], (x) => x[1])![0];
  const plate = plateOf(rng);
  const make = rng.pick(MAKES);
  const owner = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
  return { id, unitId, incidentId, kind, at, status: 'open', subject: plate, detail: make, truth, hits: [{ name: owner, dob: '', flag: truth, match: true, lines: plateLines(rng, plate, make, owner, truth) }], ran: false, reminded: 0 };
}

/** what the officer says on the radio */
export function requestText(r: OfficerRequest, spoken: string, rng: Rng): string {
  if (r.kind === 'person') {
    return rng.pick([
      `Dispatch, ${spoken}. Can you run a subject for wants and warrants? ${r.subject}, date of birth ${r.detail.slice(4)}.`,
      `Dispatch, ${spoken}. Requesting a 10-29 on a ${r.subject}, DOB ${r.detail.slice(4)}. Subject's being evasive.`,
      `${spoken} to dispatch — ID check please. Last name ${r.subject.split(' ')[1]}, first ${r.subject.split(' ')[0]}, born ${r.detail.slice(4)}.`,
    ]);
  }
  return rng.pick([
    `Dispatch, ${spoken}. Run a plate for me — ${r.subject.split('').join(' ')}, ${r.detail}.`,
    `${spoken}, traffic stop. Can you check plate ${r.subject}? It's a ${r.detail}.`,
    `Dispatch, ${spoken}. 10-28 on plate ${r.subject}, ${r.detail}, occupied times two.`,
  ]);
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
