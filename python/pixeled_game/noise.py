"""Deterministic, seedable noise — the Python twin of ``web/noise.js``.

The maths is deliberately identical to the JavaScript edition (same hashing, same octaves, same
order of operations), so a seed typed into either edition produces the very same landscape. All
arithmetic is done on unsigned 32-bit integers to match JavaScript's bit-twiddling exactly.
"""

from __future__ import annotations

U32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    """Low 32 bits of ``a * b``, exactly like JavaScript's ``Math.imul``."""
    return ((a & U32) * (b & U32)) & U32


def mulberry32(seed: int):
    """Tiny, fast, well-distributed PRNG returning floats in [0, 1)."""
    state = seed & U32

    def random() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & U32
        t = state
        t = _imul(t ^ (t >> 15), t | 1)
        t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & U32)) & U32
        return ((t ^ (t >> 14)) & U32) / 4294967296.0

    return random


def hash3(x: int, y: int, z: int, seed: int) -> int:
    """32-bit integer hash of three coordinates (and a seed)."""
    h = _imul(x, 0x27D4EB2D) ^ _imul(y, 0x165667B1) ^ _imul(z, 0x9E3779B1) ^ _imul(seed, 0x85EBCA6B)
    h = _imul(h ^ (h >> 15), 0x2C1B3C6D)
    h = _imul(h ^ (h >> 12), 0x297A2D39)
    return (h ^ (h >> 15)) & U32


def hash2(x: int, z: int, seed: int) -> int:
    """Hash of two coordinates, handy for per-column decisions (trees, flowers, biome jitter)."""
    return hash3(x, 0, z, seed)


def hash_float(x: int, y: int, z: int, seed: int) -> float:
    """Float in [0, 1) from a hash."""
    return hash3(x, y, z, seed) / 4294967296.0


def _smooth(t: float) -> float:
    """Quintic smoothstep — removes the visible grid artefacts of raw value noise."""
    return t * t * t * (t * (t * 6 - 15) + 10)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def noise2(x: float, y: float, seed: int = 0) -> float:
    """Smooth value noise in 2D, returning [0, 1)."""
    import math

    xi, yi = math.floor(x), math.floor(y)
    xf, yf = _smooth(x - xi), _smooth(y - yi)
    n00 = hash_float(xi, 0, yi, seed)
    n10 = hash_float(xi + 1, 0, yi, seed)
    n01 = hash_float(xi, 0, yi + 1, seed)
    n11 = hash_float(xi + 1, 0, yi + 1, seed)
    return _lerp(_lerp(n00, n10, xf), _lerp(n01, n11, xf), yf)


def noise3(x: float, y: float, z: float, seed: int = 0) -> float:
    """Smooth value noise in 3D, returning [0, 1)."""
    import math

    xi, yi, zi = math.floor(x), math.floor(y), math.floor(z)
    xf, yf, zf = _smooth(x - xi), _smooth(y - yi), _smooth(z - zi)
    n000 = hash_float(xi, yi, zi, seed)
    n100 = hash_float(xi + 1, yi, zi, seed)
    n010 = hash_float(xi, yi + 1, zi, seed)
    n110 = hash_float(xi + 1, yi + 1, zi, seed)
    n001 = hash_float(xi, yi, zi + 1, seed)
    n101 = hash_float(xi + 1, yi, zi + 1, seed)
    n011 = hash_float(xi, yi + 1, zi + 1, seed)
    n111 = hash_float(xi + 1, yi + 1, zi + 1, seed)
    bottom = _lerp(_lerp(n000, n100, xf), _lerp(n010, n110, xf), yf)
    top = _lerp(_lerp(n001, n101, xf), _lerp(n011, n111, xf), yf)
    return _lerp(bottom, top, zf)


def fbm2(x: float, y: float, seed: int = 0, octaves: int = 4, lacunarity: float = 2, gain: float = 0.5) -> float:
    """Fractal brownian motion over 2D value noise. Result stays in [0, 1)."""
    amplitude = 1.0
    frequency = 1.0
    total = 0.0
    accumulated = 0.0
    for octave in range(octaves):
        accumulated += noise2(x * frequency, y * frequency, seed + octave * 1013) * amplitude
        total += amplitude
        amplitude *= gain
        frequency *= lacunarity
    return accumulated / total


def fbm3(x: float, y: float, z: float, seed: int = 0, octaves: int = 3, lacunarity: float = 2, gain: float = 0.5) -> float:
    """Fractal brownian motion over 3D value noise. Result stays in [0, 1)."""
    amplitude = 1.0
    frequency = 1.0
    total = 0.0
    accumulated = 0.0
    for octave in range(octaves):
        accumulated += noise3(x * frequency, y * frequency, z * frequency, seed + octave * 7919) * amplitude
        total += amplitude
        amplitude *= gain
        frequency *= lacunarity
    return accumulated / total


def random_seed() -> int:
    """A fresh 32-bit seed for a brand-new world."""
    import random

    return random.getrandbits(32)


def seed_label(seed: int) -> str:
    """Tidy seed text for the interface, e.g. 0004821004."""
    return str(int(seed) & U32).rjust(10, "0")


def parse_seed(text) -> int | None:
    """Turn whatever the player typed into the seed box into a number."""
    trimmed = str(text or "").strip()
    if not trimmed:
        return None
    if trimmed.isdigit():
        return int(trimmed) & U32
    h = 2166136261
    for character in trimmed:
        h ^= ord(character)
        h = _imul(h, 16777619)
    return h & U32
