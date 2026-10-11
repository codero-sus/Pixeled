/**
 * The voxel world: a flat Uint8Array of block ids plus the generator that fills it.
 *
 * Generation layers, in the order they are applied:
 *   1. continental shelf + hills + fine detail (2D noise) -> surface height
 *   2. biomes from temperature/moisture noise  3. water up to sea level
 *   4. caves carved with 3D noise  5. trees planted per biome
 */

import { AIR, DIRT, GRASS, LEAVES, LOG, SAND, SNOW, STONE, WATER, blockById } from './constants.js';
import { Noise, hashCoords } from './noise.js';
import { SEA_LEVEL, WORLD_X, WORLD_Y, WORLD_Z } from './constants.js';

export const BIOMES = ['plains', 'forest', 'desert', 'snow'];

function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }

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
    const temperature = this.noise.fbm2(x * 0.0031 + 7.3, z * 0.0031 + 2.1, 3);
    const moisture = this.noise.fbm2(x * 0.0043 - 4.7, z * 0.0043 + 9.4, 3);
    if (temperature < 0.34) return 3;      // snow
    if (moisture < 0.36 && temperature > 0.5) return 2; // desert
    if (moisture > 0.6) return 1;          // forest
    return 0;                              // plains
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
        const alpine = height > 36 && !beach;
        for (let y = 0; y <= height; y++) {
          let id = STONE;
          if (y === height) id = beach ? SAND : alpine || biome === 3 ? SNOW : biome === 2 ? SAND : GRASS;
          else if (y > height - 4) id = beach ? SAND : alpine ? STONE : DIRT;
          if (y === 0) id = STONE;
          if (y > 0 && y < height - 2 && this.caveAt(x, y, z)) continue;
          data[VoxelWorld.index(x, y, z)] = id;
        }
        for (let y = height + 1; y <= SEA_LEVEL; y++) data[VoxelWorld.index(x, y, z)] = WATER;
        this.plantTree(x, z, height, biome, beach);
      }
    }
  }

  caveAt(x, y, z) {
    return this.noise.fbm3(x * 0.055, y * 0.085, z * 0.055, 3) > 0.63;
  }

  plantTree(x, z, height, biome, beach) {
    if (beach || height <= SEA_LEVEL + 1) return;
    if (biome === 2) return; // deserts stay bare
    const density = biome === 1 ? 0.055 : biome === 3 ? 0.02 : 0.012;
    if (hashCoords(x, 7, z, this.seed) > density) return;
    if (x < 3 || z < 3 || x > WORLD_X - 4 || z > WORLD_Z - 4) return;
    const tall = biome === 3;
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
