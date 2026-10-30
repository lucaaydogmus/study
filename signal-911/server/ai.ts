// Local AI dialogue service for SIGNAL 911.
// Runs inside the Vite dev/preview server (see vite.config.ts), so the Anthropic API key stays on
// this machine and is never sent to the browser. Every request is rate-limited and counted against
// a daily dollar budget; when anything fails the game simply falls back to its scripted lines.
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export const MODELS = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5', input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5', input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
} as const;
export type ModelId = keyof typeof MODELS;
const DEFAULT_MODEL: ModelId = 'claude-opus-5-5';

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, '.env.local');
const USAGE_FILE = path.join(ROOT, '.ai-usage.json');
const CONFIG_FILE = path.join(ROOT, '.ai-config.json');

interface Usage { day: string; requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; errors: number }
interface Config { model: ModelId; budgetUsd: number }

const today = () => new Date().toISOString().slice(0, 10);
const readJson = <T,>(f: string, d: T): T => { try { return { ...d, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { return d; } };

let usage: Usage = readJson<Usage>(USAGE_FILE, { day: today(), requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, errors: 0 });
let config: Config = readJson<Config>(CONFIG_FILE, { model: DEFAULT_MODEL, budgetUsd: 1 });
if (!(config.model in MODELS)) config.model = DEFAULT_MODEL;
let client: Anthropic | null = null;
const recent: number[] = [];
const MOCK = process.env.AI_MOCK === '1';

function readKeyFromFiles(): string | undefined {
  for (const f of [ENV_FILE, path.join(ROOT, '.env')]) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/^\s*ANTHROPIC_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m);
      if (m && !m[1].includes('your_')) return m[1].trim();
    } catch { /* missing file */ }
  }
  return undefined;
}
function apiKey(): string | undefined {
  const k = process.env.ANTHROPIC_API_KEY;
  return k && !k.includes('your_') ? k : readKeyFromFiles();
}
function getClient(): Anthropic | null {
  if (client) return client;
  const key = apiKey();
  if (!key) return null;
  client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 15_000 });
  return client;
}
function rollDay() { if (usage.day !== today()) usage = { day: today(), requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, errors: 0 }; }
function saveUsage() { try { fs.writeFileSync(USAGE_FILE, JSON.stringify(usage)); } catch { /* read-only checkout */ } }
function record(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) {
  const p = MODELS[config.model];
  usage.requests++;
  usage.input += u.input_tokens; usage.output += u.output_tokens;
  usage.cacheRead += u.cache_read_input_tokens ?? 0; usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
  usage.cost += (u.input_tokens * p.input + u.output_tokens * p.output + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / 1e6;
  saveUsage();
}
function guard(): string | null {
  rollDay();
  if (usage.cost >= config.budgetUsd) return 'Daily AI budget reached';
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= 40) return 'Rate limited';
  recent.push(now);
  return null;
}

