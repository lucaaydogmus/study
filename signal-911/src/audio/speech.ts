// Real voices and a real microphone. Caller and crew lines are read aloud by the browser's speech
// engine (a different voice, pitch and pace per caller), and push-to-talk turns what you say into
// text the dispatcher console understands. Both degrade gracefully where the browser lacks them.

export interface VoiceProfile { sex: 'M' | 'F'; age: number; panic: number; radio?: boolean; seed: number; child?: boolean }

const synth: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
let voices: SpeechSynthesisVoice[] = [];
const loadVoices = () => { if (synth) voices = synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang)); };
if (synth) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }

// voice names → who they sound like (desktop, Edge neural, Chrome/Google and Apple voices)
const CHILD = /\b(ana|maisie)\b/i;
const FEMALE = /female|woman|\b(aria|jenny|michelle|sonia|libby|natasha|emily|clara|molly|neerja|ava|emma|sara|nancy|jane|amber|ashley|cora|elizabeth|monica|samantha|karen|moira|tessa|fiona|serena|victoria|allison|susan|zira|hazel|catherine|heera|joanna|kendra|kimberly|salli|ivy|olivia|amy|nicole|aoife|leah|yan|isla|hollie|bella|abbie|ruby|evelyn)\b|google us english/i;
const MALE = /\bmale\b|\b(guy|christopher|eric|roger|steffan|ryan|thomas|connor|william|liam|prabhat|davis|tony|jason|brandon|andrew|brian|daniel|alex|fred|oliver|arthur|aaron|david|mark|george|james|ravi|matthew|justin|joey|russell|elliot|ethan|noah|alfie|oscar|kenneth|reed|rishi)\b/i;
/** how natural a voice sounds: neural/online voices first, the old robotic desktop voices last */
function quality(v: SpeechSynthesisVoice): number {
  let q = 0;
  if (/natural|neural/i.test(v.name)) q += 100;
  if (/online/i.test(v.name)) q += 60;
  if (/google/i.test(v.name)) q += 50;
  if (/premium|enhanced|siri/i.test(v.name)) q += 45;
  if (!v.localService) q += 10;
  if (/^microsoft (david|zira|mark|hazel|george|susan|james|catherine|ravi|heera)( desktop)?\b/i.test(v.name) && !/online|natural/i.test(v.name)) q -= 30;
  if (/en-(us|gb)/i.test(v.lang)) q += 4;
  return q;
}
const sexOfVoice = (v: SpeechSynthesisVoice): 'M' | 'F' | 'C' | '?' => (CHILD.test(v.name) ? 'C' : MALE.test(v.name) && !/female/i.test(v.name) ? 'M' : FEMALE.test(v.name) ? 'F' : '?');

export const speechSupported = (): boolean => !!synth;
const FEMALE_NAMES = new Set(['Maria', 'Priya', 'Aisha', 'Grace', 'Hannah', 'Elena', 'Sofia', 'Claire', 'Nadia', 'Mei', 'Lucy', 'Ruth', 'Imani', 'Tess', 'Rosa', 'Dorothy', 'Margaret', 'Edith', 'Mabel', 'Anna', 'Julia', 'Sarah', 'Emma', 'Laura', 'Kate', 'Zoe', 'Amy', 'Leah', 'Nina', 'Ivy', 'Jade', 'Ella']);
export const sexOfName = (name: string): 'M' | 'F' => (FEMALE_NAMES.has(name.split(' ')[0]) ? 'F' : 'M');
let enabled = true;
let volume = 0.9;
export function configureSpeech(opts: { enabled?: boolean; volume?: number }) {
  if (opts.enabled !== undefined) enabled = opts.enabled;
  if (opts.volume !== undefined) volume = Math.max(0, Math.min(1, opts.volume));
  if (!enabled) stopSpeech();
}
/** what the browser offers: how many voices, and how many of them sound natural */
export function voiceReport(): { total: number; natural: number; best: string | null } {
  if (!voices.length) loadVoices();
  const nat = voices.filter((v) => quality(v) >= 50);
  const best = [...voices].sort((a, b) => quality(b) - quality(a))[0];
  return { total: voices.length, natural: nat.length, best: best?.name ?? null };
}

/** the best-sounding voice that suits the speaker; the same speaker always gets the same voice */
function pickVoice(p: VoiceProfile): SpeechSynthesisVoice | undefined {
  if (!voices.length) loadVoices();
  if (!voices.length) return undefined;
  const want = p.child ? 'C' : p.sex;
  let pool = voices.filter((v) => sexOfVoice(v) === want);
  if (!pool.length && want === 'C') pool = voices.filter((v) => sexOfVoice(v) === 'F');
  if (!pool.length) pool = voices.filter((v) => sexOfVoice(v) === '?');
  if (!pool.length) pool = voices;
  const top = Math.max(...pool.map(quality));
  const best = pool.filter((v) => quality(v) >= top - 15);
  return best[p.seed % best.length];
}

