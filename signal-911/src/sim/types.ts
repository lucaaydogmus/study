// ─────────────────────────────────────────────────────────────────────────────
// Core types for SIGNAL 911. The simulation state is plain JSON-serialisable data so that
// a shift can be saved and restored; the engine (engine.ts) is the only thing that mutates it.
// ─────────────────────────────────────────────────────────────────────────────

export type Service = 'police' | 'fire' | 'medical';
export type Category = 'medical' | 'fire' | 'police' | 'unusual';

export type Capability =
  | 'patrol' | 'traffic' | 'crowd' | 'tactical' | 'police_supervisor' | 'prisoner_transport'
  | 'fire_suppression' | 'aerial' | 'rescue' | 'heavy_rescue' | 'water_rescue' | 'command'
  | 'bls' | 'als' | 'transport' | 'critical_transport' | 'med_supervisor' | 'air_support';

export interface Req { cap: Capability; n: number }

export type UnitStatus =
  | 'AVAILABLE' | 'DISPATCHED' | 'EN_ROUTE' | 'ON_SCENE' | 'BUSY'
  | 'TRANSPORTING' | 'RETURNING' | 'OUT_OF_SERVICE';

export type IncidentStatus =
  | 'REPORTED' | 'AWAITING_INFORMATION' | 'CLASSIFIED' | 'AWAITING_DISPATCH' | 'UNITS_EN_ROUTE'
  | 'ON_SCENE' | 'ESCALATING' | 'STABILIZING' | 'RESOLVED' | 'CLOSED';

export type Difficulty = 'casual' | 'standard' | 'hard' | 'expert';
export type WeatherType = 'clear' | 'rain' | 'snow' | 'fog' | 'storm' | 'heat';
export type FactVal = number | boolean | string;

export interface Vec { x: number; y: number }

// ── City ────────────────────────────────────────────────────────────────────
export type RoadClass = 'highway' | 'arterial' | 'local' | 'bridge';

export interface RoadNode {
  id: number; x: number; y: number; i: number; j: number; district: string;
  addrStreet: string; addrNumber: number; crossStreet: string;
}
export interface RoadEdge { id: number; a: number; b: number; len: number; cls: RoadClass; name: string }

export interface District {
  id: string; name: string; tags: string[]; poly: Vec[]; center: Vec; unlockRank: number;
  /** Relative traffic load 0..1 (before time-of-day/weather) */
  baseTraffic: number;
  /** Incident category weights */
  weights: Record<Category, number>;
  blurb: string;
}
export interface Landmark { id: string; name: string; kind: string; nodeId: number; district: string }

// ── Fleet & personnel ───────────────────────────────────────────────────────
export interface Personnel {
  id: string; name: string; service: Service;
  experience: number; training: number; medical: number; fire: number; driving: number; policing: number;
  fatigue: number; morale: number; reliability: number;
  salary: number; unitId: string | null; specialty: string;
}

export interface Unit {
  id: string; callsign: string; spoken: string; service: Service; type: string; typeLabel: string;
  status: UnitStatus; x: number; y: number; prevNode: number;
  stationId: string; postNode: number;
  assignedIncidentId?: string;
  route: number[]; destNode: number | null; eta: number | null; speed: number;
  capabilities: Capability[]; personnelIds: string[]; crewSeats: number; minCrew: number;
  speedModifier: number; equipment: string; timer: number; value: number;
  /** patient on board (medical transport) */
  patients: number;
  lastRadio: number;
  deployments: number;
  note?: string; temp?: boolean;
  code?: 2 | 3; crashAt?: number | null; stoppedUntil?: number;
  /** aircraft only: fuel 0..100 */
  fuel?: number;
  /** police cars cruise their beat while available; false = wait at the station */
  patrol?: boolean;
  /** fire/EMS told to stage short of an unsafe scene until police secure it */
  staging?: boolean; stagedAt?: number | null;
  /** search incidents: the sector this crew is sweeping */
  searchSector?: number | null;
  /** police on scene: when dispatch owes them a status check, when they last had one, and (hidden) when things go wrong */
  checkDue?: number | null; lastCheck?: number; trouble?: number | null;
}

