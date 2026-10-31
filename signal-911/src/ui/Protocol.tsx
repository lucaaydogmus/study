// Protocol card: the structured questioning real dispatch centres follow (case entry, key
// questions for the type of emergency, then instructions). Steps tick themselves off as you go.
import type { GameEngine } from '../sim/engine';
import type { Call, Incident } from '../sim/types';

type Step = { id: string; label: string; intent?: string; done: (c: Call, i: Incident) => boolean };
const has = (i: Incident, k: string) => i.facts.some((f) => f.key === k && f.confidence !== 'contradicted');
const asked = (c: Call, k: string) => (c.asked[k] ?? 0) > 0;
const ENTRY: Step[] = [
  { id: 'where', label: 'Location', intent: 'address', done: (c, i) => i.reportedNode !== null },
  { id: 'what', label: 'What happened', intent: 'cause', done: (c, i) => asked(c, 'cause') || asked(c, 'emergency') || has(i, 'cause') },
  { id: 'safe', label: 'Caller safe', intent: 'safe', done: (c, i) => asked(c, 'safe') || has(i, 'safe') },
];
const KEY: Record<string, Step[]> = {
  medical: [
    { id: 'conscious', label: 'Conscious?', intent: 'conscious', done: (c, i) => asked(c, 'conscious') || has(i, 'conscious') },
    { id: 'breathing', label: 'Breathing?', intent: 'breathing', done: (c, i) => asked(c, 'breathing') || has(i, 'breathing') },
    { id: 'age', label: 'Age', intent: 'age', done: (c, i) => asked(c, 'age') || has(i, 'age') },
    { id: 'injuries', label: 'Injuries / bleeding', intent: 'injuries', done: (c, i) => asked(c, 'injuries') || has(i, 'injured') },
  ],
  fire: [
    { id: 'trapped', label: 'Anyone inside?', intent: 'trapped', done: (c, i) => asked(c, 'trapped') || has(i, 'trapped') },
    { id: 'fire', label: 'Flames / smoke', intent: 'fire', done: (c, i) => asked(c, 'fire') || has(i, 'fire') || has(i, 'smoke') },
    { id: 'hazard', label: 'Hazards', intent: 'hazard', done: (c, i) => asked(c, 'hazard') || has(i, 'hazard') },
    { id: 'injuries', label: 'Injuries', intent: 'injuries', done: (c, i) => asked(c, 'injuries') || has(i, 'injured') },
  ],
  police: [
    { id: 'weapon', label: 'Weapons?', intent: 'weapon', done: (c, i) => asked(c, 'weapon') || has(i, 'weapon') },
    { id: 'suspect', label: 'Suspect description', intent: 'suspect', done: (c, i) => asked(c, 'suspect') || has(i, 'suspect_desc') },
    { id: 'injuries', label: 'Anyone hurt?', intent: 'injuries', done: (c, i) => asked(c, 'injuries') || has(i, 'injured') },
    { id: 'vehicles', label: 'Vehicles', intent: 'vehicles', done: (c, i) => asked(c, 'vehicles') || has(i, 'vehicles') },
  ],
  unusual: [
    { id: 'people', label: 'People involved', intent: 'people', done: (c, i) => asked(c, 'people') || has(i, 'people') },
    { id: 'hazard', label: 'Any danger?', intent: 'hazard', done: (c, i) => asked(c, 'hazard') || has(i, 'hazard') },
  ],
};
export function ProtocolCard({ engine, call, inc, onAsk }: { engine: GameEngine; call: Call; inc: Incident; onAsk: (intent: string) => void }) {
  const cat = inc.classification ? (inc.classification.startsWith('medical') ? 'medical' : inc.classification.startsWith('fire') || ['hazmat', 'rescue', 'water'].includes(inc.classification) ? 'fire' : ['collision', 'crime_progress', 'crime_report', 'disturbance', 'welfare'].includes(inc.classification) ? 'police' : 'unusual') : inc.category;
  const steps = [...ENTRY, ...(KEY[cat] ?? KEY.unusual)];
  const dispatched = inc.assignedUnits.length > 0;
  const all = [...steps, { id: 'dispatch', label: 'Units sent', done: () => dispatched } as Step, { id: 'tell', label: 'Tell caller help is coming', intent: 'promise', done: (c: Call) => asked(c, 'promise') || (c.promises?.length ?? 0) > 0 } as Step];
  const n = all.filter((s) => s.done(call, inc)).length;
  void engine;
  return (
    <div className="protocol" aria-label="Protocol card">
      <span className="proto-k">{cat.toUpperCase()} PROTOCOL</span>
      {all.map((s) => {
        const ok = s.done(call, inc);
        return <button key={s.id} className={`proto-step ${ok ? 'ok' : ''}`} disabled={ok || !s.intent} onClick={() => s.intent && onAsk(s.intent)} title={ok ? 'Done' : s.intent ? 'Ask now' : ''}>{ok ? '✓' : '○'} {s.label}</button>;
      })}
      <span className="proto-n mono">{n}/{all.length}</span>
    </div>
  );
}
