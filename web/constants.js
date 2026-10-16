/**
 * Shared tuning constants and the block palette for the 3D voxel edition.
 *
 * Colours are stored twice: as normalized RGB for the GPU (top/side/bottom faces get their own
 * tint, which is what gives blocks their Minecraft-like read) and as hex for the HTML hotbar.
 */

export const WORLD_X = 128;
export const WORLD_Y = 64;
export const WORLD_Z = 128;
export const CHUNK = 16;
export const CHUNKS_X = WORLD_X / CHUNK;
export const CHUNKS_Z = WORLD_Z / CHUNK;
export const SEA_LEVEL = 20;

export const GRAVITY = 30;
export const JUMP_SPEED = 9.2;
export const WALK_SPEED = 4.6;
export const SPRINT_SPEED = 7.4;
export const FLY_SPEED = 11;
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
export const REACH = 6.5;
export const MOUSE_SENSITIVITY = 0.0022;

function rgb(hex) {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

function block(id, name, hex, options = {}) {
  const top = rgb(options.top ?? hex);
  return {
    id,
    name,
    hex,
    swatch: options.swatch ?? hex,
    top,
    side: rgb(options.side ?? hex),
    bottom: rgb(options.bottom ?? options.side ?? hex),
    solid: options.solid ?? true,
    liquid: options.liquid ?? false,
    transparent: options.transparent ?? false,
    placeable: options.placeable ?? true,
    alpha: options.alpha ?? 1,
    // seconds to mine by hand (0 = instantly, Infinity = unbreakable)
    hardness: options.hardness ?? 0.55,
    // which synthesised sound the block uses when dug or placed
    sound: options.sound ?? 'stone',
    // a plant is drawn as crossed quads and never blocks movement
    plant: options.plant ?? false,
    // colour multiplied into the biome tint of this block
    tint: options.tint ?? null,
    // how much light this block pours into the world (0 = none, 15 = daylight)
    light: options.light ?? 0,
    // sand, gravel and the like fall when the ground under them disappears
    falling: options.falling ?? false,
    // damaging blocks, e.g. lava
    damage: options.damage ?? 0,
    // how much of the cell blocks movement and can be stood on (1 = a full cube)
    fraction: options.fraction ?? 1,
    // the shape the mesher emits: cube, slab, stairs, fence, pane, ladder, door, chest, bed
    shape: options.shape ?? 'cube',
    // blocks you can climb, like a ladder
    climbable: options.climbable ?? false,
    // opens and closes (doors), or holds things (chests)
    interactive: options.interactive ?? null,
  };
}

/** Block ids 0-10 are stable across every edition of the game; 11+ are web-edition extras. */
export const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, LEAVES = 6, SNOW = 7, PLANKS = 8, GLASS = 9, WATER = 10;
export const COAL_ORE = 11, IRON_ORE = 12, GOLD_ORE = 13, DIAMOND_ORE = 14, GRAVEL = 15, CLAY = 16,
  CACTUS = 17, TALL_GRASS = 18, FLOWER = 19, ICE = 20, SANDSTONE = 21, SPRUCE_LOG = 22, SPRUCE_LEAVES = 23,
  BIRCH_LOG = 24, BIRCH_LEAVES = 25, COBBLESTONE = 26, MOSSY_STONE = 27, OBSIDIAN = 28, PUMPKIN = 29,
  LAVA = 30, TORCH = 31, SAPLING = 32, SMOOTH_STONE = 33, STONE_BRICKS = 34, IRON_BLOCK = 35,
  GOLD_BLOCK = 36, DIAMOND_BLOCK = 37, BIRCH_PLANKS = 38, SPRUCE_PLANKS = 39, GLASS_PANE = 40,
  FENCE = 41, LADDER = 42, DOOR = 43, CHEST = 44, BED = 45, SLAB = 46, STAIRS = 47, BOOKSHELF = 48;

export const BLOCKS = [
  block(GRASS, 'Grass', '#79c05a', { top: '#79c05a', side: '#8f7f4a', bottom: '#8a5a3b', swatch: '#79c05a', hardness: 0.5, sound: 'grass', tint: 'grass' }),
  block(DIRT, 'Dirt', '#8a5a3b', { top: '#96654a', side: '#8a5a3b', bottom: '#7d5136', hardness: 0.45, sound: 'dirt' }),
  block(STONE, 'Stone', '#9aa0a6', { top: '#a6adb3', side: '#9aa0a6', bottom: '#8d949a', hardness: 1.5, sound: 'stone' }),
  block(SAND, 'Sand', '#e6d7a0', { top: '#efe3b0', side: '#e6d7a0', bottom: '#d8c68f', hardness: 0.4, sound: 'sand', falling: true }),
  block(LOG, 'Log', '#7f5a35', { top: '#b08a52', side: '#7f5a35', bottom: '#b08a52', hardness: 1.1, sound: 'wood' }),
  block(LEAVES, 'Leaves', '#4f9c47', { top: '#5fae52', side: '#4f9c47', bottom: '#3f843c', hardness: 0.2, sound: 'grass', tint: 'foliage' }),
  block(SNOW, 'Snow', '#f2f7fb', { top: '#ffffff', side: '#eaf2f8', bottom: '#d7e3ec', hardness: 0.35, sound: 'snow' }),
  block(PLANKS, 'Planks', '#b9854b', { top: '#c79357', side: '#b9854b', bottom: '#a9763f', hardness: 1.0, sound: 'wood' }),
  block(GLASS, 'Glass', '#cfe8f2', { top: '#dff2f8', side: '#cfe8f2', bottom: '#cfe8f2', transparent: true, alpha: 0.45, swatch: '#9fd0e0', hardness: 0.3, sound: 'glass' }),
  block(WATER, 'Water', '#2f74d0', { top: '#4b8fe0', side: '#2f74d0', bottom: '#245aa8', solid: false, liquid: true, transparent: true, placeable: false, alpha: 0.72, hardness: Infinity, sound: 'water' }),
  block(COAL_ORE, 'Coal ore', '#4a4a4f', { top: '#565660', side: '#4a4a4f', bottom: '#3f3f46', hardness: 1.8, sound: 'stone', swatch: '#3a3a40' }),
  block(IRON_ORE, 'Iron ore', '#c9a184', { top: '#d8b096', side: '#c9a184', bottom: '#b58f74', hardness: 2.2, sound: 'stone', swatch: '#c9a184' }),
  block(GOLD_ORE, 'Gold ore', '#e8c351', { top: '#f2d066', side: '#e8c351', bottom: '#d1ad42', hardness: 2.4, sound: 'stone', swatch: '#e8c351' }),
  block(DIAMOND_ORE, 'Diamond ore', '#6fe3dc', { top: '#8df0e9', side: '#6fe3dc', bottom: '#5cccc6', hardness: 2.8, sound: 'stone', swatch: '#6fe3dc', light: 4 }),
  block(GRAVEL, 'Gravel', '#8d8a86', { top: '#9b9894', side: '#8d8a86', bottom: '#7c7975', hardness: 0.5, sound: 'gravel', falling: true }),
  block(CLAY, 'Clay', '#a7b1bd', { top: '#b4bdc8', side: '#a7b1bd', bottom: '#96a0ac', hardness: 0.6, sound: 'dirt' }),
  block(CACTUS, 'Cactus', '#4f8f45', { top: '#5aa04c', side: '#4f8f45', bottom: '#427a3a', hardness: 0.4, sound: 'grass', swatch: '#4f8f45' }),
  block(TALL_GRASS, 'Tall grass', '#6fae54', { top: '#6fae54', side: '#6fae54', solid: false, transparent: true, plant: true, hardness: 0, sound: 'grass', tint: 'grass', swatch: '#6fae54' }),
  block(FLOWER, 'Flower', '#e0698f', { top: '#e0698f', side: '#e0698f', solid: false, transparent: true, plant: true, hardness: 0, sound: 'grass', swatch: '#e0698f' }),
  block(ICE, 'Ice', '#a8d8f0', { top: '#c2e6f7', side: '#a8d8f0', bottom: '#96c8e2', transparent: true, alpha: 0.72, hardness: 0.6, sound: 'glass', swatch: '#a8d8f0' }),
  block(SANDSTONE, 'Sandstone', '#d9c88f', { top: '#e4d69c', side: '#d9c88f', bottom: '#c9b87f', hardness: 1.4, sound: 'stone' }),
  block(SPRUCE_LOG, 'Spruce log', '#5d4630', { top: '#8a6b46', side: '#5d4630', bottom: '#8a6b46', hardness: 1.1, sound: 'wood' }),
  block(SPRUCE_LEAVES, 'Spruce needles', '#37693f', { top: '#3f7647', side: '#37693f', bottom: '#2d5836', hardness: 0.2, sound: 'grass', tint: 'foliage' }),
  block(BIRCH_LOG, 'Birch log', '#d6cbb4', { top: '#e8dfcb', side: '#d6cbb4', bottom: '#e8dfcb', hardness: 1.0, sound: 'wood' }),
  block(BIRCH_LEAVES, 'Birch leaves', '#6fae4f', { top: '#7cbd58', side: '#6fae4f', bottom: '#5d9a44', hardness: 0.2, sound: 'grass', tint: 'foliage' }),
  block(COBBLESTONE, 'Cobblestone', '#8b8f93', { top: '#979b9f', side: '#8b8f93', bottom: '#7d8185', hardness: 1.7, sound: 'stone' }),
  block(MOSSY_STONE, 'Mossy stone', '#7d8c72', { top: '#8a9a7d', side: '#7d8c72', bottom: '#6f7d66', hardness: 1.7, sound: 'stone' }),
  block(OBSIDIAN, 'Obsidian', '#2b2135', { top: '#362a42', side: '#2b2135', bottom: '#231a2b', hardness: 3.4, sound: 'stone', swatch: '#3c2f4a' }),
  block(PUMPKIN, 'Pumpkin', '#d98a2b', { top: '#e09a3d', side: '#d98a2b', bottom: '#c07a24', hardness: 0.9, sound: 'wood', falling: true }),
  block(LAVA, 'Lava', '#ff7a2f', { top: '#ffa245', side: '#ff7a2f', bottom: '#e05a1c', solid: false, liquid: true, transparent: false, placeable: false, hardness: Infinity, sound: 'water', light: 12, damage: 1 }),
  block(TORCH, 'Torch', '#ffcf7a', { top: '#ffe6a8', side: '#e0a94f', bottom: '#a9762f', solid: false, transparent: true, plant: true, hardness: 0.05, sound: 'wood', light: 14, swatch: '#ffcf7a' }),
  block(SAPLING, 'Sapling', '#6dbb54', { top: '#7ecb62', side: '#6dbb54', bottom: '#5aa246', solid: false, transparent: true, plant: true, hardness: 0.05, sound: 'grass', tint: 'grass', swatch: '#6dbb54' }),
  block(SMOOTH_STONE, 'Smooth stone', '#b7bcc2', { top: '#c3c8ce', side: '#b7bcc2', bottom: '#a9aeb4', hardness: 1.5, sound: 'stone' }),
  block(STONE_BRICKS, 'Stone bricks', '#a6abb1', { top: '#b2b7bd', side: '#a6abb1', bottom: '#989da3', hardness: 1.6, sound: 'stone' }),
  block(IRON_BLOCK, 'Iron block', '#d8d3cb', { top: '#e6e1d9', side: '#d8d3cb', bottom: '#c6c1b9', hardness: 2.4, sound: 'stone' }),
  block(GOLD_BLOCK, 'Gold block', '#f0ce55', { top: '#f7dc72', side: '#f0ce55', bottom: '#dcba46', hardness: 2.4, sound: 'stone' }),
  block(DIAMOND_BLOCK, 'Diamond block', '#79e7e0', { top: '#93f2ec', side: '#79e7e0', bottom: '#63d3cc', hardness: 2.6, sound: 'stone', light: 6 }),
  block(BIRCH_PLANKS, 'Birch planks', '#dcc9a0', { top: '#e8d8b2', side: '#dcc9a0', bottom: '#cbb890', hardness: 1.0, sound: 'wood' }),
  block(SPRUCE_PLANKS, 'Spruce planks', '#8a6a45', { top: '#9a7850', side: '#8a6a45', bottom: '#7a5c3c', hardness: 1.0, sound: 'wood' }),
  block(GLASS_PANE, 'Glass pane', '#d8eef7', { top: '#e6f6fb', side: '#d8eef7', bottom: '#d8eef7', transparent: true, alpha: 0.42, shape: 'pane', hardness: 0.3, sound: 'glass', swatch: '#a8d8e8' }),
  block(FENCE, 'Fence', '#b9854b', { top: '#c79357', side: '#b9854b', bottom: '#a9763f', shape: 'fence', hardness: 1.0, sound: 'wood' }),
  block(LADDER, 'Ladder', '#a97c46', { top: '#bb8b52', side: '#a97c46', bottom: '#8f6839', solid: false, transparent: true, shape: 'ladder', climbable: true, hardness: 0.4, sound: 'wood' }),
  block(DOOR, 'Door', '#bd8a4e', { top: '#c9995c', side: '#bd8a4e', bottom: '#a8783f', transparent: true, shape: 'door', interactive: 'door', hardness: 0.9, sound: 'wood' }),
  block(CHEST, 'Chest', '#a9762f', { top: '#c08a3c', side: '#a9762f', bottom: '#8f6427', shape: 'chest', interactive: 'chest', hardness: 0.9, sound: 'wood' }),
  block(BED, 'Bed', '#c0392b', { top: '#d9d0c4', side: '#c0392b', bottom: '#8e2b20', shape: 'bed', fraction: 0.62, interactive: 'bed', hardness: 0.5, sound: 'cloth' }),
  block(SLAB, 'Stone slab', '#b7bcc2', { top: '#c3c8ce', side: '#b7bcc2', bottom: '#a9aeb4', shape: 'slab', fraction: 0.5, hardness: 1.4, sound: 'stone' }),
  block(STAIRS, 'Stone stairs', '#b7bcc2', { top: '#c3c8ce', side: '#b7bcc2', bottom: '#a9aeb4', shape: 'stairs', fraction: 0.5, hardness: 1.4, sound: 'stone' }),
  block(BOOKSHELF, 'Bookshelf', '#9c7742', { top: '#b08a52', side: '#9c7742', bottom: '#8a6739', hardness: 1.0, sound: 'wood', swatch: '#b9895a' }),
];

/** The nine blocks a player can place, in hotbar order. */
export const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, LEAVES, SNOW, PLANKS, GLASS];

