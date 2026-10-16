/**
 * The light engine: torches, lava and glinting ore fill the world with light.
 *
 * Light is a flat grid of levels 0-15, poured out from every glowing block with a breadth-first
 * search that drops one level per step and stops at anything opaque. The whole grid is built once
 * per world (a single multi-source BFS, not one flood per torch), and after that each edit repairs
 * only the box around the block that changed — cheap enough to run on every dig and every build.
 */

import { AIR, MAX_LIGHT, WORLD_X, WORLD_Y, WORLD_Z, blockById, lightOf } from './constants.js';

export { WORLD_X, WORLD_Y, WORLD_Z };

export class LightEngine {
  constructor(world, { reach = 6 } = {}) {
    this.world = world;
    this.reach = reach;
    this.grid = new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z);
    this.sources = new Map();          // packed index -> light level
    this.dirty = true;
    this.fills = 0;                    // how many BFS runs have happened, for the tests
  }

  static pack(x, y, z) { return (y * WORLD_Z + z) * WORLD_X + x; }

  unpacks(index) {
    const x = index % WORLD_X;
    const z = Math.floor(index / WORLD_X) % WORLD_Z;
    const y = Math.floor(index / (WORLD_X * WORLD_Z));
    return [x, y, z];
  }

  /** The sun: anything above the terrain's skyline is in daylight. */
  skyLight(x, y, z) {
    if (y >= WORLD_Y) return MAX_LIGHT;
    if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z || y < 0) return 0;
    return y > this.skyline(z * WORLD_X + x) ? MAX_LIGHT : 0;
  }

  /**
   * Highest opaque block in a column — the height the sun reaches. Built once, then repaired one
   * column at a time: rescanning all 16384 columns after every dig would stall the frame.
   */
  skyline(column) {
    this.skylineGrid ??= new Uint8Array(WORLD_X * WORLD_Z);
    if (!this.skylineReady) {
      this.skylineReady = true;
      for (let z = 0; z < WORLD_Z; z++) {
        for (let x = 0; x < WORLD_X; x++) this.skylineGrid[z * WORLD_X + x] = this.scanColumn(x, z);
      }
    }
    return this.skylineGrid[column];
  }

  /** Rescan a single column after an edit changed what blocks the sun. */
  refreshColumn(x, z) {
    if (!this.skylineReady) return;
    this.skylineGrid ??= new Uint8Array(WORLD_X * WORLD_Z);
    this.skylineGrid[z * WORLD_X + x] = this.scanColumn(x, z);
  }

  scanColumn(x, z) {
    for (let y = WORLD_Y - 1; y >= 0; y--) {
      if (!this.translucent(x, y, z)) return y;
    }
    return -1;
  }

  /** Light level 0-15 at a cell, sun and torches together. */
  at(x, y, z) {
    if (x < 0 || x >= WORLD_X || y < 0 || z < 0 || z >= WORLD_Z) return y >= WORLD_Y ? MAX_LIGHT : 0;
    if (y >= WORLD_Y) return MAX_LIGHT;
    if (this.dirty) this.rebuild();
    return Math.max(this.grid[LightEngine.pack(x, y, z)], this.skyLight(x, y, z));
  }

  /** Torch-and-lava light only, ignoring the sun: what lights a sealed room. */
  blockLightAt(x, y, z) {
    if (x < 0 || x >= WORLD_X || y < 0 || y >= WORLD_Y || z < 0 || z >= WORLD_Z) return 0;
    if (this.dirty) this.rebuild();
    return this.grid[LightEngine.pack(x, y, z)];
  }

  /** A cell lets light through if it is air, water, glass or ice. */
  translucent(x, y, z) {
    if (y < 0 || y >= WORLD_Y) return false;
    if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) return false;
    const id = this.world.data[LightEngine.pack(x, y, z)];
    if (id === AIR) return true;
    const block = blockById(id);
    return Boolean(block.transparent) && !block.liquid;
  }

  /** Remember (or forget) a glowing block without rebuilding anything yet. */
  register(x, y, z, id) {
    const level = lightOf(id);
    const key = LightEngine.pack(x, y, z);
    if (level > 0) this.sources.set(key, level);
    else this.sources.delete(key);
    return this.sources.size;
  }

  /** Find every glowing block in the terrain — after generation, or after loading a save. */
  scan() {
    this.sources.clear();
    const data = this.world.data;
    for (let index = 0; index < data.length; index++) {
      const id = data[index];
      if (!id) continue;
      const level = lightOf(id);
      if (level > 0) this.sources.set(index, level);
    }
    this.dirty = true;
    this.skylineReady = false;
    return this.sources.size;
  }

  /**
   * One multi-source breadth-first search over the whole grid. Every source starts in the queue at
   * its own level, so a cell is visited at most once per level it can be reached at — far cheaper
   * than flooding once per torch.
   */
  rebuild() {
    this.grid.fill(0);
    const queue = [];
    for (const [index, level] of this.sources) {
      this.grid[index] = level;
      queue.push([index, level]);
    }
    this.propagate(queue);
    this.dirty = false;
    this.fills++;
    return queue.length;
  }

  /** Expand a queue of lit cells, brightest first, one level per step. */
  propagate(queue) {
    let head = 0;
    while (head < queue.length) {
      const [index, level] = queue[head++];
      if (level <= 1) continue;
      const x = index % WORLD_X;
      const z = Math.floor(index / WORLD_X) % WORLD_Z;
      const y = Math.floor(index / (WORLD_X * WORLD_Z));
      const next = level - 1;
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < 0 || ny >= WORLD_Y || nx < 0 || nx >= WORLD_X || nz < 0 || nz >= WORLD_Z) continue;
        if (!this.translucent(nx, ny, nz)) continue;
        const neighbour = LightEngine.pack(nx, ny, nz);
        if (next <= this.grid[neighbour]) continue;
        this.grid[neighbour] = next;
        if (next > 1) queue.push([neighbour, next]);
      }
    }
    return queue.length;
  }

  /**
   * Remove the light that came from a cell that just changed, and note what should be re-lit.
   *
   * This is the half of the lighting problem that stops walls from leaking: light is only removed
   * from cells that were *dimmer* than the one being cleared (they must have been lit by it), and
   * cells that are brighter are handed back as seeds because something else is lighting them.
   */
  removeLight(index, level, readd) {
    const queue = [[index, level]];
    this.grid[index] = 0;
    while (queue.length) {
      const [cell, lvl] = queue.shift();
      const x = cell % WORLD_X;
      const z = Math.floor(cell / WORLD_X) % WORLD_Z;
      const y = Math.floor(cell / (WORLD_X * WORLD_Z));
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < 0 || ny >= WORLD_Y || nx < 0 || nx >= WORLD_X || nz < 0 || nz >= WORLD_Z) continue;
        const neighbour = LightEngine.pack(nx, ny, nz);
        const value = this.grid[neighbour];
        if (value === 0) continue;
        if (value < lvl) {
          this.grid[neighbour] = 0;
          queue.push([neighbour, value]);
        } else {
          readd.push([neighbour, value]);       // lit by something else: put it back
        }
      }
    }
    return readd.length;
  }

  /**
   * Repair the light after one block changed.
   *
   * Three cases, and the order matters: light that was removed is taken away first (so a wall really
   * does cast a shadow), then the new block is registered as a source if it glows, and finally
   * everything still lit around the edit is re-poured so the room fills back in.
   */
  update(x, y, z, id = null) {
    const index = LightEngine.pack(x, y, z);
    const next = id === null ? this.world.get(x, y, z) : id;
    const previous = this.sources.get(index) ?? 0;
    const level = lightOf(next);
    this.register(x, y, z, next);
    if (this.dirty) { this.rebuild(); this.refreshColumn(x, z); return 0; }

    const readd = [];
    if (previous > 0) {
      // A torch or a lava block went away: take its light back out of the world.
      this.removeLight(index, previous, readd);
    } else if (level === 0 && this.grid[index] > 0) {
      // An opaque block was placed where light used to be: it shadows what is behind it.
      this.removeLight(index, this.grid[index], readd);
    }

    const seeds = readd;
    if (level > 0) {
      this.grid[index] = Math.max(this.grid[index], level);
      seeds.push([index, Math.max(this.grid[index], level)]);
    }
    // Anything still glowing next to the edit can flow back into the cell it lost.
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (ny < 0 || ny >= WORLD_Y || nx < 0 || nx >= WORLD_X || nz < 0 || nz >= WORLD_Z) continue;
      if (!this.translucent(nx, ny, nz)) continue;
      const neighbour = LightEngine.pack(nx, ny, nz);
      if (this.grid[neighbour] > 1) seeds.push([neighbour, this.grid[neighbour]]);
    }
    this.propagate(seeds);
    this.refreshColumn(x, z);
    return seeds.length;
  }
}

/** Fixed neighbour order: the BFS is easier to reason about (and to test) when it never varies. */
const NEIGHBOURS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

export { NEIGHBOURS };
