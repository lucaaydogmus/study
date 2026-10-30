import { useEffect } from 'react';
import { useApp } from './store';
import { audio } from './audio/audioManager';
import { GameScreen } from './ui/Game';
import { HubScreen } from './ui/Hub';
import { ReportScreen } from './ui/Report';
import { BriefingScreen, EndlessScreen, FreePlayScreen, LoadScreen, MainMenu, ModeSelect, NewCareer, ScenarioScreen } from './ui/Screens';
import { SettingsScreen } from './ui/Settings';
import { Toast } from './ui/common';

export default function App() {
  const screen = useApp((s) => s.screen);
  const init = useApp((s) => s.init);
  const hc = useApp((s) => s.settings.highContrast);
  const reduce = useApp((s) => s.settings.reduceMotion);
  useEffect(() => { void init(); const unlock = () => audio.unlock(); window.addEventListener('pointerdown', unlock, { once: true }); return () => window.removeEventListener('pointerdown', unlock); }, []);
  const view = (() => {
    switch (screen) {
      case 'menu': return <MainMenu />;
      case 'newCareer': return <NewCareer />;
      case 'load': return <LoadScreen />;
      case 'modes': return <ModeSelect />;
      case 'hub': return <HubScreen />;
      case 'briefing': return <BriefingScreen />;
      case 'game': return <GameScreen />;
      case 'report': return <ReportScreen />;
      case 'settings': return <SettingsScreen />;
      case 'freeplay': return <FreePlayScreen />;
      case 'scenarios': return <ScenarioScreen />;
      case 'endless': return <EndlessScreen />;
      default: return <MainMenu />;
    }
  })();
  return <div className={`app ${hc ? 'hc' : ''} ${reduce ? 'reduce' : ''}`}>{view}{screen !== 'game' && screen !== 'menu' && screen !== 'hub' && screen !== 'load' && <Toast />}</div>;
}
