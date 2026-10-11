package pixeled;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.util.ArrayList;
import java.util.List;

import static pixeled.Blocks.HOTBAR;
import static pixeled.Blocks.WORLD_X;
import static pixeled.Blocks.WORLD_Z;

/** The overlay drawn on top of the 3D frame: stats, hotbar, minimap, toasts and the help card. */
public final class Hud {

  private static final Color PANEL = new Color(18, 22, 30, 205);
  private static final Color PANEL_EDGE = new Color(150, 200, 255, 120);
  private static final Color TEXT = new Color(232, 238, 246);
  private static final Color ACCENT = new Color(120, 200, 255);

  private final List<String> messages = new ArrayList<>();
  private final List<Double> lives = new ArrayList<>();
  public boolean helpVisible;
  private final Font font;
  private final Font small;

  public Hud() {
    font = new Font(Font.MONOSPACED, Font.BOLD, 12);
    small = new Font(Font.MONOSPACED, Font.PLAIN, 11);
  }

  public void notify(String message) {
    messages.add(message);
    lives.add(3.4);
    while (messages.size() > 6) {
      messages.remove(0);
      lives.remove(0);
    }
  }

  public void update(double dt) {
    for (int index = lives.size() - 1; index >= 0; index--) {
      double remaining = lives.get(index) - dt;
      if (remaining <= 0) {
        lives.remove(index);
        messages.remove(index);
      } else {
        lives.set(index, remaining);
      }
    }
  }

  public void draw(Graphics2D g, int width, int height, World world, Player player,
                   int selected, double fps, boolean flying, String note) {
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_OFF);
    g.setFont(small);
    String stats = String.format("seed %d   x %.1f  y %.1f  z %.1f   %s   %.0f fps%s",
        world.seed, player.x, player.y, player.z, world.biomeName(player.x, player.z), fps,
        flying ? "   flying" : "");
    panel(g, 6, 6, g.getFontMetrics().stringWidth(stats) + 12, 18);
    g.setColor(TEXT);
    g.drawString(stats, 12, 19);

