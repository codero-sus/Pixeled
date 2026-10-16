/**
 * The voxel world: a flat Uint8Array of block ids plus the generator that fills it.
 *
 * Generation layers, in the order they are applied:
 *   1. continental shelf + hills + fine detail (2D noise) -> surface height
 *   2. biomes from temperature/moisture noise  3. water up to sea level
 *   4. caves carved with 3D noise  5. trees planted per biome
 */

import {
  AIR, BIRCH_LEAVES, BIRCH_LOG, CACTUS, CLAY, COAL_ORE, COBBLESTONE, DIAMOND_ORE, DIRT, FLOWER, GOLD_ORE,
  GRASS, GRAVEL, ICE, IRON_ORE, LEAVES, LOG, MOSSY_STONE, OBSIDIAN, PUMPKIN, SAND, SANDSTONE, SNOW,
  LAVA, SAPLING, SPRUCE_LEAVES, SPRUCE_LOG, STONE, TALL_GRASS, WATER,
  blockById,
} from './constants.js';
import { Noise, hashCoords } from './noise.js';
import { LightEngine } from './light.js';
import { SEA_LEVEL, WORLD_X, WORLD_Y, WORLD_Z } from './constants.js';
import { boxesOverlap, shapeBoxes, standingHeight, tallestTop } from './shapes.js';

export const BIOMES = ['plains', 'forest', 'desert', 'snow', 'savanna', 'swamp', 'mountains'];

/** Turn a yaw into one of four compass quarter-turns: 0 north (-z), 1 east (+x), 2 south, 3 west. */
export function yawToFacing(yaw = 0) {
  const quarter = Math.round((-yaw / (Math.PI / 2)) % 4 + 4) % 4;
  return quarter;
}

/** The quarter-turn for the wall a face normal points at, used to hang ladders. */
export function wallFromNormal(normal) {
  if (!normal) return 0;
  const [nx, , nz] = normal;
  if (nx > 0) return 3;          // looking east: the ladder hangs on the west wall of the cell
  if (nx < 0) return 1;
  if (nz > 0) return 0;
  if (nz < 0) return 2;
  return 0;
}

/** Grass colour per biome, used by the mesher so the same block reads differently per biome. */
export const GRASS_TINTS = {
  plains: [0.47, 0.75, 0.35],
  forest: [0.33, 0.65, 0.28],
  desert: [0.72, 0.78, 0.42],
  snow: [0.72, 0.82, 0.78],
  savanna: [0.70, 0.72, 0.34],
  swamp: [0.36, 0.53, 0.27],
  mountains: [0.55, 0.68, 0.45],
};

function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }

/**
 * fbm output clusters tightly around 0.5 — its tails almost never reach 0.2 or 0.8. Biome rules
 * need those tails (a world with no wet hollows has no swamp), so the value is stretched away from
 * the middle before it is compared against the thresholds.
 */
function spread(value, factor = 2.4) {
  return clamp01((value - 0.5) * factor + 0.5);
}

