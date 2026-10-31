// The live side of a 911 call: caller speech that plays out, clickable addresses and highlighted danger words,
// questions the caller asks you, suggested replies, and a CPR count-along.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GameEngine } from '../sim/engine';
import { QUICK_QUESTIONS, type Intent, type QuickQ } from '../sim/dialogue';
import type { Call, Incident, TranscriptLine } from '../sim/types';
import { audio } from '../audio/audioManager';
import { useApp } from '../store';
import { Icon } from './common';

// ── highlighted caller speech ───────────────────────────────────────────────
const DANGER = /\b(knife|knives|gun|guns|shots?|shooting|stabbed|blood|bleeding|not breathing|isn'?t breathing|stopped breathing|no pulse|unconscious|won'?t wake( up)?|not waking|fire|flames|smoke|trapped|stuck|weapons?|gas|explosion|bang|chest pains?|can'?t breathe|choking|turning blue|seizure|overdose|collapsed|screaming)\b/gi;
const INFO = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(people|persons|cars|vehicles|kids|children|men|women|of them|years? old|floors?|months? old)\b/gi;

type Span = { start: number; end: number; kind: 'loc' | 'danger' | 'info'; nodeId?: number; label?: string; bad?: boolean };

/** places the caller has mentioned, as text to look for in their lines */
function locationNeedles(engine: GameEngine, call: Call): Array<{ needle: string; nodeId: number; label: string; bad: boolean }> {
  const out: Array<{ needle: string; nodeId: number; label: string; bad: boolean }> = [];
  for (const h of call.heard) {
    if (h.source === 'ali' || h.source === 'district') continue;
    const n = engine.city.nodes[h.nodeId];
    const clean = h.label.replace(/^(Near|ALI:)\s+/i, '').replace(/\s*\(.*\)\s*$/, '').replace(/\s+at\s+.*$/, '').trim();
    const bad = h.reliability === 'contradicted';
    for (const needle of [clean, h.label.replace(/^Near\s+/i, '').replace(/\s*\(.*\)\s*$/, ''), n?.addrStreet, n?.crossStreet]) if (needle && needle.length > 3) out.push({ needle, nodeId: h.nodeId, label: h.label, bad });
  }
  return out.sort((a, b) => b.needle.length - a.needle.length);
}

function spansFor(text: string, needles: ReturnType<typeof locationNeedles>): Span[] {
  const spans: Span[] = [];
  const lower = text.toLowerCase();
  const free = (s: number, e: number) => spans.every((x) => e <= x.start || s >= x.end);
  for (const n of needles) {
    const i = lower.indexOf(n.needle.toLowerCase());
    if (i >= 0 && free(i, i + n.needle.length)) spans.push({ start: i, end: i + n.needle.length, kind: 'loc', nodeId: n.nodeId, label: n.label, bad: n.bad });
  }
  for (const [re, kind] of [[DANGER, 'danger'], [INFO, 'info']] as const) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) { const s = m.index, e = s + m[0].length; if (free(s, e)) spans.push({ start: s, end: e, kind }); }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** a caller line: plays out like speech when it is new, then shows clickable places and highlighted danger words */
export function CallerLine({ engine, call, inc, line, fresh, plain }: { engine: GameEngine; call: Call; inc: Incident; line: TranscriptLine; fresh: boolean; plain?: boolean }) {
  const reduce = useApp((s) => s.settings.reduceMotion);
  const [shown, setShown] = useState(fresh && !reduce ? 0 : line.text.length);
  useEffect(() => {
    if (shown >= line.text.length) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const add = Math.max(1, Math.floor(((now - last) / 1000) * 58));
      if (now - last >= 16) { last = now; setShown((s) => Math.min(line.text.length, s + add)); }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [line.text, shown >= line.text.length]);
  const bump = useApp((s) => s.bump);
  if (shown < line.text.length) return <>{line.text.slice(0, shown)}<i className="caret" /></>;
  if (plain) return <>{line.text}</>;
  const spans = spansFor(line.text, locationNeedles(engine, call));
  const parts: ReactNode[] = [];
  let at = 0;
  spans.forEach((sp, k) => {
    if (sp.start > at) parts.push(line.text.slice(at, sp.start));
    const t = line.text.slice(sp.start, sp.end);
    if (sp.kind === 'loc') {
      const set = inc.reportedNode === sp.nodeId;
      parts.push(
        <button key={k} className={`hl loc ${sp.bad ? 'bad' : ''} ${set ? 'set' : ''}`} disabled={sp.bad || set} title={sp.bad ? 'Contradicted — the caller corrected this' : set ? 'This is the incident location' : `Set the incident location to ${sp.label}`}
          onClick={() => { engine.setIncidentLocation(inc.id, sp.nodeId!, 'candidate'); audio.dispatchConfirm(); useApp.getState().showToast(`Location set: ${sp.label}`, 'info'); bump(); }}>
          <Icon n="pin" size={10} />{t}
        </button>,
      );
    } else parts.push(<mark key={k} className={`hl ${sp.kind}`}>{t}</mark>);
    at = sp.end;
  });
  if (at < line.text.length) parts.push(line.text.slice(at));
  return <>{parts}</>;
}

// ── questions the caller asks the dispatcher ────────────────────────────────
export function CallerQuestionPrompt({ engine, call }: { engine: GameEngine; call: Call }) {
  const q = call.question;
  const seen = useRef<number | null>(null);
  useEffect(() => { if (q && seen.current !== q.at) { seen.current = q.at; audio.notify(); } }, [q?.at]);
  if (!q) return null;
  const total = q.expiresAt - q.at, left = Math.max(0, q.expiresAt - engine.state.time);
  // no answer buttons: they asked in the chat, you answer in your own words
  return (
    <div className="cq slim" role="status">
      <Icon n="help" size={12} /><span><b>{call.profile.name.split(' ')[0]}</b> is waiting for your answer — type it below.</span>
      <div className="cq-bar"><i style={{ width: `${(left / total) * 100}%` }} /></div><span className="mono small">{Math.ceil(left)}s</span>
    </div>
  );
}

// ── suggested next things to say ────────────────────────────────────────────
const qq = (intent: Intent, group?: QuickQ['group']): QuickQ | undefined => QUICK_QUESTIONS.find((q) => q.intent === intent && (!group || q.group === group)) ?? QUICK_QUESTIONS.find((q) => q.intent === intent);

/** what a good dispatcher would ask or say next, given what the caller just said and what is still unknown */
export function suggestFor(engine: GameEngine, call: Call, inc: Incident): QuickQ[] {
  const asked = (i: Intent) => (call.asked[i] ?? 0) > 0;
  const out: QuickQ[] = [];
  const add = (q?: QuickQ) => { if (q && !out.some((x) => x.intent === q.intent && x.group === q.group)) out.push(q); };
  const lastCaller = call.transcript.filter((l) => l.who === 'CALLER').slice(-2).map((l) => l.text.toLowerCase()).join(' ');
  const dispatcherLines = call.transcript.filter((l) => l.who === 'DISPATCHER').length;
  if (call.mood.panic > 68 && !(call.asked.calm > 1)) add(qq('calm'));
  if (!asked('emergency') && !asked('cause') && dispatcherLines === 0) add(qq('emergency'));
  if (inc.reportedNode === null) { if (!asked('address')) add(qq('address')); else if (!asked('landmark')) add(qq('landmark')); else if (!asked('district')) add(qq('district')); }
  const has = (re: RegExp) => re.test(lastCaller);
  if (!inc.aid && has(/not breathing|isn'?t breathing|stopped breathing|no pulse|turning blue/)) add(qq('inst_cpr'));
  if (inc.aid?.kind !== 'pressure' && has(/bleed|blood/)) add(qq('inst_pressure'));
  if (has(/won'?t wake|unconscious|passed out|collapsed/) && !asked('breathing')) add(qq('breathing'));
  if (inc.category === 'fire' && has(/fire|smoke|flames|burning/) && !inc.safetyAdvised) add(qq('move', 'Instructions'));
  if (has(/downstairs|break(ing)? in|someone in (my|the) house|intruder|kick(ing)? (in )?the door/) && inc.aid?.kind !== 'lock') add(qq('inst_lock'));
  if (has(/knife|gun|weapon|shot/) && !asked('safe')) add(qq('safe'));
  if (has(/trapped|stuck|can'?t get out/) && !asked('trapped')) add(qq('trapped'));
  if (has(/crash|collision|hit (a|the|my)|smashed/) && !asked('injuries')) add(qq('injuries'));
  const byCat: Record<string, Intent[]> = { medical: ['conscious', 'breathing', 'age', 'injuries'], fire: ['trapped', 'people', 'hazard', 'injuries'], police: ['weapon', 'suspect', 'safe', 'injuries'], unusual: ['cause', 'safe', 'injuries'] };
  for (const i of byCat[inc.category] ?? []) if (!asked(i)) add(qq(i));
  if (inc.assignedUnits.length && !asked('promise')) add(qq('promise'));
  return out.slice(0, 4);
}

export function SuggestedReplies({ items, onPick }: { items: QuickQ[]; onPick: (q: QuickQ) => void }) {
  if (!items.length) return null;
  return (
    <div className="sugg" aria-label="Suggested replies">
      <span className="sugg-lbl"><Icon n="star" size={11} /> Suggested</span>
      {items.map((q, i) => <button key={q.intent + q.group} className={`sugg-chip ${i === 0 ? 'top' : ''}`} title={q.text} onClick={() => onPick(q)}>{q.label}{i === 0 && <kbd>Tab</kbd>}</button>)}
    </div>
  );
}

// ── who is on the line ──────────────────────────────────────────────────────
export function CallerAvatar({ call, speaking }: { call: Call; speaking: boolean }) {
  const initials = call.profile.name.split(' ').map((p) => p[0]).slice(0, 2).join('');
  const m = call.mood;
  const tone = m.panic > 72 ? 'red' : m.frustration > 55 || m.panic > 45 ? 'amber' : 'green';
  return (
    <div className={`cavatar ${tone} ${speaking ? 'speaking' : ''}`} title={`${call.profile.name} — ${call.profile.emotionalState}`}>
      <span>{initials}</span>
      {speaking && <i className="vbars" aria-hidden="true"><b /><b /><b /><b /><b /></i>}
    </div>
  );
}

// ── CPR count-along ─────────────────────────────────────────────────────────
export function CprCoach({ engine, call, inc }: { engine: GameEngine; call: Call; inc: Incident }) {
  const bump = useApp((s) => s.bump);
  const taps = useRef<number[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);
  const [tempo, setTempo] = useState<'good' | 'slow' | 'fast' | null>(null);
  const [hit, setHit] = useState(0);
  const tap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 3500), now].slice(-6);
    setHit((h) => h + 1);
    audio.click();
    if (taps.current.length < 3) return;
    const iv = (taps.current[taps.current.length - 1] - taps.current[0]) / (taps.current.length - 1);
    const b = Math.round(60000 / iv);
    setBpm(b);
    const r = engine.cprPace(call.id, b);
    if (r.ok) setTempo(r.tempo ?? null);
    bump();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); tap(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [call.id]);
  const pos = bpm === null ? null : Math.max(0, Math.min(100, ((bpm - 60) / 100) * 100));
  return (
    <div className={`cpr ${tempo ?? ''}`}>
      <div className="cpr-beat" aria-hidden="true" />
      <b className="cpr-title" title="Count with the caller: tap the beat at 100–120 a minute to keep compressions effective">CPR — count with them</b>
      <div className="cpr-gauge" aria-label="Compression rate" title="Green zone: 100–120 compressions a minute">
        <i className="zone" />
        {pos !== null && <i className="needle" style={{ left: `${pos}%` }} />}
      </div>
      <span className="small mono cpr-read">{bpm === null ? 'tap the beat' : `${bpm}/min · ${tempo === 'good' ? 'perfect' : tempo === 'slow' ? 'faster!' : tempo === 'fast' ? 'slower' : ''}`}</span>
      <button key={hit} className="cpr-btn" onClick={tap}>Count <kbd>C</kbd></button>
    </div>
  );
}
