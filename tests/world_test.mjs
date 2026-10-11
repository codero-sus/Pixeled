/**
 * World, generator and mesher tests — everything that does not need a browser.
 *
 *   node tests/world_test.mjs
 */

import assert from 'node:assert/strict';

import { ATLAS_PIXELS, BLOCKS, CHUNK_SIZE, SEA_LEVEL, TILES, WORLD_HEIGHT } from '../web/constants.js';
import { paintAtlas, averageTileColor, tileUV } from '../web/atlas.js';
import { Chunk, TerrainGenerator } from '../web/generator.js';
import { meshChunk, FACE_TABLE, countFaces } from '../web/mesher.js';
import { VoxelWorld } from '../web/world.js';
import { fbm2, hashFloat, parseSeed, randomSeed, seedLabel } from '../web/noise.js';

// ------------------------------------------------------------------ noise

{
  const a = fbm2(12.3, 45.6, 99, 4);
  const b = fbm2(12.3, 45.6, 99, 4);
  assert.equal(a, b, 'noise is deterministic');
  assert.ok(a >= 0 && a < 1, 'noise stays inside [0, 1)');
  const values = Array.from({ length: 200 }, (_, i) => fbm2(i * 3.1, i * 1.7, 7, 3));
  assert.ok(Math.max(...values) - Math.min(...values) > 0.2, 'noise varies across space');
  assert.equal(hashFloat(1, 2, 3, 4), hashFloat(1, 2, 3, 4), 'hashes are stable');
  assert.equal(parseSeed('  '), null);
  assert.equal(parseSeed('123'), 123);
  assert.equal(parseSeed('meadow'), parseSeed('meadow'));
  assert.notEqual(parseSeed('meadow'), parseSeed('forest'));
  assert.match(seedLabel(7), /^\d{10}$/);
  assert.ok(Number.isInteger(randomSeed()));
}

// ------------------------------------------------------------------ atlas

{
  const pixels = paintAtlas();
  assert.equal(pixels.length, ATLAS_PIXELS * ATLAS_PIXELS * 4);
  const opaqueTiles = [TILES.grass_top, TILES.stone, TILES.dirt, TILES.water, TILES.planks];
  for (const tile of opaqueTiles) {
    const [r, g, b] = averageTileColor(pixels, tile);
    assert.ok(r + g + b > 0.05, `tile ${tile} has visible colour`);
  }
  for (const tile of [TILES.tall_grass, TILES.glass, TILES.flower_red]) {
    const uv = tileUV(tile);
    assert.ok(uv.u0 > 0 && uv.u1 < 1 && uv.v0 > 0 && uv.v1 < 1, 'UVs stay inside the atlas');
  }
  const leaves = averageTileColor(pixels, TILES.leaves);
  const stone = averageTileColor(pixels, TILES.stone);
  assert.ok(leaves[1] > leaves[0] && leaves[1] > leaves[2], 'leaves are green');
  assert.ok(Math.abs(stone[0] - stone[2]) < 0.05, 'stone is neutral grey');
  assert.equal(paintAtlas()[0], pixels[0], 'the atlas is painted deterministically');
}

// ------------------------------------------------------------------ faces

{
  for (const face of FACE_TABLE) {
    const [ax, ay, az] = face.corners[0];
    const [bx, by, bz] = face.corners[1];
    const [cx, cy, cz] = face.corners[2];
    const u = [bx - ax, by - ay, bz - az];
    const v = [cx - ax, cy - ay, cz - az];
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const alignment = normal[0] * face.normal[0] + normal[1] * face.normal[1] + normal[2] * face.normal[2];
    assert.ok(alignment > 0, `face ${face.name} winds outwards`);
  }
}

// ------------------------------------------------------------------ generator

