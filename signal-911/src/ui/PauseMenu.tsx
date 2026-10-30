import { useState } from 'react';
import { useApp } from '../store';
import { Btn, Confirm, Modal } from './common';
import { SettingsPanel } from './Settings';

export function PauseMenu() {
  const setPause = useApp((s) => s.setPauseMenu);
  const engine = useApp((s) => s.engine)!;
  const session = useApp((s) => s.session)!;
  const [view, setView] = useState<'menu' | 'settings' | 'abandon' | 'end'>('menu');
  const career = session.kind === 'career' || session.kind === 'chapter';
  if (view === 'settings') return <Modal title="Settings" onClose={() => setView('menu')} wide><SettingsPanel compact /><div className="row end"><Btn kind="primary" onClick={() => setView('menu')}>Back</Btn></div></Modal>;
  if (view === 'abandon') return <Confirm title="Abandon this shift?" text={career ? 'The shift will be discarded and no rewards will be paid. Your career progress up to now is kept.' : 'The current run will be discarded.'} confirm="Abandon shift" danger onYes={() => { setPause(false); useApp.getState().abandon(); }} onNo={() => setView('menu')} />;
  if (view === 'end') return <Confirm title="End shift now?" text="Remaining incidents will be handed over and the shift report is produced from what has happened so far." confirm="End shift" onYes={() => { setPause(false); engine.endShift(true); }} onNo={() => setView('menu')} />;
  return (
    <Modal title="Paused">
      <div className="menu-list">
        <Btn kind="primary" size="lg" icon="play" onClick={() => setPause(false)}>Resume shift</Btn>
        {career && <Btn size="lg" icon="save" onClick={async () => { await useApp.getState().saveSlot('slot1'); await useApp.getState().saveSlot('auto'); }}>Save career (between-shift progress)</Btn>}
        <Btn size="lg" icon="gear" onClick={() => setView('settings')}>Settings</Btn>
        <Btn size="lg" icon="check" onClick={() => setView('end')}>End shift now</Btn>
        <Btn size="lg" kind="danger" icon="x" onClick={() => setView('abandon')}>Abandon shift</Btn>
      </div>
      <p className="muted small">Career shifts are checkpointed every few seconds; closing the browser keeps your shift so you can resume it from the main menu.</p>
    </Modal>
  );
}
