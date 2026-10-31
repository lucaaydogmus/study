// The live 911 call: a chat with the caller, their composure, calming techniques, jobs to give them,
// the questions they ask, and the call controls.
import { MicButton } from './Voice';
import { ProtocolCard } from './Protocol';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { assistsOn, SOUND_CLUES, type CalmKind, type GameEngine } from '../sim/engine';
import { classifyIntent, QUICK_QUESTIONS, type Intent } from '../sim/dialogue';
import type { Call, Incident } from '../sim/types';
import { audio } from '../audio/audioManager';
import { useApp } from '../store';
import { Badge, Btn, Icon, fmtTime } from './common';
import { DeadlineBanner, LifeMeter } from './Ops';
import { callPremises } from '../sim/ops';
import { matchOption } from '../sim/replies';
import { getAi } from '../store';
import { TraceStatus } from './Field';
import { CallerAvatar, CallerLine, CallerQuestionPrompt, CprCoach, SuggestedReplies, suggestFor } from './CallExtras';

type SideTab = 'ask' | 'calm' | 'jobs' | 'instruct';
const CALM: Array<{ kind: CalmKind; label: string; icon: string; hint: string }> = [
  { kind: 'reassure', label: 'Reassure', icon: 'heart', hint: 'Warm and steady. Best for frightened callers.' },
  { kind: 'firm', label: 'Be firm & simple', icon: 'bolt', hint: 'Use their name, short sentences. Cuts through panic — angers angry callers, scares children.' },
  { kind: 'acknowledge', label: 'Acknowledge', icon: 'users', hint: 'Validate how they feel. Defuses anger and frustration.' },
  { kind: 'ground', label: 'Ground them', icon: 'map', hint: 'Ask what they can see. Steadies a shaken caller — and may give away where they are.' },
  { kind: 'update', label: 'Give an update', icon: 'clock', hint: 'Tell them exactly who is coming and how long. Needs a unit on the way.' },
];

/** composure = 100 − panic, with a trend arrow and the effect of your last calming attempt */
function Composure({ call, now }: { call: Call; now: number }) {
  const value = Math.round(100 - call.mood.panic);
  const hist = useRef<Array<{ t: number; v: number }>>([]);
  hist.current = [...hist.current.filter((h) => now - h.t < 6), { t: now, v: value }];
  const trend = value - (hist.current[0]?.v ?? value);
  const lc = call.lastCalm && now - call.lastCalm.at < 4 ? call.lastCalm : null;
  const tone = value < 28 ? 'red' : value < 52 ? 'amber' : 'green';
  return (
    <div className={`composure ${tone}`} title="How well the caller is holding together. Silence while they wait drains it; calming techniques and jobs restore it.">
      <div className="cmp-top"><span>COMPOSURE</span><b className="mono">{value}%</b><span className={`cmp-trend ${trend > 1 ? 'up' : trend < -1 ? 'down' : ''}`}>{trend > 1 ? '▲' : trend < -1 ? '▼' : '•'}</span>
        {lc && <span key={lc.at} className={`cmp-delta ${lc.d > 0 ? 'good' : 'bad'}`}>{lc.d > 0 ? `+${lc.d}` : lc.d < 0 ? `${lc.d}` : '±0'}</span>}
      </div>
      <div className="cmp-bar"><i style={{ width: `${value}%` }} /><b className="cmp-mark" style={{ left: '28%' }} /></div>
    </div>
  );
}

