"""Seeded value noise, shared with the other editions so a seed means the same world everywhere."""

import math


def mulberry32(seed):
    """The same 32-bit PRNG the JavaScript edition uses, so noise tables match exactly."""
    MASK = 0xFFFFFFFF
    state = seed & MASK

    def random():
        nonlocal state
        state = (state + 0x6D2B79F5) & MASK
        t = ((state ^ (state >> 15)) * (1 | state)) & MASK
        advanced = (t + (((t ^ (t >> 7)) * (61 | t)) & MASK)) & MASK
        t = advanced ^ t
        return ((t ^ (t >> 14)) & MASK) / 4294967296

    return random


def _smooth(t):
    return t * t * (3 - 2 * t)


class Noise:
    """Value noise with a permuted hash table, matching the JavaScript implementation."""

    def __init__(self, seed):
        self.seed = seed & 0xFFFFFFFF
        random = mulberry32(self.seed)
        perm = list(range(256))
        for i in range(255, 0, -1):
            j = int(random() * (i + 1))
            perm[i], perm[j] = perm[j], perm[i]
        self.perm = [perm[i & 255] for i in range(512)]

    def hash2(self, x, y):
        return self.perm[(self.perm[x & 255] + (y & 255)) & 255] / 255

    def hash3(self, x, y, z):
        return self.perm[(self.perm[(self.perm[x & 255] + (y & 255)) & 255] + (z & 255)) & 255] / 255

    def value2(self, x, y):
        xi, yi = math.floor(x), math.floor(y)
        tx, ty = _smooth(x - xi), _smooth(y - yi)
        a, b = self.hash2(xi, yi), self.hash2(xi + 1, yi)
        c, d = self.hash2(xi, yi + 1), self.hash2(xi + 1, yi + 1)
        top, bottom = a + (b - a) * tx, c + (d - c) * tx
        return top + (bottom - top) * ty

    def value3(self, x, y, z):
        xi, yi, zi = math.floor(x), math.floor(y), math.floor(z)
        tx, ty, tz = _smooth(x - xi), _smooth(y - yi), _smooth(z - zi)
        c000, c100 = self.hash3(xi, yi, zi), self.hash3(xi + 1, yi, zi)
        c010, c110 = self.hash3(xi, yi + 1, zi), self.hash3(xi + 1, yi + 1, zi)
        c001, c101 = self.hash3(xi, yi, zi + 1), self.hash3(xi + 1, yi, zi + 1)
        c011, c111 = self.hash3(xi, yi + 1, zi + 1), self.hash3(xi + 1, yi + 1, zi + 1)
        x00, x10 = c000 + (c100 - c000) * tx, c010 + (c110 - c010) * tx
        x01, x11 = c001 + (c101 - c001) * tx, c011 + (c111 - c011) * tx
        y0, y1 = x00 + (x10 - x00) * ty, x01 + (x11 - x01) * ty
        return y0 + (y1 - y0) * tz

    def fbm2(self, x, y, octaves=4, lacunarity=2.0, gain=0.5):
        amplitude, frequency, total, weight = 1.0, 1.0, 0.0, 0.0
        for _ in range(octaves):
            total += self.value2(x * frequency, y * frequency) * amplitude
            weight += amplitude
            amplitude *= gain
            frequency *= lacunarity
        return total / weight

    def fbm3(self, x, y, z, octaves=3, lacunarity=2.0, gain=0.5):
        amplitude, frequency, total, weight = 1.0, 1.0, 0.0, 0.0
        for _ in range(octaves):
            total += self.value3(x * frequency, y * frequency, z * frequency) * amplitude
            weight += amplitude
            amplitude *= gain
            frequency *= lacunarity
        return total / weight


def hash_coords(x, y, z, seed=0):
    """Cheap deterministic hash, used for per-block colour jitter and tree placement."""
    h = (x * 0x27D4EB2D ^ y * 0x165667B1 ^ z * 0x9E3779B1 ^ seed) & 0xFFFFFFFF
    h ^= h >> 15
    h = (h * 0x85EBCA6B) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & 0xFFFFFFFF
    h ^= h >> 16
    return h / 4294967296
