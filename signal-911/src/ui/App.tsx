import { useEffect } from 'react';
import { useGame } from '../store/game';
import { TopBar } from './TopBar';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { BottomPanel } from './BottomPanel';
import { MapCanvas } from './MapCanvas';
import { SummaryModal } from './SummaryModal';

export function App() {
  const phase = useGame((s) => s.phase);
  const toast = useGame((s) => s.toast);

  // One animation-frame loop drives the simulation clock.
  useEffect(() => {
    let last = performance.now();
    let raf = requestAnimationFrame(function frame(now) {
      useGame.getState().tick((now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey) return;
      const g = useGame.getState();
      if (e.code === 'Space') { if (t.tagName === 'BUTTON') return; e.preventDefault(); g.togglePause(); }
      else if (e.key === '1') g.setSpeed(1);
      else if (e.key === '2') g.setSpeed(2);
      else if (e.key === '3') g.setSpeed(4);
      else if (e.key.toLowerCase() === 'm') g.toggleMute();
      else if (e.key === 'Escape') g.clearSelection();
      else if (e.key === 'Enter') { if (t.tagName === 'BUTTON') return; g.confirmDispatch(); }
      else if (e.key.toLowerCase() === 'e') g.hangUp();
      else if (e.key.toLowerCase() === 'a') {
        const c = g.world.calls.find((x) => x.status === 'ringing');
        if (c) g.answer(c.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <LeftPanel />
      <main className="map"><MapCanvas /></main>
      <RightPanel />
      <BottomPanel />
      {phase === 'summary' && <SummaryModal />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
