/**
 * Block shapes: the boxes that make up a partial block, in cell-local coordinates.
 *
 * One source of truth for three consumers: the mesher draws them, the collision code tests against
 * them, and the tests assert on them. A full cube is a single box from 0 to 1 on every axis, so
 * every block goes through the same code path.
 */

/** The shape of a block in a cell, as a list of boxes with optional colour overrides. */
export function shapeBoxes(block, meta = 0, connect = () => false) {
  const shape = block.shape ?? 'cube';
  switch (shape) {
    case 'slab':
      return [box(0, 0, 0, 1, 0.5, 1)];
    case 'stairs': {
      const facing = meta & 3;                       // 0 north, 1 east, 2 south, 3 west
      const step = box(0, 0, 0, 1, 0.5, 1);
      const upper = facing === 0 ? box(0, 0.5, 0, 1, 1, 0.5)
        : facing === 1 ? box(0.5, 0.5, 0, 1, 1, 1)
          : facing === 2 ? box(0, 0.5, 0.5, 1, 1, 1)
            : box(0, 0.5, 0, 0.5, 1, 1);
      return [step, upper];
    }
    case 'fence': {
      const boxes = [box(0.375, 0, 0.375, 0.625, 1, 0.625)];
      const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dx, dz] of sides) {
        if (!connect(dx, dz)) continue;
        for (const level of [0.25, 0.72]) {
          boxes.push(dx
            ? box(dx > 0 ? 0.625 : 0, level, 0.4375, dx > 0 ? 1 : 0.375, level + 0.12, 0.5625)
            : box(0.4375, level, dz > 0 ? 0.625 : 0, 0.5625, level + 0.12, dz > 0 ? 1 : 0.375));
        }
      }
      return boxes;
    }
    case 'pane': {
      const alongX = connect(1, 0) || connect(-1, 0);
      const alongZ = connect(0, 1) || connect(0, -1);
      const boxes = [];
      if (alongX || !alongZ) boxes.push(box(0, 0, 0.4375, 1, 1, 0.5625));
      if (alongZ || !alongX) boxes.push(box(0.4375, 0, 0, 0.5625, 1, 1));
      return boxes;
    }
    case 'ladder': {
      // Flat against the wall it was hung on: meta 0 north, 1 east, 2 south, 3 west.
      const thin = 0.16;
      const side = meta & 3;
      if (side === 0) return [box(0.0625, 0, 0, 0.9375, 1, thin)];
      if (side === 1) return [box(1 - thin, 0, 0.0625, 1, 1, 0.9375)];
      if (side === 2) return [box(0.0625, 0, 1 - thin, 0.9375, 1, 1)];
      return [box(0, 0, 0.0625, thin, 1, 0.9375)];
    }
    case 'door': {
      // An open door is the closed door swung a quarter turn, which is a swap of its axes. Bit 1 of
      // the metadata says which side it swings to, so the open leaf ends up flat against the frame
      // instead of floating in the middle of the doorway.
      const t = 0.0625;
      if ((meta & 1) === 0) return [box(0.0625, 0, 0.5 - t, 0.9375, 1, 0.5 + t)];
      return (meta & 2)
        ? [box(1 - t, 0, 0.0625, 1, 1, 0.9375)]
        : [box(0, 0, 0.0625, t, 1, 0.9375)];
    }
    case 'chest':
      return [
        box(0.0625, 0, 0.0625, 0.9375, 0.82, 0.9375, block.side),
        box(0.0625, 0.82, 0.0625, 0.9375, 1, 0.9375, block.top),
      ];
    case 'bed':
      return [
        box(0, 0, 0, 1, 0.45, 1, block.side),
        box(0.0625, 0.45, 0.0625, 0.9375, 0.5625, 0.4, block.top),      // pillow end
      ];
    default:
      return [box(0, 0, 0, 1, 1, 1)];
  }
}

export function box(minX, minY, minZ, maxX, maxY, maxZ, colour = null) {
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], colour };
}

/** Do two cell-local boxes overlap? */
export function boxesOverlap(a, b) {
  return a.min[0] < b.max[0] - 1e-9 && a.max[0] > b.min[0] + 1e-9
    && a.min[1] < b.max[1] - 1e-9 && a.max[1] > b.min[1] + 1e-9
    && a.min[2] < b.max[2] - 1e-9 && a.max[2] > b.min[2] + 1e-9;
}

/**
 * The highest surface a footprint can stand on in this cell: the tallest box top whose horizontal
 * span the footprint touches, or null when the footprint misses every box.
 */
export function standingHeight(boxes, minX, minZ, maxX, maxZ) {
  let top = null;
  for (const shape of boxes) {
    if (shape.max[0] <= minX + 1e-9 || shape.min[0] >= maxX - 1e-9) continue;
    if (shape.max[2] <= minZ + 1e-9 || shape.min[2] >= maxZ - 1e-9) continue;
    if (top === null || shape.max[1] > top) top = shape.max[1];
  }
  return top;
}

/** The tallest box in a cell, used for "how high does this block reach" questions. */
export function tallestTop(boxes) {
  let top = 0;
  for (const shape of boxes) if (shape.max[1] > top) top = shape.max[1];
  return top;
}
