package com.pixeled.rockz;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * The 3D voxel world for Rockz: generation (calibrated continents, biomes, caves, trees), block
 * access, the render indices and the save file in SharedPreferences.
 */
final class WorldModel {

    private static final int CHUNK = 8;
    static final int SAVE_VERSION = 3;

    final int seed;
    final Noise noise;
    final byte[] data = new byte[Blocks.WORLD_X * Blocks.WORLD_Y * Blocks.WORLD_Z];
    final Map<Integer, Integer> edits = new HashMap<>();
    final byte[][] groundTop = new byte[Blocks.WORLD_X][Blocks.WORLD_Z];
    final byte[][] waterTop = new byte[Blocks.WORLD_X][Blocks.WORLD_Z];
    final Map<Integer, List<int[]>> objects = new HashMap<>();
    private final Map<Integer, List<Integer>> chunks = new HashMap<>();
    int version;
    double continentMean = 0.42;

    private final SaveStore store;
    double savedPlayerX, savedPlayerY, savedPlayerZ, savedYaw, savedPitch, savedClock;
    int savedSelected;
    boolean hasSavedPlayer;

    WorldModel(SaveStore store, int seed) {
        this.store = store;
        this.seed = seed & 0x7FFFFFFF;
        this.noise = new Noise(this.seed);
        calibrate();
        generate();
    }

    /** Open the saved world, or roll a brand-new random one. */
    static WorldModel open(SaveStore store) {
        int version = store.getInt("version", 0);
        int seed = store.getInt("seed", 0);
        if (version == SAVE_VERSION && seed != 0) {
            WorldModel world = new WorldModel(store, seed);
            world.readSave();
            return world;
        }
        WorldModel world = new WorldModel(store, randomSeed());
        world.save();
        return world;
    }

    /** Forget the current world; the next open() rolls a fresh random one. */
    void forget() {
        store.clear();
    }

    static int randomSeed() {
        return 1 + new Random().nextInt(Integer.MAX_VALUE - 1);
    }

    // ------------------------------------------------------------------ blocks

    static int index(int x, int y, int z) {
        return (y * Blocks.WORLD_Z + z) * Blocks.WORLD_X + x;
    }

    boolean inside(int x, int y, int z) {
        return x >= 0 && x < Blocks.WORLD_X && y >= 0 && y < Blocks.WORLD_Y
                && z >= 0 && z < Blocks.WORLD_Z;
    }

    int get(int x, int y, int z) {
        if (!inside(x, y, z)) return Blocks.AIR;
        return data[index(x, y, z)] & 255;
    }

    boolean isSolid(int x, int y, int z) {
        if (y < 0) return true;
        if (x < 0 || x >= Blocks.WORLD_X || z < 0 || z >= Blocks.WORLD_Z || y >= Blocks.WORLD_Y) return false;
        return Blocks.solid(data[index(x, y, z)] & 255);
    }

    void set(int x, int y, int z, int id) {
        if (!inside(x, y, z)) return;
        data[index(x, y, z)] = (byte) id;
        edits.put(index(x, y, z), id);
        version++;
        refreshColumn(x, z);
    }

    /** Surface of one column: {height, block id, 1 when water, 0 otherwise}; height -1 for void. */
    int[] surface(int x, int z) {
        int ground = groundTop[x][z];
        int water = waterTop[x][z];
        if (water > ground) return new int[]{water, Blocks.WATER, 1};
        if (ground < 0) return new int[]{-1, Blocks.AIR, 0};
        return new int[]{ground, data[index(x, ground, z)] & 255, 0};
    }