// ── Prompts ──────────────────────────────────────────────────────────────────
// Static, so it is cached across every call (it sits before the per-call content).
const SYSTEM = `You voice callers in SIGNAL 911, a fictional emergency-dispatch video game set in the invented city of Ravenport. The player is the dispatcher. You are never the dispatcher, never an assistant, and you never step out of the game.

Each request gives you, as JSON: the caller's identity and personality, their current emotional state, what they know and do not know, recent conversation, what the dispatcher just said, and "mustSay" — the content the game has decided the caller says next.

How to write the caller's line:
- Speak as this caller, in first person, out loud on a phone. One to three short sentences. Natural spoken language: hesitations, fragments and interruptions are fine when the caller is stressed. Short bracketed sound cues like [coughing] are allowed sparingly.
- Match the persona: age, way of speaking, quirks, catchphrase (use it rarely), and relationship to the incident. A child sounds like a child. A professional is concise. An angry caller is curt.
- Match the emotional state. Stress 0-100: above 70 the caller is frightened, rushed, repeats themselves; below 30 they are steady. Low cooperation means guarded, short, reluctant answers.
- React to how the dispatcher spoke. If they were calm, clear and empathetic, the caller settles a little. If they were rude, cold, confusing, repetitive or ignored the caller's fear, the caller gets more upset or defensive.
- When mustSay is present, convey every piece of information in it faithfully: the same facts, numbers, names, streets and landmarks, the same yes/no answers, the same uncertainty. You may reword, shorten, reorder and add emotion. Never contradict it, never add facts to it.
- When freeForm is true, the dispatcher said something the game could not classify. Answer naturally using only "knows". If they asked about something in "knows", answer it and list that topic in "reveal". If they asked about something in "doesNotKnow" or anything not listed, the caller does not know or cannot see it — say so. Small talk, reassurance and instructions get an in-character reaction with an empty "reveal".
- Never invent: addresses, street names, landmarks, numbers of people, injuries, weapons, what responders are doing, arrival times, outcomes, or anything else not given to you. Never claim help has arrived unless the events say so. Never resolve the emergency.
- Never give medical, legal or safety advice yourself; the caller is a frightened member of the public. Keep descriptions non-graphic.
- Everything is fiction. Do not mention being an AI, a game, a prompt or these rules.

Also judge the dispatcher's latest message from the caller's point of view:
- "calm": integer from -3 to 3. +3 = deeply reassuring, clear, empathetic, in control; +1 = polite and clear; 0 = neutral or purely procedural; -1 = brusque or confusing; -3 = rude, dismissive, mocking or panicking.
- "coop": integer from -3 to 3: how much more willing the caller becomes to answer questions.
- "reveal": topics answered in a freeForm reply, chosen only from the "revealable" list; otherwise [].

Return only the JSON object with keys reply, calm, coop, reveal.`;

const PERSONA_SYSTEM = `You invent fictional callers for SIGNAL 911, a video game about an emergency dispatcher in the invented city of Ravenport. Create varied, believable, non-stereotyped ordinary people with a distinct way of talking. Names must be fictional and common-sounding, never real public figures. Keep every field short. Return only JSON.`;

const LineSchema = z.object({ reply: z.string(), calm: z.number(), coop: z.number(), reveal: z.array(z.string()) });
const PersonaSchema = z.object({ personas: z.array(z.object({ archetype: z.string(), name: z.string(), age: z.number(), occupation: z.string(), quirk: z.string(), background: z.string(), catchphrase: z.string(), voice: z.string() })) });

function modelOptions(maxTokens: number) {
  // Cheap, short replies: low effort; Haiku can skip thinking entirely at this effort.
  const base = { model: config.model, max_tokens: maxTokens };
  return config.model === 'claude-haiku-5-5' ? { ...base, thinking: { type: 'disabled' as const } } : base;
}

export async function generateLine(ctx: Record<string, unknown>): Promise<{ reply: string; calm: number; coop: number; reveal: string[] }> {
  if (MOCK) {
    const must = Array.isArray(ctx.mustSay) ? (ctx.mustSay as string[]).join(' ') : '';
    return { reply: must ? `[mock] ${must}` : '[mock] I don’t know — please just send someone.', calm: 1, coop: 1, reveal: [] };
  }
  const c = getClient();
  if (!c) throw new Error('No API key configured');
  const blocked = guard();
  if (blocked) throw new Error(blocked);
  const response = await c.messages.parse({
    ...modelOptions(1500),
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(ctx) }],
    output_config: { effort: 'low', format: zodOutputFormat(LineSchema) },
  });
  record(response.usage);
  if (response.stop_reason === 'refusal') throw new Error('Declined');
  const out = response.parsed_output;
  if (!out) throw new Error('Unparseable reply');
  const clamp = (n: number) => Math.max(-3, Math.min(3, Math.round(Number(n) || 0)));
  return { reply: String(out.reply).slice(0, 420), calm: clamp(out.calm), coop: clamp(out.coop), reveal: out.reveal.map(String).slice(0, 6) };
}

