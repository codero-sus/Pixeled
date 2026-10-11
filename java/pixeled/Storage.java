package pixeled;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.Writer;
import java.util.Random;

/**
 * Save files for the Java edition: a small text document in ~/.pixeled/world.txt.
 *
 * The format is deliberately dead simple (one field per line, edits as "blockIndex id") so it can
 * be read by eye and by every edition without a JSON library.
 */
public final class Storage {

  public static File saveFile() {
    File directory = new File(System.getProperty("user.home"), ".pixeled");
    return new File(directory, "world.txt");
  }

  /** A fresh seed for a brand-new world. */
  public static int randomSeed() {
    return 1 + new Random().nextInt(Integer.MAX_VALUE - 1);
  }

  public static void save(World world, Player player, int selected, double clock) throws IOException {
    File file = saveFile();
    File parent = file.getParentFile();
    if (parent != null) parent.mkdirs();
    File temporary = new File(file.getPath() + ".tmp");
    try (Writer writer = new PrintWriter(new FileWriter(temporary))) {
      writer.write("pixeled 3\n");
      writer.write("seed " + world.seed + "\n");
      writer.write(String.format("player %.6f %.6f %.6f %.6f %.6f%n",
          player.x, player.y, player.z, player.yaw, player.pitch));
      writer.write("selected " + selected + "\n");
      writer.write(String.format("clock %.6f%n", clock));
      writer.write("edits " + world.edits.size() + "\n");
      world.writeEdits(writer);
    }
    if (file.exists() && !file.delete()) {
      throw new IOException("cannot replace " + file);
    }
    if (!temporary.renameTo(file)) {
      throw new IOException("cannot write " + file);
    }
  }

  /** Everything read back from a save file. */
  public static final class Saved {
    public int seed;
    public double[] player;
    public int selected;
    public double clock;
    public World world;

    public boolean complete() {
      return seed > 0 && player != null && player.length == 5 && world != null;
    }
  }

  /** Read the saved world, or null when there is nothing usable. */
  public static Saved load() {
    File file = saveFile();
    if (!file.isFile()) return null;
    Saved saved = new Saved();
    try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
      String header = reader.readLine();
      if (header == null || !header.trim().equals("pixeled 3")) return null;
      String line;
      while ((line = reader.readLine()) != null) {
        String trimmed = line.trim();
        if (trimmed.startsWith("seed ")) {
          saved.seed = Integer.parseInt(trimmed.substring(5).trim());
        } else if (trimmed.startsWith("player ")) {
          String[] parts = trimmed.substring(7).trim().split("\\s+");
          if (parts.length == 5) {
            saved.player = new double[5];
            for (int index = 0; index < 5; index++) saved.player[index] = Double.parseDouble(parts[index]);
          }
        } else if (trimmed.startsWith("selected ")) {
          saved.selected = Integer.parseInt(trimmed.substring(9).trim());
        } else if (trimmed.startsWith("clock ")) {
          saved.clock = Double.parseDouble(trimmed.substring(6).trim());
        } else if (trimmed.startsWith("edits ")) {
          saved.world = new World(saved.seed);
          saved.world.readEdits(reader);
          break;
        }
      }
    } catch (IOException | NumberFormatException error) {
      return null;
    }
    return saved.complete() ? saved : null;
  }

  public static void clear() {
    File file = saveFile();
    if (file.isFile()) file.delete();
  }

  private Storage() {
  }
}
