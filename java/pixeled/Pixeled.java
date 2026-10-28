package pixeled;

import java.awt.Color;
import java.awt.Dimension;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.event.ActionEvent;
import java.awt.event.KeyEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.event.MouseWheelEvent;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;

import javax.imageio.ImageIO;
import javax.swing.AbstractAction;
import javax.swing.ActionMap;
import javax.swing.InputMap;
import javax.swing.JComponent;
import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.KeyStroke;
import javax.swing.SwingUtilities;
import javax.swing.Timer;

/**
 * Pixeled — a dependency-free 3D voxel sandbox (Java/Swing edition).
 *
 *     javac -d out java/pixeled/*.java  &&  java -cp out pixeled.Pixeled
 *
 * Left click mines, right click places, WASD walks, space jumps, F flies, N rolls a brand-new
 * random world, H shows the controls and P writes a screenshot next to the working directory.
 * Swing has no pointer lock, so looking around works by dragging the mouse while a button is held.
 */
public final class Pixeled extends JPanel {

  private static final long serialVersionUID = 1L;
  private static final double SENSITIVITY = 0.0045;

  private final Game game;
  private final Set<Integer> keys = new HashSet<>();
  private int dragX, dragY;
  private boolean dragging;
  private int screenshots;
  private double lastTime = System.nanoTime() / 1e9;

  public Pixeled(int width, int height, Integer seed, boolean save) {
    setPreferredSize(new Dimension(width, height));
    setBackground(new Color(11, 15, 22));
    Renderer renderer = new Renderer(width, height);
    game = new Game(renderer, seed);
    game.saveEnabled = save;
    bindKeys();
    MouseHandler mouse = new MouseHandler();
    addMouseListener(mouse);
    addMouseMotionListener(mouse);
    addMouseWheelListener(mouse);
    setFocusable(true);
  }

  private void bindKeys() {
    InputMap input = getInputMap(JComponent.WHEN_IN_FOCUSED_WINDOW);
    ActionMap actions = getActionMap();
    int[] codes = {KeyEvent.VK_W, KeyEvent.VK_A, KeyEvent.VK_S, KeyEvent.VK_D,
        KeyEvent.VK_UP, KeyEvent.VK_DOWN, KeyEvent.VK_LEFT, KeyEvent.VK_RIGHT,
        KeyEvent.VK_SPACE, KeyEvent.VK_SHIFT, KeyEvent.VK_CONTROL, KeyEvent.VK_F,
        KeyEvent.VK_H, KeyEvent.VK_N, KeyEvent.VK_T, KeyEvent.VK_P,
        KeyEvent.VK_1, KeyEvent.VK_2, KeyEvent.VK_3, KeyEvent.VK_4, KeyEvent.VK_5,
        KeyEvent.VK_6, KeyEvent.VK_7, KeyEvent.VK_8, KeyEvent.VK_9};
    for (int code : codes) {
      input.put(KeyStroke.getKeyStroke(code, 0, false), "press" + code);
      input.put(KeyStroke.getKeyStroke(code, 0, true), "release" + code);
      actions.put("press" + code, new AbstractAction() {
        private static final long serialVersionUID = 1L;
        public void actionPerformed(ActionEvent event) {
          onKeyPressed(code);
        }
      });
      actions.put("release" + code, new AbstractAction() {
        private static final long serialVersionUID = 1L;
        public void actionPerformed(ActionEvent event) {
          keys.remove(code);
        }
      });
    }
  }

  private void onKeyPressed(int code) {
    if (keys.contains(code)) return;
    keys.add(code);
    if (code >= KeyEvent.VK_1 && code <= KeyEvent.VK_9) game.select(code - KeyEvent.VK_1);
    else if (code == KeyEvent.VK_F) game.toggleFly();
    else if (code == KeyEvent.VK_H) game.hud.helpVisible = !game.hud.helpVisible;
    else if (code == KeyEvent.VK_N) game.newWorld(null);
    else if (code == KeyEvent.VK_T) game.skipTime(2);
    else if (code == KeyEvent.VK_P) screenshot();
  }

  private void screenshot() {
    screenshots++;
    File file = new File(String.format("pixeled-%03d.png", screenshots));
    try {
      ImageIO.write(game.renderer.image, "png", file);
      game.hud.notify("SCREENSHOT " + file.getName());
    } catch (IOException error) {
      game.hud.notify("SCREENSHOT FAILED");
    }
  }

  private final class MouseHandler extends MouseAdapter {
    @Override
    public void mousePressed(MouseEvent event) {
      requestFocusInWindow();
      dragging = true;
      dragX = event.getX();
      dragY = event.getY();
      if (event.getButton() == MouseEvent.BUTTON1) game.mine();
      else if (event.getButton() == MouseEvent.BUTTON3) game.place();
      else game.pick();
    }

