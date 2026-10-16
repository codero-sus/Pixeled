package com.pixeled.rockz;

/** The block palette and world metrics, identical to the web, Python and Java editions. */
final class Blocks {
    static final int WORLD_X = 96, WORLD_Y = 48, WORLD_Z = 96, SEA_LEVEL = 20;

    static final int AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4,
            LOG = 5, LEAVES = 6, SNOW = 7, PLANKS = 8, GLASS = 9, WATER = 10;

    /** id -> {name, top, side, bottom, solid, transparent}. */
    private static final Object[][] TABLE = {
            {GRASS, "Grass", 0x79C05A, 0x8F7F4A, 0x8A5A3B, true, false},
            {DIRT, "Dirt", 0x96654A, 0x8A5A3B, 0x7D5136, true, false},
            {STONE, "Stone", 0xA6ADB3, 0x9AA0A6, 0x8D949A, true, false},
            {SAND, "Sand", 0xEFE3B0, 0xE6D7A0, 0xD8C68F, true, false},
            {LOG, "Log", 0xB08A52, 0x7F5A35, 0xB08A52, true, false},
            {LEAVES, "Leaves", 0x5FAE52, 0x4F9C47, 0x3F843C, true, false},
            {SNOW, "Snow", 0xFFFFFF, 0xEAF2F8, 0xD7E3EC, true, false},
            {PLANKS, "Planks", 0xC79357, 0xB9854B, 0xA9763F, true, false},
            {GLASS, "Glass", 0xDFF2F8, 0xCFE8F2, 0xCFE8F2, true, true},
            {WATER, "Water", 0x4B8FE0, 0x2F74D0, 0x245AA8, false, true},
    };

    static final int[] HOTBAR = {GRASS, DIRT, STONE, SAND, LOG, LEAVES, SNOW, PLANKS, GLASS};
    static final String[] BIOMES = {"plains", "forest", "desert", "snow"};

    private static Object[] row(int id) {
        for (Object[] candidate : TABLE) if (((Integer) candidate[0]) == id) return candidate;
        return null;
    }

    static String name(int id) {
        Object[] entry = row(id);
        return entry == null ? "Air" : (String) entry[1];
    }

    static int colour(int id, int face) {
        Object[] entry = row(id);
        return entry == null ? 0 : (Integer) entry[2 + Math.max(0, Math.min(2, face))];
    }

    static int topColour(int id) {
        return colour(id, 0);
    }

    static int sideColour(int id) {
        return colour(id, 1);
    }

    static boolean solid(int id) {
        Object[] entry = row(id);
        return entry != null && (Boolean) entry[5];     // id, name, top, side, bottom, solid, ...
    }

    static boolean transparent(int id) {
        Object[] entry = row(id);
        return entry != null && (Boolean) entry[6];
    }

    static int toArgb(int rgb) {
        return 0xFF000000 | rgb;
    }

    /** Blends towards black by {@code light} (0..1), used for shading. */
    static int shade(int rgb, double light) {
        return scale(rgb, 1 - light);
    }

    static int mix(int a, int b, double t) {
        if (t <= 0) return a;
        if (t >= 1) return b;
        int red = (int) (((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t);
        int green = (int) (((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
        int blue = (int) ((a & 255) + ((b & 255) - (a & 255)) * t);
        return (clamp(red) << 16) | (clamp(green) << 8) | clamp(blue);
    }

    static int scale(int rgb, double light) {
        return (clamp((int) (((rgb >> 16) & 255) * light)) << 16)
                | (clamp((int) (((rgb >> 8) & 255) * light)) << 8)
                | clamp((int) ((rgb & 255) * light));
    }

    static int clamp(int value) {
        return value < 0 ? 0 : value > 255 ? 255 : value;
    }

    private Blocks() {
    }
}
