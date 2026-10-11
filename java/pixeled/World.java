package pixeled;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.Writer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static pixeled.Blocks.AIR;
import static pixeled.Blocks.DIRT;
import static pixeled.Blocks.GRASS;
import static pixeled.Blocks.LEAVES;
import static pixeled.Blocks.LOG;
import static pixeled.Blocks.SAND;
import static pixeled.Blocks.SEA_LEVEL;
import static pixeled.Blocks.SNOW;
import static pixeled.Blocks.STONE;
import static pixeled.Blocks.WATER;
import static pixeled.Blocks.WORLD_X;
import static pixeled.Blocks.WORLD_Y;
import static pixeled.Blocks.WORLD_Z;

/**
 * The voxel world: generation (continents, biomes, caves, trees), block access, the edit list
 * that gets saved, and the heightfield plus block index the renderer draws from.
 */
public final class World {

  private static final int CHUNK = 8;

  public final int seed;
  public final Noise noise;
  public final byte[] data = new byte[WORLD_X * WORLD_Y * WORLD_Z];
  public final Map<Integer, Integer> edits = new HashMap<>();
  public final byte[][] groundTop = new byte[WORLD_X][WORLD_Z];
  public final byte[][] waterTop = new byte[WORLD_X][WORLD_Z];
  /** (x, z) packed as x * WORLD_Z + z -> the cubes standing on the terrain in that column. */
  public final Map<Integer, List<int[]>> objects = new HashMap<>();
  private final Map<Integer, List<Integer>> chunks = new HashMap<>();
  public int version = 0;
  public double continentMean = 0.42;

  public World(int seed) {
    this.seed = seed & 0x7FFFFFFF;
    this.noise = new Noise(this.seed);
    calibrate();
    generate();
  }

  public static int index(int x, int y, int z) {
    return (y * WORLD_Z + z) * WORLD_X + x;
  }

  public boolean inside(int x, int y, int z) {
    return x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y && z >= 0 && z < WORLD_Z;
  }

  public int get(int x, int y, int z) {
    if (!inside(x, y, z)) return AIR;
    return data[index(x, y, z)] & 255;
  }

