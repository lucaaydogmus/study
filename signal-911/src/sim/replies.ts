// Answering in your own words. Callers ask you things in the chat and crews ask over the radio; there are
// no answer buttons. Whatever you type (or say) is read for what you mean — yes or no, go or stay, which
// of the things they could do — and acted on. If it is unclear, they ask you to say it again.
import type { GameEngine } from './engine';
import type { Decision } from './types';

const STOP = new Set(['the', 'and', 'you', 'your', 'them', 'they', 'that', 'this', 'with', 'from', 'have', 'just', 'what', 'when', 'will', 'there', 'their', 'into', 'about', 'only', 'then', 'than', 'were', 'been', 'here', 'it’s', "it's", 'okay', 'right', 'please', 'dispatch', 'copy']);
const words = (s: string) => (s.toLowerCase().match(/[a-z’']{3,}/g) ?? []).map((w) => w.replace(/[’']/g, '')).filter((w) => !STOP.has(w));
const NEG = /\b(no|nope|don'?t|do not|never|stay|wait|stop|negative|not|hold|keep|deny|decline|leave it|stand down|don’t)\b/i;
const POS = /\b(yes|yeah|yep|go|do it|okay|ok|sure|affirmative|approved?|fine|send|take|grant(ed)?|let them|go ahead|copy that)\b/i;
const optPolarity = (label: string): -1 | 0 | 1 => /^(no\b|don'?t|do not|stay|wait|keep|deny|decline|not now|negative|hold|leave|stand)/i.test(label) ? -1 : /^(yes|go\b|approve|send|take|do\b|request|get|grant|let|rotate)/i.test(label) ? 1 : 0;

/** which option a free-text reply means, or null if it is not clear */
export function matchOption(text: string, options: Array<{ id: string; label: string; say?: string; hint?: string }>): string | null {
  const t = text.toLowerCase();
  const tw = new Set(words(t));
  // the first word carries the answer: "yes, go — stay low" is a yes
  const lead = (t.trim().match(/^[a-z'’]+/)?.[0] ?? '').replace(/[’']/g, '');
  const leadPos = /^(yes|yeah|yep|ok|okay|sure|go|affirmative|approved?|send|grant(ed)?)$/.test(lead), leadNeg = /^(no|nope|negative|dont|never|not|stay|wait|hold|deny)$/.test(lead);
  const neg = leadNeg || (!leadPos && NEG.test(t)), pos = leadPos || (!leadNeg && POS.test(t));
  let best: string | null = null, bs = 0, second = 0;
  for (const o of options) {
    const ow = new Set([...words(o.label), ...words(o.say ?? ''), ...words(o.hint ?? '')]);
    let score = 0;
    for (const w of tw) if (ow.has(w)) score += words(o.label).includes(w) ? 1.6 : 0.7;
    const p = optPolarity(o.label);
    if (neg && p === -1) score += 2.2;
    if (pos && !neg && p === 1) score += 2.2;
    if (neg && p === 1) score -= 1.2;
    if (score > bs) { second = bs; bs = score; best = o.id; } else if (score > second) second = score;
  }
  return bs >= 1.5 && bs - second >= 0.4 ? best : null;
}

export interface Ask { kind: 'decision' | 'query'; id: string; unitId: string; incId: string; text: string; expiresAt: number; hints: string[] }
/** everything crews (and neighbouring counties) are waiting on you to answer over the radio */
export function pendingAsks(e: GameEngine): Ask[] {
  const st = e.state;
  const out: Ask[] = [];
  for (const d of st.decisions ?? []) if (!d.chosen) out.push({ kind: 'decision', id: d.id, unitId: d.unitId, incId: d.incId, text: d.prompt.replace(/^[^:]{1,40}: /, ''), expiresAt: d.expiresAt, hints: d.options.map((o) => o.label.replace(/\s*\(.*\)$/, '').toLowerCase()) });
  for (const q of st.unitQueries ?? []) if (q.status === 'open' || q.status === 'standby') out.push({ kind: 'query', id: q.id, unitId: q.unitId, incId: q.incId, text: q.text, expiresAt: q.expiresAt, hints: ['tell them what you know', 'stand by', 'none / negative'] });
  return out.sort((a, b) => a.expiresAt - b.expiresAt);
}

/** who a radio transmission is answering, if anyone */
export function askFor(e: GameEngine, text: string, ctx: { unitId?: string; channel?: string }): Ask | undefined {
  const st = e.state;
  const asks = pendingAsks(e);
  const t = text.toLowerCase();
  const named = asks.filter((a) => { const u = st.units[a.unitId]; return u && (t.startsWith(u.spoken.toLowerCase()) || t.startsWith(u.callsign.toLowerCase()) || t.includes(u.callsign.toLowerCase())); });
  const onChan = ctx.unitId ? asks.filter((a) => a.unitId === ctx.unitId) : ctx.channel === 'outside' ? asks.filter((a) => st.decisions?.find((d) => d.id === a.id)?.kind === 'aidOut') : [];
  return named[0] ?? onChan[0] ?? (asks.length === 1 && !ctx.unitId ? asks[0] : undefined);
}
/** a radio transmission from dispatch that may be an answer to someone who asked (forced = what the AI read it as) */
export function replyOnRadio(e: GameEngine, text: string, ctx: { unitId?: string; channel?: string }, forced?: string): { handled: boolean; reason?: string } {
  const st = e.state;
  const asks = pendingAsks(e);
  if (!asks.length) return { handled: false };
  // addressed by name ("Engine 3, approved"), the channel you are on, or the only one waiting
  const t = text.toLowerCase();
  const named = asks.filter((a) => { const u = st.units[a.unitId]; return u && (t.startsWith(u.spoken.toLowerCase()) || t.startsWith(u.callsign.toLowerCase()) || t.includes(u.callsign.toLowerCase())); });
  const onChan = ctx.unitId ? asks.filter((a) => a.unitId === ctx.unitId) : ctx.channel === 'outside' ? asks.filter((a) => st.decisions?.find((d) => d.id === a.id)?.kind === 'aidOut') : [];
  const target = named[0] ?? onChan[0] ?? (asks.length === 1 && !ctx.unitId ? asks[0] : undefined);
  if (!target) return { handled: false };
  const u = st.units[target.unitId];
  const clean = text.replace(new RegExp(`^(${u?.spoken ?? '_'}|${u?.callsign ?? '_'})[,.]?\\s*`, 'i'), '');
  if (target.kind === 'query') {
    const q = st.unitQueries!.find((x) => x.id === target.id)!;
    const opt = e.queryOptions(q.id);
    let mode: 'relay' | 'deny' | 'standby';
    if (/\b(stand ?by|hold on|wait|checking|finding out|let me (check|find)|one (sec|moment)|working on it|find out)\b/i.test(clean)) mode = 'standby';
    else if (/\b(no|none|negative|nothing|nobody|no one|not that we know|clear)\b/i.test(clean)) mode = opt.canDeny ? 'deny' : 'standby';
    else if (/\b(don'?t know|unknown|not sure|no idea)\b/i.test(clean)) mode = 'standby';
    else mode = 'relay';
    if (mode === 'relay' && !opt.known) { e.radio('DISPATCH', `${u?.spoken ?? 'Unit'}, ${clean}`, 'dispatch', u?.id, q.incId); if (u) e.radio(u.spoken, 'Copy... is that from the caller? Confirm when you have it.', 'unit', u.id, q.incId); return { handled: true, reason: 'You have not got that from the caller yet' }; }
    if (mode === 'standby' && q.status === 'standby') { e.radio('DISPATCH', `${u?.spoken ?? 'Unit'}, still working on it.`, 'dispatch', u?.id, q.incId); return { handled: true }; }
    const r = e.answerUnitQuery(q.id, mode);
    const sent = [...st.radio].reverse().find((m) => m.from === 'DISPATCH');
    if (sent) sent.understood = mode === 'relay' ? 'relayed what the caller told you' : mode === 'deny' ? 'none / negative' : 'stand by';
    return { handled: true, reason: r.ok ? undefined : r.reason };
  }
  const d = st.decisions!.find((x) => x.id === target.id) as Decision;
  const opt = forced && d.options.some((o) => o.id === forced) ? forced : matchOption(clean, d.options);
  e.radio('DISPATCH', `${u ? `${u.spoken}, ` : ''}${clean}`, 'dispatch', u?.id, d.incId || undefined);
  if (!opt) {
    if (u) e.radio(u.spoken, `Say again, dispatch? ${d.options.length === 2 ? `${d.options[0].label} or ${d.options[1].label.toLowerCase()}?` : 'Need a clear answer.'}`, 'unit', u.id, d.incId || undefined);
    st.stats.sayAgainAsks = (st.stats.sayAgainAsks ?? 0) + 1;
    return { handled: true, reason: 'They did not understand — be clearer' };
  }
  const sent = [...st.radio].reverse().find((m) => m.from === 'DISPATCH');
  if (sent) sent.understood = d.options.find((o) => o.id === opt)?.label;
  const r = e.decide(d.id, opt);
  return { handled: true, reason: r.ok ? undefined : r.reason };
}
