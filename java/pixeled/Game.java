package pixeled;

import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.IOException;

import static pixeled.Blocks.AIR;
import static pixeled.Blocks.HOTBAR;
import static pixeled.Blocks.WATER;

/**
 * Game state for the Java edition: the world, the player, the clock, editing rules and saving.
 * The Swing window (Pixeled.java) only feeds it input and shows the frame, so the whole game can
 * also be driven headlessly by Smoke.java.
 */
public final class Game {

  public static final double DAY_LENGTH = 480, CLOCK_START = 0.32, AUTOSAVE_EVERY = 25;

  public World world;
  public Player player;
  public final Renderer renderer;
  public final Hud hud = new Hud();
  public int selected;
  public double clock = CLOCK_START;
  public double fps;
  public int mined, placed, frames;
  public boolean saveEnabled = true;

  private double autosave = AUTOSAVE_EVERY;
  private long lastFrame = System.nanoTime();
  private long started = System.nanoTime();
  private double fpsWindow;
  private int fpsFrames;

  public Game(Renderer renderer, Integer seed) {
    this.renderer = renderer;
    loadOrNew(seed);
  }

  /** Continue the saved world, or make a fresh random one. */
  public void loadOrNew(Integer seed) {
    if (seed == null && saveEnabled) {
      Storage.Saved saved = Storage.load();
      if (saved != null) {
        world = saved.world;
        player = new Player(world);
        player.x = saved.player[0];
        player.y = saved.player[1];
        player.z = saved.player[2];
        player.yaw = saved.player[3];
        player.pitch = saved.player[4];
        selected = Math.floorMod(saved.selected, HOTBAR.length);
        clock = saved.clock;
        hud.notify("CONTINUING SEED " + world.seed);
        return;
      }
    }
    int chosen = seed != null ? seed : Storage.randomSeed();
    world = new World(chosen);
    player = new Player(world);
    clock = CLOCK_START;
    hud.notify("NEW WORLD SEED " + chosen);
  }

  /** Throw the old world away and generate a random one. */
  public void newWorld(Integer seed) {
    int chosen = seed != null ? seed : Storage.randomSeed();
    if (saveEnabled) Storage.clear();
    world = new World(chosen);
    player = new Player(world);
    selected = 0;
    clock = CLOCK_START;
    mined = placed = 0;
    hud.notify("NEW WORLD SEED " + chosen);
  }

  public void save() {
    if (!saveEnabled) return;
    try {
      Storage.save(world, player, selected, clock);
    } catch (IOException error) {
      hud.notify("SAVE FAILED");
    }
  }

  /** One frame of simulation; controls are the movement flags, dt seconds. */
  public void update(double dt, int forward, int right, boolean jump, boolean crouch, boolean sprint) {
    dt = Math.max(0.001, Math.min(0.1, dt));
    clock = (clock + dt / DAY_LENGTH) % 1.0;
    boolean fell = player.update(dt, forward, right, jump, crouch, sprint, world);
    if (fell) hud.notify("FELL OUT - BACK AT SPAWN");
    autosave -= dt;
    if (autosave <= 0) {
      autosave = AUTOSAVE_EVERY;
      save();
      hud.notify("AUTOSAVED");
    }
    hud.update(dt);
    frames++;
    fpsFrames++;
    long now = System.nanoTime();
    fpsWindow += (now - lastFrame) / 1e9;
    lastFrame = now;
    if (fpsWindow >= 0.5) {
      fps = fpsFrames / fpsWindow;
      fpsWindow = 0;
      fpsFrames = 0;
    }
  }

  public double elapsed() {
    return (System.nanoTime() - started) / 1e9;
  }

  // ------------------------------------------------------------------ actions

  public Raycast.Hit target() {
    double[] direction = player.direction();
    return Raycast.cast(world, player.x, player.eyeY(), player.z,
        direction[0], direction[1], direction[2], 6.5, false);
  }

  public Raycast.Hit mine() {
    Raycast.Hit hit = target();
    if (hit == null) return null;
    if (!player.reaches(hit.x, hit.y, hit.z)) return null;
    if (hit.y <= 0) {
      hud.notify("BEDROCK IS UNBREAKABLE");
      return null;
    }
    world.set(hit.x, hit.y, hit.z, AIR);
    mined++;
    return hit;
  }

  public int[] place() {
    return place(HOTBAR[selected]);
  }

  public int[] place(int blockId) {
    Raycast.Hit hit = target();
    if (hit == null) return null;
    int[] cell = Raycast.placementCell(hit);
    if (!world.inside(cell[0], cell[1], cell[2])) return null;
    if (player.overlaps(cell[0], cell[1], cell[2])) {
      hud.notify("THAT IS WHERE YOU STAND");
      return null;
    }
    int existing = world.get(cell[0], cell[1], cell[2]);
    if (existing != AIR && existing != WATER) return null;
    world.set(cell[0], cell[1], cell[2], blockId);
    placed++;
    return cell;
  }

  public Raycast.Hit pick() {
    Raycast.Hit hit = target();
    if (hit == null) return null;
    for (int index = 0; index < HOTBAR.length; index++) {
      if (HOTBAR[index] == hit.id) {
        selected = index;
        hud.notify("PICKED " + Blocks.name(hit.id).toUpperCase());
        return hit;
      }
    }
    hud.notify(Blocks.name(hit.id).toUpperCase() + " IS NOT PLACEABLE");
    return hit;
  }

  public void select(int index) {
    if (index >= 0 && index < HOTBAR.length) selected = index;
  }

  public void wheel(int direction) {
    selected = Math.floorMod(selected + (direction > 0 ? 1 : -1), HOTBAR.length);
  }

  public void toggleFly() {
    player.flying = !player.flying;
    player.velocityY = 0;
    hud.notify(player.flying ? "FLYING" : "WALKING");
  }

  public void skipTime(double hours) {
    clock = (clock + hours / 24.0) % 1.0;
    hud.notify(String.format("TIME %02d:00", (int) (clock * 24)));
  }

  /** Render the world and lay the HUD on top. */
  public BufferedImage draw() {
    Raycast.Hit hit = target();
    renderer.render(world, player, clock, hit != null,
        hit == null ? 0 : hit.x, hit == null ? 0 : hit.y, hit == null ? 0 : hit.z, elapsed());
    String note = hit == null ? null : Blocks.name(hit.id);
    if (note != null && note.equals("Air")) note = null;
    Graphics2D g = renderer.image.createGraphics();
    try {
      hud.draw(g, renderer.width, renderer.height, world, player, selected, fps, player.flying, note);
    } finally {
      g.dispose();
    }
    return renderer.image;
  }
}
