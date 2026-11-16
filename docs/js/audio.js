/* ==========================================================================
   GAMBIT · procedural sound design
   No audio files: every cue is synthesised with the Web Audio API.
   ========================================================================== */

const STORAGE_KEY = 'gambit.sound';

export class ChessAudio {
  constructor() {
    this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.started = false;
    this._onFirstGesture = () => this.unlock();
    window.addEventListener('pointerdown', this._onFirstGesture, { once: true, passive: true });
    window.addEventListener('keydown', this._onFirstGesture, { once: true });
  }

  get available() {
    return typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off');
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.enabled ? 0.62 : 0, now, 0.05);
    }
    if (this.enabled) this.unlock();
  }

  unlock() {
    if (!this.enabled || !this.available) return;
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.62;
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.24;
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
      this.noiseBuffer = this._makeNoise(1.2);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.started = true;
  }

  _makeNoise(seconds) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  _noise(duration, { gain = 0.2, filter = 1800, q = 0.8, type = 'bandpass', delay = 0, pan = 0 } = {}) {
    if (!this.ctx || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const biquad = ctx.createBiquadFilter();
    biquad.type = type;
    biquad.frequency.value = filter;
    biquad.Q.value = q;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(biquad);
    biquad.connect(envelope);
    envelope.connect(panner);
    panner.connect(this.master);
    src.start(now, Math.random() * 0.6);
    src.stop(now + duration + 0.03);
  }

  _tone(freq, duration, { type = 'sine', gain = 0.12, delay = 0, slide = null, pan = 0, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), now);
    if (slide) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), now + duration);
    }
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(envelope);
    envelope.connect(panner);
    panner.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  _safe(fn) {
    if (!this.enabled || !this.available) return;
    this.unlock();
    if (!this.ctx) return;
    try {
      fn();
    } catch {
      // Audio must never break the game loop.
    }
  }

  select() {
    this._safe(() => {
      this._tone(980, 0.045, { type: 'triangle', gain: 0.045 });
      this._tone(1480, 0.035, { type: 'sine', gain: 0.018, delay: 0.012 });
    });
  }

  move() {
    this._safe(() => {
      this._noise(0.09, { gain: 0.1, filter: 920, q: 0.7, type: 'lowpass' });
      this._tone(132, 0.16, { type: 'sine', gain: 0.14, slide: 72 });
      this._tone(520, 0.055, { type: 'triangle', gain: 0.035, delay: 0.01, slide: 370 });
    });
  }

  place() {
    this._safe(() => {
      this._noise(0.13, { gain: 0.08, filter: 2600, q: 1.2, type: 'bandpass' });
      this._tone(190, 0.2, { type: 'sine', gain: 0.16, slide: 84 });
      this._tone(660, 0.08, { type: 'triangle', gain: 0.03, delay: 0.015, slide: 430 });
    });
  }

  capture() {
    this._safe(() => {
      this._noise(0.34, { gain: 0.3, filter: 820, q: 0.45, type: 'lowpass' });
      this._noise(0.18, { gain: 0.14, filter: 3600, q: 0.8, type: 'bandpass', delay: 0.015 });
      this._tone(78, 0.42, { type: 'sine', gain: 0.4, slide: 34 });
      this._tone(310, 0.24, { type: 'sawtooth', gain: 0.035, slide: 120 });
      [1470, 1980, 2630].forEach((freq, i) => {
        this._tone(freq, 0.34 - i * 0.06, {
          type: 'sine',
          gain: 0.022 - i * 0.004,
          delay: 0.025 + i * 0.018,
          pan: i === 0 ? -0.2 : i === 2 ? 0.24 : 0,
        });
      });
    });
  }

  check() {
    this._safe(() => {
      this._tone(740, 0.14, { type: 'triangle', gain: 0.07 });
      this._tone(988, 0.2, { type: 'triangle', gain: 0.06, delay: 0.12 });
      this._tone(1318, 0.3, { type: 'sine', gain: 0.035, delay: 0.24 });
    });
  }

  promote() {
    this._safe(() => {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) => {
        this._tone(freq, 0.55, {
          type: 'sine',
          gain: 0.055 - i * 0.006,
          delay: i * 0.055,
          pan: (i - 2) * 0.08,
        });
      });
      this._noise(0.5, { gain: 0.045, filter: 5200, q: 0.5, type: 'highpass' });
    });
  }

  win() {
    this._safe(() => {
      [392, 523.25, 659.25, 783.99].forEach((freq, i) => {
        this._tone(freq, 1.4, { type: 'sine', gain: 0.06, delay: i * 0.11, attack: 0.02 });
      });
      this._tone(196, 1.6, { type: 'triangle', gain: 0.04, delay: 0.08 });
    });
  }

  lose() {
    this._safe(() => {
      [329.63, 246.94, 196, 146.83].forEach((freq, i) => {
        this._tone(freq, 1.2, { type: 'triangle', gain: 0.045, delay: i * 0.14, attack: 0.02 });
      });
      this._tone(73.42, 1.5, { type: 'sine', gain: 0.05 });
    });
  }

  draw() {
    this._safe(() => {
      this._tone(392, 0.8, { type: 'sine', gain: 0.045 });
      this._tone(440, 0.8, { type: 'sine', gain: 0.035, delay: 0.03 });
      this._tone(523.25, 0.9, { type: 'sine', gain: 0.025, delay: 0.08 });
    });
  }

  error() {
    this._safe(() => {
      this._tone(150, 0.15, { type: 'square', gain: 0.035 });
      this._tone(112, 0.2, { type: 'square', gain: 0.025, delay: 0.08 });
    });
  }

  destroy() {
    window.removeEventListener('pointerdown', this._onFirstGesture);
    window.removeEventListener('keydown', this._onFirstGesture);
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