  public boolean isSolid(int x, int y, int z) {
    if (y < 0) return true;
    if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z || y >= WORLD_Y) return false;
    return Blocks.solid(data[index(x, y, z)] & 255);
  }

  public void set(int x, int y, int z, int id) {
    if (!inside(x, y, z)) return;
    data[index(x, y, z)] = (byte) id;
    edits.put(key(x, y, z), id);
    version++;
    refreshColumn(x, z);
  }

  public static int key(int x, int y, int z) {
    return (y * WORLD_Z + z) * WORLD_X + x;
  }

  public static int[] unkey(int key) {
    int x = key % WORLD_X;
    int rest = key / WORLD_X;
    int z = rest % WORLD_Z;
    int y = rest / WORLD_Z;
    return new int[] {x, y, z};
  }

  /** Surface of one column: {height, block id, 1 when water, 0 otherwise}; height -1 for void. */
  public int[] surface(int x, int z) {
    int ground = groundTop[x][z];
    int water = waterTop[x][z];
    if (water > ground) return new int[] {water, WATER, 1};
    if (ground < 0) return new int[] {-1, AIR, 0};
    return new int[] {ground, data[index(x, ground, z)] & 255, 0};
  }

  /** Recache one column: terrain top, water top and the cubes standing on them. */
  public void refreshColumn(int x, int z) {
    int ground = -1, water = -1;
    for (int y = WORLD_Y - 1; y >= 0 && (ground < 0 || water < 0); y--) {
      int id = data[index(x, y, z)] & 255;
      if (id == AIR) continue;
      if (id == WATER) {
        if (water < 0) water = y;
      } else if (ground < 0) {
        ground = y;
      }
    }
    groundTop[x][z] = (byte) ground;
    waterTop[x][z] = (byte) water;

    List<int[]> stack = null;
    for (int y = Math.max(ground, water) + 1; y < WORLD_Y; y++) {
      int id = data[index(x, y, z)] & 255;
      if (id == AIR) continue;
      if (stack == null) stack = new ArrayList<>();
      stack.add(new int[] {y, id});
    }
    int column = x * WORLD_Z + z;
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
  public List<int[]> objectsNear(double px, double pz, double radius) {
    List<int[]> found = new ArrayList<>();
    int minX = (int) Math.floor((px - radius) / CHUNK), maxX = (int) Math.floor((px + radius) / CHUNK);
    int minZ = (int) Math.floor((pz - radius) / CHUNK), maxZ = (int) Math.floor((pz + radius) / CHUNK);
    double radiusSquared = radius * radius;
    for (int cx = minX; cx <= maxX; cx++) {
      for (int cz = minZ; cz <= maxZ; cz++) {
        List<Integer> bucket = chunks.get(cx * 64 + cz);
        if (bucket == null) continue;
        for (int column : bucket) {
          int x = column / WORLD_Z, z = column % WORLD_Z;
          double dx = x + 0.5 - px, dz = z + 0.5 - pz;
          if (dx * dx + dz * dz > radiusSquared) continue;
          List<int[]> stack = objects.get(column);
          if (stack == null) continue;
          for (int[] cube : stack) found.add(new int[] {x, cube[0], z, cube[1]});
        }
      }
    }
    return found;
  }

  // ------------------------------------------------------------------ terrain

  /** Average the continental noise so every seed gets a similar land/water balance. */
  public void calibrate() {
    double total = 0;
    int count = 0;
    for (int x = 0; x < WORLD_X; x += 4) {
      for (int z = 0; z < WORLD_Z; z += 4) {
        total += continent(x, z);
        count++;
      }
    }
    continentMean = total / count;
  }

  public double continent(double x, double z) {
    return noise.fbm2(x * 0.0038, z * 0.0038, 5);
  }

  /** The height every edition must agree on: calibrated continents + hills + one-block grain. */
  public int surfaceHeight(double x, double z) {
    double land = clamp01((continent(x, z) - (continentMean - 0.065)) / 0.14);
    double ridge = Math.abs(noise.fbm2(x * 0.011 + 31, z * 0.011 - 17, 3) - 0.5) * 2;
    double mask = clamp01((land - 0.58) / 0.42);
    double hills = (noise.fbm2(x * 0.021 + 11, z * 0.021 - 5, 3) - 0.5) * (3 + land * 8);
    double grain = (noise.fbm2(x * 0.085 - 3, z * 0.085 + 19, 2) - 0.5) * 1.8;
    double height = 11 + Math.pow(land, 1.1) * 38 + Math.pow(ridge, 3) * 9 * mask + hills + grain;
    return Math.max(2, Math.min(WORLD_Y - 6, (int) Math.floor(height)));
  }

  public int biomeAt(double x, double z) {
    double temperature = noise.fbm2(x * 0.0031 + 7.3, z * 0.0031 + 2.1, 3);
    double moisture = noise.fbm2(x * 0.0043 - 4.7, z * 0.0043 + 9.4, 3);
    if (temperature < 0.34) return 3;
    if (moisture < 0.36 && temperature > 0.5) return 2;
    if (moisture > 0.6) return 1;
    return 0;
  }

  public String biomeName(double x, double z) {
    return Blocks.BIOMES[biomeAt(x, z)];
  }

  private static double clamp01(double value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  public void generate() {
    for (int z = 0; z < WORLD_Z; z++) {
      for (int x = 0; x < WORLD_X; x++) {
        int height = surfaceHeight(x, z);
        int biome = biomeAt(x, z);
        boolean beach = height <= SEA_LEVEL + 1;
        boolean alpine = height > 34 && !beach;
        for (int y = 0; y <= height; y++) {
          int id;
          if (y > height - 4) {
            if (beach) id = SAND;
            else if (y == height) id = (alpine || biome == 3) ? SNOW : biome == 2 ? SAND : GRASS;
            else id = alpine ? STONE : DIRT;
          } else {
            id = STONE;
          }
          data[index(x, y, z)] = (byte) id;
        }
        groundTop[x][z] = (byte) height;
        if (height < SEA_LEVEL) {
          for (int y = height + 1; y <= SEA_LEVEL; y++) data[index(x, y, z)] = (byte) WATER;
          waterTop[x][z] = (byte) SEA_LEVEL;
        }
      }
    }
    // Caves, sampled on a 2x2 lattice.
    for (int z = 2; z < WORLD_Z - 2; z += 2) {
      for (int x = 2; x < WORLD_X - 2; x += 2) {
        int height = surfaceHeight(x, z);
        for (int y = 2; y < Math.max(3, height - 2); y += 2) {
          if (noise.value3(x * 0.055, y * 0.085, z * 0.055) > 0.72) {
            for (int dy = 0; dy < 2; dy++)
              for (int dz = 0; dz < 2; dz++)
                for (int dx = 0; dx < 2; dx++)
                  if (inside(x + dx, y + dy, z + dz)) data[index(x + dx, y + dy, z + dz)] = (byte) AIR;
          }
        }
      }
    }
    for (int z = 0; z < WORLD_Z; z++) {
      for (int x = 0; x < WORLD_X; x++) plantTree(x, z);
    }
  }

  private void plantTree(int x, int z) {
    int height = surfaceHeight(x, z);
    if (height <= SEA_LEVEL + 1) return;
    if (x < 3 || z < 3 || x > WORLD_X - 4 || z > WORLD_Z - 4) return;
    int biome = biomeAt(x, z);
    if (biome == 2) return;
    double density = biome == 1 ? 0.055 : biome == 3 ? 0.02 : 0.012;
    if (Noise.hashCoords(x, 7, z, seed) > density) return;
    int trunk = (biome == 3 ? 5 : 4) + (int) (Noise.hashCoords(x, 11, z, seed) * 3);
    int crown = height + trunk;
    for (int i = 1; i <= trunk; i++) placeCube(x, height + i, z, LOG);
    for (int dy = -2; dy < 2; dy++) {
      double spread = dy <= -1 ? 2 : 2 - (dy + 2) * 0.6;
      for (int dz = -2; dz <= 2; dz++) {
        for (int dx = -2; dx <= 2; dx++) {
          if (Math.hypot(dx, dz) + Math.abs(dy) * 0.35 > spread + 0.45) continue;
          if (dx == 0 && dz == 0 && dy < 1) continue;
          int px = x + dx, py = crown + dy, pz = z + dz;
          if (inside(px, py, pz) && (data[index(px, py, pz)] & 255) == AIR) {
            data[index(px, py, pz)] = (byte) LEAVES;
            if (py > groundTop[px][pz]) groundTop[px][pz] = (byte) py;
          }
        }
      }
    }
  }

  /** Placement at generation time: grid plus the render index. */
  public void placeCube(int x, int y, int z, int id) {
    if (!inside(x, y, z)) return;
    if ((data[index(x, y, z)] & 255) != AIR) return;
    data[index(x, y, z)] = (byte) id;
    int column = x * WORLD_Z + z;
    List<int[]> stack = objects.get(column);
    if (stack == null) {
      stack = new ArrayList<>();
      objects.put(column, stack);
    }
    stack.add(new int[] {y, id});
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
  public double[] spawnPoint() {
    for (int attempt = 0; attempt < 400; attempt++) {
      double angle = attempt * 0.7;
      double radius = 5 + attempt * 0.3;
      int x = (int) (WORLD_X / 2 + Math.cos(angle) * radius);
      int z = (int) (WORLD_Z / 2 + Math.sin(angle) * radius);
      if (x < 2 || z < 2 || x > WORLD_X - 3 || z > WORLD_Z - 3) continue;
      int height = surfaceHeight(x, z);
      if (height <= SEA_LEVEL + 2) continue;
      if (get(x, height, z) == AIR) continue;
      if (get(x, height + 1, z) != AIR || get(x, height + 2, z) != AIR) continue;
      return new double[] {x + 0.5, height + 1, z + 0.5};
    }
    return new double[] {WORLD_X / 2.0 + 0.5, SEA_LEVEL + 6, WORLD_Z / 2.0 + 0.5};
  }

  // ------------------------------------------------------------------ save helpers

  public void writeEdits(Writer writer) throws IOException {
    for (Map.Entry<Integer, Integer> entry : edits.entrySet()) {
      writer.write(entry.getKey() + " " + entry.getValue() + "\n");
    }
  }

  public void readEdits(BufferedReader reader) throws IOException {
    String line;
    while ((line = reader.readLine()) != null) {
      line = line.trim();
      if (line.isEmpty()) continue;
      int space = line.indexOf(' ');
      if (space < 0) continue;
      int blockKey = Integer.parseInt(line.substring(0, space));
      int id = Integer.parseInt(line.substring(space + 1));
      int[] xyz = unkey(blockKey);
      if (inside(xyz[0], xyz[1], xyz[2])) data[index(xyz[0], xyz[1], xyz[2])] = (byte) id;
      edits.put(blockKey, id);
    }
    // Only the columns the edits touched can have changed, so refresh just those.
    List<Integer> columns = new ArrayList<>();
    for (int blockKey : edits.keySet()) {
      int[] xyz = unkey(blockKey);
      int column = xyz[0] * WORLD_Z + xyz[2];
      if (!columns.contains(column)) columns.add(column);
    }
    for (int column : columns) refreshColumn(column / WORLD_Z, column % WORLD_Z);
    version++;
  }
}