{
  const seed = 123456;
  const generator = new TerrainGenerator(seed);
  const first = generator.generateChunk(0, 0);
  const second = new TerrainGenerator(seed).generateChunk(0, 0);
  assert.deepEqual(Array.from(first.data), Array.from(second.data), 'the same seed rebuilds the same chunk');

  const other = new TerrainGenerator(seed + 1).generateChunk(0, 0);
  let identicalColumns = 0;
  for (let i = 0; i < 256; i++) if (first.heights[i] === other.heights[i]) identicalColumns++;
  assert.ok(identicalColumns < 200, 'a different seed makes a different world');

  const world = new VoxelWorld(seed);
  const stats = { grass: 0, dirt: 0, stone: 0, water: 0, sand: 0, logs: 0, leaves: 0, snow: 0, cacti: 0, plants: 0, glowstone: 0 };
  const surfaces = {};
  // A wide enough neighbourhood to be sure every feature shows up somewhere.
  for (let cx = -6; cx <= 6; cx++) {
    for (let cz = -6; cz <= 6; cz++) world.ensureChunk(cx, cz);
  }
  for (const chunk of world.chunks.values()) {
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = chunk.get(x, y, z);
          if (id === 0) continue;
          if (id === 1) stats.grass++;
          if (id === 2) stats.dirt++;
          if (id === 3) stats.stone++;
          if (id === 5) stats.sand++;
          if (id === 7) stats.logs++;
          if (id === 8) stats.leaves++;
          if (id === 10) { stats.water++; assert.ok(y <= SEA_LEVEL, 'water never sits above sea level'); }
          if (id === 11) stats.snow++;
          if (id === 14) stats.cacti++;
          if (id === 15) stats.glowstone++;
          if (id >= 16) stats.plants++;
        }
      }
    }
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const worldX = chunk.cx * CHUNK_SIZE + x, worldZ = chunk.cz * CHUNK_SIZE + z;
        const biome = world.generator.biomeAt(worldX, worldZ);
        const surface = chunk.get(x, chunk.height(x, z), z);
        (surfaces[biome] ??= {})[surface] = ((surfaces[biome] ?? {})[surface] ?? 0) + 1;
      }
    }
  }

  const dominant = biome => (surfaces[biome]
    ? Number(Object.entries(surfaces[biome]).sort((a, b) => b[1] - a[1])[0][0])
    : null);
  if (surfaces.desert) assert.equal(dominant('desert'), 5, 'deserts are sandy');
  if (surfaces.snow) assert.equal(dominant('snow'), 11, 'snowy biomes are covered in snow');
  if (surfaces.plains) assert.equal(dominant('plains'), 1, 'plains are grassy');
  if (surfaces.forest) assert.equal(dominant('forest'), 1, 'forests are grassy');
  assert.equal(surfaces.desert?.[1], undefined, 'grass never grows in the desert');
  assert.ok(Object.keys(surfaces).length >= 2, `a few biomes appear in the sample (${Object.keys(surfaces).join(', ')})`);

  // Surface layers per biome, independent of where the sample happened to land.
  const gen = world.generator;
  assert.equal(gen.surfaceLayers('desert', 50)[0], 5, 'sand on top in deserts');
  assert.equal(gen.surfaceLayers('snow', 50)[0], 11, 'snow on top in snowy biomes');
  assert.equal(gen.surfaceLayers('plains', 50)[0], 1, 'grass on top in plains');
  assert.equal(gen.surfaceLayers('forest', 50)[0], 1, 'grass on top in forests');
  assert.equal(gen.surfaceLayers('mountain', SEA_LEVEL + 40)[0], 11, 'snow caps the highest peaks');
  assert.equal(gen.surfaceLayers('plains', SEA_LEVEL)[0], 5, 'shorelines turn into beaches');
  assert.ok(stats.stone > 100000, 'the underground is mostly stone');
  assert.ok(stats.grass > 100, 'grass covers the meadows');
  assert.ok(stats.dirt > 500, 'there is dirt under the grass');
  assert.ok(stats.water > 2000, 'oceans and lakes exist nearby');
  assert.ok(stats.logs > 0 && stats.leaves > 0, 'trees grow');
  assert.ok(stats.plants > 0, 'grass and flowers are scattered around');

  // Caves: some air below the surface, and glowstone only ever underground.
  let undergroundAir = 0;
  const chunk = world.chunk(1, 1);
  for (let y = 3; y < 20; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) if (chunk.get(x, y, z) === 0) undergroundAir++;
    }
  }
  assert.ok(undergroundAir > 0, 'caves are carved out below the surface');
  assert.equal(chunk.get(0, 0, 0), 3, 'the bottom layer is solid bedrock');
  world.findSpawn();
  assert.ok(world.stats.generated >= 20, 'chunks are generated on demand');
}

// ------------------------------------------------------------------ edits and heights

{
  const world = new VoxelWorld(777);
  world.ensureChunk(0, 0);
  const spawn = world.findSpawn();
  const groundY = Math.floor(spawn.y) - 1;
  assert.equal(world.setBlock(2, groundY + 1, 3, 15), true, 'a block can be placed');
  assert.equal(world.getBlock(2, groundY + 1, 3), 15, 'and reads back');
  assert.equal(world.columnTop(2, 3), groundY + 1, 'the column height follows the edit');
  assert.equal(world.edits.size, 1, 'the edit is recorded for saving');

  const reloaded = new VoxelWorld(777, new Map(world.edits));
  reloaded.ensureChunk(0, 0);
  assert.equal(reloaded.getBlock(2, groundY + 1, 3), 15, 'edits survive regeneration');

  assert.equal(world.setBlock(2, groundY + 1, 3, 0), true, 'blocks can be removed again');
  assert.equal(world.getBlock(2, groundY + 1, 3), 0);
}

