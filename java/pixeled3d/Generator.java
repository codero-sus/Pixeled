package pixeled3d;

import static pixeled3d.Blocks.*;

/**
 * Terrain generation — the Java twin of {@code web/generator.js} and {@code generator.py}.
 *
 * <p>A chunk is derived from the world seed alone, so the same seed always rebuilds the same
 * landscape and a brand-new seed gives a brand-new world. Layers, in order: continental shape and
 * mountains, a sea-level fill, biomes from temperature and humidity, caves with glowstone, then
 * trees, cacti and ground cover, and finally the player's saved edits.
 */
public final class Generator {

    private static final int BEDROCK = 1;
    private static final int STRUCTURE_REACH = 3;

    /** A 16 × 96 × 16 block of the world. */
    public static final class Chunk {
        public final int cx;
        public final int cz;
        public final byte[] data = new byte[CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE];
        public final short[] heights = new short[CHUNK_SIZE * CHUNK_SIZE];
        public int highest;
        public boolean dirty = true;

        Chunk(int cx, int cz) {
            this.cx = cx;
            this.cz = cz;
        }

        public static int index(int x, int y, int z) {
            return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
        }

        public int get(int x, int y, int z) {
            if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return 0;
            return data[index(x, y, z)];
        }

        public void set(int x, int y, int z, int block) {
            data[index(x, y, z)] = (byte) block;
            if (block != 0 && y > highest) highest = y;
        }

        public int height(int x, int z) {
            return heights[z * CHUNK_SIZE + x];
        }

        public void setHeight(int x, int z, int y) {
            heights[z * CHUNK_SIZE + x] = (short) y;
        }
    }

    private final int seed;
    private final java.util.Map<Long, int[]> edits;
    private java.util.HashMap<Long, int[]> cache;

    public Generator(int seed, java.util.Map<Long, int[]> edits) {
        this.seed = seed;
        this.edits = edits;
    }

    // ------------------------------------------------------------------ shape & biome

    private static double contrast(double value, double strength) {
        return Math.max(0, Math.min(1, 0.5 + (value - 0.5) * strength));
    }

    /** Terrain height (top solid block) at a world column. */
    public int heightAt(int x, int z) {
        double continent = Noise.fbm2(x * 0.0075, z * 0.0075, seed, 4);
        double hills = Noise.fbm2(x * 0.017, z * 0.017, seed + 101, 3);
        double mountainMask = Math.max(0, (Noise.fbm2(x * 0.0035, z * 0.0035, seed + 211, 3) - 0.48) * 3.6);
        double mountain = Math.pow(mountainMask, 1.6) * 46;
        double ridges = Math.abs(Noise.noise2(x * 0.09, z * 0.09, seed + 307) - 0.5) * 2.4;
        double height = SEA_LEVEL - 3 + (continent - 0.428) * 60 + (hills - 0.45) * 11 + mountain + ridges;
        double beach = Math.max(0, 1 - Math.abs(height - SEA_LEVEL) / 3);
        height = height * (1 - beach * 0.25) + SEA_LEVEL * beach * 0.25;
        return (int) Math.max(BEDROCK + 1, Math.min(WORLD_HEIGHT - 12, Math.round(height)));
    }

    public double temperatureAt(int x, int z) {
        return contrast(Noise.fbm2(x * 0.0055, z * 0.0055, seed + 401, 3), 2.4);
    }

    public double humidityAt(int x, int z) {
        return contrast(Noise.fbm2(x * 0.0072, z * 0.0072, seed + 509, 3), 2.2);
    }

    public String biomeAt(int x, int z) {
        return biomeAt(x, z, heightAt(x, z));
    }

    public String biomeAt(int x, int z, int height) {
        if (height > SEA_LEVEL + 26) return "mountain";
        double temperature = temperatureAt(x, z);
        double humidity = humidityAt(x, z);
        if (temperature > 0.78 && humidity < 0.55) return "desert";
        if (temperature < 0.30) return "snow";
        if (humidity > 0.58) return "forest";
        return "plains";
    }

    /** The stack of natural blocks below the surface, top first, for a biome and altitude. */
    public int[] surfaceLayers(String biome, int height) {
        if (!biome.equals("snow") && !biome.equals("mountain") && height <= SEA_LEVEL + 1) return new int[]{SAND, SAND, SANDSTONE};
        if (biome.equals("desert")) return new int[]{SAND, SAND, SAND, SANDSTONE};
        if (biome.equals("snow")) return new int[]{SNOW, DIRT, DIRT};
        if (biome.equals("mountain") && height > SEA_LEVEL + 34) return new int[]{SNOW, STONE, STONE};
        return new int[]{GRASS, DIRT, DIRT, DIRT};
    }

    // ------------------------------------------------------------------ chunks

