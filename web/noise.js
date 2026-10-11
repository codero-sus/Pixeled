/**
 * Deterministic, seedable noise. Everything the world generator needs and nothing else:
 * a small integer hash, smooth value noise in 2D and 3D, and fractal brownian motion on top.
 *
 * Value noise (rather than gradient/simplex) keeps the code short, runs fast in plain JavaScript
 * and produces the soft, rolling terrain the game uses.
 */

/** mulberry32: tiny, fast, well-distributed 32-bit PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit integer hash of three coordinates (and a seed). */
export function hash3(x, y, z, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Hash of two coordinates, handy for per-column decisions (trees, flowers, biome jitter). */
export function hash2(x, z, seed) {
  return hash3(x, 0, z, seed);
}

/** Float in [0, 1) from a hash. */
export function hashFloat(x, y, z, seed) {
  return hash3(x, y, z, seed) / 4294967296;
}

/** Quintic smoothstep – the usual 6t^5-15t^4+10t^3 easing that removes visible grid artefacts. */
function smooth(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Smooth value noise in 2D, returning [0, 1). */
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const n00 = hashFloat(xi, 0, yi, seed);
  const n10 = hashFloat(xi + 1, 0, yi, seed);
  const n01 = hashFloat(xi, 0, yi + 1, seed);
  const n11 = hashFloat(xi + 1, 0, yi + 1, seed);
  return lerp(lerp(n00, n10, xf), lerp(n01, n11, xf), yf);
}

/** Smooth value noise in 3D, returning [0, 1). */
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const n000 = hashFloat(xi, yi, zi, seed);
  const n100 = hashFloat(xi + 1, yi, zi, seed);
  const n010 = hashFloat(xi, yi + 1, zi, seed);
  const n110 = hashFloat(xi + 1, yi + 1, zi, seed);
  const n001 = hashFloat(xi, yi, zi + 1, seed);
  const n101 = hashFloat(xi + 1, yi, zi + 1, seed);
  const n011 = hashFloat(xi, yi + 1, zi + 1, seed);
  const n111 = hashFloat(xi + 1, yi + 1, zi + 1, seed);
  const bottom = lerp(lerp(n000, n100, xf), lerp(n010, n110, xf), yf);
  const top = lerp(lerp(n001, n101, xf), lerp(n011, n111, xf), yf);
  return lerp(bottom, top, zf);
}

/** Fractal brownian motion over 2D value noise. Result stays in [0, 1). */
export function fbm2(x, y, seed = 0, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amplitude = 1, frequency = 1, sum = 0, total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += noise2(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / total;
}

/** Fractal brownian motion over 3D value noise. Result stays in [0, 1). */
export function fbm3(x, y, z, seed = 0, octaves = 3, lacunarity = 2, gain = 0.5) {
  let amplitude = 1, frequency = 1, sum = 0, total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += noise3(x * frequency, y * frequency, z * frequency, seed + octave * 7919) * amplitude;
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / total;
}

/** A random 32-bit seed, suitable for a brand-new world. */
export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Tidy seed text for the UI, e.g. "MEADOW-4821" style sharing codes. */
export function seedLabel(seed) {
  return String(seed).padStart(10, '0');
}

/** Turn whatever the player typed into the seed box into a number. */
export function parseSeed(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
