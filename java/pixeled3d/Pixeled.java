package pixeled3d;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.event.KeyAdapter;
import java.awt.event.KeyEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.event.MouseWheelEvent;
import java.awt.image.BufferedImage;

import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.SwingUtilities;
import javax.swing.Timer;

/**
 * Pixeled — Java/Swing edition, 3D.
 *
 * <p>The world is the same world the web and Python editions generate from a seed, drawn by a small
 * software 3D renderer ({@link Renderer}) onto a Swing panel: chunk meshes, painter's-algorithm
 * sorting, baked shading and fog. Controls are WASD + mouse look + space to jump and fly, exactly
 * like the other editions, and F3 toggles a debug overlay.
 */
public final class Pixeled extends JPanel {

    private static final long serialVersionUID = 1L;
    private static final double REACH = 6.0;

    private World world;
    private Player player;
    private final Renderer renderer;
    private final Renderer.Settings settings = new Renderer.Settings();

    private final boolean[] keys = new boolean[512];
    private boolean paused = true;
    private boolean thirdPerson;
    private boolean debug;
    private int page;
    private int selected;
    private int blocksPlaced;
    private double minutesPlayed;
    private double breakProgress;
    private int[] breakKey;
    private boolean digging;
    private String toast = "";
    private long toastUntil;
    private double fps;
    private int frames;
    private long fpsTimer = System.currentTimeMillis();
    private long lastFrame = System.currentTimeMillis();
    private long lastSave = System.currentTimeMillis();

    private int lastMouseX = -1;
    private int lastMouseY = -1;

    public Pixeled() {
        setPreferredSize(new Dimension(1100, 680));
        setBackground(new Color(0x9fc6e8));
        setFocusable(true);

        Storage.Save save = Storage.load();
        int seed = save != null ? save.seed : Noise.randomSeed();
        world = new World(seed);
        double[] spawn = world.findSpawn(0, 0);
        player = new Player(world, spawn);
        if (save != null) {
            if (save.player != null) player.restore(save.player);
            blocksPlaced = save.blocksPlaced;
            minutesPlayed = save.minutes;
            settings.timeOfDay = save.time;
            for (int[] edit : save.edits) {
                Generator.Chunk chunk = world.ensureChunk(edit[0] >> 4, edit[2] >> 4);
                world.setBlock(edit[0], edit[1], edit[2], edit[3], true);
                chunk.dirty = true;
            }
        }
        renderer = new Renderer(world, settings);
        renderer.streamChunks(player);

        bindInput();
        Timer timer = new Timer(16, event -> tick());
        timer.start();
        requestFocusInWindow();
    }

    // ------------------------------------------------------------------ input

