/**
 * Player sprites: a tiny 32x48 pixel-art explorer, painted at runtime like the block atlas.
 *
 * The sheet is 4 columns by 2 rows of 32x48 frames:
 *   row 0 – side view walk cycle (4 frames)
 *   row 1 – side idle, front idle, jump, mining swing
 *
 * The 3D character is built from these frames as billboarded quads (head, body, arms, legs), so it
 * keeps the hand-drawn look of the original game while moving through a real 3D world. Everything
 * writes into a plain pixel buffer, so the sprites can be rendered in Node too.
 */

const FRAME_WIDTH = 32;
const FRAME_HEIGHT = 48;
const COLUMNS = 4;
const ROWS = 2;

export const CHARACTER = {
  width: FRAME_WIDTH * COLUMNS,
  height: FRAME_HEIGHT * ROWS,
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  columns: COLUMNS,
  rows: ROWS,
  /** Fraction of the sheet for each named frame, ready for UV maths. */
  frames: {
    walk0: { column: 0, row: 0 },
    walk1: { column: 1, row: 0 },
    walk2: { column: 2, row: 0 },
    walk3: { column: 3, row: 0 },
    idleSide: { column: 0, row: 1 },
    idleFront: { column: 1, row: 1 },
    jump: { column: 2, row: 1 },
    mine: { column: 3, row: 1 },
  },
  /** Height of the character in world blocks, used to scale the billboards. */
  blockHeight: 1.6,
};

const SKIN = '#eac28c';
const SKIN_DARK = '#d3a672';
const CAP = '#60875a';
const CAP_LIGHT = '#81ad69';
const OVERALLS = '#4b887e';
const OVERALLS_DARK = '#3d6f67';
const SHIRT = '#e4c678';
const BOOTS = '#4a5045';
const EYE = '#31413d';
const HAIR = '#7a5a3b';

class Painter {
  constructor(data, offsetX, offsetY, width, height) {
    this.data = data;
    this.ox = offsetX;
    this.oy = offsetY;
    this.width = width;
    this.height = height;
    this.canvasWidth = CHARACTER.width;
  }

  pixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const [r, g, b] = hexToRgb(color);
    const offset = ((this.oy + y) * this.canvasWidth + (this.ox + x)) * 4;
    this.data[offset] = r;
    this.data[offset + 1] = g;
    this.data[offset + 2] = b;
    this.data[offset + 3] = 255;
  }

  rect(x, y, w, h, color) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.pixel(xx, yy, color);
  }
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * Paint one frame.
 * legSwing  – -1 (leg back) to 1 (leg forward)
 * armSwing  – same idea for the arms
 * pose      – 'side' | 'front' | 'jump' | 'mine'
 */