    minimap(g, width, world, player, 76);
    crosshair(g, width, height);
    hotbar(g, width, height, selected);
    toasts(g, width);
    if (note != null && !note.isEmpty()) {
      int noteWidth = g.getFontMetrics().stringWidth(note) + 12;
      panel(g, (width - noteWidth) / 2, height / 2 - 26, noteWidth, 18);
      g.setColor(TEXT);
      g.drawString(note, (width - noteWidth) / 2 + 6, height / 2 - 13);
    }
    if (helpVisible) help(g, width, height);
  }

  private void panel(Graphics2D g, int x, int y, int width, int height) {
    g.setColor(PANEL);
    g.fillRoundRect(x, y, width, height, 6, 6);
    g.setColor(PANEL_EDGE);
    g.drawRoundRect(x, y, width, height, 6, 6);
  }

  private void minimap(Graphics2D g, int width, World world, Player player, int size) {
    int left = width - size - 8, top = 8;
    double radius = 24;
    g.setColor(PANEL);
    g.fillRect(left - 2, top - 2, size + 4, size + 4);
    for (int row = 0; row < size; row++) {
      int worldZ = (int) (player.z - radius + row * (radius * 2 / size));
      if (worldZ < 0 || worldZ >= WORLD_Z) continue;
      for (int column = 0; column < size; column++) {
        int worldX = (int) (player.x - radius + column * (radius * 2 / size));
        if (worldX < 0 || worldX >= WORLD_X) continue;
        int[] surface = world.surface(worldX, worldZ);
        int colour;
        if (surface[0] < 0) colour = 0x101828;
        else if (surface[2] == 1) colour = 0x3C6EBE;
        else colour = Blocks.topColour(surface[1]);
        g.setColor(new Color(colour));
        g.fillRect(left + column, top + row, 1, 1);
      }
    }
    g.setColor(Color.WHITE);
    g.fillRect(left + size / 2 - 1, top + size / 2 - 3, 2, 2);
    g.fillRect(left + size / 2 - 3, top + size / 2 - 1, 2, 2);
    g.fillRect(left + size / 2 + 1, top + size / 2 - 1, 2, 2);
    g.fillRect(left + size / 2 - 1, top + size / 2 + 1, 2, 2);
  }

  private void crosshair(Graphics2D g, int width, int height) {
    g.setColor(new Color(255, 255, 255, 200));
    g.setStroke(new BasicStroke(1.4f));
    int cx = width / 2, cy = height / 2;
    g.drawLine(cx + 3, cy, cx + 8, cy);
    g.drawLine(cx - 3, cy, cx - 8, cy);
    g.drawLine(cx, cy + 3, cx, cy + 8);
    g.drawLine(cx, cy - 3, cx, cy - 8);
  }

  private void hotbar(Graphics2D g, int width, int height, int selected) {
    int slot = 30, gap = 4;
    int total = HOTBAR.length * slot + (HOTBAR.length - 1) * gap;
    int left = (width - total) / 2, top = height - slot - 10;
    g.setFont(font);
    for (int index = 0; index < HOTBAR.length; index++) {
      int x = left + index * (slot + gap);
      if (index == selected) {
        g.setColor(Color.WHITE);
        g.fillRoundRect(x - 2, top - 2, slot + 4, slot + 4, 6, 6);
      }
      g.setColor(PANEL);
      g.fillRoundRect(x, top, slot, slot, 4, 4);
      int colour = Blocks.topColour(HOTBAR[index]);
      g.setColor(new Color(colour));
      g.fillRect(x + 3, top + 3, slot - 6, slot - 6);
      g.setColor(new Color(0, 0, 0, 110));
      g.fillRect(x + 2, top + slot - 16, 16, 14);
      g.setColor(TEXT);
      g.drawString(String.valueOf(index + 1), x + 4, top + slot - 4);
    }
    String label = Blocks.name(HOTBAR[selected]);
    g.setFont(small);
    int labelWidth = g.getFontMetrics().stringWidth(label) + 12;
    panel(g, (width - labelWidth) / 2, top - 22, labelWidth, 17);
    g.setColor(TEXT);
    g.drawString(label, (width - labelWidth) / 2 + 6, top - 9);
  }

  private void toasts(Graphics2D g, int width) {
    g.setFont(small);
    int shown = Math.min(4, messages.size());
    for (int index = 0; index < shown; index++) {
      String message = messages.get(messages.size() - 1 - index);
      int textWidth = g.getFontMetrics().stringWidth(message) + 12;
      int x = (width - textWidth) / 2, y = 30 + index * 20;
      panel(g, x, y, textWidth, 17);
      g.setColor(TEXT);
      g.drawString(message, x + 6, y + 13);
    }
  }

  private void help(Graphics2D g, int width, int height) {
    String[] lines = {
        "Pixeled - 3D voxel sandbox",
        "",
        "WASD / arrows   move and look",
        "Space           jump (fly up)",
        "Shift           sprint (fly down)",
        "F               toggle flight",
        "Left click      mine     Right click    place",
        "Middle click    pick the aimed block",
        "1 - 9 / wheel   choose a block",
        "N new world   T time   P screenshot   H help",
    };
    g.setFont(font);
    int widest = 0;
    for (String line : lines) widest = Math.max(widest, g.getFontMetrics().stringWidth(line));
    int boxWidth = widest + 28, boxHeight = lines.length * 18 + 22;
    int left = (width - boxWidth) / 2, top = Math.max(10, (height - boxHeight) / 2 - 20);
    panel(g, left, top, boxWidth, boxHeight);
    for (int index = 0; index < lines.length; index++) {
      g.setColor(index == 0 ? ACCENT : TEXT);
      g.drawString(lines[index], left + 14, top + 20 + index * 18);
    }
  }
}
