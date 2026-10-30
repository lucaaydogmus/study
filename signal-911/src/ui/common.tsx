import { useEffect, useRef, type ReactNode } from 'react';
import { audio } from '../audio/audioManager';
import { useApp } from '../store';

export const fmtMoney = (n: number) => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
export const fmtTime = (sec: number) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const fmtEta = (sec: number | null | undefined) => (sec === null || sec === undefined || !isFinite(sec) ? '—' : sec >= 60 ? `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, '0')}s` : `${Math.round(sec)}s`);

const P: Record<string, string> = {
  heli: 'M3 5h18M12 5v3M6 12.5C6 10 8 8 11 8h3c2.8 0 5 2 5 4.5S16.8 17 14 17h-3c-3 0-5-2-5-4.5zM19 12h3M10 17l-1 3M15 17l1 3M7 20h11',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4', terminal: 'M3 5h18v14H3zM7 10l3 2-3 2M12 15h5', pulse: 'M2 12h4l2-5 4 10 3-7 2 2h5',
  phone: 'M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z',
  phoneoff: 'M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2zM3 3l18 18',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z', play: 'M8 5v14l11-7z', ff: 'M4 5l8 7-8 7zM12 5l8 7-8 7z', fff: 'M2 5l6 7-6 7zM9 5l6 7-6 7zM16 5l6 7-6 7z',
  gear: 'M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm8 3.5l1.7-1.3-1.7-3-2 .6-1.5-1-.3-2.1h-3.4l-.3 2.1-1.5 1-2-.6-1.7 3L5.9 12 4.2 13.3l1.7 3 2-.6 1.5 1 .3 2.1h3.4l.3-2.1 1.5-1 2 .6 1.7-3z',
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z', flame: 'M12 2c1 4 5 6 5 11a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z', shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z',
  alert: 'M12 2l10 18H2zM12 9v5M12 17v1', map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14', layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  radio: 'M4 9h16v11H4zM8 9l9-6M8 14h4M16 14h2', users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 11a3 3 0 100-6M21 20a6 6 0 00-4-5.6', wrench: 'M14 6a4 4 0 005 5l-8 8a2 2 0 01-3-3l8-8a4 4 0 00-2-2z',
  check: 'M4 12l5 5L20 6', x: 'M5 5l14 14M19 5L5 19', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3', chevL: 'M15 5l-7 7 7 7', chevR: 'M9 5l7 7-7 7', chevD: 'M5 9l7 7 7-7', chevU: 'M5 15l7-7 7 7',
  clock: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 8v4l3 2', hold: 'M8 5v14M16 5v14', note: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5', transfer: 'M4 8h13l-4-4M20 16H7l4 4',
  pin: 'M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12zM12 12a2 2 0 100-4 2 2 0 000 4z', send: 'M3 12l18-9-6 18-3-8z', star: 'M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z',
  coins: 'M12 4c4.4 0 8 1.1 8 2.5S16.4 9 12 9 4 7.9 4 6.5 7.6 4 12 4zM4 6.5v5C4 12.9 7.6 14 12 14s8-1.1 8-2.5v-5M4 11.5v5C4 17.9 7.6 19 12 19s8-1.1 8-2.5v-5',
  rain: 'M7 16a5 5 0 110-10 6 6 0 0111 2 4 4 0 010 8zM8 19l-1 2M12 19l-1 2M16 19l-1 2', sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  cloud: 'M7 18a5 5 0 110-10 6 6 0 0111 2 4 4 0 010 8z', snow: 'M12 3v18M4 7.5l16 9M20 7.5l-16 9', fog: 'M4 8h16M3 12h18M5 16h14', bolt: 'M13 2L5 14h6l-1 8 8-12h-6z', moon: 'M20 14A8 8 0 019.5 3.5 8 8 0 1020 14z',
  heart: 'M12 21s-7.5-4.6-9.6-9.3C.9 7.9 3.4 4 7 4c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.6 0 6.1 3.9 4.6 7.7C19.5 16.4 12 21 12 21z',
  help: 'M12 4a8 8 0 100 16 8 8 0 000-16zM9.5 9.5a2.5 2.5 0 115 .2c0 1.8-2.5 2-2.5 4M12 17v.5', save: 'M5 3h12l4 4v14H5zM8 3v6h8V3M8 21v-7h8v7', trash: 'M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14', plus: 'M12 5v14M5 12h14', car: 'M4 14l2-6h12l2 6v4h-3v-2H7v2H4zM7 14h.01M17 14h.01', hosp: 'M5 4h14v16H5zM12 8v8M8 12h8',
  trophy: 'M7 4h10v5a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M12 14v4M8 20h8', book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM8 3v16', info: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 11v5M12 8v.5',
};
export function Icon({ n, size = 16, stroke = true, className }: { n: keyof typeof P | string; size?: number; stroke?: boolean; className?: string }) {
  const filled = ['pause', 'play', 'ff', 'fff', 'cross', 'flame', 'shield', 'phone', 'gear', 'star', 'bolt', 'heart'].includes(n);
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={filled && stroke ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[n] ?? P.info} />
    </svg>
  );
}
export const weatherIcon = (w: string) => ({ clear: 'sun', rain: 'rain', snow: 'snow', fog: 'fog', storm: 'bolt', heat: 'sun' }[w] ?? 'cloud');