    void refreshColumn(int x, int z) {
        int ground = -1, water = -1;
        for (int y = Blocks.WORLD_Y - 1; y >= 0 && (ground < 0 || water < 0); y--) {
            int id = data[index(x, y, z)] & 255;
            if (id == Blocks.AIR) continue;
            if (id == Blocks.WATER) {
                if (water < 0) water = y;
            } else if (ground < 0) {
                ground = y;
            }
        }
        groundTop[x][z] = (byte) ground;
        waterTop[x][z] = (byte) water;

        List<int[]> stack = null;
        for (int y = Math.max(ground, water) + 1; y < Blocks.WORLD_Y; y++) {
            int id = data[index(x, y, z)] & 255;
            if (id == Blocks.AIR) continue;
            if (stack == null) stack = new ArrayList<>();
            stack.add(new int[]{y, id});
        }
        int column = x * Blocks.WORLD_Z + z;
        if (stack == null) {
            objects.remove(column);
            List<Integer> bucket = chunks.get(chunkKey(x, z));
            if (bucket != null) bucket.remove((Integer) column);
        } else {
            objects.put(column, stack);
            List<Integer> bucket = chunks.get(chunkKey(x, z));
            if (bucket == null) {
                bucket = new ArrayList<>();
                chunks.put(chunkKey(x, z), bucket);
            }
            if (!bucket.contains(column)) bucket.add(column);
        }
    }

    private static int chunkKey(int x, int z) {
        return (x / CHUNK) * 64 + (z / CHUNK);
    }

    /** Every cube within {@code radius} columns of a point, as {x, y, z, id}. */
    List<int[]> objectsNear(double px, double pz, double radius) {
        List<int[]> found = new ArrayList<>();
        int minX = (int) Math.floor((px - radius) / CHUNK), maxX = (int) Math.floor((px + radius) / CHUNK);
        int minZ = (int) Math.floor((pz - radius) / CHUNK), maxZ = (int) Math.floor((pz + radius) / CHUNK);
        double radiusSquared = radius * radius;
        for (int cx = minX; cx <= maxX; cx++) {
            for (int cz = minZ; cz <= maxZ; cz++) {
                List<Integer> bucket = chunks.get(cx * 64 + cz);
                if (bucket == null) continue;
                for (int column : bucket) {
                    int x = column / Blocks.WORLD_Z, z = column % Blocks.WORLD_Z;
                    double dx = x + 0.5 - px, dz = z + 0.5 - pz;
                    if (dx * dx + dz * dz > radiusSquared) continue;
                    List<int[]> stack = objects.get(column);
                    if (stack == null) continue;
                    for (int[] cube : stack) found.add(new int[]{x, cube[0], z, cube[1]});
                }
            }
        }
        return found;
    }

    // ------------------------------------------------------------------ terrain

    void calibrate() {
        double total = 0;
        int count = 0;
        for (int x = 0; x < Blocks.WORLD_X; x += 4) {
            for (int z = 0; z < Blocks.WORLD_Z; z += 4) {
                total += continent(x, z);
                count++;
            }
        }
        continentMean = total / count;
    }

    double continent(double x, double z) {
        return noise.fbm2(x * 0.0038, z * 0.0038, 5);
    }

    int surfaceHeight(double x, double z) {
        double land = clamp01((continent(x, z) - (continentMean - 0.065)) / 0.14);
        double ridge = Math.abs(noise.fbm2(x * 0.011 + 31, z * 0.011 - 17, 3) - 0.5) * 2;
        double mask = clamp01((land - 0.58) / 0.42);
        double hills = (noise.fbm2(x * 0.021 + 11, z * 0.021 - 5, 3) - 0.5) * (3 + land * 8);
        double grain = (noise.fbm2(x * 0.085 - 3, z * 0.085 + 19, 2) - 0.5) * 1.8;
        double height = 11 + Math.pow(land, 1.1) * 38 + Math.pow(ridge, 3) * 9 * mask + hills + grain;
        return Math.max(2, Math.min(Blocks.WORLD_Y - 6, (int) Math.floor(height)));
    }

    int biomeAt(double x, double z) {
        double temperature = noise.fbm2(x * 0.0031 + 7.3, z * 0.0031 + 2.1, 3);
        double moisture = noise.fbm2(x * 0.0043 - 4.7, z * 0.0043 + 9.4, 3);
        if (temperature < 0.34) return 3;
        if (moisture < 0.36 && temperature > 0.5) return 2;
        if (moisture > 0.6) return 1;
        return 0;
    }

    String biomeName(double x, double z) {
        return Blocks.BIOMES[biomeAt(x, z)];
    }

    private static double clamp01(double value) {
        return value < 0 ? 0 : value > 1 ? 1 : value;
    }

