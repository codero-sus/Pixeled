package com.pixeled.rockz;

/**
 * The block palette — the Java twin of every other edition.
 *
 * Every block carries the colours its faces are drawn with (baked from the web edition's procedural
 * atlas) plus the physical flags the world, the mesher and the interface need.
 */
public final class Blocks {

    private Blocks() {}

    public static final int CHUNK_SIZE = 16;
    public static final int WORLD_HEIGHT = 96;
    public static final int SEA_LEVEL = 38;

    public static final int AIR = 0;
    public static final int GRASS = 1;
    public static final int DIRT = 2;
    public static final int STONE = 3;
    public static final int COBBLESTONE = 4;
    public static final int SAND = 5;
    public static final int SANDSTONE = 6;
    public static final int OAK_LOG = 7;
    public static final int LEAVES = 8;
    public static final int PLANKS = 9;
    public static final int WATER = 10;
    public static final int SNOW = 11;
    public static final int GLASS = 12;
    public static final int BRICKS = 13;
    public static final int CACTUS = 14;
    public static final int GLOWSTONE = 15;
    public static final int TALL_GRASS = 16;
    public static final int RED_FLOWER = 17;
    public static final int YELLOW_FLOWER = 18;

    /** One entry of the block table. */
    public static final class Block {
        public final int id;
        public final String name;
        public final int top;
        public final int side;
        public final int bottom;
        public final boolean liquid;
        public final boolean plant;
        public final boolean cutout;
        public final boolean opaque;
        public final boolean solid;
        public final double hardness;
        public final String material;
        public final int light;

        Block(int id, String name, int top, int side, int bottom, boolean liquid, boolean plant,
              boolean cutout, boolean opaque, boolean solid, double hardness, String material, int light) {
            this.id = id;
            this.name = name;
            this.top = top;
            this.side = side;
            this.bottom = bottom;
            this.liquid = liquid;
            this.plant = plant;
            this.cutout = cutout;
            this.opaque = opaque;
            this.solid = solid;
            this.hardness = hardness;
            this.material = material;
            this.light = light;
        }

        /** Colour of the top, side or bottom face, as an RGB integer. */
        public int color(String face) {
            int tile = face.equals("top") ? top : face.equals("bottom") ? bottom : side;
            return TILE_COLORS[tile % TILE_COLORS.length];
        }
    }

    /** Average colour of each atlas tile in the web edition, so all editions look like one game. */
    public static final int[] TILE_COLORS = {
        0x7bbb55, 0x827e45, 0x87593c, 0x8d8d8d, 0x7d7d7d, 0xe2d8a7, 0xdccf9b, 0xd9cb98,
        0xa97a46, 0x725532, 0x438238, 0xaa824c, 0x3b7ed8, 0xf1f6fb, 0xb39a8b, 0xc3dfeb,
        0xbb9283, 0x508c3c, 0x4f853c, 0xdfad53, 0x59a545, 0x977f40, 0xa1b148, 0xffffff,
    };

    public static final Block[] BLOCKS = build();

    private static Block[] build() {
        Block[] table = new Block[19];
        table[0] = new Block(0, "Air", 0, 0, 0, false, false, false, false, false, 0, "", 0);
        table[1] = new Block(1, "Grass", 0, 1, 2, false, false, false, true, true, 0.6, "dirt", 0);
        table[2] = new Block(2, "Dirt", 2, 2, 2, false, false, false, true, true, 0.5, "dirt", 0);
        table[3] = new Block(3, "Stone", 3, 3, 3, false, false, false, true, true, 1.5, "stone", 0);
        table[4] = new Block(4, "Cobblestone", 4, 4, 4, false, false, false, true, true, 1.6, "stone", 0);
        table[5] = new Block(5, "Sand", 5, 5, 5, false, false, false, true, true, 0.5, "sand", 0);
        table[6] = new Block(6, "Sandstone", 6, 7, 7, false, false, false, true, true, 0.9, "stone", 0);
        table[7] = new Block(7, "Oak Log", 8, 9, 9, false, false, false, true, true, 1.4, "wood", 0);
        table[8] = new Block(8, "Leaves", 10, 10, 10, false, false, true, false, true, 0.25, "plant", 0);
        table[9] = new Block(9, "Planks", 11, 11, 11, false, false, false, true, true, 1.2, "wood", 0);
        table[10] = new Block(10, "Water", 12, 12, 12, true, false, false, false, false, 0, "water", 0);
        table[11] = new Block(11, "Snow", 13, 14, 2, false, false, false, true, true, 0.4, "snow", 0);
        table[12] = new Block(12, "Glass", 15, 15, 15, false, false, true, false, true, 0.3, "glass", 0);
        table[13] = new Block(13, "Bricks", 16, 16, 16, false, false, false, true, true, 1.6, "stone", 0);
        table[14] = new Block(14, "Cactus", 17, 18, 18, false, false, false, true, true, 0.4, "plant", 0);
        table[15] = new Block(15, "Glowstone", 19, 19, 19, false, false, false, true, true, 0.6, "stone", 14);
        table[16] = new Block(16, "Tall Grass", 20, 20, 20, false, true, true, false, false, 0.05, "plant", 0);
        table[17] = new Block(17, "Red Flower", 21, 21, 21, false, true, true, false, false, 0.05, "plant", 0);
        table[18] = new Block(18, "Yellow Flower", 22, 22, 22, false, true, true, false, false, 0.05, "plant", 0);
        return table;
    }

    /** Two pages of nine blocks, exactly like the web hotbar. */
    public static final int[][] HOTBAR_PAGES = {
        {GRASS, DIRT, STONE, COBBLESTONE, SAND, SANDSTONE, OAK_LOG, LEAVES, PLANKS},
        {SNOW, GLASS, BRICKS, CACTUS, GLOWSTONE, TALL_GRASS, RED_FLOWER, YELLOW_FLOWER, WATER},
    };

    /** How bright each face of a cube is drawn, before ambient occlusion and daylight. */
    public static final double FACE_SHADE_TOP = 1.0;
    public static final double FACE_SHADE_BOTTOM = 0.52;
    public static final double FACE_SHADE_Z = 0.78;
    public static final double FACE_SHADE_X = 0.78;

    public static boolean isSolid(int block) { return BLOCKS[block].solid; }
    public static boolean isOpaque(int block) { return BLOCKS[block].opaque; }
    public static boolean isLiquid(int block) { return BLOCKS[block].liquid; }
    public static boolean isPlant(int block) { return BLOCKS[block].plant; }
    public static String nameOf(int block) { return BLOCKS[block].name; }
    public static double hardnessOf(int block) { return BLOCKS[block].hardness; }
}
