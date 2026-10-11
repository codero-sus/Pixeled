/**
 * The texture atlas: 16x16 tiles of hand-written pixel art generated at runtime.
 *
 * Nothing is downloaded — every texture is painted procedurally into an RGBA buffer, which keeps
 * the edition self-contained and makes the art testable (and previewable) outside the browser.
 *
 * `paintAtlas` works on a plain pixel buffer, so Node can render it without a DOM;
 * `createAtlasCanvas` is the thin browser wrapper that turns it into a canvas for three.js.
 */

import { ATLAS_COLUMNS, ATLAS_PIXELS, ATLAS_ROWS, TILES, TILE_PIXELS } from './constants.js';
import { mulberry32 } from './noise.js';

const rgb = hex => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Small painter that knows its tile origin and writes straight into the atlas buffer. */
class TilePainter {
  constructor(data, tile) {
    this.data = data;
    this.ox = (tile % ATLAS_COLUMNS) * TILE_PIXELS;
    this.oy = Math.floor(tile / ATLAS_COLUMNS) * TILE_PIXELS;
    this.random = mulberry32(0x9e3779b9 ^ (tile * 2654435761));
  }

  pixel(x, y, color, alpha = 255) {
    if (x < 0 || y < 0 || x >= TILE_PIXELS || y >= TILE_PIXELS) return;
    const [r, g, b] = Array.isArray(color) ? color : rgb(color);
    const offset = ((this.oy + y) * ATLAS_PIXELS + (this.ox + x)) * 4;
    this.data[offset] = r;
    this.data[offset + 1] = g;
    this.data[offset + 2] = b;
    this.data[offset + 3] = alpha;
  }

  fill(color, alpha = 255) {
    for (let y = 0; y < TILE_PIXELS; y++) for (let x = 0; x < TILE_PIXELS; x++) this.pixel(x, y, color, alpha);
  }

  clear() { this.fill([0, 0, 0], 0); }

  rect(x, y, w, h, color, alpha = 255) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.pixel(xx, yy, color, alpha);
  }

  /** Scatter single pixels of a colour, the bread and butter of pixel-art texture. */
  speckle(color, count, alpha = 255) {
    for (let i = 0; i < count; i++) {
      this.pixel(Math.floor(this.random() * TILE_PIXELS), Math.floor(this.random() * TILE_PIXELS), color, alpha);
    }
  }

  /** Every pixel nudged towards one of the given shades: soft, natural-looking grain. */
  grain(shades, chance = 0.5) {
    for (let y = 0; y < TILE_PIXELS; y++) {
      for (let x = 0; x < TILE_PIXELS; x++) {
        if (this.random() < chance) this.pixel(x, y, shades[Math.floor(this.random() * shades.length)]);
      }
    }
  }

  /** Diagonal flecks used by stone and sand to break up flat colour. */
  flecks(color, amount = 6, size = 2) {
    for (let i = 0; i < amount; i++) {
      const x = 2 + Math.floor(this.random() * (TILE_PIXELS - 4));
      const y = 2 + Math.floor(this.random() * (TILE_PIXELS - 4));
      const length = size + Math.floor(this.random() * 3);
      for (let step = 0; step < length; step++) this.pixel(x + step, y + (step % 2), color);
    }
  }
}

/* ------------------------------------------------------------------ individual tiles */

function paintGrassTop(p) {
  p.fill('#7cbd56');
  p.grain(['#74b34f', '#86c95e', '#6aa947', '#8fd066'], 0.55);
  p.speckle('#5f9c3e', 14);
}

function paintDirt(p) {
  p.fill('#8a5a3b');
  p.grain(['#7d4f33', '#96654a', '#744a2f', '#9c6d4e'], 0.6);
  p.speckle('#5f3c26', 12);
}

function paintGrassSide(p) {
  paintDirt(p);
  p.rect(0, 0, TILE_PIXELS, 3, '#7cbd56');
  p.rect(0, 3, TILE_PIXELS, 1, '#6fae4b');
  // Ragged edge so the grass looks like it drips into the dirt.
  for (let x = 0; x < TILE_PIXELS; x += 1) {
    const depth = 1 + Math.floor(p.random() * 3);
    for (let y = 4; y < 4 + depth; y++) p.pixel(x, y, y < 5 ? '#7cbd56' : '#6fae4b');
  }
}

