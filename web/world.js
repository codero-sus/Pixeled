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
  SPRUCE_LEAVES, SPRUCE_LOG, STONE, TALL_GRASS, WATER, blockById,
} from './constants.js';
import { Noise, hashCoords } from './noise.js';
import { SEA_LEVEL, WORLD_X, WORLD_Y, WORLD_Z } from './constants.js';

export const BIOMES = ['plains', 'forest', 'desert', 'snow', 'savanna', 'swamp', 'mountains'];

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
  constructor(seed) {
    this.seed = seed >>> 0;
    this.noise = new Noise(this.seed);
    this.data = new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z);
    this.edits = new Map();
    this.continentMean = 0.42;
    this.calibrate();
    this.generate();
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

  set(x, y, z, id) {
    if (!this.inside(x, y, z)) return false;
    this.data[VoxelWorld.index(x, y, z)] = id;
    this.edits.set(`${x},${y},${z}`, id);
    return true;
  }

  applyEdits(edits) {
    for (const [key, id] of edits) {
      const [x, y, z] = key.split(',').map(Number);
      if (this.inside(x, y, z)) this.data[VoxelWorld.index(x, y, z)] = id;
      this.edits.set(key, id);
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
