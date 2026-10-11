/**
 * The voxel world: chunk storage, block queries, edits and ray casting.
 *
 * Chunks are generated lazily and can be unloaded again, which is what lets the world feel
 * endless without a loading screen in the middle of a walk. Player edits are kept separately so
 * they can be saved compactly and replayed over freshly generated terrain.
 */

import {
  BLOCK_NAMES, CHUNK_SIZE, HARDNESS, IS_LIQUID, IS_OPAQUE, IS_PLANT, IS_SOLID, LIGHT_BLOCKS, WORLD_HEIGHT,
} from './constants.js';
import { TerrainGenerator } from './generator.js';

export class VoxelWorld {
  constructor(seed, edits = new Map()) {
    this.seed = seed >>> 0;
    this.edits = edits;
    this.generator = new TerrainGenerator(seed, edits);
    this.chunks = new Map();
    this.stats = { generated: 0, meshed: 0 };
  }

  static key(cx, cz) { return `${cx},${cz}`; }

  chunk(cx, cz) { return this.chunks.get(VoxelWorld.key(cx, cz)); }

  ensureChunk(cx, cz) {
    const key = VoxelWorld.key(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = this.generator.generateChunk(cx, cz);
      this.chunks.set(key, chunk);
      this.stats.generated++;
    }
    return chunk;
  }

  hasChunk(cx, cz) { return this.chunks.has(VoxelWorld.key(cx, cz)); }

  unloadChunk(cx, cz) { return this.chunks.delete(VoxelWorld.key(cx, cz)); }

  // ------------------------------------------------------------------ blocks

  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const cx = x >> 4, cz = z >> 4;
    const chunk = this.chunks.get(VoxelWorld.key(cx, cz));
    if (!chunk) return 0;
    return chunk.get(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
  }

  /** Blocks the player collides with. */
  isSolid(x, y, z) { return IS_SOLID[this.getBlock(x, y, z)] === true; }

  /** Blocks that hide their neighbours' faces. */
  isOpaque(x, y, z) { return IS_OPAQUE[this.getBlock(x, y, z)] === true; }

  isLiquid(x, y, z) { return IS_LIQUID[this.getBlock(x, y, z)] === true; }

  isPlant(x, y, z) { return IS_PLANT[this.getBlock(x, y, z)] === true; }

  /** Targetable blocks are everything except air and water. */
  isTargetable(x, y, z) {
    const block = this.getBlock(x, y, z);
    return block !== 0 && !IS_LIQUID[block];
  }

  nameOf(id) { return BLOCK_NAMES[id] ?? 'Air'; }

  hardnessOf(id) { return HARDNESS[id] ?? 1; }

  isLightSource(id) { return LIGHT_BLOCKS[id] === true; }

  setBlock(x, y, z, id, record = true) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = x >> 4, cz = z >> 4;
    const chunk = this.ensureChunk(cx, cz);
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    const previous = chunk.get(lx, y, lz);
    if (previous === id) return false;
    chunk.set(lx, y, lz, id);
    if (id !== 0 && y > chunk.height(lx, lz)) chunk.setHeight(lx, lz, y);
    if (id === 0 && y >= chunk.height(lx, lz)) {
      for (let scan = y; scan >= 0; scan--) {
        if (chunk.get(lx, scan, lz) !== 0) { chunk.setHeight(lx, lz, scan); break; }
        if (scan === 0) chunk.setHeight(lx, lz, 0);
      }
    }
    chunk.dirty = true;
    if (record) this.edits.set(`${x},${y},${z}`, id);
    // Neighbouring meshes need rebuilding when a border block changes.
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    return true;
  }

  markDirty(cx, cz) {
    const chunk = this.chunks.get(VoxelWorld.key(cx, cz));
    if (chunk) chunk.dirty = true;
  }

  /** Highest non-air block in a column, or -1 when the chunk is not loaded. */
  columnTop(x, z) {
    const chunk = this.chunk(x >> 4, z >> 4);
    if (!chunk) return -1;
    return chunk.height(x - (x >> 4) * CHUNK_SIZE, z - (z >> 4) * CHUNK_SIZE);
  }

  // ------------------------------------------------------------------ ray casting

  /**
   * Amanatides & Woo voxel traversal: walks the grid one cell at a time and returns the first
   * targetable block, together with the face the ray entered through.
   */
  raycast(origin, direction, maxDistance = 6) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const dx = direction.x, dy = direction.y, dz = direction.z;
    const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
    const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
    const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
    const tDeltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);
    const boundary = (position, step) => (step > 0 ? Math.floor(position) + 1 - position : position - Math.floor(position));
    let tMaxX = dx === 0 ? Infinity : boundary(origin.x, stepX) * tDeltaX;
    let tMaxY = dy === 0 ? Infinity : boundary(origin.y, stepY) * tDeltaY;
    let tMaxZ = dz === 0 ? Infinity : boundary(origin.z, stepZ) * tDeltaZ;
    let nx = 0, ny = 0, nz = 0;
    let distance = 0;

    // The starting cell counts too, so mining the block you are standing in works.
    for (let guard = 0; guard < 512; guard++) {
      if (this.isTargetable(x, y, z)) {
        return { x, y, z, block: this.getBlock(x, y, z), nx, ny, nz, distance };
      }
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) { x += stepX; distance = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
        else { z += stepZ; distance = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
      } else {
        if (tMaxY < tMaxZ) { y += stepY; distance = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
        else { z += stepZ; distance = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
      }
      if (distance > maxDistance + 1) break;
      if (y < -1 || y > WORLD_HEIGHT + 1) break;
    }
    return null;
  }

  // ------------------------------------------------------------------ spawning

  /** Walk outwards from the origin until dry land with headroom appears. */
  findSpawn(preferX = 0, preferZ = 0) {
    for (let radius = 0; radius <= 96; radius += 4) {
      for (let angle = 0; angle < 12; angle++) {
        const x = Math.round(preferX + Math.cos(angle) * radius);
        const z = Math.round(preferZ + Math.sin(angle) * radius);
        this.ensureChunk(x >> 4, z >> 4);
        const top = this.columnTop(x, z);
        if (top < 0) continue;
        const ground = this.getBlock(x, top, z);
        if (ground === 0 || ground === 10) continue;
        if (this.getBlock(x, top + 1, z) !== 0 || this.getBlock(x, top + 2, z) !== 0) continue;
        return { x: x + 0.5, y: top + 1, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: WORLD_HEIGHT - 20, z: 0.5 };
  }

  /** The column the player is standing on, for the HUD. */
  describeColumn(x, z) {
    const cx = x >> 4, cz = z >> 4;
    this.ensureChunk(cx, cz);
    const biome = this.generator.biomeAt(Math.floor(x), Math.floor(z));
    return biome;
  }
}
