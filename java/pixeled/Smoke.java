package pixeled;

import java.io.File;

import static pixeled.Blocks.AIR;
import static pixeled.Blocks.GRASS;
import static pixeled.Blocks.HOTBAR;
import static pixeled.Blocks.LEAVES;
import static pixeled.Blocks.LOG;
import static pixeled.Blocks.SEA_LEVEL;
import static pixeled.Blocks.SNOW;
import static pixeled.Blocks.STONE;
import static pixeled.Blocks.WORLD_X;
import static pixeled.Blocks.WORLD_Y;
import static pixeled.Blocks.WORLD_Z;

/**
 * Headless smoke test for the Java edition — the same contracts the web and Python tests check.
 *
 *     javac -d out java/pixeled/*.java && java -Djava.awt.headless=true -cp out pixeled.Smoke
 */
public final class Smoke {

  private static int checks;
  private static int failures;

  private static void check(boolean condition, String message) {
    checks++;
    if (!condition) {
      failures++;
      System.out.println("  FAIL: " + message);
    }
  }

  private static void near(double actual, double expected, double tolerance, String message) {
    check(Math.abs(actual - expected) <= tolerance,
        message + " (expected " + expected + ", got " + actual + ")");
  }

  private static int[] skyline(World world) {
    int[] profile = new int[48];
    for (int index = 0; index < profile.length; index++) profile[index] = world.surfaceHeight(index * 2 + 4, 30);
    return profile;
  }

  private static String describe(int[] profile) {
    StringBuilder builder = new StringBuilder();
    for (int value : profile) builder.append(value).append(',');
    return builder.toString();
  }

  public static void main(String[] args) {
    System.out.println("java smoke test - " + System.getProperty("java.version"));
    noise();
    worlds();
    rays();
    players();
    rendering();
    game();
    // A tiny sandbox for the save-file checks so the real ~/.pixeled is never touched.
    File home = new File(System.getProperty("java.io.tmpdir"), "pixeled-smoke-" + System.nanoTime());
    if (!home.mkdirs()) {
      check(false, "could not create the temporary home directory");
    }
    String previousHome = System.getProperty("user.home");
    System.setProperty("user.home", home.getPath());
    saving();
    System.setProperty("user.home", previousHome);
    delete(home);

    if (failures == 0) {
      System.out.println("java smoke test passed — " + checks + " checks");
    } else {
      System.out.println("java smoke test FAILED — " + failures + " of " + checks + " checks");
      System.exit(1);
    }
  }

  private static void delete(File file) {
    File[] children = file.listFiles();
    if (children != null) {
      for (File child : children) delete(child);
    }
    file.delete();
  }

  // ------------------------------------------------------------------ checks

  private static void noise() {
    Noise noise = new Noise(2408);
    near(noise.fbm2(0.5, 0.5, 5), 0.482606, 1e-6, "fbm2 matches the shared noise contract");
    near(noise.value3(1.5, 2.5, 3.5), 0.446569, 1e-6, "value3 matches the shared noise contract");
    near(Noise.hashCoords(3, 4, 5, 2408), 0.028467, 1e-6, "hashCoords matches");
    near(new Noise(1).fbm2(0.3, 0.7, 4) == new Noise(2).fbm2(0.3, 0.7, 4) ? 1 : 0, 0, 0.5,
        "different seeds give different noise");
  }

