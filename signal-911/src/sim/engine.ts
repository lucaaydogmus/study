// The authoritative game engine: a deterministic, tick-based simulation of Ravenport dispatch.
// The UI only reads `engine.state` and calls the public action methods; the caller dialogue
// layer (dialogue.ts) can never mutate protected state directly — it only returns lines that the
// engine validates and applies.
import { addressOf, fullAddress, getCity, type City } from './city';
import { Rng } from './rng';
import { ARCHETYPES, CLASSES, CLASS_BY_ID, FACT_LABELS, adaptReqForRank, CAP_LABEL } from './content/vocab';
import { TEMPLATES, TEMPLATE_BY_ID, type Template } from './content/templates';
import { backgroundClue } from './content/clues';
import { aidVerdict, lifeThreatOf, FIRE_LIKE, TOPIC_FACTS, aliLookup, classifyIntent, makeCallerProfile, makeLocPlan, makeVars, fill, openingLines, replyTo, spontaneous, verifyReply, QUICK_QUESTIONS, type DialogueEnv, type Intent } from './dialogue';
import { EVENT_DEFS, WEATHER_SPEED, WEATHER_TRAFFIC, WEATHER_LABEL, nextWeather } from './events';
import { numWord, UNIT_TYPE_BY_ID, makeUnit, isAir, AIR_SPEED } from './fleet';
import { cameraList, cctvTracking, type Camera } from './cctv';
import { needsTick } from './radioreq';
import { matchOption } from './replies';
import { aidOutTick, cadDown, cadTick, decideAidOut, directiveTick, hoaxTick, learnPremise, maybeText, premiseArrival, pursuitRisk, textSpeak } from './ops';
import { bookPrisoner, buildingsTick, onReturn, reTone, suppliesFactor, turnoutDelay, useSupplies } from './buildings';
import { emergencyActivation, emergencyTick, heldTick, isHeld, maybeBreak, patchAskTick, radioQueueTick, reportPosition, talkgroupOf } from './radioops';
import { addStress, commandFactor, commandTick, decideStress, stormTick, stressFactor, stressTick } from './field';
import { getCloser, landmarkNear, pullOver, relayBlock, relaysTick, regularOnAnswer, regularOutcome, regularsTick, setupThirdParty, thirdPartyBlock, thirdPartyTick, updateMovingCaller } from './callers';
import { applyFit, KIT_BY_ID } from './garage';
import { makeRequest, requestText, replyText, returnText, searchRecords, CHECK_LABEL, DANGEROUS, type RecordQuery } from './records';
import { speak } from './voices';
import { edgeSpeed, findRoute, makeClosedMask, multiSourceTimes, routeTime, TIME_COMPRESS, type TrafficModel } from './routing';
import { computeScore, evaluateObjectives } from './scoring';
import { modProduct, MODIFIER_BY_ID } from './extras';
import type {
  Call, CallerProfile, CityEvent, CityState, Capability, Fact, FactVal, GameState, HeardLocation, Incident, IncidentStatus, Outcome, Personnel, Req,
  Service, ShiftConfig, ShiftStats, Station, Unit, UpgradeLevels, TimelineEntry, OfficerRequest, CheckResult, Decision, Dept, HospitalState,
  AgencyKind, AlertKind, SearchGrid, SpecialistKind,
} from './types';

export const DT = 0.5;
/** topics a free-form AI answer may reveal, mapped to the fact keys the engine then records */
export const REVEAL_KEYS = TOPIC_FACTS as Record<string, string[]>;
export const STATE_VERSION = 1;
/** global pacing knob: scales how quickly unattended incidents deteriorate */
export const THREAT_SCALE = 0.55;
/** escalating incidents never sit still for long: the slowest one still reaches its next stage in about three minutes */
export const STAGE_FLOOR = 0.27;

/** outside agencies crews ask dispatch to call */
export const AGENCY: Record<AgencyKind, { name: string; short: string; cost: number; eta: [number, number]; ask: string[] }> = {
  tow: { name: 'Tow truck', short: 'TOW', cost: 150, eta: [45, 85], ask: ["We'll need a tow truck — these vehicles aren't going anywhere on their own.", 'Can you roll a wrecker? Both cars are undriveable and blocking the lane.'] },
  power: { name: 'Power company', short: 'POWER CO', cost: 250, eta: [60, 110], ask: ['We need the power company to kill the feed before we can make this safe.', 'Get the utility out here — that line is still live.'] },
  gas: { name: 'Gas company', short: 'GAS CO', cost: 250, eta: [55, 100], ask: ['Request the gas company to isolate the main.', 'We need the gas utility to shut it off at the street.'] },
  animal: { name: 'Animal control', short: 'ANIMAL CTRL', cost: 120, eta: [45, 85], ask: ["Can we get animal control out here? We've got it cornered but can't transport it.", 'Requesting animal control with a trailer.'] },
};
export const AGENCY_FOR: Record<string, AgencyKind> = {
  collision_minor: 'tow', collision_injury: 'tow', collision_trapped: 'tow', collision_multi: 'tow', vehicle_fire: 'tow', tanker_fire: 'tow',
  power_line_down: 'power', gas_leak: 'gas', house_explosion: 'gas', escaped_animal: 'animal', animal_burglar: 'animal',
};
/** outside specialists for the very worst days: a federal tactical team and National Guard bomb technicians */
export const SPECIALIST: Record<SpecialistKind, { name: string; short: string; unitType: string; cost: number; mobilise: [number, number]; spoken: string; ask: string[]; arrive: string }> = {
  federal: { name: 'Federal Tactical Team', short: 'FED', unitType: 'federal_tactical', cost: 9000, mobilise: [70, 110], spoken: 'Federal Team',
    ask: ['This is beyond what we have here — recommend you request the federal tactical team.', 'Dispatch, we are outgunned. Get the feds rolling — tactical and a negotiator.'],
    arrive: 'Federal tactical team on scene — we have command of the inner cordon.' },
  eod: { name: 'National Guard EOD', short: 'EOD', unitType: 'guard_eod', cost: 6000, mobilise: [55, 95], spoken: 'Guard EOD',
    ask: ['We need bomb technicians here — get EOD rolling, nobody goes near this thing until they arrive.', 'Dispatch, we have a possible device. Request EOD — National Guard if the bomb squad is not available.'],
    arrive: 'Guard EOD on scene. Robot is going down to the device now.' },
};
/** which incidents can use which specialist */
export const SPECIALIST_FOR: Record<string, SpecialistKind> = {
  active_shooter: 'federal', hostage_barricade: 'federal', kidnapping: 'federal', bank_robbery: 'federal', vehicle_ramming: 'federal', riot: 'federal',
  bomb_threat: 'eod', suspicious_package: 'eod',
};
/** the outside-resources catalogue: everything dispatch can phone in, from a tow truck to the federal team */
export type ResourceKind = 'agency' | 'unit' | 'mutual';
export interface ResourceDef { id: string; name: string; short: string; group: string; kind: ResourceKind; cost: number; eta: [number, number]; desc: string; icon: string; unitType?: string; spoken?: string; cap?: Capability; arrive?: string; templates?: string[] }
export const RESOURCE_GROUPS = ['Utilities & city services', 'Police specialists', 'Fire & rescue specialists', 'Federal & military', 'Mutual aid'] as const;
export const RESOURCES: ResourceDef[] = [
  { id: 'tow', name: 'Tow truck', short: 'TOW', group: 'Utilities & city services', kind: 'agency', cost: 150, eta: [45, 85], icon: 'car', desc: 'Clears wrecked and disabled vehicles so the road can reopen.' },
  { id: 'power', name: 'Power company', short: 'POWER CO', group: 'Utilities & city services', kind: 'agency', cost: 250, eta: [60, 110], icon: 'bolt', desc: 'Kills live feeds and makes downed lines safe.' },
  { id: 'gas', name: 'Gas company', short: 'GAS CO', group: 'Utilities & city services', kind: 'agency', cost: 250, eta: [55, 100], icon: 'flame', desc: 'Isolates gas mains at the street.' },
  { id: 'animal', name: 'Animal control', short: 'ANIMAL CTRL', group: 'Utilities & city services', kind: 'agency', cost: 120, eta: [45, 85], icon: 'heart', desc: 'Captures and removes dangerous or loose animals.' },
  { id: 'publicworks', name: 'Public works road crew', short: 'DPW', group: 'Utilities & city services', kind: 'agency', cost: 600, eta: [70, 130], icon: 'wrench', desc: 'Clears debris, sandbags and reopens blocked roads.', templates: ['collision_multi', 'collision_trapped', 'tanker_fire', 'building_collapse', 'flooded_basement', 'water_rescue', 'power_line_down', 'protest_march', 'riot', 'vehicle_ramming'] },
  { id: 'transit', name: 'Transit authority', short: 'TRANSIT', group: 'Utilities & city services', kind: 'agency', cost: 0, eta: [15, 35], icon: 'clock', desc: 'Stops trains and diverts buses around the scene.', templates: ['train_derailment', 'bomb_threat', 'suspicious_package', 'riot', 'protest_march', 'crowd_crush'] },
  { id: 'redcross', name: 'Red Cross disaster team', short: 'RED CROSS', group: 'Utilities & city services', kind: 'agency', cost: 0, eta: [90, 160], icon: 'heart', desc: 'Shelter, food and care for families who have lost their homes.', templates: ['apartment_fire', 'house_explosion', 'building_collapse', 'flooded_basement', 'kitchen_fire', 'electrical_fire'] },
  { id: 'coroner', name: 'Medical examiner', short: 'M.E.', group: 'Utilities & city services', kind: 'agency', cost: 400, eta: [90, 150], icon: 'note', desc: 'Takes charge of the deceased so crews can clear the scene.' },
  { id: 'k9', name: 'K-9 unit', short: 'K9', group: 'Police specialists', kind: 'unit', unitType: 'k9_unit', spoken: 'K-Nine', cost: 800, eta: [25, 50], icon: 'search', desc: 'A tracking and detection dog: finds missing people, hidden suspects and explosives.', arrive: 'K-9 on scene. Dog is working.', templates: ['missing_person', 'lost_child', 'lost_hiker', 'burglary_progress', 'suspicious_activity', 'robbery', 'kidnapping', 'suspicious_package', 'bomb_threat', 'trespassing'] },
  { id: 'negotiator', name: 'Crisis negotiation team', short: 'CNT', group: 'Police specialists', kind: 'unit', unitType: 'negotiator_team', spoken: 'Negotiator', cost: 2000, eta: [45, 85], icon: 'phone', desc: 'Trained negotiators for sieges, hostage-takers and people in crisis.', arrive: 'Negotiators on scene. We have the phone line.', templates: ['hostage_barricade', 'kidnapping', 'bank_robbery', 'domestic_disturbance', 'silent_call'] },
  { id: 'regional_hazmat', name: 'Regional hazmat team', short: 'RHT', group: 'Fire & rescue specialists', kind: 'unit', unitType: 'regional_hazmat', spoken: 'Regional Hazmat', cost: 3500, eta: [70, 120], icon: 'alert', desc: 'Level A suits, a decon line and a detection lab for chemical releases.', arrive: 'Regional hazmat on scene. Setting up the hot zone and decon.', templates: ['hazmat_spill', 'gas_leak', 'tanker_fire', 'train_derailment', 'industrial_accident', 'carbon_monoxide', 'warehouse_smoke'] },
  { id: 'usar', name: 'Urban search & rescue', short: 'USAR', group: 'Fire & rescue specialists', kind: 'unit', unitType: 'usar', spoken: 'Task Force', cost: 5000, eta: [100, 160], icon: 'wrench', desc: 'A state task force with shoring, listening gear and search dogs for collapses.', arrive: 'Task force on scene. Shoring and search teams going in.', templates: ['building_collapse', 'house_explosion', 'train_derailment', 'collision_trapped', 'crowd_crush', 'industrial_accident'] },
  { id: 'coast_guard', name: 'Coast Guard rescue', short: 'USCG', group: 'Fire & rescue specialists', kind: 'unit', unitType: 'coast_guard', spoken: 'Coast Guard', cost: 3000, eta: [60, 110], icon: 'pin', desc: 'Rescue swimmers and a fast boat for the river and the bay.', arrive: 'Coast Guard on scene, boat in the water.', templates: ['water_rescue', 'boat_fire', 'flooded_basement'] },
  { id: 'federal', name: 'Federal tactical team', short: 'FED', group: 'Federal & military', kind: 'unit', unitType: 'federal_tactical', cost: 9000, eta: [70, 110], icon: 'shield', desc: 'An elite federal hostage-rescue team with a negotiator. Slow to mobilise, decisive on arrival.' },
  { id: 'eod', name: 'National Guard EOD', short: 'EOD', group: 'Federal & military', kind: 'unit', unitType: 'guard_eod', cost: 6000, eta: [55, 95], icon: 'alert', desc: 'Army bomb technicians with a robot: the safe way to deal with a device.' },
  { id: 'ma_police', name: 'Mutual aid — police', short: 'MA-PD', group: 'Mutual aid', kind: 'mutual', cap: 'patrol', cost: 4000, eta: [60, 120], icon: 'shield', desc: 'A patrol car from a neighbouring city.' },
  { id: 'ma_fire', name: 'Mutual aid — fire engine', short: 'MA-FD', group: 'Mutual aid', kind: 'mutual', cap: 'fire_suppression', cost: 4000, eta: [60, 120], icon: 'flame', desc: 'An engine company from a neighbouring city.' },
  { id: 'ma_ems', name: 'Mutual aid — ambulance', short: 'MA-EMS', group: 'Mutual aid', kind: 'mutual', cap: 'transport', cost: 4000, eta: [60, 120], icon: 'cross', desc: 'An ambulance from a neighbouring service.' },
  { id: 'ma_als', name: 'Mutual aid — paramedics', short: 'MA-ALS', group: 'Mutual aid', kind: 'mutual', cap: 'als', cost: 4000, eta: [60, 120], icon: 'cross', desc: 'A paramedic unit from a neighbouring service.' },
  { id: 'ma_rescue', name: 'Mutual aid — rescue', short: 'MA-RSQ', group: 'Mutual aid', kind: 'mutual', cap: 'rescue', cost: 4000, eta: [60, 120], icon: 'wrench', desc: 'A rescue company with cutting tools.' },
  { id: 'ma_crowd', name: 'Mutual aid — public order', short: 'MA-POU', group: 'Mutual aid', kind: 'mutual', cap: 'crowd', cost: 4000, eta: [60, 120], icon: 'users', desc: 'Officers trained for crowds and disorder.' },
];
export const RESOURCE_BY_ID: Record<string, ResourceDef> = Object.fromEntries(RESOURCES.map((r) => [r.id, r]));
/** unit types that are much better than generalists at certain jobs */
const SPECIALIST_FIT: Array<{ types: string[]; tpl: Set<string>; m: number }> = [
  { types: ['public_order'], tpl: new Set(['riot', 'protest_march', 'looting', 'public_disturbance', 'assault_mob', 'unruly_passenger']), m: 1.45 },
  { types: ['hazmat'], tpl: new Set(['hazmat_spill', 'gas_leak', 'tanker_fire', 'train_derailment', 'industrial_accident', 'carbon_monoxide', 'warehouse_smoke']), m: 1.45 },
  { types: ['bomb_squad', 'guard_eod'], tpl: new Set(['bomb_threat', 'suspicious_package']), m: 1.35 },
  { types: ['foot', 'bicycle'], tpl: new Set(['public_disturbance', 'protest_march', 'shoplifting', 'public_intoxication', 'lost_child', 'suspicious_activity', 'assault_mob']), m: 1.25 },
  { types: ['paramedic_engine'], tpl: new Set(['collision_trapped', 'collision_multi', 'house_explosion', 'apartment_fire']), m: 1.15 },
  { types: ['k9_unit'], tpl: new Set(RESOURCES.find((r) => r.id === 'k9')!.templates), m: 1.45 },
  { types: ['negotiator_team'], tpl: new Set(['hostage_barricade', 'kidnapping', 'bank_robbery', 'domestic_disturbance']), m: 1.3 },
  { types: ['regional_hazmat'], tpl: new Set(RESOURCES.find((r) => r.id === 'regional_hazmat')!.templates), m: 1.55 },
  { types: ['usar'], tpl: new Set(RESOURCES.find((r) => r.id === 'usar')!.templates), m: 1.6 },
  { types: ['coast_guard'], tpl: new Set(['water_rescue', 'boat_fire']), m: 1.5 },
];
/** which public alert actually protects people for each kind of incident */
export const ALERT_RIGHT: Record<string, AlertKind> = {
  gas_leak: 'evacuate', house_explosion: 'evacuate', tanker_fire: 'evacuate', train_derailment: 'evacuate', brush_fire: 'evacuate', building_collapse: 'evacuate', bomb_threat: 'evacuate', apartment_fire: 'evacuate',
  warehouse_smoke: 'shelter', industrial_accident: 'shelter', active_shooter: 'shelter', hostage_barricade: 'shelter', crowd_crush: 'shelter',
  suspicious_package: 'evacuate', hazmat_spill: 'shelter', riot: 'shelter', vehicle_ramming: 'shelter',
};
/** hard and expert shifts switch off the dispatch assists: response plans, suggested replies, auto-classification, quick location picks */
export const assistsOn = (st: GameState): boolean => !['hard', 'expert'].includes(st.config.difficulty);
/** what each background sound tells a dispatcher who is listening for it */
export const SOUND_CLUES: Record<string, string> = {
  train: 'a level-crossing bell and a train rumbling past', highway: 'the roar of fast traffic — a motorway close by', water: 'water lapping and gulls crying',
  harbor: "a ship's horn, gulls and clanking containers", jets: 'jet engines screaming overhead, very low', school: 'a school bell and children shouting',
  bells: 'church bells ringing out', crowd: 'a big crowd cheering and chanting', industrial: 'heavy machinery and reversing beepers',
  birds: 'wind in the trees and birdsong', traffic: 'busy traffic, horns and a bus pulling away', suburb: 'a dog barking and a lawnmower somewhere',
  hospital: 'an ambulance siren winding down nearby', rain: 'rain hammering down', alarm: 'a fire alarm ringing',
};
export type CalmKind = 'reassure' | 'firm' | 'acknowledge' | 'ground' | 'update' | 'breathe';
/** how well each calming technique lands, by the caller's state (negative = it backfires) */
const CALM_FIT: Record<string, Record<CalmKind, number>> = {
  panicked: { firm: 1, breathe: 1, update: 0.6, reassure: 0.5, acknowledge: 0.4, ground: 0.3 },
  angry: { acknowledge: 1, update: 0.9, reassure: 0.25, ground: 0.2, breathe: -0.4, firm: -0.7 },
  frightened: { reassure: 1, ground: 0.9, breathe: 0.8, update: 0.8, acknowledge: 0.6, firm: 0.4 },
  shaken: { ground: 0.85, update: 0.85, reassure: 0.7, acknowledge: 0.5, breathe: 0.5, firm: 0.2 },
  calm: { update: 0.4, reassure: 0.2, acknowledge: 0.2, ground: 0.1, breathe: 0, firm: -0.2 },
};
/** and by who they are */
const CALM_ARCH: Record<string, Partial<Record<CalmKind, number>>> = {
  child_caller: { firm: -0.6, reassure: 0.3, ground: 0.2, breathe: 0.2 },
  confused_elderly: { firm: 0.25, ground: -0.25, update: 0.2 },
  drunk_caller: { firm: 0.25, ground: -0.2 },
  professional: { update: 0.3, reassure: -0.25 }, calm_serious: { update: 0.3, reassure: -0.2 },
  angry_motorist: { acknowledge: 0.2, firm: -0.2 },
  panicked_parent: { firm: 0.15, update: 0.15 },
};
/** callers hiding from someone: opening doors or going outside is dangerous */
/** working structure fires where crews go inside: PAR checks and MAYDAYs */
const STRUCTURE_FIRES = new Set(['apartment_fire', 'kitchen_fire', 'warehouse_smoke', 'electrical_fire', 'house_explosion', 'building_collapse', 'industrial_accident']);
const HIDING = new Set(['burglary_progress', 'domestic_disturbance', 'active_shooter', 'hostage_barricade', 'bank_robbery', 'robbery', 'suspicious_activity', 'strange_noise', 'kidnapping']);
export const SEARCH_TEMPLATES = new Set(['missing_person', 'lost_hiker', 'lost_child']);
/** seconds one crew needs to sweep a search sector */
const SECTOR_WORK = 26;
/** police calls where an officer on scene can get into trouble */
const RISKY_POLICE = new Set(['domestic_disturbance', 'public_disturbance', 'robbery', 'burglary_progress', 'traffic_stop', 'public_intoxication', 'trespassing', 'suspicious_activity', 'carjacking', 'street_racing', 'unruly_passenger', 'shoplifting']);

/** incidents where a helicopter overhead speeds up the job (searching, overwatch) */
export const AIR_HELPS = new Set(['lost_hiker', 'kidnapping', 'active_shooter', 'bank_robbery', 'hostage_barricade', 'water_rescue', 'boat_fire', 'escaped_animal', 'train_derailment', 'missing_person', 'brush_fire', 'crowd_crush', 'tanker_fire']);

export const DIFFICULTY = {
  casual: { rate: 0.7, ring: 55, coop: 8, esc: 0.8, wrong: 0.4, label: 'Casual' },
  standard: { rate: 1, ring: 42, coop: 0, esc: 1, wrong: 1, label: 'Standard' },
  hard: { rate: 1.05, ring: 36, coop: -5, esc: 1.05, wrong: 1.25, label: 'Realistic' },
  expert: { rate: 1.5, ring: 28, coop: -10, esc: 1.3, wrong: 1.6, label: 'Expert' },
} as const;

export interface ShiftSetup { rank: number; reputation: number; budget: number; stations: Station[]; units: Unit[]; personnel: Personnel[]; upgrades: UpgradeLevels; city: CityState }

export type EngineEvent =
  | { type: 'ring'; callId: string } | { type: 'answer'; callId: string } | { type: 'hangup'; callId: string } | { type: 'caller_line'; callId: string }
  | { type: 'radio'; unitId?: string } | { type: 'dispatch'; unitId: string } | { type: 'arrive'; unitId: string } | { type: 'alert'; text: string; incId?: string; cine?: 'major' | 'mayday' | 'chase' | 'escalate' }
  | { type: 'ai_request'; callId: string; lineIds: number[]; intent: string; playerText: string }
  | { type: 'resolved'; incidentId: string } | { type: 'failed'; incidentId: string } | { type: 'notify'; level: string } | { type: 'ended' } | { type: 'status'; unitId: string };

const emptyStats = (): ShiftStats => ({
  callsReceived: 0, callsAnswered: 0, callsMissed: 0, answerTimes: [], responseTimes: [], resolved: 0, failed: 0, falseAlarms: 0, mishandled: 0,
  casualties: 0, livesHelped: 0, unnecessary: 0, dispatches: 0, correctDispatches: 0, wrongLocations: 0, locationChecks: 0, costs: 0, income: 0, bonus: 0,
  coverageSamples: { police: [], fire: [], medical: [] }, districtCoverage: {}, serviceResponse: { police: [], fire: [], medical: [] },
  unitBusySeconds: 0, unitSeconds: 0, handedOver: 0, byCategory: {}, callbacks: 0, escalations: 0, promisesBroken: 0,
  merges: 0, wrongLinks: 0, pursuitsCaught: 0, verifiedOk: 0, cleanFalseAlarms: 0, bestStreak: 0, calmedCallers: 0, transfersOk: 0, mutualAid: 0, contractBonus: 0,
  aidGood: 0, aidBad: 0, unitCrashes: 0, breakdowns: 0, aiLines: 0,
  heliRelays: 0, heliSightings: 0, checksOk: 0, checksBad: 0, checksMissed: 0, guidanceDeaths: 0, guidanceSaves: 0, harmfulAdvice: 0,
});

export function createShiftState(config: ShiftConfig, setup: ShiftSetup): GameState {
  const city = getCity();
  const units: Record<string, Unit> = {};
  for (const u of setup.units) units[u.id] = applyFit(JSON.parse(JSON.stringify(u)));
  const stations: Record<string, Station> = {};
  for (const s of setup.stations) stations[s.id] = { ...s };
  const personnel: Record<string, Personnel> = {};
  for (const p of setup.personnel) personnel[p.id] = { ...p };
  const closed: number[] = setup.city.closedRoads.filter((r) => r.shifts > 0).map((r) => r.edge);
  const rng = new Rng(config.seed);
  const districtTraffic: Record<string, number> = {};
  for (const d of city.districts) districtTraffic[d.id] = d.baseTraffic;
  const st: GameState = {
    version: STATE_VERSION, seed: config.seed, rngState: rng.state, config, time: 0, speed: 1, paused: false, phase: 'running',
    weather: config.weather, weatherIntensity: config.weather === 'clear' ? 0 : 0.7, nextWeatherChange: 150 + rng.range(0, 120), timeOfDay: config.startHour,
    units, stations, personnel, incidents: {}, calls: {}, activeCallId: null, incidentCounter: 0, callCounter: 0,
    events: [], closedEdges: closed, districtTraffic, radio: [], timeline: [], notifications: [],
    stats: emptyStats(), upgrades: { ...setup.upgrades }, rank: setup.rank, reputation: setup.reputation, budget: setup.budget,
    nextSpawnAt: config.script ? Infinity : rng.range(5, 9), spawnedScripted: 0, scriptIndex: 0,
    selected: { kind: null, id: null }, flags: {}, dispatcherLoad: 0, assistantFreeAt: 0, lastCoverage: 0, uniqueNameCounter: 0, endingAt: null,
    streak: 0, fx: [], fxCounter: 0, closedHospitals: [], lineCounter: 0,
    requests: [], requestCounter: 0, nextStopAt: config.script ? Infinity : 95 + rng.range(0, 70),
  };
  // persistent consequences: stations that are damaged keep their units out of service
  for (const sid of Object.keys(setup.city.damagedStations)) {
    const stn = stations[sid];
    if (stn && setup.city.damagedStations[sid] > 0) {
      stn.disabledShifts = setup.city.damagedStations[sid];
      for (const u of Object.values(units)) if (u.stationId === sid) { u.status = 'OUT_OF_SERVICE'; u.note = 'Station damaged'; u.timer = 0; }
    }
  }
  // districts with lingering congestion
  for (const k of Object.keys(setup.city.districtTraffic)) st.districtTraffic[k] = Math.min(1, (st.districtTraffic[k] ?? 0.3) + setup.city.districtTraffic[k]);
  return st;
}

export function checkCrew(state: GameState, u: Unit): boolean {
  const n = u.personnelIds.filter((id) => state.personnel[id]).length;
  return n >= u.minCrew;
}

// ── Pure helpers ────────────────────────────────────────────────────────────
export function matchCoverage(reqs: Req[], units: Unit[]): { f: number; used: Set<string>; missing: Req[] } {
  const used = new Set<string>();
  let total = 0, got = 0;
  const missing: Req[] = [];
  for (const req of reqs) {
    const cands = units.filter((u) => u.capabilities.includes(req.cap)).sort((a, b) => a.capabilities.length - b.capabilities.length);
    const have = Math.min(req.n, cands.length);
    for (let i = 0; i < have; i++) used.add(cands[i].id);
    total += req.n; got += have;
    if (have < req.n) missing.push({ cap: req.cap, n: req.n - have });
  }
  return { f: total ? got / total : 1, used, missing };
}
export function mergeReqs(a: Req[], b: Req[]): Req[] {
  const m = new Map<Capability, number>();
  for (const r of [...a, ...b]) m.set(r.cap, Math.max(m.get(r.cap) ?? 0, r.n));
  return [...m.entries()].map(([cap, n]) => ({ cap, n }));
}
export function reqText(reqs: Req[]): string {
  return reqs.map((r) => (r.n > 1 ? `${r.n}× ` : '') + CAP_LABEL[r.cap]).join(', ') || 'none';
}
const fmtClock = (hour: number) => {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.floor((((h - hh) * 60) - mm) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};
export const gameClock = (st: GameState, t = st.time) => fmtClock(st.config.startHour + t / 3600);

export function suggestClass(inc: Incident): string {
  const tpl = TEMPLATE_BY_ID[inc.templateId];
  const f: Record<string, FactVal> = {};
  for (const x of inc.facts) if (x.confidence !== 'contradicted') f[x.key] = x.value;
  if (inc.twistRevealed && inc.twist?.hint) return inc.twist.hint;
  if (f.false_alarm === true) return 'no_response';
  if (f.conscious === false || f.breathing === false) return 'medical_critical';
  if (f.weapon) return 'crime_progress';
  if (f.water) return 'water';
  if (f.fire === true || (f.smoke === true && !(typeof f.vehicles === 'number' && f.vehicles > 0))) return tpl.hint === 'fire_other' ? 'fire_other' : 'fire_structure';
  if (typeof f.hazard === 'string' && /gas/.test(f.hazard)) return 'hazmat';
  if (typeof f.trapped === 'number' && f.trapped > 0 && tpl.hint !== 'collision') return tpl.hint === 'collision' ? 'collision' : 'rescue';
  return tpl.hint ?? 'unknown';
}

export function recommendFor(inc: Incident, rank = 7): Req[] {
  const cls = inc.classification ?? suggestClass(inc);
  const def = CLASS_BY_ID[cls] ?? CLASS_BY_ID.unknown;
  let rec: Req[] = def.rec.map((r) => ({ ...r }));
  const f: Record<string, FactVal> = {};
  for (const x of inc.facts) if (x.confidence !== 'contradicted') f[x.key] = x.value;
  const add = (cap: Capability, n = 1) => { rec = mergeReqs(rec, [{ cap, n }]); };
  if (typeof f.injured === 'number' && f.injured > 0 && !rec.some((r) => r.cap === 'bls' || r.cap === 'als')) { add('bls'); add('transport'); }
  if (f.conscious === false || f.breathing === false || f.breathing === 'labored') { rec = rec.filter((r) => r.cap !== 'bls'); add('als'); add('transport'); }
  if ((f.fire === true || f.smoke === true) && !rec.some((r) => r.cap === 'fire_suppression')) add('fire_suppression');
  if (typeof f.trapped === 'number' && f.trapped > 0 && !rec.some((r) => r.cap === 'rescue')) add('rescue');
  if ((f.suspect === true || f.weapon) && !rec.some((r) => r.cap === 'patrol')) add('patrol');
  if (typeof f.vehicles === 'number' && f.vehicles > 0 && !rec.some((r) => r.cap === 'patrol')) add('patrol');
  if (f.water) add('water_rescue');
  if (inc.knownReqs.length) return inc.knownReqs;
  return rec.map((r) => adaptReqForRank(r, rank));
}

/** structure fires that get away spread to the building next door */
const FIRE_SPREAD: Record<string, string> = { kitchen_fire: 'apartment_fire', apartment_fire: 'apartment_fire', electrical_fire: 'apartment_fire', house_explosion: 'apartment_fire', warehouse_smoke: 'warehouse_smoke', brush_fire: 'brush_fire' };

/** trauma centres improve the odds for critical patients; the small clinic does not */
export function hospitalKind(city: City, node: number): 'trauma' | 'general' | 'clinic' {
  const lm = city.landmarks.find((l) => l.nodeId === node && l.kind === 'hospital');
  if (!lm) return 'general';
  return /General|University/.test(lm.name) ? 'trauma' : /Clinic/.test(lm.name) ? 'clinic' : 'general';
}

// ── Engine ──────────────────────────────────────────────────────────────────
type Listener = (e: EngineEvent) => void;

export class GameEngine {
  state: GameState;
  city: City;
  rng: Rng;
  private acc = 0;
  private listeners: Listener[] = [];
  private closedMask: Uint8Array;
  private covCache: Partial<Record<Service, { t: number; times: Float32Array }>> = {};
  private etaCache = new Map<string, { t: number; v: { eta: number; dist: number } | null }>();
  private lastTrafficUpdate = -99;
  private lastReroute = 0;
  private lastSample = 0;
  private recentTemplates: string[] = [];
  private tickSecond = 0;

  constructor(state: GameState) {
    this.state = state;
    // tolerate snapshots from older versions
    state.fx ??= []; state.streak ??= 0; state.fxCounter ??= 0; state.closedHospitals ??= []; state.lineCounter ??= 0;
    state.requests ??= []; state.requestCounter ??= 0; state.nextStopAt ??= state.time + 120;
    // lines held for AI voicing cannot survive a reload: release their scripted text
    for (const c of Object.values(state.calls)) for (const l of c.pending) if (l.hold) { l.hold = false; l.at = state.time + 0.5; }
    const base = emptyStats() as unknown as Record<string, unknown>;
    for (const k of Object.keys(base)) if ((state.stats as unknown as Record<string, unknown>)[k] === undefined) (state.stats as unknown as Record<string, unknown>)[k] = base[k];
    for (const inc of Object.values(state.incidents)) { inc.dupPlan ??= []; inc.duplicateOf ??= null; inc.pursuit ??= false; inc.mover ??= null; inc.mergedInto ??= null; }
    this.city = getCity();
    this.rng = new Rng(state.rngState);
    this.closedMask = makeClosedMask(this.city, state.closedEdges);
    this.updateTraffic(true);
    this.refreshOutOfService();
  }

  static fromConfig(config: ShiftConfig, setup: ShiftSetup): GameEngine {
    const e = new GameEngine(createShiftState(config, setup));
    e.log('info', `Shift started — ${config.title}`);
    e.applyModifiers();
    e.sampleCoverage();
    e.scheduleEvents();
    return e;
  }

  on(l: Listener): () => void { this.listeners.push(l); return () => { this.listeners = this.listeners.filter((x) => x !== l); }; }
  emit(e: EngineEvent) { for (const l of this.listeners) l(e); }

  serialize(): GameState { this.state.rngState = this.rng.state; return JSON.parse(JSON.stringify(this.state)); }

  // ── logging helpers ───────────────────────────────────────────────────────
  log(kind: TimelineEntry['kind'], text: string, extra: Partial<TimelineEntry> = {}) {
    this.state.timeline.push({ t: this.state.time, kind, text, ...extra });
    if (this.state.timeline.length > 600) this.state.timeline.shift();
  }
  notify(text: string, level: 'info' | 'good' | 'warn' | 'bad' = 'info', incidentId?: string) {
    const st = this.state;
    st.notifications.push({ id: `n${st.notifications.length}-${Math.floor(st.time)}`, t: st.time, text, level, incidentId });
    if (st.notifications.length > 80) st.notifications.shift();
    this.emit({ type: 'notify', level });
  }
  radio(from: string, text: string, kind: import('./types').RadioMsg['kind'] = 'unit', unitId?: string, incidentId?: string) {
    const st = this.state;
    const msg: import('./types').RadioMsg = { id: `r${st.radio.length}-${Math.floor(st.time * 10)}-${(st.lineCounter = (st.lineCounter ?? 0) + 1)}`, t: st.time, clock: gameClock(st), from, text, unitId, incidentId, kind };
    // routine chatter waits while a talkgroup is on emergency traffic only
    if (kind === 'chatter' && isHeld(st, talkgroupOf(st, msg))) return;
    st.radio.push(msg);
    maybeBreak(this, msg);
    if (unitId && cadDown(st) && st.units[unitId]) reportPosition(st, st.units[unitId]);
    if (st.radio.length > 250) st.radio.shift();
    this.emit({ type: 'radio', unitId });
  }

  /** floating map feedback (score popups etc.) */
  fx(kind: 'good' | 'bad' | 'warn' | 'info', nodeId: number, text: string) {
    const st = this.state;
    const n = this.city.nodes[nodeId];
    if (!n) return;
    st.fx.push({ id: ++st.fxCounter, t: st.time, kind, x: n.x, y: n.y, text });
    if (st.fx.length > 40) st.fx.shift();
  }

  private applyModifiers() {
    const st = this.state;
    for (const id of st.config.modifiers ?? []) {
      const m = MODIFIER_BY_ID[id];
      if (!m) continue;
      if (m.oos) {
        const pool = this.rng.shuffle(Object.values(st.units).filter((u) => u.status === 'AVAILABLE' && !u.temp));
        // never take out a service's last unit
        let taken = 0;
        for (const u of pool) {
          if (taken >= m.oos) break;
          if (Object.values(st.units).filter((x) => x.service === u.service && x.status === 'AVAILABLE').length <= 1) continue;
          u.status = 'OUT_OF_SERVICE'; u.note = 'Crew shortage'; u.timer = 240; taken++;
        }
      }
      if (m.fresh) for (const p of Object.values(st.personnel)) { p.fatigue = 0; p.morale = Math.min(100, p.morale + 10); }
      if (m.roadworks) {
        const cands = this.city.edges.filter((e) => e.cls === 'local' && st.config.districts.includes(this.city.nodes[e.a].district) && !st.closedEdges.includes(e.id));
        for (let i = 0; i < m.roadworks && cands.length; i++) st.closedEdges.push(this.rng.pick(cands).id);
        this.closedMask = makeClosedMask(this.city, st.closedEdges);
      }
      if (m.closeHospital && this.city.hospitals.length > 1) {
        const open = this.city.hospitals.filter((h) => st.config.districts.includes(this.city.nodes[h].district));
        st.closedHospitals = [this.rng.pick(open.length > 1 ? open : this.city.hospitals)];
      }
      this.notify(`Shift condition: ${m.name} — ${m.desc}`, m.tone === 'good' ? 'good' : m.tone === 'bad' ? 'warn' : 'info');
    }
  }

  // ── main loop ─────────────────────────────────────────────────────────────
  setSpeed(s: number) { this.state.speed = s; this.state.paused = s === 0; }
  togglePause() { this.state.paused = !this.state.paused; }

  update(realDt: number) {
    const st = this.state;
    if (st.phase !== 'running' || st.paused) return;
    this.acc += Math.min(0.25, realDt) * st.speed;
    let guard = 0;
    while (this.acc >= DT && guard++ < 40 && st.phase === 'running') { this.acc -= DT; this.step(DT); }
  }

  step(dt: number) {
    const st = this.state;
    st.time += dt;
    st.timeOfDay = st.config.startHour + st.time / 3600;
    this.tickSecond += dt;
    if (this.tickSecond >= 1) { this.tickSecond -= 1; this.everySecond(); }
    this.updateUnits(dt);
    this.updateIncidents(dt);
    this.updateCalls(dt);
    if (st.time - this.lastReroute > 10) { this.lastReroute = st.time; this.rerouteAll(); }
    if (st.time - this.lastSample > 10) { this.lastSample = st.time; this.sampleCoverage(); }
    this.checkEnd();
  }

  private everySecond() {
    const st = this.state;
    this.processScript();
    this.processForced();
    this.majorNews();
    this.updateEvents();
    this.updateWeather();
    if (st.time - this.lastTrafficUpdate >= 4) this.updateTraffic();
    this.spawnTick();
    this.updateCallbacks();
    this.updatePersonnel();
    this.updateWorkload();
    this.spawnDuplicates();
    this.updateRequests();
    this.trafficStops();
    this.onViewTick();
    this.updateDecisions();
    this.updateHospitals();
    this.radioChatter();
    this.updateBolos();
    this.updateStingers();
    this.breakRequests();
    this.updateAgencies();
    this.updateResources();
    this.stationWalkIns();
    this.hospitalCalls();
    regularsTick(this);
    relaysTick(this);
    stormTick(this);
    stressTick(this);
    needsTick(this);
    buildingsTick(this);
    heldTick(this);
    radioQueueTick(this);
    emergencyTick(this);
    patchAskTick(this);
    this.updateStatusChecks();
    cadTick(this);
    directiveTick(this);
    aidOutTick(this);
    this.updateAlertCalls();
    this.updateRelapses();
    this.unitQueriesTick();
    if (!st.config.script) this.breakdowns();
  }

  // ── Weather, events, traffic ──────────────────────────────────────────────
  private updateWeather() {
    const st = this.state;
    const ev = st.events.find((e) => e.active && EVENT_DEFS[e.type].weather);
    if (ev) {
      const w = EVENT_DEFS[ev.type].weather!;
      if (st.weather !== w) { st.weather = w; this.notify(`Weather: ${WEATHER_LABEL[w]}`, 'warn'); }
      st.weatherIntensity = Math.min(1, st.weatherIntensity + 0.02);
      return;
    }
    if (st.time >= st.nextWeatherChange && !st.config.events.length) {
      const nw = nextWeather(st.weather, this.rng.next(), st.timeOfDay);
      if (nw !== st.weather) { st.weather = nw; st.weatherIntensity = 0.4; this.notify(`Weather change: ${WEATHER_LABEL[nw]}`, 'info'); }
      st.nextWeatherChange = st.time + 150 + this.rng.range(0, 150);
    }
    if (st.weather === 'clear') st.weatherIntensity = Math.max(0, st.weatherIntensity - 0.02);
    else st.weatherIntensity = Math.min(1, st.weatherIntensity + 0.01);
  }

  private scheduleEvents() { /* events are activated in updateEvents by config times */ }

  private updateEvents() {
    const st = this.state;
    for (const c of st.config.events) {
      const id = `${c.type}@${c.at}`;
      let ev = st.events.find((e) => e.id === id);
      if (!ev && st.time >= c.at - 20) {
        const def = EVENT_DEFS[c.type];
        const districts = c.districts ?? this.defaultEventDistricts(c.type);
        const eff = def.make(districts);
        ev = { id, type: c.type, name: def.name, start: c.at, end: c.at + c.duration, districts, ...eff, closedEdges: [], announced: false, active: false, description: def.description };
        st.events.push(ev);
      }
      if (!ev) continue;
      if (!ev.announced && st.time >= ev.start - 20) {
        ev.announced = true;
        this.notify(`Advisory: ${ev.name} expected shortly — ${ev.description}`, 'warn');
        this.log('event', `Advisory issued: ${ev.name}`);
      }
      if (!ev.active && st.time >= ev.start && st.time < ev.end) {
        ev.active = true;
        this.notify(`${ev.name} is now in effect`, 'bad');
        this.radio('DISPATCH', `All units, ${ev.name} now in effect. Expect elevated call volume.`, 'alert');
        this.headline(`${ev.name}: ${ev.description}`, 'info');
        this.log('event', `${ev.name} began`);
        this.emit({ type: 'alert', text: ev.name });
        this.applyEventStart(ev);
      } else if (ev.active && st.time >= ev.end) {
        ev.active = false;
        this.notify(`${ev.name} has eased`, 'good');
        this.log('event', `${ev.name} ended`);
        this.removeEventClosures(ev);
      }
    }
  }
  private defaultEventDistricts(t: CityEvent['type']): string[] {
    const all = this.state.config.districts;
    const pick = (ids: string[]) => ids.filter((i) => all.includes(i));
    switch (t) {
      case 'festival': return pick(['downtown', 'oldtown']);
      case 'flood': return pick(['riverside', 'southside', 'harbor', 'industrial']);
      case 'industrial_fire': return pick(['industrial', 'harbor']);
      case 'blackout': return all.slice(0, Math.max(3, Math.ceil(all.length * 0.6)));
      case 'protest': case 'riot': { const d = pick(['downtown', 'financial', 'oldtown', 'university']); return d.length ? d : all.slice(0, 2); }
      case 'marathon': { const d = pick(['riverside', 'downtown', 'oldtown', 'westres', 'university']); return d.length ? d : all.slice(0, 3); }
      default: return all;
    }
  }
  private applyEventStart(ev: CityEvent) {
    const st = this.state;
    const closable = this.city.edges.filter((e) => e.cls !== 'highway' && ev.districts.includes(this.city.nodes[e.a].district) && e.cls !== 'bridge');
    const nClose = ev.type === 'storm' ? 3 : ev.type === 'winter_storm' ? 3 : ev.type === 'flood' ? 4 : ev.type === 'marathon' ? 6 : ev.type === 'protest' ? 3 : ev.type === 'riot' ? 4 : 0;
    for (let i = 0; i < nClose && closable.length; i++) { const e = this.rng.pick(closable); if (!ev.closedEdges.includes(e.id)) { ev.closedEdges.push(e.id); st.closedEdges.push(e.id); } }
    if (ev.type === 'flood') {
      const bridges = this.city.edges.filter((e) => e.cls === 'bridge' && this.city.nodes[e.a].i !== 20);
      if (bridges.length) { const b = this.rng.pick(bridges); ev.closedEdges.push(b.id); st.closedEdges.push(b.id); this.notify('A river bridge has been closed by rising water', 'warn'); }
    }
    if (ev.closedEdges.length) { this.closedMask = makeClosedMask(this.city, st.closedEdges); this.notify(`${ev.closedEdges.length} road(s) closed — routes will adapt`, 'warn'); this.rerouteAll(true); }
    if (ev.type === 'industrial_fire' && st.config.districts.includes('industrial')) this.spawnIncident('warehouse_smoke', 'industrial', { severity: 4, forceEvent: ev.id });
    const home = ev.districts.filter((d) => st.config.districts.includes(d));
    if (ev.type === 'protest' && home.length) this.spawnIncident('protest_march', this.rng.pick(home), { forceEvent: ev.id });
    if (ev.type === 'riot' && home.length) { const inc = this.spawnIncident('riot', this.rng.pick(home), { forceEvent: ev.id }); inc.breakAt = st.time + 3; }
    if (ev.type === 'riot' || ev.type === 'protest') this.radio('DISPATCH', ev.type === 'riot' ? 'All units, all units: serious disorder in progress. Public order units to staging; fire crews do not enter without a police escort.' : 'All units, be advised: large protest march on the move. Expect road closures and diversions.', 'alert');
    if (ev.type === 'marathon') this.radio('DISPATCH', 'All units, marathon course is closed to traffic. Medical teams are staged along the route — use the diversions.', 'alert');
  }
  private removeEventClosures(ev: CityEvent) {
    const st = this.state;
    st.closedEdges = st.closedEdges.filter((e) => !ev.closedEdges.includes(e) || st.config.mode === 'career' && false);
    this.closedMask = makeClosedMask(this.city, st.closedEdges);
  }
  private eventMult(cat: string, tplId: string, district: string): number {
    let m = 1;
    for (const ev of this.state.events) {
      if (!ev.active) continue;
      const here = ev.districts.includes(district) ? 1 : 0.55;
      m *= 1 + (ev.incidentMult - 1) * here;
      m *= (ev.categoryBias as Record<string, number>)[cat] ?? 1;
      m *= ev.templateBias[tplId] ? 1 + (ev.templateBias[tplId] - 1) * here : 1;
    }
    return m;
  }

  private updateTraffic(force = false) {
    const st = this.state;
    this.lastTrafficUpdate = st.time;
    const hour = ((st.timeOfDay % 24) + 24) % 24;
    const tf = hour >= 7 && hour < 9.5 ? 1.5 : hour >= 16 && hour < 19 ? 1.55 : hour >= 22 || hour < 5 ? 0.35 : hour < 7 ? 0.5 : 1;
    for (const d of this.city.districts) {
      let v = d.baseTraffic * tf + WEATHER_TRAFFIC[st.weather] * st.weatherIntensity;
      for (const ev of st.events) {
        if (!ev.active) continue;
        const here = ev.districts.includes(d.id);
        v *= 1 + (ev.trafficMult - 1) * (here ? 1 : 0.5);
        if (ev.type === 'blackout' && here) v += 0.25;
        if ((ev.type === 'festival' || ev.type === 'protest' || ev.type === 'riot' || ev.type === 'marathon') && here) v += 0.2;
      }
      // open incidents add congestion at their district
      const blockers = Object.values(st.incidents).filter((i) => i.district === d.id && i.blockedEdge !== null && i.status !== 'RESOLVED' && i.status !== 'CLOSED').length;
      v += blockers * 0.08;
      v = Math.max(0.05, Math.min(0.92, v));
      const cur = st.districtTraffic[d.id] ?? v;
      st.districtTraffic[d.id] = force ? v : cur + (v - cur) * 0.35;
    }
  }

  tm(siren: boolean): TrafficModel {
    const st = this.state;
    return { district: st.districtTraffic, weatherMult: WEATHER_SPEED[st.weather] * (1 - 0.05 * st.weatherIntensity), closed: this.closedMask, preempt: (st.upgrades.preempt ?? 0) / 3, siren };
  }

  // ── Personnel / unit effectiveness ────────────────────────────────────────
  crewOf(u: Unit): Personnel[] { return u.personnelIds.map((id) => this.state.personnel[id]).filter(Boolean); }
  unitSpeedFactor(u: Unit): number {
    const crew = this.crewOf(u);
    const drive = crew.length ? crew.reduce((s, p) => s + p.driving, 0) / crew.length : 50;
    const fat = crew.length ? crew.reduce((s, p) => s + p.fatigue, 0) / crew.length : 0;
    const w = WEATHER_SPEED[this.state.weather];
    const grip = u.fit?.grip ? (w + (1 - w) * u.fit.grip) / w : 1;
    const worn = (u.condition ?? 100) < 35 ? 0.92 : (u.condition ?? 100) < 55 ? 0.97 : 1;
    return u.speedModifier * grip * worn * Math.max(0.86, Math.min(1.14, drive / 68)) * (1 - Math.max(0, fat - 60) / 400);
  }
  unitEffectiveness(u: Unit): number {
    if (u.type === 'federal_tactical' || u.type === 'guard_eod') return 1.7;
    const crew = this.crewOf(u);
    if (!crew.length) return 0.4;
    const avg = (f: (p: Personnel) => number) => crew.reduce((s, p) => s + f(p), 0) / crew.length;
    const skill = avg((p) => (u.service === 'medical' ? p.medical : u.service === 'fire' ? p.fire : p.policing));
    const eff = 0.55 * (skill / 65) + 0.25 * (avg((p) => p.training) / 65) + 0.2 * (avg((p) => p.experience) / 65);
    const fatigue = 1 - Math.max(0, avg((p) => p.fatigue) - 45) / 160;
    const morale = 0.92 + (avg((p) => p.morale) / 100) * 0.16;
    const up = this.state.upgrades;
    const equip = 1 + 0.12 * (u.service === 'medical' ? up.medkit ?? 0 : u.service === 'fire' ? up.firegear ?? 0 : up.policegear ?? 0);
    const seatFactor = Math.sqrt(Math.min(1, crew.length / u.crewSeats));
    return Math.max(0.35, Math.min(2.2, eff * fatigue * morale * equip * seatFactor * stressFactor(crew) * suppliesFactor(this.state, u) * (u.fit?.eff ?? 1) * modProduct(this.state.config, 'eff')));
  }
  /** the right tool for the job: specialist vehicles and fitted kit work some scenes faster */
  sceneFit(inc: Incident, u: Unit): number {
    let m = 1;
    for (const f of SPECIALIST_FIT) if (f.types.includes(u.type) && f.tpl.has(inc.templateId)) m *= f.m;
    for (const k of u.fit?.kits ?? []) { const kit = KIT_BY_ID[k]; if (kit?.scenes?.includes(inc.templateId) || (kit?.categories?.includes(inc.category))) m *= kit.sceneMult ?? 1; }
    return m;
  }
  private updatePersonnel() {
    const st = this.state;
    const barracks = st.upgrades.barracks ?? 0;
    for (const u of Object.values(st.units)) {
      const working = u.status === 'ON_SCENE' || u.status === 'EN_ROUTE' || u.status === 'TRANSPORTING' || u.status === 'DISPATCHED';
      for (const p of this.crewOf(u)) {
        if (working) p.fatigue = Math.min(100, p.fatigue + 0.6 * (1 - 0.2 * barracks));
        else if (this.onPatrol(u)) p.fatigue = Math.min(100, p.fatigue + 0.05);
        else p.fatigue = Math.max(0, p.fatigue - (u.status === 'AVAILABLE' ? 0.35 : 0.15) * (1 + 0.3 * barracks));
      }
      if (u.status === 'AVAILABLE' && !checkCrew(st, u)) { u.status = 'OUT_OF_SERVICE'; u.note = 'Understaffed'; }
      if (u.status === 'OUT_OF_SERVICE' && u.note === 'Understaffed' && checkCrew(st, u)) { u.status = 'AVAILABLE'; u.note = undefined; }
    }
  }
  private refreshOutOfService() {
    for (const u of Object.values(this.state.units)) if (u.status === 'AVAILABLE' && !checkCrew(this.state, u)) { u.status = 'OUT_OF_SERVICE'; u.note = 'Understaffed'; }
  }
  private updateWorkload() {
    const st = this.state;
    const open = Object.values(st.incidents).filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status) && !i.hidden).length;
    const calls = Object.values(st.calls).filter((c) => c.state === 'ringing' || c.state === 'hold' || c.state === 'active').length;
    st.dispatcherLoad = Math.min(1, (open * 0.12 + calls * 0.2));
  }

  // ── Spawning ──────────────────────────────────────────────────────────────
  private processScript() {
    const st = this.state;
    const sc = st.config.script;
    if (!sc) return;
    while (st.scriptIndex < sc.length && st.time >= sc[st.scriptIndex].at) {
      const s = sc[st.scriptIndex++];
      this.spawnIncident(s.template, s.district ?? 'downtown', { archetype: s.archetype, accuracy: s.accuracy, tutorial: true });
    }
  }

  /** scenario set pieces: guaranteed incidents on top of the random ones */
  private processForced() {
    const st = this.state;
    const f = st.config.forced;
    if (!f) return;
    st.forcedIndex ??= 0;
    while (st.forcedIndex < f.length && st.time >= f[st.forcedIndex].at) {
      const s = f[st.forcedIndex++];
      const d = s.district && st.config.districts.includes(s.district) ? s.district : this.rng.pick(st.config.districts);
      const inc = this.spawnIncident(s.template, d, { archetype: s.archetype });
      if (s.story) inc.storyline = s.story;
      if (s.story && s.first && st.config.storyline) { this.breaking(st.config.storyline.headline, inc); inc.breakAt = undefined; }
    }
  }
  /** a major incident hits the news a little after the first call */
  private majorNews() {
    const st = this.state;
    for (const inc of Object.values(st.incidents)) {
      if (inc.breakAt === undefined || st.time < inc.breakAt) continue;
      inc.breakAt = undefined;
      if (['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
      const h = TEMPLATE_BY_ID[inc.templateId]?.headline;
      if (h) this.breaking(`${h} in ${this.city.districtById[inc.district]?.name ?? 'the city'}`, inc);
    }
  }

  /** a storyline kicks off: everyone in the city hears about it */
  breaking(headline: string, inc?: Incident) {
    const st = this.state;
    this.headline(`BREAKING: ${headline}`, 'bad');
    this.notify(`BREAKING — ${headline}`, 'bad', inc?.id);
    this.radio('DISPATCH', `All units, major incident developing: ${headline.toLowerCase()}. Stand by for assignments.`, 'alert', undefined, inc?.id);
    // the newsroom starts ringing 911 for details
    if (inc && !inc.pressCalled && !st.config.script) { inc.pressCalled = true; (st.alertCalls ??= []).push({ at: st.time + 25 + this.rng.range(0, 30), district: inc.district, template: 'press_call' }); }
    this.emit({ type: 'alert', text: 'breaking', incId: inc?.id, cine: 'major' });
    void st;
  }
  /** add a line to the news ticker */
  headline(text: string, tone: 'good' | 'bad' | 'info' = 'info') {
    const st = this.state;
    (st.news ??= []).push({ t: st.time, text, tone });
    if (st.news.length > 30) st.news.shift();
  }

  private spawnTick() {
    const st = this.state;
    const cfg = st.config;
    if (cfg.script) return;
    if (st.time < st.nextSpawnAt) return;
    if (st.time > (cfg.noSpawnAfterSec ?? cfg.durationSec - 25)) { st.nextSpawnAt = Infinity; return; }
    // governor
    const inService = Object.values(st.units).filter((u) => u.status !== 'OUT_OF_SERVICE').length;
    const open = Object.values(st.incidents).filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status) && !i.hidden).length;
    const ringing = Object.values(st.calls).filter((c) => c.state === 'ringing').length;
    const hold = Object.values(st.calls).filter((c) => c.state === 'hold').length;
    const cap = Math.max(2, Math.min(14, Math.round(inService * 0.62) + 1 + (st.rank >= 4 ? 1 : 0)));
    if (!cfg.ignoreGovernor && (open + ringing >= cap || ringing + hold >= 4)) { st.nextSpawnAt = st.time + 6; return; }
    // pick template + district
    const choice = this.pickIncident();
    if (choice) this.spawnIncident(choice.tpl.id, choice.district);
    // schedule next
    const diff = DIFFICULTY[cfg.difficulty];
    const ramp = Math.max(0.4, Math.min(1.45, 0.45 + 1.15 * (st.time / cfg.durationSec)));
    let evM = 1;
    for (const e of st.events) if (e.active) evM *= e.incidentMult;
    const storyOpen = Object.values(st.incidents).some((i) => i.storyline && !['RESOLVED', 'CLOSED'].includes(i.status));
    const perMin = 0.92 * diff.rate * cfg.incidentRate * ramp * evM * (1 + (cfg.endlessWave ?? 0) * 0.06) * modProduct(cfg, 'rate') * (storyOpen ? 0.7 : 1);
    const mean = 60 / perMin;
    st.nextSpawnAt = st.time + Math.max(4, -Math.log(1 - this.rng.next() * 0.98) * mean * 0.7 + mean * 0.35);
  }

  pickIncident(): { tpl: Template; district: string } | null {
    const st = this.state;
    const cfg = st.config;
    const hour = ((st.timeOfDay % 24) + 24) % 24;
    const night = hour >= 22 || hour < 5;
    const list: Array<{ tpl: Template; district: string; w: number }> = [];
    const majorOpen = Object.values(st.incidents).some((i) => TEMPLATE_BY_ID[i.templateId]?.major && !['RESOLVED', 'CLOSED'].includes(i.status));
    for (const dId of cfg.districts) {
      const d = this.city.districtById[dId];
      if (!d) continue;
      for (const tpl of TEMPLATES) {
        if (tpl.minRank > Math.max(st.rank, 1)) continue;
        if (cfg.hideIntense && tpl.intense) continue;
        if (tpl.id === 'wrong_jurisdiction' && st.rank < 1) continue;
        if (tpl.spawnOnly) continue;
        if (tpl.event && !st.events.some((ev) => ev.active && ev.type === tpl.event)) continue;
        if (tpl.major && (majorOpen || cfg.forced?.length)) continue;
        let w = 0;
        for (const tag of d.tags) w += tpl.w[tag] ?? 0;
        w += tpl.w[d.id] ?? 0;
        // runways, rail lines and terminals only exist in their own districts
        if (w <= 0 && (tpl.nodeHint === 'runway' || tpl.nodeHint === 'rail' || (tpl.w.airport && Object.keys(tpl.w).length === 1))) continue;
        if (w <= 0) w = 0.06;
        w *= d.weights[tpl.category];
        if (tpl.category === 'unusual') w *= cfg.unusualBias ?? 1;
        w *= tpl.weather?.[st.weather] ?? 1;
        w *= this.eventMult(tpl.category, tpl.id, d.id);
        if (night && tpl.category === 'police') w *= 1.35;
        if (night && tpl.id === 'burglary_progress') w *= 1.8;
        if (tpl.id === 'wrong_jurisdiction') w *= 0.35;
        if (tpl.major) w *= 0.3;
        const recent = this.recentTemplates.filter((x) => x === tpl.id).length;
        w *= Math.pow(0.45, recent);
        list.push({ tpl, district: dId, w });
      }
    }
    const pick = this.rng.weighted(list, (x) => x.w);
    if (!pick) return null;
    this.recentTemplates.push(pick.tpl.id);
    if (this.recentTemplates.length > 5) this.recentTemplates.shift();
    return pick;
  }

  /** create an incident plus its ringing call */
  spawnIncident(templateId: string, districtId: string, opts: { archetype?: string; accuracy?: CallerProfile['locationAccuracy']; severity?: number; forceEvent?: string; tutorial?: boolean; duplicateOf?: Incident; connectedTo?: Incident; noCall?: boolean; nodeId?: number } = {}): Incident {
    const st = this.state;
    const rng = this.rng;
    const diff = DIFFICULTY[st.config.difficulty];
    const base = TEMPLATE_BY_ID[templateId];
    const src = opts.duplicateOf;
    let tpl: Template = src ? { ...base, twist: undefined } : base.build ? base.build(() => rng.next(), base) : base;
    if (st.config.hideIntense && tpl.intense && !base.intense) tpl = base;
    // location
    const dNodes = this.city.nodesInDistrict[districtId] ?? this.city.nodesInDistrict.downtown;
    let candidates = dNodes.filter((n) => this.city.adj[n].some((e) => this.city.edges[e].cls !== 'highway'));
    if (templateId === 'water_rescue') { const w = candidates.filter((n) => [17, 24].includes(this.city.nodes[n].j)); if (w.length) candidates = w; }
    if (tpl.nodeHint) { const h = this.hintNodes(tpl.nodeHint, districtId, candidates); if (h.length) candidates = h; }
    if (!candidates.length) candidates = dNodes;
    const nodeId = src ? src.nodeId : opts.nodeId ?? rng.pick(candidates);
    // caller
    const archetypeId = opts.archetype ?? (rng.weighted(tpl.archetypes, (a) => a[1]) ?? tpl.archetypes[0])[0];
    const vars = makeVars(rng, tpl, archetypeId);
    if (src) for (const k of ['he', 'him', 'his', 'He', 'Him', 'His', 'age', 'kid', 'pname']) vars[k] = src.vars[k];
    let accuracy = opts.accuracy;
    const profile = makeCallerProfile(rng, tpl, archetypeId, this.city, nodeId, accuracy, vars);
    if (!accuracy && profile.locationAccuracy !== 'exact' && !rng.chance(Math.min(0.97, diff.wrong * 0.9 + 0.1))) profile.locationAccuracy = 'exact';
    if (opts.tutorial && !accuracy) profile.locationAccuracy = 'exact';
    profile.cooperationLevel = Math.max(5, Math.min(100, profile.cooperationLevel + diff.coop));
    const locPlan = makeLocPlan(rng, this.city, nodeId);
    // truth
    const truth: Record<string, FactVal> = {};
    for (const [k, v] of Object.entries(tpl.truth)) truth[k] = typeof v === 'string' ? fill(v, vars) : v;
    if (tpl.patient && tpl.patient !== 'none') truth.age = parseInt(vars.age, 10);
    if (src) Object.assign(truth, src.truth);
    const sev = src ? src.severity : opts.severity ?? Math.max(1, Math.min(5, rng.int(tpl.sev[0], tpl.sev[1]) + (st.config.difficulty === 'expert' && rng.chance(0.25) ? 1 : 0)));
    const requires = src ? [] : tpl.requires.map((r) => adaptReqForRank(r, st.rank));
    const num = ++st.incidentCounter;
    const id = `i${num}`;
    const esc = DIFFICULTY[st.config.difficulty].esc;
    const arch = ARCHETYPES[archetypeId];
    const callId = opts.noCall ? null : `c${++st.callCounter}`;
    const inc: Incident = {
      id, num, templateId, category: tpl.category, label: tpl.label, severity: sev, status: 'REPORTED', nodeId, district: districtId, reportedNode: null, locationConfirmed: false,
      classification: null, callId, callerName: profile.name, requires, knownReqs: [], stage: 0, maxStage: tpl.escalate?.length ?? 0,
      threat: Math.min(80, tpl.threat[0] * (0.9 + rng.next() * 0.3)), growth: ((g) => (tpl.escalate?.length ? Math.max(STAGE_FLOOR * (0.9 + (g % 0.01) * 20), g) : g))(tpl.threat[1] * THREAT_SCALE * esc * (0.9 + rng.next() * 0.25)), clear: tpl.threat[2], work: tpl.work,
      assignedUnits: [], everAssigned: [], createdAt: st.time, answeredAt: null, locatedAt: null, firstArrivalAt: null, resolvedAt: null, lastStageAt: st.time,
      facts: [], truth, knows: [], unsureKeys: tpl.unsure ? [...tpl.unsure] : [], notes: '', casualties: 0, saved: 0, needsTransport: !!tpl.transport,
      twistRevealed: false, dismissed: false, hidden: false, stabilizeTimer: 0, callbackAt: null, callbackCount: 0, missedCalls: 0, safetyAdvised: false,
      wrongLocationArrivals: 0, sceneReported: false, unnecessary: 0, relatedIds: [], eventId: opts.forceEvent ?? this.activeEventFor(districtId)?.id, workProgress: 0, patientsTransported: 0,
      mislocated: false, firstDispatchAt: null, timelineBlock: false, callerProfile: profile, vars, blockedEdge: null, sceneSeen: false, twist: tpl.twist ?? null, sceneAt: null,
      escalatedAt: null, mutualAid: 0,
      duplicateOf: src ? src.id : null, dupPlan: [], pursuit: !!tpl.pursuit && !src, mover: null, mergedInto: null,
      deadlineAt: tpl.deadline && !src ? st.time + tpl.deadline : null, deadlineMet: null, parentId: opts.connectedTo?.id ?? null,
    };
    if (src) { inc.label = src.label; inc.maxStage = 0; inc.growth = 0; inc.threat = 0; inc.district = src.district; inc.blockedEdge = null; }
    if (inc.pursuit) {
      const n = this.city.nodes[nodeId];
      inc.mover = { x: n.x, y: n.y, prev: nodeId, next: -1, came: -1, speed: tpl.pursuitSpeed ?? 5.6, tracked: true, trail: [], startAt: st.time + (opts.noCall ? 3 : 10), lastUpdate: st.time, lastSighting: st.time, contact: 0, heading: 0, foot: !!tpl.foot };
    } else if (tpl.movingCaller && !src) {
      // a caller driving their patient to hospital: aim for one well across town
      const n = this.city.nodes[nodeId];
      const hs = this.city.landmarks.filter((l) => l.kind === 'hospital').map((l) => l.nodeId).sort((a, b) => Math.hypot(this.city.nodes[b].x - n.x, this.city.nodes[b].y - n.y) - Math.hypot(this.city.nodes[a].x - n.x, this.city.nodes[a].y - n.y));
      profile.callerIdType = 'mobile';
      inc.mover = { x: n.x, y: n.y, prev: nodeId, next: -1, came: -1, speed: 4.2, tracked: false, trail: [], startAt: st.time + 2, lastUpdate: st.time, lastSighting: st.time, contact: 0, heading: 0, caller: true, dest: hs[Math.min(1, hs.length - 1)] ?? nodeId };
    }
    setupThirdParty(inc, archetypeId, tpl.patient);
    if (tpl.id === 'swatting_hoax') { inc.hoax = true; profile.callerIdType = 'voip'; }
    // the first stage does not hang about either
    if (tpl.escalate?.length && !src && inc.growth > 0) inc.growth = Math.max(inc.growth, (100 - inc.threat) / 300);
    // nothing real sits for a quarter of an hour: unattended, it goes wrong within about thirteen minutes
    else if (!src && inc.growth > 0 && tpl.requires.length && !tpl.nonEmergency && tpl.threat[1] >= 0.05) inc.growth = Math.max(inc.growth, (100 - inc.threat) / 780);
    // big incidents draw more than one caller
    const dupable = !src && !opts.tutorial && !tpl.pursuit && !tpl.outside && sev >= 3 && (tpl.category === 'fire' || tpl.id.startsWith('collision') || ['robbery', 'public_disturbance', 'domestic_disturbance', 'water_rescue', 'industrial_accident'].includes(tpl.id));
    if (tpl.dupes && !src && !opts.tutorial) {
      // major incidents light up the switchboard: several people phone about the same thing
      for (let k = 0; k < tpl.dupes; k++) if (k === 0 || rng.chance(Math.min(0.95, 0.7 * modProduct(st.config, 'dupes')))) inc.dupPlan.push(st.time + 14 + k * 24 + rng.range(0, 14));
    } else if (dupable && rng.chance(Math.min(0.95, 0.5 * modProduct(st.config, 'dupes')))) {
      inc.dupPlan.push(st.time + rng.range(18, 40));
      if (sev >= 4 && rng.chance(Math.min(0.9, 0.45 * modProduct(st.config, 'dupes')))) inc.dupPlan.push(st.time + rng.range(45, 75));
    }
    if (tpl.closesRoad && !src) {
      const eid = this.city.adj[nodeId].find((e) => this.city.edges[e].cls === 'local' || this.city.edges[e].cls === 'arterial');
      if (eid !== undefined && !st.closedEdges.includes(eid) && rng.chance(0.5)) { inc.blockedEdge = eid; }
    }
    st.incidents[id] = inc;
    if (tpl.major && !src && !opts.tutorial && tpl.headline) inc.breakAt = st.time + 30;
    if (opts.connectedTo) { inc.relatedIds.push(opts.connectedTo.id); opts.connectedTo.relatedIds.push(id); }
    if (!callId) {
      // reported over the radio, not by phone: location and basic facts are already known
      inc.answeredAt = st.time; inc.reportedNode = nodeId; inc.locationConfirmed = true; inc.locatedAt = st.time; inc.callerName = 'Unit report';
      for (const k of tpl.reported) if (k in truth) this.addFact(inc, k, truth[k], 'confirmed', 'scene');
      this.refreshIncidentStatus(inc);
      return inc;
    }
    // link to related open incidents of the same event
    if (inc.eventId) for (const o of Object.values(st.incidents)) if (o.id !== id && o.eventId === inc.eventId && o.district === inc.district && !['RESOLVED', 'CLOSED'].includes(o.status) && inc.relatedIds.length < 3) { inc.relatedIds.push(o.id); o.relatedIds.push(id); }
    const mood = { panic: profile.panicLevel, base: profile.panicLevel, cooperation: profile.cooperationLevel, frustration: Math.round(rng.range(arch.frustration[0], arch.frustration[1])), trust: 50 };
    void opts.noCall;
    const call: Call = {
      id: callId, incidentId: id, state: 'ringing', profile, isCallback: false, callerId: this.callerId(profile),
      ringStart: st.time, ringTimeout: diff.ring + (st.rank <= 1 ? 8 : 0), answeredAt: null, endedAt: null, transcript: [], badLine: profile.callerIdType === 'mobile' && !opts.tutorial && st.rank >= 1 && ((num * 2654435761) >>> 0) % 100 < 11, mood, asked: {}, promises: [], promiseAt: null, complained: 0,
      heard: [], usedLines: {}, pending: [], holdSince: null, holdTotal: 0, aliUsed: false, verifyAsked: [], locPlan, typing: false, spokeFirst: false, misunderstood: 0, lastSpontaneous: st.time, stateNote: '',
    };
    maybeText(inc, call);
    st.calls[callId] = call;
    st.stats.callsReceived++;
    this.log('call', `Incoming call — ${call.callerId}`, { incidentId: id });
    this.emit({ type: 'ring', callId });
    return inc;
  }

  /** where location-bound incidents can happen: on a runway, along the rail line, at the bank... */
  private hintNodes(hint: NonNullable<Template['nodeHint']>, districtId: string, base: number[]): number[] {
    const city = this.city;
    const all = city.nodesInDistrict[districtId] ?? [];
    const nearLm = (kinds: string[], r = 75) => {
      const out: number[] = [];
      for (const kind of kinds) {
        for (const l of city.landmarks) {
          if (l.kind !== kind || l.district !== districtId) continue;
          const c = city.nodes[l.nodeId];
          for (const n of base) if (Math.hypot(city.nodes[n].x - c.x, city.nodes[n].y - c.y) <= r) out.push(n);
        }
        if (out.length) return out;
      }
      return out;
    };
    switch (hint) {
      case 'runway': return all.filter((n) => { const m = city.nodes[n]; return m.j >= 3 && m.j <= 7 && m.i >= 31 && m.i <= 38; });
      case 'highway': return all.filter((n) => city.adj[n].some((e) => city.edges[e].cls === 'highway'));
      case 'rail': return all.filter((n) => { const j = city.nodes[n].j; return j === 20 || j === 21; });
      case 'water': return base.filter((n) => [17, 24].includes(city.nodes[n].j));
      case 'pool': return nearLm(['pool', 'park']);
      case 'stadium': return nearLm(['stadium', 'campus', 'plaza']);
      case 'mall': return nearLm(['mall', 'campus', 'market', 'plaza', 'airport']);
      case 'transit': return nearLm(['transit', 'airport', 'terminal', 'campus', 'plaza']);
      case 'bank': return nearLm(['bank', 'tower', 'plaza', 'market']);
    }
  }

  /** a new incident that breaks out of an existing one: a getaway van, a victim fleeing a shooting */
  spawnConnected(parent: Incident, templateId: string, opts: { noCall?: boolean } = {}): Incident | null {
    const tpl = TEMPLATE_BY_ID[templateId];
    if (!tpl) return null;
    const st = this.state;
    const city = this.city;
    if (tpl.pursuit || opts.noCall) {
      const child = this.spawnIncident(templateId, parent.district, { connectedTo: parent, noCall: true, nodeId: parent.nodeId });
      this.radio('DISPATCH', tpl.pursuit ? `All units, ${child.label.toLowerCase()} from ${addressOf(city, parent.nodeId)}. Units at INC-${String(parent.num).padStart(4, '0')} may break off to pursue.` : `All units, ${child.label.toLowerCase()} at ${addressOf(city, parent.nodeId)}. All available units respond.`, 'alert', undefined, child.id);
      this.notify(`NEW — ${child.label} (from INC-${String(parent.num).padStart(4, '0')})`, 'bad', child.id);
      this.fx('bad', parent.nodeId, child.label);
      this.emit({ type: 'alert', text: child.label });
      return child;
    }
    const p = city.nodes[parent.nodeId];
    const near = (city.nodesInDistrict[parent.district] ?? []).filter((n) => { const d = Math.hypot(city.nodes[n].x - p.x, city.nodes[n].y - p.y); return d > 40 && d < 170 && city.adj[n].some((e) => city.edges[e].cls !== 'highway'); });
    const nodeId = near.length ? this.rng.pick(near) : parent.nodeId;
    void st;
    return this.spawnIncident(templateId, city.nodes[nodeId].district, { connectedTo: parent, nodeId });
  }

  private activeEventFor(district: string): CityEvent | undefined {
    return this.state.events.find((e) => e.active && e.districts.includes(district));
  }
  private callerId(p: CallerProfile): string {
    const t = p.callerIdType === 'mobile' ? 'WIRELESS' : p.callerIdType === 'landline' ? 'LANDLINE' : p.callerIdType === 'voip' ? 'VOIP' : 'PAYPHONE';
    return `${t} ${p.phone}`;
  }
  instanceTemplate(inc: Incident): Template {
    const base = TEMPLATE_BY_ID[inc.templateId];
    return { ...base, twist: inc.twist ?? undefined };
  }
  private env(call: Call): DialogueEnv {
    const inc = this.state.incidents[call.incidentId];
    return { rng: this.rng, city: this.city, inc, call, tpl: this.instanceTemplate(inc), now: this.state.time };
  }

  // ── Calls ─────────────────────────────────────────────────────────────────
  private updateCalls(dt: number) {
    const st = this.state;
    for (const call of Object.values(st.calls)) {
      const inc = st.incidents[call.incidentId];
      if (call.state === 'ringing') {
        if (st.time - call.ringStart >= call.ringTimeout) this.missCall(call);
        continue;
      }
      if (call.state === 'ended' || call.state === 'missed') continue;
      if (call.state === 'active' && !call.heardSirens && inc && !inc.pursuit) this.checkSirens(call, inc);
      if (call.trace && !call.trace.done) this.updateTrace(call);
      if (call.interpreter === 'connecting') this.updateInterpreter(call);
      // deliver pending lines (only on active calls)
      if (call.state === 'active') {
        while (call.pending.length && !call.pending[0].hold && call.pending[0].at <= st.time) {
          const line = call.pending.shift()!;
          this.deliver(call, line);
          if (call.state !== 'active') break;
        }
        call.typing = call.state === 'active' && call.pending.length > 0;
        if (call.state === 'active' && inc) this.callerQuestions(call, inc);
      }
      if (call.question && st.time >= call.question.expiresAt && (call.state === 'active' || call.state === 'hold')) this.questionTimeout(call);
      if ((call.state as string) === 'ended') continue;
      // emotional model: panic eases toward its baseline
      const m = call.mood;
      if (call.state === 'hold') { call.holdTotal += dt; m.base = Math.min(100, m.base + 0.55 * dt); m.trust = Math.max(0, m.trust - 0.2 * dt); m.cooperation = Math.max(0, m.cooperation - 0.12 * dt); }
      const danger = inc ? Math.max(0, inc.threat - 45) / 55 : 0;
      const target = Math.min(100, m.base + danger * 12);
      m.panic += (target - m.panic) * 0.05 * dt * 2;
      m.panic = Math.max(0, Math.min(100, m.panic));
      call.peakPanic = Math.max(call.peakPanic ?? 0, m.panic);
      if (!call.calmed && call.state === 'active' && (call.peakPanic ?? 0) > 72 && m.panic < 38) { call.calmed = true; st.stats.calmedCallers++; this.notify(`${call.profile.name.split(' ')[0]} has calmed down`, 'good', inc?.id); }
      m.frustration = Math.max(0, m.frustration - 0.04 * dt);
      m.cooperation = Math.max(0, Math.min(100, m.cooperation + (call.profile.cooperationLevel - m.cooperation) * 0.004 * dt));
      call.profile.emotionalState = m.panic > 72 ? 'Panicked' : m.frustration > 58 ? 'Angry' : m.panic > 48 ? 'Frightened' : m.cooperation < 30 ? 'Uncooperative' : m.panic < 15 ? 'Calm' : 'Shaken';
      if (call.state === 'active' && inc) this.composureTick(call, inc, dt);
      if (call.state === 'hold' && call.holdSince !== null && st.time - call.holdSince > 20 && st.time - call.lastSpontaneous > 20) {
        call.lastSpontaneous = st.time;
        this.addTranscript(call, 'CALLER', '(still on hold) ' + spontaneous(this.env(call), 'hold'));
      }
      if (call.state === 'hold' && call.holdSince !== null && st.time - call.holdSince > 75 && !inc.dismissed) {
        // caller gives up
        this.endCall(call.id, 'caller_hung_up');
      }
    }
  }

  /** the caller only hears sirens once a unit running lights-and-sirens is genuinely close */
  private checkSirens(call: Call, inc: Incident) {
    const st = this.state;
    const n = this.city.nodes[inc.nodeId];
    for (const id of inc.assignedUnits) {
      const u = st.units[id];
      if (!u) continue;
      if (u.status === 'ON_SCENE' && this.unitAtScene(u, inc)) { call.heardSirens = true; return; }
      if (u.status !== 'EN_ROUTE' || !this.sirenFor(u) || isAir(u)) continue;
      if (Math.hypot(u.x - n.x, u.y - n.y) < 240) {
        call.heardSirens = true;
        if (!call.pending.some((l) => !l.hold) && st.time - call.lastSpontaneous > 1.5) call.pending.push({ at: st.time + 0.6, text: spontaneous(this.env(call), 'sirens') });
        return;
      }
    }
  }

  private missCall(call: Call) {
    const st = this.state;
    const inc = st.incidents[call.incidentId];
    call.state = 'missed'; call.endedAt = st.time;
    st.stats.callsMissed++;
    st.streak = 0;
    inc.missedCalls++;
    this.log('missed', `Missed call — ${call.callerId}`, { incidentId: inc.id, good: false });
    this.notify('Missed call — the caller hung up', 'bad', inc.id);
    this.emit({ type: 'hangup', callId: call.id });
    if (inc.missedCalls < 2 && inc.reportedNode === null) { inc.callbackAt = st.time + 20; inc.status = 'REPORTED'; }
    else this.loseIncident(inc, 'Unanswered call');
  }

  private loseIncident(inc: Incident, reason: string) {
    const st = this.state;
    inc.hidden = true; inc.dismissed = true; inc.lostReason = reason;
    st.streak = 0;
    if (inc.callbackCount < 2) { inc.callbackAt = st.time + 50 + this.rng.range(0, 15); inc.callbackCount++; }
    this.log('failed', `${inc.label}: unhandled (${reason})`, { incidentId: inc.id, good: false });
  }

  addTranscript(call: Call, who: 'CALLER' | 'DISPATCHER' | 'SYSTEM', text: string, garbled = false) {
    if (who === 'CALLER' && call.text) text = textSpeak(text) || '…';
    call.transcript.push({ t: this.state.time, clock: gameClock(this.state), who, text, ...(garbled ? { garbled: true } : {}) });
    if (who === 'DISPATCHER') call.lastDispatcherAt = this.state.time;
  }

  private deliver(call: Call, line: import('./types').PendingLine) {
    const st = this.state;
    const inc = st.incidents[call.incidentId];
    // scripted lines pass through the caller's own voice (AI-written lines already have it)
    let text = line.hangup || line.ai || line.system ? line.text : speak(line.text, call, this.rng, (s) => fill(s, inc.vars));
    if (call.interpreter === 'on' && !line.hangup && !line.system) text = `(via interpreter) ${text}`;
    // a weak mobile signal: words drop out, and whatever they said is lost until you ask them to repeat it
    if (call.badLine && !line.clear && !line.hangup && !line.system && text.length > 28 && !/^\(/.test(text) && this.hrand(call.transcript.length + inc.num * 31, 77) < 0.3) {
      call.lastGarbled = { ...line, text, clear: true, at: st.time };
      const words = text.split(' ');
      const garbled = words.map((w, k) => (this.hrand(k + inc.num, 78 + k) < 0.4 ? '—' : w)).join(' ').replace(/(— ?){2,}/g, '— ');
      this.addTranscript(call, 'CALLER', `${garbled} [line breaking up]`, true);
      call.spokeFirst = true; call.lastSpontaneous = st.time;
      this.emit({ type: 'caller_line', callId: call.id });
      return;
    }
    this.addTranscript(call, line.hangup || line.system ? 'SYSTEM' : 'CALLER', text);
    call.spokeFirst = true;
    call.lastSpontaneous = st.time;
    this.emit({ type: 'caller_line', callId: call.id });
    if (line.facts) for (const [k, v] of Object.entries(line.facts)) this.addFact(inc, k, v, line.unsure?.includes(k) ? 'unconfirmed' : 'confirmed', 'caller');
    if (line.heard) for (const h of line.heard) this.addHeard(call, h);
    if (line.twist) this.revealTwist(inc, 'caller');
    if (line.hangup) this.endCall(call.id, line.endReason ?? 'caller_hung_up');
    this.refreshIncidentStatus(inc);
  }

  addFact(inc: Incident, key: string, value: FactVal, confidence: Fact['confidence'], source: Fact['source']) {
    const label = FACT_LABELS[key] ?? key;
    const existing = inc.facts.filter((f) => f.key === key);
    const same = existing.find((f) => f.value === value && f.confidence !== 'contradicted');
    if (same) { if (confidence === 'confirmed') same.confidence = 'confirmed'; return; }
    for (const f of existing) if (f.confidence !== 'contradicted') f.confidence = 'contradicted';
    inc.facts.push({ key, label, value, confidence, source, at: this.state.time });
    if (!inc.knows.includes(key)) inc.knows.push(key);
  }

  private addHeard(call: Call, h: Omit<HeardLocation, 'id' | 'at'>) {
    // new, different statements contradict older unsure ones on a different node
    const dup = call.heard.find((x) => x.nodeId === h.nodeId && x.source === h.source);
    if (dup) { if (h.reliability === 'sure') dup.reliability = 'sure'; return; }
    if (h.reliability === 'sure' || h.source === 'cross') {
      for (const x of call.heard) if (x.nodeId !== h.nodeId && x.source !== 'district' && x.reliability === 'unsure' && Math.hypot(this.city.nodes[x.nodeId].x - this.city.nodes[h.nodeId].x, this.city.nodes[x.nodeId].y - this.city.nodes[h.nodeId].y) > 150) x.reliability = 'contradicted';
    }
    call.heard.push({ ...h, id: `h${call.heard.length + 1}`, at: this.state.time });
  }

  private revealTwist(inc: Incident, source: 'caller' | 'scene') {
    const tw = inc.twist;
    if (!tw || inc.twistRevealed) return;
    inc.twistRevealed = true;
    for (const [k, v] of Object.entries(tw.facts)) { inc.truth[k] = v; this.addFact(inc, k, v, 'confirmed', source === 'scene' ? 'scene' : 'caller'); }
    if (tw.requires) {
      inc.requires = tw.requires.map((r) => adaptReqForRank(r, this.state.rank));
      if (!tw.requires.length) { inc.truth.false_alarm = true; this.addFact(inc, 'false_alarm', true, 'confirmed', source === 'scene' ? 'scene' : 'caller'); }
      else inc.truth.false_alarm = false;
      if (tw.requires.some((r) => r.cap === 'bls' || r.cap === 'als')) inc.needsTransport = true;
    }
    if (tw.label) inc.label = tw.label;
    if (tw.severity) inc.severity = tw.severity;
    if (tw.threat !== undefined) inc.threat = tw.threat;
    if (tw.requires && tw.requires.length && inc.status === 'STABILIZING') inc.status = 'ON_SCENE';
    this.log('info', `Revealed: ${inc.label}`, { incidentId: inc.id });
    if (source === 'caller') this.notify(`New information — ${inc.label}`, 'warn', inc.id);
    if (source === 'caller' && inc.sceneSeen) { const here = this.onScene(inc)[0]; if (here) this.askSpecialist(inc, here); }
  }

  answerCall(callId: string): boolean {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || (call.state !== 'ringing' && call.state !== 'hold')) return false;
    const inc = st.incidents[call.incidentId];
    // put the current call on hold
    if (st.activeCallId && st.activeCallId !== callId) { const cur = st.calls[st.activeCallId]; if (cur && cur.state === 'active') this.holdCall(cur.id); }
    const wasRinging = call.state === 'ringing';
    if (call.state === 'hold' && call.holdSince !== null) { call.holdSince = null; }
    call.state = 'active';
    st.activeCallId = callId;
    if (wasRinging) {
      call.answeredAt = st.time;
      if (!call.isCallback) { st.stats.callsAnswered++; st.stats.answerTimes.push(st.time - call.ringStart); }
      else { st.stats.callbacks++; }
      inc.answeredAt = inc.answeredAt ?? st.time;
      if (inc.status === 'REPORTED') inc.status = 'AWAITING_INFORMATION';
      this.addTranscript(call, 'SYSTEM', `Call connected — ${call.callerId}`);
      this.log('call', `Call answered — ${call.callerId}`, { incidentId: inc.id });
      if (inc.regular && !call.isCallback) regularOnAnswer(this, call, inc);
      if (call.isCallback) {
        for (const p of call.pending) if (p.at < 0) p.at = st.time + 1.4;
      } else {
        const lines = openingLines(this.env(call));
        const clue = backgroundClue(inc.templateId, st.weather, inc.truth);
        if (clue) this.addTranscript(call, 'SYSTEM', clue);
        lines.forEach((l, i) => call.pending.push({ ...l, at: st.time + 1.2 + i * 1.5 }));
        if (this.aiMode && this.aiVoiced(call)) this.holdForAi(call, call.pending.filter((l) => !l.hold && l.at > st.time && !l.system), 'opening', '');
      }
    } else {
      this.addTranscript(call, 'SYSTEM', 'Call resumed');
    }
    this.select('incident', inc.id);
    this.emit({ type: 'answer', callId });
    this.refreshIncidentStatus(inc);
    return true;
  }

  holdCall(callId: string) {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return;
    call.state = 'hold'; call.holdSince = st.time; call.pending = call.pending.filter((p) => p.at < 0);
    if (st.activeCallId === callId) st.activeCallId = null;
    this.addTranscript(call, 'SYSTEM', 'Caller placed on hold');
  }

  /** player asks / says something */
  ask(callId: string, input: { intent?: Intent; text?: string }) {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return;
    const inc = st.incidents[call.incidentId];
    const text = (input.text ?? QUICK_QUESTIONS.find((q) => q.intent === input.intent)?.text ?? '').trim();
    if (!text) return;
    if (!input.intent && /\b(say (that )?again|repeat (that|yourself)|breaking up|didn'?t (catch|get) (that|you)|come again|you('re| are) cutting out|bad line)\b/i.test(text)) { this.sayAgain(callId, text); return; }
    // the caller asked you something: what you say is your answer, if it answers it
    if (call.question) { const opt = matchOption(text, call.question.options); if (opt) { this.answerCaller(callId, opt, text); return; } }
    const intent: Intent = input.intent ?? classifyIntent(text);
    this.addTranscript(call, 'DISPATCHER', text);
    const blocked = thirdPartyBlock(inc, intent) ?? relayBlock(call, intent);
    if (blocked) {
      call.asked[intent] = (call.asked[intent] ?? 0) + 1;
      const line = { at: Math.max(st.time, ...call.pending.map((p) => p.at)) + 1.6, text: blocked };
      call.pending.push(line);
      if (this.aiMode && this.aiVoiced(call)) this.holdForAi(call, [line], `${intent} (they cannot know this)`, text);
      return;
    }
    const env = this.env(call);
    const r = replyTo(env, intent, text);
    call.asked[intent] = (call.asked[intent] ?? 0) + 1;
    const m = call.mood;
    if (r.mood.panic) m.panic = Math.max(0, Math.min(100, m.panic + r.mood.panic));
    if (r.mood.base) m.base = Math.max(0, Math.min(100, m.base + r.mood.base));
    if (r.mood.cooperation) m.cooperation = Math.max(0, Math.min(100, m.cooperation + r.mood.cooperation));
    if (r.mood.frustration) m.frustration = Math.max(0, Math.min(100, m.frustration + r.mood.frustration));
    if (r.mood.trust) m.trust = Math.max(0, Math.min(100, m.trust + r.mood.trust));
    if (r.promise) { call.promises.push('help'); call.promiseAt = st.time; }
    if (r.safety && ['fire', 'police', 'unusual'].includes(inc.category)) inc.safetyAdvised = true;
    if (r.aid) this.applyAid(inc, call, r.aid);
    if (inc.aid?.kind === 'cpr' && ['calm', 'stay', 'inst_cpr', 'promise'].includes(intent)) inc.aid.encouragedAt = st.time;
    // schedule reply lines with a natural pace
    const arch = ARCHETYPES[call.profile.archetype];
    let at = Math.max(st.time, ...call.pending.filter((p) => !p.hold).map((p) => p.at));
    const added: import('./types').PendingLine[] = [];
    for (const l of r.lines) {
      const len = l.text.length;
      const pace = (arch.slow ? 1.5 : 1) * (m.panic > 70 ? 0.7 : 1) * (call.profile.archetype === 'terse' ? 1.2 : 1) * (call.text ? 2.2 : 1);
      at += Math.min(4.5, (0.9 + len * 0.028) * pace);
      const line = { ...l, at };
      call.pending.push(line);
      added.push(line);
    }
    if (this.aiMode && added.length && !r.hangup && this.aiVoiced(call)) this.holdForAi(call, added.filter((l) => !l.system), intent, text);
  }

  // ── AI voicing hooks (the dialogue model rewrites lines; the engine stays authoritative) ──
  get aiMode(): boolean { return !!this.state.flags.ai; }
  /** silent callers tap and foreign-language callers need an interpreter: those lines stay scripted */
  private aiVoiced(call: Call): boolean { return call.profile.archetype !== 'silent' && !(call.profile.language && call.interpreter !== 'on'); }
  private holdForAi(call: Call, lines: import('./types').PendingLine[], intent: string, playerText: string) {
    const st = this.state;
    const ids: number[] = [];
    for (const l of lines) { l.id = ++st.lineCounter; l.hold = true; ids.push(l.id); }
    this.emit({ type: 'ai_request', callId: call.id, lineIds: ids, intent, playerText });
  }
  /** apply an AI-written reply to held lines. Facts, locations and twists come only from the engine's own lines or validated reveal keys. */
  voiceLines(callId: string, lineIds: number[], text: string, extra: { calm?: number; coop?: number; reveal?: string[] } = {}): boolean {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state === 'ended' || call.state === 'missed') return false;
    const held = call.pending.filter((l) => l.id !== undefined && lineIds.includes(l.id) && l.hold);
    if (!held.length) return false;
    const first = held[0];
    for (const l of held.slice(1)) {
      first.facts = { ...(first.facts ?? {}), ...(l.facts ?? {}) };
      first.unsure = [...(first.unsure ?? []), ...(l.unsure ?? [])];
      first.heard = [...(first.heard ?? []), ...(l.heard ?? [])];
      first.twist = first.twist || l.twist; first.hangup = first.hangup || l.hangup;
    }
    call.pending = call.pending.filter((l) => !held.includes(l) || l === first);
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 420);
    if (clean) first.text = clean;
    // validated reveals for free-form questions
    const inc = st.incidents[call.incidentId];
    for (const key of extra.reveal ?? []) {
      if (key === 'address' || key === 'landmark') {
        const r = replyTo(this.env(call), key as Intent, '');
        for (const l of r.lines) { if (l.heard) first.heard = [...(first.heard ?? []), ...l.heard]; if (l.facts) first.facts = { ...(first.facts ?? {}), ...l.facts }; }
        call.asked[key] = (call.asked[key] ?? 0) + 1;
        continue;
      }
      const allowed = REVEAL_KEYS[key];
      if (!allowed) continue;
      const tpl = this.instanceTemplate(inc);
      for (const fk of allowed) if (fk in inc.truth && !(tpl.blind ?? []).includes(fk)) first.facts = { ...(first.facts ?? {}), [fk]: inc.truth[fk] };
      if (inc.twist && !inc.twistRevealed && inc.twist.topics.includes(key)) {
        call.pending.push({ at: st.time + 2.5, text: fill(inc.twist.say[0], inc.vars), facts: inc.twist.facts, twist: true });
      }
    }
    first.hold = false; first.ai = true;
    first.at = Math.max(st.time + 0.3, first.at - 1e9 > 0 ? st.time + 0.3 : st.time + 0.3);
    const m = call.mood;
    const calm = Math.max(-3, Math.min(3, extra.calm ?? 0)), coop = Math.max(-3, Math.min(3, extra.coop ?? 0));
    m.panic = Math.max(0, Math.min(100, m.panic - calm * 4)); m.base = Math.max(0, Math.min(100, m.base - calm * 3));
    m.cooperation = Math.max(0, Math.min(100, m.cooperation + coop * 4)); m.frustration = Math.max(0, Math.min(100, m.frustration - calm * 2));
    st.stats.aiLines++;
    return true;
  }
  /** give up on AI voicing: deliver the scripted lines */
  releaseLines(callId: string, lineIds: number[]) {
    const st = this.state;
    const call = st.calls[callId];
    if (!call) return;
    let at = st.time + 0.3;
    for (const l of call.pending) if (l.id !== undefined && lineIds.includes(l.id) && l.hold) { l.hold = false; l.at = at; at += 1.4; }
  }
  /** flavour-only persona details from the procedural persona generator */
  applyPersona(callId: string, persona: NonNullable<CallerProfile['persona']> & { name?: string; age?: number }) {
    const call = this.state.calls[callId];
    if (!call || call.isCallback) return;
    const p = call.profile;
    if (persona.name && /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(persona.name)) { p.name = persona.name; const inc = this.state.incidents[call.incidentId]; if (inc && inc.callerProfile.id === p.id) { inc.callerName = p.name; inc.callerProfile.name = p.name; } }
    const clip = (x: unknown, n: number) => String(x ?? '').slice(0, n);
    p.persona = { occupation: clip(persona.occupation, 60), quirk: clip(persona.quirk, 120), background: clip(persona.background, 200), catchphrase: clip(persona.catchphrase, 80), voice: clip(persona.voice, 120) };
    // the persona's catchphrase also colours scripted lines
    if (p.voice && p.persona.catchphrase && p.persona.catchphrase.length <= 40) p.voice.catchphrase = p.persona.catchphrase.replace(/[.!?]+$/, '');
  }

  // ── Pre-arrival instructions ──────────────────────────────────────────────
  private applyAid(inc: Incident, call: Call, aid: { kind: string; fit: 'good' | 'bad' | 'neutral' }) {
    const st = this.state;
    if (aid.fit === 'neutral') return;
    const prev = inc.aid;
    inc.aid = { kind: aid.kind, fit: aid.fit, at: st.time, encouragedAt: st.time };
    if (prev && prev.kind === aid.kind && prev.fit === aid.fit) return;
    const label: Record<string, string> = { cpr: 'CPR in progress', recovery: 'Recovery position', pressure: 'Pressure on wound', still: 'Patient kept still', lock: 'Caller hiding', evacuate: 'Evacuated', water: 'Small sips of water', lift: 'Helped out of danger' };
    if (aid.fit === 'good') { st.stats.aidGood++; this.addFact(inc, 'aid', label[aid.kind] ?? aid.kind, 'confirmed', 'caller'); this.fx('good', inc.reportedNode ?? inc.nodeId, label[aid.kind] ?? 'First aid'); return; }
    st.stats.aidBad++;
    this.fx('bad', inc.reportedNode ?? inc.nodeId, 'Harmful instruction');
    this.harm(inc, call, aid.kind);
  }

  consequence(inc: Incident, text: string) {
    (inc.consequences ??= []).push(text);
    this.log('failed', `${inc.label}: ${text}`, { incidentId: inc.id, good: false });
  }
  /** what a wrong instruction actually does to the people on the other end of the line */
  private harm(inc: Incident, call: Call, kind: string) {
    const st = this.state;
    const t = inc.truth;
    const hurt = (n = 1) => { t.injured = (typeof t.injured === 'number' ? t.injured : 0) + n; inc.requires = mergeReqs(inc.requires, [{ cap: 'als', n: 1 }, { cap: 'transport', n: Math.min(3, Number(t.injured)) }].map((r) => adaptReqForRank(r as Req, st.rank))); inc.needsTransport = true; };
    st.stats.harmfulAdvice++;
    switch (kind) {
      case 'cpr': if (inc.survival !== undefined) inc.survival = Math.max(0, inc.survival - 8); this.consequence(inc, 'CPR was ordered on a patient who was breathing'); break;
      case 'recovery': this.consequence(inc, 'A patient in cardiac arrest was put in the recovery position instead of receiving CPR'); break;
      case 'water': if (inc.survival !== undefined) inc.survival = Math.max(0, inc.survival - 18); inc.threat = Math.min(99, inc.threat + 12); this.consequence(inc, 'The caller was told to give water — the patient choked'); break;
      case 'lift':
        if (inc.survival !== undefined) inc.survival = Math.max(0, inc.survival - 12);
        inc.threat = Math.min(99, inc.threat + 15);
        if (inc.lifeThreat !== 'arrest') { inc.severity = Math.min(5, inc.severity + 1); this.consequence(inc, 'The patient was moved against medical advice — the injury got worse'); }
        else this.consequence(inc, 'Precious seconds were lost moving a patient who needed CPR');
        break;
      case 'still': case 'lock':
        this.consequence(inc, kind === 'lock' ? 'The caller was told to shelter inside a building that was on fire' : 'The caller was told to stay put inside a burning building');
        inc.threat = Math.min(99, inc.threat + 10);
        break;
      case 'goback':
        hurt(1);
        t.trapped = (typeof t.trapped === 'number' ? t.trapped : 0) + 1;
        inc.requires = mergeReqs(inc.requires, [adaptReqForRank({ cap: 'rescue', n: 1 }, st.rank)]);
        inc.threat = Math.min(99, inc.threat + 20);
        this.consequence(inc, 'The caller was sent back into the fire and was overcome by smoke');
        call.pending.push({ at: st.time + 6, text: '(the line fills with coughing, then goes quiet)', hangup: true });
        break;
      case 'peek':
        if (inc.survival !== undefined) inc.survival = Math.max(0, inc.survival - 12);
        inc.threat = Math.min(99, inc.threat + 10);
        this.consequence(inc, 'The caller lifted the dressing to look and the bleeding started again');
        break;
      case 'smokerun':
        hurt(1); inc.threat = Math.min(99, inc.threat + 15);
        this.consequence(inc, 'The caller opened a door into the smoke and was overcome');
        call.pending.push({ at: st.time + 5, text: '(coughing, a door slams, then the line goes quiet)', hangup: true });
        break;
      case 'push':
        hurt(1); inc.threat = Math.min(99, inc.threat + 12);
        this.consequence(inc, 'Bystanders tried to push a leaking car and someone was hurt');
        break;
      case 'gasback':
        hurt(1);
        inc.threat = Math.min(99, inc.threat + 20);
        this.consequence(inc, 'The caller was sent back into a building full of gas and collapsed');
        call.pending.push({ at: st.time + 6, text: '(a thud, then nothing but a hiss on the line)', hangup: true });
        break;
      case 'confront':
        hurt(1);
        inc.threat = Math.min(99, inc.threat + 18);
        this.consequence(inc, 'The caller was told to confront the suspect and was attacked');
        call.pending.push({ at: st.time + 5, text: '(the call disconnects)', hangup: true });
        break;
    }
    if (['goback', 'gasback', 'confront', 'smokerun'].includes(kind)) { inc.casualties += 0; this.notify(`Your instruction put the caller in danger — ${inc.label}`, 'bad', inc.id); }
  }

  /** survival clock for patients with a life threat: falls until professional care arrives, faster without good instructions */
  private updateSurvival(inc: Incident, here: Unit[], dt: number) {
    const st = this.state;
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    const threat = lifeThreatOf(tpl, inc.truth, inc.severity);
    if (!threat) { if (inc.lifeThreat && inc.careAt == null) inc.lifeThreat = null; return; }
    if (inc.lifeThreat !== threat) { inc.lifeThreat = threat; inc.survival ??= 100; }
    if (inc.careAt != null) return;
    const care = here.some((u) => u.capabilities.some((c) => c === 'als' || c === 'bls' || c === 'first_aid'));
    if (care) {
      inc.careAt = st.time;
      const u = here.find((x) => x.capabilities.includes('als') || x.capabilities.includes('bls'));
      if (u) this.radio(u.spoken, `Dispatch, ${u.spoken}. We have the patient${inc.aid?.fit === 'good' ? ` — the bystander's ${inc.aid.kind === 'cpr' ? 'CPR' : 'first aid'} bought us time` : ''}.`, 'unit', u.id, inc.id);
      return;
    }
    const a = inc.aid;
    let rate: number;
    if (threat === 'arrest') {
      if (a?.kind === 'cpr' && a.fit === 'good') {
        const call = this.callFor(inc);
        const coached = !!call && call.state === 'active';
        const since = st.time - a.encouragedAt;
        rate = 0.1 + Math.min(0.42, Math.max(0, since - (coached ? 60 : 20)) / (coached ? 500 : 200));
        // counting the rhythm with the caller keeps compressions at the right rate
        if (coached && a.pacedAt !== undefined && st.time - a.pacedAt < 6) rate *= 0.6;
      } else rate = a && a.fit === 'bad' ? 0.72 : 0.62;
    } else if (threat === 'airway') rate = a?.kind === 'recovery' && a.fit === 'good' ? 0.03 : a?.fit === 'bad' ? 0.3 : 0.16;
    else rate = a?.kind === 'pressure' && a.fit === 'good' ? 0.06 : a?.fit === 'bad' ? 0.42 : 0.3;
    inc.survival = Math.max(0, (inc.survival ?? 100) - rate * dt);
    if (inc.survival <= 0) this.patientDied(inc, threat);
  }

  private patientDied(inc: Incident, threat: 'arrest' | 'bleed' | 'airway') {
    const st = this.state;
    const a = inc.aid;
    const guided = a?.fit === 'good' && (threat === 'arrest' ? a.kind === 'cpr' : threat === 'airway' ? a.kind === 'recovery' : a.kind === 'pressure');
    const why = guided ? 'Help did not arrive in time.' : threat === 'arrest' ? (a?.fit === 'bad' ? 'The wrong instructions were given — nobody did CPR.' : 'Nobody started CPR before help arrived.') : threat === 'airway' ? 'The airway was never protected — no recovery position.' : 'The bleeding was never controlled — no pressure on the wound.';
    if (!guided) st.stats.guidanceDeaths++;
    this.consequence(inc, `The patient died. ${why}`);
    inc.casualties++; st.stats.casualties++;
    inc.lostReason = why;
    this.finishIncident(inc, 'failed');
    st.stats.failed++;
    this.notify(`PATIENT DIED — ${inc.label}. ${why}`, 'bad', inc.id);
    this.headline(`Tragedy in ${this.city.districtById[inc.district]?.name ?? 'Ravenport'} as patient dies before help arrives`, 'bad');
    this.emit({ type: 'failed', incidentId: inc.id });
    this.emit({ type: 'alert', text: 'Patient died' });
    const call = this.callFor(inc);
    if (call && call.state === 'active') call.pending.push({ at: st.time + 1.2, text: fill("(sobbing) {He}'s... {he}'s gone. {He}'s not— oh god...", inc.vars) });
  }
  /** how instructions given over the phone change how fast the incident deteriorates */
  aidFactor(inc: Incident): number {
    const a = inc.aid;
    if (!a) return 1;
    if (a.fit === 'bad') return a.kind === 'cpr' ? 1.15 : 1.2;
    const base: Record<string, number> = { cpr: 0.4, recovery: 0.7, pressure: 0.7, still: 0.85, lock: 0.75, evacuate: 0.85 };
    let f = base[a.kind] ?? 1;
    if (a.kind === 'cpr') {
      // a caller doing CPR tires quickly without coaching
      const call = this.callFor(inc);
      const coached = call && call.state === 'active';
      const since = this.state.time - a.encouragedAt;
      f = Math.min(0.9, 0.4 + Math.max(0, since - (coached ? 60 : 20)) / (coached ? 400 : 160));
    }
    return f;
  }

  say(callId: string, text: string) { this.ask(callId, { text }); }
  /** ask a caller on a bad line to repeat what was lost */
  sayAgain(callId: string, text = "Say again? You're breaking up."): boolean {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return false;
    this.addTranscript(call, 'DISPATCHER', text);
    const g = call.lastGarbled;
    if (!g) { call.pending.push({ at: st.time + 1, text: this.qpick(call, ["I said — never mind, can you hear me now?", 'Hello? Can you hear me?', "I didn't say anything — I'm waiting!"]) }); return false; }
    call.lastGarbled = null;
    call.pending.push({ ...g, at: st.time + 1.2, text: `${this.qpick(call, ['I SAID — ', 'Can you hear me now? ', 'Sorry — ', ''])}${g.text}`, clear: true, ai: true });
    st.stats.sayAgains = (st.stats.sayAgains ?? 0) + 1;
    return true;
  }

  /** read-back verification of a candidate location with the caller */
  verifyLocation(callId: string, nodeId: number) {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return;
    const inc = st.incidents[call.incidentId];
    this.addTranscript(call, 'DISPATCHER', `Let me confirm — you are at ${fullAddress(this.city, nodeId)}. Is that correct?`);
    const v = verifyReply(this.env(call), nodeId);
    call.verifyAsked.push(nodeId);
    st.stats.locationChecks++;
    const at = st.time + 1.6;
    call.pending.push({ at, text: v.text });
    if (v.ok === true) { st.stats.verifiedOk++; inc.locationConfirmed = inc.reportedNode === nodeId; this.addHeard(call, { nodeId: inc.nodeId, label: `${addressOf(this.city, nodeId)} (read-back confirmed)`, source: 'address', reliability: 'sure' }); }
    if (v.ok === false) for (const h of call.heard) if (h.nodeId === nodeId) h.reliability = 'contradicted';
  }

  requestLocation(callId: string): string {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || (call.state !== 'active' && call.state !== 'hold')) return 'No active call';
    const level = st.upgrades.ali ?? 0;
    if (call.aliUsed) return 'Location lookup already performed for this call';
    const res = aliLookup(this.env(call), level);
    if (!res) return 'Caller location lookup is not installed';
    call.aliUsed = true;
    this.addTranscript(call, 'SYSTEM', res.message);
    this.addHeard(call, res.heard);
    return res.message;
  }

  endCall(callId: string, reason = 'dispatcher'): void {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state === 'ended' || call.state === 'missed') return;
    const inc = st.incidents[call.incidentId];
    call.state = 'ended'; call.endedAt = st.time; call.endReason = reason; call.pending = []; call.typing = false;
    if (st.activeCallId === callId) st.activeCallId = null;
    this.addTranscript(call, 'SYSTEM', reason === 'caller_hung_up' ? 'Caller disconnected' : reason === 'transferred' ? 'Call transferred' : reason === 'handover' ? 'Caller went to meet the crew — call closed' : reason === 'redirected' ? 'Caller transferred to the non-emergency line' : 'Call ended by dispatcher');
    this.log('call', `Call ended (${reason === 'dispatcher' ? 'dispatcher' : reason.replace('_', ' ')}) — ${inc.label}`, { incidentId: inc.id });
    this.emit({ type: 'hangup', callId });
    if (inc.truth.outside && reason !== 'transferred') { this.resolveOutside(inc, false); return; }
    if (inc.reportedNode === null && !inc.truth.outside && !inc.dismissed) {
      // location never established — the caller will try again
      if (inc.callbackCount < 2) { inc.callbackAt = st.time + 14 + this.rng.range(0, 8); inc.callbackCount++; this.notify('Call ended before a location was set — expect a callback', 'warn', inc.id); }
      else this.loseIncident(inc, 'No location');
    }
    this.refreshIncidentStatus(inc);
  }

  /** transfer — to the neighbouring agency for out-of-area calls, or to a dispatch assistant */
  transferCall(callId: string): string {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return 'No active call';
    const inc = st.incidents[call.incidentId];
    if (inc.truth.outside) {
      this.addTranscript(call, 'DISPATCHER', "You're outside Ravenport — I'm transferring you to the neighbouring county's dispatch now. Stay on the line.");
      this.endCall(callId, 'transferred');
      this.resolveOutside(inc, true);
      return 'Transferred to the neighbouring agency';
    }
    const lvl = st.upgrades.assistant ?? 0;
    if (lvl <= 0) return 'No dispatch assistants available — upgrade Dispatch Assistants';
    if (st.assistantFreeAt > st.time) return `Assistant busy for ${Math.ceil(st.assistantFreeAt - st.time)}s`;
    this.addTranscript(call, 'DISPATCHER', "I'm handing you to a colleague who will confirm your location and send help.");
    const delay = lvl >= 2 ? 14 : 22;
    st.assistantFreeAt = st.time + delay + 20;
    this.endCall(callId, 'transferred');
    inc.callbackAt = null;
    // assistant finishes later
    const accuracy = lvl >= 2 ? 0.92 : 0.78;
    inc.notes += (inc.notes ? '\n' : '') + `Transferred to assistant at ${gameClock(st)}`;
    const when = st.time + delay;
    (this as unknown as { _assist?: Array<{ at: number; id: string; acc: number }> })._assist ??= [];
    (this as unknown as { _assist: Array<{ at: number; id: string; acc: number }> })._assist.push({ at: when, id: inc.id, acc: accuracy });
    this.notify('Call transferred to an assistant — location pending', 'info', inc.id);
    return 'Transferred to assistant';
  }
  private runAssistants() {
    const arr = (this as unknown as { _assist?: Array<{ at: number; id: string; acc: number }> })._assist;
    if (!arr || !arr.length) return;
    const st = this.state;
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (st.time < a.at) continue;
      arr.splice(i, 1);
      const inc = st.incidents[a.id];
      if (!inc || inc.reportedNode !== null) continue;
      const call = Object.values(st.calls).filter((c) => c.incidentId === inc.id).sort((x, y) => y.ringStart - x.ringStart)[0];
      const best = call?.heard.filter((h) => h.reliability !== 'contradicted').sort((x, y) => (y.reliability === 'sure' ? 1 : 0) - (x.reliability === 'sure' ? 1 : 0))[0];
      if (best && this.rng.chance(a.acc)) { this.setIncidentLocation(inc.id, best.nodeId, 'assistant'); this.notify(`Assistant set location for ${inc.label}`, 'good', inc.id); }
      else { inc.callbackAt = st.time + 8; inc.callbackCount = Math.min(inc.callbackCount, 1); this.notify('Assistant could not confirm the location — caller will call back', 'warn', inc.id); }
    }
  }

  private resolveOutside(inc: Incident, ok: boolean) {
    const st = this.state;
    inc.status = 'CLOSED'; inc.resolvedAt = st.time; inc.outcome = ok ? 'success' : 'mishandled';
    st.stats.byCategory.unusual = st.stats.byCategory.unusual ?? { n: 0, ok: 0 };
    st.stats.byCategory.unusual.n++;
    if (ok) { st.stats.byCategory.unusual.ok++; st.stats.resolved++; st.stats.transfersOk++; st.streak++; st.stats.bestStreak = Math.max(st.stats.bestStreak, st.streak); st.stats.bonus += 400; this.notify('Out-of-area call transferred correctly', 'good', inc.id); this.log('resolved', 'Out-of-area call transferred', { incidentId: inc.id, good: true }); }
    else { st.stats.mishandled++; this.notify('Out-of-area caller was dropped without a transfer', 'bad', inc.id); this.log('failed', 'Out-of-area caller dropped', { incidentId: inc.id, good: false }); }
  }

  private updateCallbacks() {
    const st = this.state;
    this.runAssistants();
    for (const inc of Object.values(st.incidents)) {
      if (inc.callbackAt === null || st.time < inc.callbackAt) continue;
      if (['RESOLVED', 'CLOSED'].includes(inc.status) || inc.callId === null) { inc.callbackAt = null; continue; }
      // don't stack callbacks while a call for this incident is live
      if (Object.values(st.calls).some((c) => c.incidentId === inc.id && (c.state === 'ringing' || c.state === 'active' || c.state === 'hold'))) { inc.callbackAt = st.time + 8; continue; }
      inc.callbackAt = null;
      this.createCallback(inc);
    }
  }

  createCallback(inc: Incident, reason?: string) {
    const st = this.state;
    const prev = Object.values(st.calls).filter((c) => c.incidentId === inc.id).sort((a, b) => b.ringStart - a.ringStart)[0];
    const profile: CallerProfile = JSON.parse(JSON.stringify(inc.callerProfile));
    const tpl = this.instanceTemplate(inc);
    const why = reason ?? (inc.wrongLocationArrivals > 0 && inc.mislocated ? 'nothing_found' : inc.hidden ? 'dismissed' : inc.reportedNode === null ? 'no_location' : inc.stage > 0 ? 'escalated' : 'waiting');
    const id = `c${++st.callCounter}`;
    const mood = prev ? { ...prev.mood, panic: Math.min(100, prev.mood.panic + 14), base: Math.min(100, prev.mood.base + 14), frustration: Math.min(100, prev.mood.frustration + 12), trust: Math.max(0, prev.mood.trust - 12) } : { panic: 60, base: 60, cooperation: 55, frustration: 20, trust: 40 };
    if (why === 'nothing_found') profile.locationAccuracy = 'exact';
    const call: Call = {
      id, incidentId: inc.id, state: 'ringing', profile, isCallback: true, callerId: this.callerId(profile) + ' (callback)', ringStart: st.time,
      ringTimeout: DIFFICULTY[st.config.difficulty].ring, answeredAt: null, endedAt: null, transcript: [], mood, asked: {}, promises: prev?.promises ?? [], promiseAt: prev?.promiseAt ?? null,
      complained: 0, heard: prev ? prev.heard.map((h) => ({ ...h })) : [], usedLines: {}, pending: [], holdSince: null, holdTotal: 0, aliUsed: prev?.aliUsed ?? false, verifyAsked: [],
      locPlan: prev?.locPlan ?? makeLocPlan(this.rng, this.city, inc.nodeId), typing: false, spokeFirst: true, misunderstood: 0, lastSpontaneous: st.time, stateNote: why, callbackOf: prev?.id,
    };
    const env: DialogueEnv = { rng: this.rng, city: this.city, inc, call, tpl, now: st.time };
    const cause = tpl.cause.length ? fill(this.rng.pick(tpl.cause), inc.vars) : 'it has not stopped';
    let text: string;
    switch (why) {
      case 'nothing_found': text = `Hello? I called earlier — the officers came but they went to the wrong place! We're not where they went. ${spontaneous(env, 'nothing_found')}`; break;
      case 'no_location': text = `Hello? I called a minute ago and we got cut off. You never got my location! ${spontaneous(env, 'waiting')}`; break;
      case 'escalated': text = `It's me again, I called earlier. ${spontaneous(env, 'escalated')}`; break;
      case 'dismissed': text = `I called earlier and nobody came. ${cause} It's getting worse!`; break;
      default: text = `Hello? I called a while ago and nobody has arrived. ${spontaneous(env, 'waiting')}`;
    }
    call.pending.push({ at: -1, text });
    if (why === 'escalated' || why === 'dismissed') call.mood.base = Math.min(100, call.mood.base + 10);
    st.calls[id] = call;
    inc.hidden = false; inc.dismissed = false;
    st.stats.callsReceived++;
    this.log('call', `Callback — ${inc.label}`, { incidentId: inc.id });
    this.emit({ type: 'ring', callId: id });
    this.notify(`Callback incoming — ${inc.label}`, 'warn', inc.id);
  }

  // ── Incident bookkeeping ──────────────────────────────────────────────────
  setIncidentLocation(incId: string, nodeId: number, source: 'map' | 'candidate' | 'search' | 'assistant' = 'candidate') {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status) || inc.truth.outside) return;
    const first = inc.reportedNode === null;
    inc.reportedNode = nodeId;
    inc.locationConfirmed = nodeId === inc.nodeId && (source === 'candidate' || source === 'assistant');
    if (first) { inc.locatedAt = st.time; this.log('info', `Location set: ${fullAddress(this.city, nodeId)}`, { incidentId: incId }); }
    else this.log('info', `Location corrected: ${fullAddress(this.city, nodeId)}`, { incidentId: incId });
    inc.callbackAt = null;
    // the committed location might be wrong; track mislocated
    const truthNode = inc.search?.origin ?? inc.nodeId;
    inc.mislocated = Math.hypot(this.city.nodes[nodeId].x - this.city.nodes[truthNode].x, this.city.nodes[nodeId].y - this.city.nodes[truthNode].y) > (inc.search || SEARCH_TEMPLATES.has(inc.templateId) ? 220 : 90);
    if (SEARCH_TEMPLATES.has(inc.templateId) && (!inc.search || (!inc.search.found && inc.search.sectors.every((x) => x.searched === 0)) || inc.search.exhausted)) this.buildSearch(inc, nodeId);
    // redirect units
    for (const uid of inc.assignedUnits) {
      const u = st.units[uid];
      if (u && (u.status === 'EN_ROUTE' || u.status === 'DISPATCHED' || (u.status === 'ON_SCENE' && !inc.pursuit && !this.unitAtScene(u, inc)))) {
        if (u.status === 'ON_SCENE') { u.status = 'EN_ROUTE'; this.radio(u.spoken, `Copy, redirecting to ${addressOf(this.city, nodeId)}.`, 'unit', u.id, inc.id); }
        this.routeUnit(u, nodeId, true);
      }
    }
    this.refreshIncidentStatus(inc);
  }

  setClassification(incId: string, cls: string | null) {
    const inc = this.state.incidents[incId];
    if (!inc) return;
    inc.classification = cls;
    this.refreshIncidentStatus(inc);
  }

  setNotes(incId: string, text: string) { const inc = this.state.incidents[incId]; if (inc) inc.notes = text; }

  refreshIncidentStatus(inc: Incident) {
    if (!['REPORTED', 'AWAITING_INFORMATION', 'CLASSIFIED', 'AWAITING_DISPATCH'].includes(inc.status)) return;
    const hasCall = inc.answeredAt !== null;
    if (!hasCall) { inc.status = 'REPORTED'; return; }
    const classified = inc.classification !== null || (inc.facts.length > 0 && suggestClass(inc) !== 'unknown');
    if (inc.reportedNode !== null && classified) inc.status = 'AWAITING_DISPATCH';
    else if (inc.reportedNode !== null || classified) inc.status = 'CLASSIFIED';
    else inc.status = 'AWAITING_INFORMATION';
  }

  select(kind: 'incident' | 'unit' | 'station' | 'district' | null, id: string | null) { this.state.selected = { kind, id }; }

  /** false alarm / no response decision */
  dismissIncident(incId: string) {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) return;
    if (inc.requires.length === 0 && !inc.duplicateOf) {
      if (inc.everAssigned.length === 0) st.stats.cleanFalseAlarms++;
      this.closeIncident(inc, 'false_alarm');
      return;
    }
    // wrong call: the problem keeps developing out of sight; the caller will phone again
    inc.hidden = true; inc.dismissed = true;
    inc.callbackAt = st.time + 35 + this.rng.range(0, 12);
    for (const uid of [...inc.assignedUnits]) this.recall(uid);
    this.log('failed', `${inc.label}: dismissed as no emergency (incorrect)`, { incidentId: inc.id, good: false });
    this.notify('Incident dismissed — but this may have been a real emergency', 'warn', inc.id);
    st.stats.mishandled += 0;
    if (st.activeCallId) { const c = st.calls[st.activeCallId]; if (c && c.incidentId === incId) this.endCall(c.id); }
  }

  // ── Unit commands ────────────────────────────────────────────────────────
  sceneUnsafe(inc: Incident): boolean { const t = inc.truth; return (!!t.weapon && t.weapon !== 'none') || (t.suspect === true && t.safe === false); }
  policeOnScene(inc: Incident): boolean { return this.onScene(inc).some((x) => x.service === 'police' && !isAir(x)); }
  /** hold a staged unit a couple of blocks out until police have the scene */
  private stagingHold(u: Unit, inc: Incident): boolean {
    const st = this.state;
    if (!this.sceneUnsafe(inc) || this.policeOnScene(inc)) {
      if (u.stagedAt != null) { u.note = undefined; this.radio(u.spoken, `Dispatch, ${u.spoken}. Copy, scene is secure — moving in.`, 'unit', u.id, inc.id); }
      u.staging = false; u.stagedAt = null;
      return false;
    }
    const n = this.city.nodes[inc.reportedNode ?? inc.nodeId];
    if (Math.hypot(u.x - n.x, u.y - n.y) > 170) return false;
    u.speed = 0;
    if (u.stagedAt == null) { u.stagedAt = st.time; u.note = 'Staged — waiting for police'; this.radio(u.spoken, `Dispatch, ${u.spoken}. Staged two blocks out, holding for PD.`, 'unit', u.id, inc.id); }
    return true;
  }
  /** upgrade / downgrade a responding unit */
  setCode(unitId: string, code: 2 | 3): boolean {
    const u = this.state.units[unitId];
    if (!u || isAir(u) || !['DISPATCHED', 'EN_ROUTE'].includes(u.status) || u.code === code) return false;
    u.code = code;
    this.radio('DISPATCH', `${u.spoken}, ${code === 3 ? 'upgrade to Code 3, lights and sirens' : 'downgrade to Code 2, no lights'}.`, 'dispatch', u.id, u.assignedIncidentId);
    this.radio(u.spoken, code === 3 ? 'Copy, going Code 3.' : 'Copy, Code 2.', 'unit', u.id, u.assignedIncidentId);
    if (code === 3 && !u.crashAt && this.rng.chance(0.008 * ({ clear: 1, heat: 1, rain: 1.7, fog: 1.8, snow: 2.6, storm: 2.3 } as Record<string, number>)[this.state.weather])) u.crashAt = this.state.time + this.rng.range(8, 30);
    if (u.status === 'EN_ROUTE' && u.destNode !== null) this.routeUnit(u, u.destNode, code === 3);
    if (code === 2) this.state.flags.code2 = true;
    return true;
  }
  /** tell fire / EMS to stage until police secure the scene */
  setStaging(unitId: string, on: boolean): boolean {
    const u = this.state.units[unitId];
    if (!u || u.service === 'police' || !['DISPATCHED', 'EN_ROUTE'].includes(u.status)) return false;
    u.staging = on;
    if (!on && u.stagedAt != null) { u.stagedAt = null; u.note = undefined; }
    this.radio('DISPATCH', on ? `${u.spoken}, stage short of the scene — wait for PD to make it safe.` : `${u.spoken}, cancel staging, proceed in.`, 'dispatch', u.id, u.assignedIncidentId);
    this.radio(u.spoken, on ? 'Copy, we will stage.' : 'Copy, proceeding.', 'unit', u.id, u.assignedIncidentId);
    return true;
  }
  /** give responding crews what the caller has said */
  briefUnits(incId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) return { ok: false, reason: 'Incident closed' };
    const units = inc.assignedUnits.map((id) => st.units[id]).filter((u): u is Unit => !!u);
    if (!units.length) return { ok: false, reason: 'No units assigned yet' };
    const facts = inc.facts.filter((f) => f.confidence !== 'contradicted' && f.key !== 'aid');
    if (facts.length < 2) return { ok: false, reason: 'You do not know enough yet — ask the caller more' };
    if (inc.briefedAt != null && (inc.briefedFacts ?? 0) >= facts.length) return { ok: false, reason: 'Crews already have everything you know' };
    const say = facts.slice(-5).map((f) => `${f.label.toLowerCase()} ${typeof f.value === 'boolean' ? (f.value ? 'yes' : 'no') : String(f.value)}`).join('; ');
    const warn = facts.some((f) => f.key === 'weapon' && f.value && f.value !== 'none') ? ' Use caution — weapon reported.' : '';
    this.radio('DISPATCH', `Units responding to INC-${String(inc.num).padStart(4, '0')}, be advised: ${say}.${warn}`, 'dispatch', undefined, inc.id);
    const u = units[0];
    this.radio(u.spoken, this.rng.pick(['Copy, thanks dispatch.', `${u.spoken} copies all.`, 'Copy that.']), 'unit', u.id, inc.id);
    inc.briefedAt = st.time; inc.briefedFacts = facts.length;
    if (inc.accessNeeded && facts.some((f) => f.key === 'access')) inc.accessNeeded.relayed = true;
    return { ok: true };
  }
  /** pull a unit off whatever it is doing and send it to another incident */
  divert(unitId: string, incId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const u = st.units[unitId], inc = st.incidents[incId];
    if (!u || !inc) return { ok: false, reason: 'Unknown' };
    if (u.assignedIncidentId === incId) return { ok: false, reason: 'Already assigned there' };
    if (u.status === 'ON_SCENE') {
      const from = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
      this.detach(u, true);
      u.status = 'AVAILABLE';
      if (from) this.radio(u.spoken, `Copy, clearing ${from.label.toLowerCase()} to divert.`, 'unit', u.id, from.id);
    }
    return this.dispatch(unitId, incId);
  }
  /** keep a police car at its post instead of patrolling */
  setPatrol(unitId: string, on: boolean) { const u = this.state.units[unitId]; if (u) { u.patrol = on; if (!on && u.status === 'AVAILABLE') { u.status = 'RETURNING'; this.routeUnit(u, u.postNode, false); } } }
  /** hospitals with free capacity; the nearest is chosen unless it is full */
  hospitalFull(node: number): boolean {
    const h = this.state.hospitals?.[node];
    return !!h && h.er >= h.erCap;
  }
  private chooseHospital(fromNode: number): number {
    const n = this.city.nodes[fromNode];
    const open = this.city.hospitals.filter((h) => !this.state.closedHospitals.includes(h) && !this.hospitalFull(h));
    const pool = open.length ? open : this.city.hospitals;
    return pool.slice().sort((a, b) => Math.hypot(this.city.nodes[a].x - n.x, this.city.nodes[a].y - n.y) - Math.hypot(this.city.nodes[b].x - n.x, this.city.nodes[b].y - n.y))[0];
  }
  /** send a transporting ambulance to a different hospital */
  setHospital(unitId: string, node: number): { ok: boolean; reason?: string } {
    const st = this.state;
    const u = st.units[unitId];
    if (!u || u.status !== 'TRANSPORTING') return { ok: false, reason: 'Unit is not transporting' };
    if (!this.city.hospitals.includes(node)) return { ok: false, reason: 'Not a hospital' };
    if (st.closedHospitals.includes(node)) return { ok: false, reason: 'That hospital is diverting' };
    const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
    if (inc) inc.hospitalNode = node;
    this.routeUnit(u, node, true);
    const name = this.nearestLandmarkName(node, 'hospital');
    this.radio('DISPATCH', `${u.spoken}, divert your patient to ${name}.`, 'dispatch', u.id, inc?.id);
    this.radio(u.spoken, `Copy, en route to ${name}.`, 'unit', u.id, inc?.id);
    return { ok: true };
  }

  // ── Units ─────────────────────────────────────────────────────────────────
  private mobilizationTime(u: Unit): number {
    const lvl = this.state.upgrades.console ?? 0;
    const crew = this.crewOf(u);
    const rel = crew.length ? crew.reduce((s, p) => s + p.reliability, 0) / crew.length : 70;
    if (this.onPatrol(u)) return 2.5;
    return Math.max(2.5, 10 - 2.5 * lvl - (rel - 70) / 20);
  }
  /** police cars cruising their beat (available, but out on the road) */
  onPatrol(u: Unit): boolean { return u.status === 'AVAILABLE' && u.patrol !== false && u.service === 'police' && !isAir(u) && !u.temp && ['patrol', 'motorcycle', 'traffic', 'foot', 'bicycle'].includes(u.type); }

  /** pick the next stretch of the beat: a few blocks away, around the unit's post */
  private patrolStep(u: Unit) {
    const city = this.city;
    const post = city.nodes[u.postNode];
    const here = city.nodes[u.prevNode];
    const near = (city.nodesInDistrict[post.district] ?? []).filter((n) => {
      const m = city.nodes[n];
      const dp = Math.hypot(m.x - post.x, m.y - post.y), dh = Math.hypot(m.x - here.x, m.y - here.y);
      return dp < 260 && dh > 60 && dh < 220 && city.adj[n].some((e) => city.edges[e].cls !== 'highway');
    });
    if (!near.length) return;
    const dest = this.rng.pick(near);
    const res = findRoute(city, u.prevNode, dest, this.tm(false), this.unitSpeedFactor(u));
    if (res) { u.route = res.path; u.destNode = dest; }
  }

  canDispatch(u: Unit, inc: Incident): { ok: boolean; reason?: string } {
    if (!u) return { ok: false, reason: 'Unknown unit' };
    if (['RESOLVED', 'CLOSED'].includes(inc.status)) return { ok: false, reason: 'Incident closed' };
    if (inc.reportedNode === null) return { ok: false, reason: 'Set the incident location first' };
    if (inc.truth.outside) return { ok: false, reason: 'Out of jurisdiction' };
    if (u.status === 'OUT_OF_SERVICE') return { ok: false, reason: 'Unit out of service' };
    if (u.status === 'TRANSPORTING') return { ok: false, reason: 'Unit is transporting a patient' };
    if (u.status === 'BUSY') return { ok: false, reason: 'Unit is busy' };
    if (u.status === 'ON_SCENE' && !(inc.parentId && u.assignedIncidentId === inc.parentId)) return { ok: false, reason: 'Unit is on scene elsewhere — recall it first' };
    if (u.assignedIncidentId === inc.id && u.status !== 'RETURNING') return { ok: false, reason: 'Already assigned here' };
    if (!checkCrew(this.state, u)) return { ok: false, reason: 'Understaffed' };
    if (isAir(u)) {
      if (this.state.weather === 'storm') return { ok: false, reason: 'Grounded — weather beyond flight limits' };
      if ((u.fuel ?? 100) < 30 && u.status !== 'AVAILABLE') return { ok: false, reason: 'Low fuel — must refuel first' };
    }
    return { ok: true };
  }

  dispatch(unitId: string, incId: string, opts: { code?: 2 | 3; self?: boolean } = {}): { ok: boolean; reason?: string } {
    const st = this.state;
    const u = st.units[unitId], inc = st.incidents[incId];
    if (!u || !inc) return { ok: false, reason: 'Unknown' };
    const can = this.canDispatch(u, inc);
    if (!can.ok) return can;
    const rolling = this.onPatrol(u);
    // detach from a previous incident
    if (u.assignedIncidentId && u.assignedIncidentId !== incId) this.detach(u, true);
    u.assignedIncidentId = incId;
    u.status = 'DISPATCHED';
    u.code = opts.code ?? 3;
    if (u.code === 2 && !opts.self) st.flags.code2 = true;
    u.crashAt = null;
    if (u.code === 3 && !u.temp && !isAir(u)) {
      // running with lights and sirens is faster but not risk-free
      const wx = { clear: 1, heat: 1, rain: 1.7, fog: 1.8, snow: 2.6, storm: 2.3 }[st.weather];
      const crew = this.crewOf(u);
      const fat = crew.length ? crew.reduce((s, p) => s + p.fatigue, 0) / crew.length : 0;
      if (this.rng.chance(0.012 * wx * (1 + fat / 120))) u.crashAt = st.time + u.timer + this.rng.range(8, 40);
    }
    u.missedTones = false;
    u.timer = isAir(u) ? 14 : rolling ? 2.5 : this.mobilizationTime(u) + turnoutDelay(this, u);
    u.staging = false; u.stagedAt = null;
    u.deployments++;
    u.note = undefined;
    inc.assignedUnits.push(u.id);
    if (!inc.everAssigned.includes(u.id)) inc.everAssigned.push(u.id);
    if (inc.firstDispatchAt === null) inc.firstDispatchAt = st.time;
    if (['REPORTED', 'AWAITING_INFORMATION', 'CLASSIFIED', 'AWAITING_DISPATCH', 'ESCALATING'].includes(inc.status) || !inc.assignedUnits.length) inc.status = inc.status === 'ESCALATING' ? 'ESCALATING' : 'UNITS_EN_ROUTE';
    if (inc.status === 'AWAITING_DISPATCH' || inc.status === 'CLASSIFIED') inc.status = 'UNITS_EN_ROUTE';
    const reqs = inc.duplicateOf ? (st.incidents[inc.duplicateOf]?.requires ?? []) : inc.requires;
    const useful = reqs.some((r) => u.capabilities.includes(r.cap)) || (isAir(u) && (inc.pursuit || AIR_HELPS.has(inc.templateId)));
    if (!opts.self) {
      st.stats.dispatches++;
      if (useful) st.stats.correctDispatches++;
      const cost = isAir(u) ? 700 : u.service === 'fire' ? 320 : u.service === 'medical' ? 220 : 150;
      st.stats.costs += cost; st.budget -= cost;
    }
    if (!opts.self) this.radio('DISPATCH', `${u.spoken}, respond to ${addressOf(this.city, inc.reportedNode!)}, ${inc.label.toLowerCase()}.`, 'dispatch', u.id, inc.id);
    this.log('dispatch', `${u.callsign} dispatched → ${inc.label} (${addressOf(this.city, inc.reportedNode!)})`, { incidentId: inc.id, unitId: u.id });
    this.routeUnit(u, inc.reportedNode!, true);
    this.emit({ type: 'dispatch', unitId: u.id });
    // the caller cannot see the dispatch screen: they only know help is coming once the dispatcher tells them
    return { ok: true };
  }

  callFor(inc: Incident): Call | undefined {
    return Object.values(this.state.calls).find((c) => c.incidentId === inc.id && (c.state === 'active' || c.state === 'hold' || c.state === 'ringing'));
  }

  /** remove the unit from its incident (does not change the unit's own status) */
  detach(u: Unit, silent = false) {
    const st = this.state;
    const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
    if (inc) {
      inc.assignedUnits = inc.assignedUnits.filter((x) => x !== u.id);
      if (!silent && inc.assignedUnits.length === 0 && ['UNITS_EN_ROUTE', 'ON_SCENE'].includes(inc.status)) inc.status = 'AWAITING_DISPATCH';
      if (silent && inc.assignedUnits.length === 0 && ['UNITS_EN_ROUTE', 'ON_SCENE'].includes(inc.status)) inc.status = 'AWAITING_DISPATCH';
      // sending a unit that never contributed counts as unnecessary
      const hadContribution = inc.requires.some((r) => u.capabilities.includes(r.cap));
      if (!hadContribution && u.status === 'ON_SCENE') { inc.unnecessary++; }
    }
    u.assignedIncidentId = undefined;
  }

  recall(unitId: string): boolean {
    const st = this.state;
    const u = st.units[unitId];
    if (!u || u.status === 'TRANSPORTING' || u.status === 'OUT_OF_SERVICE' || u.status === 'BUSY') return false;
    if (u.temp) { this.detach(u); delete st.units[u.id]; this.radio(u.spoken, 'Copy, standing down.', 'unit'); return true; }
    const wasScene = u.status === 'ON_SCENE';
    this.detach(u);
    u.status = 'RETURNING';
    u.patients = 0;
    this.routeUnit(u, u.postNode, false);
    this.radio('DISPATCH', `${u.spoken}, return to service.`, 'dispatch', u.id);
    this.radio(u.spoken, wasScene ? 'Copy, clear of the scene, returning.' : 'Copy, returning to station.', 'unit', u.id);
    this.log('dispatch', `${u.callsign} recalled`, { unitId: u.id });
    return true;
  }

  reposition(unitId: string, nodeId: number): boolean {
    const u = this.state.units[unitId];
    if (!u || !['AVAILABLE', 'RETURNING'].includes(u.status) || isAir(u)) return false;
    u.postNode = nodeId;
    u.status = 'RETURNING';
    this.routeUnit(u, nodeId, false);
    this.radio(u.spoken, `Copy, moving to cover ${addressOf(this.city, nodeId)}.`, 'unit', u.id);
    return true;
  }

  routeUnit(u: Unit, destNode: number, siren: boolean): boolean {
    if (isAir(u)) {
      // aircraft fly straight lines
      const n = this.city.nodes[destNode];
      u.destNode = destNode; u.route = []; u.eta = Math.hypot(n.x - u.x, n.y - u.y) / AIR_SPEED;
      return true;
    }
    const startNode = u.route.length ? u.route[0] : u.prevNode;
    const startPos = u.route.length ? { x: this.city.nodes[startNode].x, y: this.city.nodes[startNode].y } : { x: u.x, y: u.y };
    void startPos;
    const filters = ['bicycle', 'foot', 'motorcycle'].includes(u.type);
    const res = findRoute(this.city, startNode, destNode, this.tm(filters || (siren && this.sirenFor(u)) || (u.status === 'DISPATCHED' && u.code !== 2)), this.unitSpeedFactor(u));
    u.destNode = destNode;
    if (!res) { u.route = []; u.eta = null; return false; }
    u.route = u.route.length ? [startNode, ...res.path] : res.path;
    this.updateEta(u);
    return true;
  }

  private rerouteAll(force = false) {
    for (const u of Object.values(this.state.units)) {
      if (!['EN_ROUTE', 'RETURNING', 'TRANSPORTING'].includes(u.status) || u.destNode === null || !u.route.length) continue;
      const siren = u.status !== 'RETURNING';
      const cur = routeTime(this.city, u.prevNode, u.route, this.tm(siren), this.unitSpeedFactor(u), u.x, u.y);
      const res = findRoute(this.city, u.route[0], u.destNode, this.tm(siren), this.unitSpeedFactor(u));
      if (!res) continue;
      const blocked = u.route.some((n, i) => { const prev = i === 0 ? u.prevNode : u.route[i - 1]; const eid = this.city.edgeBetween.get(prev * 100000 + n); return eid !== undefined && this.closedMask[eid]; });
      if (force || blocked || res.time < cur * 0.88) { u.route = [u.route[0], ...res.path]; }
    }
  }

  updateEta(u: Unit) {
    if (!u.route.length) { u.eta = 0; return; }
    const siren = u.status !== 'RETURNING';
    u.eta = routeTime(this.city, u.prevNode, u.route, this.tm(siren), this.unitSpeedFactor(u), u.x, u.y);
  }

  /** estimated time (seconds) and distance (km) for a unit to reach a node, used by the dispatch list */
  estimate(unitId: string, nodeId: number): { eta: number; dist: number } | null {
    const u = this.state.units[unitId];
    if (!u) return null;
    const key = `${unitId}:${nodeId}`;
    const c = this.etaCache.get(key);
    if (c && this.state.time - c.t < 3) return c.v;
    if (isAir(u)) {
      const n = this.city.nodes[nodeId];
      const d = Math.hypot(n.x - u.x, n.y - u.y);
      const mob = u.status === 'AVAILABLE' ? 14 : u.status === 'DISPATCHED' ? u.timer : 0;
      const v = { eta: mob + d / AIR_SPEED, dist: d * 4 / 1000 };
      this.etaCache.set(key, { t: this.state.time, v });
      return v;
    }
    const startNode = u.route.length && ['EN_ROUTE', 'RETURNING', 'DISPATCHED'].includes(u.status) ? u.route[0] : u.prevNode;
    const res = findRoute(this.city, startNode, nodeId, this.tm(true), this.unitSpeedFactor(u));
    let v: { eta: number; dist: number } | null = null;
    if (res) {
      const sn = this.city.nodes[startNode];
      const lead = Math.hypot(sn.x - u.x, sn.y - u.y);
      const mob = u.status === 'AVAILABLE' ? this.mobilizationTime(u) : u.status === 'DISPATCHED' ? u.timer : 0;
      v = { eta: res.time + mob + lead / 6, dist: (res.dist + lead) * 4 / 1000 };
    }
    this.etaCache.set(key, { t: this.state.time, v });
    return v;
  }

  private unitAtScene(u: Unit, inc: Incident): boolean {
    // during a search every sector counts as the scene
    const S = inc.search;
    if (S && !S.found) return Math.hypot(u.x - S.cx, u.y - S.cy) < (S.r / 0.55) * 1.6 + 30;
    const n = this.city.nodes[inc.nodeId];
    return Math.hypot(u.x - n.x, u.y - n.y) < (inc.guided ? 200 : 90);
  }

  private updateUnits(dt: number) {
    const st = this.state;
    for (const u of Object.values(st.units)) {
      st.stats.unitSeconds += dt;
      if (u.status !== 'AVAILABLE' && u.status !== 'OUT_OF_SERVICE') st.stats.unitBusySeconds += dt;
      if (isAir(u)) { this.updateAir(u, dt); continue; }
      if (this.onPatrol(u) && st.config.mode !== 'tutorial') {
        if (!u.route.length) this.patrolStep(u);
        if (u.route.length) this.advance(u, dt, 0.55);
        continue;
      }
      switch (u.status) {
        case 'DISPATCHED': {
          u.timer -= dt;
          if (u.timer <= 0) {
            const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
            if (!inc || inc.reportedNode === null) { u.status = 'AVAILABLE'; u.assignedIncidentId = undefined; break; }
            u.status = 'EN_ROUTE';
            this.routeUnit(u, inc.reportedNode, true);
            this.radio(u.spoken, `Dispatch, ${u.spoken}. Copy, en route to ${addressOf(this.city, inc.reportedNode)}.`, 'unit', u.id, inc.id);
            this.emit({ type: 'status', unitId: u.id });
            // already there?
            if (!u.route.length) this.arrive(u);
          } else this.updateEta(u);
          break;
        }
        case 'EN_ROUTE': case 'RETURNING': case 'TRANSPORTING': {
          // retarget if the incident location changed
          if (u.status === 'EN_ROUTE') {
            const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
            if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) { u.assignedIncidentId = undefined; u.status = 'RETURNING'; this.routeUnit(u, u.postNode, false); break; }
            if (inc.pursuit && inc.mover) {
              // crews who can see the suspect chase it directly; others head for the last known position
              const m = inc.mover;
              const near = Math.hypot(u.x - m.x, u.y - m.y) < 230 && st.time >= (m.evadeUntil ?? 0);
              const target = near ? (m.next >= 0 ? m.next : m.prev) : inc.reportedNode;
              if (target !== null && target !== u.destNode) this.routeUnit(u, target, true);
              if (u.route.length) this.advance(u, dt); else { u.speed = 0; u.note = 'Searching area'; }
              break;
            }
            if (inc.search && !inc.search.found && u.searchSector != null) {
              const tgt = inc.search.sectors[u.searchSector]?.node;
              if (tgt !== undefined && u.destNode !== tgt) this.routeUnit(u, tgt, this.sirenFor(u));
              if (!u.route.length) this.arrive(u); else this.advance(u, dt);
              break;
            }
            if (inc.reportedNode !== null && u.destNode !== inc.reportedNode) this.routeUnit(u, inc.reportedNode, this.sirenFor(u));
            if (u.staging && this.stagingHold(u, inc)) break;
            if (u.crashAt && st.time >= u.crashAt && u.route.length > 2) this.unitCrash(u, inc);
          }
          this.advance(u, dt);
          break;
        }
        case 'BUSY': {
          // a car running spikes out ahead of a pursuit drives there with lights on
          if (u.note?.startsWith('Spike strip') && u.route.length) { this.advance(u, dt); break; }
          u.timer -= dt;
          if (u.timer <= 0) { u.status = 'RETURNING'; u.assignedIncidentId = undefined; this.routeUnit(u, u.postNode, false); }
          break;
        }
        case 'ON_SCENE': {
          const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
          if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) {
            if (u.temp) { delete st.units[u.id]; break; }
            u.assignedIncidentId = undefined; u.status = 'RETURNING'; this.routeUnit(u, u.prisoner ? this.nearestStationNode(u, 'police') : u.postNode, false);
          } else if (!inc.pursuit && !(inc.search && !inc.search.found) && inc.reportedNode !== null && !this.unitAtScene(u, inc) && Math.hypot(this.city.nodes[inc.reportedNode].x - u.x, this.city.nodes[inc.reportedNode].y - u.y) > 90) {
            u.status = 'EN_ROUTE'; this.routeUnit(u, inc.reportedNode, true);
          }
          break;
        }
        case 'OUT_OF_SERVICE': {
          if (u.timer > 0) { u.timer -= dt; if (u.timer <= 0) { if (u.note === 'In the workshop' || u.note === 'Mechanical fault') { u.condition = u.note === 'In the workshop' ? 100 : Math.max(u.condition ?? 100, 70); } u.status = 'AVAILABLE'; u.note = undefined; } }
          break;
        }
        default: break;
      }
    }
  }

  sirenFor(u: Unit): boolean { return u.status === 'TRANSPORTING' || ((u.status === 'EN_ROUTE' || u.status === 'DISPATCHED') && u.code !== 2); }

  private unitCrash(u: Unit, inc: Incident) {
    const st = this.state;
    u.crashAt = null;
    u.stoppedUntil = st.time + 35;
    u.note = 'Minor collision en route';
    st.stats.unitCrashes++;
    st.stats.costs += 2000; st.budget -= 2000;
    for (const p of this.crewOf(u)) p.morale = Math.max(10, p.morale - 8);
    this.radio(u.spoken, `Dispatch, ${u.spoken}. We've been involved in a collision at an intersection. Crew okay, vehicle damaged — we're delayed.`, 'alert', u.id, inc.id);
    this.notify(`${u.callsign} crashed en route (Code 3) — delayed ~35 s`, 'bad', inc.id);
    this.fx('bad', u.prevNode, 'Unit collision');
    this.emit({ type: 'alert', text: 'Unit collision' });
  }

  private breakdowns() {
    const st = this.state;
    const pool = Object.values(st.units).filter((u) => u.status === 'AVAILABLE' && !u.temp);
    if (!pool.length || st.time < 60) return;
    for (const u of pool) {
      const crew = this.crewOf(u);
      const rel = crew.length ? crew.reduce((s, p) => s + p.reliability, 0) / crew.length : 70;
      const wear = (u.condition ?? 100) < 35 ? 4 : (u.condition ?? 100) < 55 ? 2 : 1;
      if (this.rng.chance((1.6 - rel / 100) * wear / (900 * Math.max(6, pool.length)))) {
        u.status = 'OUT_OF_SERVICE'; u.note = 'Mechanical fault'; u.timer = 150 + this.rng.range(0, 90);
        st.stats.breakdowns++;
        this.radio(u.spoken, `Dispatch, ${u.spoken}. We have a mechanical fault — out of service until the mechanic clears us.`, 'unit', u.id);
        this.notify(`${u.callsign} is out of service — mechanical fault`, 'warn');
        return;
      }
    }
  }

  private advance(u: Unit, dt: number, cruise = 1) {
    const x0 = u.x, y0 = u.y;
    this.advanceInner(u, dt, cruise);
    if (!u.temp && !isAir(u)) u.condition = Math.max(0, (u.condition ?? 100) - Math.hypot(u.x - x0, u.y - y0) * (u.status === 'EN_ROUTE' && u.code !== 2 ? 0.0065 : 0.004));
  }
  private advanceInner(u: Unit, dt: number, cruise = 1) {
    const city = this.city;
    let remaining = dt;
    if (u.stoppedUntil && this.state.time < u.stoppedUntil) { u.speed = 0; return; }
    const tm = this.tm(this.sirenFor(u));
    const vf = this.unitSpeedFactor(u);
    let guard = 0;
    while (remaining > 1e-6 && u.route.length && guard++ < 20) {
      const target = city.nodes[u.route[0]];
      const eid = city.edgeBetween.get(u.prevNode * 100000 + u.route[0]);
      let speed = (eid !== undefined ? edgeSpeed(city, city.edges[eid], tm, vf) : (35 / 3.6 / 4) * TIME_COMPRESS * vf) * cruise;
      if (speed <= 0) { this.routeUnit(u, u.destNode ?? u.postNode, u.status !== 'RETURNING'); u.speed = 0; return; }
      u.speed = speed;
      const dx = target.x - u.x, dy = target.y - u.y;
      const dist = Math.hypot(dx, dy);
      const step = speed * remaining;
      if (step >= dist) {
        u.x = target.x; u.y = target.y; remaining -= dist / speed; u.prevNode = u.route.shift()!;
      } else { u.x += (dx / dist) * step; u.y += (dy / dist) * step; remaining = 0; }
    }
    if (!u.route.length) { u.speed = 0; this.arrive(u); }
    else this.updateEta(u);
  }

  private arrive(u: Unit) {
    const st = this.state;
    u.eta = 0; u.route = [];
    if (u.status === 'RETURNING') {
      if (u.temp) { delete st.units[u.id]; return; }
      if (u.prisoner) {
        u.prisoner = false; u.status = 'BUSY'; u.timer = bookPrisoner(this, u); u.note = 'Booking prisoner';
        st.stats.arrests = (st.stats.arrests ?? 0) + 1;
        this.radio(u.spoken, `Dispatch, ${u.spoken}. At ${this.stationAt(u.prevNode)?.name ?? 'the station'} with one in custody — booking now.`, 'unit', u.id);
        this.emit({ type: 'status', unitId: u.id });
        return;
      }
      if (u.workshop) {
        u.workshop = false; u.status = 'OUT_OF_SERVICE'; u.timer = 70; u.note = 'In the workshop';
        st.stats.services = (st.stats.services ?? 0) + 1;
        this.radio(u.spoken, `${u.spoken}, in the workshop. Mechanic says about a minute.`, 'unit', u.id);
        this.emit({ type: 'status', unitId: u.id });
        return;
      }
      u.assignedIncidentId = undefined; u.destNode = null;
      if (!onReturn(this, u)) u.status = 'AVAILABLE';
      this.emit({ type: 'status', unitId: u.id });
      return;
    }
    if (u.status === 'TRANSPORTING') {
      const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
      const hosp = this.nearestLandmarkName(u.prevNode, 'hospital');
      this.radio(u.spoken, `Dispatch, ${u.spoken}. Arrived at ${hosp}, transferring care.`, 'unit', u.id, inc?.id);
      const hn = this.nearestHospitalNode(u.prevNode);
      ((st.hospitalLoad ??= {})[hn] ??= []).push(st.time);
      const h = st.hospitals?.[hn];
      if (inc && h) {
        const need = this.patientNeed(inc);
        const suits = this.hospitalSuits(h, need, inc.severity);
        const pre = h.prealerts.includes(inc.id);
        const full = h.er >= h.erCap;
        inc.hospitalOutcome = !suits ? 'unsuitable' : pre ? 'ideal' : 'ok';
        h.er = Math.min(h.erCap + 2, h.er + 1);
        if (!suits) { u.timer += 45; this.consequence(inc, `${h.name} could not treat a ${need} patient — a secondary transfer was needed`); this.radio(h.name, `${h.name} to ${u.spoken}: we can't manage this patient here, arranging a transfer.`, 'hospital', u.id, inc.id); }
        else if (pre) { u.timer = 6; }
        if (full) { u.heldExtra = 40; u.note = 'Held at the ER door'; this.radio(u.spoken, `Dispatch, ${u.spoken}. ER is full at ${h.name}, we're stuck holding the patient in the corridor.`, 'unit', u.id, inc.id); }
      }
      u.patients = 0; u.status = 'BUSY'; u.timer = 12 + (u.heldExtra ?? 0); u.heldExtra = 0;
      useSupplies(this, u, 6);
      if (inc) {
        inc.patientsTransported++;
        const needed = this.transportsNeeded(inc);
        const stillMoving = inc.assignedUnits.some((id) => st.units[id]?.status === 'TRANSPORTING');
        if (inc.patientsTransported >= needed && !stillMoving && inc.status !== 'RESOLVED') this.resolveIncident(inc, 'success');
      }
      this.emit({ type: 'arrive', unitId: u.id });
      return;
    }
    if (u.status === 'EN_ROUTE') {
      const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
      if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) { u.status = 'RETURNING'; u.assignedIncidentId = undefined; this.routeUnit(u, u.postNode, false); return; }
      if (inc.pursuit) { u.note = 'Searching area'; u.speed = 0; return; }
      u.status = 'ON_SCENE';
      if (u.service !== 'police') useSupplies(this, u, 3);
      premiseArrival(this, inc, u);
      this.emit({ type: 'arrive', unitId: u.id });
      if (inc.search && !inc.search.found) {
        const sec = u.searchSector != null ? inc.search.sectors[u.searchSector] : null;
        this.radio(u.spoken, sec ? `Dispatch, ${u.spoken}. In sector ${sec.id}, starting our sweep.` : `Dispatch, ${u.spoken}. At the last-seen point, starting a search.`, 'unit', u.id, inc.id);
        if (inc.firstArrivalAt === null) { inc.firstArrivalAt = st.time; const rt = st.time - (inc.answeredAt ?? inc.createdAt); st.stats.responseTimes.push(rt); st.stats.serviceResponse[u.service].push(rt); }
        if (['UNITS_EN_ROUTE', 'AWAITING_DISPATCH', 'CLASSIFIED'].includes(inc.status)) inc.status = 'ON_SCENE';
        if (inc.sceneAt === null) inc.sceneAt = st.time + 6;
        return;
      }
      if (!this.unitAtScene(u, inc)) {
        // wrong place
        inc.wrongLocationArrivals++;
        inc.mislocated = true;
        st.stats.wrongLocations++;
        u.note = 'Nothing found';
        this.fx('bad', inc.reportedNode ?? u.prevNode, 'Nothing here');
        this.radio(u.spoken, `Dispatch, ${u.spoken}. Nothing found at ${addressOf(this.city, inc.reportedNode ?? inc.nodeId)}. Please verify the location.`, 'unit', u.id, inc.id);
        this.notify(`${u.callsign} found nothing at the reported address — verify the location`, 'bad', inc.id);
        this.log('arrival', `${u.callsign} arrived at wrong location`, { incidentId: inc.id, unitId: u.id, good: false });
        if (inc.callbackAt === null && !this.callFor(inc)) inc.callbackAt = st.time + 6;
        else { const c = this.callFor(inc); if (c && c.state === 'active') c.pending.push({ at: st.time + 1.5, text: spontaneous(this.env(c), 'nothing_found') }); }
        return;
      }
      u.note = undefined;
      if (u.stationId === 'outside') this.specialistArrived(inc, u);
      // fire and EMS walking into an unsecured scene with an armed suspect can be attacked
      if (u.service !== 'police' && !u.staging && this.sceneUnsafe(inc) && !this.policeOnScene(inc) && this.rng.chance(inc.truth.weapon && inc.truth.weapon !== 'none' ? 0.2 : 0.07)) {
        this.radio(u.spoken, `Dispatch, ${u.spoken}! We're being threatened on scene — crew pulling back! We need PD here now!`, 'alert', u.id, inc.id);
        this.consequence(inc, `${u.callsign} went in before police secured the scene and the crew was attacked`);
        for (const p of this.crewOf(u)) p.morale = Math.max(10, p.morale - 15);
        this.detach(u, true);
        u.status = 'OUT_OF_SERVICE'; u.note = 'Crew assaulted'; u.timer = 150; u.route = []; u.destNode = null;
        this.notify(`${u.callsign} attacked on an unsecured scene — stage medics until police arrive`, 'bad', inc.id);
        this.fx('bad', inc.nodeId, 'Crew attacked');
        return;
      }
      const homeTags = this.city.districtById[inc.district]?.tags ?? [];
      if (!inc.petsSecured && !inc.accessDelayUntil && ['medical', 'police'].includes(inc.category) && !inc.onView && homeTags.some((t) => ['residential', 'suburb'].includes(t)) && ((inc.num * 2654435761) >>> 0) % 100 < 16) {
        inc.accessDelayUntil = st.time + 12;
        this.radio(u.spoken, `Dispatch, ${u.spoken}. There's a big dog going crazy at the door — can the caller put it away?`, 'unit', u.id, inc.id);
        this.consequence(inc, 'Crews were held at the door by a loose dog');
      }
      if (inc.accessNeeded && !inc.accessNeeded.relayed && !inc.accessDelayUntil) {
        inc.accessDelayUntil = st.time + 25;
        this.radio(u.spoken, `Dispatch, ${u.spoken}. On scene — we can't get in, it's locked and nobody gave us a way in. Working on it.`, 'unit', u.id, inc.id);
        this.consequence(inc, 'Crews lost time at the door without access details');
      } else if (inc.accessNeeded?.relayed && !inc.accessDelayUntil) { inc.accessDelayUntil = st.time; this.radio(u.spoken, `Dispatch, ${u.spoken}. On scene — got in with the details you gave us, thanks.`, 'unit', u.id, inc.id); }
      else this.radio(u.spoken, `Dispatch, ${u.spoken}. On scene at ${addressOf(this.city, inc.nodeId)}.`, 'unit', u.id, inc.id);
      this.log('arrival', `${u.callsign} on scene — ${inc.label}`, { incidentId: inc.id, unitId: u.id, good: true });
      this.startStatusTimer(u, inc);
      if (inc.firstArrivalAt === null) {
        inc.firstArrivalAt = st.time;
        const rt = st.time - (inc.answeredAt ?? inc.createdAt);
        // officers' own traffic stops are not responses the dispatcher made
        if (!inc.onView) { st.stats.responseTimes.push(rt); st.stats.serviceResponse[u.service].push(rt); }
      }
      if (inc.status === 'UNITS_EN_ROUTE' || inc.status === 'AWAITING_DISPATCH' || inc.status === 'CLASSIFIED') inc.status = 'ON_SCENE';
      if (inc.sceneAt === null) inc.sceneAt = st.time + 6;
      const call = this.callFor(inc);
      if (call && call.state === 'active') call.pending.push({ at: st.time + 1.6, text: spontaneous(this.env(call), 'arrived') });
    }
  }

  private nearestLandmarkName(fromNode: number, kind: string): string {
    const n = this.city.nodes[fromNode];
    let best = '', bd = Infinity;
    for (const l of this.city.landmarks) if (l.kind === kind) { const m = this.city.nodes[l.nodeId]; const d = Math.hypot(m.x - n.x, m.y - n.y); if (d < bd) { bd = d; best = l.name; } }
    return best;
  }
  private nearestHospitalNode(fromNode: number): number {
    const n = this.city.nodes[fromNode];
    const open = this.city.hospitals.filter((h) => !this.state.closedHospitals.includes(h));
    let best = open[0] ?? this.city.hospitals[0], bd = Infinity;
    for (const h of open.length ? open : this.city.hospitals) { const m = this.city.nodes[h]; const d = Math.hypot(m.x - n.x, m.y - n.y); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  private transportsNeeded(inc: Incident): number {
    const r = inc.requires.find((x) => x.cap === 'transport');
    return r ? r.n : 0;
  }

  // ── Incident simulation ───────────────────────────────────────────────────
  onScene(inc: Incident): Unit[] {
    return inc.assignedUnits.map((id) => this.state.units[id]).filter((u) => u && u.status === 'ON_SCENE' && this.unitAtScene(u, inc));
  }

  private updateIncidents(dt: number) {
    const st = this.state;
    for (const inc of Object.values(st.incidents)) {
      if (['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
      if (inc.truth.outside) continue;
      if (inc.duplicateOf) { this.updateDuplicate(inc); continue; }
      if (inc.pursuit && inc.mover) { this.updatePursuit(inc, dt); continue; }
      if (inc.mover?.caller && !inc.mover.stopped && updateMovingCaller(this, inc, dt)) continue;
      if (inc.thirdParty && !inc.thirdParty.near) thirdPartyTick(this, inc);
      const here = this.onScene(inc);
      // scene size-up report
      if (here.length && inc.sceneAt !== null && st.time >= inc.sceneAt && !inc.sceneSeen) this.sceneReport(inc, here[0]);
      if (inc.deadlineAt != null && inc.deadlineMet == null) {
        if (st.time < inc.deadlineAt) { this.deadlineCountdown(inc); this.checkPromise(inc); continue; }
        this.deadlineReached(inc, here);
        if (['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
      }
      // auto-expire pointless no-response items
      if (inc.requires.length === 0) {
        if (here.length && inc.sceneSeen) { this.closeIncident(inc, 'false_alarm'); continue; }
        if (!here.length && inc.answeredAt !== null && !this.callFor(inc) && st.time - inc.answeredAt > 100) { this.closeIncident(inc, 'false_alarm', true); continue; }
        continue;
      }
      if (inc.status === 'STABILIZING') {
        if (!inc.needsTransport || this.transportsNeeded(inc) === 0) { inc.stabilizeTimer -= dt; if (inc.stabilizeTimer <= 0) this.resolveIncident(inc, 'success'); }
        continue;
      }
      this.updateSurvival(inc, here, dt);
      if (['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
      if (inc.sceneSeen && !inc.checkRolled) this.rollOfficerCheck(inc, here);
      if (inc.sceneSeen && !inc.decided && here.length && st.time - (inc.sceneAt ?? st.time) > 4) this.rollDecision(inc, here);
      if (inc.sceneSeen && !inc.mciAsked && st.time - (inc.sceneAt ?? st.time) > 12) this.mciCheck(inc, here);
      if (inc.accessNeeded === undefined && inc.assignedUnits.length) this.checkAccess(inc);
      if (inc.search && !inc.search.found) { this.updateSearch(inc, here, dt); continue; }
      const cov = matchCoverage(inc.requires, here);
      const usedUnits = here.filter((u) => cov.used.has(u.id));
      if (inc.hoax) { hoaxTick(this, inc, here); if (['RESOLVED', 'CLOSED'].includes(inc.status)) continue; }
      if (inc.sceneSeen && !inc.command) commandTick(this, inc);
      const eff = (usedUnits.length ? usedUnits.reduce((s, u) => s + this.unitEffectiveness(u) * this.sceneFit(inc, u), 0) / usedUnits.length : 1) * (inc.command ? commandFactor(this, inc).f : 1) * (inc.patched ? 1.08 : inc.patchAsked && st.time - inc.patchAsked > 60 ? 0.95 : 1);
      const f = cov.f;
      // threat grows without adequate response, subsides with it
      inc.threat += inc.growth * this.aidFactor(inc) * (1 - f) * dt - inc.clear * eff * f * f * 0.35 * dt;
      inc.threat = Math.max(0, inc.threat);
      if (f > 0 && here.length && st.time >= (inc.accessDelayUntil ?? 0)) inc.workProgress += dt * eff * f * f * (AIR_HELPS.has(inc.templateId) && here.some(isAir) ? 1.35 : 1) * (inc.briefedAt != null ? 1.12 : 1);
      if (inc.status === 'ESCALATING' && st.time - (inc.escalatedAt ?? 0) > 10) inc.status = here.length ? 'ON_SCENE' : inc.assignedUnits.length ? 'UNITS_EN_ROUTE' : 'AWAITING_DISPATCH';
      if (inc.threat >= 100) { this.escalate(inc); continue; }
      if (inc.workProgress >= inc.work && f >= 1 && !st.requests.some((r) => r.incidentId === inc.id && r.status === 'open')) {
        if (this.agencyHolds(inc)) { if (inc.agency!.nagged < 3 && here[0]) { inc.agency!.nagged = 3; this.radio(here[0].spoken, `Dispatch, ${here[0].spoken}. We're done here — just waiting on the ${AGENCY[inc.agency!.kind].name.toLowerCase()}.`, 'unit', here[0].id, inc.id); } }
        else this.completeWork(inc, here);
      }
      // caller impatience when a promise has not been kept
      this.checkPromise(inc);
    }
  }

  /** the tower keeps the dispatcher updated while the aircraft is inbound */
  private deadlineCountdown(inc: Incident) {
    const st = this.state;
    const say = TEMPLATE_BY_ID[inc.templateId].deadlineSay;
    const call = this.callFor(inc);
    if (!say || !call || call.state !== 'active' || call.pending.length || st.time - call.lastSpontaneous < 24) return;
    const left = Math.max(0, (inc.deadlineAt ?? st.time) - st.time);
    if (left < 8) return;
    call.lastSpontaneous = st.time;
    const t = left >= 75 ? `${Math.round(left / 60 * 2) / 2} minutes`.replace('.5 minutes', ' and a half minutes').replace(/^1 minutes/, 'One minute') : `${Math.round(left / 5) * 5} seconds`;
    call.pending.push({ at: st.time + 0.5, text: say.count.replace('{t}', t) });
  }

  private checkPromise(inc: Incident) {
    const st = this.state;
    const call = this.callFor(inc);
    if (!call || call.state !== 'active' || call.promiseAt === null) return;
    if (inc.assignedUnits.length === 0 && st.time - call.promiseAt > 40 && call.complained < 2 && !call.pending.length) {
      call.complained++;
      call.promiseAt = st.time;
      call.mood.trust = Math.max(0, call.mood.trust - 15); call.mood.base = Math.min(100, call.mood.base + 12); call.mood.frustration = Math.min(100, call.mood.frustration + 10);
      call.pending.push({ at: st.time + 1.2, text: spontaneous(this.env(call), 'broken_promise') });
      st.stats.promisesBroken++;
    }
  }

  private sceneReport(inc: Incident, u: Unit) {
    const st = this.state;
    inc.sceneSeen = true;
    inc.sceneReported = true;
    const tpl = this.instanceTemplate(inc);
    if (inc.twist && !inc.twistRevealed) {
      this.revealTwist(inc, 'scene');
      this.radio(u.spoken, `Dispatch, ${u.spoken}. ${inc.twist.scene}`, 'unit', u.id, inc.id);
    } else {
      this.radio(u.spoken, `Dispatch, ${u.spoken}. ${fill(tpl.scene, inc.vars) || 'Scene assessed.'}`, 'unit', u.id, inc.id);
    }
    inc.knownReqs = inc.requires.map((r) => ({ ...r }));
    const cov = matchCoverage(inc.requires, this.onScene(inc).concat(inc.assignedUnits.map((id) => st.units[id]).filter((x) => x && x.status !== 'ON_SCENE')));
    if (cov.missing.length) this.radio(u.spoken, `Dispatch, requesting ${reqText(cov.missing)} at this location.`, 'unit', u.id, inc.id);
    this.requestAgency(inc, u);
    this.askSpecialist(inc, u);
    this.askResources(inc, u);
    // fire and EMS on a busy road want police to hold the traffic back
    if (u.service !== 'police' && !inc.trafficAsked && st.config.mode !== 'tutorial') {
      inc.trafficAsked = true;
      const busy = this.city.adj[inc.reportedNode ?? inc.nodeId].some((eid) => ['arterial', 'highway'].includes(this.city.edges[eid].cls));
      const pdThere = inc.assignedUnits.some((id) => st.units[id]?.service === 'police');
      if (busy && !pdThere && !inc.requires.some((r) => r.cap === 'patrol') && this.hrand(inc.num, 51) < 0.35) {
        inc.requires = mergeReqs(inc.requires, [{ cap: 'patrol', n: 1 }]);
        inc.knownReqs = inc.requires.map((r) => ({ ...r }));
        this.radio(u.spoken, this.hrand(inc.num, 52) < 0.5 ? `Dispatch, ${u.spoken} — can we get PD down here for traffic control? Cars are going round us at speed.` : `${u.spoken} to dispatch, we need a police unit to shut the junction, it's not safe to work.`, 'unit', u.id, inc.id);
        this.notify(`${u.callsign} needs police for traffic control`, 'warn', inc.id);
      }
    }
    for (const [k, v] of Object.entries(inc.truth)) if (['fire', 'smoke', 'injured', 'trapped', 'vehicles', 'hazard', 'people'].includes(k) && inc.facts.every((x) => x.key !== k)) this.addFact(inc, k, v, 'confirmed', 'scene');
    // upgrade confidence of existing
    for (const x of inc.facts) if (x.confidence === 'unconfirmed' && inc.truth[x.key] === x.value) x.confidence = 'confirmed';
  }

  escalate(inc: Incident) {
    const st = this.state;
    if (inc.stage >= inc.maxStage) { this.failIncident(inc); return; }
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    const esc = tpl.escalate![inc.stage];
    inc.stage++;
    inc.severity = Math.min(5, inc.severity + (esc.sev ?? 1));
    inc.requires = mergeReqs(inc.requires, esc.reqs.map((r) => adaptReqForRank(r, st.rank)));
    inc.threat = 52;
    inc.escalatedAt = st.time; inc.lastStageAt = st.time;
    inc.status = 'ESCALATING';
    inc.workProgress *= 0.6;
    let hurt = esc.casualties ?? 0;
    // a public alert that got people out of the way saves lives; the wrong one puts them in harm's way
    if (inc.alert?.right && hurt) { hurt = Math.floor(hurt / 2); this.consequence(inc, 'The public alert kept people clear — fewer were hurt when it escalated'); }
    else if (inc.alert && !inc.alert.right && inc.alert.needed) { hurt += 1; this.consequence(inc, `The ${inc.alert.kind === 'evacuate' ? 'evacuation order sent people into danger' : 'shelter-in-place order kept people where the danger was'}`); }
    if (hurt) { inc.casualties += hurt; st.stats.casualties += hurt; }
    st.stats.escalations++;
    this.fx('bad', inc.reportedNode ?? inc.nodeId, 'Escalating!');
    this.log('escalation', `${inc.label} escalated: ${esc.text}`, { incidentId: inc.id, good: false });
    this.notify(`ESCALATION — ${inc.label}: ${esc.text}`, 'bad', inc.id);
    this.emit({ type: 'alert', text: esc.text, incId: inc.id, cine: 'escalate' });
    const here = this.onScene(inc);
    if (here.length) { inc.knownReqs = inc.requires.map((r) => ({ ...r })); this.radio(here[0].spoken, `Dispatch, ${esc.text.toLowerCase()}. Requesting ${reqText(matchCoverage(inc.requires, here).missing)}.`, 'alert', here[0].id, inc.id); }
    const call = this.callFor(inc);
    if (call && call.state === 'active') call.pending.push({ at: st.time + 1.3, text: esc.say?.length ? fill(this.rng.pick(esc.say), inc.vars) : spontaneous(this.env(call), 'escalated') });
    else if (inc.answeredAt !== null && !call && inc.callId !== null) inc.callbackAt = st.time + 12 + this.rng.range(0, 10);
    if (esc.spawn && st.phase === 'running') this.spawnConnected(inc, esc.spawn);
    // uncontained fires jump to the building next door
    const spreadTo = FIRE_SPREAD[inc.templateId];
    if (spreadTo && !inc.spread && st.phase === 'running' && this.rng.chance(0.4)) {
      inc.spread = true;
      const child = this.spawnConnected(inc, spreadTo);
      if (child) { child.label = `Fire spread — ${child.label}`; this.notify(`The fire at ${addressOf(this.city, inc.nodeId)} has spread to a neighbouring building`, 'bad', child.id); }
    }
  }

  /** the moment that cannot be postponed (an aircraft touching down): were crews in position? */
  private deadlineReached(inc: Incident, here: Unit[]) {
    const st = this.state;
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    const cov = matchCoverage(inc.requires, here);
    inc.deadlineMet = cov.f >= 0.66;
    const say = tpl.deadlineSay;
    if (inc.deadlineMet) {
      inc.threat = Math.min(inc.threat, 28);
      inc.workProgress += inc.work * 0.25;
      const b = Math.round(1500 * modProduct(st.config, 'bonus'));
      st.stats.bonus += b; st.budget += b;
      this.fx('good', inc.nodeId, `In position +$${b}`);
      this.radio(here[0].spoken, `Dispatch, ${here[0].spoken}. ${say?.good ?? "It's happening now — we were in position and we're working it."}`, 'unit', here[0].id, inc.id);
      this.notify(`${inc.label}: crews were in position in time`, 'good', inc.id);
      this.log('arrival', `${inc.label}: responders staged before ${say?.moment ?? 'impact'}`, { incidentId: inc.id, good: true });
    } else {
      this.notify(`${inc.label}: ${say?.bad ?? 'it happened before crews were in place'}`, 'bad', inc.id);
      this.log('escalation', `${inc.label}: responders not in position`, { incidentId: inc.id, good: false });
      inc.growth *= 1.35;
      this.escalate(inc);
    }
    const call = this.callFor(inc);
    if (call && call.state === 'active' && say) call.pending.push({ at: st.time + 1, text: inc.deadlineMet ? say.callerGood : say.callerBad });
  }

  private failIncident(inc: Incident) {
    const st = this.state;
    addStress(this, inc, 22 + inc.casualties * 6);
    if (inc.regular) { const reg = (st.regularLog ?? []).find((r) => r.incId === inc.id); if (reg && !reg.outcome) reg.outcome = regularOutcome(inc, 'failed'); }
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    // a patient with an untreated life threat: say plainly what was (not) done on the phone
    if (inc.lifeThreat && inc.careAt == null && inc.survival !== undefined) { this.patientDied(inc, inc.lifeThreat); return; }
    let cas = 0;
    if (tpl.lethal) cas = 1 + (inc.category === 'fire' || inc.severity >= 5 ? 1 : 0);
    else if (inc.category === 'fire') cas = this.rng.chance(inc.safetyAdvised ? 0.2 : 0.6) ? 1 : 0;
    else if (inc.pursuit) cas = this.rng.chance(0.2) ? 1 : 0;
    else if (inc.category === 'police' && inc.severity >= 3) cas = this.rng.chance(0.4) ? 1 : 0;
    if (inc.safetyAdvised && cas > 1) cas--;
    if (typeof inc.truth.injured === 'number' && inc.truth.injured >= 1 && tpl.category === 'medical') cas = Math.min(cas, inc.truth.injured);
    inc.casualties += cas; st.stats.casualties += cas;
    this.finishIncident(inc, cas > 0 ? 'failed' : 'partial');
    inc.lostReason = TEMPLATE_BY_ID[inc.templateId].failed;
    this.notify(`FAILED — ${inc.label}: ${tpl.failed}${cas ? ` (${cas} casualt${cas === 1 ? 'y' : 'ies'})` : ''}`, 'bad', inc.id);
    if (inc.severity >= 3) this.headline(`Questions over emergency response in ${this.city.districtById[inc.district]?.name ?? 'Ravenport'}: ${tpl.failed.replace(/\.$/, '')}`, 'bad');
    this.log('failed', `${inc.label}: ${tpl.failed}`, { incidentId: inc.id, good: false });
    st.stats.failed++;
    this.emit({ type: 'failed', incidentId: inc.id });
    // lasting damage is applied at shift end through the profile (see persistence of city state)
    const call = this.callFor(inc);
    if (call && call.state === 'active') call.pending.push({ at: st.time + 1, text: '(sobbing) ...no...' });
  }

  private completeWork(inc: Incident, here: Unit[]) {
    const st = this.state;
    inc.status = 'STABILIZING';
    inc.stabilizeTimer = 5;
    if (inc.needsTransport && this.transportsNeeded(inc) > 0) {
      const carriers = here.filter((u) => u.capabilities.includes('transport'));
      const n = this.transportsNeeded(inc);
      carriers.slice(0, n).forEach((u) => {
        const hosp = inc.hospitalNode ?? this.chooseHospital(inc.nodeId);
        inc.hospitalNode = hosp;
        u.status = 'TRANSPORTING'; u.patients = 1; this.routeUnit(u, hosp, true);
        if (!inc.hospitalAsked && (this.patientNeed(inc) !== 'general' || inc.severity >= 4)) this.askHospital(inc, u);
        else this.radio(u.spoken, `Dispatch, ${u.spoken}. Transporting to ${this.nearestLandmarkName(hosp, 'hospital')}.`, 'unit', u.id, inc.id);
      });
      // release everything not carrying a patient
      for (const u of [...here]) if (u.status === 'ON_SCENE') this.releaseUnit(u, inc);
      inc.stabilizeTimer = 9999;
    } else {
      // release non-needed units later at resolution
    }
    this.log('info', `${inc.label}: scene stabilised`, { incidentId: inc.id });
    void st;
  }

  private releaseUnit(u: Unit, inc: Incident, silent = false) {
    inc.assignedUnits = inc.assignedUnits.filter((x) => x !== u.id);
    u.assignedIncidentId = undefined;
    if (u.temp) { delete this.state.units[u.id]; return; }
    u.status = 'BUSY'; u.timer = 6;
    u.destNode = null;
    if (!silent) this.radio(u.spoken, `Dispatch, ${u.spoken}. Clear of the scene, returning to service.`, 'unit', u.id, inc.id);
  }

  resolveIncident(inc: Incident, outcome: Outcome) {
    const st = this.state;
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    if (inc.regular) { const reg = (st.regularLog ?? []).find((r) => r.incId === inc.id); if (reg && !reg.outcome) reg.outcome = regularOutcome(inc, outcome === 'success' ? 'resolved' : outcome === 'failed' ? 'failed' : 'dismissed'); }
    if (inc.casualties > 0) addStress(this, inc, 8 + inc.casualties * 6);
    learnPremise(st, inc);
    // someone is arrested: a police car (or better, a van) takes them to the station to be booked
    if (outcome === 'success' && inc.truth.suspect === true && !inc.pursuit && inc.category === 'police' && !['traffic_stop', 'protest_march'].includes(inc.templateId) && st.config.mode !== 'tutorial') {
      const pol = this.onScene(inc).filter((x) => x.service === 'police' && !isAir(x) && !x.temp);
      const taker = pol.find((x) => x.capabilities.includes('prisoner_transport')) ?? pol[0];
      if (taker) { taker.prisoner = true; this.radio(taker.spoken, `Dispatch, ${taker.spoken}. One in custody — transporting to the station for booking.`, 'unit', taker.id, inc.id); }
    }
    // surplus units
    const here = inc.everAssigned.map((id) => st.units[id]).filter((u) => u && u.assignedIncidentId === inc.id && ['ON_SCENE', 'EN_ROUTE', 'DISPATCHED'].includes(u.status));
    const assigned = inc.everAssigned.map((id) => st.units[id]).filter((u): u is Unit => !!u && !isAir(u));
    const base = matchCoverage(inc.requires, assigned).f;
    let surplus = 0;
    for (const u of assigned) {
      if (matchCoverage(inc.requires, assigned.filter((x) => x.id !== u.id)).f >= base) surplus++;
    }
    surplus = Math.min(surplus, Math.max(0, assigned.length - 1));
    inc.unnecessary += surplus;
    st.stats.unnecessary += inc.unnecessary;
    for (const u of here) { if (u.status === 'ON_SCENE') this.releaseUnit(u, inc); else { this.detach(u); u.status = 'RETURNING'; this.routeUnit(u, u.postNode, false); } }
    inc.saved = Math.max(1, Number(typeof inc.truth.injured === 'number' ? inc.truth.injured : 0), Number(typeof inc.truth.trapped === 'number' ? inc.truth.trapped : 0));
    if (inc.lifeThreat && inc.survival !== undefined) {
      const risk = Math.max(0, (55 - inc.survival) / 100) * (inc.hospitalOutcome === 'ideal' ? 0.6 : inc.hospitalOutcome === 'unsuitable' ? 1.7 : 1);
      if (this.rng.chance(risk)) {
        inc.casualties++; st.stats.casualties++;
        const guided = inc.aid?.fit === 'good';
        if (!guided) st.stats.guidanceDeaths++;
        this.consequence(inc, `The patient died in hospital${guided ? '' : ' — too long without first aid before crews arrived'}`);
        this.notify(`${inc.label}: the patient later died in hospital`, 'bad', inc.id);
      } else if (inc.aid?.fit === 'good' && inc.survival < 92) {
        st.stats.guidanceSaves++;
        (inc.consequences ??= []).push(`Your instructions kept the patient alive (survival ${Math.round(inc.survival)}% at hand-over)`);
        this.notify(`Doctors say the ${inc.aid.kind === 'cpr' ? 'CPR' : 'first aid'} you coached saved ${fill('{his}', inc.vars)} life`, 'good', inc.id);
        this.headline(`Hero bystander kept patient alive with dispatcher's ${inc.aid.kind === 'cpr' ? 'CPR' : 'first-aid'} instructions`, 'good');
        this.fx('good', inc.nodeId, 'Life saved');
      }
    }
    this.finishIncident(inc, inc.casualties > 0 ? 'partial' : inc.stage > 1 ? 'partial' : outcome);
    if (['medical', 'fire'].includes(inc.category) && tpl.sev[0] >= 3) st.stats.livesHelped += inc.saved; else if (inc.category === 'police' && inc.severity >= 3) st.stats.livesHelped += 1;
    this.notify(`Resolved — ${inc.label}`, 'good', inc.id);
    this.log('resolved', `${inc.label} resolved: ${tpl.resolved}`, { incidentId: inc.id, good: true });
    if (inc.severity >= 4 || inc.storyline) this.headline(`${this.city.districtById[inc.district]?.name ?? 'Ravenport'}: ${tpl.resolved}`, 'good');
    const call = this.callFor(inc);
    if (call && call.state === 'active') call.pending.push({ at: st.time + 1.5, text: spontaneous(this.env(call), 'resolved') });
    this.emit({ type: 'resolved', incidentId: inc.id });
  }

  closeIncident(inc: Incident, outcome: Outcome, quiet = false) {
    const st = this.state;
    for (const uid of [...inc.assignedUnits]) {
      const u = st.units[uid];
      if (u) {
        if (u.status === 'ON_SCENE' || u.status === 'EN_ROUTE' || u.status === 'DISPATCHED') { inc.unnecessary++; st.stats.unnecessary++; this.detach(u, true); if (u.status === 'ON_SCENE') this.radio(u.spoken, `Dispatch, ${u.spoken}. No emergency found, returning to service.`, 'unit', u.id, inc.id); u.status = 'RETURNING'; this.routeUnit(u, u.postNode, false); }
      }
    }
    this.finishIncident(inc, outcome);
    if (outcome === 'false_alarm') { st.stats.falseAlarms++; if (!quiet) { this.notify(`Closed — ${inc.label} (no emergency)`, 'good', inc.id); this.log('resolved', `${inc.label}: confirmed no emergency`, { incidentId: inc.id, good: true }); } }
    this.emit({ type: 'resolved', incidentId: inc.id });
  }

  private finishIncident(inc: Incident, outcome: Outcome) {
    const st = this.state;
    inc.outcome = outcome; inc.status = 'RESOLVED'; inc.resolvedAt = st.time;
    inc.assignedUnits = [];
    if (inc.blockedEdge !== null) inc.blockedEdge = null;
    if (outcome === 'merged') return;
    if (inc.templateId === 'traffic_stop') return;
    const cat = st.stats.byCategory[inc.category] ?? { n: 0, ok: 0 };
    cat.n++; if (outcome === 'success' || outcome === 'false_alarm') cat.ok++;
    st.stats.byCategory[inc.category] = cat;
    const where = inc.reportedNode ?? inc.nodeId;
    if (outcome === 'success' || outcome === 'false_alarm') { st.streak++; st.stats.bestStreak = Math.max(st.stats.bestStreak, st.streak); }
    else st.streak = 0;
    if (outcome !== 'failed') {
      st.stats.resolved++;
      const q = outcome === 'success' || outcome === 'false_alarm' ? 1 : 0.55;
      const streakMult = 1 + Math.min(0.5, 0.05 * Math.max(0, st.streak - 1));
      const bonus = Math.round((outcome === 'false_alarm' ? 250 : 900 * inc.severity * q) * streakMult * modProduct(st.config, 'bonus'));
      st.stats.bonus += bonus; st.budget += bonus;
      this.fx(q === 1 ? 'good' : 'warn', where, `+$${bonus.toLocaleString('en-US')}${st.streak >= 3 ? `  ×${streakMult.toFixed(2)}` : ''}`);
    } else this.fx('bad', where, 'Failed');
    // remaining duplicate callers are folded into this record
    for (const o of Object.values(st.incidents)) if (o.duplicateOf === inc.id && !['RESOLVED', 'CLOSED'].includes(o.status)) this.mergeDuplicate(o, inc, false, true);
    // callers who were told help is coming but nothing happened: nothing more to do
    for (const c of Object.values(st.calls)) if (c.incidentId === inc.id && (c.state === 'hold')) this.endCall(c.id, 'resolved');
    // close any temporary mutual-aid units
    // then archive after a short delay (status CLOSED is set by cleanup)
  }

  // ── Duplicate callers ─────────────────────────────────────────────────────
  private spawnDuplicates() {
    const st = this.state;
    for (const inc of Object.values(st.incidents)) {
      if (!inc.dupPlan?.length || st.time < inc.dupPlan[0]) continue;
      inc.dupPlan.shift();
      if (['RESOLVED', 'CLOSED'].includes(inc.status) || inc.hidden || st.time > st.config.durationSec - 25) continue;
      const archetype = this.rng.pick(['witness', 'witness', 'worried_neighbor', 'angry_motorist', 'shopkeeper', 'calm_serious']);
      this.spawnIncident(inc.templateId, inc.district, { duplicateOf: inc, archetype });
    }
  }

  private updateDuplicate(inc: Incident) {
    const st = this.state;
    const src = inc.duplicateOf ? st.incidents[inc.duplicateOf] : undefined;
    if (!src || ['RESOLVED', 'CLOSED'].includes(src.status)) { this.mergeDuplicate(inc, src ?? null, false, true); return; }
    // units sent to the duplicate discover the original response there
    const here = inc.assignedUnits.map((id) => st.units[id]).filter((u) => u && u.status === 'ON_SCENE' && this.unitAtScene(u, inc));
    if (here.length) {
      this.radio(here[0].spoken, `Dispatch, ${here[0].spoken}. This is the same incident as INC-${String(src.num).padStart(4, '0')} — joining that response.`, 'unit', here[0].id, src.id);
      this.mergeDuplicate(inc, src, false);
    }
  }

  /** fold a duplicate record into its source incident */
  private mergeDuplicate(dup: Incident, src: Incident | null, linked: boolean, quiet = false) {
    const st = this.state;
    const srcOpen = !!src && !['RESOLVED', 'CLOSED'].includes(src.status);
    for (const uid of [...dup.assignedUnits]) {
      const u = st.units[uid];
      dup.assignedUnits = dup.assignedUnits.filter((x) => x !== uid);
      if (!u) continue;
      if (srcOpen && src) {
        u.assignedIncidentId = src.id;
        if (!src.assignedUnits.includes(uid)) src.assignedUnits.push(uid);
        if (!src.everAssigned.includes(uid)) src.everAssigned.push(uid);
        if (src.firstDispatchAt === null) src.firstDispatchAt = dup.firstDispatchAt;
      } else if (['ON_SCENE', 'EN_ROUTE', 'DISPATCHED'].includes(u.status)) {
        u.assignedIncidentId = undefined; u.status = 'RETURNING'; this.routeUnit(u, u.postNode, false);
      }
    }
    if (srcOpen && src) {
      if (src.reportedNode === null && dup.reportedNode !== null) { src.reportedNode = dup.reportedNode; src.locatedAt = st.time; src.mislocated = Math.hypot(this.city.nodes[dup.reportedNode].x - this.city.nodes[src.nodeId].x, this.city.nodes[dup.reportedNode].y - this.city.nodes[src.nodeId].y) > 90; }
      for (const f of dup.facts) if (!src.facts.some((x) => x.key === f.key && x.value === f.value)) src.facts.push({ ...f });
      for (const c of Object.values(st.calls)) if (c.incidentId === dup.id && ['active', 'hold', 'ringing'].includes(c.state)) c.incidentId = src.id;
      if (src.assignedUnits.length && ['REPORTED', 'AWAITING_INFORMATION', 'CLASSIFIED', 'AWAITING_DISPATCH'].includes(src.status)) src.status = 'UNITS_EN_ROUTE';
      if (this.onScene(src).length && src.status === 'UNITS_EN_ROUTE') src.status = 'ON_SCENE';
      this.refreshIncidentStatus(src);
    }
    dup.mergedInto = src?.id ?? null;
    this.finishIncident(dup, 'merged');
    if (linked && src) {
      st.stats.merges++;
      const b = Math.round(600 * modProduct(st.config, 'bonus'));
      st.stats.bonus += b; st.budget += b;
      this.fx('info', src.reportedNode ?? src.nodeId, `Linked +$${b}`);
      this.notify(`Linked duplicate call to INC-${String(src.num).padStart(4, '0')}`, 'good', src.id);
      this.log('resolved', `Duplicate call linked to ${src.label}`, { incidentId: src.id, good: true });
    } else if (!quiet && src) this.log('info', `Duplicate report merged into ${src.label}`, { incidentId: src.id });
    if (st.selected.kind === 'incident' && st.selected.id === dup.id && src) this.select('incident', src.id);
  }

  /** dispatcher decision: "this call is about that incident" */
  linkIncident(aId: string, bId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const a = st.incidents[aId], b = st.incidents[bId];
    const open = (i?: Incident) => !!i && !['RESOLVED', 'CLOSED'].includes(i.status);
    if (!open(a) || !open(b) || aId === bId) return { ok: false, reason: 'Both incidents must be open' };
    const related = a.duplicateOf === b.id || b.duplicateOf === a.id || (a.duplicateOf !== null && a.duplicateOf === b.duplicateOf);
    if (related) {
      if (a.duplicateOf === b.id) this.mergeDuplicate(a, b, true);
      else if (b.duplicateOf === a.id) this.mergeDuplicate(b, a, true);
      else { const src = st.incidents[a.duplicateOf!]; this.mergeDuplicate(a, open(src) ? src : b, true); }
      return { ok: true };
    }
    // they were different emergencies: the linked call drops out of sight and will get worse
    a.hidden = true; a.dismissed = true; a.callbackAt = st.time + 40 + this.rng.range(0, 12);
    for (const uid of [...a.assignedUnits]) this.recall(uid);
    for (const c of Object.values(st.calls)) if (c.incidentId === a.id && (c.state === 'active' || c.state === 'hold')) this.endCall(c.id);
    st.stats.wrongLinks++; st.streak = 0;
    this.notify(`Linked to INC-${String(b.num).padStart(4, '0')}`, 'info', b.id);
    this.log('failed', `${a.label} linked to an unrelated incident`, { incidentId: a.id, good: false });
    this.select('incident', b.id);
    return { ok: true };
  }

  /** open incidents near this one that could be the same emergency */
  duplicateCandidates(incId: string): Array<{ inc: Incident; dist: number }> {
    const st = this.state;
    const a = st.incidents[incId];
    if (!a) return [];
    const anchors: number[] = [];
    if (a.reportedNode !== null) anchors.push(a.reportedNode);
    for (const c of Object.values(st.calls)) if (c.incidentId === a.id) for (const h of c.heard) if (h.reliability !== 'contradicted' && h.source !== 'district') anchors.push(h.nodeId);
    if (!anchors.length) return [];
    const out: Array<{ inc: Incident; dist: number }> = [];
    for (const b of Object.values(st.incidents)) {
      if (b.id === a.id || b.hidden || b.reportedNode === null || ['RESOLVED', 'CLOSED'].includes(b.status)) continue;
      const bn = this.city.nodes[b.reportedNode];
      const d = Math.min(...anchors.map((n) => Math.hypot(this.city.nodes[n].x - bn.x, this.city.nodes[n].y - bn.y)));
      if (d < 280) out.push({ inc: b, dist: d * 4 });
    }
    return out.sort((x, y) => x.dist - y.dist).slice(0, 3);
  }

  // ── Pursuits ──────────────────────────────────────────────────────────────
  private chooseEscape(m: NonNullable<Incident['mover']>, chasers: Unit[]): number {
    const city = this.city;
    const opts = city.adj[m.prev].map((eid) => city.edges[eid]).filter((e) => !this.closedMask[e.id] && !(m.foot && e.cls === 'highway'));
    if (!opts.length) return m.prev;
    let best = -1, bs = -Infinity;
    for (const e of opts) {
      const n = e.a === m.prev ? e.b : e.a;
      const nn = city.nodes[n];
      let score = this.rng.next() * 22 + (e.cls === 'arterial' || e.cls === 'highway' ? 9 : 0) + (n === m.came ? -60 : 0);
      if (chasers.length) score += Math.min(...chasers.map((u) => Math.hypot(u.x - nn.x, u.y - nn.y))) * 0.05;
      if (score > bs) { bs = score; best = n; }
    }
    return best;
  }

  private updatePursuit(inc: Incident, dt: number) {
    const st = this.state, city = this.city, m = inc.mover!;
    if (inc.status === 'STABILIZING') return;
    const all = inc.assignedUnits.map((id) => st.units[id]).filter((u): u is Unit => !!u);
    const assigned = all.filter((u) => !isAir(u));
    const evading = st.time < (m.evadeUntil ?? 0);
    // someone on foot is far harder to pick out than a car: crews have to be close (officers on foot or bikes see more)
    const sight = (u: Unit) => (m.foot ? (['foot', 'bicycle'].includes(u.type) ? 34 : 24) : 42);
    const contacts = assigned.filter((u) => (u.status === 'ON_SCENE' && u.note === 'In pursuit') || (!evading && u.status === 'EN_ROUTE' && Math.hypot(u.x - m.x, u.y - m.y) < sight(u)));
    // air support: the camera picks the vehicle up from far further away than a crew in a car
    const air = all.filter((u) => isAir(u) && (u.status === 'ON_SCENE' || u.status === 'EN_ROUTE'));
    if (m.heliId && !air.some((u) => u.id === m.heliId)) m.heliId = null;
    if (!m.heliId) {
      const spot = air.find((u) => Math.hypot(u.x - m.x, u.y - m.y) < (st.weather === 'fog' ? 105 : 150) * (m.foot ? 0.7 : 1));
      if (spot) {
        m.heliId = spot.id; m.heliSince = st.time; m.lastHeliReport = st.time;
        spot.status = 'ON_SCENE'; spot.note = 'Eyes on suspect';
        st.stats.heliSightings++;
        const w = this.moverWhere(m);
        this.radio(spot.spoken, `Dispatch, ${spot.spoken}. We have the suspect vehicle on camera — ${w.dir} on ${w.street}. We'll stay on it.`, 'alert', spot.id, inc.id);
        this.notify(`${spot.callsign} has eyes on the suspect — relay its position to ground units`, 'good', inc.id);
        this.fx('good', inc.nodeId, 'Air has eyes');
        if (inc.firstArrivalAt === null) inc.sceneSeen = true;
      }
    } else if (st.time - (m.lastHeliReport ?? 0) >= 9 && st.time >= m.startAt) {
      const h = st.units[m.heliId];
      if (h) this.heliCommentary(inc, h);
    }
    if (contacts.length && m.contact === 0) {
      const u = contacts[0];
      this.radio(u.spoken, m.foot ? `Dispatch, ${u.spoken}. Eyes on — he's running, we're out on foot after him!` : `Dispatch, ${u.spoken}. Suspect vehicle in sight — in pursuit!`, 'alert', u.id, inc.id);
      inc.sceneSeen = true; inc.sceneReported = true; inc.knownReqs = inc.requires.map((r) => ({ ...r }));
      if (inc.firstArrivalAt === null) { inc.firstArrivalAt = st.time; const rt = st.time - (inc.answeredAt ?? inc.createdAt); st.stats.responseTimes.push(rt); st.stats.serviceResponse.police.push(rt); }
      if (inc.status !== 'ESCALATING') inc.status = 'ON_SCENE';
    }
    m.contact = contacts.length;
    pursuitRisk(this, inc, contacts.length, dt);
    if (['RESOLVED', 'CLOSED'].includes(inc.status)) return;
    // a lone car can lose the suspect in traffic; with the helicopter overhead there is nowhere to hide
    if (contacts.length === 1 && !m.heliId && st.time >= m.startAt) {
      const night = st.timeOfDay % 24 >= 21 || st.timeOfDay % 24 < 5;
      const wx = ({ fog: 1.6, rain: 1.25, storm: 1.5, snow: 1.3 } as Record<string, number>)[st.weather] ?? 1;
      if (this.hrand(inc.num, 91) < (m.foot ? 0.022 : 0.009) * wx * (night ? 1.25 : 1)) {
        const u = contacts[0];
        const w = this.moverWhere(m);
        u.status = 'EN_ROUTE'; u.note = 'Lost visual'; this.routeUnit(u, m.prev, true);
        m.evadeUntil = st.time + 14; m.contact = 0;
        inc.reportedNode = inc.nodeId;
        const heli = Object.values(st.units).some((x) => isAir(x) && x.status === 'AVAILABLE');
        this.radio(u.spoken, `Dispatch, ${u.spoken}. We've lost him! Last seen ${w.dir} on ${w.street}.`, 'alert', u.id, inc.id);
        this.notify(`${u.callsign} lost the suspect${heli ? ' — air support could find him' : ''}`, 'warn', inc.id);
        contacts.length = 0;
      }
    }
    // the suspect keeps driving unless boxed in
    if (st.time >= m.startAt && contacts.length < 2) {
      let remaining = m.speed * TIME_COMPRESS / 2.4 * WEATHER_SPEED[st.weather] * (contacts.length ? 0.45 : evading ? 1.25 : 1) * dt;
      let guard = 0;
      const passed: number[] = [];
      while (remaining > 1e-6 && guard++ < 8) {
        if (m.next < 0) m.next = this.chooseEscape(m, assigned);
        const tgt = city.nodes[m.next];
        const dx = tgt.x - m.x, dy = tgt.y - m.y, d = Math.hypot(dx, dy);
        if (d <= remaining || d < 1e-3) { m.x = tgt.x; m.y = tgt.y; remaining -= d; m.came = m.prev; m.prev = m.next; m.next = -1; passed.push(m.prev); if (d < 1e-3 && guard > 3) break; }
        else { m.x += (dx / d) * remaining; m.y += (dy / d) * remaining; m.heading = Math.atan2(dy, dx); remaining = 0; }
      }
      const last = m.trail[m.trail.length - 1];
      if (!last || Math.hypot(last.x - m.x, last.y - m.y) > 10) { m.trail.push({ x: m.x, y: m.y }); if (m.trail.length > 26) m.trail.shift(); }
      for (const node of passed) this.runOverStinger(inc, node);
    }
    const dPrev = Math.hypot(city.nodes[m.prev].x - m.x, city.nodes[m.prev].y - m.y);
    inc.nodeId = m.next >= 0 && Math.hypot(city.nodes[m.next].x - m.x, city.nodes[m.next].y - m.y) < dPrev ? m.next : m.prev;
    inc.district = city.nodes[inc.nodeId].district;
    // crews in contact stay on the suspect's tail
    contacts.forEach((u, i) => {
      u.status = 'ON_SCENE'; u.note = 'In pursuit'; u.route = []; u.eta = 0; u.destNode = null;
      const ang = m.heading + Math.PI + (i - (contacts.length - 1) / 2) * 0.7;
      u.x = m.x + Math.cos(ang) * 14; u.y = m.y + Math.sin(ang) * 14; u.prevNode = m.prev;
    });
    // tracking: a caller still following, or crews with eyes on it, keep the location live
    const call = this.callFor(inc);
    const following = !!call && call.state === 'active' && !call.stopFollowing && st.time - (call.answeredAt ?? st.time) < (call.following ? 260 : 160);
    // the live position only reaches ground units through the caller or a crew with eyes on (air positions are relayed by dispatch)
    m.tracked = following || contacts.length > 0 || assigned.some((u) => Math.hypot(u.x - m.x, u.y - m.y) < (m.foot ? 60 : 120) && !evading) || cctvTracking(this, inc);
    if (inc.reportedNode !== null) {
      if (m.tracked && st.time - m.lastUpdate >= 2.5) { m.lastUpdate = st.time; inc.reportedNode = inc.nodeId; }
      else if (!m.tracked && st.time - m.lastSighting > 22) {
        m.lastSighting = st.time;
        if (m.foot) {
          // people on the street ring in when a running man goes past — late, and only roughly where
          if (this.hrand(inc.num, 92) < 0.4) {
            const lm = landmarkNear(this, m.x, m.y, 120);
            const node = lm ? lm.nodeId : city.nearestNode(m.x, m.y);
            inc.reportedNode = node;
            this.radio('DISPATCH', `All units, caller reports a man matching the description running past ${lm ? lm.name : addressOf(city, node)}, about a minute ago.`, 'dispatch', undefined, inc.id);
            this.notify(`Sighting (a minute old): suspect on foot near ${lm ? lm.name : addressOf(city, node)}`, 'warn', inc.id);
          }
        } else if (this.rng.chance(0.6)) {
          inc.reportedNode = inc.nodeId;
          this.radio('DISPATCH', `All units, suspect vehicle sighted near ${addressOf(city, inc.nodeId)}.`, 'dispatch', undefined, inc.id);
          this.notify(`Sighting: suspect vehicle near ${addressOf(city, inc.nodeId)}`, 'warn', inc.id);
        }
      }
    }
    if (following && call && st.time >= m.startAt && st.time - call.lastSpontaneous > 11 && !call.pending.length) {
      const n = city.nodes[inc.nodeId];
      const lines = [`He's on ${n.addrStreet} now, near ${n.crossStreet}!`, `Turning onto ${n.addrStreet}! He's still going!`, `We're passing ${n.crossStreet} — he's not stopping!`, `${n.addrStreet}, heading toward ${n.crossStreet}. I can't keep up much longer!`];
      call.pending.push({ at: st.time + 0.4, text: this.rng.pick(lines), heard: [{ nodeId: inc.nodeId, label: `Suspect at ${n.addrStreet} & ${n.crossStreet} (live)`, source: 'cross', reliability: 'sure' }] });
      call.lastSpontaneous = st.time;
    }
    // risk to the public grows until the car is stopped
    if (contacts.length) {
      inc.threat = Math.max(0, inc.threat - 0.6 * dt);
      const eff = contacts.reduce((s, u) => s + this.unitEffectiveness(u), 0) / contacts.length;
      inc.workProgress += dt * eff * (contacts.length >= 2 ? 3 : 1) * (m.heliId ? 1.5 : 1);
      if (inc.workProgress >= inc.work) {
        this.radio(contacts[0].spoken, m.foot ? `Dispatch, ${contacts[0].spoken}. One detained after a foot chase. Property recovered.` : `Dispatch, ${contacts[0].spoken}. Suspect vehicle stopped, driver in custody.`, 'unit', contacts[0].id, inc.id);
        st.stats.pursuitsCaught++;
        this.headline(`Police end ${inc.label.toLowerCase()} — suspect in custody`, 'good');
        this.fx('good', inc.nodeId, 'Suspect detained');
        inc.reportedNode = inc.nodeId;
        this.resolveIncident(inc, 'success');
        return;
      }
    } else if (st.time >= m.startAt) inc.threat += inc.growth * dt;
    if (inc.status === 'ESCALATING' && st.time - (inc.escalatedAt ?? 0) > 10) inc.status = contacts.length ? 'ON_SCENE' : inc.assignedUnits.length ? 'UNITS_EN_ROUTE' : inc.reportedNode !== null ? 'AWAITING_DISPATCH' : inc.status;
    if (inc.threat >= 100) this.escalate(inc);
  }

  // ── BOLOs, spike strips and crew breaks ───────────────────────────────────
  /** what a BOLO would say: the caller's description, plus vehicle and weapon if known */
  boloInfo(incId: string): { ok: boolean; reason?: string; text?: string; quality?: number } {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || inc.category !== 'police') return { ok: false, reason: 'BOLOs are for police incidents with a suspect' };
    if (inc.status === 'CLOSED') return { ok: false, reason: 'Incident closed' };
    const f = (k: string) => inc.facts.find((x) => x.key === k && x.confidence !== 'contradicted');
    const desc = f('suspect_desc');
    if (!desc || typeof desc.value !== 'string') return { ok: false, reason: 'Get a description of the suspect from the caller first' };
    if ((st.bolos ?? []).some((b) => b.incId === incId && b.status === 'active')) return { ok: false, reason: 'A BOLO is already out for this suspect' };
    const veh = f('vehicles'), weapon = f('weapon');
    const armed = weapon && weapon.value && weapon.value !== 'none';
    const quality = Math.min(1, 0.55 + (veh ? 0.2 : 0) + (weapon ? 0.1 : 0) + (desc.confidence === 'confirmed' ? 0.15 : 0));
    return { ok: true, text: `${desc.value}${armed ? `, possibly armed${typeof weapon.value === 'string' ? ` (${weapon.value})` : ''}` : ''}`, quality };
  }
  /** put the description out to every patrol: cruising cars may spot the suspect later */
  broadcastBolo(incId: string): { ok: boolean; reason?: string } {
    const info = this.boloInfo(incId);
    if (!info.ok) return info;
    const st = this.state, inc = st.incidents[incId], t = inc.truth;
    const blurb = `${String(t.cause ?? '')} ${String(t.suspect_desc ?? '')}`;
    const fled = inc.pursuit || /flee|fled|leaving|running|escap|heading/.test(blurb);
    const caughtOnScene = inc.firstArrivalAt !== null && !fled;
    const atLarge = t.suspect === true && this.rng.chance(fled ? 0.95 : caughtOnScene ? 0.25 : 0.65);
    const vehicle = /car|sedan|van|hatchback|truck|vehicle|motorbike/.test(String(t.suspect_desc ?? ''));
    (st.bolos ??= []).push({ id: `b${st.bolos.length + 1}`, incId, at: st.time, expiresAt: st.time + 540, text: info.text!, quality: info.quality!, atLarge, vehicle, status: 'active' });
    const num = String(inc.num).padStart(4, '0');
    this.radio('DISPATCH', `All units, BOLO in connection with INC-${num}: ${info.text}. Last seen near ${addressOf(this.city, inc.reportedNode ?? inc.nodeId)}.`, 'dispatch', undefined, inc.id);
    const ack = Object.values(st.units).find((u) => this.onPatrol(u));
    if (ack) this.radio(ack.spoken, this.rng.pick(['Copy the BOLO.', `${ack.spoken} copies, we'll keep an eye out.`, 'Copy, watching for them.']), 'chatter', ack.id);
    this.log('dispatch', `BOLO issued for INC-${num}`, { incidentId: inc.id });
    this.emit({ type: 'alert', text: 'BOLO' });
    return { ok: true };
  }
  private updateBolos() {
    const st = this.state;
    for (const b of st.bolos ?? []) {
      if (b.status !== 'active') continue;
      const inc = st.incidents[b.incId];
      const num = inc ? String(inc.num).padStart(4, '0') : '----';
      if (st.time >= b.expiresAt) {
        b.status = 'expired';
        this.radio('DISPATCH', `All units, cancel the BOLO for INC-${num} — no sightings.`, 'dispatch', undefined, b.incId);
        continue;
      }
      const watchers = Object.values(st.units).filter((u) => this.onPatrol(u));
      if (!watchers.length) continue;
      const night = st.timeOfDay % 24 >= 21 || st.timeOfDay % 24 < 5;
      // a vague description gets the odd wrong stop
      if (!b.atLarge || b.quality < 0.7) {
        if (this.rng.chance(0.004 * (1.2 - b.quality))) {
          const u = this.rng.pick(watchers);
          this.radio(u.spoken, `Dispatch, ${u.spoken}. Stopped someone who looked like the BOLO for INC-${num} — not our guy. Back in service.`, 'unit', u.id, b.incId);
          u.status = 'BUSY'; u.timer = 20; u.route = []; u.speed = 0;
        }
        if (!b.atLarge) continue;
      }
      if (!this.rng.chance(0.0045 * b.quality * Math.min(4, watchers.length) * (night ? 0.8 : 1))) continue;
      const u = this.rng.pick(watchers);
      b.status = 'found'; b.foundBy = u.id;
      st.stats.boloHits = (st.stats.boloHits ?? 0) + 1;
      const where = addressOf(this.city, u.prevNode);
      this.fx('good', u.prevNode, 'BOLO hit');
      if (b.vehicle && inc) {
        this.radio(u.spoken, `Dispatch, ${u.spoken}! I've got the BOLO vehicle from INC-${num} at ${where} — lit him up and he's not stopping!`, 'alert', u.id, b.incId);
        const child = this.spawnIncident('pursuit', this.city.nodes[u.prevNode].district, { connectedTo: inc, noCall: true, nodeId: u.prevNode });
        child.reportedNode = u.prevNode;
        this.dispatch(u.id, child.id, { code: 3, self: true });
        this.notify(`BOLO hit — ${u.callsign} is chasing the suspect from INC-${num}`, 'good', child.id);
        this.emit({ type: 'alert', text: 'BOLO hit — pursuit', incId: child.id, cine: 'chase' });
      } else {
        this.radio(u.spoken, `Dispatch, ${u.spoken}. Out with a subject matching the BOLO for INC-${num} at ${where}. Running them now.`, 'unit', u.id, b.incId);
        u.status = 'BUSY'; u.timer = 60; u.route = []; u.speed = 0; u.note = 'BOLO stop';
        this.officerRequest(u, inc ?? null, 'person', inc?.truth.weapon !== false && inc?.truth.weapon !== undefined, 3);
        this.notify(`BOLO hit — ${u.callsign} has stopped a subject matching INC-${num}`, 'good', b.incId);
      }
      st.stats.bonus += 400; st.budget += 400;
      this.headline(`Patrol spots suspect wanted over ${inc ? inc.label.toLowerCase() : 'earlier incident'}`, 'good');
    }
  }

  /** the vehicle pursuit spikes would be laid against */
  activePursuit(): Incident | undefined {
    return Object.values(this.state.incidents).filter((i) => i.pursuit && i.mover && !i.hidden && !['RESOLVED', 'CLOSED'].includes(i.status)).sort((a, b) => b.createdAt - a.createdAt)[0];
  }
  /** police cars that could get spikes to a spot in time */
  stingerUnits(node: number): Array<{ unit: Unit; eta: number }> {
    const inc = this.activePursuit();
    return Object.values(this.state.units)
      .filter((u) => u.service === 'police' && !isAir(u) && !u.temp && ((['AVAILABLE', 'RETURNING'].includes(u.status) && !u.assignedIncidentId) || (inc && u.assignedIncidentId === inc.id && ['DISPATCHED', 'EN_ROUTE'].includes(u.status))))
      .map((unit) => ({ unit, eta: this.estimate(unit.id, node)?.eta ?? Infinity })).filter((x) => isFinite(x.eta)).sort((a, b) => a.eta - b.eta);
  }
  deployStinger(unitId: string, node: number): { ok: boolean; reason?: string } {
    const st = this.state;
    const inc = this.activePursuit();
    if (!inc) return { ok: false, reason: 'No vehicle pursuit in progress' };
    const u = st.units[unitId];
    if (!u || !this.stingerUnits(node).some((x) => x.unit.id === unitId)) return { ok: false, reason: 'That unit cannot run spikes right now' };
    if ((st.stingers ?? []).some((x) => !x.result && x.incId === inc.id && x.node === node)) return { ok: false, reason: 'Spikes are already going down there' };
    if (u.assignedIncidentId) this.detach(u, true);
    u.status = 'BUSY'; u.timer = 9999; u.note = `Spike strip → ${addressOf(this.city, node)}`;
    this.routeUnit(u, node, true);
    (st.stingers ??= []).push({ id: `s${st.stingers.length + 1}`, unitId, incId: inc.id, node, laidAt: null, expiresAt: st.time + 260 });
    this.radio('DISPATCH', `${u.spoken}, deploy stop sticks at ${addressOf(this.city, node)}.`, 'dispatch', u.id, inc.id);
    this.radio(u.spoken, this.rng.pick(['Copy, en route with the stingers.', 'Copy, setting up spikes.', 'On our way — we\'ll have the strip down.']), 'unit', u.id, inc.id);
    return { ok: true };
  }
  private updateStingers() {
    const st = this.state;
    for (const s of st.stingers ?? []) {
      if (s.result) continue;
      const u = st.units[s.unitId], inc = st.incidents[s.incId];
      const over = !inc || !inc.mover || ['RESOLVED', 'CLOSED'].includes(inc.status);
      if (!u || over || st.time >= s.expiresAt || !u.note?.startsWith('Spike strip')) {
        s.result = 'cancelled';
        if (u && u.note?.startsWith('Spike strip')) {
          u.note = undefined; u.timer = 0; u.status = 'RETURNING'; this.routeUnit(u, u.postNode, false);
          if (!over) this.radio(u.spoken, 'Pulling the spikes, he never came this way.', 'unit', u.id, s.incId);
        }
        continue;
      }
      if (s.laidAt === null && !u.route.length) {
        s.laidAt = st.time; u.note = `Spike strip at ${addressOf(this.city, s.node)}`; u.speed = 0;
        this.radio(u.spoken, `Dispatch, ${u.spoken}. Spikes are down at ${addressOf(this.city, s.node)}.`, 'unit', u.id, s.incId);
        this.fx('info', s.node, 'Spikes down');
      }
    }
  }
  /** the fleeing car crosses a node: did it meet a spike strip? */
  private runOverStinger(inc: Incident, node: number) {
    const st = this.state;
    const s = (st.stingers ?? []).find((x) => !x.result && x.laidAt !== null && x.incId === inc.id && x.node === node);
    if (!s) return;
    const u = st.units[s.unitId], m = inc.mover!;
    const grip = ({ rain: 0.9, storm: 0.85, snow: 0.8, fog: 0.95 } as Record<string, number>)[st.weather] ?? 1;
    const w = this.moverWhere(m);
    if (this.rng.chance(0.8 * grip)) {
      s.result = 'hit';
      st.stats.stingerHits = (st.stingers ?? []).filter((x) => x.result === 'hit').length;
      m.speed *= 0.2; m.evadeUntil = 0;
      inc.threat = Math.max(0, inc.threat - 25); inc.workProgress += inc.work * 0.35; inc.reportedNode = node;
      this.radio(u?.spoken ?? 'UNIT', `Spikes got him! Tyres are shredded — he's crawling ${w.dir} on ${w.street}!`, 'alert', u?.id, inc.id);
      this.fx('good', node, 'Spikes hit');
      this.headline(`Stop sticks end ${inc.label.toLowerCase()}`, 'good');
    } else {
      s.result = 'missed';
      this.radio(u?.spoken ?? 'UNIT', `He swerved round the strip! Still going ${w.dir} on ${w.street}!`, 'alert', u?.id, inc.id);
      this.fx('warn', node, 'Missed the spikes');
    }
    // the spike car joins the chase either way
    if (u) { u.note = undefined; u.timer = 0; u.status = 'AVAILABLE'; this.dispatch(u.id, inc.id, { code: 3, self: true }); }
  }

  /** tired crews ask for a meal break (Code 7): rest against coverage */
  private breakRequests() {
    const st = this.state;
    if (st.config.script || st.config.mode === 'tutorial' || st.time < (st.nextBreakAt ?? 300)) return;
    if ((st.decisions ?? []).some((d) => !d.chosen)) return;
    const fat = (u: Unit) => { const c = this.crewOf(u); return c.length ? c.reduce((a, p) => a + p.fatigue, 0) / c.length : 0; };
    const tired = Object.values(st.units).filter((u) => u.status === 'AVAILABLE' && !isAir(u) && !u.temp && fat(u) > 42).sort((a, b) => fat(b) - fat(a))[0];
    if (!tired) { st.nextBreakAt = st.time + 60; return; }
    st.nextBreakAt = st.time + this.rng.range(280, 440);
    (st.decisions ??= []).push({
      id: `d${st.decisions.length + 1}-b${Math.floor(st.time)}`, incId: '', unitId: tired.id, at: st.time, expiresAt: st.time + 25, kind: 'break',
      prompt: `${tired.spoken}: requesting Code 7 for a meal break — about fifteen minutes?`,
      options: [{ id: 'approve', label: 'Approve the break', hint: 'Out of service for a while, back fresh and sharper' }, { id: 'later', label: 'Not now — ask me later', hint: 'Stays available; the crew keeps tiring' }, { id: 'deny', label: 'Deny it', hint: 'Available, but morale takes a hit' }],
      defaultId: 'later',
    });
    this.radio(tired.spoken, `Dispatch, ${tired.spoken}. Requesting Code 7 for a meal break when you can.`, 'unit', tired.id);
  }
  private decideBreak(d: import('./types').Decision, optionId: string, auto: boolean): { ok: boolean; outcome?: string } {
    const st = this.state;
    const u = st.units[d.unitId];
    const crew = u ? this.crewOf(u) : [];
    if (!u) { d.outcome = 'Unit no longer on shift.'; return { ok: true, outcome: d.outcome }; }
    if (optionId === 'approve') {
      if (u.status !== 'AVAILABLE') { d.outcome = `${u.callsign} got a call first — break cancelled.`; return { ok: true, outcome: d.outcome }; }
      this.radio('DISPATCH', `${u.spoken}, Code 7 approved. Enjoy.`, 'dispatch', u.id);
      this.radio(u.spoken, this.rng.pick(['Appreciate it, dispatch.', 'Thanks — back shortly.', 'Copy, Code 7.']), 'unit', u.id);
      u.status = 'OUT_OF_SERVICE'; u.note = 'Meal break'; u.timer = 150; u.route = []; u.speed = 0;
      for (const p of crew) { p.fatigue = Math.max(0, p.fatigue - 40); p.morale = Math.min(100, p.morale + 6); }
      st.stats.breaksGiven = (st.stats.breaksGiven ?? 0) + 1;
      d.outcome = `${u.callsign} is on a meal break — back in service in a few minutes.`;
    } else if (optionId === 'later') {
      if (!auto) this.radio('DISPATCH', `${u.spoken}, stand by on that — busy board.`, 'dispatch', u.id);
      this.radio(u.spoken, 'Copy, standing by.', 'unit', u.id);
      for (const p of crew) { p.fatigue = Math.min(100, p.fatigue + 3); p.morale = Math.max(0, p.morale - 2); }
      st.nextBreakAt = Math.min(st.nextBreakAt ?? Infinity, st.time + 130);
      d.outcome = `${u.callsign} will ask again later.`;
    } else {
      this.radio('DISPATCH', `${u.spoken}, negative on the Code 7, we need you available.`, 'dispatch', u.id);
      this.radio(u.spoken, this.rng.pick(['...Copy.', 'Copy. Running on fumes here.', 'Understood.']), 'unit', u.id);
      for (const p of crew) p.morale = Math.max(0, p.morale - 10);
      d.outcome = `${u.callsign} stays available — the crew is not happy (morale down).`;
    }
    return { ok: true, outcome: d.outcome };
  }

  // ── Callers ask the dispatcher things ─────────────────────────────────────
  /** the closest responding unit's ETA to this incident */
  private soonestEta(inc: Incident): number {
    let best = Infinity;
    for (const id of inc.assignedUnits) { const u = this.state.units[id]; if (u && ['DISPATCHED', 'EN_ROUTE'].includes(u.status)) best = Math.min(best, u.eta ?? this.estimate(u.id, inc.reportedNode ?? inc.nodeId)?.eta ?? Infinity); }
    return best;
  }
  /** caller-question randomness, derived from the call and the clock so it never shifts the simulation's own random stream */
  private qrand(call: Call, salt: number): number {
    let h = 2166136261 ^ salt;
    for (let i = 0; i < call.id.length; i++) h = Math.imul(h ^ call.id.charCodeAt(i), 16777619);
    h = Math.imul(h ^ Math.floor(this.state.time * 2), 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  private qpick<T>(call: Call, arr: T[]): T { return arr[Math.floor(this.qrand(call, arr.length * 31 + 5) * arr.length)]; }
  private callerQuestions(call: Call, inc: Incident) {
    const st = this.state;
    if (call.question) return;
    // a promise of "any second now" that did not come true
    if (call.overpromiseAt != null && st.time >= call.overpromiseAt) {
      call.overpromiseAt = null;
      if (!this.onScene(inc).length && !call.pending.length) {
        call.mood.trust = Math.max(0, call.mood.trust - 20); call.mood.frustration = Math.min(100, call.mood.frustration + 15);
        call.pending.push({ at: st.time + 0.5, text: this.qpick(call, ["You said any second! Where are they?!", "It's been ages — you told me they were nearly here!", "Why did you say they were close? Nobody's here!"]) });
        return;
      }
    }
    if (call.pending.length || call.profile.archetype === 'silent' || (call.profile.language && call.interpreter !== 'on') || inc.truth.outside) return;
    const since = st.time - (call.answeredAt ?? st.time);
    const asked = (call.questionsAsked ??= []);
    const waiting = inc.reportedNode !== null && inc.assignedUnits.length > 0 && !this.onScene(inc).length;
    if (since < 10 || (call.questionCount ?? 0) >= 6 || st.time - (call.lastQuestionAt ?? -99) < (waiting ? 15 : 20) || st.time - call.lastSpontaneous < 3) return;
    if (this.qrand(call, 1) >= 0.12) return;
    const t = inc.truth, tid = inc.templateId, m = call.mood;
    const has = (k: string) => !asked.includes(k);
    const conscious = t.conscious !== false;
    const name = this.qpick(call, ['him', 'her']);
    const q = (kind: string, text: string, options: Array<[string, string, string, string, string]>, timeout: { effect: string; line: string }) => {
      asked.push(kind);
      call.questionCount = (call.questionCount ?? 0) + 1;
      call.lastQuestionAt = st.time;
      const f = (x: string) => fill(x, inc.vars);
      this.deliver(call, { at: st.time, text });
      call.question = { kind, text: f(text), at: st.time, expiresAt: st.time + 32, lineIdx: call.transcript.length - 1, options: options.map(([id, label, say, reply, effect]) => ({ id, label: f(label), say: f(say), reply: f(reply), effect })), timeout: { effect: timeout.effect, line: f(timeout.line) } };
    };
    // ordered by urgency: the first one that fits is asked
    if (has('goback') && ['kitchen_fire', 'apartment_fire', 'electrical_fire'].includes(tid) && inc.firstArrivalAt === null) {
      const who = this.qpick(call, ['my dog', 'the cat', 'my neighbour from upstairs']);
      return q('goback', `${who[0].toUpperCase()}${who.slice(1)} — I think ${who.startsWith('my n') ? 'she' : "he"}'s still in there! Should I go back in and get ${who.startsWith('my n') ? 'her' : 'him'}?`, [
        ['stay', 'No — stay outside', "No. Do not go back inside. Stay out, and tell the firefighters exactly where to look when they arrive.", "Okay... okay. I'll wait right here by the door.", 'aid:evacuate'],
        ['go', 'Go in quickly', "If you're quick, go in and get them — stay low.", "Okay — I'm going in!", 'harm:goback'],
      ], m.panic > 60 && this.qrand(call, 7) < 0.5 ? { effect: 'harm:goback', line: "I can't just stand here — I'm going in!" } : { effect: 'calm', line: "...I'll wait. Please hurry." });
    }
    if (has('gasback') && ['gas_leak', 'carbon_monoxide'].includes(tid) && inc.firstArrivalAt === null) {
      return q('gasback', this.qpick(call, ['Should I run back in and turn the cooker off? And open the windows?', "I left the door open — should I go back in and switch everything off at the wall?"]), [
        ['out', 'No — stay out, no switches', "No. Stay outside, don't touch any switches or anything electrical, and keep everyone away from the building.", "Right. Staying out. I'll keep people back.", 'aid:evacuate'],
        ['in', 'Yes, turn it off', 'Yes — quickly turn it off and open the windows, then come straight out.', "Okay, I'm going in to turn it off...", 'harm:gasback'],
      ], m.panic > 60 && this.qrand(call, 7) < 0.5 ? { effect: 'harm:gasback', line: "I'm just going to switch it off, it'll take a second—" } : { effect: 'calm', line: "I'll stay out here." });
    }
    if (has('confront') && ['burglary_progress', 'suspicious_activity', 'trespassing', 'domestic_disturbance', 'strange_noise', 'animal_burglar'].includes(tid) && inc.firstArrivalAt === null) {
      return q('confront', this.qpick(call, ["I can hear them moving about downstairs — should I go and see who it is?", "He's still out there by the back door. Should I go out and tell him to clear off?", 'Should I grab something and go and check?']), [
        ['hide', 'No — lock yourself in', "No. Lock yourself in a room, stay quiet, keep away from the door and stay on the line with me.", "Okay. I'm in the bedroom. I've locked it.", 'aid:lock'],
        ['look', 'Have a careful look', 'Go and have a careful look, but keep your distance.', "Okay... I'm going down.", 'harm:confront'],
      ], m.frustration > 45 && this.qrand(call, 7) < 0.5 ? { effect: 'harm:confront', line: "That's it, I'm not hiding in my own house — I'm going down there." } : { effect: 'calm', line: "I'm staying in the bedroom. Please hurry." });
    }
    if (has('confront') && ['shoplifting', 'robbery', 'carjacking'].includes(tid) && inc.firstArrivalAt === null) {
      return q('confront', tid === 'shoplifting' ? "He's walking out with it — should I try and stop him?" : "He's leaving — should I go after him?", [
        ['let', "No — don't try to stop him", "Don't try to stop him. Watch which way he goes and describe him to me.", "Okay. He's going left, towards the bus stop.", 'calm'],
        ['stop', 'Try to stop him', 'If you can do it safely, try to stop him at the door.', 'Right — hey! HEY, YOU!', 'harm:confront'],
      ], { effect: 'calm', line: 'He just walked out. I let him go.' });
    }
    if (has('water') && ['fall_elderly', 'sudden_illness', 'allergic_reaction', 'workplace_injury', 'sports_injury', 'collision_injury', 'gunshot_victim', 'breathing_trouble'].includes(tid) && inc.careAt == null) {
      return q('water', conscious ? `${name === 'him' ? "He's" : "She's"} asking for a drink — can I give ${name} some water?` : `Should I splash some water on ${name}, or try to get ${name} to drink something?`, [
        ['no', 'No food or drink', `No — nothing to eat or drink until the paramedics have seen ${name}. You can wet ${name === 'him' ? 'his' : 'her'} lips if they're dry.`, 'Okay, no water. I told them.', 'calm'],
        ['yes', 'Small sips', 'Yes, just small sips.', 'Okay, here, just a little...', 'harm:water'],
      ], m.panic > 60 && this.qrand(call, 7) < 0.5 ? { effect: 'harm:water', line: `I gave ${name} a little water, ${name === 'him' ? 'he' : 'she'} was begging for it...` } : { effect: 'calm', line: "I'll wait for them." });
    }
    if (has('lift') && ['fall_elderly', 'collision_injury', 'collision_trapped', 'workplace_injury', 'sports_injury', 'industrial_accident'].includes(tid) && inc.careAt == null) {
      return q('lift', tid.startsWith('collision') ? `Should we pull ${name} out of the car? People are saying we should get ${name} out.` : `${name === 'him' ? "He's" : "She's"} on the cold floor — should I help ${name} up into a chair?`, [
        ['still', "Don't move them", `Don't move ${name} unless there's fire or immediate danger. Keep ${name} still and warm until the crew gets there.`, `Okay, we're leaving ${name} where ${name === 'him' ? 'he' : 'she'} is. I've put my coat over ${name}.`, 'aid:still'],
        ['lift', 'Help them up', `Yes, carefully help ${name} up.`, 'Okay, one, two, three—', 'harm:lift'],
      ], m.panic > 62 && this.qrand(call, 7) < 0.5 ? { effect: 'harm:lift', line: `We got ${name} up — ${name === 'him' ? "he's" : "she's"} screaming about ${name === 'him' ? 'his' : 'her'} back now...` } : { effect: 'calm', line: `I'll leave ${name} be.` });
    }
    if (has('follow') && inc.pursuit && inc.mover && st.time >= inc.mover.startAt) {
      return q('follow', "He's getting away — should I keep following him?!", [
        ['stop', 'No — pull over', "No. Pull over somewhere safe and tell me which way he was heading.", "Okay, I've stopped. He went towards the river.", 'nofollow'],
        ['follow', 'Follow at a distance', 'Stay well back, obey the road, and keep telling me where he goes.', "Okay, I'm behind him. I'll keep talking.", 'follow'],
      ], { effect: m.frustration > 40 ? 'follow' : 'nofollow', line: m.frustration > 40 ? "I'm going after him." : "I've lost him, I've pulled over." });
    }
    // things that change while help is on the way
    const BLEEDERS = ['gunshot_victim', 'collision_injury', 'workplace_injury', 'industrial_accident', 'domestic_disturbance', 'robbery', 'fireworks'];
    const UNCONSCIOUS = ['collapse_child', 'sudden_illness', 'public_intoxication', 'drowning_pool', 'breathing_trouble', 'fall_elderly'];
    if (waiting && inc.careAt == null) {
      if (has('bleed') && BLEEDERS.includes(tid) && Number(t.injured ?? 0) > 0) {
        return q('bleed', 'The blood is soaking right through the towel! What do I do?!', [
          ['press', 'Another towel, press harder', 'Put another towel straight on top — don\'t lift the first one — and press down hard with both hands.', "Okay — another one on top, I'm pressing hard.", 'aid:pressure'],
          ['peek', 'Lift it and look', 'Lift the towel and have a look at the wound.', "Okay, I'm lifting it— oh God, it's pouring out—", 'harm:peek'],
        ], { effect: 'panic', line: "It's still coming through! Hello?!" });
      }
      if (has('snore') && UNCONSCIOUS.includes(tid) && t.breathing !== false) {
        return q('snore', `${'{He}'} is making this awful snoring, gurgling noise!`, [
          ['side', 'Roll them onto their side', 'Roll {him} onto {his} side, tilt the head back a little and let anything in the mouth drain out.', "Okay, on {his} side... the noise is better, {he}'s breathing easier.", 'aid:recovery'],
          ['water', 'Give some water to clear it', 'Try giving {him} a little water to clear the throat.', "I'm trying to get {him} to drink—", 'harm:water'],
        ], { effect: 'panic', line: "It's getting worse! What do I do?!" });
      }
      if (has('vomit') && ['sudden_illness', 'public_intoxication', 'allergic_reaction', 'collapse_child', 'carbon_monoxide'].includes(tid)) {
        return q('vomit', "{He}'s being sick! {He}'s being sick everywhere!", [
          ['side', 'Turn them on their side', 'Turn {him} onto {his} side straight away so {he} doesn\'t choke, and clear {his} mouth.', "Okay — on {his} side. {He}'s coughing but {he}'s breathing.", 'aid:recovery'],
          ['sit', 'Sit them up', 'Sit {him} up so {he} can be sick more easily.', "I'm getting {him} up—", 'harm:lift'],
        ], { effect: 'panic', line: "{He}'s choking on it! Please!" });
      }
      if (has('seizure') && ['sudden_illness', 'collapse_child', 'breathing_trouble'].includes(tid)) {
        return q('seizure', "{He}'s shaking — all over — it won't stop! Is {he} having a fit?!", [
          ['space', "Clear space, don't hold them", "Move anything hard away, put something soft under the head, don't hold {him} down and don't put anything in {his} mouth. Tell me when it stops.", "Okay, I've moved the chairs... it's slowing down... it's stopped.", 'aid:still'],
          ['hold', 'Hold them still', 'Hold {him} down so {he} doesn\'t hurt {him}self, and put something between {his} teeth.', "I'm holding {him}— {he} bit my hand—", 'harm:lift'],
        ], { effect: 'panic', line: "It's still going! Hello?!" });
      }
      if (has('waking') && ['fall_elderly', 'collision_injury', 'sports_injury', 'workplace_injury'].includes(tid) && t.conscious !== false) {
        return q('waking', "{He}'s trying to get up — {he} says {he}'s fine and wants to walk!", [
          ['still', 'Keep them lying still', "Tell {him} to stay lying still until the crew have checked {him}. Keep talking to {him}.", "I told {him}. {He}'s lying back down, {he}'s grumbling but {he}'s staying put.", 'aid:still'],
          ['walk', 'Let them get up slowly', 'If {he} feels okay, let {him} get up slowly.', 'Okay, easy now— oh, {he}\'s gone dizzy—', 'harm:lift'],
        ], { effect: 'calm', line: "{He}'s sitting up now. I couldn't stop {him}." });
      }
      if (has('smoke') && ['apartment_fire', 'building_collapse', 'electrical_fire', 'warehouse_smoke'].includes(tid) && t.safe === false) {
        return q('smoke', "Smoke's coming in under the door! It's getting hard to breathe!", [
          ['seal', 'Seal the door, go to the window', 'Keep the door shut. Push towels or clothes along the gap, get low, go to the window and wave something so the crews see you.', "Okay, towels on the door... I'm at the window. I'm waving a sheet.", 'aid:still'],
          ['run', 'Open the door and run for it', 'Open the door and run for the stairs as fast as you can.', "Okay, I'm opening the door—", 'harm:smokerun'],
        ], { effect: 'panic', line: "I can't see! It's everywhere!" });
      }
      if (has('hose') && ['kitchen_fire', 'apartment_fire', 'vehicle_fire', 'electrical_fire'].includes(tid) && t.safe !== false) {
        return q('hose', 'One of the neighbours wants to go in with a garden hose. Should he?', [
          ['back', 'Everyone stay back', "No. Nobody goes near it. Get everyone back across the road and wait for the fire crews.", "I've told him. He's put the hose down, we're all back.", 'aid:evacuate'],
          ['try', 'Let him try', "If he's careful, a hose might help.", "He's going in with it...", 'harm:goback'],
        ], { effect: 'calm', line: "He's gone round the side with the hose. I couldn't stop him." });
      }
      if (has('handle') && ['burglary_progress', 'domestic_disturbance', 'strange_noise', 'suspicious_activity'].includes(tid)) {
        return q('handle', "(whispering) He's trying the door handle... he's right outside the door...", [
          ['silent', 'Stay silent — tap if you must', "Don't answer him. Stay silent and stay low. If you can't talk, tap the phone once for yes.", '(a single soft tap)', 'aid:lock'],
          ['shout', 'Shout that police are coming', 'Shout that the police are on their way.', "THE POLICE ARE COMING! ...he's stopped...", 'shout'],
        ], { effect: 'panic', line: '(heavy, frightened breathing)' });
      }
      if (has('fuel') && ['collision_injury', 'collision_multi', 'collision_trapped', 'vehicle_fire'].includes(tid)) {
        return q('fuel', "There's petrol leaking under the car — I can smell it!", [
          ['back', 'Everyone back, no flames', 'Get everyone well back from the car, nobody smokes, no lighters, and switch the engine off if you can do it safely.', "Everyone's back. Engine's off.", 'aid:evacuate'],
          ['push', 'Push the car off the road', 'Get a few people to push the car off the road.', 'Right, everyone push—', 'harm:push'],
        ], { effect: 'calm', line: "People are just standing around it." });
      }
    }
    const eta = this.soonestEta(inc);
    if (has('eta') && inc.assignedUnits.length && !this.onScene(inc).length && isFinite(eta) && since > 18) {
      const mins = eta >= 90 ? `about ${Math.round(eta / 60)} minutes` : eta >= 45 ? 'about a minute' : 'under a minute';
      return q('eta', this.qpick(call, ['How long until they get here?!', 'Are they close? Please tell me they\'re close.', 'How much longer? I can\'t do this on my own!']), [
        ['honest', `Tell them: ${mins}`, `They're ${mins} away, coming with lights and sirens. I'm staying with you until they're there.`, 'Okay. Okay, I can hold on that long.', 'eta_honest'],
        ['soon', 'Say: any second now', 'Any second now — they\'re nearly there.', 'Oh thank God.', 'eta_soon'],
      ], { effect: 'frustrate', line: 'Hello?! Are you even listening to me?' });
    }
    if (has('hangup') && !inc.pursuit && inc.firstArrivalAt !== null && this.onScene(inc).length && (inc.lifeThreat == null || inc.careAt != null) && since > 15) {
      return q('hangup', this.qpick(call, ["They're here! The crew just pulled up — can I hang up now?", "I can see them! Is it okay if I hang up and go to them?"]), [
        ['go', 'Yes — go to them', "Yes, go and meet them. You did really well — thank you.", 'Thank you... thank you so much.', 'handover'],
        ['wait', 'Stay on a moment', 'Stay on the line with me a moment longer, please.', "Okay, I'm still here.", 'stay'],
      ], { effect: 'hangup', line: "Okay — I'm going to them. Bye!" });
    }
    if (has('reassure') && call.profile.archetype === 'child_caller' && since > 12) {
      return q('reassure', this.qpick(call, ['Is... is my mummy going to be okay?', 'Am I going to be in trouble?', 'Will you stay with me?']), [
        ['kind', 'You are doing so well', "You're being so brave, and you're doing everything right. The helpers are coming, and I'm staying right here with you.", 'Okay... I\'m being brave.', 'calmbig'],
        ['firm', 'Keep answering me', 'I need you to keep answering my questions, okay?', '...okay.', 'firm'],
      ], { effect: 'panic', line: 'Hello...? Are you still there?' });
    }
    if (has('donthang') && m.panic > 75 && since > 14) {
      return q('donthang', this.qpick(call, ["Please don't hang up on me... please, I'm so scared.", "Don't leave me, okay? Please stay on the phone."]), [
        ['stay', "I'm not going anywhere", "I'm right here. I'm not going anywhere until help is with you. Breathe with me.", 'Okay... okay. I\'m breathing.', 'calmbig'],
        ['firm', 'Be firm: answer my questions', 'I need you to focus and answer my questions quickly.', 'I — okay. Okay.', 'firm'],
      ], { effect: 'panic', line: 'Hello?! Hello, are you there?!' });
    }
  }
  /** the dispatcher answers the caller's question */
  answerCaller(callId: string, optId: string, words?: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const call = st.calls[callId];
    const q = call?.question;
    if (!call || !q || call.state !== 'active') return { ok: false, reason: 'Nothing to answer' };
    const opt = q.options.find((o) => o.id === optId);
    if (!opt) return { ok: false, reason: 'Unknown answer' };
    call.question = null;
    st.stats.callerAnswers = (st.stats.callerAnswers ?? 0) + 1;
    this.addTranscript(call, 'DISPATCHER', words?.trim() || opt.say);
    const inc = st.incidents[call.incidentId];
    const line = { at: st.time + 1.1 + opt.reply.length * 0.02, text: opt.reply };
    call.pending.push(line);
    // the caller reacts to what you actually said (the decision itself stays the game's)
    if (this.aiMode && this.aiVoiced(call)) this.holdForAi(call, [line], `answered their question: ${opt.label}`, words?.trim() || opt.say);
    this.questionEffect(call, inc, opt.effect);
    return { ok: true };
  }
  private questionTimeout(call: Call) {
    const st = this.state, q = call.question!;
    call.question = null;
    const inc = st.incidents[call.incidentId];
    if (call.state === 'active') this.deliver(call, { at: st.time, text: q.timeout.line });
    if (call.state === 'active' || q.timeout.effect.startsWith('harm')) this.questionEffect(call, inc, q.timeout.effect);
  }
  private questionEffect(call: Call, inc: Incident, effect: string) {
    const st = this.state, m = call.mood;
    const [kind, arg] = effect.split(':');
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    switch (kind) {
      case 'calm': m.panic = clamp(m.panic - 8); m.base = clamp(m.base - 5); m.trust = clamp(m.trust + 6); break;
      case 'calmbig': m.panic = clamp(m.panic - 18); m.base = clamp(m.base - 10); m.trust = clamp(m.trust + 12); m.cooperation = clamp(m.cooperation + 6); break;
      case 'firm': m.panic = clamp(m.panic + 4); m.cooperation = clamp(m.cooperation + 8); m.trust = clamp(m.trust - 4); break;
      case 'panic': m.panic = clamp(m.panic + 10); m.trust = clamp(m.trust - 6); break;
      case 'frustrate': m.frustration = clamp(m.frustration + 12); m.trust = clamp(m.trust - 8); break;
      case 'stay': m.trust = clamp(m.trust + 4); break;
      case 'aid':
        this.applyAid(inc, call, { kind: arg, fit: 'good' });
        if (arg === 'evacuate' || arg === 'lock') inc.safetyAdvised = true;
        m.panic = clamp(m.panic - 6); m.trust = clamp(m.trust + 6);
        break;
      case 'harm': this.applyAid(inc, call, { kind: arg, fit: 'bad' }); break;
      case 'eta_honest': m.trust = clamp(m.trust + 8); m.panic = clamp(m.panic - 5); break;
      case 'eta_soon': {
        m.trust = clamp(m.trust + 4); m.panic = clamp(m.panic - 7);
        if (this.soonestEta(inc) > 50) call.overpromiseAt = st.time + 40;
        break;
      }
      case 'handover':
        st.stats.handoffs = (st.stats.handoffs ?? 0) + 1;
        call.pending.push({ at: st.time + 3.2, text: 'Caller went to meet the crew', system: true, hangup: true, endReason: 'handover' });
        break;
      case 'hangup': call.pending.push({ at: st.time + 1.2, text: '(the caller hangs up)', system: true, hangup: true }); break;
      case 'shout':
        if (this.qrand(call, 13) < 0.5) { inc.threat = Math.max(0, inc.threat - 12); call.pending.push({ at: st.time + 4, text: "(whispering) I think he's run off. I heard the back gate." }); }
        else { inc.threat = Math.min(99, inc.threat + 18); m.panic = clamp(m.panic + 12); this.consequence(inc, 'Shouting at the intruder told him exactly where the caller was hiding'); call.pending.push({ at: st.time + 4, text: "(banging) He's hitting the door! He knows I'm in here!" }); }
        break;
      case 'nofollow': call.stopFollowing = true; call.following = false; m.panic = clamp(m.panic - 6); break;
      case 'follow':
        call.following = true;
        if (this.qrand(call, 11) < 0.18) {
          call.pending.push({ at: st.time + 22, text: "(tyres screech) — oh God, oh God, I've hit something—", hangup: true });
          this.consequence(inc, 'A witness kept following the suspect on the dispatcher\'s say-so and crashed');
          st.reputation = Math.max(0, st.reputation - 1);
        }
        break;
    }
  }
  /** the dispatcher counts compressions out loud with the caller: on-tempo counting keeps CPR effective */
  cprPace(callId: string, bpm: number): { ok: boolean; reason?: string; tempo?: 'good' | 'slow' | 'fast' } {
    const st = this.state;
    const call = st.calls[callId];
    const inc = call ? st.incidents[call.incidentId] : undefined;
    const a = inc?.aid;
    if (!call || !inc || call.state !== 'active' || !a || a.kind !== 'cpr' || a.fit !== 'good' || inc.careAt != null) return { ok: false, reason: 'Nobody is doing CPR on this call' };
    const tempo = bpm < 95 ? 'slow' : bpm > 125 ? 'fast' : 'good';
    if (a.paceStartedAt === undefined || st.time - (a.pacedAt ?? -99) > 15) {
      a.paceStartedAt = st.time;
      this.addTranscript(call, 'DISPATCHER', 'Push hard and fast in the middle of the chest — count with me: one, two, three, four...');
    }
    if (tempo === 'good') { a.pacedAt = st.time; a.encouragedAt = st.time; st.stats.cprPaced = (st.stats.cprPaced ?? 0) + 1; }
    if (st.time - (a.lastPaceLine ?? -99) > 9 && !call.pending.length) {
      a.lastPaceLine = st.time;
      const n = this.qpick(call, ['twenty-eight, twenty-nine, thirty', 'fourteen, fifteen, sixteen', 'seven, eight, nine, ten']);
      call.pending.push({ at: st.time + 0.6, text: tempo === 'good' ? this.qpick(call, [`...${n}... I'm still pushing!`, `${n[0].toUpperCase()}${n.slice(1)}... okay, I've got the rhythm.`, "I'm keeping up — don't stop counting!"]) : tempo === 'slow' ? this.qpick(call, ['Like this? Is this fast enough?', "I'm getting so tired..."]) : this.qpick(call, ["That's too fast, I can't keep up!", 'Slow down, I\'m losing count!']) });
    }
    return { ok: true, tempo };
  }

  // ── Caller composure: keep them together while help is on the way ─────────
  /** the caller's emotional state, as the console reads it */
  callerState(call: Call): 'panicked' | 'angry' | 'frightened' | 'shaken' | 'calm' {
    const m = call.mood;
    return m.panic > 72 ? 'panicked' : m.frustration > 58 ? 'angry' : m.panic > 48 ? 'frightened' : m.panic < 15 ? 'calm' : 'shaken';
  }
  private composureTick(call: Call, inc: Incident, dt: number) {
    const st = this.state, m = call.mood;
    for (const t of call.tasks ?? []) if (t.status === 'doing' && st.time >= t.doneAt) this.finishTask(call, inc, t);
    if (call.state !== 'active' || inc.truth.outside || ['silent', 'prankster'].includes(call.profile.archetype) || (call.profile.language && call.interpreter !== 'on')) return;
    const waiting = inc.reportedNode !== null && inc.assignedUnits.length > 0 && !this.onScene(inc).length;
    const silence = st.time - (call.lastDispatcherAt ?? call.answeredAt ?? st.time);
    const busy = (call.tasks ?? []).some((t) => t.status === 'doing');
    // left in silence while they wait, fear builds
    if (waiting && silence > 14 && !busy) m.base = Math.min(100, m.base + 0.45 * dt * (['calm_serious', 'professional'].includes(call.profile.archetype) ? 0.4 : 1));
    if (waiting && silence > 16 && !busy && !call.pending.length && !call.question && st.time - call.lastSpontaneous > 13 && st.time - (call.lastWaitLine ?? -99) > 18) {
      call.lastWaitLine = st.time;
      call.pending.push({ at: st.time + 0.4, text: fill(this.waitLine(call, inc), inc.vars) });
    }
    if (m.panic >= 96) { call.panicSince ??= st.time; if (st.time - call.panicSince > 12 && !call.brokeDown) this.breakdown(call, inc); } else call.panicSince = null;
  }
  private waitLine(call: Call, inc: Incident): string {
    const hiding = HIDING.has(inc.templateId);
    const pool = inc.category === 'medical' || inc.lifeThreat ? ["{He}'s still breathing, but it's so shallow...", '{His} lips look a bit blue. Is that bad?', "I keep talking to {him} but {he}'s not really answering me.", "Please — how long now? I don't know how long {he} can—", "I'm holding {his} hand. {He}'s so cold."]
      : inc.category === 'fire' ? ["The smoke's getting thicker. I can barely see the door now.", 'I can hear windows cracking!', "Everyone's just standing in the street watching it burn.", "Where are the fire engines? It's spreading!"]
      : hiding ? ['(whispering) I can still hear him moving around...', "(whispering) He's gone quiet. I don't know where he is.", "(whispering) I'm so scared. Are they nearly here?", '(whispering) Something just smashed downstairs.']
      : ['Hello? Are you still there?', 'It feels like forever. Are they actually coming?', "I don't know what to do with myself while I wait.", 'Is someone coming? Nobody is here yet.'];
    return this.qpick(call, pool);
  }
  private breakdown(call: Call, inc: Incident) {
    const st = this.state, m = call.mood;
    call.brokeDown = true;
    st.stats.callerBreakdowns = (st.stats.callerBreakdowns ?? 0) + 1;
    m.cooperation = Math.max(0, m.cooperation - 30); m.base = 80;
    this.consequence(inc, 'The caller fell apart on the line while waiting for help');
    if (inc.reportedNode !== null && this.qrand(call, 17) < 0.5) call.pending.push({ at: st.time + 0.5, text: "(screaming) I can't — I can't do this — (the line goes dead)", hangup: true });
    else call.pending.push({ at: st.time + 0.5, text: "(sobbing uncontrollably — you can't get a clear word out of them)" });
    this.notify(`${call.profile.name.split(' ')[0]} has broken down on the line — nobody was keeping them together`, 'bad', inc.id);
  }
  /** a calming technique; how well it lands depends on the caller's state and personality, and repeating it wears thin */
  calmCaller(callId: string, kind: CalmKind, score = 1): { ok: boolean; reason?: string; eff?: number; d?: number } {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return { ok: false, reason: 'No active call' };
    if (call.profile.archetype === 'silent') return { ok: false, reason: 'The caller cannot speak — use yes/no taps' };
    if (call.profile.language && call.interpreter !== 'on') return { ok: false, reason: "They don't understand you yet — get an interpreter" };
    const inc = st.incidents[call.incidentId];
    const used = (call.calmUsed ??= {});
    const times = (used[kind] ?? []).filter((t) => st.time - t < 45);
    if (times.length && st.time - times[times.length - 1] < 5) return { ok: false, reason: 'Give them a moment to respond' };
    const mood = this.callerState(call);
    let eff = (CALM_FIT[mood][kind] ?? 0) + (CALM_ARCH[call.profile.archetype]?.[kind] ?? 0);
    if (kind === 'breathe') eff *= 0.3 + 0.9 * Math.max(0, Math.min(1, score));
    const u = inc.assignedUnits.map((id) => st.units[id]).filter((x): x is Unit => !!x && ['DISPATCHED', 'EN_ROUTE'].includes(x.status)).sort((a, b) => (a.eta ?? 1e9) - (b.eta ?? 1e9))[0];
    if (kind === 'update' && !u) eff = Math.min(eff, this.onScene(inc).length ? 0.4 : -0.3);
    eff *= Math.pow(0.55, times.length);
    if (times.length >= 2) eff -= 0.35;
    used[kind] = [...times, st.time];
    const m = call.mood, clamp = (v: number) => Math.max(0, Math.min(100, v));
    const before = m.panic;
    if (eff > 0) {
      m.panic = clamp(m.panic - 20 * eff); m.base = clamp(m.base - 12 * eff); m.trust = clamp(m.trust + 7 * eff); m.cooperation = clamp(m.cooperation + 4 * eff);
      if (kind === 'acknowledge' || kind === 'update') m.frustration = clamp(m.frustration - 20 * eff);
    } else { m.panic = clamp(m.panic + 2 - 10 * eff); m.frustration = clamp(m.frustration + 3 - 14 * eff); m.trust = clamp(m.trust - 6); }
    const first = call.profile.name.split(' ')[0];
    const mins = u ? ((u.eta ?? 60) >= 90 ? `about ${Math.round((u.eta ?? 60) / 60)} minutes` : (u.eta ?? 60) >= 45 ? 'about a minute' : 'under a minute') : '';
    const stn = u ? st.stations[u.stationId]?.name : '';
    const say: Record<CalmKind, string[]> = {
      reassure: [`${first}, you're doing really well. Help is on the way and I'm staying right here with you.`, "You're doing everything right. I'm not going anywhere.", "You did the hardest part by calling. We're getting help to you."],
      firm: [`${first}. ${first}, listen to me. Listen to my voice. One slow breath with me.`, 'I need you to stop and listen to me. One breath. Good. Now stay with me.', `Listen to me, ${first}. You can do this. Slow down and stay with me.`],
      acknowledge: ["I hear you. I know this feels like it's taking forever — I'd be frustrated too. They are coming.", "You're right to be upset. I'm doing everything I can from here.", "I understand. This is awful, and you're handling it."],
      ground: ['Tell me five things you can see around you right now.', 'What can you see from where you are? Describe it to me.', "Put your feet flat on the floor. Now tell me what's in front of you."],
      update: [u ? `The ${u.typeLabel.toLowerCase()} is ${mins} away — ${u.callsign} is coming from ${stn}. You'll hear the sirens soon.` : this.onScene(inc).length ? 'The crew are with you now — do what they tell you.' : "I'm getting a unit assigned to you right now."],
      breathe: ['Breathe with me. In... two... three... four. And out... two... three... four.'],
    };
    this.addTranscript(call, 'DISPATCHER', fill(this.qpick(call, say[kind]), inc.vars));
    const tier = eff >= 0.55 ? 'good' : eff > 0.12 ? 'ok' : 'bad';
    const replies: Record<string, Record<CalmKind, string[]>> = {
      good: {
        reassure: ["Okay... okay. Thank you. Please don't go anywhere.", "I'm trying. Okay. I'm here."], firm: ['...okay. Okay. I\'m listening.', "I'm breathing. I'm listening to you."],
        acknowledge: ['...yeah. Okay. Sorry for shouting.', 'Thank you. Just — please make them hurry.'], ground: [], update: [`${mins ? mins[0].toUpperCase() + mins.slice(1) : 'Okay'}. Okay. I can hold on.`, "Okay. I'll listen for the sirens."],
        breathe: ['(slow breathing) ...okay. That helped.', 'In... and out. Okay. I feel a bit better.'],
      },
      ok: { reassure: ['Okay.', "I'll try."], firm: ['...alright.', 'Okay, okay.'], acknowledge: ['Fine.', 'Okay.'], ground: [], update: ['Okay.', 'That long?'], breathe: ["I'm trying...", '(shaky breathing)'] },
      bad: {
        reassure: ['Stop saying that! You keep saying that!', "That doesn't help me!"], firm: ["Don't tell me to calm down!", "Don't talk to me like that!"],
        acknowledge: ["I don't need you to understand, I need help!"], ground: ["Why are you asking me that?! {He}'s dying!", "That's a stupid question!"],
        update: ['That is too long!', 'You said that before!'], breathe: ["I can't breathe, I can't do this—", 'Stop it! Just send someone!'],
      },
    };
    let reply = this.qpick(call, replies[tier][kind].length ? replies[tier][kind] : ['Okay.']);
    if (kind === 'ground' && tier !== 'bad') {
      // describing the surroundings sometimes gives away where they are
      if (inc.reportedNode === null && call.profile.locationAccuracy !== 'unknown' && this.qrand(call, 23) < 0.6) {
        const r = replyTo(this.env(call), 'landmark', '');
        const l = r.lines.find((x) => x.heard?.length);
        if (l) { call.pending.push({ ...l, at: st.time + 1.4, text: `Um... ${l.text}` }); call.asked.landmark = (call.asked.landmark ?? 0) + 1; reply = ''; }
      }
      if (reply) reply = this.qpick(call, inc.category === 'fire' ? ['The street lamp. A red car. People in dressing gowns. Smoke. My shoes. ...Okay. Okay.', 'Our front gate, the bins, the neighbour\'s van... okay, I\'m a bit calmer.'] : ['The clock, the sofa, {his} glasses on the floor, the window, the rug... okay. Okay.', 'Um — a lamp, a picture of us, the TV, my phone, my hands. ...Okay, I\'m here.']);
    }
    if (reply) call.pending.push({ at: st.time + 1.2 + reply.length * 0.015, text: fill(reply, inc.vars) });
    call.lastCalm = { at: st.time, kind, eff, d: Math.round(before - m.panic) };
    call.panicSince = null;
    st.stats.calmActions = (st.stats.calmActions ?? 0) + 1;
    if (tier === 'good') st.stats.calmGood = (st.stats.calmGood ?? 0) + 1;
    return { ok: true, eff, d: Math.round(before - m.panic) };
  }

  /** jobs the dispatcher can give this caller while help is on the way */
  callTasks(callId: string): Array<{ id: string; label: string; say: string; dur: number; status?: 'doing' | 'done' }> {
    const st = this.state;
    const call = st.calls[callId];
    if (!call) return [];
    const inc = st.incidents[call.incidentId];
    if (!inc || inc.truth.outside || call.profile.archetype === 'silent') return [];
    const t = inc.truth, tid = inc.templateId, cat = inc.category;
    const self = inc.vars.self === '1';
    const hiding = HIDING.has(tid);
    const out: Array<{ id: string; label: string; say: string; dur: number }> = [];
    const add = (id: string, label: string, say: string, dur: number) => out.push({ id, label, say, dur });
    const injured = Number(t.injured ?? 0) > 0 || cat === 'medical';
    if (hiding) {
      add('lockin', 'Lock yourself in a room', 'Get into a room with a lock, lock it, turn your phone to silent and keep low and quiet.', 4);
      if (t.suspect === true) add('describe', 'Describe what you can see', 'Only if you are safe: tell me exactly what you can see — who, what they are wearing, which way they go.', 8);
      add('unlock', 'Unlock the front door for the crew', 'When you can, unlock the front door so the officers can get in.', 7);
      add('wave', 'Go out and wave the crew in', 'Go outside and wave the officers in when you see them.', 6);
    } else if (cat === 'fire' || ['gas_leak', 'carbon_monoxide', 'power_line_down', 'tanker_fire'].includes(tid)) {
      add('distance', 'Move everyone well back', 'Get everyone across the street, well back from the building, and keep them there.', 6);
      add('headcount', 'Count everyone — anyone missing?', 'Count everyone who came out. Is anybody missing? Think about every flat.', 8);
      add('wave', 'Wave the fire engines in', 'Send someone to the end of the street to wave the fire engines in.', 6);
    } else if (tid.startsWith('collision')) {
      add('hazards', 'Hazards on, everyone behind the barrier', 'Put your hazard lights on and get everyone off the road, behind the barrier.', 5);
      if (injured) add('blanket', 'Keep the injured warm', "Put a coat or a blanket over anyone who's hurt and keep them still.", 5);
      add('wave', 'Wave the crews in', 'Have someone safe stand back from the road and wave the crews in.', 6);
    } else {
      if (injured && !self) {
        add('blanket', 'Keep them warm', 'Put a blanket or a coat over {him} and keep {him} warm.', 5);
        if (inc.lifeThreat !== 'arrest') add('breaths', 'Count their breaths for me', "Watch {his} chest and count {his} breaths for thirty seconds. Tell me what you get.", 10);
        add('meds', 'Gather their medications', "Find any medication {he} takes and put it in a bag for the crew — and any hospital letters.", 10);
        add('clear', 'Clear a path to them', 'Move any furniture so the crew can get a stretcher right to {him}.', 8);
      }
      add('unlock', 'Unlock the front door', 'Unlock the front door and leave it on the latch for the crew.', 7);
      add('light', 'Turn the outside light on', 'Turn on the outside light so the crew can find the house.', 5);
      add('pets', 'Shut any pets away', 'If you have any pets, shut them in another room so they don\'t get in the way.', 6);
    }
    return out.slice(0, 8).map((x) => ({ ...x, label: fill(x.label, inc.vars), say: fill(x.say, inc.vars), status: call.tasks?.find((k) => k.id === x.id)?.status }));
  }
  assignTask(callId: string, taskId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return { ok: false, reason: 'No active call' };
    const task = this.callTasks(callId).find((x) => x.id === taskId);
    if (!task) return { ok: false, reason: 'That job does not fit this call' };
    if (task.status) return { ok: false, reason: task.status === 'done' ? 'Already done' : 'They are doing that now' };
    if ((call.tasks ?? []).some((x) => x.status === 'doing')) return { ok: false, reason: "They're still busy with the last job" };
    if (call.profile.language && call.interpreter !== 'on') return { ok: false, reason: "They don't understand you yet — get an interpreter" };
    const inc = st.incidents[call.incidentId];
    this.addTranscript(call, 'DISPATCHER', task.say);
    const slow = ARCHETYPES[call.profile.archetype]?.slow ? 1.4 : 1;
    (call.tasks ??= []).push({ id: task.id, label: task.label, status: 'doing', at: st.time, doneAt: st.time + task.dur * slow });
    const m = call.mood;
    m.panic = Math.max(0, m.panic - 6); m.base = Math.max(0, m.base - 4);
    call.pending.push({ at: st.time + 1.1, text: this.qpick(call, ["Okay. Okay, I'm doing it now.", "Right — I'll do that now. Don't hang up.", 'Okay, give me a second.', 'On it.']) });
    void inc;
    return { ok: true };
  }
  private finishTask(call: Call, inc: Incident, task: import('./types').CallTask) {
    const st = this.state, t = inc.truth, m = call.mood;
    task.status = 'done';
    st.stats.tasksDone = (st.stats.tasksDone ?? 0) + 1;
    (inc.prep ??= []).push(task.id);
    m.panic = Math.max(0, m.panic - 5);
    const hiding = HIDING.has(inc.templateId);
    const say = (text: string) => { if (call.state === 'active') call.pending.push({ at: st.time + 0.3, text: fill(text, inc.vars) }); };
    switch (task.id) {
      case 'light': inc.guided = true; say("The outside light's on. You can't miss it now."); break;
      case 'wave':
        if (hiding) { say("I'm outside — oh God, he's here, he's coming over—"); this.applyAid(inc, call, { kind: 'confront', fit: 'bad' }); break; }
        inc.guided = true; say(this.qpick(call, ["My son's at the end of the drive waving his arms.", "There's a man from next door out on the corner, waving.", "I've sent someone out to the road to wave them in."]));
        break;
      case 'unlock':
        if (hiding) { say("I've unlocked it — wait, the door's moving— he's coming in—"); this.applyAid(inc, call, { kind: 'confront', fit: 'bad' }); break; }
        inc.accessNeeded = inc.accessNeeded ? { ...inc.accessNeeded, relayed: true } : null;
        say("Front door's unlocked. I've left it open a crack.");
        break;
      case 'pets': inc.petsSecured = true; say("I've shut the dog in the bedroom."); break;
      case 'meds': inc.work *= 0.85; say(this.qpick(call, ["I've got all {his} tablets in a bag — there's a lot of them.", "Got them. Blood pressure pills and an inhaler, and {his} hospital letters."])); break;
      case 'blanket': if (inc.survival !== undefined) inc.survival = Math.min(100, inc.survival + 4); m.panic = Math.max(0, m.panic - 4); say("I've put my coat over {him}. {He}'s shivering but {he}'s warmer."); break;
      case 'clear': inc.work *= 0.9; say("I've pushed the table and chairs out of the way. There's a clear path now."); break;
      case 'breaths': {
        this.addFact(inc, 'breathing', t.breathing ?? true, 'confirmed', 'caller');
        if (t.conscious !== undefined) this.addFact(inc, 'conscious', t.conscious, 'confirmed', 'caller');
        say(t.breathing === false ? "I can't see {his} chest moving at all! I don't think {he}'s breathing!" : this.qpick(call, ['About seven in thirty seconds... is that slow?', 'Twelve, maybe? Fast and a bit shallow.']));
        break;
      }
      case 'headcount': {
        for (const k of ['people', 'trapped']) if (k in t) this.addFact(inc, k, t[k], 'confirmed', 'caller');
        if (Number(t.trapped ?? 0) > 0) { inc.knownReqs = inc.requires.map((r) => ({ ...r })); say("Oh God — the lady from the top floor isn't here! She's still inside!"); }
        else say("Everyone's out. I counted twice — everybody's here.");
        break;
      }
      case 'distance': this.applyAid(inc, call, { kind: 'evacuate', fit: 'good' }); inc.safetyAdvised = true; say("We're all across the road now, well back."); break;
      case 'describe': {
        if (t.suspect === true && t.suspect_desc) { this.addFact(inc, 'suspect_desc', t.suspect_desc, 'confirmed', 'caller'); if ('weapon' in t) this.addFact(inc, 'weapon', t.weapon, 'unconfirmed', 'caller'); say(`(whispering) It's ${t.suspect_desc}.${t.weapon && t.weapon !== 'none' ? ' I think he has something in his hand.' : ''}`); }
        else say("(whispering) I can't see anyone now.");
        break;
      }
      case 'lockin': this.applyAid(inc, call, { kind: 'lock', fit: 'good' }); inc.safetyAdvised = true; say("(whispering) I'm in the bathroom. It's locked."); break;
      case 'hazards': inc.threat = Math.max(0, inc.threat - 10); inc.safetyAdvised = true; say("Hazards are on, we're all behind the barrier."); break;
    }
  }

  // ── Firefighter MAYDAY ────────────────────────────────────────────────────
  private mayday(u: Unit, inc: Incident, late: boolean) {
    const st = this.state;
    st.stats.maydays = (st.stats.maydays ?? 0) + 1;
    inc.maydayLate = late;
    this.radio(u.spoken, `MAYDAY, MAYDAY, MAYDAY! ${u.spoken} — firefighter down, second floor, low on air!`, 'alert', u.id, inc.id);
    this.notify(`MAYDAY — firefighter down at ${inc.label}${late ? ' (the PAR check was overdue)' : ''}`, 'bad', inc.id);
    this.fx('bad', inc.reportedNode ?? inc.nodeId, 'MAYDAY');
    (st.decisions ??= []).push({
      id: `d${st.decisions.length + 1}-m${Math.floor(st.time)}`, incId: inc.id, unitId: u.id, at: st.time, expiresAt: st.time + 18, kind: 'mayday',
      prompt: `${u.spoken}: MAYDAY — a firefighter is down inside. What do you want?`,
      options: [{ id: 'rit', label: 'Send a rapid intervention team', hint: 'The nearest free engine goes in after them' }, { id: 'evac', label: 'Everyone out — go defensive', hint: 'Crews drag their colleague out and stop fighting from inside' }, { id: 'wait', label: 'Stand by for an update', hint: 'Leave it to the crew already inside' }],
      defaultId: 'wait',
    });
    this.emit({ type: 'alert', text: 'MAYDAY', incId: inc.id, cine: 'mayday' });
  }
  private decideMayday(d: Decision, optionId: string, auto: boolean): { ok: boolean; outcome?: string } {
    const st = this.state;
    const inc = st.incidents[d.incId], u = st.units[d.unitId];
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) { d.outcome = 'The incident was already over.'; return { ok: true, outcome: d.outcome }; }
    if (u) this.radio(auto ? u.spoken : 'DISPATCH', auto ? 'No word from dispatch — we\'re working the MAYDAY ourselves.' : `${u.spoken}, ${d.options.find((o) => o.id === optionId)?.label.toLowerCase()}.`, auto ? 'unit' : 'dispatch', u.id, inc.id);
    let p = 0.4;
    if (optionId === 'rit') {
      const rit = Object.values(st.units).filter((x) => x.service === 'fire' && !isAir(x) && ['AVAILABLE', 'RETURNING'].includes(x.status) && !x.assignedIncidentId && this.canDispatch(x, inc).ok)
        .map((x) => ({ x, eta: this.estimate(x.id, inc.reportedNode ?? inc.nodeId)?.eta ?? Infinity })).sort((a, b) => a.eta - b.eta)[0];
      if (rit && isFinite(rit.eta)) { this.dispatch(rit.x.id, inc.id, { code: 3 }); p = rit.eta < 60 ? 0.9 : rit.eta < 120 ? 0.72 : 0.5; }
      else p = 0.35;
    } else if (optionId === 'evac') { p = 0.75; inc.work *= 1.25; inc.threat = Math.min(99, inc.threat + 10); }
    if (inc.maydayLate) p -= 0.2;
    if (this.rng.chance(Math.max(0.05, p))) {
      st.stats.maydaySaved = (st.stats.maydaySaved ?? 0) + 1;
      d.outcome = optionId === 'rit' ? 'The rescue team pulled the firefighter out — conscious and breathing.' : 'The crew dragged their colleague out. Shaken, but alive.';
      if (u) this.radio(u.spoken, 'Dispatch, firefighter is out and breathing. Cancel the MAYDAY.', 'unit', u.id, inc.id);
      this.fx('good', inc.reportedNode ?? inc.nodeId, 'Firefighter out');
    } else {
      d.outcome = 'A firefighter was badly hurt before anyone could reach them.';
      this.consequence(inc, `A firefighter was badly hurt in a MAYDAY${inc.maydayLate ? ' after the PAR check was overdue' : ''}`);
      st.reputation = Math.max(0, st.reputation - 2);
      if (u) { this.detach(u, true); u.status = 'OUT_OF_SERVICE'; u.note = 'Firefighter injured'; u.timer = 300; u.route = []; for (const p2 of this.crewOf(u)) p2.morale = Math.max(10, p2.morale - 20); }
      this.headline(`Firefighter seriously injured battling ${inc.label.toLowerCase()}`, 'bad');
    }
    return { ok: true, outcome: d.outcome };
  }

  // ── Patients who refused care ─────────────────────────────────────────────
  private updateRelapses() {
    const st = this.state;
    if (!st.relapses?.length) return;
    const due = st.relapses.filter((r) => st.time >= r.at);
    if (!due.length) return;
    st.relapses = st.relapses.filter((r) => st.time < r.at);
    for (const r of due) {
      const prev = st.incidents[r.incId];
      if (!prev) continue;
      const again = this.spawnIncident('sudden_illness', prev.district, { nodeId: prev.nodeId, accuracy: 'exact', severity: Math.min(5, prev.severity + 1) });
      again.label = 'Collapsed after refusing care';
      this.consequence(prev, 'The patient who signed a refusal collapsed later and needed a second response');
      this.notify('A patient who refused transport earlier has collapsed — new call incoming', 'bad', again.id);
    }
  }

  // ── Non-emergency calls ───────────────────────────────────────────────────
  /** send a caller to the non-emergency line (or the press office): right for non-emergencies, very wrong for a real one */
  redirectCall(callId: string): { ok: boolean; reason?: string; good?: boolean } {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return { ok: false, reason: 'No active call' };
    const inc = st.incidents[call.incidentId];
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    const hiddenTwist = !!inc.twist && !inc.twistRevealed;
    const nonEm = !!tpl.nonEmergency || (inc.requires.length === 0 && inc.truth.false_alarm === true && !hiddenTwist);
    this.addTranscript(call, 'DISPATCHER', inc.templateId === 'press_call' ? "I can't give out any details on this line. Please contact the city press office — they'll be issuing a statement." : "This line is for emergencies — I'm putting you through to the non-emergency line, they'll help you with this.");
    const reg = inc.regular ? (st.regularLog ?? []).find((r) => r.incId === inc.id) : null;
    if (reg) reg.outcome = regularOutcome(inc, 'redirected');
    if (inc.regular?.real) this.consequence(inc, `${inc.callerName} has called a hundred times about nothing — this time it was real, and they were sent to the non-emergency line`);
    if (nonEm) {
      st.stats.redirectsOk = (st.stats.redirectsOk ?? 0) + 1;
      const b = 80; st.stats.bonus += b; st.budget += b;
      inc.dismissed = true;
      this.endCall(callId, 'redirected');
      this.closeIncident(inc, 'false_alarm', true);
      this.fx('good', inc.reportedNode ?? inc.nodeId, 'Line freed');
      return { ok: true, good: true };
    }
    st.stats.redirectsBad = (st.stats.redirectsBad ?? 0) + 1;
    st.reputation = Math.max(0, st.reputation - 2);
    this.consequence(inc, 'A real emergency was sent to the non-emergency line');
    this.endCall(callId, 'redirected');
    this.loseIncident(inc, 'Redirected to the non-emergency line');
    this.notify(`That was a real emergency — ${inc.label}. They will call back, and it will be worse.`, 'bad', inc.id);
    return { ok: true, good: false };
  }

  // ── Listening to the line ─────────────────────────────────────────────────
  /** sounds that carry from where the caller really is (worked out once per call) */
  soundscape(callId: string): string[] {
    const st = this.state, city = this.city;
    const call = st.calls[callId];
    if (!call) return [];
    if (call.env) return call.env;
    const inc = st.incidents[call.incidentId];
    const n = city.nodes[inc.nodeId];
    const near = (kinds: string[], r: number) => city.landmarks.some((l) => kinds.includes(l.kind) && Math.hypot(city.nodes[l.nodeId].x - n.x, city.nodes[l.nodeId].y - n.y) < r);
    const tags = city.districtById[n.district]?.tags ?? [];
    const out: string[] = [];
    if (n.j >= 19 && n.j <= 22) out.push('train');
    if (tags.includes('harbor')) out.push('harbor');
    else if (Math.min(...city.riverline.map((p) => Math.hypot(p.x - n.x, p.y - n.y))) < 70) out.push('water');
    if (tags.includes('airport') || near(['airport', 'terminal'], 260)) out.push('jets');
    if (near(['cathedral', 'clocktower'], 150)) out.push('bells');
    if (near(['campus', 'school', 'library'], 130)) out.push('school');
    if (near(['stadium', 'plaza', 'market'], 130)) out.push('crowd');
    if (near(['hospital'], 120)) out.push('hospital');
    if (city.adj[n.id].some((e) => city.edges[e].cls === 'highway')) out.push('highway');
    if (tags.includes('industrial')) out.push('industrial');
    if (tags.includes('forest')) out.push('birds');
    if (tags.some((t) => ['commercial', 'dense', 'highrise'].includes(t))) out.push('traffic');
    if (tags.some((t) => ['residential', 'suburb'].includes(t))) out.push('suburb');
    if (!out.length) out.push('traffic');
    call.env = out.slice(0, 3);
    return call.env;
  }
  /** listen hard to the background: where they are, and sometimes what is going on */
  listen(callId: string): { ok: boolean; reason?: string; kinds?: string[] } {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return { ok: false, reason: 'No active call' };
    if (call.text) return { ok: false, reason: 'This is a text session — there is nothing to hear' };
    if (st.time - (call.listenedAt ?? -99) < 12) return { ok: false, reason: 'Give it a moment — keep listening' };
    call.listenedAt = st.time;
    st.stats.listens = (st.stats.listens ?? 0) + 1;
    const inc = st.incidents[call.incidentId];
    const env = this.soundscape(callId);
    const heard = new Set(call.heardSounds ?? []);
    const fresh = env.filter((k) => !heard.has(k));
    const kinds = (fresh.length ? fresh : env).slice(0, 2);
    if ((st.weather === 'rain' || st.weather === 'storm') && !heard.has('rain')) kinds.push('rain');
    if (inc.category === 'fire' && STRUCTURE_FIRES.has(inc.templateId) && !heard.has('alarm')) kinds.push('alarm');
    for (const k of kinds) heard.add(k);
    call.heardSounds = [...heard];
    this.addTranscript(call, 'SYSTEM', `You listen closely: ${kinds.map((k) => SOUND_CLUES[k]).join('; ')}.`);
    return { ok: true, kinds };
  }

  // ── Escalation forecast ───────────────────────────────────────────────────
  /** what happens next if the response stays as it is, and roughly when */
  escalationForecast(incId: string): { next: string | null; eta: number | null; rising: boolean } {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status) || inc.requires.length === 0) return { next: null, eta: null, rising: false };
    const tpl = TEMPLATE_BY_ID[inc.templateId];
    const esc = tpl.escalate?.[inc.stage];
    const next = inc.stage >= inc.maxStage ? 'The incident fails — people get hurt' : esc ? esc.text : null;
    const here = this.onScene(inc);
    const cov = matchCoverage(inc.requires, here);
    const eff = here.length ? here.reduce((a, u) => a + this.unitEffectiveness(u), 0) / here.length : 1;
    const rate = inc.growth * this.aidFactor(inc) * (1 - cov.f) - inc.clear * eff * cov.f * cov.f * 0.35;
    return { next, eta: rate > 0.001 ? Math.max(0, (100 - inc.threat) / rate) : null, rising: rate > 0.001 };
  }

  // ── Crews asking dispatch for information ─────────────────────────────────
  private static QUERY_TEXT: Record<string, string[]> = {
    weapon: ['any weapons involved?', 'do we know if anyone is armed?'], suspect_desc: ['do we have a description of the suspect?', "what's our suspect wearing?"],
    people: ['how many people are we dealing with?', 'how many involved?'], trapped: ['is anyone still inside?', 'any reports of people trapped?'],
    hazard: ['any hazards on scene — gas, chemicals, cylinders?', 'anything dangerous we should know about?'], age: ["what's the patient's age?", 'how old is the patient?'],
    conscious: ['is the patient conscious?', 'is the patient awake and talking?'], breathing: ['is the patient breathing?', 'do we know if they are breathing?'],
    vehicles: ['how many vehicles involved?'], injured: ['how many injured?', 'how many patients do we have?'],
  };
  private queryKeys(inc: Incident): string[] {
    const tid = inc.templateId, cat = inc.category;
    const keys = tid.startsWith('collision') ? ['injured', 'trapped', 'vehicles'] : cat === 'police' ? ['weapon', 'suspect_desc', 'people'] : cat === 'fire' ? ['trapped', 'hazard', 'people'] : cat === 'medical' ? ['conscious', 'breathing', 'age'] : ['people', 'hazard'];
    return keys.filter((k) => k in inc.truth);
  }
  /** randomness from the clock and an id: for side systems that must not shift the simulation's own random stream */
  private hrand(id: number, salt: number): number {
    let h = Math.imul(id + 0x9e3779b9, 2654435761) ^ Math.imul(Math.floor(this.state.time * 2) + salt * 7919, 0x85ebca6b);
    h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  private unitQueriesTick() {
    const st = this.state;
    if (st.config.mode === 'tutorial' || st.config.script) return;
    for (const q of st.unitQueries ?? []) {
      if ((q.status === 'open' || q.status === 'standby') && st.time >= q.expiresAt) {
        q.status = 'expired';
        st.stats.unitQueriesMissed = (st.stats.unitQueriesMissed ?? 0) + 1;
        const u = st.units[q.unitId], inc = st.incidents[q.incId];
        if (inc && !['RESOLVED', 'CLOSED'].includes(inc.status)) { inc.work *= 1.05; if (u) this.radio(u.spoken, this.hrand(inc.num, 3) < 0.5 ? 'Copy, nothing from dispatch — going in blind.' : "No answer. We'll find out when we get there.", 'unit', u.id, inc.id); }
      }
    }
    for (const inc of Object.values(st.incidents)) {
      if (['RESOLVED', 'CLOSED'].includes(inc.status) || inc.hidden || inc.onView || inc.pursuit || inc.requires.length === 0 || (inc.queries ?? 0) >= 2) continue;
      if ((st.unitQueries ?? []).some((q) => q.incId === inc.id && (q.status === 'open' || q.status === 'standby'))) continue;
      const u = inc.assignedUnits.map((id) => st.units[id]).find((x) => x && x.status === 'EN_ROUTE' && !isAir(x) && (x.eta ?? 0) > 15 && (x.eta ?? 0) < 90);
      if (!u || this.hrand(inc.num, 1) >= 0.045) continue;
      const asked = new Set((st.unitQueries ?? []).filter((q) => q.incId === inc.id).map((q) => q.key));
      const key = this.queryKeys(inc).find((k) => !asked.has(k));
      if (!key) { inc.queries = 2; continue; }
      inc.queries = (inc.queries ?? 0) + 1;
      const opts = GameEngine.QUERY_TEXT[key] ?? ['anything else we should know?'];
      const text = opts[Math.floor(this.hrand(inc.num, 2) * opts.length)];
      (st.unitQueries ??= []).push({ id: `uq${st.unitQueries.length + 1}`, unitId: u.id, incId: inc.id, key, text, at: st.time, expiresAt: st.time + 30, status: 'open' });
      st.stats.unitQueries = (st.stats.unitQueries ?? 0) + 1;
      this.radio(u.spoken, `Dispatch, ${u.spoken} — ${text}`, 'unit', u.id, inc.id);
    }
  }
  /** a crew asks dispatch a follow-up right now (used when you talk to them on the radio) */
  crewAsks(unitId: string): boolean {
    const st = this.state;
    const u = st.units[unitId];
    const inc = u?.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
    if (!u || !inc || ['RESOLVED', 'CLOSED'].includes(inc.status) || inc.requires.length === 0) return false;
    if ((st.unitQueries ?? []).some((q) => q.incId === inc.id && (q.status === 'open' || q.status === 'standby'))) return false;
    const asked = new Set((st.unitQueries ?? []).filter((q) => q.incId === inc.id).map((q) => q.key));
    const key = this.queryKeys(inc).find((k) => !asked.has(k));
    if (!key) return false;
    inc.queries = (inc.queries ?? 0) + 1;
    const opts = GameEngine.QUERY_TEXT[key] ?? ['anything else we should know?'];
    const text = opts[Math.floor(this.hrand(inc.num, 9) * opts.length)];
    (st.unitQueries ??= []).push({ id: `uq${st.unitQueries.length + 1}`, unitId: u.id, incId: inc.id, key, text, at: st.time, expiresAt: st.time + 35, status: 'open' });
    st.stats.unitQueries = (st.stats.unitQueries ?? 0) + 1;
    this.radio(u.spoken, `Also, dispatch — ${text}`, 'unit', u.id, inc.id);
    return true;
  }
  /** what dispatch can tell the crew: the caller's answer if there is one */
  queryOptions(queryId: string): { known: { label: string; value: string } | null; canDeny: boolean } {
    const st = this.state;
    const q = st.unitQueries?.find((x) => x.id === queryId);
    const inc = q ? st.incidents[q.incId] : undefined;
    if (!q || !inc) return { known: null, canDeny: false };
    const f = [...inc.facts].reverse().find((x) => x.key === q.key && x.confidence !== 'contradicted');
    const v = (x: unknown) => (typeof x === 'boolean' ? (x ? 'yes' : 'no') : String(x));
    return { known: f ? { label: f.label, value: v(f.value) } : null, canDeny: ['weapon', 'trapped', 'hazard'].includes(q.key) };
  }
  answerUnitQuery(queryId: string, mode: 'relay' | 'deny' | 'standby'): { ok: boolean; reason?: string; correct?: boolean } {
    const st = this.state;
    const q = st.unitQueries?.find((x) => x.id === queryId);
    if (!q || (q.status !== 'open' && q.status !== 'standby')) return { ok: false, reason: 'Already answered' };
    const inc = st.incidents[q.incId], u = st.units[q.unitId];
    if (!inc) return { ok: false, reason: 'Incident gone' };
    if (mode === 'standby') {
      if (q.status === 'standby') return { ok: false, reason: 'Already on standby' };
      q.status = 'standby'; q.expiresAt = st.time + 40;
      this.radio('DISPATCH', `${u?.spoken ?? 'Unit'}, stand by — I'm finding out from the caller.`, 'dispatch', u?.id, inc.id);
      return { ok: true };
    }
    const truth = inc.truth[q.key];
    const truthy = (x: unknown) => x !== undefined && x !== false && x !== 0 && x !== 'none' && x !== null;
    let said: string, correct: boolean;
    if (mode === 'relay') {
      const o = this.queryOptions(queryId).known;
      if (!o) return { ok: false, reason: 'You do not know that yet — ask the caller' };
      said = `${o.label}: ${o.value}`;
      const f = [...inc.facts].reverse().find((x) => x.key === q.key && x.confidence !== 'contradicted')!;
      correct = typeof truth === 'number' && typeof f.value === 'number' ? truth === f.value : typeof truth === 'boolean' || typeof f.value === 'boolean' ? truthy(truth) === truthy(f.value) : String(truth) === String(f.value) || (truthy(truth) && truthy(f.value));
    } else {
      said = q.key === 'weapon' ? 'no weapons reported' : q.key === 'trapped' ? 'nobody inside as far as we know' : 'no hazards reported';
      correct = !truthy(truth);
    }
    q.status = 'answered'; q.said = said; q.correct = correct;
    this.radio('DISPATCH', `${u?.spoken ?? 'Units'}, ${said}.`, 'dispatch', u?.id, inc.id);
    if (u) this.radio(u.spoken, 'Copy.', 'unit', u.id, inc.id);
    if (correct) {
      st.stats.unitQueriesOk = (st.stats.unitQueriesOk ?? 0) + 1;
      inc.work *= 0.93;
      if (q.key === 'weapon' && truthy(truth)) inc.weaponRelayed = true;
      if (q.key === 'trapped' && truthy(truth)) inc.knownReqs = inc.requires.map((r) => ({ ...r }));
    } else {
      if (q.key === 'weapon' && truthy(truth)) { inc.weaponMissed = true; this.consequence(inc, 'Officers were told there was no weapon — there was'); }
      else if (q.key === 'trapped' && truthy(truth)) { inc.threat = Math.min(99, inc.threat + 15); this.consequence(inc, 'Crews were told nobody was inside — someone was'); }
      else if (q.key === 'hazard' && truthy(truth)) { inc.threat = Math.min(99, inc.threat + 12); this.consequence(inc, 'Crews walked into a hazard nobody warned them about'); }
      else { inc.work *= 1.08; this.consequence(inc, `Crews were given the wrong ${q.key === 'suspect_desc' ? 'description' : q.key}`); }
    }
    return { ok: true, correct };
  }

  // ── Outside agencies ──────────────────────────────────────────────────────
  /** crews on scene ask for a tow truck, a utility or animal control */
  private requestAgency(inc: Incident, u: Unit) {
    const kind = AGENCY_FOR[inc.templateId];
    if (!kind || inc.onView || inc.requires.length === 0) return;
    if (inc.agency) { if (inc.agency.askedAt === null) inc.agency.askedAt = this.state.time; return; }
    if (!this.rng.chance(0.85)) return;
    inc.agency = { kind, askedAt: this.state.time, calledAt: null, arriveAt: null, here: false, nagged: 0 };
    this.radio(u.spoken, `Dispatch, ${u.spoken}. ${this.rng.pick(AGENCY[kind].ask)}`, 'unit', u.id, inc.id);
    this.notify(`${u.callsign} needs a ${AGENCY[kind].name.toLowerCase()} — call one from the incident card`, 'warn', inc.id);
  }
  /** what outside agency this incident could use (whether or not the crew has asked yet) */
  agencyFor(inc: Incident): AgencyKind | null { return inc.agency?.kind ?? AGENCY_FOR[inc.templateId] ?? null; }
  callAgency(incId: string): { ok: boolean; reason?: string; eta?: number } {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) return { ok: false, reason: 'Incident closed' };
    const kind = this.agencyFor(inc);
    if (!kind) return { ok: false, reason: 'No outside agency needed here' };
    if (inc.reportedNode === null) return { ok: false, reason: 'Set the incident location first' };
    if (inc.agency?.calledAt != null) return { ok: false, reason: `${AGENCY[kind].name} already called` };
    const a = AGENCY[kind];
    const night = st.timeOfDay % 24 >= 21 || st.timeOfDay % 24 < 5;
    const eta = Math.round(this.rng.range(a.eta[0], a.eta[1]) * (night ? 1.25 : 1) * (st.weather === 'storm' || st.weather === 'snow' ? 1.3 : 1));
    inc.agency = { ...(inc.agency ?? { kind, askedAt: null, here: false, nagged: 0 }), kind, calledAt: st.time, arriveAt: st.time + eta };
    st.budget -= a.cost; st.stats.costs += a.cost;
    st.stats.agencyCalls = (st.stats.agencyCalls ?? 0) + 1;
    this.radio('DISPATCH', `Units at INC-${String(inc.num).padStart(4, '0')}, ${a.name.toLowerCase()} is on the way, about ${Math.max(1, Math.round(eta / 60))} minute${Math.round(eta / 60) > 1 ? 's' : ''}.`, 'dispatch', undefined, inc.id);
    return { ok: true, eta };
  }
  private agencyHolds(inc: Incident): boolean { return !!inc.agency && inc.agency.askedAt !== null && !inc.agency.here; }
  private updateAgencies() {
    const st = this.state;
    for (const inc of Object.values(st.incidents)) {
      const a = inc.agency;
      if (!a || a.here || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
      const def = AGENCY[a.kind];
      if (a.arriveAt !== null && st.time >= a.arriveAt) {
        a.here = true;
        this.radio(def.name, `${def.name} on scene at ${addressOf(this.city, inc.reportedNode ?? inc.nodeId)}.`, 'chatter', undefined, inc.id);
        this.fx('info', inc.reportedNode ?? inc.nodeId, `${def.short} on scene`);
        continue;
      }
      if (a.calledAt !== null || a.askedAt === null) continue;
      const here = this.onScene(inc)[0];
      const waited = st.time - a.askedAt;
      if (waited > 120) {
        // crews end up phoning it in themselves, later than if dispatch had done it
        a.calledAt = st.time; a.arriveAt = st.time + this.rng.range(def.eta[0], def.eta[1]) + 40; a.late = true;
        st.stats.agencyLate = (st.stats.agencyLate ?? 0) + 1;
        this.consequence(inc, `Crews waited two minutes for someone to call the ${def.name.toLowerCase()}`);
        if (here) this.radio(here.spoken, `Dispatch, ${here.spoken}. Never mind, we've called the ${def.name.toLowerCase()} ourselves.`, 'unit', here.id, inc.id);
      } else if (waited > 45 + a.nagged * 35 && a.nagged < 2 && here) {
        a.nagged++;
        this.radio(here.spoken, `Dispatch, ${here.spoken}. Any update on that ${def.name.toLowerCase()}?`, 'unit', here.id, inc.id);
      }
    }
  }

  // ── Specialists: federal tactical team and National Guard EOD ─────────────
  specialistFor(inc: Incident): SpecialistKind | null {
    if (SPECIALIST_FOR[inc.templateId]) return SPECIALIST_FOR[inc.templateId];
    if (inc.requires.some((r) => r.cap === 'eod')) return 'eod';
    return null;
  }
  /** crews on scene tell dispatch what they are up against */
  private askSpecialist(inc: Incident, u: Unit) {
    const st = this.state;
    const kind = this.specialistFor(inc);
    if (!kind || inc.specialists?.[kind] || inc.specialistAsked?.[kind] !== undefined || u.service !== 'police' && kind === 'federal') return;
    const needEod = kind === 'eod' && inc.requires.some((r) => r.cap === 'eod') && !this.onScene(inc).some((x) => x.capabilities.includes('eod'));
    const needFed = kind === 'federal' && inc.severity >= 5 && !this.onScene(inc).some((x) => x.type === 'federal_tactical');
    if (!needEod && !needFed) return;
    (inc.specialistAsked ??= {})[kind] = st.time;
    this.radio(u.spoken, `Dispatch, ${u.spoken}. ${this.rng.pick(SPECIALIST[kind].ask)}`, 'alert', u.id, inc.id);
    this.notify(`${u.callsign}: ${kind === 'eod' ? 'bomb technicians needed' : 'recommends the federal tactical team'} — request it on the radio`, 'warn', inc.id);
  }
  /** call in the federal team or National Guard bomb technicians; they mobilise, then drive in from the city limits */
  requestSpecialist(incId: string, kind: SpecialistKind): { ok: boolean; reason?: string; eta?: number } {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) return { ok: false, reason: 'Incident closed' };
    if (inc.reportedNode === null) return { ok: false, reason: 'Set the incident location first' };
    if (inc.specialists?.[kind]) return { ok: false, reason: `${SPECIALIST[kind].name} already requested` };
    if (this.specialistFor(inc) !== kind) return { ok: false, reason: kind === 'eod' ? 'No suspected device here' : 'Federal teams only respond to the most serious armed threats' };
    const sp = SPECIALIST[kind];
    const def = UNIT_TYPE_BY_ID[sp.unitType];
    const n = this.city.nodes[inc.reportedNode];
    const edgeNodes = this.city.nodes.filter((x) => (x.i === 0 || x.i === 40 || x.j === 0) && this.city.adj[x.id].length);
    let best = edgeNodes[0], bd = Infinity;
    for (const e of edgeNodes) { const d = Math.hypot(e.x - n.x, e.y - n.y); if (d < bd) { bd = d; best = e; } }
    const station: Station = { id: 'outside', name: sp.name, service: def.service, nodeId: best.id, district: best.district, capacity: 99, disabledShifts: 0 };
    const k = (st.stats.specialistCalls ?? 0) + 1;
    const idn = 9500 + Object.keys(st.units).length + st.uniqueNameCounter++;
    const u = makeUnit(def, station, Object.values(st.units), idn);
    u.id = `sp${idn}`; u.callsign = `${sp.short}-${k}`; u.spoken = `${sp.spoken} ${numWord(k)}`;
    u.temp = true; u.minCrew = 0; u.stationId = 'outside'; u.speedModifier = def.speed; u.postNode = best.id;
    const night = st.timeOfDay % 24 >= 21 || st.timeOfDay % 24 < 5;
    u.timer = Math.round(this.rng.range(sp.mobilise[0], sp.mobilise[1]) * (night ? 1.2 : 1));
    st.units[u.id] = u;
    (inc.specialists ??= {})[kind] = { at: st.time, unitId: u.id, asked: inc.specialistAsked?.[kind] };
    st.budget -= sp.cost; st.stats.costs += sp.cost;
    st.stats.specialistCalls = k;
    this.dispatch(u.id, inc.id, { code: 3 });
    const eta = u.timer + (u.eta ?? 0);
    this.radio('DISPATCH', `${sp.name}, Ravenport dispatch. Requesting immediate response to ${addressOf(this.city, inc.reportedNode)} — ${inc.label.toLowerCase()}.`, 'dispatch', u.id, inc.id);
    this.radio(sp.name, kind === 'eod' ? `Ravenport, Guard EOD copies. Team is loading the robot now — wheels rolling in about ${Math.max(1, Math.round(u.timer / 60))} minute${Math.round(u.timer / 60) > 1 ? 's' : ''}.` : `Ravenport, federal team copies. We are mobilising — expect us in about ${Math.max(1, Math.round(eta / 60))} minutes. Hold the perimeter, do not engage unless you have to.`, 'unit', u.id, inc.id);
    this.radio('DISPATCH', `Units at INC-${String(inc.num).padStart(4, '0')}, ${sp.name.toLowerCase()} has been requested. Hold the cordon.`, 'dispatch', undefined, inc.id);
    this.notify(`${sp.name} requested (−$${sp.cost.toLocaleString()})`, 'info', inc.id);
    this.log('dispatch', `${sp.name} requested for ${inc.label}`, { incidentId: inc.id, good: true });
    this.emit({ type: 'alert', text: 'Specialist requested' });
    return { ok: true, eta };
  }
  // ── Stations: prisoners, the workshop and walk-ins ───────────────────────
  stationAt(node: number): Station | undefined { return Object.values(this.state.stations).find((s) => Math.hypot(this.city.nodes[s.nodeId].x - this.city.nodes[node].x, this.city.nodes[s.nodeId].y - this.city.nodes[node].y) < 6); }
  nearestStationNode(u: Unit, service: Unit['service']): number {
    let best = u.postNode, bd = Infinity;
    for (const s of Object.values(this.state.stations)) { if (s.service !== service) continue; const n = this.city.nodes[s.nodeId]; const d = Math.hypot(n.x - u.x, n.y - u.y); if (d < bd) { bd = d; best = s.nodeId; } }
    return best;
  }
  /** send an idle unit back to quarters for servicing: out for about a minute, comes back like new */
  serviceUnit(unitId: string): { ok: boolean; reason?: string } {
    const u = this.state.units[unitId];
    if (!u || u.temp || isAir(u)) return { ok: false, reason: 'Not one of our vehicles' };
    if (u.status !== 'AVAILABLE') return { ok: false, reason: 'Only an available unit can go to the workshop' };
    if ((u.condition ?? 100) > 85) return { ok: false, reason: 'This vehicle does not need servicing yet' };
    const stn = this.state.stations[u.stationId];
    u.workshop = true; u.status = 'RETURNING'; u.patrol = false;
    this.routeUnit(u, stn ? stn.nodeId : u.postNode, false);
    this.radio('DISPATCH', `${u.spoken}, return to quarters for servicing.`, 'dispatch', u.id);
    this.radio(u.spoken, 'Copy, heading in to the workshop.', 'unit', u.id);
    if (!u.route.length) this.arrive(u);
    return { ok: true };
  }
  /** now and then someone walks into a station needing help, and the crew on duty takes it */
  private stationWalkIns() {
    const st = this.state;
    if (st.config.mode === 'tutorial' || st.config.script || st.time < 120 || st.time - (st.lastWalkIn ?? -999) < 360 || this.hrand(Math.floor(st.time * 2), 61) > 0.0016) return;
    const home = Object.values(st.units).filter((u) => u.status === 'AVAILABLE' && !u.temp && !isAir(u) && (u.capabilities.includes('bls') || u.capabilities.includes('first_aid') || u.service === 'fire') && Math.hypot(u.x - this.city.nodes[st.stations[u.stationId]?.nodeId ?? u.postNode].x, u.y - this.city.nodes[st.stations[u.stationId]?.nodeId ?? u.postNode].y) < 6);
    if (!home.length) return;
    const u = home[Math.floor(this.hrand(st.incidentCounter, 62) * home.length)];
    const stn = st.stations[u.stationId];
    if (!stn) return;
    const tpl = ['workplace_injury', 'sports_injury', 'fall_elderly', 'heat_exhaustion'][Math.floor(this.hrand(st.incidentCounter, 63) * 4)];
    st.lastWalkIn = st.time;
    const inc = this.spawnIncident(tpl, stn.district, { noCall: true, nodeId: stn.nodeId, severity: 2 });
    st.stats.walkIns = (st.stats.walkIns ?? 0) + 1;
    this.radio(u.spoken, `Dispatch, ${u.spoken} at quarters — we've had a walk-in: ${inc.label.toLowerCase()}. We're on it.`, 'unit', u.id, inc.id);
    this.notify(`Walk-in at ${stn.name}: ${inc.label}`, 'info', inc.id);
    this.dispatch(u.id, inc.id, { code: 2, self: true });
  }

  // ── Hospitals calling in, diversions and mass casualties ─────────────────
  private hospitalCalls() {
    const st = this.state;
    if (st.config.mode === 'tutorial' || st.config.script || !st.hospitals || st.time < 90) return;
    if (st.rank < 2 || this.hrand(Math.floor(st.time / 30), 71) > 0.03 || st.time - (st.lastHospitalCall ?? -999) < 600 || (st.stats.hospitalCalls ?? 0) >= Math.max(1, Math.floor(st.config.durationSec / 700))) return;
    const hs = Object.values(st.hospitals).filter((h) => st.config.districts.includes(this.city.nodes[h.node].district));
    if (!hs.length) return;
    const h = hs[Math.floor(this.hrand(st.incidentCounter, 72) * hs.length)];
    const tpl = ['ift_transfer', 'ift_transfer', 'blood_run', 'er_violent'][Math.floor(this.hrand(st.incidentCounter, 73) * 4)];
    st.lastHospitalCall = st.time;
    st.stats.hospitalCalls = (st.stats.hospitalCalls ?? 0) + 1;
    this.spawnIncident(tpl, this.city.nodes[h.node].district, { nodeId: h.node, archetype: 'professional', accuracy: 'exact' });
  }
  /** ask a hospital on diversion to take one more patient anyway */
  askHospitalToAccept(node: number): { ok: boolean; reason?: string; accepted?: boolean } {
    const st = this.state;
    const h = st.hospitals?.[node];
    if (!h) return { ok: false, reason: 'No such hospital' };
    if (st.time - (h.lastPlea ?? -999) < 90) return { ok: false, reason: `${h.name} just told you — try again in a minute` };
    h.lastPlea = st.time;
    const accepted = h.er < h.erCap + 1 && this.hrand(node, Math.floor(st.time)) < (h.er < h.erCap ? 0.85 : 0.45);
    this.radio('DISPATCH', `${h.name}, dispatch — can you take one more? Our other hospitals are further out.`, 'dispatch');
    this.radio(h.name, accepted ? `${h.name}: okay, dispatch. We'll make room — bring them in.` : `${h.name}: negative, we are full to the corridors. Divert.`, 'hospital');
    if (accepted) { h.er = Math.max(0, h.er - 1); if (h.known) { h.known.diversion = false; h.known.er = h.er; h.known.at = st.time; } }
    return { ok: true, accepted };
  }
  /** big incidents: decide where the casualties go before the ambulances start loading */
  private mciCheck(inc: Incident, here: Unit[]) {
    const st = this.state;
    if (inc.mciAsked || !st.hospitals || !['active_shooter', 'vehicle_ramming', 'crowd_crush', 'train_derailment', 'house_explosion', 'riot', 'collision_multi', 'building_collapse'].includes(inc.templateId)) return;
    const medic = here.find((u) => u.service === 'medical' || u.capabilities.includes('als'));
    if (!medic) return;
    inc.mciAsked = true;
    const opt = (o: string, label: string, hint: string) => ({ id: o, label, hint });
    (st.decisions ??= []).push({ id: `d${st.decisions.length + 1}-m${Math.floor(st.time)}`, incId: inc.id, unitId: medic.id, at: st.time, expiresAt: st.time + 30, kind: 'mci',
      prompt: `${medic.spoken}: mass casualty — multiple patients. How do you want them distributed?`,
      options: [opt('spread', 'Spread across hospitals', 'Longer drives, nobody overwhelmed'), opt('trauma', 'Criticals to the trauma centre', 'Best care, if it has room'), opt('nearest', 'Nearest hospital', 'Fastest — may overwhelm the ER')], defaultId: 'spread' });
    this.radio(medic.spoken, 'Dispatch, we have a mass casualty incident. Need a decision on patient distribution.', 'alert', medic.id, inc.id);
    this.emit({ type: 'alert', text: 'Decision needed' });
  }

  // ── The resources panel ────────────────────────────────────────────────────
  /** can this resource help here, has it been asked for, and where is it */
  resourceInfo(incId: string, id: string): { ok: boolean; reason?: string; recommended: boolean; asked: boolean; status: 'none' | 'requested' | 'enroute' | 'here'; eta?: number } {
    const st = this.state;
    const inc = st.incidents[incId];
    const def = RESOURCE_BY_ID[id];
    if (!inc || !def) return { ok: false, reason: 'No incident selected', recommended: false, asked: false, status: 'none' };
    const live = !['RESOLVED', 'CLOSED'].includes(inc.status);
    let status: 'none' | 'requested' | 'enroute' | 'here' = 'none', eta: number | undefined;
    const asked = inc.resAsked?.[id] !== undefined || (id in AGENCY && inc.agency?.kind === id && inc.agency.askedAt !== null) || ((id === 'federal' || id === 'eod') && inc.specialistAsked?.[id] !== undefined);
    // status
    if (id in AGENCY && inc.agency?.kind === id && inc.agency.calledAt != null) { status = inc.agency.here ? 'here' : 'enroute'; eta = (inc.agency.arriveAt ?? st.time) - st.time; }
    const unitId = id === 'federal' || id === 'eod' ? inc.specialists?.[id]?.unitId : inc.resources?.[id]?.unitId;
    if (unitId) { const u = st.units[unitId]; status = !u ? 'here' : u.status === 'ON_SCENE' ? 'here' : u.status === 'DISPATCHED' ? 'requested' : 'enroute'; eta = u ? (u.status === 'DISPATCHED' ? u.timer : 0) + (u.eta ?? 0) : 0; }
    else if (inc.resources?.[id]) { const r = inc.resources[id]; status = r.here ? 'here' : 'enroute'; eta = r.arriveAt - st.time; }
    // applicability
    let ok = live && inc.reportedNode !== null, reason = !live ? 'Incident closed' : inc.reportedNode === null ? 'Set the incident location first' : undefined;
    let recommended = asked;
    if (ok) {
      if (id in AGENCY) { ok = this.agencyFor(inc) === id; if (!ok) reason = 'Not needed for this kind of incident'; else recommended = true; }
      else if (id === 'federal' || id === 'eod') { ok = this.specialistFor(inc) === id; if (!ok) reason = id === 'eod' ? 'No suspected device here' : 'Only for the most serious armed threats'; else recommended = recommended || inc.severity >= 5 || inc.requires.some((r) => r.cap === 'eod'); }
      else if (def.kind === 'mutual') { const cov = matchCoverage(inc.requires, inc.assignedUnits.map((x) => st.units[x]).filter(Boolean)); recommended = cov.missing.some((r) => r.cap === def.cap || (def.cap === 'transport' && r.cap === 'bls')); if (inc.mutualAid >= 2) { ok = false; reason = 'Mutual aid limit reached for this incident'; } }
      else if (id === 'coroner') { ok = inc.casualties > 0; if (!ok) reason = 'No fatalities at this incident'; else recommended = true; }
      else if (id === 'publicworks') { ok = inc.blockedEdge !== null || !!def.templates?.includes(inc.templateId); if (!ok) reason = 'No road to clear here'; else recommended = recommended || inc.blockedEdge !== null; }
      else { ok = !!def.templates?.includes(inc.templateId); if (!ok) reason = 'Not the right specialists for this incident'; else recommended = true; }
    }
    if (status !== 'none') { ok = false; reason = status === 'here' ? 'On scene' : 'Already requested'; }
    return { ok, reason, recommended: recommended && status === 'none', asked: asked && status === 'none', status, eta };
  }
  /** phone in an outside resource for an incident */
  requestResource(incId: string, id: string): { ok: boolean; reason?: string; eta?: number } {
    const st = this.state;
    const info = this.resourceInfo(incId, id);
    if (!info.ok) return { ok: false, reason: info.reason };
    const inc = st.incidents[incId];
    const def = RESOURCE_BY_ID[id];
    if (id in AGENCY) return this.callAgency(incId);
    if (id === 'federal' || id === 'eod') return this.requestSpecialist(incId, id);
    if (def.kind === 'mutual') return this.requestMutualAid(incId, def.cap!);
    st.stats.resourceCalls = (st.stats.resourceCalls ?? 0) + 1;
    if (def.kind === 'unit') {
      const u = this.spawnOutside(inc, { unitType: def.unitType!, name: def.name, short: def.short, spoken: def.spoken ?? def.short, mobilise: def.eta, cost: def.cost });
      (inc.resources ??= {})[id] = { at: st.time, arriveAt: st.time + u.timer + (u.eta ?? 0), here: false, unitId: u.id };
      this.radio(def.name, `Ravenport, ${def.name.toLowerCase()} copies. Mobilising now — about ${Math.max(1, Math.round((u.timer + (u.eta ?? 0)) / 60))} minutes.`, 'unit', u.id, inc.id);
      return { ok: true, eta: u.timer + (u.eta ?? 0) };
    }
    const night = st.timeOfDay % 24 >= 21 || st.timeOfDay % 24 < 5;
    const eta = Math.round(this.rng.range(def.eta[0], def.eta[1]) * (night ? 1.2 : 1));
    (inc.resources ??= {})[id] = { at: st.time, arriveAt: st.time + eta, here: false };
    st.budget -= def.cost; st.stats.costs += def.cost;
    this.radio('DISPATCH', `Units at INC-${String(inc.num).padStart(4, '0')}, ${def.name.toLowerCase()} is on the way, about ${Math.max(1, Math.round(eta / 60))} minute${Math.round(eta / 60) > 1 ? 's' : ''}.`, 'dispatch', undefined, inc.id);
    this.notify(`${def.name} requested${def.cost ? ` (−$${def.cost.toLocaleString()})` : ''}`, 'info', inc.id);
    return { ok: true, eta };
  }
  /** an outside vehicle that mobilises, then drives in from the city limits */
  private spawnOutside(inc: Incident, sp: { unitType: string; name: string; short: string; spoken: string; mobilise: [number, number]; cost: number }): Unit {
    const st = this.state;
    const def = UNIT_TYPE_BY_ID[sp.unitType];
    const n = this.city.nodes[inc.reportedNode ?? inc.nodeId];
    const edgeNodes = this.city.nodes.filter((x) => (x.i === 0 || x.i === 40 || x.j === 0) && this.city.adj[x.id].length);
    let best = edgeNodes[0], bd = Infinity;
    for (const e of edgeNodes) { const d = Math.hypot(e.x - n.x, e.y - n.y); if (d < bd) { bd = d; best = e; } }
    const station: Station = { id: 'outside', name: sp.name, service: def.service, nodeId: best.id, district: best.district, capacity: 99, disabledShifts: 0 };
    const k = (st.stats.specialistCalls ?? 0) + 1;
    const idn = 9500 + Object.keys(st.units).length + st.uniqueNameCounter++;
    const u = makeUnit(def, station, Object.values(st.units), idn);
    u.id = `sp${idn}`; u.callsign = `${sp.short}-${k}`; u.spoken = `${sp.spoken} ${numWord(k)}`;
    u.temp = true; u.minCrew = 0; u.stationId = 'outside'; u.speedModifier = def.speed; u.postNode = best.id;
    const night = st.timeOfDay % 24 >= 21 || st.timeOfDay % 24 < 5;
    u.timer = Math.round(this.rng.range(sp.mobilise[0], sp.mobilise[1]) * (night ? 1.2 : 1));
    st.units[u.id] = u;
    st.budget -= sp.cost; st.stats.costs += sp.cost;
    st.stats.specialistCalls = k;
    this.dispatch(u.id, inc.id, { code: 3 });
    this.radio('DISPATCH', `${sp.name}, Ravenport dispatch. Requesting response to ${addressOf(this.city, inc.reportedNode ?? inc.nodeId)} — ${inc.label.toLowerCase()}.`, 'dispatch', u.id, inc.id);
    this.notify(`${sp.name} requested (−$${sp.cost.toLocaleString()})`, 'info', inc.id);
    this.log('dispatch', `${sp.name} requested for ${inc.label}`, { incidentId: inc.id, good: true });
    this.emit({ type: 'alert', text: 'Specialist requested' });
    return u;
  }
  /** city services that turn up and help without a vehicle on the map */
  private updateResources() {
    const st = this.state;
    for (const inc of Object.values(st.incidents)) {
      if (!inc.resources || ['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
      for (const [id, r] of Object.entries(inc.resources)) {
        if (r.here || r.unitId || st.time < r.arriveAt) continue;
        r.here = true;
        const def = RESOURCE_BY_ID[id];
        this.radio(def.name, `${def.name} on scene at ${addressOf(this.city, inc.reportedNode ?? inc.nodeId)}.`, 'chatter', undefined, inc.id);
        this.fx('info', inc.reportedNode ?? inc.nodeId, `${def.short} on scene`);
        if (id === 'publicworks') { if (inc.blockedEdge !== null) { inc.blockedEdge = null; this.notify('Public works reopened the road', 'good', inc.id); } inc.work *= 0.92; }
        else if (id === 'transit') { inc.threat = Math.max(0, inc.threat - 15); inc.growth *= 0.7; this.radio('Transit Control', 'All trains through the area are held. Buses diverting.', 'chatter', undefined, inc.id); }
        else if (id === 'redcross') { st.reputation = Math.min(100, st.reputation + 0.6); this.headline('Red Cross opens shelter for families displaced by the fire', 'good'); }
        else if (id === 'coroner') inc.work *= 0.85;
      }
    }
  }
  /** crews on scene ask for the specialists they know would help */
  private askResources(inc: Incident, u: Unit) {
    const st = this.state;
    if (st.config.mode === 'tutorial' || inc.resAsked) return;
    const want = RESOURCES.find((r) => r.kind === 'unit' && r.id !== 'federal' && r.id !== 'eod' && r.templates?.includes(inc.templateId) && (inc.severity >= 4 || r.id === 'k9' || r.id === 'transit'))
      ?? (inc.templateId === 'train_derailment' ? RESOURCE_BY_ID.transit : inc.casualties > 0 ? RESOURCE_BY_ID.coroner : undefined);
    if (!want || this.hrand(inc.num, 41) > 0.7) { inc.resAsked = {}; return; }
    inc.resAsked = { [want.id]: st.time };
    const lines: Record<string, string> = {
      k9: 'Can we get a K-9 out here? The dog will find them faster than we will.', negotiator: 'Request the crisis negotiation team — we need someone talking to him.',
      regional_hazmat: 'This is beyond our hazmat unit — request the regional team.', usar: 'We need urban search and rescue. There could be people under this.',
      coast_guard: 'Get the Coast Guard rolling — we need a boat and swimmers.', transit: 'Get the trains stopped on this line, now!', coroner: "We've got a fatality. We'll need the medical examiner.",
    };
    this.radio(u.spoken, `Dispatch, ${u.spoken}. ${lines[want.id] ?? `Request ${want.name.toLowerCase()}.`}`, 'unit', u.id, inc.id);
    this.notify(`${u.callsign} asks for: ${want.name} — answer on the radio (outside line)`, 'warn', inc.id);
  }
  /** a specialist team reached the scene */
  private specialistArrived(inc: Incident, u: Unit) {
    const res = Object.entries(inc.resources ?? {}).find(([, r]) => r.unitId === u.id);
    if (res) { const def = RESOURCE_BY_ID[res[0]]; res[1].here = true; this.radio(u.spoken, `Dispatch, ${u.spoken}. ${def.arrive ?? 'On scene.'}`, 'unit', u.id, inc.id); this.fx('info', inc.reportedNode ?? inc.nodeId, `${def.short} on scene`); inc.threat = Math.max(0, inc.threat - 12); return; }
    const kind = (Object.keys(inc.specialists ?? {}) as SpecialistKind[]).find((k) => inc.specialists?.[k]?.unitId === u.id);
    if (!kind) return;
    this.radio(u.spoken, `Dispatch, ${u.spoken}. ${SPECIALIST[kind].arrive}`, 'unit', u.id, inc.id);
    this.fx('info', inc.reportedNode ?? inc.nodeId, `${SPECIALIST[kind].short} on scene`);
    if (kind === 'eod') { inc.threat = Math.max(0, inc.threat - 25); }
    else { inc.threat = Math.max(0, inc.threat - 20); inc.growth *= 0.6; }
  }

  // ── Officer status checks ─────────────────────────────────────────────────
  private startStatusTimer(u: Unit, inc: Incident) {
    const st = this.state;
    if (u.service === 'fire' && !isAir(u) && STRUCTURE_FIRES.has(inc.templateId) && st.config.mode !== 'tutorial') {
      // crews working inside a burning building: dispatch runs PAR (personnel accountability) checks
      u.checkDue = st.time + 75; u.lastCheck = st.time;
      u.trouble = this.rng.chance(0.12) ? st.time + this.rng.range(50, 150) : null;
      return;
    }
    if (u.service !== 'police' || isAir(u) || inc.category !== 'police' || inc.pursuit || inc.search || st.config.mode === 'tutorial') return;
    u.checkDue = st.time + 60; u.lastCheck = st.time;
    const risky = RISKY_POLICE.has(inc.templateId) || (inc.truth.weapon !== false && inc.truth.weapon !== undefined && inc.truth.weapon !== 'none');
    const p = (risky ? 0.2 : 0.05) * (inc.weaponRelayed ? 0.45 : 1) + (inc.weaponMissed ? 0.3 : 0);
    u.trouble = this.rng.chance(p) ? st.time + this.rng.range(55, 150) : null;
  }
  /** dispatch asks an officer on scene for a status; trouble that is brewing comes out early */
  statusCheck(unitId: string): { ok: boolean; reason?: string; text?: string; trouble?: boolean } {
    const st = this.state;
    const u = st.units[unitId];
    if (!u) return { ok: false, reason: 'Unknown unit' };
    const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
    const fire = u.service === 'fire';
    this.radio('DISPATCH', fire ? `${u.spoken}, PAR check.` : `${u.spoken}, status?`, 'dispatch', u.id, inc?.id);
    st.stats.statusChecks = (st.stats.statusChecks ?? 0) + 1;
    u.lastCheck = st.time;
    if (u.checkDue != null) u.checkDue = st.time + 75;
    if (fire && u.trouble != null && inc && st.time >= u.trouble - 45) {
      u.trouble = null;
      st.stats.statusSaves = (st.stats.statusSaves ?? 0) + 1;
      const text = `${u.spoken} — we're one short on PAR. Firefighter not answering on the second floor, starting a search. Send us another company!`;
      this.radio(u.spoken, text, 'alert', u.id, inc.id);
      inc.requires = mergeReqs(inc.requires, [adaptReqForRank({ cap: 'fire_suppression', n: 2 }, st.rank)]); inc.knownReqs = inc.requires.map((x) => ({ ...x }));
      this.notify(`${u.callsign} is missing a firefighter — your PAR check caught it early. Send another engine.`, 'warn', inc.id);
      return { ok: true, text, trouble: true };
    }
    if (fire) { const text = `${u.spoken}, PAR — ${this.crewOf(u).length || 4} firefighters accounted for.`; this.radio(u.spoken, text, 'unit', u.id, inc?.id); return { ok: true, text }; }
    if (u.trouble != null && inc && st.time >= u.trouble - 45) {
      u.trouble = null;
      st.stats.statusSaves = (st.stats.statusSaves ?? 0) + 1;
      const text = this.rng.pick([`${u.spoken}... send me another unit, code three. He's getting aggressive.`, `${u.spoken}, I need a second unit here now — this is going sideways.`, `Dispatch, ${u.spoken}. Start me backup, subject's squaring up.`]);
      this.radio(u.spoken, text, 'alert', u.id, inc.id);
      inc.requires = mergeReqs(inc.requires, [{ cap: 'patrol', n: 2 }]); inc.knownReqs = inc.requires.map((x) => ({ ...x }));
      inc.threat = Math.min(95, inc.threat + 15);
      this.notify(`${u.callsign} needs backup — your status check caught it early`, 'warn', inc.id);
      this.fx('warn', inc.reportedNode ?? inc.nodeId, 'Backup needed');
      return { ok: true, text, trouble: true };
    }
    const text = this.rng.pick([`${u.spoken}, code four.`, `${u.spoken}, all good here.`, `${u.spoken}, situation's under control.`, `Code four, ${u.spoken}.`]);
    this.radio(u.spoken, text, 'unit', u.id, inc?.id);
    return { ok: true, text };
  }
  /** an officer is hurt: they come off the board and an officer-down incident opens */
  officerDown(u: Unit, inc: Incident, why: string) {
    const st = this.state;
    this.radio(u.spoken, `10-33! ${u.spoken} — officer down!`, 'alert', u.id, inc.id);
    this.consequence(inc, why);
    st.reputation = Math.max(0, st.reputation - 2);
    const down = this.spawnConnected(inc, 'officer_down', { noCall: true });
    this.detach(u, true); u.status = 'OUT_OF_SERVICE'; u.note = 'Officer injured'; u.timer = 300; u.route = []; u.destNode = null; u.checkDue = null;
    for (const p of this.crewOf(u)) p.stress = Math.min(100, (p.stress ?? 0) + 25);
    if (down) this.notify(`OFFICER DOWN — ${why.toLowerCase()}`, 'bad', down.id);
  }
  /** side-system randomness for modules outside the engine */
  hrandPublic(id: number, salt: number): number { return this.hrand(id, salt); }
  /** officers whose status check is overdue */
  overdueChecks(): Unit[] { const t = this.state.time; return Object.values(this.state.units).filter((u) => u.checkDue != null && t >= u.checkDue).sort((a, b) => a.checkDue! - b.checkDue!); }
  private updateStatusChecks() {
    const st = this.state;
    for (const u of Object.values(st.units)) {
      if (u.checkDue == null) continue;
      const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
      if (u.status !== 'ON_SCENE' || !inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) { u.checkDue = null; u.trouble = null; continue; }
      if (st.time - u.checkDue > 45 && (u.lastCheck ?? 0) < u.checkDue && !u.note?.includes('overdue')) { st.stats.statusMissed = (st.stats.statusMissed ?? 0) + 1; u.note = 'Status overdue'; }
      if (u.trouble == null || st.time < u.trouble) continue;
      u.trouble = null;
      if (u.service === 'fire') { this.mayday(u, inc, st.time >= u.checkDue); continue; }
      if (st.time < u.checkDue) {
        // dispatch was on top of things: the officer gets the call out in time
        this.radio(u.spoken, `Dispatch, ${u.spoken}. Start me another unit, code three — subject's fighting.`, 'alert', u.id, inc.id);
        inc.requires = mergeReqs(inc.requires, [{ cap: 'patrol', n: 2 }]); inc.knownReqs = inc.requires.map((x) => ({ ...x }));
        inc.threat = Math.min(95, inc.threat + 20);
        this.notify(`${u.callsign} is calling for backup`, 'warn', inc.id);
      } else if (this.hrand(inc.num, 88) < 0.6) {
        // the orange button: you get a few seconds to answer it
        emergencyActivation(this, u, inc.id);
      } else if (this.rng.chance(0.55)) {
        this.officerDown(u, inc, `Nobody had checked on ${u.callsign} — the officer was hurt before anyone knew there was trouble`);
      } else {
        this.radio(u.spoken, `Dispatch, ${u.spoken}... had a struggle here, I'm okay. Subject's in cuffs. Could've used a check-in.`, 'unit', u.id, inc.id);
        this.consequence(inc, `${u.callsign} fought a subject alone while the status check was overdue`);
        for (const p of this.crewOf(u)) p.morale = Math.max(10, p.morale - 12);
      }
    }
  }

  // ── Public emergency alerts ───────────────────────────────────────────────
  alertInfo(incId: string): { ok: boolean; reason?: string; district?: string } {
    const inc = this.state.incidents[incId];
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) return { ok: false, reason: 'Incident closed' };
    if (inc.reportedNode === null) return { ok: false, reason: 'Set the incident location first' };
    if (inc.alert) return { ok: false, reason: 'An alert is already out for this incident' };
    if (inc.severity < 3) return { ok: false, reason: 'Too minor for a public alert' };
    return { ok: true, district: this.city.nodes[inc.reportedNode].district };
  }
  /** push an evacuation order or a shelter-in-place to every phone in the district */
  issueAlert(incId: string, kind: AlertKind): { ok: boolean; reason?: string } {
    const info = this.alertInfo(incId);
    if (!info.ok) return info;
    const st = this.state, inc = st.incidents[incId];
    const rightKind = ALERT_RIGHT[inc.templateId];
    const needed = !!rightKind, right = rightKind === kind;
    inc.alert = { kind, at: st.time, right, needed };
    const dName = this.city.districtById[info.district!]?.name ?? 'the area';
    const what = kind === 'evacuate' ? 'evacuation order' : 'shelter-in-place order';
    this.radio('DISPATCH', `All units, a public ${what} has gone out for ${dName} in connection with INC-${String(inc.num).padStart(4, '0')}.`, 'dispatch', undefined, inc.id);
    this.headline(`Emergency alert: ${kind === 'evacuate' ? 'residents told to leave' : 'residents told to stay indoors'} in ${dName}`, right ? 'good' : needed ? 'bad' : 'info');
    if (right) { inc.growth *= 0.75; st.stats.alertsRight = (st.stats.alertsRight ?? 0) + 1; this.fx('good', inc.reportedNode!, kind === 'evacuate' ? 'Evacuating' : 'Sheltering'); }
    else if (needed) { inc.growth *= 1.15; st.stats.alertsWrong = (st.stats.alertsWrong ?? 0) + 1; this.fx('bad', inc.reportedNode!, 'Wrong alert'); }
    else { st.reputation = Math.max(0, st.reputation - 2); st.stats.alertsWrong = (st.stats.alertsWrong ?? 0) + 1; this.consequence(inc, `A city-wide alert went out for a ${inc.label.toLowerCase()} — residents panicked for nothing`); }
    // phones light up: worried residents ring in to ask what is going on
    const n = right ? 2 : needed ? 3 : 4;
    for (let i = 0; i < n; i++) (st.alertCalls ??= []).push({ at: st.time + 6 + i * this.rng.range(8, 16), district: info.district! });
    return { ok: true };
  }
  private updateAlertCalls() {
    const st = this.state;
    if (!st.alertCalls?.length) return;
    const due = st.alertCalls.filter((c) => st.time >= c.at);
    if (!due.length) return;
    st.alertCalls = st.alertCalls.filter((c) => st.time < c.at);
    for (const c of due) this.spawnIncident(c.template ?? 'alert_query', c.district, { accuracy: 'exact' });
  }

  // ── Missing-person search grid ────────────────────────────────────────────
  private buildSearch(inc: Incident, center: number) {
    const city = this.city;
    const origin = inc.search?.origin ?? inc.nodeId;
    const c = city.nodes[center];
    const R = inc.templateId === 'lost_child' ? 60 : 92;
    const likes = inc.templateId === 'lost_hiker' ? ['forest', 'park'] : inc.templateId === 'lost_child' ? ['mall', 'market', 'plaza', 'park'] : ['park', 'transit', 'plaza', 'campus'];
    const pts: Array<{ x: number; y: number }> = [{ x: c.x, y: c.y }];
    for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * Math.PI / 3; pts.push({ x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R }); }
    const sectors: SearchGrid['sectors'] = [];
    const used = new Set<number>();
    for (const q of pts) {
      const node = city.nearestNode(q.x, q.y);
      if (used.has(node)) continue;
      used.add(node);
      const n = city.nodes[node];
      const near = city.landmarks.some((l) => likes.includes(l.kind) && Math.hypot(city.nodes[l.nodeId].x - n.x, city.nodes[l.nodeId].y - n.y) < R * 0.9);
      sectors.push({ id: String.fromCharCode(65 + sectors.length), x: n.x, y: n.y, node, p: (sectors.length === 0 ? 2 : this.rng.range(0.7, 1.4)) + (near ? 1.3 : 0), searched: 0 });
    }
    const tot = sectors.reduce((a, x) => a + x.p, 0);
    for (const x of sectors) x.p = Math.round((x.p / tot) * 100);
    // the person really is out there only if the grid was drawn around the right place
    const o = city.nodes[origin];
    const right = Math.hypot(o.x - c.x, o.y - c.y) < 220;
    let target = -1;
    if (right) { let roll = this.rng.range(0, sectors.reduce((a, x) => a + x.p, 0)); for (let i = 0; i < sectors.length; i++) { roll -= sectors[i].p; if (roll <= 0) { target = i; break; } } if (target < 0) target = 0; inc.nodeId = sectors[target].node; }
    inc.search = { cx: c.x, cy: c.y, r: R * 0.55, sectors, target, origin, found: false };
    for (const id of inc.assignedUnits) { const u = this.state.units[id]; if (u) u.searchSector = null; }
  }
  /** send a crew to sweep one sector (an idle crew on scene, or the nearest free unit) */
  assignSearch(incId: string, sector: number, unitId?: string): { ok: boolean; reason?: string; unitId?: string } {
    const st = this.state;
    const inc = st.incidents[incId];
    const S = inc?.search;
    if (!inc || !S || S.found) return { ok: false, reason: 'No active search' };
    const sec = S.sectors[sector];
    if (!sec) return { ok: false, reason: 'Unknown sector' };
    if (sec.searched >= 1) return { ok: false, reason: `Sector ${sec.id} has already been searched` };
    let u = unitId ? st.units[unitId] : undefined;
    if (!u) {
      const mine = inc.assignedUnits.map((id) => st.units[id]).filter((x): x is Unit => !!x && !isAir(x) && ['ON_SCENE', 'EN_ROUTE', 'DISPATCHED'].includes(x.status));
      const idle = mine.find((x) => x.searchSector == null || S.sectors[x.searchSector]?.searched >= 1);
      u = idle ?? Object.values(st.units).filter((x) => !isAir(x) && !x.temp && (x.capabilities.includes('patrol') || x.capabilities.includes('rescue')) && ['AVAILABLE', 'RETURNING'].includes(x.status) && !x.assignedIncidentId && this.canDispatch(x, inc).ok)
        .map((x) => ({ x, eta: this.estimate(x.id, sec.node)?.eta ?? Infinity })).sort((a, b) => a.eta - b.eta)[0]?.x;
    }
    if (!u) return { ok: false, reason: 'No crew free to search' };
    if (isAir(u)) return { ok: false, reason: 'The helicopter sweeps every sector from above — just send it to the incident' };
    if (u.assignedIncidentId !== inc.id) { const r = u.assignedIncidentId ? this.divert(u.id, inc.id) : this.dispatch(u.id, inc.id, { code: 2 }); if (!r.ok) return r; }
    u.searchSector = sector; u.note = undefined;
    if (u.status === 'ON_SCENE') { u.status = 'EN_ROUTE'; this.routeUnit(u, sec.node, false); if (!u.route.length) this.arrive(u); }
    this.radio('DISPATCH', `${u.spoken}, take sector ${sec.id}.`, 'dispatch', u.id, inc.id);
    return { ok: true, unitId: u.id };
  }
  private updateSearch(inc: Incident, here: Unit[], dt: number) {
    const st = this.state, S = inc.search!;
    const night = st.timeOfDay % 24 >= 20 || st.timeOfDay % 24 < 6;
    const sweep = (sec: SearchGrid['sectors'][number], amount: number, by: Unit) => {
      if (sec.searched >= 1 || S.found) return;
      sec.searched = Math.min(1, sec.searched + amount);
      if (sec.searched < 1) return;
      const idx = S.sectors.indexOf(sec);
      if (idx === S.target) { this.searchFound(inc, by, sec); return; }
      sec.cleared = true;
      if (!isAir(by)) { by.note = 'Sector clear'; this.radio(by.spoken, `Dispatch, ${by.spoken}. Sector ${sec.id} is clear, nothing. Where do you want us?`, 'unit', by.id, inc.id); }
    };
    for (const u of here) {
      if (isAir(u)) {
        // thermal camera overhead sweeps every open sector at once, best at night
        for (const sec of S.sectors) sweep(sec, (dt * 0.3 * (night ? 1.8 : 1)) / SECTOR_WORK, u);
        continue;
      }
      if (u.searchSector == null) {
        // crews arriving without orders take the nearest open sector
        const open = S.sectors.map((sec, i) => ({ i, d: sec.searched < 1 ? Math.hypot(sec.x - u.x, sec.y - u.y) : Infinity })).sort((a, b) => a.d - b.d)[0];
        if (!open || !isFinite(open.d)) continue;
        u.searchSector = open.i;
        if (open.d > S.r) { u.status = 'EN_ROUTE'; this.routeUnit(u, S.sectors[open.i].node, false); if (!u.route.length) this.arrive(u); continue; }
      }
      const sec = S.sectors[u.searchSector];
      if (!sec) continue;
      if (sec.searched < 1 && Math.hypot(sec.x - u.x, sec.y - u.y) > S.r * 1.5 && u.destNode !== sec.node) { u.status = 'EN_ROUTE'; this.routeUnit(u, sec.node, false); if (u.route.length) continue; }
      if (sec.searched >= 1) {
        // an idle crew picks the likeliest open sector after a while
        if (u.note === 'Sector clear' && this.rng.chance(dt / 18)) {
          const next = S.sectors.map((x, i) => ({ x, i })).filter((o) => o.x.searched < 1).sort((a, b) => b.x.p - a.x.p)[0];
          if (next) { this.radio(u.spoken, `Dispatch, ${u.spoken}. Moving on to sector ${next.x.id}.`, 'unit', u.id, inc.id); this.assignSearch(inc.id, next.i, u.id); }
        }
        continue;
      }
      const rate = (u.capabilities.includes('rescue') ? 1.25 : 1) * this.unitEffectiveness(u) * (night ? 0.75 : 1) * (st.weather === 'fog' || st.weather === 'storm' ? 0.75 : 1);
      sweep(sec, (dt * rate) / SECTOR_WORK, u);
      if (S.found) return;
    }
    // the whole grid came up empty: the last-seen point must be wrong
    if (!S.found && !S.exhausted && S.sectors.every((x) => x.searched >= 1)) {
      S.exhausted = true;
      const u = here.find((x) => !isAir(x)) ?? here[0];
      if (u) this.radio(u.spoken, `Dispatch, ${u.spoken}. Every sector's clear. Can you verify where they were last seen?`, 'unit', u.id, inc.id);
      this.notify('Search area exhausted — the last-seen location is probably wrong. Re-check it with the caller.', 'bad', inc.id);
      inc.mislocated = true;
    }
    // time is against the missing person
    inc.threat += inc.growth * (night ? 1.3 : 1) * dt * (here.length ? 0.6 : 1);
    if (inc.threat >= 100) this.escalate(inc);
  }
  private searchFound(inc: Incident, u: Unit, sec: SearchGrid['sectors'][number]) {
    const st = this.state, S = inc.search!;
    S.found = true; S.foundAt = st.time;
    st.stats.searchFinds = (st.stats.searchFinds ?? 0) + 1;
    const hurt = typeof inc.truth.injured === 'number' && inc.truth.injured > 0;
    this.radio(u.spoken, `Dispatch, ${u.spoken}! We've found them in sector ${sec.id}${hurt ? ' — one hurt, we need medical up here' : ' — cold and scared, but okay'}.`, 'alert', u.id, inc.id);
    this.fx('good', sec.node, 'Found!');
    this.headline(`${inc.templateId === 'lost_child' ? 'Lost child' : inc.templateId === 'lost_hiker' ? 'Missing walkers' : 'Missing person'} found safe after search`, 'good');
    inc.reportedNode = sec.node; inc.nodeId = sec.node; inc.mislocated = false;
    inc.threat = Math.max(0, inc.threat - 30);
    inc.workProgress = Math.max(inc.workProgress, inc.work * 0.5);
    inc.sceneSeen = true; inc.sceneReported = true; inc.knownReqs = inc.requires.map((r) => ({ ...r }));
    for (const id of inc.assignedUnits) { const x = st.units[id]; if (x) { x.searchSector = null; if (x.note === 'Sector clear') x.note = undefined; if (x.status === 'ON_SCENE' && !isAir(x) && Math.hypot(x.x - sec.x, x.y - sec.y) > 90) { x.status = 'EN_ROUTE'; this.routeUnit(x, sec.node, false); } } }
  }

  // ── Dispatch tools: trace, interpreter, redial, CCTV ─────────────────────
  /** ask the carrier for the caller's location: an uncertainty circle that tightens as the trace refines */
  startTrace(callId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || !['active', 'hold'].includes(call.state)) return { ok: false, reason: 'No live call to trace' };
    if (call.trace) return { ok: false, reason: 'A trace is already running' };
    const inc = st.incidents[call.incidentId];
    const lvl = st.upgrades.ali ?? 0;
    const type = call.profile.callerIdType;
    const n = this.city.nodes[inc.nodeId];
    let stages: Array<{ at: number; radius: number; label: string }>;
    if (type === 'landline') stages = [{ at: 3.5, radius: 5, label: 'Landline — subscriber address' }];
    else if (type === 'payphone') stages = [{ at: 3.5, radius: 5, label: 'Payphone — booth location' }];
    else if (type === 'voip') stages = [{ at: 4, radius: 5, label: 'VoIP — registered address (may not be where the caller is)' }];
    else {
      stages = [{ at: lvl >= 1 ? 5 : 8, radius: 190, label: 'Phase I — cell tower sector' }, { at: lvl >= 1 ? 15 : 24, radius: 75, label: 'Phase II — network triangulation' }];
      if (lvl >= 2) stages.push({ at: lvl >= 3 ? 24 : 36, radius: 16, label: 'Device GPS fix' });
    }
    let wrongNode: number | null = null;
    if (type === 'voip' && this.rng.chance(0.45)) {
      const far = this.city.nodes.filter((m) => { const d = Math.hypot(m.x - n.x, m.y - n.y); return d > 280 && d < 650 && st.config.districts.includes(m.district); });
      if (far.length) wrongNode = this.rng.pick(far).id;
    }
    call.trace = { startedAt: st.time, stage: -1, stages, x: n.x, y: n.y, radius: 0, label: 'Trace requested — waiting for the carrier…', done: false, wrongNode };
    call.aliUsed = true;
    this.addTranscript(call, 'SYSTEM', `Location trace requested from the ${type === 'landline' ? 'telephone company' : type === 'voip' ? 'VoIP provider' : 'mobile carrier'}…`);
    return { ok: true };
  }
  private updateTrace(call: Call) {
    const st = this.state, tr = call.trace;
    if (!tr || tr.done) return;
    const inc = st.incidents[call.incidentId];
    const el = st.time - tr.startedAt;
    while (tr.stage + 1 < tr.stages.length && el >= tr.stages[tr.stage + 1].at) {
      tr.stage++;
      const sg = tr.stages[tr.stage];
      const t = this.city.nodes[tr.wrongNode ?? inc.nodeId];
      const a = this.rng.range(0, Math.PI * 2), d = this.rng.range(0, sg.radius * 0.55);
      tr.x = t.x + Math.cos(a) * d; tr.y = t.y + Math.sin(a) * d; tr.radius = sg.radius; tr.label = sg.label;
      const near = this.city.nearestNode(tr.x, tr.y);
      const meters = Math.max(10, Math.round(sg.radius * 4 / 10) * 10);
      this.addTranscript(call, 'SYSTEM', `Trace: ${sg.label} — within ${meters} m of ${addressOf(this.city, near)}.`);
      if (sg.radius <= 80) this.addHeard(call, { nodeId: near, label: `Trace: ${addressOf(this.city, near)} (±${meters} m)`, source: 'ali', reliability: sg.radius <= 20 ? 'sure' : 'unsure' });
      if (tr.stage === tr.stages.length - 1) tr.done = true;
      this.emit({ type: 'notify', level: 'info' });
    }
  }

  /** conference in a Language Line interpreter for a caller who does not speak English */
  requestInterpreter(callId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const call = st.calls[callId];
    if (!call || call.state !== 'active') return { ok: false, reason: 'No active call' };
    if (!call.profile.language) return { ok: false, reason: 'This caller speaks English' };
    if (call.interpreter) return { ok: false, reason: 'Interpreter already requested' };
    call.interpreter = 'connecting'; call.interpreterAt = st.time + this.rng.range(12, 20);
    st.stats.costs += 120; st.budget -= 120;
    this.addTranscript(call, 'SYSTEM', `Conferencing Language Line — requesting a ${call.profile.language} interpreter…`);
    return { ok: true };
  }
  private updateInterpreter(call: Call) {
    if (call.interpreter !== 'connecting' || this.state.time < (call.interpreterAt ?? 0)) return;
    call.interpreter = 'on';
    this.addTranscript(call, 'SYSTEM', `${call.profile.language} interpreter joined the call.`);
    for (const l of openingLines(this.env(call))) call.pending.push({ ...l, at: this.state.time + 1.2 });
    call.mood.panic = Math.max(0, call.mood.panic - 12); call.mood.trust = Math.min(100, call.mood.trust + 15);
  }

  /** call the last caller back on their number */
  redial(incId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) return { ok: false, reason: 'Incident closed' };
    if (st.activeCallId) return { ok: false, reason: 'Hold or end the current call first' };
    const calls = Object.values(st.calls).filter((c) => c.incidentId === incId).sort((a, b) => b.ringStart - a.ringStart);
    const prev = calls[0];
    if (!prev) return { ok: false, reason: 'No number on file' };
    if (['active', 'hold', 'ringing'].includes(prev.state)) return { ok: false, reason: 'The caller is still on a line' };
    if (st.time - (prev.endedAt ?? 0) < 8) return { ok: false, reason: 'Give it a moment before calling back' };
    const id = `c${++st.callCounter}`;
    const profile: CallerProfile = JSON.parse(JSON.stringify(prev.profile));
    const call: Call = {
      id, incidentId: inc.id, state: 'active', profile, isCallback: true, callerId: `OUTBOUND ${profile.phone}`, ringStart: st.time, ringTimeout: 999, answeredAt: st.time, endedAt: null,
      transcript: [], mood: { ...prev.mood }, asked: {}, promises: prev.promises, promiseAt: prev.promiseAt, complained: 0, heard: prev.heard.map((h) => ({ ...h })), usedLines: {}, pending: [],
      holdSince: null, holdTotal: 0, aliUsed: prev.aliUsed, verifyAsked: [], locPlan: prev.locPlan, typing: false, spokeFirst: true, misunderstood: 0, lastSpontaneous: st.time, stateNote: 'redial',
      callbackOf: prev.id, outbound: true, interpreter: prev.interpreter === 'on' ? 'on' : undefined, tapProtocol: prev.tapProtocol, trace: prev.trace ? { ...prev.trace } : null,
    };
    st.calls[id] = call;
    st.activeCallId = id;
    inc.callId = id; inc.callbackAt = null;
    this.addTranscript(call, 'SYSTEM', `Calling back ${profile.phone}…`);
    const scared = profile.archetype === 'silent' || profile.archetype === 'terse' || inc.stage > 0;
    if (this.rng.chance(scared ? 0.3 : 0.12)) {
      call.pending.push({ at: st.time + 4, text: '(no answer — the call goes to voicemail)', hangup: true });
    } else {
      const hello = profile.language && call.interpreter !== 'on' ? `${this.rng.pick(['¿Hola?', 'Halo?', 'Alô?', 'A lô?'])} (${profile.language})` : profile.archetype === 'silent' ? '(the line connects — silence, then a single tap)' : this.rng.pick(["Hello? Oh — it's you. I'm still here.", "Hello? Yes — you called back! Thank God.", "Hello?! Sorry, the line dropped. I'm still here."]);
      call.pending.push({ at: st.time + 3, text: hello });
    }
    this.log('call', `Called back ${profile.phone}`, { incidentId: inc.id });
    this.emit({ type: 'answer', callId: id });
    return { ok: true };
  }

  /** storm flooding: these streets are under water until the cell passes */
  setFloodEdges(edges: number[]) {
    const st = this.state;
    const prev = new Set(st.floodEdges ?? []);
    st.closedEdges = st.closedEdges.filter((e) => !prev.has(e) || edges.includes(e));
    for (const e of edges) if (!st.closedEdges.includes(e)) st.closedEdges.push(e);
    st.floodEdges = edges;
    this.closedMask = makeClosedMask(this.city, st.closedEdges);
    this.rerouteAll(true);
  }
  /** the crew missed the station tones: send them again (see buildings.ts) */
  reTone(unitId: string) { return reTone(this, unitId); }
  /** callers who are not with the patient: get them closer (see callers.ts) */
  getCloser(callId: string) { return getCloser(this, callId); }
  /** a caller driving their patient: tell them to stop and wait */
  pullOver(callId: string) { return pullOver(this, callId); }
  /** city CCTV network (see cctv.ts) */
  cameras(): Camera[] { return cameraList(this.city); }
  /** a location lead from outside the call (CCTV, sightings): goes on the call's list of places heard */
  noteHeard(inc: Incident, nodeId: number, label: string, reliability: 'sure' | 'unsure') {
    const call = Object.values(this.state.calls).filter((c) => c.incidentId === inc.id).sort((a, b) => b.ringStart - a.ringStart)[0];
    if (call) this.addHeard(call, { nodeId, label, source: 'landmark', reliability });
  }

  // ── Tactical decisions from crews on scene ────────────────────────────────
  private rollDecision(inc: Incident, here: Unit[]) {
    const st = this.state;
    inc.decided = true;
    const u = here[0];
    if (!u || st.config.mode === 'tutorial') return;
    const id = inc.templateId;
    const opt = (o: string, label: string, hint: string) => ({ id: o, label, hint });
    let d: Omit<Decision, 'id' | 'incId' | 'unitId' | 'at' | 'expiresAt'> | null = null;
    if (['apartment_fire', 'house_explosion', 'warehouse_smoke', 'electrical_fire'].includes(id)) d = { kind: 'attack', prompt: `${u.spoken}: heavy fire showing. Interior attack, or go defensive?`, options: [opt('interior', 'Interior attack', 'Faster, can rescue trapped occupants — risk to crews'), opt('defensive', 'Defensive', 'Nobody goes in; protect the buildings next door')], defaultId: 'defensive' };
    else if (id === 'hostage_barricade') d = { kind: 'barricade', prompt: `${u.spoken}: subject is barricaded with a weapon. Negotiate, or breach?`, options: [opt('negotiate', 'Negotiate', 'Slow, but usually ends without injury'), opt('breach', 'Breach now', 'Fast — dangerous without the tactical team')], defaultId: 'negotiate' };
    else if (id === 'active_shooter') d = { kind: 'shooter', prompt: `${u.spoken}: shots still being fired inside. Go in with what we have, or wait for tactical?`, options: [opt('enter', 'Go in now', 'Stops the killing sooner — officers at risk'), opt('wait', 'Wait for tactical', 'Safer for officers — more victims meanwhile')], defaultId: 'wait' };
    else if (['cardiac_arrest', 'drowning_pool', 'collapse_child', 'gunshot_victim', 'airport_medical', 'collision_trapped'].includes(id)) d = { kind: 'medical', prompt: `${u.spoken}: patient is critical. Treat on scene, or load and go?`, options: [opt('stay', 'Treat on scene', 'Right for a cardiac arrest — resuscitate where they are'), opt('go', 'Load and go', 'Right for bleeding trauma — surgery is the fix')], defaultId: 'stay' };
    else if (['fall_elderly', 'sudden_illness', 'allergic_reaction', 'sports_injury', 'heat_exhaustion', 'workplace_injury', 'collision_injury', 'breathing_trouble'].includes(id) && inc.truth.conscious !== false && inc.needsTransport && u.capabilities.includes('transport') && this.rng.chance(0.18)) d = { kind: 'refusal', prompt: `${u.spoken}: patient is refusing to come with us — says they feel fine. How do you want to play it?`, options: [opt('persuade', 'Keep talking them round', 'Slower, but they get the care they need'), opt('sign', 'Let them sign a refusal', 'Frees the crew now — risky if they are worse than they think'), opt('police', 'Send an officer to help', 'Ties up a patrol car, usually works')], defaultId: 'persuade' };
    else if (id === 'riot' || (id === 'protest_march' && this.rng.chance(0.7))) d = { kind: 'riot', prompt: id === 'riot' ? `${u.spoken}: the line is taking bricks. Hold, push them back, or pull out and regroup?` : `${u.spoken}: the march has stopped and a hard core at the front want a fight. Talk to the organisers, or clear the road?`, options: id === 'riot' ? [opt('hold', 'Hold the line', 'Contain it until enough units are here'), opt('push', 'Push forward', 'Takes the street back fast — injuries likely, worse without public order units'), opt('withdraw', 'Pull back', 'Nobody gets hurt now — the crowd runs riot meanwhile')] : [opt('talk', 'Talk to the organisers', 'Slower, keeps it peaceful'), opt('clear', 'Clear the road', 'Fast — risks turning a march into a riot')], defaultId: id === 'riot' ? 'hold' : 'talk' };
    else if (id === 'suspicious_package' && inc.twistRevealed) d = { kind: 'package', prompt: `${u.spoken}: possible device confirmed. Wait for EOD, or let an officer take a closer look?`, options: [opt('wait', 'Hold the cordon for EOD', 'Safe — the street stays shut until bomb techs arrive'), opt('look', 'Officer takes a look', 'Quicker answer — someone could be killed if it is real')], defaultId: 'wait' };
    else if (id === 'bomb_threat') d = { kind: 'bomb', prompt: `${u.spoken}: station is still full of people. Evacuate first, or search with people inside?`, options: [opt('evacuate', 'Evacuate first', 'Slow and disruptive, but safe'), opt('search', 'Search now', 'Fast — dangerous if the threat is real')], defaultId: 'evacuate' };
    if (!d) return;
    if (!st.decisions) st.decisions = [];
    st.decisions.push({ ...d, id: `d${st.decisions.length + 1}-${Math.floor(st.time)}`, incId: inc.id, unitId: u.id, at: st.time, expiresAt: st.time + 25 });
    this.radio(u.spoken, `Dispatch, ${d.prompt.replace(`${u.spoken}: `, '')}`, 'alert', u.id, inc.id);
    this.emit({ type: 'alert', text: 'Decision needed' });
  }
  /** the dispatcher answers a crew's tactical question */
  decide(decisionId: string, optionId: string, auto = false): { ok: boolean; reason?: string; outcome?: string } {
    const st = this.state;
    const d = st.decisions?.find((x) => x.id === decisionId);
    if (!d || d.chosen) return { ok: false, reason: 'Already decided' };
    const inc = st.incidents[d.incId];
    const u = st.units[d.unitId];
    d.chosen = optionId; d.auto = auto;
    if (d.kind === 'break') return this.decideBreak(d, optionId, auto);
    if (d.kind === 'stress') return decideStress(this, d, optionId);
    if (d.kind === 'aidOut') return decideAidOut(this, d, optionId);
    if (d.kind === 'mayday') return this.decideMayday(d, optionId, auto);
    if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) { d.outcome = 'The incident was already over.'; return { ok: true, outcome: d.outcome }; }
    const t = inc.truth;
    const n = (k: string) => (typeof t[k] === 'number' ? (t[k] as number) : 0);
    const label = d.options.find((o) => o.id === optionId)?.label ?? optionId;
    if (u) this.radio(auto ? u.spoken : 'DISPATCH', auto ? `No answer from dispatch — going with: ${label.toLowerCase()}.` : `${u.spoken}, ${label.toLowerCase()}.`, auto ? 'unit' : 'dispatch', u.id, inc.id);
    let out = '';
    const hurtCrew = (why: string) => { if (u) { this.detach(u, true); u.status = 'OUT_OF_SERVICE'; u.note = 'Crew injured'; u.timer = 200; u.route = []; for (const p of this.crewOf(u)) p.morale = Math.max(10, p.morale - 18); } this.consequence(inc, why); out = why; };
    const tactical = this.onScene(inc).some((x) => x.capabilities.includes('tactical'));
    switch (d.kind) {
      case 'attack':
        if (optionId === 'interior') {
          inc.workProgress += inc.work * 0.3;
          if (n('trapped') > 0) { out = `Crews pulled ${n('trapped')} trapped occupant${n('trapped') > 1 ? 's' : ''} out alive.`; t.trapped = 0; st.stats.livesHelped += 1; }
          if (this.rng.chance(0.1 + inc.stage * 0.12)) hurtCrew('A firefighter was hurt during the interior attack');
          else out ||= 'Interior attack knocked the fire down fast.';
        } else {
          inc.work *= 1.2; inc.threat = Math.max(0, inc.threat - 8);
          if (n('trapped') > 0) { inc.casualties += 1; st.stats.casualties += 1; this.consequence(inc, 'Nobody went in — a trapped occupant did not get out'); out = 'Nobody went in — a trapped occupant did not get out.'; }
          else out = 'Defensive operation: slower, but nobody was at risk.';
        }
        break;
      case 'barricade': {
        const negotiator = this.onScene(inc).some((x) => x.capabilities.includes('negotiator'));
        if (optionId === 'negotiate') { inc.work *= negotiator ? 1.05 : 1.3; out = this.rng.chance(negotiator ? 0.97 : 0.88) ? (negotiator ? 'The federal negotiator has him talking — he is asking about his kids.' : 'Negotiators are talking — this will take time, but it is calm.') : 'Talks broke down; the subject is getting agitated.'; if (out.startsWith('Talks')) inc.threat += 20; }
        else { inc.workProgress += inc.work * 0.7; if (this.rng.chance(tactical ? 0.12 : 0.4)) { inc.casualties += 1; st.stats.casualties += 1; this.consequence(inc, `The breach went wrong${tactical ? '' : ' without the tactical team'} — someone was shot`); out = 'The breach went wrong — someone was shot.'; } else out = 'Entry team breached and took the subject down.'; }
        break;
      }
      case 'riot': {
        const pou = this.onScene(inc).filter((x) => x.capabilities.includes('public_order') || x.capabilities.includes('crowd')).length;
        const ll = this.onScene(inc).some((x) => x.fit?.kits.includes('less_lethal'));
        if (optionId === 'hold') { inc.work *= 1.1; inc.threat = Math.max(0, inc.threat - 6); out = pou ? 'The line is holding. Waiting for more units before moving.' : 'Patrol officers are holding — barely. They need public order units.'; }
        else if (optionId === 'push') {
          inc.workProgress += inc.work * 0.35; inc.threat = Math.max(0, inc.threat - 20);
          if (this.rng.chance(pou ? (ll ? 0.08 : 0.18) : 0.45)) { inc.casualties += 1; st.stats.casualties += 1; this.consequence(inc, `The push turned violent${pou ? '' : ' without public order units'} — someone was badly hurt`); out = 'The push turned violent — someone was badly hurt.'; }
          else out = 'The line pushed forward and took the street back.';
        } else if (optionId === 'withdraw') { inc.threat = Math.min(99, inc.threat + 25); inc.work *= 1.25; this.consequence(inc, 'Officers pulled back and the crowd ran riot'); out = 'Officers pulled back — the crowd is smashing up the street.'; }
        else if (optionId === 'talk') { inc.work *= 1.15; inc.growth *= 0.6; out = this.rng.chance(0.85) ? 'The organisers agreed a new route — the march is moving again.' : 'Talks stalled; the hard core are pushing at the line.'; if (out.startsWith('Talks')) inc.threat += 15; }
        else { inc.workProgress += inc.work * 0.4; if (this.rng.chance(pou ? 0.2 : 0.4)) { inc.threat = Math.min(99, inc.threat + 30); this.consequence(inc, 'Clearing the road by force inflamed the march'); out = 'Clearing the road by force has inflamed the crowd.'; } else out = 'The road was cleared without serious trouble.'; }
        break;
      }
      case 'mci': {
        st.stats.mciPlans = (st.stats.mciPlans ?? 0) + 1;
        const hs = Object.values(st.hospitals ?? {}).filter((h) => !st.closedHospitals.includes(h.node));
        const n = inc.reportedNode ?? inc.nodeId, nd = this.city.nodes[n];
        const dist = (h: HospitalState) => Math.hypot(this.city.nodes[h.node].x - nd.x, this.city.nodes[h.node].y - nd.y);
        const nearest = [...hs].sort((a, b) => dist(a) - dist(b))[0];
        const trauma = hs.find((h) => h.has.includes('trauma') && !(h.down.trauma && st.time < (h.down.trauma ?? 0)));
        if (optionId === 'spread') { inc.work *= 1.1; for (const h of hs.slice(0, 3)) h.er = Math.min(h.erCap + 1, h.er + 1); if (inc.survival !== undefined) inc.survival = Math.min(100, inc.survival + 6); out = 'Patients spread across the hospitals — nobody overwhelmed.'; }
        else if (optionId === 'trauma') {
          if (trauma && trauma.er <= trauma.erCap - 2) { trauma.er += 2; if (inc.survival !== undefined) inc.survival = Math.min(100, inc.survival + 10); inc.work *= 0.95; out = `Criticals going to ${trauma.name} — the trauma team is ready.`; }
          else { inc.casualties += 1; st.stats.casualties += 1; this.consequence(inc, 'The trauma centre was already overwhelmed'); out = 'The trauma centre was already full — patients waited in the corridor.'; }
        } else if (nearest) {
          nearest.er += 4; inc.work *= 0.85;
          if (nearest.er > nearest.erCap) { if (inc.survival !== undefined) inc.survival = Math.max(0, inc.survival - 8); this.consequence(inc, `${nearest.name} was swamped by the casualties`); out = `${nearest.name} is swamped — it has gone on diversion.`; }
          else out = `Everyone to ${nearest.name} — fast turnaround.`;
        }
        break;
      }
      case 'package': {
        const eod = this.onScene(inc).some((x) => x.capabilities.includes('eod'));
        if (optionId === 'wait') { inc.work *= eod ? 1 : 1.15; out = eod ? 'Bomb techs are on it — robot going down now.' : 'Cordon held. Waiting for EOD — request them if you have not.'; }
        else if (eod) { inc.workProgress += inc.work * 0.2; out = 'The EOD tech suited up and had a look — controlled disruption next.'; }
        else if (this.rng.chance(0.3)) { inc.casualties += 1; st.stats.casualties += 1; if (u) hurtCrew('The device went off as an officer approached'); else this.consequence(inc, 'The device went off as an officer approached'); out ||= 'The device went off as an officer approached.'; }
        else { inc.workProgress += inc.work * 0.15; out = 'The officer backed away safely — it is definitely a device.'; }
        break;
      }
      case 'shooter':
        if (optionId === 'enter') { inc.threat = Math.max(0, inc.threat - 35); inc.workProgress += inc.work * 0.25; if (!tactical && this.rng.chance(0.25)) hurtCrew('An officer was shot going in without the tactical team'); else out = 'Officers went in and engaged the shooter.'; }
        else if (!tactical) { inc.threat = Math.min(99, inc.threat + 15); if (this.rng.chance(0.5)) { inc.casualties += 1; st.stats.casualties += 1; this.consequence(inc, 'Officers waited outside for tactical — another victim was hit'); out = 'While officers waited, another victim was hit.'; } else out = 'Officers are holding the perimeter until tactical arrives.'; }
        else out = 'Tactical team is on scene and leads the entry.';
        break;
      case 'medical': {
        const bleeding = inc.lifeThreat === 'bleed' || inc.templateId === 'gunshot_victim' || inc.templateId === 'collision_trapped';
        const right = bleeding ? 'go' : 'stay';
        if (optionId === right) { if (inc.survival !== undefined) inc.survival = Math.min(100, inc.survival + 8); inc.workProgress += inc.work * 0.15; out = optionId === 'go' ? 'Loaded and running hot to the trauma centre — right call.' : 'Working the patient on scene — they have a pulse back.'; }
        else { if (inc.survival !== undefined) inc.survival = Math.max(0, inc.survival - 18); inc.threat = Math.min(99, inc.threat + 12); this.consequence(inc, optionId === 'go' ? 'Crews moved a cardiac-arrest patient instead of resuscitating on scene' : 'Crews stayed on scene with a bleeding patient who needed surgery'); out = 'That call cost the patient precious time.'; }
        break;
      }
      case 'hospital': {
        const node = Number(optionId);
        if (u && u.status === 'TRANSPORTING') { if (u.destNode !== node) this.setHospital(u.id, node); this.prealert(u.id); }
        const h = st.hospitals?.[node];
        out = h ? `${u?.callsign ?? 'Ambulance'} heading to ${h.name}.` : 'Destination set.';
        break;
      }
      case 'refusal':
        st.stats.refusals = (st.stats.refusals ?? 0) + 1;
        if (optionId === 'persuade') { inc.work *= 1.3; out = 'The crew talked them round — they\'re coming in.'; }
        else if (optionId === 'police') { inc.requires = mergeReqs(inc.requires, [{ cap: 'patrol', n: 1 }]); inc.knownReqs = inc.requires.map((x) => ({ ...x })); inc.work *= 1.1; out = 'An officer is on the way to help persuade them.'; }
        else {
          inc.needsTransport = false; inc.workProgress = Math.max(inc.workProgress, inc.work);
          out = 'The patient signed a refusal and the crew cleared.';
          if (this.rng.chance(0.35)) (st.relapses ??= []).push({ at: st.time + 70 + this.rng.range(0, 60), incId: inc.id });
        }
        break;
      case 'bomb':
        if (optionId === 'evacuate') { inc.work *= 1.25; out = 'Station evacuated — search under way with nobody inside.'; }
        else { inc.workProgress += inc.work * 0.4; if (inc.twist && this.rng.chance(this.onScene(inc).some((x) => x.capabilities.includes('eod')) ? 0.08 : 0.35)) { inc.casualties += 2; st.stats.casualties += 2; this.consequence(inc, 'The device went off during a search with people still inside'); out = 'The device went off with people still inside.'; } else out = 'Quick search completed.'; }
        break;
    }
    d.outcome = out;
    this.log(out.match(/hurt|shot|did not|went off|cost|wrong/) ? 'failed' : 'info', `${inc.label}: ${label} — ${out}`, { incidentId: inc.id, good: !/hurt|shot|did not|went off|cost|wrong/.test(out) });
    this.notify(`${inc.label}: ${out}`, /hurt|shot|did not|went off|cost|wrong/.test(out) ? 'bad' : 'good', inc.id);
    return { ok: true, outcome: out };
  }
  private updateDecisions() {
    const st = this.state;
    for (const d of st.decisions ?? []) {
      // answers are typed on the radio now: give a little longer than a button press took
      if (!d.chosen && !d.auto && d.extended === undefined) { d.extended = true; d.expiresAt += 10; }
      if (!d.chosen && st.time >= d.expiresAt) this.decide(d.id, d.defaultId, true);
    }
    for (const q of st.unitQueries ?? []) if (q.status === 'open' && q.extended === undefined) { q.extended = true; q.expiresAt += 10; }
  }

  // ── Hospital coordination ─────────────────────────────────────────────────
  private initHospitals() {
    const st = this.state;
    if (st.hospitals) return;
    st.hospitals = {};
    for (const node of this.city.hospitals) {
      const name = this.city.landmarks.find((l) => l.nodeId === node && l.kind === 'hospital')?.name ?? 'Hospital';
      const has: Dept[] = /General/.test(name) ? ['trauma', 'cardiac', 'burns'] : /University/.test(name) ? ['trauma', 'pediatric', 'stroke'] : /Maren/.test(name) ? ['cardiac', 'stroke', 'pediatric'] : [];
      const erCap = /Clinic/.test(name) ? 3 : /Maren/.test(name) ? 6 : 8;
      st.hospitals[node] = { node, name, has, down: {}, er: Math.round(erCap * this.rng.range(0.25, 0.6)), erCap, nextEvent: st.time + this.rng.range(150, 360), lastDecay: st.time, known: null, prealerts: [] };
    }
    this.refreshHospitalBoard(true);
  }
  /** the dispatcher pulls the current bed board */
  refreshHospitalBoard(silent = false) {
    const st = this.state;
    for (const h of Object.values(st.hospitals ?? {})) h.known = { at: st.time, er: h.er, down: h.has.filter((d) => (h.down[d] ?? 0) > st.time), diversion: h.er >= h.erCap || st.closedHospitals.includes(h.node) };
    if (!silent) this.radio('DISPATCH', 'Hospital bed board refreshed — capacity and department status updated.', 'hospital');
  }
  /** what kind of hospital this patient needs */
  patientNeed(inc: Incident): Dept | 'general' {
    const id = inc.templateId;
    if (inc.truth.age !== undefined && Number(inc.truth.age) < 14) return 'pediatric';
    if (['cardiac_arrest'].includes(id)) return 'cardiac';
    if (['sudden_illness'].includes(id)) return 'stroke';
    if (inc.category === 'fire' && typeof inc.truth.injured === 'number' && inc.truth.injured > 0 && ['apartment_fire', 'house_explosion', 'kitchen_fire', 'tanker_fire', 'vehicle_fire', 'fireworks', 'electrical_fire'].includes(id)) return 'burns';
    if (['gunshot_victim', 'collision_injury', 'collision_trapped', 'collision_multi', 'industrial_accident', 'building_collapse', 'train_derailment', 'crowd_crush', 'active_shooter', 'workplace_injury', 'officer_down', 'aircraft_emergency'].includes(id)) return 'trauma';
    return 'general';
  }
  hospitalSuits(h: HospitalState, need: Dept | 'general', sev: number): boolean {
    const st = this.state;
    if (st.closedHospitals.includes(h.node) || h.er >= h.erCap) return false;
    if (need === 'general') return h.has.length > 0 || sev <= 3;
    return h.has.includes(need) && !((h.down[need] ?? 0) > st.time);
  }
  private updateHospitals() {
    const st = this.state;
    if (!st.hospitals) this.initHospitals();
    for (const h of Object.values(st.hospitals!)) {
      if (st.time - h.lastDecay > 80) { h.lastDecay = st.time; h.er = Math.max(0, h.er - 1); }
      if (this.rng.chance(1 / 140)) h.er = Math.min(h.erCap + 1, h.er + 1);
      if (st.time >= h.nextEvent && h.has.length && st.config.mode !== 'tutorial') {
        h.nextEvent = st.time + this.rng.range(220, 460);
        const dept = this.rng.pick(h.has);
        h.down[dept] = st.time + this.rng.range(160, 300);
        const why: Record<Dept, string> = { trauma: 'both trauma bays are occupied', cardiac: 'the cath lab team is tied up', stroke: 'the CT scanner is down', pediatric: 'the children’s ward is full', burns: 'the burns unit is at capacity' };
        this.radio(h.name, `${h.name} to all units: ${why[dept]} — no ${dept} patients until further notice.`, 'hospital');
        if (h.known) h.known.down = Array.from(new Set([...h.known.down, dept]));
      }
      for (const d of h.has) if ((h.down[d] ?? 0) && (h.down[d] ?? 0) <= st.time && h.down[d] !== 0) {
        h.down[d] = 0;
        this.radio(h.name, `${h.name}: ${d} is accepting patients again.`, 'hospital');
        if (h.known) h.known.down = h.known.down.filter((x) => x !== d);
      }
    }
    if (st.time > 0 && Math.floor(st.time) % 180 === 0) this.refreshHospitalBoard(true);
  }
  /** call ahead so the hospital is ready when the ambulance arrives */
  prealert(unitId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const u = st.units[unitId];
    if (!u || u.status !== 'TRANSPORTING' || u.destNode === null) return { ok: false, reason: 'Unit is not transporting' };
    const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
    const h = st.hospitals?.[u.destNode];
    if (!inc || !h) return { ok: false, reason: 'No receiving hospital' };
    if (h.prealerts.includes(inc.id)) return { ok: false, reason: 'Already pre-alerted' };
    h.prealerts.push(inc.id);
    const need = this.patientNeed(inc);
    this.radio('DISPATCH', `${h.name}, dispatch: ${u.spoken} inbound with one${need !== 'general' ? `, ${need} patient` : ''}, ETA ${Math.max(1, Math.round((u.eta ?? 60) / 60))} minutes.`, 'dispatch', u.id, inc.id);
    const ok = this.hospitalSuits(h, need, inc.severity);
    this.radio(h.name, ok ? `${h.name} copies — ${need === 'trauma' ? 'trauma bay two' : need === 'cardiac' ? 'cath lab is standing by' : need === 'stroke' ? 'stroke team paged' : need === 'pediatric' ? 'paediatric resus ready' : need === 'burns' ? 'burns team on the way down' : 'bay four'} for ${u.spoken}.` : `${h.name}: we can't take that patient right now — ${h.er >= h.erCap ? 'the ER is full' : `no ${need} capability at the moment`}. Recommend another facility.`, 'hospital', u.id, inc.id);
    return { ok: true };
  }
  /** medics ask where to take the patient; the dispatcher has the bed board */
  private askHospital(inc: Incident, u: Unit) {
    const st = this.state;
    if (inc.hospitalAsked || st.config.mode === 'tutorial') return;
    inc.hospitalAsked = true;
    const need = this.patientNeed(inc);
    const opts = Object.values(st.hospitals ?? {}).filter((h) => !st.closedHospitals.includes(h.node)).map((h) => {
      const k = h.known;
      const eta = this.estimate(u.id, h.node)?.eta ?? 0;
      const status = need === 'general' ? (h.has.length ? 'full hospital' : 'clinic') : h.has.includes(need) ? (k && k.down.includes(need) ? `${need} DOWN` : `${need} ✓`) : `no ${need}`;
      const age = k ? Math.round((st.time - k.at) / 60) : null;
      return { id: String(h.node), label: h.name.replace('Ravenport ', ''), hint: `${status} · ER ${k ? `${k.er}/${h.erCap}` : '?'}${k?.diversion ? ' DIVERT' : ''} · ${Math.max(1, Math.round(eta / 60))} min${age !== null && age >= 2 ? ` · info ${age}m old` : ''}` };
    });
    if (opts.length < 2) return;
    (st.decisions ??= []).push({ id: `d${st.decisions.length + 1}-h${Math.floor(st.time)}`, incId: inc.id, unitId: u.id, at: st.time, expiresAt: st.time + 20, kind: 'hospital', prompt: `${u.spoken}: transporting one${need !== 'general' ? ` — ${need} patient` : ''}. Which hospital?`, options: opts.slice(0, 4), defaultId: String(u.destNode ?? opts[0].id) });
    this.radio(u.spoken, `Dispatch, ${u.spoken}, transporting one${need !== 'general' ? `, ${need} patient` : ''}. Where do you want us?`, 'alert', u.id, inc.id);
  }

  // ── Units ask for access details on the way in ────────────────────────────
  private checkAccess(inc: Incident) {
    const st = this.state;
    if (inc.accessNeeded !== undefined || inc.onView || inc.pursuit || inc.truth.outside) return;
    const first = inc.assignedUnits.map((id) => st.units[id]).find((u) => u && u.status === 'EN_ROUTE' && !isAir(u) && (u.eta ?? 0) > 18 && (u.eta ?? 0) < 75);
    if (!first) return;
    const tags = this.city.districtById[inc.district]?.tags ?? [];
    if (!tags.some((t) => ['residential', 'dense', 'suburb', 'historic', 'highrise', 'campus'].includes(t)) || !this.rng.chance(0.45)) { inc.accessNeeded = null; return; }
    const known = inc.facts.some((f) => f.key === 'access') && inc.briefedAt != null && (inc.briefedFacts ?? 0) > 0;
    inc.accessNeeded = { at: st.time, relayed: known };
    if (!known) this.radio(first.spoken, this.rng.pick([`Dispatch, ${first.spoken} — any access info? Flat number, gate code, which entrance?`, `${first.spoken} to dispatch, can you get us a way in? Is it a flat or a house?`, `Dispatch, ${first.spoken}. How do we get to the patient — any door codes?`]), 'unit', first.id, inc.id);
  }

  // ── A living radio: units talk to each other ──────────────────────────────
  private radioChatter() {
    const st = this.state;
    if (st.config.mode === 'tutorial' || st.time - (st.lastChatter ?? 0) < 16 || !this.rng.chance(0.07)) return;
    const units = Object.values(st.units).filter((u) => !u.temp);
    const say = (from: Unit, to: Unit | null, text: string, incId?: string) => { st.lastChatter = st.time; st.radio.push({ id: `r${st.radio.length}-${Math.floor(st.time * 10)}c`, t: st.time, clock: gameClock(st), from: from.spoken, to: to?.spoken, text, unitId: from.id, incidentId: incId, kind: 'chatter' }); if (st.radio.length > 250) st.radio.shift(); this.emit({ type: 'radio', unitId: from.id }); };
    // crews on the same job coordinate
    const busy = Object.values(st.incidents).filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status) && i.assignedUnits.length >= 2);
    if (busy.length && this.rng.chance(0.6)) {
      const inc = this.rng.pick(busy);
      const us = inc.assignedUnits.map((id) => st.units[id]).filter((u): u is Unit => !!u && !isAir(u));
      if (us.length >= 2) {
        const [a, b] = this.rng.shuffle(us).slice(0, 2);
        const here = a.status === 'ON_SCENE';
        const lines = here ? (a.service === 'fire' ? [`${b.spoken}, ${a.spoken} — come in from the north side, hydrant's on the corner.`, `${b.spoken}, we've got the line in, can you take ventilation?`, `${b.spoken}, ${a.spoken}, staging area is in front of the shop next door.`]
          : a.service === 'medical' ? [`${b.spoken}, ${a.spoken} — patient's in the back room, bring the stretcher round the side.`, `${b.spoken}, we'll need a hand with the lift, it's a carry-down.`, `${b.spoken}, we've got the airway, can you set up the monitor?`]
          : [`${b.spoken}, ${a.spoken} — take the rear, I've got the front door.`, `${b.spoken}, block the road at the junction, keep the crowd back.`, `${b.spoken}, subject went out the back, heading toward the alley.`])
          : [`${b.spoken}, ${a.spoken} — I'm about a minute behind you, I'll come in from the east.`, `${b.spoken}, ${a.spoken}, traffic's heavy on the main road, take the back streets.`, `${b.spoken}, you take point, I'll set up behind you.`];
        say(a, b, this.rng.pick(lines), inc.id);
        return;
      }
    }
    // patrol chatter and general radio life
    const patrol = units.filter((u) => this.onPatrol(u));
    const pool: Array<() => void> = [];
    if (patrol.length >= 2) pool.push(() => { const [a, b] = this.rng.shuffle(patrol).slice(0, 2); say(a, b, this.rng.pick([`${b.spoken}, ${a.spoken} — meet you at the Gas & Go when you're clear?`, `${b.spoken}, heads up, there's a crowd building outside the bar on ${this.city.nodes[a.prevNode].addrStreet}.`, `${b.spoken}, I'll cover your beat for ten, go grab something to eat.`, `${b.spoken}, that silver hatchback is back on ${this.city.nodes[a.prevNode].addrStreet}, keep an eye out.`])); });
    if (patrol.length) pool.push(() => { const a = this.rng.pick(patrol); say(a, null, this.rng.pick([`${a.spoken}, all quiet on ${this.city.nodes[a.prevNode].addrStreet}.`, `${a.spoken}, 10-8, back on patrol.`, `${a.spoken}, slow-rolling past the school, all clear.`])); });
    // crews at quarters, and across services
    const home = units.filter((u) => u.status === 'AVAILABLE' && !this.onPatrol(u) && !isAir(u));
    if (home.length) pool.push(() => { const a = this.rng.pick(home); say(a, null, this.rng.pick(a.service === 'fire' ? [`${a.spoken} back in quarters. Crew's checking the gear — available.`, `${a.spoken}, in quarters. Someone's put dinner on, so naturally the tones will go any second.`, `${a.spoken}, available, doing pump checks on the apron.`] : a.service === 'medical' ? [`${a.spoken}, restocked and available.`, `${a.spoken} clear at base, cleaning the truck — available.`, `${a.spoken}, available. We're down to our last box of gloves, will grab more at the hospital.`] : [`${a.spoken}, available at the station, finishing paperwork.`, `${a.spoken}, clear and available.`])); });
    const pairs = units.filter((u) => u.status === 'RETURNING');
    if (pairs.length && units.length > 3) pool.push(() => { const a = this.rng.pick(pairs); const b = this.rng.pick(units.filter((x) => x.service !== a.service)); if (b) say(a, b, this.rng.pick([`${b.spoken}, ${a.spoken} — thanks for the hand back there.`, `${b.spoken}, good work on that last one.`, `${b.spoken}, ${a.spoken}, coffee's on us next time.`])); });
    if (st.weather !== 'clear') pool.push(() => { const a = this.rng.pick(units); say(a, null, `All units, ${a.spoken} — roads are ${st.weather === 'snow' ? 'icy' : st.weather === 'fog' ? 'thick with fog' : 'slick'} on ${this.city.nodes[a.prevNode].addrStreet}, take it easy out there.`); });
    const heavy = Object.entries(st.districtTraffic).filter(([d, v]) => v > 0.65 && st.config.districts.includes(d));
    if (heavy.length) pool.push(() => { const a = this.rng.pick(units); const [d] = this.rng.pick(heavy); say(a, null, `${a.spoken} — traffic is solid through ${this.city.districtById[d].name}, avoid it if you can.`); });
    if (pool.length) this.rng.pick(pool)();
  }

  /** order a patrol car to stop the next vehicle and run it */
  orderStop(unitId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const u = st.units[unitId];
    if (!u || !this.onPatrol(u)) return { ok: false, reason: 'Only a patrol car out on its beat can make a stop' };
    const node = u.route.length ? u.route[0] : u.prevNode;
    const inc = this.spawnIncident('traffic_stop', this.city.nodes[node].district, { noCall: true, nodeId: node });
    inc.label = 'Traffic stop'; inc.onView = true; inc.callerName = u.callsign;
    this.radio('DISPATCH', `${u.spoken}, see what you can find — pull one over and run it.`, 'dispatch', u.id, inc.id);
    this.radio(u.spoken, `Copy. ${u.spoken} out on a vehicle at ${addressOf(this.city, node)}.`, 'unit', u.id, inc.id);
    this.dispatch(u.id, inc.id, { code: 2, self: true });
    u.timer = 0.5;
    return { ok: true };
  }

  // ── Officer radio requests (ID / warrant / plate checks) ──────────────────
  private static PLATE_TPL = new Set(['traffic_stop', 'collision_minor', 'collision_injury', 'collision_trapped', 'collision_multi', 'dangerous_driving', 'stolen_vehicle', 'street_racing']);
  private static PERSON_TPL = new Set(['domestic_disturbance', 'public_disturbance', 'shoplifting', 'trespassing', 'suspicious_activity', 'burglary_report', 'burglary_progress', 'public_intoxication', 'robbery', 'vandalism', 'unruly_passenger', 'welfare_check', 'missing_person', 'lost_child', 'fireworks', 'hostage_barricade', 'bank_robbery']);

  private rollOfficerCheck(inc: Incident, here: Unit[]) {
    const st = this.state;
    const cop = here.find((u) => u.service === 'police' && !isAir(u) && u.capabilities.includes('patrol'));
    if (!cop || st.time < (inc.sceneAt ?? st.time) + 6) return;
    inc.checkRolled = true;
    const plate = GameEngine.PLATE_TPL.has(inc.templateId);
    const person = GameEngine.PERSON_TPL.has(inc.templateId);
    if (!plate && !person) return;
    const p = inc.templateId === 'traffic_stop' ? 1 : st.config.mode === 'tutorial' ? 0 : 0.55;
    if (!this.rng.chance(p) || st.requests.filter((r) => r.status === 'open').length >= 3) return;
    this.officerRequest(cop, inc, plate ? 'plate' : 'person', !!inc.truth.weapon);
    // a stop sometimes needs both: the plate first, then the driver
    if (inc.templateId === 'traffic_stop' && this.rng.chance(0.35)) this.officerRequest(cop, inc, 'person', false, 14);
  }
  private officerRequest(u: Unit, inc: Incident | null, kind: 'person' | 'plate', risky: boolean, delay = 0) {
    const st = this.state;
    const id = `q${++st.requestCounter}`;
    const r = makeRequest(this.rng, id, u.id, inc?.id ?? null, kind, st.time + delay, risky);
    st.requests.push(r);
    if (st.requests.length > 40) st.requests.splice(0, st.requests.length - 40);
    if (!delay) this.announceRequest(r);
    return r;
  }
  private announceRequest(r: OfficerRequest) {
    const u = this.state.units[r.unitId];
    if (!u) return;
    r.announced = true;
    r.text = requestText(r, u.spoken, this.rng);
    this.radio(u.spoken, r.text, 'alert', u.id, r.incidentId ?? undefined);
    this.emit({ type: 'alert', text: 'Records request' });
  }

  private updateRequests() {
    const st = this.state;
    for (const r of st.requests) {
      if (r.status !== 'open') continue;
      const u = st.units[r.unitId];
      const inc = r.incidentId ? st.incidents[r.incidentId] : undefined;
      if (st.time < r.at) continue;
      if (!r.announced) { this.announceRequest(r); continue; }
      if (!u || (inc && ['RESOLVED', 'CLOSED'].includes(inc.status))) { r.status = 'expired'; continue; }
      const waited = st.time - r.at;
      if (waited > 35 && r.reminded === 0) { r.reminded = 1; this.radio(u.spoken, `Dispatch, ${u.spoken}. Still waiting on that return${r.kind === 'plate' ? ` on ${r.subject}` : ` on ${r.subject.split(' ')[1]}`}.`, 'unit', u.id, r.incidentId ?? undefined); }
      else if (waited > 60 && r.reminded === 1) { r.reminded = 2; this.radio(u.spoken, `Dispatch — ${u.spoken}, I need that return now, subject is getting agitated.`, 'alert', u.id, r.incidentId ?? undefined); }
      else if (waited > 80) {
        r.status = 'expired';
        st.stats.checksMissed++;
        this.radio(u.spoken, `Dispatch, ${u.spoken}. Disregard — no return, we're releasing ${r.kind === 'plate' ? 'the vehicle' : 'the subject'}.`, 'unit', u.id, r.incidentId ?? undefined);
        this.notify(`${u.callsign}'s records request went unanswered`, 'warn', r.incidentId ?? undefined);
        this.checkConsequence(r, 'clear', true);
      }
    }
  }

  /** the dispatcher types a query into the records terminal: returns indexes into the request's database */
  searchRequest(id: string, q: RecordQuery): number[] {
    const r = this.state.requests.find((x) => x.id === id);
    if (!r) return [];
    r.searches++;
    const hits = searchRecords(r, q);
    if (hits.some((i) => r.db[i].match) && !r.ran) { r.ran = true; r.ranAt = this.state.time; }
    return hits;
  }
  /** run exactly what the officer read out (used by bots and tests) */
  runRequest(id: string): OfficerRequest | null {
    const r = this.state.requests.find((x) => x.id === id);
    if (!r) return null;
    this.searchRequest(id, 'last' in r.given ? { last: r.given.last, first: r.given.first, dob: r.given.dob, sex: r.given.sex } : { plate: r.given.plate });
    return r;
  }
  /** ask the officer to repeat the details */
  repeatRequest(id: string) {
    const r = this.state.requests.find((x) => x.id === id);
    const u = r ? this.state.units[r.unitId] : undefined;
    if (!r || !u || r.status !== 'open') return;
    this.radio('DISPATCH', `${u.spoken}, dispatch — say again your subject?`, 'dispatch', u.id, r.incidentId ?? undefined);
    this.radio(u.spoken, requestText(r, u.spoken, this.rng, true), 'unit', u.id, r.incidentId ?? undefined);
  }

  /**
   * the dispatcher radios the return back to the officer. `recordIdx` is the record they chose
   * (-1 = "no record on file"); relaying the wrong person's record is caught by the officer.
   */
  answerRequest(id: string, answer: CheckResult, recordIdx?: number): { ok: boolean; correct?: boolean; mismatch?: boolean; reason?: string } {
    const st = this.state;
    const r = st.requests.find((x) => x.id === id);
    if (!r || r.status !== 'open') return { ok: false, reason: 'Request no longer open' };
    const u = st.units[r.unitId];
    const spoken = u?.spoken ?? 'Unit';
    const hit = recordIdx !== undefined && recordIdx >= 0 ? r.db[recordIdx] : null;
    if (hit && !hit.match) {
      // the officer compares the return with the ID in their hand
      r.mistakes++;
      this.radio('DISPATCH', returnText(spoken, answer, hit), 'dispatch', u?.id, r.incidentId ?? undefined);
      const g = r.given;
      const why = 'dob' in g ? (hit.person && hit.person.dob !== g.dob ? `date of birth on my subject is ${g.dob}` : `name on the licence is ${g.first} ${g.last}`) : `plate I have is ${g.plate}, ${g.vehicle}`;
      if (u) this.radio(u.spoken, `Negative, dispatch — that's not my subject. The ${why}. Check again.`, 'unit', u.id, r.incidentId ?? undefined);
      st.budget -= 100; st.stats.costs += 100;
      return { ok: true, correct: false, mismatch: true };
    }
    if (recordIdx === -1) answer = 'clear';
    r.status = 'answered'; r.answer = answer; r.answeredAt = st.time; r.correct = answer === r.truth;
    this.radio('DISPATCH', recordIdx === undefined ? `${spoken}, return on ${r.subject}: ${CHECK_LABEL[answer].toLowerCase()}.` : returnText(spoken, answer, hit), 'dispatch', u?.id, r.incidentId ?? undefined);
    if (u) this.radio(u.spoken, replyText(answer, u.spoken), 'unit', u.id, r.incidentId ?? undefined);
    const where = (r.incidentId ? st.incidents[r.incidentId]?.nodeId : undefined) ?? u?.prevNode ?? 0;
    if (r.correct) {
      st.stats.checksOk++;
      const fast = st.time - r.at < 30;
      const b = Math.round((fast ? 380 : 200) * (r.ran ? 1 : 0.5) * (r.mistakes ? 0.6 : 1) * modProduct(st.config, 'bonus'));
      st.stats.bonus += b; st.budget += b;
      this.fx('good', where, `Return ✓ +$${b}`);
    } else {
      st.stats.checksBad++;
      this.fx('bad', where, 'Wrong return');
    }
    this.checkConsequence(r, answer, false);
    return { ok: true, correct: r.correct };
  }

  /** what happens on the street after the officer acts on (or without) the return */
  private checkConsequence(r: OfficerRequest, given: CheckResult, expired: boolean) {
    const st = this.state;
    const u = st.units[r.unitId];
    const inc = r.incidentId ? st.incidents[r.incidentId] : undefined;
    const missedDanger = DANGEROUS.includes(r.truth) && !DANGEROUS.includes(given);
    const falseAlarm = !DANGEROUS.includes(r.truth) && DANGEROUS.includes(given);
    if (given === r.truth) {
      if (r.truth === 'caution' && inc) {
        // officer waits for a second unit before approaching
        inc.requires = mergeReqs(inc.requires, [{ cap: 'patrol', n: 2 }]);
        inc.knownReqs = inc.requires.map((x) => ({ ...x }));
        this.notify(`${u?.callsign ?? 'Unit'} requests a second unit before approaching — send backup`, 'warn', inc.id);
      }
      if (r.truth === 'caution' && inc) inc.growth = Math.max(inc.growth, 0.3);
      if (r.truth === 'stolen' && inc && this.rng.chance(0.35)) {
        if (u) this.radio(u.spoken, `Dispatch, ${u.spoken}! Vehicle's taking off — we're in pursuit!`, 'alert', u.id, inc.id);
        this.chaseFromStop(inc, u);
      } else if (r.truth === 'stolen' && !inc && u && this.onPatrol(u)) {
        // rolling check comes back stolen: the officer lights it up and it runs
        const node = u.route.length ? u.route[0] : u.prevNode;
        const chase = this.spawnIncident('pursuit', this.city.nodes[node].district, { noCall: true, nodeId: node });
        chase.label = 'Stolen vehicle fleeing'; chase.onView = true;
        this.radio(u.spoken, `Dispatch, ${u.spoken}! Lit it up and it's running — in pursuit, ${addressOf(this.city, node)}!`, 'alert', u.id, chase.id);
        this.dispatch(u.id, chase.id, { code: 3, self: true }); u.timer = 0.5;
        this.notify('Stolen car fled from a patrol check — pursuit under way', 'warn', chase.id);
      }
      return;
    }
    if (missedDanger) {
      if (r.truth === 'caution' && inc && this.rng.chance(expired ? 0.5 : 0.75)) {
        if (u) this.radio(u.spoken, `10-33! ${u.spoken} — officer down, officer down! Subject had a weapon!`, 'alert', u.id, inc.id);
        this.consequence(inc, `An officer was attacked after being told ${r.subject} was ${CHECK_LABEL[given].toLowerCase()}`);
        st.reputation = Math.max(0, st.reputation - 2);
        const down = this.spawnConnected(inc, 'officer_down', { noCall: true });
        if (u) { this.detach(u, true); u.status = 'OUT_OF_SERVICE'; u.note = 'Officer injured'; u.timer = 300; u.route = []; u.destNode = null; }
        if (inc.templateId === 'traffic_stop') this.finishIncident(inc, 'success');
        if (down) this.notify('OFFICER DOWN — the subject was armed and dangerous', 'bad', down.id);
      } else if (r.truth === 'stolen' && inc) {
        if (u) this.radio(u.spoken, `Dispatch, ${u.spoken}. Vehicle just took off on us!`, 'alert', u.id, inc.id);
        this.chaseFromStop(inc, u);
      } else {
        st.reputation = Math.max(0, st.reputation - 1);
        this.notify(`A wanted ${r.kind === 'plate' ? 'vehicle owner' : 'person'} was released — the warrant was missed`, 'bad', r.incidentId ?? undefined);
        if (inc) this.consequence(inc, `A wanted subject (${r.subject}) was let go`);
      }
    } else if (falseAlarm) {
      const cost = 1500;
      st.stats.costs += cost; st.budget -= cost; st.reputation = Math.max(0, st.reputation - 1);
      this.notify(`Wrongful detention complaint — ${r.subject} had no warrant (−$${cost})`, 'bad', r.incidentId ?? undefined);
      if (inc) this.consequence(inc, `${r.subject} was wrongly detained on a bad records return`);
    }
  }

  private chaseFromStop(stop: Incident, u: Unit | undefined) {
    const child = this.spawnConnected(stop, 'pursuit');
    if (!child) return;
    child.label = 'Vehicle fled traffic stop';
    if (u && u.assignedIncidentId === stop.id) { this.detach(u, true); u.status = 'AVAILABLE'; this.dispatch(u.id, child.id, { code: 3, self: true }); u.timer = 1; }
    if (stop.templateId === 'traffic_stop') this.finishIncident(stop, 'success');
  }

  /** officers on patrol pull cars over on their own — it ties them up and generates records requests */
  private trafficStops() {
    const st = this.state;
    if (st.config.mode === 'tutorial' || st.time < st.nextStopAt || st.time > st.config.durationSec - 60) return;
    st.nextStopAt = st.time + 110 + this.rng.range(0, 100) / Math.max(0.6, DIFFICULTY[st.config.difficulty].rate);
    if (st.dispatcherLoad > 0.8 || st.requests.filter((r) => r.status === 'open').length >= 2) return;
    const free = Object.values(st.units).filter((u) => this.onPatrol(u) && checkCrew(st, u) && st.config.districts.includes(this.city.nodes[u.prevNode].district));
    if (free.length < 2) return;
    const u = this.rng.pick(free);
    if (this.rng.chance(0.4)) {
      // a rolling check: the officer runs the car in front without stopping it yet
      const r = this.officerRequest(u, null, 'plate', true);
      r.text = `Dispatch, ${u.spoken}. Rolling plate check, I'm behind it on ${this.city.nodes[u.prevNode].addrStreet}: ${r.text?.split(': ').slice(1).join(': ') ?? r.subject}`;
      return;
    }
    // the car pulls someone over right where it is
    const node = u.route.length ? u.route[0] : u.prevNode;
    const inc = this.spawnIncident('traffic_stop', this.city.nodes[node].district, { noCall: true, nodeId: node });
    inc.label = 'Traffic stop'; inc.onView = true; inc.callerName = u.callsign;
    this.radio(u.spoken, this.rng.pick([`Dispatch, ${u.spoken}. Show me out on a traffic stop, ${addressOf(this.city, node)}.`, `${u.spoken}, traffic stop at ${addressOf(this.city, node)} — speeding, one occupant.`, `Dispatch, ${u.spoken}, I'll be out with a vehicle at ${addressOf(this.city, node)}, ran the red.`]), 'unit', u.id, inc.id);
    this.dispatch(u.id, inc.id, { code: 2, self: true });
    u.timer = 0.5;
  }

  /** officers on patrol come across incidents themselves and call for the help they need */
  private onViewTick() {
    const st = this.state;
    if (st.nextOnViewAt === undefined) { st.nextOnViewAt = st.time + 200 + this.rng.range(0, 160); return; }
    if (st.time < st.nextOnViewAt || st.config.mode === 'tutorial' || st.config.script || st.time > st.config.durationSec - 90) return;
    st.nextOnViewAt = st.time + 220 + this.rng.range(0, 200);
    if (st.dispatcherLoad > 0.85) return;
    const free = Object.values(st.units).filter((u) => this.onPatrol(u) && checkCrew(st, u) && st.config.districts.includes(this.city.nodes[u.prevNode].district));
    if (free.length < 2) return;
    const u = this.rng.pick(free);
    const node = u.route.length ? u.route[0] : u.prevNode;
    const pool: Array<[string, string]> = [
      ['collision_injury', "I've come across a two-car collision — one injured. Start me EMS."],
      ['collision_minor', 'I have a minor collision blocking the lane, no injuries so far.'],
      ['public_disturbance', "I've got a fight outside a bar here, multiple subjects. I need another unit."],
      ['vehicle_fire', 'Vehicle on fire at the side of the road — start me fire!'],
      ['public_intoxication', "I've got a male down on the sidewalk, intoxicated. Requesting medical to check him over."],
      ['fall_elderly', 'Flagged down by a pedestrian — elderly female has fallen, hip injury. Start me an ambulance.'],
    ];
    const [tpl, say] = this.rng.pick(pool.filter(([t]) => TEMPLATE_BY_ID[t]));
    const inc = this.spawnIncident(tpl, this.city.nodes[node].district, { noCall: true, nodeId: node });
    inc.onView = true; inc.callerName = u.callsign;
    this.radio(u.spoken, `Dispatch, ${u.spoken}, on-view at ${addressOf(this.city, node)}: ${say}`, 'alert', u.id, inc.id);
    this.notify(`${u.callsign} on-view: ${inc.label} — send what they need`, 'warn', inc.id);
    this.dispatch(u.id, inc.id, { code: 3, self: true });
    u.timer = 0.5;
  }

  // ── Air support ───────────────────────────────────────────────────────────
  private fly(u: Unit, tx: number, ty: number, dt: number, mult = 1) {
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    const step = AIR_SPEED * mult * dt * (this.state.weather === 'fog' ? 0.85 : 1);
    if (d <= step) { u.x = tx; u.y = ty; } else { u.x += (dx / d) * step; u.y += (dy / d) * step; }
    u.speed = Math.min(d / dt, AIR_SPEED * mult);
  }
  private airHome(u: Unit) { u.status = 'RETURNING'; u.destNode = u.postNode; u.route = []; u.note = undefined; }

  private updateAir(u: Unit, dt: number) {
    const st = this.state, city = this.city;
    const airborne = u.status === 'EN_ROUTE' || u.status === 'ON_SCENE' || u.status === 'RETURNING';
    u.fuel ??= 100;
    if (airborne) u.fuel = Math.max(0, u.fuel - dt * 100 / 420);
    const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
    if (airborne && u.status !== 'RETURNING') {
      const why = st.weather === 'storm' ? "Weather's beyond our limits — we're returning to base." : u.fuel < 15 ? 'Bingo fuel — returning to base to refuel.' : null;
      if (why) {
        this.radio(u.spoken, `Dispatch, ${u.spoken}. ${why}`, 'alert', u.id, inc?.id);
        this.notify(`${u.callsign} returning to base — ${st.weather === 'storm' ? 'weather' : 'low fuel'}`, 'warn', inc?.id);
        if (inc) this.detach(u, true);
        this.airHome(u);
        return;
      }
    }
    if (airborne && Math.floor(st.time / dt) % 4 === 0) u.prevNode = city.nearestNode(u.x, u.y);
    switch (u.status) {
      case 'DISPATCHED': {
        u.timer -= dt;
        if (u.timer > 0) break;
        if (!inc || inc.reportedNode === null) { u.status = 'AVAILABLE'; u.assignedIncidentId = undefined; break; }
        u.status = 'EN_ROUTE';
        this.radio(u.spoken, `Dispatch, ${u.spoken}. Wheels up, en route to ${addressOf(city, inc.reportedNode)}.`, 'unit', u.id, inc.id);
        this.emit({ type: 'status', unitId: u.id });
        break;
      }
      case 'EN_ROUTE': case 'ON_SCENE': {
        if (!inc || ['RESOLVED', 'CLOSED'].includes(inc.status)) { u.assignedIncidentId = undefined; this.airHome(u); break; }
        const m = inc.pursuit ? inc.mover : null;
        const locked = !!m && m.heliId === u.id;
        const n = city.nodes[inc.reportedNode ?? inc.nodeId];
        const tx = locked ? m!.x : n.x, ty = locked ? m!.y : n.y;
        const d = Math.hypot(tx - u.x, ty - u.y);
        if (u.status === 'EN_ROUTE') {
          this.fly(u, tx, ty, dt);
          u.eta = d / AIR_SPEED;
          if (d < 26) {
            u.status = 'ON_SCENE'; u.eta = 0;
            this.emit({ type: 'arrive', unitId: u.id });
            if (m) { u.note = locked ? 'Eyes on suspect' : 'Searching'; if (!locked) this.radio(u.spoken, `Dispatch, ${u.spoken}. Over the last known position — searching with the camera.`, 'unit', u.id, inc.id); }
            else { u.note = 'Overhead'; this.radio(u.spoken, `Dispatch, ${u.spoken}. Overhead ${addressOf(city, inc.reportedNode ?? inc.nodeId)}, providing air support.`, 'unit', u.id, inc.id); }
          }
        } else {
          // orbit the scene, or sit right on top of the vehicle we are tracking
          const ang = st.time * (locked ? 1.4 : 0.55) + u.id.charCodeAt(u.id.length - 1);
          const r = locked ? 14 : 36;
          this.fly(u, tx + Math.cos(ang) * r, ty + Math.sin(ang) * r, dt, locked ? 1.3 : 0.45);
          if (!locked && d > 110) { u.status = 'EN_ROUTE'; u.note = undefined; }
          if (m && !locked) u.note = 'Searching';
        }
        break;
      }
      case 'RETURNING': {
        const n = city.nodes[u.postNode];
        const d = Math.hypot(n.x - u.x, n.y - u.y);
        this.fly(u, n.x, n.y, dt);
        u.eta = d / AIR_SPEED;
        if (d < 2) {
          u.x = n.x; u.y = n.y; u.prevNode = u.postNode; u.eta = 0; u.speed = 0; u.destNode = null; u.assignedIncidentId = undefined;
          const need = 100 - u.fuel;
          if (need > 6) { u.status = 'BUSY'; u.timer = 10 + need * 0.8; u.note = 'Refuelling'; }
          else { u.status = 'AVAILABLE'; u.note = undefined; u.fuel = 100; }
          this.emit({ type: 'status', unitId: u.id });
        }
        break;
      }
      case 'BUSY': {
        u.timer -= dt;
        if (u.timer > 0) break;
        const n = city.nodes[u.postNode];
        if (Math.hypot(n.x - u.x, n.y - u.y) < 4) {
          const refuelled = u.note === 'Refuelling';
          u.status = 'AVAILABLE'; u.fuel = 100; u.note = undefined;
          if (refuelled) this.radio(u.spoken, `Dispatch, ${u.spoken}. Refuelled and available.`, 'unit', u.id);
        } else { u.assignedIncidentId = undefined; this.airHome(u); }
        break;
      }
      case 'OUT_OF_SERVICE': {
        if (u.timer > 0) { u.timer -= dt; if (u.timer <= 0) { u.status = 'AVAILABLE'; u.note = undefined; } }
        break;
      }
      default: break;
    }
  }

  private compass(heading: number): string {
    const a = ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return ['eastbound', 'southbound', 'westbound', 'northbound'][Math.round(a / (Math.PI / 2)) % 4];
  }
  /** street the vehicle is on and the next cross street, for air-to-ground commentary */
  private moverWhere(m: NonNullable<Incident['mover']>): { street: string; cross: string; dir: string } {
    const city = this.city;
    const ahead = m.next >= 0 ? m.next : m.prev;
    const eid = m.next >= 0 ? city.edgeBetween.get(m.prev * 100000 + m.next) : undefined;
    const street = eid !== undefined ? city.edges[eid].name : city.nodes[ahead].addrStreet;
    const n = city.nodes[ahead];
    const cross = n.addrStreet === street ? n.crossStreet : n.addrStreet;
    return { street, cross, dir: this.compass(m.heading) };
  }
  private straightAhead(from: number, at: number): number {
    const city = this.city;
    const a = city.nodes[from], b = city.nodes[at];
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    let best = -1, bd = 0.9;
    for (const eid of city.adj[at]) {
      const e = city.edges[eid];
      const n = e.a === at ? e.b : e.a;
      if (n === from || this.closedMask[eid]) continue;
      const c = city.nodes[n];
      let diff = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - dir);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < bd) { bd = diff; best = n; }
    }
    return best;
  }

  /** ask the aircraft where the suspect is right now */
  askAir(incId: string): { ok: boolean; reason?: string } {
    const st = this.state;
    const inc = st.incidents[incId];
    const m = inc?.mover;
    if (!inc || !m) return { ok: false, reason: 'No pursuit selected' };
    const h = inc.assignedUnits.map((id) => st.units[id]).find((u) => u && isAir(u));
    if (!h) return { ok: false, reason: 'No air unit assigned to this pursuit' };
    this.radio('DISPATCH', `${h.spoken}, dispatch. What's your suspect's location?`, 'dispatch', h.id, inc.id);
    if (m.heliId === h.id) { this.heliCommentary(inc, h, true); return { ok: true }; }
    this.radio(h.spoken, h.status === 'ON_SCENE' ? `Dispatch, ${h.spoken}. Negative contact — still searching around ${addressOf(this.city, inc.reportedNode ?? inc.nodeId)}.` : `Dispatch, ${h.spoken}. Not on scene yet, ${Math.max(5, Math.round((h.eta ?? 0) / 5) * 5)} seconds out.`, 'unit', h.id, inc.id);
    return { ok: true };
  }
  private heliCommentary(inc: Incident, h: Unit, asked = false) {
    const m = inc.mover!;
    const w = this.moverWhere(m);
    const lines = [
      `Suspect ${w.dir} on ${w.street}, approaching ${w.cross}.`,
      `Vehicle still ${w.dir} on ${w.street} — coming up on ${w.cross}, speed increasing.`,
      `He's on ${w.street} ${w.dir}, next junction ${w.cross}. Ground units, he's running lights.`,
      `Still got him. ${w.street}, ${w.dir}, toward ${w.cross}.`,
    ];
    m.lastHeliReport = this.state.time;
    this.radio(h.spoken, `${asked ? 'Dispatch, ' + h.spoken + '. ' : ''}${this.rng.pick(lines)}`, 'unit', h.id, inc.id);
  }

  /** dispatcher relays the aircraft's position: ground units are sent to an intercept point ahead of the suspect */
  relayAir(incId: string): { ok: boolean; reason?: string } {
    const st = this.state, city = this.city;
    const inc = st.incidents[incId];
    const m = inc?.mover;
    if (!inc || !m || ['RESOLVED', 'CLOSED'].includes(inc.status)) return { ok: false, reason: 'No active pursuit' };
    const h = m.heliId ? st.units[m.heliId] : undefined;
    if (!h) return { ok: false, reason: 'Air support has no eyes on the suspect' };
    let prev = m.next >= 0 ? m.prev : m.came, node = m.next >= 0 ? m.next : m.prev;
    for (let k = 0; k < 2 && prev >= 0; k++) { const a = this.straightAhead(prev, node); if (a < 0) break; prev = node; node = a; }
    inc.reportedNode = node; inc.relayedAt = st.time; m.lastUpdate = st.time;
    st.stats.heliRelays++;
    const w = this.moverWhere(m);
    const ground = inc.assignedUnits.map((id) => st.units[id]).filter((u): u is Unit => !!u && !isAir(u));
    const names = ground.slice(0, 3).map((u) => u.spoken).join(', ');
    this.radio('DISPATCH', `All units, ${h.spoken} has the suspect ${w.dir} on ${w.street}.${names ? ` ${names} — set up to intercept at ${addressOf(city, node)}.` : ' Any unit able, respond.'}`, 'dispatch', undefined, inc.id);
    for (const u of ground) if (u.status === 'EN_ROUTE') { this.routeUnit(u, node, true); u.note = undefined; }
    const g = ground.find((u) => u.status === 'EN_ROUTE');
    if (g) this.radio(g.spoken, this.rng.pick(['Copy, moving to intercept.', `${g.spoken} copies, en route to the intercept.`, 'Copy that — cutting across now.']), 'unit', g.id, inc.id);
    this.fx('info', node, 'Intercept point');
    return { ok: true };
  }

  // ── Mutual aid ────────────────────────────────────────────────────────────
  requestMutualAid(incId: string, cap: Capability): { ok: boolean; reason?: string } {
    const st = this.state;
    const inc = st.incidents[incId];
    if (!inc || inc.reportedNode === null) return { ok: false, reason: 'Set the incident location first' };
    if (inc.mutualAid >= 2) return { ok: false, reason: 'Mutual aid limit reached for this incident' };
    const defs = Object.values(UNIT_TYPE_BY_ID).filter((d) => d.caps.includes(cap) && d.minRank < 99).sort((a, b) => a.cost - b.cost);
    const def = defs[0];
    if (!def) return { ok: false, reason: 'No such resource' };
    const cost = 4000;
    inc.mutualAid++; st.stats.mutualAid++;
    st.stats.costs += cost; st.budget -= cost;
    // enters from the nearest edge of the city
    const n = this.city.nodes[inc.reportedNode];
    const edgeNodes = this.city.nodes.filter((x) => x.i === 0 || x.i === 40 || x.j === 0);
    let best = edgeNodes[0], bd = Infinity;
    for (const e of edgeNodes) { const d = Math.hypot(e.x - n.x, e.y - n.y); if (d < bd) { bd = d; best = e; } }
    const fakeStation: Station = { id: 'mutual', name: 'Mutual aid', service: def.service, nodeId: best.id, district: best.district, capacity: 99, disabledShifts: 0 };
    const idn = 9000 + Object.keys(st.units).length + st.uniqueNameCounter++;
    const u = makeUnit(def, fakeStation, Object.values(st.units), idn);
    u.id = `ma${idn}`; u.callsign = `MA-${numWord(st.uniqueNameCounter).toUpperCase()}`; u.spoken = `Mutual Aid ${numWord(st.uniqueNameCounter)}`;
    u.temp = true; u.minCrew = 0; u.stationId = 'mutual'; u.speedModifier = def.speed * 0.95; u.timer = 18; u.postNode = best.id;
    st.units[u.id] = u;
    this.notify(`Mutual aid requested: ${CAP_LABEL[cap]} (−$${cost.toLocaleString()})`, 'info', incId);
    this.dispatch(u.id, incId);
    return { ok: true };
  }

  // ── Radio queries ─────────────────────────────────────────────────────────
  radioQuery(unitId: string): string {
    const st = this.state;
    const u = st.units[unitId];
    if (!u) return '';
    if (u.checkDue != null && u.status === 'ON_SCENE') return this.statusCheck(u.id).text ?? '';
    this.radio('DISPATCH', `${u.spoken}, status check.`, 'dispatch', u.id);
    const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
    const eta = u.eta ?? 0;
    const t = eta >= 60 ? `about ${Math.round(eta / 60)} minute${Math.round(eta / 60) === 1 ? '' : 's'}` : `${Math.max(5, Math.round(eta / 5) * 5)} seconds`;
    let msg: string;
    switch (u.status) {
      case 'AVAILABLE': msg = `Dispatch, ${u.spoken}. Available${u.postNode ? ` at ${addressOf(this.city, u.postNode)}` : ''}.`; break;
      case 'DISPATCHED': msg = `Dispatch, ${u.spoken}. Mobilising now.`; break;
      case 'EN_ROUTE': msg = `Dispatch, ${u.spoken}. En route to ${inc ? addressOf(this.city, inc.reportedNode ?? inc.nodeId) : 'the scene'}, ${t} out.`; break;
      case 'ON_SCENE': {
        if (inc) {
          const cov = matchCoverage(inc.requires, this.onScene(inc));
          const pct = Math.min(99, Math.round((inc.workProgress / Math.max(1, inc.work)) * 100));
          const pt = inc.lifeThreat && inc.careAt != null && inc.survival !== undefined ? ` Patient ${inc.survival > 66 ? 'stable for now' : inc.survival > 35 ? 'critical but holding' : 'in a very bad way'}.` : '';
          msg = u.note === 'Nothing found' ? `Dispatch, ${u.spoken}. Still nothing at this address. Need a verified location.` : cov.missing.length && inc.sceneSeen ? `Dispatch, ${u.spoken}. On scene, about ${pct} percent through — we need ${reqText(cov.missing)}.${pt}` : `Dispatch, ${u.spoken}. On scene, about ${pct} percent done${inc.threat > 70 ? ', situation is deteriorating' : ''}.${pt}`;
        } else msg = `Dispatch, ${u.spoken}. On scene.`;
        break;
      }
      case 'TRANSPORTING': msg = `Dispatch, ${u.spoken}. Transporting, ${t} from the hospital.`; break;
      case 'RETURNING': msg = `Dispatch, ${u.spoken}. Returning to ${addressOf(this.city, u.postNode)}, ${t} out.`; break;
      case 'BUSY': msg = `Dispatch, ${u.spoken}. Tied up for a few more moments.`; break;
      default: msg = `Dispatch, ${u.spoken}. Out of service${u.note ? ` — ${u.note.toLowerCase()}` : ''}.`;
    }
    if (isAir(u)) msg = msg.replace(/\.$/, '') + `. Fuel ${Math.round(u.fuel ?? 100)} percent.`;
    this.radio(u.spoken, msg, 'unit', u.id, inc?.id);
    return msg;
  }

  // ── Dispatch planning helpers (UI) ────────────────────────────────────────
  private impactCache = new Map<string, { t: number; v: { service: Service; before: number; after: number; exposed: string | null } }>();
  /** how much of the active city loses its sub-100 s cover for this service if the unit leaves */
  coverageImpact(unitId: string): { service: Service; before: number; after: number; exposed: string | null } | null {
    const st = this.state;
    const u = st.units[unitId];
    if (!u || !['AVAILABLE', 'RETURNING'].includes(u.status) || isAir(u)) return null;
    const key = `${unitId}:${Math.floor(st.time / 3)}`;
    const c = this.impactCache.get(unitId);
    if (c && Math.floor(c.t / 3) === Math.floor(st.time / 3)) return c.v;
    void key;
    const thr = 100;
    const nodes = st.config.districts.flatMap((d) => this.city.nodesInDistrict[d]);
    const before = this.coverageTimes(u.service);
    const sources: Array<{ node: number; offset: number }> = [];
    for (const o of Object.values(st.units)) {
      if (o.id === u.id || o.service !== u.service || o.temp || isAir(o)) continue;
      if (o.status === 'AVAILABLE') sources.push({ node: o.prevNode, offset: this.mobilizationTime(o) });
      else if (o.status === 'RETURNING' && o.destNode !== null && !o.assignedIncidentId) sources.push({ node: o.destNode, offset: this.mobilizationTime(o) + Math.max(0, o.eta ?? 0) });
    }
    const after = sources.length ? multiSourceTimes(this.city, sources, this.tm(true), 1) : new Float32Array(this.city.nodes.length).fill(Infinity);
    const frac = (t: Float32Array) => nodes.filter((n) => t[n] <= thr).length / Math.max(1, nodes.length);
    let exposed: string | null = null, worst = 0;
    for (const d of st.config.districts) {
      const ids = this.city.nodesInDistrict[d];
      const drop = (ids.filter((n) => before[n] <= thr).length - ids.filter((n) => after[n] <= thr).length) / ids.length;
      if (drop > worst) { worst = drop; exposed = drop > 0.35 ? this.city.districtById[d].name : null; }
    }
    const v = { service: u.service, before: frac(before), after: frac(after), exposed };
    this.impactCache.set(unitId, { t: st.time, v });
    return v;
  }
  private previewCache = new Map<string, { t: number; path: number[] }>();
  previewRoute(unitId: string, nodeId: number): number[] {
    const u = this.state.units[unitId];
    if (!u) return [];
    const key = `${unitId}:${nodeId}`;
    const c = this.previewCache.get(key);
    if (c && this.state.time - c.t < 3) return c.path;
    if (isAir(u)) return [u.prevNode, nodeId];
    const start = u.route.length && ['EN_ROUTE', 'RETURNING', 'DISPATCHED'].includes(u.status) ? u.route[0] : u.prevNode;
    const r = findRoute(this.city, start, nodeId, this.tm(true), this.unitSpeedFactor(u));
    const path = r ? [start, ...r.path] : [];
    this.previewCache.set(key, { t: this.state.time, path });
    return path;
  }
  /** nearest free units that together cover the suggested response */
  buildPlan(incId: string, reqs: Req[]): { units: Array<{ unit: Unit; covers: Capability[]; eta: number }>; uncovered: Capability[] } {
    const st = this.state;
    const inc = st.incidents[incId];
    const out: Array<{ unit: Unit; covers: Capability[]; eta: number }> = [];
    const uncovered: Capability[] = [];
    if (!inc || inc.reportedNode === null) return { units: out, uncovered };
    const assigned = inc.assignedUnits.map((id) => st.units[id]).filter(Boolean);
    const chosen = new Set<string>();
    for (const r of reqs) {
      let have = assigned.filter((u) => u.capabilities.includes(r.cap)).length + out.filter((x) => x.unit.capabilities.includes(r.cap)).length;
      for (const x of out) if (x.unit.capabilities.includes(r.cap) && !x.covers.includes(r.cap)) x.covers.push(r.cap);
      while (have < r.n) {
        const cands = Object.values(st.units).filter((u) => !chosen.has(u.id) && !inc.assignedUnits.includes(u.id) && u.capabilities.includes(r.cap) && (u.status === 'AVAILABLE' || (u.status === 'RETURNING' && !u.assignedIncidentId)) && checkCrew(st, u))
          .map((u) => ({ u, eta: this.estimate(u.id, inc.reportedNode!)?.eta ?? Infinity }))
          .sort((a, b) => a.eta - b.eta || a.u.capabilities.length - b.u.capabilities.length);
        if (!cands.length || !isFinite(cands[0].eta)) { uncovered.push(r.cap); break; }
        chosen.add(cands[0].u.id);
        out.push({ unit: cands[0].u, covers: [r.cap], eta: cands[0].eta });
        have++;
      }
    }
    return { units: out, uncovered };
  }

  // ── Coverage ──────────────────────────────────────────────────────────────
  coverageTimes(service: Service): Float32Array {
    const c = this.covCache[service];
    if (c && this.state.time - c.t < 3) return c.times;
    const sources: Array<{ node: number; offset: number }> = [];
    for (const u of Object.values(this.state.units)) {
      if (u.service !== service || u.temp || isAir(u)) continue;
      if (u.status === 'AVAILABLE') sources.push({ node: u.prevNode, offset: this.mobilizationTime(u) });
      else if (u.status === 'RETURNING' && u.destNode !== null && !u.assignedIncidentId) sources.push({ node: u.destNode, offset: this.mobilizationTime(u) + Math.max(0, (u.eta ?? 0)) });
    }
    const times = sources.length ? multiSourceTimes(this.city, sources, this.tm(true), 1) : new Float32Array(this.city.nodes.length).fill(Infinity);
    this.covCache[service] = { t: this.state.time, times };
    return times;
  }
  sampleCoverage() {
    const st = this.state;
    const thr = 100;
    const active = st.config.districts;
    const nodeIds = active.flatMap((d) => this.city.nodesInDistrict[d]);
    const cov: Record<string, number[]> = {};
    for (const s of ['police', 'fire', 'medical'] as const) {
      const t = this.coverageTimes(s);
      const ok = nodeIds.filter((n) => t[n] <= thr).length / Math.max(1, nodeIds.length);
      st.stats.coverageSamples[s].push(ok);
      for (const d of active) {
        const ids = this.city.nodesInDistrict[d];
        (cov[d] ??= []).push(ids.filter((n) => t[n] <= thr).length / ids.length / 3);
      }
    }
    for (const d of Object.keys(cov)) {
      const sum = cov[d].reduce((a, b) => a + b, 0);
      (st.stats.districtCoverage[d] ??= []).push(sum);
    }
    st.lastCoverage = (st.stats.coverageSamples.police.at(-1)! + st.stats.coverageSamples.fire.at(-1)! + st.stats.coverageSamples.medical.at(-1)!) / 3;
  }

  // ── End of shift ──────────────────────────────────────────────────────────
  private checkEnd() {
    const st = this.state;
    // the tutorial finishes as soon as every scripted incident has been handled
    if (st.config.mode === 'tutorial' && st.config.script && st.scriptIndex >= st.config.script.length && st.time > 30) {
      const all = Object.values(st.incidents);
      if (all.length && all.every((i) => ['RESOLVED', 'CLOSED'].includes(i.status)) && !Object.values(st.calls).some((c) => c.state === 'ringing' || c.state === 'active' || c.state === 'hold')) {
        if (st.endingAt === null) st.endingAt = st.time + 6;
        if (st.time >= st.endingAt) { this.endShift(); return; }
      }
    }
    if (st.time < st.config.durationSec) return;
    const pendingCalls = Object.values(st.calls).some((c) => c.state === 'ringing' || c.state === 'active');
    if (pendingCalls && st.time < st.config.durationSec + 25) return;
    this.endShift();
  }
  endShift(early = false) {
    const st = this.state;
    if (st.phase === 'ended') return;
    st.phase = 'ended';
    for (const c of Object.values(st.calls)) if (c.state === 'ringing' || c.state === 'active' || c.state === 'hold') { c.state = c.state === 'ringing' ? 'missed' : 'ended'; c.endedAt = st.time; }
    for (const inc of Object.values(st.incidents)) {
      if (['RESOLVED', 'CLOSED'].includes(inc.status)) continue;
      if (inc.truth.outside) continue;
      if (inc.duplicateOf) { inc.outcome = 'merged'; inc.status = 'RESOLVED'; continue; }
      if (inc.templateId === 'traffic_stop') { inc.outcome = 'success'; inc.status = 'RESOLVED'; continue; }
      inc.outcome = inc.hidden ? 'lost' : 'handover';
      if (inc.hidden) { st.stats.mishandled++; if (TEMPLATE_BY_ID[inc.templateId].lethal) { st.stats.casualties++; inc.casualties++; } } else st.stats.handedOver++;
      this.log('failed', `${inc.label}: ${inc.hidden ? 'never handled' : 'handed over to the next shift'}`, { incidentId: inc.id, good: false });
    }
    void early;
    st.scoreBreakdown = computeScore(st);
    evaluateObjectives(st);
    this.log('info', `Shift complete — grade ${st.scoreBreakdown.grade}`);
    this.emit({ type: 'ended' });
  }
}

export { CLASSES };
export type { Fact, IncidentStatus, Service };
void ({} as Unit);
