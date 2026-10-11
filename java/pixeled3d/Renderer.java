package pixeled3d;

import java.awt.Color;
import java.awt.Graphics2D;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A small software 3D renderer for Swing — real perspective, no OpenGL required.
 *
 * <p>Every visible block face is projected by hand into screen space, sorted back to front (the
 * painter's algorithm) and filled with Java2D. Faces carry their baked shading, and fog blends them
 * towards the sky colour with distance, so the world reads as 3D without a single shader.
 */
public final class Renderer {

    private static final double NEAR_PLANE = 0.2;
    private static final double SCREEN_LIMIT = 4000.0;

    private World world;
    private final Map<Long, List<Mesher.Face>> chunkFaces = new HashMap<>();
    private final Settings settings;

    public double cameraX, cameraY, cameraZ, yaw, pitch;
    private double[] forward = {0, 0, -1};
    private double[] right = {1, 0, 0};
    private double[] up = {0, 1, 0};
    public int facesDrawn;
    public int chunksDrawn;

    /** Mutable player settings, shared with the interface. */
    public static final class Settings {
        public int renderDistance = 4;
        public int fov = 72;
        public double sensitivity = 0.0022;
        public boolean creative = true;
        public boolean dayCycle = true;
        public double dayLength = 600;
        public double timeOfDay = 0.32;
    }

    public Renderer(World world, Settings settings) {
        this.world = world;
        this.settings = settings;
    }

    public void setWorld(World world) {
        this.world = world;
        chunkFaces.clear();
    }

    public World world() {
        return world;
    }

    private static long key(int cx, int cz) {
        return ((long) cx << 32) ^ (cz & 0xFFFFFFFFL);
    }

    // ------------------------------------------------------------------ chunks

    /** Make sure every chunk within the render distance is generated and meshed. */
    public void streamChunks(Player player) {
        int radius = settings.renderDistance;
        int centerX = (int) Math.floor(player.x()) >> 4;
        int centerZ = (int) Math.floor(player.z()) >> 4;
        java.util.Set<Long> wanted = new java.util.HashSet<>();
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dz = -radius; dz <= radius; dz++) {
                if (dx * dx + dz * dz > radius * radius + radius) continue;
                int cx = centerX + dx, cz = centerZ + dz;
                wanted.add(key(cx, cz));
                Generator.Chunk chunk = world.ensureChunk(cx, cz);
                if (chunk.dirty || !chunkFaces.containsKey(key(cx, cz))) {
                    chunkFaces.put(key(cx, cz), Mesher.meshChunk(world, chunk));
                    chunk.dirty = false;
                }
            }
        }
        chunkFaces.keySet().removeIf(entry -> !wanted.contains(entry));
    }

    /** Re-mesh one chunk (after the player changed a block in or next to it). */
    public void rebuild(int cx, int cz) {
        if (!world.hasChunk(cx, cz)) return;
        Generator.Chunk chunk = world.chunk(cx, cz);
        chunkFaces.put(key(cx, cz), Mesher.meshChunk(world, chunk));
        chunk.dirty = false;
    }

    public void markBlockDirty(int x, int z) {
        int cx = x >> 4, cz = z >> 4;
        for (int dx = -1; dx <= 1; dx++) {
            for (int dz = -1; dz <= 1; dz++) rebuild(cx + dx, cz + dz);
        }
    }

    public int loadedChunkMeshes() {
        return chunkFaces.size();
    }

    // ------------------------------------------------------------------ camera

    public void moveCamera(double x, double y, double z, double yaw, double pitch) {
        this.cameraX = x;
        this.cameraY = y;
        this.cameraZ = z;
        this.yaw = yaw;
        this.pitch = pitch;
        double cosPitch = Math.cos(pitch);
        this.forward = new double[]{-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch};
        this.right = new double[]{Math.cos(yaw), 0, -Math.sin(yaw)};
        double rx = right[0], ry = right[1], rz = right[2];
        double fx = forward[0], fy = forward[1], fz = forward[2];
        this.up = new double[]{ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx};
    }

    private double[] project(double[] point) {
        double px = point[0] - cameraX, py = point[1] - cameraY, pz = point[2] - cameraZ;
        return new double[]{
            px * right[0] + py * right[1] + pz * right[2],
            px * up[0] + py * up[1] + pz * up[2],
            px * forward[0] + py * forward[1] + pz * forward[2],
        };
    }

    // ------------------------------------------------------------------ drawing

    /** Render one frame straight onto the Swing graphics context. */
    public void render(Graphics2D g, Player player, int width, int height, double daylight, int skyColor, int fogColor) {
        int radius = settings.renderDistance;
        double focal = (height / 2.0) / Math.tan(Math.toRadians(settings.fov) / 2.0);
        double gx = player.x(), gy = player.eyeY(), gz = player.z();
        moveCamera(gx, gy, gz, player.yaw, player.pitch);
        double fogNear = 24;
        double fogFar = radius * Blocks.CHUNK_SIZE - 4.0;

        // Each record is [distance, cornerCount, colour, alpha, x0, y0, x1, y1, ...];
        // sorting it back to front is what makes a painter's-algorithm renderer work.
        List<double[]> drawList = new ArrayList<>();
        facesDrawn = 0;
        chunksDrawn = 0;

        for (Map.Entry<Long, List<Mesher.Face>> entry : chunkFaces.entrySet()) {
            long key = entry.getKey();
            int cx = (int) (key >> 32);
            int cz = (int) key;
            double centerX = cx * Blocks.CHUNK_SIZE + 8;
            double centerZ = cz * Blocks.CHUNK_SIZE + 8;
            double toX = centerX - cameraX, toZ = centerZ - cameraZ;
            if (toX * forward[0] + toZ * forward[2] < -Blocks.CHUNK_SIZE * 1.5) continue;
            chunksDrawn++;

            for (Mesher.Face face : entry.getValue()) {
                double centerY = face.centerY();
                double dx = face.centerX() - cameraX;
                double dy = centerY - cameraY;
                double dz = face.centerZ() - cameraZ;
                double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (distance > fogFar + 6) continue;
                int[] normal = face.normal;
                if (normal[0] * dx + normal[1] * dy + normal[2] * dz >= 0) continue;

                int cornerCount = 0;
                double[][] cameraPoints = new double[face.points.length][];
                for (int i = 0; i < face.points.length; i++) cameraPoints[i] = project(face.points[i]);
                List<double[]> clipped = clipNear(cameraPoints);
                if (clipped.size() < 3) continue;
                double[] screen = new double[clipped.size() * 2];
                for (double[] point : clipped) {
                    double sx = width / 2.0 + point[0] * focal / point[2];
                    double sy = height / 2.0 - point[1] * focal / point[2];
                    screen[cornerCount * 2] = Math.max(-SCREEN_LIMIT, Math.min(SCREEN_LIMIT, sx));
                    screen[cornerCount * 2 + 1] = Math.max(-SCREEN_LIMIT, Math.min(SCREEN_LIMIT, sy));
                    cornerCount++;
                }

                double fog = distance <= fogNear ? 0 : Math.min(0.72, (distance - fogNear) / Math.max(1, fogFar - fogNear));
                int color = Mesher.shadeColor(face.color, face.shade * (0.35 + 0.65 * daylight));
                color = mixColor(color, fogColor, fog);
                int alpha = face.kind.equals("water") ? 176 : 255;
                if (face.kind.equals("water")) color = mixColor(color, 0x2f6fc0, 0.35);
                // A record is: [0] distance, [1] corner count, [2] colour, [3] alpha,
                // then the screen coordinates, alternating x and y.
                double[] record = new double[4 + cornerCount * 2];
                record[0] = distance;
                record[1] = cornerCount;
                record[2] = color;
                record[3] = alpha;
                System.arraycopy(screen, 0, record, 4, cornerCount * 2);
                drawList.add(record);
            }
        }

        drawList.sort((a, b) -> Double.compare(b[0], a[0]));   // far first: the painter's algorithm

        for (double[] record : drawList) {
            int count = (int) record[1];
            int color = (int) record[2];
            int alpha = (int) record[3];
            int[] xs = new int[count];
            int[] ys = new int[count];
            for (int i = 0; i < count; i++) {
                xs[i] = (int) Math.round(record[4 + i * 2]);
                ys[i] = (int) Math.round(record[5 + i * 2]);
            }
            g.setColor(new Color((color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF, alpha));
            g.fillPolygon(xs, ys, count);
            facesDrawn++;
        }
    }

    /** Clip a camera-space polygon against the near plane (Sutherland–Hodgman). */
    private static List<double[]> clipNear(double[][] points) {
        List<double[]> out = new ArrayList<>(points.length + 1);
        int count = points.length;
        for (int i = 0; i < count; i++) {
            double[] current = points[i];
            double[] following = points[(i + 1) % count];
            boolean currentInside = current[2] >= NEAR_PLANE;
            boolean followingInside = following[2] >= NEAR_PLANE;
            if (currentInside) out.add(current);
            if (currentInside != followingInside) {
                double t = (NEAR_PLANE - current[2]) / (following[2] - current[2]);
                out.add(new double[]{
                    current[0] + (following[0] - current[0]) * t,
                    current[1] + (following[1] - current[1]) * t,
                    NEAR_PLANE,
                });
            }
        }
        return out;
    }

    /** Blend two RGB colours; amount 0 keeps a, 1 keeps b. */
    public static int mixColor(int colorA, int colorB, double amount) {
        int red = (int) (((colorA >> 16) & 0xFF) * (1 - amount) + ((colorB >> 16) & 0xFF) * amount);
        int green = (int) (((colorA >> 8) & 0xFF) * (1 - amount) + ((colorB >> 8) & 0xFF) * amount);
        int blue = (int) ((colorA & 0xFF) * (1 - amount) + (colorB & 0xFF) * amount);
        return (clamp(red) << 16) | (clamp(green) << 8) | clamp(blue);
    }

    private static int clamp(int value) {
        return Math.max(0, Math.min(255, value));
    }

    // ------------------------------------------------------------------ sky & clock

    /** Daylight 0 (midnight) to 1 (noon), following the same clock as the other editions. */
    public double daylight() {
        double angle = (settings.timeOfDay - 0.25) * Math.PI * 2;
        return Math.max(0, Math.min(1, Math.sin(angle) * 1.6 + 0.28));
    }

    public String clockText() {
        int total = (int) (settings.timeOfDay * 24 * 60);
        return String.format("%02d:%02d", total / 60, total % 60);
    }

    public String phaseName() {
        if (settings.timeOfDay < 0.22) return "Night";
        if (settings.timeOfDay < 0.30) return "Dawn";
        if (settings.timeOfDay < 0.66) return "Daytime";
        if (settings.timeOfDay < 0.78) return "Dusk";
        return "Night";
    }

    /** The sky and fog colour for the current light level. */
    public int skyColor() {
        double light = daylight();
        return mixColor(0x0a1020, 0x9fc6e8, light);
    }
}
