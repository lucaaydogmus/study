import { X } from 'lucide-react';
import { useGame } from '../store/game';

export function HelpModal() {
  const g = useGame.getState();
  const phase = useGame((s) => s.phase);
  const close = () => g.openHelp(false);
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="card depot help">
        <div className="dhead2"><h1>How to play</h1><span className="spacer" /><button className="icon" onClick={close} title="Close (Esc)"><X size={14} /></button></div>
        <div className="helpgrid">
          <section>
            <h3>A shift</h3>
            <ol className="notes">
              <li><b>Answer</b> ringing calls (<kbd>A</kbd>). Callers have limited patience; every question costs some.</li>
              <li><b>Ask</b> for the address first. Check the notes: ✓ confirmed, ? unconfirmed, ⚠ warnings. Ask again if a caller was unsure.</li>
              <li><b>Dispatch</b> units that fill the capabilities the incident needs. Units marked "not needed" waste money and score.</li>
              <li><b>Watch</b> the danger bar. If needed capabilities are missing, incidents escalate and eventually fail.</li>
              <li><b>Decide</b> when a decision card appears on scene, or let it lapse to carry on with current resources.</li>
            </ol>
            <h3>Between shifts</h3>
            <ul className="notes">
              <li><b>Depot</b>: move, equip, service, buy and sell units. Check the Coverage tab for gaps.</li>
              <li><b>Career</b>: objectives, special events and district challenges.</li>
            </ul>
          </section>
          <section>
            <h3>Keys</h3>
            <ul className="keys">
              <li><kbd>Space</kbd> pause / resume</li><li><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> speed 1× / 2× / 4×</li>
              <li><kbd>A</kbd> answer next call</li><li><kbd>E</kbd> end the call</li>
              <li><kbd>Enter</kbd> confirm dispatch</li><li><kbd>Esc</kbd> close windows / clear selection</li>
              <li><kbd>M</kbd> mute</li><li><kbd>?</kbd> this help</li>
            </ul>
            <h3>Map</h3>
            <p className="muted small">Drag to pan, wheel to zoom, click units, incidents, stations and districts. Dashed ring = unverified address. Red dashed road = closure. Orange "!" = decision waiting.</p>
            <h3>Progress</h3>
            <p className="muted small">Progress saves in this browser only. Nothing is sent anywhere.</p>
            <button className="danger" disabled={phase === 'shift'} title={phase === 'shift' ? 'Finish or end the shift first' : 'Erase money, fleet and career progress'}
              onClick={() => { if (window.confirm('Erase ALL progress (money, fleet, career)? This cannot be undone.')) { g.resetProgress(); close(); } }}>Reset all progress</button>
          </section>
        </div>
      </div>
    </div>
  );
}