// ------------------------------------------------------------------ meshing

{
  const world = new VoxelWorld(4242);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.ensureChunk(cx, cz);
  const chunk = world.chunk(0, 0);
  const mesh = meshChunk(world, chunk);
  const counts = countFaces(mesh);
  assert.ok(counts.opaque > 100, `a chunk produces plenty of faces (${counts.opaque})`);
  assert.equal(mesh.opaque.positions.length, mesh.opaque.vertices * 3);
  assert.equal(mesh.opaque.indices.length, mesh.opaque.quads * 6);
  assert.equal(mesh.opaque.colors.length, mesh.opaque.vertices * 3);

  for (let i = 0; i < mesh.opaque.colors.length; i++) {
    const shade = mesh.opaque.colors[i];
    assert.ok(shade > 0.05 && shade <= 1.05, `shade stays in range (${shade})`);
  }

  // Meshes are in world space, so chunks tile instead of stacking up.
  {
    const worldA = new VoxelWorld(4242);
    const east = worldB => { worldB.ensureChunk(0, 0); worldB.ensureChunk(1, 0); return worldB; };
    east(worldA);
    const west = meshChunk(worldA, worldA.chunk(0, 0));
    const eastMesh = meshChunk(worldA, worldA.chunk(1, 0));
    const xs = Array.from(west.opaque.positions).filter((_, i) => i % 3 === 0);
    const eastXs = Array.from(eastMesh.opaque.positions).filter((_, i) => i % 3 === 0);
    assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 16, 'chunk 0 spans its own 16 blocks');
    assert.ok(Math.min(...eastXs) >= 16 && Math.max(...eastXs) <= 32, 'the next chunk sits beside it, not on top of it');
  }

  // Every triangle must face the same way as its stored normal.
  for (let i = 0; i < mesh.opaque.indices.length; i += 3) {
    const [a, b, c] = [mesh.opaque.indices[i], mesh.opaque.indices[i + 1], mesh.opaque.indices[i + 2]];
    const ax = mesh.opaque.positions[a * 3], ay = mesh.opaque.positions[a * 3 + 1], az = mesh.opaque.positions[a * 3 + 2];
    const bx = mesh.opaque.positions[b * 3], by = mesh.opaque.positions[b * 3 + 1], bz = mesh.opaque.positions[b * 3 + 2];
    const cx = mesh.opaque.positions[c * 3], cy = mesh.opaque.positions[c * 3 + 1], cz = mesh.opaque.positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const storedX = mesh.opaque.normals[a * 3], storedY = mesh.opaque.normals[a * 3 + 1], storedZ = mesh.opaque.normals[a * 3 + 2];
    assert.ok(nx * storedX + ny * storedY + nz * storedZ > 0, 'triangles wind counter-clockwise when seen from outside');
  }

  // A lone block: six faces, and nothing hidden.
  const lone = new Chunk(0, 0);
  lone.set(0, 40, 0, 3);
  lone.setHeight(0, 0, 40);
  lone.highest = 40;
  const loneWorld = {
    getBlock: (x, y, z) => (x === 0 && y === 40 && z === 0 ? 3 : 0),
    columnTop: () => 40,
    seed: 1,
  };
  assert.deepEqual(countFaces(meshChunk(loneWorld, lone)), { opaque: 6, water: 0, plants: 0 }, 'a lone block is a full cube');

  // Two stacked blocks: the shared faces disappear.
  const stacked = new Chunk(0, 0);
  stacked.set(0, 40, 0, 3);
  stacked.set(0, 41, 0, 3);
  stacked.setHeight(0, 0, 41);
  stacked.highest = 41;
  const both = { getBlock: (x, y, z) => (x === 0 && z === 0 && (y === 40 || y === 41) ? 3 : 0), columnTop: () => 41, seed: 1 };
  assert.equal(countFaces(meshChunk(both, stacked)).opaque, 10, 'stacked blocks hide their shared faces');

  // Ambient occlusion darkens a corner that is boxed in.
  const occluded = new Chunk(0, 0);
  occluded.set(0, 40, 0, 3);
  occluded.set(1, 40, 0, 3);
  occluded.set(0, 41, 0, 3);
  occluded.set(1, 41, 0, 3);
  occluded.set(0, 40, 1, 3);
  occluded.set(1, 40, 1, 3);
  occluded.set(0, 41, 1, 3);
  occluded.set(1, 41, 1, 3);
  occluded.setHeight(0, 0, 41);
  occluded.setHeight(1, 0, 41);
  occluded.setHeight(0, 1, 41);
  occluded.setHeight(1, 1, 41);
  occluded.highest = 41;
  const blocky = { getBlock: (x, y, z) => (x >= 0 && x <= 1 && z >= 0 && z <= 1 && (y === 40 || y === 41) ? 3 : 0), columnTop: () => 41, seed: 1 };
  const blockyMesh = meshChunk(blocky, occluded);
  const shades = Array.from(blockyMesh.opaque.colors).filter((_, i) => i % 3 === 0);
  assert.ok(Math.min(...shades) < 0.5, 'corners tucked into a pocket are darker than open ones');
  assert.ok(Math.max(...shades) > 0.9, 'top faces stay bright');

  // Water: a flat pool drops its surface slightly below the full block.
  const pool = new Chunk(0, 0);
  for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
    pool.set(x, 40, z, 10);
    pool.setHeight(x, z, 40);
  }
  pool.highest = 40;
  const poolWorld = {
    getBlock: (x, y, z) => {
      if (x >= 0 && x < 4 && z >= 0 && z < 4) {
        if (y === 40) return 10;
        if (y < 40) return 3; // solid ground under the pool
      }
      return 0;
    },
    columnTop: () => 40,
    seed: 1,
  };
  const poolMesh = meshChunk(poolWorld, pool);
  // 16 surface quads plus 16 side quads around the rim; the floor is hidden by stone.
  assert.equal(poolMesh.water.quads, 32, 'a flat pool draws its surface and rim only');
  assert.equal(poolMesh.opaque.quads, 0, 'water never lands in the opaque group');
  const heights = Array.from(poolMesh.water.positions).filter((_, i) => i % 3 === 1);
  const near = (a, b) => Math.abs(a - b) < 1e-4;
  const surfaceVertices = heights.filter(y => near(y, 40.88)).length;
  const levels = [...new Set(heights.map(y => y.toFixed(2)))].sort();
  assert.deepEqual(levels, ['40.00', '40.88'], 'the water surface sits just under the block top, rim included');
  assert.equal(surfaceVertices, 96, 'every rim and surface corner drops to the water line');
  assert.ok(near(Math.max(...heights), 40.88), 'nothing pokes above the water line');

  // Plants: crossed quads, in the plant group.
  const garden = new Chunk(0, 0);
  garden.set(0, 40, 0, 16);
  garden.setHeight(0, 0, 40);
  garden.highest = 40;
  const gardenWorld = {
    getBlock: (x, y, z) => (x === 0 && y === 40 && z === 0 ? 16 : 0),
    columnTop: () => 40,
    seed: 1,
  };
  assert.deepEqual(countFaces(meshChunk(gardenWorld, garden)), { opaque: 0, water: 0, plants: 2 }, 'plants are crossed quads');
}