export interface Station {
  id: string; name: string; service: Service; nodeId: number; district: string; capacity: number; disabledShifts: number;
}

export interface UpgradeLevels { [id: string]: number }

// ── Calls & dialogue ────────────────────────────────────────────────────────
export interface CallerProfile {
  id: string; name: string; age: number; archetype: string; personality: string;
  emotionalState: string; panicLevel: number; cooperationLevel: number; speakingStyle: string;
  knownFacts: string[]; unknownFacts: string[]; relationshipToIncident: string; scenarioId: string;
  locationAccuracy: 'exact' | 'street' | 'landmark' | 'wrong' | 'unknown';
  callerIdType: 'mobile' | 'landline' | 'voip' | 'payphone';
  ambience: string; phone: string;
  persona?: { occupation: string; quirk: string; background: string; catchphrase: string; voice: string };
  /** how this person talks (see voices.ts) */
  voice?: CallerVoice;
  /** the caller does not speak English: nothing useful until an interpreter joins */
  language?: string;
}
export interface CallerVoice {
  tic: string | null; address: string | null; catchphrase: string | null; tangents: string[];
  formal: boolean; slang: boolean; caps: boolean; stutter: boolean; trail: boolean; short: boolean;
}

export interface TranscriptLine { t: number; clock: string; who: 'CALLER' | 'DISPATCHER' | 'SYSTEM'; text: string }

export interface HeardLocation {
  id: string; nodeId: number; label: string; source: 'address' | 'landmark' | 'cross' | 'ali' | 'district';
  reliability: 'sure' | 'unsure' | 'contradicted'; at: number;
}

export interface Mood { panic: number; base: number; cooperation: number; frustration: number; trust: number }

export interface PendingLine {
  at: number; text: string; facts?: Record<string, FactVal>; unsure?: string[]; heard?: Omit<HeardLocation, 'id' | 'at'>[];
  /** AI voicing: line ids are held until the dialogue model rewrites them (or a timeout releases the scripted text) */
  id?: number; hold?: boolean; ai?: boolean; system?: boolean;
  twist?: boolean; hangup?: boolean; endReason?: string;
}

