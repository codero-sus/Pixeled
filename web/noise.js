/**
 * Seeded value noise. The same permutation table, hash and interpolation are re-implemented in the
 * Python, Java and Android editions, so a seed produces the same world everywhere.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise {
  constructor(seed) {
    this.seed = seed >>> 0;
    const random = mulberry32(this.seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = perm[i & 255];
  }

  hash2(x, y) { return this.perm[(this.perm[x & 255] + (y & 255)) & 255] / 255; }

  hash3(x, y, z) { return this.perm[(this.perm[(this.perm[x & 255] + (y & 255)) & 255] + (z & 255)) & 255] / 255; }

  static smooth(t) { return t * t * (3 - 2 * t); }

  value2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = Noise.smooth(x - xi), ty = Noise.smooth(y - yi);
    const top = this.hash2(xi, yi) + (this.hash2(xi + 1, yi) - this.hash2(xi, yi)) * tx;
    const bottom = this.hash2(xi, yi + 1) + (this.hash2(xi + 1, yi + 1) - this.hash2(xi, yi + 1)) * tx;
    return top + (bottom - top) * ty;
  }

  value3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const tx = Noise.smooth(x - xi), ty = Noise.smooth(y - yi), tz = Noise.smooth(z - zi);
    const c000 = this.hash3(xi, yi, zi), c100 = this.hash3(xi + 1, yi, zi);
    const c010 = this.hash3(xi, yi + 1, zi), c110 = this.hash3(xi + 1, yi + 1, zi);
    const c001 = this.hash3(xi, yi, zi + 1), c101 = this.hash3(xi + 1, yi, zi + 1);
    const c011 = this.hash3(xi, yi + 1, zi + 1), c111 = this.hash3(xi + 1, yi + 1, zi + 1);
    const x00 = c000 + (c100 - c000) * tx, x10 = c010 + (c110 - c010) * tx;
    const x01 = c001 + (c101 - c001) * tx, x11 = c011 + (c111 - c011) * tx;
    const y0 = x00 + (x10 - x00) * ty, y1 = x01 + (x11 - x01) * ty;
    return y0 + (y1 - y0) * tz;
  }

  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amplitude = 1, frequency = 1, sum = 0, total = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.value2(x * frequency, y * frequency) * amplitude;
      total += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / total;
  }

  fbm3(x, y, z, octaves = 3, lacunarity = 2, gain = 0.5) {
    let amplitude = 1, frequency = 1, sum = 0, total = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.value3(x * frequency, y * frequency, z * frequency) * amplitude;
      total += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / total;
  }
}

/** Small deterministic hash for per-block colour variation and prop placement. */
export function hashCoords(x, y, z, seed = 0) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ (seed | 0)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
