// Procedural audio: every sound is synthesised with Web Audio, so there are no assets to load.
// Buses: master → (effects | radio | music | ambience). All volumes are user-configurable.
import type { Settings } from '../sim/profile';

type Bus = 'effects' | 'radio' | 'music' | 'ambience';

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

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        (['effects', 'radio', 'music', 'ambience'] as Bus[]).forEach((b) => { const g = this.ctx!.createGain(); g.connect(this.master!); this.buses[b] = g; });
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
    if (s.music > 0.01 && !this.musicTimer) this.startMusic(); else if (s.music <= 0.01) this.stopMusic();
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; bus?: Bus; slide?: number; attack?: number } = {}) {
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
    o.connect(g); g.connect(this.buses[opts.bus ?? 'effects']!);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  private noise(dur: number, opts: { gain?: number; at?: number; bus?: Bus; lp?: number; hp?: number; bp?: number } = {}) {
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
    node.connect(g); g.connect(this.buses[opts.bus ?? 'effects']!);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
  }

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
  siren() { this.tone(700, 0.5, { type: 'sine', gain: 0.03, slide: 950 }); }
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

  shutdown() { this.stopAllRings(); this.stopOffice(); this.stopMusic(); this.setCallAmbience(null); }
}

export const audio = new AudioManager();