export class VoxelWorld {
  constructor(seed, { flat = false } = {}) {
    this.seed = seed >>> 0;
    this.flat = Boolean(flat);
    this.noise = new Noise(this.seed);
    this.data = new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z);
    // A second byte per cell for things that are not the block itself: which way a door swings, which
    // way stairs face, which ladder wall they hang on and which corner of a bed is the pillow.
    this.meta = new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z);
    this.edits = new Map();
    this.metaEdits = new Map();
    this.chests = new Map();          // "x,y,z" -> Map(blockId -> count)
    this.waterQueue = [];             // cells whose neighbours get a chance to flood each tick
    this.continentMean = 0.42;
    this.calibrate();
    if (this.flat) this.generateFlat();
    else this.generate();
    // The light grid is built lazily: nothing floods until the first time a mesh asks for a light
    // level, which is exactly when the picture needs it.
    this.light = new LightEngine(this);
    this.light.scan();
  }

  static index(x, y, z) { return (y * WORLD_Z + z) * WORLD_X + x; }

  inside(x, y, z) { return x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y && z >= 0 && z < WORLD_Z; }

  /** Block id for rendering and generation. Outside the world reads as air (except below bedrock). */
  get(x, y, z) {
    if (!this.inside(x, y, z)) return y < 0 ? STONE : AIR;
    return this.data[VoxelWorld.index(x, y, z)];
  }

  /** Physics query: the world edges are walls so nobody falls off the map. */
  isSolid(x, y, z) {
    if (y < 0) return true;
    if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z || y >= WORLD_Y) return false;
    return blockById(this.data[VoxelWorld.index(x, y, z)]).solid;
  }

  isLiquid(x, y, z) {
    return this.get(x, y, z) === WATER;
  }

  /** Cell metadata: door open state, stair facing, ladder side, bed pillow. */
  metaAt(x, y, z) {
    return this.inside(x, y, z) ? this.meta[VoxelWorld.index(x, y, z)] : 0;
  }

  getMeta(x, y, z) {
    if (!this.inside(x, y, z)) return 0;
    return this.meta[VoxelWorld.index(x, y, z)];
  }

  setMeta(x, y, z, value) {
    if (!this.inside(x, y, z)) return false;
    this.meta[VoxelWorld.index(x, y, z)] = value & 0xff;
    this.metaEdits.set(`${x},${y},${z}`, value & 0xff);
    return true;
  }

  /** A door is open when the low bit of its metadata is set. */
  isDoorOpen(x, y, z) { return (this.getMeta(x, y, z) & 1) === 1; }

  /** Flip a door — both halves — and report the new state. */
  toggleDoor(x, y, z) {
    const open = !this.isDoorOpen(x, y, z);
    const base = open ? 1 : 0;
    const facing = this.getMeta(x, y, z) & 0b110;
    this.setMeta(x, y, z, base | facing);
    return open;
  }

  /** Highest surface a box can stand on in a cell, or null when the cell is passable. */
  surfaceAt(x, y, z) { return this.blockTop(x, y, z); }

  /**
   * Absolute height of the top of whatever blocks movement in a cell, or null if it is passable.
   * For a stair this is the raised step, for a slab the half-way surface, for a bed the mattress.
   */
  blockTop(x, y, z) {
    if (y < 0) return 0;
    const boxes = this.cellBoxes(x, y, z);
    if (!boxes) return null;
    return y + tallestTop(boxes);
  }

  /** True when a cell stops the player walking into it at a given height. */
  blocksMovement(x, y, z) {
    const top = this.blockTop(x, y, z);
    return top !== null;
  }

  /** The boxes a block occupies in its cell, or null when the cell is passable. */
  cellBoxes(x, y, z) {
    if (!this.inside(x, y, z)) return null;
    const id = this.data[VoxelWorld.index(x, y, z)];
    if (!id) return null;
    const block = blockById(id);
    if (!block.solid && !block.interactive) return null;
    const meta = this.getMeta(x, y, z);
    return shapeBoxes(block, meta, (dx, dz) => this.holdsConnector(x + dx, y, z + dz));
  }

  /** Does a cell hold something a fence post or a pane edge can attach to? */
  holdsConnector(x, y, z) {
    if (!this.inside(x, y, z)) return false;
    const id = this.data[VoxelWorld.index(x, y, z)];
    if (!id) return false;
    const block = blockById(id);
    if (block.plant || block.liquid) return false;
    return (block.fraction ?? 1) >= 0.999 || block.shape === 'fence' || block.shape === 'pane';
  }

  /**
   * True when a box overlaps anything solid. Partial blocks only occupy the boxes they actually
   * fill, so you can walk under a stair, stand on a slab at half height, and walk through an open
   * door — its leaf is a wafer against the frame, so it only catches you if you hug that wall.
   */
  overlapsSolid(minX, minY, minZ, maxX, maxY, maxZ) {
    const x0 = Math.floor(minX), x1 = Math.floor(maxX - 1e-9);
    const y0 = Math.floor(minY), y1 = Math.floor(maxY - 1e-9);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - 1e-9);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const boxes = this.cellBoxes(x, y, z);
          if (!boxes) continue;
          const region = {
            min: [minX - x, minY - y, minZ - z],
            max: [maxX - x, maxY - y, maxZ - z],
          };
          for (const shape of boxes) if (boxesOverlap(shape, region)) return true;
        }
      }
    }
    return false;
  }

  /**
   * The surface a footprint of this size stands on: the tallest box top it touches, searching down
   * from `from`. Defaults to the world floor so nothing ever falls out of the bottom of the map.
   */
  surfaceUnder(minX, minZ, maxX, maxZ, from) {
    let best = 0;
    const startY = Math.floor(from + 1e-3);
    for (let y = Math.min(WORLD_Y - 1, startY); y >= 0; y--) {
      const x0 = Math.floor(minX), x1 = Math.floor(maxX - 1e-9);
      const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - 1e-9);
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const boxes = this.cellBoxes(x, y, z);
          if (!boxes) continue;
          const local = standingHeight(boxes,
            Math.max(0, minX - x), Math.max(0, minZ - z),
            Math.min(1, maxX - x), Math.min(1, maxZ - z));
          if (local === null) continue;
          const top = y + local;
          if (top <= from + 1e-6 && top > best) best = top;
        }
      }
      // Scanning downwards finds the highest surface first, so the first hit is the answer.
      if (best > 0) break;
    }
    return best;
  }

  isLadder(x, y, z) {
    if (!this.inside(x, y, z)) return false;
    return blockById(this.data[VoxelWorld.index(x, y, z)]).climbable === true;
  }

  /** Chest contents at a cell, created on demand. */
  chestAt(x, y, z, create = false) {
    // A chest has to be somewhere: this refuses nonsense coordinates instead of filing a phantom
    // chest under "NaN" and handing it back forever.
    if (!this.inside(x, y, z)) return null;
    const key = `${x},${y},${z}`;
    if (!this.chests.has(key) && create) this.chests.set(key, new Map());
    return this.chests.get(key) ?? null;
  }

  set(x, y, z, id) {
    if (!this.inside(x, y, z)) return false;
    const previous = this.data[VoxelWorld.index(x, y, z)];
    this.data[VoxelWorld.index(x, y, z)] = id;
    this.edits.set(`${x},${y},${z}`, id);
    if (previous !== id) {
      this.setMeta(x, y, z, 0);
      if (blockById(previous).interactive === 'chest') this.chests.delete(`${x},${y},${z}`);
    }
    // Once the world is built, changing a block can start a sand slide. During generation this is
    // skipped: a million queued cells would cost more than the terrain does.
    if (this.ready && previous !== id) {
      this.queueFalling(x, y, z);
      if (blockById(this.get(x, y + 1, z)).falling) this.queueFalling(x, y + 1, z);
      // A torch, a lamp or a hole in the wall: repair the light right here.
      this.light?.update(x, y, z, id);
      if (id === AIR) this.wakeWater(x, y, z);
    }
    return true;
  }

  applyEdits(edits, metaEdits = null, chests = null) {
    for (const [key, id] of edits) {
      const [x, y, z] = key.split(',').map(Number);
      if (this.inside(x, y, z)) this.data[VoxelWorld.index(x, y, z)] = id;
      this.edits.set(key, id);
    }
    if (metaEdits) {
      for (const [key, value] of metaEdits) {
        const [x, y, z] = key.split(',').map(Number);
        if (this.inside(x, y, z)) this.meta[VoxelWorld.index(x, y, z)] = value & 0xff;
        this.metaEdits.set(key, value & 0xff);
      }
    }
    if (chests) {
      for (const [key, contents] of Object.entries(chests)) {
        const [x, y, z] = String(key).split(',').map(Number);
        if (!this.inside(x, y, z) || !contents) continue;
        // Counts and ids are untrusted: a hand-edited save must not poison the world.
        const kept = Object.entries(contents)
          .map(([id, count]) => [Number(id), Math.max(0, Math.floor(Number(count)) || 0)])
          .filter(([id, count]) => Number.isFinite(id) && id > 0 && count > 0);
        this.chests.set(key, new Map(kept));
      }
    }
  }

  // ------------------------------------------------------------------ fluids

  /**
   * Water flow. Breaking a wall next to a lake should let the water in, but only a few cells per
   * tick so a hole in the ocean floor does not stall the frame. Water spreads down first, then
   * sideways, and stops when it has gone `limit` cells from its source.
   */
  flowWater({ limit = 220 } = {}) {
    this.waterQueue ??= [];
    if (!this.waterQueue.length) return [];
    const wet = [];
    let budget = limit;
    while (this.waterQueue.length && budget-- > 0) {
      const { x, y, z } = this.waterQueue.shift();
      for (const [dx, dy, dz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (!this.inside(nx, ny, nz)) continue;
        const id = this.get(nx, ny, nz);
        if (id !== AIR) continue;
        // Do not flood upward forever: only fill upward if the water is still near its source level.
        if (dy === 1 && this.waterLevel(nx, ny, nz) > 3) continue;
        this.set(nx, ny, nz, WATER);
        wet.push({ x: nx, y: ny, z: nz });
        this.waterQueue.push({ x: nx, y: ny, z: nz });
      }
    }
    return wet;
  }

  /** How far above the nearest solid ground a cell is — used to stop water climbing the world. */
  waterLevel(x, y, z) {
    let steps = 0;
    while (steps < 6 && this.get(x, y - 1 - steps, z) === AIR) steps++;
    return steps;
  }

  /** Queue a cell so its neighbours get a chance to flood on the next tick. */
  queueWater(x, y, z) {
    this.waterQueue ??= [];
    if (this.waterQueue.length < 4000) this.waterQueue.push({ x, y, z });
    return this.waterQueue.length;
  }

  // ------------------------------------------------------------------ placing

  /**
   * Place a block the way a player would: stairs remember which way they face, ladders remember the
   * wall they hang on, doors start closed, beds remember which end is the pillow.
   */
  placeBlock(x, y, z, id, { yaw = 0, face = null, replace = false } = {}) {
    if (!this.inside(x, y, z)) return false;
    const block = blockById(id);
    if (!block.placeable && !replace) return false;
    if (!replace && this.get(x, y, z) !== AIR) return false;
    this.set(x, y, z, id);
    const facing = yawToFacing(yaw);
    switch (block.shape) {
      case 'stairs':
        this.setMeta(x, y, z, facing);
        break;
      case 'ladder':
        // Hang on whichever wall the player is looking at, or the nearest neighbour if they are
        // standing in the open.
        this.setMeta(x, y, z, face === null ? facing : wallFromNormal(face));
        break;
      case 'door':
        this.setMeta(x, y, z, facing & 2);      // closed, remembering which way it swings
        break;
      case 'bed':
        this.setMeta(x, y, z, facing);
        break;
      default:
        break;
    }
    return true;
  }

  /** When a block is broken next to water, tell the water to start moving. */
  wakeWater(x, y, z) {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
      if (this.get(x + dx, y + dy, z + dz) === WATER) this.queueWater(x + dx, y + dy, z + dz);
    }
  }

  // ------------------------------------------------------------------ terrain

  /**
   * The continental shape is calibrated against the world's own average, so every random seed ends
   * up with a similar land-to-water balance (roughly 60% land) but a completely different layout.
   */
  calibrate() {
    let sum = 0, count = 0;
    for (let x = 0; x < WORLD_X; x += 8) {
      for (let z = 0; z < WORLD_Z; z += 8) { sum += this.continent(x, z); count++; }
    }
    this.continentMean = sum / count;
  }

  continent(x, z) { return this.noise.fbm2(x * 0.0038, z * 0.0038, 5); }

  surfaceHeight(x, z) {
    // A sandbox world has one level, and it is the same everywhere.
    if (this.flat) return this.flatHeight;
    const land = clamp01((this.continent(x, z) - (this.continentMean - 0.065)) / 0.14);
    // A ridged noise only bites on high ground, which keeps plains flatter and makes real peaks.
    const ridge = Math.abs(this.noise.fbm2(x * 0.011 + 31, z * 0.011 - 17, 3) - 0.5) * 2;
    const mask = clamp01((land - 0.58) / 0.42);
    // Rolling hills: mid-frequency noise that bites harder on high ground, plus 1-block grain.
    const hills = (this.noise.fbm2(x * 0.021 + 11, z * 0.021 - 5, 3) - 0.5) * (3 + land * 8);
    const grain = (this.noise.fbm2(x * 0.085 - 3, z * 0.085 + 19, 2) - 0.5) * 1.8;
    const height = 11 + Math.pow(land, 1.1) * 38 + Math.pow(ridge, 3) * 9 * mask + hills + grain;
    return Math.max(2, Math.min(WORLD_Y - 8, Math.floor(height)));
  }

  biomeAt(x, z) {
    if (this.flat) return 0;                                      // a sandbox world is all plains
    const temperature = spread(this.noise.fbm2(x * 0.0031 + 7.3, z * 0.0031 + 2.1, 3));
    const moisture = spread(this.noise.fbm2(x * 0.0043 - 4.7, z * 0.0043 + 9.4, 3), 2.6);
    const height = this.surfaceHeight(x, z);
    if (height > 39) return 6;                                    // mountains
    if (temperature < 0.32) return 3;                             // snow
    if (moisture < 0.34 && temperature > 0.52) return 2;          // desert
    if (moisture > 0.7 && height <= SEA_LEVEL + 4) return 5;      // swamp
    if (moisture > 0.58) return 1;                                // forest
    if (temperature > 0.6 && moisture < 0.5) return 4;            // savanna
    return 0;                                                     // plains
  }

  /** Grass tint for a column, read by the mesher. */
  tintAt(x, z) { return GRASS_TINTS[BIOMES[this.biomeAt(x, z)]] ?? GRASS_TINTS.plains; }

  /**
   * Ore veins: three-dimensional noise stamps a blob wherever it is above the threshold, and the
   * depth bands decide which ore that blob is. Coal is common and shallow, diamond rare and deep.
   */
  oreAt(x, y, z) {
    if (y < 2 || y > 46) return AIR;
    const vein = this.noise.fbm3(x * 0.09 + 13.7, y * 0.11 - 5.2, z * 0.09 + 21.4, 2);
    if (vein < 0.62) return AIR;
    const roll = hashCoords(x, y * 31 + z, z, this.seed ^ 0x51ed) ;
    if (y < 14) {
      if (roll < 0.055 && vein > 0.68) return DIAMOND_ORE;
      if (roll < 0.20) return GOLD_ORE;
      if (roll < 0.52) return IRON_ORE;
      return y < 30 ? COAL_ORE : AIR;
    }
    if (y < 26) {
      if (roll < 0.28) return IRON_ORE;
      if (roll < 0.62) return COAL_ORE;
      return AIR;
    }
    return roll < 0.5 && y < 40 ? COAL_ORE : AIR;
  }

  generate() {
    const data = this.data;
    data.fill(AIR);
    if (!this.continentMean) this.calibrate();
    for (let z = 0; z < WORLD_Z; z++) {
      for (let x = 0; x < WORLD_X; x++) {
        const height = this.surfaceHeight(x, z);
        const biome = this.biomeAt(x, z);
        const beach = height <= SEA_LEVEL + 1;
        const alpine = height > 38 && !beach;
        const dry = biome === 2;
        const swampy = biome === 5;
        for (let y = 0; y <= height; y++) {
          let id = STONE;
          if (y === height) id = beach ? SAND : alpine ? SNOW : biome === 3 ? SNOW : dry ? SAND : GRASS;
          else if (y > height - 4) {
            id = beach || dry ? SAND : alpine ? GRAVEL : swampy ? CLAY : DIRT;
            // Sand always sits on sandstone, and swamps keep a clay seam, so strata read clearly.
            if ((beach || dry) && y <= height - 3) id = SANDSTONE;
          }
          if (y === 0) id = STONE;
          if (y > 0 && y < height - 2) {
            if (this.caveAt(x, y, z)) continue;
            const ore = this.oreAt(x, y, z);
            if (ore && id === STONE) id = ore;
            else if (!ore && id === STONE && y < 6 && hashCoords(x, y * 13 + z, z, this.seed ^ 0x11c0) < 0.05) id = OBSIDIAN;
            else if (!ore && id === STONE && (swampy || biome === 1) && y > height - 8
              && hashCoords(x, y * 19 + z, z, this.seed ^ 0x3d7e) < 0.08) id = MOSSY_STONE;
            else if (!ore && id !== OBSIDIAN && y > 6 && y < height - 5 && hashCoords(x, y * 7 + z, z, this.seed ^ 0x2b3c) < 0.05) id = COBBLESTONE;
            // Lava pools deep down, and lava lining the floor of the very deepest caves.
            else if (!ore && y < 12 && this.lavaAt(x, y, z)) id = LAVA;
            else if (!ore && y > height - 3 && this.pebbleAt(x, y, z)) id = hashCoords(x, y, z, this.seed) < 0.6 ? GRAVEL : CLAY;
          }
          data[VoxelWorld.index(x, y, z)] = id;
        }
        // A murky pool in the middle of a swamp, and ice wherever snow meets the sea.
        if (swampy && height <= SEA_LEVEL + 1) {
          for (let y = height + 1; y <= SEA_LEVEL + 2; y++) data[VoxelWorld.index(x, y, z)] = WATER;
        } else {
          for (let y = height + 1; y <= SEA_LEVEL; y++) data[VoxelWorld.index(x, y, z)] = WATER;
        }
        if (biome === 3 && height < SEA_LEVEL && hashCoords(x, 3, z, this.seed ^ 0x9e37) < 0.85) {
          data[VoxelWorld.index(x, SEA_LEVEL, z)] = ICE;
        }
        this.plantTree(x, z, height, biome, beach);
        this.plantFlora(x, z, height, biome, beach, swampy);
        this.plantPumpkin(x, z, height, biome, beach);
        this.plantBoulder(x, z, height, beach, biome);
      }
    }
    // From here on, edits simulate: sand falls, saplings grow, leaves wither.
    this.ready = true;
    this.fallQueue = new Set();
    this.saplings = new Map();
    this.age = 0;
  }

  /**
   * Lava: a large, slow 3D blob noise that only appears below y = 12, so the deep caves have glowing
   * pools to find (and to fall into) without the surface ever catching fire.
   */
  lavaAt(x, y, z) {
    if (y > 12 || y < 2) return false;
    const pool = this.noise.fbm3(x * 0.06 - 31.4, y * 0.12 + 9.8, z * 0.06 + 44.2, 2);
    if (pool < 0.66) return false;
    // Lava sits in hollows: only where there is air above it, so pools have a surface.
    return this.get(x, y + 1, z) === AIR || y >= 12;
  }

  caveAt(x, y, z) {
    return this.noise.fbm3(x * 0.055, y * 0.085, z * 0.055, 3) > 0.63;
  }

  /** Small gravel and clay pockets just under the surface. */
  pebbleAt(x, y, z) {
    return this.noise.fbm3(x * 0.13 + 7, y * 0.16 + 3, z * 0.13 - 11, 2) > 0.68;
  }

  /** Desert cacti, savanna and swamp ground cover, and flowers in the greener biomes. */
  plantFlora(x, z, height, biome, beach, swampy) {
    if (beach || height <= SEA_LEVEL + 1) return;
    if (x < 2 || z < 2 || x > WORLD_X - 3 || z > WORLD_Z - 3) return;
    const surface = this.data[VoxelWorld.index(x, height, z)];
    if (surface !== GRASS && surface !== SAND) return;
    const above = this.data[VoxelWorld.index(x, height + 1, z)];
    if (above !== AIR) return;
    const roll = hashCoords(x, 29, z, this.seed ^ 0x2f1d);

    if (biome === 2) {                       // desert: cacti and the odd dry tuft
      if (roll < 0.02) {
        const tall = 1 + Math.floor(hashCoords(x, 41, z, this.seed) * 3);
        for (let i = 1; i <= tall && height + i < WORLD_Y - 1; i++) {
          if (this.data[VoxelWorld.index(x, height + i, z)] !== AIR) break;
          this.data[VoxelWorld.index(x, height + i, z)] = CACTUS;
        }
      } else if (roll < 0.035) {
        this.data[VoxelWorld.index(x, height + 1, z)] = TALL_GRASS;
      }
      return;
    }

    const cover = swampy ? 0.30 : biome === 4 ? 0.16 : biome === 6 ? 0.05 : biome === 1 ? 0.10 : 0.07;
    if (roll < cover * 0.75) this.data[VoxelWorld.index(x, height + 1, z)] = TALL_GRASS;
    else if (roll < cover && biome !== 6) this.data[VoxelWorld.index(x, height + 1, z)] = FLOWER;
  }

  /** The occasional boulder: a 3-wide lump of stone or gravel sitting on the surface. */
  plantBoulder(x, z, height, beach, biome) {
    if (beach || biome === 2) return;
    if (x < 3 || z < 3 || x > WORLD_X - 4 || z > WORLD_Z - 4) return;
    if (hashCoords(x, 53, z, this.seed ^ 0x71a3) > 0.004) return;
    // Wet ground grows moss on its rocks: mountains and swamps get mossy stone, cold peaks gravel.
    const material = biome === 6 || biome === 3 ? GRAVEL
      : biome === 5 || biome === 1 ? MOSSY_STONE : STONE;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > 1 && dy === 1) continue;
          if (dx === 0 && dz === 0 && dy === 0) continue;
          const px = x + dx, py = height + dy, pz = z + dz;
          if (!this.inside(px, py, pz)) continue;
          if (this.data[VoxelWorld.index(px, py, pz)] !== AIR) continue;
          this.data[VoxelWorld.index(px, py, pz)] = material;
        }
      }
    }
  }

  plantTree(x, z, height, biome, beach) {
    if (beach || height <= SEA_LEVEL + 1) return;
    if (biome === 2) return; // deserts stay bare
    const density = biome === 1 ? 0.055 : biome === 3 ? 0.03 : biome === 5 ? 0.03 : biome === 6 ? 0.004 : biome === 4 ? 0.006 : 0.012;
    if (hashCoords(x, 7, z, this.seed) > density) return;
    if (x < 3 || z < 3 || x > WORLD_X - 4 || z > WORLD_Z - 4) return;
    if (biome === 3) return this.plantSpruce(x, z, height);
    if (biome === 5) return this.plantSwampTree(x, z, height);
    // Just under half of the broadleaf trees are birches, so forests read as mixed woodland.
    if (hashCoords(x, 23, z, this.seed ^ 0x5a11) < 0.42) return this.plantBirch(x, z, height);
    const tall = biome === 4;
    const trunk = (tall ? 5 : 4) + Math.floor(hashCoords(x, 11, z, this.seed) * 3);
    for (let i = 1; i <= trunk; i++) this.data[VoxelWorld.index(x, height + i, z)] = LOG;
    const crown = height + trunk;
    const radius = tall ? 2 : 2;
    for (let dy = -2; dy <= 1; dy++) {
      const spread = dy <= -1 ? radius : radius - (dy + 2) * 0.6;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const distance = Math.hypot(dx, dz) + Math.abs(dy) * 0.35;
          if (distance > spread + 0.45) continue;
          if (dx === 0 && dz === 0 && dy < 1) continue;
          const px = x + dx, py = crown + dy, pz = z + dz;
          if (this.inside(px, py, pz) && this.data[VoxelWorld.index(px, py, pz)] === AIR) {
            this.data[VoxelWorld.index(px, py, pz)] = LEAVES;
          }
        }
      }
    }
  }

  /** A slimmer, paler trunk with a smaller, higher crown than an oak. */
  plantBirch(x, z, height) {
    const trunk = 5 + Math.floor(hashCoords(x, 17, z, this.seed) * 4);
    if (height + trunk + 2 >= WORLD_Y - 1) return;
    for (let i = 1; i <= trunk; i++) this.data[VoxelWorld.index(x, height + i, z)] = BIRCH_LOG;
    const crown = height + trunk;
    for (let dy = -1; dy <= 2; dy++) {
      const radius = dy <= 0 ? 2 : 1;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && dy >= 1) continue;
          const px = x + dx, py = crown + dy, pz = z + dz;
          if (!this.inside(px, py, pz)) continue;
          if (this.data[VoxelWorld.index(px, py, pz)] === AIR) {
            this.data[VoxelWorld.index(px, py, pz)] = BIRCH_LEAVES;
          }
        }
      }
    }
  }

  /** A pumpkin sitting on the grass — a splash of colour in plains and forests. */
  plantPumpkin(x, z, height, biome, beach) {
    if (beach || height <= SEA_LEVEL + 1) return;
    if (biome !== 0 && biome !== 1) return;
    if (hashCoords(x, 41, z, this.seed ^ 0x7f4a) > 0.004) return;
    const y = height + 1;
    if (!this.inside(x, y, z)) return;
    if (this.data[VoxelWorld.index(x, y, z)] !== AIR) return;
    this.data[VoxelWorld.index(x, y, z)] = PUMPKIN;
  }

  /** Conical spruce, the snow biome's signature. */
  plantSpruce(x, z, height) {
    const trunk = 6 + Math.floor(hashCoords(x, 11, z, this.seed) * 4);
    if (height + trunk + 1 >= WORLD_Y - 1) return;
    for (let i = 1; i <= trunk; i++) this.data[VoxelWorld.index(x, height + i, z)] = SPRUCE_LOG;
    for (let layer = 0; layer < trunk - 1; layer++) {
      const y = height + 2 + layer;
      const radius = layer % 2 === 0 ? 2 : 1;
      const shrink = Math.floor(layer / 3);
      const r = Math.max(0, radius - shrink);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && r > 1) continue;
          const px = x + dx, py = y, pz = z + dz;
          if (!this.inside(px, py, pz)) continue;
          if (this.data[VoxelWorld.index(px, py, pz)] !== AIR) continue;
          if (dx === 0 && dz === 0) continue;
          this.data[VoxelWorld.index(px, py, pz)] = SPRUCE_LEAVES;
        }
      }
    }
    const top = height + trunk;
    if (this.inside(x, top, z)) this.data[VoxelWorld.index(x, top, z)] = SPRUCE_LEAVES;
    if (this.inside(x, top + 1, z)) this.data[VoxelWorld.index(x, top + 1, z)] = SPRUCE_LEAVES;
  }

  /** A swamp tree with a wider, flatter canopy and a hint of a root flare. */
  plantSwampTree(x, z, height) {
    const trunk = 4 + Math.floor(hashCoords(x, 11, z, this.seed) * 3);
    if (height + trunk >= WORLD_Y - 1) return;
    for (let i = 1; i <= trunk; i++) this.data[VoxelWorld.index(x, height + i, z)] = LOG;
    const crown = height + trunk;
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.hypot(dx, dz) > 3.2) continue;
        const px = x + dx, py = crown, pz = z + dz;
        if (this.inside(px, py, pz) && this.data[VoxelWorld.index(px, py, pz)] === AIR) {
          this.data[VoxelWorld.index(px, py, pz)] = LEAVES;
        }
      }
    }
  }

  // ------------------------------------------------------------------ world sim

  /**
   * A gravity block (sand, gravel, a pumpkin) drops until something solid stops it.
   * @returns {number} how many blocks it fell, 0 if it stayed put
   */
  dropBlock(x, y, z) {
    const id = this.get(x, y, z);
    if (!blockById(id).falling) return 0;
    let target = y;
    while (target > 0 && !blockById(this.get(x, target - 1, z)).solid) target--;
    if (target === y) return 0;
    this.set(x, y, z, AIR);
    this.set(x, target, z, id);
    return y - target;
  }

  /** Gravity blocks that should be re-checked this tick (filled by set() and by digging). */
  queueFalling(x, y, z) {
    this.fallQueue ??= new Set();
    this.fallQueue.add(`${x},${y},${z}`);
  }

  /** Advance one world tick of falling sand, saplings and leaf decay. */
  /**
   * A sandbox world: a flat plateau of grass on dirt over stone, sea level well below the surface,
   * a scattering of trees, flowers and a couple of boulders so it does not look like a blank plane.
   */
  generateFlat({ height = 28 } = {}) {
    this.flatHeight = height;
    for (let z = 0; z < WORLD_Z; z++) {
      for (let x = 0; x < WORLD_X; x++) {
        for (let y = 0; y <= height; y++) {
          const id = y === 0 ? OBSIDIAN : y === height ? GRASS : y >= height - 3 ? DIRT : STONE;
          this.set(x, y, z, id);
        }
      }
    }
    // Trees on a coarse grid, thinned by hash noise, plus the odd flower: deterministic per seed.
    for (let z = 4; z < WORLD_Z - 4; z += 7) {
      for (let x = 4; x < WORLD_X - 4; x += 7) {
        const roll = hashCoords(x, z, this.seed, 91);
        if (roll > 0.34) continue;
        // plantTree takes the *ground* level and plants upward from there, exactly like the
        // generated worlds do.
        this.plantTree(x, z, height, 0, false);
      }
    }
    for (let z = 0; z < WORLD_Z; z += 3) {
      for (let x = 0; x < WORLD_X; x += 3) {
        if (this.get(x, height + 1, z) !== AIR) continue;
        const roll = hashCoords(x, z, this.seed, 37);
        if (roll < 0.06) this.set(x, height + 1, z, FLOWER);
        else if (roll < 0.12) this.set(x, height + 1, z, TALL_GRASS);
        else if (roll > 0.985) this.set(x, height + 1, z, PUMPKIN);
      }
    }
    // Same contract as generate(): from here on, edits simulate and light can be scanned.
    this.ready = true;
    this.fallQueue = new Set();
    this.saplings = new Map();
    this.age = 0;
    this.flat = true;
    return height;
  }

  worldTick(rng = Math.random) {
    const moved = [];
    if (this.fallQueue?.size) {
      const queue = [...this.fallQueue];
      this.fallQueue.clear();
      for (const key of queue) {
        const [x, y, z] = key.split(',').map(Number);
        // The queued cell first, then its neighbours: breaking a support starts a whole column.
        const cells = [[x, y, z], [x, y + 1, z], [x, y - 1, z],
          [x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1]];
        for (const [cx, cy, cz] of cells) {
          const id = this.get(cx, cy, cz);
          if (!blockById(id).falling) continue;
          const fell = this.dropBlock(cx, cy, cz);
          if (!fell) continue;
          moved.push({ x: cx, y: cy, z: cz, to: cy - fell, id });
          // Anything that was resting on the block that just moved has to be re-checked as well.
          this.queueFalling(cx, cy + 1, cz);
          this.queueFalling(cx, cy - fell + 1, cz);
        }
      }
    }

    // Saplings grow up once they have been in the ground long enough.
    this.saplings ??= new Map();
    for (const [key, plantedAt] of [...this.saplings]) {
      const age = (this.age ?? 0) - plantedAt;
      if (age < 24) continue;
      const [x, y, z] = key.split(',').map(Number);
      if (this.get(x, y, z) !== SAPLING) { this.saplings.delete(key); continue; }
      this.saplings.delete(key);
      if (this.growTree(x, y, z)) moved.push({ x, y, z, to: y, id: 'grown' });
    }
    // Water that was disturbed by digging spreads a little further each tick.
    for (const cell of this.flowWater()) {
      moved.push({ x: cell.x, y: cell.y, z: cell.z, to: cell.y, id: WATER, wet: true });
    }
    this.age = (this.age ?? 0) + 1;
    return moved;
  }

  /** Turn a sapling into a proper tree, choosing the species from the biome. */
  growTree(x, y, z) {
    const biome = this.biomeAt(x, z);
    if (y + 8 >= WORLD_Y) return false;
    if (biome === 3) { this.plantSpruce(x, z, y - 1); return true; }
    if (biome === 5) { this.plantSwampTree(x, z, y - 1); return true; }
    this.set(x, y, z, AIR);
    this.plantTree(x, z, y - 1, biome === 1 ? 1 : 0, false);
    if (this.get(x, y, z) !== LOG && this.get(x, y, z) !== BIRCH_LOG) {
      // plantTree rolls its own density; force a trunk when the roll said no.
      const trunk = 5;
      for (let i = 1; i <= trunk; i++) this.set(x, y - 1 + i, z, LOG);
      this.plantCrown(x, y - 1 + trunk, z, LEAVES, 2);
      return true;
    }
    return true;
  }

  /** A round crown, used when a sapling forces a tree. */
  plantCrown(x, y, z, leaf, radius) {
    for (let dy = -2; dy <= 1; dy++) {
      const spread = dy <= -1 ? radius : radius - (dy + 2) * 0.6;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.hypot(dx, dz) + Math.abs(dy) * 0.35 > spread + 0.45) continue;
          if (dx === 0 && dz === 0 && dy < 1) continue;
          if (this.get(x + dx, y + dy, z + dz) === AIR) this.set(x + dx, y + dy, z + dz, leaf);
        }
      }
    }
  }

  /** Remember a sapling so the world tick can grow it. */
  plantSapling(x, y, z) {
    this.saplings ??= new Map();
    this.saplings.set(`${x},${y},${z}`, this.age ?? 0);
    return this.saplings.size;
  }

  /**
   * Leaf decay: when a trunk goes, any leaf that can no longer reach a log within five steps
   * withers away. Returns the cells that were cleared.
   */
  decayLeaves(x, y, z, { reach = 5 } = {}) {
    const cleared = [];
    const seen = new Set();
    const queue = [[x, y, z, 0]];
    while (queue.length) {
      const [cx, cy, cz, depth] = queue.shift();
      if (depth > reach) continue;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        const key = `${nx},${ny},${nz}`;
        if (seen.has(key)) continue;
        const id = this.get(nx, ny, nz);
        if (id === LOG || id === SPRUCE_LOG || id === BIRCH_LOG) return cleared;   // still anchored
        if (!this.isLeaf(id)) continue;
        seen.add(key);
        queue.push([nx, ny, nz, depth + 1]);
      }
    }
    for (const key of seen) {
      const [cx, cy, cz] = key.split(',').map(Number);
      if (this.isLeaf(this.get(cx, cy, cz))) {
        this.set(cx, cy, cz, AIR);
        cleared.push({ x: cx, y: cy, z: cz });
      }
    }
    return cleared;
  }

  isLeaf(id) { return id === LEAVES || id === SPRUCE_LEAVES || id === BIRCH_LEAVES; }

  /** Whether a cell (or the one below) is lava, for damage and the heat haze. */
  isLava(x, y, z) { return this.get(x, y, z) === LAVA; }

  /** Light level 0-15 at a cell: the sun by day, plus whatever torches and lava are nearby. */
  lightAt(x, y, z) {
    return this.light ? this.light.at(Math.floor(x), Math.floor(y), Math.floor(z)) : 15;
  }

  /** Light from blocks only, ignoring the sun — used to check that torches really light a room. */
  torchLightAt(x, y, z) {
    return this.light ? this.light.blockLightAt(Math.floor(x), Math.floor(y), Math.floor(z)) : 0;
  }

  /** Torches and lava found in the terrain, for the debug overlay and the tests. */
  get lightSourceCount() { return this.light ? this.light.sources.size : 0; }

  /** A safe, dry spot near the middle of the map for a fresh spawn. */
  spawnPoint() {
    for (let attempt = 0; attempt < 400; attempt++) {
      const angle = attempt * 0.7;
      const radius = 6 + attempt * 0.35;
      const x = Math.floor(WORLD_X / 2 + Math.cos(angle) * radius);
      const z = Math.floor(WORLD_Z / 2 + Math.sin(angle) * radius);
      if (x < 2 || z < 2 || x > WORLD_X - 3 || z > WORLD_Z - 3) continue;
      const height = this.surfaceHeight(x, z);
      if (height <= SEA_LEVEL + 2) continue;
      if (this.get(x, height, z) === AIR) continue;
      if (this.get(x, height + 1, z) !== AIR || this.get(x, height + 2, z) !== AIR) continue;
      return { x: x + 0.5, y: height + 1, z: z + 0.5 };
    }
    return { x: WORLD_X / 2 + 0.5, y: SEA_LEVEL + 6, z: WORLD_Z / 2 + 0.5 };
  }

  biomeNameAt(x, z) { return BIOMES[this.biomeAt(Math.floor(x), Math.floor(z))]; }
}
