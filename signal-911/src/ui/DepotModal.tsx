import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useGame } from '../store/game';
import { EQUIPMENT, MAX_UPGRADES, allowedFor } from '../sim/equipment';
import {
  MAX_FLEET, PRICE, STATION_CAPACITY, UPKEEP, coverageTable, sellValue, serviceCost, stationLoad, stationsFor, totalUpkeep, upkeepOf,
} from '../sim/fleet';
import { CAP_SHORT, VEHICLES } from '../sim/units';
import { getCity } from '../sim/city';
import { Bar, money } from './common';
import { SERVICE_COLOR } from './MapCanvas';
import type { Service, VehicleId } from '../sim/types';

type Tab = 'fleet' | 'shop' | 'coverage';

export function DepotModal() {
  const g = useGame.getState();
  const [tab, setTab] = useState<Tab>('fleet');
  const save = useGame((s) => s.save);
  const fleet = save.fleet;
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && g.openDepot(false)}>
      <div className="card depot">
        <div className="dhead2">
          <h1>Depot</h1>
          <div className="seg small">
            {(['fleet', 'shop', 'coverage'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
          </div>
          <span className="spacer" />
          <span title="Budget">{money(save.money)}</span>
          <span className="muted" title="Charged automatically at the end of every shift">Upkeep {money(totalUpkeep(fleet))}/shift</span>
          <button className="icon" onClick={() => g.openDepot(false)} title="Close"><X size={14} /></button>
        </div>
        {tab === 'fleet' && <FleetTab />}
        {tab === 'shop' && <ShopTab />}
        {tab === 'coverage' && <CoverageTab />}
      </div>
    </div>
  );
}

function FleetTab() {
  const g = useGame.getState();
  const save = useGame((s) => s.save);
  const fleet = save.fleet;
  const worn = fleet.filter((u) => u.condition < 100);
  return (
    <>
      <p className="muted small">Move units between stations (max {STATION_CAPACITY} each), equip up to {MAX_UPGRADES} upgrades per vehicle, and service worn vehicles. Every dispatch wears a vehicle down; badly worn ones can break down on a call.</p>
      <div className="row">
        <button onClick={() => g.serviceUnits(worn.map((u) => u.id))} disabled={!worn.length} title="Service every worn unit">
          Service all worn ({money(-worn.reduce((a, u) => a + serviceCost(u), 0))})
        </button>
        <span className="muted small">{fleet.length}/{MAX_FLEET} units</span>
      </div>
      <table className="fleet">
        <thead><tr><th>Unit</th><th>Station</th><th>Condition</th><th>Upgrades</th><th /></tr></thead>
        <tbody>
          {fleet.map((u) => {
            const v = VEHICLES[u.vehicle];
            const options = EQUIPMENT && Object.values(EQUIPMENT).filter((e) => allowedFor(e.id, v.service) && !u.upgrades.includes(e.id));
            return (
              <tr key={u.id}>
                <td><span className="dot" style={{ background: SERVICE_COLOR[v.service] }} /> <b>{u.id}</b> <span className="muted small">{v.name}</span></td>
                <td>
                  <select value={u.stationId} onChange={(e) => g.moveUnitTo(u.id, e.target.value)} aria-label={`Station for ${u.id}`}>
                    {stationsFor(v.service).map((s) => <option key={s.id} value={s.id}>{s.name} ({stationLoad(fleet, s.id)}/{STATION_CAPACITY})</option>)}
                  </select>
                </td>
                <td>
                  <div className="cond"><Bar value={u.condition / 100} kind={u.condition < 40 ? 'danger' : u.condition < 70 ? 'urgent' : 'good'} title={`${u.condition}%`} /><span className="mono small">{u.condition}%</span></div>
                  <button className="link small" disabled={u.condition >= 100} onClick={() => g.serviceUnits([u.id])}>Service {u.condition < 100 ? money(-serviceCost(u)) : ''}</button>
                </td>
                <td>
                  <div className="wrapchips">
                    {u.upgrades.map((id) => <span key={id} className="chip cap met" title={EQUIPMENT[id].desc}>{EQUIPMENT[id].name} <button className="x" onClick={() => g.removeUpgrade(u.id, id)} title={`Remove (refund ${money(EQUIPMENT[id].cost / 2)})`}>×</button></span>)}
                    {u.upgrades.length < MAX_UPGRADES && (
                      <select value="" aria-label={`Equip ${u.id}`} onChange={(e) => e.target.value && g.installUpgrade(u.id, e.target.value)}>
                        <option value="">+ Equip…</option>
                        {options.map((e) => <option key={e.id} value={e.id} disabled={save.money < e.cost}>{e.name} — {money(e.cost)}</option>)}
                      </select>
                    )}
                  </div>
                  <span className="muted small">Upkeep {money(upkeepOf(u))}</span>
                </td>
                <td><button className="danger" onClick={() => { if (window.confirm(`Sell ${u.id} for ${money(sellValue(u))}?`)) g.sellUnit(u.id); }} title={`Sell for ${money(sellValue(u))}`}>Sell</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function ShopTab() {
  const g = useGame.getState();
  const save = useGame((s) => s.save);
  const fleet = save.fleet;
  const [station, setStation] = useState<Record<string, string>>({});
  const types = Object.values(VEHICLES);
  return (
    <>
      <p className="muted small">New vehicles arrive at once. Each adds upkeep every shift, and a larger fleet draws a few more calls.</p>
      <div className="shop">
        {types.map((v) => {
          const options = stationsFor(v.service).filter((s) => stationLoad(fleet, s.id) < STATION_CAPACITY);
          const chosen = station[v.id] ?? options[0]?.id ?? '';
          const can = save.money >= PRICE[v.id] && fleet.length < MAX_FLEET && !!chosen;
          return (
            <div key={v.id} className="shopcard">
              <div><b style={{ color: SERVICE_COLOR[v.service] }}>{v.name}</b></div>
              <div className="wrapchips">{v.caps.map((c) => <span key={c} className="chip">{CAP_SHORT[c]}</span>)}</div>
              <div className="muted small">Crew {v.personnel} · upkeep {money(UPKEEP[v.id])}/shift</div>
              <select value={chosen} onChange={(e) => setStation({ ...station, [v.id]: e.target.value })} aria-label={`Station for new ${v.name}`}>
                {options.map((s) => <option key={s.id} value={s.id}>{s.name} ({stationLoad(fleet, s.id)}/{STATION_CAPACITY})</option>)}
              </select>
              <button className="primary" disabled={!can} onClick={() => g.buyVehicle(v.id as VehicleId, chosen)}>Buy {money(PRICE[v.id])}</button>
            </div>
          );
        })}
      </div>
      <h3>Equipment</h3>
      <ul className="notelist">{Object.values(EQUIPMENT).map((e) => (
        <li key={e.id} className="note info"><span><b>{e.name}</b> ({money(e.cost)}, {e.services === 'any' ? 'any vehicle' : e.services.join('/')}): {e.desc}</span></li>
      ))}</ul>
      <p className="muted small">Equip units from the Fleet tab. Equipment effects stack once per kind across the units on scene.</p>
    </>
  );
}

function CoverageTab() {
  const fleet = useGame((s) => s.save.fleet);
  const table = useMemo(() => coverageTable(fleet), [fleet]);
  const city = getCity();
  const services: Service[] = ['police', 'fire', 'medical'];
  const cell = (v: number | null) => (v === null ? <td className="cov bad">no unit</td> : <td className={`cov ${v < 35 ? 'good' : v < 60 ? 'mid' : 'bad'}`}>{Math.round(v)}s</td>);
  return (
    <>
      <p className="muted small">Average drive time (clear weather, no traffic) from the nearest staffed station to a sample of junctions in each district. Under 35 s is good; over 60 s is a gap.</p>
      <table className="fleet cover">
        <thead><tr><th>District</th>{services.map((s) => <th key={s} style={{ color: SERVICE_COLOR[s] }}>{s}</th>)}</tr></thead>
        <tbody>{city.districts.map((d) => <tr key={d.id}><td>{d.name}</td>{services.map((s) => <Fragment2 key={s}>{cell(table[d.id][s])}</Fragment2>)}</tr>)}</tbody>
      </table>
    </>
  );
}
const Fragment2 = ({ children }: { children: React.ReactNode }) => <>{children}</>;
