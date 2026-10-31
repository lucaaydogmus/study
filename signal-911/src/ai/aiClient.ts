// Browser side of the AI callers. Talks only to the local server (/api/ai/*), never to Anthropic directly.
import type { GameEngine, EngineEvent } from '../sim/engine';
import { buildAiContext } from '../sim/aiContext';
import { personalityOf, speakerOf } from '../sim/crew';
import { addressOf } from '../sim/city';

export interface AiStatus {
  configured: boolean; mock: boolean; model: string; budgetUsd: number; estimatePerLine: number;
  usage: { day: string; requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; errors: number };
  models: Array<{ id: string; label: string; input: number; output: number; perLine: number }>;
  error?: string; sample?: string; ok?: boolean;
}

async function call<T>(path: string, body?: unknown, timeoutMs = 9000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    const data = await res.json().catch(() => ({ error: 'The AI server is not running (use npm run dev)' }));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
    return data as T;
  } finally { clearTimeout(t); }
}
export const aiApi = {
  status: () => call<AiStatus>('/api/ai/status'),
  saveKey: (key: string) => call<AiStatus>('/api/ai/key', { key }),
  setConfig: (c: { model?: string; budgetUsd?: number }) => call<AiStatus>('/api/ai/config', c),
  test: () => call<AiStatus>('/api/ai/test', {}, 20000),
};

// ── Persona pool: one cheap request yields a dozen distinct callers ─────────
const POOL_KEY = 'signal911.personas';
type Persona = { archetype: string; name: string; age: number; occupation: string; quirk: string; background: string; catchphrase: string; voice: string };
const loadPool = (): Persona[] => { try { return JSON.parse(localStorage.getItem(POOL_KEY) ?? '[]'); } catch { return []; } };
const savePool = (p: Persona[]) => { try { localStorage.setItem(POOL_KEY, JSON.stringify(p.slice(-60))); } catch { /* ignore */ } };
const ARCHES = ['panicked_parent', 'confused_elderly', 'angry_motorist', 'calm_serious', 'prankster', 'witness', 'injured_self', 'child_caller', 'professional', 'worried_neighbor', 'drunk_caller', 'shopkeeper'];

export class AiManager {
  private off: (() => void) | null = null;
  private inFlight = new Map<string, number>();
  private lastRefill = 0;
  lines = 0; failures = 0; lastError = '';
  constructor(private engine: GameEngine, private maxLinesPerShift: number, private onError: (msg: string) => void) {}

  start() {
    this.engine.state.flags.ai = true;
    this.off = this.engine.on((e) => this.onEvent(e));
    void this.refill();
  }
  stop() { this.off?.(); this.off = null; this.engine.state.flags.ai = false; }

  private onEvent(e: EngineEvent) {
    if (e.type === 'ring') this.assignPersona(e.callId);
    if (e.type === 'ai_request') void this.voice(e.callId, e.lineIds, e.intent, e.playerText);
  }

  private assignPersona(callId: string) {
    const call = this.engine.state.calls[callId];
    if (!call || call.isCallback) return;
    const pool = loadPool();
    const i = pool.findIndex((p) => p.archetype === call.profile.archetype);
    if (i >= 0) {
      const [p] = pool.splice(i, 1);
      savePool(pool);
      this.engine.applyPersona(callId, p);
    }
    if (pool.length < 6) void this.refill();
  }

  private async refill() {
    if (Date.now() - this.lastRefill < 120_000 || loadPool().length >= 8) return;
    this.lastRefill = Date.now();
    try {
      const res = await call<{ personas: Persona[] }>('/api/ai/personas', { archetypes: ARCHES }, 30000);
      savePool([...loadPool(), ...res.personas.filter((p) => ARCHES.includes(p.archetype))]);
    } catch { /* personas are optional flavour */ }
  }

  private async voice(callId: string, lineIds: number[], intent: string, playerText: string) {
    const eng = this.engine;
    if (this.lines >= this.maxLinesPerShift) { eng.releaseLines(callId, lineIds); return; }
    const token = (this.inFlight.get(callId) ?? 0) + 1;
    this.inFlight.set(callId, token);
    let ctx;
    try { ctx = buildAiContext(eng, callId, lineIds, intent, playerText); } catch { eng.releaseLines(callId, lineIds); return; }
    try {
      const out = await call<{ reply: string; calm: number; coop: number; reveal: string[] }>('/api/ai/line', ctx, 9000);
      this.lines++;
      if (!eng.voiceLines(callId, lineIds, out.reply, { calm: out.calm, coop: out.coop, reveal: out.reveal })) eng.releaseLines(callId, lineIds);
    } catch (err) {
      this.failures++;
      this.lastError = err instanceof Error ? err.message : String(err);
      eng.releaseLines(callId, lineIds);
      if (this.failures === 1 || this.failures % 10 === 0) this.onError(`AI caller unavailable — using scripted lines (${this.lastError})`);
    } finally {
      if (this.inFlight.get(callId) === token) this.inFlight.delete(callId);
    }
  }

  /** what an answer means when plain keyword matching cannot tell ("best not, they're nearly there") */
  async interpret(question: string, options: Array<{ id: string; label: string }>, reply: string): Promise<string | null> {
    if (this.lines >= this.maxLinesPerShift) return null;
    try { const r = await call<{ option: string | null }>('/api/ai/interpret', { question, options, reply }, 5000); this.lines++; return r.option; } catch { return null; }
  }
  /** a crew's radio answer, in their own voice: the facts and decisions stay the game's */
  async voiceCrew(unitId: string, msgId: string, dispatcher: string): Promise<string | null> {
    const eng = this.engine, st = eng.state;
    const m = st.radio.find((x) => x.id === msgId), u = st.units[unitId];
    if (!m || !u || this.lines >= this.maxLinesPerShift) return null;
    const inc = u.assignedIncidentId ? st.incidents[u.assignedIncidentId] : undefined;
    const ctx = {
      unit: { callsign: u.callsign, type: u.typeLabel, service: u.service, status: u.status.replace(/_/g, ' ').toLowerCase(), note: u.note ?? null },
      speaker: speakerOf(eng, u), personality: personalityOf(eng, u),
      incident: inc ? { what: inc.label, where: addressOf(eng.city, inc.reportedNode ?? inc.nodeId), crewsOnScene: eng.onScene(inc).length } : null,
      history: st.radio.filter((x) => x.unitId === u.id && x.id !== msgId).slice(-6).map((x) => `${x.from === 'DISPATCH' ? 'Dispatch' : u.callsign}: ${x.text}`),
      dispatcher, mustSay: [m.text],
    };
    try {
      const r = await call<{ reply: string }>('/api/ai/crew', ctx, 7000);
      this.lines++;
      if (r.reply && st.radio.includes(m)) m.text = r.reply.replace(/\s+/g, ' ').trim();
      return m.text;
    } catch { return null; }
  }
}
