/**
 * Weather: a slow, seeded state machine that drifts between clear, rain, snow and storms.
 *
 * It only decides *what* the sky is doing — intensity, whether the drops fall as snow, whether
 * thunder is due — and hands that to the renderer, the audio and the HUD. The clock runs on world
 * time, so a world reloads into the same weather it was saved with.
 */

import { hashCoords } from './noise.js';

const MIN_CLEAR = 150;     // seconds of guaranteed good weather after a storm
const MAX_CLEAR = 420;
const MIN_STORM = 60;
const MAX_STORM = 150;
const FADE = 12;           // seconds to fade in or out

export class Weather {
  constructor(seed = 1, { enabled = true } = {}) {
    this.seed = seed >>> 0;
    this.enabled = enabled;
    this.reset(seed);
  }

  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this.phase = 'clear';        // clear | storm
    this.timer = this.roll(0, MIN_CLEAR, MAX_CLEAR);
    this.intensity = 0;
    this.target = 0;
    this.snowing = false;
    this.thundering = false;
    this.stormy = false;
    this.flash = 0;
    this.strikes = 0;
    this.stormStrikes = 0;
    this.elapsed = 0;
    this.cycles = 0;
  }

  /** Deterministic per-cycle random in [min, max). */
  roll(salt, min, max) {
    const value = hashCoords(Math.floor(this.cycles ?? 0) + salt * 7, salt, Math.floor(this.timer ?? 0) + salt * 13, this.seed ^ 0x5bd1);
    return min + value * (max - min);
  }

  /**
   * Advance the state machine.
   * @param {number} dt seconds
   * @param {object} [context] { biome, snowBiome } — snow falls in cold biomes even in a light storm
   */
  update(dt, context = {}) {
    this.elapsed += dt;
    if (!this.enabled) {
      this.intensity = Math.max(0, this.intensity - dt * 0.5);
      this.target = 0;
      this.flash = Math.max(0, this.flash - dt * 3);
      return;
    }

    this.timer -= dt;
    if (this.timer <= 0) {
      this.cycles++;
      if (this.phase === 'clear') {
        this.phase = 'storm';
        this.timer = MIN_STORM + (this.cycles * 37 % 90);
        this.target = 0.55 + (this.cycles * 53 % 45) / 100;
        // Roughly one storm in three is a thunderstorm.
        this.stormy = this.target > 0.72;
      } else {
        this.phase = 'clear';
        this.timer = MIN_CLEAR + (this.cycles * 71 % (MAX_CLEAR - MIN_CLEAR));
        this.target = 0;
        this.stormy = false;
      }
      this.stormStrikes = 0;      // strikes this front; `strikes` counts the whole session
    }

    // Snow whenever it is cold where the player is, otherwise rain.
    this.snowing = Boolean(context.snowBiome);
    const rate = this.phase === 'storm' ? dt / FADE : -dt / FADE;
    this.intensity = Math.max(0, Math.min(1, this.intensity + rate));

    // Thunder: a flash, then a rumble a moment later (the audio module drives the sound).
    this.thundering = false;
    if (this.stormy && this.intensity > 0.5 && Math.random() < dt * 0.12) {
      this.flash = 1;
      this.strikes++;
      this.stormStrikes++;
      this.thundering = true;
      this.lastStrike = this.elapsed;
    }
    this.flash = Math.max(0, this.flash - dt * 2.4);
  }

  /** What the renderer and audio want to know, in one small object. */
  get state() {
    return {
      intensity: this.intensity,
      snow: this.snowing,
      storm: this.stormy,
      flash: this.flash,
      raining: this.intensity > 0.02 && !this.snowing,
      label: this.intensity < 0.05 ? 'clear'
        : this.snowing ? (this.intensity > 0.6 ? 'snowstorm' : 'snow')
          : this.stormy ? 'thunderstorm' : 'rain',
    };
  }

  /** For saves and tests. */
  serialize() {
    return { phase: this.phase, timer: this.timer, intensity: this.intensity, cycles: this.cycles, seed: this.seed };
  }

  load(saved) {
    if (!saved) return this;
    this.phase = saved.phase === 'storm' ? 'storm' : 'clear';
    this.timer = Number.isFinite(saved.timer) ? saved.timer : this.timer;
    this.intensity = Number.isFinite(saved.intensity) ? Math.max(0, Math.min(1, saved.intensity)) : 0;
    this.cycles = Number.isFinite(saved.cycles) ? saved.cycles : 0;
    this.target = this.phase === 'storm' ? Math.max(0.4, this.intensity) : 0;
    this.stormy = this.target > 0.8;
    return this;
  }
}
