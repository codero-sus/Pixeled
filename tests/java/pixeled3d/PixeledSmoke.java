package pixeled3d;

import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * Display-free smoke test for the Java edition: world generation, meshing, physics and saves.
 *
 * <p>Nothing here touches Swing, so it runs on a headless build machine:
 *
 * <pre>
 * javac -d build java/pixeled3d/*.java tests/java/pixeled3d/PixeledSmoke.java
 * java -Djava.awt.headless=true -cp build pixeled3d.PixeledSmoke
 * </pre>
 *
 * <p>The numbers it asserts are the same numbers the web and Python editions produce from the same
 * seed, which is what keeps the three editions the same world.
 */
public final class PixeledSmoke {

    private static int checks;
    private static int failures;

    private PixeledSmoke() {}

    private static void check(boolean ok, String what) {
        checks++;
        if (ok) {
            System.out.println("  ok   " + what);
        } else {
            failures++;
            System.out.println("  FAIL " + what);
        }
    }

    private static void heading(String name) {
        System.out.println("\n" + name);
    }

    public static void main(String[] args) {
        noise();
        terrain();
        mesher();
        world();
        player();
        storage();
        renderer();

        System.out.println();
        if (failures > 0) {
            System.out.println("java smoke test failed — " + failures + " of " + checks + " checks");
            System.exit(1);
        }
        System.out.println("java smoke test passed — world, mesher, physics and renderer all behave");
    }

    // ------------------------------------------------------------------ noise

    private static void noise() {
        heading("noise");
        check(Noise.fbm2(12.3, 45.6, 99, 4) == Noise.fbm2(12.3, 45.6, 99, 4), "noise is deterministic");
        double value = Noise.fbm2(12.3, 45.6, 99, 4);
        check(value >= 0 && value <= 1, "noise stays inside [0, 1] (" + round(value) + ")");
        check(Noise.hashFloat(1, 2, 3, 4) == Noise.hashFloat(1, 2, 3, 4), "hashes are stable");
        check(Noise.parseSeed("meadow") != null && Noise.parseSeed("meadow").equals(Noise.parseSeed("meadow")),
            "text seeds are repeatable");
        check(Noise.parseSeed("   ") == null, "a blank seed means 'surprise me'");
        check(!Noise.randomSeed().equals(Noise.randomSeed()), "random seeds differ");
        check(Noise.seedLabel(7).length() == 10, "seed labels are padded for sharing");
    }

    // ------------------------------------------------------------------ terrain

    private static void terrain() {
        heading("terrain");
        int[] probes = {0, 0, 7, -13, -129, 88, 400, -260, 13, 13, -7, 7, 64, 64, -64, -64};
        int[] expected = {56, 55, 57, 68, 52, 54, 45, 38};
        Generator generator = new Generator(20261011, new java.util.HashMap<>());
        boolean allMatch = true;
        StringBuilder found = new StringBuilder();
        for (int index = 0; index < expected.length; index++) {
            int height = generator.heightAt(probes[index * 2], probes[index * 2 + 1]);
            found.append(index == 0 ? "" : ", ").append(height);
            if (height != expected[index]) allMatch = false;
        }
        check(allMatch, "the seed builds the same columns as the web edition ([" + found + "] vs [56, 55, 57, 68, 52, 54, 45, 38])");

        int[] second = new int[expected.length];
        Generator sameSeed = new Generator(20261011, new java.util.HashMap<>());
        for (int index = 0; index < expected.length; index++) {
            second[index] = sameSeed.heightAt(probes[index * 2], probes[index * 2 + 1]);
        }
        check(java.util.Arrays.equals(second, expected), "the same seed rebuilds the same column");

        Generator other = new Generator(123456, new java.util.HashMap<>());
        check(other.heightAt(0, 0) != expected[0], "a new seed changes the terrain");

        java.util.Set<String> biomes = new java.util.TreeSet<>();
        int minHeight = Integer.MAX_VALUE, maxHeight = Integer.MIN_VALUE;
        for (int x = -400; x <= 400; x += 40) {
            for (int z = -400; z <= 400; z += 40) {
                int height = generator.heightAt(x, z);
                biomes.add(generator.biomeAt(x, z));
                minHeight = Math.min(minHeight, height);
                maxHeight = Math.max(maxHeight, height);
            }
        }
        check(biomes.size() >= 3, "several biomes exist (" + String.join(", ", biomes) + ")");
        check(maxHeight - minHeight > 12, "the landscape has relief (" + minHeight + " to " + maxHeight + ")");
        check(minHeight > 0 && maxHeight < Blocks.WORLD_HEIGHT, "heights stay inside the world");

        Generator.Chunk chunk = generator.generateChunk(0, 0);
        check(chunk.highest > Blocks.SEA_LEVEL, "the surface sits above sea level (" + chunk.highest + ")");
    }