/** guided breathing: hold the button while the circle fills, let go while it empties */
function BreatheExercise({ onDone, onCancel }: { onDone: (score: number) => void; onCancel: () => void }) {
  const CYCLE = 6000, CYCLES = 3;
  const [t, setT] = useState(0);
  const start = useRef(performance.now());
  const holding = useRef(false);
  const samples = useRef({ ok: 0, n: 0 });
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const el = now - start.current;
      setT(el);
      const inhale = (el % CYCLE) < CYCLE / 2;
      samples.current.n++; if (holding.current === inhale) samples.current.ok++;
      if (el >= CYCLE * CYCLES) { onDone(samples.current.ok / Math.max(1, samples.current.n)); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const phase = (t % CYCLE) / CYCLE;
  const inhale = phase < 0.5;
  const size = inhale ? phase * 2 : 2 - phase * 2;
  const acc = samples.current.n ? Math.round((samples.current.ok / samples.current.n) * 100) : 100;
  return (
    <div className="breathe">
      <div className="br-ring"><i style={{ transform: `scale(${0.35 + size * 0.65})` }} /><span>{inhale ? 'Breathe in…' : 'and out…'}</span></div>
      <div className="br-side">
        <b>Breathe with me</b>
        <span className="small muted">Hold the button while the circle grows, release while it shrinks. Breath {Math.min(CYCLES, Math.floor(t / CYCLE) + 1)} of {CYCLES} · in sync {acc}%</span>
        <div className="btnrow">
          <button className={`br-btn ${inhale ? 'in' : 'out'}`} onPointerDown={(e) => { e.preventDefault(); holding.current = true; }} onPointerUp={() => { holding.current = false; }} onPointerLeave={() => { holding.current = false; }}>Hold to breathe in</button>
          <Btn size="sm" kind="ghost" onClick={onCancel}>Stop</Btn>
        </div>
      </div>
    </div>
  );
}

export function CallConsole({ engine, setTab, openDispatch }: { engine: GameEngine; setTab: (t: string) => void; openDispatch: () => void }) {
  const st = engine.state;
  const bump = useApp((s) => s.bump);
  const call = st.activeCallId ? st.calls[st.activeCallId] : null;
  const [text, setText] = useState('');
  const [side, setSide] = useState<SideTab>('ask');
  const [grp, setGrp] = useState<'Opening' | 'Location' | 'Situation'>('Opening');
  const [breathing, setBreathing] = useState(false);
  const aiActive = useApp((s) => s.aiActive);
  const scroll = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // keep the newest line in view while the caller is "speaking", unless the dispatcher scrolled up to read
  useLayoutEffect(() => {
    const el = scroll.current, body = inner.current;
    if (!el || !body) return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(body);
    return () => ro.disconnect();
  }, [call?.id]);
  useEffect(() => { setBreathing(false); setSide('ask'); stick.current = true; }, [call?.id]);
  // the world behind the caller drifts in faintly every so often: a sharp ear picks up where they are
  useEffect(() => {
    if (!call || call.state !== 'active' || call.profile.archetype === 'silent') return;
    let timer = 0;
    const tick = () => {
      const env = engine.soundscape(call.id);
      if (env.length && engine.state.activeCallId === call.id && !engine.state.paused) audio.playClue(env[Math.floor(Math.random() * env.length)], 0.32);
      timer = window.setTimeout(tick, 9000 + Math.random() * 9000);
    };
    timer = window.setTimeout(tick, 4000 + Math.random() * 4000);
    return () => clearTimeout(timer);
  }, [call?.id, call?.state]);
  const onHold = Object.values(st.calls).filter((c) => c.state === 'hold' && !c.colleague);
  const ringing = Object.values(st.calls).filter((c) => c.state === 'ringing');
  const inc = call ? st.incidents[call.incidentId] : null;
  const assists = assistsOn(st);
  const askedKey = call ? Object.keys(call.asked).length : 0;
  // suggestions only change when the conversation does, so the chips don't jump around
  const sugg = useMemo(() => (call && inc && assists ? suggestFor(engine, call, inc) : []), [call?.id, call?.transcript.length, askedKey, inc?.reportedNode, inc?.aid?.kind, inc?.assignedUnits.length, Math.round((call?.mood.panic ?? 0) / 20), assists]);

  if (!call || !inc) {
    return (
      <div className="nocall">
        <Icon n="phone" size={28} />
        <div>
          <b>{ringing.length ? `${ringing.length} call${ringing.length > 1 ? 's' : ''} ringing` : onHold.length ? `${onHold.length} on hold` : 'Line clear'}</b>
          <div className="muted small">{ringing.length ? 'Press A or click ANSWER in the call queue.' : 'Waiting for the next 911 call. Use the time to position units — select an available unit, then click Reposition.'}</div>
        </div>
        <div className="btnrow">
          {ringing[0] && <Btn kind="primary" icon="phone" onClick={() => { engine.answerCall(ringing[0].id); bump(); }}>Answer next call</Btn>}
          {onHold.map((c) => <Btn key={c.id} icon="phone" onClick={() => { engine.answerCall(c.id); bump(); }}>Resume {c.profile.name.split(' ')[0]}</Btn>)}
        </div>
      </div>
    );
  }
  const send = (intent?: Intent, t?: string) => { engine.ask(call.id, { intent, text: t }); setText(''); stick.current = true; bump(); };
  const submit = () => {
    const t = text.trim(); if (!t) return;
    const q = call.question, ai = getAi();
    // an answer the keywords cannot place: let the AI read what you meant before treating it as a new question
    if (q && ai && !matchOption(t, q.options)) {
      setText('');
      void ai.interpret(q.text, q.options.map((o) => ({ id: o.id, label: o.label })), t).then((opt) => {
        if (opt && call.question === q) engine.answerCaller(call.id, opt, t); else engine.ask(call.id, { text: t });
        stick.current = true; bump();
      });
      return;
    }
    send(undefined, t);
  };
  const detected = text.trim().length > 3 ? classifyIntent(text) : null;
  const elapsed = st.time - (call.answeredAt ?? st.time);
  const lastLine = call.transcript[call.transcript.length - 1];
  const speaking = call.typing || (lastLine?.who === 'CALLER' && st.time - lastLine.t < 1.5);
  const cpr = inc.aid?.kind === 'cpr' && inc.aid.fit === 'good' && inc.careAt == null && inc.lifeThreat === 'arrest';
  const waiting = inc.reportedNode !== null && inc.assignedUnits.length > 0 && !engine.onScene(inc).length;
  const silence = st.time - (call.lastDispatcherAt ?? call.answeredAt ?? st.time);
  const tasks = engine.callTasks(call.id);
  const doing = (call.tasks ?? []).filter((t) => t.status === 'doing');
  const calmUsed = (k: CalmKind) => (call.calmUsed?.[k] ?? []).filter((t) => st.time - t < 45).length;
  const toast = (r: { ok: boolean; reason?: string }) => { if (!r.ok) { audio.error(); useApp.getState().showToast(r.reason ?? 'Not now', 'warn'); } else audio.click(); stick.current = true; bump(); };
  const first = call.profile.name.split(' ')[0];
  const lowComp = call.mood.panic > 62;

  return (
    <div className="callgrid v2">
      <div className="callmain">
        <div className="callhead v2">
          <CallerAvatar call={call} speaking={speaking} />
          <div className="ch-id">
            <div><b>{call.profile.name}</b>{call.isCallback && <Badge tone="amber">CALLBACK</Badge>}{call.text && <Badge tone="blue">TEXT 911</Badge>}{aiActive && <span className="aibadge" title="This caller's lines are improvised by Claude">AI</span>}</div>
            <div className="small muted">{call.callerId} · <span className="mono">{fmtTime(elapsed)}</span>{waiting && <span className={`ch-wait ${silence > 14 ? 'quiet' : ''}`}> · {silence > 14 ? `silent ${Math.round(silence)}s — they're waiting on you` : 'help on the way'}</span>}</div>
          </div>
          <Badge tone={call.mood.panic > 72 ? 'red' : call.mood.frustration > 55 || call.mood.panic > 45 ? 'amber' : 'green'}>{call.profile.emotionalState.toUpperCase()}</Badge>
          <Composure call={call} now={st.time} />
        </div>
        <div className="callctl inhead">
          <Btn size="sm" kind="danger" icon="phoneoff" onClick={() => { engine.endCall(call.id); bump(); }} title="End call (E)">End</Btn>
          <Btn size="sm" icon="hold" onClick={() => { engine.holdCall(call.id); bump(); }} title="Hold call (H)">Hold</Btn>
          <Btn size="sm" icon="transfer" onClick={() => { const m = engine.transferCall(call.id); useApp.getState().showToast(m, 'info'); bump(); }} title={inc.truth.outside ? 'Hand the caller to the neighbouring agency' : 'Hand the call to a dispatch assistant'}>{inc.truth.outside ? 'To county' : 'Transfer'}</Btn>
          <Btn size="sm" icon="send" onClick={() => { const r = engine.redirectCall(call.id); if (r.ok) { if (r.good) { audio.good(); useApp.getState().showToast('Sent to the non-emergency line — line freed', 'good'); } else { audio.error(); useApp.getState().showToast('That was a real emergency!', 'bad'); } } bump(); }} title="Not an emergency? Send them to the non-emergency line (or a reporter to the press office). Get it wrong and a real emergency goes unanswered.">Non-emergency</Btn>
          <Btn size="sm" icon="radio" onClick={() => { const r = engine.listen(call.id); if (!r.ok) { useApp.getState().showToast(r.reason ?? '', 'warn'); return; } r.kinds!.forEach((k, i) => window.setTimeout(() => audio.playClue(k, 1.1), i * 3000)); stick.current = true; bump(); }} title="Listen hard to what's behind the caller — trains, gulls, bells, crowds give away where they are">Listen</Btn>
          <Btn size="sm" icon="phone" disabled={!!inc.premisesCalled || inc.reportedNode === null} onClick={() => { const r = callPremises(engine, inc.id); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); bump(); }} title="Ring the landline listed at the address — the quickest way to catch a hoax, and it tells you something about real calls">{inc.premisesCalled ? 'Address rung' : 'Ring address'}</Btn>
          <Btn size="sm" icon="pin" disabled={!!call.trace} onClick={() => { const r = engine.startTrace(call.id); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); bump(); }} title="Ask the carrier for the caller's location">{call.trace ? (call.trace.done ? 'Traced' : 'Tracing…') : 'Trace'}</Btn>
          {call.profile.language && <Btn size="sm" kind={call.interpreter ? 'default' : 'primary'} icon="users" disabled={!!call.interpreter} onClick={() => { const r = engine.requestInterpreter(call.id); if (!r.ok) useApp.getState().showToast(r.reason ?? '', 'warn'); bump(); }}>{call.interpreter === 'on' ? 'Interpreter on' : call.interpreter ? 'Connecting…' : `${call.profile.language} interpreter`}</Btn>}
          <Btn size="sm" icon="map" onClick={openDispatch} title="Open the incident and dispatch panel">Dispatch</Btn>
          <Btn size="sm" icon="note" onClick={() => setTab('transcripts')} title="Full transcript">Log</Btn>
        </div>

        {(call.heardSounds?.length ?? 0) > 0 && <div className="heardsounds"><Icon n="radio" size={11} /> Behind the caller: {call.heardSounds!.map((k) => <span key={k} className="hs-chip" title={SOUND_CLUES[k]} onClick={() => audio.playClue(k, 1)}>{SOUND_CLUES[k].split(/[,—]| and /)[0]}</span>)}</div>}
        <LifeMeter inc={inc} compact />
        <TraceStatus call={call} />
        {inc.deadlineAt != null && inc.deadlineMet == null && <DeadlineBanner engine={engine} inc={inc} />}
        {cpr && <CprCoach engine={engine} call={call} inc={inc} />}
        {breathing && <BreatheExercise onCancel={() => setBreathing(false)} onDone={(score) => { setBreathing(false); toast(engine.calmCaller(call.id, 'breathe', score)); }} />}
        <div className="chat" ref={scroll} aria-live="polite" aria-label="Call transcript" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
          <div ref={inner}>
            {call.transcript.map((l, i) => l.who === 'SYSTEM'
              ? <div key={i} className="sysmsg"><span>{l.text}</span></div>
              : (
                <div key={i} className={`bubble ${l.who === 'CALLER' ? 'caller' : 'me'} ${l.who === 'CALLER' && /^\(/.test(l.text) ? 'action' : ''} ${l.garbled ? 'garbled' : ''} ${call.text ? 'sms' : ''}`}>
                  <div className="bmeta">{l.who === 'CALLER' ? first : 'You'} · {l.clock.slice(0, 5)}</div>
                  <div className="btext">{l.who === 'CALLER' && !l.garbled ? <CallerLine engine={engine} call={call} inc={inc} line={l} fresh={i === call.transcript.length - 1 && st.time - l.t < 2} plain={!assists} /> : l.text}</div>
                  {l.understood && <div className="understood">understood as: {l.understood}</div>}
                  {l.garbled && call.lastGarbled && i === call.transcript.map((x) => !!x.garbled).lastIndexOf(true) && <button className="chip sayagain" onClick={() => { engine.sayAgain(call.id); stick.current = true; bump(); }}><Icon n="phone" size={11} /> Say again?</button>}
                </div>
              ))}
            {doing.map((t) => (
              <div key={t.id + t.at} className="jobcard"><Icon n="wrench" size={12} /> <span>{first} is on it: <b>{t.label.toLowerCase()}</b></span><div className="job-bar"><i style={{ width: `${Math.min(100, ((st.time - t.at) / Math.max(1, t.doneAt - t.at)) * 100)}%` }} /></div></div>
            ))}
            <CallerQuestionPrompt engine={engine} call={call} />
            {call.typing && <div className="bubble caller typing"><div className="btext"><i className="dots"><b /><b /><b /></i></div></div>}
          </div>
        </div>
        <ProtocolCard engine={engine} call={call} inc={inc} onAsk={(intent) => send(intent as Intent)} />
        {assists && <SuggestedReplies items={sugg} onPick={(q) => send(q.intent, q.text)} />}
        <div className="inputrow">
 <MicButton onText={(t) => setText(t)} onFinal={(t) => send(undefined, t)} title={`Hold to talk to ${first} (or hold V)`} />
          <input aria-label="Say to caller" placeholder={call.question ? `Answer ${first}: “${call.question.text.length > 60 ? call.question.text.slice(0, 57) + '…' : call.question.text}”` : aiActive ? `Talk to ${first} in your own words…` : 'Type what you say… (e.g. “What is the address?”)'} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); else if (e.key === 'Tab' && !text.trim() && sugg[0]) { e.preventDefault(); send(sugg[0].intent, sugg[0].text); } e.stopPropagation(); }} />
          {detected && detected !== 'unknown' && <span className="detect small muted">{detected}</span>}
          <Btn kind="primary" icon="send" onClick={submit} disabled={!text.trim()}>Say</Btn>
        </div>
      </div>
      <div className="callside v2">
        <div className="sidetabs" role="tablist">
          {([['ask', 'Ask'], ['calm', 'Calm'], ['jobs', 'Jobs'], ['instruct', 'Instruct']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={side === id} className={`${side === id ? 'on' : ''} ${(id === 'calm' && lowComp) || (id === 'jobs' && waiting && !(call.tasks ?? []).length && tasks.length) ? 'nudge' : ''}`} onClick={() => setSide(id)}>{label}</button>
          ))}
        </div>
        <div className="sidebody">
          {side === 'ask' && (
            <>
              <div className="qgroups">{(['Opening', 'Location', 'Situation'] as const).map((g) => <button key={g} className={grp === g ? 'on' : ''} onClick={() => setGrp(g)}>{g}</button>)}</div>
              <div className="qchips">{QUICK_QUESTIONS.filter((q) => q.group === grp).map((q) => (
                <button key={q.intent} className={`chip ${call.asked[q.intent] ? 'asked' : ''}`} title={q.text} onClick={() => send(q.intent, q.text)}>{call.asked[q.intent] ? <Icon n="check" size={11} /> : null}{q.label}</button>
              ))}</div>
            </>
          )}
          {side === 'calm' && (
            <div className="calmlist">
              {CALM.map((c) => {
                const n = calmUsed(c.kind);
                return (
                  <button key={c.kind} className="calmbtn" onClick={() => toast(engine.calmCaller(call.id, c.kind))} title={c.hint}>
                    <Icon n={c.icon} size={14} /><span className="cb-txt"><b>{c.label}</b><span>{c.hint}</span></span>{n > 0 && <span className="cb-used">{n === 1 ? 'used — weaker' : 'overused'}</span>}
                  </button>
                );
              })}
              <button className="calmbtn breathe-btn" disabled={breathing} onClick={() => setBreathing(true)}><Icon n="pulse" size={14} /><span className="cb-txt"><b>Breathe with me</b><span>A guided breathing exercise. Strong on panic if you keep the rhythm.</span></span></button>
            </div>
          )}
          {side === 'jobs' && (
            <div className="calmlist">
              {!tasks.length && <div className="small muted">No jobs fit this caller.</div>}
              {tasks.map((t) => (
                <button key={t.id} className={`calmbtn job ${t.status ?? ''}`} disabled={!!t.status || doing.length > 0} onClick={() => toast(engine.assignTask(call.id, t.id))} title={t.say}>
                  <Icon n={t.status === 'done' ? 'check' : t.status === 'doing' ? 'clock' : 'wrench'} size={14} /><span className="cb-txt"><b>{t.label}</b><span>{t.status === 'done' ? 'Done' : t.status === 'doing' ? 'Doing it now…' : `“${t.say}”`}</span></span>
                </button>
              ))}
              <div className="small muted">A job gives a frightened caller something to do — and helps the crews when they arrive. Some jobs are dangerous in the wrong situation.</div>
            </div>
          )}
          {side === 'instruct' && (
            <div className="qchips">{QUICK_QUESTIONS.filter((q) => q.group === 'Guidance' || q.group === 'Instructions').map((q) => (
              <button key={q.group + q.intent} className={`chip ${call.asked[q.intent] ? 'asked' : ''}`} title={q.text} onClick={() => send(q.intent, q.text)}>{call.asked[q.intent] ? <Icon n="check" size={11} /> : null}{q.label}</button>
            ))}</div>
          )}
        </div>
        <SpecialCall engine={engine} call={call} inc={inc} />
        {onHold.length > 0 && <div className="small muted">On hold: {onHold.map((c) => c.profile.name).join(', ')}</div>}
      </div>
    </div>
  );
}