export interface Call {
  id: string; incidentId: string; state: 'ringing' | 'active' | 'hold' | 'ended' | 'missed';
  profile: CallerProfile; isCallback: boolean; callerId: string;
  ringStart: number; ringTimeout: number; answeredAt: number | null; endedAt: number | null;
  transcript: TranscriptLine[]; mood: Mood; asked: Record<string, number>;
  promises: string[]; promiseAt: number | null; complained: number;
  heard: HeardLocation[]; usedLines: Record<string, number>; pending: PendingLine[];
  holdSince: number | null; holdTotal: number; aliUsed: boolean; verifyAsked: number[];
  locPlan: { wrong: number; approx: number; landmark: string | null; wrongDistrict: string };
  typing: boolean; endReason?: string; spokeFirst: boolean; callbackOf?: string; misunderstood: number; peakPanic?: number; calmed?: boolean;
  /** last time the caller volunteered something */
  lastSpontaneous: number; stateNote: string;
  /** the caller has heard the first siren approaching (said once, only when a unit is actually close) */
  heardSirens?: boolean;
  /** Language Line interpreter */
  interpreter?: 'connecting' | 'on'; interpreterAt?: number;
  /** carrier location trace: an uncertainty circle that tightens over time */
  trace?: CallTrace | null;
  /** silent caller: the dispatcher set up "tap twice for yes" */
  tapProtocol?: boolean;
  outbound?: boolean;
  /** the caller asked the dispatcher something and is waiting on an answer */
  question?: CallerQuestion | null; questionsAsked?: string[]; lastQuestionAt?: number;
  /** "any second now" was promised: if help is not there by then, trust takes a hit */
  overpromiseAt?: number | null;
  /** pursuit witness told to keep following (or to stop) */
  following?: boolean; stopFollowing?: boolean;
}
/** a caller asks the dispatcher what to do; the answer (or silence) has consequences */
export interface CallerQuestion { kind: string; text: string; at: number; expiresAt: number; lineIdx: number; options: Array<{ id: string; label: string; say: string; reply: string; effect: string }>; timeout: { effect: string; line: string } }
export type Dept = 'trauma' | 'cardiac' | 'stroke' | 'pediatric' | 'burns';
export interface HospitalState {
  node: number; name: string; has: Dept[]; down: Partial<Record<Dept, number>>; er: number; erCap: number; nextEvent: number; lastDecay: number;
  /** what the dispatcher's bed board shows (it goes stale until refreshed) */
  known: { at: number; er: number; down: Dept[]; diversion: boolean } | null;
  prealerts: string[];
}
export interface Decision {
  id: string; incId: string; unitId: string; at: number; expiresAt: number; kind: string; prompt: string;
  options: Array<{ id: string; label: string; hint: string }>; defaultId: string; chosen?: string; outcome?: string; auto?: boolean;
}
/** be-on-the-lookout broadcast: patrols watch for a suspect the caller described */
export interface Bolo {
  id: string; incId: string; at: number; expiresAt: number; text: string; quality: number;
  /** hidden truth: is the suspect still out there, and in a vehicle? */
  atLarge: boolean; vehicle: boolean;
  status: 'active' | 'found' | 'expired'; foundBy?: string;
}
/** a spike strip run out ahead of a fleeing vehicle */
export interface Stinger { id: string; unitId: string; incId: string; node: number; laidAt: number | null; expiresAt: number; result?: 'hit' | 'missed' | 'cancelled' }
export interface CallTrace {
  startedAt: number; stage: number; stages: Array<{ at: number; radius: number; label: string }>;
  x: number; y: number; radius: number; label: string; done: boolean; wrongNode?: number | null;
}

export interface Fact {
  key: string; label: string; value: FactVal; confidence: 'confirmed' | 'unconfirmed' | 'contradicted';
  source: 'caller' | 'ali' | 'scene' | 'dispatcher'; at: number;
}

// ── Incidents ───────────────────────────────────────────────────────────────
export type Outcome = 'success' | 'partial' | 'failed' | 'false_alarm' | 'mishandled' | 'handover' | 'lost' | 'merged';

/** a fleeing suspect vehicle that moves along the road network */
export interface Mover {
  x: number; y: number; prev: number; next: number; came: number; speed: number; tracked: boolean; trail: Vec[]; startAt: number; lastUpdate: number; lastSighting: number; contact: number; heading: number;
  /** air unit with eyes on the vehicle (positions only reach ground units when dispatch relays them) */
  heliId?: string | null; heliSince?: number; lastHeliReport?: number; evadeUntil?: number;
}

export interface Fx { id: number; t: number; kind: 'good' | 'bad' | 'warn' | 'info'; x: number; y: number; text: string }