function paintStone(p) {
  p.fill('#8f8f8f');
  p.grain(['#868686', '#9a9a9a', '#7c7c7c', '#a4a4a4'], 0.5);
  p.flecks('#6f6f6f', 5, 3);
  p.flecks('#b0b0b0', 3, 2);
}

function paintCobblestone(p) {
  p.fill('#5f5f5f');
  const cobbles = [
    [1, 1, 6, 5], [8, 1, 7, 4], [1, 7, 4, 4], [6, 6, 5, 5], [12, 6, 3, 4],
    [1, 12, 7, 3], [9, 12, 6, 3], [11, 1, 4, 4], [2, 5, 5, 2], [6, 12, 3, 3],
  ];
  for (const [x, y, w, h] of cobbles) {
    const shade = ['#8c8c8c', '#949494', '#848484', '#9c9c9c'][Math.floor(p.random() * 4)];
    p.rect(x, y, w, h, shade);
    p.rect(x, y, w, 1, '#a8a8a8');
    p.rect(x, y + h - 1, w, 1, '#757575');
  }
  p.speckle('#6a6a6a', 22);
}

function paintSand(p) {
  p.fill('#e3d9a8');
  p.grain(['#dbd09c', '#ece2b3', '#d3c892', '#f0e7bb'], 0.5);
  p.speckle('#c5b983', 12);
}

function paintSandstoneTop(p) {
  p.fill('#e0d3a0');
  p.grain(['#d8ca95', '#e8dcac', '#cdbe88'], 0.4);
  p.speckle('#c2b17c', 10);
}

function paintSandstoneSide(p) {
  p.fill('#ddd09e');
  for (let y = 0; y < TILE_PIXELS; y += 4) p.rect(0, y, TILE_PIXELS, 1, '#c8b982');
  p.grain(['#d5c791', '#e6d9a9'], 0.3);
  p.speckle('#bfae79', 8);
}

function paintLogTop(p) {
  p.fill('#b8874f');
  for (let ring = 7; ring > 0; ring -= 2) {
    const shade = ring % 4 === 3 ? '#a1723f' : '#8c6238';
    for (let angle = 0; angle < 64; angle++) {
      const a = (angle / 64) * Math.PI * 2;
      p.pixel(8 + Math.round(Math.cos(a) * ring * 0.95), 8 + Math.round(Math.sin(a) * ring * 0.95), shade);
    }
  }
  p.pixel(8, 8, '#7c5730');
  p.rect(0, 0, TILE_PIXELS, 1, '#96693c');
}

function paintLogSide(p) {
  p.fill('#7a5a35');
  p.grain(['#6f5230', '#856440', '#684b2b'], 0.4);
  for (const x of [2, 6, 9, 13]) p.rect(x, 0, 1, TILE_PIXELS, '#5f4527');
  for (const x of [4, 11]) p.rect(x, 0, 1, TILE_PIXELS, '#8d6c45');
  p.speckle('#553d22', 14);
}

function paintLeaves(p) {
  p.fill('#3f7a34');
  p.grain(['#37702d', '#488a3c', '#2f6427', '#529b45'], 0.75);
  // Holes so foliage looks airy against the sky.
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(p.random() * TILE_PIXELS);
    const y = Math.floor(p.random() * TILE_PIXELS);
    p.pixel(x, y, [0, 0, 0], 0);
    if (p.random() < 0.4) p.pixel(x + 1, y, [0, 0, 0], 0);
  }
  p.speckle('#63ad52', 16);
}

function paintPlanks(p) {
  p.fill('#b58b52');
  p.grain(['#ab8149', '#c0955b', '#a17943'], 0.35);
  for (const y of [0, 4, 8, 12]) p.rect(0, y, TILE_PIXELS, 1, '#8f6a3c');
  // Staggered end joints, one per plank.
  p.rect(5, 1, 1, 3, '#8f6a3c');
  p.rect(11, 5, 1, 3, '#8f6a3c');
  p.rect(3, 9, 1, 3, '#8f6a3c');
  p.rect(9, 13, 1, 3, '#8f6a3c');
  p.speckle('#c9a268', 12);
}

function paintWater(p) {
  p.fill('#3579d6');
  p.grain(['#3071cc', '#3f86e2', '#2f6cc4'], 0.4);
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(p.random() * TILE_PIXELS);
    const y = Math.floor(p.random() * TILE_PIXELS);
    p.rect(x, y, 3, 1, '#5fa2f0');
  }
  p.speckle('#6fb0f5', 10);
}

function paintSnowTop(p) {
  p.fill('#f4f8fd');
  p.grain(['#eaf1f8', '#ffffff', '#e2ebf4'], 0.45);
  p.speckle('#d7e3ee', 10);
}