    void generate() {
        for (int z = 0; z < Blocks.WORLD_Z; z++) {
            for (int x = 0; x < Blocks.WORLD_X; x++) {
                int height = surfaceHeight(x, z);
                int biome = biomeAt(x, z);
                boolean beach = height <= Blocks.SEA_LEVEL + 1;
                boolean alpine = height > 34 && !beach;
                for (int y = 0; y <= height; y++) {
                    int id;
                    if (y > height - 4) {
                        if (beach) id = Blocks.SAND;
                        else if (y == height) {
                            id = (alpine || biome == 3) ? Blocks.SNOW : biome == 2 ? Blocks.SAND : Blocks.GRASS;
                        } else {
                            id = alpine ? Blocks.STONE : Blocks.DIRT;
                        }
                    } else {
                        id = Blocks.STONE;
                    }
                    data[index(x, y, z)] = (byte) id;
                }
                groundTop[x][z] = (byte) height;
                if (height < Blocks.SEA_LEVEL) {
                    for (int y = height + 1; y <= Blocks.SEA_LEVEL; y++) data[index(x, y, z)] = (byte) Blocks.WATER;
                    waterTop[x][z] = (byte) Blocks.SEA_LEVEL;
                }
            }
        }
        for (int z = 2; z < Blocks.WORLD_Z - 2; z += 2) {
            for (int x = 2; x < Blocks.WORLD_X - 2; x += 2) {
                int height = surfaceHeight(x, z);
                for (int y = 2; y < Math.max(3, height - 2); y += 2) {
                    if (noise.value3(x * 0.055, y * 0.085, z * 0.055) > 0.72) {
                        for (int dy = 0; dy < 2; dy++)
                            for (int dz = 0; dz < 2; dz++)
                                for (int dx = 0; dx < 2; dx++)
                                    if (inside(x + dx, y + dy, z + dz)) {
                                        data[index(x + dx, y + dy, z + dz)] = (byte) Blocks.AIR;
                                    }
                    }
                }
            }
        }
        for (int z = 0; z < Blocks.WORLD_Z; z++) {
            for (int x = 0; x < Blocks.WORLD_X; x++) plantTree(x, z);
        }
    }

    private void plantTree(int x, int z) {
        int height = surfaceHeight(x, z);
        if (height <= Blocks.SEA_LEVEL + 1) return;
        if (x < 3 || z < 3 || x > Blocks.WORLD_X - 4 || z > Blocks.WORLD_Z - 4) return;
        int biome = biomeAt(x, z);
        if (biome == 2) return;
        double density = biome == 1 ? 0.055 : biome == 3 ? 0.02 : 0.012;
        if (Noise.hashCoords(x, 7, z, seed) > density) return;
        int trunk = (biome == 3 ? 5 : 4) + (int) (Noise.hashCoords(x, 11, z, seed) * 3);
        int crown = height + trunk;
        for (int i = 1; i <= trunk; i++) placeCube(x, height + i, z, Blocks.LOG);
        for (int dy = -2; dy < 2; dy++) {
            double spread = dy <= -1 ? 2 : 2 - (dy + 2) * 0.6;
            for (int dz = -2; dz <= 2; dz++) {
                for (int dx = -2; dx <= 2; dx++) {
                    if (Math.hypot(dx, dz) + Math.abs(dy) * 0.35 > spread + 0.45) continue;
                    if (dx == 0 && dz == 0 && dy < 1) continue;
                    int px = x + dx, py = crown + dy, pz = z + dz;
                    if (inside(px, py, pz) && (data[index(px, py, pz)] & 255) == Blocks.AIR) {
                        data[index(px, py, pz)] = (byte) Blocks.LEAVES;
                        placeCubeIndex(px, py, pz, Blocks.LEAVES);
                    }
                }
            }
        }
    }

    void placeCube(int x, int y, int z, int id) {
        if (!inside(x, y, z)) return;
        if ((data[index(x, y, z)] & 255) != Blocks.AIR) return;
        data[index(x, y, z)] = (byte) id;
        placeCubeIndex(x, y, z, id);
    }

