export type Service = 'police' | 'fire' | 'medical';
export type Capability = 'LAW' | 'TRAFFIC' | 'SECURITY' | 'FIRE' | 'RESCUE' | 'MEDICAL' | 'ADV_MEDICAL';
export type DistrictId = 'downtown' | 'riverside' | 'northside' | 'oldtown' | 'industrial' | 'westbrook';
export type RoadClass = 'arterial' | 'street' | 'narrow' | 'bridge';
export type CellKind = 'building' | 'house' | 'park' | 'industrial';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Weather = 'clear' | 'rain';
export type VehicleId = 'patrol' | 'suv' | 'engine' | 'rescue' | 'ambulance' | 'advanced';
export type UnitStatus = 'AVAILABLE' | 'EN ROUTE' | 'ON SCENE' | 'BUSY' | 'RETURNING' | 'OUT OF SERVICE';
export type IncidentStatus =
  | 'AWAITING DISPATCH' | 'RESPONDING' | 'ON SCENE' | 'COMPLICATION' | 'STABILIZING' | 'RESOLVED' | 'FAILED';

export interface CNode { id: number; x: number; y: number; district: DistrictId; name: string; street: string }
export interface Edge { id: number; a: number; b: number; len: number; cls: RoadClass; district: DistrictId }
export interface Cell { pts: number[]; kind: CellKind; district: DistrictId }
export interface District {
  id: DistrictId; name: string; x: number; y: number; w: number; h: number;
  traffic: number; tint: string; blurb: string;
}
export interface Landmark { name: string; nodeId: number; district: DistrictId }
export interface Station { id: string; name: string; service: Service; nodeId: number; district: DistrictId }
export interface City {
  nodes: CNode[];
  edges: Edge[];
  adj: { to: number; edge: Edge }[][];
  districts: District[];
  cells: Cell[];
  landmarks: Landmark[];
  stations: Station[];
  nodesByDistrict: Record<DistrictId, number[]>;
}
