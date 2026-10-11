package pixeled3d;

import static pixeled3d.Blocks.*;

import java.util.HashMap;
import java.util.Map;

/**
 * The voxel world — the Java twin of {@code web/world.js} and {@code world.py}.
 *
 * <p>Owns the chunks, the blocks the player changed, and the two queries the game asks constantly:
 * "what is at this coordinate" and "what is the player looking at" (a voxel raycast).
 */
public final class World {

    /** What a raycast found: the block, its face normal and how far away it was. */
    public static final class Hit {
        public final int x, y, z, block;
        public final int nx, ny, nz;
        public final double distance;

        Hit(int x, int y, int z, int block, int nx, int ny, int nz, double distance) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.block = block;
            this.nx = nx;
            this.ny = ny;
            this.nz = nz;
            this.distance = distance;
        }
    }

    public final int seed;
    public final Map<Long, int[]> edits = new HashMap<>();
    private final Map<Long, Generator.Chunk> chunks = new HashMap<>();
    public final Generator generator;

    public World(int seed) {
        this.seed = seed;
        this.generator = new Generator(seed, edits);
    }

    private static long key(int cx, int cz) {
        return ((long) cx << 32) ^ (cz & 0xFFFFFFFFL);
    }

    public Generator.Chunk chunk(int cx, int cz) {
        return chunks.get(key(cx, cz));
    }

    public boolean hasChunk(int cx, int cz) {
        return chunks.containsKey(key(cx, cz));
    }

    public Generator.Chunk ensureChunk(int cx, int cz) {
        Generator.Chunk chunk = chunks.get(key(cx, cz));
        if (chunk == null) {
            chunk = generator.generateChunk(cx, cz);
            chunks.put(key(cx, cz), chunk);
        }
        return chunk;
    }

    public int loadedChunks() {
        return chunks.size();
    }

    public void markDirty(int cx, int cz) {
        Generator.Chunk chunk = chunks.get(key(cx, cz));
        if (chunk != null) chunk.dirty = true;
    }

    // ------------------------------------------------------------------ blocks

    public int getBlock(int x, int y, int z) {
        if (y < 0 || y >= WORLD_HEIGHT) return 0;
        int cx = x >> 4, cz = z >> 4;
        Generator.Chunk chunk = chunks.get(key(cx, cz));
        if (chunk == null) return 0;
        return chunk.get(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
    }

    public boolean setBlock(int x, int y, int z, int block, boolean record) {
        if (y < 0 || y >= WORLD_HEIGHT) return false;
        int cx = x >> 4, cz = z >> 4;
        Generator.Chunk chunk = chunks.get(key(cx, cz));
        if (chunk == null) return false;
        int lx = x - cx * CHUNK_SIZE;
        int lz = z - cz * CHUNK_SIZE;
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
        else if (lx == CHUNK_SIZE - 1) markDirty(cx + 1, cz);
        if (lz == 0) markDirty(cx, cz - 1);
        else if (lz == CHUNK_SIZE - 1) markDirty(cx, cz + 1);
        return true;
    }

    public boolean isSolid(int x, int y, int z) { return Blocks.isSolid(getBlock(x, y, z)); }
    public boolean isOpaque(int x, int y, int z) { return Blocks.isOpaque(getBlock(x, y, z)); }

    public int columnTop(int x, int z) {
        int cx = x >> 4, cz = z >> 4;
        Generator.Chunk chunk = ensureChunk(cx, cz);
        return chunk.height(x - cx * CHUNK_SIZE, z - cz * CHUNK_SIZE);
    }

    // ------------------------------------------------------------------ raycast

    /** Amanatides & Woo voxel traversal — the block the player is looking at. */
    public Hit raycast(double ox, double oy, double oz, double dx, double dy, double dz, double maxDistance) {
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
            if (block != 0 && !isLiquid(block)) return new Hit(x, y, z, block, nx, ny, nz, travelled);
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
            if (y < 0 || y >= WORLD_HEIGHT) return null;
        }
        return null;
    }

    // ------------------------------------------------------------------ spawning

    /** Look for dry land near the preferred column and return a safe standing spot. */
    public double[] findSpawn(int preferX, int preferZ) {
        for (int ring = 0; ring < 8; ring++) {
            for (int dx = -ring; dx <= ring; dx++) {
                for (int dz = -ring; dz <= ring; dz++) {
                    if (ring > 0 && Math.abs(dx) != ring && Math.abs(dz) != ring) continue;
                    int x = preferX + dx * 8;
                    int z = preferZ + dz * 8;
                    ensureChunk(x >> 4, z >> 4);
                    int top = columnTop(x, z);
                    int block = getBlock(x, top, z);
                    boolean plant = Blocks.isPlant(block);
                    if (top > SEA_LEVEL && block != 0 && block != WATER && !plant) {
                        return new double[]{x + 0.5, top + 1, z + 0.5};
                    }
                }
            }
        }
        ensureChunk(preferX >> 4, preferZ >> 4);
        int top = columnTop(preferX, preferZ);
        return new double[]{preferX + 0.5, Math.max(SEA_LEVEL + 2, top + 1), preferZ + 0.5};
    }

    public String describeColumn(int x, int z) {
        int top = columnTop(x, z);
        return generator.biomeAt(x, z) + " · " + Blocks.nameOf(getBlock(x, top, z)) + " at y=" + top;
    }
}
