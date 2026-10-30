import { CAP_SHORT } from '../sim/units';
import { SEVERITY_LABEL } from '../sim/incidents';
import type { Capability, IncidentStatus, UnitStatus } from '../sim/types';
import type { Note, SlotState } from '../sim/world';
import { CheckCircle2, HelpCircle, AlertTriangle, Dot } from 'lucide-react';

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

const NOTE_ICON = {
  confirmed: <CheckCircle2 size={13} />, unconfirmed: <HelpCircle size={13} />, warning: <AlertTriangle size={13} />, info: <Dot size={13} />,
};
const NOTE_TITLE = { confirmed: 'Confirmed', unconfirmed: 'Unconfirmed: caller unsure', warning: 'Warning', info: 'Info' };
export function NoteList({ notes }: { notes: Note[] }) {
  if (!notes.length) return <p className="muted small">No information yet.</p>;
  return (
    <ul className="notelist">
      {notes.map((n, i) => (
        <li key={i} className={`note ${n.kind}`} title={NOTE_TITLE[n.kind]}>
          <span className="ni">{NOTE_ICON[n.kind]}</span><span>{n.text}</span>
        </li>
      ))}
    </ul>
  );
}
