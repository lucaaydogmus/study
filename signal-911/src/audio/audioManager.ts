// Procedural audio: every sound is synthesised with Web Audio, so there are no assets to load.
// Buses: master → (effects | radio | music | ambience | sirens). All volumes are user-configurable.
import type { Settings } from '../sim/profile';

type Bus = 'effects' | 'radio' | 'music' | 'ambience' | 'sirens';
export type SirenKind = 'police' | 'fire' | 'medical' | 'rotor';
export interface SirenVoice { id: string; kind: SirenKind; pan: number; vol: number; variant?: number }
interface LiveVoice { kind: SirenKind; gain: GainNode; pan: StereoPannerNode; sources: Array<OscillatorNode | AudioBufferSourceNode> }
/** loudness of each kind of voice at full volume (comparable to the phone ring) */
const SIREN_PEAK: Record<SirenKind, number> = { police: 0.2, fire: 0.22, medical: 0.17, rotor: 0.55 };

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private settings: Settings | null = null;
  private ringTimer: number | null = null;
  private ringing = 0;
  private noiseBuf: AudioBuffer | null = null;
  private amb: { src: AudioBufferSourceNode; gain: GainNode; kind: string }[] = [];
  private officeHum: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private musicTimer: number | null = null;
  private ambKind = '';
  private voices = new Map<string, LiveVoice>();

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        (['effects', 'radio', 'music', 'ambience', 'sirens'] as Bus[]).forEach((b) => { const g = this.ctx!.createGain(); g.connect(this.master!); this.buses[b] = g; });
        const n = this.ctx.sampleRate * 2;
        this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        this.applySettings();
      } catch { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** must be called from a user gesture at least once */
  unlock() { this.ensure(); }

  configure(s: Settings) { this.settings = s; this.applySettings(); }
  private applySettings() {
    const s = this.settings;
    if (!s || !this.ctx || !this.master) return;
    this.master.gain.value = s.muted ? 0 : s.master;
    this.buses.effects!.gain.value = s.effects;
    this.buses.radio!.gain.value = s.radio;
    this.buses.music!.gain.value = s.music * 0.5;
    this.buses.ambience!.gain.value = s.ambience * 0.6;
    this.buses.sirens!.gain.value = (s.sirens ?? 0.7) * 1.1;
    if (s.music > 0.01 && !this.musicTimer) this.startMusic(); else if (s.music <= 0.01) this.stopMusic();
  }

  // everything heard through the caller's phone goes through a narrow telephone band
  private phoneNode: AudioNode | null = null;
  private phoneIn(): AudioNode | null {
    const ctx = this.ensure(); if (!ctx) return null;
    if (this.phoneNode) return this.phoneNode;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const g = ctx.createGain(); g.gain.value = 1.2;
    hp.connect(lp); lp.connect(g); g.connect(this.buses.ambience!);
    this.phoneNode = hp;
    return hp;
  }
  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; bus?: Bus; slide?: number; attack?: number; phone?: boolean } = {}) {
    const ctx = this.ensure(); if (!ctx) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.slide) o.frequency.linearRampToValueAtTime(opts.slide, t0 + dur);
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + (opts.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect((opts.phone ? this.phoneIn() : null) ?? this.buses[opts.bus ?? 'effects']!);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  /** a noise layer that swells in and out (crowds, jets, passing traffic) */
  private swell(dur: number, opts: { gain?: number; at?: number; bp?: number; lp?: number; hp?: number; sweep?: number; phone?: boolean; bus?: Bus } = {}) {
    const ctx = this.ensure(); if (!ctx || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const g = ctx.createGain(); const peak = opts.gain ?? 0.15;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + dur * 0.4); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = src;
    if (opts.bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(opts.bp, t0); if (opts.sweep) f.frequency.linearRampToValueAtTime(opts.sweep, t0 + dur); f.Q.value = 0.9; node.connect(f); node = f; }
    if (opts.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; node.connect(f); node = f; }
    if (opts.hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = opts.hp; node.connect(f); node = f; }
    node.connect(g); g.connect((opts.phone ? this.phoneIn() : null) ?? this.buses[opts.bus ?? 'ambience']!);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
  }
  private noise(dur: number, opts: { gain?: number; at?: number; bus?: Bus; lp?: number; hp?: number; bp?: number; phone?: boolean } = {}) {
    const ctx = this.ensure(); if (!ctx || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = src;
    if (opts.bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = opts.bp; f.Q.value = 0.8; node.connect(f); node = f; }
    if (opts.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; node.connect(f); node = f; }
    if (opts.hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = opts.hp; node.connect(f); node = f; }
    node.connect(g); g.connect((opts.phone ? this.phoneIn() : null) ?? this.buses[opts.bus ?? 'effects']!);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
  }

  // ── What can be heard behind a caller (through the phone line) ───────────
  playClue(kind: string, level = 1) {
    const L = Math.max(0.05, Math.min(1.4, level)), P = { phone: true };
    const r = Math.random;
    switch (kind) {
      case 'train':
        for (let i = 0; i < 8; i++) this.tone(i % 2 ? 690 : 830, 0.2, { type: 'square', gain: 0.045 * L, at: i * 0.3, ...P });
        this.swell(2.8, { gain: 0.35 * L, lp: 160, ...P }); break;
      case 'highway': [0, 0.8, 1.7].forEach((at) => this.swell(1.1, { gain: 0.22 * L, bp: 900, sweep: 500, at, ...P })); break;
      case 'water': this.swell(2.6, { gain: 0.18 * L, lp: 600, ...P }); [0.3, 0.75, 1.7].forEach((at) => this.tone(1950, 0.28, { type: 'sine', gain: 0.05 * L, slide: 1300, at, ...P })); break;
      case 'harbor':
        this.tone(110, 1.7, { type: 'sawtooth', gain: 0.07 * L, attack: 0.18, ...P }); this.tone(165, 1.7, { type: 'sawtooth', gain: 0.05 * L, attack: 0.18, ...P });
        [1.9, 2.3].forEach((at) => this.tone(1900, 0.28, { type: 'sine', gain: 0.05 * L, slide: 1250, at, ...P }));
        [2.7, 3.0].forEach((at) => this.noise(0.09, { gain: 0.12 * L, bp: 2600, at, ...P })); break;
      case 'jets': this.swell(3.2, { gain: 0.32 * L, bp: 2400, sweep: 500, ...P }); break;
      case 'school':
        for (let k = 0; k < 34; k++) this.tone(1650, 0.03, { type: 'square', gain: 0.028 * L, at: k * 0.042, ...P });
        for (let k = 0; k < 6; k++) this.noise(0.18, { gain: 0.05 * L, bp: 1700 + r() * 600, at: 1.5 + k * 0.2, ...P }); break;
      case 'bells':
        for (let sIdx = 0; sIdx < 3; sIdx++) [1, 2, 2.4, 3, 4.2].forEach((m, i) => this.tone(392 * m, 2.4, { type: 'sine', gain: (0.05 / (i + 1)) * L, at: sIdx * 0.95, ...P })); break;
      case 'crowd': this.swell(2.6, { gain: 0.22 * L, bp: 800, ...P }); this.swell(1.1, { gain: 0.14 * L, bp: 1600, at: 0.9, ...P }); break;
      case 'industrial': this.tone(58, 2.2, { type: 'sawtooth', gain: 0.05 * L, attack: 0.2, ...P }); [0, 0.5, 1, 1.5].forEach((at) => this.tone(1050, 0.25, { type: 'square', gain: 0.03 * L, at, ...P })); break;
      case 'birds': for (let k = 0; k < 9; k++) { const f = 2800 + r() * 1600; this.tone(f, 0.07, { type: 'sine', gain: 0.03 * L, slide: f * (0.8 + r() * 0.4), at: r() * 2.2, ...P }); } this.swell(2.4, { gain: 0.08 * L, bp: 500, ...P }); break;
      case 'traffic': this.swell(2.2, { gain: 0.24 * L, lp: 450, ...P }); this.tone(392, 0.26, { type: 'sawtooth', gain: 0.035 * L, at: 0.7, ...P }); this.tone(494, 0.26, { type: 'sawtooth', gain: 0.035 * L, at: 0.7, ...P }); break;
      case 'suburb':
        for (const b of [0, 0.32, 1.25]) { this.noise(0.12, { gain: 0.22 * L, bp: 700, at: b, ...P }); this.tone(330, 0.12, { type: 'sawtooth', gain: 0.05 * L, slide: 180, at: b, ...P }); }
        this.tone(88, 2.2, { type: 'sawtooth', gain: 0.02 * L, attack: 0.3, at: 0.4, ...P }); break;
      case 'hospital': [0, 0.65, 1.3].forEach((at) => this.tone(680, 0.6, { type: 'sine', gain: 0.045 * L, slide: 980, at, ...P })); break;
      case 'rain': this.swell(2.6, { gain: 0.22 * L, hp: 2200, ...P }); break;
      case 'alarm': for (let k = 0; k < 6; k++) this.tone(3000, 0.18, { type: 'square', gain: 0.025 * L, at: k * 0.36, ...P }); break;
      default: break;
    }
  }
  /** gibberish "speech" in the caller's own pitch, so every line sounds like someone talking */
  voice(text: string, pitch: number, agitated = false) {
    const n = Math.max(3, Math.min(20, Math.round(text.length / 5)));
    let t = 0.02;
    this.noise(0.05, { gain: 0.03, bp: 1400, phone: true });
    for (let i = 0; i < n; i++) {
      const f = pitch * (0.85 + Math.random() * 0.35) * (agitated ? 1.12 : 1);
      const d = 0.06 + Math.random() * 0.06;
      this.tone(f, d, { type: 'triangle', gain: agitated ? 0.06 : 0.045, slide: f * (0.9 + Math.random() * 0.15), at: t, phone: true, attack: 0.01 });
      t += d + 0.015 + Math.random() * (agitated ? 0.02 : 0.05);
    }
  }
  /** the faint click of a phone line opening before the caller speaks */
  lineClick() { this.noise(0.05, { gain: 0.03, bp: 1400, phone: true }); }
  mayday() { for (let k = 0; k < 6; k++) this.tone(k % 2 ? 1060 : 760, 0.22, { type: 'square', gain: 0.07, at: k * 0.24 }); }
  attention() { this.tone(1000, 0.9, { type: 'sine', gain: 0.07 }); this.tone(1000, 0.12, { type: 'sine', gain: 0.07, at: 1.05 }); this.tone(1000, 0.12, { type: 'sine', gain: 0.07, at: 1.25 }); }
  stinger() { this.tone(110, 1.4, { type: 'sawtooth', gain: 0.06, attack: 0.05 }); this.tone(116.5, 1.4, { type: 'sawtooth', gain: 0.05, attack: 0.05 }); this.swell(1.6, { gain: 0.12, lp: 300, bus: 'effects' }); }
  /** a dispatch room never goes quiet: keyboards, colleagues on other calls, distant phones */
  private lifeTimer: number | null = null;
  startOfficeLife() {
    if (this.lifeTimer !== null) return;
    const tick = () => {
      const r = Math.random();
      if (r < 0.4) { const n = 4 + Math.floor(Math.random() * 9); for (let k = 0; k < n; k++) this.noise(0.02, { gain: 0.018, hp: 2800, bus: 'ambience', at: k * (0.08 + Math.random() * 0.07) }); }
      else if (r < 0.75) { let t = 0; for (let k = 0; k < 8; k++) { const f = 140 + Math.random() * 90; this.tone(f, 0.09, { type: 'triangle', gain: 0.012, at: t, bus: 'ambience' }); t += 0.12 + Math.random() * 0.06; } }
      else if (r < 0.9) { this.noise(0.07, { gain: 0.025, bp: 2400, bus: 'ambience' }); this.tone(1700, 0.04, { type: 'sine', gain: 0.012, at: 0.08, bus: 'ambience' }); }
      else { [0, 0.42].forEach((at) => { this.tone(440, 0.3, { type: 'sine', gain: 0.008, at, bus: 'ambience' }); this.tone(480, 0.3, { type: 'sine', gain: 0.008, at, bus: 'ambience' }); }); }
      this.lifeTimer = window.setTimeout(tick, 3500 + Math.random() * 6000);
    };
    this.lifeTimer = window.setTimeout(tick, 2500);
  }
  stopOfficeLife() { if (this.lifeTimer !== null) { clearTimeout(this.lifeTimer); this.lifeTimer = null; } }

  // ── UI & events ───────────────────────────────────────────────────────────
  click() { this.tone(1400, 0.035, { type: 'square', gain: 0.04 }); }
  hover() { this.tone(900, 0.02, { type: 'sine', gain: 0.015 }); }
  pickup() { this.tone(520, 0.05, { type: 'square', gain: 0.07 }); this.noise(0.06, { gain: 0.06, hp: 2000 }); this.tone(780, 0.07, { type: 'sine', gain: 0.08, at: 0.06 }); }
  hangup() { this.tone(420, 0.12, { type: 'sine', gain: 0.1 }); this.tone(310, 0.18, { type: 'sine', gain: 0.1, at: 0.12 }); this.noise(0.05, { gain: 0.05, hp: 1500, at: 0.28 }); }
  dispatchConfirm() { this.tone(660, 0.09, { type: 'triangle', gain: 0.12 }); this.tone(990, 0.14, { type: 'triangle', gain: 0.12, at: 0.09 }); }
  notify() { this.tone(880, 0.08, { type: 'sine', gain: 0.07 }); }
  good() { this.tone(523, 0.1, { type: 'triangle', gain: 0.1 }); this.tone(659, 0.1, { type: 'triangle', gain: 0.1, at: 0.09 }); this.tone(784, 0.18, { type: 'triangle', gain: 0.1, at: 0.18 }); }
  alert() { this.tone(440, 0.16, { type: 'sawtooth', gain: 0.07 }); this.tone(330, 0.22, { type: 'sawtooth', gain: 0.07, at: 0.17 }); }
  error() { this.tone(220, 0.14, { type: 'square', gain: 0.06 }); }
  siren() { this.sirenBurst('police', 1.6, 0.9); }
  radioBlip() {
    this.noise(0.09, { gain: 0.12, bus: 'radio', bp: 2400 });
    this.tone(1800, 0.05, { type: 'sine', gain: 0.05, bus: 'radio', at: 0.09 });
    this.noise(0.05, { gain: 0.05, bus: 'radio', bp: 2800, at: 0.14 });
  }
  heartbeat() { this.tone(58, 0.16, { type: 'sine', gain: 0.22, bus: 'effects' }); this.tone(52, 0.2, { type: 'sine', gain: 0.18, bus: 'effects', at: 0.22 }); }
  endBlip() { this.noise(0.06, { gain: 0.08, bus: 'radio', bp: 2600 }); }

  startRing() {
    this.ringing++;
    if (this.ringTimer !== null) return;
    const ring = () => {
      if (this.ringing <= 0) return;
      // classic double ring: 440+480 Hz, two bursts
      [0, 0.45].forEach((at) => { this.tone(440, 0.34, { type: 'sine', gain: 0.1, at }); this.tone(480, 0.34, { type: 'sine', gain: 0.1, at }); });
    };
    ring();
    this.ringTimer = window.setInterval(ring, 2600);
  }
  stopRing() {
    this.ringing = Math.max(0, this.ringing - 1);
    if (this.ringing === 0 && this.ringTimer !== null) { clearInterval(this.ringTimer); this.ringTimer = null; }
  }
  setRinging(on: boolean) { if (on) { if (this.ringTimer === null) this.startRing(); } else this.stopAllRings(); }
  stopAllRings() { this.ringing = 0; if (this.ringTimer !== null) { clearInterval(this.ringTimer); this.ringTimer = null; } }

  // ── Ambience ──────────────────────────────────────────────────────────────
  startOffice() {
    const ctx = this.ensure(); if (!ctx || !this.noiseBuf || this.officeHum) return;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = 0.18;
    src.connect(lp); lp.connect(g); g.connect(this.buses.ambience!);
    src.start();
    this.officeHum = { src, gain: g };
  }
  stopOffice() { try { this.officeHum?.src.stop(); } catch { /* ignore */ } this.officeHum = null; }

  /** call-context ambience (rain, traffic, crowd, wind, indoor) heard while a call is active */
  setCallAmbience(kind: string | null) {
    if ((kind ?? '') === this.ambKind) return;
    this.ambKind = kind ?? '';
    for (const a of this.amb) { try { a.gain.gain.linearRampToValueAtTime(0, (this.ctx?.currentTime ?? 0) + 0.4); a.src.stop((this.ctx?.currentTime ?? 0) + 0.5); } catch { /* ignore */ } }
    this.amb = [];
    const ctx = this.ensure(); if (!ctx || !this.noiseBuf || !kind || kind === 'quiet') return;
    const mk = (type: BiquadFilterType, freq: number, gain: number, q = 0.7) => {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.6);
      src.connect(f); f.connect(g); g.connect(this.buses.ambience!);
      src.start(); this.amb.push({ src, gain: g, kind });
    };
    switch (kind) {
      case 'rain': mk('highpass', 2500, 0.35); break;
      case 'traffic': mk('lowpass', 420, 0.4); mk('bandpass', 900, 0.05); break;
      case 'crowd': mk('bandpass', 700, 0.28, 0.5); break;
      case 'wind': mk('bandpass', 380, 0.3, 0.4); break;
      case 'indoor': mk('lowpass', 160, 0.2); break;
      case 'siren': mk('lowpass', 500, 0.2); break;
      default: break;
    }
  }

  // ── The world under the camera: a layered bed that follows where you look ─
  private world: Record<string, { src: AudioBufferSourceNode; gain: GainNode; filt: BiquadFilterNode }> = {};
  private chirpT = 0; private thunderT = 0;
  /** levels 0..1 for each layer, from what is on screen; call a few times a second */
  setWorldMix(mix: { traffic: number; water: number; wind: number; crowd: number; fire: number; rain: number; birds: number; crickets: number; storm: number }) {
    const ctx = this.ensure(); if (!ctx || !this.noiseBuf) return;
    const layer = (k: string, type: BiquadFilterType, freq: number, q: number) => {
      let l = this.world[k];
      if (!l) {
        const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = 0.8 + Math.random() * 0.4;
        const filt = ctx.createBiquadFilter(); filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
        const gain = ctx.createGain(); gain.gain.value = 0;
        src.connect(filt); filt.connect(gain); gain.connect(this.buses.ambience!); src.start();
        l = this.world[k] = { src, gain, filt };
      }
      return l;
    };
    const set = (k: string, type: BiquadFilterType, freq: number, q: number, v: number) => { const l = layer(k, type, freq, q); l.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.6); };
    set('traffic', 'lowpass', 380, 0.7, mix.traffic * 0.22);
    set('water', 'bandpass', 520, 0.5, mix.water * 0.16 * (0.7 + 0.3 * Math.sin(ctx.currentTime * 0.6)));
    set('wind', 'bandpass', 300, 0.35, mix.wind * 0.14);
    set('crowd', 'bandpass', 780, 0.6, mix.crowd * 0.2);
    set('fire', 'highpass', 1800, 0.4, mix.fire * 0.16 * (0.6 + 0.4 * Math.random()));
    set('rain', 'highpass', 2600, 0.5, mix.rain * 0.18);
    // birdsong by day, crickets after dark: little synthesized chirps
    const now = ctx.currentTime;
    if (mix.birds > 0.05 && now > this.chirpT) {
      this.chirpT = now + 0.6 + Math.random() * 2.4 / mix.birds;
      const f = 2600 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) this.tone(f * (0.9 + Math.random() * 0.25), 0.05 + Math.random() * 0.05, { type: 'sine', gain: 0.012 * mix.birds, slide: f * (1.1 + Math.random() * 0.3), at: i * 0.09, bus: 'ambience' });
    } else if (mix.crickets > 0.05 && now > this.chirpT) {
      this.chirpT = now + 0.25 + Math.random() * 0.6;
      for (let i = 0; i < 3; i++) this.tone(4300 + Math.random() * 200, 0.03, { type: 'square', gain: 0.004 * mix.crickets, at: i * 0.06, bus: 'ambience' });
    }
    if (mix.storm > 0.1 && now > this.thunderT) { this.thunderT = now + 9 + Math.random() * 18; this.thunder(mix.storm); }
  }
  stopWorld() { for (const l of Object.values(this.world)) l.gain.gain.value = 0; }
  thunder(level = 1) { this.noise(2.6, { gain: 0.22 * level, lp: 180, bus: 'ambience' }); this.noise(0.25, { gain: 0.12 * level, lp: 900, bus: 'ambience', at: 0.05 }); }
  /** the alerting tones a station hears when you send its crew out */
  stationTones(service: string) {
    if (service === 'fire') { this.tone(853, 0.5, { type: 'sine', gain: 0.05 }); this.tone(960, 0.5, { type: 'sine', gain: 0.05, at: 0.52 }); for (let k = 0; k < 3; k++) this.tone(1500, 0.04, { type: 'square', gain: 0.03, at: 1.1 + k * 0.12 }); }
    else if (service === 'medical') { this.tone(1046, 0.18, { type: 'triangle', gain: 0.05 }); this.tone(784, 0.18, { type: 'triangle', gain: 0.05, at: 0.2 }); this.tone(1046, 0.25, { type: 'triangle', gain: 0.05, at: 0.4 }); }
    else { this.tone(700, 0.08, { type: 'square', gain: 0.03 }); this.tone(1050, 0.12, { type: 'square', gain: 0.03, at: 0.1 }); }
  }
  /** a hospital pager going off */
  pager() { for (let k = 0; k < 4; k++) this.tone(k % 2 ? 2400 : 2000, 0.07, { type: 'square', gain: 0.03, at: k * 0.09 }); }
  /** a heavy door and a cell lock: someone booked into custody */
  booking() { this.noise(0.18, { gain: 0.1, lp: 400 }); this.tone(180, 0.12, { type: 'square', gain: 0.04, at: 0.18 }); }
  /** an air horn blast from a fire engine forcing through traffic */
  airHorn() { this.tone(233, 0.55, { type: 'sawtooth', gain: 0.045, bus: 'sirens' }); this.tone(277, 0.55, { type: 'sawtooth', gain: 0.035, bus: 'sirens' }); }

  // ── Music (optional): slow generative pad ─────────────────────────────────
  private startMusic() {
    const ctx = this.ensure(); if (!ctx || this.musicTimer) return;
    const chords = [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]];
    let i = 0;
    const play = () => {
      const c = chords[i++ % chords.length];
      c.forEach((f) => this.tone(f, 6.5, { type: 'sine', gain: 0.06, bus: 'music', attack: 2 }));
      this.tone(c[0] / 2, 6.5, { type: 'triangle', gain: 0.05, bus: 'music', attack: 2 });
    };
    play();
    this.musicTimer = window.setInterval(play, 6000);
  }
  private stopMusic() { if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; } }

  // ── positional sirens & rotors ────────────────────────────────────────────
  private sirenCurve: Float32Array | null = null;
  /** soft clipping: gives the synthesised siren the gritty horn character of a real speaker */
  private shaper(): WaveShaperNode {
    const ctx = this.ctx!;
    if (!this.sirenCurve) {
      const n = 1024, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 2.4) / Math.tanh(2.4); }
      this.sirenCurve = c;
    }
    const w = ctx.createWaveShaper(); w.curve = this.sirenCurve; w.oversample = '2x';
    return w;
  }
  /** create one continuous siren (or rotor) voice: two detuned oscillators swept by an LFO, through a horn filter, panned */
  private makeVoice(kind: SirenKind, variant: number): LiveVoice | null {
    const ctx = this.ctx;
    if (!ctx || !this.buses.sirens || !this.noiseBuf) return null;
    const gain = ctx.createGain(); gain.gain.value = 0.0001;
    const pan = ctx.createStereoPanner();
    gain.connect(pan); pan.connect(this.buses.sirens);
    const sources: LiveVoice['sources'] = [];
    if (kind === 'rotor') {
      // blade slap: low-passed noise chopped at the blade-pass rate, plus a low turbine whine
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      const amp = ctx.createGain(); amp.gain.value = 0.35;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11.5;
      const depth = ctx.createGain(); depth.gain.value = 0.35;
      lfo.connect(depth); depth.connect(amp.gain);
      src.connect(lp); lp.connect(amp); amp.connect(gain);
      const whine = ctx.createOscillator(); whine.type = 'sawtooth'; whine.frequency.value = 182;
      const wg = ctx.createGain(); wg.gain.value = 0.05; const wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 600;
      whine.connect(wl); wl.connect(wg); wg.connect(gain);
      src.start(); lfo.start(); whine.start(); sources.push(src, lfo, whine);
      return { kind, gain, pan, sources };
    }
    const base = kind === 'police' ? 1000 : kind === 'fire' ? 720 : 860;
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    if (kind === 'police') { const yelp = variant % 2 === 1; lfo.type = yelp ? 'sawtooth' : 'triangle'; lfo.frequency.value = yelp ? 3.2 : 0.22; depth.gain.value = yelp ? 340 : 420; }
    else if (kind === 'fire') { lfo.type = 'triangle'; lfo.frequency.value = 0.12; depth.gain.value = 380; }
    else { lfo.type = 'square'; lfo.frequency.value = 0.75; depth.gain.value = 95; }
    const shaper = this.shaper();
    const horn = ctx.createBiquadFilter(); horn.type = 'bandpass'; horn.frequency.value = kind === 'fire' ? 1100 : 1500; horn.Q.value = 0.55;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
    for (const det of [0, 9]) {
      const osc = ctx.createOscillator();
      osc.type = kind === 'fire' ? 'sawtooth' : 'square';
      osc.frequency.value = base; osc.detune.value = det;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      const og = ctx.createGain(); og.gain.value = 0.5;
      osc.connect(og); og.connect(shaper);
      osc.start(); sources.push(osc);
    }
    shaper.connect(horn); horn.connect(lp); lp.connect(gain);
    lfo.start(); sources.push(lfo);
    return { kind, gain, pan, sources };
  }
  /** called by the map every few frames with the emergency vehicles that should be audible right now */
  updateSirens(list: SirenVoice[]) {
    if (!this.ctx) { if (!list.length) return; if (!this.ensure()) return; }
    const ctx = this.ctx!;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const want = new Set(list.map((v) => v.id));
    for (const [id, v] of this.voices) {
      if (want.has(id)) continue;
      v.gain.gain.setTargetAtTime(0.0001, now, 0.35);
      for (const src of v.sources) { try { src.stop(now + 1.6); } catch { /* ignore */ } }
      this.voices.delete(id);
    }
    for (const v of list) {
      let live = this.voices.get(v.id);
      if (!live) { const made = this.makeVoice(v.kind, v.variant ?? 0); if (!made) continue; live = made; this.voices.set(v.id, live); }
      live.gain.gain.setTargetAtTime(Math.max(0.0001, v.vol * SIREN_PEAK[v.kind]), now, 0.25);
      live.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, v.pan)), now, 0.12);
    }
  }
  private analyser: AnalyserNode | null = null;
  /** RMS level of everything the game is playing right now (0..1) — used by QA to prove sirens are audible */
  outputLevel(): number {
    const ctx = this.ctx;
    if (!ctx || !this.master) return 0;
    if (!this.analyser) { this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048; this.master.connect(this.analyser); }
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0; for (const x of buf) sum += x * x;
    return Math.sqrt(sum / buf.length);
  }
  /** what the sirens are doing right now (for the settings readout and tests) */
  sirenLevels(): Array<{ kind: SirenKind; gain: number }> { return [...this.voices.values()].map((v) => ({ kind: v.kind, gain: v.gain.gain.value })); }
  /** a short demonstration burst: the settings test button and the moment a unit goes Code 3 */
  sirenBurst(kind: Exclude<SirenKind, 'rotor'> = 'police', seconds = 1.8, level = 0.8) {
    const ctx = this.ensure();
    if (!ctx) return;
    const v = this.makeVoice(kind, 1);
    if (!v) return;
    const t = ctx.currentTime;
    v.gain.gain.setValueAtTime(0.0001, t);
    v.gain.gain.linearRampToValueAtTime(level * SIREN_PEAK[kind], t + 0.08);
    v.gain.gain.setValueAtTime(level * SIREN_PEAK[kind], t + seconds - 0.3);
    v.gain.gain.linearRampToValueAtTime(0.0001, t + seconds);
    for (const src of v.sources) { try { src.stop(t + seconds + 0.05); } catch { /* ignore */ } }
  }

  shutdown() { this.updateSirens([]); this.stopAllRings(); this.stopOffice(); this.stopMusic(); this.setCallAmbience(null); }
}

export const audio = new AudioManager();
