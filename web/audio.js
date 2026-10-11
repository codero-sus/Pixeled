/**
 * Tiny synthesised sound effects: no audio files, just short shaped oscillators.
 *
 * Digging, placing, footsteps and the UI all get their own voice, and everything respects the
 * sound toggle in the settings.
 */

export class GameAudio {
  constructor(settings = {}) {
    this.settings = settings;
    this.context = null;
    this.master = null;
    this.enabled = settings.sound !== false;
  }

  /** Browsers only allow audio after a gesture, so this is called on the first click or key. */
  unlock() {
    if (this.context || typeof window === 'undefined') return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.3;
    this.master.connect(this.context.destination);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.settings.sound = enabled;
  }

  /** A short pitched blip; `type` picks the waveform character. */
  blip({ frequency = 440, duration = 0.08, type = 'square', volume = 0.18, slide = 0 } = {}) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + slide), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  /** Noise burst shaped like a thud, for block breaking and footsteps. */
  noise({ duration = 0.12, volume = 0.16, filter = 900 } = {}) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.context) return;
    const now = this.context.currentTime;
    const frames = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, frames, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const lowpass = this.context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = filter;
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(this.master);
    source.start(now);
  }

  dig(material = 'dirt') {
    const base = { stone: 160, wood: 220, sand: 300, plant: 420, snow: 380, glass: 700, dirt: 240 }[material] ?? 240;
    this.noise({ duration: 0.09, volume: 0.13, filter: base + 500 });
    this.blip({ frequency: base, duration: 0.06, type: 'triangle', volume: 0.05, slide: -60 });
  }

  place(material = 'dirt') {
    this.dig(material);
    this.blip({ frequency: 320, duration: 0.05, type: 'square', volume: 0.06, slide: 120 });
  }

  step(sprinting = false) {
    this.noise({ duration: 0.06, volume: sprinting ? 0.09 : 0.06, filter: 500 });
  }

  jump() { this.blip({ frequency: 520, duration: 0.09, type: 'triangle', volume: 0.08, slide: 260 }); }

  splash() { this.noise({ duration: 0.25, volume: 0.14, filter: 1400 }); }

  click() { this.blip({ frequency: 660, duration: 0.05, type: 'square', volume: 0.07 }); }

  error() { this.blip({ frequency: 180, duration: 0.14, type: 'sawtooth', volume: 0.08, slide: -60 }); }

  pickup() { this.blip({ frequency: 880, duration: 0.07, type: 'square', volume: 0.07, slide: 240 }); }
}
