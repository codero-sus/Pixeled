package com.pixeled.rockz;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A small software 3D renderer for Android's Canvas — real perspective, no OpenGL required.
 *
 * <p>Chunk meshes (from {@link Mesher}) are projected into screen space, sorted back to front with
 * the painter's algorithm, fogged and filled as polygons. It is the same approach the Swing and
 * Tkinter editions use, so all four editions read as one game.
 */
final class RockzRenderer {

    private static final double NEAR_PLANE = 0.2;
    private static final double SCREEN_LIMIT = 4000.0;

    private final WorldModel world;
    private final Map<Long, List<Mesher.Face>> chunkFaces = new HashMap<>();
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();

    double cameraX, cameraY, cameraZ, yaw, pitch;
    private double[] forward = {0, 0, -1};
    private double[] right = {1, 0, 0};
    private double[] up = {0, 1, 0};
    int renderDistance = 4;
    int fov = 74;
    int facesDrawn;
    int chunksDrawn;

    RockzRenderer(WorldModel world) {
        this.world = world;
        fill.setStyle(Paint.Style.FILL);
    }

    private static long key(int cx, int cz) {
        return ((long) cx << 32) ^ (cz & 0xFFFFFFFFL);
    }

    int loadedChunkMeshes() {
        return chunkFaces.size();
    }

    /** Generate and mesh every chunk within the render distance. */
    void streamChunks(double x, double z, int budget) {
        int centerX = (int) Math.floor(x) >> 4;
        int centerZ = (int) Math.floor(z) >> 4;
        int built = 0;
        for (int dx = -renderDistance; dx <= renderDistance; dx++) {
            for (int dz = -renderDistance; dz <= renderDistance; dz++) {
                if (dx * dx + dz * dz > renderDistance * renderDistance + renderDistance) continue;
                int cx = centerX + dx, cz = centerZ + dz;
                Generator.Chunk chunk = world.ensureChunk(cx, cz);
                if (chunk.dirty || !chunkFaces.containsKey(key(cx, cz))) {
                    chunkFaces.put(key(cx, cz), Mesher.meshChunk(world, chunk));
                    chunk.dirty = false;
                    if (++built >= budget) return;
                }
            }
        }
    }

    /** Re-mesh one chunk after a block changed; also touches the neighbours across the seam. */
    void markDirty(int x, int z) {
        int cx = x >> 4, cz = z >> 4;
        for (int dx = -1; dx <= 1; dx++) {
            for (int dz = -1; dz <= 1; dz++) {
                int ncx = cx + dx, ncz = cz + dz;
                if (!world.hasChunk(ncx, ncz)) continue;
                chunkFaces.put(key(ncx, ncz), Mesher.meshChunk(world, world.chunk(ncx, ncz)));
                world.chunk(ncx, ncz).dirty = false;
            }
        }
    }

    void moveCamera(double x, double y, double z, double yaw, double pitch) {
        this.cameraX = x;
        this.cameraY = y;
        this.cameraZ = z;
        this.yaw = yaw;
        this.pitch = pitch;
        double cosPitch = Math.cos(pitch);
        forward = new double[]{-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch};
        right = new double[]{Math.cos(yaw), 0, -Math.sin(yaw)};
        double rx = right[0], ry = right[1], rz = right[2];
        double fx = forward[0], fy = forward[1], fz = forward[2];
        up = new double[]{ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx};
    }

    private double[] project(double[] point) {
        double px = point[0] - cameraX, py = point[1] - cameraY, pz = point[2] - cameraZ;
        return new double[]{
            px * right[0] + py * right[1] + pz * right[2],
            px * up[0] + py * up[1] + pz * up[2],
            px * forward[0] + py * forward[1] + pz * forward[2],
        };
    }

    static int mixColor(int colorA, int colorB, double amount) {
        int red = (int) (((colorA >> 16) & 0xFF) * (1 - amount) + ((colorB >> 16) & 0xFF) * amount);
        int green = (int) (((colorA >> 8) & 0xFF) * (1 - amount) + ((colorB >> 8) & 0xFF) * amount);
        int blue = (int) ((colorA & 0xFF) * (1 - amount) + (colorB & 0xFF) * amount);
        return (clamp(red) << 16) | (clamp(green) << 8) | clamp(blue);
    }

    private static int clamp(int value) {
        return Math.max(0, Math.min(255, value));
    }

