import type { GameEngine } from '../sim/engine';
import { Btn, Icon } from './common';

interface Lesson { title: string; hints: string[]; done: (e: GameEngine) => boolean }
const LESSONS: Lesson[] = [
  { title: 'Lesson 1 — Answer a call', hints: ['A call is ringing in the queue on the left.', 'Click ANSWER (or press A). Listen to what the caller says in the transcript at the bottom.'], done: (e) => e.state.stats.callsAnswered >= 1 },
  { title: 'Lesson 2 — Gather information', hints: ['Use the quick-question tabs (Location, Situation) or type your own questions.', 'Ask for the address, then press USE next to what you heard in the right-hand Location panel.', 'Confirmed facts appear under Information.'], done: (e) => Object.values(e.state.incidents).some((i) => i.reportedNode !== null && i.facts.length >= 2) },
  { title: 'Lesson 3 — Dispatch responders', hints: ['The right panel lists available units sorted by ETA. ★ marks units that match the suggested response.', 'Press DISPATCH on a fire engine. You can also tell the caller “help is on the way”.'], done: (e) => Object.values(e.state.incidents).some((i) => i.everAssigned.length >= 1) },
  { title: 'Lesson 4 — Monitor the incident', hints: ['Watch the unit travel along the roads on the map; the ETA counts down.', 'Check the radio tab. When the unit is on scene it reports what it finds.'], done: (e) => Object.values(e.state.units).some((u) => u.status === 'ON_SCENE') || e.state.stats.resolved >= 1 },
  { title: 'Lesson 5 — Handle simultaneous incidents', hints: ['More calls are coming. Hold a call (H) if you must, but don’t leave callers waiting too long.', 'Keep one unit of each service free where you can. Send the nearest suitable unit — a patrol car to the crash, an ambulance to the fall.'], done: (e) => e.state.stats.dispatches >= 3 },
  { title: 'Lesson 6 — Complete the shift', hints: ['Resolve the remaining incidents. Units return to their stations on their own.', 'When everything is closed the shift report appears.'], done: (e) => e.state.phase === 'ended' || e.state.stats.resolved >= 3 },
];
export function coachIndex(e: GameEngine) { const i = LESSONS.findIndex((l) => !l.done(e)); return i === -1 ? LESSONS.length - 1 : i; }
export function coachHint(e: GameEngine) { return `Tutorial: ${LESSONS[coachIndex(e)].title}`; }

export function Coach({ engine, onSkip }: { engine: GameEngine; onSkip: () => void }) {
  const idx = coachIndex(engine);
  const l = LESSONS[idx];
  // all incidents closed → finish the shift early
  const allClosed = engine.state.incidentCounter >= 3 && Object.values(engine.state.incidents).every((i) => ['RESOLVED', 'CLOSED'].includes(i.status));
  return (
    <div className="coach" role="note">
      <div className="coach-head"><Icon n="book" size={14} /><b>{l.title}</b><div className="grow" /><span className="small muted">{idx + 1} / {LESSONS.length}</span></div>
      <div className="coach-dots">{LESSONS.map((x, i) => <i key={i} className={i < idx ? 'done' : i === idx ? 'cur' : ''} />)}</div>
      <ul>{l.hints.map((h, i) => <li key={i}>{h}</li>)}</ul>
      <div className="row gap">
        {allClosed && <Btn kind="primary" size="sm" onClick={() => engine.endShift()}>Finish tutorial</Btn>}
        <Btn size="sm" kind="ghost" onClick={onSkip}>Skip tutorial</Btn>
      </div>
    </div>
  );
}
