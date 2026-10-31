// Push-to-talk: hold the mic button (or V) and speak; the words land in the box and are sent.
import { useEffect, useRef, useState } from 'react';
import { micSupported, startListening, stopListening } from '../audio/speech';
import { Icon } from './common';

export function MicButton({ onText, onFinal, hotkey = 'v', title }: { onText: (t: string) => void; onFinal: (t: string) => void; hotkey?: string; title?: string }) {
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cb = useRef({ onText, onFinal }); cb.current = { onText, onFinal };
  const start = () => {
    if (on) return;
    setErr(null);
    const ok = startListening((t) => cb.current.onText(t), (t) => cb.current.onFinal(t), (e) => { setOn(false); if (e && e !== 'no-speech' && e !== 'aborted') setErr(e === 'not-allowed' ? 'Microphone blocked — allow it in the browser' : `Mic: ${e}`); });
    setOn(ok);
  };
  const stop = () => { stopListening(); };
  useEffect(() => {
    if (!hotkey) return;
    const typing = (el: Element | null) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    const down = (e: KeyboardEvent) => { if (e.key.toLowerCase() === hotkey && !e.repeat && !typing(document.activeElement) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); start(); } };
    const up = (e: KeyboardEvent) => { if (e.key.toLowerCase() === hotkey) stop(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });
  if (!micSupported()) return <button className="mic off" disabled title="Speech recognition is not available in this browser (try Chrome or Edge)"><Icon n="radio" size={13} /></button>;
  return (
    <button className={`mic ${on ? 'live' : ''}`} title={err ?? title ?? `Hold to talk (or hold ${hotkey.toUpperCase()})`} aria-pressed={on}
      onPointerDown={(e) => { e.preventDefault(); start(); }} onPointerUp={stop} onPointerLeave={() => on && stop()}>
      <Icon n="radio" size={13} />{on ? <span className="mic-wave"><i /><i /><i /></span> : null}
    </button>
  );
}
