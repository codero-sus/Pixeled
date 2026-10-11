/**
 * Shared constants for the 3D edition: world metrics, the block table and the texture atlas layout.
 *
 * Blocks are described once here and consumed everywhere else: the generator picks them by id, the
 * mesher asks for their per-face atlas tiles and flags, the UI draws their icons and the audio
 * module uses their material group.
 */

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 96;
export const SEA_LEVEL = 38;

export const TILE_PIXELS = 16;
export const ATLAS_COLUMNS = 16;
export const ATLAS_ROWS = 16;
export const ATLAS_PIXELS = TILE_PIXELS * ATLAS_COLUMNS;

export const SAVE_KEY = 'pixeled3d-world-v1';
export const SETTINGS_KEY = 'pixeled3d-settings-v1';

/** Atlas tile indices, laid out left-to-right / top-to-bottom in the 16x16 tile sheet. */
export const TILES = {
  grass_top: 0,
  grass_side: 1,
  dirt: 2,
  stone: 3,
  cobblestone: 4,
  sand: 5,
  sandstone_top: 6,
  sandstone_side: 7,
  log_top: 8,
  log_side: 9,
  leaves: 10,
  planks: 11,
  water: 12,
  snow_top: 13,
  snow_side: 14,
  glass: 15,
  brick: 16,
  cactus_top: 17,
  cactus_side: 18,
  glowstone: 19,
  tall_grass: 20,
  flower_red: 21,
  flower_yellow: 22,
  cloud: 23,
};

const face = (top, side, bottom = side) => ({ top, side, bottom });

/**
 * Every block in the game.
 *
 * opaque   – hides the neighbouring face (used for face culling and ambient occlusion)
 * solid    – stops the player
 * cutout   – uses the alpha-tested material
 * plant    – drawn as crossed quads instead of a cube
 * hardness – seconds of holding the mouse to break it in survival mode
 */
export const BLOCKS = [
  { id: 0, name: 'Air', tiles: face(0, 0, 0) },
  { id: 1, name: 'Grass', tiles: face(TILES.grass_top, TILES.grass_side, TILES.dirt), opaque: true, solid: true, hardness: .6 },
  { id: 2, name: 'Dirt', tiles: face(TILES.dirt, TILES.dirt), opaque: true, solid: true, hardness: .5 },
  { id: 3, name: 'Stone', tiles: face(TILES.stone, TILES.stone), opaque: true, solid: true, hardness: 1.5, material: 'stone' },
  { id: 4, name: 'Cobblestone', tiles: face(TILES.cobblestone, TILES.cobblestone), opaque: true, solid: true, hardness: 1.6, material: 'stone' },
  { id: 5, name: 'Sand', tiles: face(TILES.sand, TILES.sand), opaque: true, solid: true, hardness: .5, material: 'sand' },
  { id: 6, name: 'Sandstone', tiles: face(TILES.sandstone_top, TILES.sandstone_side), opaque: true, solid: true, hardness: .9, material: 'stone' },
  { id: 7, name: 'Oak Log', tiles: face(TILES.log_top, TILES.log_side), opaque: true, solid: true, hardness: 1.4, material: 'wood' },
  { id: 8, name: 'Leaves', tiles: face(TILES.leaves, TILES.leaves), solid: true, cutout: true, hardness: .25, material: 'plant' },
  { id: 9, name: 'Planks', tiles: face(TILES.planks, TILES.planks), opaque: true, solid: true, hardness: 1.2, material: 'wood' },
  { id: 10, name: 'Water', tiles: face(TILES.water, TILES.water), liquid: true, hardness: 0 },
  { id: 11, name: 'Snow', tiles: face(TILES.snow_top, TILES.snow_side, TILES.dirt), opaque: true, solid: true, hardness: .4, material: 'snow' },
  { id: 12, name: 'Glass', tiles: face(TILES.glass, TILES.glass), solid: true, cutout: true, hardness: .3, material: 'glass' },
  { id: 13, name: 'Bricks', tiles: face(TILES.brick, TILES.brick), opaque: true, solid: true, hardness: 1.6, material: 'stone' },
  { id: 14, name: 'Cactus', tiles: face(TILES.cactus_top, TILES.cactus_side), opaque: true, solid: true, hardness: .4, material: 'plant' },
  { id: 15, name: 'Glowstone', tiles: face(TILES.glowstone, TILES.glowstone), opaque: true, solid: true, hardness: .6, light: true, material: 'stone' },
  { id: 16, name: 'Tall Grass', tiles: face(TILES.tall_grass, TILES.tall_grass), plant: true, cutout: true, hardness: .05, material: 'plant' },
  { id: 17, name: 'Red Flower', tiles: face(TILES.flower_red, TILES.flower_red), plant: true, cutout: true, hardness: .05, material: 'plant' },
  { id: 18, name: 'Yellow Flower', tiles: face(TILES.flower_yellow, TILES.flower_yellow), plant: true, cutout: true, hardness: .05, material: 'plant' },
];

/** Fast lookup tables built from BLOCKS so the hot paths stay array indexing. */
export const BLOCK_NAMES = BLOCKS.map(b => b.name);
export const IS_OPAQUE = BLOCKS.map(b => !!b.opaque);
export const IS_SOLID = BLOCKS.map(b => !!b.solid);
export const IS_LIQUID = BLOCKS.map(b => !!b.liquid);
export const IS_PLANT = BLOCKS.map(b => !!b.plant);
export const IS_CUTOUT = BLOCKS.map(b => !!b.cutout);
export const HARDNESS = BLOCKS.map(b => b.hardness ?? 1);
export const LIGHT_BLOCKS = BLOCKS.map(b => !!b.light);

export const HOTBAR_PAGES = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9],
  [11, 12, 13, 14, 15, 16, 17, 18, 10],
];

export const DEFAULT_SETTINGS = {
  renderDistance: 6,
  fov: 78,
  sensitivity: 0.0022,
  sound: true,
  creative: true,
  dayCycle: true,
  timeOfDay: 0.30,
  dayLength: 900,
};

/** Face shading used on top of the texture: top brightest, bottom darkest, like classic Minecraft. */
export const FACE_SHADE = { top: 1.0, side: 0.78, bottom: 0.52 };