function paintSnowSide(p) {
  paintDirt(p);
  p.rect(0, 0, TILE_PIXELS, 5, '#f4f8fd');
  p.rect(0, 5, TILE_PIXELS, 1, '#e2ebf4');
  for (let x = 0; x < TILE_PIXELS; x += 2) {
    const depth = 1 + Math.floor(p.random() * 2);
    for (let y = 6; y < 6 + depth; y++) p.pixel(x, y, '#eaf1f8');
  }
}

function paintGlass(p) {
  p.clear();
  p.rect(0, 0, TILE_PIXELS, 1, '#d3ecf6', 190);
  p.rect(0, TILE_PIXELS - 1, TILE_PIXELS, 1, '#a9cddd', 190);
  p.rect(0, 0, 1, TILE_PIXELS, '#d3ecf6', 190);
  p.rect(TILE_PIXELS - 1, 0, 1, TILE_PIXELS, '#a9cddd', 190);
  for (let i = 0; i < 5; i++) p.pixel(4 + i, 4 + i, '#ffffff', 140);
  for (let i = 0; i < 4; i++) p.pixel(5 + i, 3 + i, '#ffffff', 90);
  p.rect(2, 2, 3, 1, '#eef9ff', 90);
}

function paintBrick(p) {
  p.fill('#c9c6bb');
  const rows = [[0, 1], [3, 6], [8, 1], [11, 6], [0, 11], [8, 11]];
  for (const [x, y] of rows) p.rect(x, y, 6, 3, '#a8503c');
  for (let y = 0; y < TILE_PIXELS; y += 5) for (let x = 0; x < TILE_PIXELS; x += 1) p.pixel(x, y, '#c9c6bb');
  p.speckle('#b5614c', 18);
}

function paintCactusTop(p) {
  p.fill('#4e8a3a');
  for (let ring = 6; ring > 1; ring -= 2) {
    for (let angle = 0; angle < 48; angle++) {
      const a = (angle / 48) * Math.PI * 2;
      p.pixel(8 + Math.round(Math.cos(a) * ring), 8 + Math.round(Math.sin(a) * ring), ring % 4 === 2 ? '#5d9c46' : '#3f722f');
    }
  }
  p.speckle('#6cad52', 8);
}

function paintCactusSide(p) {
  p.fill('#4e8a3a');
  p.grain(['#478032', '#569542', '#3f722f'], 0.4);
  for (const x of [1, 6, 11, 14]) p.rect(x, 0, 1, TILE_PIXELS, '#3a682b');
  for (const x of [4, 9]) p.rect(x, 0, 1, TILE_PIXELS, '#5fa04a');
  for (let y = 1; y < TILE_PIXELS; y += 3) {
    p.pixel(4, y, '#dfecc4');
    p.pixel(9, y + 1, '#dfecc4');
  }
}

function paintGlowstone(p) {
  p.fill('#e0a94a');
  p.grain(['#d29a3d', '#eab657', '#c88f34'], 0.45);
  for (let i = 0; i < 12; i++) {
    const x = 1 + Math.floor(p.random() * (TILE_PIXELS - 2));
    const y = 1 + Math.floor(p.random() * (TILE_PIXELS - 2));
    p.rect(x, y, 2, 2, '#ffe49a');
    p.pixel(x + 1, y + 1, '#fff6cf');
  }
  p.speckle('#b8802c', 16);
}

function paintTallGrass(p) {
  p.clear();
  for (let blade = 0; blade < 7; blade++) {
    const x = 2 + blade * 2;
    const top = 3 + Math.floor(p.random() * 4);
    for (let y = TILE_PIXELS - 1; y >= top; y--) {
      const wobble = Math.sin((TILE_PIXELS - y) * 0.5 + blade) > 0.4 ? 1 : 0;
      p.pixel(x + wobble, y, y > 9 ? '#4f9a3f' : '#63b04c');
    }
  }
}

function paintFlower(p, petals, centre) {
  p.clear();
  for (let y = 15; y >= 8; y--) p.pixel(8, y, '#4b8f3c');
  p.pixel(7, 11, '#5da84a');
  p.pixel(6, 10, '#5da84a');
  const spots = [[7, 4], [8, 3], [9, 4], [7, 6], [9, 6], [8, 7], [6, 5], [10, 5], [8, 5]];
  for (const [x, y] of spots) p.pixel(x, y, petals);
  p.pixel(8, 5, centre);
  p.pixel(8, 4, centre);
}