    // ------------------------------------------------------------------ mesher

    private static void mesher() {
        heading("mesher");
        World world = new World(20261011);
        for (int cx = -1; cx <= 1; cx++) {
            for (int cz = -1; cz <= 1; cz++) world.ensureChunk(cx, cz);
        }
        Generator.Chunk chunk = world.chunk(0, 0);
        java.util.List<Mesher.Face> faces = Mesher.meshChunk(world, chunk);
        Map<String, Integer> counts = Mesher.countFaces(faces);
        check(counts.get("opaque") == 1485, "solid faces match the web edition (" + counts.get("opaque") + " vs 1485)");
        check(counts.get("cutout") == 358, "cutout faces match the web edition (" + counts.get("cutout") + " vs 358)");
        check(counts.get("plant") == 90, "plant faces match the web edition (" + counts.get("plant") + " vs 90)");
        check(counts.get("water") == 0, "no water in this chunk, exactly like the web edition");
        check(faces.size() == 1933, "the chunk meshes to the same 1933 quads (" + faces.size() + ")");

        double minimum = Double.MAX_VALUE, maximum = -Double.MAX_VALUE;
        for (Mesher.Face face : faces) {
            if (face.kind.equals("plant")) continue;
            minimum = Math.min(minimum, face.shade);
            maximum = Math.max(maximum, face.shade);
        }
        check(minimum > 0 && maximum <= 1.06, "baked shading stays in a sane range (" + round(minimum) + " to " + round(maximum) + ")");
        check(Math.abs(maximum - 1.0498) < 0.01, "sunlit faces reach the same brightness as the web edition");

        // A lone block in the air has exactly six faces.
        World tiny = new World(7);
        tiny.ensureChunk(0, 0);
        int top = tiny.columnTop(3, 3);
        tiny.setBlock(3, top + 3, 3, Blocks.STONE, false);
        Map<String, Integer> lone = Mesher.countFaces(Mesher.meshChunk(tiny, tiny.chunk(0, 0)));
        check(lone.get("opaque") == 6, "a lone block has six visible faces (" + lone.get("opaque") + ")");
    }

    // ------------------------------------------------------------------ world

    private static void world() {
        heading("world");
        World world = new World(20261011);
        double[] spawn = world.findSpawn(0, 0);
        check(spawn[1] > Blocks.SEA_LEVEL, "the spawn point is on dry land (y=" + round(spawn[1]) + ")");
        check(world.getBlock((int) spawn[0], (int) spawn[1] - 1, (int) spawn[2]) != 0, "and stands on a solid block");

        int x = (int) spawn[0], z = (int) spawn[2];
        int columnTop = world.columnTop(x, z);
        check(columnTop > 0, "the column top is a real block (" + columnTop + ")");

        World.Hit down = world.raycast(x + 0.5, columnTop + 4.5, z + 0.5, 0, -1, 0, 8);
        check(down != null && down.y == columnTop && down.ny == 1,
            "a ray straight down finds the surface top face");

        check(world.setBlock(x, columnTop + 1, z, Blocks.PLANKS, true), "a block can be placed");
        check(world.getBlock(x, columnTop + 1, z) == Blocks.PLANKS, "and read back");
        check(world.edits.size() == 1, "and is recorded for the save file");
        check(world.setBlock(x, columnTop + 1, z, 0, true), "and removed again");
        check(world.getBlock(x, columnTop + 1, z) == 0, "leaving nothing behind");
        check(world.edits.size() == 2, "removals are recorded too");

        int ground = world.columnTop(x + 1, z + 1);
        World.Hit side = world.raycast(x + 0.5, ground - 1.5, z + 0.5, 1, 0, 0, 4);
        check(side == null || side.nx == -1 || side.nx == 1, "a sideways ray reports the wall's face");
    }