/** callers who need handling differently: a regular on file, someone calling for another person, a driver on the move */
function SpecialCall({ engine, call, inc }: { engine: GameEngine; call: Call; inc: Incident }) {
  const bump = useApp((s) => s.bump);
  const tp = inc.thirdParty, mv = inc.mover?.caller ? inc.mover : null;
  const reg = inc.regular ? engine.state.config.regulars?.[inc.regular.id] : null;
  if (!inc.regular && !tp && !mv) return null;
  const act = (r: { ok: boolean; reason?: string }) => { if (!r.ok) { audio.error(); useApp.getState().showToast(r.reason ?? 'Not possible', 'warn'); } else audio.click(); bump(); };
  return (
    <div className="specialcall">
      {inc.regular && <div className="sc-row"><span className="sc-tag">KNOWN CALLER</span><span>{inc.callerName}{reg ? ` · ${reg.calls} previous call${reg.calls === 1 ? '' : 's'}${reg.real ? ` (${reg.real} real)` : ''}` : ' · on file'} — <i>don't assume</i></span></div>}
      {tp && <div className="sc-row"><span className="sc-tag warn">THIRD PARTY</span><span>{tp.near ? (tp.kind === 'door' ? 'Caller is now with the patient.' : `The child is with ${tp.rel}.`) : tp.kind === 'door' ? (tp.window ? 'Can see the patient through a window — the door is still locked.' : 'Caller is outside a locked door and cannot see the patient.') : `A child calling about ${tp.rel}. They are not with them.`}</span>
        {!tp.near && <Btn size="sm" kind="primary" disabled={tp.tried >= 2} onClick={() => act(engine.getCloser(call.id))}>{tp.kind === 'door' ? 'Can they get in?' : `Take the phone to ${tp.rel}`}</Btn>}</div>}
      {mv && <div className="sc-row"><span className="sc-tag bad">ON THE MOVE</span><span>{mv.stopped ? 'The car has stopped — confirm where.' : 'The caller is driving. Every location they give you is already behind them.'}</span>
        {!mv.stopped && <Btn size="sm" kind="primary" onClick={() => act(engine.pullOver(call.id))}>Tell them to pull over</Btn>}</div>}
    </div>
  );
}
