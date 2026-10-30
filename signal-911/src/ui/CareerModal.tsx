import { useState } from 'react';
import { Lock, X, Check } from 'lucide-react';
import { useGame } from '../store/game';
import { CHALLENGE_LEVEL, LEVEL_XP, OBJECTIVES, levelOf, nextLevelXp, objectiveById } from '../sim/career';
import { EVENTS } from '../sim/events';
import { getCity } from '../sim/city';
import { Bar, money } from './common';

type Tab = 'objectives' | 'scenarios' | 'record';

export function CareerModal() {
  const g = useGame.getState();
  const save = useGame((s) => s.save);
  const config = useGame((s) => s.config);
  const [tab, setTab] = useState<Tab>('objectives');
  const level = levelOf(save.xp);
  const nxt = nextLevelXp(save.xp);
  const cur = LEVEL_XP[level - 1];
  const c = save.career;
  const pick = (kind: 'standard' | 'event' | 'challenge', id?: string) => { g.setScenario(kind, id); g.openCareer(false); };
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && g.openCareer(false)}>
      <div className="card depot">
        <div className="dhead2">
          <h1>Career</h1>
          <div className="seg small">{(['objectives', 'scenarios', 'record'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
          <span className="spacer" />
          <button className="icon" onClick={() => g.openCareer(false)} title="Close"><X size={14} /></button>
        </div>
        <div className="lvl">
          <b>Level {level}</b>
          <Bar value={nxt === null ? 1 : (save.xp - cur) / (nxt - cur)} kind="good" />
          <span className="muted small">{save.xp} XP{nxt !== null ? ` · ${nxt - save.xp} to level ${level + 1}` : ' · max level'}</span>
        </div>

        {tab === 'objectives' && (
          <>
            <p className="muted small">Three active objectives. Finish a shift that meets one to claim its reward; a new one replaces it.</p>
            {c.active.map((id) => { const o = objectiveById(id)!; return (
              <div key={id} className="obj"><b>{o.title}</b><span className="muted small">{o.hint}</span><span className="chip">{money(o.reward.money)} · {o.reward.xp} XP</span></div>
            ); })}
          </>
        )}

        {tab === 'scenarios' && (
          <>
            <p className="muted small">Special events change traffic, weather and call patterns. Level up to unlock more. Your pick applies to the next shift.</p>
            <div className="shop">
              <div className={`shopcard ${!config.event && !config.challenge ? 'chosen' : ''}`}>
                <b>Standard shift</b><span className="muted small">Normal call pattern, any weather you choose.</span>
                <button className="primary" onClick={() => pick('standard')}>Select</button>
              </div>
              {EVENTS.map((e) => {
                const locked = e.level > level;
                return (
                  <div key={e.id} className={`shopcard ${config.event === e.id ? 'chosen' : ''}`}>
                    <b>{e.name} {c.events[e.id] ? <Check size={13} className="goodc" /> : null}</b>
                    <span className="muted small">{e.blurb}</span>
                    <span className="small">Goal: {e.goal.text}</span>
                    <span className="chip">{money(e.reward.money)} · {e.reward.xp} XP first time</span>
                    <button className="primary" disabled={locked} onClick={() => pick('event', e.id)}>{locked ? <><Lock size={12} /> Level {e.level}</> : 'Select'}</button>
                  </div>
                );
              })}
            </div>
            <h3>District challenges {level < CHALLENGE_LEVEL && <span className="muted small">(unlock at level {CHALLENGE_LEVEL})</span>}</h3>
            <p className="muted small">Most calls land in one district. Goal: resolve 5 incidents there with at most 1 failure anywhere.</p>
            <div className="wrapchips">
              {getCity().districts.map((d) => (
                <button key={d.id} className={`chipbtn ${config.challenge === d.id ? 'on' : ''}`} disabled={level < CHALLENGE_LEVEL} onClick={() => pick('challenge', d.id)}>
                  {c.challenges[d.id] ? '✓ ' : ''}{d.name}
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'record' && (
          <dl className="kv">
            <dt>Shifts completed</dt><dd>{save.completedShifts}</dd>
            <dt>Best grade</dt><dd>{c.bestGrade}</dd>
            <dt>Reputation</dt><dd>{save.reputation}/100</dd>
            <dt>Objectives completed</dt><dd>{c.completed.length}/{OBJECTIVES.length} distinct</dd>
            <dt>Events finished</dt><dd>{Object.keys(c.events).length}/{EVENTS.length}</dd>
            <dt>District challenges</dt><dd>{Object.keys(c.challenges).length}/6</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