// ------------------------------------------------------------------ ray casting

{
  const world = new VoxelWorld(99);
  world.ensureChunk(0, 0);
  const spawn = world.findSpawn();
  const topY = Math.floor(spawn.y) - 1;
  const hit = world.raycast({ x: 0.5, y: topY + 6, z: 0.5 }, { x: 0, y: -1, z: 0 }, 20);
  assert.ok(hit, 'looking down hits the ground');
  assert.equal(hit.y, topY, 'and lands on the surface block');
  assert.deepEqual([hit.nx, hit.ny, hit.nz], [0, 1, 0], 'the hit face points up');

  world.setBlock(4, topY + 1, 0, 3, false);
  const sideways = world.raycast({ x: 0.5, y: topY + 1.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10);
  assert.ok(sideways, 'rays find blocks in front of the player');
  assert.equal(sideways.x, 4);
  assert.deepEqual([sideways.nx, sideways.ny, sideways.nz], [-1, 0, 0], 'the hit face points back at the player');

  assert.equal(world.raycast({ x: 0.5, y: topY + 40, z: 0.5 }, { x: 0, y: 1, z: 0 }, 10), null, 'empty sky is no hit');
}

// ------------------------------------------------------------------ block table sanity

{
  assert.ok(BLOCKS.length >= 18, 'a good spread of blocks');
  for (const [id, block] of BLOCKS.entries()) {
    assert.equal(block.id, id, 'block ids match their index');
    assert.ok(typeof block.tiles.top === 'number', `${block.name} has face tiles`);
  }
  assert.ok(BLOCKS[1].opaque && BLOCKS[1].solid, 'grass is a solid opaque block');
  assert.ok(!BLOCKS[10].solid && BLOCKS[10].liquid, 'water is a liquid you can swim through');
  assert.ok(BLOCKS[16].plant, 'tall grass is a plant');
}

console.log('world, atlas and mesher tests passed');
