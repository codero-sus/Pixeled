/**
 * Player settings: everything adjustable at runtime, with defaults that suit a laptop and a phone.
 *
 * Stored in local storage under its own key so a new world never resets how you like to play, and
 * clamped on load so a hand-edited save cannot put the game in a silly state.
 */

const KEY = 'pixeled-settings-v1';

export const DEFAULTS = {
  fov: 72,                 // degrees
  sensitivity: 2.2,        // mouse look, scaled by 0.001
  renderDistance: 104,     // fog far plane
  volume: 70,              // percent
  dayLength: 600,          // seconds for a full day
  bob: true,               // view bobbing while walking
  viewmodel: true,         // the block in your hand
  particles: true,
  weather: true,
  minimap: true,
  adaptiveDistance: false, // shrink the fog distance when the frame rate drops
  reducedMotion: false,    // no bob, no flash, no panorama
  uiScale: 100,            // percent
};

const RANGES = {
  fov: [50, 110],
  sensitivity: [0.5, 8],
  renderDistance: [48, 160],
  volume: [0, 100],
  dayLength: [120, 2400],
  uiScale: [80, 150],
};

function clampNumber(value, [min, max], fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export class Settings {
  constructor(store = null) {
    this.store = store;
    this.values = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      const raw = this.store ? this.store.getItem(KEY) : globalThis.localStorage?.getItem(KEY);
      if (!raw) return this;
      const saved = JSON.parse(raw);
      for (const [key, fallback] of Object.entries(DEFAULTS)) {
        if (!(key in saved)) continue;
        this.values[key] = typeof fallback === 'number'
          ? clampNumber(saved[key], RANGES[key] ?? [-Infinity, Infinity], fallback)
          : Boolean(saved[key]);
      }
    } catch (_) { /* a corrupt settings blob just means defaults */ }
    return this;
  }

  save() {
    try {
      const payload = JSON.stringify(this.values);
      if (this.store) this.store.setItem(KEY, payload);
      else globalThis.localStorage?.setItem(KEY, payload);
    } catch (_) { /* private mode: settings simply do not persist */ }
  }

  get(key) { return this.values[key]; }

  /** Set one value, clamped, and persist. Returns the value that was stored. */
  set(key, value) {
    if (!(key in DEFAULTS)) return undefined;
    this.values[key] = typeof DEFAULTS[key] === 'number'
      ? clampNumber(value, RANGES[key] ?? [-Infinity, Infinity], DEFAULTS[key])
      : Boolean(value);
    this.save();
    return this.values[key];
  }

  reset() {
    this.values = { ...DEFAULTS };
    this.save();
    return this.values;
  }

  /** Degrees to radians, with the reduced-motion preference applied. */
  get fovRadians() { return (this.values.fov * Math.PI) / 180; }

  get mouseSensitivity() { return this.values.sensitivity * 0.001; }

  get effectiveDayLength() {
    return this.values.reducedMotion ? this.values.dayLength * 1.5 : this.values.dayLength;
  }
}

export { clampNumber };