    @Override
    public void mouseReleased(MouseEvent event) {
      dragging = false;
    }

    @Override
    public void mouseDragged(MouseEvent event) {
      if (!dragging) return;
      game.player.look((event.getX() - dragX) * SENSITIVITY, (event.getY() - dragY) * SENSITIVITY);
      dragX = event.getX();
      dragY = event.getY();
    }

    @Override
    public void mouseWheelMoved(MouseWheelEvent event) {
      game.wheel(event.getWheelRotation());
    }
  }

  @Override
  protected void paintComponent(Graphics graphics) {
    super.paintComponent(graphics);
    BufferedImage frame = game.draw();
    Graphics2D g = (Graphics2D) graphics;
    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
    g.drawImage(frame, 0, 0, getWidth(), getHeight(), null);
  }

  private void tick() {
    double now = System.nanoTime() / 1e9;
    double dt = Math.min(0.1, now - lastTime);
    lastTime = now;
    int forward = (keys.contains(KeyEvent.VK_W) || keys.contains(KeyEvent.VK_UP) ? 1 : 0)
        - (keys.contains(KeyEvent.VK_S) || keys.contains(KeyEvent.VK_DOWN) ? 1 : 0);
    int right = (keys.contains(KeyEvent.VK_D) || keys.contains(KeyEvent.VK_RIGHT) ? 1 : 0)
        - (keys.contains(KeyEvent.VK_A) || keys.contains(KeyEvent.VK_LEFT) ? 1 : 0);
    boolean shift = keys.contains(KeyEvent.VK_SHIFT);
    game.update(dt, forward, right,
        keys.contains(KeyEvent.VK_SPACE),
        shift,                                        // Shift: sprint on foot, fly down in the air
        shift || keys.contains(KeyEvent.VK_CONTROL));
    repaint();
  }

  private static JFrame openWindow(int width, int height, int scale, Integer seed, boolean save) {
    JFrame frame = new JFrame("Pixeled - 3D voxel sandbox (Java edition)");
    Pixeled panel = new Pixeled(width, height, seed, save);
    frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
    frame.add(panel);
    frame.pack();
    frame.setLocationRelativeTo(null);
    frame.setVisible(true);
    panel.requestFocusInWindow();
    Timer timer = new Timer(33, event -> panel.tick());
    timer.start();
    // Scale the window by an integer factor so the pixels stay crisp.
    frame.setSize(width * scale, height * scale + frame.getInsets().top);
    return frame;
  }

  public static void main(String[] args) throws Exception {
    int width = 288, height = 162, scale = 3;
    Integer seed = null;
    boolean save = true;
    boolean render = false;
    String output = "pixeled.png";
    for (int index = 0; index < args.length; index++) {
      String argument = args[index];
      if (argument.equals("--seed") && index + 1 < args.length) seed = Integer.parseInt(args[++index]);
      else if (argument.equals("--width") && index + 1 < args.length) width = Integer.parseInt(args[++index]);
      else if (argument.equals("--height") && index + 1 < args.length) height = Integer.parseInt(args[++index]);
      else if (argument.equals("--scale") && index + 1 < args.length) scale = Integer.parseInt(args[++index]);
      else if (argument.equals("--no-save")) save = false;
      else if (argument.equals("--render")) render = true;
      else if (argument.equals("--out") && index + 1 < args.length) output = args[++index];
      else if (argument.equals("--help")) {
        System.out.println("Pixeled (Java edition)\n"
            + "  --seed N        start a specific world\n"
            + "  --width/--height/--scale  window and frame size\n"
            + "  --no-save       ignore the save file\n"
            + "  --render [--out FILE]  render one frame headlessly and exit\n"
            + "Controls: WASD move, space jump, F fly, left/right click mine/place,\n"
            + "          N new world, T time, H help, P screenshot");
        return;
      }
    }
    if (render) {
      Renderer renderer = new Renderer(width, height);
      Game game = new Game(renderer, seed);
      game.saveEnabled = false;
      for (int frame = 0; frame < 6; frame++) game.update(1 / 30.0, 1, 0, false, false, false);
      ImageIO.write(game.draw(), "png", new File(output));
      System.out.printf("wrote %s (seed %d, %s)%n", output, game.world.seed,
          game.world.biomeName(game.player.x, game.player.z));
      return;
    }
    final int frameWidth = width, frameHeight = height, frameScale = scale;
    final Integer frameSeed = seed;
    final boolean frameSave = save;
    SwingUtilities.invokeLater(() -> openWindow(frameWidth, frameHeight, frameScale, frameSeed, frameSave));
  }
}