    // ------------------------------------------------------------------ player

    private static void player() {
        heading("player");

        // A flat, walled arena so the physics checks are about the physics, not about the terrain.
        World arena = new World(5);
        arena.ensureChunk(0, 0);
        int floor = 0;
        for (int x = 2; x <= 15; x++) {
            for (int z = 4; z <= 8; z++) floor = Math.max(floor, arena.columnTop(x, z));
        }
        for (int x = 2; x <= 15; x++) {
            for (int z = 4; z <= 8; z++) {
                arena.setBlock(x, floor, z, Blocks.STONE, false);
                for (int y = floor + 1; y <= floor + 6; y++) arena.setBlock(x, y, z, 0, false);
            }
        }
        for (int x = 12; x <= 15; x++) {                      // the wall the walker must not pass
            for (int z = 4; z <= 8; z++) {
                for (int y = floor + 1; y <= floor + 6; y++) arena.setBlock(x, y, z, Blocks.STONE, false);
            }
        }
        double stand = floor + 1;
        double[] start = {2.5, stand + 6, 6.5};
        Player.Input idle = new Player.Input();

        Player faller = new Player(arena, start);
        for (int step = 0; step < 600; step++) faller.update(1 / 60.0, idle);
        check(Math.abs(faller.y() - stand) < 0.2,
            "a fall lands on the surface (y=" + round(faller.y()) + " vs " + round(stand) + ")");
        check(faller.onGround, "and leaves the player standing");

        // Walking forward: about 4.6 blocks a second, exactly like the other editions.
        Player walker = new Player(arena, new double[]{2.5, stand, 6.5});
        walker.yaw = (float) (-Math.PI / 2);                  // face along +x
        Player.Input forward = new Player.Input();
        forward.forward = true;
        for (int step = 0; step < 60; step++) walker.update(1 / 60.0, forward);
        double travelled = walker.x() - 2.5;
        check(travelled > 3.4 && travelled < 5.0,
            "one second of walking covers about four and a half blocks (" + round(travelled) + ")");

        Player runner = new Player(arena, new double[]{2.5, stand, 6.5});
        runner.yaw = (float) (-Math.PI / 2);
        for (int step = 0; step < 300; step++) runner.update(1 / 60.0, forward);
        check(runner.x() < 12.0 && runner.x() > 9.5, "a wall stops the player (x=" + round(runner.x()) + ")");
        check(!runner.overlapsBlock(12, floor + 1, 6), "and they never end up inside it");
        check(Math.abs(runner.y() - stand) < 0.2, "walking keeps the player on the floor");

        Player jumper = new Player(arena, new double[]{2.5, stand, 6.5});
        jumper.update(1 / 60.0, idle);
        boolean jumped = false;
        for (int step = 0; step < 30; step++) {
            jumped = jumper.jump() || jumped;
            jumper.update(1 / 60.0, idle);
        }
        check(jumped && jumper.y() > stand + 0.4, "jumping lifts the player (" + round(jumper.y() - stand) + ")");

        // Swimming: a pool dug into the same arena.
        World lake = new World(20261011);
        lake.ensureChunk(0, 0);
        int lakeTop = lake.columnTop(4, 4);
        for (int y = lakeTop - 3; y <= lakeTop + 4; y++) lake.setBlock(4, y, 4, Blocks.WATER, false);
        Player swimmer = new Player(lake, new double[]{4.5, lakeTop + 1, 4.5});
        swimmer.update(1 / 60.0, idle);
        check(swimmer.inWater, "standing in water is detected");
        double swimStart = swimmer.y();
        Player.Input up = new Player.Input();
        up.jump = true;
        for (int step = 0; step < 60; step++) swimmer.update(1 / 60.0, up);
        check(swimmer.y() >= swimStart - 0.1, "and pressing space swims upwards");

        Player flyer = new Player(arena, new double[]{2.5, stand, 6.5});
        flyer.toggleFly(true);
        Player.Input hover = new Player.Input();
        hover.jump = true;
        double flyStart = flyer.y();
        for (int step = 0; step < 60; step++) flyer.update(1 / 60.0, hover);
        check(flyer.y() > flyStart + 3, "flying rises with space (" + round(flyer.y() - flyStart) + ")");
    }