export interface Incident {
  id: string; num: number; templateId: string; category: Category; label: string; severity: number;
  status: IncidentStatus; nodeId: number; district: string;
  /** location the dispatcher committed to (may differ from nodeId if caller was wrong) */
  reportedNode: number | null; locationConfirmed: boolean;
  classification: string | null;
  callId: string | null; callerName: string;
  requires: Req[]; knownReqs: Req[]; stage: number; maxStage: number;
  threat: number; growth: number; clear: number; work: number;
  assignedUnits: string[]; everAssigned: string[];
  createdAt: number; answeredAt: number | null; locatedAt: number | null; firstArrivalAt: number | null;
  resolvedAt: number | null; lastStageAt: number;
  facts: Fact[]; truth: Record<string, FactVal>; knows: string[]; unsureKeys: string[];
  notes: string; outcome?: Outcome; casualties: number; saved: number; needsTransport: boolean;
  twistRevealed: boolean; dismissed: boolean; hidden: boolean;
  stabilizeTimer: number; callbackAt: number | null; callbackCount: number; missedCalls: number;
  safetyAdvised: boolean; wrongLocationArrivals: number; sceneReported: boolean;
  unnecessary: number; relatedIds: string[]; eventId?: string; lostReason?: string;
  workProgress: number; patientsTransported: number; mislocated: boolean; scenarioTag?: string;
  firstDispatchAt: number | null; timelineBlock: boolean; callerProfile: CallerProfile;
  vars: Record<string, string>; blockedEdge: number | null; sceneSeen: boolean; twist: import('./content/templates').Twist | null; sceneAt: number | null; escalatedAt: number | null; mutualAid: number;
  duplicateOf: string | null; dupPlan: number[]; pursuit: boolean; mover: Mover | null; mergedInto: string | null;
  aid?: { kind: string; fit: 'good' | 'bad' | 'neutral'; at: number; encouragedAt: number; pacedAt?: number; paceStartedAt?: number; lastPaceLine?: number } | null;
  /** something unstoppable happens at this time (an aircraft touches down); responders must be staged first */
  deadlineAt?: number | null; deadlineMet?: boolean | null;
  /** incident this one broke out of (getaway van from a bank robbery, a victim fleeing a shooting) */
  parentId?: string | null;
  /** patient survival 0..100 while a life threat is untreated; dispatcher guidance changes how fast it falls */
  survival?: number; lifeThreat?: 'arrest' | 'bleed' | 'airway' | null; careAt?: number | null;
  /** what the dispatcher's guidance did, for the report */
  consequences?: string[]; relayedAt?: number; checkRolled?: boolean;
  /** crews were given the caller's information on the radio */
  briefedAt?: number | null; briefedFacts?: number;
  /** officer-initiated (on-view) incident */
  onView?: boolean; hospitalNode?: number | null;
  cctvAt?: number; decided?: boolean; spread?: boolean; storyline?: string;
  /** crews asked for access details (flat number, gate code) on the way in */
  accessNeeded?: { at: number; relayed: boolean } | null; accessDelayUntil?: number;
  /** how well the receiving hospital matched the patient */
  hospitalOutcome?: 'ideal' | 'ok' | 'unsuitable'; hospitalAsked?: boolean;
  /** an outside agency the crews need before the scene can clear (tow truck, power or gas company, animal control) */
  agency?: { kind: AgencyKind; askedAt: number | null; calledAt: number | null; arriveAt: number | null; here: boolean; nagged: number; late?: boolean } | null;
  /** missing-person search: sectors around the last-seen point */
  search?: SearchGrid | null;
  /** public emergency alert issued for the incident's district */
  alert?: { kind: AlertKind; at: number; right: boolean; needed: boolean } | null;
}
export type AgencyKind = 'tow' | 'power' | 'gas' | 'animal';
export type AlertKind = 'evacuate' | 'shelter';
export interface SearchSector { id: string; x: number; y: number; node: number; p: number; searched: number; cleared?: boolean }
export interface SearchGrid {
  cx: number; cy: number; r: number; sectors: SearchSector[];
  /** hidden: the sector the person is in (-1 when the grid was drawn around the wrong place) */
  target: number; origin: number; found: boolean; foundAt?: number; exhausted?: boolean;
}

