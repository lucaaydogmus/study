// Real voices and a real microphone. Caller and crew lines are read aloud by the browser's speech
// engine (a different voice, pitch and pace per caller), and push-to-talk turns what you say into
// text the dispatcher console understands. Both degrade gracefully where the browser lacks them.

export interface VoiceProfile { sex: 'M' | 'F'; age: number; panic: number; radio?: boolean; seed: number }

const synth: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
let voices: SpeechSynthesisVoice[] = [];
const loadVoices = () => { if (synth) voices = synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang)); };
if (synth) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }

const FEMALE = /female|woman|zira|samantha|victoria|karen|moira|tessa|fiona|serena|susan|hazel|libby|sonia|aria|jenny|natasha|emma|olivia|ava|allison|kate|google uk english female|google us english/i;
const MALE = /male|man|david|mark|daniel|alex|fred|george|ryan|guy|thomas|oliver|arthur|james|christopher|eric|google uk english male/i;

export const speechSupported = (): boolean => !!synth;
const FEMALE_NAMES = new Set(['Maria', 'Priya', 'Aisha', 'Grace', 'Hannah', 'Elena', 'Sofia', 'Claire', 'Nadia', 'Mei', 'Lucy', 'Ruth', 'Imani', 'Tess', 'Rosa', 'Dorothy', 'Margaret', 'Edith', 'Mabel', 'Anna', 'Julia', 'Sarah', 'Emma', 'Laura', 'Kate', 'Zoe', 'Amy', 'Leah', 'Nina', 'Ivy', 'Jade', 'Ella']);
export const sexOfName = (name: string): 'M' | 'F' => (FEMALE_NAMES.has(name.split(' ')[0]) ? 'F' : 'M');
let enabled = true;
let volume = 0.9;
export function configureSpeech(opts: { enabled?: boolean; volume?: number }) {
  if (opts.enabled !== undefined) enabled = opts.enabled;
  if (opts.volume !== undefined) volume = Math.max(0, Math.min(1, opts.volume));
  if (!enabled) synth?.cancel();
}

function pickVoice(p: VoiceProfile): SpeechSynthesisVoice | undefined {
  if (!voices.length) loadVoices();
  if (!voices.length) return undefined;
  const pool = voices.filter((v) => (p.sex === 'F' ? FEMALE.test(v.name) && !/\bmale\b/i.test(v.name.replace(/female/i, '')) : MALE.test(v.name) && !FEMALE.test(v.name)));
  const list = pool.length ? pool : voices;
  return list[p.seed % list.length];
}

/** read a line aloud; `interrupt` cuts off whatever is being said */
export function speakLine(text: string, p: VoiceProfile, interrupt = false): void {
  if (!synth || !enabled || !text || /^\(/.test(text.trim())) return;
  const clean = text.replace(/\([^)]*\)/g, ' ').replace(/[*_#]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  if (interrupt) synth.cancel();
  // keep the queue short so voices never lag far behind the transcript
  if (synth.pending && !interrupt) synth.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  const v = pickVoice(p);
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'en-US';
  const childish = p.age < 13, old = p.age > 68;
  u.pitch = Math.max(0.1, Math.min(2, (p.sex === 'F' ? 1.12 : 0.92) + (childish ? 0.45 : 0) - (old ? 0.12 : 0) + (p.panic - 50) / 260));
  u.rate = Math.max(0.6, Math.min(1.6, 1.0 + (p.panic - 45) / 160 - (old ? 0.14 : 0) + (p.radio ? 0.12 : 0)));
  u.volume = volume * (p.radio ? 0.85 : 1);
  synth.speak(u);
}
export function stopSpeech() { synth?.cancel(); }

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
  try { synth?.cancel(); r.start(); active = r; return true; } catch { return false; }
}
export function stopListening() { if (active) { try { active.stop(); } catch { /* already stopped */ } } }
export const isListening = () => !!active;
