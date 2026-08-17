// Audio: original synthesized transients tied to logical events, layered
// material impacts, quiet garden ambience, and an adaptive generative music
// pad. Four buses (music / effects / ambience / voice) with independent
// gains; suspends when hidden; no audio-only gameplay information.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buses = {};
    this.settings = { music: 0.7, effects: 0.9, ambience: 0.6, voice: 0.8, muted: false, voiceCues: false };
    this.theme = null;
    this._musicNodes = [];
    this._ambNodes = [];
    this._musicTimer = null;
    this._started = false;
    this._intensity = 0; // 0 calm, 1 endgame — adaptive layer
  }

  /** Must be called from a user gesture. Idempotent. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      const mk = (name, gain) => {
        const g = this.ctx.createGain();
        g.gain.value = gain;
        g.connect(this.master);
        this.buses[name] = g;
        return g;
      };
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      mk('music', this.settings.music);
      mk('effects', this.settings.effects);
      mk('ambience', this.settings.ambience);
      mk('voice', this.settings.voice);
      return true;
    } catch {
      return false;
    }
  }

  applySettings(s) {
    this.settings = { ...this.settings, ...s };
    if (!this.ctx) return;
    this.master.gain.value = this.settings.muted ? 0 : 1;
    for (const [k, g] of Object.entries(this.buses)) {
      if (this.settings[k] !== undefined) g.gain.value = this.settings[k];
    }
  }

  setSuspended(hidden) {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend();
    else this.ctx.resume();
  }

  // --- SFX: short original transients --------------------------------------

  _env(gainNode, t0, a, peak, d) {
    const g = gainNode.gain;
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  _tone({ freq = 440, freqEnd = null, type = 'sine', dur = 0.12, gain = 0.2, bus = 'effects', attack = 0.004, detune = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    osc.detune.value = detune;
    const g = this.ctx.createGain();
    this._env(g, t0, attack, gain, dur);
    osc.connect(g).connect(this.buses[bus]);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noise({ dur = 0.1, gain = 0.15, bus = 'effects', freq = 1200, q = 0.8, type = 'bandpass', attack = 0.002 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t0, attack, gain, dur);
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t0);
  }

  // Event map — one sound per logical event, layered for material feel.
  select() { this._tone({ freq: 740, type: 'triangle', dur: 0.05, gain: 0.10 }); }
  hover() { this._tone({ freq: 980, type: 'sine', dur: 0.03, gain: 0.04 }); }
  uiClick() { this._tone({ freq: 620, type: 'triangle', dur: 0.05, gain: 0.10 }); }
  uiOpen() { this._tone({ freq: 440, freqEnd: 660, type: 'sine', dur: 0.09, gain: 0.08 }); }
  invalid() {
    this._tone({ freq: 160, freqEnd: 120, type: 'square', dur: 0.1, gain: 0.07 });
    this._noise({ dur: 0.06, gain: 0.05, freq: 300 });
  }
  move() {
    this._noise({ dur: 0.07, gain: 0.16, freq: 900, q: 1.2 });
    this._tone({ freq: 220, freqEnd: 140, type: 'sine', dur: 0.08, gain: 0.12 });
  }
  capture() {
    this._noise({ dur: 0.12, gain: 0.22, freq: 500, q: 0.9 });
    this._tone({ freq: 130, freqEnd: 70, type: 'sine', dur: 0.16, gain: 0.22 });
    this._noise({ dur: 0.05, gain: 0.1, freq: 2600, q: 2 });
  }
  crown() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => setTimeout(() => this._tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.12 }), i * 70));
  }
  turn() { this._tone({ freq: 880, type: 'sine', dur: 0.1, gain: 0.07 }); }
  hint() { this._tone({ freq: 660, freqEnd: 990, type: 'sine', dur: 0.12, gain: 0.08 }); }
  undo() { this._tone({ freq: 500, freqEnd: 350, type: 'sine', dur: 0.1, gain: 0.08 }); }
  win() {
    const seq = [392, 523.25, 659.25, 783.99];
    seq.forEach((f, i) => setTimeout(() => this._tone({ freq: f, type: 'triangle', dur: 0.4, gain: 0.14, bus: 'music' }), i * 120));
  }
  lose() {
    const seq = [330, 277, 220];
    seq.forEach((f, i) => setTimeout(() => this._tone({ freq: f, type: 'sine', dur: 0.5, gain: 0.12, bus: 'music' }), i * 160));
  }
  draw() { this._tone({ freq: 440, type: 'sine', dur: 0.4, gain: 0.1, bus: 'music' }); }
  achievement() {
    [880, 1108.7, 1318.5].forEach((f, i) => setTimeout(() => this._tone({ freq: f, type: 'sine', dur: 0.25, gain: 0.1 }), i * 90));
  }
  clockWarn() { this._tone({ freq: 1050, type: 'square', dur: 0.06, gain: 0.06 }); }

  /** Optional spoken cue (voice bus). Text is short and already localized by UI. */
  speak(text) {
    if (!this.settings.voiceCues) return;
    try {
      const synth = globalThis.speechSynthesis;
      if (!synth) return;
      const u = new SpeechSynthesisUtterance(text);
      u.volume = this.settings.voice;
      u.rate = 1.05;
      synth.cancel();
      synth.speak(u);
    } catch { /* unsupported */ }
  }

  // --- ambience: wind noise + birds + fountain --------------------------------

  startAmbience(theme) {
    if (!this.ensure()) return;
    this.theme = theme;
    this.stopAmbience();
    const amb = theme?.ambience || { wind: 0.5, birds: 0.5, water: 0.3 };
    // wind: looping filtered noise
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) {
      v = v * 0.98 + (Math.random() * 2 - 1) * 0.02; // brown-ish
      d[i] = v * 3;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = this.ctx.createGain();
    g.gain.value = 0.10 * (amb.wind ?? 0.5);
    src.connect(f).connect(g).connect(this.buses.ambience);
    src.start();
    this._ambNodes.push(src, g);
    // birds: gentle chirp scheduler
    if ((amb.birds ?? 0) > 0.05) {
      const chirp = () => {
        if (!this.ctx) return;
        const base = 2200 + Math.random() * 1400;
        this._tone({ freq: base, freqEnd: base * (1.2 + Math.random() * 0.4), type: 'sine', dur: 0.07, gain: 0.028 * amb.birds, bus: 'ambience' });
        if (Math.random() < 0.5) {
          setTimeout(() => this._tone({ freq: base * 1.1, freqEnd: base * 0.9, type: 'sine', dur: 0.06, gain: 0.022 * amb.birds, bus: 'ambience' }), 90);
        }
        this._birdTimer = setTimeout(chirp, 2500 + Math.random() * 7000 / amb.birds);
      };
      this._birdTimer = setTimeout(chirp, 1200);
    }
    // fountain: bright filtered noise
    if ((amb.water ?? 0) > 0.05) {
      const len2 = this.ctx.sampleRate;
      const buf2 = this.ctx.createBuffer(1, len2, this.ctx.sampleRate);
      const d2 = buf2.getChannelData(0);
      for (let i = 0; i < len2; i++) d2[i] = Math.random() * 2 - 1;
      const src2 = this.ctx.createBufferSource();
      src2.buffer = buf2;
      src2.loop = true;
      const f2 = this.ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.value = 3200;
      f2.Q.value = 0.6;
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.02 * amb.water;
      src2.connect(f2).connect(g2).connect(this.buses.ambience);
      src2.start();
      this._ambNodes.push(src2, g2);
    }
  }

  stopAmbience() {
    for (const n of this._ambNodes) {
      try { n.stop?.(); } catch { /* gain nodes */ }
      try { n.disconnect(); } catch { /* already gone */ }
    }
    this._ambNodes = [];
    clearTimeout(this._birdTimer);
  }

  // --- adaptive generative music pad -------------------------------------------

  startMusic(theme) {
    if (!this.ensure()) return;
    this.stopMusic();
    const m = theme?.music || { root: 220, scale: [0, 2, 4, 7, 9], tempo: 0.1 };
    const chords = [
      [0, 4, 7], [5, 9, 12], [7, 11, 14], [2, 5, 9],
    ];
    let step = 0;
    const playChord = () => {
      if (!this.ctx) return;
      const chord = chords[step % chords.length];
      step += 1;
      const t0 = this.ctx.currentTime;
      for (const semi of chord) {
        const freq = m.root * Math.pow(2, semi / 12);
        for (const det of [-4, 3]) {
          const osc = this.ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq * (this._intensity > 0.5 && det > 0 ? 2 : 1);
          osc.detune.value = det;
          const g = this.ctx.createGain();
          const peak = 0.028 + this._intensity * 0.012;
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(peak, t0 + 2.2);
          g.gain.linearRampToValueAtTime(0, t0 + 7.5);
          osc.connect(g).connect(this.buses.music);
          osc.start(t0);
          osc.stop(t0 + 8);
          this._musicNodes.push(osc);
        }
      }
      this._musicTimer = setTimeout(playChord, 6000 / Math.max(0.05, m.tempo * 10));
    };
    playChord();
  }

  /** 0..1 — raises the music intensity layer in endgames. */
  setIntensity(v) { this._intensity = Math.max(0, Math.min(1, v)); }

  stopMusic() {
    clearTimeout(this._musicTimer);
    for (const n of this._musicNodes) {
      try { n.stop(); } catch { /* done */ }
    }
    this._musicNodes = [];
  }

  dispose() {
    this.stopMusic();
    this.stopAmbience();
    this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