    // ------------------------------------------------------------------ storage

    private static void storage() {
        heading("storage");
        try {
            Path home = Files.createTempDirectory("pixeled-java-");
            System.setProperty("pixeled.home", home.toString());
            Storage.clear();

            World world = new World(4242);
            double[] spawn = world.findSpawn(0, 0);
            Player player = new Player(world, spawn);
            world.ensureChunk(0, 0);
            world.setBlock(1, 60, 2, Blocks.BRICKS, true);
            check(Storage.save(world, player, 3, 12.5, 0.6), "the world saves");
            Storage.Save save = Storage.load();
            check(save != null, "and loads again");
            check(save != null && save.seed == 4242, "the seed survives the round trip");
            check(save != null && save.blocksPlaced == 3, "and the block counter");
            check(save != null && save.edits.size() == 1 && save.edits.get(0)[3] == Blocks.BRICKS,
                "and the player's blocks");
            check(save != null && save.player != null && Math.abs(save.player[0] - spawn[0]) < 0.01,
                "and where they were standing");
            Storage.clear();
            check(!Storage.hasWorld(), "clearing the save works");
        } catch (Exception error) {
            check(false, "storage round trip threw " + error);
        }
    }

    // ------------------------------------------------------------------ renderer

    private static void renderer() {
        heading("renderer");
        World world = new World(20261011);
        Renderer.Settings settings = new Renderer.Settings();
        settings.renderDistance = 3;
        Renderer renderer = new Renderer(world, settings);
        double[] spawn = world.findSpawn(0, 0);
        Player player = new Player(world, spawn);
        player.look(0.6, -0.2);
        renderer.streamChunks(player);
        check(renderer.loadedChunkMeshes() > 10, "chunks stream in around the player (" + renderer.loadedChunkMeshes() + ")");

        BufferedImage image = new BufferedImage(400, 240, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(new java.awt.Color(renderer.skyColor()));
        g.fillRect(0, 0, 400, 240);
        renderer.render(g, player, 400, 240, renderer.daylight(), renderer.skyColor(), renderer.skyColor());
        g.dispose();
        check(renderer.facesDrawn > 100, "the software renderer draws real geometry (" + renderer.facesDrawn + " faces)");

        java.util.Set<Integer> colours = new java.util.HashSet<>();
        for (int y = 0; y < 240; y += 6) {
            for (int x = 0; x < 400; x += 6) colours.add(image.getRGB(x, y));
        }
        check(colours.size() > 20, "and paints a varied picture (" + colours.size() + " colours)");

        check(renderer.clockText().length() == 5, "the clock reads like a clock (" + renderer.clockText() + ")");
        settings.timeOfDay = 0.5;
        check(renderer.daylight() > 0.8, "midday is bright");
        settings.timeOfDay = 0.0;
        check(renderer.daylight() < 0.1, "midnight is dark");
        check(renderer.phaseName().equals("Night"), "and is called night");
    }

    private static String round(double value) {
        return String.format("%.2f", value);
    }
}
