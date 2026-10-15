/**
 * Tiny synthesised sound effects — no audio files, nothing to download.
 *
 * Every sound is built from oscillators and a shared noise buffer, so the whole game stays a
 * handful of kilobytes. Materials pick their own timbre: stone clacks, grass rustles, sand hisses.
 */

import { AIR, blockById } from './constants.js';

const NOISE_SECONDS = 2;

export class Audio {
  constructor() {
    this.enabled = true;
    this.volume = 0.7;
    this.context = null;
    this.noise = null;
    this.rain = null;          // { source, gain } while rain is falling
    this.lastStep = 0;
    this.master = null;
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this.blip(660, 0.05);
    else this.stopRain();
    return this.enabled;
  }

  setVolume(percent) {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    if (this.master) this.master.gain.value = 0.9 * this.volume;
    if (this.rain) this.rain.gain.gain.value = 0.05 * this.volume;
    return this.volume;
  }

  resume() {
    try {
      this.context ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.context.state === 'suspended') this.context.resume();
      if (!this.master && this.context.createGain) {
        this.master = this.context.createGain();
        this.master.gain.value = 0.9 * this.volume;
        this.master.connect(this.context.destination);
      }
    } catch (_) { /* audio is a bonus, never a blocker */ }
  }

  get destination() { return this.master ?? this.context?.destination; }

  /** Two seconds of white noise, reused by every noise-based sound. */
  noiseBuffer() {
    if (this.noise || !this.context) return this.noise;
    const length = Math.floor(this.context.sampleRate * NOISE_SECONDS);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      // Brown-ish noise: smoother and less hissy than pure white noise.
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return (this.noise = buffer);
  }

  /** A filtered noise burst — the base of footsteps, digging and splashes. */
  burst({ duration = 0.12, volume = 0.05, frequency = 900, q = 0.8, type = 'bandpass' } = {}) {
    if (!this.enabled || this.volume <= 0) return;
    try {
      this.resume();
      const context = this.context;
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer();
      source.playbackRate.value = 0.8 + Math.random() * 0.4;
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = context.createGain();
      gain.gain.setValueAtTime(volume * this.volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      source.connect(filter).connect(gain).connect(this.destination);
      source.start();
      source.stop(context.currentTime + duration);
    } catch (_) { /* ignore */ }
  }

  blip(frequency, duration = 0.07, type = 'square', volume = 0.03) {
    if (!this.enabled || this.volume <= 0) return;
    try {
      this.resume();
      const context = this.context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume * this.volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain).connect(this.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch (_) { /* ignore */ }
  }

  /** Sweeping tone, used for thunder rolls and the underwater thud. */
  sweep(from, to, duration = 0.6, volume = 0.06, type = 'sine') {
    if (!this.enabled || this.volume <= 0) return;
    try {
      this.resume();
      const context = this.context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(from, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), context.currentTime + duration);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(volume * this.volume, context.currentTime + duration * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain).connect(this.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch (_) { /* ignore */ }
  }

  /** Per-material digging and walking voice. */
  materialOf(blockId) {
    const block = blockById(blockId);
    if (!block || blockId === AIR) return 'stone';
    return block.sound ?? 'stone';
  }

  step(blockId) {
    const material = this.materialOf(blockId);
    const voices = {
      grass: { frequency: 1500, volume: 0.035, duration: 0.1, q: 0.5 },
      sand: { frequency: 2400, volume: 0.03, duration: 0.12, q: 0.4, type: 'highpass' },
      snow: { frequency: 1900, volume: 0.03, duration: 0.1, q: 0.5 },
      stone: { frequency: 620, volume: 0.035, duration: 0.07, q: 1.4 },
      wood: { frequency: 420, volume: 0.035, duration: 0.09, q: 1.8 },
      leaves: { frequency: 2600, volume: 0.028, duration: 0.12, q: 0.6 },
      gravel: { frequency: 1100, volume: 0.035, duration: 0.1, q: 0.9 },
      glass: { frequency: 2800, volume: 0.025, duration: 0.06, q: 2 },
      cloth: { frequency: 800, volume: 0.025, duration: 0.09, q: 0.7 },
    };
    const voice = voices[material] ?? voices.stone;
    this.burst({ ...voice, volume: voice.volume * 0.9 });
  }

  digTick(blockId) {
    const material = this.materialOf(blockId);
    const frequency = { stone: 700, sand: 2100, grass: 1400, wood: 480, leaves: 2400, gravel: 1000, glass: 2600, snow: 1800 }[material] ?? 700;
    this.burst({ duration: 0.05, volume: 0.025, frequency, q: 1.2 });
  }

  dig(blockId) {
    const material = this.materialOf(blockId);
    const frequency = { stone: 520, sand: 1700, grass: 1200, wood: 380, leaves: 2200, gravel: 800, glass: 2300, snow: 1500 }[material] ?? 520;
    this.burst({ duration: 0.16, volume: 0.05, frequency, q: 1.1 });
  }

  place(blockId) { this.blip(300 + (blockId % 5) * 55, 0.08, 'triangle', 0.03); }

  jump() { this.blip(520, 0.05, 'sine', 0.02); }

  land(impact = 1) { this.burst({ duration: 0.1, volume: 0.03 * Math.min(2, impact), frequency: 800, q: 1 }); }

  splash() {
    this.burst({ duration: 0.3, volume: 0.06, frequency: 900, q: 0.4, type: 'highpass' });
    this.sweep(420, 160, 0.25, 0.03, 'sine');
  }

  bubble() { this.sweep(220, 520, 0.18, 0.025, 'sine'); }

  thunder() {
    this.burst({ duration: 1.6, volume: 0.09, frequency: 260, q: 0.5, type: 'lowpass' });
    this.sweep(90, 40, 1.4, 0.06, 'sine');
  }

  /** Steady rain loop, started once and faded in and out with the weather. */
  startRain() {
    if (!this.enabled || this.volume <= 0) return;
    try {
      this.resume();
      if (this.rain) return;
      const context = this.context;
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer();
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1200;
      const gain = context.createGain();
      gain.gain.value = 0.05 * this.volume;
      source.connect(filter).connect(gain).connect(this.destination);
      source.start();
      this.rain = { source, gain };
    } catch (_) { /* ignore */ }
  }

  /** Adjusts the loop volume, starts it when it starts raining and stops it when it clears. */
  setRain(intensity) {
    if (intensity <= 0.02 || !this.enabled) { this.stopRain(); return; }
    this.startRain();
    if (this.rain) this.rain.gain.gain.value = 0.05 * this.volume * Math.min(1, intensity * 1.4);
  }

  stopRain() {
    if (!this.rain) return;
    try { this.rain.source.stop(); } catch (_) { /* ignore */ }
    this.rain = null;
  }

  select() { this.blip(720, 0.045, 'sine', 0.02); }

  /** Little melodies for the menu and for a fresh world. */
  chime(notes = [523, 659, 784, 1046]) {
    notes.forEach((frequency, index) => {
      setTimeout(() => this.blip(frequency, 0.16, 'triangle', 0.028), index * 90);
    });
  }

  /** Soft whoosh when a menu panel opens or a day fades. */
  whoosh() { this.burst({ duration: 0.3, volume: 0.03, frequency: 600, q: 0.5 }); }
}
