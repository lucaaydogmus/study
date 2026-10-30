/** Tiny Web Audio sound set: everything is synthesised locally, nothing is downloaded. */
let ctx: AudioContext | null = null;
let volume = 0.6;
let muted = false;

export function configureAudio(v: number, m: boolean) { volume = v; muted = m; }

/** Browsers only allow audio after a user gesture; call this from a click. */
export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { ctx = null; }
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', gain = 0.18) {
  if (!ctx || muted || volume <= 0) return;
  try {
    const o = ctx.createOscillator(), g = ctx.createGain();
    const t = ctx.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * volume), t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch { /* audio is best-effort */ }
}

export const sfx = {
  /** Classic double-burst telephone ring. */
  ring: () => { for (const t of [0, 0.22]) { tone(440, t, 0.18, 'sine', 0.22); tone(480, t, 0.18, 'sine', 0.22); } },
  answer: () => { tone(520, 0, 0.07, 'square', 0.08); tone(780, 0.07, 0.1, 'square', 0.08); },
  end: () => { tone(620, 0, 0.08, 'square', 0.08); tone(400, 0.08, 0.12, 'square', 0.08); },
  select: () => tone(700, 0, 0.04, 'triangle', 0.08),
  dispatch: () => { tone(660, 0, 0.08, 'triangle', 0.14); tone(880, 0.09, 0.12, 'triangle', 0.14); },
  arrive: () => tone(560, 0, 0.12, 'sine', 0.14),
  warn: () => { tone(330, 0, 0.14, 'sawtooth', 0.1); tone(300, 0.16, 0.18, 'sawtooth', 0.1); },
  good: () => { tone(523, 0, 0.1, 'sine', 0.14); tone(659, 0.1, 0.1, 'sine', 0.14); tone(784, 0.2, 0.18, 'sine', 0.14); },
  bad: () => { tone(220, 0, 0.25, 'sawtooth', 0.12); },
  hangup: () => { tone(300, 0, 0.1, 'square', 0.08); tone(300, 0.15, 0.1, 'square', 0.08); },
};
