import type { Capability, Service, UnitStatus, VehicleId, Edge } from './types';

export interface VehicleDef {
  id: VehicleId; name: string; service: Service; caps: Capability[];
  speed: number; personnel: number; cost: number; prefix: string; equipment: string[];
}

export const VEHICLES: Record<VehicleId, VehicleDef> = {
  patrol: { id: 'patrol', name: 'Patrol Car', service: 'police', caps: ['LAW', 'TRAFFIC'], speed: 1.1, personnel: 2, cost: 40, prefix: 'P', equipment: ['Radio', 'Traffic cones'] },
  suv: { id: 'suv', name: 'Police SUV', service: 'police', caps: ['LAW', 'TRAFFIC', 'SECURITY'], speed: 1.0, personnel: 3, cost: 60, prefix: 'PS', equipment: ['Radio', 'Barriers', 'Armor kit'] },
  engine: { id: 'engine', name: 'Fire Engine', service: 'fire', caps: ['FIRE'], speed: 0.9, personnel: 4, cost: 150, prefix: 'E', equipment: ['Hose line', 'Pump'] },
  rescue: { id: 'rescue', name: 'Rescue Truck', service: 'fire', caps: ['RESCUE'], speed: 0.9, personnel: 3, cost: 120, prefix: 'R', equipment: ['Cutting tools', 'Rope kit'] },
  ambulance: { id: 'ambulance', name: 'Ambulance', service: 'medical', caps: ['MEDICAL'], speed: 1.05, personnel: 2, cost: 80, prefix: 'A', equipment: ['First aid', 'Stretcher'] },
  advanced: { id: 'advanced', name: 'Advanced Ambulance', service: 'medical', caps: ['MEDICAL', 'ADV_MEDICAL'], speed: 1.0, personnel: 3, cost: 130, prefix: 'ADV', equipment: ['Cardiac monitor', 'Stretcher'] },
};

export const CAP_LABEL: Record<Capability, string> = {
  LAW: 'Law enforcement', TRAFFIC: 'Traffic control', SECURITY: 'Armed response', FIRE: 'Firefighting',
  RESCUE: 'Rescue', MEDICAL: 'Medical', ADV_MEDICAL: 'Advanced medical',
};
export const CAP_SHORT: Record<Capability, string> = {
  LAW: 'LAW', TRAFFIC: 'TRAFFIC', SECURITY: 'ARMED', FIRE: 'FIRE', RESCUE: 'RESCUE', MEDICAL: 'MED', ADV_MEDICAL: 'ADV MED',
};

export interface Leg { to: number; edge: Edge | null }

export interface Unit {
  id: string; callsign: string; vehicle: VehicleId; service: Service; stationId: string;
  x: number; y: number; node: number; status: UnitStatus; caps: Capability[];
  personnel: number; equipment: string[]; incidentId: number | null;
  legs: Leg[]; eta: number; busyUntil: number;
  upgrades: string[]; condition: number; oosUntil: number;
  /** Arrived at an address the caller got wrong: not covering the real incident. */
  wrongSite: boolean;
}