/** an officer on the radio asking dispatch to run someone or something through records */
export type CheckResult = 'clear' | 'warrant' | 'caution' | 'suspended' | 'missing' | 'stolen' | 'expired';
export interface PersonRecord {
  last: string; first: string; middle: string; dob: string; sex: 'M' | 'F'; height: string; weight: number; hair: string; eyes: string; address: string;
  oln: string; olnStatus: 'VALID' | 'SUSPENDED' | 'EXPIRED'; warrants: Array<{ num: string; charge: string; level: 'FELONY' | 'MISD' }>;
  priors: Array<{ year: number; charge: string }>; caution: string | null; marks: string; missing: boolean;
}
export interface VehicleRecord {
  plate: string; state: string; year: number; make: string; model: string; color: string; owner: string; ownerAddress: string;
  reg: 'VALID' | 'EXPIRED'; insured: boolean; stolen: { date: string; caseNo: string } | null; ownerWarrant: boolean;
}
export interface RecordHit { person?: PersonRecord; vehicle?: VehicleRecord; flag: CheckResult; match: boolean }
export interface OfficerRequest {
  id: string; unitId: string; incidentId: string | null; kind: 'person' | 'plate';
  at: number; status: 'open' | 'answered' | 'expired';
  subject: string; detail: string;
  /** what the officer read out on the radio */
  given: { last: string; first: string; dob: string; sex: 'M' | 'F' } | { plate: string; state: string; vehicle: string };
  truth: CheckResult; db: RecordHit[]; ran: boolean; ranAt?: number; searches: number; mistakes: number;
  answer?: CheckResult; answeredAt?: number; reminded: number; correct?: boolean; announced?: boolean; text?: string;
}

// ── City events / weather / config ──────────────────────────────────────────
export type CityEventType = 'storm' | 'blackout' | 'flood' | 'festival' | 'rush_hour' | 'industrial_fire' | 'winter_storm' | 'heat_wave';
export interface CityEvent {
  id: string; type: CityEventType; name: string; start: number; end: number; districts: string[];
  trafficMult: number; incidentMult: number; categoryBias: Partial<Record<Category, number>>;
  templateBias: Record<string, number>; closedEdges: number[]; announced: boolean; active: boolean; description: string;
}

export interface Objective { id: string; text: string; kind: string; target: number; value?: number; done?: boolean; optional?: boolean }

export interface ShiftConfig {
  mode: 'career' | 'free' | 'endless' | 'scenario' | 'tutorial';
  scenarioId?: string; chapterId?: string; title: string; briefing: string;
  difficulty: Difficulty; durationSec: number; weather: WeatherType; startHour: number;
  incidentRate: number; // multiplier
  districts: string[];  // active districts
  events: Array<{ type: CityEventType; at: number; duration: number; districts?: string[] }>;
  objectives: Objective[];
  seed: number;
  /** scripted spawns (tutorial) */
  script?: Array<{ at: number; template: string; district?: string; archetype?: string; accuracy?: CallerProfile['locationAccuracy'] }>;
  ignoreGovernor?: boolean;
  hideIntense?: boolean;
  endlessWave?: number;
  startUnitsMax?: number;
  startBudget?: number;
  reducedFleet?: boolean;
  noSpawnAfterSec?: number;
  unusualBias?: number;
  modifiers?: string[];
  contracts?: Array<{ id: string; target: number }>;
  daily?: string;
  /** guaranteed incidents on top of the random ones (scenario set pieces) */
  forced?: Array<{ at: number; template: string; district?: string; archetype?: string; story?: string; first?: boolean }>;
  /** a live storyline (major incident chain) rolled for this shift */
  storyline?: { id: string; title: string; headline: string; at: number };
}

export interface TimelineEntry {
  t: number; kind: 'call' | 'dispatch' | 'arrival' | 'escalation' | 'resolved' | 'failed' | 'event' | 'radio' | 'info' | 'missed';
  text: string; incidentId?: string; unitId?: string; good?: boolean | null;
}

export interface RadioMsg { id: string; t: number; clock: string; from: string; text: string; unitId?: string; incidentId?: string; kind: 'unit' | 'dispatch' | 'alert' | 'hospital' | 'chatter'; to?: string }

export interface Notification { id: string; t: number; text: string; level: 'info' | 'good' | 'warn' | 'bad'; incidentId?: string }