    private void bindInput() {
        addKeyListener(new KeyAdapter() {
            @Override
            public void keyPressed(KeyEvent event) {
                int code = event.getKeyCode();
                if (code < keys.length) keys[code] = true;
                if (code == KeyEvent.VK_ESCAPE) setPaused(true);
                if (code == KeyEvent.VK_F) toggleFly();
                if (code == KeyEvent.VK_V) {
                    thirdPerson = !thirdPerson;
                    say(thirdPerson ? "Third person" : "First person");
                }
                if (code == KeyEvent.VK_E) {
                    page = (page + 1) % Blocks.HOTBAR_PAGES.length;
                    say("Blocks page " + (page + 1) + " of " + Blocks.HOTBAR_PAGES.length);
                }
                if (code == KeyEvent.VK_F3) debug = !debug;
                if (code == KeyEvent.VK_R) {
                    player.respawn();
                    say("Back to the surface");
                }
                if (code == KeyEvent.VK_N) newWorld(null);
                if (code == KeyEvent.VK_SPACE) player.jump();
                if (code >= KeyEvent.VK_1 && code <= KeyEvent.VK_9) selected = code - KeyEvent.VK_1;
            }

            @Override
            public void keyReleased(KeyEvent event) {
                int code = event.getKeyCode();
                if (code < keys.length) keys[code] = false;
            }
        });

        MouseAdapter mouse = new MouseAdapter() {
            @Override
            public void mousePressed(MouseEvent event) {
                requestFocusInWindow();
                if (paused) { setPaused(false); return; }
                if (SwingUtilities.isLeftMouseButton(event)) {
                    digging = true;
                    World.Hit hit = currentTarget();
                    if (hit != null) breakBlock(hit);
                } else if (SwingUtilities.isRightMouseButton(event)) {
                    World.Hit hit = currentTarget();
                    if (hit != null) placeBlock(hit);
                } else if (SwingUtilities.isMiddleMouseButton(event)) {
                    pickBlock();
                }
            }

            @Override
            public void mouseReleased(MouseEvent event) {
                if (SwingUtilities.isLeftMouseButton(event)) digging = false;
            }

            @Override
            public void mouseMoved(MouseEvent event) { turn(event); }

            @Override
            public void mouseDragged(MouseEvent event) { turn(event); }

            @Override
            public void mouseWheelMoved(MouseWheelEvent event) {
                selected = ((selected + event.getWheelRotation()) % 9 + 9) % 9;
            }

            private void turn(MouseEvent event) {
                if (paused) { lastMouseX = event.getX(); lastMouseY = event.getY(); return; }
                if (lastMouseX >= 0) {
                    double dx = event.getX() - lastMouseX;
                    double dy = event.getY() - lastMouseY;
                    player.look(dx * settings.sensitivity * 6, dy * settings.sensitivity * 6);
                }
                lastMouseX = event.getX();
                lastMouseY = event.getY();
            }
        };
        addMouseListener(mouse);
        addMouseMotionListener(mouse);
        addMouseWheelListener(mouse);
    }

    private World.Hit currentTarget() {
        double[] eye = {player.x(), player.eyeY(), player.z()};
        double[] direction = player.direction();
        return world.raycast(eye[0], eye[1], eye[2], direction[0], direction[1], direction[2], REACH);
    }

    private void breakBlock(World.Hit hit) {
        if (!world.setBlock(hit.x, hit.y, hit.z, 0, true)) return;
        renderer.markBlockDirty(hit.x, hit.z);
        say("Dug " + Blocks.nameOf(hit.block).toLowerCase());
        lastSave = 0;
    }

    private void placeBlock(World.Hit hit) {
        int x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
        if (y < 0 || y >= Blocks.WORLD_HEIGHT) return;
        int block = Blocks.HOTBAR_PAGES[page][selected];
        int existing = world.getBlock(x, y, z);
        if (existing != 0 && !Blocks.isLiquid(existing)) return;
        if (player.overlapsBlock(x, y, z) && Blocks.isSolid(block)) {
            say("Make a little room first");
            return;
        }
        if (!world.setBlock(x, y, z, block, true)) return;
        renderer.markBlockDirty(x, z);
        blocksPlaced++;
        say("Placed " + Blocks.nameOf(block).toLowerCase());
        lastSave = 0;
    }

    private void pickBlock() {
        World.Hit hit = currentTarget();
        if (hit == null) return;
        for (int candidate = 0; candidate < Blocks.HOTBAR_PAGES.length; candidate++) {
            int[] pageBlocks = Blocks.HOTBAR_PAGES[candidate];
            for (int slot = 0; slot < pageBlocks.length; slot++) {
                if (pageBlocks[slot] == hit.block) {
                    page = candidate;
                    selected = slot;
                    say(Blocks.nameOf(hit.block));
                    return;
                }
            }
        }
        say("That block is not in your hotbar");
    }

    private void toggleFly() {
        if (!settings.creative) { say("Flying needs creative mode"); return; }
        say(player.toggleFly(true) ? "Flying — space up, shift down" : "Back on your feet");
    }

    // ------------------------------------------------------------------ world management