  private static void worlds() {
    World world = new World(2408);
    check(WORLD_X == 96 && WORLD_Y == 48 && WORLD_Z == 96, "world metrics match the other editions");
    int[] surface = world.surface(53, 48);
    check(surface[0] > SEA_LEVEL, "the middle of the map is dry land");
    check(Blocks.solid(surface[1]), "the surface block is solid");
    check(describe(skyline(new World(2408))).equals(describe(skyline(world))), "seeds are reproducible");
    check(!describe(skyline(new World(99))).equals(describe(skyline(world))), "different seeds differ");

    int water = 0, lowest = WORLD_Y, highest = 0, logs = 0, leaves = 0;
    for (int x = 0; x < WORLD_X; x++) {
      for (int z = 0; z < WORLD_Z; z++) {
        if (world.waterTop[x][z] >= 0) water++;
        int height = world.surfaceHeight(x, z);
        lowest = Math.min(lowest, height);
        highest = Math.max(highest, height);
      }
    }
    for (java.util.List<int[]> stack : world.objects.values()) {
      for (int[] cube : stack) {
        if (cube[1] == LOG) logs++;
        if (cube[1] == LEAVES) leaves++;
      }
    }
    check(water > 200, "the world has a sea (" + water + " water columns)");
    check(highest - lowest > 18, "terrain has relief (" + lowest + " to " + highest + ")");
    check(lowest >= 2 && highest <= WORLD_Y - 6, "heights stay inside the world");
    check(logs > 20 && leaves > 60, "there are plenty of trees (" + logs + " logs, " + leaves + " leaves)");

    double[] spawn = world.spawnPoint();
    int[] spawnSurface = world.surface((int) spawn[0], (int) spawn[2]);
    check(spawnSurface[2] == 0, "spawn is dry");
    near(spawn[1], spawnSurface[0] + 1, 0.001, "spawn stands on the surface");

    world.set(10, 40, 10, STONE);
    check(world.get(10, 40, 10) == STONE && world.edits.containsKey(World.key(10, 40, 10)), "edits are recorded");
    check(world.surface(10, 10)[0] == 40, "the surface follows edits");
    world.set(10, 40, 10, AIR);
    check(world.surface(10, 10)[0] < 40, "removing a block lowers the surface");
  }

  private static void rays() {
    World world = new World(2408);
    Raycast.Hit hit = Raycast.cast(world, 48.5, 44, 48.5, 0, -1, 0, 40, false);
    check(hit != null, "a downward ray hits the ground");
    if (hit != null) {
      check(hit.y == world.surface(48, 48)[0], "the hit is the surface block");
      check(hit.ny == 1, "the face normal points up");
      int[] cell = Raycast.placementCell(hit);
      check(cell[0] == 48 && cell[1] == hit.y + 1 && cell[2] == 48, "the placement cell is in front of the face");
    }
    check(Raycast.cast(world, 48.5, 44, 48.5, 0, 1, 0, 40, false) == null, "an upward ray leaves the world");
    check(Raycast.cast(world, 48.5, 46, 48.5, 1, 0, 0, 2, false) == null, "reach is limited");
  }

  private static void players() {
    World world = new World(2408);
    Player player = new Player(world);
    for (int frame = 0; frame < 90; frame++) player.update(1 / 60.0, 0, 0, false, false, false, world);
    check(player.onGround, "the player lands");
    check(!player.collides(world), "the player is not stuck in a block");
    near(player.y, world.surface((int) player.x, (int) player.z)[0] + 1, 0.02, "the player stands on the surface");
    double height = player.y;
    player.update(1 / 60.0, 0, 0, true, false, false, world);
    for (int frame = 0; frame < 120; frame++) player.update(1 / 60.0, 0, 0, false, false, false, world);
    check(Math.abs(player.y - height) < 0.05, "jumping lands back on the ground");

    // A single-block ledge with a carved track: the walker must step up cleanly.
    World course = new World(7);
    for (int x = 6; x <= 16; x++) {
      for (int z = 8; z <= 14; z++) {
        for (int y = 40; y <= 44; y++) course.set(x, y, z, AIR);
        course.set(x, 39, z, STONE);
      }
    }
    for (int z = 8; z <= 14; z++) {
      course.set(12, 40, z, STONE);
      for (int y = 41; y <= 44; y++) course.set(12, y, z, AIR);
    }
    Player walker = new Player(course);
    walker.x = 9.5;
    walker.y = 40.02;
    walker.z = 11.5;
    walker.yaw = -Math.PI / 2;
    walker.pitch = 0;
    double highest = walker.y;
    boolean embedded = false;
    for (int frame = 0; frame < 240; frame++) {
      walker.update(1 / 60.0, 1, 0, false, false, true, course);
      highest = Math.max(highest, walker.y);
      if (walker.collides(course)) embedded = true;
    }
    check(!embedded, "the walker never ends up inside a block");
    check(highest > 40.9, "the walker steps up onto the ledge");
    check(walker.x > 12.5, "and carries on past it");
    check(walker.onGround, "and is back on the ground");

    Player flyer = new Player(world);
    flyer.flying = true;
    flyer.y += 6;
    double altitude = flyer.y;
    for (int frame = 0; frame < 60; frame++) flyer.update(1 / 60.0, 0, 0, false, false, false, world);
    near(flyer.y, altitude, 1e-4, "flight holds altitude");
  }

