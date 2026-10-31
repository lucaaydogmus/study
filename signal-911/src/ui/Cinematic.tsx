// Cinematic beats: letterboxed title cards for major incidents and MAYDAYs, a live picture-in-picture
// camera on the big moments, and a jolt of the screen when something blows up.
import { useEffect, useRef, useState } from 'react';
import { addressOf } from '../sim/city';
import type { GameEngine } from '../sim/engine';
import { useApp } from '../store';
import { MapView } from './MapView';

type Card = { kind: string; title: string; sub: string; tone: 'red' | 'amber' | 'blue'; key: number };
type Pip = { incId: string; label: string; x: number; y: number; key: number; until: number };

export function Cinematics({ engine }: { engine: GameEngine }) {
  const reduce = useApp((s) => s.settings.reduceMotion);
  const [card, setCard] = useState<Card | null>(null);
  const [pip, setPip] = useState<Pip | null>(null);
  const keyRef = useRef(0);
  useEffect(() => engine.on((e) => {
    if (e.type !== 'alert' || !e.cine || !e.incId) return;
    const inc = engine.state.incidents[e.incId];
    if (!inc) return;
    const node = engine.city.nodes[inc.reportedNode ?? inc.nodeId];
    const where = `${addressOf(engine.city, inc.reportedNode ?? inc.nodeId)} · ${engine.city.districtById[node.district]?.name ?? ''}`;
    const k = ++keyRef.current;
    const showPip = (secs: number) => setPip({ incId: inc.id, label: inc.label, x: node.x, y: node.y, key: k, until: performance.now() + secs * 1000 });
    const shake = () => {
      if (reduce) return;
      const el = document.querySelector('.game .center');
      el?.classList.remove('shake'); void (el as HTMLElement | null)?.offsetWidth; el?.classList.add('shake');
      window.setTimeout(() => el?.classList.remove('shake'), 650);
    };
    if (e.cine === 'major') { setCard({ kind: 'MAJOR INCIDENT', title: inc.label, sub: where, tone: 'red', key: k }); showPip(8); shake(); }
    else if (e.cine === 'mayday') { setCard({ kind: 'MAYDAY · FIREFIGHTER DOWN', title: inc.label, sub: where, tone: 'red', key: k }); showPip(8); }
    else if (e.cine === 'chase') { setCard({ kind: 'PURSUIT', title: inc.label, sub: where, tone: 'amber', key: k }); showPip(7); }
    else if (e.cine === 'escalate') { if (inc.category === 'fire') shake(); if (inc.severity >= 4) showPip(6); }
  }), [engine, reduce]);
  useEffect(() => { if (!card) return; const t = window.setTimeout(() => setCard(null), 3600); return () => clearTimeout(t); }, [card?.key]);
  useEffect(() => { if (!pip) return; const t = window.setTimeout(() => setPip(null), Math.max(0, pip.until - performance.now())); return () => clearTimeout(t); }, [pip?.key]);
  return (
    <>
      {card && (
        <div key={card.key} className={`cine ${card.tone} ${reduce ? 'still' : ''}`} aria-live="assertive">
          <div className="cine-bar top" /><div className="cine-bar bottom" />
          <div className="cine-card"><div className="cine-kind">{card.kind}</div><div className="cine-title">{card.title}</div><div className="cine-sub">{card.sub}</div></div>
        </div>
      )}
      {pip && (
        <div className="pip" key={pip.key}>
          <MapView engine={engine} layer="normal" mode="select" selected={{ kind: 'incident', id: pip.incId }} onSelect={() => {}} focus={{ x: pip.x, y: pip.y, zoom: 3.4, key: pip.key }} reduceMotion={reduce} lockedLabel={false} camEase={0.2} />
          <div className="pip-label"><i className="rec" /> LIVE · {pip.label}</div>
          <button className="pip-x" onClick={() => setPip(null)} aria-label="Close live camera">×</button>
        </div>
      )}
    </>
  );
}