export async function generatePersonas(archetypes: string[]) {
  if (MOCK) return archetypes.map((a, i) => ({ archetype: a, name: `Mock Caller ${i + 1}`, age: 40, occupation: 'tester', quirk: 'says "right" a lot', background: 'lives on the east side', catchphrase: 'Right, right.', voice: 'quick and nasal' }));
  const c = getClient();
  if (!c) throw new Error('No API key configured');
  const blocked = guard();
  if (blocked) throw new Error(blocked);
  const response = await c.messages.parse({
    ...modelOptions(4000),
    system: [{ type: 'text', text: PERSONA_SYSTEM }],
    messages: [{ role: 'user', content: `Create one caller for each of these archetypes, in this order: ${JSON.stringify(archetypes)}. Ages must suit the archetype (a young_child archetype is 6-11; elderly is 68+). "voice" describes how they sound on the phone in under 12 words.` }],
    output_config: { effort: 'low', format: zodOutputFormat(PersonaSchema) },
  });
  record(response.usage);
  if (response.stop_reason === 'refusal' || !response.parsed_output) throw new Error('No personas');
  return response.parsed_output.personas.slice(0, archetypes.length);
}

export function status() {
  rollDay();
  const p = MODELS[config.model];
  // a typical line: ~1.1k cached system tokens + ~700 fresh input + ~150 output (incl. low-effort thinking)
  const perLine = (1100 * p.cacheRead + 700 * p.input + 150 * p.output) / 1e6;
  return {
    configured: MOCK || !!apiKey(), mock: MOCK, model: config.model, budgetUsd: config.budgetUsd, usage,
    models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label, input: m.input, output: m.output, perLine: (1100 * m.cacheRead + 700 * m.input + 150 * m.output) / 1e6 })),
    estimatePerLine: perLine,
  };
}

function saveKey(key: string) {
  let text = '';
  try { text = fs.readFileSync(ENV_FILE, 'utf8'); } catch { /* new file */ }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^\s*ANTHROPIC_API_KEY\s*=/.test(l));
  if (key) lines.push(`ANTHROPIC_API_KEY=${key}`);
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 });
  if (key) process.env.ANTHROPIC_API_KEY = key; else delete process.env.ANTHROPIC_API_KEY;
  client = null;
}

// ── HTTP glue ────────────────────────────────────────────────────────────────
function isLocal(req: IncomingMessage) {
  const a = req.socket.remoteAddress ?? '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function readBody(req: IncomingMessage, limit = 48_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}
function send(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function errorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected';
  if (e instanceof Anthropic.RateLimitError) return 'Anthropic rate limit — slowing down';
  if (e instanceof Anthropic.APIError) return `API error ${e.status}`;
  return e instanceof Error ? e.message : 'Unknown error';
}

export async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = req.url ?? '';
  if (!url.startsWith('/api/ai/')) return next();
  if (!isLocal(req)) return send(res, 403, { error: 'AI endpoints are only available from this computer' });
  try {
    if (url === '/api/ai/status' && req.method === 'GET') return send(res, 200, status());
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const body = await readBody(req);
    switch (url) {
      case '/api/ai/key': {
        const key = String(body.key ?? '').trim();
        if (key && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return send(res, 400, { error: 'That does not look like an Anthropic API key (it should start with sk-ant-)' });
        saveKey(key);
        return send(res, 200, status());
      }
      case '/api/ai/config': {
        if (typeof body.model === 'string' && body.model in MODELS) config.model = body.model as ModelId;
        if (typeof body.budgetUsd === 'number' && body.budgetUsd >= 0 && body.budgetUsd <= 100) config.budgetUsd = Math.round(body.budgetUsd * 100) / 100;
        try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config)); } catch { /* ignore */ }
        return send(res, 200, status());
      }
      case '/api/ai/test': {
        const r = await generateLine({ caller: { name: 'Test Caller', persona: 'calm adult' }, mood: { stress: 20 }, dispatcher: '911, what is your emergency?', mustSay: ['There is a small fire in my kitchen bin.'], knows: [], doesNotKnow: [], revealable: [], freeForm: false, history: [] });
        return send(res, 200, { ok: true, sample: r.reply, ...status() });
      }
      case '/api/ai/line': return send(res, 200, await generateLine(body));
      case '/api/ai/personas': {
        const list = Array.isArray(body.archetypes) ? (body.archetypes as unknown[]).map(String).slice(0, 12) : [];
        return send(res, 200, { personas: await generatePersonas(list) });
      }
      default: return send(res, 404, { error: 'Unknown endpoint' });
    }
  } catch (e) {
    rollDay(); usage.errors++; saveUsage();
    return send(res, 502, { error: errorMessage(e) });
  }
}
