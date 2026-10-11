package pixeled3d;

/**
 * Deterministic, seedable noise — the Java twin of {@code web/noise.js} and
 * {@code python/pixeled_game/noise.py}.
 *
 * <p>The maths is deliberately identical in all editions: the same hashing, the same octaves, the
 * same order of operations. A seed typed into any edition therefore produces the very same
 * landscape, which is what makes seeds shareable between the web game, the desktop game and the
 * phone game.
 */
public final class Noise {

    private Noise() {}

    /** Tiny, fast, well-distributed PRNG returning floats in [0, 1). */
    public static final class Mulberry32 {
        private int state;

        public Mulberry32(int seed) {
            this.state = seed;
        }

        public double next() {
            state = state + 0x6D2B79F5;
            int t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) & 0xFFFFFFFFL) / 4294967296.0;
        }
    }

    /** 32-bit integer hash of three coordinates (and a seed). */
    public static int hash3(int x, int y, int z, int seed) {
        int h = Math.imul(x, 0x27D4EB2D) ^ Math.imul(y, 0x165667B1) ^ Math.imul(z, 0x9E3779B1) ^ Math.imul(seed, 0x85EBCA6B);
        h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D);
        h = Math.imul(h ^ (h >>> 12), 0x297A2D39);
        return h ^ (h >>> 15);
    }

    /** Hash of two coordinates, handy for per-column decisions (trees, flowers, biome jitter). */
    public static int hash2(int x, int z, int seed) {
        return hash3(x, 0, z, seed);
    }

    /** Float in [0, 1) from a hash. */
    public static double hashFloat(int x, int y, int z, int seed) {
        return (hash3(x, y, z, seed) & 0xFFFFFFFFL) / 4294967296.0;
    }

    /** Quintic smoothstep — removes the visible grid artefacts of raw value noise. */
    private static double smooth(double t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private static double lerp(double a, double b, double t) {
        return a + (b - a) * t;
    }

    /** Smooth value noise in 2D, returning [0, 1). */
    public static double noise2(double x, double y, int seed) {
        int xi = (int) Math.floor(x);
        int yi = (int) Math.floor(y);
        double xf = smooth(x - xi);
        double yf = smooth(y - yi);
        double n00 = hashFloat(xi, 0, yi, seed);
        double n10 = hashFloat(xi + 1, 0, yi, seed);
        double n01 = hashFloat(xi, 0, yi + 1, seed);
        double n11 = hashFloat(xi + 1, 0, yi + 1, seed);
        return lerp(lerp(n00, n10, xf), lerp(n01, n11, xf), yf);
    }

    /** Smooth value noise in 3D, returning [0, 1). */
    public static double noise3(double x, double y, double z, int seed) {
        int xi = (int) Math.floor(x);
        int yi = (int) Math.floor(y);
        int zi = (int) Math.floor(z);
        double xf = smooth(x - xi);
        double yf = smooth(y - yi);
        double zf = smooth(z - zi);
        double n000 = hashFloat(xi, yi, zi, seed);
        double n100 = hashFloat(xi + 1, yi, zi, seed);
        double n010 = hashFloat(xi, yi + 1, zi, seed);
        double n110 = hashFloat(xi + 1, yi + 1, zi, seed);
        double n001 = hashFloat(xi, yi, zi + 1, seed);
        double n101 = hashFloat(xi + 1, yi, zi + 1, seed);
        double n011 = hashFloat(xi, yi + 1, zi + 1, seed);
        double n111 = hashFloat(xi + 1, yi + 1, zi + 1, seed);
        double bottom = lerp(lerp(n000, n100, xf), lerp(n010, n110, xf), yf);
        double top = lerp(lerp(n001, n101, xf), lerp(n011, n111, xf), yf);
        return lerp(bottom, top, zf);
    }

    /** Fractal brownian motion over 2D value noise. Result stays in [0, 1). */
    public static double fbm2(double x, double y, int seed, int octaves) {
        double amplitude = 1, frequency = 1, sum = 0, total = 0;
        for (int octave = 0; octave < octaves; octave++) {
            sum += noise2(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
            total += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        return sum / total;
    }

    /** Fractal brownian motion over 3D value noise. Result stays in [0, 1). */
    public static double fbm3(double x, double y, double z, int seed, int octaves) {
        double amplitude = 1, frequency = 1, sum = 0, total = 0;
        for (int octave = 0; octave < octaves; octave++) {
            sum += noise3(x * frequency, y * frequency, z * frequency, seed + octave * 7919) * amplitude;
            total += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        return sum / total;
    }

    /** A fresh 32-bit seed for a brand-new world. */
    public static int randomSeed() {
        return (int) (Math.random() * 0xFFFFFFFFL);
    }

    /** Tidy seed text for the interface, e.g. 0004821004. */
    public static String seedLabel(int seed) {
        return String.format("%010d", seed & 0xFFFFFFFFL);
    }

    /** Turn whatever the player typed into the seed box into a number; null means "surprise me". */
    public static Integer parseSeed(String text) {
        if (text == null) return null;
        String trimmed = text.trim();
        if (trimmed.isEmpty()) return null;
        boolean numeric = true;
        for (int i = 0; i < trimmed.length(); i++) {
            if (!Character.isDigit(trimmed.charAt(i))) { numeric = false; break; }
        }
        if (numeric) {
            try {
                return (int) (Long.parseLong(trimmed) & 0xFFFFFFFFL);
            } catch (NumberFormatException tooBig) {
                numeric = false;
            }
        }
        int h = 2166136261;
        for (int i = 0; i < trimmed.length(); i++) {
            h ^= trimmed.charAt(i);
            h = Math.imul(h, 16777619);
        }
        return h;
    }
}