/** tidy a line so a speech engine reads it like a person would say it */
export function speakable(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/[{}*_#]/g, '')
    .replace(/(\b\w+)[—–-]\s+\1\b/gi, '$1, $1')
    .replace(/\s*[—–]\s*/g, ', ').replace(/\.{2,}|…/g, ', ')
    .replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?').replace(/,\s*([,.!?])/g, '$1')
    .replace(/\b([A-Z]{4,})\b/g, (w) => w.toLowerCase())
    .replace(/\bINC-0*(\d+)/g, 'incident $1').replace(/\bER\b/g, 'E R').replace(/\bPD\b/g, 'P D')
    .replace(/\s+/g, ' ').replace(/^[,\s]+/, '').trim();
}
/** sentences, so each gets its own breath and a long line never stalls the engine */
function sentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const out: string[] = [];
  for (const raw of parts) { const t = raw.trim(); if (!t) continue; if (out.length && (t.length < 14 || out[out.length - 1].length < 14)) out[out.length - 1] += ' ' + t; else out.push(t); }
  return out;
}

type Item = { channel: string; text: string; p: VoiceProfile; at: number; gap: number };
let queue: Item[] = [];
let speaking: Item | null = null;
let watchdog = 0;
function pump() {
  if (!synth || speaking) return;
  const now = performance.now();
  // never fall far behind the transcript: lines older than ten seconds are dropped
  queue = queue.filter((q) => now - q.at < 10000);
  const it = queue.shift();
  if (!it) return;
  speaking = it;
  const u = new SpeechSynthesisUtterance(it.text);
  const v = pickVoice(it.p);
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'en-US';
  const natural = !!v && quality(v) >= 50;
  const old = it.p.age > 68;
  const tense = Math.max(0, Math.min(1, (it.p.panic - 40) / 50));
  // neural voices sound best close to neutral; small, consistent per-speaker offsets give variety
  const jitter = ((it.p.seed % 7) - 3) / 100;
  let pitch = 1 + jitter + tense * 0.05 - (old ? 0.05 : 0) + (it.p.child && sexOfVoice(v ?? ({ name: '' } as SpeechSynthesisVoice)) !== 'C' ? 0.22 : 0);
  if (!natural) pitch += it.p.sex === 'F' ? 0.04 : -0.04;
  u.pitch = Math.max(0.8, Math.min(1.3, pitch));
  u.rate = Math.max(0.78, Math.min(1.3, 0.98 + tense * 0.16 - (old ? 0.1 : 0) + (it.p.radio ? 0.06 : 0) + jitter));
  u.volume = volume * (it.p.radio ? 0.85 : 1);
  const done = () => { if (speaking !== it) return; speaking = null; clearTimeout(watchdog); window.setTimeout(pump, it.gap); };
  u.onend = done; u.onerror = done;
  // some engines never fire onend: don't let the queue jam
  clearTimeout(watchdog);
  watchdog = window.setTimeout(done, 2500 + it.text.length * 110);
  synth.speak(u);
}

/** queue a line for a speaker on a channel ("call:<id>" or "radio:<unit>") */
export function speakLine(text: string, p: VoiceProfile, channel = 'misc'): void {
  if (!synth || !enabled || !text) return;
  const clean = speakable(text);
  if (!clean || !/[a-z]/i.test(clean)) return;
  const now = performance.now();
  const gap = Math.round(260 - Math.max(0, Math.min(1, (p.panic - 40) / 50)) * 170);
  for (const sn of sentences(clean)) queue.push({ channel, text: sn, p, at: now, gap });
  pump();
}
/** silence a channel (or every channel starting with a prefix) right now */
export function stopChannel(prefix: string, except?: string) {
  if (!synth) return;
  const hit = (c: string) => c.startsWith(prefix) && c !== except;
  queue = queue.filter((q) => !hit(q.channel));
  if (speaking && hit(speaking.channel)) { speaking = null; clearTimeout(watchdog); synth.cancel(); window.setTimeout(pump, 60); }
}
export function stopSpeech() { queue = []; speaking = null; clearTimeout(watchdog); synth?.cancel(); }
/** a sample line, for the settings page */
export function previewVoice(sex: 'M' | 'F', panic = 50) { stopSpeech(); speakLine(sex === 'F' ? "Hello? I need help — my neighbour's collapsed in the garden and he isn't answering me." : "Yeah, hi. There's been a crash on the high street. Two cars, and one of the drivers is still inside.", { sex, age: 38, panic, seed: Math.floor(Math.random() * 99) }, 'preview'); }

// ── microphone (push to talk) ───────────────────────────────────────────────
type Rec = { start: () => void; stop: () => void; abort: () => void; continuous: boolean; interimResults: boolean; lang: string; maxAlternatives: number; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const RecCtor: (new () => Rec) | undefined = typeof window !== 'undefined' ? ((window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition) : undefined;
export const micSupported = (): boolean => !!RecCtor;

let active: Rec | null = null;
/** start listening; `onText` gets the live transcript, `onFinal` the finished sentence */
export function startListening(onText: (t: string) => void, onFinal: (t: string) => void, onEnd: (err?: string) => void): boolean {
  if (!RecCtor) return false;
  stopListening();
  const r = new RecCtor();
  r.lang = 'en-US'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
  let finalText = '';
  r.onresult = (e) => {
    let interim = '';
    for (let i = 0; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript; }
    onText((finalText + ' ' + interim).trim());
  };
  r.onerror = (e) => { onEnd(e.error); };
  r.onend = () => { active = null; if (finalText.trim()) onFinal(finalText.trim()); onEnd(); };
  try { stopSpeech(); r.start(); active = r; return true; } catch { return false; }
}
export function stopListening() { if (active) { try { active.stop(); } catch { /* already stopped */ } } }
export const isListening = () => !!active;
