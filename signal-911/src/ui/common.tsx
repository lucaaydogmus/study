import { CAP_SHORT } from '../sim/units';
import { SEVERITY_LABEL } from '../sim/incidents';
import type { Capability, IncidentStatus, UnitStatus } from '../sim/types';
import type { SlotState } from '../sim/world';

export const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;

export const SevChip = ({ sev }: { sev: number }) => <span className={`chip sev${sev}`} title="Severity">{SEVERITY_LABEL[sev]}</span>;
export const StatusChip = ({ s }: { s: IncidentStatus | UnitStatus }) => (
  <span className={`chip st-${s.toLowerCase().replace(/ /g, '-')}`}>{s}</span>
);
export const CapChip = ({ cap, state }: { cap: Capability; state?: SlotState }) => (
  <span className={`chip cap ${state ?? ''}`}
    title={state === 'met' ? 'Covered by a unit on scene' : state === 'enroute' ? 'Unit en route' : state === 'open' ? 'No unit assigned yet' : undefined}>
    {CAP_SHORT[cap]}
  </span>
);
export const Bar = ({ value, kind, title }: { value: number; kind?: string; title?: string }) => (
  <div className={`bar ${kind ?? ''}`} title={title}><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>
);
