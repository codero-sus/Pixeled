/**
 * Terrain generation. One chunk at a time, derived from the world seed alone, so the same seed
 * always rebuilds the same landscape — and a brand-new seed gives a brand-new world.
 *
 * The generator layers, in order:
 *   1. continental shape and hills, plus a separate mountain mask for dramatic peaks
 *   2. a sea-level fill, so low ground becomes ocean, lakes or rivers
 *   3. biomes from temperature/humidity noise: plains, forest, desert, snow, mountains
 *   4. caves carved with 3D noise, occasionally lit by glowstone
 *   5. decorations: trees, cacti, tall grass and flowers
 *   6. the player's saved edits, replayed on top so builds survive regeneration
 */

import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from './constants.js';
import { fbm2, fbm3, hash3, hashFloat, noise2 } from './noise.js';

const BEDROCK = 1;

/** Push a noise value away from the average so biomes and terrain cover their full range. */
function contrast(value, strength = 1.8) {
  return Math.max(0, Math.min(1, 0.5 + (value - 0.5) * strength));
}
const STRUCTURE_REACH = 3; // how far a tree or cactus can lean into a neighbouring chunk

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.data = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
    this.heights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.highest = 0;
    this.generated = false;
    this.dirty = true;
    this.meshed = false;
  }

  static index(x, y, z) { return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x; }

  get(x, y, z) { return this.data[Chunk.index(x, y, z)]; }

  set(x, y, z, id) {
    this.data[Chunk.index(x, y, z)] = id;
    if (id !== 0 && y > this.highest) this.highest = y;
  }

  /** Topmost non-air block in a column; kept up to date during generation. */
  height(x, z) { return this.heights[z * CHUNK_SIZE + x]; }

  setHeight(x, z, y) { this.heights[z * CHUNK_SIZE + x] = y; }
}

export class TerrainGenerator {
  constructor(seed, edits = new Map()) {
    this.seed = seed >>> 0;
    this.edits = edits;
    this.cache = null;
  }

  // ------------------------------------------------------------------ shape & biome

  /** Terrain height (top solid block) at a world column. */
  heightAt(x, z) {
    const seed = this.seed;
    const continent = fbm2(x * 0.0075, z * 0.0075, seed, 4);
    const hills = fbm2(x * 0.017, z * 0.017, seed + 101, 3);
    const mountainMask = Math.max(0, (fbm2(x * 0.0035, z * 0.0035, seed + 211, 3) - 0.48) * 3.6);
    const mountain = Math.pow(mountainMask, 1.6) * 46;
    const ridges = Math.abs(noise2(x * 0.09, z * 0.09, seed + 307) - 0.5) * 2.4;
    let height = SEA_LEVEL - 3 + (continent - 0.428) * 60 + (hills - 0.45) * 11 + mountain + ridges;
    // Flatten shorelines slightly so beaches read clearly.
    const beach = Math.max(0, 1 - Math.abs(height - SEA_LEVEL) / 3);
    height = height * (1 - beach * 0.25) + SEA_LEVEL * beach * 0.25;
    return Math.max(BEDROCK + 1, Math.min(WORLD_HEIGHT - 12, Math.round(height)));
  }

  temperatureAt(x, z) { return contrast(fbm2(x * 0.0055, z * 0.0055, this.seed + 401, 3), 2.4); }
  humidityAt(x, z) { return contrast(fbm2(x * 0.0072, z * 0.0072, this.seed + 509, 3), 2.2); }

  biomeAt(x, z, height = this.heightAt(x, z)) {
    if (height > SEA_LEVEL + 26) return 'mountain';
    const temperature = this.temperatureAt(x, z);
    const humidity = this.humidityAt(x, z);
    if (temperature > 0.78 && humidity < 0.55) return 'desert';
    if (temperature < 0.30) return 'snow';
    if (humidity > 0.58) return 'forest';
    return 'plains';
  }