function paintFrame(painter, { legSwing = 0, armSwing = 0, pose = 'side' }) {
  const front = pose === 'front';
  const jumping = pose === 'jump';
  const mining = pose === 'mine';

  // --- legs (from the hip at y=32 down to the boots at y=46)
  const legOffset = Math.round(legSwing * 2);
  if (jumping) {
    painter.rect(10, 32, 5, 11, OVERALLS_DARK);
    painter.rect(17, 30, 5, 11, OVERALLS_DARK);
    painter.rect(9, 42, 6, 4, BOOTS);
    painter.rect(18, 40, 6, 4, BOOTS);
  } else if (front) {
    painter.rect(11, 32, 4, 12, OVERALLS_DARK);
    painter.rect(17, 32, 4, 12, OVERALLS_DARK);
    painter.rect(10, 44, 5, 3, BOOTS);
    painter.rect(17, 44, 5, 3, BOOTS);
  } else {
    painter.rect(11 + legOffset, 32, 5, 12, OVERALLS_DARK);
    painter.rect(16 - legOffset, 32, 5, 12, OVERALLS_DARK);
    painter.rect(10 + legOffset, 44, 6, 3, BOOTS);
    painter.rect(16 - legOffset, 44, 6, 3, BOOTS);
  }

  // --- body: overalls over a mossy shirt
  painter.rect(10, 20, 12, 13, OVERALLS);
  painter.rect(10, 20, 12, 3, SHIRT);
  if (!front) {
    painter.rect(12, 23, 2, 10, SHIRT);
    painter.rect(18, 23, 2, 10, SHIRT);
  } else {
    painter.rect(12, 23, 3, 9, SHIRT);
    painter.rect(17, 23, 3, 9, SHIRT);
    painter.rect(13, 25, 6, 4, OVERALLS_DARK);
  }

  // --- arms
  if (jumping) {
    painter.rect(6, 14, 4, 12, SKIN);
    painter.rect(22, 14, 4, 12, SKIN);
    painter.rect(6, 12, 4, 4, SHIRT);
    painter.rect(22, 12, 4, 4, SHIRT);
  } else if (mining) {
    painter.rect(7, 20, 4, 12, SKIN);
    painter.rect(21, 16, 4, 12, SKIN);
    painter.rect(21, 14, 4, 4, SHIRT);
    painter.rect(7, 18, 4, 4, SHIRT);
    painter.rect(23, 26, 4, 4, '#c9a268'); // swinging hand/tool
  } else if (front) {
    painter.rect(7, 20, 3, 12, SKIN);
    painter.rect(22, 20, 3, 12, SKIN);
  } else {
    const swing = Math.round(armSwing * 3);
    painter.rect(8 + swing, 20, 4, 12, SKIN);
    painter.rect(20 - swing, 20, 4, 12, SKIN);
    painter.rect(8 + swing, 18, 4, 3, SHIRT);
    painter.rect(20 - swing, 18, 4, 3, SHIRT);
  }

  // --- head
  painter.rect(10, 8, 12, 12, SKIN);
  painter.rect(10, 18, 12, 2, SKIN_DARK); // chin shade
  if (front) {
    painter.rect(12, 12, 2, 3, EYE);
    painter.rect(18, 12, 2, 3, EYE);
    painter.rect(14, 16, 4, 1, '#c77b67');
  } else {
    painter.rect(18, 12, 2, 3, EYE);
    painter.rect(21, 15, 2, 2, '#c77b67');
  }

  // --- mossy cap
  painter.rect(8, 3, 16, 6, CAP);
  painter.rect(9, 1, 14, 3, CAP_LIGHT);
  painter.rect(6, 8, 20, 2, CAP);
  painter.rect(6, 10, 6, 1, CAP_LIGHT);
  painter.rect(20, 10, 6, 1, CAP);
  painter.rect(9, 4, 2, 1, '#6f9a63');

  // --- a wisp of hair under the cap, and a soft outline so the sprite reads against the sky
  painter.rect(9, 12, 1, 3, HAIR);
  painter.rect(22, 12, 1, 3, HAIR);
}

/** Paint the whole character sheet into an RGBA buffer. */
export function paintCharacter(data = new Uint8ClampedArray(CHARACTER.width * CHARACTER.height * 4)) {
  const frames = [
    { column: 0, row: 0, legSwing: 0, armSwing: 0, pose: 'side' },
    { column: 1, row: 0, legSwing: 0.7, armSwing: -0.6, pose: 'side' },
    { column: 2, row: 0, legSwing: 0, armSwing: 0, pose: 'side' },
    { column: 3, row: 0, legSwing: -0.7, armSwing: 0.6, pose: 'side' },
    { column: 0, row: 1, legSwing: 0, armSwing: 0, pose: 'side' },
    { column: 1, row: 1, legSwing: 0, armSwing: 0, pose: 'front' },
    { column: 2, row: 1, legSwing: 0, armSwing: 0, pose: 'jump' },
    { column: 3, row: 1, legSwing: 0, armSwing: 0, pose: 'mine' },
  ];
  for (const frame of frames) {
    paintFrame(new Painter(data, frame.column * FRAME_WIDTH, frame.row * FRAME_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT), frame);
  }
  return data;
}

/** Browser helper: the sprite sheet as a canvas three.js can upload. */
export function createCharacterCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = CHARACTER.width;
  canvas.height = CHARACTER.height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(CHARACTER.width, CHARACTER.height);
  image.data.set(paintCharacter());
  context.putImageData(image, 0, 0);
  return canvas;
}

/** UV rectangle of a named frame, inset half a texel to avoid bleeding between frames. */
export function frameUV(name) {
  const frame = CHARACTER.frames[name] ?? CHARACTER.frames.idleSide;
  const insetU = 0.5 / CHARACTER.width;
  const insetV = 0.5 / CHARACTER.height;
  return {
    u0: (frame.column * FRAME_WIDTH) / CHARACTER.width + insetU,
    u1: ((frame.column + 1) * FRAME_WIDTH) / CHARACTER.width - insetU,
    v0: (frame.row * FRAME_HEIGHT) / CHARACTER.height + insetV,
    v1: ((frame.row + 1) * FRAME_HEIGHT) / CHARACTER.height - insetV,
  };
}

export const WALK_FRAMES = ['walk0', 'walk1', 'walk2', 'walk3'];
