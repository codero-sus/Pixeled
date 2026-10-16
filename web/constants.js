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
  };
}

/** Block ids 0-10 are stable across every edition of the game; 11+ are web-edition extras. */
export const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, LEAVES = 6, SNOW = 7, PLANKS = 8, GLASS = 9, WATER = 10;
export const COAL_ORE = 11, IRON_ORE = 12, GOLD_ORE = 13, DIAMOND_ORE = 14, GRAVEL = 15, CLAY = 16,
  CACTUS = 17, TALL_GRASS = 18, FLOWER = 19, ICE = 20, SANDSTONE = 21, SPRUCE_LOG = 22, SPRUCE_LEAVES = 23,
  BIRCH_LOG = 24, BIRCH_LEAVES = 25, COBBLESTONE = 26, MOSSY_STONE = 27, OBSIDIAN = 28, PUMPKIN = 29,
  LAVA = 30, TORCH = 31, SAPLING = 32;

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

/** Blocks that hurt to stand in. */
export const DAMAGING = new Map(BLOCKS.filter(entry => entry.damage > 0).map(entry => [entry.id, entry.damage]));

export function lightOf(id) { return blockById(id).light ?? 0; }

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
