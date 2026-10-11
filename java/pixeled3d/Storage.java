package pixeled3d;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * Saving — worlds live in {@code ~/.pixeled/world-java.txt}.
 *
 * <p>Only the seed, what the player changed and where they were standing are stored: everything
 * else is regenerated from the seed, so a save file stays tiny no matter how far you walk. The
 * format is a handful of plain text lines on purpose: it is easy to read, easy to edit and needs no
 * JSON library.
 *
 * <pre>
 * seed 20261011
 * time 0.32
 * player 1.50 40.00 -3.25 1.200 0.100
 * placed 7
 * minutes 3.5
 * edit 1 40 2 13
 * </pre>
 */
public final class Storage {

    private Storage() {}

    /** The loaded world, or null when there is nothing to continue. */
    public static final class Save {
        public int seed;
        public double time = 0.32;
        public double[] player;
        public int blocksPlaced;
        public double minutes;
        public final List<int[]> edits = new ArrayList<>();
    }

    public static Path directory() {
        String property = System.getProperty("pixeled.home");
        if (property != null && !property.isEmpty()) return Paths.get(property);
        String override = System.getenv("PIXELED_HOME");
        if (override != null && !override.isEmpty()) return Paths.get(override);
        return Paths.get(System.getProperty("user.home"), ".pixeled");
    }

    public static Path worldFile() {
        return directory().resolve("world-java.txt");
    }

    public static boolean hasWorld() {
        return Files.exists(worldFile());
    }

    public static boolean save(World world, Player player, int blocksPlaced, double minutes, double timeOfDay) {
        StringBuilder text = new StringBuilder();
        text.append("seed ").append(world.seed).append('\n');
        text.append("time ").append(round(timeOfDay, 4)).append('\n');
        double[] state = player.serialize();
        text.append("player ");
        for (int i = 0; i < state.length; i++) {
            if (i > 0) text.append(' ');
            text.append(round(state[i], 3));
        }
        text.append('\n');
        text.append("placed ").append(blocksPlaced).append('\n');
        text.append("minutes ").append(round(minutes, 1)).append('\n');
        int written = 0;
        for (java.util.Map.Entry<Long, int[]> entry : world.edits.entrySet()) {
            long key = entry.getKey();
            int x = (int) (key >> 32);
            int z = (int) key;
            text.append("edit ").append(x).append(' ').append(entry.getValue()[0]).append(' ')
                .append(z).append(' ').append(entry.getValue()[1]).append('\n');
            if (++written >= 60000) break;
        }
        try {
            Files.createDirectories(directory());
            Files.write(worldFile(), text.toString().getBytes(StandardCharsets.UTF_8));
            return true;
        } catch (IOException error) {
            return false;
        }
    }

    public static Save load() {
        if (!hasWorld()) return null;
        Save save = new Save();
        boolean sawSeed = false;
        try {
            for (String line : Files.readAllLines(worldFile(), StandardCharsets.UTF_8)) {
                String[] parts = line.trim().split("\\s+");
                if (parts.length == 0 || parts[0].isEmpty()) continue;
                try {
                    switch (parts[0]) {
                        case "seed":
                            save.seed = (int) Long.parseLong(parts[1]);
                            sawSeed = true;
                            break;
                        case "time":
                            save.time = Double.parseDouble(parts[1]);
                            break;
                        case "player":
                            save.player = new double[]{
                                Double.parseDouble(parts[1]), Double.parseDouble(parts[2]),
                                Double.parseDouble(parts[3]), Double.parseDouble(parts[4]),
                                Double.parseDouble(parts[5]),
                            };
                            break;
                        case "placed":
                            save.blocksPlaced = Integer.parseInt(parts[1]);
                            break;
                        case "minutes":
                            save.minutes = Double.parseDouble(parts[1]);
                            break;
                        case "edit":
                            save.edits.add(new int[]{
                                Integer.parseInt(parts[1]), Integer.parseInt(parts[2]),
                                Integer.parseInt(parts[3]), Integer.parseInt(parts[4]),
                            });
                            break;
                        default:
                            break;
                    }
                } catch (NumberFormatException | ArrayIndexOutOfBoundsException brokenLine) {
                    // A damaged line never stops the world from loading.
                }
            }
        } catch (IOException error) {
            return null;
        }
        return sawSeed ? save : null;
    }

    public static void clear() {
        try {
            Files.deleteIfExists(worldFile());
        } catch (IOException ignored) {
            // Nothing to do: the next save simply overwrites it.
        }
    }

    private static double round(double value, int places) {
        double factor = Math.pow(10, places);
        return Math.round(value * factor) / factor;
    }
}