    static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | ((alpha & 0xFF) << 24);
    }

    /** Project, sort and fill every visible face. */
    void render(Canvas canvas, int width, int height, double daylight, int fogColor) {
        double focal = (height / 2.0) / Math.tan(Math.toRadians(fov) / 2.0);
        double fogNear = 20;
        double fogFar = renderDistance * Blocks.CHUNK_SIZE - 3.0;
        List<double[]> drawList = new ArrayList<>();
        facesDrawn = 0;
        chunksDrawn = 0;

        for (Map.Entry<Long, List<Mesher.Face>> entry : chunkFaces.entrySet()) {
            long chunkKey = entry.getKey();
            int cx = (int) (chunkKey >> 32);
            int cz = (int) chunkKey;
            double toX = cx * Blocks.CHUNK_SIZE + 8 - cameraX;
            double toZ = cz * Blocks.CHUNK_SIZE + 8 - cameraZ;
            if (toX * forward[0] + toZ * forward[2] < -Blocks.CHUNK_SIZE * 1.5) continue;
            chunksDrawn++;

            for (Mesher.Face face : entry.getValue()) {
                double dx = face.centerX() - cameraX;
                double dy = face.centerY() - cameraY;
                double dz = face.centerZ() - cameraZ;
                double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (distance > fogFar + 6) continue;
                if (face.normal[0] * dx + face.normal[1] * dy + face.normal[2] * dz >= 0) continue;

                double[][] cameraPoints = new double[face.points.length][];
                for (int i = 0; i < face.points.length; i++) cameraPoints[i] = project(face.points[i]);
                List<double[]> clipped = clipNear(cameraPoints);
                int count = clipped.size();
                if (count < 3) continue;
                double[] record = new double[4 + count * 2];
                for (int i = 0; i < count; i++) {
                    double[] point = clipped.get(i);
                    double sx = width / 2.0 + point[0] * focal / point[2];
                    double sy = height / 2.0 - point[1] * focal / point[2];
                    record[4 + i * 2] = Math.max(-SCREEN_LIMIT, Math.min(SCREEN_LIMIT, sx));
                    record[5 + i * 2] = Math.max(-SCREEN_LIMIT, Math.min(SCREEN_LIMIT, sy));
                }
                double fog = distance <= fogNear ? 0 : Math.min(0.7, (distance - fogNear) / Math.max(1, fogFar - fogNear));
                int color = Mesher.shadeColor(face.color, face.shade * (0.4 + 0.6 * daylight));
                color = mixColor(color, fogColor, fog);
                int alpha = 255;
                if (face.kind.equals("water")) {
                    color = mixColor(color, 0x2f6fc0, 0.35);
                    alpha = 180;
                } else if (face.kind.equals("cutout")) {
                    alpha = 240;
                }
                record[0] = distance;
                record[1] = count;
                record[2] = withAlpha(color, alpha);
                drawList.add(record);
            }
        }

        drawList.sort((a, b) -> Double.compare(b[0], a[0]));

        for (double[] record : drawList) {
            int count = (int) record[1];
            path.reset();
            path.moveTo((float) record[4], (float) record[5]);
            for (int i = 1; i < count; i++) {
                path.lineTo((float) record[4 + i * 2], (float) record[5 + i * 2]);
            }
            path.close();
            fill.setColor((int) record[2]);
            canvas.drawPath(path, fill);
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

    // ------------------------------------------------------------------ sky & light

    /** Daylight 0 (midnight) to 1 (noon), following the shared clock. */
    static double daylight(double timeOfDay) {
        double angle = (timeOfDay - 0.25) * Math.PI * 2;
        return Math.max(0, Math.min(1, Math.sin(angle) * 1.6 + 0.28));
    }

    static int skyColor(double timeOfDay) {
        return mixColor(0x0a1020, 0x9fc6e8, daylight(timeOfDay));
    }

    static String clockText(double timeOfDay) {
        int total = (int) (timeOfDay * 24 * 60);
        return String.format("%02d:%02d", total / 60, total % 60);
    }

    static String phaseName(double timeOfDay) {
        if (timeOfDay < 0.22) return "Night";
        if (timeOfDay < 0.30) return "Dawn";
        if (timeOfDay < 0.66) return "Daytime";
        if (timeOfDay < 0.78) return "Dusk";
        return "Night";
    }
}
