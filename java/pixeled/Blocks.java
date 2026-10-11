package pixeled;

/** The block palette and the world metrics every edition shares. */
public final class Blocks {

  public static final int WORLD_X = 96;
  public static final int WORLD_Y = 48;
  public static final int WORLD_Z = 96;
  public static final int SEA_LEVEL = 20;

  public static final int AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4,
      LOG = 5, LEAVES = 6, SNOW = 7, PLANKS = 8, GLASS = 9, WATER = 10;

  /** id -> {name, top colour, side colour, bottom colour, solid, transparent, placeable}. */
  public static final Object[][] BLOCKS = {
      {GRASS, "Grass", 0x79C05A, 0x8F7F4A, 0x8A5A3B, true, false, true},
      {DIRT, "Dirt", 0x96654A, 0x8A5A3B, 0x7D5136, true, false, true},
      {STONE, "Stone", 0xA6ADB3, 0x9AA0A6, 0x8D949A, true, false, true},
      {SAND, "Sand", 0xEFE3B0, 0xE6D7A0, 0xD8C68F, true, false, true},
      {LOG, "Log", 0xB08A52, 0x7F5A35, 0xB08A52, true, false, true},
      {LEAVES, "Leaves", 0x5FAE52, 0x4F9C47, 0x3F843C, true, false, true},
      {SNOW, "Snow", 0xFFFFFF, 0xEAF2F8, 0xD7E3EC, true, false, true},
      {PLANKS, "Planks", 0xC79357, 0xB9854B, 0xA9763F, true, false, true},
      {GLASS, "Glass", 0xDFF2F8, 0xCFE8F2, 0xCFE8F2, true, true, true},
      {WATER, "Water", 0x4B8FE0, 0x2F74D0, 0x245AA8, false, true, false},
  };

  public static final int[] HOTBAR = {GRASS, DIRT, STONE, SAND, LOG, LEAVES, SNOW, PLANKS, GLASS};
  public static final String[] BIOMES = {"plains", "forest", "desert", "snow"};

  private Blocks() {
  }

  private static Object[] entry(int id) {
    for (Object[] row : BLOCKS) {
      if (((Integer) row[0]) == id) return row;
    }
    return null;
  }

  public static String name(int id) {
    Object[] row = entry(id);
    return row == null ? "Air" : (String) row[1];
  }

  public static int colour(int id, int face) {
    Object[] row = entry(id);
    if (row == null) return 0;
    return (Integer) row[2 + Math.max(0, Math.min(2, face))];
  }

  public static int topColour(int id) {
    return colour(id, 0);
  }

  public static int sideColour(int id) {
    return colour(id, 1);
  }

  public static boolean solid(int id) {
    Object[] row = entry(id);
    return row != null && (Boolean) row[5];             // id, name, top, side, bottom, solid, ...
  }

  public static boolean transparent(int id) {
    Object[] row = entry(id);
    return row != null && (Boolean) row[6];
  }

  public static boolean placeable(int id) {
    Object[] row = entry(id);
    return row == null || (Boolean) row[7];
  }

  private static int red(int rgb) {
    return (rgb >> 16) & 255;
  }

  private static int green(int rgb) {
    return (rgb >> 8) & 255;
  }

  private static int blue(int rgb) {
    return rgb & 255;
  }

  public static int mix(int a, int b, double t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    int r = (int) (red(a) + (red(b) - red(a)) * t);
    int g = (int) (green(a) + (green(b) - green(a)) * t);
    int bl = (int) (blue(a) + (blue(b) - blue(a)) * t);
    return (clamp(r) << 16) | (clamp(g) << 8) | clamp(bl);
  }

  public static int scale(int rgb, double light) {
    return (clamp((int) (red(rgb) * light)) << 16)
        | (clamp((int) (green(rgb) * light)) << 8)
        | clamp((int) (blue(rgb) * light));
  }

  public static int clamp(int value) {
    return value < 0 ? 0 : value > 255 ? 255 : value;
  }
}