export const ORES = [COAL_ORE, IRON_ORE, GOLD_ORE, DIAMOND_ORE];
export const PLANTS = [TALL_GRASS, FLOWER];

/** Everything that can be placed, for the creative palette in the menu. */
export const PALETTE = BLOCKS.filter(entry => entry.placeable).map(entry => entry.id);

/** How far a block pours light: torches light a room, lava glows, diamond glints. */
export const LIGHT_SOURCES = Object.fromEntries(
  BLOCKS.filter(entry => entry.light > 0).map(entry => [entry.id, entry.light]),
);

export const MAX_LIGHT = 15;

/** Blocks that glow at night, so a torch-free base is still readable. */
export const EMISSIVE = new Set(BLOCKS.filter(entry => entry.light > 0).map(entry => entry.id));

/** Blocks that fall when unsupported. */
export const FALLING = new Set(BLOCKS.filter(entry => entry.falling).map(entry => entry.id));

/** Shapes that are not full cubes, and how much of the cell they occupy. */
export const SHAPES = Object.fromEntries(BLOCKS.filter(entry => entry.shape !== 'cube').map(entry => [entry.id, entry.shape]));

/** Blocks you can climb. */
export const CLIMBABLE = new Set(BLOCKS.filter(entry => entry.climbable).map(entry => entry.id));

