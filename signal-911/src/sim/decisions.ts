import type { Capability } from './types';

/** A high-level coordination choice offered when responders reach the real scene. */
export interface DecisionOption {
  id: string; label: string; detail: string; cost?: number;
  /** A unit with this capability must already be on scene. */
  needs?: Capability;
  /** Send the nearest free unit with this capability; the effect starts when it arrives. */
  fetch?: Capability;
  /** Work-rate multiplier and change to complication risk while the measure is active. */
  speed?: number; risk?: number;
  liftBlock?: boolean; supervisor?: boolean;
}
export interface DecisionPoint {
  prompt: string;
  /** Chance an incident of each variation offers this decision at all (others resolve on their own). */
  chance: Record<string, number>;
  options: DecisionOption[];
}

export const CONTINUE: DecisionOption = {
  id: 'continue', label: 'Continue with current resources', detail: 'No extra cost. Nothing changes.',
};
export const SUPERVISOR: DecisionOption = {
  id: 'supervisor', label: 'Escalate to supervisor', cost: 200, supervisor: true, speed: 1.1, risk: -0.05,
  detail: 'Supervisor takes over coordination. Clears 20 s of danger. Limited to 2 per shift.',
};
export const DECISION_SECONDS = 40;
export const SUPERVISORS_PER_SHIFT = 2;

export const DECISIONS: Record<string, DecisionPoint> = {
  collision: {
    prompt: 'Traffic is building up around the collision.',
    chance: { minor: 0, injured: 0.6, multi: 1 },
    options: [
      { id: 'divert', label: 'Coordinate traffic diversions', cost: 60, liftBlock: true, speed: 1.1, risk: -0.1, detail: 'City crews divert traffic. Reopens the closed road.' },
      { id: 'ambulance', label: 'Request an extra ambulance', fetch: 'MEDICAL', speed: 1.25, risk: -0.15, detail: 'More hands for the patients once it arrives.' },
    ],
  },
  fire: {
    prompt: 'The fire is developing. How should the scene be supported?',
    chance: { small: 0.3, smoke: 0.7, trapped: 1, access: 1 },
    options: [
      { id: 'rescue_eq', label: 'Deploy rescue equipment', needs: 'RESCUE', cost: 100, speed: 1.4, risk: -0.25, detail: 'The rescue crew on scene uses specialist equipment.' },
      { id: 'engine', label: 'Request an additional fire engine', fetch: 'FIRE', speed: 1.35, risk: -0.15, detail: 'A second pump once it arrives.' },
      { id: 'perimeter', label: 'Establish a safe perimeter', fetch: 'LAW', risk: -0.3, detail: 'Police hold back the crowd. Lowers the chance of complications.' },
    ],
  },
  medical: {
    prompt: 'The patient is getting worse. How should care be supported?',
    chance: { unclear: 0, chest: 0.5, cardiac: 1, multi: 1 },
    options: [
      { id: 'als', label: 'Request advanced life support', fetch: 'ADV_MEDICAL', speed: 1.3, risk: -0.3, detail: 'Sends the nearest advanced ambulance.' },
      { id: 'second', label: 'Request a second ambulance', fetch: 'MEDICAL', speed: 1.25, risk: -0.15, detail: 'Extra crew to share the patients.' },
      { id: 'prep', label: 'Prepare rapid hospital transfer', cost: 50, speed: 1.15, risk: -0.1, detail: 'The hospital is alerted and ready.' },
    ],
  },
  disturbance: {
    prompt: 'Tension at the scene is rising.',
    chance: { noise: 0, burglary: 0.4, armed: 1 },
    options: [
      { id: 'perimeter', label: 'Establish a safe perimeter', fetch: 'LAW', risk: -0.4, speed: 1.1, detail: 'Backup officers secure the area.' },
      { id: 'deescalate', label: 'Hold position and de-escalate', speed: 0.9, risk: -0.2, detail: 'Slower, but safer. No extra resources.' },
    ],
  },
  water: {
    prompt: 'The current is strong and the swimmer is tiring.',
    chance: { swimmer: 1 },
    options: [
      { id: 'rescue_eq', label: 'Deploy rescue equipment', needs: 'RESCUE', cost: 100, speed: 1.4, risk: -0.25, detail: 'Throw lines and flotation from the rescue truck.' },
      { id: 'medic', label: 'Stage an ambulance at the bank', fetch: 'MEDICAL', risk: -0.2, detail: 'Medical care ready the moment they are out.' },
    ],
  },
  industrial: {
    prompt: 'Hazards on site are unclear. How should the response be supported?',
    chance: { crush: 1, spill: 1 },
    options: [
      { id: 'perimeter', label: 'Establish a safe perimeter', fetch: 'LAW', risk: -0.3, detail: 'Keep workers and onlookers clear.' },
      { id: 'evac', label: 'Prioritize evacuation assistance', needs: 'RESCUE', speed: 1.1, risk: -0.25, detail: 'Rescue crew helps clear the building first.' },
      { id: 'fire', label: 'Request fire support', fetch: 'FIRE', speed: 1.2, risk: -0.2, detail: 'A fire engine stands by on site.' },
    ],
  },
};

/** What goes wrong when the scene itself turns against responders (driven by risk, not neglect). */
export const COMPLICATION_TEXT: Record<string, string> = {
  collision: 'A passing car clips the scene and another person is hurt.',
  fire: 'The wind picks up and the fire jumps to a new section.',
  medical: 'The patient\'s condition suddenly worsens.',
  disturbance: 'The confrontation turns violent and someone is injured.',
  water: 'The current drags the swimmer further out.',
  industrial: 'A second container ruptures.',
};

/** Incidents that can seed another incident next door. */
export const LINKED: Record<string, { on: 'escalation2' | 'complication1'; templateId: string; variationId: string; text: string }> = {
  fire: { on: 'escalation2', templateId: 'fire', variationId: 'small', text: 'Fire has spread to the neighbouring property.' },
  industrial: { on: 'complication1', templateId: 'fire', variationId: 'small', text: 'A fire has started in the next unit.' },
};