  private static void rendering() {
    Renderer renderer = new Renderer(160, 90);
    Game game = new Game(renderer, 2408);
    game.saveEnabled = false;
    for (int frame = 0; frame < 4; frame++) game.update(1 / 30.0, 1, 0, false, false, false);
    game.draw();
    java.util.Set<Integer> colours = new java.util.HashSet<>();
    for (int pixel : renderer.pixels) colours.add(pixel);
    // A 160x90 frame of shaded terrain runs to a few hundred distinct colours (the Python suite
    // checks the same thing on a bigger frame); a flat renderer would produce a handful.
    check(colours.size() > 150, "frames are shaded, not flat (" + colours.size() + " colours)");
    check(renderer.lastSamples > 1000, "the terrain sweep painted terrain");

    double[] noon = Renderer.skyPalette(0.5), midnight = Renderer.skyPalette(0.0);
    check(noon[6] > midnight[6], "the sun climbs through the day");
    check(noon[4] > midnight[4], "and its height does too");
  }

  private static void game() {
    Renderer renderer = new Renderer(96, 54);
    Game game = new Game(renderer, 2408);
    game.saveEnabled = false;
    game.player.pitch = -1.5;
    game.player.y += 2;
    Raycast.Hit hit = game.mine();
    check(hit != null, "looking down mines the block below");
    if (hit != null) check(game.world.get(hit.x, hit.y, hit.z) == AIR, "the mined block is gone");
    int[] cell = game.place(GRASS);
    check(cell != null && game.world.get(cell[0], cell[1], cell[2]) == GRASS, "placing puts a block back");

    World world = game.world;
    for (int y = 1; y < 8; y++) world.set(20, y, 20, AIR);
    game.player.x = 20.5;
    game.player.y = 4.6;
    game.player.z = 20.5;
    game.player.pitch = -1.5;
    Raycast.Hit aimed = game.target();
    check(aimed != null && aimed.y == 0, "the shaft aims at the bottom layer");
    check(game.mine() == null, "the bottom layer cannot be mined");
    check(world.get(20, 0, 20) == STONE, "bedrock is still there");

    game.select(HOTBAR.length - 1);
    check(game.selected == HOTBAR.length - 1, "the hotbar takes a direct selection");
    game.wheel(1);
    check(game.selected == 0, "the wheel wraps around");
    game.wheel(-1);
    check(game.selected == HOTBAR.length - 1, "and wraps back");

    int firstSeed = game.world.seed;
    game.newWorld(null);
    check(game.world.seed != firstSeed, "a new world gets a random seed");
    check(!describe(skyline(game.world)).equals(describe(skyline(new World(firstSeed)))), "and a new landscape");

    double startX = game.player.x, startZ = game.player.z;
    for (int frame = 0; frame < 30; frame++) game.update(1 / 30.0, 1, 0, false, false, false);
    double walked = Math.abs(game.player.x - startX) + Math.abs(game.player.z - startZ);
    check(walked > 0.4, "walking moves the player (moved " + String.format("%.2f", walked)
        + " from " + startX + "," + startZ + " to " + game.player.x + "," + game.player.z
        + " at y=" + game.player.y + " onGround=" + game.player.onGround + ")");
    check(!game.player.collides(game.world), "and never embeds the player");
  }

  private static void saving() {
    Renderer renderer = new Renderer(96, 54);
    Game game = new Game(renderer, 2408);
    game.player.x += 3.5;
    game.clock = 0.61;
    game.world.set(30, 40, 30, SNOW);
    game.save();

    Game reloaded = new Game(renderer, null);
    check(reloaded.world.seed == 2408, "the save keeps the seed");
    check(reloaded.world.get(30, 40, 30) == SNOW, "the save keeps the edits");
    near(reloaded.player.x, game.player.x, 1e-4, "the save keeps the player position");
    near(reloaded.clock, 0.61, 1e-4, "the save keeps the time of day");

    Storage.clear();
    check(Storage.load() == null, "clearing forgets the world");
    check(Storage.randomSeed() > 0, "new seeds are positive");
  }

  private Smoke() {
  }
}
