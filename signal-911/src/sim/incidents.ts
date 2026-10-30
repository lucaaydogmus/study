import type { Capability, DistrictId } from './types';

export interface Variation {
  id: string; label: string; severity: number; caps: Capability[]; weight: number; openings: string[];
  /** Base chance of a complication on scene (0-1); decisions can lower it. */
  risk: number;
  /** Chance the incident closes a road once it is known. */
  blockRoad?: number;
  /** Only occurs in these districts. */
  districts?: DistrictId[];
}
export interface Template {
  id: string; title: string; districtWeights: Partial<Record<DistrictId, number>>;
  /** Seconds of on-scene work once all capability slots are covered (scaled by severity). */
  duration: number;
  /** Seconds of unattended time (pressure) per escalation step; each step may add a requirement. */
  escalateEvery: number; escalateAdd: Capability | null; escalateText: string;
  /** Unattended seconds before the incident fails. */
  failAfter: number; failText: string; reward: number;
  variations: Variation[];
}

export const TEMPLATES: Template[] = [
  {
    id: 'collision', title: 'Traffic collision',
    districtWeights: { downtown: 3, industrial: 2, northside: 1, riverside: 1, oldtown: 0.6, westbrook: 0.8 },
    duration: 30, escalateEvery: 70, escalateAdd: 'MEDICAL', escalateText: 'A bystander reports a driver is now unresponsive.',
    failAfter: 160, failText: 'The injured were left unattended too long and traffic backed up across the district.', reward: 200,
    variations: [
      { id: 'minor', risk: 0.1, label: 'No injuries, lane blocked', severity: 1, caps: ['TRAFFIC'], weight: 3,
        openings: ['"Two cars bumped each other and now everyone is arguing in the lane."', '"There was a fender bender, no one seems hurt, but traffic is stuck."'] },
      { id: 'injured', risk: 0.25, blockRoad: 0.5, label: 'Injured passenger', severity: 2, caps: ['MEDICAL', 'TRAFFIC'], weight: 3,
        openings: ['"A car hit a lamp post! The passenger is holding their neck!"', '"Crash at the intersection, someone is hurt and the road is blocked!"'] },
      { id: 'multi', risk: 0.45, blockRoad: 1, label: 'Multiple vehicles', severity: 3, caps: ['MEDICAL', 'MEDICAL', 'TRAFFIC'], weight: 1.5,
        openings: ['"Three cars, maybe four! People are climbing out, some can\'t stand!"', '"It\'s a pile-up, I count several people on the ground!"'] },
    ],
  },
  {
    id: 'fire', title: 'Structure fire',
    districtWeights: { oldtown: 3, downtown: 2, industrial: 1.5, northside: 1.2, westbrook: 1, riverside: 0.7 },
    duration: 45, escalateEvery: 50, escalateAdd: 'FIRE', escalateText: 'The fire is spreading to the next unit. More firefighting capacity is needed.',
    failAfter: 130, failText: 'The fire spread out of control before crews could get it under control.', reward: 320,
    variations: [
      { id: 'small', risk: 0.3, label: 'Contained fire', severity: 2, caps: ['FIRE'], weight: 3,
        openings: ['"There\'s fire coming out of a kitchen window, it hasn\'t gone further yet."', '"Smoke and flames from a ground floor flat!"'] },
      { id: 'smoke', risk: 0.4, label: 'Smoke, injuries', severity: 2, caps: ['FIRE', 'MEDICAL'], weight: 2,
        openings: ['"Thick smoke in the stairwell, a man is coughing badly!"', '"The building is filling with smoke, a woman can\'t breathe!"'] },
      { id: 'trapped', risk: 0.5, label: 'Residents trapped', severity: 3, caps: ['FIRE', 'RESCUE', 'MEDICAL'], weight: 1.2,
        openings: ['"My neighbors are on the third floor, they can\'t get out!"', '"Fire at the apartment block, people are at the windows!"'] },
      { id: 'access', risk: 0.5, districts: ['oldtown'], label: 'Difficult access, spreading', severity: 3, caps: ['FIRE', 'FIRE'], weight: 1.5,
        openings: ['"The street is so narrow nobody can get near the burning house!"', '"Fire in the old row houses and cars are parked right up to the doors!"'] },
    ],
  },
  {
    id: 'medical', title: 'Medical emergency',
    districtWeights: { downtown: 2.5, northside: 1.5, westbrook: 1.2, riverside: 1.2, oldtown: 1.2, industrial: 0.5 },
    duration: 28, escalateEvery: 60, escalateAdd: 'ADV_MEDICAL', escalateText: 'The patient has deteriorated and needs advanced life support.',
    failAfter: 120, failText: 'The patient did not receive medical care in time.', reward: 240,
    variations: [
      { id: 'unclear', risk: 0.1, label: 'Unwell, severity unclear', severity: 1, caps: ['MEDICAL'], weight: 3,
        openings: ['"My dad feels dizzy and keeps sitting down, I\'m not sure what to do."', '"Someone fainted in the shop, they\'re awake now but pale."'] },
      { id: 'chest', risk: 0.3, label: 'Chest pain', severity: 2, caps: ['ADV_MEDICAL'], weight: 2,
        openings: ['"He says his chest is tight and his arm hurts!"', '"My husband is sweating and clutching his chest!"'] },
      { id: 'cardiac', risk: 0.35, label: 'Collapse, not breathing normally', severity: 3, caps: ['ADV_MEDICAL', 'MEDICAL'], weight: 1,
        openings: ['"She just dropped and isn\'t answering me!"', '"He collapsed at the bus stop, someone is helping him!"'] },
      { id: 'multi', risk: 0.3, label: 'Several people unwell', severity: 3, caps: ['MEDICAL', 'MEDICAL'], weight: 0.8,
        openings: ['"A few people at the market suddenly feel sick and weak!"', '"Three of my coworkers are faint and nauseous, something is wrong!"'] },
    ],
  },
  {
    id: 'disturbance', title: 'Disturbance / crime',
    districtWeights: { downtown: 2, oldtown: 1.5, riverside: 1.2, northside: 1, industrial: 1, westbrook: 0.6 },
    duration: 25, escalateEvery: 80, escalateAdd: 'MEDICAL', escalateText: 'Someone has been hurt in the confrontation.',
    failAfter: 170, failText: 'The situation turned violent with no police on scene.', reward: 160,
    variations: [
      { id: 'noise', risk: 0.1, label: 'Noise complaint', severity: 1, caps: ['LAW'], weight: 3,
        openings: ['"The party next door has been going since midnight."', '"Someone is shouting in the street again."'] },
      { id: 'burglary', risk: 0.3, label: 'Break-in', severity: 2, caps: ['LAW'], weight: 2.5,
        openings: ['"I think someone is inside the store, the shutter is bent!"', '"Someone is climbing out of my neighbor\'s window."'] },
      { id: 'armed', risk: 0.6, label: 'Armed suspect reported', severity: 3, caps: ['SECURITY', 'LAW'], weight: 1,
        openings: ['"A man is waving a weapon outside the bar!"', '"There\'s someone with a gun, everyone is running!"'] },
    ],
  },
  {
    id: 'water', title: 'Water rescue',
    districtWeights: { riverside: 3, westbrook: 0.4, downtown: 0.2 },
    duration: 35, escalateEvery: 55, escalateAdd: 'MEDICAL', escalateText: 'The swimmer has been in the water too long and needs medical care.',
    failAfter: 120, failText: 'The swimmer was not reached in time.', reward: 300,
    variations: [
      { id: 'swimmer', risk: 0.5, label: 'Swimmer in difficulty', severity: 2, caps: ['RESCUE', 'MEDICAL'], weight: 1,
        openings: ['"A kid fell off the pier and the current is carrying him!"', '"Someone is struggling in the river by the footbridge!"'] },
    ],
  },
  {
    id: 'industrial', title: 'Industrial accident',
    districtWeights: { industrial: 3 },
    duration: 40, escalateEvery: 60, escalateAdd: 'FIRE', escalateText: 'Material on site has ignited. Firefighting is now required.',
    failAfter: 140, failText: 'The accident site was left without rescue crews and conditions worsened.', reward: 340,
    variations: [
      { id: 'crush', risk: 0.4, label: 'Worker trapped', severity: 3, caps: ['RESCUE', 'MEDICAL'], weight: 1,
        openings: ['"A pallet stack came down on one of our guys, he\'s pinned!"'] },
      { id: 'spill', risk: 0.5, label: 'Leak and minor injuries', severity: 2, caps: ['FIRE', 'MEDICAL'], weight: 1,
        openings: ['"A drum split open in warehouse 4, two people are dizzy."'] },
    ],
  },
];

export const SEVERITY_LABEL = ['', 'Low', 'Moderate', 'High', 'Critical'];