export interface ShiftStats {
  callsReceived: number; callsAnswered: number; callsMissed: number; answerTimes: number[];
  responseTimes: number[]; resolved: number; failed: number; falseAlarms: number; mishandled: number;
  casualties: number; livesHelped: number; unnecessary: number; dispatches: number; correctDispatches: number;
  wrongLocations: number; locationChecks: number; costs: number; income: number; bonus: number;
  coverageSamples: Record<Service, number[]>; districtCoverage: Record<string, number[]>;
  serviceResponse: Record<Service, number[]>; unitBusySeconds: number; unitSeconds: number; handedOver: number;
  byCategory: Record<string, { n: number; ok: number }>; callbacks: number; escalations: number; promisesBroken: number;
  merges: number; wrongLinks: number; pursuitsCaught: number; verifiedOk: number; cleanFalseAlarms: number; bestStreak: number; calmedCallers: number; transfersOk: number; mutualAid: number; contractBonus: number;
  aidGood: number; aidBad: number; unitCrashes: number; breakdowns: number; aiLines: number;
  heliRelays: number; heliSightings: number; checksOk: number; checksBad: number; checksMissed: number; guidanceDeaths: number; guidanceSaves: number; harmfulAdvice: number;
  boloHits?: number; stingerHits?: number; breaksGiven?: number;
  callerAnswers?: number; cprPaced?: number; handoffs?: number;
  agencyCalls?: number; agencyLate?: number; statusChecks?: number; statusSaves?: number; statusMissed?: number; alertsRight?: number; alertsWrong?: number; searchFinds?: number;
}

export interface GameState {
  version: number; seed: number; rngState: number; config: ShiftConfig;
  time: number; speed: number; paused: boolean; phase: 'running' | 'ended';
  weather: WeatherType; weatherIntensity: number; nextWeatherChange: number; timeOfDay: number; // hour
  units: Record<string, Unit>; stations: Record<string, Station>; personnel: Record<string, Personnel>;
  incidents: Record<string, Incident>; calls: Record<string, Call>;
  activeCallId: string | null; incidentCounter: number; callCounter: number;
  events: CityEvent[]; closedEdges: number[]; districtTraffic: Record<string, number>;
  radio: RadioMsg[]; timeline: TimelineEntry[]; notifications: Notification[];
  stats: ShiftStats; upgrades: UpgradeLevels; rank: number; reputation: number; budget: number;
  nextSpawnAt: number; spawnedScripted: number; scriptIndex: number;
  selected: { kind: 'incident' | 'unit' | 'station' | 'district' | null; id: string | null };
  flags: Record<string, boolean>; dispatcherLoad: number;
  assistantFreeAt: number; lastCoverage: number; uniqueNameCounter: number; endingAt: number | null;
  scoreBreakdown?: ShiftScore;
  streak: number; fx: Fx[]; fxCounter: number; closedHospitals: number[]; lineCounter: number;
  forcedIndex?: number;
  requests: OfficerRequest[]; requestCounter: number; nextStopAt: number; nextOnViewAt?: number;
  /** recent admissions per hospital node (times), for capacity and diversion */
  hospitalLoad?: Record<number, number[]>;
  /** tactical questions from crews on scene */
  decisions?: Decision[];
  bolos?: Bolo[]; stingers?: Stinger[]; nextBreakAt?: number;
  /** worried residents ringing in after a public alert */
  alertCalls?: Array<{ at: number; district: string }>;
  /** headlines for the news ticker */
  news?: Array<{ t: number; text: string; tone: 'good' | 'bad' | 'info' }>;
  /** hospital departments, beds and diversions, keyed by hospital node */
  hospitals?: Record<string, HospitalState>;
  lastChatter?: number;
}

export interface ShiftScore {
  total: number; grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  response: number; outcomes: number; accuracy: number; calls: number; coverage: number; penalties: number;
}

export interface CityState { closedRoads: Array<{ edge: number; shifts: number }>; districtTraffic: Record<string, number>; damagedStations: Record<string, number>; log: string[] }

export const GRADE_ORDER: ShiftScore['grade'][] = ['F', 'D', 'C', 'B', 'A', 'S'];
