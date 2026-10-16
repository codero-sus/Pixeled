package pixeled;

/**
 * Seeded value noise, ported bit-for-bit from the web and Python editions, so the same seed makes
 * the same world in every edition.
 */
public final class Noise {

  private final int[] perm = new int[512];
  public final int seed;

  public Noise(int seed) {
    this.seed = seed;
    int state = seed;
    final int[] table = new int[256];
    for (int i = 0; i < 256; i++) table[i] = i;
    for (int i = 255; i > 0; i--) {
      state += 0x6D2B79F5;                       // mulberry32, exactly as in noise.js
      int t = state;
      t = (t ^ (t >>> 15)) * (1 | t);
      // mulberry32 folds the summed value back in with an XOR before the final shift;
      // (t >>> 0) would still be a signed int in Java, so widen through a long to divide.
      t = (t + (t ^ (t >>> 7)) * (61 | t)) ^ t;
      int bits = t ^ (t >>> 14);
      int j = (int) Math.floor((bits & 0xFFFFFFFFL) / 4294967296.0 * (i + 1));
      int swap = table[i];
      table[i] = table[j];
      table[j] = swap;
    }
    for (int i = 0; i < 512; i++) perm[i] = table[i & 255] & 255;
  }

  public double hash2(int x, int y) {
    return perm[(perm[x & 255] + (y & 255)) & 255] / 255.0;
  }

  public double hash3(int x, int y, int z) {
    return perm[(perm[(perm[x & 255] + (y & 255)) & 255] + (z & 255)) & 255] / 255.0;
  }

  private static double smooth(double t) {
    return t * t * (3 - 2 * t);
  }

  public double value2(double x, double y) {
    int xi = (int) Math.floor(x), yi = (int) Math.floor(y);
    double tx = smooth(x - xi), ty = smooth(y - yi);
    double a = hash2(xi, yi), b = hash2(xi + 1, yi);
    double c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    double top = a + (b - a) * tx, bottom = c + (d - c) * tx;
    return top + (bottom - top) * ty;
  }

  public double value3(double x, double y, double z) {
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

  public double fbm2(double x, double y, int octaves) {
    double amplitude = 1, frequency = 1, total = 0, weight = 0;
    for (int i = 0; i < octaves; i++) {
      total += value2(x * frequency, y * frequency) * amplitude;
      weight += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return total / weight;
  }

  public double fbm3(double x, double y, double z, int octaves) {
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
  public static double hashCoords(int x, int y, int z, int seed) {
    int h = x * 0x27D4EB2D ^ y * 0x165667B1 ^ z * 0x9E3779B1 ^ seed;
    h ^= h >>> 15;
    h *= 0x85EBCA6B;
    h ^= h >>> 13;
    h *= 0xC2B2AE35;
    h ^= h >>> 16;
    return (h & 0xFFFFFFFFL) / 4294967296.0;
  }
}