    /** Start a fresh world, optionally from a seed the player typed. */
    public void newWorld(String seedText) {
        Integer parsed = Noise.parseSeed(seedText);
        int seed = parsed != null ? parsed : Noise.randomSeed();
        world = new World(seed);
        double[] spawn = world.findSpawn(0, 0);
        player = new Player(world, spawn);
        renderer.setWorld(world);
        renderer.streamChunks(player);
        blocksPlaced = 0;
        minutesPlayed = 0;
        settings.timeOfDay = 0.32;
        Storage.clear();
        say("New world · seed " + seed);
        setPaused(false);
    }

    public void setPaused(boolean value) {
        paused = value;
        if (value) saveNow();
    }

    private void saveNow() {
        Storage.save(world, player, blocksPlaced, minutesPlayed, settings.timeOfDay);
        lastSave = System.currentTimeMillis();
    }

    private void say(String text) {
        toast = text;
        toastUntil = System.currentTimeMillis() + 2000;
    }

    // ------------------------------------------------------------------ the loop

    private void tick() {
        long now = System.currentTimeMillis();
        double dt = Math.min(0.05, (now - lastFrame) / 1000.0);
        lastFrame = now;

        if (!paused) {
            Player.Input input = new Player.Input();
            input.forward = keys[KeyEvent.VK_W] || keys[KeyEvent.VK_UP];
            input.back = keys[KeyEvent.VK_S] || keys[KeyEvent.VK_DOWN];
            input.left = keys[KeyEvent.VK_A] || keys[KeyEvent.VK_LEFT];
            input.right = keys[KeyEvent.VK_D] || keys[KeyEvent.VK_RIGHT];
            input.jump = keys[KeyEvent.VK_SPACE];
            input.sneak = keys[KeyEvent.VK_SHIFT];
            input.sprint = keys[KeyEvent.VK_CONTROL];
            player.update(dt, input);
            updateBreaking(dt);
            if (settings.dayCycle) {
                settings.timeOfDay = (settings.timeOfDay + dt / settings.dayLength) % 1;
            }
            minutesPlayed += dt / 60;
            if (now - lastSave > 20000) saveNow();
        }

        renderer.streamChunks(player);
        frames++;
        if (now - fpsTimer >= 500) {
            fps = frames * 1000.0 / (now - fpsTimer);
            frames = 0;
            fpsTimer = now;
        }
        repaint();
    }

    private void updateBreaking(double dt) {
        if (!digging) { breakProgress = 0; breakKey = null; return; }
        World.Hit hit = currentTarget();
        if (hit == null) { breakProgress = 0; breakKey = null; return; }
        int[] key = {hit.x, hit.y, hit.z};
        if (breakKey == null || key[0] != breakKey[0] || key[1] != breakKey[1] || key[2] != breakKey[2]) {
            breakKey = key;
            breakProgress = 0;
        }
        double hardness = settings.creative ? 0.18 : Math.max(0.12, Blocks.hardnessOf(hit.block));
        breakProgress += dt / hardness;
        if (breakProgress >= 1) {
            breakBlock(hit);
            breakProgress = 0;
            breakKey = null;
        }
    }

    // ------------------------------------------------------------------ painting

    @Override
    protected void paintComponent(Graphics graphics) {
        super.paintComponent(graphics);
        Graphics2D g = (Graphics2D) graphics;
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_OFF);

        int width = getWidth();
        int height = getHeight();
        int sky = renderer.skyColor();
        g.setColor(new Color(sky));
        g.fillRect(0, 0, width, height);

        // A simple sun glow, so the time of day reads at a glance.
        double light = renderer.daylight();
        if (light > 0.15) {
            int glow = (int) (60 + 90 * light);
            g.setColor(new Color(255, 244, 214, Math.min(220, glow)));
            g.fillOval(width - 190, 40, 96, 96);
        }

        renderer.render(g, player, width, height, light, sky, sky);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        drawCrosshair(g, width, height);
        drawHud(g, width, height);

