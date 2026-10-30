import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from '../sim/achievements';
import { CONTRACT_BY_ID, contractProgress, MODIFIER_BY_ID } from '../sim/extras';
import type { Profile } from '../sim/profile';
import type { GameState, ShiftConfig } from '../sim/types';
import { Bar, Icon, fmtMoney } from './common';

/** shift conditions + bonus contracts, shown on briefings and reports */
export function ExtrasList({ config, st }: { config: ShiftConfig; st?: GameState }) {
  const mods = (config.modifiers ?? []).map((m) => MODIFIER_BY_ID[m]).filter(Boolean);
  const cons = config.contracts ?? [];
  if (!mods.length && !cons.length) return null;
  return (
    <div className="extras">
      {mods.length > 0 && <h4>Shift conditions</h4>}
      {mods.map((m) => <div key={m.id} className={`mod ${m.tone}`} style={{ display: 'flex', marginBottom: 4 }} title={m.desc}><Icon n="alert" size={11} /> <b>{m.name}</b> <span className="small">— {m.desc}</span></div>)}
      {cons.length > 0 && <h4>Bonus contracts</h4>}
      <div className="contracts">
        {cons.map((c) => {
          const def = CONTRACT_BY_ID[c.id];
          if (!def) return null;
          const p = st ? contractProgress(st, c) : null;
          return (
            <div key={c.id} className={`contract ${p?.done ? 'ok' : p && (p.failed || st?.phase === 'ended') ? 'no' : ''}`}>
              <Icon n={p?.done ? 'check' : p && (p.failed || st?.phase === 'ended') ? 'x' : 'coins'} size={13} />
              <span className="grow">{def.label(c.target)}</span>
              <span className="mono small">{fmtMoney(def.reward)} · {def.xp} XP</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AchievementCard({ id, got }: { id: string; got: boolean }) {
  const a = ACHIEVEMENT_BY_ID[id];
  return (
    <div className={`ach ${a.tier} ${got ? 'got' : ''}`} title={got ? 'Unlocked' : 'Locked'}>
      <div className="medal"><Icon n={a.icon} size={20} /></div>
      <div><b>{a.name}</b><span className="small muted">{a.desc}</span></div>
    </div>
  );
}

export function AchievementsPage({ p }: { p: Profile }) {
  const got = p.achievements ?? {};
  const n = ACHIEVEMENTS.filter((a) => got[a.id]).length;
  return (
    <div className="page">
      <h2>Achievements</h2>
      <div className="card"><div className="row gap"><Icon n="trophy" size={22} /><b>{n} / {ACHIEVEMENTS.length} unlocked</b></div><div className="achbar"><Bar value={n} max={ACHIEVEMENTS.length} tone="amber" label="Achievements" /></div></div>
      <div className="achgrid">{[...ACHIEVEMENTS].sort((a, b) => (got[b.id] ? 1 : 0) - (got[a.id] ? 1 : 0)).map((a) => <AchievementCard key={a.id} id={a.id} got={!!got[a.id]} />)}</div>
    </div>
  );
}