/** Blocks that open, close or hold things. */
export const INTERACTIVE = Object.fromEntries(BLOCKS.filter(entry => entry.interactive).map(entry => [entry.id, entry.interactive]));

/** Blocks that hurt to stand in. */
export const DAMAGING = new Map(BLOCKS.filter(entry => entry.damage > 0).map(entry => [entry.id, entry.damage]));

export function lightOf(id) { return blockById(id).light ?? 0; }

/**
 * Crafting recipes. Each one names what it makes and what it costs, so the panel can show the
 * recipe book and the craft button can spend from the inventory.
 */
export const RECIPES = [
  { out: PLANKS, count: 4, needs: [[LOG, 1]], label: 'Oak planks from a log' },
  { out: BIRCH_PLANKS, count: 4, needs: [[BIRCH_LOG, 1]], label: 'Birch planks from a birch log' },
  { out: SPRUCE_PLANKS, count: 4, needs: [[SPRUCE_LOG, 1]], label: 'Spruce planks from a spruce log' },
  { out: STONE_BRICKS, count: 4, needs: [[SMOOTH_STONE, 4]], label: 'Stone bricks from smooth stone' },
  { out: SMOOTH_STONE, count: 1, needs: [[COBBLESTONE, 1]], label: 'Smooth stone from cobblestone' },
  { out: GLASS, count: 1, needs: [[SAND, 1], [COAL_ORE, 1]], label: 'Glass from sand and coal' },
  { out: GLASS_PANE, count: 8, needs: [[GLASS, 3]], label: 'Panes from glass' },
  { out: IRON_BLOCK, count: 1, needs: [[IRON_ORE, 4]], label: 'Iron block from iron ore' },
  { out: GOLD_BLOCK, count: 1, needs: [[GOLD_ORE, 4]], label: 'Gold block from gold ore' },
  { out: DIAMOND_BLOCK, count: 1, needs: [[DIAMOND_ORE, 4]], label: 'Diamond block from diamond ore' },
  { out: TORCH, count: 4, needs: [[LOG, 1], [COAL_ORE, 1]], label: 'Four torches from a log and coal' },
  { out: SLAB, count: 2, needs: [[SMOOTH_STONE, 1]], label: 'Two slabs from smooth stone' },
  { out: STAIRS, count: 2, needs: [[SMOOTH_STONE, 2]], label: 'Two stairs from smooth stone' },
  { out: FENCE, count: 3, needs: [[LOG, 1], [PLANKS, 2]], label: 'Three fences from a log and planks' },
  { out: LADDER, count: 3, needs: [[PLANKS, 3]], label: 'Three ladders from planks' },
  { out: DOOR, count: 1, needs: [[PLANKS, 4]], label: 'A door from four planks' },
  { out: CHEST, count: 1, needs: [[PLANKS, 6]], label: 'A chest from six planks' },
  { out: BOOKSHELF, count: 1, needs: [[PLANKS, 4], [SAPLING, 4]], label: 'A bookshelf from planks and saplings' },
  { out: BED, count: 1, needs: [[PLANKS, 4], [LEAVES, 6]], label: 'A bed from planks and leaves' },
];