        if (paused) drawPauseMenu(g, width, height);
        else if (toast != null && !toast.isEmpty() && System.currentTimeMillis() < toastUntil) drawToast(g, width, height);
    }

    private void drawCrosshair(Graphics2D g, int width, int height) {
        g.setColor(new Color(255, 255, 255, 200));
        int cx = width / 2, cy = height / 2;
        g.drawLine(cx - 9, cy, cx + 9, cy);
        g.drawLine(cx, cy - 9, cx, cy + 9);
        if (breakProgress > 0) {
            g.setColor(new Color(0xb3df9e));
            g.fillRect(cx - 30, cy + 18, (int) (60 * Math.min(1, breakProgress)), 4);
        }
        World.Hit hit = currentTarget();
        if (hit != null) {
            g.setColor(new Color(255, 255, 255, 210));
            g.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 12));
            g.drawString(Blocks.nameOf(hit.block), cx - 20, cy - 18);
        }
    }

    private void drawHud(Graphics2D g, int width, int height) {
        g.setFont(new Font(Font.MONOSPACED, Font.BOLD, 12));

        // Status bar.
        g.setColor(new Color(0x0e1a26));
        g.fillRect(0, 0, width, 28);
        g.setColor(new Color(0xeef3ea));
        String position = String.format("%.1f %.1f %.1f", player.x(), player.y(), player.z());
        g.drawString(world.generator.biomeAt((int) player.x(), (int) player.z()) + "   " + position, 10, 19);
        g.setColor(new Color(0xb3df9e));
        String right = renderer.clockText() + "  " + renderer.phaseName() + "  " + (int) fps + " fps  "
            + renderer.loadedChunkMeshes() + " chunks  seed " + world.seed;
        g.drawString(right, width - 10 - g.getFontMetrics().stringWidth(right), 19);

        // Hotbar.
        int slotWidth = 62, slotHeight = 52;
        int total = slotWidth * 9;
        int startX = (width - total) / 2;
        int startY = height - slotHeight - 16;
        int[] pageBlocks = Blocks.HOTBAR_PAGES[page];
        for (int slot = 0; slot < 9; slot++) {
            int blockId = pageBlocks[slot];
            Blocks.Block block = Blocks.BLOCKS[blockId];
            int x = startX + slot * slotWidth;
            boolean active = slot == selected;
            g.setColor(active ? new Color(0x3a5540) : new Color(0x16232e, false));
            g.fillRect(x + 2, startY, slotWidth - 4, slotHeight);
            g.setColor(active ? new Color(0xb3df9e) : new Color(0x2b3b47));
            g.drawRect(x + 2, startY, slotWidth - 4, slotHeight);
            g.setColor(new Color(block.color("top")));
            g.fillRect(x + 12, startY + 7, slotWidth - 24, 22);
            g.setColor(new Color(0xeef3ea));
            g.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 10));
            g.drawString((slot + 1) + block.name.substring(0, Math.min(5, block.name.length())), x + 6, startY + 44);
            g.setFont(new Font(Font.MONOSPACED, Font.BOLD, 12));
        }
        String held = Blocks.nameOf(pageBlocks[selected]) + "   ·   seed " + world.seed
            + "   ·   " + renderer.facesDrawn + " faces   ·   " + blocksPlaced + " placed";
        g.setColor(new Color(0xffffff));
        g.drawString(held, (width - g.getFontMetrics().stringWidth(held)) / 2, startY - 10);

        if (debug) {
            g.setColor(new Color(0x0e1a26, false));
            g.fillRect(10, 40, 240, 120);
            g.setColor(new Color(0x9fb0ae));
            g.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 11));
            g.drawString("position  " + position, 20, 62);
            g.drawString("chunk     " + (((int) player.x()) >> 4) + ", " + (((int) player.z()) >> 4), 20, 80);
            g.drawString("chunks    " + renderer.loadedChunkMeshes() + " meshed, " + renderer.chunksDrawn + " drawn", 20, 98);
            g.drawString("faces     " + renderer.facesDrawn, 20, 116);
            g.drawString("seed      " + world.seed, 20, 134);
            g.drawString("time      " + renderer.clockText() + "  " + renderer.phaseName(), 20, 152);
        }
    }

    private void drawToast(Graphics2D g, int width, int height) {
        g.setFont(new Font(Font.MONOSPACED, Font.BOLD, 12));
        int textWidth = g.getFontMetrics().stringWidth(toast);
        int x = (width - textWidth) / 2;
        g.setColor(new Color(0x0e1a26));
        g.fillRect(x - 14, height - 150, textWidth + 28, 28);
        g.setColor(new Color(0xeef3ea));
        g.drawString(toast, x, height - 132);
    }

    private void drawPauseMenu(Graphics2D g, int width, int height) {
        g.setColor(new Color(8, 14, 22, 200));
        g.fillRect(0, 0, width, height);
        int panelWidth = 520, panelHeight = 330;
        int x = (width - panelWidth) / 2, y = (height - panelHeight) / 2;
        g.setColor(new Color(0x0d1a26));
        g.fillRect(x, y, panelWidth, panelHeight);
        g.setColor(new Color(0x2b3b47));
        g.setStroke(new BasicStroke(2f));
        g.drawRect(x, y, panelWidth, panelHeight);

        g.setFont(new Font(Font.MONOSPACED, Font.BOLD, 20));
        g.setColor(new Color(0xb3df9e));
        g.drawString("Pixeled", x + 28, y + 44);
        g.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 12));
        g.setColor(new Color(0x9fb0ae));
        g.drawString("seed " + world.seed + "  (" + Noise.seedLabel(world.seed) + ")", x + 28, y + 66);

        String[] lines = {
            "W A S D  move        Space  jump / fly up",
            "Shift  sneak         Ctrl   sprint",
            "Mouse  look          Click  dig",
            "Right click  place   Middle click  pick block",
            "1-9 / wheel  choose  E  change block page",
            "F  fly   R  respawn  V  camera   F3  debug",
            "N  new world   Esc  pause",
        };
        g.setColor(new Color(0xeef3ea));
        for (int i = 0; i < lines.length; i++) {
            g.drawString(lines[i], x + 28, y + 100 + i * 22);
        }
        g.setFont(new Font(Font.MONOSPACED, Font.BOLD, 13));
        g.setColor(new Color(0xb3df9e));
        g.drawString("Click the world to play", x + 28, y + panelHeight - 26);
        g.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 11));
        g.setColor(new Color(0x9fb0ae));
        g.drawString("Every new world gets its own seed, so no two are the same.", x + 28, y + panelHeight - 8);
    }

    /** A preview image of a seed, used by the tests and by the seed dialog. */
    public BufferedImage renderPreview(int seed, int width, int height) {
        World previewWorld = new World(seed);
        Renderer previewRenderer = new Renderer(previewWorld, settings);
        double[] spawn = previewWorld.findSpawn(0, 0);
        Player previewPlayer = new Player(previewWorld, spawn);
        previewPlayer.look(0.6, -0.15);
        previewRenderer.streamChunks(previewPlayer);
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(new Color(previewRenderer.skyColor()));
        g.fillRect(0, 0, width, height);
        previewRenderer.render(g, previewPlayer, width, height, previewRenderer.daylight(),
            previewRenderer.skyColor(), previewRenderer.skyColor());
        g.dispose();
        return image;
    }

    // ------------------------------------------------------------------ window

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            JFrame frame = new JFrame("Pixeled — a 3D voxel world");
            Pixeled game = new Pixeled();
            frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
            frame.add(game);
            frame.pack();
            frame.setLocationRelativeTo(null);
            frame.setVisible(true);
            game.requestFocusInWindow();
            if (args.length > 0) {
                Integer seed = Noise.parseSeed(String.join(" ", args));
                if (seed != null) game.newWorld(String.valueOf(seed));
            }
        });
    }
}