    private void placeCubeIndex(int x, int y, int z, int id) {
        int column = x * Blocks.WORLD_Z + z;
        List<int[]> stack = objects.get(column);
        if (stack == null) {
            stack = new ArrayList<>();
            objects.put(column, stack);
        }
        stack.add(new int[]{y, id});
        stack.sort((a, b) -> Integer.compare(a[0], b[0]));
        if (y > groundTop[x][z]) groundTop[x][z] = (byte) y;
        List<Integer> bucket = chunks.get(chunkKey(x, z));
        if (bucket == null) {
            bucket = new ArrayList<>();
            chunks.put(chunkKey(x, z), bucket);
        }
        if (!bucket.contains(column)) bucket.add(column);
    }

    /** A dry, open spot near the middle of the map. */
    double[] spawnPoint() {
        for (int attempt = 0; attempt < 400; attempt++) {
            double angle = attempt * 0.7;
            double radius = 5 + attempt * 0.3;
            int x = (int) (Blocks.WORLD_X / 2 + Math.cos(angle) * radius);
            int z = (int) (Blocks.WORLD_Z / 2 + Math.sin(angle) * radius);
            if (x < 2 || z < 2 || x > Blocks.WORLD_X - 3 || z > Blocks.WORLD_Z - 3) continue;
            int height = surfaceHeight(x, z);
            if (height <= Blocks.SEA_LEVEL + 2) continue;
            if (get(x, height, z) == Blocks.AIR) continue;
            if (get(x, height + 1, z) != Blocks.AIR || get(x, height + 2, z) != Blocks.AIR) continue;
            return new double[]{x + 0.5, height + 1, z + 0.5};
        }
        return new double[]{Blocks.WORLD_X / 2.0 + 0.5, Blocks.SEA_LEVEL + 6, Blocks.WORLD_Z / 2.0 + 0.5};
    }

    // ------------------------------------------------------------------ saving

    void save() {
        StringBuilder editList = new StringBuilder();
        for (Map.Entry<Integer, Integer> entry : edits.entrySet()) {
            if (editList.length() > 0) editList.append(';');
            editList.append(entry.getKey()).append('=').append(entry.getValue());
        }
        store.putInt("version", SAVE_VERSION);
        store.putInt("seed", seed);
        store.putString("edits", editList.toString());
        store.putFloat("player-x", (float) savedPlayerX);
        store.putFloat("player-y", (float) savedPlayerY);
        store.putFloat("player-z", (float) savedPlayerZ);
        store.putFloat("yaw", (float) savedYaw);
        store.putFloat("pitch", (float) savedPitch);
        store.putFloat("clock", (float) savedClock);
        store.putInt("selected", savedSelected);
        store.apply();
    }

    void rememberPlayer(double x, double y, double z, double yaw, double pitch, double clock, int selected) {
        savedPlayerX = x;
        savedPlayerY = y;
        savedPlayerZ = z;
        savedYaw = yaw;
        savedPitch = pitch;
        savedClock = clock;
        savedSelected = selected;
        hasSavedPlayer = true;
    }

    void readSave() {
        String saved = store.getString("edits", "");
        if (saved != null && !saved.isEmpty()) {
            for (String pair : saved.split(";")) {
                int equals = pair.indexOf('=');
                if (equals < 0) continue;
                try {
                    int blockIndex = Integer.parseInt(pair.substring(0, equals));
                    int id = Integer.parseInt(pair.substring(equals + 1));
                    data[blockIndex] = (byte) id;
                    edits.put(blockIndex, id);
                } catch (NumberFormatException ignored) {
                    // A damaged entry is skipped rather than losing the whole world.
                }
            }
            for (int blockIndex : edits.keySet()) {
                int x = blockIndex % Blocks.WORLD_X;
                int rest = blockIndex / Blocks.WORLD_X;
                int z = rest % Blocks.WORLD_Z;
                refreshColumn(x, z);
            }
            version++;
        }
        savedPlayerX = store.getFloat("player-x", 0);
        savedPlayerY = store.getFloat("player-y", 0);
        savedPlayerZ = store.getFloat("player-z", 0);
        savedYaw = store.getFloat("yaw", 0.6f);
        savedPitch = store.getFloat("pitch", -0.12f);
        savedClock = store.getFloat("clock", 0.32f);
        savedSelected = store.getInt("selected", 0);
        hasSavedPlayer = savedPlayerY > 0;
    }
}
