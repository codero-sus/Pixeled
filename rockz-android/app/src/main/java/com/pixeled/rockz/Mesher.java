package com.pixeled.rockz;

import static com.pixeled.rockz.Blocks.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Turns voxels into drawable faces — the Java twin of the other editions.
 *
 * <p>Only faces that can actually be seen are emitted, with the same baked light the other editions
 * use: a face-direction tint, ambient occlusion from the neighbours tucked beside each vertex, a
 * skylight estimate sampled from the air cell in front of the face, and a small per-block colour
 * jitter so large walls do not look flat. The face table, the corner order and every constant below
 * match the web mesher one for one.
 */
final class Mesher {

    private Mesher() {}

    static final double WATER_DROP = 0.12;
    private static final double[] AO_LEVELS = {0.45, 0.62, 0.8, 1.0};
    private static final int SKY_SEARCH = 12;

    /** One cube face: its normal, its four corners, the u/v axes and the texture it uses. */
    static final class FaceDef {
        public final String name;
        public final String tile;
        public final double shade;
        public final int[] normal;
        public final int[] u;
        public final int[] v;
        public final int[][] corners = new int[4][3];
        /** Per-corner signs along u and v, which is where the ambient-occlusion samples sit. */
        public final int[][] signs = new int[4][2];

        FaceDef(String name, String tile, double shade, int[] normal, int[] u, int[] v) {
            this.name = name;
            this.tile = tile;
            this.shade = shade;
            this.normal = normal;
            this.u = u;
            this.v = v;
        }
    }

    /** The six cube faces, in the order the web mesher emits them. */
    static final FaceDef[] FACE_TABLE = {
        face("east", new int[]{1, 0, 0}, new int[]{1, 0, 0}, new int[]{0, 0, 1}, new int[]{0, 1, 0}, "side", FACE_SHADE_X),
        face("west", new int[]{-1, 0, 0}, new int[]{0, 0, 1}, new int[]{0, 0, -1}, new int[]{0, 1, 0}, "side", FACE_SHADE_X),
        face("top", new int[]{0, 1, 0}, new int[]{0, 1, 1}, new int[]{1, 0, 0}, new int[]{0, 0, -1}, "top", FACE_SHADE_TOP),
        face("bottom", new int[]{0, -1, 0}, new int[]{0, 0, 0}, new int[]{1, 0, 0}, new int[]{0, 0, 1}, "bottom", FACE_SHADE_BOTTOM),
        face("south", new int[]{0, 0, 1}, new int[]{0, 0, 1}, new int[]{1, 0, 0}, new int[]{0, 1, 0}, "side", FACE_SHADE_Z),
        face("north", new int[]{0, 0, -1}, new int[]{1, 0, 0}, new int[]{-1, 0, 0}, new int[]{0, 1, 0}, "side", FACE_SHADE_Z),
    };

    /**
     * Builds a face the way the web does: corners are [base, base+u, base+u+v, base+v] carrying the
     * texture axes [[0,0], [1,0], [1,1], [0,1]]. When {@code u × v} points into the block both lists
     * are reversed, which keeps the winding counter-clockwise and the textures upright.
     */
    private static FaceDef face(String name, int[] normal, int[] base, int[] u, int[] v, String tile, double shade) {
        FaceDef definition = new FaceDef(name, tile, shade, normal, u, v);
        int[][] offsets = {
            base,
            add(base, u),
            add(add(base, u), v),
            add(base, v),
        };
        int[][] uvs = {{0, 0}, {1, 0}, {1, 1}, {0, 1}};
        if (dot(cross(u, v), normal) < 0) {
            reverse(offsets);
            reverse(uvs);
        }
        System.arraycopy(offsets, 0, definition.corners, 0, 4);
        for (int corner = 0; corner < 4; corner++) {
            definition.signs[corner][0] = uvs[corner][0] == 0 ? -1 : 1;
            definition.signs[corner][1] = uvs[corner][1] == 0 ? -1 : 1;
        }
        return definition;
    }

    private static int[] add(int[] a, int[] b) {
        return new int[]{a[0] + b[0], a[1] + b[1], a[2] + b[2]};
    }

    private static int[] cross(int[] a, int[] b) {
        return new int[]{
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        };
    }