    public Chunk generateChunk(int cx, int cz) {
        Chunk chunk = new Chunk(cx, cz);
        int baseX = cx * CHUNK_SIZE;
        int baseZ = cz * CHUNK_SIZE;
        cache = new java.util.HashMap<>();

        for (int z = 0; z < CHUNK_SIZE; z++) {
            for (int x = 0; x < CHUNK_SIZE; x++) {
                int worldX = baseX + x;
                int worldZ = baseZ + z;
                int height = heightAt(worldX, worldZ);
                int[] layers = surfaceLayers(biomeAt(worldX, worldZ, height), height);
                int top = 0;
                for (int y = 0; y <= height; y++) {
                    int block;
                    if (y <= BEDROCK) block = STONE;
                    else if (y == height) block = layers[0];
                    else {
                        int below = height - y - 1;
                        block = below < layers.length ? layers[below] : STONE;
                    }
                    chunk.set(x, y, z, block);
                    top = y;
                }
                for (int y = height + 1; y <= SEA_LEVEL; y++) {
                    chunk.set(x, y, z, WATER);
                    top = y;
                }
                chunk.setHeight(x, z, top);
            }
        }

        carveCaves(chunk, baseX, baseZ);
        decorate(chunk, baseX, baseZ);
        applyEdits(chunk, baseX, baseZ);
        cache = null;
        chunk.dirty = true;
        return chunk;
    }

    private void carveCaves(Chunk chunk, int baseX, int baseZ) {
        int caveSeed = seed + 1301;
        for (int z = 0; z < CHUNK_SIZE; z++) {
            for (int x = 0; x < CHUNK_SIZE; x++) {
                int worldX = baseX + x;
                int worldZ = baseZ + z;
                int height = column(worldX, worldZ)[0];
                int floor = Math.max(BEDROCK + 2, height - 44);
                for (int y = floor; y < height - 1; y++) {
                    int current = chunk.get(x, y, z);
                    if (current == 0 || current == WATER) continue;
                    double worm = Noise.fbm3(worldX * 0.055, y * 0.09, worldZ * 0.055, caveSeed, 3);
                    double hollow = Noise.fbm3(worldX * 0.02, y * 0.05, worldZ * 0.02, caveSeed + 77, 2);
                    if (worm > 0.6 && hollow > 0.42) {
                        chunk.set(x, y, z, 0);
                        if (y > 1 && chunk.get(x, y - 1, z) == STONE && Noise.hashFloat(worldX, y, worldZ, caveSeed + 5) < 0.012) {
                            chunk.set(x, y - 1, z, GLOWSTONE);
                        }
                    }
                }
            }
        }
    }

    private void decorate(Chunk chunk, int baseX, int baseZ) {
        for (int dz = -STRUCTURE_REACH; dz < CHUNK_SIZE + STRUCTURE_REACH; dz++) {
            for (int dx = -STRUCTURE_REACH; dx < CHUNK_SIZE + STRUCTURE_REACH; dx++) {
                int worldX = baseX + dx;
                int worldZ = baseZ + dz;
                int[] info = column(worldX, worldZ);
                int height = info[0];
                String biome = biomeName(info[1]);
                if (height <= SEA_LEVEL) continue;
                double roll = Noise.hashFloat(worldX, height, worldZ, seed + 907);

                if (biome.equals("desert")) {
                    if (roll < 0.014) placeCactus(chunk, dx, height, dz, worldX, worldZ);
                    continue;
                }
                if (hasTree(worldX, worldZ) && !nearStructure(worldX, worldZ, 2)) {
                    placeTree(chunk, dx, height, dz, worldX, worldZ, biome.equals("snow"));
                    continue;
                }
                if (biome.equals("plains") || biome.equals("forest") || biome.equals("snow")) {
                    double deco = Noise.hashFloat(worldX, height + 7, worldZ, seed + 1907);
                    if (deco < 0.15) setLocal(chunk, dx, height + 1, dz, TALL_GRASS);
                    else if (deco < 0.172) setLocal(chunk, dx, height + 1, dz, RED_FLOWER);
                    else if (deco < 0.194) setLocal(chunk, dx, height + 1, dz, YELLOW_FLOWER);
                }
            }
        }
    }

    /** Would this column grow a tree? Shared with {@link #nearStructure} so the two agree. */
    public boolean hasTree(int x, int z) {
        int[] info = column(x, z);
        int height = info[0];
        String biome = biomeName(info[1]);
        if (height <= SEA_LEVEL || biome.equals("desert")) return false;
        double chance = biome.equals("forest") ? 0.045 : biome.equals("snow") ? 0.02 : biome.equals("mountain") ? 0.006 : 0.008;
        return Noise.hashFloat(x, height, z, seed + 907) < chance;
    }

