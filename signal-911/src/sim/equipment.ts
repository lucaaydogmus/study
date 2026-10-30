import type { Service } from './types';

export interface Equipment {
  id: string; name: string; cost: number; services: Service[] | 'any'; desc: string;
  /** Incident families this equipment helps with (all when omitted). */
  templates?: string[];
  /** Work-rate multiplier and change to scene risk, while a unit carrying it is on scene. */
  speed?: number; risk?: number;
  /** Travel-speed multiplier for the carrying unit. */
  travel?: number;
}

export const EQUIPMENT: Record<string, Equipment> = {
  rescue_kit: {
    id: 'rescue_kit', name: 'Enhanced rescue kit', cost: 3000, services: ['fire'], templates: ['fire', 'water', 'industrial'],
    speed: 1.2, risk: -0.1, desc: 'Fire, water and industrial scenes are worked 20% faster with 10% less risk.',
  },
  adv_med: {
    id: 'adv_med', name: 'Advanced medical kit', cost: 3000, services: ['medical'], templates: ['medical', 'collision'],
    speed: 1.2, risk: -0.08, desc: 'Medical and collision patients are treated 20% faster with 8% less risk.',
  },
  tactical: {
    id: 'tactical', name: 'Tactical gear', cost: 2500, services: ['police'], templates: ['disturbance'],
    speed: 1.15, risk: -0.15, desc: 'Disturbances are resolved 15% faster with 15% less risk.',
  },
  comms: {
    id: 'comms', name: 'Upgraded comms', cost: 1500, services: 'any', travel: 1.06,
    desc: 'Better dispatch coordination: this unit travels 6% faster on every call.',
  },
};

export const MAX_UPGRADES = 2;
export const UPKEEP_PER_UPGRADE = 50;
export const allowedFor = (id: string, service: Service) => {
  const e = EQUIPMENT[id];
  return !!e && (e.services === 'any' || e.services.includes(service));
};
