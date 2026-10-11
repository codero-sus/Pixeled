package com.pixeled.rockz;

/**
 * Seeded value noise, ported bit-for-bit from the web, Python and Java editions, so a seed means
 * the same world everywhere.
 */
final class Noise {
    private final int[] perm = new int[512];
    final int seed;

    Noise(int seed) {
        this.seed = seed;
        int state = seed;
        int[] table = new int[256];
        for (int i = 0; i < 256; i++) table[i] = i;
        for (int i = 255; i > 0; i--) {
            state += 0x6D2B79F5;
            int t = state;
            t = (t ^ (t >>> 15)) * (1 | t);
            t = t + (t ^ (t >>> 7)) * (61 | t);
            int advanced = t ^ (t >>> 14);
            int j = (int) Math.floor((advanced >>> 0) / 4294967296.0 * (i + 1));
            int swap = table[i];
            table[i] = table[j];
            table[j] = swap;
        }
        for (int i = 0; i < 512; i++) perm[i] = table[i & 255] & 255;
    }

    private double hash2(int x, int y) {
        return perm[(perm[x & 255] + (y & 255)) & 255] / 255.0;
    }

    private double hash3(int x, int y, int z) {
        return perm[(perm[(perm[x & 255] + (y & 255)) & 255] + (z & 255)) & 255] / 255.0;
    }

    private static double smooth(double t) {
        return t * t * (3 - 2 * t);
    }

    double value2(double x, double y) {
        int xi = (int) Math.floor(x), yi = (int) Math.floor(y);
        double tx = smooth(x - xi), ty = smooth(y - yi);
        double a = hash2(xi, yi), b = hash2(xi + 1, yi);
        double c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
        double top = a + (b - a) * tx, bottom = c + (d - c) * tx;
        return top + (bottom - top) * ty;
    }

    double value3(double x, double y, double z) {
        int xi = (int) Math.floor(x), yi = (int) Math.floor(y), zi = (int) Math.floor(z);
        double tx = smooth(x - xi), ty = smooth(y - yi), tz = smooth(z - zi);
        double c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
        double c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
        double c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
        double c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
        double x00 = c000 + (c100 - c000) * tx, x10 = c010 + (c110 - c010) * tx;
        double x01 = c001 + (c101 - c001) * tx, x11 = c011 + (c111 - c011) * tx;
        double y0 = x00 + (x10 - x00) * ty, y1 = x01 + (x11 - x01) * ty;
        return y0 + (y1 - y0) * tz;
    }

    double fbm2(double x, double y, int octaves) {
        double amplitude = 1, frequency = 1, total = 0, weight = 0;
        for (int i = 0; i < octaves; i++) {
            total += value2(x * frequency, y * frequency) * amplitude;
            weight += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        return total / weight;
    }

    double fbm3(double x, double y, double z, int octaves) {
        double amplitude = 1, frequency = 1, total = 0, weight = 0;
        for (int i = 0; i < octaves; i++) {
            total += value3(x * frequency, y * frequency, z * frequency) * amplitude;
            weight += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        return total / weight;
    }

    /** Cheap deterministic hash used for per-block colour jitter and tree placement. */
    static double hashCoords(int x, int y, int z, int seed) {
        int h = x * 0x27D4EB2D ^ y * 0x165667B1 ^ z * 0x9E3779B1 ^ seed;
        h ^= h >>> 15;
        h *= 0x85EBCA6B;
        h ^= h >>> 13;
        h *= 0xC2B2AE35;
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296.0;
    }
}