function paintCloud(p) {
  p.clear();
  for (let y = 0; y < TILE_PIXELS; y++) {
    for (let x = 0; x < TILE_PIXELS; x++) {
      const n = Math.sin(x * .7) * Math.cos(y * .6) * .5 + .5;
      if (n > .45) p.pixel(x, y, '#ffffff', 190);
      else if (n > .3) p.pixel(x, y, '#f2f7ff', 90);
    }
  }
}

const PAINTERS = {
  [TILES.grass_top]: paintGrassTop,
  [TILES.grass_side]: paintGrassSide,
  [TILES.dirt]: paintDirt,
  [TILES.stone]: paintStone,
  [TILES.cobblestone]: paintCobblestone,
  [TILES.sand]: paintSand,
  [TILES.sandstone_top]: paintSandstoneTop,
  [TILES.sandstone_side]: paintSandstoneSide,
  [TILES.log_top]: paintLogTop,
  [TILES.log_side]: paintLogSide,
  [TILES.leaves]: paintLeaves,
  [TILES.planks]: paintPlanks,
  [TILES.water]: paintWater,
  [TILES.snow_top]: paintSnowTop,
  [TILES.snow_side]: paintSnowSide,
  [TILES.glass]: paintGlass,
  [TILES.brick]: paintBrick,
  [TILES.cactus_top]: paintCactusTop,
  [TILES.cactus_side]: paintCactusSide,
  [TILES.glowstone]: paintGlowstone,
  [TILES.tall_grass]: paintTallGrass,
  [TILES.flower_red]: painter => paintFlower(painter, '#d9503f', '#f7d24a'),
  [TILES.flower_yellow]: painter => paintFlower(painter, '#f2c53d', '#fdf0a6'),
};

/**
 * Paint the whole atlas into an RGBA buffer.
 * Returns the buffer so callers can upload it or inspect it.
 */
export function paintAtlas(data = new Uint8ClampedArray(ATLAS_PIXELS * ATLAS_PIXELS * 4)) {
  for (const [tile, painter] of Object.entries(PAINTERS)) {
    painter(new TilePainter(data, Number(tile)));
  }
  paintCloud(new TilePainter(data, TILES.cloud));
  return data;
}

/** Browser helper: the atlas as a canvas that three.js can turn into a texture. */
export function createAtlasCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PIXELS;
  canvas.height = ATLAS_PIXELS;
  const context = canvas.getContext('2d');
  const image = context.createImageData(ATLAS_PIXELS, ATLAS_PIXELS);
  image.data.set(paintAtlas());
  context.putImageData(image, 0, 0);
  return canvas;
}

/** UV rectangle of a tile, with a half-pixel inset so mipmapping cannot bleed neighbours in. */
export function tileUV(tileIndex) {
  const column = tileIndex % ATLAS_COLUMNS;
  const row = Math.floor(tileIndex / ATLAS_COLUMNS) % ATLAS_ROWS;
  const inset = 0.5 / ATLAS_PIXELS;
  const u0 = column / ATLAS_COLUMNS + inset;
  const u1 = (column + 1) / ATLAS_COLUMNS - inset;
  const v0 = row / ATLAS_ROWS + inset;
  const v1 = (row + 1) / ATLAS_ROWS - inset;
  return { u0, v0, u1, v1 };
}

/** Average colour of a tile, used for break particles and UI accents. */
export function averageTileColor(data, tileIndex, out = [0, 0, 0]) {
  const ox = (tileIndex % ATLAS_COLUMNS) * TILE_PIXELS;
  const oy = Math.floor(tileIndex / ATLAS_COLUMNS) * TILE_PIXELS;
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = 0; y < TILE_PIXELS; y++) {
    for (let x = 0; x < TILE_PIXELS; x++) {
      const offset = ((oy + y) * ATLAS_PIXELS + (ox + x)) * 4;
      if (data[offset + 3] < 128) continue;
      r += data[offset]; g += data[offset + 1]; b += data[offset + 2];
      count++;
    }
  }
  if (!count) return out;
  out[0] = r / count / 255;
  out[1] = g / count / 255;
  out[2] = b / count / 255;
  return out;
}

/** Average colour for every tile in one pass, ready for the particle system. */
export function tilePalette(data) {
  return Array.from({ length: ATLAS_COLUMNS * ATLAS_ROWS }, (_, tile) => averageTileColor(data, tile).slice());
}