export function Btn({ children, onClick, kind = 'default', disabled, title, icon, size, className, ...rest }: { children?: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'danger' | 'ghost' | 'success' | 'warn'; disabled?: boolean; title?: string; icon?: string; size?: 'sm' | 'lg'; className?: string } & Record<string, unknown>) {
  return (
    <button className={`btn ${kind} ${size ?? ''} ${className ?? ''}`} onClick={() => { if (disabled) { audio.error(); return; } audio.click(); onClick?.(); }} aria-disabled={disabled} disabled={false} title={title} data-disabled={disabled ? '1' : undefined} {...rest}>
      {icon && <Icon n={icon} size={size === 'lg' ? 18 : 14} />}{children}
    </button>
  );
}
export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'red' | 'amber' | 'green' | 'blue'; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}
export function Bar({ value, max = 100, tone = 'blue', label }: { value: number; max?: number; tone?: 'blue' | 'red' | 'amber' | 'green'; label?: string }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemax={max} aria-label={label}>
      <div className={`fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  );
}
export function Section({ title, children, right, collapsible = true, defaultOpen = true, id }: { title: ReactNode; children: ReactNode; right?: ReactNode; collapsible?: boolean; defaultOpen?: boolean; id?: string }) {
  const key = id ? `sec:${id}` : null;
  const read = () => { try { const v = key ? sessionStorage.getItem(key) : null; return v === null ? defaultOpen : v === '1'; } catch { return defaultOpen; } };
  const [open, setOpen] = useOpenState(read, key);
  return (
    <section className="section">
      <header onClick={() => collapsible && setOpen(!open)} className={collapsible ? 'clickable' : ''}>
        {collapsible && <Icon n={open ? 'chevD' : 'chevR'} size={12} />}<h3>{title}</h3><div className="grow" />{right}
      </header>
      {open && <div className="body">{children}</div>}
    </section>
  );
}
import { useState } from 'react';
function useOpenState(read: () => boolean, key: string | null): [boolean, (v: boolean) => void] {
  const [open, setO] = useState(read);
  return [open, (v) => { setO(v); try { if (key) sessionStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ } }];
}
export function Modal({ children, onClose, title, wide }: { children: ReactNode; onClose?: () => void; title?: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') onClose?.(); }}>
        {title && <div className="modal-head"><h2>{title}</h2>{onClose && <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon n="x" /></button>}</div>}
        {children}
      </div>
    </div>
  );
}
export function Confirm({ title, text, confirm, onYes, onNo, danger }: { title: string; text: string; confirm: string; onYes: () => void; onNo: () => void; danger?: boolean }) {
  return (
    <Modal title={title} onClose={onNo}>
      <p className="muted">{text}</p>
      <div className="row end gap"><Btn onClick={onNo}>Cancel</Btn><Btn kind={danger ? 'danger' : 'primary'} onClick={onYes}>{confirm}</Btn></div>
    </Modal>
  );
}
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode; badge?: ReactNode }>; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => { audio.click(); onChange(t.id); }}>{t.label}{t.badge !== undefined && <span className="tabbadge">{t.badge}</span>}</button>
      ))}
    </div>
  );
}
export function Toast() {
  const toast = useApp((s) => s.toast);
  const [shown, setShown] = useState<typeof toast>(null);
  useEffect(() => { if (!toast) return; setShown(toast); const t = setTimeout(() => setShown(null), 3200); return () => clearTimeout(t); }, [toast]);
  if (!shown) return null;
  return <div className={`toast ${shown.level}`} role="status">{shown.text}</div>;
}
export const SERVICE_ICON: Record<string, string> = { police: 'shield', fire: 'flame', medical: 'cross' };
export function useTick(): number { return useApp((s) => s.rev); }
export const GRADE_COLOR: Record<string, string> = { S: '#E5AC4D', A: '#54B889', B: '#4A9CD6', C: '#98A6B5', D: '#D69A53', F: '#D65353', '-': '#98A6B5' };
export function Grade({ g, size = 56 }: { g: string; size?: number }) {
  return <div className="grade" style={{ width: size, height: size, fontSize: size * 0.58, color: GRADE_COLOR[g], borderColor: GRADE_COLOR[g] }}>{g}</div>;
}
export const DISCLAIMER = 'SIGNAL 911 is a work of fiction. Ravenport, its people and every call in this game are invented. It is not connected to any real emergency service — never use it to report a real emergency.';