  /** The stack of natural blocks below the surface, top first, for a biome and altitude. */
  surfaceLayers(biome, height) {
    if (biome !== 'snow' && biome !== 'mountain' && height <= SEA_LEVEL + 1) return [5, 5, 6]; // beach
    if (biome === 'desert') return [5, 5, 5, 6];
    if (biome === 'snow') return [11, 2, 2];
    if (biome === 'mountain' && height > SEA_LEVEL + 34) return [11, 3, 3];
    return [1, 2, 2, 2];
  }

  // ------------------------------------------------------------------ chunks

  generateChunk(cx, cz) {
    const chunk = new Chunk(cx, cz);
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    this.cache = new Map();

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const worldX = baseX + x;
        const worldZ = baseZ + z;
        const height = this.heightAt(worldX, worldZ);
        const layers = this.surfaceLayers(this.biomeAt(worldX, worldZ, height), height);
        let top = 0;
        for (let y = 0; y <= height; y++) {
          let block;
          if (y <= BEDROCK) block = 3;
          else if (y === height) block = layers[0];
          else {
            const below = height - y - 1;
            block = below < layers.length ? layers[below] : 3;
          }
          chunk.set(x, y, z, block);
          top = y;
        }
        for (let y = height + 1; y <= SEA_LEVEL; y++) {
          chunk.set(x, y, z, 10);
          top = y;
        }
        chunk.setHeight(x, z, top);
      }
    }

    this.carveCaves(chunk, baseX, baseZ);
    this.decorate(chunk, baseX, baseZ);
    this.applyEdits(chunk, baseX, baseZ);
    this.cache = null;
    chunk.generated = true;
    chunk.dirty = true;
    return chunk;
  }

  carveCaves(chunk, baseX, baseZ) {
    const seed = this.seed + 1301;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const worldX = baseX + x;
        const worldZ = baseZ + z;
        const { height } = this.column(worldX, worldZ);
        const floor = Math.max(BEDROCK + 2, height - 44);
        for (let y = floor; y < height - 1; y++) {
          const current = chunk.get(x, y, z);
          if (current === 0 || current === 10) continue;
          const worm = fbm3(worldX * 0.055, y * 0.09, worldZ * 0.055, seed, 3);
          const hollow = fbm3(worldX * 0.02, y * 0.05, worldZ * 0.02, seed + 77, 2);
          if (worm > 0.6 && hollow > 0.42) {
            chunk.set(x, y, z, 0);
            // Sprinkle glowing stone so caves are worth exploring.
            if (y > 1 && chunk.get(x, y - 1, z) === 3 && hashFloat(worldX, y, worldZ, seed + 5) < 0.012) {
              chunk.set(x, y - 1, z, 15);
            }
          }
        }
      }
    }
  }

  /**
   * Trees, cacti and ground cover.
   *
   * The scan runs over a padded band around the chunk so structures rooted in neighbouring
   * chunks still spill their branches in here. `setLocal` clips every write to this chunk, and
   * because placement only depends on world coordinates, the neighbours generate identical
   * cells — the seams match exactly.
   */
  decorate(chunk, baseX, baseZ) {
    for (let dz = -STRUCTURE_REACH; dz < CHUNK_SIZE + STRUCTURE_REACH; dz++) {
      for (let dx = -STRUCTURE_REACH; dx < CHUNK_SIZE + STRUCTURE_REACH; dx++) {
        const worldX = baseX + dx;
        const worldZ = baseZ + dz;
        const { height, biome } = this.column(worldX, worldZ);
        if (height <= SEA_LEVEL) continue; // underwater columns stay bare
        const roll = hashFloat(worldX, height, worldZ, this.seed + 907);

        if (biome === 'desert') {
          if (roll < 0.014) this.placeCactus(chunk, dx, height, dz, worldX, worldZ);
          continue;
        }
        if (this.hasTree(worldX, worldZ) && !this.nearStructure(worldX, worldZ, 2)) {
          this.placeTree(chunk, dx, height, dz, worldX, worldZ, biome === 'snow');
          continue;
        }
        if (biome === 'plains' || biome === 'forest' || biome === 'snow') {
          const deco = hashFloat(worldX, height + 7, worldZ, this.seed + 1907);
          if (deco < 0.15) this.setLocal(chunk, dx, height + 1, dz, 16);
          else if (deco < 0.172) this.setLocal(chunk, dx, height + 1, dz, 17);
          else if (deco < 0.194) this.setLocal(chunk, dx, height + 1, dz, 18);
        }
      }
    }
  }

  /** Keeps trees from growing straight through each other. */
  /** Would this column grow a tree? Shared by decorate() and nearStructure() so they agree. */
  hasTree(x, z) {
    const { height, biome } = this.column(x, z);
    if (height <= SEA_LEVEL || biome === 'desert') return false;
    const chance = biome === 'forest' ? 0.045 : biome === 'snow' ? 0.02 : biome === 'mountain' ? 0.006 : 0.008;
    return hashFloat(x, height, z, this.seed + 907) < chance;
  }

  /** Keeps trees from growing straight through each other. */
  nearStructure(x, z, radius) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dz === 0) continue;
        if (this.hasTree(x + dx, z + dz)) return true;
      }
    }
    return false;
  }

  /** Height and biome for a column, memoised for the chunk currently being built. */
  column(x, z) {
    if (!this.cache) return this.computeColumn(x, z);
    const key = x + ',' + z;
    let entry = this.cache.get(key);
    if (!entry) {
      entry = this.computeColumn(x, z);
      this.cache.set(key, entry);
    }
    return entry;
  }

  computeColumn(x, z) {
    const height = this.heightAt(x, z);
    return { height, biome: this.biomeAt(x, z, height) };
  }

  setLocal(chunk, x, y, z, id) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    chunk.set(x, y, z, id);
    if (id !== 0 && y > chunk.height(x, z)) chunk.setHeight(x, z, y);
  }

  placeTree(chunk, x, ground, z, worldX, worldZ, snowy) {
    const rng = hash3(worldX, ground, worldZ, this.seed + 31);
    const trunk = snowy ? 6 + (rng % 3) : 4 + (rng % 3);
    for (let i = 1; i <= trunk; i++) this.setLocal(chunk, x, ground + i, z, 7);
    const top = ground + trunk;
    if (snowy) {
      // Spruce: narrow, layered cone.
      for (let layer = 3; layer >= 0; layer--) {
        const radius = layer === 0 ? 0 : layer === 1 ? 1 : 2;
        const y = top + (3 - layer);
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > radius + 0.5) continue;
            if (dx === 0 && dz === 0 && layer !== 0) continue;
            this.setLocal(chunk, x + dx, y, z + dz, 8);
          }
        }
      }
      this.setLocal(chunk, x, top + 4, z, 8);
    } else {
      // Oak: fat blobby crown.
      for (let dy = -2; dy <= 2; dy++) {
        const radius = dy <= -2 || dy === 2 ? 1 : 2;
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx === 0 && dz === 0 && dy <= 0) continue;
            if (Math.abs(dx) === radius && Math.abs(dz) === radius && dy !== 0) continue;
            this.setLocal(chunk, x + dx, top + dy, z + dz, 8);
          }
        }
      }
      this.setLocal(chunk, x, top + 3, z, 8);
    }
  }

  placeCactus(chunk, x, ground, z, worldX, worldZ) {
    const height = 1 + (hash3(worldX, ground, worldZ, this.seed + 53) % 3);
    for (let i = 1; i <= height; i++) this.setLocal(chunk, x, ground + i, z, 14);
  }

  /** Replay the player's saved edits on top of freshly generated terrain. */
  applyEdits(chunk, baseX, baseZ) {
    if (this.edits.size === 0) return;
    let touched = false;
    for (const [key, id] of this.edits) {
      const comma = key.indexOf(',');
      const second = key.indexOf(',', comma + 1);
      const x = Number(key.slice(0, comma));
      const y = Number(key.slice(comma + 1, second));
      const z = Number(key.slice(second + 1));
      const lx = x - baseX, lz = z - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) continue;
      chunk.set(lx, y, lz, id);
      touched = true;
    }
    if (!touched) return;
    // Recompute cached column tops so meshing never misses a player-built tower.
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          if (chunk.get(x, y, z) !== 0) { chunk.setHeight(x, z, y); break; }
        }
      }
    }
  }
}
