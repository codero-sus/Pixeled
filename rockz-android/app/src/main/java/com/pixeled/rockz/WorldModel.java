package com.pixeled.rockz;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.HashMap;
import java.util.Map;

/**
 * The voxel world for the Android edition: chunks, the blocks the player changed, raycasting and
 * the device-local save file.
 *
 * <p>The terrain comes from the same seed maths as the web, Python and desktop editions, so a seed
 * typed into Rockz grows the very same valley you explored on the big screen.
 */
final class WorldModel {

    /** What a raycast found: the block, its face normal and how far away it was. */
    static final class Hit {
        final int x, y, z, block;
        final int nx, ny, nz;

        Hit(int x, int y, int z, int block, int nx, int ny, int nz) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.block = block;
            this.nx = nx;
            this.ny = ny;
            this.nz = nz;
        }
    }

    private static final String PREFS = "rockz_world";

    final int seed;
    private final Map<Long, Generator.Chunk> chunks = new HashMap<>();
    final Map<Long, int[]> edits = new HashMap<>();
    final Generator generator;
    private final SharedPreferences preferences;

    int blocksPlaced = 0;
    long elapsedMs = 0;
    double timeOfDay = 0.32;
    double[] savedPlayer;

    WorldModel(Context context, int seed) {
        this.seed = seed;
        this.generator = new Generator(seed, edits);
        this.preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        load();
        if (savedPlayer == null) {
            double[] spawn = findSpawn(0, 0);
            savedPlayer = new double[]{spawn[0], spawn[1], spawn[2], 0, 0};
        }
    }

    private static long key(int cx, int cz) {
        return ((long) cx << 32) ^ (cz & 0xFFFFFFFFL);
    }

    Generator.Chunk chunk(int cx, int cz) {
        return chunks.get(key(cx, cz));
    }

    boolean hasChunk(int cx, int cz) {
        return chunks.containsKey(key(cx, cz));
    }

    Generator.Chunk ensureChunk(int cx, int cz) {
        Generator.Chunk chunk = chunks.get(key(cx, cz));
        if (chunk == null) {
            chunk = generator.generateChunk(cx, cz);
            chunks.put(key(cx, cz), chunk);
        }
        return chunk;
    }

    void markDirty(int cx, int cz) {
        Generator.Chunk chunk = chunks.get(key(cx, cz));
        if (chunk != null) chunk.dirty = true;
    }

    int loadedChunks() {
        return chunks.size();
    }

    // ------------------------------------------------------------------ blocks

    int getBlock(int x, int y, int z) {
        if (y < 0 || y >= Blocks.WORLD_HEIGHT) return 0;
        int cx = x >> 4, cz = z >> 4;
        Generator.Chunk chunk = chunks.get(key(cx, cz));
        if (chunk == null) return 0;
        return chunk.get(x - cx * Blocks.CHUNK_SIZE, y, z - cz * Blocks.CHUNK_SIZE);
    }

    boolean setBlock(int x, int y, int z, int block, boolean record) {
        if (y < 0 || y >= Blocks.WORLD_HEIGHT) return false;
        int cx = x >> 4, cz = z >> 4;
        Generator.Chunk chunk = chunks.get(key(cx, cz));
        if (chunk == null) return false;
        int lx = x - cx * Blocks.CHUNK_SIZE;
        int lz = z - cz * Blocks.CHUNK_SIZE;
        if (chunk.get(lx, y, lz) == block) return false;
        chunk.set(lx, y, lz, block);
        chunk.dirty = true;
        if (block != 0 && y > chunk.height(lx, lz)) {
            chunk.setHeight(lx, lz, y);
        } else if (block == 0 && y == chunk.height(lx, lz)) {
            int scan = y;
            while (scan > 0 && chunk.get(lx, scan, lz) == 0) scan--;
            chunk.setHeight(lx, lz, scan);
        }
        if (record) edits.put(Generator.editKey(x, z), new int[]{y, block});
        if (lx == 0) markDirty(cx - 1, cz);
        else if (lx == Blocks.CHUNK_SIZE - 1) markDirty(cx + 1, cz);
        if (lz == 0) markDirty(cx, cz - 1);
        else if (lz == Blocks.CHUNK_SIZE - 1) markDirty(cx, cz + 1);
        return true;
    }

    boolean isSolid(int x, int y, int z) {
        return Blocks.isSolid(getBlock(x, y, z));
    }

    int columnTop(int x, int z) {
        int cx = x >> 4, cz = z >> 4;
        Generator.Chunk chunk = ensureChunk(cx, cz);
        return chunk.height(x - cx * Blocks.CHUNK_SIZE, z - cz * Blocks.CHUNK_SIZE);
    }

    // ------------------------------------------------------------------ raycast

    /** Amanatides & Woo voxel traversal — the block the crosshair is on. */
    Hit raycast(double ox, double oy, double oz, double dx, double dy, double dz, double maxDistance) {
        double length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (length == 0) return null;
        dx /= length;
        dy /= length;
        dz /= length;
        int x = (int) Math.floor(ox), y = (int) Math.floor(oy), z = (int) Math.floor(oz);
        int stepX = dx > 0 ? 1 : -1;
        int stepY = dy > 0 ? 1 : -1;
        int stepZ = dz > 0 ? 1 : -1;
        double deltaX = dx == 0 ? Double.MAX_VALUE : Math.abs(1 / dx);
        double deltaY = dy == 0 ? Double.MAX_VALUE : Math.abs(1 / dy);
        double deltaZ = dz == 0 ? Double.MAX_VALUE : Math.abs(1 / dz);
        double maxX = dx > 0 ? (x + 1 - ox) / dx : dx < 0 ? (x - ox) / dx : Double.MAX_VALUE;
        double maxY = dy > 0 ? (y + 1 - oy) / dy : dy < 0 ? (y - oy) / dy : Double.MAX_VALUE;
        double maxZ = dz > 0 ? (z + 1 - oz) / dz : dz < 0 ? (z - oz) / dz : Double.MAX_VALUE;

        int nx = 0, ny = 0, nz = 0;
        double travelled = 0;
        while (travelled <= maxDistance) {
            int block = getBlock(x, y, z);
            if (block != 0 && !Blocks.isLiquid(block)) return new Hit(x, y, z, block, nx, ny, nz);
            if (maxX <= maxY && maxX <= maxZ) {
                x += stepX;
                travelled = maxX;
                maxX += deltaX;
                nx = -stepX; ny = 0; nz = 0;
            } else if (maxY <= maxZ) {
                y += stepY;
                travelled = maxY;
                maxY += deltaY;
                nx = 0; ny = -stepY; nz = 0;
            } else {
                z += stepZ;
                travelled = maxZ;
                maxZ += deltaZ;
                nx = 0; ny = 0; nz = -stepZ;
            }
            if (y < 0 || y >= Blocks.WORLD_HEIGHT) return null;
        }
        return null;
    }

    // ------------------------------------------------------------------ spawning

    /** Look for dry land near the preferred column and return a safe standing spot. */
    double[] findSpawn(int preferX, int preferZ) {
        for (int ring = 0; ring < 8; ring++) {
            for (int dx = -ring; dx <= ring; dx++) {
                for (int dz = -ring; dz <= ring; dz++) {
                    if (ring > 0 && Math.abs(dx) != ring && Math.abs(dz) != ring) continue;
                    int x = preferX + dx * 8;
                    int z = preferZ + dz * 8;
                    ensureChunk(x >> 4, z >> 4);
                    int top = columnTop(x, z);
                    int block = getBlock(x, top, z);
                    if (top > Blocks.SEA_LEVEL && block != 0 && block != Blocks.WATER && !Blocks.isPlant(block)) {
                        return new double[]{x + 0.5, top + 1, z + 0.5};
                    }
                }
            }
        }
        ensureChunk(preferX >> 4, preferZ >> 4);
        int top = columnTop(preferX, preferZ);
        return new double[]{preferX + 0.5, Math.max(Blocks.SEA_LEVEL + 2, top + 1), preferZ + 0.5};
    }

    // ------------------------------------------------------------------ saving

    /** Save the seed's world: only what changed, so the file stays tiny. */
    void save(double[] playerState, int blocksPlaced, long elapsedMs, double timeOfDay) {
        StringBuilder text = new StringBuilder();
        text.append("seed ").append(seed).append('\n');
        text.append("time ").append(timeOfDay).append('\n');
        text.append("placed ").append(blocksPlaced).append('\n');
        text.append("player");
        for (double value : playerState) text.append(' ').append(value);
        text.append('\n');
        int written = 0;
        for (Map.Entry<Long, int[]> entry : edits.entrySet()) {
            long key = entry.getKey();
            text.append("edit ").append((int) (key >> 32)).append(' ').append(entry.getValue()[0])
                .append(' ').append((int) key).append(' ').append(entry.getValue()[1]).append('\n');
            if (++written >= 40000) break;   // keep the save small on a phone
        }
        preferences.edit().putString("world", text.toString()).apply();
    }

    /** Reads the save back. Only done once, when the world is created. */
    private void load() {
        String text = preferences.getString("world", null);
        if (text == null) return;
        for (String line : text.split("\n")) {
            String[] parts = line.trim().split(" ");
            try {
                if (parts.length == 0) continue;
                if (parts[0].equals("time") && parts.length > 1) timeOfDay = Double.parseDouble(parts[1]);
                else if (parts[0].equals("placed") && parts.length > 1) blocksPlaced = Integer.parseInt(parts[1]);
                else if (parts[0].equals("player") && parts.length >= 6) {
                    savedPlayer = new double[]{
                        Double.parseDouble(parts[1]), Double.parseDouble(parts[2]),
                        Double.parseDouble(parts[3]), Double.parseDouble(parts[4]),
                        Double.parseDouble(parts[5]),
                    };
                } else if (parts[0].equals("edit") && parts.length >= 5) {
                    edits.put(Generator.editKey(Integer.parseInt(parts[1]), Integer.parseInt(parts[3])),
                        new int[]{Integer.parseInt(parts[2]), Integer.parseInt(parts[4])});
                }
            } catch (NumberFormatException | ArrayIndexOutOfBoundsException brokenLine) {
                // A damaged line never stops the world from loading.
            }
        }
    }

    void clearSave() {
        preferences.edit().remove("world").apply();
    }
}
