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
  };
}

/** Block ids are stable across every edition of the game. */
export const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5, LEAVES = 6, SNOW = 7, PLANKS = 8, GLASS = 9, WATER = 10;

export const BLOCKS = [
  block(GRASS, 'Grass', '#79c05a', { top: '#79c05a', side: '#8f7f4a', bottom: '#8a5a3b', swatch: '#79c05a' }),
  block(DIRT, 'Dirt', '#8a5a3b', { top: '#96654a', side: '#8a5a3b', bottom: '#7d5136' }),
  block(STONE, 'Stone', '#9aa0a6', { top: '#a6adb3', side: '#9aa0a6', bottom: '#8d949a' }),
  block(SAND, 'Sand', '#e6d7a0', { top: '#efe3b0', side: '#e6d7a0', bottom: '#d8c68f' }),
  block(LOG, 'Log', '#7f5a35', { top: '#b08a52', side: '#7f5a35', bottom: '#b08a52' }),
  block(LEAVES, 'Leaves', '#4f9c47', { top: '#5fae52', side: '#4f9c47', bottom: '#3f843c' }),
  block(SNOW, 'Snow', '#f2f7fb', { top: '#ffffff', side: '#eaf2f8', bottom: '#d7e3ec' }),
  block(PLANKS, 'Planks', '#b9854b', { top: '#c79357', side: '#b9854b', bottom: '#a9763f' }),
  block(GLASS, 'Glass', '#cfe8f2', { top: '#dff2f8', side: '#cfe8f2', bottom: '#cfe8f2', transparent: true, alpha: 0.45, swatch: '#9fd0e0' }),
  block(WATER, 'Water', '#2f74d0', { top: '#4b8fe0', side: '#2f74d0', bottom: '#245aa8', solid: false, liquid: true, transparent: true, placeable: false, alpha: 0.72 }),
];

/** The nine blocks a player can place, in hotbar order. */
export const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, LEAVES, SNOW, PLANKS, GLASS];

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