/** Air is a real block for lookups, but it is never in the hotbar. */
export const AIR_BLOCK = {
  id: 0, name: 'Air', hex: '#000000', swatch: '#000000',
  top: [0, 0, 0], side: [0, 0, 0], bottom: [0, 0, 0],
  solid: false, liquid: false, transparent: true, placeable: false, alpha: 0,
};

export function blockById(id) {
  if (id <= 0) return AIR_BLOCK;
  return BLOCKS[id - 1] ?? BLOCKS[0];
}

/** True for anything that lets light through: air, water, glass or a plant. */
export function isTransparent(id) {
  return id === AIR || blockById(id).transparent;
}

/** Seconds needed to break a block by hand (Infinity for bedrock and water). */
export function hardnessOf(id) {
  return blockById(id).hardness;
}

/** Faces: CCW corner order seen from outside, plus the two in-plane axes used for ambient occlusion. */
export const FACES = [
  { normal: [1, 0, 0], origin: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.72 },
  { normal: [-1, 0, 0], origin: [0, 0, 1], u: [0, 0, -1], v: [0, 1, 0], shade: 0.72 },
  { normal: [0, 1, 0], origin: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 1.0 },
  { normal: [0, -1, 0], origin: [0, 0, 1], u: [1, 0, 0], v: [0, 0, -1], shade: 0.5 },
  { normal: [0, 0, 1], origin: [1, 0, 1], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.86 },
  { normal: [0, 0, -1], origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], shade: 0.86 },
];

export const CORNER_ORDER = [[0, 0], [0, 1], [1, 1], [1, 0]];
export const AO_LEVELS = [1.0, 0.78, 0.62, 0.48];