    private static int dot(int[] a, int[] b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    private static void reverse(int[][] values) {
        for (int i = 0, j = values.length - 1; i < j; i++, j--) {
            int[] swap = values[i];
            values[i] = values[j];
            values[j] = swap;
        }
    }

    /** One drawable quad, already in world space. */
    static final class Face {
        public final String kind;
        public final double[][] points;
        public final int color;
        public final double shade;
        public final int[] normal;
        public final int block;

        Face(String kind, double[][] points, int color, double shade, int[] normal, int block) {
            this.kind = kind;
            this.points = points;
            this.color = color;
            this.shade = shade;
            this.normal = normal;
            this.block = block;
        }

        public double centerX() { return (points[0][0] + points[2][0]) / 2; }
        public double centerY() { return (points[0][1] + points[2][1]) / 2; }
        public double centerZ() { return (points[0][2] + points[2][2]) / 2; }
    }

    /** Multiply an RGB colour by a brightness factor. */
    static int shadeColor(int color, double factor) {
        int red = (int) Math.min(255, ((color >> 16) & 0xFF) * factor);
        int green = (int) Math.min(255, ((color >> 8) & 0xFF) * factor);
        int blue = (int) Math.min(255, ((color & 0xFF) * factor));
        return (red << 16) | (green << 8) | blue;
    }

    /**
     * How much sky reaches a cell. A cell at or above its column top sees the sky; below it, the
     * upward scan stops at the first opaque block. Fully covered cells fade towards 0.3, which is
     * what makes caves and overhangs read as dark without a light engine.
     */
    static double skyLight(WorldModel world, int x, int y, int z, int columnTop) {
        if (y >= columnTop) return 1.0;
        int opened = 0;
        for (int scan = y + 1; scan <= WORLD_HEIGHT; scan++) {
            if (Blocks.isOpaque(world.getBlock(x, scan, z))) break;
            if (++opened >= SKY_SEARCH) return 1.0;
        }
        return 0.3 + 0.7 * (opened / (double) SKY_SEARCH);
    }

    /** Ambient occlusion for one vertex, from the three blocks tucked beside it. */
    private static double occlusion(WorldModel world, int x, int y, int z, FaceDef face, int corner) {
        int[] normal = face.normal;
        int[] u = face.u;
        int[] v = face.v;
        int su = face.signs[corner][0];
        int sv = face.signs[corner][1];

        boolean sideA = Blocks.isOpaque(world.getBlock(
            x + normal[0] + u[0] * su, y + normal[1] + u[1] * su, z + normal[2] + u[2] * su));
        boolean sideB = Blocks.isOpaque(world.getBlock(
            x + normal[0] + v[0] * sv, y + normal[1] + v[1] * sv, z + normal[2] + v[2] * sv));
        if (sideA && sideB) return AO_LEVELS[0];
        boolean diagonal = Blocks.isOpaque(world.getBlock(
            x + normal[0] + u[0] * su + v[0] * sv,
            y + normal[1] + u[1] * su + v[1] * sv,
            z + normal[2] + u[2] * su + v[2] * sv));
        int count = (sideA ? 1 : 0) + (sideB ? 1 : 0) + (diagonal ? 1 : 0);
        return AO_LEVELS[Math.min(3, 3 - count)];
    }

    private static boolean visible(WorldModel world, int x, int y, int z, FaceDef face, int block) {
        int nx = x + face.normal[0];
        int ny = y + face.normal[1];
        int nz = z + face.normal[2];
        int neighbour = world.getBlock(nx, ny, nz);
        if (Blocks.isOpaque(neighbour)) return false;
        if (Blocks.isLiquid(block) && Blocks.isLiquid(neighbour)) return false;
        Blocks.Block definition = BLOCKS[block];
        if (definition.cutout && neighbour == block) return false;   // glass and leaves merge
        return true;
    }

    /** Every visible face of a chunk, ready to sort and draw. */
    static List<Face> meshChunk(WorldModel world, Generator.Chunk chunk) {
        List<Face> faces = new ArrayList<>();
        int baseX = chunk.cx * CHUNK_SIZE;
        int baseZ = chunk.cz * CHUNK_SIZE;

        for (int y = 0; y <= chunk.highest; y++) {
            for (int z = 0; z < CHUNK_SIZE; z++) {
                for (int x = 0; x < CHUNK_SIZE; x++) {
                    int blockId = chunk.get(x, y, z);
                    if (blockId == 0) continue;
                    int worldX = baseX + x;
                    int worldZ = baseZ + z;
                    Blocks.Block block = BLOCKS[blockId];
                    int top = chunk.height(x, z);

                    if (block.plant) {
                        plantFaces(world, faces, blockId, worldX, y, worldZ, top);
                        continue;
                    }

                    boolean liquid = block.liquid;
                    double jitter = 0.95 + Noise.hashFloat(worldX, y, worldZ, 7717) * 0.1;
                    // The top layer of a liquid sits a little lower, so the surface reads as water.
                    double drop = liquid && world.getBlock(worldX, y + 1, worldZ) == 0 ? WATER_DROP : 0;

                    for (FaceDef face : FACE_TABLE) {
                        if (!visible(world, worldX, y, worldZ, face, blockId)) continue;
                        double light = face.shade * jitter * skyLight(
                            world, worldX + face.normal[0], y + face.normal[1], worldZ + face.normal[2], top);

                        double[][] points = new double[4][3];
                        for (int corner = 0; corner < 4; corner++) {
                            int[] offset = face.corners[corner];
                            points[corner] = new double[]{
                                worldX + offset[0],
                                y + offset[1] - (offset[1] == 1 ? drop : 0),
                                worldZ + offset[2],
                            };
                        }
                        double shade;
                        if (liquid) {
                            shade = light;
                        } else {
                            double ao = 0;
                            for (int corner = 0; corner < 4; corner++) {
                                ao += occlusion(world, worldX, y, worldZ, face, corner);
                            }
                            shade = light * (ao / 4.0);
                        }
                        String kind = liquid ? "water" : block.cutout ? "cutout" : "opaque";
                        faces.add(new Face(kind, points, block.color(face.tile), shade, face.normal, blockId));
                    }
                }
            }
        }
        return faces;
    }

    /** Plants are two crossed quads, jittered so a field never looks like a grid. */
    private static void plantFaces(WorldModel world, List<Face> faces, int blockId, int x, int y, int z, int columnTop) {
        Blocks.Block block = BLOCKS[blockId];
        double offsetX = (Noise.hashFloat(x, 1, z, 131) - 0.5) * 0.3;
        double offsetZ = (Noise.hashFloat(x, 2, z, 131) - 0.5) * 0.3;
        double height = 0.86 + Noise.hashFloat(x, 3, z, 131) * 0.18;
        double light = skyLight(world, x, y, z, columnTop) * (0.9 + Noise.hashFloat(x, y, z, 991) * 0.16);
        int color = block.color("side");

        double[][] firstCorners = {
            {0, 0, 0.5}, {1, 0, 0.5}, {1, height, 0.5}, {0, height, 0.5},
        };
        double[][] secondCorners = {
            {0.5, 0, 1}, {0.5, 0, 0}, {0.5, height, 0}, {0.5, height, 1},
        };
        faces.add(plantFace("plant", firstCorners, color, light, new int[]{0, 0, 1}, blockId, x, y, z, offsetX, offsetZ));
        faces.add(plantFace("plant", secondCorners, color, light, new int[]{1, 0, 0}, blockId, x, y, z, offsetX, offsetZ));
    }

    private static Face plantFace(String kind, double[][] corners, int color, double shade, int[] normal,
                                  int block, int x, int y, int z, double offsetX, double offsetZ) {
        double[][] points = new double[4][3];
        for (int i = 0; i < 4; i++) {
            points[i] = new double[]{x + corners[i][0] + offsetX, y + corners[i][1], z + corners[i][2] + offsetZ};
        }
        return new Face(kind, points, color, shade, normal, block);
    }

    /** How many faces of each kind a mesh holds. */
    static Map<String, Integer> countFaces(List<Face> faces) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        counts.put("opaque", 0);
        counts.put("water", 0);
        counts.put("cutout", 0);
        counts.put("plant", 0);
        for (Face face : faces) counts.put(face.kind, counts.get(face.kind) + 1);
        return counts;
    }
}
