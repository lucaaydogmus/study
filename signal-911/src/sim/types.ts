// ─────────────────────────────────────────────────────────────────────────────
// Core types for SIGNAL 911. The simulation state is plain JSON-serialisable data so that
// a shift can be saved and restored; the engine (engine.ts) is the only thing that mutates it.
// ─────────────────────────────────────────────────────────────────────────────

export type Service = 'police' | 'fire' | 'medical';
export type Category = 'medical' | 'fire' | 'police' | 'unusual';

export type Capability =
  | 'patrol' | 'traffic' | 'crowd' | 'tactical' | 'police_supervisor' | 'prisoner_transport'
  | 'fire_suppression' | 'aerial' | 'rescue' | 'heavy_rescue' | 'water_rescue' | 'command'
  | 'bls' | 'als' | 'transport' | 'critical_transport' | 'med_supervisor';

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
}

export interface TranscriptLine { t: number; clock: string; who: 'CALLER' | 'DISPATCHER' | 'SYSTEM'; text: string }

export interface HeardLocation {
  id: string; nodeId: number; label: string; source: 'address' | 'landmark' | 'cross' | 'ali' | 'district';
  reliability: 'sure' | 'unsure' | 'contradicted'; at: number;
}

export interface Mood { panic: number; base: number; cooperation: number; frustration: number; trust: number }

export interface PendingLine {
  at: number; text: string; facts?: Record<string, FactVal>; unsure?: string[]; heard?: Omit<HeardLocation, 'id' | 'at'>[];
  twist?: boolean; hangup?: boolean;
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
  typing: boolean; endReason?: string; spokeFirst: boolean; callbackOf?: string; misunderstood: number;
  /** last time the caller volunteered something */
  lastSpontaneous: number; stateNote: string;
}

export interface Fact {
  key: string; label: string; value: FactVal; confidence: 'confirmed' | 'unconfirmed' | 'contradicted';
  source: 'caller' | 'ali' | 'scene' | 'dispatcher'; at: number;
}

// ── Incidents ───────────────────────────────────────────────────────────────
export type Outcome = 'success' | 'partial' | 'failed' | 'false_alarm' | 'mishandled' | 'handover' | 'lost';

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
}

export interface TimelineEntry {
  t: number; kind: 'call' | 'dispatch' | 'arrival' | 'escalation' | 'resolved' | 'failed' | 'event' | 'radio' | 'info' | 'missed';
  text: string; incidentId?: string; unitId?: string; good?: boolean | null;
}

export interface RadioMsg { id: string; t: number; clock: string; from: string; text: string; unitId?: string; incidentId?: string; kind: 'unit' | 'dispatch' | 'alert' }

export interface Notification { id: string; t: number; text: string; level: 'info' | 'good' | 'warn' | 'bad'; incidentId?: string }

export interface ShiftStats {
  callsReceived: number; callsAnswered: number; callsMissed: number; answerTimes: number[];
  responseTimes: number[]; resolved: number; failed: number; falseAlarms: number; mishandled: number;
  casualties: number; livesHelped: number; unnecessary: number; dispatches: number; correctDispatches: number;
  wrongLocations: number; locationChecks: number; costs: number; income: number; bonus: number;
  coverageSamples: Record<Service, number[]>; districtCoverage: Record<string, number[]>;
  serviceResponse: Record<Service, number[]>; unitBusySeconds: number; unitSeconds: number; handedOver: number;
  byCategory: Record<string, { n: number; ok: number }>; callbacks: number; escalations: number; promisesBroken: number;
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
}

export interface ShiftScore {
  total: number; grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  response: number; outcomes: number; accuracy: number; calls: number; coverage: number; penalties: number;
}

export interface CityState { closedRoads: Array<{ edge: number; shifts: number }>; districtTraffic: Record<string, number>; damagedStations: Record<string, number>; log: string[] }

export const GRADE_ORDER: ShiftScore['grade'][] = ['F', 'D', 'C', 'B', 'A', 'S'];