    private boolean nearStructure(int x, int z, int radius) {
        for (int dz = -radius; dz <= radius; dz++) {
            for (int dx = -radius; dx <= radius; dx++) {
                if (dx == 0 && dz == 0) continue;
                if (hasTree(x + dx, z + dz)) return true;
            }
        }
        return false;
    }

    /** Height and biome for a column, memoised for the chunk currently being built. */
    private int[] column(int x, int z) {
        if (cache == null) return computeColumn(x, z);
        long key = ((long) x << 32) ^ (z & 0xFFFFFFFFL);
        int[] entry = cache.get(key);
        if (entry == null) {
            entry = computeColumn(x, z);
            cache.put(key, entry);
        }
        return entry;
    }

    private int[] computeColumn(int x, int z) {
        int height = heightAt(x, z);
        return new int[]{height, biomeId(biomeAt(x, z, height))};
    }

    private static int biomeId(String biome) {
        if (biome.equals("forest")) return 1;
        if (biome.equals("desert")) return 2;
        if (biome.equals("snow")) return 3;
        if (biome.equals("mountain")) return 4;
        return 0;
    }

    private static String biomeName(int id) {
        switch (id) {
            case 1: return "forest";
            case 2: return "desert";
            case 3: return "snow";
            case 4: return "mountain";
            default: return "plains";
        }
    }

    private void setLocal(Chunk chunk, int x, int y, int z, int block) {
        if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
        chunk.set(x, y, z, block);
        if (block != 0 && y > chunk.height(x, z)) chunk.setHeight(x, z, y);
    }

    private void placeTree(Chunk chunk, int x, int ground, int z, int worldX, int worldZ, boolean snowy) {
        int rng = Noise.hash3(worldX, ground, worldZ, seed + 31) & 0x7FFFFFFF;
        int trunk = snowy ? 6 + (rng % 3) : 4 + (rng % 3);
        for (int i = 1; i <= trunk; i++) setLocal(chunk, x, ground + i, z, OAK_LOG);
        int top = ground + trunk;
        if (snowy) {
            for (int layer = 3; layer >= 0; layer--) {
                int radius = layer == 0 ? 0 : layer == 1 ? 1 : 2;
                int y = top + (3 - layer);
                for (int dz = -radius; dz <= radius; dz++) {
                    for (int dx = -radius; dx <= radius; dx++) {
                        if (Math.abs(dx) + Math.abs(dz) > radius + 0.5) continue;
                        if (dx == 0 && dz == 0 && layer != 0) continue;
                        setLocal(chunk, x + dx, y, z + dz, LEAVES);
                    }
                }
            }
            setLocal(chunk, x, top + 4, z, LEAVES);
        } else {
            for (int dy = -2; dy <= 2; dy++) {
                int radius = (dy <= -2 || dy == 2) ? 1 : 2;
                for (int dz = -radius; dz <= radius; dz++) {
                    for (int dx = -radius; dx <= radius; dx++) {
                        if (dx == 0 && dz == 0 && dy <= 0) continue;
                        if (Math.abs(dx) == radius && Math.abs(dz) == radius && dy != 0) continue;
                        setLocal(chunk, x + dx, top + dy, z + dz, LEAVES);
                    }
                }
            }
            setLocal(chunk, x, top + 3, z, LEAVES);
        }
    }

    private void placeCactus(Chunk chunk, int x, int ground, int z, int worldX, int worldZ) {
        int height = 1 + (Noise.hash3(worldX, ground, worldZ, seed + 53) & 0x7FFFFFFF) % 3;
        for (int i = 1; i <= height; i++) setLocal(chunk, x, ground + i, z, CACTUS);
    }

    private void applyEdits(Chunk chunk, int baseX, int baseZ) {
        if (edits.isEmpty()) return;
        boolean touched = false;
        for (java.util.Map.Entry<Long, int[]> entry : edits.entrySet()) {
            long key = entry.getKey();
            int x = (int) (key >> 32);
            int z = (int) key;
            int y = entry.getValue()[0];
            int block = entry.getValue()[1];
            int lx = x - baseX;
            int lz = z - baseZ;
            if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) continue;
            chunk.set(lx, y, lz, block);
            touched = true;
        }
        if (!touched) return;
        for (int z = 0; z < CHUNK_SIZE; z++) {
            for (int x = 0; x < CHUNK_SIZE; x++) {
                for (int y = WORLD_HEIGHT - 1; y >= 0; y--) {
                    if (chunk.get(x, y, z) != 0) {
                        chunk.setHeight(x, z, y);
                        break;
                    }
                }
            }
        }
    }

    /** Pack an edit key: world X and Z in one long. */
    public static long editKey(int x, int z) {
        return ((long) x << 32) ^ (z & 0xFFFFFFFFL);
    }
}
