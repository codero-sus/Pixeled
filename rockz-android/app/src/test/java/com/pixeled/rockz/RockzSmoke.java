package com.pixeled.rockz;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Headless smoke test for the Rockz mobile edition.
 *
 * It exercises the parts of the game that must never depend on Android — the shared noise
 * contract, world generation, the ray caster, the player sweep and step-up, the renderer and the
 * save round-trip — so a broken build is caught without an emulator:
 *
 *     javac -d out app/src/main/java/com/pixeled/rockz/{Blocks,Noise,SaveStore,WorldModel,PlayerModel,Raycast,Renderer,TouchControls}.java \
 *           app/src/test/java/com/pixeled/rockz/{MemoryStore,RockzSmoke}.java
 *     java -cp out com.pixeled.rockz.RockzSmoke
 */
public final class RockzSmoke {

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

    private static String skyline(WorldModel world) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < 48; index++) builder.append(world.surfaceHeight(index * 2 + 4, 30)).append(',');
        return builder.toString();
    }

    public static void main(String[] args) {
        noise();
        worlds();
        rays();
        players();
        controls();
        rendering();
        saving();
        if (failures == 0) {
            System.out.println("rockz smoke test passed — " + checks + " checks");
        } else {
            System.out.println("rockz smoke test FAILED — " + failures + " of " + checks + " checks");
            System.exit(1);
        }
    }

    private static void noise() {
        Noise noise = new Noise(2408);
        near(noise.fbm2(0.5, 0.5, 5), 0.482606, 1e-6, "fbm2 matches the shared contract");
        near(noise.value3(1.5, 2.5, 3.5), 0.446569, 1e-6, "value3 matches the shared contract");
        near(Noise.hashCoords(3, 4, 5, 2408), 0.028467, 1e-6, "hashCoords matches");
    }

    private static void worlds() {
        MemoryStore store = new MemoryStore();
        WorldModel world = new WorldModel(store, 2408);
        check(Blocks.WORLD_X == 96 && Blocks.WORLD_Y == 48 && Blocks.WORLD_Z == 96, "world metrics match");
        int[] surface = world.surface(53, 48);
        check(surface[0] > Blocks.SEA_LEVEL && Blocks.solid(surface[1]), "the middle of the map is dry land");
        check(skyline(new WorldModel(store, 2408)).equals(skyline(world)), "seeds are reproducible");
        check(!skyline(new WorldModel(store, 99)).equals(skyline(world)), "different seeds differ");

        int water = 0, lowest = Blocks.WORLD_Y, highest = 0, logs = 0, leaves = 0;
        for (int x = 0; x < Blocks.WORLD_X; x++) {
            for (int z = 0; z < Blocks.WORLD_Z; z++) {
                if (world.waterTop[x][z] >= 0) water++;
                int height = world.surfaceHeight(x, z);
                lowest = Math.min(lowest, height);
                highest = Math.max(highest, height);
            }
        }
        for (List<int[]> stack : world.objects.values()) {
            for (int[] cube : stack) {
                if (cube[1] == Blocks.LOG) logs++;
                if (cube[1] == Blocks.LEAVES) leaves++;
            }
        }
        check(water > 200, "the world has a sea (" + water + " water columns)");
        check(highest - lowest > 18, "terrain has relief (" + lowest + " to " + highest + ")");
        check(logs > 20 && leaves > 60, "there are trees (" + logs + " logs, " + leaves + " leaves)");
        double[] spawn = world.spawnPoint();
        check(world.surface((int) spawn[0], (int) spawn[2])[2] == 0, "spawn is dry");

        world.set(10, 40, 10, Blocks.STONE);
        check(world.get(10, 40, 10) == Blocks.STONE, "edits stick");
        check(world.surface(10, 10)[0] == 40, "and move the surface");
        world.set(10, 40, 10, Blocks.AIR);
        check(world.surface(10, 10)[0] < 40, "and come back down");
    }

    private static void rays() {
        MemoryStore store = new MemoryStore();
        WorldModel world = new WorldModel(store, 2408);
        Raycast.Hit hit = Raycast.cast(world, 48.5, 44, 48.5, 0, -1, 0, 40, false);
        check(hit != null, "a downward ray hits the ground");
        if (hit != null) {
            check(hit.y == world.surface(48, 48)[0] && hit.ny == 1, "it hits the top face of the surface block");
            int[] cell = Raycast.placementCell(hit);
            check(cell[0] == 48 && cell[1] == hit.y + 1 && cell[2] == 48, "the placement cell is above the face");
        }
        check(Raycast.cast(world, 48.5, 44, 48.5, 0, 1, 0, 40, false) == null, "an upward ray leaves the world");
    }

    private static void players() {
        MemoryStore store = new MemoryStore();
        WorldModel world = new WorldModel(store, 2408);
        PlayerModel player = new PlayerModel(world);
        for (int frame = 0; frame < 90; frame++) {
            player.update(1 / 60.0, 0, 0, false, false, false, world);
        }
        check(player.onGround, "the player lands");
        check(!player.collides(world), "and is not stuck in a block");
        near(player.y, world.surface((int) player.x, (int) player.z)[0] + 1, 0.05, "standing on the surface");

        // The same carved track the desktop editions test: a one-block step at x = 12.
        WorldModel course = new WorldModel(store, 7);
        for (int x = 6; x <= 16; x++) {
            for (int z = 8; z <= 14; z++) {
                for (int y = 40; y <= 44; y++) course.set(x, y, z, Blocks.AIR);
                course.set(x, 39, z, Blocks.STONE);
            }
        }
        for (int z = 8; z <= 14; z++) {
            course.set(12, 40, z, Blocks.STONE);
            for (int y = 41; y <= 44; y++) course.set(12, y, z, Blocks.AIR);
        }
        PlayerModel walker = new PlayerModel(course);
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

        // Flight: JUMP climbs, DOWN descends, and letting go hovers.
        PlayerModel flyer = new PlayerModel(world);
        flyer.flying = true;
        double start = flyer.y;
        for (int frame = 0; frame < 30; frame++) {
            flyer.update(1 / 60.0, 0, 0, true, false, false, world);
        }
        check(flyer.y > start + 3, "holding JUMP climbs while flying");
        double peak = flyer.y;
        for (int frame = 0; frame < 30; frame++) {
            flyer.update(1 / 60.0, 0, 0, false, false, false, world);
        }
        near(flyer.y, peak, 0.01, "letting go hovers");
        for (int frame = 0; frame < 30; frame++) {
            flyer.update(1 / 60.0, 0, 0, false, true, false, world);
        }
        check(flyer.y < peak - 3, "holding DOWN descends while flying");
    }

    private static void controls() {
        TouchControls controls = new TouchControls();
        controls.layout(1080, 1920, 3);

        float[] mine = controls.anchor("mine");
        float[] place = controls.anchor("place");
        float[] jump = controls.anchor("jump");
        float[] fly = controls.anchor("fly");
        float[] down = controls.anchor("crouch");
        for (float[] anchor : new float[][]{mine, place, jump, fly, down}) {
            check(anchor != null, "every button has a place on screen");
        }
        check(Math.hypot(mine[0] - place[0], mine[1] - place[1]) > TouchControls.BUTTON_RADIUS * 2.3f * 3,
                "buttons do not overlap");
        check(mine[0] > 1080 / 2 && place[1] > 1920 / 2, "buttons sit in the bottom-right corner");
        check(down[1] < jump[1], "the descend control is above the jump button");

        check("mine".equals(hit(controls, mine)) && "place".equals(hit(controls, place))
                && "jump".equals(hit(controls, jump)) && "fly".equals(hit(controls, fly))
                && "crouch".equals(hit(controls, down)), "taps land on the button that was hit");
        controls.clear();

        // The stick owns the bottom-left, and buttons win over it wherever they are.
        controls.pointerDown(1, controls.joystickAnchorX(), controls.joystickAnchorY());
        check("move".equals(controls.actionOf(1)), "the bottom-left corner is the joystick");
        controls.drag(1, controls.joystickAnchorX() + TouchControls.JOYSTICK_RADIUS * 3,
                controls.joystickAnchorY());
        near(controls.moveX(), 1, 0.02, "pushing the stick right drives movement");
        check(controls.joystickStrength() > 0.9, "the stick reports how far it is pushed");
        controls.pointerUp(1);
        near(controls.moveX(), 0, 1e-6, "releasing the stick stops the player");
        controls.pointerDown(9, 500, 900);
        check("look".equals(controls.actionOf(9)), "empty space is the look area");
        controls.clear();

        // The status bar is the new-world button.
        controls.pointerDown(2, 120, 60);
        check(controls.isNewWorldTap(2), "the status bar taps as a new world");
        controls.clear();

        // Hotbar slots are picked by x, and the gaps between them miss.
        float[] strip = controls.anchor("hotbar");
        float stride = strip[2] + strip[3];
        check(controls.hotbarSlot(strip[0] + 4, strip[1] + strip[2] / 2) == 0, "the first slot");
        check(controls.hotbarSlot(strip[0] + stride * 3 + 4, strip[1] + strip[2] / 2) == 3, "the fourth slot");
        check(controls.hotbarSlot(strip[0] - 40, strip[1]) == -1, "outside the strip");
        check(controls.hotbarSlot(strip[0] + 4, strip[1] - 200) == -1, "above the strip");
    }

    private static String hit(TouchControls controls, float[] anchor) {
        int id = 77;
        controls.pointerDown(id, anchor[0], anchor[1]);
        String action = controls.actionOf(id);
        controls.pointerUp(id);
        return action;
    }

    private static void rendering() {
        MemoryStore store = new MemoryStore();
        WorldModel world = new WorldModel(store, 2408);
        PlayerModel player = new PlayerModel(world);
        Renderer renderer = new Renderer(160, 90);
        for (int frame = 0; frame < 4; frame++) {
            player.update(1 / 30.0, 1, 0, false, false, false, world);
        }
        int[] pixels = renderer.render(world, player, 0.35, false, 0, 0, 0, 0);
        check(pixels.length == 160 * 90, "the renderer fills the framebuffer");
        Set<Integer> colours = new HashSet<>();
        boolean opaque = true;
        for (int pixel : pixels) {
            colours.add(pixel);
            if ((pixel >>> 24) != 0xFF) opaque = false;
        }
        check(colours.size() > 150, "frames are shaded, not flat (" + colours.size() + " colours)");
        check(opaque, "every pixel is opaque ARGB");
        check(renderer.lastSamples > 1000, "the terrain sweep painted terrain");

        // Flying up and looking down must still find terrain.
        player.flying = true;
        player.y += 10;
        player.pitch = -1.2;
        renderer.render(world, player, 0.5, false, 0, 0, 0, 0);
        check(renderer.lastSamples > 1000, "and still paints when looking straight down");
    }

    private static void saving() {
        MemoryStore store = new MemoryStore();
        WorldModel world = WorldModel.open(store);
        check(store.getString("edits", null) != null, "opening a fresh world writes a save");
        int seed = world.seed;
        world.set(30, 40, 30, Blocks.SNOW);
        world.rememberPlayer(31.25, 42.5, 33.75, 1.5, -0.25, 0.61, 4);
        world.save();

        WorldModel reopened = WorldModel.open(store);
        check(reopened.seed == seed, "the save keeps the seed");
        check(reopened.get(30, 40, 30) == Blocks.SNOW, "the save keeps the edits");
        check(reopened.hasSavedPlayer, "the save keeps the player");
        near(reopened.savedPlayerX, 31.25, 1e-3, "player x");
        near(reopened.savedPlayerZ, 33.75, 1e-3, "player z");
        near(reopened.savedClock, 0.61, 1e-3, "the clock");
        check(reopened.savedSelected == 4, "the hotbar selection");

        PlayerModel player = new PlayerModel(reopened);
        near(player.x, 31.25, 1e-3, "the player spawns where the save left them");
        near(player.yaw, 1.5, 1e-3, "and looks the same way");

        reopened.forget();
        WorldModel rolled = WorldModel.open(store);
        check(rolled.seed != seed, "after a new world the seed changes");
        List<Integer> columns = new ArrayList<>();
        columns.add(rolled.surface(30, 30)[0]);
        check(!columns.isEmpty(), "the new world is generated");
    }

    private RockzSmoke() {
    }
}
